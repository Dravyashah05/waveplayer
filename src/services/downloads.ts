import { importLocalFiles, listLocalFiles, type LocalFileMeta } from './localLibrary';

// DownloadManager — ONLY for audio the user provides themselves (local file
// imports persisted to IndexedDB). It never caches platform streams and has
// no DRM/circumvention capability: states below track the user-file import
// pipeline (queued → downloading → completed/failed/cancelled).

export type DownloadState = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadItem {
  id: string;
  name: string;
  state: DownloadState;
  progress: number;
  error?: string;
}

const subs = new Set<() => void>();
const items = new Map<string, DownloadItem>();
let cancelledAll = false;

function emit() {
  for (const fn of [...subs]) {
    try {
      fn();
    } catch {}
  }
}

export function subscribeDownloads(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function downloadItems(): DownloadItem[] {
  return [...items.values()];
}

export function cancelDownload(id: string): void {
  const it = items.get(id);
  if (it && (it.state === 'queued' || it.state === 'downloading')) {
    it.state = 'cancelled';
    emit();
  }
}

export function clearFinishedDownloads(): void {
  for (const [id, it] of items) {
    if (it.state === 'completed' || it.state === 'failed' || it.state === 'cancelled') items.delete(id);
  }
  emit();
}

/** Persist user-selected audio files for offline playback, with progress. */
export async function queueUserFiles(files: FileList | File[]): Promise<{ imported: number; skipped: number }> {
  const list = [...files];
  cancelledAll = false;
  const CHUNK = 3;
  let imported = 0;
  let skipped = 0;
  for (let i = 0; i < list.length; i += CHUNK) {
    const batch = list.slice(i, i + CHUNK);
    for (const f of batch) {
      const id = `${f.name}|${f.size}`;
      items.set(id, { id, name: f.name, state: 'queued', progress: 0 });
    }
    emit();
    await Promise.all(
      batch.map(async (f) => {
        const id = `${f.name}|${f.size}`;
        const it = items.get(id);
        if (!it || cancelledAll || it.state === 'cancelled') return;
        it.state = 'downloading';
        emit();
        try {
          const r = await importLocalFiles([f]);
          const cur = items.get(id);
          if (!cur || cur.state === 'cancelled') return;
          imported += r.imported;
          skipped += r.skipped;
          cur.state = r.imported > 0 ? 'completed' : 'failed';
          cur.progress = 1;
          if (r.imported === 0) cur.error = 'unsupported or unreadable file';
        } catch (e: any) {
          const cur = items.get(id);
          if (cur && cur.state !== 'cancelled') {
            cur.state = 'failed';
            cur.error = String(e?.message || e).slice(0, 120);
          }
        }
        emit();
      }),
    );
  }
  return { imported, skipped };
}

export function cancelAllDownloads(): void {
  cancelledAll = true;
  for (const it of items.values()) {
    if (it.state === 'queued' || it.state === 'downloading') it.state = 'cancelled';
  }
  emit();
}

export type { LocalFileMeta };
export { listLocalFiles };
