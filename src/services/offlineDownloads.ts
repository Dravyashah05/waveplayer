import type { Track } from '../types';
import { audioSourceManager } from './audioSourceManager';
import { getCustomSources } from './audioSources';
import { settingsStore } from './settingsStore';

/**
 * Offline download framework (Task 15).
 *
 * Rights boundary (hard rule): only audio the user controls may be persisted —
 * tracks from user-configured static hosts (`custom:*` sources). Platform
 * streams (JioSaavn / YouTube / YTMusic) are streaming-licensed, never cached
 * here: no DRM, CAPTCHA, access-control or platform-restriction bypass exists
 * in this module. User-supplied local files are already on-device and handled
 * by localLibrary, not this manager.
 *
 * Storage: IndexedDB (`wave-offline-downloads`) — audio blob, metadata,
 * artwork, source info, download date, size. localStorage is never used for
 * audio. Playback: the manager registers an offline provider with
 * AudioSourceManager, so a permitted cached track wins over network sources
 * (online and offline) with zero engine changes beyond the 'offline'→'local'
 * backend mapping.
 */

export const OFFLINE_SOURCE_ID = 'offline';
const DB_NAME = 'wave-offline-downloads';
const DB_VERSION = 1;
const MAX_BYTES = 150 * 1024 * 1024;

export type OfflineState = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface OfflineMeta {
  trackId: string;
  track: Track;
  sourceId: string;
  mimeType?: string;
  size: number;
  downloadDate: number;
}

export interface OfflineEntry {
  trackId: string;
  track: Track;
  state: OfflineState;
  progress: number;
  total?: number;
  error?: string;
  size?: number;
  mimeType?: string;
  downloadDate?: number;
  sourceId?: string;
}

export interface OfflineStore {
  listMetas(): Promise<OfflineMeta[]>;
  putMeta(meta: OfflineMeta): Promise<void>;
  deleteMeta(id: string): Promise<void>;
  getAudio(id: string): Promise<Blob | null>;
  putAudio(id: string, blob: Blob): Promise<void>;
  deleteAudio(id: string): Promise<void>;
  getArtwork(id: string): Promise<Blob | null>;
  putArtwork(id: string, blob: Blob): Promise<void>;
  deleteArtwork(id: string): Promise<void>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexeddb unavailable'));
        return;
      }
    } catch {
      reject(new Error('indexeddb unavailable'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('idb open failed'));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'trackId' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'trackId' });
      if (!db.objectStoreNames.contains('artwork')) db.createObjectStore('artwork', { keyPath: 'trackId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
    req.onblocked = () => reject(new Error('indexeddb blocked'));
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (t: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, mode);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('idb transaction failed'));
      return;
    }
    let req: IDBRequest<T>;
    try {
      req = work(t);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('idb request failed'));
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb request failed'));
  });
}

async function withDb<T>(stores: string[], mode: IDBTransactionMode, work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await work(db);
  } finally {
    try {
      db.close();
    } catch {}
  }
}

/** Persistent IndexedDB backend. Nothing touches storage before first use. */
export function createIndexedDbOfflineStore(): OfflineStore {
  return {
    listMetas: () =>
      withDb(['tracks'], 'readonly', async (db) => {
        const all = await tx<OfflineMeta[]>(db, ['tracks'], 'readonly', (t) => t.objectStore('tracks').getAll());
        return Array.isArray(all) ? all : [];
      }),
    putMeta: (meta) =>
      withDb(['tracks'], 'readwrite', async (db) => {
        await tx(db, ['tracks'], 'readwrite', (t) => t.objectStore('tracks').put(meta));
      }),
    deleteMeta: (id) =>
      withDb(['tracks'], 'readwrite', async (db) => {
        await tx(db, ['tracks'], 'readwrite', (t) => t.objectStore('tracks').delete(id));
      }),
    getAudio: (id) =>
      withDb(['audio'], 'readonly', async (db) => {
        const rec = await tx<{ trackId: string; blob: Blob } | undefined>(
          db,
          ['audio'],
          'readonly',
          (t) => t.objectStore('audio').get(id),
        );
        return rec?.blob ?? null;
      }),
    putAudio: (id, blob) =>
      withDb(['audio'], 'readwrite', async (db) => {
        await tx(db, ['audio'], 'readwrite', (t) => t.objectStore('audio').put({ trackId: id, blob }));
      }),
    deleteAudio: (id) =>
      withDb(['audio'], 'readwrite', async (db) => {
        await tx(db, ['audio'], 'readwrite', (t) => t.objectStore('audio').delete(id));
      }),
    getArtwork: (id) =>
      withDb(['artwork'], 'readonly', async (db) => {
        const rec = await tx<{ trackId: string; blob: Blob } | undefined>(
          db,
          ['artwork'],
          'readonly',
          (t) => t.objectStore('artwork').get(id),
        );
        return rec?.blob ?? null;
      }),
    putArtwork: (id, blob) =>
      withDb(['artwork'], 'readwrite', async (db) => {
        await tx(db, ['artwork'], 'readwrite', (t) => t.objectStore('artwork').put({ trackId: id, blob }));
      }),
    deleteArtwork: (id) =>
      withDb(['artwork'], 'readwrite', async (db) => {
        await tx(db, ['artwork'], 'readwrite', (t) => t.objectStore('artwork').delete(id));
      }),
  };
}

/** Volatile backend for tests (and IDB-less environments). */
export function createMemoryOfflineStore(): OfflineStore & { audioCount(): number } {
  const metas = new Map<string, OfflineMeta>();
  const audio = new Map<string, Blob>();
  const art = new Map<string, Blob>();
  return {
    audioCount: () => audio.size,
    listMetas: async () => [...metas.values()],
    putMeta: async (m) => {
      metas.set(m.trackId, m);
    },
    deleteMeta: async (id) => {
      metas.delete(id);
    },
    getAudio: async (id) => audio.get(id) ?? null,
    putAudio: async (id, blob) => {
      audio.set(id, blob);
    },
    deleteAudio: async (id) => {
      audio.delete(id);
    },
    getArtwork: async (id) => art.get(id) ?? null,
    putArtwork: async (id, blob) => {
      art.set(id, blob);
    },
    deleteArtwork: async (id) => {
      art.delete(id);
    },
  };
}

export interface FetchBytesResult {
  blob: Blob;
  mimeType?: string;
  sourceId: string;
}

export type FetchStreamBytes = (
  track: Track,
  signal: AbortSignal,
  onProgress: (loaded: number, total?: number) => void,
) => Promise<FetchBytesResult>;

/** Production byte fetcher: resolves through the source manager, but only
 *  persists bytes served from a user-configured host. Anything else throws. */
async function defaultFetchStreamBytes(
  manager: OfflineDownloadManager,
  track: Track,
  signal: AbortSignal,
  onProgress: (loaded: number, total?: number) => void,
): Promise<FetchBytesResult> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('you appear to be offline');
  } catch {
    // Non-browser runtimes: proceed.
  }
  const { resolved } = await audioSourceManager.resolve(track, { forceRefresh: true });
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  if (!resolved || resolved.type !== 'direct' || !resolved.url) {
    throw new Error('no downloadable stream available');
  }
  // Rights gate on the actual bytes: the resolved URL must live on a
  // user-configured host. Platform CDN URLs are never persisted here.
  if (!manager.isUserHostedUrl(resolved.url)) {
    throw new Error('offline downloads are not permitted for this source');
  }
  let res: Response;
  try {
    res = await fetch(resolved.url, { signal });
  } catch (e: any) {
    if (signal.aborted || e?.name === 'AbortError') throw new DOMException('aborted', 'AbortError');
    throw new Error('network request failed');
  }
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const totalHeader = res.headers?.get?.('content-length');
  const total = totalHeader ? Number(totalHeader) : NaN;
  const knownTotal = Number.isFinite(total) && total > 0 ? total : undefined;
  if (knownTotal !== undefined && knownTotal > MAX_BYTES) {
    throw new Error('file exceeds the 150 MB offline limit');
  }
  const mime = res.headers?.get?.('content-type')?.split(';')[0]?.trim() || undefined;
  if (!res.body || typeof (res.body as ReadableStream).getReader !== 'function') {
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) throw new Error('file exceeds the 150 MB offline limit');
    if (blob.size === 0) throw new Error('downloaded file is empty');
    onProgress(blob.size, blob.size);
    return { blob, mimeType: mime, sourceId: resolved.sourceId };
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (value) {
        loaded += value.byteLength;
        if (loaded > MAX_BYTES) throw new Error('file exceeds the 150 MB offline limit');
        chunks.push(value as BlobPart);
      }
      onProgress(loaded, knownTotal);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  if (loaded === 0) throw new Error('downloaded file is empty');
  return { blob: new Blob(chunks, { type: mime || 'audio/mpeg' }), mimeType: mime, sourceId: resolved.sourceId };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export class OfflineDownloadManager {
  private entries = new Map<string, OfflineEntry>();
  private listeners = new Set<() => void>();
  private controllers = new Map<string, AbortController>();
  private urlMemo = new Map<string, string>();
  private artMemo = new Map<string, string>();
  private hydratePromise: Promise<void> | null = null;
  private userHosts: string[] | null;
  private fetchBytes: FetchStreamBytes;

  constructor(
    private store: OfflineStore,
    fetchBytes?: FetchStreamBytes,
    opts: { customHosts?: string[] } = {},
  ) {
    this.userHosts = opts.customHosts ?? null;
    this.fetchBytes =
      fetchBytes ?? ((t, signal, onProgress) => defaultFetchStreamBytes(this, t, signal, onProgress));
  }

  /** Hosts the user controls (Settings → Audio sources). Null = read live. */
  private getCustomHosts(): string[] {
    if (this.userHosts) return this.userHosts;
    try {
      return getCustomSources().map((d) => d.baseUrl.replace(/\/+$/, ''));
    } catch {
      return [];
    }
  }

  /** True only for http(s) URLs under a user-configured host. */
  isUserHostedUrl(url?: string): boolean {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    const norm = url.replace(/\/+$/, '');
    return this.getCustomHosts().some((b) => !!b && (norm === b || norm.startsWith(`${b}/`)));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {}
    }
  }

  /** Load persisted downloads into memory. Idempotent; never throws. */
  hydrate(): Promise<void> {
    if (!this.hydratePromise) {
      this.hydratePromise = this.store
        .listMetas()
        .then((metas) => {
          for (const m of metas) {
            if (!m || typeof m.trackId !== 'string' || !m.track) continue;
            this.entries.set(m.trackId, {
              trackId: m.trackId,
              track: m.track,
              state: 'completed',
              progress: 1,
              size: m.size,
              mimeType: m.mimeType,
              downloadDate: m.downloadDate,
              sourceId: m.sourceId,
            });
          }
          this.emit();
        })
        .catch(() => {
          // Storage unavailable — manager stays usable for the session.
        });
    }
    return this.hydratePromise;
  }

  getEntry(trackId: string): OfflineEntry | undefined {
    return this.entries.get(trackId);
  }

  entriesList(): OfflineEntry[] {
    return [...this.entries.values()];
  }

  isDownloaded(trackId: string): boolean {
    return this.entries.get(trackId)?.state === 'completed';
  }

  /** Completed downloads as playable tracks, newest first. */
  listOfflineTracks(): Track[] {
    return [...this.entries.values()]
      .filter((e) => e.state === 'completed')
      .sort((a, b) => (b.downloadDate || 0) - (a.downloadDate || 0))
      .map((e) => e.track);
  }

  canDownload(track: Track | null | undefined): { eligible: boolean; reason?: string; alreadyOffline?: boolean } {
    if (!track || typeof track.id !== 'string' || !track.id) {
      return { eligible: false, reason: 'invalid track' };
    }
    try {
      if (!settingsStore.get().experimentalOffline) {
        return { eligible: false, reason: 'offline mode is disabled in Settings' };
      }
    } catch {
      // Settings unreadable — allow the attempt; storage errors surface as failed.
    }
    if (this.isDownloaded(track.id)) {
      return { eligible: false, alreadyOffline: true, reason: 'already downloaded' };
    }
    if (track.source === 'local' || track.streamUrl?.startsWith('blob:')) {
      return { eligible: false, alreadyOffline: true, reason: 'already stored on this device' };
    }
    // Rights rule: only tracks explicitly marked custom or files served from
    // a user-configured host. Platform CDN URLs never qualify.
    if (track.source === 'custom' || this.isUserHostedUrl(track.downloadUrl) || this.isUserHostedUrl(track.streamUrl)) {
      return { eligible: true };
    }
    return { eligible: false, reason: 'offline downloads are not permitted for this source' };
  }

  /** Queue (or restart) a download. No-op when already queued/downloading/completed. */
  queueDownload(track: Track): string | null {
    if (!track || typeof track.id !== 'string' || !track.id) return null;
    const existing = this.entries.get(track.id);
    if (existing && (existing.state === 'queued' || existing.state === 'downloading' || existing.state === 'completed')) {
      return track.id;
    }
    const gate = this.canDownload(track);
    if (!gate.eligible) return null;
    this.entries.set(track.id, { trackId: track.id, track, state: 'queued', progress: 0 });
    this.emit();
    void this.run(track.id);
    return track.id;
  }

  cancel(trackId: string): void {
    const entry = this.entries.get(trackId);
    const controller = this.controllers.get(trackId);
    try {
      controller?.abort();
    } catch {}
    if (entry && (entry.state === 'queued' || entry.state === 'downloading')) {
      entry.state = 'cancelled';
      entry.error = undefined;
      this.emit();
    }
  }

  /** Delete cached audio, metadata and artwork. Never throws. */
  async remove(trackId: string): Promise<boolean> {
    this.cancel(trackId);
    this.controllers.delete(trackId);
    const existed = this.entries.has(trackId);
    this.entries.delete(trackId);
    const url = this.urlMemo.get(trackId);
    if (url) {
      this.urlMemo.delete(trackId);
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    const art = this.artMemo.get(trackId);
    if (art) {
      this.artMemo.delete(trackId);
      try {
        URL.revokeObjectURL(art);
      } catch {}
    }
    try {
      await Promise.all([
        this.store.deleteAudio(trackId).catch(() => {}),
        this.store.deleteMeta(trackId).catch(() => {}),
        this.store.deleteArtwork(trackId).catch(() => {}),
      ]);
    } catch {}
    this.emit();
    return existed;
  }

  retry(trackId: string): void {
    const entry = this.entries.get(trackId);
    if (!entry) return;
    if (entry.state !== 'failed' && entry.state !== 'cancelled') return;
    this.entries.set(trackId, {
      trackId,
      track: entry.track,
      state: 'queued',
      progress: 0,
    });
    this.emit();
    void this.run(trackId);
  }

  /** Session blob URL for a completed download. Null when the blob is gone
   *  (missing-track case) — callers fall back to online resolution. */
  async ensurePlaybackUrl(trackId: string): Promise<{ url: string; mimeType?: string } | null> {
    const entry = this.entries.get(trackId);
    if (!entry || entry.state !== 'completed') return null;
    const memo = this.urlMemo.get(trackId);
    if (memo) return { url: memo, mimeType: entry.mimeType };
    let blob: Blob | null = null;
    try {
      blob = await this.store.getAudio(trackId);
    } catch {
      blob = null;
    }
    if (!blob || blob.size === 0) {
      entry.state = 'failed';
      entry.error = 'cached audio is missing';
      this.emit();
      return null;
    }
    let url: string;
    try {
      url = URL.createObjectURL(blob);
    } catch {
      return null;
    }
    this.urlMemo.set(trackId, url);
    return { url, mimeType: entry.mimeType };
  }

  /** Memoized artwork URL for offline display (sync; may be undefined). */
  artworkUrl(trackId: string): string | undefined {
    return this.artMemo.get(trackId);
  }

  /** Best-effort artwork materialization for offline display. Never throws. */
  async ensureArtwork(trackId: string): Promise<string | null> {
    const memo = this.artMemo.get(trackId);
    if (memo) return memo;
    let blob: Blob | null = null;
    try {
      blob = await this.store.getArtwork(trackId);
    } catch {
      return null;
    }
    if (!blob || blob.size === 0) return null;
    try {
      const url = URL.createObjectURL(blob);
      this.artMemo.set(trackId, url);
      this.emit();
      return url;
    } catch {
      return null;
    }
  }

  private async run(trackId: string): Promise<void> {
    const entry = this.entries.get(trackId);
    if (!entry || entry.state !== 'queued') return;
    const controller = new AbortController();
    this.controllers.set(trackId, controller);
    const { signal } = controller;
    entry.state = 'downloading';
    entry.progress = 0;
    entry.error = undefined;
    this.emit();
    const onProgress = (loaded: number, total?: number) => {
      const cur = this.entries.get(trackId);
      if (!cur || cur.state !== 'downloading') return;
      cur.progress = total && total > 0 ? Math.min(1, loaded / total) : 0;
      cur.total = total;
      this.emit();
    };
    try {
      const { blob, mimeType, sourceId } = await this.fetchBytes(entry.track, signal, onProgress);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const meta: OfflineMeta = {
        trackId,
        track: entry.track,
        sourceId,
        mimeType,
        size: blob.size,
        downloadDate: Date.now(),
      };
      try {
        await this.store.putAudio(trackId, blob);
        await this.store.putMeta(meta);
      } catch (e) {
        try {
          await this.store.deleteAudio(trackId).catch(() => {});
        } catch {}
        throw e instanceof Error ? e : new Error('storage write failed');
      }
      // Artwork is decorative — a failure here never fails the download.
      void this.fetchArtwork(entry.track, trackId, signal);
      const cur = this.entries.get(trackId);
      if (!cur || cur.state !== 'downloading') return;
      cur.state = 'completed';
      cur.progress = 1;
      cur.size = blob.size;
      cur.mimeType = mimeType;
      cur.downloadDate = meta.downloadDate;
      cur.sourceId = sourceId;
      this.emit();
    } catch (e: any) {
      const cur = this.entries.get(trackId);
      if (!cur) return;
      if (signal.aborted || e?.name === 'AbortError') {
        if (cur.state === 'downloading' || cur.state === 'queued') {
          cur.state = 'cancelled';
          cur.error = undefined;
          this.emit();
        }
        return;
      }
      cur.state = 'failed';
      cur.error = String(e?.message || 'download failed').slice(0, 140);
      this.emit();
    } finally {
      if (this.controllers.get(trackId) === controller) this.controllers.delete(trackId);
    }
  }

  private async fetchArtwork(track: Track, trackId: string, signal: AbortSignal): Promise<void> {
    try {
      const src = track.thumbnail;
      if (!src || !/^https?:\/\//.test(src)) return;
      if (signal.aborted) return;
      const res = await fetch(src, { signal });
      if (!res.ok) return;
      const type = res.headers?.get?.('content-type')?.split(';')[0]?.trim() || '';
      if (type && !type.startsWith('image/')) return;
      const blob = await res.blob();
      if (!blob || blob.size === 0 || blob.size > 8 * 1024 * 1024) return;
      await this.store.putArtwork(trackId, blob);
    } catch {
      // Decorative only.
    }
  }
}

function createSingleton(): OfflineDownloadManager {
  const manager = new OfflineDownloadManager(createIndexedDbOfflineStore());
  audioSourceManager.setOfflineProvider({
    sourceId: OFFLINE_SOURCE_ID,
    has: (trackId) => manager.isDownloaded(trackId),
    load: (trackId) => manager.ensurePlaybackUrl(trackId),
  });
  void manager.hydrate();
  return manager;
}

let singleton: OfflineDownloadManager | null = null;

function getSingleton(): OfflineDownloadManager {
  if (!singleton) singleton = createSingleton();
  return singleton;
}

/** Test seam: isolated manager with injected store, byte fetcher and hosts. */
export function createOfflineManagerForTests(
  store: OfflineStore,
  fetchBytes: FetchStreamBytes,
  opts: { customHosts?: string[] } = {},
): OfflineDownloadManager {
  return new OfflineDownloadManager(store, fetchBytes, opts);
}

export function subscribeOffline(fn: () => void): () => void {
  return getSingleton().subscribe(fn);
}

export function getOfflineEntry(trackId: string): OfflineEntry | undefined {
  return getSingleton().getEntry(trackId);
}

export function isOfflineDownloaded(trackId: string): boolean {
  return getSingleton().isDownloaded(trackId);
}

export function listOfflineTracks(): Track[] {
  return getSingleton().listOfflineTracks();
}

export function canDownloadOffline(track: Track | null | undefined): {
  eligible: boolean;
  reason?: string;
  alreadyOffline?: boolean;
} {
  return getSingleton().canDownload(track);
}

export function queueOfflineDownload(track: Track): string | null {
  return getSingleton().queueDownload(track);
}

export function cancelOfflineDownload(trackId: string): void {
  getSingleton().cancel(trackId);
}

export function removeOfflineDownload(trackId: string): Promise<boolean> {
  return getSingleton().remove(trackId);
}

export function retryOfflineDownload(trackId: string): void {
  getSingleton().retry(trackId);
}

export function offlineArtworkUrl(trackId: string): string | undefined {
  return getSingleton().artworkUrl(trackId);
}

export function ensureOfflineArtwork(trackId: string): Promise<string | null> {
  return getSingleton().ensureArtwork(trackId);
}
