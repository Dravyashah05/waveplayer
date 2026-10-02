import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_CONFIG,
  deduplicateAlbums,
  deduplicateArtists,
  deduplicatePlaylists,
  deduplicateTracks,
  detectTopResult,
  isStaleRun,
  nextSearchRun,
  rankByName,
  rankSuggestions,
  rankTracks,
} from './searchEngine';
import type { Album, Playlist, SearchArtist, Track } from '../types';

function track(over: Partial<Track> & { id: string }): Track {
  return {
    title: 'Song',
    author: 'Artist',
    thumbnail: '',
    duration: '3:20',
    durationSeconds: 200,
    url: '',
    ...over,
  } as Track;
}

describe('search engine 2.0', () => {
  it('ranks exact title matches above prefix and token matches', () => {
    const exact = track({ id: 'e1', title: 'Kesariya', author: 'Someone Else' });
    const prefix = track({ id: 'e2', title: 'Kesariya Reprise Version', author: 'Someone Else' });
    const token = track({ id: 'e3', title: 'Totally Different Words Here', author: 'Kesariya Fan Club' });
    const out = rankTracks([token, prefix, exact], 'kesariya');
    assert.equal(out[0].id, 'e1');
  });

  it('boosts preferred-language tracks without hiding others', () => {
    const hindi = track({ id: 'l1', title: 'Raabta Exact', author: 'X', language: 'Hindi' });
    const other = track({ id: 'l2', title: 'Raabta Exact', author: 'X' });
    const out = rankTracks([other, hindi], 'raabta exact');
    // Both survive; language order is a tiebreak, not a filter.
    assert.equal(out.length, 2);
    assert.ok(out.find((t) => t.id === 'l1'));
  });

  it('rewards provider popularity via play counts (bounded)', () => {
    const hot = track({ id: 'p1', title: 'Same Title Words', author: 'Same Author', playCount: 50000000 });
    const cold = track({ id: 'p2', title: 'Same Title Words', author: 'Same Author' });
    const out = rankTracks([cold, hot], 'same title words');
    assert.equal(out[0].id, 'p1');
    assert.ok(SEARCH_CONFIG.ranking.playCountMax <= 8);
  });

  it('keeps remaster years distinct when deduplicating albums', () => {
    const a: Album = {
      albumId: 'a1', playlistId: '', name: 'After Hours',
      artist: { artistId: null, name: 'The Weeknd' }, year: 2020,
      thumbnails: [], type: 'ALBUM',
    };
    const b: Album = { ...a, albumId: 'a2', year: 2022 };
    const c: Album = { ...a, albumId: 'a3', year: 2020 };
    const out = deduplicateAlbums([a, b, c]);
    assert.equal(out.length, 2);
    assert.ok(out.some((x) => x.albumId === 'a1'));
    assert.ok(out.some((x) => x.albumId === 'a2'));
  });

  it('keeps same-titled playlists from different owners distinct', () => {
    const mk = (id: string, author: string): Playlist => ({
      playlistId: id, name: 'Chill Vibes', author, thumbnails: [], type: 'PLAYLIST',
    });
    const out = deduplicatePlaylists([mk('p1', 'Asha'), mk('p2', 'Ravi'), mk('p3', 'Asha')]);
    assert.equal(out.length, 2);
  });

  it('prefers artist entries that actually carry artwork', () => {
    const bare: SearchArtist = { artistId: 'x', name: 'Arijit Singh', thumbnails: [], type: 'ARTIST' };
    const rich: SearchArtist = {
      artistId: 'y', name: 'arijit singh',
      thumbnails: [{ url: 'http://img', width: 100, height: 100 }], type: 'ARTIST',
    };
    const out = deduplicateArtists([bare, rich]);
    assert.equal(out.length, 1);
    assert.equal(out[0].artistId, 'y');
  });

  it('ranks names by exact, prefix, then token match (stable ties)', () => {
    const items = [{ n: 'Blue Eyes' }, { n: 'Eyes Blue Remix' }, { n: 'Blue' }];
    const out = rankByName(items, 'blue', (x) => x.n);
    assert.equal(out[0].n, 'Blue');
    assert.equal(out.length, 3);
  });

  it('ranks suggestions: recent-prefix first, provider prefix before contains, capped', () => {
    const out = rankSuggestions('ari', ['Arijit Singh Live', 'Zebra'], [
      'Arijit Singh',
      'arijit singh',
      'Best of Arijit',
      'Arijit Singh Live',
      'Sari Dress Song',
      'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7',
    ]);
    assert.ok(out.length <= SEARCH_CONFIG.suggestionLimit);
    assert.equal(out[0], 'Arijit Singh Live'); // recent prefix match wins
    assert.ok(out.indexOf('Arijit Singh') < out.indexOf('Best of Arijit')); // prefix before contains
    assert.equal(new Set(out.map((s) => s.toLowerCase())).size, out.length); // deduped
    assert.deepEqual(rankSuggestions('   ', [], ['a']), []);
  });

  it('detects playlist top results for playlist queries', () => {
    const pl: Playlist = { playlistId: 'pl1', name: 'Lofi Girl Radio', author: 'Lofi', thumbnails: [], type: 'PLAYLIST' };
    const top = detectTopResult('lofi girl radio', [], [], [], [pl]);
    assert.ok(top);
    assert.equal(top!.type, 'playlist');
  });

  it('guards against stale runs monotonically', () => {
    const first = nextSearchRun();
    const second = nextSearchRun();
    assert.ok(second > first);
    assert.equal(isStaleRun(first), true);
    assert.equal(isStaleRun(second), false);
    assert.equal(isStaleRun(second + 999), true);
  });

  it('merges duplicate cross-provider tracks without losing versions', () => {
    const yt = track({ id: 'dQw4w9WgXcQ', title: 'Kesariya', author: 'Arijit Singh', source: 'ytmusic', durationSeconds: 268, duration: '4:28' });
    const saavn = track({
      id: 'saavn_1', title: 'Kesariya', author: 'Arijit Singh', source: 'saavn',
      streamUrl: 'https://audio/320.mp3', durationSeconds: 268, duration: '4:28',
    });
    const remix = track({ id: 'dQw4w9WgXcR', title: 'Kesariya (Remix)', author: 'Arijit Singh', source: 'ytmusic' });
    const out = deduplicateTracks([yt, saavn, remix]);
    assert.equal(out.length, 2); // merged pair + distinct remix
    const merged = out.find((t) => t.id === 'dQw4w9WgXcQ')!;
    assert.equal(merged.streamUrl, 'https://audio/320.mp3'); // gap-filled
  });
});
