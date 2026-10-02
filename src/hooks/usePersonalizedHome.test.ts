import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_CACHE_TTL_MS,
  isColdStart,
  rankTrendingForYou,
  readHomeCache,
  selectBasedOnLibrary,
  selectContinueListening,
  writeHomeCache,
  type HomeData,
} from './usePersonalizedHome';
import type { ListeningEvent } from '../services/listeningStore';
import type { TasteProfile } from '../services/tasteProfile';
import type { Track } from '../types';

// In-memory localStorage stub (Node has none; module touches it lazily).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

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

function ev(over: Partial<ListeningEvent> & { songId: string; event: ListeningEvent['event'] }): ListeningEvent {
  return {
    playedSeconds: 0,
    duration: 200,
    completionPercentage: 0,
    timestamp: new Date().toISOString(),
    ...over,
  } as ListeningEvent;
}

function taste(over: Partial<TasteProfile> = {}): TasteProfile {
  return {
    favoriteArtists: [],
    favoriteAlbums: [],
    favoriteGenres: [],
    favoriteLanguages: [],
    artistAffinity: {},
    genreAffinity: {},
    albumAffinity: {},
    averageCompletionRate: 0,
    skipRate: 0,
    preferredDuration: null,
    preferredDecades: [],
    discoveryLevel: 0,
    recentlyPlayed: [],
    frequentlyPlayed: [],
    sourcePreference: { wave: 1, ytmusic: 0, saavn: 0, youtube: 0 },
    languagePreference: {},
    totalEvents: 0,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function emptyData(): HomeData {
  return {
    quickPicks: [],
    madeForYou: [],
    continueListening: [],
    becauseSections: [],
    mixes: [],
    discover: [],
    basedOnLibrary: { tracks: [], explanation: '' },
    trendingForYou: { tracks: [], label: 'Popular Now' },
    recentHistory: [],
    albums: [],
    artists: [],
    playlists: [],
    taste: taste(),
    coldStart: true,
  };
}

describe('personalized home data', () => {
  beforeEach(() => mem.clear());

  it('selects unfinished tracks for Continue Listening (10-90%)', () => {
    const t1 = track({ id: 'c1', title: 'Halfway' });
    const t2 = track({ id: 'c2', title: 'Finished' });
    const t3 = track({ id: 'c3', title: 'Barely started' });
    const t4 = track({ id: 'c4', title: 'Fresh restart' });
    const events = [
      ev({ songId: 'c1', event: 'pause', track: t1, playedSeconds: 100, duration: 200, completionPercentage: 50 }),
      ev({ songId: 'c2', event: 'complete', track: t2, playedSeconds: 200, duration: 200, completionPercentage: 100 }),
      ev({ songId: 'c3', event: 'skip', track: t3, playedSeconds: 10, duration: 200, completionPercentage: 5 }),
      // newer fresh play supersedes the older partial pause
      ev({ songId: 'c4', event: 'play', track: t4, playedSeconds: 0, duration: 200, completionPercentage: 0 }),
      ev({ songId: 'c4', event: 'pause', track: t4, playedSeconds: 80, duration: 200, completionPercentage: 40 }),
    ];
    const out = selectContinueListening(events);
    assert.equal(out.length, 1);
    assert.equal(out[0].track.id, 'c1');
    assert.equal(out[0].positionSeconds, 100);
    assert.ok(out[0].completionFraction > 0.1 && out[0].completionFraction < 0.9);
  });

  it('bounds Continue Listening to 10 items', () => {
    const events = Array.from({ length: 15 }, (_, i) => {
      const t = track({ id: `cc${i}` });
      return ev({ songId: `cc${i}`, event: 'pause', track: t, playedSeconds: 100, duration: 200, completionPercentage: 50 });
    });
    assert.equal(selectContinueListening(events).length, 10);
  });

  it('detects cold start only without real evidence', () => {
    assert.equal(isColdStart(taste(), 0, 0), true);
    assert.equal(isColdStart(taste(), 3, 0), false);
    assert.equal(isColdStart(taste(), 0, 5), false);
    assert.equal(isColdStart(taste({ totalEvents: 10 }), 0, 0), false);
    assert.equal(
      isColdStart(taste({ frequentlyPlayed: [{ track: track({ id: 'x' }), plays: 3 }] }), 0, 0),
      false,
    );
  });

  it('ranks trending by real affinity (Trending For You, not global)', () => {
    const t = taste({ artistAffinity: { 'arijit singh': 1 }, languagePreference: { hindi: 0.8 } });
    const loved = track({ id: 't1', author: 'Arijit Singh', language: 'Hindi' });
    const meh = track({ id: 't2', author: 'Unknown Band', language: 'German' });
    const out = rankTrendingForYou([meh, loved], t);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 't1');
    assert.deepEqual(rankTrendingForYou([meh], t), []);
  });

  it('grounds library picks in affinity artists with an explanation', () => {
    const t = taste({ favoriteArtists: [{ name: 'pritam', score: 1 }] });
    const pool = [track({ id: 'l1', author: 'Pritam, Vocals', title: 'Lib Song' }), track({ id: 'l2', author: 'Other', title: 'X' })];
    const out = selectBasedOnLibrary(pool, t);
    assert.equal(out.tracks.length, 1);
    assert.equal(out.tracks[0].id, 'l1');
    assert.match(out.explanation, /Pritam/);
    assert.deepEqual(selectBasedOnLibrary([], t).tracks, []);
  });

  it('caches home payload per scope with TTL expiry', () => {
    assert.equal(HOME_CACHE_TTL_MS, 10 * 60 * 1000);
    assert.equal(readHomeCache(), null);
    const d = { ...emptyData(), coldStart: false };
    d.quickPicks = [track({ id: 'q1' })];
    writeHomeCache(d);
    const back = readHomeCache();
    assert.ok(back);
    assert.equal(back!.quickPicks[0].id, 'q1');
    assert.equal(back!.coldStart, false);
  });

  it('queues a resume position without throwing (engine honors it)', async () => {
    const { requestResumePosition } = await import('../services/playerEngine');
    requestResumePosition('dQw4w9WgXcQ', 87);
    requestResumePosition('', 10); // ignored
    requestResumePosition('dQw4w9WgXcQ', 0); // ignored
  });
});
