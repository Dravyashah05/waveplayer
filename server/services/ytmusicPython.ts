import type { Express, Request, Response } from 'express';
import { getWaveUserKey } from '../googleYouTube.js';

/**
 * Express gateway for the Python ytmusicapi service (sigma67/ytmusicapi).
 *
 * The browser only ever talks to Express. Express forwards to the Python
 * service with the Wave user key + shared secret; the secret never reaches
 * the frontend. The Python service is never exposed to browsers directly.
 *
 * Resilience contract:
 * - Every upstream call has a timeout; a hung Python request returns a
 *   controlled error and never blocks the player.
 * - Python down/unreachable/invalid → 503/502/504 with a stable error code.
 *   Existing /api/ytmusic/* (npm ytmusic-api) routes are untouched.
 * - Cache keys ALWAYS include the user key: user-private data is never
 *   shared across users.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

type CacheEntry = { expiresAt: number; value: unknown };
const cache = new Map<string, CacheEntry>();

export function pyCacheKey(userKey: string, path: string, query = ''): string {
  return `${userKey}:${path}${query ? `?${query}` : ''}`;
}

export function pyCacheGet(key: string): { hit: boolean; value?: unknown } {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

export function pyCacheSet(key: string, value: unknown, ttlMs = CACHE_TTL_MS): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

export function pyCacheClear(): void {
  cache.clear();
}

function pyBase(): string {
  return (process.env.YTMUSIC_PY_URL || 'http://127.0.0.1:8002').replace(/\/+$/, '');
}

function pySecret(): string {
  return process.env.YTMUSIC_PY_SECRET || '';
}

function pyTimeout(): number {
  const raw = Number(process.env.YTMUSIC_PY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 30_000) : DEFAULT_TIMEOUT_MS;
}

export type PyErrorCode =
  | 'YTMUSIC_PY_UNAVAILABLE'
  | 'YTMUSIC_PY_TIMEOUT'
  | 'YTMUSIC_PY_INVALID'
  | 'YTMUSIC_AUTH_REQUIRED'
  | 'YTMUSIC_PY_UPSTREAM_ERROR';

export class PyGatewayError extends Error {
  code: PyErrorCode;
  status: number;
  constructor(code: PyErrorCode, status: number, message?: string) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

async function readJson(response: globalThis.Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new PyGatewayError('YTMUSIC_PY_INVALID', 502, 'Python service returned invalid JSON');
  }
}

/**
 * Single choke point for Express → Python calls. Exported for tests.
 * `fetchImpl` is injectable so tests never need a live Python service.
 */
export async function pyRequest(
  userKey: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; useCache?: boolean } = {},
): Promise<unknown> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && String(v) !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  const cacheKey = pyCacheKey(userKey, path, qs);
  const useCache = opts.useCache !== false;
  if (useCache) {
    const cached = pyCacheGet(cacheKey);
    if (cached.hit) return cached.value;
  }
  const url = `${pyBase()}${path}${qs ? `?${qs}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? pyTimeout());
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: globalThis.Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'x-wave-user': userKey,
        ...(pySecret() ? { 'x-wave-secret': pySecret() } : {}),
      },
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') throw new PyGatewayError('YTMUSIC_PY_TIMEOUT', 504);
    throw new PyGatewayError('YTMUSIC_PY_UNAVAILABLE', 503);
  }
  clearTimeout(timer);
  const body = await readJson(response);
  if (response.status === 401) throw new PyGatewayError('YTMUSIC_AUTH_REQUIRED', 401);
  if (!response.ok) {
    const code =
      typeof (body as any)?.error === 'string' && (body as any).error ? String((body as any).error).slice(0, 64) : 'YTMUSIC_PY_UPSTREAM_ERROR';
    throw new PyGatewayError('YTMUSIC_PY_UPSTREAM_ERROR', response.status >= 400 && response.status < 600 ? response.status : 502, code);
  }
  if (useCache) pyCacheSet(cacheKey, body);
  return body;
}

export async function pyHealth(fetchImpl?: typeof fetch): Promise<{ ok: boolean; py?: unknown }> {
  try {
    const body = await pyRequest('healthcheck', '/health', {}, { timeoutMs: HEALTH_TIMEOUT_MS, fetchImpl, useCache: false });
    return { ok: true, py: body };
  } catch {
    return { ok: false };
  }
}

function sendPyError(res: Response, e: unknown): void {
  if (e instanceof PyGatewayError) {
    res.status(e.status).json({ error: e.code, detail: e.message });
    return;
  }
  res.status(502).json({ error: 'YTMUSIC_PY_UPSTREAM_ERROR' });
}

function userKeyFor(req: Request): string {
  return getWaveUserKey(req) || 'anon:unknown';
}

/** Mount the Python-backed, user-isolated YT Music routes. Existing routes untouched. */
export function registerYTMusicPyRoutes(app: Express): void {
  app.get('/api/ytmusic-py/health', async (_req, res) => {
    const health = await pyHealth();
    // Gateway is healthy even when Python is down — the player degrades.
    res.json({ ok: true, gateway: 'ytmusic-py', python: health.ok ? health.py : null, pythonAvailable: health.ok });
  });

  const proxy = (pyPath: string, cacheable = true) => async (req: Request, res: Response) => {
    try {
      const query: Record<string, string | number | undefined> = {};
      for (const [k, v] of Object.entries(req.query)) {
        if (typeof v === 'string' || typeof v === 'number') query[k] = v;
      }
      const body = await pyRequest(userKeyFor(req), pyPath, query, { useCache: cacheable });
      res.json(body);
    } catch (e) {
      sendPyError(res, e);
    }
  };

  app.get('/api/ytmusic-py/home', proxy('/home'));
  app.get('/api/ytmusic-py/library/playlists', proxy('/library/playlists'));
  app.get('/api/ytmusic-py/library/songs', proxy('/library/songs'));
  app.get('/api/ytmusic-py/library/albums', proxy('/library/albums'));
  app.get('/api/ytmusic-py/library/liked', proxy('/library/liked'));
  app.get('/api/ytmusic-py/library/history', proxy('/library/history', false));
  app.get('/api/ytmusic-py/library/artists', proxy('/library/artists'));
  app.get('/api/ytmusic-py/auth/status', proxy('/auth/status', false));
}
