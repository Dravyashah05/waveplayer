import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../../types';
import { cleanTitle, detectVersion, normalizeArtist, normalizeText } from './metadataNormalizer';
import { matchSongs } from './songMatcher';
import { diversify } from './diversity';
import { skipPenalty } from '../listeningStore';
import { tasteScore } from '../userProfile';

const track = (title: string, author = 'Artist', extra: Partial<Track> = {}): Track => ({
  id: `${title}-${author}`, title, author, thumbnail: '', duration: '3:00', durationSeconds: 180,
  url: '', source: 'saavn', ...extra,
});

describe('recommendation identity', () => {
  it('normalizes case, punctuation, and upload noise', () => {
    assert.equal(normalizeText('SONG NAME'), normalizeText('Song Name'));
    assert.equal(cleanTitle('Song Name - Official Audio'), 'Song Name');
    assert.equal(cleanTitle('Song Name (Official Music Video)'), 'Song Name');
    assert.equal(normalizeArtist('Artist feat. Guest'), 'artist');
  });
  it('preserves recording version distinctions', () => {
    assert.equal(detectVersion('Song Name - Remix'), 'remix');
    assert.equal(matchSongs(track('Song Name'), track('song name - Official Audio')).isMatch, true);
    assert.equal(matchSongs(track('Song Name'), track('Song Name Remix')).isMatch, false);
  });
  it('requires corroborating artist metadata and uses duration/ISRC evidence', () => {
    assert.equal(matchSongs(track('Song Name'), track('Song Name', 'Other Artist')).isMatch, false);
    const isrcMatch = matchSongs(track('Completely Different', 'Artist', { isrc: 'USABC1234567' }), track('Other', 'Someone', { isrc: 'USABC1234567' }));
    assert.equal(isrcMatch.confidence, 0.98);
  });
  it('spreads first recommendations across artists and albums, without duplicate recordings', () => {
    const picks = diversify([
      track('A', 'One', { albumName: 'X' }), track('B', 'One', { albumName: 'X' }),
      track('C', 'One', { albumName: 'X' }), track('D', 'Two', { albumName: 'Y' }),
      track('A - Official Audio', 'One', { albumName: 'X' }),
    ], 4);
    assert.equal(picks.length, 3);
    assert.equal(picks[0].title, 'A');
  });
  it('penalizes immediate skips more than late skips', () => {
    assert.equal(skipPenalty(5, 200), 1);
    assert.equal(skipPenalty(180, 200), 0);
  });
  it('boosts a favorite artist over an unknown artist', () => {
    const profile = { artists: { artist: 1 }, languages: {}, genres: {}, moods: {}, updatedAt: '', totalPlays: 4 };
    assert.ok(tasteScore(track('Song', 'Artist'), profile) > tasteScore(track('Song', 'Unknown'), profile));
  });
});
