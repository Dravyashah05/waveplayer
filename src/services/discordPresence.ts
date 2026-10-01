import type { Track } from '../types';
import { subscribePlayerEvents } from './playerEvents';
import { settingsStore } from './settingsStore';

// Discord Rich Presence from a browser tab cannot reach the desktop Discord
// RPC socket (no localhost access contract) nor the Discord API directly
// (no user token here by design). This module is therefore an honest
// abstraction: it tracks presence state for the UI, optionally POSTs to a
// user-run companion bridge, and reports `companion-required` otherwise.
// Nothing pretends to set Discord status when it cannot.

export type DiscordStatus = 'off' | 'companion-required' | 'connected' | 'error';

export interface DiscordActivity {
  details: string;
  state: string;
  startTimestamp?: number;
  largeImage?: string;
}

let status: DiscordStatus = 'off';
let lastActivity: DiscordActivity | null = null;
let lastError = '';
let companionUrl = '';
let started = false;
const subs = new Set<() => void>();

function emit() {
  for (const fn of [...subs]) {
    try {
      fn();
    } catch {}
  }
}

export function subscribeDiscord(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function discordState(): { status: DiscordStatus; activity: DiscordActivity | null; error: string } {
  return { status, activity: lastActivity, error: lastError };
}

export function setDiscordCompanion(url: string): void {
  companionUrl = url.trim().replace(/\/+$/, '');
}

function trackActivity(track: Track | null, playing: boolean): DiscordActivity | null {
  if (!track) return null;
  return {
    details: track.title,
    state: `${track.author}${playing ? '' : ' (paused)'}`,
    startTimestamp: playing ? Date.now() : undefined,
    largeImage: track.thumbnail,
  };
}

export function startDiscordPresence(): () => void {
  if (started) return () => {};
  started = true;
  return subscribePlayerEvents((e) => {
    try {
      if (!settingsStore.get().discordPresence) {
        if (status !== 'off') {
          status = 'off';
          lastActivity = null;
          emit();
        }
        return;
      }
      if (e.type === 'TRACK_START' || e.type === 'PLAY' || e.type === 'PAUSE') {
        lastActivity = trackActivity(e.track, e.type !== 'PAUSE');
        if (!companionUrl) {
          status = 'companion-required';
          emit();
          return;
        }
        status = 'connected';
        emit();
        void fetch(`${companionUrl}/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activity: lastActivity }),
        }).catch((err) => {
          status = 'error';
          lastError = String(err?.message || err).slice(0, 120);
          emit();
        });
      }
    } catch {}
  });
}
