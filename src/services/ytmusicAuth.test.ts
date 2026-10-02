import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkYTMusicAuth } from './ytmusicApi';

describe('ytmusic auth probe', () => {
  it('queries the real gateway status endpoint (never a missing route)', async () => {
    const seen: string[] = [];
    (globalThis as any).fetch = async (url: string) => {
      seen.push(String(url));
      return { ok: true, status: 200, json: async () => ({ authenticated: true }) };
    };
    const r = await checkYTMusicAuth();
    assert.ok(seen.some((u) => u.includes('/api/ytmusic-py/auth/status')));
    assert.ok(!seen.some((u) => u.includes('/api/ytmusic/auth/status')));
    assert.equal(r.authenticated, true);
    assert.equal(r.mode, 'ytmusic');
  });

  it('degrades honestly when the service is down', async () => {
    (globalThis as any).fetch = async () => ({
      ok: false, status: 503, json: async () => ({}),
    });
    const r = await checkYTMusicAuth();
    assert.equal(r.authenticated, false);
    assert.equal(r.mode, 'anonymous');
  });
});
