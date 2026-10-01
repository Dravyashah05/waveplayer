import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveYouTubeAudio, selectBestAudioFormat, YOUTUBE_VIDEO_ID, type SongStreamData } from './youtubeStream';

describe('YouTube audio resolver selection', () => {
  const audioUrl = 'https://rr1.googlevideo.com/audio?expire=2000000000';
  it('validates canonical 11-character video IDs', () => {
    assert.equal(YOUTUBE_VIDEO_ID.test('dQw4w9WgXcQ'), true);
    assert.equal(YOUTUBE_VIDEO_ID.test('invalid'), false);
  });
  it('selects a directly exposed audio-only format near the preferred bitrate', () => {
    const selected = selectBestAudioFormat([
      { url: 'https://rr1.googlevideo.com/video', mimeType: 'video/mp4', bitrate: 100_000 },
      { url: audioUrl, mimeType: 'audio/webm; codecs="opus"', bitrate: 128_000 },
      { url: 'https://rr2.googlevideo.com/audio2', mimeType: 'audio/webm', bitrate: 256_000 },
    ]);
    assert.equal(selected?.bitrate, 128_000);
  });
  it('does not decipher cipher-only formats or accept arbitrary hosts', () => {
    assert.equal(selectBestAudioFormat([
      { signatureCipher: 'opaque', mimeType: 'audio/mp4' },
      { url: 'https://example.com/audio', mimeType: 'audio/mp4' },
    ]), null);
  });
  it('returns typed stream metadata and expiry from the selected URL', async () => {
    const song: SongStreamData = { videoId: 'dQw4w9WgXcQ', adaptiveFormats: [{ url: audioUrl, mimeType: 'audio/mp4', bitrate: 128_000, contentLength: '42' }] };
    const result = await resolveYouTubeAudio(song.videoId as string, async () => song);
    assert.equal(result?.mimeType, 'audio/mp4');
    assert.equal(result?.expiresAt, 2_000_000_000_000);
    assert.equal(result?.contentLength, 42);
  });
  it('rejects invalid IDs before querying the metadata library', async () => {
    let called = false;
    await assert.rejects(resolveYouTubeAudio('nope', async () => { called = true; return {}; }), /INVALID_VIDEO_ID/);
    assert.equal(called, false);
  });
  it('rejects a mismatched metadata result and gracefully reports no usable audio', async () => {
    assert.equal(await resolveYouTubeAudio('dQw4w9WgXcQ', async () => ({ videoId: 'aaaaaaaaaaa' })), null);
    assert.equal(await resolveYouTubeAudio('dQw4w9WgXcQ', async () => ({ videoId: 'dQw4w9WgXcQ', adaptiveFormats: [] })), null);
  });
});
