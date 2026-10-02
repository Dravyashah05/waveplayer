import { Track } from '../types';
import { AFFINITY_WEIGHTS } from './affinityWeights';
import { currentScope } from './scopedStorage';

export type ListeningEventType = 'play' | '10_percent' | '25_percent' | '50_percent' | '75_percent' | 'complete' | 'skip' | 'replay' | 'like' | 'unlike' | 'seek' | 'add_to_queue' | 'add_to_playlist' | 'search' | 'view' | 'pause' | 'resume' | 'error';

/** Normalized playback source. Device-local/unknown tracks count as "wave". */
export type ListeningSource = 'wave' | 'ytmusic' | 'saavn' | 'youtube';

export interface ListeningContext {
  page?: string;
  playlistId?: string;
  albumId?: string;
  artistId?: string;
  recommendationId?: string;
}

export interface ListeningEvent {
  songId: string;
  track?: Track;
  event: ListeningEventType;
  playedSeconds: number;
  duration: number;
  completionPercentage: number;
  timestamp: string;
  /** Playback origin of the track (never credentials — just a label). */
  source?: ListeningSource;
  /** Where the event happened (page/playlist/album/artist). */
  context?: ListeningContext;
  /** Storage scope (Google user id or 'local') that recorded the event. */
  userId?: string;
  meta?: Record<string, unknown>;
}

const LS_EVENTS = 'wave:listening_events';
const LS_RECENT = 'wave:recently_played';
const LS_SKIP = 'wave:skip_counts';
const LS_PLAY_COUNT = 'wave:play_counts';

function load<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    if (!v) return fallback;
    const parsed = JSON.parse(v) as unknown;
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (!Array.isArray(fallback) && typeof fallback === 'object' && fallback !== null && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) return fallback;
    return parsed as T;
  } catch { return fallback; }
}
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// capped in-memory cache for fast reads
let eventsCache: ListeningEvent[] | null = null;

// write-through count caches (single localStorage read each, memory-fast after)
let skipCountsCache: Record<string, number> | null = null;
let playCountsCache: Record<string, number> | null = null;

function countMap(lsKey: string, cached: Record<string, number> | null): Record<string, number> {
  if (cached) return cached;
  const m = load<Record<string, number>>(lsKey, {});
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
}
function getSkipCounts(): Record<string, number> {
  skipCountsCache = countMap(LS_SKIP, skipCountsCache);
  return skipCountsCache;
}
function getPlayCounts(): Record<string, number> {
  playCountsCache = countMap(LS_PLAY_COUNT, playCountsCache);
  return playCountsCache;
}

function getEvents(): ListeningEvent[] {
  if (eventsCache) return eventsCache;
  const loaded = load<ListeningEvent[]>(LS_EVENTS, []);
  eventsCache = Array.isArray(loaded) ? loaded : [];
  return eventsCache;
}
function setEvents(ev: ListeningEvent[]) {
  eventsCache = ev;
  save(LS_EVENTS, ev.slice(0, 500));
}

export function logEvent(partial: Omit<ListeningEvent, 'timestamp' | 'completionPercentage'> & { timestamp?: string }) {
  const completion = partial.duration > 0 ? Math.round((partial.playedSeconds / partial.duration) * 100) : 0;
  const ev: ListeningEvent = {
    songId: partial.songId,
    track: partial.track,
    event: partial.event,
    playedSeconds: Math.round(partial.playedSeconds),
    duration: partial.duration || partial.track?.durationSeconds || 0,
    completionPercentage: Math.min(100, Math.max(0, completion)),
    timestamp: partial.timestamp || new Date().toISOString(),
    source: partial.source || sourceForTrack(partial.track),
    context: partial.context,
    userId: partial.userId || currentScope(),
    meta: partial.meta,
  };
  const cur = getEvents();
  cur.unshift(ev);
  if (cur.length > 500) cur.length = 500;
  setEvents(cur);

  // side indexes — technical failures are NEVER taste signals
  if (ev.event === 'skip' && !isTechnicalFailure(ev)) {
    const safe = getSkipCounts();
    safe[ev.songId] = (safe[ev.songId] || 0) + 1;
    save(LS_SKIP, safe);
  }
  if (ev.event === 'play' || ev.event === 'complete' || ev.event === 'replay') {
    const safe = getPlayCounts();
    safe[ev.songId] = (safe[ev.songId] || 0) + (ev.event === 'replay' ? 2 : 1);
    save(LS_PLAY_COUNT, safe);
  }
  if (ev.event === 'play' || ev.event === 'complete' || ev.event === 'replay') {
    const recent = load<Track[]>(LS_RECENT, []);
    const list = Array.isArray(recent) ? recent : [];
    const t = ev.track;
    if (t) {
      const filtered = list.filter(x => x && x.id !== t.id);
      filtered.unshift(t);
      save(LS_RECENT, filtered.slice(0, 50));
    }
  }
  // notify profile to recalc debounced
  try { window.dispatchEvent(new CustomEvent('wave:listening', { detail: ev })); } catch {}
}

export function getRecentlyPlayed(limit = 20): Track[] {
  const list = load<Track[]>(LS_RECENT, []);
  return (Array.isArray(list) ? list : []).slice(0, limit);
}

export function getSkipCount(songId: string): number {
  return getSkipCounts()[songId] || 0;
}

export function getPlayCount(songId: string): number {
  return getPlayCounts()[songId] || 0;
}

export function getEventsForSong(songId: string): ListeningEvent[] {
  return getEvents().filter(e => e.songId === songId).slice(0, 20);
}

/** Newest-first capped event feed — powers co-occurrence (collaborative) scoring. */
export function getListeningEvents(limit = 500): ListeningEvent[] {
  return getEvents().slice(0, Math.max(0, limit));
}

export function hasRecentPlay(songId: string, hours = 24): boolean {
  const ev = getEvents().find(e => e.songId === songId && (e.event === 'play' || e.event === 'complete'));
  if (!ev) return false;
  return Date.now() - new Date(ev.timestamp).getTime() < hours * 3600 * 1000;
}

// Smart skip helper — returns penalty score 0-1
export function skipPenalty(playedSeconds: number, duration: number): number {
  if (duration <= 0) return 0.5;
  const pct = playedSeconds / duration;
  if (playedSeconds < 10) return 1.0; // strong negative
  if (pct < 0.3) return 0.6;
  if (pct < 0.7) return 0.2;
  return 0;
}

/**
 * True for technical playback failures (stream/network/player errors).
 * These are recorded as neutral 'error' events and must never become
 * negative taste signals — unlike genuine early skips.
 */
export function isTechnicalFailure(e: Pick<ListeningEvent, 'event' | 'meta'>): boolean {
  if (e.event === 'error') return true;
  const meta = e.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') return false;
  if (meta.technical === true) return true;
  return meta.via === 'error';
}

/** Map a Track's origin to the normalized listening source label. */
export function sourceForTrack(track?: Track): ListeningSource {
  const s = track?.source;
  if (s === 'ytmusic') return 'ytmusic';
  if (s === 'youtube') return 'youtube';
  if (s === 'saavn') return 'saavn';
  return 'wave';
}

/** Remove a track from the device recently-played list (History UI). */
export function removeRecentEntry(songId: string): void {
  try {
    const recent = load<Track[]>(LS_RECENT, []);
    const list = Array.isArray(recent) ? recent : [];
    const next = list.filter((x) => x && x.id !== songId);
    if (next.length !== list.length) save(LS_RECENT, next);
  } catch {}
}

/** Engagement weight for one event type (single source of truth lives in affinityWeights). */
export function eventWeight(event: ListeningEventType): number {
  switch (event) {
    case 'like': return AFFINITY_WEIGHTS.like;
    case 'unlike': return AFFINITY_WEIGHTS.unlike;
    case 'replay': return AFFINITY_WEIGHTS.replay;
    case 'add_to_playlist': return AFFINITY_WEIGHTS.addToPlaylist;
    case 'play': return AFFINITY_WEIGHTS.play;
    case 'add_to_queue': return AFFINITY_WEIGHTS.addToQueue;
    case 'resume': return AFFINITY_WEIGHTS.resume;
    case 'search': return AFFINITY_WEIGHTS.search;
    case '10_percent': return AFFINITY_WEIGHTS.milestone10;
    case '25_percent': return AFFINITY_WEIGHTS.milestone25;
    case '50_percent': return AFFINITY_WEIGHTS.milestone50;
    case '75_percent': return AFFINITY_WEIGHTS.milestone75;
    case 'pause':
    case 'seek':
    case 'view':
    case 'error':
    default: return 0;
  }
}

export function completionSignal(playedSeconds: number, duration: number, isReplay: boolean, isLiked: boolean): number {
  if (isLiked || isReplay) return 1.0;
  if (duration <= 0) return 0.5;
  const pct = playedSeconds / duration;
  if (pct > 0.9) return 1.0;
  if (pct > 0.7) return 0.7;
  if (pct > 0.3) return 0.4;
  return 0.1;
}
