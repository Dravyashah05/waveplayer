import type { Track } from '../types';
import type { ListeningSource } from './listeningStore';
import { getListeningEvents } from './listeningStore';
import { getHistory } from './ytmusicLibrary';
import { googleAccountStore } from '../hooks/useGoogleAccount';
import { currentScope, scopeKey } from './scopedStorage';

/**
 * History aggregation layer:
 *
 *   YT Music history (authenticated, via existing Express gateway)
 *       + Wave playback history (device-local playerStore)
 *       → normalized identity keys → deduped unified history
 *
 * Rules:
 * - Never overwrites or mutates existing Wave history.
 * - Never fabricates timestamps: YT entries carry none, so they sort as
 *   "Earlier" unless local listening events corroborate them.
 * - Only normalized track data is cached. No tokens, cookies or headers.
 * - The YT cache is namespaced per Google user (see scopedStorage) and is
 *   never served to a different account.
 */

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const CACHE_BASE = 'yt_history_v1';
const CACHE_TTL_MS = 15 * 60 * 1000;

export interface UnifiedHistoryEntry {
  track: Track;
  sources: ListeningSource[];
  primarySource: ListeningSource;
  /** ms epoch when last heard, when known (local events only). */
  lastPlayedAt?: number;
}

export interface HistorySection {
  key: 'today' | 'yesterday' | 'earlier';
  label: string;
  entries: UnifiedHistoryEntry[];
}

function normText(s: string | undefined | null): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\(\[].*?[\)\]]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic identity key. Prefers stable source IDs (YouTube video id,
 * ISRC) and falls back to normalized title + artist + duration bucket.
 */
export function historyIdentityKey(t: Pick<Track, 'id' | 'title' | 'author' | 'durationSeconds'> & {
  isrc?: string | null;
  identity?: { youtubeId?: string } | null;
}): string {
  const yt = t.identity?.youtubeId || (t.id && YT_ID_RE.test(t.id) ? t.id : '');
  if (yt) return `yt:${yt}`;
  if (t.isrc) return `isrc:${String(t.isrc).trim().toLowerCase()}`;
  const title = normText(t.title);
  const artist = normText((t.author || '').split(',')[0]);
  const dur = t.durationSeconds && t.durationSeconds > 0 ? Math.round(t.durationSeconds / 10) : 0;
  return `meta:${title}|${artist}|${dur}`;
}

// ---------------------------------------------------------------------------
// Authenticated YT Music history (user-scoped cache, safe refresh strategy)
// ---------------------------------------------------------------------------

interface YTHistoryCache {
  scope: string;
  fetchedAt: number;
  tracks: Track[];
}

function cacheKey(): string {
  return scopeKey(CACHE_BASE);
}

function readCache(): YTHistoryCache | null {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as YTHistoryCache;
    if (!parsed || parsed.scope !== currentScope() || !Array.isArray(parsed.tracks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(tracks: Track[]): void {
  try {
    const payload: YTHistoryCache = { scope: currentScope(), fetchedAt: Date.now(), tracks };
    localStorage.setItem(cacheKey(), JSON.stringify(payload));
  } catch {}
}

/** Cached YT Music history for the CURRENT user only. [] when absent. */
export function getCachedYTMusicHistory(): Track[] {
  return readCache()?.tracks ?? [];
}

function isGoogleConnected(): boolean {
  try {
    return !!googleAccountStore.get()?.connected;
  } catch {
    return false;
  }
}

export interface YTHistoryResult {
  tracks: Track[];
  fromCache: boolean;
  updated: boolean;
}

/**
 * Fetch YT Music history with stale-while-usable semantics:
 * fresh cache → returned immediately (no network); stale/missing → one
 * network fetch; failure → stale cache or []. Never throws, never blocks
 * playback — callers decide when to invoke (History open, login, refresh).
 */
export async function ensureYTMusicHistory(): Promise<YTHistoryResult> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { tracks: cached.tracks, fromCache: true, updated: false };
  }
  return refreshYTMusicHistory();
}

/** Force a refetch (explicit Refresh / after login). Never throws. */
export async function refreshYTMusicHistory(): Promise<YTHistoryResult> {
  const cached = readCache();
  if (!isGoogleConnected()) return { tracks: cached?.tracks ?? [], fromCache: true, updated: false };
  try {
    const tracks = await getHistory();
    writeCache(tracks);
    return { tracks, fromCache: false, updated: true };
  } catch {
    return { tracks: cached?.tracks ?? [], fromCache: true, updated: false };
  }
}

// ---------------------------------------------------------------------------
// Merge + grouping
// ---------------------------------------------------------------------------

/** Union Wave + YT histories by identity key. Wave entry wins ties. */
export function mergeHistories(waveTracks: Track[], ytTracks: Track[]): UnifiedHistoryEntry[] {
  const out: UnifiedHistoryEntry[] = [];
  const seen = new Map<string, UnifiedHistoryEntry>();
  const push = (track: Track, source: ListeningSource) => {
    if (!track || !track.id) return;
    const key = historyIdentityKey(track);
    const existing = seen.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    const entry: UnifiedHistoryEntry = { track, sources: [source], primarySource: source };
    seen.set(key, entry);
    out.push(entry);
  };
  for (const t of waveTracks) push(t, (t.source === 'ytmusic' || t.source === 'youtube' ? t.source : 'wave') as ListeningSource);
  for (const t of ytTracks) push(t, 'ytmusic');
  return out;
}

/** Attach last-played timestamps from local listening events (no fabrication). */
export function attachRecency(entries: UnifiedHistoryEntry[]): UnifiedHistoryEntry[] {
  let events: ReturnType<typeof getListeningEvents> = [];
  try {
    events = getListeningEvents(500);
  } catch {
    events = [];
  }
  const newest = new Map<string, number>();
  for (const e of events) {
    if (e.event !== 'play' && e.event !== 'complete' && e.event !== 'replay') continue;
    const at = new Date(e.timestamp).getTime();
    if (!Number.isFinite(at)) continue;
    const prev = newest.get(e.songId);
    if (prev === undefined || at > prev) newest.set(e.songId, at);
  }
  return entries.map((entry) => {
    const key = historyIdentityKey(entry.track);
    const at = newest.get(entry.track.id) ?? newest.get(key);
    return at !== undefined ? { ...entry, lastPlayedAt: at } : entry;
  });
}

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** Group unified history into Today / Yesterday / Earlier. */
export function groupHistoryByRecency(entries: UnifiedHistoryEntry[]): HistorySection[] {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86_400_000;
  const today: UnifiedHistoryEntry[] = [];
  const yesterday: UnifiedHistoryEntry[] = [];
  const earlier: UnifiedHistoryEntry[] = [];
  const dated = entries.filter((e) => e.lastPlayedAt !== undefined).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
  const undated = entries.filter((e) => e.lastPlayedAt === undefined);
  for (const e of dated) {
    const at = e.lastPlayedAt ?? 0;
    if (at >= todayStart) today.push(e);
    else if (at >= yesterdayStart) yesterday.push(e);
    else earlier.push(e);
  }
  // Wave order (most significant first) then YT imports, all undated → Earlier.
  earlier.push(...undated);
  return [
    { key: 'today', label: 'Today', entries: today },
    { key: 'yesterday', label: 'Yesterday', entries: yesterday },
    { key: 'earlier', label: 'Earlier', entries: earlier },
  ];
}
