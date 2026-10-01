// Multi-field track matching for the server core (self-contained: the server
// runtime has no DOM/localStorage, so the client matcher is not imported).
// NEVER matches on title alone — artist (or another independent field) must
// corroborate. Version markers are preserved as first-class identity so a
// remix is never collapsed into its original.

import type { Candidate, VersionType } from './types.js';

const VERSION_MARKERS: Array<[VersionType, RegExp]> = [
  ['remix', /\b(remix|remixes|club mix|radio edit|extended mix)\b/i],
  ['live', /\b(live|concert|unplugged session)\b/i],
  ['acoustic', /\b(acoustic|unplugged)\b/i],
  ['cover', /\b(cover|covered by|tribute)\b/i],
  ['instrumental', /\b(instrumental|karaoke|off vocal)\b/i],
  ['lofi', /\b(lo[- ]?fi|chill mix)\b/i],
  ['slowed', /\b(slowed( down)?|reverb)\b/i],
  ['sped_up', /\b(sped[ -]?up|nightcore|8d|bass boosted)\b/i],
  ['remastered', /\b(remaster(?:ed)?|remastered version)\b/i],
];

const UPLOAD_NOISE = /\b(official|music video|lyric video|audio|video|lyrics?|full song|hd|hq|4k|visuali[sz]er|topic|vevo)\b/gi;

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function detectVersion(title: string): VersionType {
  for (const [type, marker] of VERSION_MARKERS) if (marker.test(title)) return type;
  return 'original';
}

/** Strip bracketed parts unless they carry a version marker; drop upload noise. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, (part) =>
      VERSION_MARKERS.some(([, marker]) => marker.test(part)) ? part : ' ',
    )
    .replace(UPLOAD_NOISE, ' ')
    .replace(/[|•–—]+/g, ' ')
    .replace(/\s*[-:|]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstArtist(artist: string): string {
  return normalizeText(String(artist || '').split(/,| feat\.? | ft\.? | & | x /i)[0]);
}

/** Version markers stripped entirely (canonical work identity). */
export function stripVersions(title: string): string {
  return cleanTitle(title)
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(new RegExp(VERSION_MARKERS.map(([, marker]) => marker.source).join('|'), 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical song = work identity, version-agnostic (groups recordings). */
export function canonicalSongId(title: string, artist: string): string {
  return `${normalizeText(stripVersions(title))}|${firstArtist(artist)}`;
}

/** Recording = one concrete version of a song (what actually plays). */
export function recordingId(title: string, artist: string): string {
  return `${canonicalSongId(title, artist)}|${detectVersion(title)}`;
}

function tokenSimilarity(a: string, b: string): number {
  const aa = new Set(normalizeText(a).split(' ').filter(Boolean));
  const bb = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  const hit = [...aa].filter((x) => bb.has(x)).length;
  return hit / Math.max(aa.size, bb.size);
}

export interface FieldMatch {
  score: number;
  titleExact: boolean;
  artistExact: boolean;
  versionSame: boolean;
}

/**
 * Multi-field match between two candidates. Returns 0 unless the artist
 * corroborates the title (or ISRC/videoId anchor matches).
 */
export function fieldMatch(a: Candidate, b: Candidate): FieldMatch {
  const out = { score: 0, titleExact: false, artistExact: false, versionSame: true };
  if (a.videoId && b.videoId && a.videoId === b.videoId) return { score: 1, titleExact: true, artistExact: true, versionSame: true };
  if (a.isrc && b.isrc && a.isrc.toUpperCase() === b.isrc.toUpperCase()) {
    const same = detectVersion(a.title) === detectVersion(b.title);
    return { score: same ? 0.98 : 0.2, titleExact: same, artistExact: true, versionSame: same };
  }
  const ta = normalizeText(cleanTitle(a.title));
  const tb = normalizeText(cleanTitle(b.title));
  const aa = firstArtist(a.artist);
  const ab = firstArtist(b.artist);
  if (!ta || !tb || !aa || !ab) return out;
  const versionSame = detectVersion(a.title) === detectVersion(b.title);
  out.versionSame = versionSame;
  if (!versionSame) return out; // remix ≠ original, live ≠ studio — never cross-match
  out.titleExact = ta === tb;
  out.artistExact = aa === ab;
  const titleNear = out.titleExact || tokenSimilarity(ta, tb) >= 0.8;
  const artistNear = out.artistExact || tokenSimilarity(aa, ab) >= 0.8;
  if (!titleNear || !artistNear) return out;
  out.score = Math.min(
    1,
    (out.titleExact ? 0.5 : 0.34) +
      (out.artistExact ? 0.34 : 0.2) +
      (a.album && b.album && normalizeText(a.album) === normalizeText(b.album) ? 0.08 : 0),
  );
  if (a.duration && b.duration) {
    const diff = Math.abs(a.duration - b.duration);
    out.score += diff <= 3 ? 0.08 : diff <= 8 ? 0.04 : -0.12;
  }
  out.score = Math.max(0, Math.min(1, out.score));
  return out;
}
