import { useSyncExternalStore } from 'react';
import { Track } from '../types';
import { playerStore } from './playerStore';
import { getSaavnSongDetails } from './saavnApi';
import { searchYouTube } from './youtubeSearch';
import { logEvent } from './listeningStore';
import { resolveYouTubeAudio } from './ytmusicApi';
import { TemporaryStreamCache, canRetryDirectStream, runDeduped } from './temporaryStreamCache';
import { resolutionRoute } from './playbackSource';

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
  source?: 'saavn' | 'youtube-audio' | 'youtube-iframe';
  streamUrl?: string;
  downloadUrl?: string;
  ytId?: string;
  expiresAt?: number;
  mimeType?: string;
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
  private snapshot: EngineState = { ...INITIAL_STATE, volume: playerStore.volume, muted: loadMuted() };
  private listeners = new Set<() => void>();

  private audio: HTMLAudioElement | null = null;
  private ytContainer: HTMLElement | null = null;
  private ytPlayer: any = null;
  private ytTimer: number | null = null;

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

  constructor() {
    this.unsubStore = playerStore.subscribe(() => this.sync());
    if (typeof window !== 'undefined') {
      this.ytTimer = window.setInterval(() => this.tickYT(), 250);
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
      return;
    }
    this.loggedMilestones.clear();
    const isFirstLoad = this.currentTrack === null && this.snapshot.trackId === null;
    void this.loadTrack(cur, !isFirstLoad);
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

  // ——— Stream resolution (cached, deduped) ———
  private resolveCache = new TemporaryStreamCache();
  private inflight = new Map<string, Promise<ResolvedStream>>();
  private directRetries = new Map<string, number>();
  private audioRecoveries = new Map<string, Promise<void>>();

  private resolveStream(track: Track, forceRefresh = false): Promise<ResolvedStream> {
    if (resolutionRoute(track) === 'provided-audio') return Promise.resolve({ source: 'saavn', streamUrl: https(track.streamUrl!), downloadUrl: track.downloadUrl ? https(track.downloadUrl) : undefined });
    if (forceRefresh) this.resolveCache.delete(track.id);
    const cached = this.resolveCache.get(track.id);
    if (cached) {
      return Promise.resolve(cached);
    }
    const run = this.inflight.get(track.id);
    if (run) return run;
    return runDeduped(this.inflight, track.id, async (): Promise<ResolvedStream> => {
      const saavnish = resolutionRoute(track) === 'saavn';
      if (saavnish) {
        try {
          const d = await getSaavnSongDetails(track.id);
          if (d?.streamUrl) {
            const r: ResolvedStream = { source: 'saavn', streamUrl: https(d.streamUrl), downloadUrl: d.downloadUrl ? https(d.downloadUrl) : undefined };
            this.resolveCache.set(track.id, r);
            return r;
          }
        } catch {}
        // Fallback: find a playable YouTube match
        try {
          const hits = await searchYouTube(`${track.title} ${track.author}`);
          const m = hits.find((h) => YT_ID_RE.test(h.id));
          if (m) {
            const audio = await resolveYouTubeAudio(m.id);
            const r: ResolvedStream = audio
              ? { source: 'youtube-audio', ytId: m.id, streamUrl: audio.streamUrl, expiresAt: audio.expiresAt, mimeType: audio.mimeType }
              : { source: 'youtube-iframe', ytId: m.id };
            this.resolveCache.set(track.id, r);
            return r;
          }
        } catch {}
        return {};
      }
      // Use only a directly exposed audio URL. The IFrame remains the fallback.
      if (import.meta.env.DEV) console.debug('[Wave Stream] Resolving YouTube audio:', track.id);
      const audio = await resolveYouTubeAudio(track.id);
      const r: ResolvedStream = audio
        ? { source: 'youtube-audio', ytId: track.id, streamUrl: audio.streamUrl, expiresAt: audio.expiresAt, mimeType: audio.mimeType }
        : { source: 'youtube-iframe', ytId: track.id };
      this.resolveCache.set(track.id, r);
      if (audio && import.meta.env.DEV) console.debug('[Wave Stream] Resolved audio stream');
      return r;
    });
  }

  /** Warm the resolve cache for the upcoming track so "next" is instant. */
  private preloadNext() {
    try {
      const q = playerStore.queue();
      const idx = playerStore.currentIndex();
      const nxt = q[idx + 1];
      if (nxt && nxt.id !== this.preloadedNextId && !nxt.streamUrl && !this.resolveCache.has(nxt.id)) {
        this.preloadedNextId = nxt.id;
        this.resolveStream(nxt).catch(() => {});
      }
    } catch {}
  }

  // ——— Track loading ———
  private async loadTrack(track: Track, autoplay: boolean) {
    const gen = ++this.loadGen;
    this.teardownYT();
    const audio = this.ensureAudio();
    try { audio.pause(); } catch {}
    audio.removeAttribute('src');
    try { audio.load(); } catch {}

    this.currentTrack = track;
    this.wantPlay = autoplay;
    this.directRetries.delete(track.id);
    this.pendingSeek = null;
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
      });
      a.addEventListener('loadedmetadata', () => {
        this.set({ duration: Number.isFinite(a.duration) ? a.duration : this.snapshot.duration });
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
      });
      a.addEventListener('pause', () => {
        this.set({ isPlaying: false, isBuffering: this.wantPlay });
        this.updateMedia(this.currentTrack, false);
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
        void this.recoverAudioFailure(t);
      });
      this.audio = a;
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
        const refreshed = await resolveYouTubeAudio(videoId);
        if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return;
        if (refreshed) {
          const result: ResolvedStream = { source: 'youtube-audio', ytId: videoId, streamUrl: refreshed.streamUrl, expiresAt: refreshed.expiresAt, mimeType: refreshed.mimeType };
          this.resolveCache.set(track.id, result);
          if (import.meta.env.DEV) console.debug('[Wave Stream] Retrying refreshed audio stream');
          this.startAudio(track, result, autoplay);
          return;
        }
      }

      if (!videoId && track.source === 'saavn') {
        try {
          const match = (await searchYouTube(`${track.title} ${track.author}`)).find((candidate) => YT_ID_RE.test(candidate.id));
          if (match) videoId = match.id;
        } catch {}
        if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return;
        if (videoId) {
          const audio = await resolveYouTubeAudio(videoId);
          if (gen !== this.loadGen || this.currentTrack?.id !== track.id) return;
          if (audio) {
            const result: ResolvedStream = { source: 'youtube-audio', ytId: videoId, streamUrl: audio.streamUrl, expiresAt: audio.expiresAt, mimeType: audio.mimeType };
            this.resolveCache.set(track.id, result);
            this.startAudio(track, result, autoplay);
            return;
          }
        }
      }

      videoId ||= YT_ID_RE.test(track.id) ? track.id : undefined;
      if (videoId) {
        if (import.meta.env.DEV) console.debug('[Wave Stream] Falling back to YouTube IFrame');
        this.resolveCache.set(track.id, { source: 'youtube-iframe', ytId: videoId });
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
    a.src = https(resolved.streamUrl!);
    try { a.load(); } catch {}
    this.set({ backend: 'audio', resolved });
    if (autoplay) {
      this.set({ isBuffering: true });
      this.playAudio(a);
    } else {
      this.set({ isBuffering: false, isPlaying: false });
    }
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
    try {
      this.ytPlayer = new w.YT.Player(mount, {
        videoId,
        playerVars: { autoplay: autoplay ? 1 : 0, controls: 0, modestbranding: 1, rel: 0, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: (e: any) => {
            if (this.currentTrack?.id !== track.id) return;
            try {
              const d = e.target.getDuration?.();
              if (d) this.set({ duration: d });
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
                if (d) this.set({ duration: d });
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
        if (d && d !== this.snapshot.duration) this.set({ duration: d });
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
    // Auto-skip poisoned tracks so one bad item never stalls the session
    if (!this.failedIds.has(track.id) && playerStore.queue().length > 1) {
      this.failedIds.add(track.id);
      this.set({ error: message, isBuffering: false, isPlaying: false });
      try {
        logEvent({ songId: track.id, track, event: 'skip', playedSeconds: fmtForLog(this.snapshot.progress), duration: fmtForLog(this.snapshot.duration || track.durationSeconds || 0), meta: { via: 'error', reason: message } });
      } catch {}
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
    this.set({ progress: target });
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
      logEvent({ songId: t.id, track: t, event: 'skip', playedSeconds: fmtForLog(this.snapshot.progress), duration: fmtForLog(this.snapshot.duration || t.durationSeconds || 0) });
    } catch {}
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
      logEvent({ songId: t.id, track: t, event: 'skip', playedSeconds: fmtForLog(this.snapshot.progress), duration: fmtForLog(this.snapshot.duration || t.durationSeconds || 0) });
    } catch {}
    playerStore.prev();
  }

  private onEnded() {
    const t = this.currentTrack;
    if (!t) return;
    try {
      logEvent({ songId: t.id, track: t, event: 'complete', playedSeconds: fmtForLog(this.snapshot.duration || t.durationSeconds || 0), duration: fmtForLog(this.snapshot.duration || t.durationSeconds || 0) });
    } catch {}
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
