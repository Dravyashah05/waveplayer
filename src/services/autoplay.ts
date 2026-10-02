import type { Track } from '../types';
import { playerStore } from './playerStore';
import { settingsStore } from './settingsStore';
import { fetchAutoplay } from './recommendationApi';
import { getUpNext } from './recommendationEngine';
import {
  DIVERSITY,
  attachRadioFeedback,
  extendRadioQueue,
  getActiveSession,
  shouldExtendQueue,
} from './radioEngine';

const LS_KEY = 'wave:autoplay';
const APPEND_COUNT = DIVERSITY.extensionBatch;
const MAX_QUEUE = DIVERSITY.maxQueue;

/**
 * Infinite autoplay: extends the queue before it runs dry.
 *
 * Enablement is unified: BOTH the Settings toggle (settingsStore.autoplay)
 * and the queue-drawer toggle (wave:autoplay) must be on. Both default to
 * true, so existing users keep their behavior; turning either off stops
 * all extension. repeat=one never extends; repeat off/all extend normally.
 *
 * When a radio session is active, extension comes from the session (context
 * preserved, feedback applied). Otherwise the legacy server-autoplay +
 * on-device fallback path runs unchanged.
 */
export function isAutoplayEnabled(): boolean {
  try {
    if (!settingsStore.get().autoplay) return false;
  } catch {}
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setAutoplayEnabled(on: boolean): void {
  try {
    localStorage.setItem(LS_KEY, on ? '1' : '0');
  } catch {}
  notifySubs();
}

const subs = new Set<() => void>();
function notifySubs() {
  for (const fn of [...subs]) {
    try {
      fn();
    } catch {}
  }
}

export function subscribeAutoplay(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Re-emit autoplay state when the Settings toggle changes (unified UI). */
let settingsHooked = false;
function hookSettings(): void {
  if (settingsHooked) return;
  settingsHooked = true;
  try {
    settingsStore.subscribe(() => notifySubs());
  } catch {}
}

let fetching = false;
let lastSeedId: string | null = null;

async function maybeExtend() {
  if (fetching) return;
  const queue = playerStore.queue();
  const current = playerStore.current();
  if (!current?.id || !queue.length) return;
  const pos = queue.findIndex((t) => t === current);
  const remaining = pos >= 0 ? queue.length - pos - 1 : 0;
  // Pure decision (tested): off / repeat-one / empty / full / enough → stop.
  const decision = shouldExtendQueue({
    queueLength: queue.length,
    remaining,
    repeat: playerStore.repeat,
    autoplayOn: isAutoplayEnabled(),
  });
  if (!decision.extend) return;
  if (lastSeedId === current.id) return;
  fetching = true;
  try {
    // Radio session active → context-preserving batch (feedback applied).
    if (getActiveSession()) {
      await extendRadioQueue(APPEND_COUNT);
      lastSeedId = current.id;
      return;
    }
    const exclude = new Set(queue.map((t) => t.id));
    let tracks = await fetchAutoplay(current, [...exclude], APPEND_COUNT).catch(() => [] as Track[]);
    if (!tracks.length) {
      // Fallback to the on-device engine (taste + Saavn radio) when the
      // server endpoint is unreachable — same behavior as before.
      tracks = await getUpNext(current, exclude, APPEND_COUNT).catch(() => []);
    }
    const fresh = tracks.filter((t) => t?.id && !exclude.has(t.id)).slice(0, APPEND_COUNT);
    lastSeedId = current.id;
    for (const t of fresh) {
      playerStore.addToQueue(t, {
        addedBy: 'autoplay',
        context: 'autoplay',
        seedTrackId: current.id,
        seedTitle: current.title,
      });
    }
  } catch {
    // Autoplay must never interrupt playback.
  } finally {
    fetching = false;
  }
}

/** Starts the queue-tail watcher. Call once from the app root. */
export function startAutoplay(): () => void {
  lastSeedId = null;
  hookSettings();
  attachRadioFeedback();
  return playerStore.subscribe(() => {
    void maybeExtend();
  });
}
