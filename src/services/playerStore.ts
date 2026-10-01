import { Track } from '../types';
import { getSimilarTracks } from './recommendationEngine';
import { logEvent } from './listeningStore';

type Listener = () => void;
type Repeat = 'off' | 'one' | 'all';

const LS_QUEUE = 'wave:queue';
const LS_INDEX = 'wave:index';
const LS_FAV = 'wave:fav';
const LS_HISTORY = 'wave:history';
const LS_SHUFFLE = 'wave:shuffle';
const LS_REPEAT = 'wave:repeat';
const LS_VOLUME = 'wave:volume';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

class PlayerStore {
  private tracks: Track[] = load<Track[]>(LS_QUEUE, []);
  private index = load<number>(LS_INDEX, -1);
  private favs: Track[] = load<Track[]>(LS_FAV, []);
  private history: Track[] = load<Track[]>(LS_HISTORY, []);
  private _shuffle = load<boolean>(LS_SHUFFLE, false);
  private _repeat: Repeat = load<Repeat>(LS_REPEAT, 'all');
  private _volume = load<number>(LS_VOLUME, 80);
  private listeners = new Set<Listener>();
  private shuffleOrder: number[] = [];
  private shufflePtr = 0;
  /** Bumped on every queue/index mutation the engine must react to. */
  private _revision = 0;
  get revision() { return this._revision; }
  private bump() { this._revision++; }

  constructor() {
    // sanitize index
    if (this.index < 0 || this.index >= this.tracks.length) this.index = this.tracks.length ? 0 : -1;
    if (this.tracks.length && this.index === -1) this.index = 0;
  }

  // queue
  setQueue(tracks: Track[], startIndex = 0) {
    this.tracks = [...tracks];
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

  addToQueue(track: Track) {
    // avoid dup
    if (this.tracks.find((t) => t.id === track.id)) return;
    this.tracks.push(track);
    logEvent({ songId: track.id, track, event: 'add_to_queue', playedSeconds: 0, duration: track.durationSeconds || 0 });
    if (this.index === -1) this.index = 0;
    this.bump();
    this.rebuildShuffle();
    this.persistQueue();
    this.emit();
  }

  playNext(track: Track) {
    if (!track?.id) return;
    const existingIdx = this.tracks.findIndex((t) => t.id === track.id);
    if (existingIdx !== -1) {
      this.tracks.splice(existingIdx, 1);
      if (existingIdx < this.index) this.index--;
    }
    const insertIdx = this.index >= 0 ? this.index + 1 : 0;
    this.tracks.splice(insertIdx, 0, track);
    if (this.index === -1) this.index = 0;
    logEvent({ songId: track.id, track, event: 'add_to_queue', playedSeconds: 0, duration: track.durationSeconds || 0, meta: { playNext: true } });
    this.bump();
    this.rebuildShuffle();
    this.persistQueue();
    this.emit();
  }

  addMultipleToQueue(tracks: Track[]) {
    if (!tracks.length) return;
    const existing = new Set(this.tracks.map((t) => t.id));
    const toAdd = tracks.filter((t) => t?.id && !existing.has(t.id));
    if (!toAdd.length) return;
    this.tracks.push(...toAdd);
    for (const t of toAdd) {
      logEvent({ songId: t.id, track: t, event: 'add_to_queue', playedSeconds: 0, duration: t.durationSeconds || 0 });
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
      // if skipped quickly, log skip for previous
      if (prev && !isReplay) {
        // we don't have playedSeconds here; PlayerBar will log precise skip
        logEvent({ songId: prev.id, track: prev, event: 'skip', playedSeconds: 5, duration: prev.durationSeconds || 180, meta: { via: 'setIndex' } });
      }
      this.emit();
    }
  }

  current(): Track | null { return this.tracks[this.index] ?? null; }
  queue(): Track[] { return this.tracks; }
  currentIndex(): number { return this.index; }

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

  // helpers
  private rebuildShuffle() {
    if (this.tracks.length === 0) { this.shuffleOrder = []; this.shufflePtr = 0; return; }
    this.shuffleOrder = this.tracks.map((_, i) => i).sort(() => Math.random() - 0.5);
    // ensure current at ptr
    this.shufflePtr = this.shuffleOrder.indexOf(this.index);
    if (this.shufflePtr === -1) this.shufflePtr = 0;
  }
  private persistQueue() {
    save(LS_QUEUE, this.tracks);
    save(LS_INDEX, this.index);
  }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((fn) => fn()); }
}

export const playerStore = new PlayerStore();
