import { Track, Playlist, Album, SearchArtist, SearchFilter } from '../types';

const YT_BASE = '/api/ytmusic';

const STREAM_FAILURE_TTL_MS = 20_000;
const streamInflight = new Map<string, Promise<ResolvedYouTubeAudio | null>>();
const streamFailures = new Map<string, number>();
function rememberStreamFailure(videoId: string): void {
  for (const [id, retryAt] of streamFailures) if (retryAt <= Date.now()) streamFailures.delete(id);
  if (streamFailures.size >= 200) {
    const oldest = streamFailures.keys().next();
    if (!oldest.done) streamFailures.delete(oldest.value);
  }
  streamFailures.set(videoId, Date.now() + STREAM_FAILURE_TTL_MS);
}

export interface ResolvedYouTubeAudio {
  videoId: string;
  streamUrl: string;
  expiresAt?: number;
  mimeType: string;
  bitrate?: number;
  contentLength?: number;
}

export function parseResolvedYouTubeAudio(value: unknown, expectedVideoId: string): ResolvedYouTubeAudio | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.success !== true || data.videoId !== expectedVideoId || typeof data.streamUrl !== 'string' || typeof data.mimeType !== 'string') return null;
  try {
    const url = new URL(data.streamUrl);
    if (url.protocol !== 'https:' || !/(^|\.)googlevideo\.com$/i.test(url.hostname) || !/^audio\//i.test(data.mimeType)) return null;
  } catch { return null; }
  const numeric = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
  const resolved: ResolvedYouTubeAudio = {
    videoId: expectedVideoId,
    streamUrl: data.streamUrl,
    mimeType: data.mimeType,
    expiresAt: numeric(data.expiresAt),
    bitrate: numeric(data.bitrate),
    contentLength: numeric(data.contentLength),
  };
  if (resolved.expiresAt !== undefined && Date.now() + 5_000 >= resolved.expiresAt) return null;
  return resolved;
}

export async function resolveYouTubeAudio(videoId: string): Promise<ResolvedYouTubeAudio | null> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  const now = Date.now();
  const retryAt = streamFailures.get(videoId);
  if (retryAt && retryAt > now) return null;
  streamFailures.delete(videoId);
  const existing = streamInflight.get(videoId);
  if (existing) return existing;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${YT_BASE}/stream/${encodeURIComponent(videoId)}`, {
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) {
        rememberStreamFailure(videoId);
        return null;
      }
      const resolved = parseResolvedYouTubeAudio(await response.json(), videoId);
      if (!resolved) rememberStreamFailure(videoId);
      return resolved;
    } catch {
      rememberStreamFailure(videoId);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();
  streamInflight.set(videoId, request);
  try {
    return await request;
  } finally {
    if (streamInflight.get(videoId) === request) streamInflight.delete(videoId);
  }
}

function formatDuration(sec: number | null): string {
  if (!sec || !isFinite(sec)) return '—';
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = Math.floor(sec%60);
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function pickLargestThumb(thumbs: any[] | undefined, fallbackId?: string): string {
  if (Array.isArray(thumbs) && thumbs.length) {
    let best = thumbs[0];
    for (const t of thumbs) {
      const w = Number(t?.width || 0);
      const bw = Number(best?.width || 0);
      const h = Number(t?.height || 0);
      const bh = Number(best?.height || 0);
      if (w * h > bw * bh) best = t;
    }
    if (best?.url) {
      // For yt3 thumbnails, try to upscale: replace w60/w120 etc with w800 for higher quality if url contains =w...
      let url = String(best.url);
      // If it's a Googleusercontent URL with =w<number>, upgrade to w800 for high quality
      if (url.includes('=w')) {
        url = url.replace(/=w\d+-h\d+/, '=w1080-h1080').replace(/=w\d+/, '=w1080');
        // Ensure high quality params
        if (!url.includes('-l90')) url += '';
      }
      return url;
    }
  }
  if (fallbackId) return `https://i.ytimg.com/vi/${fallbackId}/maxresdefault.jpg`;
  return '';
}

function toTrack(item: any): Track | null {
  const id = String(item.videoId || item.id || '');
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
  const title = String(item.name || item.title || 'Unknown');
  const author = String(item.artist?.name || item.author || item.uploaderName || 'YouTube');
  const thumb = pickLargestThumb(item.thumbnails, id) || String(item.thumbnail || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`);
  const dur = Number(item.duration ?? 0);
  return {
    id,
    title,
    author,
    thumbnail: thumb,
    duration: formatDuration(dur),
    durationSeconds: dur || 0,
    url: `https://www.youtube.com/watch?v=${id}`,
    source: 'ytmusic',
    type: item.type === 'VIDEO' ? 'VIDEO' : 'SONG',
    albumId: item.album?.albumId,
    albumName: item.album?.name,
  };
}

function toPlaylist(item: any): Playlist | null {
  const pid = String(item.playlistId || '');
  if (!pid) return null;
  return {
    playlistId: pid,
    name: String(item.name || item.title || 'Playlist'),
    author: String(item.artist?.name || 'YouTube'),
    thumbnails: Array.isArray(item.thumbnails) ? item.thumbnails : [],
    type: 'PLAYLIST',
    source: 'ytmusic',
  };
}

function toAlbum(item: any): Album | null {
  const aid = String(item.albumId || '');
  if (!aid) return null;
  return {
    albumId: aid,
    playlistId: String(item.playlistId || ''),
    name: String(item.name || 'Album'),
    artist: { artistId: item.artist?.artistId || null, name: String(item.artist?.name || 'Unknown') },
    year: typeof item.year === 'number' ? item.year : null,
    thumbnails: Array.isArray(item.thumbnails) ? item.thumbnails : [],
    type: 'ALBUM',
  };
}

function toArtist(item: any): SearchArtist | null {
  const aid = String(item.artistId || item.browseId || item.id || '');
  const name = String(item.name || item.artist || item.title || '');
  if (!name) return null;
  return {
    artistId: aid || name,
    name,
    thumbnails: Array.isArray(item.thumbnails) ? item.thumbnails : Array.isArray(item.thumbnail) ? item.thumbnail : [],
    type: 'ARTIST',
  };
}

export async function ytmusicSearch(query: string, filter: SearchFilter = 'all'): Promise<{ tracks: Track[]; playlists: Playlist[]; albums: Album[]; artists: SearchArtist[] }> {
  const q = query.trim();
  if (!q) return { tracks: [], playlists: [], albums: [], artists: [] };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`${YT_BASE}/search?q=${encodeURIComponent(q)}&filter=${filter}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`ytmusic search failed ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return { tracks: [], playlists: [], albums: [], artists: [] };

  const tracks: Track[] = [];
  const playlists: Playlist[] = [];
  const albums: Album[] = [];
  const artists: SearchArtist[] = [];

  for (const item of data) {
    if (item.type === 'SONG' || item.type === 'VIDEO') {
      const t = toTrack(item);
      if (t) tracks.push(t);
    } else if (item.type === 'PLAYLIST') {
      const p = toPlaylist(item);
      if (p) playlists.push(p);
    } else if (item.type === 'ALBUM') {
      const a = toAlbum(item);
      if (a) albums.push(a);
    } else if (item.type === 'ARTIST') {
      const ar = toArtist(item);
      if (ar) artists.push(ar);
    }
  }
  return { tracks, playlists, albums, artists };
  } catch {
    return { tracks: [], playlists: [], albums: [], artists: [] };
  }
}

export async function ytmusicSuggestions(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetch(`${YT_BASE}/suggestions?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0,8).map(String) : [];
}

export async function getPlaylistVideos(playlistId: string): Promise<Track[]> {
  const res = await fetch(`${YT_BASE}/playlist/${encodeURIComponent(playlistId)}/videos`);
  if (!res.ok) throw new Error('playlist videos failed');
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map(toTrack).filter(Boolean) as Track[];
}

export async function getAlbumDetails(albumId: string): Promise<{ info: Album; tracks: Track[] } | null> {
  const res = await fetch(`${YT_BASE}/album/${encodeURIComponent(albumId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.albumId && !data?.name && !data?.title) return null;
  const info = toAlbum(data) || {
    albumId: data.albumId || albumId,
    playlistId: data.playlistId || '',
    name: data.name || data.title || 'Album',
    artist: { artistId: data.artist?.artistId || null, name: data.artist?.name || 'Various Artists' },
    year: typeof data.year === 'number' ? data.year : null,
    thumbnails: Array.isArray(data.thumbnails) ? data.thumbnails : [],
    type: 'ALBUM' as const,
  };
  const tracks = Array.isArray(data.songs) ? (data.songs.map(toTrack).filter(Boolean) as Track[]) : [];
  return { info, tracks };
}

export async function getYTMusicArtist(artistId: string): Promise<{
  artist: SearchArtist;
  topSongs: Track[];
  topAlbums: Album[];
  singles?: Album[];
  similarArtists?: SearchArtist[];
} | null> {
  if (!artistId) return null;
  try {
    const res = await fetch(`${YT_BASE}/artist/${encodeURIComponent(artistId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.name) return null;
    const artist: SearchArtist = toArtist(data) || {
      artistId: data.artistId || artistId,
      name: data.name,
      thumbnails: data.thumbnails || [],
      type: 'ARTIST' as const,
    };
    const topSongs = Array.isArray(data.topSongs) ? (data.topSongs.map(toTrack).filter(Boolean) as Track[]) : [];
    const topAlbums = Array.isArray(data.topAlbums) ? (data.topAlbums.map(toAlbum).filter(Boolean) as Album[]) : [];
    const singles = Array.isArray(data.singles) ? (data.singles.map(toAlbum).filter(Boolean) as Album[]) : [];
    const similarArtists = Array.isArray(data.similarArtists) ? (data.similarArtists.map(toArtist).filter(Boolean) as SearchArtist[]) : [];

    return { artist, topSongs, topAlbums, singles, similarArtists };
  } catch {
    return null;
  }
}

export async function getHomeSections(): Promise<any[]> {
  const res = await fetch(`${YT_BASE}/home`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function getUpNext(videoId: string): Promise<Track[]> {
  const res = await fetch(`${YT_BASE}/upnext/${encodeURIComponent(videoId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((item:any)=> ({
    id: String(item.videoId),
    title: String(item.title || item.name || 'Unknown'),
    author: String(item.artists?.name || 'YouTube'),
    thumbnail: pickLargestThumb(item.thumbnails, String(item.videoId)),
    duration: formatDuration(Number(item.duration||0)),
    durationSeconds: Number(item.duration||0),
    url: `https://www.youtube.com/watch?v=${item.videoId}`,
    source: 'ytmusic' as const,
    type: 'SONG' as const,
  })).filter(t=> /^[a-zA-Z0-9_-]{11}$/.test(t.id));
}

export interface SyncedWord { text: string; start: number; end: number; }
export interface SyncedLine { time: number; text: string; words?: SyncedWord[]; }
export interface LyricsData { synced: SyncedLine[] | null; plain: string[] | null; source: string | null; lyrics: string[] | null; }

export function parseLRC(lrc: string): SyncedLine[] {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result: SyncedLine[] = [];
  const tagRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    tagRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    const tags: number[] = [];
    while ((match = tagRegex.exec(trimmed)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const msStr = match[3];
      const ms = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr, 10);
      tags.push(min * 60 + sec + ms / 1000);
    }
    const text = trimmed.replace(tagRegex, '').trim();
    if (text && tags.length) {
      for (const t of tags) result.push({ time: t, text });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

async function searchLrcLibUncached(
  trackTitle: string,
  artistName: string,
  durationSec?: number
): Promise<{ synced: SyncedLine[] | null; plain: string[] | null; source: string | null } | null> {
  if (!trackTitle) return null;
  try {
    const params = new URLSearchParams({ track: trackTitle, artist: artistName });
    if (durationSec && durationSec > 10) params.set('duration', String(Math.round(durationSec)));
    const response = await fetch(`${YT_BASE}/lyrics/search?${params}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      synced: Array.isArray(data.synced) ? data.synced : null,
      plain: Array.isArray(data.plain) ? data.plain : null,
      source: typeof data.source === 'string' ? data.source : null,
    };
  } catch {}

  return null;
}

const lyricsLookupCache = new Map<string, { until: number; value: Awaited<ReturnType<typeof searchLrcLibUncached>> }>();
const lyricsLookupInflight = new Map<string, Promise<Awaited<ReturnType<typeof searchLrcLibUncached>>>>();

export async function searchLrcLib(
  trackTitle: string,
  artistName: string,
  durationSec?: number,
): Promise<Awaited<ReturnType<typeof searchLrcLibUncached>>> {
  const key = `${trackTitle.trim().toLowerCase()}|${artistName.trim().toLowerCase()}|${Math.round(durationSec || 0)}`;
  const cached = lyricsLookupCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (cached) lyricsLookupCache.delete(key);
  const pending = lyricsLookupInflight.get(key);
  if (pending) return pending;
  const request = searchLrcLibUncached(trackTitle, artistName, durationSec);
  lyricsLookupInflight.set(key, request);
  try {
    const value = await request;
    if (lyricsLookupCache.size >= 200) {
      const oldest = lyricsLookupCache.keys().next();
      if (!oldest.done) lyricsLookupCache.delete(oldest.value);
    }
    lyricsLookupCache.set(key, { until: Date.now() + 60_000, value });
    return value;
  } finally {
    if (lyricsLookupInflight.get(key) === request) lyricsLookupInflight.delete(key);
  }
}

export async function getLyrics(videoId: string): Promise<LyricsData | null> {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const res = await fetch(`${YT_BASE}/lyrics/${encodeURIComponent(videoId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    // New server returns { synced, plain, lyrics, source }
    if (data && (Array.isArray(data.synced) || Array.isArray(data.plain) || Array.isArray(data.lyrics))) {
      return {
        synced: Array.isArray(data.synced) ? data.synced : null,
        plain: Array.isArray(data.plain) ? data.plain : Array.isArray(data.lyrics) ? data.lyrics : null,
        source: data.source || null,
        lyrics: Array.isArray(data.lyrics) ? data.lyrics : Array.isArray(data.plain) ? data.plain : null,
      };
    }
    // Fallback old shape: { lyrics: string[] }
    if (Array.isArray(data?.lyrics)) return { synced: null, plain: data.lyrics, source: 'ytmusic', lyrics: data.lyrics };
    if (Array.isArray(data)) return { synced: null, plain: data, source: 'ytmusic', lyrics: data };
    return null;
  } catch {
    return null;
  }
}

// --- Playlist write: real YTMusic via Python backend (ytmusicapi) with local mock fallback ---
const YT_WRITE_BASE = '/api/ytmusic'; // proxied to Python :3000 for /playlist & /auth, Node :8001 for others

export type YTMusicAuthMode = 'connected' | 'disconnected' | 'unavailable';

export async function checkYTMusicAuth(): Promise<{ authenticated: boolean; authFile: string | null; mode: YTMusicAuthMode }> {
  // Legacy `/api/ytmusic/auth/*` never existed server-side (was a 404).
  // Query the real gateway status with a bound; anything else is anonymous.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch('/api/ytmusic-py/auth/status', { credentials: 'include', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { authenticated: false, authFile: null, mode: 'unavailable' };
    const data: any = await res.json().catch(() => ({}));
    const authenticated = !!data?.authenticated;
    return { authenticated, authFile: null, mode: authenticated ? 'connected' : 'disconnected' };
  } catch { return { authenticated: false, authFile: null, mode: 'unavailable' }; }
}

export async function createYTMusicPlaylist(title: string, description = '', privacyStatus: 'PRIVATE' | 'PUBLIC' | 'UNLISTED' = 'PRIVATE'): Promise<{ playlistId: string; mock?: boolean }> {
  try {
    const res = await fetch(`${YT_WRITE_BASE}/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, privacyStatus }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.playlistId) return { playlistId: String(data.playlistId) };
    // Fallback to mock if 401/503 (no auth or not installed)
    if (res.status === 401 || res.status === 503) throw new Error(data?.detail || 'auth required');
    throw new Error(data?.detail || `failed ${res.status}`);
  } catch (e) {
    // Mock fallback: create local playlist id
    const mockId = `LOCAL_${Date.now().toString(36).toUpperCase()}`;
    try {
      const raw = localStorage.getItem('wave:local_playlists');
      const arr = raw ? JSON.parse(raw) : [];
      arr.unshift({ id: mockId, title, description, privacyStatus, songs: [], createdAt: new Date().toISOString(), mock: true });
      localStorage.setItem('wave:local_playlists', JSON.stringify(arr.slice(0, 50)));
    } catch {}
    // Surface that it's mock
    return { playlistId: mockId, mock: true };
  }
}

export async function addToYTMusicPlaylist(playlistId: string, videoIds: string[]): Promise<{ mock?: boolean }> {
  const cleanIds = videoIds.map((v) => {
    const m = String(v).match(/([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : String(v).slice(0, 11);
  }).filter((id) => /^[a-zA-Z0-9_-]{11}$/.test(id));
  if (!cleanIds.length) throw new Error('no valid videoIds');
  // If local mock id, just update local storage
  if (playlistId.startsWith('LOCAL_')) {
    try {
      const raw = localStorage.getItem('wave:local_playlists');
      const arr: any[] = raw ? JSON.parse(raw) : [];
      const idx = arr.findIndex((p) => p.id === playlistId);
      if (idx >= 0) {
        const set = new Set([...(arr[idx].songs || []), ...cleanIds]);
        arr[idx].songs = Array.from(set);
        localStorage.setItem('wave:local_playlists', JSON.stringify(arr));
      }
    } catch {}
    return { mock: true };
  }
  try {
    const res = await fetch(`${YT_WRITE_BASE}/playlist/${encodeURIComponent(playlistId)}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoIds: cleanIds }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return {};
    if (res.status === 401 || res.status === 503) throw new Error(data?.detail || 'auth required');
    throw new Error(data?.detail || `failed ${res.status}`);
  } catch (e) {
    // Fallback mock for real playlistId when auth missing: still store locally for UX
    try {
      const raw = localStorage.getItem('wave:local_playlists');
      const arr: any[] = raw ? JSON.parse(raw) : [];
      const idx = arr.findIndex((p) => p.id === playlistId);
      if (idx >= 0) {
        const set = new Set([...(arr[idx].songs || []), ...cleanIds]);
        arr[idx].songs = Array.from(set);
        localStorage.setItem('wave:local_playlists', JSON.stringify(arr));
      }
    } catch {}
    return { mock: true };
  }
}
