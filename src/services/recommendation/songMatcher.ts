import type { Track } from '../../types';
import { musicIdentity, normalizeText } from './metadataNormalizer';

export interface SongMatchResult { isMatch: boolean; confidence: number; reasons: string[] }

export function matchSongs(a: Track, b: Track): SongMatchResult {
  const x = a.identity || musicIdentity(a);
  const y = b.identity || musicIdentity(b);
  const reasons: string[] = [];
  if (a.id === b.id && a.source && a.source === b.source) return { isMatch: true, confidence: 1, reasons: ['same source id'] };
  if (x.isrc && y.isrc && x.isrc.toUpperCase() === y.isrc.toUpperCase()) {
    if (x.versionType !== y.versionType) return { isMatch: false, confidence: 0.3, reasons: ['version differs'] };
    return { isMatch: true, confidence: 0.98, reasons: ['ISRC match'] };
  }
  if (!x.normalizedTitle || !y.normalizedTitle || !x.normalizedArtist || !y.normalizedArtist) return { isMatch: false, confidence: 0, reasons };
  if (x.versionType !== y.versionType) return { isMatch: false, confidence: 0.25, reasons: ['version differs'] };
  const titleExact = x.normalizedTitle === y.normalizedTitle;
  const titleNear = titleExact || tokenSimilarity(x.normalizedTitle, y.normalizedTitle) >= 0.8;
  const artistExact = x.normalizedArtist === y.normalizedArtist;
  const artistNear = artistExact || tokenSimilarity(x.normalizedArtist, y.normalizedArtist) >= 0.8;
  let confidence = (titleExact ? 0.48 : titleNear ? 0.34 : 0) + (artistExact ? 0.34 : artistNear ? 0.2 : 0);
  if (titleNear) reasons.push(titleExact ? 'title match' : 'similar title');
  if (artistNear) reasons.push(artistExact ? 'artist match' : 'similar artist');
  if (x.normalizedAlbum && x.normalizedAlbum === y.normalizedAlbum) { confidence += 0.08; reasons.push('album match'); }
  if (x.duration && y.duration) {
    const diff = Math.abs(x.duration - y.duration);
    confidence += diff <= 3 ? 0.08 : diff <= 8 ? 0.04 : -0.12;
    reasons.push('duration comparison');
  }
  if (x.year && y.year && x.year === y.year) { confidence += 0.02; reasons.push('year match'); }
  confidence = Math.max(0, Math.min(1, confidence));
  return { isMatch: confidence >= 0.76 && titleNear && artistNear, confidence, reasons };
}

function tokenSimilarity(a: string, b: string): number {
  const aa = new Set(normalizeText(a).split(' ')); const bb = new Set(normalizeText(b).split(' '));
  const intersection = [...aa].filter((x) => bb.has(x)).length;
  return intersection / Math.max(aa.size, bb.size, 1);
}
