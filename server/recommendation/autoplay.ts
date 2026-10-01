// Autoplay + radio builders. Pure queue-extension logic: they return ordered
// candidates, and callers append them to the playerStore queue. No playback
// code lives here.

import type { Candidate, ResolvedTrack, ScoredCandidate, TasteHints } from './types.js';
import type { YTMusicLike } from './candidates.js';
import { artistCandidates, resolveSeed, searchCandidates, trendingCandidates, upnextCandidates } from './candidates.js';
import { rankCandidates } from './ranker.js';
import { diversify } from './diversity.js';
import { recordingId } from './similarity.js';

export interface BuildOptions {
  taste?: Partial<TasteHints>;
  excludeIds?: string[];
  recentIds?: string[];
  skippedIds?: string[];
  limit?: number;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function toResolvedTrack(c: Candidate): ResolvedTrack {
  const dur = Number(c.duration || 0);
  return {
    id: c.videoId,
    title: c.title,
    author: c.artist || 'YouTube',
    thumbnail: c.thumbnails || `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`,
    duration: fmtDuration(dur),
    durationSeconds: dur,
    url: `https://www.youtube.com/watch?v=${c.videoId}`,
    source: 'ytmusic',
    type: 'SONG',
    albumName: c.album,
    year: c.year ?? null,
    language: c.language,
    isrc: c.isrc,
  };
}

function mergeUnique(lists: Candidate[][], exclude: Set<string>): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const list of lists) {
    for (const c of list) {
      if (!c?.videoId || exclude.has(c.videoId) || seen.has(c.videoId)) continue;
      seen.add(c.videoId);
      out.push(c);
    }
  }
  return out;
}

function tasteOf(opts: BuildOptions): TasteHints {
  return {
    artists: opts.taste?.artists || [],
    languages: opts.taste?.languages || [],
    excludeIds: opts.excludeIds || [],
  };
}

/**
 * autoplay(seedVideoId): up-next relations blended with same-artist tracks,
 * ranked by taste + relation, diversified. Returns 5–10 resolved tracks,
 * never the seed itself.
 */
export async function buildAutoplay(
  yt: YTMusicLike,
  seedVideoId: string,
  opts: BuildOptions = {},
): Promise<{ seed: string; tracks: ResolvedTrack[]; reasons: string[][] }> {
  const limit = Math.max(5, Math.min(10, opts.limit ?? 8));
  const seed = await resolveSeed(yt, seedVideoId);
  if (!seed) return { seed: seedVideoId, tracks: [], reasons: [] };
  const exclude = new Set([seed.videoId, ...(opts.excludeIds || [])]);
  const [upnext, artist] = await Promise.all([
    upnextCandidates(yt, seed.videoId, 25),
    artistCandidates(yt, seed, 15),
  ]);
  const pool = mergeUnique([upnext, artist], exclude);
  const ranked = rankCandidates(pool, {
    seed,
    taste: tasteOf(opts),
    recentIds: new Set(opts.recentIds || []),
    skippedIds: new Set(opts.skippedIds || []),
  });
  // rank best-first, then diversify (highest-scored recording wins per song)
  ranked.sort((a, b) => b.score - a.score);
  const picked = diversify(ranked, limit, { artistCap: 2, albumCap: 2 });
  return {
    seed: seed.videoId,
    tracks: picked.map((s) => toResolvedTrack(s.candidate)),
    reasons: picked.map((s) => s.reasons),
  };
}

/**
 * radio(seedVideoId): wider net than autoplay — same artist, similar artists
 * via text search, trending injection — for a long diverse queue.
 */
export async function buildRadio(
  yt: YTMusicLike,
  seedVideoId: string,
  opts: BuildOptions = {},
): Promise<{ seed: string; tracks: ResolvedTrack[]; reasons: string[][] }> {
  const limit = Math.max(10, Math.min(30, opts.limit ?? 20));
  const seed = await resolveSeed(yt, seedVideoId);
  if (!seed) return { seed: seedVideoId, tracks: [], reasons: [] };
  const exclude = new Set([seed.videoId, ...(opts.excludeIds || [])]);
  const [upnext, artist, similar, trending] = await Promise.all([
    upnextCandidates(yt, seed.videoId, 25),
    artistCandidates(yt, seed, 20),
    seed.artist ? searchCandidates(yt, `${seed.artist} mix`, 'search', 12) : Promise.resolve([] as Candidate[]),
    trendingCandidates(yt, 10),
  ]);
  const pool = mergeUnique([upnext, artist, similar, trending], exclude);
  const ranked = rankCandidates(pool, {
    seed,
    taste: tasteOf(opts),
    weights: { discovery: 0.12, popularity: 0.07 },
    recentIds: new Set(opts.recentIds || []),
    skippedIds: new Set(opts.skippedIds || []),
  });
  ranked.sort((a, b) => b.score - a.score);
  const picked = diversify(ranked, limit, { artistCap: 3, albumCap: 2 });
  return {
    seed: seed.videoId,
    tracks: picked.map((s) => toResolvedTrack(s.candidate)),
    reasons: picked.map((s) => s.reasons),
  };
}

/** similar(seedVideoId): tight relation set, 10–30 ranked candidates. */
export async function buildSimilar(
  yt: YTMusicLike,
  seedVideoId: string,
  opts: BuildOptions = {},
): Promise<{ seed: string; tracks: ResolvedTrack[]; reasons: string[][] }> {
  const limit = Math.max(10, Math.min(30, opts.limit ?? 20));
  const seed = await resolveSeed(yt, seedVideoId);
  if (!seed) return { seed: seedVideoId, tracks: [], reasons: [] };
  const exclude = new Set([seed.videoId, ...(opts.excludeIds || [])]);
  const [upnext, artist] = await Promise.all([
    upnextCandidates(yt, seed.videoId, 25),
    artistCandidates(yt, seed, 20),
  ]);
  const pool = mergeUnique([upnext, artist], exclude);
  const ranked = rankCandidates(pool, {
    seed,
    taste: tasteOf(opts),
    weights: { content: 0.3, artist: 0.2, ytRelation: 0.2 },
    recentIds: new Set(opts.recentIds || []),
    skippedIds: new Set(opts.skippedIds || []),
  });
  ranked.sort((a, b) => b.score - a.score);
  const picked = diversify(ranked, limit, { artistCap: 3, albumCap: 3 });
  return {
    seed: seed.videoId,
    tracks: picked.map((s) => toResolvedTrack(s.candidate)),
    reasons: picked.map((s) => s.reasons),
  };
}

export { recordingId };
export type { ScoredCandidate };
