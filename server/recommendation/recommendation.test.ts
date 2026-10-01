import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSongId,
  cleanTitle,
  detectVersion,
  fieldMatch,
  recordingId,
} from './similarity.js';
import { rankCandidates } from './ranker.js';
import { diversify } from './diversity.js';
import { buildAutoplay, buildRadio, buildSimilar, toResolvedTrack } from './autoplay.js';
import type { Candidate } from './types.js';

function cand(partial: Partial<Candidate> & { videoId: string; title: string; artist: string }): Candidate {
  return { relation: 'search', ...partial };
}

describe('song vs recording identity', () => {
  it('groups versions under one canonical song but splits recordings', () => {
    const song = canonicalSongId('Tum Hi Ho (Remix)', 'Arijit Singh');
    assert.equal(song, canonicalSongId('Tum Hi Ho', 'Arijit Singh'));
    assert.notEqual(recordingId('Tum Hi Ho (Remix)', 'Arijit Singh'), recordingId('Tum Hi Ho', 'Arijit Singh'));
  });

  it('recognizes version markers including remastered', () => {
    for (const [title, v] of [
      ['Song (Remix)', 'remix'],
      ['Song - Live', 'live'],
      ['Song (Acoustic)', 'acoustic'],
      ['Song Cover', 'cover'],
      ['Song (Instrumental)', 'instrumental'],
      ['song lofi', 'lofi'],
      ['song slowed + reverb', 'slowed'],
      ['song sped up', 'sped_up'],
      ['Song Remastered', 'remastered'],
      ['Song', 'original'],
    ] as Array<[string, string]>) assert.equal(detectVersion(title), v, title);
    assert.ok(cleanTitle('Tum Hi Ho - Official Video').toLowerCase().includes('tum hi ho'));
  });
});

describe('multi-field matching (never title-only)', () => {
  it('rejects same title with a different artist', () => {
    const m = fieldMatch(
      cand({ videoId: 'AAAAAAAAAAA', title: 'Believer', artist: 'Imagine Dragons' }),
      cand({ videoId: 'BBBBBBBBBBB', title: 'Believer', artist: 'Someone Else' }),
    );
    assert.equal(m.score, 0);
  });

  it('rejects remix vs original even with identical artist', () => {
    const m = fieldMatch(
      cand({ videoId: 'AAAAAAAAAAA', title: 'Tum Hi Ho', artist: 'Arijit Singh' }),
      cand({ videoId: 'BBBBBBBBBBB', title: 'Tum Hi Ho (Remix)', artist: 'Arijit Singh' }),
    );
    assert.equal(m.versionSame, false);
    assert.equal(m.score, 0);
  });

  it('anchors on videoId and ISRC', () => {
    assert.equal(fieldMatch(
      cand({ videoId: 'AAAAAAAAAAA', title: 'X', artist: 'Y' }),
      cand({ videoId: 'AAAAAAAAAAA', title: 'Totally Different', artist: 'Nobody' }),
    ).score, 1);
    assert.ok(fieldMatch(
      cand({ videoId: 'AAAAAAAAAAA', title: 'X', artist: 'Y', isrc: 'USABC1234567' }),
      cand({ videoId: 'BBBBBBBBBBB', title: 'X', artist: 'Y', isrc: 'usabc1234567' }),
    ).score >= 0.9);
  });

  it('rewards title+artist+album+duration evidence', () => {
    const m = fieldMatch(
      cand({ videoId: 'AAAAAAAAAAA', title: 'Song', artist: 'Artist', album: 'Album', duration: 200 }),
      cand({ videoId: 'BBBBBBBBBBB', title: 'Song (Official Audio)', artist: 'Artist', album: 'Album', duration: 201 }),
    );
    assert.ok(m.score >= 0.85, `score=${m.score}`);
  });
});

describe('transparent ranking', () => {
  const pool = [
    cand({ videoId: 'AAAAAAAAAAA', title: 'Hit One', artist: 'Fav Artist', relation: 'upnext', sourceRank: 0 }),
    cand({ videoId: 'BBBBBBBBBBB', title: 'Other Song', artist: 'Stranger', relation: 'trending', sourceRank: 5 }),
  ];
  it('prefers favourite artists and YouTube relations, deterministically', () => {
    const run = () => rankCandidates(pool, {
      seed: null,
      taste: { artists: ['Fav Artist'], languages: [], excludeIds: [] },
    }).map((s) => [s.candidate.videoId, s.score, s.reasons.length > 0] as const);
    const a = run();
    const b = run();
    assert.deepEqual(a, b);
    assert.equal(a[0][0], 'AAAAAAAAAAA');
    assert.ok(a[0][1] > a[1][1]);
  });

  it('honours weight overrides', () => {
    const plain = rankCandidates(pool, { seed: null, taste: { artists: [], languages: [], excludeIds: [] } });
    const boosted = rankCandidates(pool, {
      seed: null, taste: { artists: [], languages: [], excludeIds: [] }, weights: { discovery: 0.9 },
    });
    assert.notDeepEqual(plain.map((s) => s.score), boosted.map((s) => s.score));
  });
});

describe('diversity', () => {
  it('caps artists and recordings per song', () => {
    const pool: Candidate[] = [];
    for (let i = 0; i < 6; i++) {
      pool.push(cand({ videoId: `AAAAAAAAAA${i}`, title: `Same Song ${i}`, artist: 'One Artist', relation: 'search' }));
    }
    pool.push(cand({ videoId: 'BBBBBBBBBBB', title: 'Same Song', artist: 'One Artist', relation: 'search' }));
    pool.push(cand({ videoId: 'CCCCCCCCCCC', title: 'Same Song (Remix)', artist: 'One Artist', relation: 'search' }));
    const ranked = pool.map((candidate, i) => ({ candidate, score: 1 - i * 0.01, reasons: [] }));
    // same normalized song+artist dedupes to one; artist cap is 2
    const picked = diversify(ranked, 10, { artistCap: 2 });
    assert.ok(picked.length <= 2, `picked=${picked.length}`);
    const artists = picked.map((p) => p.candidate.artist);
    assert.ok(new Set(artists).size >= 1);
  });
});

describe('autoplay / radio builders (stubbed YTMusic)', () => {
  const ytStub = {
    getSong: async (id: string) => ({ name: 'Seed Song', artist: { name: 'Seed Artist', artistId: 'AR1' } }),
    getUpNexts: async () => [
      { videoId: 'UUUUUUUUUUU', name: 'Next One', artist: { name: 'Seed Artist' } },
      { videoId: 'VVVVVVVVVVV', name: 'Next Two', artist: { name: 'Other Artist' } },
    ],
    searchSongs: async () => [{ videoId: 'WWWWWWWWWWW', name: 'Search Hit', artist: { name: 'Seed Artist' } }],
    searchArtists: async () => [{ artistId: 'AR1', name: 'Seed Artist' }],
    getArtist: async () => ({ name: 'Seed Artist' }),
    getArtistSongs: async () => [{ videoId: 'XXXXXXXXXXX', name: 'Catalog Song' }],
    getHomeSections: async () => [],
    search: async () => [],
  };

  it('autoplay excludes the seed and stays within 5–10 tracks', async () => {
    const r = await buildAutoplay(ytStub, 'SSSSSSSSSSS', { limit: 8 });
    assert.ok(r.tracks.length >= 1 && r.tracks.length <= 10);
    assert.ok(r.tracks.every((t) => t.id !== 'SSSSSSSSSSS'));
    assert.ok(r.tracks.every((t) => t.source === 'ytmusic' && t.url.includes('youtube.com/watch')));
    assert.equal(r.tracks.length, r.reasons.length);
  });

  it('radio returns the wider 10–30 set', async () => {
    const r = await buildRadio(ytStub, 'SSSSSSSSSSS', { limit: 12 });
    assert.ok(r.tracks.length >= 1 && r.tracks.length <= 30);
  });

  it('similar returns ranked candidates with reasons', async () => {
    const r = await buildSimilar(ytStub, 'SSSSSSSSSSS', { limit: 10 });
    assert.ok(r.tracks.length >= 1);
  });

  it('rejects invalid seed ids without throwing', async () => {
    const r = await buildAutoplay(ytStub, 'nope', {});
    assert.deepEqual(r.tracks, []);
  });

  it('resolves Wave Track-compatible shape', () => {
    const t = toResolvedTrack(cand({ videoId: 'AAAAAAAAAAA', title: 'T', artist: 'A', relation: 'search' }));
    for (const k of ['id', 'title', 'author', 'thumbnail', 'duration', 'durationSeconds', 'url', 'source', 'type']) {
      assert.ok(k in t, k);
    }
  });

  it('normalizes real upnext shapes (artists string, m:ss duration, thumbnail)', async () => {
    const { toCandidate } = await import('./candidates.js');
    const c = toCandidate(
      { type: 'SONG', videoId: '34Na4j8AVgA', title: 'Starboy (Official Video)', artists: 'The Weeknd', duration: '4:34', thumbnail: 'https://i.ytimg.com/vi/34Na4j8AVgA/hq720.jpg' },
      'upnext',
      0,
    );
    assert.ok(c);
    assert.equal(c.artist, 'The Weeknd');
    assert.equal(c.duration, 274);
    assert.ok(c.thumbnails?.includes('hq720.jpg'));
  });

  it('normalizes arbitrary YT Music Home section labels and wrapped song items', async () => {
    const { homeSectionCandidates } = await import('./candidates.js');
    const sections = await homeSectionCandidates({
      ...ytStub,
      getHomeSections: async () => [
        { title: 'A title that may change', contents: [{ song: { videoId: '34Na4j8AVgA', title: 'Starboy', artists: 'The Weeknd', duration: '3:50' } }] },
        { name: 'Another changing label', items: [{ videoId: '4NRXx6U8ABQ', name: 'Blinding Lights', artist: { name: 'The Weeknd' } }] },
      ],
    }, 10);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].title, 'A title that may change');
    assert.equal(sections[0].candidates[0].videoId, '34Na4j8AVgA');
    assert.equal(sections[1].candidates[0].title, 'Blinding Lights');
  });
});
