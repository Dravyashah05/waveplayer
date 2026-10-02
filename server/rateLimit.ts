import type { NextFunction, Request, Response } from 'express';

/**
 * Lightweight API rate limiting (no new dependencies).
 *
 * Redis-backed sliding window when Upstash is configured (works across
 * serverless instances); per-instance memory fallback otherwise (documented
 * limitation: a fleet of N instances allows ~N× the budget). Limits are
 * generous for normal playback — only abusive bursts hit 429, which returns
 * a clean JSON body with Retry-After and never leaks internals.
 */

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const t = raw.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}

function redisAvailable(): boolean {
  return !!env('UPSTASH_REDIS_REST_URL') && !!env('UPSTASH_REDIS_REST_TOKEN');
}

async function redisIncr(key: string, windowSec: number): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(env('UPSTASH_REDIS_REST_URL')!, {
      method: 'POST',
      headers: { authorization: `Bearer ${env('UPSTASH_REDIS_REST_TOKEN')}`, 'content-type': 'application/json' },
      body: JSON.stringify(['EVAL', 'local c = redis.call("INCR", KEYS[1]); if c == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]); end; return c;', '1', key, String(windowSec)]),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('rl-unavailable');
    const data: any = await res.json();
    if (data.error) throw new Error('rl-unavailable');
    return Number(data.result) || 1;
  } finally {
    clearTimeout(timer);
  }
}

const mem = new Map<string, { count: number; reset: number }>();
function memIncr(key: string, windowMs: number): number {
  const now = Date.now();
  const hit = mem.get(key);
  if (!hit || hit.reset <= now) {
    // Opportunistic cleanup so the fallback map stays bounded.
    if (mem.size > 5000) {
      for (const [k, v] of mem) if (v.reset <= now) mem.delete(k);
    }
    mem.set(key, { count: 1, reset: now + windowMs });
    return 1;
  }
  hit.count += 1;
  return hit.count;
}

function clientKey(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.socket?.remoteAddress || 'unknown';
  return ip.replace(/[^A-Za-z0-9.:_-]/g, '_').slice(0, 64);
}

export interface RateLimitOpts {
  windowMs: number;
  max: number;
  prefix: string;
}

/**
 * Express middleware enforcing a fixed-window limit per client IP.
 * Mount with `app.use(path, ...)` (never inline beside typed route
 * handlers) so Express 5 keeps inferring `:params` as `string`.
 */
export function rateLimit(opts: RateLimitOpts) {
  const windowSec = Math.max(1, Math.round(opts.windowMs / 1000));
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `wave:rl:${opts.prefix}:${clientKey(req)}`;
    let count = 1;
    try {
      count = redisAvailable()
        ? await redisIncr(key, windowSec)
        : memIncr(key, opts.windowMs);
    } catch {
      // Limiter failure must never block legitimate traffic.
      return next();
    }
    if (count > opts.max) {
      res.setHeader('Retry-After', String(windowSec));
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}

/** Generous per-route budgets — normal playback never notices these. */
export const LIMITS = {
  auth: { windowMs: 10 * 60 * 1000, max: 60, prefix: 'auth' },
  search: { windowMs: 60 * 1000, max: 120, prefix: 'search' },
  gateway: { windowMs: 60 * 1000, max: 180, prefix: 'gateway' },
  recommendations: { windowMs: 60 * 1000, max: 120, prefix: 'recs' },
  mutations: { windowMs: 60 * 1000, max: 120, prefix: 'mut' },
} as const;
