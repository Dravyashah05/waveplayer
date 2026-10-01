import type { Track } from '../types';
import { subscribePlayerEvents } from './playerEvents';
import { settingsStore } from './settingsStore';

export interface ScrobblePayload {
  title: string;
  artist: string;
  album?: string;
  duration: number;
  timestamp: number;
  trackId: string;
}

export interface ScrobbleProvider {
  id: 'lastfm' | 'listenbrainz';
  isEnabled(): boolean;
  nowPlaying(payload: ScrobblePayload): Promise<void>;
  scrobble(payload: ScrobblePayload): Promise<void>;
}

const providers: ScrobbleProvider[] = [];

export function registerScrobbleProvider(p: ScrobbleProvider): void {
  if (!providers.some((x) => x.id === p.id)) providers.push(p);
}

/** Standard scrobble rule: >30s track, listened ≥50% or ≥4 min, once per play. */
export function shouldScrobble(durationSec: number, playedSec: number): boolean {
  if (!durationSec || durationSec < 30 || !playedSec) return false;
  return playedSec >= Math.min(240, durationSec * 0.5);
}

interface Pending {
  track: Track;
  startedAt: number;
  scrobbled: boolean;
}

let current: Pending | null = null;
let started = false;

function toPayload(track: Track, timestamp: number): ScrobblePayload {
  return {
    title: track.title,
    artist: track.author,
    album: track.albumName,
    duration: Math.round(track.durationSeconds || 0),
    timestamp,
    trackId: track.id,
  };
}

function enabled(): ScrobbleProvider[] {
  return providers.filter((p) => {
    try {
      return p.isEnabled();
    } catch {
      return false;
    }
  });
}

export function startScrobbleService(): () => void {
  if (started) return () => {};
  started = true;
  return subscribePlayerEvents((e) => {
    try {
      if (e.type === 'TRACK_START' && e.track) {
        current = { track: e.track, startedAt: Math.floor(Date.now() / 1000), scrobbled: false };
        const payload = toPayload(e.track, Math.floor(Date.now() / 1000));
        for (const p of enabled()) void p.nowPlaying(payload).catch(() => {});
      } else if ((e.type === 'TRACK_COMPLETE' || e.type === 'TRACK_SKIP') && e.track && current && e.track.id === current.track.id && !current.scrobbled) {
        const played = typeof e.progress === 'number' && e.progress > 0 ? e.progress : e.duration || 0;
        const duration = e.duration || current.track.durationSeconds || 0;
        if (shouldScrobble(duration, played)) {
          current.scrobbled = true;
          const payload = toPayload(current.track, current.startedAt);
          for (const p of enabled()) void p.scrobble(payload).catch(() => {});
        }
        if (e.type === 'TRACK_COMPLETE') current = null;
      } else if (e.type === 'TRACK_ERROR' || e.type === 'SEEK') {
        // errors never scrobble; seeks don't reset the pending play
      }
    } catch {}
  });
}
