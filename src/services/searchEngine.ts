import { Track, SearchArtist, Album, Playlist, SearchFilter } from '../types';
import { ytmusicSearch, ytmusicSuggestions } from './ytmusicApi';
import {
  searchSaavnAll,
  searchSaavnSongs,
  searchSaavnAlbums,
  searchSaavnPlaylists,
  searchSaavnArtists,
  getSaavnSuggestions,
} from './saavnApi';
import { searchYouTube } from './youtubeSearch';
import { matchSongs } from './recommendation/songMatcher';
import { normalizeText } from './recommendation/metadataNormalizer';
import { getProfile } from './userProfile';

export interface TopResultItem {
  type: 'artist' | 'song' | 'album' | 'playlist';
  item: SearchArtist | Track | Album | Playlist;
  confidence: number;
  reason?: string;
}

export interface UnifiedSearchResults {
  tracks: Track[];
  artists: SearchArtist[];
  albums: Album[];
  playlists: Playlist[];
  topResult?: TopResultItem | null;
  /** Per-source health for the last completed run (partial-failure banner). */
  sources?: { ytmusic: boolean; saavn: boolean };
}

/**
 * Single tunable configuration for search aggregation.
 * Budgets, ranking weights and suggestion limits live here — nowhere else.
 */
export const SEARCH_CONFIG = {
  /** Max time one provider may delay the final merged results. */
  providerBudgetMs: 8000,
  /** Suggestion list size. */
  suggestionLimit: 8,
  ranking: {
    exactTitle: 100,
    titlePrefix: 40,
    titleToken: 15,
    authorToken: 18,
    authorMatch: 35,
    tasteMax: 15,
    languageMatch: 6,
    playCountMax: 8,
    streamBonus: 5,
  },
} as const;

let searchRun = 0;
/** Start a new search run; late partials/finals from older runs are ignored. */
export function nextSearchRun(): number {
  searchRun += 1;
  return searchRun;
}
export function isStaleRun(id: number): boolean {
  return id !== searchRun;
}

function withBudget<T>(promise: Promise<T>, ms = SEARCH_CONFIG.providerBudgetMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('search-budget-exceeded')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const LS_RECENT = 'wave:recent_searches';

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): string[] {
  const q = query.trim();
  if (!q) return getRecentSearches();
  try {
    const existing = getRecentSearches();
    const updated = [q, ...existing.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, 10);
    localStorage.setItem(LS_RECENT, JSON.stringify(updated));
    return updated;
  } catch {
    return getRecentSearches();
  }
}

export function removeRecentSearch(query: string): string[] {
  const q = query.trim().toLowerCase();
  try {
    const existing = getRecentSearches();
    const updated = existing.filter((item) => item.toLowerCase() !== q);
    localStorage.setItem(LS_RECENT, JSON.stringify(updated));
    return updated;
  } catch {
    return getRecentSearches();
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(LS_RECENT);
  } catch {}
}

/**
 * Deduplicates tracks across providers (YT Music, JioSaavn, YouTube)
 * while preserving distinct versions (Remix, Acoustic, Live, etc.)
 */
export function deduplicateTracks(tracks: Track[]): Track[] {
  const deduped: Track[] = [];

  for (const track of tracks) {
    if (!track || !track.id || !track.title) continue;

    let matchIdx = -1;
    for (let i = 0; i < deduped.length; i++) {
      const { isMatch } = matchSongs(track, deduped[i]);
      if (isMatch) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx === -1) {
      deduped.push(track);
    } else {
      // Merge best attributes (prefer 320k stream or higher res thumbnail)
      const existing = deduped[matchIdx];
      const merged: Track = {
        ...existing,
        streamUrl: existing.streamUrl || track.streamUrl,
        downloadUrl: existing.downloadUrl || track.downloadUrl,
        qualities: existing.qualities || track.qualities,
        hasLyrics: existing.hasLyrics || track.hasLyrics,
        lyricsId: existing.lyricsId || track.lyricsId,
        albumName: existing.albumName || track.albumName,
        albumId: existing.albumId || track.albumId,
      };
      deduped[matchIdx] = merged;
    }
  }

  return deduped;
}

/**
 * Deduplicates artists by normalized name
 */
export function deduplicateArtists(artists: SearchArtist[]): SearchArtist[] {
  const map = new Map<string, SearchArtist>();
  for (const ar of artists) {
    if (!ar || !ar.name) continue;
    const norm = normalizeText(ar.name);
    if (!map.has(norm)) {
      map.set(norm, ar);
    } else {
      const current = map.get(norm)!;
      if ((!current.thumbnails || !current.thumbnails.length) && ar.thumbnails && ar.thumbnails.length) {
        map.set(norm, ar);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Deduplicates albums by normalized title + artist + year.
 * Year keeps remasters/anniversary editions distinct across providers.
 */
export function deduplicateAlbums(albums: Album[]): Album[] {
  const map = new Map<string, Album>();
  for (const al of albums) {
    if (!al || !al.name) continue;
    const key = `${normalizeText(al.name)}__${normalizeText(al.artist?.name || '')}__${al.year || ''}`;
    if (!map.has(key)) {
      map.set(key, al);
    }
  }
  return Array.from(map.values());
}

/**
 * Deduplicates playlists by normalized title + author.
 * Author keeps different owners' same-titled playlists distinct.
 */
export function deduplicatePlaylists(playlists: Playlist[]): Playlist[] {
  const map = new Map<string, Playlist>();
  for (const pl of playlists) {
    if (!pl || !pl.name) continue;
    const key = `${normalizeText(pl.name)}__${normalizeText(pl.author || '')}`;
    if (!map.has(key)) {
      map.set(key, pl);
    }
  }
  return Array.from(map.values());
}

/**
 * Search Wave (device-local) playlists without any network. Returns
 * provider-shaped Playlist entries with `local:` ids so the shared detail
 * page, cards and top-result flows work unchanged. Private YouTube
 * playlists are deliberately excluded here — they surface only in Library
 * for the signed-in owner, never in global search.
 */
export function searchWavePlaylists(
  query: string,
  playlists: Array<{ id: string; title: string; description?: string; songs?: Array<{ id: string }> }>,
): Playlist[] {
  const normQ = normalizeText(query);
  if (!normQ) return [];
  const ranked = rankByName(
    (playlists || []).filter((p) => p && typeof p.id === 'string'),
    query,
    (p) => `${p.title || ''} ${p.description || ''}`,
  );
  return ranked
    .filter((p) => {
      const hay = normalizeText(`${p.title || ''} ${p.description || ''}`);
      return !!hay && normQ.split(' ').filter(Boolean).some((tok) => hay.includes(tok));
    })
    .slice(0, 6)
    .map((p) => ({
      playlistId: `local:${p.id}`,
      name: p.title || 'Untitled Playlist',
      author: 'Wave Player',
      thumbnails: [],
      videoCount: Array.isArray(p.songs) ? p.songs.length : 0,
      type: 'PLAYLIST' as const,
      description: p.description || '',
    }));
}

/** Generic name-match ranking for artists/albums/playlists (provider order kept on ties). */
export function rankByName<T>(items: T[], query: string, getName: (item: T) => string): T[] {
  const normQ = normalizeText(query);
  const qTokens = normQ.split(' ').filter(Boolean);
  const scored = items.map((item, idx) => {
    const norm = normalizeText(getName(item));
    let score = 0;
    if (norm === normQ) score += 100;
    else if (norm.startsWith(normQ) || normQ.startsWith(norm)) score += 40;
    for (const t of qTokens) {
      if (norm.includes(t)) score += 10;
    }
    return { item, score, idx };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((s) => s.item);
}

/**
 * Ranks tracks by fused relevance: string match + taste affinity +
 * language match + provider popularity (play count) + stream availability.
 * Weights live in SEARCH_CONFIG; no scores ever reach the UI.
 */
export function rankTracks(tracks: Track[], query: string): Track[] {
  const normQ = normalizeText(query);
  const qTokens = normQ.split(' ').filter(Boolean);
  const profile = getProfile();
  const topArtists = profile.artists || {};
  const favLang = (profile.favoriteLanguage || '').trim().toLowerCase();
  const W = SEARCH_CONFIG.ranking;

  return [...tracks].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    const normTitleA = normalizeText(a.title);
    const normTitleB = normalizeText(b.title);
    const normAuthorA = normalizeText(a.author);
    const normAuthorB = normalizeText(b.author);

    // Exact title match
    if (normTitleA === normQ) scoreA += W.exactTitle;
    if (normTitleB === normQ) scoreB += W.exactTitle;

    // Title starts with query
    if (normTitleA.startsWith(normQ)) scoreA += W.titlePrefix;
    if (normTitleB.startsWith(normQ)) scoreB += W.titlePrefix;

    // Title token containment
    for (const t of qTokens) {
      if (normTitleA.includes(t)) scoreA += W.titleToken;
      if (normTitleB.includes(t)) scoreB += W.titleToken;
      if (normAuthorA.includes(t)) scoreA += W.authorToken;
      if (normAuthorB.includes(t)) scoreB += W.authorToken;
    }

    // Exact artist match
    if (normAuthorA === normQ || normAuthorA.includes(normQ)) scoreA += W.authorMatch;
    if (normAuthorB === normQ || normAuthorB.includes(normQ)) scoreB += W.authorMatch;

    // User taste boost
    for (const [artistName, weight] of Object.entries(topArtists)) {
      const normName = normalizeText(artistName);
      if (normAuthorA.includes(normName)) scoreA += Math.min(W.tasteMax, (weight as number) * 3);
      if (normAuthorB.includes(normName)) scoreB += Math.min(W.tasteMax, (weight as number) * 3);
    }

    // Preferred-language match
    if (favLang) {
      if ((a.language || '').trim().toLowerCase() === favLang) scoreA += W.languageMatch;
      if ((b.language || '').trim().toLowerCase() === favLang) scoreB += W.languageMatch;
    }

    // Provider popularity (log-scaled play count when the source supplies one)
    const playsA = typeof a.playCount === 'number' && a.playCount > 0 ? Math.log10(a.playCount + 1) : 0;
    const playsB = typeof b.playCount === 'number' && b.playCount > 0 ? Math.log10(b.playCount + 1) : 0;
    scoreA += Math.min(W.playCountMax, playsA * 2);
    scoreB += Math.min(W.playCountMax, playsB * 2);

    // Source fidelity
    if (a.streamUrl || a.source === 'saavn') scoreA += W.streamBonus;
    if (b.streamUrl || b.source === 'saavn') scoreB += W.streamBonus;

    return scoreB - scoreA;
  });
}

/**
 * Detects the strongest Top Result (Artist, Song, Album, or Playlist)
 */
export function detectTopResult(
  query: string,
  tracks: Track[],
  artists: SearchArtist[],
  albums: Album[],
  playlists: Playlist[]
): TopResultItem | null {
  const normQ = normalizeText(query);
  if (!normQ) return null;

  // 1. Check for strong Artist match
  if (artists.length > 0) {
    const topArtist = artists[0];
    const normArtist = normalizeText(topArtist.name);
    if (normArtist === normQ || normQ.startsWith(normArtist) || normArtist.startsWith(normQ)) {
      return {
        type: 'artist',
        item: topArtist,
        confidence: 0.98,
        reason: 'Artist',
      };
    }
  }

  // 2. Check for strong Song match
  if (tracks.length > 0) {
    const topTrack = tracks[0];
    const normTitle = normalizeText(topTrack.title);
    if (normTitle === normQ || normTitle.startsWith(normQ) || normQ.startsWith(normTitle)) {
      return {
        type: 'song',
        item: topTrack,
        confidence: 0.95,
        reason: 'Song',
      };
    }
  }

  // 3. Check for strong Album match
  if (albums.length > 0) {
    const topAlbum = albums[0];
    const normAlbum = normalizeText(topAlbum.name);
    if (normAlbum === normQ || normAlbum.startsWith(normQ) || normQ.startsWith(normAlbum)) {
      return {
        type: 'album',
        item: topAlbum,
        confidence: 0.90,
        reason: 'Album',
      };
    }
  }

  // 4. Check for strong Playlist match
  if (playlists.length > 0) {
    const topPlaylist = playlists[0];
    const normPlaylist = normalizeText(topPlaylist.name);
    if (normPlaylist === normQ || normPlaylist.startsWith(normQ)) {
      return {
        type: 'playlist',
        item: topPlaylist,
        confidence: 0.85,
        reason: 'Playlist',
      };
    }
  }

  // 5. Default fallback to top track or top artist
  if (tracks.length > 0) {
    return {
      type: 'song',
      item: tracks[0],
      confidence: 0.75,
      reason: 'Top Result',
    };
  }

  if (artists.length > 0) {
    return {
      type: 'artist',
      item: artists[0],
      confidence: 0.70,
      reason: 'Top Result',
    };
  }

  return null;
}

/**
 * Unified multi-provider search with instant partial returns and deduplication.
 * Each provider races a time budget so one slow source never stalls the merge;
 * per-source health rides along for partial-failure UI. Pass a run id from
 * nextSearchRun() to ignore stale late arrivals (debounced keystrokes).
 */
export async function executeUnifiedSearch(
  query: string,
  filter: SearchFilter = 'all',
  onPartialResults?: (results: UnifiedSearchResults) => void,
  runId?: number,
): Promise<UnifiedSearchResults> {
  const q = query.trim();
  if (!q) {
    return { tracks: [], artists: [], albums: [], playlists: [], topResult: null };
  }

  let accumulatedTracks: Track[] = [];
  let accumulatedArtists: SearchArtist[] = [];
  let accumulatedAlbums: Album[] = [];
  let accumulatedPlaylists: Playlist[] = [];
  let ytOk = false;
  let saavnOk = false;

  const alive = () => runId === undefined || !isStaleRun(runId);

  const updateState = () => {
    const dedupedTracks = rankTracks(deduplicateTracks(accumulatedTracks), q);
    const dedupedArtists = rankByName(deduplicateArtists(accumulatedArtists), q, (a) => a.name);
    const dedupedAlbums = rankByName(deduplicateAlbums(accumulatedAlbums), q, (a) => a.name);
    const dedupedPlaylists = rankByName(deduplicatePlaylists(accumulatedPlaylists), q, (p) => p.name);

    const topResult = detectTopResult(q, dedupedTracks, dedupedArtists, dedupedAlbums, dedupedPlaylists);

    const results: UnifiedSearchResults = {
      tracks: dedupedTracks,
      artists: dedupedArtists,
      albums: dedupedAlbums,
      playlists: dedupedPlaylists,
      topResult,
      sources: { ytmusic: ytOk, saavn: saavnOk },
    };

    if (alive()) onPartialResults?.(results);
    return results;
  };

  // Launch YT Music & JioSaavn in parallel (budgeted)
  const ytPromise = withBudget(ytmusicSearch(q, filter)).then((ytRes) => {
    ytOk = true;
    if (ytRes.tracks?.length) accumulatedTracks.push(...ytRes.tracks);
    if (ytRes.artists?.length) accumulatedArtists.push(...ytRes.artists);
    if (ytRes.albums?.length) accumulatedAlbums.push(...ytRes.albums);
    if (ytRes.playlists?.length) accumulatedPlaylists.push(...ytRes.playlists);
    return updateState();
  }).catch(() => null);

  const saavnPromise = (async () => {
    try {
      if (filter === 'all') {
        const saavnRes = await withBudget(searchSaavnAll(q));
        if (saavnRes.tracks?.length) accumulatedTracks.push(...saavnRes.tracks);
        if (saavnRes.artists?.length) accumulatedArtists.push(...saavnRes.artists);
        if (saavnRes.albums?.length) accumulatedAlbums.push(...saavnRes.albums);
        if (saavnRes.playlists?.length) accumulatedPlaylists.push(...saavnRes.playlists);
      } else if (filter === 'songs' || filter === 'videos') {
        // Videos are YT-side; Saavn contributes matching songs as backup.
        const saavnRes = await withBudget(searchSaavnSongs(q, 1, 25));
        if (saavnRes.tracks?.length) accumulatedTracks.push(...saavnRes.tracks);
      } else if (filter === 'artists') {
        const saavnRes = await withBudget(searchSaavnArtists(q, 1, 25));
        if (saavnRes.artists?.length) accumulatedArtists.push(...saavnRes.artists);
      } else if (filter === 'albums') {
        const saavnRes = await withBudget(searchSaavnAlbums(q, 1, 25));
        if (saavnRes.albums?.length) accumulatedAlbums.push(...saavnRes.albums);
      } else if (filter === 'playlists') {
        const saavnRes = await withBudget(searchSaavnPlaylists(q, 1, 25));
        if (saavnRes.playlists?.length) accumulatedPlaylists.push(...saavnRes.playlists);
      }
      saavnOk = true;
    } catch {
      // stays false → partial-failure banner
    }
    return updateState();
  })();

  await Promise.allSettled([ytPromise, saavnPromise]);

  // Fallback to YouTube direct search if no tracks were found
  if (accumulatedTracks.length === 0 && (filter === 'all' || filter === 'songs' || filter === 'videos')) {
    try {
      const ytFallback = await searchYouTube(q);
      if (ytFallback.length) {
        accumulatedTracks.push(...ytFallback);
      }
    } catch {}
  }

  return updateState();
}

/**
 * Ranked suggestion merge: recent-search prefix matches first, then
 * provider suggestions (prefix before substring), deduped and capped.
 */
export function rankSuggestions(query: string, recent: string[], provider: string[]): string[] {
  const normQ = query.trim().toLowerCase();
  if (!normQ) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const cleaned = s.trim();
    const lower = cleaned.toLowerCase();
    if (cleaned && !seen.has(lower)) {
      seen.add(lower);
      out.push(cleaned);
    }
  };
  for (const r of recent) {
    if (r.toLowerCase().startsWith(normQ)) push(r);
  }
  const cleaned = provider.map((s) => s.trim()).filter(Boolean);
  const starts: string[] = [];
  const contains: string[] = [];
  const rest: string[] = [];
  for (const s of cleaned) {
    const lower = s.toLowerCase();
    if (lower.startsWith(normQ)) starts.push(s);
    else if (lower.includes(normQ)) contains.push(s);
    else rest.push(s);
  }
  // Prefer shorter (more precise) completions within each band.
  const byLength = (a: string, b: string) => a.length - b.length;
  starts.sort(byLength);
  contains.sort(byLength);
  for (const s of [...starts, ...contains, ...rest]) push(s);
  return out.slice(0, SEARCH_CONFIG.suggestionLimit);
}

/**
 * Combines recent searches with YT Music and JioSaavn suggestions.
 */
export async function getUnifiedSuggestions(query: string, recent: string[] = []): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const [ytSug, saavnSug] = await Promise.all([
    ytmusicSuggestions(q).catch(() => [] as string[]),
    getSaavnSuggestions(q).catch(() => [] as string[]),
  ]);

  return rankSuggestions(q, recent, [...ytSug, ...saavnSug]);
}
