// Diversity filtering: at most one recording per canonical song, artist and
// album caps, and a same-artist-run penalty so the queue can't collapse into
// "Song A, Song A Remix, Song A Live…".

import type { ScoredCandidate } from './types.js';
import { canonicalSongId, firstArtist, normalizeText } from './similarity.js';

export interface DiversityOptions {
  artistCap?: number;
  albumCap?: number;
  /** Max consecutive tracks by the same artist before a penalty applies. */
  maxRun?: number;
  runPenalty?: number;
}

export function diversify(
  scored: ScoredCandidate[],
  limit: number,
  opts: DiversityOptions = {},
): ScoredCandidate[] {
  const artistCap = opts.artistCap ?? 2;
  const albumCap = opts.albumCap ?? 2;
  const maxRun = opts.maxRun ?? 2;
  const runPenalty = opts.runPenalty ?? 0.12;
  const selected: ScoredCandidate[] = [];
  const seenSongs = new Set<string>();
  const seenVideos = new Set<string>();
  const artists = new Map<string, number>();
  const albums = new Map<string, number>();

  for (const item of scored) {
    if (selected.length >= limit) break;
    const c = item.candidate;
    if (!c.videoId || seenVideos.has(c.videoId)) continue;
    // one recording per canonical song (highest-scored wins — input is ranked)
    const songId = canonicalSongId(c.title, c.artist);
    if (songId && seenSongs.has(songId)) continue;
    const artist = firstArtist(c.artist);
    const album = normalizeText(c.album || '');
    if ((artists.get(artist) || 0) >= artistCap) continue;
    if (album && (albums.get(album) || 0) >= albumCap) continue;
    // penalize (not forbid) long same-artist runs so strong affinity survives
    let score = item.score;
    if (artist) {
      let run = 0;
      for (let i = selected.length - 1; i >= 0; i--) {
        if (firstArtist(selected[i].candidate.artist) === artist) run++;
        else break;
      }
      if (run >= maxRun) score *= 1 - runPenalty;
    }
    seenVideos.add(c.videoId);
    if (songId) seenSongs.add(songId);
    if (artist) artists.set(artist, (artists.get(artist) || 0) + 1);
    if (album) albums.set(album, (albums.get(album) || 0) + 1);
    selected.push({ ...item, score });
  }
  selected.sort((a, b) => b.score - a.score);
  return selected.slice(0, limit);
}
