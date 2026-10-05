import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hqArtworkUrl } from './artworkQuality';

describe('hqArtworkUrl', () => {
  it('upscales yt3 size params to w1080', () => {
    assert.equal(
      hqArtworkUrl('https://lh3.googleusercontent.com/abc=w60-h60-l90-rj'),
      'https://lh3.googleusercontent.com/abc=w1080-l90-rj',
    );
    assert.equal(
      hqArtworkUrl('https://lh3.googleusercontent.com/abc=s88-c-k'),
      'https://lh3.googleusercontent.com/abc=s1080-c-k',
    );
  });
  it('upgrades ytimg defaults without touching maxres/sd', () => {
    assert.equal(
      hqArtworkUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg'),
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    assert.equal(
      hqArtworkUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg'),
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    assert.equal(
      hqArtworkUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'),
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    );
    assert.equal(
      hqArtworkUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg'),
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg',
    );
  });
  it('upscales saavn cdn sizes to 500px', () => {
    assert.equal(
      hqArtworkUrl('https://c.saavncdn.com/123/abc-150.jpg'),
      'https://c.saavncdn.com/123/abc-500.jpg',
    );
    assert.equal(
      hqArtworkUrl('https://c.saavncdn.com/123/abc-150x150.jpg'),
      'https://c.saavncdn.com/123/abc-500x500.jpg',
    );
  });
  it('passes through local, blob and unknown urls', () => {
    assert.equal(hqArtworkUrl('/icon-512.png'), '/icon-512.png');
    assert.equal(hqArtworkUrl('blob:https://x/y'), 'blob:https://x/y');
    assert.equal(hqArtworkUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
    assert.equal(hqArtworkUrl(undefined), undefined);
  });
});
