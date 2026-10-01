import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser shims — libraryStore touches localStorage + window events.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  get length() { return mem.size; },
  key: (i: number) => [...mem.keys()][i] ?? null,
};
(globalThis as any).window = { dispatchEvent: () => true };

import type { Track } from '../types';
import {
  addTracksToPlaylist,
  addTrackToPlaylist,
  createLocalPlaylist,
  deleteLocalPlaylist,
  formatTotalDuration,
  getLocalPlaylists,
  removeTrackFromPlaylist,
  saveLocalPlaylists,
  sortTracks,
} from './libraryStore';

function track(id: string, title: string, author = 'Artist', seconds = 180): Track {
  return {
    id, title, author, thumbnail: '', duration: '3:00', durationSeconds: seconds,
    url: `https://x/${id}`, source: 'saavn', type: 'SONG',
  };
}

beforeEach(() => mem.clear());

describe('local playlist CRUD', () => {
  it('creates, renames (via save), deletes, and persists across reads', () => {
    const pl = createLocalPlaylist('  Mix  ', 'desc', [track('a', 'A')]);
    assert.equal(pl.title, 'Mix');
    assert.ok(pl.id.startsWith('LOCAL_'));
    assert.equal(getLocalPlaylists().length, 1);
    saveLocalPlaylists(getLocalPlaylists().map((p) => (p.id === pl.id ? { ...p, title: 'Renamed' } : p)));
    assert.equal(getLocalPlaylists()[0].title, 'Renamed');
    assert.equal(deleteLocalPlaylist(pl.id), true);
    assert.equal(getLocalPlaylists().length, 0);
    assert.equal(deleteLocalPlaylist('missing'), false);
  });

  it('rejects empty titles at the store edge (trims to Untitled)', () => {
    const pl = createLocalPlaylist('   ');
    assert.equal(pl.title, 'Untitled Playlist');
  });
});

describe('add/remove with duplicate protection', () => {
  it('adds once, rejects duplicates, bulk-adds only new', () => {
    const pl = createLocalPlaylist('Mix');
    assert.equal(addTrackToPlaylist(pl.id, track('a', 'A')), true);
    assert.equal(addTrackToPlaylist(pl.id, track('a', 'A')), false);
    assert.equal(addTracksToPlaylist(pl.id, [track('a', 'A'), track('b', 'B'), track('c', 'C')]), 2);
    assert.equal(getLocalPlaylists()[0].songs.length, 3);
  });

  it('removes by id and reports misses', () => {
    const pl = createLocalPlaylist('Mix', '', [track('a', 'A'), track('b', 'B')]);
    assert.equal(removeTrackFromPlaylist(pl.id, 'a'), true);
    assert.equal(removeTrackFromPlaylist(pl.id, 'a'), false);
    assert.deepEqual(getLocalPlaylists()[0].songs.map((s) => s.id), ['b']);
  });
});

describe('reorder persistence', () => {
  it('keeps a manually reordered sequence', () => {
    const pl = createLocalPlaylist('Mix', '', [track('a', 'A'), track('b', 'B'), track('c', 'C')]);
    const all = getLocalPlaylists();
    const target = all.find((p) => p.id === pl.id)!;
    const [moved] = target.songs.splice(0, 1);
    target.songs.push(moved);
    saveLocalPlaylists(all);
    assert.deepEqual(getLocalPlaylists()[0].songs.map((s) => s.id), ['b', 'c', 'a']);
  });
});

describe('sorting and duration', () => {
  const songs = [track('b', 'Beta', 'Zed', 200), track('a', 'Alpha', 'Amy', 300), track('c', 'Gamma', 'Mid', 100)];
  it('sorts title/artist/duration without mutating the source order permanently', () => {
    assert.deepEqual(sortTracks(songs, 'title_asc').map((s) => s.id), ['a', 'b', 'c']);
    assert.deepEqual(sortTracks(songs, 'artist_asc').map((s) => s.id), ['a', 'c', 'b']);
    assert.deepEqual(sortTracks(songs, 'duration_desc').map((s) => s.id), ['a', 'b', 'c']);
    assert.deepEqual(songs.map((s) => s.id), ['b', 'a', 'c']); // input untouched
  });

  it('totals durations across mixed metadata', () => {
    assert.equal(formatTotalDuration(songs), '10 min');
    assert.equal(formatTotalDuration([]), '0 songs');
  });
});
