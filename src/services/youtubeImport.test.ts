import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../types';
import {
  buildImportPreview,
  buildWavePlaylist,
  canonicalTrackId,
  matchYoutubeItem,
  type YoutubeItem,
} from './youtubeImport';

function saavn(id: string, title: string, author: string, extra: Partial<Track> = {}): Track {
  return {
    id, title, author, thumbnail: '', duration: '3:30', durationSeconds: 210,
    url: `https://www.jiosaavn.com/song/_/${id}`, source: 'saavn', type: 'SONG', ...extra,
  };
}

function ytItem(videoId: string | null, title: string, channel: string, position = 0): YoutubeItem {
  return { id: `UE${videoId || 'x'}`, videoId, title, artist: channel, channelTitle: channel, thumbnail: '', position, publishedAt: null, status: 'public' };
}

describe('matchYoutubeItem tiers', () => {
  it('matches exact title+artist at high confidence (strips Official Video noise)', async () => {
    const m = await matchYoutubeItem(
      ytItem('vid1', 'Tum Hi Ho - Official Video', 'Arijit Singh'),
      async () => ({ tracks: [saavn('s1', 'Tum Hi Ho', 'Arijit Singh')] }),
    );
    assert.equal(m.tier, 'high');
    assert.ok(m.confidence >= 0.9);
    assert.equal(m.matchedTrackId, 's1');
    assert.equal(m.youtubeVideoId, 'vid1');
  });

  it('does not match a remix to the original (version preserved)', async () => {
    const m = await matchYoutubeItem(
      ytItem('vid2', 'Tum Hi Ho (Remix)', 'Arijit Singh'),
      async () => ({ tracks: [saavn('s1', 'Tum Hi Ho', 'Arijit Singh')] }),
    );
    assert.notEqual(m.tier, 'high');
  });

  it('marks unavailable videos unmatched without throwing', async () => {
    const m = await matchYoutubeItem(ytItem(null, 'Deleted video', ''), async () => { throw new Error('nope'); });
    assert.equal(m.tier, 'unmatched');
    assert.equal(m.youtubeTrack, null);
  });

  it('degrades to unmatched when search fails (one bad song never breaks import)', async () => {
    const m = await matchYoutubeItem(ytItem('vid3', 'Some Song', 'Someone'), async () => { throw new Error('offline'); });
    assert.equal(m.tier, 'unmatched');
    assert.ok(m.youtubeTrack); // still playable via YouTube path
  });

  it('buckets preview into matched/possible/unmatched in playlist order', async () => {
    const search = async (q: string) => {
      if (q.toLowerCase().includes('exact')) return { tracks: [saavn('s1', 'Exact Song', 'Exact Artist')] };
      return { tracks: [] };
    };
    const preview = await buildImportPreview([
      ytItem('v1', 'Exact Song (Official Audio)', 'Exact Artist', 0),
      ytItem('v2', 'Totally Unknown XYZ 123', 'Nobody At All', 1),
      ytItem(null, 'Deleted', '', 2),
    ], undefined, { searchFn: search });
    assert.equal(preview.matched.length, 1);
    assert.equal(preview.matched[0].position, 0);
    assert.equal(preview.unmatched.length, 2);
    assert.deepEqual(preview.unmatched.map((m) => m.position), [1, 2]);
  });
});

describe('buildWavePlaylist dedupe + sync fields', () => {
  it('dedupes repeat videos and merges without touching other playlists', () => {
    const t1 = saavn('s1', 'A', 'B');
    const dup: YoutubeItem[] = [];
    void dup;
    const first = buildWavePlaylist({ id: 'PL1', title: 'Mix' }, [
      { youtubeVideoId: 'v1', title: 'A', channelTitle: 'B', thumbnail: '', position: 0, tier: 'high', confidence: 0.95, matchedTrack: t1, matchedTrackId: 's1', youtubeTrack: null, reason: '' },
      { youtubeVideoId: 'v1', title: 'A again', channelTitle: 'B', thumbnail: '', position: 1, tier: 'high', confidence: 0.95, matchedTrack: t1, matchedTrackId: 's1', youtubeTrack: null, reason: '' },
    ], null);
    assert.equal(first.songs.length, 1);
    assert.equal(first.source, 'youtube');
    assert.equal(first.sourcePlaylistId, 'PL1');
    assert.ok(first.lastSyncedAt);
    const second = buildWavePlaylist({ id: 'PL1', title: 'Mix' }, [], first);
    assert.equal(second.songs.length, 1); // re-import adds nothing twice
    assert.equal(canonicalTrackId(t1), 'saavn:s1');
  });
});
