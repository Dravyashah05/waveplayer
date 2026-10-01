import type { MusicVersionType, Track } from '../../types';

const MARKERS: Array<[MusicVersionType, RegExp]> = [
  ['remix', /\b(remix|remixes|\w+ mix|club mix)\b/i],
  ['live', /\b(live|concert|unplugged session)\b/i],
  ['acoustic', /\b(acoustic|unplugged)\b/i],
  ['cover', /\b(cover|covered by)\b/i],
  ['instrumental', /\b(instrumental|karaoke)\b/i],
  ['lofi', /\b(lo[- ]?fi|chill mix)\b/i],
  ['slowed', /\b(slowed|slowed down|reverb)\b/i],
  ['sped_up', /\b(sped[ -]?up|speed up|nightcore)\b/i],
];
const UPLOAD_NOISE = /\b(official|music video|lyric video|audio|video|lyrics?|full song|hd|hq|visuali[sz]er|topic|remaster(?:ed)?)\b/gi;

export function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function detectVersion(title: string): MusicVersionType {
  for (const [type, marker] of MARKERS) if (marker.test(title)) return type;
  return 'original';
}

export function cleanTitle(title: string): string {
  return title.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, (part) => {
    return MARKERS.some(([, marker]) => marker.test(part)) ? part : ' ';
  }).replace(MARKERS.map(([, marker]) => marker.source).join('|'), ' ')
    .replace(UPLOAD_NOISE, ' ').replace(/[|•–—]+/g, ' ').replace(/\s*[-:|]\s*$/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeArtist(artist: string): string {
  return normalizeText(artist.split(/,| feat\.? | ft\.? | & /i)[0]);
}

export function musicIdentity(track: Track) {
  const title = track.title || '';
  const normalizedTitle = normalizeText(cleanTitle(title));
  const normalizedArtist = normalizeArtist(track.author || '');
  const normalizedAlbum = normalizeText(track.albumName || '');
  const versionType = detectVersion(title);
  const sourceId = track.source === 'saavn' ? `saavn:${track.id}` : `youtube:${track.id}`;
  return {
    canonicalId: track.isrc ? `isrc:${track.isrc.toUpperCase()}:${versionType}` : `${normalizedTitle}|${normalizedArtist}|${versionType}`,
    normalizedTitle, normalizedArtist, normalizedAlbum: normalizedAlbum || undefined,
    youtubeId: track.source === 'ytmusic' || track.source === 'youtube' ? track.id : undefined,
    saavnId: track.source === 'saavn' ? track.id : undefined,
    isrc: track.isrc,
    duration: track.durationSeconds || undefined,
    year: Number(track.year) || undefined,
    language: track.language,
    versionType,
    sourceId,
  };
}
