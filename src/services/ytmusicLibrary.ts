import type { Album, Playlist, SearchArtist, Track } from '../types';

/**
 * YT Music Library service (frontend).
 *
 * Architecture (never bypassed):
 *   React → this module → Express /api/ytmusic-py/* → ytmusicPython.ts →
 *   Python service → ytmusicapi → YouTube Music
 *
 * The browser only receives normalized library data. Google secrets,
 * refresh tokens, auth headers and cookies always stay server-side.
 *
 * Caching: the Express gateway already caches per-user (user-scoped keys).
 * This module adds NO persistent client cache — only in-flight dedup so
 * parallel renders never fan out duplicate requests. Component state is
 * cleared whenever the signed-in user changes, so one user's private
 * library can never be shown to another user.
 */

const PY_BASE = '/api/ytmusic-py';
const LEGACY_BASE = '/api/ytmusic';
const CLIENT_TIMEOUT_MS = 12_000;
const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export type YTMusicErrorCode =
  | 'YTMUSIC_AUTH_REQUIRED'
  | 'YTMUSIC_PY_TIMEOUT'
  | 'YTMUSIC_PY_UNAVAILABLE'
  | 'YTMUSIC_PY_UPSTREAM_ERROR';

export class YTMusicLibraryError extends Error {
  code: YTMusicErrorCode;
  status?: number;
  constructor(code: YTMusicErrorCode, message?: string, status?: number) {
    super(message || code);
    this.name = 'YTMusicLibraryError';
    this.code = code;
    this.status = status;
  }
}

/** Normalized Python MusicTrack shape (see services/ytmusic-python/normalize.py). */
export interface PyMusicTrack {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;
  source?: string;
  sourceId?: string;
  youtubeId?: string;
  ytmusicId?: string;
  isrc?: string;
  year?: number;
}

export interface PyPlaylistSummary {
  id: string;
  title?: string;
  author?: string;
  artwork?: string;
  itemCount?: number;
  source?: string;
  sourceId?: string;
}

export interface PyAlbumSummary {
  id?: string;
  title?: string;
  artist?: string;
  artwork?: string;
  year?: number;
  source?: string;
  sourceId?: string;
}

export interface PyArtistSummary {
  id?: string;
  title?: string;
  artwork?: string;
  subscribers?: string;
  source?: string;
  sourceId?: string;
}

export interface YTMusicAuthStatus {
  authenticated: boolean;
  /** False when the gateway/Python service itself is unreachable. */
  available: boolean;
}

// ---------------------------------------------------------------------------
// Transport (Express gateway only — never the Python service directly)
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<unknown>>();

/** Test seam / logout safety: drop deduped in-flight promises. */
export function clearYTMusicLibraryCache(): void {
  inflight.clear();
}

function mapStatusToCode(status: number, gatewayCode?: string): YTMusicErrorCode {
  if (status === 401 || gatewayCode === 'YTMUSIC_AUTH_REQUIRED') return 'YTMUSIC_AUTH_REQUIRED';
  if (status === 504 || gatewayCode === 'YTMUSIC_PY_TIMEOUT') return 'YTMUSIC_PY_TIMEOUT';
  if (status === 503 || gatewayCode === 'YTMUSIC_PY_UNAVAILABLE') return 'YTMUSIC_PY_UNAVAILABLE';
  return 'YTMUSIC_PY_UPSTREAM_ERROR';
}

async function fetchJson<T>(url: string, timeoutMs = CLIENT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'include', // session cookie → server-side user isolation
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const gatewayCode = typeof (data as any)?.error === 'string' ? String((data as any).error) : undefined;
      throw new YTMusicLibraryError(mapStatusToCode(res.status, gatewayCode), gatewayCode, res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof YTMusicLibraryError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new YTMusicLibraryError('YTMUSIC_PY_TIMEOUT', 'Request timed out');
    }
    throw new YTMusicLibraryError('YTMUSIC_PY_UNAVAILABLE', 'Service unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function deduped<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = loader().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Normalization → existing Wave Track / Playlist / Album / Artist models
// ---------------------------------------------------------------------------

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Normalize a Python MusicTrack into the existing Wave Track model.
 * The videoId is preserved as Track.id (+ identity.youtubeId); source is
 * always "ytmusic" so playback resolves through the existing
 * audioSourceManager YouTube chain — no direct audio control from UI.
 */
export function pyTrackToWave(raw: PyMusicTrack): Track | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.youtubeId || raw.ytmusicId || raw.id || '');
  if (!YT_ID_RE.test(id)) return null;
  const title = String(raw.title || 'Unknown title');
  const author = String(raw.artist || 'YouTube Music');
  const thumbnail = String(raw.artwork || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  const durationSeconds = typeof raw.duration === 'number' && raw.duration > 0 ? Math.floor(raw.duration) : 0;
  const track: Track = {
    id,
    title,
    author,
    thumbnail,
    duration: formatDuration(durationSeconds),
    durationSeconds,
    url: `https://music.youtube.com/watch?v=${id}`,
    source: 'ytmusic',
    type: 'SONG',
    albumName: raw.album ? String(raw.album) : undefined,
    year: typeof raw.year === 'number' ? raw.year : undefined,
    isrc: raw.isrc ? String(raw.isrc) : undefined,
    identity: {
      canonicalId: id,
      normalizedTitle: title.toLowerCase().trim(),
      normalizedArtist: author.toLowerCase().trim(),
      youtubeId: id,
      isrc: raw.isrc ? String(raw.isrc) : undefined,
      duration: durationSeconds || undefined,
      versionType: 'unknown',
    },
    artists: {
      primary: [{ name: author }],
      all: [{ name: author }],
    },
  };
  return track;
}

export function pyPlaylistToWave(raw: PyPlaylistSummary): Playlist | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!id) return null;
  const artwork = raw.artwork ? String(raw.artwork) : '';
  return {
    playlistId: id,
    name: String(raw.title || 'Untitled playlist'),
    author: String(raw.author || 'YouTube Music'),
    thumbnails: artwork ? [{ url: artwork, width: 0, height: 0 }] : [],
    videoCount: typeof raw.itemCount === 'number' ? raw.itemCount : undefined,
    type: 'PLAYLIST',
    source: 'ytmusic',
  };
}

export function pyAlbumToWave(raw: PyAlbumSummary): Album | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '');
  const id = String(raw.id || '');
  if (!id && !title) return null;
  const artwork = raw.artwork ? String(raw.artwork) : '';
  return {
    albumId: id || title,
    playlistId: '',
    name: title || 'Unknown album',
    artist: { artistId: null, name: String(raw.artist || 'Various Artists') },
    year: typeof raw.year === 'number' ? raw.year : null,
    thumbnails: artwork ? [{ url: artwork, width: 0, height: 0 }] : [],
    type: 'ALBUM',
    source: 'ytmusic',
  };
}

export function pyArtistToWave(raw: PyArtistSummary): SearchArtist | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.title || '');
  if (!name) return null;
  const id = String(raw.id || '');
  const artwork = raw.artwork ? String(raw.artwork) : '';
  return {
    artistId: id || name,
    name,
    thumbnails: artwork ? [{ url: artwork, width: 0, height: 0 }] : [],
    type: 'ARTIST',
    source: 'ytmusic',
  };
}

// ---------------------------------------------------------------------------
// Library API (typed, gateway-backed)
// ---------------------------------------------------------------------------

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && String(v) !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

async function getTracks(path: string, query = ''): Promise<Track[]> {
  const data = await fetchJson<unknown>(`${PY_BASE}${path}${query}`);
  if (!Array.isArray(data)) return [];
  return (data as PyMusicTrack[]).map(pyTrackToWave).filter((t): t is Track => !!t);
}

/** User's saved YT Music playlists. */
export function getPlaylists(limit = 50): Promise<Playlist[]> {
  return deduped(`playlists:${limit}`, async () => {
    const data = await fetchJson<unknown>(`${PY_BASE}/library/playlists${qs({ limit })}`);
    if (!Array.isArray(data)) return [];
    return (data as PyPlaylistSummary[]).map(pyPlaylistToWave).filter((p): p is Playlist => !!p);
  });
}

/** User's liked (thumbs-up) YT Music tracks. Kept separate from Wave favorites. */
export function getLikedSongs(limit = 100): Promise<Track[]> {
  return deduped(`liked:${limit}`, () => getTracks('/library/liked', qs({ limit })));
}

/** User's saved library songs. */
export function getSongs(limit = 100): Promise<Track[]> {
  return deduped(`songs:${limit}`, () => getTracks('/library/songs', qs({ limit })));
}

/** User's saved library albums. */
export function getAlbums(limit = 50): Promise<Album[]> {
  return deduped(`albums:${limit}`, async () => {
    const data = await fetchJson<unknown>(`${PY_BASE}/library/albums${qs({ limit })}`);
    if (!Array.isArray(data)) return [];
    return (data as PyAlbumSummary[]).map(pyAlbumToWave).filter((a): a is Album => !!a);
  });
}

/** User's followed artists. */
export function getArtists(limit = 50): Promise<SearchArtist[]> {
  return deduped(`artists:${limit}`, async () => {
    const data = await fetchJson<unknown>(`${PY_BASE}/library/artists${qs({ limit })}`);
    if (!Array.isArray(data)) return [];
    return (data as PyArtistSummary[]).map(pyArtistToWave).filter((a): a is SearchArtist => !!a);
  });
}

/** Recent YT Music history (never cached server-side — always fresh). */
export function getHistory(): Promise<Track[]> {
  return deduped('history', () => getTracks('/library/history'));
}

/** Whether the signed-in user has YT Music credentials linked. */
export async function checkYTMusicLibraryAuth(): Promise<YTMusicAuthStatus> {
  try {
    const data = await fetchJson<{ authenticated?: boolean }>(`${PY_BASE}/auth/status`);
    return { authenticated: !!data?.authenticated, available: true };
  } catch (e) {
    if (e instanceof YTMusicLibraryError && e.code === 'YTMUSIC_AUTH_REQUIRED') {
      return { authenticated: false, available: true };
    }
    return { authenticated: false, available: false };
  }
}

/** Gateway + Python service health (always resolves, never throws). */
export async function getYTMusicGatewayHealth(): Promise<{ gatewayOk: boolean; pythonAvailable: boolean }> {
  try {
    const data = await fetchJson<{ ok?: boolean; pythonAvailable?: boolean }>(`${PY_BASE}/health`, 5000);
    return { gatewayOk: true, pythonAvailable: !!data?.pythonAvailable };
  } catch {
    return { gatewayOk: false, pythonAvailable: false };
  }
}

// ---------------------------------------------------------------------------
// Playlist detail — existing Express /api/ytmusic/* endpoints (anonymous
// npm ytmusic-api, already created). Used by the shared PlaylistPage via the
// `ytmusic:` id prefix so YT Music playlists reuse the Wave detail UI.
// ---------------------------------------------------------------------------

interface LegacyVideoItem {
  videoId?: string;
  name?: string;
  title?: string;
  artist?: { name?: string };
  author?: string;
  thumbnails?: { url: string; width?: number; height?: number }[];
  thumbnail?: string;
  duration?: number;
  album?: { albumId?: string; name?: string };
}

function legacyVideoToTrack(item: LegacyVideoItem): Track | null {
  const id = String(item.videoId || '');
  if (!YT_ID_RE.test(id)) return null;
  const title = String(item.name || item.title || 'Unknown title');
  const author = String(item.artist?.name || item.author || 'YouTube Music');
  const thumbs = Array.isArray(item.thumbnails) && item.thumbnails.length ? item.thumbnails : [];
  let best = '';
  let bestArea = -1;
  for (const t of thumbs) {
    if (!t?.url) continue;
    const area = Number(t.width || 0) * Number(t.height || 0);
    if (area >= bestArea) {
      bestArea = area;
      best = String(t.url);
    }
  }
  const thumbnail = best || String(item.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  const durationSeconds = Number(item.duration) > 0 ? Math.floor(Number(item.duration)) : 0;
  return {
    id,
    title,
    author,
    thumbnail,
    duration: formatDuration(durationSeconds),
    durationSeconds,
    url: `https://music.youtube.com/watch?v=${id}`,
    source: 'ytmusic',
    type: 'SONG',
    albumId: item.album?.albumId,
    albumName: item.album?.name,
  };
}

export async function getYTMusicPlaylistDetails(playlistId: string): Promise<{ info: Playlist; tracks: Track[] }> {
  const clean = String(playlistId || '').replace(/^ytmusic:/, '');
  if (!clean) throw new YTMusicLibraryError('YTMUSIC_PY_UPSTREAM_ERROR', 'Invalid playlist id');
  const [meta, videos] = await Promise.all([
    fetchJson<any>(`${LEGACY_BASE}/playlist/${encodeURIComponent(clean)}`),
    fetchJson<unknown>(`${LEGACY_BASE}/playlist/${encodeURIComponent(clean)}/videos`),
  ]);
  const firstThumb = Array.isArray(meta?.thumbnails) && meta.thumbnails.length ? meta.thumbnails : [];
  const info: Playlist = {
    playlistId: String(meta?.playlistId || clean),
    name: String(meta?.name || meta?.title || 'YouTube Music playlist'),
    author: String(meta?.artist?.name || meta?.author || 'YouTube Music'),
    thumbnails: firstThumb,
    videoCount: typeof meta?.videoCount === 'number' ? meta.videoCount : Array.isArray(videos) ? videos.length : undefined,
    type: 'PLAYLIST',
    description: typeof meta?.description === 'string' ? meta.description : undefined,
    source: 'ytmusic',
  };
  const tracks = Array.isArray(videos)
    ? (videos as LegacyVideoItem[]).map(legacyVideoToTrack).filter((t): t is Track => !!t)
    : [];
  return { info, tracks };
}
