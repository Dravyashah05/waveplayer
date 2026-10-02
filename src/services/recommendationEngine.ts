import { Track } from '../types';
import { getSaavnSongRadio, getSaavnBrowseModules, searchSaavnSongs } from './saavnApi';
import { getProfile, tasteScore } from './userProfile';
import { getSkipCount, hasRecentPlay, getEventsForSong, skipPenalty, getListeningEvents } from './listeningStore';
import { cleanTitle, detectVersion, normalizeText } from './recommendation/metadataNormalizer';
import { matchSongs } from './recommendation/songMatcher';
import { diversify } from './recommendation/diversity';
import { CACHE_TTL as CENTRAL_TTL } from './cacheConfig';

export interface ScoredTrack extends Track { _score: number; _reasons: string[] }

const WEIGHTS = { taste: 0.35, similarity: 0.25, collaborative: 0.20, popularity: 0.10, discovery: 0.10 };
const PENALTIES = { recentPlay: 0.45 };
const SESSION_GAP_MS = 45 * 60 * 1000;

let memCache = new Map<string, { at: number; tracks: Track[] }>();
// Central policy: browse modules are public trending data (shared keys OK).
const CACHE_TTL = CENTRAL_TTL.publicStaticMs;
let browseCache: { at: number; value: Awaited<ReturnType<typeof getSaavnBrowseModules>> } | null = null;

async function getCachedBrowse() {
  if (browseCache && Date.now() - browseCache.at < CACHE_TTL) return browseCache.value;
  const value = await getSaavnBrowseModules().catch(() => ({ trending: [] as Track[], topPlaylists: [], newAlbums: [], charts: [] }));
  browseCache = { at: Date.now(), value };
  return value;
}

// Words that carry no musical meaning for matching/dedup
const STOPWORDS = new Set([
  'feat', 'ft', 'from', 'with', 'and', 'the', 'official', 'video', 'audio',
  'original', 'lyrics', 'hq', 'ost', 'motion', 'picture', 'soundtrack',
]);
// Version markers stripped with WORD boundaries (so "Alive"/"Delivered" survive)
const VERSION_MARKERS = /\b(remix|remixes|remaster|remastered|live|unplugged|acoustic|lofi|slowed|reverb|sped\s*up|nightcore|8d|bass\s*boosted|cover|version|extended|radio\s*edit|club\s*mix)\b/gi;

/** Meaningful content words of a title: parens dropped, stopwords dropped. */
export function contentWords(s: string): string[] {
  return normalizeText(cleanTitle(s))
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Order-insensitive title key with version markers removed. */
export function normalizeTitle(s: string): string {
  const title = contentWords(s).sort().join(' ');
  return title ? `${title}|${detectVersion(s)}` : '';
}

function artistSet(s: string): string[] {
  return (s || '').toLowerCase().split(/[,&]+/).map((a) => a.trim()).filter((a) => a.length > 1);
}

/**
 * Order-preserving dedup. Keeps the FIRST occurrence, so feed it best-first
 * (post-score) and the highest-scored version wins — not pool order.
 */
export function dedupTracks(tracks: Track[], limitPerArtist = 2): Track[] {
  const seenTitle = new Set<string>();
  const artistCount = new Map<string, number>();
  const seenId = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    if (!t.id || seenId.has(t.id)) continue;
    const nt = normalizeTitle(t.title);
    if (nt && seenTitle.has(nt)) continue;
    if (out.some((previous) => matchSongs(previous, t).isMatch)) continue;
    const artist = artistSet(t.author)[0] || '';
    const ac = artistCount.get(artist) || 0;
    if (ac >= limitPerArtist) continue;
    seenId.add(t.id);
    if (nt) seenTitle.add(nt);
    artistCount.set(artist, ac + 1);
    out.push(t);
  }
  return out;
}

/** Popularity: real playCount wins; otherwise chart rank (top trending ≈ 1). */
function popularityScore(t: Track, rank = -1, poolSize = 0): number {
    const pc = t.playCount || 0;
  if (pc > 5_000_000) return 1;
  if (pc > 1_000_000) return 0.85;
  if (pc > 200_000) return 0.7;
  if (pc > 0) return 0.55;
  if (rank >= 0 && poolSize > 0) return Math.round((1 - (rank / poolSize) * 0.5) * 100) / 100;
  return 0.45;
}

export function similarityScore(candidate: Track, seed: Track | null): number {
  if (!seed) return 0.4;
  let s = 0;
  if (candidate.language && seed.language &&
      candidate.language.toLowerCase() === seed.language.toLowerCase()) s += 0.35;
  const ca = artistSet(candidate.author);
  const sa = artistSet(seed.author);
  if (ca.length && sa.length) {
    if (ca.some((a) => sa.includes(a))) s += 0.5;
    else if (ca.some((a) => sa.some((b) => (a.length > 3 && b.includes(a)) || (b.length > 3 && a.includes(b))))) s += 0.3;
  }
  if (candidate.albumId && seed.albumId && candidate.albumId === seed.albumId) s += 0.25;
  const cw = contentWords(candidate.title);
  const sw = new Set(contentWords(seed.title));
  const overlap = cw.filter((w) => sw.has(w)).length;
  s += Math.min(0.2, overlap * 0.07);
  return Math.min(1, s);
}

/** Best match across seeds (most-recent seed weighs most). */
function multiSimilarity(t: Track, seeds: { track: Track; weight: number }[]): number {
  if (!seeds.length) return 0.4;
  let best = 0;
  for (const s of seeds) best = Math.max(best, similarityScore(t, s.track) * s.weight);
  return Math.min(1, best);
}

// ——— Real collaborative signal: session co-occurrence from listening events ———
function coPlayCounts(seedId: string): Map<string, number> {
  const counts = new Map<string, number>();
  const evs = getListeningEvents(500).filter(
    (e) => e.event === 'play' || e.event === 'complete' || e.event === 'replay'
  );
  const chrono = [...evs].reverse(); // oldest → newest
  let session: { id: string; at: number }[] = [];
  const flush = () => {
    if (session.some((s) => s.id === seedId)) {
      for (const s of session) {
        if (s.id !== seedId) counts.set(s.id, (counts.get(s.id) || 0) + 1);
      }
    }
    session = [];
  };
  for (const e of chrono) {
    const at = new Date(e.timestamp).getTime();
    if (Number.isNaN(at)) continue;
    const last = session[session.length - 1];
    if (last && at - last.at > SESSION_GAP_MS) flush();
    if (!session.some((s) => s.id === e.songId)) session.push({ id: e.songId, at });
  }
  flush();
  return counts;
}

/**
 * Session co-play affinity 0..1, or null when there is no data (caller falls
 * back to the taste/similarity approximation instead of a fake signal).
 */
export function collaborativeScore(candidateId: string, seedId: string | null): number | null {
  if (!seedId) return null;
  const co = coPlayCounts(seedId);
  if (!co.size) return null;
  let max = 0;
  co.forEach((v) => { if (v > max) max = v; });
  return (co.get(candidateId) || 0) / max;
}

export async function getSimilarTracks(seedId: string, limit = 12): Promise<Track[]> {
  const key = `similar:${seedId}`;
  const cached = memCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.tracks.slice(0, limit);
  // Persistent cache (survives reload) — written below on fetch
  try {
    const raw = localStorage.getItem(`wave:cache:${key}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { at: number; tracks: Track[] };
      if (parsed && Array.isArray(parsed.tracks) && parsed.tracks.length &&
          Date.now() - parsed.at < CACHE_TTL) {
        memCache.set(key, { at: parsed.at, tracks: parsed.tracks });
        return parsed.tracks.slice(0, limit);
      }
    }
  } catch {}
  const tracks = await getSaavnSongRadio(seedId).catch(() => [] as Track[]);
  const deduped = dedupTracks(tracks, 3).slice(0, limit);
  memCache.set(key, { at: Date.now(), tracks: deduped });
  try { localStorage.setItem(`wave:cache:${key}`, JSON.stringify({ at: Date.now(), tracks: deduped.slice(0, 8) })); } catch {}
  return deduped;
}

export async function getDiscoverTracks(profile: ReturnType<typeof getProfile>, excludeIds: Set<string>, limit = 8): Promise<Track[]> {
  const favLang = profile.favoriteLanguage || 'hindi';
  const favArtist = profile.favoriteArtist || '';
  // fetch trending then filter to not in exclude and not top artist heavily
  const browse = await getCachedBrowse();
  let pool = browse.trending.filter(t => !excludeIds.has(t.id));
  // inject one new artist via search
  if (favArtist) {
    const related = await searchSaavnSongs(`${favArtist} new`, 1, 6).then(r => r.tracks.filter(t => !excludeIds.has(t.id))).catch(() => [] as Track[]);
    pool = [...related.slice(0, 2), ...pool];
  }
  // language diversity
  const langFiltered = pool.filter(t => (t.language || '').toLowerCase() !== favLang.toLowerCase()).slice(0, 3);
  const combined = [...langFiltered, ...pool].slice(0, limit * 2);
  return dedupTracks(combined, 2).slice(0, limit);
}

export interface RecommendOptions {
  seedTrack?: Track | null;
  /** Preferred: up to 3 seeds, most-recent first (blended by recency). */
  seedTracks?: Track[];
  excludeIds?: Set<string>;
  limit?: number;
  weights?: Partial<typeof WEIGHTS>;
}

export async function recommendTracks(opts: RecommendOptions = {}): Promise<ScoredTrack[]> {
  const profile = getProfile();
  const rawSeeds = (opts.seedTracks?.length ? opts.seedTracks : opts.seedTrack ? [opts.seedTrack] : [])
    .filter((t): t is Track => !!t && !!t.id);
  // unique by id, keep order
  const seen = new Set<string>();
  const seeds = rawSeeds.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))).slice(0, 3)
    .map((track, i) => ({ track, weight: [1, 0.65, 0.45][i] ?? 0.3 }));
  const seed = seeds[0]?.track || null;
  const limit = opts.limit || 12;
  const w = { ...WEIGHTS, ...(opts.weights || {}) };
  const exclude = new Set(opts.excludeIds || []);
  seeds.forEach((s) => exclude.add(s.track.id));
  // pools — radio for the top two seeds, discovery, and full trending (rank kept)
  const [simA, simB, discoverPool, browse] = await Promise.all([
    seeds[0] ? getSimilarTracks(seeds[0].track.id, 16).catch(() => [] as Track[]) : Promise.resolve([] as Track[]),
    seeds[1] ? getSimilarTracks(seeds[1].track.id, 10).catch(() => [] as Track[]) : Promise.resolve([] as Track[]),
    getDiscoverTracks(profile, exclude, 6).catch(() => [] as Track[]),
    getCachedBrowse(),
  ]);
  const trending = browse.trending.filter((t) => t && t.id && !exclude.has(t.id));
  const rankOf = new Map<string, number>();
  trending.forEach((t, i) => { if (!rankOf.has(t.id)) rankOf.set(t.id, i); });

  let candidates: Track[] = [];
  candidates.push(...simA, ...simB);
  candidates.push(...trending.slice(0, 12));
  candidates.push(...discoverPool);

  // if cold start (no profile plays)
  if (profile.totalPlays < 5) {
    candidates = [...trending.slice(0, 14), ...discoverPool.slice(0, 4)];
  }

  // drop excluded + id-dedup, keep pool order for now (final dedup happens post-score)
  const idSeen = new Set<string>();
  candidates = candidates.filter((t) => {
    if (!t || !t.id || exclude.has(t.id) || idSeen.has(t.id)) return false;
    idSeen.add(t.id);
    return true;
  });
  // ensure we have at least limit
  if (candidates.length < limit) {
    for (const t of trending) {
      if (candidates.length >= limit) break;
      if (!idSeen.has(t.id)) { idSeen.add(t.id); candidates.push(t); }
    }
  }

  // real session co-occurrence for the primary seed (null → approximation below)
  const coMap = seed ? coPlayCounts(seed.id) : new Map<string, number>();
  let coMax = 0;
  coMap.forEach((v) => { if (v > coMax) coMax = v; });

  // score each
  const scored: ScoredTrack[] = candidates.slice(0, 48).map(t => {
    const taste = tasteScore(t, profile);
    const sim = multiSimilarity(t, seeds);
    const collab = coMax > 0 ? (coMap.get(t.id) || 0) / coMax : taste * 0.7 + sim * 0.3;
    const pop = popularityScore(t, rankOf.has(t.id) ? rankOf.get(t.id)! : -1, trending.length);
    const primaryArtist = artistSet(t.author)[0] || '';
    const isDiscovered = !primaryArtist || !profile.artists[primaryArtist] ? 1 : 0;
    const disc = isDiscovered ? 0.7 : 0.3;

    let base = taste * w.taste + sim * w.similarity + collab * w.collaborative + pop * w.popularity + disc * w.discovery;

    const reasons: string[] = [];
    if (taste > 0.6) reasons.push('Matches your taste');
    if (sim > 0.5) reasons.push(`Similar to ${seed?.title.slice(0, 18) || 'your play'}`);
    if (isDiscovered) reasons.push('Discover');

    // penalties — graded by HOW the user rejected the track, not just counts
    if (hasRecentPlay(t.id, 12)) base *= (1 - PENALTIES.recentPlay);
    const skipEvs = getEventsForSong(t.id).filter((e) => e.event === 'skip');
    if (skipEvs.length) {
      const last = skipEvs[0];
      const depth = skipPenalty(last.playedSeconds || 0, last.duration || 0); // 0..1
      const strength = 0.2 + 0.6 * depth; // instant skip ≈ 0.8x per occurrence
      base *= Math.pow(1 - strength, Math.min(skipEvs.length, 3));
      if (depth >= 0.6) {
        const ageH = (Date.now() - new Date(last.timestamp).getTime()) / 3_600_000;
        if (ageH < 24) base *= 0.5; // bounced off it today → bury it
      }
    } else {
      const skips = getSkipCount(t.id);
      if (skips > 0) base *= Math.pow(0.8, Math.min(skips, 3));
    }

    return { ...t, _score: Math.max(0, Math.min(1, base)), _reasons: reasons };
  });

  // sort by score…
  scored.sort((a, b) => b._score - a._score);
  // …then dedup best-first (highest-scored version wins) with artist spread
  return diversify(scored, limit, 2, 2);
}

// Cold start helper
export async function getColdStartTracks(limit = 12): Promise<Track[]> {
  const browse = await getCachedBrowse();
  return dedupTracks([...browse.trending, ...browse.charts.flatMap((c) => c.tracks || [])], 2).slice(0, limit);
}

// Up Next for queue — blends the current track with the upcoming tail so
// suggestions bridge toward what's already queued, not just what played.
export async function getUpNext(
  seed: Track | null,
  queueIds: Set<string>,
  limit = 10,
  tailSeeds: Track[] = []
): Promise<ScoredTrack[]> {
  const seeds = [seed, ...tailSeeds].filter((t): t is Track => !!t && !!t.id);
  return recommendTracks({ seedTracks: seeds.slice(0, 3), excludeIds: queueIds, limit });
}
