import type { Track } from '../types';
import { playerStore } from './playerStore';
import { fetchAutoplay } from './recommendationApi';
import { getUpNext } from './recommendationEngine';

const LS_KEY = 'wave:autoplay';
const APPEND_COUNT = 5;
const MAX_QUEUE = 60;

/** AI-suggested autoplay: extends the queue before it runs dry. */
export function isAutoplayEnabled(): boolean {
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

let fetching = false;
let lastSeedId: string | null = null;

async function maybeExtend() {
  if (!isAutoplayEnabled() || fetching) return;
  const queue = playerStore.queue();
  const current = playerStore.current();
  if (!current?.id || !queue.length) return;
  const pos = queue.findIndex((t) => t === current);
  const remaining = pos >= 0 ? queue.length - pos - 1 : 0;
  if (remaining > 1 || queue.length >= MAX_QUEUE) return;
  if (playerStore.repeat === 'one') return;
  if (lastSeedId === current.id) return;
  fetching = true;
  try {
    const exclude = new Set(queue.map((t) => t.id));
    let tracks = await fetchAutoplay(current, [...exclude], APPEND_COUNT).catch(() => [] as Track[]);
    if (!tracks.length) {
      // Fallback to the on-device engine (taste + Saavn radio) when the
      // server endpoint is unreachable — same behavior as before.
      tracks = await getUpNext(current, exclude, APPEND_COUNT).catch(() => []);
    }
    const fresh = tracks.filter((t) => t?.id && !exclude.has(t.id)).slice(0, APPEND_COUNT);
    lastSeedId = current.id;
    for (const t of fresh) playerStore.addToQueue(t);
  } catch {
    // Autoplay must never interrupt playback.
  } finally {
    fetching = false;
  }
}

/** Starts the queue-tail watcher. Call once from the app root. */
export function startAutoplay(): () => void {
  lastSeedId = null;
  return playerStore.subscribe(() => {
    void maybeExtend();
  });
}
