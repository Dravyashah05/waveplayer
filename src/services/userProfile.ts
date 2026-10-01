import { Track } from '../types';
import { getEventsForSong, skipPenalty } from './listeningStore';

const LS_PROFILE = 'wave:user_profile';
const LS_HISTORY = 'wave:history';
const LS_FAV = 'wave:fav';
const LS_RECENT = 'wave:recently_played';

export interface UserProfile {
  artists: Record<string, number>;   // 0-1
  languages: Record<string, number>;
  genres: Record<string, number>;    // derived from language + author heuristics
  moods: Record<string, number>;
  favoriteArtist?: string;
  favoriteLanguage?: string;
  updatedAt: string;
  totalPlays: number;
}

const GENRE_MAP: Record<string, string[]> = {
  Bollywood: ['hindi', 'bollywood'],
  Punjabi: ['punjabi'],
  English: ['english'],
  Tamil: ['tamil'],
  Telugu: ['telugu'],
  Romantic: ['romantic', 'love', 'lofi'],
  Workout: ['workout', 'party', 'dance'],
  Chill: ['chill', 'lofi', 'acoustic'],
};

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadJSON<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}

function inferGenre(track: Track): string[] {
  const out: string[] = [];
  const lang = (track.language || '').toLowerCase();
  const title = (track.title || '').toLowerCase();
  const author = (track.author || '').toLowerCase();
  for (const [genre, keys] of Object.entries(GENRE_MAP)) {
    if (keys.some(key => lang.includes(key) || title.includes(key) || author.includes(key))) out.push(genre);
  }
  if (track.language) out.push(track.language);
  if (!out.length) out.push('Pop');
  return out;
}

function scoreMap(items: string[], weights: number[]): Record<string, number> {
  const counts: Record<string, number> = {};
  items.forEach((k, i) => {
    const key = normalizeKey(k);
    if (!key) return;
    counts[key] = (counts[key] || 0) + (weights[i] ?? 1);
  });
  const max = Math.max(...Object.values(counts), 1);
  const norm: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) norm[k] = Math.round((v / max) * 100) / 100;
  return norm;
}

/**
 * Per-track engagement from real listening behavior.
 * Completions, replays and likes push affinity up; early skips wipe it out.
 * Time-decayed so taste follows what you enjoy *now*, not months ago.
 */
export function engagement(trackId: string): number {
  const evs = getEventsForSong(trackId).slice(0, 12);
  if (!evs.length) return 0;
  const now = Date.now();
  let s = 0;
  for (const e of evs) {
    const ageDays = Math.max(0, (now - new Date(e.timestamp).getTime()) / 86_400_000);
    const decay = Math.exp(-ageDays / 21); // ~3-week half-life
    switch (e.event) {
      case 'like': s += 2 * decay; break;
      case 'unlike': s -= 2 * decay; break;
      case 'replay': s += 1.2 * decay; break;
      case '10_percent': s += 0.04 * decay; break;
      case '25_percent': s += 0.08 * decay; break;
      case '50_percent': s += 0.12 * decay; break;
      case '75_percent': s += 0.2 * decay; break;
      case 'complete': s += (0.6 + 0.6 * Math.min(1, e.completionPercentage / 100)) * decay; break;
      case 'play': s += 0.25 * decay; break;
      case 'skip': s -= (0.4 + 1.2 * skipPenalty(e.playedSeconds || 0, e.duration || 0)) * decay; break;
      default: break;
    }
  }
  return s;
}

const clampW = (v: number) => Math.max(0, Math.min(4, v));

export function buildProfile(): UserProfile {
  const history = loadJSON<Track[]>(LS_HISTORY, []);
  const favs = loadJSON<Track[]>(LS_FAV, []);
  const recent = loadJSON<Track[]>(LS_RECENT, history);

  // weight = source base × recency decay + engagement (completions/replays/likes
  // raise it, early skips sink it). A 5-second skip no longer counts as taste.
  const artists: string[] = [];
  const artistWeights: number[] = [];
  const langs: string[] = [];
  const langWeights: number[] = [];
  const genres: string[] = [];
  const genreWeights: number[] = [];

  const pushTrack = (t: Track, w: number) => {
    // artist: first primary
    const primary = t.author?.split(',')[0]?.trim() || t.author || 'Various';
    artists.push(primary); artistWeights.push(w);
    const lang = (t.language || '').trim();
    if (lang) { langs.push(lang); langWeights.push(w); } // unknown language stays neutral
    const gs = inferGenre(t);
    gs.forEach(g => { genres.push(g); genreWeights.push(w * 0.7); });
  };

  favs.forEach(t => pushTrack(t, clampW(1.2 + engagement(t.id))));
  recent.slice(0, 20).forEach((t, i) => pushTrack(t, clampW(0.7 * Math.pow(0.96, i) + engagement(t.id))));
  history.slice(0, 40).forEach((t, i) => pushTrack(t, clampW(0.4 * Math.pow(0.97, i) + engagement(t.id))));

  const artistScores = scoreMap(artists, artistWeights);
  const langScores = scoreMap(langs, langWeights);
  const genreScores = scoreMap(genres, genreWeights);

  const topArtist = Object.entries(artistScores).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topLang = Object.entries(langScores).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    artists: artistScores,
    languages: langScores,
    genres: genreScores,
    moods: {},
    favoriteArtist: topArtist,
    favoriteLanguage: topLang,
    updatedAt: new Date().toISOString(),
    totalPlays: history.length + favs.length,
  };
}

let cached: UserProfile | null = null;
let cacheAt = 0;

export function getProfile(): UserProfile {
  // cache 2min
  if (cached && Date.now() - cacheAt < 120_000) return cached;
  // try stored
  const stored = loadJSON<UserProfile | null>(LS_PROFILE, null);
  const fresh = buildProfile();
  // if stored is older than 5min, replace
  if (!stored || Date.now() - new Date(stored.updatedAt).getTime() > 300_000) {
    cached = fresh;
    cacheAt = Date.now();
    try { localStorage.setItem(LS_PROFILE, JSON.stringify(fresh)); } catch {}
    return fresh;
  }
  // merge recent changes quickly without full recompute: prefer fresh if totalPlays diff
  if (fresh.totalPlays !== stored.totalPlays) {
    cached = fresh;
    cacheAt = Date.now();
    try { localStorage.setItem(LS_PROFILE, JSON.stringify(fresh)); } catch {}
    return fresh;
  }
  cached = stored;
  cacheAt = Date.now();
  return stored;
}

export function refreshProfile() {
  cached = null;
  cacheAt = 0;
  const p = buildProfile();
  try { localStorage.setItem(LS_PROFILE, JSON.stringify(p)); } catch {}
  // notify
  try { window.dispatchEvent(new CustomEvent('wave:profile', { detail: p })); } catch {}
  return p;
}

// listen to listening events to auto-refresh debounced
if (typeof window !== 'undefined') {
  let t: number | null = null;
  window.addEventListener('wave:listening' as any, () => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => refreshProfile(), 1200);
  });
}

export function tasteScore(track: Track, profile: UserProfile): number {
  let score = 0;
  let w = 0;
  if (profile.artists) {
    const primary = normalizeKey(track.author?.split(',')[0] || track.author || '');
    const s = profile.artists[primary] || 0;
    score += s * 0.5; w += 0.5;
    // secondary artists small bonus
    track.author?.split(',').slice(1).forEach(a => {
      const s2 = profile.artists[normalizeKey(a)] || 0;
      score += s2 * 0.15; w += 0.15;
    });
  }
  if (profile.languages) {
    const raw = (track.language || '').trim();
    if (raw) {
      const s = profile.languages[normalizeKey(raw)] || 0;
      score += s * 0.3; w += 0.3;
    }
    // unknown language → neutral (no longer assumed Hindi)
  }
  if (profile.genres) {
    const gs = inferGenre(track);
    let gMax = 0;
    gs.forEach(g => { gMax = Math.max(gMax, profile.genres[normalizeKey(g)] || 0); });
    score += gMax * 0.25; w += 0.25;
  }
  if (w === 0) return 0.2;
  return Math.min(1, score / w);
}
