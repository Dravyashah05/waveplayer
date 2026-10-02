import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex } from './md5';
import { shouldScrobble } from './scrobbleService';
import { describeStream, normalizeAudioMetadata, normalizeNetworkType } from './audioSources';
import { AudioSourceManager } from './audioSourceManager';
import { canSeekLyricsLine, isManualScrollSuspended, manualScrollUntil, normalizeLyrics, wordAt } from './lyricsSources';
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
    assert.equal(s.bitrate, 'Unknown');
    assert.equal(s.lossless, null);
    assert.equal(s.sampleRate, 'Unknown');
    const y = describeStream({ url: 'https://x', source: 'youtube', sourceId: 'youtube', mimeType: 'audio/webm; codecs=opus', bitrateKbps: 160 });
    assert.equal(y.codec, 'Opus');
    assert.equal(y.bitrate, '160 kbps');
    const u = describeStream({ url: 'not a url', source: 'youtube', sourceId: 'youtube' });
    assert.equal(u.codec, 'Unknown');
    assert.equal(u.host, 'Unknown');
  });

  it('normalizes JioSaavn and YouTube metadata only when resolvers provide it', () => {
    const saavn = normalizeAudioMetadata({ url: 'https://cdn.test/audio', source: 'saavn', sourceId: 'saavn', mimeType: 'audio/aac', bitrateKbps: 320 });
    assert.equal(saavn.source, 'JioSaavn');
    assert.equal(saavn.codec, 'AAC');
    assert.equal(saavn.bitrate, 320);
    assert.equal(saavn.isLossless, false);

    const youtube = normalizeAudioMetadata({ url: 'https://cdn.test/audio', source: 'youtube', sourceId: 'youtube', mimeType: 'audio/webm; codecs=opus', bitrateKbps: 160 });
    assert.equal(youtube.source, 'YouTube');
    assert.equal(youtube.codec, 'Opus');
    assert.equal(youtube.bitrate, 160);
    assert.equal(youtube.isLossless, false);
  });

  it('keeps missing metadata unknown and uses current resolved-track duration', () => {
    const missing = normalizeAudioMetadata({ url: 'not a url', source: 'youtube', sourceId: 'youtube' });
    assert.equal(missing.codec, undefined);
    assert.equal(missing.bitrate, undefined);
    assert.equal(missing.sampleRate, undefined);
    assert.equal(missing.bitDepth, undefined);
    assert.equal(missing.channels, undefined);
    assert.equal(missing.isLossless, undefined);

    const firstTrack = normalizeAudioMetadata({ url: 'x', source: 'saavn', sourceId: 'saavn' }, 183);
    const nextTrack = normalizeAudioMetadata({ url: 'y', source: 'youtube', sourceId: 'youtube' }, 241);
    assert.equal(firstTrack.duration, 183);
    assert.equal(nextTrack.duration, 241);
  });

  it('reflects source fallback and network type changes from current metadata', () => {
    const fallback = normalizeAudioMetadata({ url: 'https://cdn.test/fallback', source: 'youtube', sourceId: 'youtube', mimeType: 'audio/mp4; codecs=mp4a.40.2', bitrate: 128 });
    assert.equal(fallback.source, 'YouTube');
    assert.equal(fallback.codec, 'AAC');
    assert.equal(fallback.bitrate, 128);
    assert.equal(normalizeNetworkType({ effectiveType: '4g' }), '4g');
    assert.equal(normalizeNetworkType({ type: 'wifi' }), 'wifi');
    assert.equal(normalizeNetworkType(null), undefined);
  });

  it('reports the fallback source selected by the source manager', async () => {
    const manager = new AudioSourceManager();
    const failedSource = {
      id: 'saavn', name: 'JioSaavn', type: 'saavn' as const,
      capabilities: { codecs: [], maxBitrateKbps: null, lossless: false, formats: [] },
      isEnabled: () => true, resolve: async () => null,
      healthCheck: async () => ({ ok: true, detail: 'ok' }),
    };
    const fallbackSource = {
      id: 'youtube', name: 'YouTube', type: 'youtube' as const,
      capabilities: { codecs: [], maxBitrateKbps: null, lossless: false, formats: [] },
      isEnabled: () => true,
      resolve: async () => ({ url: 'https://stream.test/audio', source: 'youtube' as const, sourceId: 'youtube', mimeType: 'audio/webm; codecs=opus', bitrateKbps: 128 }),
      healthCheck: async () => ({ ok: true, detail: 'ok' }),
    };
    const result = await manager.resolve({ id: 'fallback-test', title: 'Song', author: 'Artist', thumbnail: '', duration: '', durationSeconds: 180, url: '', source: 'saavn' }, { adapters: [failedSource, fallbackSource] });
    assert.equal(result.resolved?.sourceId, 'youtube');
    assert.equal(result.resolved?.mimeType, 'audio/webm; codecs=opus');
    assert.equal(result.resolved?.bitrateKbps, 128);
  });
});

describe('lyrics word timing', () => {
  it('finds active line+word, degrades without word data', () => {
    const legacy = [
      { time: 0, text: 'hello world', words: [{ text: 'hello', start: 0, end: 0.5 }, { text: 'world', start: 0.5, end: 1 }] },
      { time: 10, text: 'plain line' },
    ];
    const synced = normalizeLyrics('test', legacy, null)!;
    assert.equal(synced.synced, true);
    assert.deepEqual(wordAt(synced.lines, 0.7), { line: 0, word: 1 });
    assert.deepEqual(wordAt(synced.lines, 10.5), { line: 1, word: -1 });
    assert.deepEqual(wordAt([], 5), { line: -1, word: -1 });
  });

  it('normalizes unsynced lines without inventing timestamps and handles unavailable lyrics', () => {
    const lyrics = normalizeLyrics('official', null, ['  One line  ', 'Second line']);
    assert.deepEqual(lyrics?.lines, [{ text: 'One line' }, { text: 'Second line' }]);
    assert.equal(lyrics?.synced, false);
    assert.deepEqual(normalizeLyrics('none', null, null), null);
    assert.equal(wordAt(lyrics?.lines || [], 42).line, -1);
  });

  it('uses line timing when word timing is absent and permits seek only for timestamped lines', () => {
    const lyrics = normalizeLyrics('lrc', [{ time: 12, text: 'line one' }, { time: 17, text: 'line two' }], null)!;
    assert.deepEqual(wordAt(lyrics.lines, 13), { line: 0, word: -1 });
    assert.equal(canSeekLyricsLine(lyrics.lines[0]), true);
    assert.equal(canSeekLyricsLine({ text: 'plain' }), false);
  });

  it('tracks play, pause, seek, and next-track positions from playback time', () => {
    const first = normalizeLyrics('lrc', [{ time: 0, text: 'start' }, { time: 20, text: 'next line' }], null)!;
    const nextTrack = normalizeLyrics('lrc', [{ time: 0, text: 'new track' }], null)!;
    assert.equal(wordAt(first.lines, 2).line, 0); // playing
    assert.equal(wordAt(first.lines, 2).line, 0); // paused: position remains stable
    assert.equal(wordAt(first.lines, 22).line, 1); // seek
    assert.equal(wordAt(nextTrack.lines, 1).line, 0); // next track reset
  });

  it('pauses auto-scroll temporarily on manual scroll and resumes after the hold or button action', () => {
    const until = manualScrollUntil(1_000);
    assert.equal(until, 11_000);
    assert.equal(isManualScrollSuspended(until, 5_000), true);
    assert.equal(isManualScrollSuspended(until, 11_001), false);
    const resumedUntil = 0; // Resume sync clears the hold immediately.
    assert.equal(isManualScrollSuspended(resumedUntil, 5_000), false);
  });
});

describe('palette cache', () => {
  it('keys deterministically and falls back with no URL', async () => {
    assert.equal(paletteCacheKey('a'), paletteCacheKey('a'));
    assert.notEqual(paletteCacheKey('a'), paletteCacheKey('b'));
    assert.deepEqual(await extractPalette(''), DEFAULT_PALETTE);
  });
});
