import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, rateLimit } from './rateLimit.js';

function fakeReq(ip = '9.9.9.9') {
  return { headers: {}, socket: { remoteAddress: ip } } as any;
}

function fakeRes() {
  const res: any = { statusCode: 200, body: null as any, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => void (res.headers[k] = v);
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res;
}

describe('API rate limiting', () => {
  it('allows traffic under budget and returns 429 JSON past it', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3, prefix: 'test-basic' });
    for (let i = 0; i < 3; i++) {
      let nexted = false;
      await mw(fakeReq('10.1.2.3'), fakeRes(), () => void (nexted = true));
      assert.equal(nexted, true);
    }
    let nexted = false;
    const res = fakeRes();
    await mw(fakeReq('10.1.2.3'), res, () => void (nexted = true));
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 429);
    assert.deepEqual(res.body, { error: 'RATE_LIMITED' });
    assert.ok(res.headers['Retry-After']);
  });

  it('isolates buckets per client IP', async () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1, prefix: 'test-ip' });
    let a = false;
    await mw(fakeReq('10.9.9.1'), fakeRes(), () => void (a = true));
    assert.equal(a, true);
    let b = false;
    const res = fakeRes();
    await mw(fakeReq('10.9.9.2'), res, () => void (b = true));
    assert.equal(b, true);
    assert.equal(res.statusCode, 200);
  });

  it('keeps playback-safe budgets generous', () => {
    assert.ok(LIMITS.search.max >= 100);
    assert.ok(LIMITS.gateway.max >= 100);
    assert.ok(LIMITS.recommendations.max >= 100);
    assert.ok(LIMITS.mutations.max >= 60);
  });
});
