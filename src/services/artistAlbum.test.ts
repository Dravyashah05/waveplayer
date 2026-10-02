import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  albumIdentity,
  artistIdentity,
  artistsShareEvidence,
  cleanDuration,
  cleanText,
  detectEdition,
  detectReleaseType,
  isAlbumSaved,
  isArtistFollowed,
  pickArtwork,
  rankSongsForArtist,
  toggleAlbumSaved,
  toggleArtistFollow,
} from './artistAlbum';
import type { Track } from '../types';

// In-memory localStorage stub (Node has none; module touches it lazily).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

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

describe('artist + album experience 2.0', () => {
  beforeEach(() => mem.clear());

  it('cleans metadata without touching meaning', () => {
    assert.equal(cleanText('  Arijit   Singh  '), 'Arijit Singh');
    assert.equal(cleanText('Adele - Topic'), 'Adele');
    assert.equal(cleanText('   '), undefined);
    assert.equal(cleanText(null), undefined);
    assert.equal(cleanText('Kesariya (From "Brahmastra")'), 'Kesariya (From "Brahmastra")');
    assert.equal(cleanDuration(268.7), 268);
    assert.equal(cleanDuration(-5), 0);
    assert.equal(cleanDuration('abc'), 0);
  });

  it('picks the largest artwork and never fabricates URLs', () => {
    const thumbs = [
      { url: 'http://small', width: 60, height: 60 },
      { url: 'http://big', width: 500, height: 500 },
    ];
    assert.equal(pickArtwork(thumbs), 'http://big');
    assert.equal(pickArtwork([]), undefined);
    assert.equal(pickArtwork(undefined, 'fallback'), 'fallback');
  });

  it('detects editions so Deluxe/Remaster/Live are never collapsed', () => {
    assert.equal(detectEdition('After Hours (Deluxe)'), 'Deluxe');
    assert.equal(detectEdition('After Hours (Remastered 2022)'), 'Remaster');
    assert.equal(detectEdition('After Hours (Live at SoFi)'), 'Live');
    assert.equal(detectEdition('After Hours (10th Anniversary)'), 'Anniversary');
    assert.equal(detectEdition('After Hours'), null);
  });

  it('classifies release types from titles and counts', () => {
    assert.equal(detectReleaseType('Blinding Lights - Single'), 'Single');
    assert.equal(detectReleaseType('Anything', 1), 'Single');
    assert.equal(detectReleaseType('Summer EP', 4), 'EP');
    assert.equal(detectReleaseType('Anything', 4), 'EP');
    assert.equal(detectReleaseType('Dune Soundtrack'), 'Soundtrack');
    assert.equal(detectReleaseType('After Hours', 14), 'Album');
    assert.equal(detectReleaseType('After Hours'), 'Album');
  });

  it('builds strict identities (never fuzzy-only)', () => {
    assert.equal(artistIdentity('Arijit Singh'), artistIdentity('  arijit  SINGH '));
    assert.notEqual(artistIdentity('Arijit Singh'), artistIdentity('Arijit Sharma'));
    assert.equal(
      albumIdentity('After Hours', 'The Weeknd', 2020),
      albumIdentity('after hours', 'the weeknd', 2020),
    );
    assert.notEqual(
      albumIdentity('After Hours', 'The Weeknd', 2020),
      albumIdentity('After Hours', 'The Weeknd', 2022),
    );
  });

  it('requires shared evidence before merging artists', () => {
    const aTracks = [track({ id: 'a1', title: 'Kesariya' })];
    const bTracks = [track({ id: 'b1', title: 'Kesariya (Duet Version)' })];
    // Different normalized titles share nothing...
    assert.equal(
      artistsShareEvidence(aTracks, [], [track({ id: 'b2', title: 'Totally Different' })], []),
      false,
    );
    // ...but overlapping album titles count as evidence.
    assert.equal(artistsShareEvidence(aTracks, ['Brahmastra'], bTracks, ['brahmastra']), true);
  });

  it('ranks heard songs first without reordering the unheard', () => {
    // No listening history in this env → stable provider order preserved.
    const a = track({ id: 'r1', title: 'A' });
    const b = track({ id: 'r2', title: 'B' });
    assert.deepEqual(rankSongsForArtist([a, b]).map((t) => t.id), ['r1', 'r2']);
    assert.deepEqual(rankSongsForArtist([]), []);
  });

  it('follows artists as a Wave-side concept (separate from YT)', () => {
    assert.equal(isArtistFollowed('saavn_1'), false);
    assert.equal(toggleArtistFollow({ id: 'saavn_1', name: 'Arijit Singh' }), true);
    assert.equal(isArtistFollowed('saavn_1'), true);
    assert.equal(toggleArtistFollow({ id: 'saavn_1', name: 'Arijit Singh' }), false);
    assert.equal(isArtistFollowed('saavn_1'), false);
    assert.equal(toggleArtistFollow({ id: '', name: 'Nobody' }), false);
  });

  it('saves albums as a Wave-side concept', () => {
    assert.equal(isAlbumSaved('alb_1'), false);
    assert.equal(toggleAlbumSaved({ id: 'alb_1', title: 'After Hours', artist: 'The Weeknd' }), true);
    assert.equal(isAlbumSaved('alb_1'), true);
    assert.equal(toggleAlbumSaved({ id: 'alb_1', title: 'After Hours', artist: 'The Weeknd' }), false);
    assert.equal(isAlbumSaved('alb_1'), false);
  });
});
