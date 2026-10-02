import type { Album, SearchArtist, Track } from '../types';
import {
  getSaavnAlbumDetails,
  getSaavnArtistDetails,
  searchSaavnAlbums,
  searchSaavnArtists,
} from './saavnApi';
import { getAlbumDetails, getYTMusicArtist } from './ytmusicApi';
import {
  deduplicateAlbums,
  deduplicateArtists,
  deduplicateTracks,
} from './searchEngine';
import { normalizeText } from './recommendation/metadataNormalizer';
import { buildTasteProfile } from './tasteProfile';
import { getPlayCount } from './listeningStore';

/**
 * Canonical Artist + Album layer.
 *
 * Normalizes Saavn/YT Music payloads into one model per entity with
 * per-source IDs tracked separately. Merging is STRICT:
 * - artists merge only on identical normalized names PLUS shared evidence
 *   (overlapping track/album titles) — never on a fuzzy name match alone;
 * - albums merge only on title+artist+year PLUS identical editions, so
 *   Deluxe / Remastered / Live / Anniversary editions are preserved, never
 *   collapsed.
 *
 * Tracks always flow through the existing canonical Track pipeline
 * (deduplicateTracks → matchSongs: source ID / ISRC / title+artist+album+
 * duration / version — never title alone).
 *
 * Cache holds PUBLIC metadata only (shared keys, 10-min TTL). Anything
 * user-specific (play counts, recommendations, follow/save state) is
 * computed live or stored under separate device-local keys — private
 * recommendation data is never mixed between users.
 */

// ---------------------------------------------------------------------------
// Canonical models
// ---------------------------------------------------------------------------

export interface CanonicalArtist {
  id: string;
  name: string;
  normalizedName: string;
  artwork?: string;
  description?: string;
  sourceIds: { saavn?: string; ytmusic?: string };
  genres: string[];
  trackCount?: number;
  albumCount?: number;
}

export type AlbumReleaseType = 'Album' | 'Single' | 'EP' | 'Soundtrack';
export type AlbumEdition = 'Deluxe' | 'Remaster' | 'Live' | 'Anniversary' | null;

export interface CanonicalAlbum {
  id: string;
  title: string;
  normalizedTitle: string;
  artist: string;
  artistId: string | null;
  artwork?: string;
  year: number | null;
  releaseType: AlbumReleaseType;
  edition: AlbumEdition;
  trackCount: number;
  duration?: number;
  sourceIds: { saavn?: string; ytmusic?: string };
  tracks: Track[];
}

// ---------------------------------------------------------------------------
// Metadata cleaning (conservative: whitespace/padding only, never meaning)
// ---------------------------------------------------------------------------

/** Trim, collapse whitespace, strip " - Topic" channel padding and empties. */
export function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = value
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+Topic\s*$/i, '')
    .trim();
  return out || undefined;
}

export function cleanDuration(seconds: unknown): number {
  const n = typeof seconds === 'string' ? Number(seconds) : (seconds as number);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Largest-area thumbnail; never fabricates a URL. */
export function pickArtwork(
  thumbnails: Array<{ url?: string; width?: number; height?: number }> | undefined,
  fallback?: string,
): string | undefined {
  let best: string | undefined;
  let bestArea = -1;
  for (const t of thumbnails || []) {
    if (!t?.url) continue;
    const area = Number(t.width || 0) * Number(t.height || 0);
    if (area >= bestArea) {
      bestArea = area;
      best = String(t.url);
    }
  }
  return best || fallback;
}

export function detectEdition(title: string): AlbumEdition {
  const t = ` ${title.toLowerCase()} `;
  if (/deluxe|expanded|super deluxe/.test(t)) return 'Deluxe';
  if (/remaster|remastered|anniversary/.test(t) && /anniversary|anniversaire/.test(t)) return 'Anniversary';
  if (/remaster|remastered/.test(t)) return 'Remaster';
  if (/\blive\b|unplugged|concert/.test(t)) return 'Live';
  return null;
}

export function detectReleaseType(title: string, trackCount?: number | null): AlbumReleaseType {
  const t = ` ${title.toLowerCase()} `;
  if (/soundtrack|ost\b|original motion picture/.test(t)) return 'Soundtrack';
  if (/\bsingle\b/.test(t) || (trackCount === 1)) return 'Single';
  if (/\bep\b|\be\.p\.\b|extended play/.test(t)) return 'EP';
  if (typeof trackCount === 'number' && trackCount > 1 && trackCount <= 5) return 'EP';
  return 'Album';
}

// ---------------------------------------------------------------------------
// Strict identity (never fuzzy-only)
// ---------------------------------------------------------------------------

export function artistIdentity(name: string): string {
  return normalizeText(name || '');
}

export function albumIdentity(title: string, artist: string, year: number | null): string {
  return `${normalizeText(title)}__${normalizeText(artist)}__${year || ''}`;
}

function titleSet(tracks: Track[]): Set<string> {
  const out = new Set<string>();
  for (const t of tracks || []) {
    const n = normalizeText(t?.title || '');
    if (n) out.add(n);
  }
  return out;
}

/** Shared evidence = overlapping track or album titles (both normalized). */
export function artistsShareEvidence(
  aTracks: Track[],
  aAlbums: string[],
  bTracks: Track[],
  bAlbums: string[],
): boolean {
  const aT = titleSet(aTracks);
  for (const n of titleSet(bTracks)) if (aT.has(n)) return true;
  const aA = new Set((aAlbums || []).map((s) => normalizeText(s || '')).filter(Boolean));
  for (const s of bAlbums || []) {
    const n = normalizeText(s || '');
    if (n && aA.has(n)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Follow / Save (Wave-side concepts, separate from YT subscriptions)
// ---------------------------------------------------------------------------

const LS_FOLLOWED_ARTISTS = 'wave:followed_artists';
const LS_SAVED_ALBUMS = 'wave:saved_albums';

interface FollowedArtist {
  id: string;
  name: string;
  artwork?: string;
  followedAt: string;
}

interface SavedAlbum {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  savedAt: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return (Array.isArray(fallback) ? Array.isArray(parsed) : typeof parsed === typeof fallback)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
}

function notifyLibrary() {
  try {
    window.dispatchEvent(new CustomEvent('wave:library'));
  } catch {}
}

export function getFollowedArtists(): FollowedArtist[] {
  return loadJson<FollowedArtist[]>(LS_FOLLOWED_ARTISTS, []).filter((a) => a && typeof a.id === 'string');
}

export function isArtistFollowed(id: string): boolean {
  if (!id) return false;
  return getFollowedArtists().some((a) => a.id === id);
}

/** Wave-side follow. Returns the new state. YT subscriptions untouched. */
export function toggleArtistFollow(artist: { id: string; name: string; artwork?: string }): boolean {
  if (!artist?.id) return false;
  const list = getFollowedArtists();
  const idx = list.findIndex((a) => a.id === artist.id);
  const nowFollowed = idx < 0;
  const next = nowFollowed
    ? [{ id: artist.id, name: artist.name, artwork: artist.artwork, followedAt: new Date().toISOString() }, ...list].slice(0, 500)
    : list.filter((a) => a.id !== artist.id);
  try {
    localStorage.setItem(LS_FOLLOWED_ARTISTS, JSON.stringify(next));
  } catch {}
  notifyLibrary();
  return nowFollowed;
}

export function getSavedAlbums(): SavedAlbum[] {
  return loadJson<SavedAlbum[]>(LS_SAVED_ALBUMS, []).filter((a) => a && typeof a.id === 'string');
}

export function isAlbumSaved(id: string): boolean {
  if (!id) return false;
  return getSavedAlbums().some((a) => a.id === id);
}

/** Wave-side album save. Returns the new state. */
export function toggleAlbumSaved(album: { id: string; title: string; artist: string; artwork?: string }): boolean {
  if (!album?.id) return false;
  const list = getSavedAlbums();
  const idx = list.findIndex((a) => a.id === album.id);
  const nowSaved = idx < 0;
  const next = nowSaved
    ? [{ id: album.id, title: album.title, artist: album.artist, artwork: album.artwork, savedAt: new Date().toISOString() }, ...list].slice(0, 500)
    : list.filter((a) => a.id !== album.id);
  try {
    localStorage.setItem(LS_SAVED_ALBUMS, JSON.stringify(next));
  } catch {}
  notifyLibrary();
  return nowSaved;
}

// ---------------------------------------------------------------------------
// Personalization helpers (live user data, never cached)
// ---------------------------------------------------------------------------

/** Total device plays across an artist's top songs (for ranking + gating). */
export function artistListenCount(tracks: Track[]): number {
  let total = 0;
  for (const t of tracks || []) {
    try {
      total += getPlayCount(t.id) || 0;
    } catch {}
  }
  return total;
}

/** Heard tracks first (stable), unheard keep provider order. */
export function rankSongsForArtist(tracks: Track[]): Track[] {
  const scored = (tracks || []).map((t, idx) => {
    let plays = 0;
    try {
      plays = getPlayCount(t.id) || 0;
    } catch {}
    return { t, plays, idx };
  });
  return scored
    .sort((a, b) => b.plays - a.plays || a.idx - b.idx)
    .map((s) => s.t);
}

// ---------------------------------------------------------------------------
// Public-metadata cache (shared keys OK — no user data inside)
// ---------------------------------------------------------------------------

import { CACHE_TTL } from './cacheConfig';

// Central policy: public static metadata (shared keys OK — no user data).
const CACHE_TTL_MS = CACHE_TTL.publicStaticMs;
const CACHE_MAX = 100;
const detailCache = new Map<string, { at: number; value: unknown }>();

function cacheGet<T>(key: string): T | null {
  const hit = detailCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    detailCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (detailCache.size >= CACHE_MAX) {
    const oldest = detailCache.keys().next();
    if (!oldest.done) detailCache.delete(oldest.value);
  }
  detailCache.set(key, { at: Date.now(), value });
}

export function clearArtistAlbumCache(): void {
  detailCache.clear();
}

function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('artist-album-timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Artist detail (merged, two-phase for progressive UI)
// ---------------------------------------------------------------------------

export interface ArtistDetail {
  artist: CanonicalArtist;
  topSongs: Track[];
  albums: Album[];
  singles: Album[];
  similar: SearchArtist[];
  bio?: string;
  sources: { saavn: boolean; ytmusic: boolean };
}

function toCanonicalArtist(
  name: string,
  artwork: string | undefined,
  description: string | undefined,
  sourceIds: { saavn?: string; ytmusic?: string },
  trackCount?: number,
  albumCount?: number,
): CanonicalArtist | null {
  const clean = cleanText(name);
  if (!clean) return null;
  return {
    id: sourceIds.saavn || sourceIds.ytmusic || clean,
    name: clean,
    normalizedName: artistIdentity(clean),
    artwork,
    description,
    sourceIds,
    genres: [],
    trackCount,
    albumCount,
  };
}

function splitReleases(albums: Album[]): { albums: Album[]; singles: Album[] } {
  const full: Album[] = [];
  const short: Album[] = [];
  for (const al of albums) {
    const kind = detectReleaseType(al.name || '', typeof al.songCount === 'number' ? al.songCount : null);
    (kind === 'Album' || kind === 'Soundtrack' ? full : short).push(al);
  }
  return { albums: full, singles: short };
}

export async function fetchArtistDetail(
  id: string,
  onProgress?: (stage: 'core' | 'complete', partial: ArtistDetail | null) => void,
): Promise<ArtistDetail | null> {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  const cached = cacheGet<ArtistDetail>(`artist:id:${cleanId}`);
  if (cached) {
    onProgress?.('complete', cached);
    return cached;
  }

  const [saavnRes, ytRes] = await Promise.allSettled([
    withTimeout(getSaavnArtistDetails(cleanId)),
    withTimeout(getYTMusicArtist(cleanId)),
  ]);
  const saavnData = saavnRes.status === 'fulfilled' ? saavnRes.value : null;
  const ytData = ytRes.status === 'fulfilled' ? ytRes.value : null;

  const rawSongs: Track[] = [];
  const rawAlbums: Album[] = [];
  const rawYtSingles: Album[] = [];
  const rawSimilar: SearchArtist[] = [];
  let bio: string | undefined;
  let name = '';
  const sourceIds: { saavn?: string; ytmusic?: string } = {};
  let artwork: string | undefined;
  let trackCount: number | undefined;
  let albumCount: number | undefined;

  if (saavnData?.artist) {
    name = saavnData.artist.name || name;
    sourceIds.saavn = saavnData.artist.artistId || cleanId;
    artwork = pickArtwork(saavnData.artist.thumbnails, artwork);
    bio = cleanText(saavnData.bio) || bio;
    if (saavnData.topSongs?.length) rawSongs.push(...saavnData.topSongs);
    if (saavnData.topAlbums?.length) rawAlbums.push(...saavnData.topAlbums);
  }
  if (ytData?.artist) {
    // Strict merge: identical normalized names, plus shared evidence when
    // both sides supplied lists (never a fuzzy name match alone).
    const ytName = cleanText(ytData.artist.name) || '';
    const baseName = cleanText(name) || ytName;
    const sameName = !!baseName && artistIdentity(baseName) === artistIdentity(ytName);
    const evidence =
      !saavnData?.artist ||
      rawSongs.length === 0 ||
      artistsShareEvidence(
        rawSongs,
        rawAlbums.map((a) => a.name),
        ytData.topSongs || [],
        [...(ytData.topAlbums || []), ...(ytData.singles || [])].map((a) => a.name),
      );
    name = baseName;
    if (sameName && evidence) {
      sourceIds.ytmusic = ytData.artist.artistId || undefined;
      if (ytData.topSongs?.length) rawSongs.push(...ytData.topSongs);
      if (ytData.topAlbums?.length) rawAlbums.push(...ytData.topAlbums);
      if (ytData.singles?.length) rawYtSingles.push(...ytData.singles);
      if (ytData.similarArtists?.length) rawSimilar.push(...ytData.similarArtists);
      artwork = pickArtwork(ytData.artist.thumbnails, artwork);
    } else if (!saavnData?.artist) {
      // YT-only artist: accept its lists (nothing to conflict with).
      sourceIds.ytmusic = ytData.artist.artistId || cleanId;
      if (ytData.topSongs?.length) rawSongs.push(...ytData.topSongs);
      if (ytData.topAlbums?.length) rawAlbums.push(...ytData.topAlbums);
      if (ytData.singles?.length) rawYtSingles.push(...ytData.singles);
      if (ytData.similarArtists?.length) rawSimilar.push(...ytData.similarArtists);
      artwork = pickArtwork(ytData.artist.thumbnails, artwork);
    }
    // Conflicting YT identity (same id, different artist) is ignored apart
    // from the shared name — it never pollutes the canonical record.
  }

  const canonical = toCanonicalArtist(name, artwork, bio, sourceIds, trackCount, albumCount);
  if (!canonical) return null;

  const topSongs = deduplicateTracks(rawSongs);
  const { albums, singles } = splitReleases(deduplicateAlbums([...rawAlbums, ...rawYtSingles]));
  const core: ArtistDetail = {
    artist: canonical,
    topSongs,
    albums,
    singles,
    similar: deduplicateArtists(rawSimilar),
    bio,
    sources: { saavn: !!saavnData?.artist, ytmusic: !!ytData?.artist },
  };
  onProgress?.('core', core);

  // Secondary: Saavn backfill when only YT resolved (bio + 320k tracks).
  if (!saavnData?.artist && canonical.name) {
    try {
      const search = await withTimeout(searchSaavnArtists(canonical.name, 1, 1), 8000);
      const hit = search.artists?.[0];
      if (hit?.artistId && artistIdentity(hit.name) === canonical.normalizedName) {
        const extra = await withTimeout(getSaavnArtistDetails(hit.artistId), 8000).catch(() => null);
        if (extra) {
          if (extra.topSongs?.length) rawSongs.push(...extra.topSongs);
          if (extra.topAlbums?.length) rawAlbums.push(...extra.topAlbums);
          if (extra.bio && !bio) bio = cleanText(extra.bio);
          sourceIds.saavn = extra.artist?.artistId || sourceIds.saavn;
          artwork = pickArtwork(extra.artist?.thumbnails, artwork);
        }
      }
    } catch {}
  }

  // Related-artist fallback: real affinity, never global popularity.
  let similar = deduplicateArtists(rawSimilar);
  if (!similar.length) {
    try {
      const taste = buildTasteProfile();
      const fav = taste.favoriteArtists?.[0]?.name;
      if (fav && fav !== canonical.normalizedName) {
        const res = await withTimeout(searchSaavnArtists(fav, 1, 6), 8000).catch(() => ({ artists: [] as SearchArtist[] }));
        similar = deduplicateArtists((res.artists || []).filter((a) => artistIdentity(a.name) !== canonical.normalizedName)).slice(0, 8);
      }
    } catch {}
  }

  const finalTopSongs = deduplicateTracks(rawSongs);
  const finalSplit = splitReleases(deduplicateAlbums([...rawAlbums, ...rawYtSingles]));
  const finalArtist: CanonicalArtist = {
    ...canonical,
    artwork,
    description: bio,
    sourceIds: { ...sourceIds },
    trackCount: finalTopSongs.length || undefined,
    albumCount: finalSplit.albums.length + finalSplit.singles.length || undefined,
  };
  const result: ArtistDetail = {
    artist: finalArtist,
    topSongs: finalTopSongs,
    albums: finalSplit.albums,
    singles: finalSplit.singles,
    similar,
    bio,
    sources: { saavn: !!saavnData?.artist || !!sourceIds.saavn, ytmusic: !!ytData?.artist },
  };
  cacheSet(`artist:id:${cleanId}`, result);
  cacheSet(`artist:name:${canonical.normalizedName}`, result);
  onProgress?.('complete', result);
  return result;
}

// ---------------------------------------------------------------------------
// Album detail (edition-aware merge)
// ---------------------------------------------------------------------------

export interface AlbumDetail {
  album: CanonicalAlbum;
  tracks: Track[];
  /** A different edition of the same album found on the other source. */
  alternate?: { id: string; edition: Exclude<AlbumEdition, null>; title: string };
  sources: { saavn: boolean; ytmusic: boolean };
}

function toCanonicalAlbum(info: Album, tracks: Track[], sourceIds: { saavn?: string; ytmusic?: string }): CanonicalAlbum | null {
  const title = cleanText(info.name);
  const artist = cleanText(info.artist?.name) || 'Various Artists';
  if (!title) return null;
  const edition = detectEdition(title);
  const releaseType = detectReleaseType(title, typeof info.songCount === 'number' ? info.songCount : tracks.length || null);
  const total = tracks.reduce((a, t) => a + (t.durationSeconds || 0), 0);
  return {
    id: sourceIds.saavn || sourceIds.ytmusic || title,
    title,
    normalizedTitle: normalizeText(title),
    artist,
    artistId: info.artist?.artistId || null,
    artwork: pickArtwork(info.thumbnails),
    year: typeof info.year === 'number' ? info.year : null,
    releaseType,
    edition,
    trackCount: tracks.length,
    duration: total > 0 ? total : undefined,
    sourceIds,
    tracks,
  };
}

export async function fetchAlbumDetail(
  id: string,
  onProgress?: (stage: 'core' | 'complete', partial: AlbumDetail | null) => void,
): Promise<AlbumDetail | null> {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  const cached = cacheGet<AlbumDetail>(`album:id:${cleanId}`);
  if (cached) {
    onProgress?.('complete', cached);
    return cached;
  }

  const [saavnRes, ytRes] = await Promise.allSettled([
    withTimeout(getSaavnAlbumDetails(cleanId)),
    withTimeout(getAlbumDetails(cleanId)),
  ]);
  const saavnData = saavnRes.status === 'fulfilled' ? saavnRes.value : null;
  const ytData = ytRes.status === 'fulfilled' ? ytRes.value : null;

  const rawTracks: Track[] = [];
  if (saavnData?.tracks?.length) rawTracks.push(...saavnData.tracks);
  if (ytData?.tracks?.length) rawTracks.push(...ytData.tracks);

  const saavnInfo = saavnData?.album || null;
  const ytInfo = ytData?.info || null;

  // Edition-aware pick: same identity AND same edition merge; a different
  // edition is preserved as an alternate, never collapsed.
  let primary: CanonicalAlbum | null = null;
  let alternate: AlbumDetail['alternate'];
  const sourceIds: { saavn?: string; ytmusic?: string } = {};
  if (saavnInfo) sourceIds.saavn = saavnInfo.albumId || cleanId;
  if (ytInfo) sourceIds.ytmusic = ytInfo.albumId || undefined;

  const sameIdentity =
    !!saavnInfo &&
    !!ytInfo &&
    albumIdentity(saavnInfo.name || '', saavnInfo.artist?.name || '', typeof saavnInfo.year === 'number' ? saavnInfo.year : null) ===
      albumIdentity(ytInfo.name || '', ytInfo.artist?.name || '', typeof ytInfo.year === 'number' ? ytInfo.year : null);

  if (saavnInfo && ytInfo && sameIdentity) {
    const sEd = detectEdition(saavnInfo.name || '');
    const yEd = detectEdition(ytInfo.name || '');
    if (sEd === yEd) {
      primary = toCanonicalAlbum(saavnInfo, [], sourceIds);
      if (primary && ytInfo.thumbnails?.length && !primary.artwork) {
        primary = { ...primary, artwork: pickArtwork(ytInfo.thumbnails, primary.artwork) };
      }
      if (primary && !primary.year && typeof ytInfo.year === 'number') {
        primary = { ...primary, year: ytInfo.year };
      }
    } else {
      // Different editions: prefer Saavn (320k tracks), keep YT as alternate.
      primary = toCanonicalAlbum(saavnInfo, [], sourceIds);
      if (yEd && ytInfo.albumId) alternate = { id: ytInfo.albumId, edition: yEd, title: cleanText(ytInfo.name) || ytInfo.name };
    }
  } else {
    primary = toCanonicalAlbum(saavnInfo || ytInfo!, [], sourceIds);
  }
  if (!primary) return null;

  const tracks = deduplicateTracks(rawTracks);
  const total = tracks.reduce((a, t) => a + (t.durationSeconds || 0), 0);
  const core: AlbumDetail = {
    album: { ...primary, trackCount: tracks.length, duration: total > 0 ? total : undefined, tracks },
    tracks,
    alternate,
    sources: { saavn: !!saavnData?.album, ytmusic: !!ytData?.info },
  };
  onProgress?.('core', core);

  // Secondary: Saavn 320k backfill when only YT resolved.
  if (!saavnData?.album && primary.title) {
    try {
      const search = await withTimeout(searchSaavnAlbums(`${primary.title} ${primary.artist}`, 1, 1), 8000);
      const hit = search.albums?.[0];
      if (
        hit?.albumId &&
        albumIdentity(hit.name || '', hit.artist?.name || '', typeof hit.year === 'number' ? hit.year : null) ===
          albumIdentity(primary.title, primary.artist, primary.year)
      ) {
        const extra = await withTimeout(getSaavnAlbumDetails(hit.albumId), 8000).catch(() => null);
        if (extra?.tracks?.length) {
          for (const t of extra.tracks) rawTracks.push(t);
          sourceIds.saavn = hit.albumId;
        }
      }
    } catch {}
  }

  const finalTracks = deduplicateTracks(rawTracks);
  const finalTotal = finalTracks.reduce((a, t) => a + (t.durationSeconds || 0), 0);
  const result: AlbumDetail = {
    album: {
      ...primary,
      sourceIds: { ...sourceIds },
      trackCount: finalTracks.length,
      duration: finalTotal > 0 ? finalTotal : undefined,
      tracks: finalTracks,
    },
    tracks: finalTracks,
    alternate,
    sources: { saavn: !!saavnData?.album || !!sourceIds.saavn, ytmusic: !!ytData?.info },
  };
  cacheSet(`album:id:${cleanId}`, result);
  onProgress?.('complete', result);
  return result;
}
