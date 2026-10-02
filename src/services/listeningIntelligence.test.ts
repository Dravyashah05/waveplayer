import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AFFINITY_WEIGHTS,
  classifySkipPosition,
  completionBucket,
} from './affinityWeights';
import {
  eventWeight,
  getPlayCount,
  getSkipCount,
  isTechnicalFailure,
  logEvent,
} from './listeningStore';
import { engagement } from './userProfile';
import {
  groupHistoryByRecency,
  historyIdentityKey,
  mergeHistories,
} from './historyMerge';
import { buildTasteProfile } from './tasteProfile';
import { currentScope, scopeKeyFor } from './scopedStorage';
import type { Track } from '../types';

function track(over: Partial<Track> & { id: string }): Track {
  return {
    title: 'Test Song',
    author: 'Test Artist',
    thumbnail: '',
    duration: '3:20',
    durationSeconds: 200,
    url: '',
    ...over,
  } as Track;
}

describe('listening intelligence', () => {
  it('buckets completion fractions without verdicts', () => {
    assert.equal(completionBucket(0), 'instant');
    assert.equal(completionBucket(0.09), 'instant');
    assert.equal(completionBucket(0.1), 'early');
    assert.equal(completionBucket(0.29), 'early');
    assert.equal(completionBucket(0.3), 'partial');
    assert.equal(completionBucket(0.59), 'partial');
    assert.equal(completionBucket(0.6), 'substantial');
    assert.equal(completionBucket(0.89), 'substantial');
    assert.equal(completionBucket(0.9), 'completed');
    assert.equal(completionBucket(1), 'completed');
    assert.equal(completionBucket(NaN), 'instant');
  });

  it('classifies skip position from raw progress', () => {
    assert.equal(classifySkipPosition(5, 200), 'instant');
    assert.equal(classifySkipPosition(40, 200), 'early');
    assert.equal(classifySkipPosition(100, 200), 'mid');
    assert.equal(classifySkipPosition(150, 200), 'late');
    assert.equal(classifySkipPosition(0, 0), 'instant');
  });

  it('detects technical failures (never taste signals)', () => {
    assert.equal(isTechnicalFailure({ event: 'error', meta: { reason: 'x' } }), true);
    assert.equal(isTechnicalFailure({ event: 'skip', meta: { via: 'error', technical: true } }), true);
    assert.equal(isTechnicalFailure({ event: 'skip', meta: { via: 'error' } }), true);
    assert.equal(isTechnicalFailure({ event: 'skip', meta: { via: 'next' } }), false);
    assert.equal(isTechnicalFailure({ event: 'skip', meta: undefined }), false);
    assert.equal(isTechnicalFailure({ event: 'complete', meta: undefined }), false);
  });

  it('keeps weights in one config file', () => {
    assert.ok(AFFINITY_WEIGHTS.like > AFFINITY_WEIGHTS.play);
    assert.ok(AFFINITY_WEIGHTS.play > 0);
    assert.ok(AFFINITY_WEIGHTS.unlike < 0);
    assert.equal(AFFINITY_WEIGHTS.technicalError, 0);
    assert.equal(eventWeight('error'), 0);
    assert.equal(eventWeight('pause'), 0);
    assert.ok(eventWeight('add_to_playlist') > eventWeight('add_to_queue'));
  });

  it('treats technical failures as neutral (no engagement, no skip count)', () => {
    const id = `__tech_${Date.now()}`;
    const t = track({ id });
    logEvent({ songId: id, track: t, event: 'play', playedSeconds: 0, duration: 200 });
    logEvent({
      songId: id, track: t, event: 'error', playedSeconds: 3, duration: 200,
      meta: { via: 'error', technical: true, errorKind: 'YOUTUBE_STREAM_FAILED' },
    });
    logEvent({
      songId: id, track: t, event: 'skip', playedSeconds: 3, duration: 200,
      meta: { via: 'error', technical: true },
    });
    assert.equal(getSkipCount(id), 0);
    // only the plain play contributes
    assert.ok(Math.abs(engagement(id) - AFFINITY_WEIGHTS.play) < 0.01);
  });

  it('records genuine completion as positive and early skip as negative', () => {
    const goodId = `__good_${Date.now()}`;
    const badId = `__bad_${Date.now()}`;
    logEvent({ songId: goodId, track: track({ id: goodId }), event: 'play', playedSeconds: 0, duration: 200 });
    logEvent({ songId: goodId, track: track({ id: goodId }), event: 'complete', playedSeconds: 200, duration: 200 });
    logEvent({ songId: badId, track: track({ id: badId }), event: 'play', playedSeconds: 0, duration: 200 });
    logEvent({ songId: badId, track: track({ id: badId }), event: 'skip', playedSeconds: 4, duration: 200, meta: { via: 'next' } });
    assert.ok(engagement(goodId) > 1);
    assert.ok(engagement(badId) < 0);
    // play + complete both count as plays (existing index semantics)
    assert.equal(getPlayCount(goodId), 2);
  });

  it('builds deterministic identity keys (stable IDs win)', () => {
    const a = track({ id: 'dQw4w9WgXcQ', title: '  Hello (Official Video) ', author: 'Adele', durationSeconds: 295 });
    const b = track({ id: 'dQw4w9WgXcQ', title: 'hello', author: 'adele', durationSeconds: 296 });
    assert.equal(historyIdentityKey(a), historyIdentityKey(b));
    assert.ok(historyIdentityKey(a).startsWith('yt:'));
    const c = track({ id: 'other-id', title: 'Hello', author: 'Adele', durationSeconds: 295 });
    const d = track({ id: 'other-id', title: 'Hello [Remastered]', author: 'ADELE', durationSeconds: 297 });
    assert.equal(historyIdentityKey(c), historyIdentityKey(d));
    const e = track({ id: 'x1', title: 'Hello', author: 'Adele', durationSeconds: 295 });
    const f = track({ id: 'x2', title: 'Goodbye', author: 'Adele', durationSeconds: 295 });
    assert.notEqual(historyIdentityKey(e), historyIdentityKey(f));
  });

  it('merges Wave + YT history without duplicates, preserving sources', () => {
    const wave = [track({ id: 'dQw4w9WgXcQ', title: 'Shared', source: 'saavn' })];
    const yt = [
      track({ id: 'dQw4w9WgXcQ', title: 'Shared', source: 'ytmusic' }),
      track({ id: '9bZkp7q19f0', title: 'YT Only', source: 'ytmusic' }),
    ];
    const merged = mergeHistories(wave, yt);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0].sources, ['wave', 'ytmusic']);
    assert.equal(merged[0].primarySource, 'wave');
    assert.deepEqual(merged[1].sources, ['ytmusic']);
  });

  it('groups history into Today / Yesterday / Earlier', () => {
    const now = Date.now();
    const sections = groupHistoryByRecency([
      { track: track({ id: 't1' }), sources: ['wave'], primarySource: 'wave', lastPlayedAt: now - 1000 },
      { track: track({ id: 't2' }), sources: ['wave'], primarySource: 'wave', lastPlayedAt: now - 25 * 3600 * 1000 },
      { track: track({ id: 't3' }), sources: ['ytmusic'], primarySource: 'ytmusic', lastPlayedAt: now - 10 * 86400 * 1000 },
      { track: track({ id: 't4' }), sources: ['ytmusic'], primarySource: 'ytmusic' },
    ]);
    assert.equal(sections[0].key, 'today');
    assert.equal(sections[1].key, 'yesterday');
    assert.equal(sections[2].key, 'earlier');
    assert.equal(sections[0].entries.length, 1);
    assert.equal(sections[1].entries.length, 1);
    assert.equal(sections[2].entries.length, 2);
  });

  it('isolates scoped storage per user with a local fallback', () => {
    assert.equal(currentScope(), 'local');
    const a = scopeKeyFor('google:123', 'yt_history_v1');
    const b = scopeKeyFor('google:456', 'yt_history_v1');
    assert.notEqual(a, b);
    assert.equal(scopeKeyFor('google:123', 'yt_history_v1'), a);
    assert.ok(a.includes('google_123'));
  });

  it('builds a recommendation-ready taste profile from raw events', () => {
    const artist = `Taste Artist ${Date.now()}`;
    const id = `__taste_${Date.now()}`;
    const t = track({ id, author: artist, language: 'English', year: 2015, durationSeconds: 210 });
    logEvent({ songId: id, track: t, event: 'play', playedSeconds: 0, duration: 210 });
    logEvent({ songId: id, track: t, event: 'complete', playedSeconds: 210, duration: 210 });
    const profile = buildTasteProfile();
    assert.ok(profile.favoriteArtists.some((a) => a.name === artist.toLowerCase()));
    assert.ok(profile.averageCompletionRate >= 0 && profile.averageCompletionRate <= 1);
    assert.ok(profile.skipRate >= 0 && profile.skipRate <= 1);
    const sourceTotal = profile.sourcePreference.wave + profile.sourcePreference.ytmusic +
      profile.sourcePreference.saavn + profile.sourcePreference.youtube;
    assert.ok(Math.abs(sourceTotal - 1) < 0.05);
    assert.ok(profile.totalEvents > 0);
    assert.ok(typeof profile.discoveryLevel === 'number');
  });
});
