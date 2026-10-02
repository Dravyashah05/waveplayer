import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../types';
import { AudioSourceManager, YOUTUBE_PLAYER_SOURCE_ID } from './audioSourceManager';
import type { AudioSource, ResolvedAudio as AdapterResolvedAudio } from './audioSources';
import { settingsStore } from './settingsStore';

function track(id: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title: 'Test Title',
    author: 'Test Artist',
    thumbnail: '',
    duration: '3:00',
    durationSeconds: 180,
    url: '',
    ...extra,
  };
}

function fakeSource(
  id: string,
  resolve: (t: Track) => AdapterResolvedAudio | null | Promise<AdapterResolvedAudio | null>,
): AudioSource {
  return {
    id,
    name: id,
    type: 'custom',
    capabilities: { codecs: [], maxBitrateKbps: null, lossless: false, formats: [] },
    isEnabled: () => true,
    resolve: async (t: Track) => resolve(t),
    healthCheck: async () => ({ ok: true, detail: 'fake' }),
  };
}

const direct = (url: string, extra: Partial<AdapterResolvedAudio> = {}): AdapterResolvedAudio => ({
  url,
  source: 'custom',
  sourceId: 'fake',
  ...extra,
});

function freshManager(): AudioSourceManager {
  return new AudioSourceManager();
}

describe('AudioSourceManager', () => {
  it('resolves from the first succeeding source and records tried', async () => {
    const m = freshManager();
    const adapters = [
      fakeSource('first', () => direct('https://cdn.example/a.mp3')),
      fakeSource('second', () => direct('https://cdn.example/b.mp3')),
    ];
    const t = track('mgr-success-1');
    const { resolved, tried, fromCache } = await m.resolve(t, { adapters });
    assert.equal(resolved?.url, 'https://cdn.example/a.mp3');
    assert.equal(resolved?.sourceId, 'first');
    assert.equal(resolved?.type, 'direct');
    assert.deepEqual(tried, ['first']);
    assert.equal(fromCache, false);
  });

  it('falls back to the next source when the first fails', async () => {
    const m = freshManager();
    const adapters = [
      fakeSource('broken', () => null),
      fakeSource('backup', () => direct('https://cdn.example/ok.mp3')),
    ];
    const { resolved, tried } = await m.resolve(track('mgr-fallback-1'), { adapters });
    assert.equal(resolved?.url, 'https://cdn.example/ok.mp3');
    assert.equal(resolved?.sourceId, 'backup');
    assert.deepEqual(tried, ['broken', 'backup']);
  });

  it('returns null with full tried list when every source fails', async () => {
    const m = freshManager();
    const adapters = [
      fakeSource('nope-a', () => null),
      fakeSource('nope-b', async () => {
        throw new Error('boom');
      }),
    ];
    const { resolved, tried } = await m.resolve(track('LOCAL-NOT-YT-ID-xyz', { streamUrl: 'https://cdn.example/provided.mp3' }), { adapters });
    assert.equal(resolved, null);
    assert.deepEqual(tried, ['nope-a', 'nope-b']);
    // Throwing adapters are reported without breaking the chain.
    assert.match(m.getLastError('nope-b')?.message || '', /boom/);
  });

  it('honors adapter order as priority (first success wins)', async () => {
    const one = track('mgr-prio-1');
    const two = track('mgr-prio-2');
    const a = fakeSource('alpha', () => direct('https://cdn.example/alpha.mp3'));
    const b = fakeSource('beta', () => direct('https://cdn.example/beta.mp3'));
    const m = freshManager();
    const first = await m.resolve(one, { adapters: [a, b] });
    assert.equal(first.resolved?.sourceId, 'alpha');
    assert.deepEqual(first.tried, ['alpha']);
    const second = await m.resolve(two, { adapters: [b, a] });
    assert.equal(second.resolved?.sourceId, 'beta');
    assert.deepEqual(second.tried, ['beta']);
  });

  it('skips disabled sources without probing them', async () => {
    const prev = [...settingsStore.get().disabledSources];
    settingsStore.set('disabledSources', [...prev, 'skipped-src']);
    try {
      let probed = 0;
      const adapters = [
        fakeSource('skipped-src', () => {
          probed++;
          return direct('https://cdn.example/no.mp3');
        }),
        fakeSource('fallback-src', () => direct('https://cdn.example/yes.mp3')),
      ];
      const m = freshManager();
      const { resolved, tried } = await m.resolve(track('mgr-disabled-1'), { adapters });
      assert.equal(probed, 0);
      assert.equal(resolved?.sourceId, 'fallback-src');
      assert.deepEqual(tried, ['fallback-src']);
    } finally {
      settingsStore.set('disabledSources', prev);
    }
  });

  it('treats already-expired URLs as a miss and never caches them', async () => {
    let calls = 0;
    const adapters = [
      fakeSource('expiring', () => {
        calls++;
        return direct('https://cdn.example/old.mp3', { expiresAt: Date.now() - 1_000 });
      }),
    ];
    const m = freshManager();
    const t = track('LOCAL-EXPIRED-xyz', { streamUrl: 'https://cdn.example/provided.mp3' });
    const first = await m.resolve(t, { adapters });
    assert.equal(first.resolved, null);
    assert.equal(calls, 1);
    const second = await m.resolve(t, { adapters });
    assert.equal(second.resolved, null);
    assert.equal(second.fromCache, false);
    assert.equal(calls, 2);
  });

  it('caches fresh URLs so repeat resolutions hit no source', async () => {
    let calls = 0;
    const adapters = [
      fakeSource('fresh', () => {
        calls++;
        return direct('https://cdn.example/fresh.mp3', { expiresAt: Date.now() + 600_000 });
      }),
    ];
    const m = freshManager();
    const t = track('mgr-cache-1');
    const first = await m.resolve(t, { adapters });
    assert.equal(first.fromCache, false);
    assert.equal(calls, 1);
    const second = await m.resolve(t, { adapters });
    assert.equal(second.fromCache, true);
    assert.equal(second.resolved?.url, 'https://cdn.example/fresh.mp3');
    assert.equal(calls, 1);
    assert.ok(m.hasCached(t.id));
  });

  it('deduplicates overlapping resolutions and lets the latest refresh win', async () => {
    let calls = 0;
    let release!: (v: AdapterResolvedAudio | null) => void;
    const gate = fakeSource('gated', () => {
      calls++;
      return new Promise<AdapterResolvedAudio | null>((resolve) => {
        release = resolve;
      });
    });
    const m = freshManager();
    const t = track('mgr-stale-1');
    const p1 = m.resolve(t, { adapters: [gate] });
    const p2 = m.resolve(t, { adapters: [gate] });
    assert.equal(calls, 1);
    release(direct('https://cdn.example/v1.mp3'));
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.resolved?.url, 'https://cdn.example/v1.mp3');
    assert.equal(r2.resolved?.url, 'https://cdn.example/v1.mp3');
    // A forced refresh after the adapter changes returns the new value —
    // stale results never overwrite the current track's source.
    const v2 = fakeSource('v2', () => direct('https://cdn.example/v2.mp3'));
    const r3 = await m.resolve(t, { adapters: [v2], forceRefresh: true });
    assert.equal(r3.resolved?.url, 'https://cdn.example/v2.mp3');
    assert.equal(r3.fromCache, false);
  });

  it('falls back to the YouTube player when no direct source resolves', async () => {
    const m = freshManager();
    const ytId = 'dQw4w9WgXcQ';
    const { resolved, tried } = await m.resolve(track(ytId, { source: 'ytmusic' }), { adapters: [] });
    assert.equal(resolved?.type, 'iframe');
    assert.equal(resolved?.sourceId, YOUTUBE_PLAYER_SOURCE_ID);
    assert.equal(resolved?.ytId, ytId);
    assert.deepEqual(tried, [YOUTUBE_PLAYER_SOURCE_ID]);
  });

  it('upgrades http URLs to https and never fabricates metadata', async () => {
    const m = freshManager();
    const adapters = [fakeSource('plain', () => direct('http://cdn.example/insecure.mp3'))];
    const { resolved } = await m.resolve(track('mgr-meta-1'), { adapters });
    assert.equal(resolved?.url, 'https://cdn.example/insecure.mp3');
    assert.equal(resolved?.bitrateKbps, undefined);
    assert.equal(resolved?.mimeType, undefined);
    assert.equal(resolved?.expiresAt, undefined);
  });

  it('prevents duplicate source registration', () => {
    const m = freshManager();
    const dup = fakeSource('dup-src', () => null);
    assert.equal(m.register(dup), true);
    assert.equal(m.register(dup), false);
    assert.equal(m.register(fakeSource('saavn', () => null)), false);
    assert.equal(m.unregister('dup-src'), true);
    assert.equal(m.unregister('dup-src'), false);
  });

  it('rejects invalid tracks without touching any source', async () => {
    let calls = 0;
    const adapters = [
      fakeSource('never', () => {
        calls++;
        return direct('https://cdn.example/x.mp3');
      }),
    ];
    const m = freshManager();
    const { resolved, tried } = await m.resolve({} as Track, { adapters });
    assert.equal(resolved, null);
    assert.deepEqual(tried, []);
    assert.equal(calls, 0);
  });
});
