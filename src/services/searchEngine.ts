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
 * Deduplicates albums by normalized title + artist
 */
export function deduplicateAlbums(albums: Album[]): Album[] {
  const map = new Map<string, Album>();
  for (const al of albums) {
    if (!al || !al.name) continue;
    const key = `${normalizeText(al.name)}__${normalizeText(al.artist?.name || '')}`;
    if (!map.has(key)) {
      map.set(key, al);
    }
  }
  return Array.from(map.values());
}

/**
 * Deduplicates playlists by normalized title
 */
export function deduplicatePlaylists(playlists: Playlist[]): Playlist[] {
  const map = new Map<string, Playlist>();
  for (const pl of playlists) {
    if (!pl || !pl.name) continue;
    const key = normalizeText(pl.name);
    if (!map.has(key)) {
      map.set(key, pl);
    }
  }
  return Array.from(map.values());
}

/**
 * Ranks tracks by search query relevance and user taste affinity
 */
export function rankTracks(tracks: Track[], query: string): Track[] {
  const normQ = normalizeText(query);
  const qTokens = normQ.split(' ').filter(Boolean);
  const profile = getProfile();
  const topArtists = profile.artists || {};

  return [...tracks].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    const normTitleA = normalizeText(a.title);
    const normTitleB = normalizeText(b.title);
    const normAuthorA = normalizeText(a.author);
    const normAuthorB = normalizeText(b.author);

    // Exact title match
    if (normTitleA === normQ) scoreA += 100;
    if (normTitleB === normQ) scoreB += 100;

    // Title starts with query
    if (normTitleA.startsWith(normQ)) scoreA += 40;
    if (normTitleB.startsWith(normQ)) scoreB += 40;

    // Title token containment
    for (const t of qTokens) {
      if (normTitleA.includes(t)) scoreA += 15;
      if (normTitleB.includes(t)) scoreB += 15;
      if (normAuthorA.includes(t)) scoreA += 18;
      if (normAuthorB.includes(t)) scoreB += 18;
    }

    // Exact artist match
    if (normAuthorA === normQ || normAuthorA.includes(normQ)) scoreA += 35;
    if (normAuthorB === normQ || normAuthorB.includes(normQ)) scoreB += 35;

    // User taste boost
    for (const [artistName, weight] of Object.entries(topArtists)) {
      const normName = normalizeText(artistName);
      if (normAuthorA.includes(normName)) scoreA += Math.min(15, weight * 3);
      if (normAuthorB.includes(normName)) scoreB += Math.min(15, weight * 3);
    }

    // Source fidelity
    if (a.streamUrl || a.source === 'saavn') scoreA += 5;
    if (b.streamUrl || b.source === 'saavn') scoreB += 5;

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
 * Unified multi-provider search with instant partial returns and deduplication
 */
export async function executeUnifiedSearch(
  query: string,
  filter: SearchFilter = 'all',
  onPartialResults?: (results: UnifiedSearchResults) => void
): Promise<UnifiedSearchResults> {
  const q = query.trim();
  if (!q) {
    return { tracks: [], artists: [], albums: [], playlists: [], topResult: null };
  }

  let accumulatedTracks: Track[] = [];
  let accumulatedArtists: SearchArtist[] = [];
  let accumulatedAlbums: Album[] = [];
  let accumulatedPlaylists: Playlist[] = [];

  const updateState = () => {
    const dedupedTracks = rankTracks(deduplicateTracks(accumulatedTracks), q);
    const dedupedArtists = deduplicateArtists(accumulatedArtists);
    const dedupedAlbums = deduplicateAlbums(accumulatedAlbums);
    const dedupedPlaylists = deduplicatePlaylists(accumulatedPlaylists);

    const topResult = detectTopResult(q, dedupedTracks, dedupedArtists, dedupedAlbums, dedupedPlaylists);

    const results: UnifiedSearchResults = {
      tracks: dedupedTracks,
      artists: dedupedArtists,
      albums: dedupedAlbums,
      playlists: dedupedPlaylists,
      topResult,
    };

    onPartialResults?.(results);
    return results;
  };

  // Launch YT Music & JioSaavn in parallel
  const ytPromise = ytmusicSearch(q, filter).then((ytRes) => {
    if (ytRes.tracks?.length) accumulatedTracks.push(...ytRes.tracks);
    if (ytRes.artists?.length) accumulatedArtists.push(...ytRes.artists);
    if (ytRes.albums?.length) accumulatedAlbums.push(...ytRes.albums);
    if (ytRes.playlists?.length) accumulatedPlaylists.push(...ytRes.playlists);
    return updateState();
  }).catch(() => null);

  const saavnPromise = (async () => {
    if (filter === 'all') {
      const saavnRes = await searchSaavnAll(q).catch(() => ({ tracks: [], albums: [], playlists: [], artists: [] }));
      if (saavnRes.tracks?.length) accumulatedTracks.push(...saavnRes.tracks);
      if (saavnRes.artists?.length) accumulatedArtists.push(...saavnRes.artists);
      if (saavnRes.albums?.length) accumulatedAlbums.push(...saavnRes.albums);
      if (saavnRes.playlists?.length) accumulatedPlaylists.push(...saavnRes.playlists);
    } else if (filter === 'songs') {
      const saavnRes = await searchSaavnSongs(q, 1, 25).catch(() => ({ total: 0, tracks: [] }));
      if (saavnRes.tracks?.length) accumulatedTracks.push(...saavnRes.tracks);
    } else if (filter === 'artists') {
      const saavnRes = await searchSaavnArtists(q, 1, 25).catch(() => ({ total: 0, artists: [] }));
      if (saavnRes.artists?.length) accumulatedArtists.push(...saavnRes.artists);
    } else if (filter === 'albums') {
      const saavnRes = await searchSaavnAlbums(q, 1, 25).catch(() => ({ total: 0, albums: [] }));
      if (saavnRes.albums?.length) accumulatedAlbums.push(...saavnRes.albums);
    } else if (filter === 'playlists') {
      const saavnRes = await searchSaavnPlaylists(q, 1, 25).catch(() => ({ total: 0, playlists: [] }));
      if (saavnRes.playlists?.length) accumulatedPlaylists.push(...saavnRes.playlists);
    }
    return updateState();
  })().catch(() => null);

  await Promise.allSettled([ytPromise, saavnPromise]);

  // Fallback to YouTube direct search if no tracks were found
  if (accumulatedTracks.length === 0 && (filter === 'all' || filter === 'songs')) {
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
 * Combines suggestions from YT Music and JioSaavn with fast response
 */
export async function getUnifiedSuggestions(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const [ytSug, saavnSug] = await Promise.all([
    ytmusicSuggestions(q).catch(() => [] as string[]),
    getSaavnSuggestions(q).catch(() => [] as string[]),
  ]);

  const seen = new Set<string>();
  const combined: string[] = [];

  for (const s of [...ytSug, ...saavnSug]) {
    const cleaned = s.trim();
    const lower = cleaned.toLowerCase();
    if (cleaned && !seen.has(lower)) {
      seen.add(lower);
      combined.push(cleaned);
    }
  }

  return combined.slice(0, 8);
}
