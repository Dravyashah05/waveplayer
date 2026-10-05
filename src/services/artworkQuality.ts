/**
 * Upgrade provider thumbnail URLs to their highest-quality variant.
 *
 * Providers hand out small thumbs by default (yt3 `=w60`, ytimg
 * `default.jpg`, Saavn `150x150`) which look blurry on the fullscreen
 * player. This rewrites the known size params to max quality; unknown
 * hosts and local/blob/data URLs pass through untouched.
 */
export function hqArtworkUrl(src: unknown, width = 1080): string | undefined {
  if (typeof src !== 'string') return undefined;
  const url = src.trim();
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || !/^https?:\/\//i.test(url)) return url || undefined;
  const w = Math.max(320, Math.min(1920, Math.round(width) || 1080));

  // YouTube Music / Google user-content (yt3): =w60-h60-l90-rj, =w60, =s88-c-k-…
  // (`=w` / `=s` size params are Google-specific, safe to rewrite anywhere.)
  if (url.includes('=w') || url.includes('=s')) {
    return url.replace(/=w\d+(-h\d+)?/, `=w${w}`).replace(/=s\d+/, `=s${w}`);
  }

  // i.ytimg.com video thumbs: default/mq -> hq, hq720 -> maxres.
  if (url.includes('ytimg.com/vi/')) {
    if (/\/maxresdefault\.jpg/i.test(url)) return url;
    if (/\/sddefault\.jpg/i.test(url)) return url; // 640px, keep (maxres not guaranteed)
    return url
      .replace(/\/hq720\.(jpg|webp)/i, '/maxresdefault.jpg')
      .replace(/\/(default|mqdefault|hqdefault)\.(jpg|webp)/i, '/hqdefault.jpg');
  }

  // JioSaavn CDN: 150x150 / 50x50 / _150. -> 500px variants.
  if (url.includes('saavncdn.com') || url.includes('jiosaavn')) {
    return url
      .replace(/150x150|50x50/g, '500x500')
      .replace(/([-_])150(?=\.(jpg|jpeg|png|webp))/i, (_, sep: string) => `${sep}500`)
      .replace(/([-_])50(?=\.(jpg|jpeg|png|webp))/i, (_, sep: string) => `${sep}500`);
  }

  return url;
}
