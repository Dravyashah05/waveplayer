import { isPlaylist, isTrack, type MediaItem, type Playlist, type Track } from '../types';
import { playerStore } from './playerStore';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export class PlaylistPlaybackError extends Error {
  constructor(readonly code: 'INVALID_PLAYLIST' | 'PLAYLIST_UNAVAILABLE' | 'NO_PLAYABLE_TRACKS') {
    super(code);
    this.name = 'PlaylistPlaybackError';
  }
}

function playableTracks(values: unknown): Track[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is Track => {
    if (!value || typeof value !== 'object') return false;
    const track = value as MediaItem & { playlistId?: unknown };
    if (!isTrack(track) || !track.id.trim() || !track.title || !track.author) return false;
    if (typeof track.playlistId === 'string') return false;
    if (track.source === 'youtube' || track.source === 'ytmusic') return YOUTUBE_ID.test(track.id);
    return track.source === 'saavn' || track.source === 'local' || track.source === 'custom' || !!track.streamUrl;
  });
}

async function loadPlaylistTracks(playlist: Playlist): Promise<Track[]> {
  const id = playlist.playlistId.trim();
  const sourceId = id.replace(/^(local|wave|youtube|ytmusic):/, '');
  try {
    if (id.startsWith('local:') || id.startsWith('wave:')) {
      const { getLocalPlaylists } = await import('./libraryStore');
      return playableTracks(getLocalPlaylists().find((item) => item.id === sourceId)?.songs);
    }
    if (playlist.source === 'youtube' || id.startsWith('youtube:')) {
      const { getYoutubePlaylistDetail } = await import('./youtubePlaylists');
      const detail = await getYoutubePlaylistDetail(sourceId);
      return playableTracks(detail.tracks);
    }
    if (playlist.source === 'ytmusic' || id.startsWith('ytmusic:')) {
      const { getYTMusicPlaylistDetails } = await import('./ytmusicLibrary');
      const detail = await getYTMusicPlaylistDetails(sourceId);
      return playableTracks(detail.tracks);
    }
    const { getSaavnPlaylistDetails } = await import('./saavnApi');
    const detail = await getSaavnPlaylistDetails(sourceId);
    return playableTracks(detail?.tracks);
  } catch {
    throw new PlaylistPlaybackError('PLAYLIST_UNAVAILABLE');
  }
}

export function startPlaylistTracks(playlist: Playlist, input: unknown, startIndex = 0): void {
  const tracks = playableTracks(input);
  if (!tracks.length) throw new PlaylistPlaybackError('NO_PLAYABLE_TRACKS');
  const index = Math.max(0, Math.min(Math.floor(startIndex), tracks.length - 1));
  const metas = tracks.map(() => ({
    addedBy: 'playlist' as const,
    context: playlist.name,
    playlistId: playlist.playlistId,
  }));
  playerStore.setQueue(tracks, index, metas);
}

const inFlight = new Map<string, Promise<void>>();

/** Load a playlist once and start it with playlist provenance on each queue item. */
export function playPlaylist(playlist: Playlist, startIndex = 0): Promise<void> {
  if (!playlist || !isPlaylist(playlist) || !playlist.playlistId?.trim()) {
    return Promise.reject(new PlaylistPlaybackError('INVALID_PLAYLIST'));
  }
  const key = `${playlist.source || 'local'}:${playlist.playlistId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    const tracks = await loadPlaylistTracks(playlist);
    startPlaylistTracks(playlist, tracks, startIndex);
  })();

  inFlight.set(key, request);
  return request.finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
}
