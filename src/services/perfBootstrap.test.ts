import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_MAX, CACHE_TTL, REQUEST_POLICY, evictOldest, isExpired } from './cacheConfig';
import { ResilientFetchError, fetchJsonResilient } from './resilientFetch';

describe('central cache config', () => {
  it('separates public, user and player TTLs sanely', () => {
    // Static lives longest; history shortest-refresh; recommendations moderate.
    assert.ok(CACHE_TTL.publicStaticMs >= CACHE_TTL.recommendationsMs);
    assert.ok(CACHE_TTL.homeMs >= CACHE_TTL.recommendationsMs);
    assert.ok(CACHE_TTL.historyMs >= CACHE_TTL.userLibraryMs);
    assert.ok(CACHE_MAX.serviceWorkerRuntime <= 200);
  });

  it('detects expiry against a TTL', () => {
    const now = 1_000_000;
    assert.equal(isExpired(now - 61_000, 60_000, now), true);
    assert.equal(isExpired(now - 10_000, 60_000, now), false);
  });

  it('evicts the oldest entry of a bounded cache', () => {
    const m = new Map([['a', 1], ['b', 2]]);
    evictOldest(m, 2);
    assert.ok(!m.has('a') && m.has('b'));
    evictOldest(m, 5);
    assert.equal(m.size, 1);
  });

  it('never retries recommendations/background aggressively', () => {
    assert.equal(REQUEST_POLICY.recommendation.retries, 0);
    assert.equal(REQUEST_POLICY.background.retries, 0);
    assert.ok(REQUEST_POLICY.critical.retries <= 1);
  });
});

describe('resilient fetch', () => {
  it('surfaces auth failures immediately without retry', async () => {
    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      return { ok: false, status: 401, json: async () => ({}) };
    };
    await assert.rejects(fetchJsonResilient('/x', { policy: 'critical' }), (e: any) => {
      assert.equal(e.code, 'AUTH_REQUIRED');
      return true;
    });
    assert.equal(calls, 1);
  });

  it('retries timeouts once for critical, never for background', async () => {
    let criticalCalls = 0;
    (globalThis as any).fetch = async () => {
      criticalCalls++;
      throw new TypeError('down');
    };
    await assert.rejects(fetchJsonResilient('/x', { policy: 'critical' }), ResilientFetchError);
    assert.equal(criticalCalls, 2);
    let bgCalls = 0;
    (globalThis as any).fetch = async () => {
      bgCalls++;
      throw new TypeError('down');
    };
    await assert.rejects(fetchJsonResilient('/x', { policy: 'background' }), ResilientFetchError);
    assert.equal(bgCalls, 1);
  });
});
