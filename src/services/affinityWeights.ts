/**
 * Single tunable configuration for listening-intelligence affinity.
 *
 * All recommendation-signal weights live here — nowhere else. The
 * recommendation layer reads raw listening events and consults this file;
 * completion/skip helpers in listeningStore only classify (buckets), they
 * never decide how much a signal matters.
 *
 * Scale notes:
 * - engagement() decays every contribution by exp(-ageDays / DECAY_DAYS).
 * - Technical playback failures are always NEUTRAL (0) and must never be
 *   given a negative weight here.
 */

export const AFFINITY_WEIGHTS = {
  /** exp decay: contribution *= exp(-ageDays / DECAY_DAYS) (~3-week half-life). */
  DECAY_DAYS: 21,

  /** Strong positive signals. */
  like: 2.0,
  replay: 1.2,
  addToPlaylist: 1.0,
  /** complete scales with completion: COMPLETE_BASE + COMPLETE_SCALE * pct. */
  completeBase: 0.6,
  completeScale: 0.6,

  /** Moderate positive signals. */
  play: 0.25,
  addToQueue: 0.15,
  resume: 0.1,
  search: 0.05,

  /** Milestone progression (partial listening). */
  milestone10: 0.04,
  milestone25: 0.08,
  milestone50: 0.12,
  milestone75: 0.2,

  /** Negative signals. */
  unlike: -2.0,
  /** skip scales with earliness: SKIP_BASE + SKIP_SCALE * skipPenalty(). */
  skipBase: 0.4,
  skipScale: 1.2,

  /** Neutral: pause, seek, views and technical errors carry no taste signal. */
  pause: 0,
  seek: 0,
  view: 0,
  technicalError: 0,
} as const;

/**
 * Completion buckets (fraction of track listened, 0..1).
 * >= 0.9 counts as a strong positive (completed); anything below is raw
 * data for the recommendation layer — not a verdict made here.
 */
export const COMPLETION_BUCKETS = {
  COMPLETED_THRESHOLD: 0.9,
  SUBSTANTIAL_THRESHOLD: 0.6,
  PARTIAL_THRESHOLD: 0.3,
  EARLY_THRESHOLD: 0.1,
} as const;

export type CompletionBucket =
  | 'completed' // >= 90%
  | 'substantial' // 60–90%
  | 'partial' // 30–60%
  | 'early' // 10–30%
  | 'instant'; // < 10%

export function completionBucket(fraction: number): CompletionBucket {
  const f = Number.isFinite(fraction) ? fraction : 0;
  if (f >= COMPLETION_BUCKETS.COMPLETED_THRESHOLD) return 'completed';
  if (f >= COMPLETION_BUCKETS.SUBSTANTIAL_THRESHOLD) return 'substantial';
  if (f >= COMPLETION_BUCKETS.PARTIAL_THRESHOLD) return 'partial';
  if (f >= COMPLETION_BUCKETS.EARLY_THRESHOLD) return 'early';
  return 'instant';
}

export type SkipPosition = 'instant' | 'early' | 'mid' | 'late';

/** Where in the track a skip happened. Technical outcome decided elsewhere. */
export function classifySkipPosition(playedSeconds: number, duration: number): SkipPosition {
  if (!(duration > 0)) return playedSeconds < 10 ? 'instant' : 'early';
  const pct = playedSeconds / duration;
  if (playedSeconds < 10 && pct < 0.1) return 'instant';
  if (pct < 0.3) return 'early';
  if (pct < 0.7) return 'mid';
  return 'late';
}

/** Canonical technical-failure kinds. Never­treated as taste signals. */
export const TECHNICAL_ERROR_KINDS = [
  'YOUTUBE_STREAM_FAILED',
  'SAAVN_STREAM_FAILED',
  'NETWORK_ERROR',
  'MISSING_AUDIO',
  'PLAYER_ERROR',
] as const;

export type TechnicalErrorKind = (typeof TECHNICAL_ERROR_KINDS)[number];
