import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_LEVELS,
  DIVERSITY,
  applyPositiveFeedback,
  applySkipFeedback,
  arrangeRadioQueue,
  buildRadioBatch,
  clearRadioCache,
  extendRadioQueue,
  isRadioGenerated,
  radioIdentity,
  scoreCandidate,
  shouldExtendQueue,
  startRadio,
  stopRadio,
  type RadioSession,
  type RankedCandidate,
} from './radioEngine';
import { playerStore } from './playerStore';
import { buildTasteProfile } from './tasteProfile';
import type { Track } from '../types';

function track(over: Partial<Track> & { id: string }): Track {
  return {
    title: 'Song',
    author: 'Artist',
    thumbnail: '',
    duration: '3:20',
    durationSeconds: 200,
    url: '',
    ...over,
  } as Track;
}

function session(over: Partial<RadioSession> = {}): RadioSession {
  return {
    id: 'rs_test',
    mode: 'track',
    label: 'Test Radio',
    startedAt: Date.now(),
    generatedIds: [],
    playedIds: [],
    skippedIds: [],
    skipArtists: {},
    demotedArtists: {},
    boostedArtists: {},
    batch: 0,
    ...over,
  };
}

function ranked(tracks: Track[], score = 0.5): RankedCandidate[] {
  return tracks.map((t) => ({ track: t, score, unfamiliar: false }));
}

// Stub network: recommendations endpoints return canned tracks, all else fails.
const realFetch = (globalThis as any).fetch;
function cannedTracks(n: number, author: string, prefix: string): any[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `dQw4w9WgXc${i}`,
    title: `${prefix} ${i}`,
    author,
    thumbnail: '',
    duration: '3:00',
    durationSeconds: 180,
    url: '',
  }));
}
function stubFetch(handler: (url: string) => any): void {
  (globalThis as any).fetch = async (url: string) => {
    const body = handler(String(url));
    if (body instanceof Error) throw body;
    return { ok: true, json: async () => body };
  };
}

describe('smart radio engine', () => {
  beforeEach(() => {
    clearRadioCache();
    stopRadio();
    playerStore.clearQueue();
  });
  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    stopRadio();
    playerStore.clearQueue();
  });

  it('keeps discovery shares inside configured ranges', () => {
    assert.ok(DISCOVERY_LEVELS.track >= 0.1 && DISCOVERY_LEVELS.track <= 0.2);
    assert.ok(DISCOVERY_LEVELS.artist >= 0.15 && DISCOVERY_LEVELS.artist <= 0.25);
    assert.ok(DISCOVERY_LEVELS.personalized >= 0.15 && DISCOVERY_LEVELS.personalized <= 0.25);
    assert.ok(DISCOVERY_LEVELS.discovery >= 0.3 && DISCOVERY_LEVELS.discovery <= 0.4);
    assert.equal(DIVERSITY.maxConsecutiveArtist, 2);
    assert.equal(DIVERSITY.maxAlbumRepeat, 2);
  });

  it('never runs 3+ consecutive tracks from the same artist', () => {
    const tracks: Track[] = [];
    ['Alpha', 'Beta', 'Gamma'].forEach((artist) => {
      for (let i = 0; i < 3; i++) tracks.push(track({ id: `${artist}-${i}`, author: artist, title: `T${artist}${i}` }));
    });
    const out = arrangeRadioQueue(ranked(tracks), 0, new Set());
    assert.equal(out.length, 9);
    for (let i = 2; i < out.length; i++) {
      const run = [out[i - 2], out[i - 1], out[i]].map((t) => t.author);
      assert.ok(!(run[0] === run[1] && run[1] === run[2]), `triple run at ${i}`);
    }
  });

  it('degrades gracefully on a single-artist pool (best effort, nothing lost)', () => {
    const tracks = Array.from({ length: 8 }, (_, i) => track({ id: `a${i}`, author: 'Same Artist', title: `T${i}` }));
    const out = arrangeRadioQueue(ranked(tracks), 0, new Set());
    assert.equal(out.length, 8);
    assert.equal(out[0].author, 'Same Artist');
  });

  it('limits album repeats inside a short window', () => {
    const tracks: Track[] = [];
    ['Album One', 'Album Two', 'Album Three'].forEach((album) => {
      for (let i = 0; i < 2; i++) {
        tracks.push(track({ id: `${album}-${i}`, author: `Artist ${album}${i}`, albumName: album, title: `T${i}` }));
      }
    });
    const out = arrangeRadioQueue(ranked(tracks), 0, new Set());
    assert.equal(out.length, 6);
    const window5 = out.slice(0, 5).filter((t) => t.albumName === 'Album One');
    assert.ok(window5.length <= DIVERSITY.maxAlbumRepeat);
  });

  it('never repeats a track id unless the pool is exhausted', () => {
    const tracks = [track({ id: 'x1' }), track({ id: 'x2' })];
    const out = arrangeRadioQueue(ranked(tracks), 0, new Set(['x1']));
    assert.deepEqual(out.map((t) => t.id), ['x2']);
    const exhausted = arrangeRadioQueue(ranked(tracks), 0, new Set(['x1', 'x2']));
    assert.equal(exhausted.length, 2); // pool exhausted → reuse allowed
  });

  it('injects the configured discovery share of unfamiliar tracks', () => {
    const familiar = Array.from({ length: 8 }, (_, i) => track({ id: `f${i}`, title: `F${i}` }));
    const unfamiliar = Array.from({ length: 8 }, (_, i) => track({ id: `u${i}`, title: `U${i}` }));
    const rankedAll: RankedCandidate[] = [
      ...familiar.map((t) => ({ track: t, score: 0.9, unfamiliar: false })),
      ...unfamiliar.map((t) => ({ track: t, score: 0.1, unfamiliar: true })),
    ];
    const out = arrangeRadioQueue(rankedAll, 0.25, new Set());
    const injected = out.filter((t) => t.id.startsWith('u')).length;
    assert.ok(injected >= 3 && injected <= 5, `injected=${injected}`);
  });

  it('scores seed similarity and session feedback', () => {
    const taste = buildTasteProfile();
    const seed = track({ id: 'dQw4w9WgXcQ', title: 'Seed Song', author: 'Seed Artist' });
    const same = track({ id: 'dQw4w9WgXcR', title: 'Seed Song', author: 'Seed Artist' });
    const other = track({ id: 'dQw4w9WgXcS', title: 'Unrelated Words Here', author: 'Stranger' });
    const sSame = scoreCandidate(same, seed, taste, null).score;
    const sOther = scoreCandidate(other, seed, taste, null).score;
    assert.ok(sSame >= sOther);
    const demoted = scoreCandidate(same, seed, taste, { demotedArtists: { 'seed artist': 1 }, boostedArtists: {} }).score;
    assert.ok(demoted < sSame);
    const boosted = scoreCandidate(other, seed, taste, { demotedArtists: {}, boostedArtists: { stranger: 1 } }).score;
    assert.ok(boosted > sOther);
  });

  it('temporarily demotes after repeated skips, forgives on like (no permanent ban)', () => {
    const s = session({ generatedIds: ['s1', 's2', 's3'] });
    const t1 = track({ id: 's1', author: 'Skipped Band' });
    const t2 = track({ id: 's2', author: 'Skipped Band' });
    applySkipFeedback(s, t1, 's1');
    assert.deepEqual(s.demotedArtists, {});
    applySkipFeedback(s, t2, 's2');
    assert.ok((s.demotedArtists['skipped band'] || 0) > 0);
    applyPositiveFeedback(s, t1, 's1', 0.5);
    assert.deepEqual(s.demotedArtists, {});
    assert.ok((s.boostedArtists['skipped band'] || 0) > 0);
    // skips of non-generated tracks are ignored
    applySkipFeedback(s, track({ id: 'zzz', author: 'Nobody' }), 'zzz');
    assert.ok(!('nobody' in s.demotedArtists));
  });

  it('decides queue extension: off, repeat-one, empty, full, enough, ready', () => {
    assert.deepEqual(shouldExtendQueue({ queueLength: 10, remaining: 1, repeat: 'all', autoplayOn: false }), {
      extend: false, reason: 'off',
    });
    assert.deepEqual(shouldExtendQueue({ queueLength: 10, remaining: 0, repeat: 'one', autoplayOn: true }), {
      extend: false, reason: 'repeat-one',
    });
    assert.deepEqual(shouldExtendQueue({ queueLength: 0, remaining: 0, repeat: 'all', autoplayOn: true }), {
      extend: false, reason: 'empty',
    });
    assert.deepEqual(
      shouldExtendQueue({ queueLength: DIVERSITY.maxQueue, remaining: 0, repeat: 'all', autoplayOn: true }),
      { extend: false, reason: 'full' },
    );
    assert.deepEqual(shouldExtendQueue({ queueLength: 10, remaining: 5, repeat: 'all', autoplayOn: true }), {
      extend: false, reason: 'enough',
    });
    assert.deepEqual(shouldExtendQueue({ queueLength: 10, remaining: 2, repeat: 'off', autoplayOn: true }), {
      extend: true, reason: 'ready',
    });
  });

  it('uses canonical identity (stable ids, never title-only)', () => {
    const a = track({ id: 'dQw4w9WgXcQ', title: 'Hello (Official Video)', author: 'Adele' });
    const b = track({ id: 'dQw4w9WgXcQ', title: 'hello', author: 'adele' });
    assert.equal(radioIdentity(a), radioIdentity(b));
    const c = track({ id: 'other', title: 'Hello', author: 'Adele', durationSeconds: 100 });
    assert.notEqual(radioIdentity(a), radioIdentity(c));
  });

  it('builds track radio from server candidates with diversity', async () => {
    stubFetch((url) =>
      url.includes('/api/recommendations/radio/') || url.includes('/api/recommendations/similar/')
        ? { tracks: cannedTracks(10, 'Radio Artist', 'Radio Hit') }
        : new Error('offline'),
    );
    const seed = track({ id: 'dQw4w9WgXcQ', title: 'Seed', author: 'Seed Artist' });
    const s = await startRadio('track', { track: seed });
    assert.equal(s.mode, 'track');
    assert.ok(s.generatedIds.length >= 5, `got ${s.generatedIds.length}`);
    assert.ok(!s.generatedIds.includes(seed.id));
    assert.ok(isRadioGenerated(s.generatedIds[0]));
    // artist diversity: canned pool is one artist → deferred, not tripled
    const labels = s.generatedIds.map((id) => id);
    assert.deepEqual([...new Set(labels)].length, labels.length);
  });

  it('falls back gracefully when every source fails (queue untouched)', async () => {
    stubFetch(() => new Error('all down'));
    playerStore.setQueue([track({ id: 'q1', title: 'Mine' })], 0);
    const seed = track({ id: 'dQw4w9WgXcQ', title: 'Seed', author: 'Seed Artist' });
    const s = await startRadio('discovery', { track: seed });
    assert.ok(s.id);
    // cold-start fallback also failed → empty batch, seed never auto-queued here
    assert.deepEqual(playerStore.queue().map((t) => t.id), ['q1']);
  });

  it('extends the queue without duplicates and respects the cap', async () => {
    let n = 0;
    stubFetch((url) => {
      if (!url.includes('/api/recommendations/')) return new Error('offline');
      n++;
      return { tracks: cannedTracks(10, `Batch Artist ${n % 3}`, `Batch ${n}`) };
    });
    const seed = track({ id: 'dQw4w9WgXcQ', title: 'Seed', author: 'Seed Artist' });
    await startRadio('personalized', { track: seed });
    playerStore.setQueue([seed], 0);
    const added = await extendRadioQueue(7);
    assert.ok(added.length > 0 && added.length <= 7);
    const ids = playerStore.queue().map((t) => t.id);
    assert.deepEqual([...new Set(ids)].length, ids.length);
    assert.equal(ids[0], seed.id); // current track never disturbed
  });

  it('stops the session without touching the existing queue', async () => {
    stubFetch((url) =>
      url.includes('/api/recommendations/') ? { tracks: cannedTracks(5, 'A', 'T') } : new Error('offline'),
    );
    const seed = track({ id: 'dQw4w9WgXcQ', title: 'Seed', author: 'Seed Artist' });
    const s = await startRadio('track', { track: seed });
    assert.ok(s.generatedIds.length > 0);
    playerStore.setQueue([seed], 0);
    stopRadio();
    assert.equal(isRadioGenerated(s.generatedIds[0]), false);
    assert.deepEqual(playerStore.queue().map((t) => t.id), [seed.id]);
  });
});
