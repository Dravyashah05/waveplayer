import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveYouTubeAudio } from './ytmusicApi';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('YouTube stream request deduplication', () => {
  it('shares one in-flight resolver request for a video ID', async () => {
    let calls = 0;
    let release!: (value: any) => void;
    globalThis.fetch = (async () => {
      calls++;
      return new Promise((resolve) => { release = resolve; }) as any;
    }) as typeof fetch;
    const a = resolveYouTubeAudio('A1234567890');
    const b = resolveYouTubeAudio('A1234567890');
    assert.equal(calls, 1);
    release({ ok: true, json: async () => ({ success: true, videoId: 'A1234567890', streamUrl: 'https://rr1.googlevideo.com/audio', mimeType: 'audio/mp4' }) });
    const [first, second] = await Promise.all([a, b]);
    assert.deepEqual(first, second);
    assert.equal(first?.videoId, 'A1234567890');
  });

  it('temporarily caches an unavailable result to prevent resolver retry loops', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return { ok: false, status: 503 } as Response;
    }) as typeof fetch;
    assert.equal(await resolveYouTubeAudio('B1234567890'), null);
    assert.equal(await resolveYouTubeAudio('B1234567890'), null);
    assert.equal(calls, 1);
  });
});
