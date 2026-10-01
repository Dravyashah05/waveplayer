// YouTube Music candidate generation. The ONLY module that talks to
// ytmusic-api; everything downstream works on plain Candidates.

import type { Candidate } from './types.js';

export interface YTMusicLike {
  getSong(id: string): Promise<any>;
  getUpNexts(id: string): Promise<any[]>;
  searchSongs(q: string): Promise<any[]>;
  searchArtists(q: string): Promise<any[]>;
  getArtist(artistId: string): Promise<any>;
  getArtistSongs(artistId: string): Promise<any[]>;
  getHomeSections(): Promise<any[]>;
  search(q: string): Promise<any[]>;
}

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

function pickThumb(thumbs: any, id: string): string {
  if (Array.isArray(thumbs)) {
    const sorted = [...thumbs].sort((a, b) => Number(b?.width || 0) - Number(a?.width || 0));
    const best = sorted.find((t) => t?.url);
    if (best?.url) return String(best.url);
  }
  if (typeof thumbs === 'string' && thumbs) return thumbs;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function pickArtist(item: any): string {
  const a = item?.artist;
  if (typeof a === 'string' && a.trim()) return a.trim();
  if (a?.name) return String(a.name);
  const list = item?.artists;
  if (typeof list === 'string' && list.trim()) return list.trim();
  if (Array.isArray(list)) {
    const names = list.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
    if (names.length) return names.join(', ');
  }
  return String(item?.author || item?.uploaderName || '').trim();
}

function pickDuration(item: any): number | undefined {
  const raw = item?.duration ?? item?.length;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (typeof raw === 'string') {
    const parts = raw.trim().split(':').map(Number);
    if (parts.length && parts.every((n) => Number.isFinite(n))) {
      const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
      if (secs > 0) return secs;
    }
  }
  return undefined;
}

export function toCandidate(item: any, relation: string, rank = -1): Candidate | null {
  const videoId = String(item?.videoId || item?.id || '');
  if (!VIDEO_ID.test(videoId)) return null;
  const title = String(item?.name || item?.title || '').trim();
  if (!title) return null;
  const artist = pickArtist(item);
  return {
    videoId,
    title,
    artist,
    album: item?.album?.name ? String(item.album.name) : undefined,
    thumbnails: pickThumb(item?.thumbnails || item?.thumbnail, videoId),
    duration: pickDuration(item),
    year: typeof item?.year === 'number' ? item.year : undefined,
    language: item?.language ? String(item.language) : undefined,
    isrc: item?.isrc ? String(item.isrc) : undefined,
    relation,
    sourceRank: rank,
  };
}

async function safe<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

export interface SeedInfo {
  videoId: string;
  title: string;
  artist: string;
  artistId?: string;
  language?: string;
}

export async function resolveSeed(yt: YTMusicLike, trackId: string): Promise<SeedInfo | null> {
  if (!VIDEO_ID.test(trackId)) return null;
  const song = await safe(yt.getSong(trackId));
  if (!song) return null;
  const artist = String(song?.artist?.name || song?.author || '').trim();
  return {
    videoId: trackId,
    title: String(song?.name || song?.title || '').trim(),
    artist,
    artistId: song?.artist?.artistId ? String(song.artist.artistId) : undefined,
    language: song?.language ? String(song.language) : undefined,
  };
}

/** Up-next / autoplay relations for a seed video. */
export async function upnextCandidates(yt: YTMusicLike, videoId: string, limit = 25): Promise<Candidate[]> {
  const up = (await safe(yt.getUpNexts(videoId))) || [];
  const out: Candidate[] = [];
  up.forEach((item, i) => {
    const c = toCandidate(item, 'upnext', i);
    if (c && c.videoId !== videoId) out.push(c);
  });
  return out.slice(0, limit);
}

/** Same-artist catalogue tracks (resolves artist via seed or name search). */
export async function artistCandidates(yt: YTMusicLike, seed: SeedInfo, limit = 25): Promise<Candidate[]> {
  let artistId = seed.artistId;
  if (!artistId && seed.artist) {
    const found = (await safe(yt.searchArtists(seed.artist))) || [];
    const first = found[0];
    artistId = first?.artistId ? String(first.artistId) : undefined;
  }
  if (!artistId) {
    // Fallback: text search for the artist's songs.
    const songs = (await safe(yt.searchSongs(seed.artist))) || [];
    return songs
      .map((item, i) => toCandidate(item, 'artist-search', i))
      .filter((c): c is Candidate => !!c && c.videoId !== seed.videoId)
      .slice(0, limit);
  }
  const [songs, artist] = await Promise.all([
    safe(yt.getArtistSongs(artistId)),
    safe(yt.getArtist(artistId)),
  ]);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const [i, item] of (songs || []).entries()) {
    const c = toCandidate({ ...item, artist: { name: seed.artist } }, 'artist', i);
    if (c && c.videoId !== seed.videoId && !seen.has(c.videoId)) {
      seen.add(c.videoId);
      out.push(c);
    }
  }
  void artist;
  return out.slice(0, limit);
}

/** Broad text-search candidates (genre/mood/language queries, discovery). */
export async function searchCandidates(yt: YTMusicLike, query: string, relation: string, limit = 15): Promise<Candidate[]> {
  if (!query.trim()) return [];
  const songs = (await safe(yt.searchSongs(query))) || [];
  return songs
    .map((item, i) => toCandidate(item, relation, i))
    .filter((c): c is Candidate => !!c)
    .slice(0, limit);
}

/** Trending / charts candidates for cold start and discovery injection. */
export async function trendingCandidates(yt: YTMusicLike, limit = 20): Promise<Candidate[]> {
  const home = (await safe(yt.getHomeSections())) || [];
  const out: Candidate[] = [];
  for (const section of home) {
    const items = section?.items || section?.contents || [];
    for (const item of items) {
      const c = toCandidate(item, 'trending', out.length);
      if (c) out.push(c);
      if (out.length >= limit) return out;
    }
  }
  if (!out.length) {
    // Fallback when the home feed is unreachable: chart-flavoured searches.
    for (const q of ['top hits', 'trending songs']) {
      for (const c of await searchCandidates(yt, q, 'trending', 10)) {
        if (out.length >= limit) return out;
        out.push(c);
      }
    }
  }
  return out;
}

/** Collect song-like items from every section returned by YT Music Home.
 * Section labels and item wrappers vary, so do not depend on fixed names. */
export async function homeSectionCandidates(yt: YTMusicLike, limit = 100): Promise<Array<{ id: string; title: string; subtitle: string; candidates: Candidate[] }>> {
  const home = (await safe(yt.getHomeSections())) || [];
  const sections: Array<{ id: string; title: string; subtitle: string; candidates: Candidate[] }> = [];
  for (const [index, section] of home.entries()) {
    const items = section?.items || section?.contents || section?.results || [];
    const candidates = (Array.isArray(items) ? items : [])
      .map((item: any, rank: number) => toCandidate(item?.video || item?.song || item?.track || item, 'home', rank))
      .filter((candidate: Candidate | null): candidate is Candidate => !!candidate)
      .slice(0, limit);
    if (!candidates.length) continue;
    const title = String(section?.title || section?.name || `YouTube Music ${index + 1}`).trim();
    sections.push({
      id: String(section?.id || `ytmusic-home-${index}`),
      title,
      subtitle: String(section?.subtitle || section?.description || 'From YouTube Music'),
      candidates,
    });
  }
  return sections;
}
