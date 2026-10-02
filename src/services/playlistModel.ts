import type { Playlist, Track } from '../types';
import type { LocalPlaylist } from './libraryStore';
import { matchSongs } from './recommendation/songMatcher';
import { googleAccountStore } from '../hooks/useGoogleAccount';

/**
 * Playlist Experience 2.0 — unified playlist model.
 *
 * One normalized representation over three origins (Wave local, YouTube
 * Data API, Saavn/YTMusic catalog) so Library, detail, search, import and
 * export share a single shape. Identity is NEVER name-only: the unified id
 * always carries its source prefix (`wave:`, `youtube:`, `ytmusic:`, raw
 * Saavn id), so same-titled playlists from different owners never merge.
 */

export type UnifiedPlaylistSource = 'wave' | 'youtube' | 'ytmusic' | 'saavn';

export interface UnifiedPlaylist {
  /** Namespaced id: `wave:<id>`, `youtube:<id>`, `ytmusic:<id>`, or raw Saavn id. */
  id: string;
  title: string;
  description?: string;
  artwork?: string;
  /** First 4 track artworks for deterministic mosaic fallback. */
  mosaic?: string[];
  owner?: string;
  trackCount: number;
  tracks?: Track[];
  source: UnifiedPlaylistSource;
  /** Raw provider id without the namespace prefix. */
  sourceId?: string;
  isEditable: boolean;
  isPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
  privacyStatus?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' | 'private' | 'public' | 'unlisted';
}

export interface YouTubePlaylistItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle?: string;
  itemCount: number;
  privacy: string;
}

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function firstArtwork(tracks: Track[] | undefined, fallback?: string): string | undefined {
  for (const t of tracks || []) {
    if (t?.thumbnail) return t.thumbnail;
  }
  return fallback;
}

/** Deterministic mosaic: first 4 distinct track artworks (no AI, no network). */
export function mosaicArtwork(tracks: Track[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tracks || []) {
    const url = t?.thumbnail;
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
    if (out.length >= 4) break;
  }
  return out;
}

/** Resolve display artwork: explicit > first track > mosaic[0] > ''. */
export function resolveArtwork(explicit: string | undefined, tracks: Track[] | undefined): string {
  return explicit || firstArtwork(tracks) || mosaicArtwork(tracks)[0] || '';
}

export function fromLocalPlaylist(pl: LocalPlaylist): UnifiedPlaylist {
  const songs = Array.isArray(pl.songs) ? pl.songs.filter((t) => t && typeof t.id === 'string') : [];
  const mosaic = mosaicArtwork(songs);
  return {
    id: `wave:${pl.id}`,
    title: pl.title || 'Untitled Playlist',
    description: pl.description || '',
    artwork: resolveArtwork(pl.thumbnail, songs),
    mosaic,
    owner: pl.source === 'youtube' ? 'YouTube import' : 'Wave Player',
    trackCount: songs.length,
    tracks: songs,
    source: 'wave',
    sourceId: pl.id,
    isEditable: true,
    isPublic: pl.privacyStatus === 'PUBLIC',
    createdAt: pl.createdAt,
    updatedAt: pl.updatedAt,
    privacyStatus: pl.privacyStatus,
  };
}

export function fromProviderPlaylist(pl: Playlist, tracks?: Track[]): UnifiedPlaylist {
  const source: UnifiedPlaylistSource = pl.source === 'ytmusic' ? 'ytmusic' : 'saavn';
  const rawId = pl.playlistId || '';
  const namespaced = rawId.startsWith('ytmusic:') || rawId.startsWith('wave:') || rawId.startsWith('youtube:')
    ? rawId
    : source === 'ytmusic'
      ? `ytmusic:${rawId}`
      : rawId;
  const list = Array.isArray(tracks) ? tracks : pl.tracks;
  return {
    id: namespaced,
    title: pl.name || 'Untitled playlist',
    description: pl.description || '',
    artwork: resolveArtwork(pl.thumbnails?.[0]?.url, list),
    mosaic: mosaicArtwork(list),
    owner: pl.author || (source === 'ytmusic' ? 'YouTube Music' : 'JioSaavn Editorial'),
    trackCount: typeof pl.videoCount === 'number' ? pl.videoCount : (list?.length ?? 0),
    tracks: list,
    source,
    sourceId: rawId.replace(/^(ytmusic|youtube|wave):/, ''),
    // Catalog playlists are never editable from Wave.
    isEditable: false,
    isPublic: true,
  };
}

export function fromYouTubeItem(
  item: YouTubePlaylistItem,
  tracks?: Track[],
  canWrite = false,
): UnifiedPlaylist {
  return {
    id: `youtube:${item.id}`,
    title: item.title || 'Untitled playlist',
    description: item.description || '',
    artwork: resolveArtwork(item.thumbnail, tracks),
    mosaic: mosaicArtwork(tracks),
    owner: item.channelTitle || 'YouTube',
    trackCount: typeof item.itemCount === 'number' ? item.itemCount : (tracks?.length ?? 0),
    tracks,
    source: 'youtube',
    sourceId: item.id,
    // Editable ONLY when the authenticated account holds the manage scope.
    // Read-only sessions stay read-only — the UI must hide write actions.
    isEditable: canWrite,
    isPublic: item.privacy === 'public',
    privacyStatus: item.privacy === 'public' ? 'public' : item.privacy === 'unlisted' ? 'unlisted' : 'private',
  };
}

/** Namespace helpers for the custom App router (no React Router). */
export function parsePlaylistRef(ref: string | undefined): { kind: 'wave' | 'youtube' | 'ytmusic' | 'saavn'; id: string } {
  const r = String(ref || '');
  if (r.startsWith('local:')) return { kind: 'wave', id: r.slice('local:'.length) };
  if (r.startsWith('wave:')) return { kind: 'wave', id: r.slice('wave:'.length) };
  if (r.startsWith('youtube:')) return { kind: 'youtube', id: r.slice('youtube:'.length) };
  if (r.startsWith('ytmusic:')) return { kind: 'ytmusic', id: r };
  return { kind: 'saavn', id: r };
}

/** Canonical duplicate check: exact-id OR matchSongs identity (never title-only). */
export function isDuplicateTrack(track: Track, existing: Track[]): boolean {
  if (!track?.id) return false;
  for (const e of existing) {
    if (!e?.id) continue;
    if (e.id === track.id && (e.source || '') === (track.source || '')) return true;
    if (e.id === track.id && (!e.source || !track.source)) return true;
    try {
      const m = matchSongs(e, track);
      if (m.isMatch) return true;
    } catch { /* matcher failure never blocks adds */ }
  }
  return false;
}

/** Filter additions: drop canonical duplicates, preserve intentional repeats already present. */
export function filterNewTracks(candidates: Track[], existing: Track[]): { fresh: Track[]; dupes: number } {
  const fresh: Track[] = [];
  let dupes = 0;
  const pool = [...existing];
  for (const t of candidates) {
    if (!t?.id) continue;
    if (isDuplicateTrack(t, pool)) {
      dupes++;
      continue;
    }
    fresh.push(t);
    pool.push(t);
  }
  return { fresh, dupes };
}

/** Extract a usable YouTube videoId for export (id or identity anchor). */
export function youtubeVideoIdOf(track: Track): string | null {
  const direct = String(track?.id || '');
  if ((track?.source === 'ytmusic' || track?.source === 'youtube') && YT_ID_RE.test(direct)) return direct;
  const anchored = String(track?.identity?.youtubeId || '');
  if (YT_ID_RE.test(anchored)) return anchored;
  if (YT_ID_RE.test(direct)) return direct;
  return null;
}

// ---------------------------------------------------------------------------
// User-scoped cache (private playlists never share keys across users)
// ---------------------------------------------------------------------------

import { CACHE_MAX, CACHE_TTL } from './cacheConfig';

// Central policy: user-scoped playlist metadata (never global for private).
const META_CACHE_TTL_MS = CACHE_TTL.playlistMetaMs;
const META_CACHE_MAX = CACHE_MAX.playlistMeta;
const metaCache = new Map<string, { at: number; value: UnifiedPlaylist }>();

function scopeOf(): string {
  try {
    const s = googleAccountStore.get();
    if (s?.connected && s.user?.id) return `google:${s.user.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}`;
  } catch { /* device-local fallback below */ }
  return 'local';
}

/** User-scoped key: `ytmusic:{userId}:playlist:{playlistId}` for private data. */
export function scopedPlaylistKey(kind: string, playlistId: string): string {
  return `ytmusic:${scopeOf()}:playlist:${kind}:${String(playlistId).slice(0, 96)}`;
}

export function cachePlaylistMeta(pl: UnifiedPlaylist): void {
  // Cache metadata only (no tokens, no secrets — tracks are public shapes).
  // Private youtube playlists land under scoped keys so users never collide.
  const key = pl.source === 'youtube' || pl.source === 'ytmusic'
    ? scopedPlaylistKey(pl.source, pl.sourceId || pl.id)
    : `wave:playlist:${pl.sourceId || pl.id}`;
  if (metaCache.size >= META_CACHE_MAX) {
    const oldest = metaCache.keys().next();
    if (!oldest.done) metaCache.delete(oldest.value);
  }
  metaCache.set(key, { at: Date.now(), value: pl });
}

export function getCachedPlaylistMeta(kind: string, playlistId: string): UnifiedPlaylist | null {
  const key = scopedPlaylistKey(kind, playlistId);
  const hit = metaCache.get(key) || metaCache.get(`wave:playlist:${playlistId}`);
  if (!hit) return null;
  if (Date.now() - hit.at > META_CACHE_TTL_MS) {
    metaCache.delete(key);
    return null;
  }
  return hit.value;
}

/** Invalidate after explicit mutations (import, add, remove, edit, delete). */
export function invalidatePlaylistCache(playlistId?: string): void {
  if (!playlistId) {
    metaCache.clear();
    return;
  }
  const raw = String(playlistId).replace(/^(wave|youtube|ytmusic|local):/, '');
  for (const key of [...metaCache.keys()]) {
    if (key.endsWith(`:${raw}`) || key.endsWith(`:${playlistId}`)) metaCache.delete(key);
  }
}

export function clearPlaylistCache(): void {
  metaCache.clear();
}
