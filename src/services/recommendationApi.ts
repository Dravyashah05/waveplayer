import type { Track } from '../types';
import { getProfile } from './userProfile';

const BASE = '/api/recommendations';

/** Taste hints derived from the local listening profile (no OAuth involved). */
export function tasteQuery(): string {
  try {
    const profile = getProfile();
    const artists = Object.entries(profile.artists || {})
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 5)
      .map(([name]) => name);
    const qs = new URLSearchParams();
    if (artists.length) qs.set('artists', artists.join(','));
    if (profile.favoriteLanguage) qs.set('lang', profile.favoriteLanguage);
    return qs.toString();
  } catch {
    return '';
  }
}

function toTrack(raw: any): Track | null {
  const id = String(raw?.id || raw?.videoId || '');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
  return {
    id,
    title: String(raw?.title || 'Unknown'),
    author: String(raw?.author || 'YouTube'),
    thumbnail: String(raw?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`),
    duration: String(raw?.duration || ''),
    durationSeconds: Number(raw?.durationSeconds || 0),
    url: String(raw?.url || `https://www.youtube.com/watch?v=${id}`),
    source: 'ytmusic',
    type: raw?.type === 'VIDEO' ? 'VIDEO' : 'SONG',
    albumId: raw?.albumId,
    albumName: raw?.albumName,
    year: raw?.year ?? null,
    language: raw?.language,
    isrc: raw?.isrc,
  };
}

async function getJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function tracksOf(data: any): Track[] {
  if (!data || !Array.isArray(data.tracks)) return [];
  return ((data.tracks || []) as any[]).map(toTrack).filter((t): t is Track => !!t);
}

export interface HomeSections {
  personalized?: boolean;
  source?: string;
  personalizationAvailable?: boolean;
  sections: Array<{ id: string; title: string; subtitle: string; tracks: Track[] }>;
}

export async function fetchRecHome(): Promise<HomeSections | null> {
  const q = tasteQuery();
  const data = await getJson(`${BASE}/home${q ? `?${q}` : ''}`);
  if (!data || !Array.isArray(data.sections)) return null;
  return {
    personalized: data.personalized === true,
    source: String(data.source || 'unknown'),
    personalizationAvailable: data.personalizationAvailable === true,
    sections: data.sections.map((s: any) => ({
      id: String(s.id),
      title: String(s.title),
      subtitle: String(s.subtitle || ''),
      tracks: tracksOf(s),
    })),
  };
}

export async function fetchForYou(): Promise<Track[]> {
  const q = tasteQuery();
  const data = await getJson(`${BASE}/for-you${q ? `?${q}` : ''}`);
  return tracksOf(data);
}

export async function fetchDiscover(): Promise<Track[]> {
  const q = tasteQuery();
  const data = await getJson(`${BASE}/discover${q ? `?${q}` : ''}`);
  return tracksOf(data);
}

export async function fetchQuickPicks(limit = 10): Promise<Track[] | null> {
  const q = tasteQuery();
  const sep = q ? '&' : '';
  const data = await getJson(`${BASE}/quick-picks?${q}${sep}limit=${limit}`);
  if (!data) return null;
  return tracksOf(data);
}

export async function fetchAutoplay(seed: Track, excludeIds: string[], limit = 8): Promise<Track[]> {
  if (!seed?.id || !/^[a-zA-Z0-9_-]{11}$/.test(seed.id)) return [];
  const qs = new URLSearchParams({ limit: String(limit) });
  if (excludeIds.length) qs.set('exclude', excludeIds.slice(0, 50).join(','));
  const data = await getJson(`${BASE}/autoplay/${seed.id}?${qs}`);
  return data ? tracksOf(data) : [];
}

export async function fetchRadio(seed: Track, limit = 20): Promise<Track[]> {
  if (!seed?.id || !/^[a-zA-Z0-9_-]{11}$/.test(seed.id)) return [];
  const data = await getJson(`${BASE}/radio/${seed.id}?limit=${limit}`);
  return data ? tracksOf(data) : [];
}

export async function fetchSimilar(seed: Track, limit = 12): Promise<Track[]> {
  if (!seed?.id || !/^[a-zA-Z0-9_-]{11}$/.test(seed.id)) return [];
  const data = await getJson(`${BASE}/similar/${seed.id}?limit=${limit}`);
  return data ? tracksOf(data) : [];
}
