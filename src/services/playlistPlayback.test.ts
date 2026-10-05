import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Playlist, Track } from '../types';
import { playerStore } from './playerStore';
import { PlaylistPlaybackError, startPlaylistTracks } from './playlistPlayback';

const playlist: Playlist = {
  playlistId: 'saavn-list-1',
  name: 'Test playlist',
  author: 'Test artist',
  thumbnails: [],
  type: 'PLAYLIST',
  source: 'saavn',
};

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    author: 'Test artist',
    thumbnail: '',
    duration: '3:00',
    durationSeconds: 180,
    url: '',
    source: 'saavn',
    type: 'SONG',
  };
}

describe('playlist playback queue', () => {
  it('queues only playable tracks and starts at the selected playlist index', () => {
    const first = track('song-1');
    const second = track('song-2');
    const fakePlaylistTrack = { id: 'playlist-id', playlistId: 'playlist-id', type: 'PLAYLIST' };

    startPlaylistTracks(playlist, [first, fakePlaylistTrack, second], 2);

    assert.deepEqual(playerStore.queue().map((item) => item.id), ['song-1', 'song-2']);
    assert.equal(playerStore.current()?.id, 'song-2');
    assert.ok(playerStore.queueMetas().every((meta) => meta.addedBy === 'playlist'));
    assert.ok(playerStore.queueMetas().every((meta) => meta.playlistId === playlist.playlistId));
  });

  it('rejects an empty or entirely invalid playlist', () => {
    assert.throws(
      () => startPlaylistTracks(playlist, [{ id: 'not-a-track', type: 'PLAYLIST', playlistId: 'x' }]),
      (error: unknown) => error instanceof PlaylistPlaybackError && error.code === 'NO_PLAYABLE_TRACKS',
    );
  });
});
