import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseResolvedYouTubeAudio } from './ytmusicApi';
import { TemporaryStreamCache, UNKNOWN_STREAM_LIFETIME_MS, IFRAME_FALLBACK_CACHE_MS, canRetryDirectStream, runDeduped } from './temporaryStreamCache';
import type { ResolvedStream } from './playerEngine';
import { resolutionRoute } from './playbackSource';

describe('stream response and player cache', () => {
  const videoId = 'dQw4w9WgXcQ';
  const stream = (extra: Record<string, unknown> = {}) => ({
    success: true, videoId, streamUrl: 'https://rr1.googlevideo.com/audio', mimeType: 'audio/mp4', ...extra,
  });
  it('parses a valid resolver response and rejects invalid or unrelated payloads', () => {
    assert.equal(parseResolvedYouTubeAudio(stream(), videoId)?.mimeType, 'audio/mp4');
    assert.equal(parseResolvedYouTubeAudio(stream({ videoId: 'aaaaaaaaaaa' }), videoId), null);
    assert.equal(parseResolvedYouTubeAudio(stream({ streamUrl: 'https://example.com/x' }), videoId), null);
    assert.equal(parseResolvedYouTubeAudio(stream({ mimeType: 'video/mp4' }), videoId), null);
    assert.equal(parseResolvedYouTubeAudio(stream({ expiresAt: Date.now() + 1_000 }), videoId), null);
  });
  it('serves a cache hit until the URL expiry safety window', () => {
    const cache = new TemporaryStreamCache();
    const value: ResolvedStream = { source: 'youtube-audio', streamUrl: 'https://rr1.googlevideo.com/audio', expiresAt: 20_000 };
    cache.set(videoId, value, 1_000);
    assert.equal(cache.get(videoId, 10_000), value);
    assert.equal(cache.get(videoId, 15_001), undefined);
  });
  it('uses a conservative lifetime when stream expiry is unknown', () => {
    const cache = new TemporaryStreamCache();
    cache.set(videoId, { source: 'youtube-audio', streamUrl: 'https://rr1.googlevideo.com/audio' }, 1_000);
    assert.ok(cache.get(videoId, 1_000 + UNKNOWN_STREAM_LIFETIME_MS - 1));
    assert.equal(cache.get(videoId, 1_000 + UNKNOWN_STREAM_LIFETIME_MS), undefined);
  });
  it('lets a temporary IFrame fallback expire so direct audio can be retried later', () => {
    const cache = new TemporaryStreamCache();
    cache.set(videoId, { source: 'youtube-iframe', ytId: videoId }, 1_000);
    assert.ok(cache.get(videoId, 1_000));
    assert.equal(cache.get(videoId, 1_000 + IFRAME_FALLBACK_CACHE_MS), undefined);
  });
  it('deduplicates simultaneous resolutions and clears failed requests for retry', async () => {
    const pending = new Map<string, Promise<string>>();
    let calls = 0;
    let release!: (value: string) => void;
    const operation = () => { calls++; return new Promise<string>((resolve) => { release = resolve; }); };
    const first = runDeduped(pending, videoId, operation);
    const second = runDeduped(pending, videoId, operation);
    assert.equal(calls, 1);
    release('ok');
    assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
    await assert.rejects(runDeduped(pending, videoId, async () => { throw new Error('failed'); }));
    assert.equal(await runDeduped(pending, videoId, async () => 'retried'), 'retried');
  });
  it('allows one bounded direct-stream retry before IFrame fallback is required', () => {
    assert.equal(canRetryDirectStream(0), true);
    assert.equal(canRetryDirectStream(1), false);
  });
  it('prefers a provided JioSaavn stream and routes canonical YouTube IDs to direct resolution', () => {
    assert.equal(resolutionRoute({ id: 'saavn-id', source: 'saavn', streamUrl: 'https://cdn.example/audio' }), 'provided-audio');
    assert.equal(resolutionRoute({ id: 'saavn-id', source: 'saavn' }), 'saavn');
    assert.equal(resolutionRoute({ id: videoId, source: 'ytmusic' }), 'youtube');
  });
});
