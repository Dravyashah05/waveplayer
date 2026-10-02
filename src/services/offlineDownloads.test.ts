import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../types';
import { audioSourceManager } from './audioSourceManager';
import {
  createMemoryOfflineStore,
  createOfflineManagerForTests,
  formatBytes,
  type FetchStreamBytes,
  type OfflineDownloadManager,
  type OfflineStore,
} from './offlineDownloads';

const TEST_HOSTS = ['https://custom.example'];

function mgr(
  store: OfflineStore,
  fetch: FetchStreamBytes = okBytes,
  hosts: string[] = TEST_HOSTS,
): OfflineDownloadManager {
  return createOfflineManagerForTests(store, fetch, { customHosts: hosts });
}

function track(id: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title: 'Offline Test',
    author: 'Test Artist',
    thumbnail: '',
    duration: '3:00',
    durationSeconds: 180,
    url: '',
    source: 'custom',
    ...extra,
  };
}

const okBytes: FetchStreamBytes = async (t, _signal, onProgress) => {
  onProgress(4, 10);
  onProgress(10, 10);
  return {
    blob: new Blob([`audio-bytes-for-${t.id}`], { type: 'audio/mpeg' }),
    mimeType: 'audio/mpeg',
    sourceId: 'custom:test-host',
  };
};

async function waitFor(cond: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('offline downloads', () => {
  it('only permits user-controlled sources (platform streams are ineligible)', () => {
    const store = createMemoryOfflineStore();
    const m = mgr(store);
    assert.equal(m.canDownload(track('c-1', { source: 'custom' })).eligible, true);
    assert.equal(
      m.canDownload(track('c-2', { source: 'saavn', downloadUrl: 'https://custom.example/c-2.mp3' })).eligible,
      true,
    );
    assert.equal(m.canDownload(track('s-1', { source: 'saavn' })).eligible, false);
    assert.equal(
      m.canDownload(track('s-2', { source: 'saavn', downloadUrl: 'https://cdn.platform.example/s-2.mp3' })).eligible,
      false,
    );
    assert.equal(m.canDownload(track('dQw4w9WgXcQ', { source: 'youtube' })).eligible, false);
    assert.equal(m.canDownload(track('y-1', { source: 'ytmusic' })).eligible, false);
    const local = m.canDownload(track('local:abc', { source: 'local', streamUrl: 'blob:fake' }));
    assert.equal(local.eligible, false);
    assert.equal(local.alreadyOffline, true);
  });

  it('downloads, stores and lists a track (queued → completed)', async () => {
    const store = createMemoryOfflineStore();
    const m = mgr(store);
    const t = track('dl-ok-1');
    assert.equal(m.queueDownload(t), t.id);
    await waitFor(() => m.getEntry(t.id)?.state === 'completed', 'download completion');
    const entry = m.getEntry(t.id)!;
    assert.equal(entry.progress, 1);
    assert.ok((entry.size || 0) > 0);
    assert.ok(entry.downloadDate);
    assert.ok(m.isDownloaded(t.id));
    assert.deepEqual(m.listOfflineTracks().map((x) => x.id), [t.id]);
    const stored = await store.getAudio(t.id);
    assert.ok(stored && stored.size > 0);
    const metas = await store.listMetas();
    assert.equal(metas.length, 1);
    assert.equal(metas[0].trackId, t.id);
    assert.equal(metas[0].sourceId, 'custom:test-host');
  });

  it('cancels an in-flight download', async () => {
    const hanging: FetchStreamBytes = (_t, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    const store = createMemoryOfflineStore();
    const m = mgr(store, hanging);
    const t = track('dl-cancel-1');
    m.queueDownload(t);
    await waitFor(() => m.getEntry(t.id)?.state === 'downloading', 'download start');
    m.cancel(t.id);
    await waitFor(() => m.getEntry(t.id)?.state === 'cancelled', 'cancellation');
    assert.equal(m.isDownloaded(t.id), false);
    assert.equal(await store.getAudio(t.id), null);
  });

  it('removes audio, metadata and artwork together', async () => {
    const store = createMemoryOfflineStore();
    const m = mgr(store);
    const t = track('dl-remove-1');
    m.queueDownload(t);
    await waitFor(() => m.isDownloaded(t.id), 'download completion');
    await store.putArtwork(t.id, new Blob(['art'], { type: 'image/jpeg' }));
    assert.equal(await m.remove(t.id), true);
    assert.equal(m.isDownloaded(t.id), false);
    assert.deepEqual(m.listOfflineTracks(), []);
    assert.equal(await store.getAudio(t.id), null);
    assert.deepEqual(await store.listMetas(), []);
    assert.equal(await store.getArtwork(t.id), null);
    assert.equal(await m.remove(t.id), false);
  });

  it('marks the entry failed when the cached blob goes missing (online fallback)', async () => {
    const store = createMemoryOfflineStore();
    const m = mgr(store);
    const t = track('dl-missing-1');
    m.queueDownload(t);
    await waitFor(() => m.isDownloaded(t.id), 'download completion');
    await store.deleteAudio(t.id);
    assert.equal(await m.ensurePlaybackUrl(t.id), null);
    assert.equal(m.getEntry(t.id)?.state, 'failed');
    assert.match(m.getEntry(t.id)?.error || '', /missing/);
  });

  it('rehydrates persisted downloads after a refresh', async () => {
    const store = createMemoryOfflineStore();
    const first = mgr(store);
    const t = track('dl-refresh-1');
    first.queueDownload(t);
    await waitFor(() => first.isDownloaded(t.id), 'download completion');
    const second = mgr(store);
    await second.hydrate();
    assert.ok(second.isDownloaded(t.id));
    assert.deepEqual(second.listOfflineTracks().map((x) => x.id), [t.id]);
    const playback = await second.ensurePlaybackUrl(t.id);
    assert.ok(playback?.url);
  });

  it('surfaces storage errors as failed instead of crashing', async () => {
    const broken: OfflineStore = {
      ...createMemoryOfflineStore(),
      putAudio: async () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
    };
    const m = mgr(broken);
    const t = track('dl-storage-1');
    m.queueDownload(t);
    await waitFor(() => m.getEntry(t.id)?.state === 'failed', 'storage failure');
    assert.match(m.getEntry(t.id)?.error || '', /quota/i);
    assert.equal(m.isDownloaded(t.id), false);
  });

  it('plays offline through the source manager without network sources', async () => {
    const store = createMemoryOfflineStore();
    const m = mgr(store);
    const t = track('dl-play-1', { streamUrl: 'https://custom.example/dl-play-1.mp3' });
    m.queueDownload(t);
    await waitFor(() => m.isDownloaded(t.id), 'download completion');
    audioSourceManager.setOfflineProvider({
      sourceId: 'offline',
      has: (id) => m.isDownloaded(id),
      load: (id) => m.ensurePlaybackUrl(id),
    });
    try {
      const { resolved, tried } = await audioSourceManager.resolve(t, { adapters: [] });
      assert.equal(resolved?.sourceId, 'offline');
      assert.equal(resolved?.type, 'direct');
      assert.ok(resolved?.url);
      assert.deepEqual(tried, ['offline']);
    } finally {
      audioSourceManager.setOfflineProvider(null);
    }
  });

  it('formats byte sizes for display', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(8 * 1024 * 1024), '8.0 MB');
    assert.equal(formatBytes(NaN), '—');
  });
});
