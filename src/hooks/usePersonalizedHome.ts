import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Album, Playlist, SearchArtist, Track } from '../types';
import { playerStore } from '../services/playerStore';
import {
  fetchDiscover,
  fetchForYou,
  fetchQuickPicks,
  fetchRecHome,
  type HomeSections,
} from '../services/recommendationApi';
import {
  getDiscoverTracks,
  getSimilarTracks,
  recommendTracks,
  type ScoredTrack,
} from '../services/recommendationEngine';
import { getSaavnBrowseModules, searchSaavnArtists } from '../services/saavnApi';
import { getProfile } from '../services/userProfile';
import { buildTasteProfile, type TasteProfile } from '../services/tasteProfile';
import { getListeningEvents, getRecentlyPlayed, type ListeningEvent } from '../services/listeningStore';
import { getCachedYTMusicHistory } from '../services/historyMerge';
import { googleAccountStore } from '../hooks/useGoogleAccount';
import { scopeKey } from '../services/scopedStorage';

/**
 * Personalized Home data layer.
 *
 * Consumes only existing endpoints (GET /api/recommendations/*, Saavn
 * browse, local engine) — never ytmusicapi directly. Each section loads
 * independently: one failed source hides its section, never the page.
 *
 * Caching: last good payload is served instantly (per-user scope, 10-min
 * TTL) and refreshed in the background. Background refreshes are throttled
 * (≥4 min) so navigating back never reshuffles the UI, and play/pause
 * events never trigger refetches. Manual refresh, like/unlike bursts (via
 * the debounced wave:profile signal, still throttled) and account changes
 * invalidate.
 */

export type SectionStatus = 'loading' | 'ready' | 'error';

export interface PersonalizedMix {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  gradient: string;
  badge: string;
  tracks: Track[];
  coverThumb?: string;
}

export interface BecauseSection {
  artist: string;
  seedTrack: Track;
  tracks: Track[];
  reason: string;
}

export interface ContinueItem {
  track: Track;
  positionSeconds: number;
  completionFraction: number;
}

export interface HomeData {
  quickPicks: Track[];
  madeForYou: ScoredTrack[];
  continueListening: ContinueItem[];
  becauseSections: BecauseSection[];
  mixes: PersonalizedMix[];
  discover: Track[];
  basedOnLibrary: { tracks: Track[]; explanation: string };
  trendingForYou: { tracks: Track[]; label: string };
  recentHistory: Track[];
  albums: Album[];
  artists: SearchArtist[];
  playlists: Playlist[];
  taste: TasteProfile;
  coldStart: boolean;
}

export interface HomeSectionStatus {
  quickPicks: SectionStatus;
  madeForYou: SectionStatus;
  continueListening: SectionStatus;
  because: SectionStatus;
  mixes: SectionStatus;
  discover: SectionStatus;
  basedOnLibrary: SectionStatus;
  trendingForYou: SectionStatus;
  recent: SectionStatus;
  albums: SectionStatus;
  artists: SectionStatus;
  playlists: SectionStatus;
}

import { CACHE_TTL } from '../services/cacheConfig';

const CACHE_BASE = 'home_cache_v1';
// Central policy: personalized home payload (user-scoped, background refresh throttled).
const CACHE_TTL_MS = CACHE_TTL.homeMs;
const BG_MIN_INTERVAL_MS = 4 * 60 * 1000;

const FALLBACK_HITS: Track[] = [
  {
    id: 'BddP6PYo2gs',
    title: 'Kesariya (From "Brahmastra")',
    author: 'Arijit Singh, Pritam, Amitabh Bhattacharya',
    thumbnail: 'https://i.ytimg.com/vi/BddP6PYo2gs/hqdefault.jpg',
    duration: '4:28',
    durationSeconds: 268,
    url: 'https://www.youtube.com/watch?v=BddP6PYo2gs',
    albumName: 'Brahmastra',
    type: 'SONG',
  },
  {
    id: '4NRXx6U8ABQ',
    title: 'Blinding Lights',
    author: 'The Weeknd',
    thumbnail: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg',
    duration: '3:20',
    durationSeconds: 200,
    url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
    albumName: 'After Hours',
    type: 'SONG',
  },
  {
    id: 'V1Pl8CzNzCw',
    title: 'Chaleya (From "Jawan")',
    author: 'Arijit Singh, Shilpa Rao, Anirudh Ravichander',
    thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/hqdefault.jpg',
    duration: '3:20',
    durationSeconds: 200,
    url: 'https://www.youtube.com/watch?v=V1Pl8CzNzCw',
    albumName: 'Jawan',
    type: 'SONG',
  },
];

function scopeOf(): string {
  try {
    const s = googleAccountStore.get();
    if (s?.connected && s.user?.id) return s.user.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  } catch {}
  return 'local';
}

interface CachePayload {
  scope: string;
  at: number;
  data: HomeData;
}

export const HOME_CACHE_TTL_MS = CACHE_TTL_MS;

function readCache(): HomeData | null {
  try {
    const raw = localStorage.getItem(scopeKey(CACHE_BASE));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed || parsed.scope !== scopeOf()) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    if (!parsed.data || !Array.isArray(parsed.data.quickPicks)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: HomeData): void {
  try {
    const payload: CachePayload = { scope: scopeOf(), at: Date.now(), data };
    localStorage.setItem(scopeKey(CACHE_BASE), JSON.stringify(payload));
  } catch {}
}

export function readHomeCache(): HomeData | null {
  return readCache();
}

export function writeHomeCache(data: HomeData): void {
  writeCache(data);
}

/** Cold start: no real evidence → neutral labels, no fake personalization. */
export function isColdStart(taste: TasteProfile, favCount: number, historyCount: number): boolean {
  if (favCount >= 3 || historyCount >= 5) return false;
  return taste.totalEvents < 5 && taste.frequentlyPlayed.length === 0;
}

function dedupTracks<T extends Track>(tracks: T[], limit = 0): T[] {
  const seen = new Set<string>();
  const out = tracks.filter((t) => {
    if (!t?.id || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * Continue Listening: meaningfully started (10–90% complete) but not
 * finished. Newest decisive event per song wins; a later fresh play or a
 * completion supersedes older partial progress. Bounded to 10.
 */
export function selectContinueListening(events: ListeningEvent[], limit = 10): ContinueItem[] {
  const decided = new Set<string>();
  const out: ContinueItem[] = [];
  for (const e of events) {
    if (out.length >= limit) break;
    if (!e?.songId || decided.has(e.songId) || !e.track?.id) continue;
    const duration = e.duration > 0 ? e.duration : e.track.durationSeconds || 0;
    if (!(duration > 0)) continue;
    if (e.event === 'complete' || (e.event === 'play' && (e.playedSeconds || 0) <= 1)) {
      decided.add(e.songId); // finished or freshly restarted — nothing to resume
      continue;
    }
    if (e.event !== 'pause' && e.event !== 'seek' && e.event !== 'skip') continue;
    const frac = e.playedSeconds / duration;
    decided.add(e.songId);
    if (frac > 0.1 && frac < 0.9) {
      out.push({ track: e.track, positionSeconds: Math.floor(e.playedSeconds), completionFraction: frac });
    }
  }
  return out;
}

function primaryArtist(t: Track): string {
  return ((t.author || '').split(',')[0]?.trim() || t.author || '').toLowerCase();
}

/** Taste-filtered trending: popularity candidates ranked by real affinity. */
export function rankTrendingForYou(trending: Track[], taste: TasteProfile, limit = 12): Track[] {
  const scored = trending
    .filter((t) => t?.id)
    .map((t) => {
      const a = taste.artistAffinity[primaryArtist(t)] || 0;
      const lang = (t.language || '').trim().toLowerCase();
      const l = lang ? taste.languagePreference[lang] || 0 : 0;
      const score = a * 2 + l;
      return { t, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return dedupTracks(scored.map((s) => s.t), limit);
}

/** Library-grounded picks: top-affinity artists as they appear in the library. */
export function selectBasedOnLibrary(
  pool: Track[],
  taste: TasteProfile,
  limit = 12,
): { tracks: Track[]; explanation: string } {
  const topArtists = taste.favoriteArtists.slice(0, 3).map((a) => a.name);
  if (!topArtists.length || !pool.length) return { tracks: [], explanation: '' };
  const picked: Track[] = [];
  for (const name of topArtists) {
    for (const t of pool) {
      if (picked.length >= limit) break;
      if (primaryArtist(t).includes(name) && !picked.some((p) => p.id === t.id)) picked.push(t);
    }
  }
  if (!picked.length) return { tracks: [], explanation: '' };
  const display = topArtists[0].replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    tracks: picked.slice(0, limit),
    explanation: topArtists.length > 1 ? `Featuring ${display} and more from your library` : `More from ${display} in your library`,
  };
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

let inflight: Promise<HomeData | null> | null = null;

async function fetchHomeData(): Promise<HomeData> {
  const taste = buildTasteProfile();
  const hist = playerStore.historyList();
  const favs = playerStore.favsList();
  const coldStart = isColdStart(taste, favs.length, hist.length);

  const seedPool = [hist[0] || favs[0], hist[1] || favs[1], hist[2] || favs[2]]
    .filter((t, i, a): t is Track => !!t?.id && a.findIndex((x) => x?.id === t.id) === i)
    .slice(0, 3);
  const primarySeed = seedPool[0] || null;

  const [backendQP, backendHome, backendForYou, backendDiscover, saavnBrowse] = await Promise.all([
    fetchQuickPicks(12).catch(() => null),
    fetchRecHome().catch(() => null),
    fetchForYou().catch(() => [] as Track[]),
    fetchDiscover().catch(() => [] as Track[]),
    getSaavnBrowseModules().catch(() => ({
      trending: [] as Track[],
      topPlaylists: [] as Playlist[],
      newAlbums: [] as Album[],
      charts: [] as Playlist[],
    })),
  ]);

  // Backend /home sections (previously fetched but ignored) feed rails/mixes.
  const homeSection = (id: string): Track[] =>
    backendHome?.sections.find((s) => s.id === id)?.tracks ?? [];
  const backendBecause = backendHome?.sections.find((s) => s.id === 'because');
  const backendYourMix = homeSection('your-mix');
  const backendTrending = homeSection('trending');

  // Quick Picks: recent favorites + frequent + backend candidates, deduped.
  const freqTracks = taste.frequentlyPlayed.slice(0, 6).map((f) => f.track);
  const quickPicks = dedupTracks(
    [...favs.slice(0, 4), ...freqTracks, ...(backendQP ?? []), ...(homeSection('quick-picks'))],
    12,
  );
  const qpFinal = quickPicks.length
    ? quickPicks
    : (await recommendTracks({ seedTrack: primarySeed, limit: 12 }).catch(() => [] as ScoredTrack[])).slice(0, 12);
  const qpOut = qpFinal.length ? qpFinal : (saavnBrowse.trending?.slice(0, 12) ?? FALLBACK_HITS);

  // Made For You with real explanations.
  let madeForYou: ScoredTrack[] = [];
  if (backendForYou.length) {
    madeForYou = backendForYou.map((t) => ({
      ...t,
      _score: 0.9,
      _reasons: ['Picked for your taste'],
    }));
  } else {
    madeForYou = await recommendTracks({ seedTracks: seedPool, limit: 16 }).catch(() => [] as ScoredTrack[]);
  }

  // Discover (novelty) — backend preferred, local fallback excludes heard.
  let discover: Track[] = backendDiscover.length ? backendDiscover : homeSection('discover');
  if (!discover.length) {
    const profile = getProfile();
    const exclude = new Set([...(primarySeed ? [primarySeed.id] : []), ...hist.slice(0, 10).map((t) => t.id)]);
    discover = await getDiscoverTracks(profile, exclude, 12).catch(() => [] as Track[]);
  }

  // Because You Listen To — real affinity artists, backend section first.
  const becauseSections: BecauseSection[] = [];
  if (backendBecause && backendBecause.tracks.length) {
    const m = backendBecause.title.match(/because you listen to (.+)$/i);
    becauseSections.push({
      artist: toTitleCase(m?.[1]?.trim() || taste.favoriteArtists[0]?.name || 'your favorites'),
      seedTrack: primarySeed ?? backendBecause.tracks[0],
      tracks: backendBecause.tracks.slice(0, 10),
      reason: backendBecause.subtitle || 'More from a favourite',
    });
  }
  if (!becauseSections.length) {
    const topArtists = taste.favoriteArtists.slice(0, 2).map((a) => a.name);
    for (const artistName of topArtists) {
      const match =
        hist.find((t) => primaryArtist(t).includes(artistName)) ||
        favs.find((t) => primaryArtist(t).includes(artistName)) ||
        qpOut.find((t) => primaryArtist(t).includes(artistName));
      if (!match) continue;
      const similar = await getSimilarTracks(match.id, 10).catch(() => [] as Track[]);
      if (similar.length) {
        becauseSections.push({
          artist: toTitleCase(artistName),
          seedTrack: match,
          tracks: similar,
          reason: `Similar to ${match.title}`,
        });
      }
      if (becauseSections.length >= 2) break;
    }
    if (!becauseSections.length && primarySeed) {
      const similar = await getSimilarTracks(primarySeed.id, 10).catch(() => [] as Track[]);
      if (similar.length) {
        becauseSections.push({
          artist: toTitleCase(primaryArtist(primarySeed)),
          seedTrack: primarySeed,
          tracks: similar,
          reason: `Similar to ${primarySeed.title}`,
        });
      }
    }
  }

  // Mixes assembled from real recommendation pools (never fabricated).
  const mixPool = dedupTracks([...qpOut, ...madeForYou, ...discover, ...favs, ...hist]);
  const keyword = (t: Track, words: string[]) => {
    const s = `${t.title} ${t.albumName || ''}`.toLowerCase();
    return words.some((w) => s.includes(w));
  };
  const mixes: PersonalizedMix[] = [
    {
      id: 'my-supermix',
      title: 'My Supermix',
      subtitle: 'Endless personalized mix',
      description: 'A signature blend of your current favorites, recent replays, and fresh discoveries.',
      gradient: 'from-amber-500 via-rose-600 to-purple-800',
      badge: 'SUPERMIX',
      tracks: (backendYourMix.length ? backendYourMix : mixPool).slice(0, 25),
      coverThumb: qpOut[0]?.thumbnail || mixPool[0]?.thumbnail,
    },
    {
      id: 'chill-mix',
      title: 'Chill Mix',
      subtitle: 'Relax & unwind',
      description: 'Mellow melodies, acoustic sounds, and relaxing rhythms tailored to your taste.',
      gradient: 'from-cyan-600 via-teal-700 to-slate-900',
      badge: 'CHILL',
      tracks: [...mixPool.filter((t) => keyword(t, ['lofi', 'chill', 'acoustic', 'love', 'slow'])), ...mixPool.slice(5, 20)].slice(0, 20),
      coverThumb: mixPool[2]?.thumbnail,
    },
    {
      id: 'energy-mix',
      title: 'Energy Mix',
      subtitle: 'High tempo & upbeat',
      description: 'Electrifying beats and high-energy bangers to fuel your day.',
      gradient: 'from-orange-500 via-red-600 to-pink-700',
      badge: 'ENERGY',
      tracks: [...mixPool.filter((t) => keyword(t, ['dance', 'party', 'remix', 'bass', 'workout'])), ...mixPool.slice(10, 25)].slice(0, 20),
      coverThumb: mixPool[4]?.thumbnail,
    },
    {
      id: 'discovery-mix',
      title: 'Discover Mix',
      subtitle: 'New music for you',
      description: 'Emerging artists, fresh releases, and songs outside your regular rotation.',
      gradient: 'from-emerald-500 via-teal-600 to-cyan-900',
      badge: 'DISCOVERY',
      tracks: (discover.length ? discover : mixPool.slice(12, 30)).slice(0, 20),
      coverThumb: discover[0]?.thumbnail || mixPool[1]?.thumbnail,
    },
  ].filter((m) => m.tracks.length > 0);

  // Continue Listening from real playback positions.
  let events: ListeningEvent[] = [];
  try {
    events = getListeningEvents(500);
  } catch {}
  const continueListening = selectContinueListening(events);

  // Based On Your Library: library pool × affinity.
  const libraryPool = dedupTracks([...favs, ...getCachedYTMusicHistory(), ...hist]);
  const basedOnLibrary = selectBasedOnLibrary(libraryPool, taste);

  // Trending For You vs cold-start Popular Now.
  const trendingPool = backendTrending.length ? backendTrending : saavnBrowse.trending ?? [];
  const trendingForYou = coldStart ? [] : rankTrendingForYou(trendingPool, taste);

  // Recently Played: unified, deduped.
  const recentHistory = dedupTracks(
    getRecentlyPlayed(20).length ? getRecentlyPlayed(20) : hist,
    10,
  );

  // Artists from real affinity (no hardcoded fallback names).
  const artistQuery =
    taste.favoriteArtists[0]?.name || primarySeed?.author?.split(',')[0]?.trim() || '';
  let artists: SearchArtist[] = [];
  if (artistQuery) {
    const res = await searchSaavnArtists(artistQuery).catch(() => ({ artists: [] as SearchArtist[] }));
    artists = (res.artists || []).slice(0, 8);
  }

  return {
    quickPicks: qpOut.slice(0, 12),
    madeForYou: madeForYou.slice(0, 16),
    continueListening,
    becauseSections,
    mixes,
    discover: discover.slice(0, 12),
    basedOnLibrary,
    trendingForYou: {
      tracks: trendingForYou,
      label: coldStart ? 'Popular Now' : 'Trending For You',
    },
    recentHistory,
    albums: (saavnBrowse.newAlbums ?? []).slice(0, 8),
    artists,
    playlists: (saavnBrowse.topPlaylists ?? []).slice(0, 8),
    taste,
    coldStart,
  };
}

function dedupedFetch(): Promise<HomeData | null> {
  if (!inflight) {
    inflight = fetchHomeData()
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

const EMPTY_STATUS: HomeSectionStatus = {
  quickPicks: 'loading',
  madeForYou: 'loading',
  continueListening: 'loading',
  because: 'loading',
  mixes: 'loading',
  discover: 'loading',
  basedOnLibrary: 'loading',
  trendingForYou: 'loading',
  recent: 'loading',
  albums: 'loading',
  artists: 'loading',
  playlists: 'loading',
};

export function usePersonalizedHome() {
  const [data, setData] = useState<HomeData | null>(() => readCache());
  const [status, setStatus] = useState<HomeSectionStatus>(() =>
    readCache() ? readyStatus(readCache() as HomeData) : { ...EMPTY_STATUS },
  );
  const [refreshing, setRefreshing] = useState(false);
  const [accountId, setAccountId] = useState(() => scopeOf());
  const lastBgRef = useRef(0);

  const applyData = useCallback((d: HomeData | null, failed: boolean) => {
    if (!d) {
      if (failed) {
        // Total failure with no cache: mark sections error (page shows cold
        // empty states per section, never a full-page error).
        setStatus((s) => {
          const next = { ...s };
          (Object.keys(next) as (keyof HomeSectionStatus)[]).forEach((k) => {
            if (next[k] === 'loading') next[k] = 'error';
          });
          return next;
        });
      }
      return;
    }
    setData(d);
    setStatus(readyStatus(d));
    writeCache(d);
  }, []);

  const refresh = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const d = await dedupedFetch();
        applyData(d, true);
        lastBgRef.current = Date.now();
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [applyData],
  );

  // Initial: cache renders instantly, background refresh fills freshness.
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      lastBgRef.current = Date.now();
      void dedupedFetch().then((d) => applyData(d, false));
    } else {
      void refresh(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Account change → other scope's cache (or cold load), never mixed data.
  useEffect(() => {
    const check = () => {
      const id = scopeOf();
      setAccountId((prev) => (prev === id ? prev : id));
    };
    const unsub = googleAccountStore.subscribe(check);
    window.addEventListener('wave:listening', check);
    return () => {
      unsub();
      window.removeEventListener('wave:listening', check);
    };
  }, []);

  // Significant listening activity refreshes in background, throttled —
  // never on every play/pause, never reshuffling on every navigation.
  useEffect(() => {
    const onProfile = () => {
      if (Date.now() - lastBgRef.current < BG_MIN_INTERVAL_MS) return;
      lastBgRef.current = Date.now();
      void dedupedFetch().then((d) => applyData(d, false));
    };
    window.addEventListener('wave:profile', onProfile);
    return () => window.removeEventListener('wave:profile', onProfile);
  }, [applyData]);

  const loading = useMemo(
    () => !data && (Object.values(status) as SectionStatus[]).some((s) => s === 'loading'),
    [data, status],
  );

  return { data, status, loading, refreshing, refresh, accountId };
}

function readyStatus(d: HomeData): HomeSectionStatus {
  // Empty arrays render nothing (never an error page); only a null fetch
  // with no cache marks sections 'error'.
  const ok: SectionStatus = 'ready';
  return {
    quickPicks: ok,
    madeForYou: ok,
    continueListening: ok,
    because: ok,
    mixes: ok,
    discover: ok,
    basedOnLibrary: ok,
    trendingForYou: ok,
    recent: ok,
    albums: ok,
    artists: ok,
    playlists: ok,
  };
}
