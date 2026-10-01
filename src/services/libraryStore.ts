import { Track } from '../types';
import { playerStore } from './playerStore';
import { getRecentlyPlayed, getListeningEvents } from './listeningStore';

export interface LocalPlaylist {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  songs: Track[];
  createdAt: string;
  updatedAt: string;
  privacyStatus?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  source?: 'local' | 'youtube';
  sourcePlaylistId?: string;
  youtubePlaylistId?: string;
  lastSyncedAt?: string;
}

export type LibrarySortOption =
  | 'recent_added'
  | 'recent_played'
  | 'title_asc'
  | 'title_desc'
  | 'artist_asc'
  | 'album_asc'
  | 'duration_desc'
  | 'duration_asc'
  | 'most_played';

const LS_LOCAL_PLAYLISTS = 'wave:local_playlists';
const LS_LIBRARY_SORT = 'wave:library:sort';

/** Format relative time strings cleanly: 'Just now', '5m ago', '2h ago', 'Yesterday', '3d ago' */
export function formatRelativeTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  const time = date.getTime();
  if (isNaN(time)) return '';

  const now = Date.now();
  const diffSec = Math.floor((now - time) / 1000);

  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return 'Yesterday';
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 604800)}w ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Formats duration in seconds to "m:ss" or "h:mm:ss" */
export function formatTrackDuration(seconds?: number | string | null): string {
  if (!seconds) return '--:--';
  const sec = typeof seconds === 'string' ? parseDurationString(seconds) : Math.round(seconds);
  if (!sec || isNaN(sec) || sec <= 0) return typeof seconds === 'string' ? seconds : '--:--';

  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Parse duration string like "3:45" or "1:02:30" to total seconds */
export function parseDurationString(dur?: string): number {
  if (!dur) return 0;
  const parts = dur.split(':').map((p) => parseInt(p.trim(), 10));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

/** Format total collection duration nicely: "48 min" or "2 hr 15 min" */
export function formatTotalDuration(tracks: Track[]): string {
  let totalSec = 0;
  for (const t of tracks) {
    if (t.durationSeconds && t.durationSeconds > 0) {
      totalSec += t.durationSeconds;
    } else if (t.duration) {
      totalSec += parseDurationString(t.duration);
    }
  }
  if (!totalSec) return `${tracks.length} songs`;
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.round((totalSec % 3600) / 60);
  if (hrs > 0) {
    return `${hrs} hr ${mins} min`;
  }
  return `${mins} min`;
}

/** Get all local playlists from localStorage */
export function getLocalPlaylists(): LocalPlaylist[] {
  try {
    const raw = localStorage.getItem(LS_LOCAL_PLAYLISTS);
    return raw ? (JSON.parse(raw) as LocalPlaylist[]) : [];
  } catch {
    return [];
  }
}

/** Save local playlists and notify listeners */
export function saveLocalPlaylists(playlists: LocalPlaylist[]) {
  try {
    localStorage.setItem(LS_LOCAL_PLAYLISTS, JSON.stringify(playlists));
    window.dispatchEvent(new Event('wave:playlists_changed'));
  } catch {}
}

/** Create a new local playlist */
export function createLocalPlaylist(title: string, description = '', initialTracks: Track[] = []): LocalPlaylist {
  const playlists = getLocalPlaylists();
  const id = `LOCAL_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newPl: LocalPlaylist = {
    id,
    title: title.trim() || 'Untitled Playlist',
    description: description.trim(),
    songs: [...initialTracks],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    privacyStatus: 'PRIVATE',
    source: 'local',
  };
  saveLocalPlaylists([newPl, ...playlists]);
  return newPl;
}

/** Add a track to a local playlist (avoids duplicates) */
export function addTrackToPlaylist(playlistId: string, track: Track): boolean {
  if (!playlistId || !track?.id) return false;
  const playlists = getLocalPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return false;

  if (!pl.songs) pl.songs = [];
  if (pl.songs.some((s) => s.id === track.id)) return false;

  pl.songs.push(track);
  pl.updatedAt = new Date().toISOString();
  saveLocalPlaylists(playlists);
  return true;
}

/** Add multiple tracks to a local playlist */
export function addTracksToPlaylist(playlistId: string, tracks: Track[]): number {
  if (!playlistId || !tracks.length) return 0;
  const playlists = getLocalPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl) return 0;

  if (!pl.songs) pl.songs = [];
  const existingIds = new Set(pl.songs.map((s) => s.id));
  let added = 0;
  for (const t of tracks) {
    if (t?.id && !existingIds.has(t.id)) {
      pl.songs.push(t);
      existingIds.add(t.id);
      added++;
    }
  }
  if (added > 0) {
    pl.updatedAt = new Date().toISOString();
    saveLocalPlaylists(playlists);
  }
  return added;
}

/** Remove track from a local playlist */
export function removeTrackFromPlaylist(playlistId: string, trackId: string): boolean {
  const playlists = getLocalPlaylists();
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl || !pl.songs) return false;

  const idx = pl.songs.findIndex((s) => s.id === trackId);
  if (idx === -1) return false;

  pl.songs.splice(idx, 1);
  pl.updatedAt = new Date().toISOString();
  saveLocalPlaylists(playlists);
  return true;
}

/** Delete a local playlist */
export function deleteLocalPlaylist(playlistId: string): boolean {
  const playlists = getLocalPlaylists();
  const filtered = playlists.filter((p) => p.id !== playlistId);
  if (filtered.length === playlists.length) return false;
  saveLocalPlaylists(filtered);
  return true;
}

/** Retrieve persisted sort setting */
export function getSavedLibrarySort(): LibrarySortOption {
  try {
    const s = localStorage.getItem(LS_LIBRARY_SORT);
    if (s) return s as LibrarySortOption;
  } catch {}
  return 'recent_added';
}

/** Save sort setting */
export function saveLibrarySort(opt: LibrarySortOption) {
  try {
    localStorage.setItem(LS_LIBRARY_SORT, opt);
  } catch {}
}

/** Aggregates all user library songs across favorites, history, recents, and playlists */
export function getAllLibraryTracks(): Track[] {
  const seen = new Set<string>();
  const all: Track[] = [];

  const push = (t?: Track | null) => {
    if (!t?.id || seen.has(t.id)) return;
    seen.add(t.id);
    all.push(t);
  };

  // 1. Favorites (priority)
  for (const t of playerStore.favsList()) push(t);

  // 2. Playlists songs
  for (const pl of getLocalPlaylists()) {
    for (const t of pl.songs || []) push(t);
  }

  // 3. Recently played
  for (const t of getRecentlyPlayed(50)) push(t);

  // 4. History
  for (const t of playerStore.historyList()) push(t);

  return all;
}

/** Extract distinct album groupings from library tracks */
export interface ExtractedAlbum {
  id: string;
  name: string;
  artistName: string;
  thumbnail: string;
  year?: string | number | null;
  tracks: Track[];
  source?: string;
}

export function extractLibraryAlbums(tracks: Track[]): ExtractedAlbum[] {
  const map = new Map<string, ExtractedAlbum>();

  for (const t of tracks) {
    const albumName = (t.albumName || '').trim();
    if (!albumName || albumName === '—') continue;

    const artistName = (t.author || 'Various Artists').split(/[,&]/)[0].trim();
    const key = `${albumName.toLowerCase()}___${artistName.toLowerCase()}`;

    if (!map.has(key)) {
      map.set(key, {
        id: t.albumId || key,
        name: albumName,
        artistName,
        thumbnail: t.thumbnail,
        year: t.year || null,
        tracks: [t],
        source: t.source,
      });
    } else {
      const existing = map.get(key)!;
      if (!existing.tracks.some((x) => x.id === t.id)) {
        existing.tracks.push(t);
      }
      if (!existing.thumbnail && t.thumbnail) existing.thumbnail = t.thumbnail;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.tracks.length - a.tracks.length);
}

/** Extract distinct artists from library tracks */
export interface ExtractedArtist {
  id: string;
  name: string;
  thumbnail: string;
  tracks: Track[];
}

export function extractLibraryArtists(tracks: Track[]): ExtractedArtist[] {
  const map = new Map<string, ExtractedArtist>();

  for (const t of tracks) {
    const rawArtists = (t.author || '').split(/[,&/]+/).map((a) => a.trim()).filter(Boolean);
    const primary = rawArtists[0] || t.author || 'Unknown Artist';

    const key = primary.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        id: (t as any).artists?.primary?.[0]?.id || key,
        name: primary,
        thumbnail: (t as any).artists?.primary?.[0]?.image || t.thumbnail,
        tracks: [t],
      });
    } else {
      const existing = map.get(key)!;
      if (!existing.tracks.some((x) => x.id === t.id)) {
        existing.tracks.push(t);
      }
      if (!existing.thumbnail && t.thumbnail) existing.thumbnail = t.thumbnail;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.tracks.length - a.tracks.length);
}

/** Sort tracks based on selected criteria */
export function sortTracks(
  tracks: Track[],
  sortOption: LibrarySortOption,
  playCountsMap: Record<string, number> = {},
  recentTimestampsMap: Record<string, number> = {}
): Track[] {
  const list = [...tracks];

  switch (sortOption) {
    case 'recent_played':
      return list.sort((a, b) => {
        const timeA = recentTimestampsMap[a.id] || 0;
        const timeB = recentTimestampsMap[b.id] || 0;
        return timeB - timeA;
      });
    case 'title_asc':
      return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    case 'title_desc':
      return list.sort((a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: 'base' }));
    case 'artist_asc':
      return list.sort((a, b) => (a.author || '').localeCompare(b.author || '', undefined, { sensitivity: 'base' }));
    case 'album_asc':
      return list.sort((a, b) => (a.albumName || '').localeCompare(b.albumName || '', undefined, { sensitivity: 'base' }));
    case 'duration_desc':
      return list.sort((a, b) => (b.durationSeconds || parseDurationString(b.duration)) - (a.durationSeconds || parseDurationString(a.duration)));
    case 'duration_asc':
      return list.sort((a, b) => (a.durationSeconds || parseDurationString(a.duration)) - (b.durationSeconds || parseDurationString(b.duration)));
    case 'most_played':
      return list.sort((a, b) => (playCountsMap[b.id] || 0) - (playCountsMap[a.id] || 0));
    case 'recent_added':
    default:
      // default preserve list order (which has favorites/playlists/recents newest first)
      return list;
  }
}
