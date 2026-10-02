import type { Track } from '../types';
import { matchSongs } from './recommendation/songMatcher';
import { cleanTitle, musicIdentity } from './recommendation/metadataNormalizer';
import { searchSaavnSongs } from './saavnApi';
import { fetchResilient } from './resilientFetch';

export interface YoutubeItem {
  id: string;
  videoId: string | null;
  title: string;
  artist: string;
  channelTitle: string;
  thumbnail: string;
  position: number;
  publishedAt: string | null;
  status: string;
}

/** Confidence tiers — low-confidence tracks are never auto-imported as matches. */
export const MATCH_HIGH = 0.9;
export const MATCH_POSSIBLE = 0.75;

export type MatchTier = 'high' | 'possible' | 'unmatched';

export interface ItemMatch {
  youtubeVideoId: string | null;
  title: string;
  channelTitle: string;
  thumbnail: string;
  position: number;
  tier: MatchTier;
  confidence: number;
  /** JioSaavn canonical track for high/possible tiers (JioSaavn playback priority). */
  matchedTrack: Track | null;
  matchedTrackId: string | null;
  /** Always playable via the existing YouTube resolution path. */
  youtubeTrack: Track | null;
  reason: string;
}

export interface ImportPreview {
  matched: ItemMatch[];
  possible: ItemMatch[];
  unmatched: ItemMatch[];
}

export interface Progress {
  loaded: number;
  total: number;
  matched: number;
  possible: number;
  unmatched: number;
}

export function isReauthError(error: unknown): boolean {
  const msg = String((error as any)?.message || error || '');
  return /YOUTUBE_NOT_CONNECTED|GOOGLE_REAUTH_REQUIRED|GOOGLE_NOT_CONNECTED/.test(msg);
}

export function reauthMessage(): string {
  return 'YouTube needs reconnecting. Connect YouTube again to continue.';
}

async function fetchJson(path: string): Promise<any> {
  // Bounded timeout via central policy (was: hung indefinitely on stall).
  // Auth failures keep their legacy codes so isReauthError() still matches.
  try {
    const res = await fetchResilient(path, { policy: 'normal' });
    return res.json().catch(() => ({}));
  } catch (e: any) {
    const code = e?.code;
    if (code === 'AUTH_REQUIRED') throw new Error('YOUTUBE_NOT_CONNECTED');
    if (code === 'FORBIDDEN') throw new Error('INSUFFICIENT_SCOPE');
    throw e;
  }
}

/** All playlists of the authenticated user, following YouTube pageTokens (bounded). */
export async function fetchAllYoutubePlaylists(): Promise<{ items: any[]; incomplete: boolean }> {
  const items: any[] = [];
  let pageToken: string | null = null;
  let incomplete = false;
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ maxResults: '50' });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await fetchJson(`/api/youtube/playlists?${qs}`);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
    if (page === 4) incomplete = true;
  }
  return { items, incomplete };
}

/** Every item of a playlist in one call (server walks pages, bounded at ~500). */
export async function fetchAllYoutubeItems(playlistId: string): Promise<{ items: YoutubeItem[]; complete: boolean }> {
  const data = await fetchJson(`/api/youtube/playlists/${encodeURIComponent(playlistId)}/items?all=1`);
  return { items: (data.items || []) as YoutubeItem[], complete: data.complete !== false };
}

/** Canonical dedupe key: Saavn id wins when matched, else the immutable videoId. */
export function canonicalTrackId(track: Pick<Track, 'id' | 'source'>): string {
  return `${track.source || 'unknown'}:${track.id}`;
}

export function youtubeFallbackTrack(item: YoutubeItem): Track | null {
  if (!item.videoId) return null;
  return {
    id: item.videoId,
    title: item.title || 'Unknown title',
    author: item.channelTitle || item.artist || 'YouTube',
    thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
    duration: '',
    durationSeconds: 0,
    url: `https://www.youtube.com/watch?v=${item.videoId}`,
    source: 'youtube',
    type: 'VIDEO',
    identity: {
      canonicalId: `youtube:${item.videoId}`,
      normalizedTitle: '',
      normalizedArtist: '',
      youtubeId: item.videoId,
      versionType: 'unknown',
    },
  };
}

/**
 * Match one YouTube item against the JioSaavn catalog.
 * Priority: exact videoId anchor (probes share it) → ISRC → normalized
 * title+artist (+album/duration) → fuzzy — all inside matchSongs().
 * Never throws: failures degrade to `unmatched` so one bad song can't break
 * the whole playlist.
 */
export async function matchYoutubeItem(
  item: YoutubeItem,
  searchFn: (q: string, page?: number, limit?: number) => Promise<{ tracks: Track[] }> = searchSaavnSongs,
): Promise<ItemMatch> {
  const base = {
    youtubeVideoId: item.videoId,
    title: item.title || 'Unknown title',
    channelTitle: item.channelTitle || item.artist || '',
    thumbnail: item.thumbnail,
    position: item.position ?? 0,
  };
  const youtubeTrack = youtubeFallbackTrack(item);
  if (!item.videoId) {
    return { ...base, tier: 'unmatched', confidence: 0, matchedTrack: null, matchedTrackId: null, youtubeTrack, reason: 'unavailable' };
  }
  try {
    const artist = item.channelTitle || item.artist || '';
    const query = `${cleanTitle(item.title)} ${artist}`.trim();
    const { tracks } = await searchFn(query, 1, 5);
    let best: { track: Track; confidence: number; reasons: string[] } | null = null;
    const probe = youtubeTrack!;
    const probeId = musicIdentity(probe);
    for (const candidate of tracks || []) {
      if (!candidate?.id) continue;
      const m = matchSongs(probe, candidate);
      let confidence = m.confidence;
      const reasons = [...m.reasons];
      // Both sides pass through the same symmetric normalization, so an
      // exact title AND artist pair is the strongest non-ISRC evidence.
      // The base scorer caps that case at ~0.82 (no album/duration), which
      // would wrongly strand exact matches below the high tier.
      const candId = musicIdentity(candidate);
      const exactBoth = !!probeId.normalizedTitle && !!probeId.normalizedArtist
        && probeId.normalizedTitle === candId.normalizedTitle
        && probeId.normalizedArtist === candId.normalizedArtist
        && probeId.versionType === candId.versionType;
      if (exactBoth && confidence < 0.92) { confidence = 0.92; reasons.push('exact title+artist'); }
      if (!best || confidence > best.confidence) best = { track: candidate, confidence, reasons };
    }
    if (best && best.confidence >= MATCH_HIGH) {
      const matchedTrack: Track = {
        ...best.track,
        identity: { ...musicIdentity(best.track), youtubeId: item.videoId },
      };
      return { ...base, tier: 'high', confidence: best.confidence, matchedTrack, matchedTrackId: matchedTrack.id, youtubeTrack, reason: best.reasons.join(', ') || 'high confidence' };
    }
    if (best && best.confidence >= MATCH_POSSIBLE) {
      const matchedTrack: Track = {
        ...best.track,
        identity: { ...musicIdentity(best.track), youtubeId: item.videoId },
      };
      return { ...base, tier: 'possible', confidence: best.confidence, matchedTrack, matchedTrackId: matchedTrack.id, youtubeTrack, reason: best.reasons.join(', ') || 'possible match' };
    }
    return { ...base, tier: 'unmatched', confidence: best?.confidence ?? 0, matchedTrack: null, matchedTrackId: null, youtubeTrack, reason: 'no confident match' };
  } catch {
    return { ...base, tier: 'unmatched', confidence: 0, matchedTrack: null, matchedTrackId: null, youtubeTrack, reason: 'match lookup failed' };
  }
}

/** Run matching with bounded concurrency, streaming progress. Never throws. */
export async function buildImportPreview(
  items: YoutubeItem[],
  onProgress?: (p: Progress) => void,
  opts: { concurrency?: number; cancelled?: () => boolean; searchFn?: (q: string, page?: number, limit?: number) => Promise<{ tracks: Track[] }> } = {},
): Promise<ImportPreview> {
  const preview: ImportPreview = { matched: [], possible: [], unmatched: [] };
  const ordered = [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const total = ordered.length;
  let done = 0;
  const emit = () => onProgress?.({ loaded: done, total, matched: preview.matched.length, possible: preview.possible.length, unmatched: preview.unmatched.length });
  emit();
  const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? 4));
  for (let i = 0; i < ordered.length; i += concurrency) {
    if (opts.cancelled?.()) break;
    const batch = await Promise.all(ordered.slice(i, i + concurrency).map((item) => matchYoutubeItem(item, opts.searchFn)));
    for (const m of batch) {
      preview[m.tier === 'high' ? 'matched' : m.tier === 'possible' ? 'possible' : 'unmatched'].push(m);
      done++;
    }
    emit();
  }
  for (const list of [preview.matched, preview.possible, preview.unmatched]) list.sort((a, b) => a.position - b.position);
  return preview;
}

/**
 * Merge preview decisions into a Wave local playlist object.
 * - Never overwrites other playlists; merges into the same import target.
 * - Dedupes by canonical track id AND by videoId (same video twice → once).
 * - Preserves original YouTube order for newly added tracks.
 */
export function buildWavePlaylist(
  meta: { id: string; title: string; description?: string; thumbnail?: string },
  matches: ItemMatch[],
  existing: any | null,
): any {
  const seen = new Set<string>();
  const seenVideos = new Set<string>();
  const songs: Track[] = [];
  const push = (t: Track | null, videoId: string | null) => {
    if (!t?.id) return;
    const key = canonicalTrackId(t);
    if (seen.has(key)) return;
    if (videoId && seenVideos.has(videoId)) return;
    seen.add(key);
    if (videoId) seenVideos.add(videoId);
    songs.push(t);
  };
  for (const s of existing?.songs || []) push(s, (s as any)?.identity?.youtubeId || null);
  for (const m of [...matches].sort((a, b) => a.position - b.position)) {
    push(m.matchedTrack || m.youtubeTrack, m.youtubeVideoId);
  }
  return {
    ...(existing || {}),
    id: existing?.id || `LOCAL_YT_${meta.id}`,
    title: meta.title,
    description: meta.description || '',
    thumbnail: meta.thumbnail || existing?.thumbnail || '',
    songs,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'youtube',
    origin: 'youtube-import',
    sourcePlaylistId: meta.id,
    lastSyncedAt: new Date().toISOString(),
    youtubePlaylistId: meta.id,
  };
}
