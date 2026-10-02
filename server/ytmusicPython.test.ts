import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PyGatewayError,
  pyCacheClear,
  pyCacheKey,
  pyHealth,
  pyRequest,
} from './services/ytmusicPython.js';

function jsonResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': 'application/json' } });
}

describe('ytmusic-python gateway', () => {
  beforeEach(() => pyCacheClear());

  it('scopes cache keys by user so libraries never cross', () => {
    assert.notEqual(pyCacheKey('google:alice', '/library/liked'), pyCacheKey('google:bob', '/library/liked'));
    assert.equal(pyCacheKey('google:alice', '/library/liked'), pyCacheKey('google:alice', '/library/liked'));
    assert.notEqual(pyCacheKey('google:alice', '/library/liked'), pyCacheKey('google:alice', '/library/history'));
  });

  it('returns a controlled error when Python is unreachable', async () => {
    const down: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    await assert.rejects(pyRequest('google:alice', '/library/liked', {}, { fetchImpl: down }), (e: unknown) => {
      assert.ok(e instanceof PyGatewayError);
      assert.equal(e.code, 'YTMUSIC_PY_UNAVAILABLE');
      assert.equal(e.status, 503);
      return true;
    });
  });

  it('times out instead of hanging the player', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    await assert.rejects(
      pyRequest('google:alice', '/home', {}, { fetchImpl: hanging, timeoutMs: 20 }),
      (e: unknown) => {
        assert.ok(e instanceof PyGatewayError);
        assert.equal(e.code, 'YTMUSIC_PY_TIMEOUT');
        assert.equal(e.status, 504);
        return true;
      },
    );
  });

  it('rejects invalid upstream payloads', async () => {
    const garbage: typeof fetch = async () => jsonResponse('<html>not json</html>');
    await assert.rejects(pyRequest('google:alice', '/home', {}, { fetchImpl: garbage }), (e: unknown) => {
      assert.ok(e instanceof PyGatewayError);
      assert.equal(e.code, 'YTMUSIC_PY_INVALID');
      return true;
    });
  });

  it('passes through auth-required without leaking upstream detail', async () => {
    const denied: typeof fetch = async () => jsonResponse({ error: 'something-internal' }, 401);
    await assert.rejects(pyRequest('anon:xyz', '/library/liked', {}, { fetchImpl: denied }), (e: unknown) => {
      assert.ok(e instanceof PyGatewayError);
      assert.equal(e.code, 'YTMUSIC_AUTH_REQUIRED');
      assert.equal(e.status, 401);
      return true;
    });
  });

  it('caches per user and refetches across users', async () => {
    let calls = 0;
    const upstream: typeof fetch = async () => {
      calls++;
      return jsonResponse([{ id: 'x' }]);
    };
    const first = await pyRequest('google:alice', '/library/liked', {}, { fetchImpl: upstream });
    const second = await pyRequest('google:alice', '/library/liked', {}, { fetchImpl: upstream });
    assert.deepEqual(first, [{ id: 'x' }]);
    assert.deepEqual(second, [{ id: 'x' }]);
    assert.equal(calls, 1);
    await pyRequest('google:bob', '/library/liked', {}, { fetchImpl: upstream });
    assert.equal(calls, 2);
  });

  it('sends the user key and never the raw session', async () => {
    let seenUser = '';
    let seenSecret: string | null = null;
    const spy: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers as HeadersInit);
      seenUser = headers.get('x-wave-user') || '';
      seenSecret = headers.get('x-wave-secret');
      return jsonResponse([]);
    };
    process.env.YTMUSIC_PY_SECRET = 'test-secret';
    try {
      await pyRequest('google:alice', '/home', {}, { fetchImpl: spy, useCache: false });
    } finally {
      delete process.env.YTMUSIC_PY_SECRET;
    }
    assert.equal(seenUser, 'google:alice');
    assert.equal(seenSecret, 'test-secret');
  });

  it('reports python down from health without throwing', async () => {
    const down: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    assert.deepEqual(await pyHealth(down), { ok: false });
  });

  it('returns empty-library payloads through untouched', async () => {
    const empty: typeof fetch = async () => jsonResponse([]);
    assert.deepEqual(await pyRequest('google:alice', '/library/songs', {}, { fetchImpl: empty }), []);
  });
});
