import type { Track } from '../types';
import { fromYouTubeItem, type UnifiedPlaylist, type YouTubePlaylistItem } from './playlistModel';
import { notifyLibraryChanged } from './accountSync';
import { fetchResilient, ResilientFetchError } from './resilientFetch';

/**
 * Playlist Experience 2.0 — YouTube Data API playlist client (frontend).
 *
 * Transport only: React → this module → Express /api/youtube/* → YouTube.
 * Tokens, secrets, cookies and auth headers stay server-side; the browser
 * sees normalized playlist/track shapes. Write calls require the `youtube`
 * (manage) scope — read-only sessions get INSUFFICIENT_SCOPE and the UI
 * must keep those playlists read-only instead of pretending success.
 */

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export type YoutubeCapability = { connected: boolean; canWrite: boolean; scopes: string[] };

export class YoutubePlaylistError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message?: string, status?: number) {
    super(message || code);
    this.name = 'YoutubePlaylistError';
    this.code = code;
    this.status = status;
  }
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  // Bounded timeout + one retry via central policy (was: no timeout at all).
  let res: Response;
  try {
    res = await fetchResilient(path, { policy: 'normal', ...init });
  } catch (e) {
    if (e instanceof ResilientFetchError && (e.code === 'AUTH_REQUIRED' || e.code === 'FORBIDDEN')) {
      throw new YoutubePlaylistError(e.code === 'FORBIDDEN' ? 'INSUFFICIENT_SCOPE' : 'YOUTUBE_NOT_CONNECTED', e.code, e.status);
    }
    throw new YoutubePlaylistError('YOUTUBE_UNAVAILABLE', 'YouTube is unavailable');
  }
  const data = await res.json().catch(() => ({}));
  return data;
}

/** Capability probe: connected + whether the manage scope is granted. */
export async function getYoutubeCapability(): Promise<YoutubeCapability> {
  try {
    const data = await fetchJson('/api/auth/youtube/status');
    const scopes: string[] = Array.isArray(data?.scopes) ? data.scopes : [];
    const connected = !!data?.connected;
    const canWrite = connected && scopes.some((s) => s === 'https://www.googleapis.com/auth/youtube');
    return { connected, canWrite, scopes };
  } catch {
    return { connected: false, canWrite: false, scopes: [] };
  }
}

export function isInsufficientScope(e: unknown): boolean {
  return e instanceof YoutubePlaylistError && e.code === 'INSUFFICIENT_SCOPE';
}

export function isAuthError(e: unknown): boolean {
  if (!(e instanceof YoutubePlaylistError)) return false;
  return ['YOUTUBE_NOT_CONNECTED', 'GOOGLE_NOT_CONNECTED', 'GOOGLE_REAUTH_REQUIRED', 'INSUFFICIENT_SCOPE'].includes(e.code);
}

function toTrack(item: any): Track | null {
  const videoId = String(item?.videoId || '');
  if (!YT_ID_RE.test(videoId)) return null;
  const title = String(item?.title || 'Unknown title');
  const author = String(item?.artist || item?.channelTitle || 'YouTube');
  const thumbnail = String(item?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  return {
    id: videoId,
    title,
    author,
    thumbnail,
    duration: '',
    durationSeconds: 0,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    source: 'youtube',
    type: 'VIDEO',
    identity: {
      canonicalId: `youtube:${videoId}`,
      normalizedTitle: title.toLowerCase().trim(),
      normalizedArtist: author.toLowerCase().trim(),
      youtubeId: videoId,
      versionType: 'unknown',
    },
  };
}

/** List the signed-in user's YouTube playlists (one failure → [], never throws). */
export async function listYoutubePlaylists(limit = 25): Promise<UnifiedPlaylist[]> {
  try {
    const [cap, data] = await Promise.all([
      getYoutubeCapability(),
      fetchJson(`/api/youtube/playlists?maxResults=${Math.min(50, Math.max(1, limit))}`),
    ]);
    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .filter((it: any) => it && typeof it.id === 'string')
      .map((it: any) => fromYouTubeItem({
        id: String(it.id),
        title: String(it.title || ''),
        description: String(it.description || ''),
        thumbnail: String(it.thumbnail || ''),
        channelTitle: String(it.channelTitle || ''),
        itemCount: Number(it.itemCount || 0),
        privacy: String(it.privacy || 'private'),
      } satisfies YouTubePlaylistItem, undefined, cap.canWrite));
  } catch {
    return [];
  }
}

export interface YoutubePlaylistDetail extends UnifiedPlaylist {
  /** YouTube itemId per videoId — required for honest remove operations. */
  itemIds: Record<string, string>;
}

/** Playlist detail + tracks. Throws on failure so callers can show retry. */
export async function getYoutubePlaylistDetail(
  playlistId: string,
  cap?: YoutubeCapability,
): Promise<YoutubePlaylistDetail> {
  const clean = String(playlistId || '').replace(/^(youtube|wave|local):/, '');
  if (!clean) throw new YoutubePlaylistError('PLAYLIST_NOT_FOUND', 'Invalid playlist id', 400);
  const capability = cap || await getYoutubeCapability().catch(() => ({ connected: false, canWrite: false, scopes: [] }));
  const [meta, items] = await Promise.all([
    fetchJson(`/api/youtube/playlists/${encodeURIComponent(clean)}`),
    fetchJson(`/api/youtube/playlists/${encodeURIComponent(clean)}/items?all=1`).catch((e) => {
      // Meta without items is still a usable playlist (retry only the tracks).
      if (e instanceof YoutubePlaylistError) throw e;
      throw new YoutubePlaylistError('YOUTUBE_UNAVAILABLE', 'Could not load tracks');
    }),
  ]);
  const rawItems = Array.isArray(items?.items) ? items.items : [];
  const tracks = rawItems.map(toTrack).filter((t: Track | null): t is Track => !!t);
  const itemIds: Record<string, string> = {};
  for (const it of rawItems) {
    const vid = String(it?.videoId || '');
    if (/^[a-zA-Z0-9_-]{11}$/.test(vid) && it?.id && !itemIds[vid]) itemIds[vid] = String(it.id);
  }
  return {
    ...fromYouTubeItem({
      id: String(meta?.id || clean),
      title: String(meta?.title || 'YouTube playlist'),
      description: String(meta?.description || ''),
      thumbnail: String(meta?.thumbnail || ''),
      channelTitle: String(meta?.channelTitle || ''),
      itemCount: Number(meta?.itemCount ?? tracks.length),
      privacy: String(meta?.privacy || 'private'),
    }, tracks, capability.canWrite),
    itemIds,
  };
}

/** Create a YouTube playlist. Requires manage scope — never pretends success. */
export async function createYoutubePlaylist(input: {
  title: string;
  description?: string;
  privacyStatus?: 'private' | 'public' | 'unlisted';
}): Promise<UnifiedPlaylist> {
  const title = String(input.title || '').trim();
  if (!title) throw new YoutubePlaylistError('INVALID_PLAYLIST', 'Title is required', 400);
  const data = await fetchJson('/api/youtube/playlists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, description: String(input.description || ''), privacyStatus: input.privacyStatus || 'private' }),
  });
  return fromYouTubeItem({
    id: String(data?.id || ''),
    title: String(data?.title || title),
    description: String(data?.description || ''),
    thumbnail: String(data?.thumbnail || ''),
    channelTitle: String(data?.channelTitle || ''),
    itemCount: 0,
    privacy: String(data?.privacy || 'private'),
  }, [], true);
}

/** Append one video. Returns false (not throw) only when the videoId is unusable. */
export async function addVideoToYoutubePlaylist(playlistId: string, videoId: string): Promise<{ ok: boolean; itemId?: string }> {
  const clean = String(playlistId || '').replace(/^(youtube|wave|local):/, '');
  if (!YT_ID_RE.test(String(videoId || ''))) return { ok: false };
  const data = await fetchJson(`/api/youtube/playlists/${encodeURIComponent(clean)}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ videoId }),
  });
  try {
    notifyLibraryChanged();
  } catch { /* refresh signal is best-effort */ }
  return { ok: true, itemId: String(data?.id || '') };
}

/** Remove one playlist item. Write-gated server-side (403 when read-only). */
export async function removeVideoFromYoutubePlaylist(playlistId: string, itemId: string): Promise<boolean> {
  const clean = String(playlistId || '').replace(/^(youtube|wave|local):/, '');
  await fetchJson(`/api/youtube/playlists/${encodeURIComponent(clean)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  try {
    notifyLibraryChanged();
  } catch { /* refresh signal is best-effort */ }
  return true;
}

export async function updateYoutubePlaylist(
  playlistId: string,
  patch: { title?: string; description?: string; privacyStatus?: 'private' | 'public' | 'unlisted' },
): Promise<boolean> {
  const clean = String(playlistId || '').replace(/^(youtube|wave|local):/, '');
  await fetchJson(`/api/youtube/playlists/${encodeURIComponent(clean)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return true;
}

export async function deleteYoutubePlaylist(playlistId: string): Promise<boolean> {
  const clean = String(playlistId || '').replace(/^(youtube|wave|local):/, '');
  await fetchJson(`/api/youtube/playlists/${encodeURIComponent(clean)}`, { method: 'DELETE' });
  return true;
}
