import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Browser shims — playerStore persists queue/index/meta to localStorage.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  get length() { return mem.size; },
  key: (i: number) => [...mem.keys()][i] ?? null,
};
(globalThis as any).window = { dispatchEvent: () => true };

import type { Track } from '../types';
import { playerStore } from './playerStore';

const t = (id: string, author = 'Artist'): Track => ({
  id, title: id, author, thumbnail: '', duration: '3:00', durationSeconds: 180,
  url: `https://x/${id}`, source: 'saavn', type: 'SONG',
});

beforeEach(() => {
  mem.clear();
  playerStore.clearQueue();
});

describe('queue metadata sidecar', () => {
  it('tags setQueue items with provenance without duplicating tracks', () => {
    playerStore.setQueue([t('a'), t('b')], 0, [
      { addedBy: 'playlist', context: 'Chill Mix', playlistId: 'LOCAL_1' },
      { addedBy: 'radio', context: 'track-radio', radioSessionId: 'rs1', seedTitle: 'Tum Hi Ho' },
    ]);
    const metas = playerStore.queueMetas();
    assert.equal(metas.length, 2);
    assert.equal(metas[0].addedBy, 'playlist');
    assert.equal(metas[0].playlistId, 'LOCAL_1');
    assert.equal(metas[1].radioSessionId, 'rs1');
    assert.notEqual(metas[0].queueItemId, metas[1].queueItemId);
  });

  it('defaults to user provenance and mirrors add/remove/move', () => {
    playerStore.setQueue([t('a'), t('b'), t('c')], 0);
    assert.ok(playerStore.queueMetas().every((m) => m.addedBy === 'user'));
    playerStore.addToQueue(t('d'), { addedBy: 'search' });
    assert.equal(playerStore.metaForIndex(3)?.addedBy, 'search');
    // Move carries the label with its track.
    playerStore.moveQueue(3, 0);
    assert.equal(playerStore.queue()[0].id, 'd');
    assert.equal(playerStore.metaForIndex(0)?.addedBy, 'search');
    // Remove keeps the mirror 1:1.
    playerStore.removeFromQueue(0);
    assert.equal(playerStore.queue().length, 3);
    assert.equal(playerStore.queueMetas().length, 3);
    // PlayNext inserts provenance right after current.
    playerStore.playNext(t('z'), { addedBy: 'recommendation', context: 'For You' });
    assert.equal(playerStore.queue()[1].id, 'z');
    assert.equal(playerStore.metaForIndex(1)?.addedBy, 'recommendation');
  });

  it('persists provenance without secrets and recovers session state', () => {
    playerStore.setVolume(62);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
    playerStore.setQueue([t('a'), t('b')], 1, [{ addedBy: 'album', context: 'After Hours', albumId: 'AL1' }]);
    const rawMeta = mem.get('wave:queue_meta');
    assert.ok(rawMeta);
    assert.ok(!/token|secret|cookie|authorization/i.test(rawMeta));
    assert.equal(JSON.parse(mem.get('wave:queue') || '[]').length, 2);
    assert.equal(mem.get('wave:index'), '1');
    assert.equal(mem.get('wave:volume'), '62');
    assert.equal(mem.get('wave:shuffle'), 'true');
    // Repeat cycles off -> all -> one with persistence.
    assert.equal(playerStore.repeat, 'all');
    playerStore.cycleRepeat();
    assert.equal(playerStore.repeat, 'one');
    playerStore.cycleRepeat();
    assert.equal(playerStore.repeat, 'off');
    playerStore.cycleRepeat();
    assert.equal(playerStore.repeat, 'all');
  });

  it('shuffle order preserves the current track and avoids naive clustering', () => {
    const tracks = [t('a1', 'Same'), t('a2', 'Same'), t('b1', 'Other'), t('b2', 'Other2')];
    playerStore.setQueue(tracks, 0);
    playerStore.toggleShuffle();
    // Queue order itself is never mutated by shuffle.
    assert.deepEqual(playerStore.queue().map((x) => x.id), ['a1', 'a2', 'b1', 'b2']);
    // Exact next is predictable via peekNext (no hidden state).
    const nxt = playerStore.peekNext();
    assert.ok(nxt && nxt.id !== 'a1');
    playerStore.toggleShuffle();
  });

  it('keeps currentIndex correct across remove/reorder/shuffle/replace', () => {
    playerStore.setQueue([t('a'), t('b'), t('c'), t('d')], 1);
    assert.equal(playerStore.current()?.id, 'b');
    // Remove an earlier item: index shifts down, same track stays current.
    playerStore.removeFromQueue(0);
    assert.equal(playerStore.current()?.id, 'b');
    assert.equal(playerStore.currentIndex(), 0);
    assert.equal(playerStore.queueMetas().length, 3);
    // Remove the current item: playback continues on the next track.
    playerStore.removeFromQueue(0);
    assert.equal(playerStore.current()?.id, 'c');
    assert.equal(playerStore.queueMetas().length, playerStore.queue().length);
    // Reorder around current: labels travel, current track preserved.
    const before = playerStore.current()?.id;
    playerStore.moveQueue(2, 0);
    assert.equal(playerStore.current()?.id, before);
    assert.equal(playerStore.queueMetas().length, playerStore.queue().length);
    // Shuffle never mutates queue order and keeps current at the pointer.
    playerStore.toggleShuffle();
    assert.equal(playerStore.current()?.id, before);
    const nxt = playerStore.peekNext();
    assert.ok(nxt && nxt.id !== before);
    playerStore.toggleShuffle();
    // Queue replacement resets index + provenance together.
    playerStore.setQueue([t('x')], 0, [{ addedBy: 'playlist', context: 'New' }]);
    assert.equal(playerStore.current()?.id, 'x');
    assert.equal(playerStore.currentIndex(), 0);
    assert.equal(playerStore.metaForIndex(0)?.addedBy, 'playlist');
  });

  it('clearQueue drops tracks and provenance together', () => {
    playerStore.setQueue([t('a')], 0, [{ addedBy: 'radio' }]);
    playerStore.clearQueue();
    assert.equal(playerStore.queue().length, 0);
    assert.equal(playerStore.queueMetas().length, 0);
    assert.equal(playerStore.currentIndex(), -1);
  });
});
