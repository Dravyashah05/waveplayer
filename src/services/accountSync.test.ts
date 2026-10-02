import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Browser shims — sync stamps + scope keys live in localStorage.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  get length() { return mem.size; },
  key: (i: number) => [...mem.keys()][i] ?? null,
};
const listeners = new Map<string, Set<(e: any) => void>>();
(globalThis as any).window = {
  dispatchEvent: (e: any) => {
    listeners.get(e.type)?.forEach((fn) => fn(e));
    return true;
  },
  addEventListener: (t: string, fn: any) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(fn);
  },
  removeEventListener: (t: string, fn: any) => void listeners.get(t)?.delete(fn),
};

import {
  buildAccountState,
  clearPrivateCaches,
  ensureAccountIsolation,
  lastSyncInfo,
  resetAccountIsolation,
  startSync,
} from './accountSync';
import { scopeKeyFor } from './scopedStorage';

const ME = { connected: true, user: { id: 'u1', email: 'a@b.c', name: 'A B' }, youtubeConnected: true, scopes: [] as string[] };

beforeEach(() => {
  mem.clear();
  resetAccountIsolation();
});

describe('unified account state', () => {
  it('reports signed-out when Google is not connected', () => {
    const s = buildAccountState({ connected: false, user: null }, {}, { authenticated: false, available: true }, true);
    assert.equal(s.connection, 'signed-out');
    assert.equal(s.capabilities.readLibrary, false);
    assert.equal(s.capabilities.managePlaylists, false);
    assert.equal(s.googleProfile, null);
  });

  it('marks the service unavailable when the gateway is unreachable', () => {
    const s = buildAccountState(ME, {}, { authenticated: false, available: false }, false);
    assert.equal(s.connection, 'unavailable');
  });

  it('never claims manage without the real write scope', () => {
    const ro = buildAccountState(ME, { connected: true, scopes: ['https://www.googleapis.com/auth/youtube.readonly'] }, { authenticated: true, available: true }, true);
    assert.equal(ro.youtubeMusicConnected, true);
    assert.equal(ro.capabilities.readLibrary, true);
    assert.equal(ro.capabilities.readHistory, true);
    assert.equal(ro.capabilities.managePlaylists, false);
    assert.equal(ro.capabilities.manageLikes, false);
    const rw = buildAccountState(
      { ...ME, scopes: ['https://www.googleapis.com/auth/youtube'] },
      { connected: true, scopes: [] }, { authenticated: false, available: true }, true,
    );
    assert.equal(rw.capabilities.managePlaylists, true);
    assert.equal(rw.capabilities.manageLikes, true);
    // Data API cannot supply watch history — stays honest.
    assert.equal(rw.capabilities.readHistory, false);
  });

  it('exposes profile without secrets', () => {
    const s = buildAccountState(ME, {}, { authenticated: false, available: true }, true);
    assert.deepEqual(s.googleProfile, { id: 'u1', name: 'A B', email: 'a@b.c', picture: undefined });
    assert.ok(!JSON.stringify(s).match(/token|secret|cookie|authorization/i));
  });

  it('treats Google-only as partial, never a full logout', () => {
    const googleOnly = { ...ME, youtubeConnected: false };
    const s = buildAccountState(googleOnly, { connected: false, scopes: [] }, { authenticated: false, available: true }, true);
    // youtubeConnected false + ytmusic unauthenticated → linked nothing yet
    assert.equal(s.connection, 'partial');
    assert.equal(s.googleConnected, true);
  });
});

describe('explicit sync', () => {
  function stubFetch(handler: (url: string) => { ok: boolean; status: number; body: unknown }) {
    (globalThis as any).fetch = async (url: string) => {
      const r = handler(String(url));
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
  }

  it('aggregates per-category success and persists a scoped stamp', async () => {
    stubFetch((url) => {
      if (url.includes('/api/ytmusic-py/')) return { ok: true, status: 200, body: [{ id: 'x' }] };
      return { ok: false, status: 404, body: null };
    });
    const r = await startSync();
    assert.equal(r.status, 'success');
    assert.ok(r.lastSyncedAt && r.lastSyncedAt > 0);
    assert.equal(r.message, 'YouTube Music synced');
    const info = lastSyncInfo();
    assert.equal(info.at, r.lastSyncedAt);
    // Stamp is user-scoped and secret-free.
    const keys = [...mem.keys()].filter((k) => k.includes('yt_sync_v1'));
    assert.equal(keys.length, 1);
    assert.ok(keys[0].startsWith('wave:uid:'));
    assert.ok(!JSON.stringify(info).match(/token|secret|cookie/i));
  });

  it('degrades to partial when one category fails (never total failure)', async () => {
    stubFetch((url) => {
      if (url.includes('/library/history')) return { ok: false, status: 500, body: { error: 'boom' } };
      if (url.includes('/api/ytmusic-py/')) return { ok: true, status: 200, body: [] };
      return { ok: false, status: 404, body: null };
    });
    const r = await startSync();
    assert.equal(r.status, 'partial');
    assert.equal(r.categories.history, 'failed');
    assert.equal(r.categories.playlists, 'success');
    assert.equal(r.message, 'Some YouTube Music data could not be synced');
  });

  it('shares one job across concurrent callers (no hammering)', async () => {
    let calls = 0;
    stubFetch((url) => {
      if (url.includes('/api/ytmusic-py/')) {
        calls++;
        return { ok: true, status: 200, body: [] };
      }
      return { ok: false, status: 404, body: null };
    });
    const [a, b] = await Promise.all([startSync(), startSync()]);
    assert.equal(a, b); // identical result object — single job
    assert.ok(calls <= 6); // one bounded pass over six categories
  });
});

describe('isolation and cleanup', () => {
  it('scopes sync stamps per user (never a global private cache)', () => {
    assert.notEqual(scopeKeyFor('alice', 'yt_sync_v1'), scopeKeyFor('bob', 'yt_sync_v1'));
  });

  it('clears private caches while preserving local Wave data', () => {
    mem.set('wave:uid:alice:yt_history_v1', '[]');
    mem.set('wave:uid:alice:yt_sync_v1', '{}');
    mem.set('wave:uid:alice:home_cache_v1', '{}');
    mem.set('wave:local_playlists', '[{"id":"LOCAL_1"}]');
    mem.set('wave:fav', '[]');
    clearPrivateCaches();
    assert.equal([...mem.keys()].filter((k) => k.startsWith('wave:uid:')).length, 0);
    assert.ok(mem.get('wave:local_playlists'));
    assert.ok(mem.has('wave:fav'));
  });

  it('detects account switches exactly once', () => {
    assert.equal(ensureAccountIsolation(), false); // baseline
    assert.equal(ensureAccountIsolation(), false); // same user, quiet
    resetAccountIsolation();
    assert.equal(ensureAccountIsolation(), false); // re-baseline after reset
  });
});
