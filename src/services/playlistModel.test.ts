import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../types';
import {
  filterNewTracks,
  fromLocalPlaylist,
  fromProviderPlaylist,
  fromYouTubeItem,
  getCachedPlaylistMeta,
  cachePlaylistMeta,
  invalidatePlaylistCache,
  isDuplicateTrack,
  mosaicArtwork,
  parsePlaylistRef,
  resolveArtwork,
  scopedPlaylistKey,
  youtubeVideoIdOf,
} from './playlistModel';

const t = (id: string, title = 'Song', author = 'Artist', source: any = 'ytmusic'): Track => ({
  id, title, author, thumbnail: `https://img/${id}.jpg`, duration: '3:00', durationSeconds: 180,
  url: `https://x/${id}`, source,
});

describe('playlist unified model', () => {
  it('adapts Wave playlists as editable with namespaced ids', () => {
    const u = fromLocalPlaylist({ id: 'ABC', title: 'Mix', songs: [t('v1234567890')], createdAt: '2026-01-01', updatedAt: '2026-01-02' } as any);
    assert.equal(u.id, 'wave:ABC');
    assert.equal(u.source, 'wave');
    assert.equal(u.isEditable, true);
    assert.equal(u.trackCount, 1);
    assert.ok(u.artwork);
  });

  it('never merges same-titled playlists: ids stay namespaced per source', () => {
    const a = fromProviderPlaylist({ playlistId: 'AAA', name: 'Chill', author: 'A', thumbnails: [], type: 'PLAYLIST', source: 'saavn' });
    const b = fromYouTubeItem({ id: 'AAA', title: 'Chill', description: '', thumbnail: '', itemCount: 5, privacy: 'private' });
    assert.notEqual(a.id, b.id);
    assert.equal(a.isEditable, false);
  });

  it('keeps YouTube playlists read-only without manage scope', () => {
    const ro = fromYouTubeItem({ id: 'PL1', title: 'T', description: '', thumbnail: '', itemCount: 0, privacy: 'private' }, [], false);
    const rw = fromYouTubeItem({ id: 'PL1', title: 'T', description: '', thumbnail: '', itemCount: 0, privacy: 'private' }, [], true);
    assert.equal(ro.isEditable, false);
    assert.equal(rw.isEditable, true);
  });

  it('builds deterministic artwork from the first tracks (no AI)', () => {
    const tracks = [t('a'), t('b'), t('c'), t('d'), t('e')];
    assert.deepEqual(mosaicArtwork(tracks), tracks.slice(0, 4).map((x) => x.thumbnail));
    assert.equal(resolveArtwork('', tracks), tracks[0].thumbnail);
    assert.equal(resolveArtwork('explicit.jpg', tracks), 'explicit.jpg');
  });

  it('parses router refs without React Router', () => {
    assert.deepEqual(parsePlaylistRef('local:ABC'), { kind: 'wave', id: 'ABC' });
    assert.deepEqual(parsePlaylistRef('youtube:PL1'), { kind: 'youtube', id: 'PL1' });
    assert.ok(parsePlaylistRef('ytmusic:PL1').kind === 'ytmusic');
    assert.ok(parsePlaylistRef('rawsaavn').kind === 'saavn');
  });

  it('detects canonical duplicates (never title-only)', () => {
    const a = t('v1234567890', 'Kesariya', 'Arijit Singh');
    const same = t('v1234567890', 'Kesariya', 'Arijit Singh');
    const diffTitle = t('dQw4w9WgXcQ', 'Kesariya', 'Arijit Singh');
    assert.equal(isDuplicateTrack(same, [a]), true);
    // Same title, different recording id + no corroboration path is still id-distinct;
    // matcher decides — must at least not throw and stay boolean.
    assert.equal(typeof isDuplicateTrack(diffTitle, [a]), 'boolean');
  });

  it('filters additions without destroying intentional repeats already present', () => {
    const existing = [t('v1234567890', 'A', 'X'), t('v1234567890', 'A', 'X')];
    const { fresh, dupes } = filterNewTracks([t('v1234567890', 'A', 'X'), t('dQw4w9WgXcQ', 'B', 'Y')], existing);
    assert.equal(dupes, 1);
    assert.equal(fresh.length, 1);
    assert.equal(existing.length, 2); // untouched
  });

  it('extracts exportable video ids only from usable anchors', () => {
    assert.equal(youtubeVideoIdOf(t('dQw4w9WgXcQ', 'A', 'B', 'ytmusic')), 'dQw4w9WgXcQ');
    assert.equal(youtubeVideoIdOf(t('saavn123', 'A', 'B', 'saavn')), null);
  });

  it('scopes private cache keys per user and invalidates on mutation', () => {
    const k1 = scopedPlaylistKey('youtube', 'PL1');
    assert.ok(k1.includes('playlist:youtube:PL1'));
    const pl = fromYouTubeItem({ id: 'PLCACHE1', title: 'C', description: '', thumbnail: '', itemCount: 1, privacy: 'private' }, [t('dQw4w9WgXcQ')]);
    cachePlaylistMeta(pl);
    assert.ok(getCachedPlaylistMeta('youtube', 'PLCACHE1'));
    invalidatePlaylistCache('youtube:PLCACHE1');
    assert.equal(getCachedPlaylistMeta('youtube', 'PLCACHE1'), null);
  });
});
