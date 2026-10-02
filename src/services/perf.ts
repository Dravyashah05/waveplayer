/**
 * Development-only performance marks (startup, navigation, first playback).
 * Compiled out of production UI entirely — no diagnostics leak to users.
 * Read via DevTools Performance timeline or `performance.getEntriesByType`.
 */

const ENABLED = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;

export function perfMark(name: string): void {
  if (!ENABLED) return;
  try {
    performance.mark(`wave:${name}`);
  } catch { /* measuring never breaks the app */ }
}

export function perfMeasure(label: string, startMark: string, endMark?: string): number | null {
  if (!ENABLED) return null;
  try {
    performance.mark(endMark ? `wave:${endMark}` : `wave:${label}:end`);
    const m = performance.measure(
      `wave:${label}`,
      `wave:${startMark}`,
      endMark ? `wave:${endMark}` : `wave:${label}:end`,
    );
    // eslint-disable-next-line no-console
    console.debug(`[wave-perf] ${label}: ${m.duration.toFixed(1)}ms`);
    return m.duration;
  } catch {
    return null;
  }
}
