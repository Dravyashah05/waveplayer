import type { Track } from '../types';
import type { ListeningSource } from './listeningStore';
import { getListeningEvents, getPlayCount, isTechnicalFailure } from './listeningStore';
import { attachRecency, getCachedYTMusicHistory, mergeHistories } from './historyMerge';
import { playerStore } from './playerStore';

/**
 * Lightweight deterministic taste profile — no machine learning.
 * Pure calculations over normalized listening events + unified history,
 * so the NEXT task (recommendation ranking) can answer "what does this
 * user actually listen to?" without re-deriving anything.
 *
 * Recommendation weights themselves live in affinityWeights.ts; this module
 * only aggregates observable behavior.
 */

export interface RankedTag {
  name: string;
  score: number;
}

export interface FrequentTrack {
  track: Track;
  plays: number;
}

export interface TasteProfile {
  favoriteArtists: RankedTag[];
  favoriteAlbums: RankedTag[];
  favoriteGenres: RankedTag[];
  favoriteLanguages: RankedTag[];
  artistAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  albumAffinity: Record<string, number>;
  /** Mean completion fraction across completed/skipped plays (0..1). */
  averageCompletionRate: number;
  /** Share of outcomes that were manual skips (0..1, technical excluded). */
  skipRate: number;
  /** Median duration (s) of strongly-liked tracks, null when unknown. */
  preferredDuration: number | null;
  /** Decade affinity, e.g. [{ name: '2010s', score: 0.8 }]. */
  preferredDecades: RankedTag[];
  /** 0 = repeats favorites, 1 = constantly new artists. */
  discoveryLevel: number;
  recentlyPlayed: Track[];
  frequentlyPlayed: FrequentTrack[];
  /** Normalized share of listening per source (sums to ~1). */
  sourcePreference: Record<ListeningSource, number>;
  languagePreference: Record<string, number>;
  totalEvents: number;
  updatedAt: string;
}

const EMPTY_PREF: Record<ListeningSource, number> = { wave: 0, ytmusic: 0, saavn: 0, youtube: 0 };

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function topEntries(counts: Map<string, number>, limit: number): RankedTag[] {
  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, v]) => ({ name, score: Math.round((v / max) * 100) / 100 }));
}

function toAffinity(counts: Map<string, number>): Record<string, number> {
  const max = Math.max(1, ...counts.values());
  const out: Record<string, number> = {};
  for (const [k, v] of counts) out[k] = Math.round((v / max) * 100) / 100;
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

function decadeOf(track: Track): string | null {
  const y = Number(track.year);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
  return `${Math.floor(y / 10) * 10}s`;
}

function genreHints(track: Track): string[] {
  const out = new Set<string>();
  const lang = (track.language || '').trim();
  if (lang) out.add(lang);
  const hay = `${track.title || ''} ${track.author || ''}`.toLowerCase();
  if (/lofi|chill|acoustic/.test(hay)) out.add('Chill');
  if (/party|dance|workout|edm/.test(hay)) out.add('Workout');
  if (/love|romantic|slow/.test(hay)) out.add('Romantic');
  if (!out.size) out.add('Pop');
  return [...out];
}

export function buildTasteProfile(): TasteProfile {
  let events: ReturnType<typeof getListeningEvents> = [];
  try {
    events = getListeningEvents(500);
  } catch {
    events = [];
  }

  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const langCounts = new Map<string, number>();
  const decadeCounts = new Map<string, number>();
  const sourceCounts: Record<ListeningSource, number> = { ...EMPTY_PREF };
  const likedDurations: number[] = [];
  const completions: number[] = [];
  let manualSkips = 0;
  let outcomes = 0;

  const bump = (map: Map<string, number>, key: string, w: number) => {
    const k = normKey(key);
    if (!k) return;
    map.set(k, (map.get(k) ?? 0) + w);
  };

  const absorbTrack = (t: Track | undefined, weight: number, source: ListeningSource) => {
    if (!t) return;
    sourceCounts[source] = (sourceCounts[source] ?? 0) + weight;
    const primary = (t.author || '').split(',')[0]?.trim() || t.author || '';
    bump(artistCounts, primary, weight);
    if (t.albumName) bump(albumCounts, t.albumName, weight);
    for (const g of genreHints(t)) bump(genreCounts, g, weight * 0.7);
    if ((t.language || '').trim()) bump(langCounts, t.language as string, weight);
    const decade = decadeOf(t);
    if (decade) bump(decadeCounts, decade, weight);
  };

  for (const e of events) {
    if (isTechnicalFailure(e)) continue; // neutral — excluded everywhere
    const src: ListeningSource = e.source ?? 'wave';
    switch (e.event) {
      case 'play':
        absorbTrack(e.track, 1, src);
        break;
      case 'complete':
        absorbTrack(e.track, 2, src);
        completions.push(Math.min(1, (e.completionPercentage || 100) / 100));
        outcomes++;
        break;
      case 'replay':
      case 'like':
        absorbTrack(e.track, 2, src);
        if (e.track?.durationSeconds) likedDurations.push(e.track.durationSeconds);
        if (e.event === 'replay') {
          completions.push(Math.min(1, (e.completionPercentage || 100) / 100));
          outcomes++;
        }
        break;
      case 'add_to_playlist':
        absorbTrack(e.track, 1.5, src);
        if (e.track?.durationSeconds) likedDurations.push(e.track.durationSeconds);
        break;
      case 'skip': {
        const frac = e.duration > 0 ? e.playedSeconds / e.duration : 0;
        completions.push(Math.max(0, Math.min(1, frac)));
        manualSkips++;
        outcomes++;
        absorbTrack(e.track, 0.25, src);
        break;
      }
      case 'add_to_queue':
      case 'resume':
      case 'search':
      case 'view':
      case 'pause':
      case 'seek':
      case '10_percent':
      case '25_percent':
      case '50_percent':
      case '75_percent':
        absorbTrack(e.track, 0.25, src);
        break;
      case 'unlike':
      case 'error':
      default:
        break;
    }
  }

  // Unified history enriches artist/album familiarity (Wave + YT imports).
  let waveHistory: Track[] = [];
  try {
    waveHistory = playerStore.historyList();
  } catch {
    waveHistory = [];
  }
  const unified = attachRecency(mergeHistories(waveHistory, getCachedYTMusicHistory()));
  unified.forEach((entry, i) => {
    const w = 0.3 * Math.pow(0.97, i);
    const src = entry.primarySource;
    sourceCounts[src] = (sourceCounts[src] ?? 0) + w;
    const t = entry.track;
    const primary = (t.author || '').split(',')[0]?.trim() || t.author || '';
    bump(artistCounts, primary, w);
    if (t.albumName) bump(albumCounts, t.albumName, w);
  });

  // Recently + frequently played (Wave play counts; YT imports have none).
  const seen = new Map<string, Track>();
  for (const e of events) {
    if ((e.event === 'play' || e.event === 'complete' || e.event === 'replay') && e.track && !seen.has(e.songId)) {
      seen.set(e.songId, e.track);
    }
  }
  const recentlyPlayed = [...seen.values()].slice(0, 10);
  const frequentlyPlayed: FrequentTrack[] = [...seen.entries()]
    .map(([id, track]) => ({ track, plays: getPlayCount(id) }))
    .filter((f) => f.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 20);

  const distinctArtists = artistCounts.size;
  const singlePlayArtists = [...artistCounts.values()].filter((v) => v <= 1.25).length;
  const discoveryLevel = distinctArtists ? Math.round((singlePlayArtists / distinctArtists) * 100) / 100 : 0;

  const sourceTotal = Object.values(sourceCounts).reduce((a, b) => a + b, 0) || 1;
  const sourcePreference: Record<ListeningSource, number> = {
    wave: Math.round((sourceCounts.wave / sourceTotal) * 100) / 100,
    ytmusic: Math.round((sourceCounts.ytmusic / sourceTotal) * 100) / 100,
    saavn: Math.round((sourceCounts.saavn / sourceTotal) * 100) / 100,
    youtube: Math.round((sourceCounts.youtube / sourceTotal) * 100) / 100,
  };

  return {
    favoriteArtists: topEntries(artistCounts, 10),
    favoriteAlbums: topEntries(albumCounts, 10),
    favoriteGenres: topEntries(genreCounts, 10),
    favoriteLanguages: topEntries(langCounts, 5),
    artistAffinity: toAffinity(artistCounts),
    genreAffinity: toAffinity(genreCounts),
    albumAffinity: toAffinity(albumCounts),
    averageCompletionRate: completions.length
      ? Math.round((completions.reduce((a, b) => a + b, 0) / completions.length) * 100) / 100
      : 0,
    skipRate: outcomes ? Math.round((manualSkips / outcomes) * 100) / 100 : 0,
    preferredDuration: median(likedDurations),
    preferredDecades: topEntries(decadeCounts, 5),
    discoveryLevel,
    recentlyPlayed,
    frequentlyPlayed,
    sourcePreference,
    languagePreference: toAffinity(langCounts),
    totalEvents: events.length,
    updatedAt: new Date().toISOString(),
  };
}
