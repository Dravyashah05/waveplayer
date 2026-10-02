/**
 * Performance + PWA + Offline 2.0 — centralized cache + network policy.
 *
 * The single place TTLs, retry budgets and timeouts live. Categories are
 * never mixed:
 * - PUBLIC: artist/album metadata, genres/moods, charts/trending (shared keys OK)
 * - USER: library, history, likes, recommendations, taste, private playlists (scoped keys ONLY)
 * - PLAYER: queue, track, volume, repeat, shuffle, autoplay (device-local, restored on boot)
 *
 * Values below preserve the previously scattered per-file TTLs — this file
 * only centralizes them so they can be reasoned about and changed once.
 */

export const CACHE_TTL = {
  /** Static public metadata (artist/album detail, genres). */
  publicStaticMs: 10 * 60 * 1000,
  /** Trending / charts / browse modules (stale fast). */
  trendingMs: 10 * 60 * 1000,
  /** Recommendations + radio candidates (taste moves). */
  recommendationsMs: 5 * 60 * 1000,
  /** Radio candidate pool. */
  radioCandidatesMs: 5 * 60 * 1000,
  /** User library snapshot (explicit sync refreshes). */
  userLibraryMs: 5 * 60 * 1000,
  /** Playlist metadata (invalidated on mutation anyway). */
  playlistMetaMs: 5 * 60 * 1000,
  /** YT Music history (explicit refresh only). */
  historyMs: 15 * 60 * 1000,
  /** Personalized home payload (background refresh throttled separately). */
  homeMs: 10 * 60 * 1000,
} as const;

export const CACHE_MAX = {
  radioCandidates: 50,
  playlistMeta: 60,
  palette: 60,
  serviceWorkerRuntime: 150,
} as const;

export type RequestPolicy = 'critical' | 'normal' | 'recommendation' | 'background';

/**
 * Retry/timeout policy per request class. Critical player requests fail fast
 * with one retry (the engine has its own fallback chain); recommendations
 * and background sync never hammer — no retries, bounded timeouts.
 */
export const REQUEST_POLICY: Record<RequestPolicy, { timeoutMs: number; retries: number }> = {
  critical: { timeoutMs: 12_000, retries: 1 },
  normal: { timeoutMs: 12_000, retries: 1 },
  recommendation: { timeoutMs: 12_000, retries: 0 },
  background: { timeoutMs: 8_000, retries: 0 },
} as const;

export function isExpired(cachedAt: number, ttlMs: number, now = Date.now()): boolean {
  return now - cachedAt > ttlMs;
}

/** Evict the oldest key when a bounded Map cache is full (insertion order). */
export function evictOldest<K>(map: Map<K, unknown>, max: number): void {
  if (map.size < max) return;
  const oldest = map.keys().next();
  if (!oldest.done) map.delete(oldest.value);
}
