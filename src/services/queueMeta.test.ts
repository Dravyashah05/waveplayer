import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../types';
import {
  buildShuffleOrder,
  defaultMeta,
  describeSource,
  matchShortcut,
  newQueueItemId,
  radioReason,
  shortcutSeekDelta,
} from './queueMeta';

const t = (id: string, author: string, album = ''): Track => ({
  id, title: id, author, albumName: album, thumbnail: '', duration: '3:00',
  durationSeconds: 180, url: `https://x/${id}`, source: 'saavn', type: 'SONG',
});

describe('queue metadata', () => {
  it('creates unique ids with user default', () => {
    const a = defaultMeta();
    const b = defaultMeta();
    assert.notEqual(a.queueItemId, b.queueItemId);
    assert.equal(a.addedBy, 'user');
    assert.ok(newQueueItemId().startsWith('q_'));
  });

  it('labels playlist/album/artist/recommendation/search sources', () => {
    assert.equal(describeSource(defaultMeta({ addedBy: 'playlist', context: 'Chill' })), 'Playlist • Chill');
    assert.equal(describeSource(defaultMeta({ addedBy: 'album', context: 'After Hours' })), 'Album • After Hours');
    assert.equal(describeSource(defaultMeta({ addedBy: 'artist', context: 'Arijit' })), 'Artist • Arijit');
    assert.equal(describeSource(defaultMeta({ addedBy: 'search' })), 'Search');
    assert.equal(describeSource(defaultMeta({ addedBy: 'radio' })), null);
    assert.equal(describeSource(defaultMeta()), null);
  });

  it('explains radio rows via the seed title, never scores', () => {
    assert.equal(radioReason(defaultMeta({ addedBy: 'radio', seedTitle: 'Tum Hi Ho' })), 'Because of “Tum Hi Ho”');
    assert.equal(radioReason(defaultMeta({ addedBy: 'radio', context: 'track-radio' })), 'From track-radio');
    assert.equal(radioReason(defaultMeta({ addedBy: 'playlist' })), null);
  });
});

describe('smart shuffle order', () => {
  it('keeps the current track first and covers every index once', () => {
    const tracks = [t('a', 'A'), t('b', 'B'), t('c', 'C'), t('d', 'D')];
    const order = buildShuffleOrder(tracks, 2);
    assert.equal(order[0], 2);
    assert.deepEqual([...order].sort((x, y) => x - y), [0, 1, 2, 3]);
  });

  it('spreads a single-artist run when variety exists', () => {
    const tracks = [t('a1', 'Same'), t('a2', 'Same'), t('b1', 'Other'), t('b2', 'Other2')];
    for (let run = 0; run < 20; run++) {
      const order = buildShuffleOrder(tracks, 0);
      let clash = 0;
      for (let i = 1; i < order.length; i++) {
        if (tracks[order[i]].author === tracks[order[i - 1]].author) clash++;
      }
      // With 2+2 split a perfect spread has 0 clashes; allow flakiness-free bound.
      assert.ok(clash <= 1, `run ${run}: ${order.join(',')} clashes ${clash}`);
    }
  });

  it('handles empty and single-track queues', () => {
    assert.deepEqual(buildShuffleOrder([], 0), []);
    assert.deepEqual(buildShuffleOrder([t('a', 'A')], 0), [0]);
  });
});

describe('keyboard shortcuts', () => {
  it('maps transport keys and ignores typing contexts', () => {
    assert.equal(matchShortcut({ key: ' ' }), 'toggle');
    assert.equal(matchShortcut({ key: 'k' }), 'toggle');
    assert.equal(matchShortcut({ key: 'ArrowLeft' }), 'seekBack');
    assert.equal(matchShortcut({ key: 'ArrowRight' }), 'seekFwd');
    assert.equal(matchShortcut({ key: 'n' }), 'next');
    assert.equal(matchShortcut({ key: 'p' }), 'prev');
    assert.equal(matchShortcut({ key: ' ' , targetTag: 'INPUT' }), null);
    assert.equal(matchShortcut({ key: 'n', targetTag: 'TEXTAREA' }), null);
    assert.equal(matchShortcut({ key: 'p', isContentEditable: true }), null);
    assert.equal(matchShortcut({ key: 'n', ctrlKey: true }), null);
    assert.equal(matchShortcut({ key: 'x' }), null);
  });

  it('seeks in 10s steps', () => {
    assert.equal(shortcutSeekDelta('seekBack'), -10);
    assert.equal(shortcutSeekDelta('seekFwd'), 10);
  });
});
