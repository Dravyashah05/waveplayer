import { useSyncExternalStore } from 'react';
import { Track } from '../types';
import { playerStore } from './playerStore';
import { logEvent } from './listeningStore';
import { classifySkipPosition, type TechnicalErrorKind } from './affinityWeights';
import { canRetryDirectStream } from './temporaryStreamCache';
import { settingsStore } from './settingsStore';
import { emitPlayerEvent } from './playerEvents';
import { normalizeAudioMetadata, normalizeNetworkType } from './audioSources';
import { audioSourceManager, type ResolvedAudio as ManagerResolvedAudio } from './audioSourceManager';

/**
 * The one and only playback engine.
 *
 * Single source of truth for: HTML5 audio + YouTube-iframe backends, play
 * intent vs actual state, buffering, progress, volume, errors, MediaSession
 * (lock screen / BT / OS media keys) and document title.
 *
 * Model:
 * - `wantPlay`  = what the user asked for (survives async stream resolving)
 * - `isPlaying` = what a backend is actually doing (driven by media events)
 * - Every queue mutation in playerStore bumps `revision`; the engine loads the
 *   new current track and autoplays — except the very first load (restored
 *   session must never autoplay).
 */

export interface ResolvedStream {
  source?: 'saavn' | 'youtube-audio' | 'youtube-iframe' | 'local' | 'custom';
  codec?: string;
  streamUrl?: string;
  downloadUrl?: string;
  ytId?: string;
  expiresAt?: number;
  mimeType?: string;
  bitrate?: number;
  bitrateKbps?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number | string;
  container?: string;
  duration?: number;
  isLossless?: boolean;
  streamType?: string;
  networkType?: string;
  bufferedSeconds?: number;
  contentLength?: number;
}


export interface EngineState {
  trackId: string | null;
  backend: 'audio' | 'youtube' | null;
  isPlaying: boolean;
  isBuffering: boolean;
  progress: number;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
  resolved: ResolvedStream | null;
  playbackRate: number;
  eqActive: boolean;
  crossfading: boolean;
  sleepRemainingSec: number | null;
}

const INITIAL_STATE: EngineState = {
  trackId: null,
  backend: null,
  isPlaying: false,
  isBuffering: false,
  progress: 0,
  duration: 0,
  volume: 80,
  muted: false,
  error: null,
  resolved: null,
  playbackRate: 1,
  eqActive: false,
  crossfading: false,
  sleepRemainingSec: null,
};

const LS_MUTED = 'wave:muted';
const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function loadMuted(): boolean {
  try { return localStorage.getItem(LS_MUTED) === '1'; } catch { return false; }
}
function saveMuted(m: boolean) {
  try { localStorage.setItem(LS_MUTED, m ? '1' : '0'); } catch {}
}
function https(url: string): string {
  return url.startsWith('http://') ? url.replace('http://', 'https://') : url;
}
function fmtForLog(s: number): number {
  return Math.max(0, Math.round(s));
}

/** Map a playback failure to a canonical technical-error kind (never taste). */
function errorKindFor(message: string, streamSource?: string): TechnicalErrorKind {
  if (streamSource === 'youtube-audio' || streamSource === 'youtube-iframe') return 'YOUTUBE_STREAM_FAILED';
  if (streamSource === 'saavn') return 'SAAVN_STREAM_FAILED';
  if (/network|fetch|timeout|offline|quota/i.test(message || '')) return 'NETWORK_ERROR';
  if (/no playable|missing|not found|unavailable/i.test(message || '')) return 'MISSING_AUDIO';
  return 'PLAYER_ERROR';
}

// ——— YouTube IFrame API loader (singleton promise) ———
let ytApiPromise: Promise<void> | null = null;
function loadYTApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') { resolve(); return; }
    const w = window as any;
    if (w.YT && w.YT.Player) { resolve(); return; }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') { try { prev(); } catch {} }
      resolve();
    };
    // Safety: never hang forever if the API is blocked
    window.setTimeout(() => resolve(), 12000);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

class PlayerEngine {
  private snapshot: EngineState = { ...INITIAL_STATE, volume: playerStore.volume, muted: loadMuted(), playbackRate: settingsStore.get().playbackRate };
  private listeners = new Set<() => void>();

  private audio: HTMLAudioElement | null = null;
  private ytContainer: HTMLElement | null = null;
  private ytPlayer: any = null;
  private ytTimer: number | null = null;
  private secondTimer: number | null = null;

  // Crossfade / Automix (temporary second element only during a transition)
  private xfAudio: HTMLAudioElement | null = null;
  private xfTimer: number | null = null;
  private xfActive = false;

  // Sleep timer
  private sleepTimeout: number | null = null;
  private sleepEndAt: number | null = null;
  private sleepEndOfTrack = false;

  // Optional WebAudio EQ graph (created lazily, torn down on failure)
  private eqCtx: AudioContext | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private eqGain: GainNode | null = null;
  private eqSource: MediaElementAudioSourceNode | null = null;
  private eqAttached = false;
  private eqAttaching = false;
  private eqAnalyser: AnalyserNode | null = null;
  private silenceStreak = 0;

  private lastRevision = -1;
  private currentTrack: Track | null = null;
  private loadGen = 0;
  private wantPlay = false;
  private pendingSeek: number | null = null;
  private seeking = false; // true while the user drags a seek slider
  private failedIds = new Set<string>();
  private preloadedNextId: string | null = null;
  private originalTitle: string = typeof document !== 'undefined' ? document.title : 'Wave Player';
  private unsubStore: (() => void) | null = null;
  private loggedMilestones = new Set<number>();
  // Listening-intelligence outcome tracking (one event per outcome, no spam):
  // - hasPausedThisTrack: pause was recorded → a later play logs 'resume' once.
  // - lastOutcomeTrackId: skip/complete/error already recorded for this track
  //   so sync() track-change detection never double-logs explicit outcomes.
  // - lastSeekLog: coalesces seek-slider drags to at most one event per 5s.
  private hasPausedThisTrack = false;
  private lastOutcomeTrackId: string | null = null;
  private lastSeekLog: { trackId: string; at: number } | null = null;

  constructor() {
    this.unsubStore = playerStore.subscribe(() => this.sync());
    if (typeof window !== 'undefined') {
      this.ytTimer = window.setInterval(() => this.tickYT(), 250);
      this.secondTimer = window.setInterval(() => this.tickSecond(), 1000);
    }
  }

  // ——— React binding ———
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = (): EngineState => this.snapshot;

  private set(patch: Partial<EngineState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (patch.progress !== undefined && this.currentTrack) {
      const duration = this.snapshot.duration || this.currentTrack.durationSeconds || 0;
      if (duration > 0) {
        const percent = (this.snapshot.progress / duration) * 100;
        for (const milestone of [10, 25, 50, 75]) {
          if (percent >= milestone && !this.loggedMilestones.has(milestone)) {
            this.loggedMilestones.add(milestone);
            logEvent({ songId: this.currentTrack.id, track: this.currentTrack, event: `${milestone}_percent` as '10_percent' | '25_percent' | '50_percent' | '75_percent', playedSeconds: fmtForLog(this.snapshot.progress), duration: fmtForLog(duration) });
          }
        }
      }
    }
    this.listeners.forEach((fn) => { try { fn(); } catch {} });
  }

  // ——— Mounting ———
  /** Called once by PlayerBar with the hidden YT mount node. Idempotent. */
  attach(container: HTMLElement | null) {
    if (container) this.ytContainer = container;
    this.sync(true);
  }

  // ——— Store sync ———
  private sync(force = false) {
    const rev = playerStore.revision;
    if (!force && rev === this.lastRevision) return;
    this.lastRevision = rev;
    const cur = playerStore.current();
    if (!cur) {
      this.logTrackStop();
      this.stopAll();
      this.currentTrack = null;
      this.set({
        trackId: null, backend: null, isPlaying: false, isBuffering: false,
        progress: 0, duration: 0, error: null, resolved: null,
      });
      this.updateMedia(null, false);
      return;
    }
    if (cur.id === this.currentTrack?.id) {
      // Same track (reorder, remove-elsewhere, or re-attach) — keep playing,
      // just make sure the backend surface still exists.
      this.ensureSurface();
      this.preloadNext();
      return;
    }
    this.loggedMilestones.clear();
    this.logTrackChange(this.currentTrack);
    this.hasPausedThisTrack = false;
    const isFirstLoad = this.currentTrack === null && this.snapshot.trackId === null;
    void this.loadTrack(cur, !isFirstLoad);
  }

  /**
   * Track-change skip detection with the REAL playback position. Covers every
   * path that swaps the current track without an explicit outcome already
   * logged by next()/prev()/fail()/onEnded() (setIndex jumps, queue edits,
   * crossfade handover, radio prefetch advance). Logs at most one skip per
   * track; silent when nothing audible happened (progress ≤ 1s, not playing).
   */
  private logTrackChange(prev: Track | null) {
    if (!prev || this.lastOutcomeTrackId === prev.id) return;
    const progress = fmtForLog(this.snapshot.progress);
    if (!this.snapshot.isPlaying && progress <= 1) return;
    const duration = fmtForLog(this.snapshot.duration || prev.durationSeconds || 0);
    try {
      logEvent({
        songId: prev.id, track: prev, event: 'skip', playedSeconds: progress, duration,
        meta: { via: 'track-change', skipPosition: classifySkipPosition(progress, duration) },
      });
    } catch {}
    this.lastOutcomeTrackId = prev.id;
  }

  /** A playing track vanished (queue cleared/emptied) — record a single skip. */
  private logTrackStop() {
    const prev = this.currentTrack;
    if (!prev || this.lastOutcomeTrackId === prev.id) return;
    const progress = fmtForLog(this.snapshot.progress);
    if (!this.snapshot.isPlaying && progress <= 1) return;
    const duration = fmtForLog(this.snapshot.duration || prev.durationSeconds || 0);
    try {
      logEvent({
        songId: prev.id, track: prev, event: 'skip', playedSeconds: progress, duration,
        meta: { via: 'stop', skipPosition: classifySkipPosition(progress, duration) },
      });
    } catch {}
    this.lastOutcomeTrackId = prev.id;
  }

  /** Re-create a missing backend surface without interrupting playback state. */
  private ensureSurface() {
    const t = this.currentTrack;
    const ytId = this.snapshot.resolved?.ytId;
    if (t && ytId && this.snapshot.backend === 'youtube' && !this.ytPlayer && this.ytContainer) {
      const gen = ++this.loadGen;
      this.set({ isBuffering: true });
      void this.startYT(t, ytId, this.wantPlay, gen);
    }
  }

  // ——— Stream resolution ———
  // Owned entirely by AudioSourceManager (chain, fallback, cache, dedup).
  // The engine only maps the normalized result onto its backend-facing
  // ResolvedStream. Stale protection stays here via loadGen (Task 01).
  private directRetries = new Map<string, number>();
  private audioRecoveries = new Map<string, Promise<void>>();

  private async resolveStream(track: Track, forceRefresh = false): Promise<ResolvedStream> {
    const { resolved } = await audioSourceManager.resolve(track, { forceRefresh });
    if (!resolved) return {};
    return this.toStream(track, resolved);
  }

  /** Single mapping point: manager result → backend-facing stream. */
  private toStream(track: Track, resolved: ManagerResolvedAudio): ResolvedStream {
    const source = resolved.sourceId === 'saavn' ? 'saavn'
      : resolved.sourceId === 'youtube' ? 'youtube-audio'
        : resolved.sourceId === 'youtube-player' || resolved.type === 'iframe' ? 'youtube-iframe'
          : resolved.sourceId === 'local' || resolved.sourceId === 'offline' ? 'local'
            : 'custom';
    return {
      source,
      streamUrl: resolved.url ? https(resolved.url) : undefined,
      ytId: resolved.ytId,
      expiresAt: resolved.expiresAt,
      mimeType: resolved.mimeType,
      codec: resolved.codec,
      bitrate: resolved.bitrate,
      bitrateKbps: resolved.bitrateKbps,
      sampleRate: resolved.sampleRate,
      bitDepth: resolved.bitDepth,
      channels: resolved.channels,
      container: resolved.container,
      duration: resolved.duration,
      isLossless: resolved.isLossless,
      streamType: resolved.streamType,
      networkType: resolved.networkType,
      bufferedSeconds: resolved.bufferedSeconds,
      downloadUrl: resolved.downloadUrl ? https(resolved.downloadUrl) : undefined,
    };
  }

  /** Warm the manager cache for the upcoming track so "next" is instant. */
  private preloadNext() {
    try {
      if (!settingsStore.get().gapless) return;
      const nxt = playerStore.peekNext();
      if (nxt && nxt.id !== this.preloadedNextId && !nxt.streamUrl && !audioSourceManager.hasCached(nxt.id)) {
        this.preloadedNextId = nxt.id;
        audioSourceManager.resolve(nxt).catch(() => {});
      }
    } catch {}
  }

  // ——— Track loading ———
  private async loadTrack(track: Track, autoplay: boolean) {
    const gen = ++this.loadGen;
    this.teardownXf();
    this.teardownYT();
    const audio = this.ensureAudio();
    try { audio.pause(); } catch {}
    audio.removeAttribute('src');
    try { audio.load(); } catch {}

    this.currentTrack = track;
    this.wantPlay = autoplay;
    this.directRetries.delete(track.id);
    this.silenceSkipsThisTrack = 0;
    this.silenceStreak = 0;
    this.pendingSeek = null;
    this.hasPausedThisTrack = false;
    this.lastSeekLog = null;
    this.lastOutcomeTrackId = null;
    this.failedIds.delete(track.id);
    this.set({
      trackId: track.id, backend: null, isPlaying: false,
      isBuffering: true, progress: 0,
      duration: track.durationSeconds > 0 ? track.durationSeconds : 0,
      error: null, resolved: null,
    });
    this.updateMedia(track, false);

    let resolved: ResolvedStream;
    try {
      resolved = await this.resolveStream(track);
    } catch {
      resolved = {};
    }
    if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return; // stale

    if (resolved.streamUrl) {
      this.startAudio(track, resolved, this.wantPlay);
    } else if (resolved.ytId) {
      this.set({ resolved });
      await this.startYT(track, resolved.ytId, this.wantPlay, gen);
    } else {
      this.fail(track, 'No playable stream found');
    }
  }

  // ——— HTML5 audio backend ———
  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      const a = document.createElement('audio');
      a.preload = 'auto';
      try { a.crossOrigin = 'anonymous'; } catch {}
      a.addEventListener('timeupdate', () => {
        if (!this.seeking) this.set({ progress: a.currentTime });
        this.updatePositionState();
        this.maybeCrossfade(a);
      });
      a.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(a.duration)) this.setActualDuration(a.duration);
        if (this.pendingSeek != null) {
          try { a.currentTime = this.pendingSeek; } catch {}
          this.set({ progress: this.pendingSeek });
          this.pendingSeek = null;
        }
      });
      a.addEventListener('play', () => {
        this.failedIds.delete(this.currentTrack?.id ?? '');
        this.set({ isPlaying: true, isBuffering: false, error: null });
        this.updateMedia(this.currentTrack, true);
        this.preloadNext();
        if (this.currentTrack) emitPlayerEvent({ type: 'PLAY', track: this.currentTrack });
      });
      a.addEventListener('pause', () => {
        this.set({ isPlaying: false, isBuffering: this.wantPlay });
        this.updateMedia(this.currentTrack, false);
        if (this.currentTrack) emitPlayerEvent({ type: 'PAUSE', track: this.currentTrack, progress: this.snapshot.progress });
      });
      a.addEventListener('waiting', () => {
        if (this.wantPlay) this.set({ isBuffering: true });
      });
      a.addEventListener('playing', () => this.set({ isBuffering: false }));
      a.addEventListener('canplay', () => {
        if (this.wantPlay && a.paused) this.playAudio(a);
        else if (!this.wantPlay) this.set({ isBuffering: false });
      });
      a.addEventListener('ended', () => this.onEnded());
      a.addEventListener('error', () => {
        const t = this.currentTrack;
        if (!t || this.snapshot.trackId !== t.id || this.snapshot.backend !== 'audio') return;
        // A CORS-opaque stream goes silent through MediaElementSource — drop
        // the EQ graph first so plain playback can continue.
        if (this.eqAttached) {
          this.teardownEq();
          settingsStore.set('eqEnabled', false);
        }
        void this.recoverAudioFailure(t);
      });
      this.audio = a;
      if (settingsStore.get().eqEnabled && !this.eqAttached && !this.eqAttaching) {
        this.eqAttaching = true;
        try {
          this.attachEq();
        } finally {
          this.eqAttaching = false;
        }
      }
    }
    return this.audio;
  }

  private playAudio(a: HTMLAudioElement) {
    a.play().then(() => {}).catch((err) => {
      const name = (err as any)?.name;
      if (name === 'AbortError') return;
      if (name === 'NotAllowedError') {
        this.wantPlay = false;
        this.set({ isPlaying: false, isBuffering: false });
        return;
      }
      if (this.currentTrack && this.snapshot.backend === 'audio') {
        void this.recoverAudioFailure(this.currentTrack);
        return;
      }
      this.wantPlay = false;
      this.set({ isPlaying: false, isBuffering: false });
    });
  }

  private recoverAudioFailure(track: Track): Promise<void> {
    const pending = this.audioRecoveries.get(track.id);
    if (pending) return pending;
    const recovery = (async () => {
      if (this.currentTrack?.id !== track.id) return;
      const autoplay = this.wantPlay;
      const previous = this.snapshot.resolved;
      const gen = ++this.loadGen;
      if (this.audio) {
        try { this.audio.pause(); } catch {}
        this.audio.removeAttribute('src');
        try { this.audio.load(); } catch {}
      }

      let videoId = previous?.ytId;
      if (previous?.source === 'youtube-audio' && videoId && canRetryDirectStream(this.directRetries.get(track.id) || 0)) {
        this.directRetries.set(track.id, 1);
        if (import.meta.env.DEV) console.debug('[Wave Stream] Direct stream failed — retrying');
        const refreshed = await audioSourceManager.refreshYoutubeDirect(track, videoId);
        if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return;
        if (refreshed?.url) {
          if (import.meta.env.DEV) console.debug('[Wave Stream] Retrying refreshed audio stream');
          this.startAudio(track, this.toStream(track, refreshed), autoplay);
          return;
        }
      }

      if (!videoId && track.source === 'saavn') {
        videoId = (await audioSourceManager.findYoutubeMatch(track)) ?? undefined;
        if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return;
        if (videoId) {
          const audio = await audioSourceManager.refreshYoutubeDirect(track, videoId);
          if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return;
          if (audio?.url) {
            this.startAudio(track, this.toStream(track, audio), autoplay);
            return;
          }
        }
      }

      videoId ||= YT_ID_RE.test(track.id) ? track.id : undefined;
      if (videoId) {
        if (import.meta.env.DEV) console.debug('[Wave Stream] Falling back to YouTube IFrame');
        audioSourceManager.cacheIframeFallback(track.id, videoId);
        this.set({ resolved: { source: 'youtube-iframe', ytId: videoId }, backend: null, isBuffering: true, isPlaying: false });
        await this.startYT(track, videoId, autoplay, gen);
      } else {
        this.fail(track, 'Audio stream failed to load');
      }
    })().finally(() => {
      if (this.audioRecoveries.get(track.id) === recovery) this.audioRecoveries.delete(track.id);
    });
    this.audioRecoveries.set(track.id, recovery);
    return recovery;
  }

  private startAudio(track: Track, resolved: ResolvedStream, autoplay: boolean) {
    const a = this.ensureAudio();
    a.volume = this.snapshot.muted ? 0 : this.snapshot.volume / 100;
    try { a.playbackRate = this.snapshot.playbackRate; } catch {}
    a.src = https(resolved.streamUrl!);
    try { a.load(); } catch {}
    this.set({ backend: 'audio', resolved });
    emitPlayerEvent({ type: 'SOURCE_CHANGED', track, source: resolved.source });
    if (autoplay) {
      this.set({ isBuffering: true });
      this.playAudio(a);
    } else {
      this.set({ isBuffering: false, isPlaying: false });
    }
    emitPlayerEvent({ type: 'TRACK_START', track, duration: this.snapshot.duration || track.durationSeconds || 0 });
  }

  // ——— YouTube iframe backend ———
  private async startYT(track: Track, videoId: string, autoplay: boolean, gen: number) {
    await loadYTApi();
    if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return;
    const w = window as any;
    if (!w.YT || !w.YT.Player) { this.fail(track, 'YouTube player failed to load'); return; }
    const host = this.ytContainer;
    if (!host) { this.fail(track, 'Player surface unavailable'); return; }
    this.teardownYT();
    host.innerHTML = '';
    const mount = document.createElement('div');
    host.appendChild(mount);
    this.set({ backend: 'youtube', isBuffering: true });
    emitPlayerEvent({ type: 'SOURCE_CHANGED', track, source: 'youtube-iframe' });
    try {
      this.ytPlayer = new w.YT.Player(mount, {
        videoId,
        playerVars: { autoplay: autoplay ? 1 : 0, controls: 0, modestbranding: 1, rel: 0, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: (e: any) => {
            if (this.currentTrack?.id !== track.id) return;
            try {
              const d = e.target.getDuration?.();
              if (d) this.setActualDuration(d);
              e.target.setVolume?.(this.snapshot.muted ? 0 : this.snapshot.volume);
              if (this.pendingSeek != null) {
                try { e.target.seekTo?.(this.pendingSeek, true); } catch {}
                this.set({ progress: this.pendingSeek });
                this.pendingSeek = null;
              }
            } catch {}
            if (this.wantPlay) { try { e.target.playVideo?.(); } catch {} }
            else { try { e.target.pauseVideo?.(); } catch {}; this.set({ isPlaying: false, isBuffering: false }); }
          },
          onStateChange: (e: any) => {
            if (this.currentTrack?.id !== track.id) return;
            const YT = (window as any).YT;
            const s = e.data;
            if (s === YT.PlayerState.PLAYING) {
              try {
                const d = e.target.getDuration?.();
                if (d) this.setActualDuration(d);
              } catch {}
              this.failedIds.delete(track.id);
              this.set({ isPlaying: true, isBuffering: false, error: null });
              this.updateMedia(track, true);
              this.preloadNext();
            } else if (s === YT.PlayerState.PAUSED) {
              this.set({ isPlaying: false, isBuffering: this.wantPlay });
              this.updateMedia(track, false);
            } else if (s === YT.PlayerState.BUFFERING || s === YT.PlayerState.CUED) {
              if (this.wantPlay) this.set({ isBuffering: true });
            } else if (s === YT.PlayerState.ENDED) {
              this.set({ isPlaying: false });
              this.onEnded();
            }
          },
          onError: () => {
            if (this.currentTrack?.id === track.id) this.fail(track, 'YouTube playback failed');
          },
        },
      });
    } catch {
      this.fail(track, 'YouTube player failed to load');
    }
  }

  private tickYT() {
    const p = this.ytPlayer;
    if (!p || this.snapshot.backend !== 'youtube') return;
    try {
      if (typeof p.getCurrentTime === 'function' && !this.seeking) {
        this.set({ progress: p.getCurrentTime() || 0 });
      }
      if (typeof p.getDuration === 'function') {
        const d = p.getDuration();
        if (d && d !== this.snapshot.duration) this.setActualDuration(d);
      }
    } catch {}
  }

  private teardownYT() {
    try { this.ytPlayer?.destroy?.(); } catch {}
    this.ytPlayer = null;
    if (this.ytContainer) {
      try { this.ytContainer.innerHTML = ''; } catch {}
    }
  }

  private stopAll() {
    this.loadGen++;
    this.wantPlay = false;
    this.pendingSeek = null;
    this.teardownXf();
    this.teardownYT();
    if (this.audio) {
      try { this.audio.pause(); } catch {}
      this.audio.removeAttribute('src');
      try { this.audio.load(); } catch {}
    }
    if (typeof document !== 'undefined') document.title = this.originalTitle;
  }

  // ——— Failure → fallback once, else error (+ auto-skip when possible) ———
  private fail(track: Track, message: string) {
    if (this.currentTrack?.id !== track.id) return;
    emitPlayerEvent({ type: 'TRACK_ERROR', track, reason: message });
    // Auto-skip poisoned tracks so one bad item never stalls the session
    if (!this.failedIds.has(track.id) && playerStore.queue().length > 1) {
      this.failedIds.add(track.id);
      this.set({ error: message, isBuffering: false, isPlaying: false });
      try {
        // Technical failure: recorded as a NEUTRAL 'error' event (never a
        // skip/dislike). skip_counts, engagement and affinity all ignore it.
        logEvent({
          songId: track.id, track, event: 'error',
          playedSeconds: fmtForLog(this.snapshot.progress),
          duration: fmtForLog(this.snapshot.duration || track.durationSeconds || 0),
          meta: {
            via: 'error', technical: true,
            errorKind: errorKindFor(message, this.snapshot.resolved?.source),
            streamSource: this.snapshot.resolved?.source,
            reason: message,
          },
        });
      } catch {}
      this.lastOutcomeTrackId = track.id;
      playerStore.next();
      return;
    }
    this.wantPlay = false;
    this.set({ error: message, isBuffering: false, isPlaying: false });
    this.updateMedia(track, false);
  }

  retry() {
    const t = this.currentTrack;
    if (!t) return;
    this.failedIds.delete(t.id);
    this.set({ error: null });
    void this.loadTrack(t, true);
  }

  replay() {
    const t = this.currentTrack;
    if (!t) return;
    this.failedIds.delete(t.id);
    this.set({ error: null });
    void this.loadTrack(t, true);
  }

  // ——— Transport ———
  toggle() {
    const t = this.currentTrack;
    if (!t || this.snapshot.error) {
      if (this.snapshot.error) this.retry();
      return;
    }
    this.wantPlay = !this.wantPlay;
    this.applyIntent();
  }

  play() {
    if (!this.currentTrack) return;
    if (this.snapshot.error) { this.retry(); return; }
    this.wantPlay = true;
    this.applyIntent();
  }

  pause() {
    this.wantPlay = false;
    this.applyIntent();
  }

  private applyIntent() {
    const s = this.snapshot;
    const t = this.currentTrack;
    // Pause → record once (only when something audible was playing).
    if (!this.wantPlay && s.isPlaying && t && s.trackId === t.id && !s.error) {
      try {
        logEvent({
          songId: t.id, track: t, event: 'pause',
          playedSeconds: fmtForLog(s.progress),
          duration: fmtForLog(s.duration || t.durationSeconds || 0),
        });
      } catch {}
      this.hasPausedThisTrack = true;
    }
    // Resume → record once (only after a recorded pause of the same track,
    // so initial autoplay and repeat presses never double-log).
    if (this.wantPlay && !s.isPlaying && this.hasPausedThisTrack && t && s.trackId === t.id && !s.error) {
      try {
        logEvent({
          songId: t.id, track: t, event: 'resume',
          playedSeconds: fmtForLog(s.progress),
          duration: fmtForLog(s.duration || t.durationSeconds || 0),
        });
      } catch {}
      this.hasPausedThisTrack = false;
    }
    if (s.backend === 'audio' && this.audio) {
      if (this.wantPlay) {
        if (this.audio.paused) {
          this.set({ isBuffering: true });
          this.playAudio(this.audio);
        }
      } else {
        try { this.audio.pause(); } catch {}
        this.set({ isPlaying: false, isBuffering: false });
      }
      return;
    }
    if (s.backend === 'youtube' && this.ytPlayer) {
      try {
        const YT = (window as any).YT;
        const st = this.ytPlayer.getPlayerState?.();
        if (this.wantPlay && st !== YT?.PlayerState?.PLAYING) {
          this.set({ isBuffering: true });
          this.ytPlayer.playVideo?.();
        } else if (!this.wantPlay && st !== YT?.PlayerState?.PAUSED) {
          this.ytPlayer.pauseVideo?.();
        }
      } catch {}
      return;
    }
    // Backend not ready yet (resolving) — wantPlay is honored on ready.
    this.set({ isBuffering: this.wantPlay });
  }

  seek(sec: number) {
    const t = this.currentTrack;
    if (!t) return;
    const target = Math.max(0, Math.min(sec, this.snapshot.duration || sec));
    // Seeks are user intent, not taste: coalesce slider drags to ≤1 event/5s.
    const now = Date.now();
    if (!this.lastSeekLog || this.lastSeekLog.trackId !== t.id || now - this.lastSeekLog.at > 5000) {
      this.lastSeekLog = { trackId: t.id, at: now };
      try {
        logEvent({
          songId: t.id, track: t, event: 'seek',
          playedSeconds: fmtForLog(target),
          duration: fmtForLog(this.snapshot.duration || t.durationSeconds || 0),
          meta: { via: 'seek' },
        });
      } catch {}
    }
    this.set({ progress: target });
    emitPlayerEvent({ type: 'SEEK', track: t, progress: target });
    const s = this.snapshot;
    if (s.backend === 'audio' && this.audio) {
      try {
        if ((this.audio.readyState ?? 0) > 0) this.audio.currentTime = target;
        else this.pendingSeek = target;
      } catch { this.pendingSeek = target; }
      return;
    }
    if (s.backend === 'youtube' && this.ytPlayer) {
      try { this.ytPlayer.seekTo?.(target, true); }
      catch { this.pendingSeek = target; }
      return;
    }
    this.pendingSeek = target;
  }

  setSeeking(active: boolean) {
    this.seeking = active;
  }

  next() {
    const t = this.currentTrack;
    if (!t) return;
    try {
      const progress = fmtForLog(this.snapshot.progress);
      const duration = fmtForLog(this.snapshot.duration || t.durationSeconds || 0);
      logEvent({
        songId: t.id, track: t, event: 'skip', playedSeconds: progress, duration,
        meta: { via: 'next', skipPosition: classifySkipPosition(progress, duration) },
      });
    } catch {}
    this.lastOutcomeTrackId = t.id;
    emitPlayerEvent({ type: 'TRACK_SKIP', track: t, progress: this.snapshot.progress, reason: 'next' });
    playerStore.next();
  }

  prev() {
    const t = this.currentTrack;
    if (!t) return;
    // Restart when well into the track (platform-standard behavior)
    if (this.snapshot.progress > 3) {
      try {
        logEvent({ songId: t.id, track: t, event: 'replay', playedSeconds: fmtForLog(this.snapshot.progress), duration: fmtForLog(this.snapshot.duration || t.durationSeconds || 0) });
      } catch {}
      this.replay();
      return;
    }
    try {
      const progress = fmtForLog(this.snapshot.progress);
      const duration = fmtForLog(this.snapshot.duration || t.durationSeconds || 0);
      logEvent({
        songId: t.id, track: t, event: 'skip', playedSeconds: progress, duration,
        meta: { via: 'prev', skipPosition: classifySkipPosition(progress, duration) },
      });
    } catch {}
    this.lastOutcomeTrackId = t.id;
    playerStore.prev();
  }

  private onEnded() {
    const t = this.currentTrack;
    if (!t) return;
    try {
      logEvent({ songId: t.id, track: t, event: 'complete', playedSeconds: fmtForLog(this.snapshot.duration || t.durationSeconds || 0), duration: fmtForLog(this.snapshot.duration || t.durationSeconds || 0), meta: { via: 'ended' } });
    } catch {}
    this.lastOutcomeTrackId = t.id;
    if (this.sleepEndOfTrack) {
      this.clearSleepTimer();
      this.wantPlay = false;
      this.set({ isPlaying: false, isBuffering: false, progress: 0 });
      this.updateMedia(t, false);
      return;
    }
    if (playerStore.repeat === 'one') {
      this.replay();
      return;
    }
    const before = playerStore.currentIndex();
    playerStore.next();
    // repeat=off at the end of the queue → next() is a no-op: stop cleanly
    if (playerStore.currentIndex() === before && playerStore.current()?.id === t.id) {
      this.wantPlay = false;
      const a = this.audio;
      if (a && this.snapshot.backend === 'audio') { try { a.currentTime = 0; } catch {} }
      this.set({ isPlaying: false, isBuffering: false, progress: 0 });
      this.updateMedia(t, false);
    }
  }

  // ——— Volume ———
  setVolume(v: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    playerStore.setVolume(clamped);
    if (clamped > 0 && this.snapshot.muted) {
      saveMuted(false);
      this.set({ muted: false });
    }
    this.set({ volume: clamped });
    if (this.audio) {
      try { this.audio.volume = this.snapshot.muted ? 0 : clamped / 100; } catch {}
    }
    try { this.ytPlayer?.setVolume?.(this.snapshot.muted ? 0 : clamped); } catch {}
  }

  toggleMute() {
    const next = !this.snapshot.muted;
    saveMuted(next);
    this.set({ muted: next });
    if (this.audio) {
      try { this.audio.volume = next ? 0 : this.snapshot.volume / 100; } catch {}
    }
    try { this.ytPlayer?.setVolume?.(next ? 0 : this.snapshot.volume); } catch {}
  }

  // ——— Playback speed (0.5x–2x, persisted) ———
  setPlaybackRate(rate: number) {
    const r = Math.max(0.5, Math.min(2, Math.round(rate * 100) / 100));
    settingsStore.set('playbackRate', r);
    this.set({ playbackRate: r });
    if (this.audio) {
      try { this.audio.playbackRate = r; } catch {}
    }
  }

  // ——— Sleep timer ———
  setSleepTimer(minutes: number) {
    this.clearSleepTimer();
    const mins = Math.max(0, Math.min(480, Math.round(minutes)));
    if (mins <= 0) {
      this.sleepEndOfTrack = false;
      this.set({ sleepRemainingSec: null });
      return;
    }
    this.sleepEndOfTrack = false;
    this.sleepEndAt = Date.now() + mins * 60_000;
    this.set({ sleepRemainingSec: mins * 60 });
    this.armSleepTimeout();
  }

  setSleepEndOfTrack(on: boolean) {
    this.clearSleepTimer();
    this.sleepEndOfTrack = on;
    this.set({ sleepRemainingSec: on ? -1 : null });
  }

  clearSleepTimer() {
    if (this.sleepTimeout != null) {
      try { window.clearTimeout(this.sleepTimeout); } catch {}
      this.sleepTimeout = null;
    }
    this.sleepEndAt = null;
    this.sleepEndOfTrack = false;
    if (this.snapshot.sleepRemainingSec !== null) this.set({ sleepRemainingSec: null });
  }

  get sleepArmed(): boolean {
    return this.sleepTimeout != null || this.sleepEndOfTrack;
  }

  private armSleepTimeout() {
    if (this.sleepEndAt == null || this.sleepTimeout != null) return;
    const delay = Math.max(0, this.sleepEndAt - Date.now());
    this.sleepTimeout = window.setTimeout(() => {
      this.sleepTimeout = null;
      this.sleepEndAt = null;
      this.set({ sleepRemainingSec: null });
      this.pause();
    }, delay);
  }

  private tickSecond() {
    if (this.sleepEndAt != null) {
      const remain = Math.max(0, Math.round((this.sleepEndAt - Date.now()) / 1000));
      if (remain !== this.snapshot.sleepRemainingSec) this.set({ sleepRemainingSec: remain });
    }
    this.updatePositionState();
    this.tickSilenceSkip();
  }

  private updatePositionState() {
    try {
      const nav = navigator as any;
      const ms = nav?.mediaSession;
      if (!ms || typeof ms.setPositionState !== 'function') return;
      const d = this.snapshot.duration;
      if (!(d > 0)) return;
      ms.setPositionState({ duration: d, playbackRate: this.snapshot.playbackRate, position: Math.min(this.snapshot.progress, d) });
    } catch {}
  }

  private setActualDuration(duration: number) {
    if (!(Number.isFinite(duration) && duration > 0)) return;
    const resolved = this.snapshot.resolved;
    this.set({ duration, resolved: resolved ? { ...resolved, duration } : resolved });
  }

  // ——— Crossfade / Automix Beta ———
  /** Effective overlap seconds. Automix reuses the same path with its own
   *  length; there is no true beat matching (no BPM analysis available), so
   *  Automix is honestly an intelligent crossfade. */
  private transitionSeconds(): number {
    const s = settingsStore.get();
    if (s.automix && s.experimentalAutomix) return Math.max(2, Math.min(12, s.automixSeconds));
    return Math.max(0, Math.min(12, s.crossfadeSeconds));
  }

  private maybeCrossfade(a: HTMLAudioElement) {
    if (this.xfActive || !this.wantPlay || this.snapshot.backend !== 'audio') return;
    const seconds = this.transitionSeconds();
    if (seconds <= 0 || !Number.isFinite(a.duration) || a.duration <= seconds + 1) return;
    const remaining = a.duration - a.currentTime;
    if (remaining > seconds || remaining < 0.5) return;
    const next = playerStore.peekNext();
    if (!next || next.id === this.currentTrack?.id) return;
    if (playerStore.repeat === 'one') return;
    void this.beginCrossfade(next, seconds);
  }

  private teardownXf() {
    if (this.xfTimer != null) {
      try { window.clearInterval(this.xfTimer); } catch {}
      this.xfTimer = null;
    }
    if (this.xfAudio) {
      try { this.xfAudio.pause(); } catch {}
      try { this.xfAudio.removeAttribute('src'); } catch {}
      try { this.xfAudio.load(); } catch {}
      this.xfAudio = null;
    }
    this.xfActive = false;
    if (this.snapshot.crossfading) this.set({ crossfading: false });
  }

  private async beginCrossfade(next: Track, seconds: number) {
    if (this.xfActive || !this.audio) return;
    const main = this.audio;
    const gen = this.loadGen;
    let resolved: ResolvedStream;
    try {
      resolved = await this.resolveStream(next);
    } catch {
      return;
    }
    // Stale guard: a track change / retry / teardown during resolution
    // invalidates this transition. peekNext alone is insufficient (user can
    // navigate away and back to the same next item within the window).
    if (gen !== this.loadGen) return;
    if (this.currentTrack?.id === next.id) return;
    if (!resolved.streamUrl || !this.wantPlay || this.snapshot.backend !== 'audio') return;
    // Queue must not have shifted under us.
    if (playerStore.peekNext()?.id !== next.id) return;
    const target = this.snapshot.muted ? 0 : this.snapshot.volume / 100;
    const tmp = document.createElement('audio');
    tmp.preload = 'auto';
    try { tmp.playbackRate = this.snapshot.playbackRate; } catch {}
    try { tmp.crossOrigin = 'anonymous'; } catch {}
    this.xfAudio = tmp;
    this.xfActive = true;
    this.set({ crossfading: true });
    tmp.src = https(resolved.streamUrl);
    try { tmp.load(); } catch {}
    tmp.volume = 0;
    try {
      await tmp.play();
    } catch {
      this.teardownXf();
      return;
    }
    const steps = Math.max(4, Math.round(seconds * 10));
    let step = 0;
    this.xfTimer = window.setInterval(() => {
      step++;
      const k = Math.min(1, step / steps);
      try { main.volume = target * (1 - k); } catch {}
      try { tmp.volume = target * k; } catch {}
      if (k >= 1) {
        if (this.xfTimer != null) {
          try { window.clearInterval(this.xfTimer); } catch {}
          this.xfTimer = null;
        }
        // Handover guard: the queue may have moved under the fade
        // (user skipped / cleared / new session). Never advance a stale fade.
        if (gen !== this.loadGen || !this.wantPlay || playerStore.peekNext()?.id !== next.id) {
          this.teardownXf();
          return;
        }
        // Hand over: advance the store, then align the fresh element.
        const at = Math.min(Math.max(0, tmp.currentTime), seconds + 0.5);
        const tmpEl = tmp;
        playerStore.next();
        window.setTimeout(() => {
          try {
            if (this.audio && this.snapshot.trackId === next.id) {
              this.audio.currentTime = at;
              this.audio.volume = target;
              try { this.audio.playbackRate = this.snapshot.playbackRate; } catch {}
            }
          } catch {}
          try { tmpEl.pause(); } catch {}
          try { tmpEl.removeAttribute('src'); } catch {}
          if (this.xfAudio === tmpEl) this.xfAudio = null;
          this.xfActive = false;
          if (this.snapshot.crossfading) this.set({ crossfading: false });
        }, 350);
      }
    }, 100);
  }

  // ——— Optional WebAudio EQ (9-band). Created lazily; any failure tears the
  // graph down and plain HTMLAudio continues. Cross-origin streams without
  // CORS headers will go silent through MediaElementSource — if the main
  // element errors while the graph is attached, we auto-disable. ———
  static readonly EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000];

  static presetGains(preset: string): number[] {
    switch (preset) {
      case 'bass': return [6, 5, 4, 2, 0, 0, 0, 0, 0];
      case 'treble': return [0, 0, 0, 0, 0, 2, 4, 5, 6];
      case 'vocal': return [-2, -1, 0, 2, 4, 4, 2, 0, -1];
      case 'rock': return [5, 3, 2, 1, 0, 1, 3, 4, 5];
      case 'pop': return [2, 3, 4, 3, 1, 0, 1, 2, 3];
      case 'classical': return [4, 3, 2, 1, 0, 1, 2, 4, 5];
      default: return [0, 0, 0, 0, 0, 0, 0, 0, 0];
    }
  }

  setEqEnabled(on: boolean) {
    settingsStore.set('eqEnabled', on);
    if (on) this.attachEq();
    else this.teardownEq();
  }

  setEqPreset(preset: string) {
    const gains = PlayerEngine.presetGains(preset);
    settingsStore.set('eqPreset', preset as any);
    settingsStore.set('eqGains', gains);
    this.applyEqGains();
  }

  setEqGains(gains: number[]) {
    const clamped = PlayerEngine.EQ_FREQS.map((_, i) => Math.max(-12, Math.min(12, Number(gains[i]) || 0)));
    settingsStore.set('eqPreset', 'custom');
    settingsStore.set('eqGains', clamped);
    this.applyEqGains();
  }

  private attachEq() {
    if (this.eqAttached || typeof window === 'undefined') return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) throw new Error('no AudioContext');
      const audio = this.ensureAudio();
      const ctx = new AC();
      const src = ctx.createMediaElementSource(audio);
      let node: AudioNode = src as unknown as AudioNode;
      this.eqNodes = PlayerEngine.EQ_FREQS.map((f) => {
        const bq = ctx.createBiquadFilter();
        bq.type = 'peaking';
        bq.frequency.value = f;
        bq.Q.value = 1;
        bq.gain.value = 0;
        node.connect(bq);
        node = bq;
        return bq;
      });
      this.eqGain = ctx.createGain();
      this.eqGain.gain.value = 1;
      node.connect(this.eqGain);
      this.eqAnalyser = ctx.createAnalyser();
      this.eqAnalyser.fftSize = 512;
      this.eqGain.connect(this.eqAnalyser);
      this.eqAnalyser.connect(ctx.destination);
      this.eqCtx = ctx;
      this.eqSource = src;
      this.eqAttached = true;
      this.applyEqGains();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      this.set({ eqActive: true });
    } catch {
      this.teardownEq();
      settingsStore.set('eqEnabled', false);
    }
  }

  private applyEqGains() {
    if (!this.eqAttached) return;
    const gains = settingsStore.get().eqGains;
    this.eqNodes.forEach((n, i) => {
      try { n.gain.value = gains[i] || 0; } catch {}
    });
  }

  private teardownEq() {
    try { this.eqNodes.forEach((n) => { try { n.disconnect(); } catch {} }); } catch {}
    try { this.eqGain?.disconnect(); } catch {}
    try { this.eqAnalyser?.disconnect(); } catch {}
    try { this.eqSource?.disconnect(); } catch {}
    if (this.eqCtx) {
      try { void this.eqCtx.close().catch(() => {}); } catch {}
    }
    this.eqCtx = null;
    this.eqNodes = [];
    this.eqGain = null;
    this.eqAnalyser = null;
    this.eqSource = null;
    this.eqAttached = false;
    this.silenceStreak = 0;
    if (this.snapshot.eqActive) this.set({ eqActive: false });
  }

  // Experimental skip-silence: only active while the EQ analyser chain is
  // attached (no full-track decode, no extra work). Skips forward in small
  // steps past sustained near-silence; bounded per track to avoid runaway.
  private silenceSkipsThisTrack = 0;

  private tickSilenceSkip() {
    try {
      const s = settingsStore.get();
      if (!s.skipSilence || !s.experimentalSkipSilence || !this.eqAttached || !this.eqAnalyser) {
        this.silenceStreak = 0;
        return;
      }
      if (!this.snapshot.isPlaying || this.snapshot.backend !== 'audio' || !this.audio) return;
      const remaining = (this.snapshot.duration || 0) - (this.snapshot.progress || 0);
      if (!(remaining > 8) || this.silenceSkipsThisTrack >= 3) return;
      const buf = new Float32Array(this.eqAnalyser.fftSize);
      this.eqAnalyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (rms < 0.004) this.silenceStreak++;
      else this.silenceStreak = 0;
      if (this.silenceStreak >= 3) {
        this.silenceStreak = 0;
        this.silenceSkipsThisTrack++;
        this.seek(this.snapshot.progress + 2);
      }
    } catch {
      this.silenceStreak = 0;
    }
  }

  /** Current-stream facts for Stats for Nerds. Unknown stays "Unknown". */
  getStats() {
    const r = this.snapshot.resolved;
    const host = (() => {
      try { return r?.streamUrl ? new URL(r.streamUrl).hostname : 'Unknown'; } catch { return 'Unknown'; }
    })();
    const normalized = r ? normalizeAudioMetadata({
      url: r.streamUrl || '',
      source: r.source === 'youtube-audio' || r.source === 'youtube-iframe' ? 'youtube' : r.source || 'custom',
      sourceId: r.source === 'custom' ? 'Configured source' : r.source || 'Unknown',
      codec: r.codec,
      mimeType: r.mimeType,
      bitrate: r.bitrate,
      bitrateKbps: r.bitrateKbps,
      sampleRate: r.sampleRate,
      bitDepth: r.bitDepth,
      channels: r.channels,
      container: r.container,
      duration: r.duration,
      isLossless: r.isLossless,
      streamType: r.streamType,
      networkType: r.networkType,
    }, r?.duration) : {};
    const connection = (navigator as any)?.connection;
    const networkType = normalizeNetworkType(connection);
    const bufferedSeconds = this.getBufferedAhead();
    const source = r?.source === 'youtube-audio' ? 'YouTube' : r?.source === 'youtube-iframe' ? 'YouTube (iframe)' : normalized.source || 'Unknown';
    return {
      source,
      codec: normalized.codec || 'Unknown',
      bitrate: typeof normalized.bitrate === 'number' && normalized.bitrate > 0 ? `${normalized.bitrate} kbps` : 'Unknown',
      sampleRate: typeof normalized.sampleRate === 'number' && normalized.sampleRate > 0 ? `${(normalized.sampleRate / 1000).toFixed(normalized.sampleRate % 1000 ? 1 : 0)} kHz` : 'Unknown',
      bitDepth: typeof normalized.bitDepth === 'number' && normalized.bitDepth > 0 ? `${normalized.bitDepth}-bit` : 'Unknown',
      channels: typeof normalized.channels === 'number' ? (normalized.channels === 2 ? 'Stereo' : `${normalized.channels} channels`) : normalized.channels || 'Unknown',
      container: normalized.container || 'Unknown',
      duration: typeof normalized.duration === 'number' && normalized.duration > 0 ? normalized.duration : 0,
      isLossless: typeof normalized.isLossless === 'boolean' ? normalized.isLossless : null,
      streamType: normalized.streamType || 'Unknown',
      networkType: networkType || normalized.networkType || 'Unknown',
      bufferedSeconds,
      host,
      progress: this.snapshot.progress,
      backend: this.snapshot.backend || 'none',
      playbackState: this.snapshot.isBuffering ? 'Buffering' : this.snapshot.isPlaying ? 'Playing' : this.snapshot.trackId ? 'Paused' : 'Idle',
      expiresAt: r?.expiresAt,
    };
  }

  /** Seconds of audio buffered ahead of the playhead (audio backend only).
   *  Exposed so diagnostics UI never reaches into the private element —
   *  the engine stays the sole audio owner. */
  getBufferedAhead(): number | null {
    try {
      if (this.snapshot.backend !== 'audio' || !this.audio) return null;
      const buf = this.audio.buffered;
      if (!buf || !buf.length) return 0;
      return Math.max(0, buf.end(buf.length - 1) - this.audio.currentTime);
    } catch {
      return null;
    }
  }

  // ——— OS integration ———
  private updateMedia(track: Track | null, playing: boolean) {
    if (typeof document !== 'undefined') {
      document.title = track ? `${track.title} — ${track.author}` : this.originalTitle;
    }
    try {
      const nav = navigator as any;
      if (!('mediaSession' in nav)) return;
      if (track) {
        nav.mediaSession.metadata = new (window as any).MediaMetadata({
          title: track.title,
          artist: track.author,
          album: track.albumName || 'Wave',
          artwork: track.thumbnail
            ? [{ src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
            : [],
        });
        nav.mediaSession.playbackState = playing ? 'playing' : 'paused';
        nav.mediaSession.setActionHandler('play', () => this.play());
        nav.mediaSession.setActionHandler('pause', () => this.pause());
        nav.mediaSession.setActionHandler('previoustrack', () => this.prev());
        nav.mediaSession.setActionHandler('nexttrack', () => this.next());
        try {
          nav.mediaSession.setActionHandler('seekbackward', (d: any) => {
            const off = typeof d?.seekOffset === 'number' ? d.seekOffset : 10;
            this.seek(Math.max(0, this.snapshot.progress - off));
          });
        } catch {}
        try {
          nav.mediaSession.setActionHandler('seekforward', (d: any) => {
            const off = typeof d?.seekOffset === 'number' ? d.seekOffset : 10;
            this.seek(this.snapshot.progress + off);
          });
        } catch {}
        try {
          nav.mediaSession.setActionHandler('seekto', (d: any) => {
            if (typeof d?.seekTime === 'number') this.seek(d.seekTime);
          });
        } catch {}
      } else {
        nav.mediaSession.playbackState = 'none';
      }
    } catch {}
  }
}

type GlobalWithEngine = typeof globalThis & { __waveEngine?: PlayerEngine };
const g = globalThis as GlobalWithEngine;
if (!g.__waveEngine) g.__waveEngine = new PlayerEngine();
export const playerEngine = g.__waveEngine;

/** React binding — re-renders on engine state changes. Actions via `playerEngine`. */
export function usePlayerEngine(): EngineState {
  return useSyncExternalStore(playerEngine.subscribe, playerEngine.getSnapshot);
}
