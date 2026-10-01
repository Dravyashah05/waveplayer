import type { Track } from '../types';

// Normalized playback event bus. The engine emits; consumers (scrobbler,
// recommendations, Discord, stats) subscribe. Nothing here touches audio.

export type PlayerEventType =
  | 'TRACK_START'
  | 'TRACK_PROGRESS'
  | 'TRACK_COMPLETE'
  | 'TRACK_SKIP'
  | 'TRACK_ERROR'
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'QUEUE_CHANGE'
  | 'SOURCE_CHANGED';

export interface PlayerEvent {
  type: PlayerEventType;
  track: Track | null;
  at: number;
  progress?: number;
  duration?: number;
  reason?: string;
  source?: string;
}

type Listener = (e: PlayerEvent) => void;

const listeners = new Set<Listener>();

export function emitPlayerEvent(e: Omit<PlayerEvent, 'at'>): void {
  const full: PlayerEvent = { ...e, at: Date.now() };
  for (const fn of [...listeners]) {
    try {
      fn(full);
    } catch {}
  }
}

export function subscribePlayerEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
