import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex } from './md5';
import { shouldScrobble } from './scrobbleService';
import { describeStream } from './audioSources';
import { wordAt } from './lyricsSources';
import { paletteCacheKey, DEFAULT_PALETTE, extractPalette } from './artworkPalette';

describe('md5 signing (Last.fm api_sig vectors)', () => {
  it('matches RFC 1321 test vectors', () => {
    assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(md5Hex('a'), '0cc175b9c0f1b6a831c399e269772661');
    assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
    assert.equal(md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
    assert.equal(md5Hex('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b');
  });
});

describe('scrobble rules', () => {
  it('requires >30s tracks and half (or 4min) listened', () => {
    assert.equal(shouldScrobble(20, 20), false); // too short
    assert.equal(shouldScrobble(200, 50), false); // <50%
    assert.equal(shouldScrobble(200, 100), true);
    assert.equal(shouldScrobble(600, 240), true); // 4-minute cap
    assert.equal(shouldScrobble(600, 100), false);
    assert.equal(shouldScrobble(0, 0), false);
  });
});

describe('stream stats honesty', () => {
  it('reports confirmed values, Unknown otherwise, never lossless', () => {
    const s = describeStream({ url: 'https://x_320.mp3', source: 'saavn', sourceId: 'saavn' });
    assert.equal(s.source, 'JioSaavn');
    assert.equal(s.bitrate, '320 kbps');
    assert.equal(s.lossless, false);
    assert.equal(s.sampleRate, 'Unknown');
    const y = describeStream({ url: 'https://x', source: 'youtube', sourceId: 'youtube', mimeType: 'audio/webm; codecs=opus', bitrateKbps: 160 });
    assert.equal(y.codec, 'Opus');
    assert.equal(y.bitrate, '160 kbps');
    const u = describeStream({ url: 'not a url', source: 'youtube', sourceId: 'youtube' });
    assert.equal(u.codec, 'Unknown');
    assert.equal(u.host, 'Unknown');
  });
});

describe('lyrics word timing', () => {
  it('finds active line+word, degrades without word data', () => {
    const synced = [
      { time: 0, text: 'hello world', words: [{ text: 'hello', start: 0, end: 0.5 }, { text: 'world', start: 0.5, end: 1 }] },
      { time: 10, text: 'plain line' },
    ];
    assert.deepEqual(wordAt(synced, 0.7), { line: 0, word: 1 });
    assert.deepEqual(wordAt(synced, 10.5), { line: 1, word: -1 });
    assert.deepEqual(wordAt([], 5), { line: -1, word: -1 });
  });
});

describe('palette cache', () => {
  it('keys deterministically and falls back with no URL', async () => {
    assert.equal(paletteCacheKey('a'), paletteCacheKey('a'));
    assert.notEqual(paletteCacheKey('a'), paletteCacheKey('b'));
    assert.deepEqual(await extractPalette(''), DEFAULT_PALETTE);
  });
});
