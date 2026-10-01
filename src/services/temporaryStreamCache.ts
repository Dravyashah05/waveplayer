import type { ResolvedStream } from './playerEngine';

export const UNKNOWN_STREAM_LIFETIME_MS = 90_000;
export const IFRAME_FALLBACK_CACHE_MS = 30_000;

export class TemporaryStreamCache {
  private entries = new Map<string, { value: ResolvedStream; createdAt: number }>();

  get(key: string, now = Date.now()): ResolvedStream | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const { value, createdAt } = entry;
    const expired = value.source === 'youtube-audio' && (value.expiresAt !== undefined
      ? now + 5_000 >= value.expiresAt
      : now - createdAt >= UNKNOWN_STREAM_LIFETIME_MS);
    const fallbackExpired = value.source === 'youtube-iframe' && now - createdAt >= IFRAME_FALLBACK_CACHE_MS;
    if (expired || fallbackExpired) {
      this.entries.delete(key);
      return undefined;
    }
    return value;
  }

  set(key: string, value: ResolvedStream, now = Date.now()): void {
    this.entries.set(key, { value, createdAt: now });
  }

  has(key: string, now = Date.now()): boolean { return this.get(key, now) !== undefined; }
  delete(key: string): void { this.entries.delete(key); }
}

export function runDeduped<T>(inflight: Map<string, Promise<T>>, key: string, operation: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = operation();
  inflight.set(key, pending);
  const clear = () => { if (inflight.get(key) === pending) inflight.delete(key); };
  pending.then(clear, clear);
  return pending;
}

export function canRetryDirectStream(attempts: number, maxRetries = 1): boolean {
  return attempts < maxRetries;
}
