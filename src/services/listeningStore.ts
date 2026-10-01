import { Track } from '../types';

export type ListeningEventType = 'play' | '10_percent' | '25_percent' | '50_percent' | '75_percent' | 'complete' | 'skip' | 'replay' | 'like' | 'unlike' | 'seek' | 'add_to_queue' | 'add_to_playlist' | 'search' | 'view';

export interface ListeningEvent {
  songId: string;
  track?: Track;
  event: ListeningEventType;
  playedSeconds: number;
  duration: number;
  completionPercentage: number;
  timestamp: string;
  meta?: Record<string, unknown>;
}

const LS_EVENTS = 'wave:listening_events';
const LS_RECENT = 'wave:recently_played';
const LS_SKIP = 'wave:skip_counts';
const LS_PLAY_COUNT = 'wave:play_counts';

function load<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// capped in-memory cache for fast reads
let eventsCache: ListeningEvent[] | null = null;

function getEvents(): ListeningEvent[] {
  if (eventsCache) return eventsCache;
  eventsCache = load<ListeningEvent[]>(LS_EVENTS, []);
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
    meta: partial.meta,
  };
  const cur = getEvents();
  cur.unshift(ev);
  if (cur.length > 500) cur.length = 500;
  setEvents(cur);

  // side indexes
  if (ev.event === 'skip') {
    const m = load<Record<string, number>>(LS_SKIP, {});
    m[ev.songId] = (m[ev.songId] || 0) + 1;
    save(LS_SKIP, m);
  }
  if (ev.event === 'play' || ev.event === 'complete' || ev.event === 'replay') {
    const m = load<Record<string, number>>(LS_PLAY_COUNT, {});
    m[ev.songId] = (m[ev.songId] || 0) + (ev.event === 'replay' ? 2 : 1);
    save(LS_PLAY_COUNT, m);
  }
  if (ev.event === 'play' || ev.event === 'complete' || ev.event === 'replay') {
    const recent = load<Track[]>(LS_RECENT, []);
    const t = ev.track;
    if (t) {
      const filtered = recent.filter(x => x.id !== t.id);
      filtered.unshift(t);
      save(LS_RECENT, filtered.slice(0, 50));
    }
  }
  // notify profile to recalc debounced
  try { window.dispatchEvent(new CustomEvent('wave:listening', { detail: ev })); } catch {}
}

export function getRecentlyPlayed(limit = 20): Track[] {
  return load<Track[]>(LS_RECENT, []).slice(0, limit);
}

export function getSkipCount(songId: string): number {
  return load<Record<string, number>>(LS_SKIP, {})[songId] || 0;
}

export function getPlayCount(songId: string): number {
  return load<Record<string, number>>(LS_PLAY_COUNT, {})[songId] || 0;
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

export function completionSignal(playedSeconds: number, duration: number, isReplay: boolean, isLiked: boolean): number {
  if (isLiked || isReplay) return 1.0;
  if (duration <= 0) return 0.5;
  const pct = playedSeconds / duration;
  if (pct > 0.9) return 1.0;
  if (pct > 0.7) return 0.7;
  if (pct > 0.3) return 0.4;
  return 0.1;
}
