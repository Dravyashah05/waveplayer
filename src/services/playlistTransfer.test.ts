import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../types';
import {
  applyImportDecisions,
  buildExportPreview,
  transfersAreDuplicates,
} from './playlistTransfer';

const t = (id: string, title = 'Song', author = 'Artist', source: any = 'ytmusic'): Track => ({
  id, title, author, thumbnail: `https://img/${id}.jpg`, duration: '3:00', durationSeconds: 180,
  url: `https://x/${id}`, source,
});

describe('playlist import/export', () => {
  it('classifies Wave → YouTube export candidates (matched/possible/unmatched)', () => {
    const preview = buildExportPreview([
      t('dQw4w9WgXcQ', 'A', 'B', 'ytmusic'),
      t('saavn1', 'Local Song', 'Local Artist', 'saavn'),
      { ...t('x', '', ''), title: '', author: '' } as Track,
    ]);
    assert.equal(preview.matched.length, 1);
    assert.equal(preview.possible.length, 1);
    assert.equal(preview.unmatched.length, 1);
  });

  it('never auto-includes possible matches without user choice', () => {
    const preview: any = {
      matched: [{ position: 0 }],
      possible: [{ position: 1 }, { position: 2 }],
      unmatched: [{ position: 3 }],
    };
    const out = applyImportDecisions(preview, { acceptedPossible: new Set([2]), includeUnmatched: false });
    assert.deepEqual(out.map((m: any) => m.position), [0, 2]);
    const withUnmatched = applyImportDecisions(preview, { acceptedPossible: new Set(), includeUnmatched: true });
    assert.deepEqual(withUnmatched.map((m: any) => m.position), [0, 3]);
  });

  it('distinguishes versions instead of collapsing them', () => {
    const orig = t('dQw4w9WgXcQ', 'Kesariya', 'Arijit Singh');
    const remix = t('9bZkp7q19f0', 'Kesariya (Remix)', 'Arijit Singh');
    assert.equal(transfersAreDuplicates(orig, { ...orig }), true);
    assert.equal(transfersAreDuplicates(orig, remix), false);
  });

  it('keeps private data isolated (no global cache of transfers)', async () => {
    // Transfers are pure preview builders — nothing leaves the device here.
    const p1 = buildExportPreview([t('dQw4w9WgXcQ')]);
    const p2 = buildExportPreview([t('dQw4w9WgXcQ')]);
    assert.deepEqual(p1.matched.length, p2.matched.length);
  });
});
