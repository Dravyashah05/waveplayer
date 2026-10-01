import type { Track } from '../types';
import { registerLocalAudio, unregisterLocalAudio } from './audioSources';

export interface LocalFileMeta {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number | null;
  trackNumber: number | null;
  durationSeconds: number;
  mimeType: string;
  size: number;
  addedAt: number;
  hasArtwork: boolean;
}

const DB_NAME = 'wave-local-library';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('art')) db.createObjectStore('art', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
  });
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, work: (s: IDBTransaction) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = work(t);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb request failed'));
  });
}

function fnvId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `local:${(h >>> 0).toString(36)}${s.length.toString(36)}`;
}

function parseFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(.*?)\s*[-–—]\s*(.+)$/);
  if (m && m[1].trim() && m[2].trim()) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: 'Unknown Artist', title: base || 'Unknown Track' };
}

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement('audio');
      el.preload = 'metadata';
      const done = (v: number) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
        resolve(v);
      };
      el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration) : 0);
      el.onerror = () => done(0);
      el.src = url;
      setTimeout(() => done(0), 8000);
    } catch {
      resolve(0);
    }
  });
}

export function localTrackToWave(meta: LocalFileMeta, blobUrl: string | null, artUrl: string | null): Track {
  return {
    id: meta.id,
    title: meta.title,
    author: meta.artist,
    thumbnail: artUrl || '',
    duration: '',
    durationSeconds: meta.durationSeconds,
    url: blobUrl || '',
    streamUrl: blobUrl || undefined,
    albumName: meta.album || undefined,
    year: meta.year,
    language: undefined,
    source: 'local',
    type: 'SONG',
  };
}

export async function importLocalFiles(files: FileList | File[]): Promise<{ imported: number; skipped: number }> {
  const list = [...files].filter((f) => /^(audio\/|video\/mp4)/.test(f.type) || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4)$/i.test(f.name));
  if (!list.length) return { imported: 0, skipped: (files as File[]).length || 0 };
  const db = await openDb();
  let imported = 0;
  let skipped = (files as unknown as File[]).length - list.length;
  for (const file of list) {
    try {
      const { title, artist } = parseFileName(file.name);
      const id = fnvId(`${file.name}|${file.size}|${file.lastModified}`);
      const existing = await tx(db, ['meta'], 'readonly', (t) => t.objectStore('meta').get(id)).catch(() => null);
      if (existing) {
        skipped++;
        continue;
      }
      const durationSeconds = await probeDuration(file);
      const meta: LocalFileMeta = {
        id,
        title,
        artist,
        album: '',
        genre: '',
        year: null,
        trackNumber: null,
        durationSeconds,
        mimeType: file.type || 'audio/mpeg',
        size: file.size,
        addedAt: Date.now(),
        hasArtwork: false,
      };
      await tx(db, ['meta', 'blobs'], 'readwrite', (t) => {
        t.objectStore('meta').put(meta);
        t.objectStore('blobs').put({ id, blob: file });
        return t.objectStore('blobs').get(id);
      }).catch(async () => {
        // Fallback for transactions spanning two stores on picky engines.
        await tx(db, ['meta'], 'readwrite', (t) => t.objectStore('meta').put(meta));
        await tx(db, ['blobs'], 'readwrite', (t) => t.objectStore('blobs').put({ id, blob: file }));
      });
      imported++;
    } catch {
      skipped++;
    }
  }
  db.close();
  return { imported, skipped };
}

export async function listLocalFiles(): Promise<LocalFileMeta[]> {
  const db = await openDb();
  try {
    const all = await tx<LocalFileMeta[]>(db, ['meta'], 'readonly', (t) => t.objectStore('meta').getAll());
    return (all || []).sort((a, b) => b.addedAt - a.addedAt);
  } finally {
    db.close();
  }
}

export async function searchLocalFiles(query: string): Promise<LocalFileMeta[]> {
  const q = query.trim().toLowerCase();
  const all = await listLocalFiles();
  if (!q) return all;
  return all.filter(
    (m) =>
      m.title.toLowerCase().includes(q) ||
      m.artist.toLowerCase().includes(q) ||
      (m.album || '').toLowerCase().includes(q),
  );
}

export async function deleteLocalFile(id: string): Promise<void> {
  unregisterLocalAudio(id);
  const db = await openDb();
  try {
    await tx(db, ['meta', 'blobs', 'art'], 'readwrite', (t) => {
      t.objectStore('meta').delete(id);
      t.objectStore('blobs').delete(id);
      t.objectStore('art').delete(id);
      return t.objectStore('meta').get(id);
    }).catch(async () => {
      for (const s of ['meta', 'blobs', 'art']) {
        try {
          await tx(db, [s], 'readwrite', (t) => t.objectStore(s).delete(id));
        } catch {}
      }
    });
  } finally {
    db.close();
  }
}

/** Resolve a stored file to a session-playable Wave Track (blob URL). */
export async function playLocalFile(meta: LocalFileMeta): Promise<Track | null> {
  const db = await openDb();
  try {
    const rec = await tx<{ id: string; blob: Blob } | undefined>(db, ['blobs'], 'readonly', (t) => t.objectStore('blobs').get(meta.id));
    const blob = rec?.blob;
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    registerLocalAudio(meta.id, { url, mimeType: meta.mimeType });
    return localTrackToWave(meta, url, null);
  } catch {
    return null;
  } finally {
    db.close();
  }
}
