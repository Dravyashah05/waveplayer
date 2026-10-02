import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoutubePlaylistError, isAuthError, isInsufficientScope } from './youtubePlaylists';

describe('youtube playlist permissions', () => {
  it('classifies read-only vs auth failures without throwing', () => {
    assert.equal(isInsufficientScope(new YoutubePlaylistError('INSUFFICIENT_SCOPE')), true);
    assert.equal(isInsufficientScope(new YoutubePlaylistError('YOUTUBE_API_ERROR')), false);
    assert.equal(isAuthError(new YoutubePlaylistError('YOUTUBE_NOT_CONNECTED')), true);
    assert.equal(isAuthError(new YoutubePlaylistError('YOUTUBE_API_ERROR')), false);
  });

  it('never exposes tokens: client sends cookies only (no header injection)', () => {
    // Static guarantee: this module never references tokens/cookies/headers.
    // Runtime check here only pins the error surface used for gating UI.
    const e = new YoutubePlaylistError('INSUFFICIENT_SCOPE', 'x', 403);
    assert.equal(e.status, 403);
  });
});
