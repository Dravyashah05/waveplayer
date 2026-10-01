// Artwork-derived palette. Analyzed lazily off the critical path, cached by
// URL, with a default Wave fallback when extraction fails.

export interface ArtworkPalette {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  accent: string;
  onPrimary: string;
}

export const DEFAULT_PALETTE: ArtworkPalette = {
  primary: '#ffffff',
  secondary: '#a1a1aa',
  background: '#0a0a0c',
  surface: 'rgba(255,255,255,0.06)',
  accent: '#f59e0b',
  onPrimary: '#000000',
};

const cache = new Map<string, ArtworkPalette>();

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function paletteCacheKey(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(h, 31) + url.charCodeAt(i)) | 0;
  return `wave:palette:${(h >>> 0).toString(36)}`;
}

function loadCached(url: string): ArtworkPalette | null {
  try {
    const raw = sessionStorage.getItem(paletteCacheKey(url));
    if (raw) return JSON.parse(raw) as ArtworkPalette;
  } catch {}
  return cache.get(url) || null;
}

function storeCached(url: string, p: ArtworkPalette): void {
  cache.set(url, p);
  if (cache.size > 60) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  try {
    sessionStorage.setItem(paletteCacheKey(url), JSON.stringify(p));
  } catch {}
}

/** Extracts a palette from artwork. Never throws; falls back on any failure. */
export async function extractPalette(artworkUrl: string): Promise<ArtworkPalette> {
  if (!artworkUrl) return DEFAULT_PALETTE;
  const hit = loadCached(artworkUrl);
  if (hit) return hit;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('artwork load failed'));
      img.src = artworkUrl;
      setTimeout(() => reject(new Error('artwork timeout')), 6000);
    });
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    // Bucket colors coarsely; skip near-black/near-white/grey pixels.
    const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += 4 * 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = luminance(r, g, b);
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum < 0.06 || lum > 0.94 || sat < 24) continue;
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      e.r += r;
      e.g += g;
      e.b += b;
      e.n++;
      buckets.set(key, e);
    }
    const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
    if (!ranked.length) throw new Error('no vivid pixels');
    const avg = ranked[0];
    const pr = Math.round(avg.r / avg.n);
    const pg = Math.round(avg.g / avg.n);
    const pb = Math.round(avg.b / avg.n);
    const second = ranked.find(
      (e) => Math.abs(e.r / e.n - pr) + Math.abs(e.g / e.n - pg) + Math.abs(e.b / e.n - pb) > 90,
    );
    const sr = second ? Math.round(second.r / second.n) : pr;
    const sg = second ? Math.round(second.g / second.n) : pg;
    const sb = second ? Math.round(second.b / second.n) : pb;
    const lum = luminance(pr, pg, pb);
    const palette: ArtworkPalette = {
      primary: `rgb(${pr}, ${pg}, ${pb})`,
      secondary: `rgb(${sr}, ${sg}, ${sb})`,
      background: '#0a0a0c',
      surface: `rgba(${pr}, ${pg}, ${pb}, 0.10)`,
      accent: `rgb(${pr}, ${pg}, ${pb})`,
      onPrimary: lum > 0.6 ? '#000000' : '#ffffff',
    };
    storeCached(artworkUrl, palette);
    return palette;
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function clearPaletteCache(): void {
  cache.clear();
}
