import { Track } from '../types';
import { getSimilarTracks } from './recommendationEngine';
import { logEvent } from './listeningStore';
import {
  buildShuffleOrder,
  defaultMeta,
  isMetaLike,
  type QueueItemMeta,
  type QueueMetaInput,
} from './queueMeta';

export type { QueueItemMeta, QueueMetaInput };

type Listener = () => void;
type Repeat = 'off' | 'one' | 'all';

const LS_QUEUE = 'wave:queue';
const LS_INDEX = 'wave:index';
const LS_FAV = 'wave:fav';
const LS_HISTORY = 'wave:history';
const LS_SHUFFLE = 'wave:shuffle';
const LS_REPEAT = 'wave:repeat';
const LS_VOLUME = 'wave:volume';
// Provenance sidecar only (ids + labels). Never tokens, never credentials.
const LS_QUEUE_META = 'wave:queue_meta';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const parsed = JSON.parse(v) as unknown;
    // Corrupt or foreign values must never propagate — fall back instead of
    // crashing the store constructor (which runs at import time and would
    // white-screen the whole app).
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (typeof fallback === 'number' && (typeof parsed !== 'number' || !Number.isFinite(parsed))) return fallback;
    if (typeof fallback === 'boolean' && typeof parsed !== 'boolean') return fallback;
    if (typeof fallback === 'string' && typeof parsed !== 'string') return fallback;
    return parsed as T;
  } catch { return fallback; }
}

function isTrackLike(t: unknown): t is Track {
  return !!t && typeof t === 'object' && typeof (t as Track).id === 'string' && !!(t as Track).id;
}

function loadTracks(key: string): Track[] {
  const arr = load<unknown[]>(key, []);
  if (!Array.isArray(arr)) return [];
  return arr.filter(isTrackLike);
}
/** Load provenance sidecar; length-mismatch or garbage resets to defaults. */
function loadMetas(): QueueItemMeta[] {
  try {
    const raw = localStorage.getItem(LS_QUEUE_META);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMetaLike);
  } catch {
    return [];
  }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

class PlayerStore {
  private tracks: Track[] = loadTracks(LS_QUEUE);
  private metas: QueueItemMeta[] = loadMetas();
  private index = load<number>(LS_INDEX, -1);
  private favs: Track[] = loadTracks(LS_FAV);
  private history: Track[] = loadTracks(LS_HISTORY);
  private _shuffle = load<boolean>(LS_SHUFFLE, false);
  private _repeat: Repeat = (() => {
    const r = load<string>(LS_REPEAT, 'all');
    return r === 'off' || r === 'one' || r === 'all' ? r : 'all';
  })();
  private _volume = (() => { const v = load<number>(LS_VOLUME, 80); return v >= 0 && v <= 100 ? v : 80; })();
  private listeners = new Set<Listener>();
  private shuffleOrder: number[] = [];
  private shufflePtr = 0;
  /** Bumped on every queue/index mutation the engine must react to. */
  private _revision = 0;
  get revision() { return this._revision; }
  private bump() { this._revision++; }

  constructor() {
    // sanitize state — never trust persisted values (corrupt keys used to
    // throw here at import time and white-screen the app).
    if (!Array.isArray(this.tracks)) this.tracks = [];
    else this.tracks = this.tracks.filter(isTrackLike);
    // Sidecar must mirror the queue 1:1; anything else resets to defaults
    // (fresh queueItemIds, addedBy user) rather than crashing or mislabeling.
    if (!Array.isArray(this.metas) || this.metas.length !== this.tracks.length) {
      this.metas = this.tracks.map(() => defaultMeta());
    }
    if (!Array.isArray(this.favs)) this.favs = [];
    if (!Array.isArray(this.history)) this.history = [];
    if (typeof this.index !== 'number' || !Number.isFinite(this.index)) this.index = -1;
    if (this.index < 0 || this.index >= this.tracks.length) this.index = this.tracks.length ? 0 : -1;
    if (this.tracks.length && this.index === -1) this.index = 0;
  }

  // queue (provenance sidecar mirrors every mutation 1:1)
  setQueue(tracks: Track[], startIndex = 0, metas?: (QueueMetaInput | undefined)[]) {
    this.tracks = [...tracks];
    this.metas = tracks.map((_, i) => defaultMeta(metas?.[i]));
    this.index = Math.max(0, Math.min(startIndex, tracks.length - 1));
    if (tracks.length === 0) this.index = -1;
    this.bump();
    this.rebuildShuffle();
    this.persistQueue();
    const cur = this.current();
    this.pushHistory(cur);
    if (cur) logEvent({ songId: cur.id, track: cur, event: 'play', playedSeconds: 0, duration: cur.durationSeconds || 180 });
    this.emit();
  }

  addToQueue(track: Track, meta?: QueueMetaInput) {
    // avoid dup
    if (this.tracks.find((t) => t.id === track.id)) return;
    this.tracks.push(track);
    this.metas.push(defaultMeta(meta));
    logEvent({ songId: track.id, track, event: 'add_to_queue', playedSeconds: 0, duration: track.durationSeconds || 0 });
    if (this.index === -1) this.index = 0;
    this.bump();
    this.rebuildShuffle();
    this.persistQueue();
    this.emit();
  }

  playNext(track: Track, meta?: QueueMetaInput) {
    if (!track?.id) return;
    const existingIdx = this.tracks.findIndex((t) => t.id === track.id);
    if (existingIdx !== -1) {
      this.tracks.splice(existingIdx, 1);
      this.metas.splice(existingIdx, 1);
      if (existingIdx < this.index) this.index--;
    }
    const insertIdx = this.index >= 0 ? this.index + 1 : 0;
    this.tracks.splice(insertIdx, 0, track);
    this.metas.splice(insertIdx, 0, defaultMeta(meta));
    if (this.index === -1) this.index = 0;
    logEvent({ songId: track.id, track, event: 'add_to_queue', playedSeconds: 0, duration: track.durationSeconds || 0, meta: { playNext: true } });
    this.bump();
    this.rebuildShuffle();
    this.persistQueue();
    this.emit();
  }

  addMultipleToQueue(tracks: Track[], metas?: (QueueMetaInput | undefined)[]) {
    if (!tracks.length) return;
    const existing = new Set(this.tracks.map((t) => t.id));
    const picks: Array<{ t: Track; i: number }> = [];
    tracks.forEach((t, i) => {
      if (t?.id && !existing.has(t.id)) {
        existing.add(t.id);
        picks.push({ t, i });
      }
    });
    if (!picks.length) return;
    for (const p of picks) {
      this.tracks.push(p.t);
      this.metas.push(defaultMeta(metas?.[p.i]));
    }
    for (const p of picks) {
      logEvent({ songId: p.t.id, track: p.t, event: 'add_to_queue', playedSeconds: 0, duration: p.t.durationSeconds || 0 });
    }
    if (this.index === -1) this.index = 0;
    this.bump();
    this.rebuildShuffle();
    this.persistQueue();
    this.emit();
  }

  removeFromQueue(idx: number) {
    if (idx < 0 || idx >= this.tracks.length) return;
    this.tracks.splice(idx, 1);
    this.metas.splice(idx, 1);
    if (this.tracks.length === 0) this.index = -1;
    else if (idx < this.index) this.index--;
    else if (idx === this.index) {
      // stay at same idx (now next track) or clamp
      if (this.index >= this.tracks.length) this.index = this.tracks.length - 1;
      this.bump();
      this.pushHistory(this.current());
    }
    this.rebuildShuffle();
    this.persistQueue();
    this.emit();
  }

  moveQueue(from: number, to: number) {
    if (from < 0 || from >= this.tracks.length || to < 0 || to >= this.tracks.length || from === to) return;
    const [m] = this.tracks.splice(from, 1);
    this.tracks.splice(to, 0, m);
    // Provenance travels with its track (labels never detach on reorder).
    const [mm] = this.metas.splice(from, 1);
    if (mm) this.metas.splice(to, 0, mm);
    // adjust index
    if (this.index === from) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this.rebuildShuffle();
    this.persistQueue();
    this.emit();
  }

  clearQueue() {
    this.tracks = [];
    this.metas = [];
    this.index = -1;
    this.bump();
    this.shuffleOrder = [];
    this.shufflePtr = 0;
    this.persistQueue();
    this.emit();
  }

  next() {
    if (this.tracks.length === 0) return;
    const wasAtEnd = !this._shuffle && this.index === this.tracks.length - 1;
    if (this._shuffle) {
      if (!this.shuffleOrder.length) this.rebuildShuffle();
      if (!this.shuffleOrder.length) return;
      this.shufflePtr = (this.shufflePtr + 1) % this.shuffleOrder.length;
      this.index = this.shuffleOrder[this.shufflePtr];
    } else {
      if (wasAtEnd && this._repeat === 'off') return;
      this.index = (this.index + 1) % this.tracks.length;
    }
    this.bump();
    this.persistQueue();
    this.pushHistory(this.current());
    this.emit();
    // Infinite recommendation: when we loop from end (repeat=all) and queue is short, append similar tracks in background
    if (wasAtEnd && this._repeat === 'all' && this.tracks.length < 30) {
      const seed = this.current();
      if (seed) this.prefetchRadio(seed.id);
    }
  }

  private radioPrefetching = false;
  private async prefetchRadio(seedId: string) {
    if (this.radioPrefetching) return;
    this.radioPrefetching = true;
    try {
      const recs = await getSimilarTracks(seedId, 12);
      if (!recs.length) return;
      const existing = new Set(this.tracks.map(t => t.id));
      const toAdd = recs.filter(t => t.id && !existing.has(t.id)).slice(0, 5);
      if (toAdd.length) {
        this.tracks.push(...toAdd);
        for (const t of toAdd) this.metas.push(defaultMeta({ addedBy: 'autoplay', context: 'prefetch' }));
        this.rebuildShuffle();
        this.persistQueue();
        this.emit();
      }
    } catch {} finally {
      this.radioPrefetching = false;
    }
  }

  prev() {
    if (this.tracks.length === 0) return;
    if (this._shuffle) {
      if (!this.shuffleOrder.length) this.rebuildShuffle();
      if (!this.shuffleOrder.length) return;
      this.shufflePtr = (this.shufflePtr - 1 + this.shuffleOrder.length) % this.shuffleOrder.length;
      this.index = this.shuffleOrder[this.shufflePtr];
    } else {
      if (this.index === 0 && this._repeat === 'off') return;
      this.index = (this.index - 1 + this.tracks.length) % this.tracks.length;
    }
    this.bump();
    this.persistQueue();
    this.pushHistory(this.current());
    this.emit();
  }

  setIndex(i: number) {
    if (i >= 0 && i < this.tracks.length) {
      const prev = this.current();
      // detect replay of same track
      const isReplay = prev?.id === this.tracks[i]?.id;
      this.index = i;
      this.bump();
      if (this._shuffle) this.shufflePtr = this.shuffleOrder.indexOf(i);
      this.persistQueue();
      const cur = this.current();
      this.pushHistory(cur);
      if (cur) logEvent({ songId: cur.id, track: cur, event: isReplay ? 'replay' : 'play', playedSeconds: 0, duration: cur.durationSeconds || 180 });
      // Skips for the previous track are logged by playerEngine with the real
      // playback position (track-change detection) — never a placeholder here.
      this.emit();
    }
  }

  current(): Track | null { return this.tracks[this.index] ?? null; }
  /** Predict the exact item next() will select without mutating queue state. */
  peekNext(): Track | null {
    if (!this.tracks.length || this.index < 0) return null;
    if (this._repeat === 'one') return this.current();
    if (this._shuffle) {
      if (this.shuffleOrder.length < 2) return this.current();
      const nextPtr = (this.shufflePtr + 1) % this.shuffleOrder.length;
      return this.tracks[this.shuffleOrder[nextPtr]] ?? null;
    }
    if (this.index + 1 < this.tracks.length) return this.tracks[this.index + 1] ?? null;
    return this._repeat === 'all' ? this.tracks[0] ?? null : null;
  }
  queue(): Track[] { return this.tracks; }
  currentIndex(): number { return this.index; }
  /** Provenance sidecar (same order as queue(); empty when nothing queued). */
  queueMetas(): QueueItemMeta[] { return this.metas; }
  metaForIndex(i: number): QueueItemMeta | null {
    return i >= 0 && i < this.metas.length ? this.metas[i] : null;
  }

  // shuffle / repeat
  get shuffle() { return this._shuffle; }
  toggleShuffle() {
    this._shuffle = !this._shuffle;
    save(LS_SHUFFLE, this._shuffle);
    this.rebuildShuffle();
    this.emit();
  }
  get repeat(): Repeat { return this._repeat; }
  cycleRepeat() {
    const order: Repeat[] = ['off', 'all', 'one'];
    const idx = order.indexOf(this._repeat);
    this._repeat = order[(idx + 1) % order.length];
    save(LS_REPEAT, this._repeat);
    this.emit();
  }
  // alias for backward compatibility — PlayerBar previously called toggleRepeat
  toggleRepeat() { this.cycleRepeat(); }
  get volume() { return this._volume; }
  setVolume(v: number) { this._volume = Math.max(0, Math.min(100, v)); save(LS_VOLUME, this._volume); this.emit(); }

  // favs
  favsList(): Track[] { return this.favs; }
  isFav(id: string) { return this.favs.some((t) => t.id === id); }
  toggleFav(track: Track): boolean {
    const idx = this.favs.findIndex((t) => t.id === track.id);
    const added = idx < 0;
    if (idx >= 0) this.favs.splice(idx, 1);
    else this.favs.unshift(track);
    // cap 200
    if (this.favs.length > 200) this.favs = this.favs.slice(0, 200);
    save(LS_FAV, this.favs);
    logEvent({ songId: track.id, track, event: added ? 'like' : 'unlike', playedSeconds: 0, duration: track.durationSeconds || 180 });
    this.emit();
    return added;
  }

  // history
  historyList(): Track[] { return this.history; }
  private pushHistory(t: Track | null) {
    if (!t) return;
    this.history = [t, ...this.history.filter((x) => x.id !== t.id)].slice(0, 50);
    save(LS_HISTORY, this.history);
  }
  clearHistory() { this.history = []; save(LS_HISTORY, []); this.emit(); }
  removeHistoryEntry(id: string) {
    if (!id) return;
    const next = this.history.filter((t) => t?.id !== id);
    if (next.length !== this.history.length) {
      this.history = next;
      save(LS_HISTORY, this.history);
      this.emit();
    }
  }

  // helpers
  private rebuildShuffle() {
    if (this.tracks.length === 0) { this.shuffleOrder = []; this.shufflePtr = 0; return; }
    // Smart order: current first, unbiased shuffle, artist/album spread.
    // Queue order itself is never mutated — only the playback pointer path.
    this.shuffleOrder = buildShuffleOrder(this.tracks, this.index);
    this.shufflePtr = this.shuffleOrder.indexOf(this.index);
    if (this.shufflePtr === -1) this.shufflePtr = 0;
  }
  private persistQueue() {
    save(LS_QUEUE, this.tracks);
    save(LS_INDEX, this.index);
    save(LS_QUEUE_META, this.metas);
  }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((fn) => fn()); }
}

export const playerStore = new PlayerStore();
