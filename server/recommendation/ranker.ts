// Transparent, configurable scoring. Every weight is overridable per call;
// every scored candidate carries human-readable reasons.

import type {
  Candidate,
  RankPenalties,
  RankWeights,
  ScoredCandidate,
  TasteHints,
} from './types.js';
import { DEFAULT_PENALTIES, DEFAULT_WEIGHTS } from './types.js';
import type { SeedInfo } from './candidates.js';
import { fieldMatch, firstArtist, normalizeText } from './similarity.js';

export type { RankWeights, RankPenalties };

export interface RankContext {
  seed: SeedInfo | null;
  taste: TasteHints;
  weights?: Partial<RankWeights>;
  penalties?: Partial<RankPenalties>;
  recentIds?: Set<string>;
  skippedIds?: Set<string>;
}

const RELATION_BOOST: Record<string, number> = {
  upnext: 1,
  artist: 0.85,
  'artist-search': 0.7,
  search: 0.55,
  trending: 0.5,
  home: 0.45,
};

function popularityOf(c: Candidate): number {
  if (c.sourceRank !== undefined && c.sourceRank >= 0) {
    return Math.max(0.3, 1 - (c.sourceRank / 25) * 0.5);
  }
  return 0.45;
}

export function rankCandidates(candidates: Candidate[], ctx: RankContext): ScoredCandidate[] {
  const w: RankWeights = { ...DEFAULT_WEIGHTS, ...(ctx.weights || {}) };
  const p: RankPenalties = { ...DEFAULT_PENALTIES, ...(ctx.penalties || {}) };
  const seed = ctx.seed;
  const seedProbe: Candidate | null = seed
    ? { videoId: seed.videoId, title: seed.title, artist: seed.artist, language: seed.language, relation: 'seed' }
    : null;
  const tasteArtists = new Set(ctx.taste.artists.map((a) => normalizeText(a)));
  const tasteLangs = new Set(ctx.taste.languages.map((l) => l.toLowerCase()));

  return candidates.map((c) => {
    const reasons: string[] = [];
    const artist = firstArtist(c.artist);

    // content similarity vs seed (multi-field, never title-only)
    let content = 0;
    if (seedProbe) {
      const m = fieldMatch(c, seedProbe);
      content = m.score;
      if (m.score >= 0.5) reasons.push('Similar to seed');
    } else {
      content = 0.4;
    }

    // taste: favourite artists/languages supplied by the client profile
    let taste = 0;
    if (artist && tasteArtists.has(artist)) {
      taste = 0.9;
      reasons.push('Favourite artist');
    } else if (artist && [...tasteArtists].some((t) => (t.length > 3 && artist.includes(t)) || (artist.length > 3 && t.includes(artist)))) {
      taste = 0.5;
      reasons.push('Related artist');
    } else {
      taste = 0.3;
    }

    // artist affinity: same artist as the seed scores highest
    let artistScore = 0;
    if (seed && artist && firstArtist(seed.artist) && artist === firstArtist(seed.artist)) {
      artistScore = 1;
      reasons.push('Same artist');
    } else if (taste >= 0.9) {
      artistScore = 0.8;
    } else if (taste >= 0.5) {
      artistScore = 0.5;
    } else {
      artistScore = 0.3;
    }

    // YouTube Music relation strength
    const ytRelation = RELATION_BOOST[c.relation] ?? 0.4;
    if (c.relation === 'upnext') reasons.push('YouTube Music related');

    // genre: approximated from title/relation keywords when present
    const genre = 0.4;

    // language similarity
    let language = 0.4;
    if (seed?.language && c.language && seed.language.toLowerCase() === c.language.toLowerCase()) {
      language = 1;
      reasons.push('Same language');
    } else if (c.language && tasteLangs.has(c.language.toLowerCase())) {
      language = 0.8;
      reasons.push('Preferred language');
    }

    const popularity = popularityOf(c);
    if (popularity >= 0.85) reasons.push('Popular');
    const freshness = c.year && c.year >= new Date().getFullYear() - 1 ? 0.9 : 0.5;
    const discovery = tasteArtists.size && artist && !tasteArtists.has(artist) ? 0.8 : 0.35;
    if (discovery >= 0.8) reasons.push('Discover');

    let score =
      content * w.content +
      taste * w.taste +
      artistScore * w.artist +
      ytRelation * w.ytRelation +
      genre * w.genre +
      language * w.language +
      popularity * w.popularity +
      freshness * w.freshness +
      discovery * w.discovery;

    // penalties (graded, multiplicative)
    if (ctx.recentIds?.has(c.videoId)) {
      score *= 1 - p.recentPlay;
      reasons.push('Recently played');
    }
    if (ctx.skippedIds?.has(c.videoId)) {
      score *= 1 - p.skip;
      reasons.push('Skipped before');
    }

    return { candidate: c, score: Math.max(0, Math.min(1, score)), reasons };
  });
}
