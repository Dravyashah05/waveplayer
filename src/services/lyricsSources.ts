import type { SyncedLine } from './ytmusicApi';
import { getLyrics } from './ytmusicApi';
import { getSaavnLyrics } from './saavnApi';

export interface LyricsWord {
  text: string;
  start?: number;
  end?: number;
}

export interface LyricsLine {
  text: string;
  start?: number;
  end?: number;
  words?: LyricsWord[];
}

export interface NormalizedLyrics {
  provider: string;
  confidence: number;
  synced: boolean;
  lines: LyricsLine[];
}

export interface LyricsProvider {
  id: string;
  fetch(track: { title: string; author: string; videoId?: string; lyricsId?: string }): Promise<NormalizedLyrics | null>;
}

function hasTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function normalizeLyrics(
  provider: string,
  synced: SyncedLine[] | null | undefined,
  plain: string[] | null | undefined,
  confidence = 0.5,
): NormalizedLyrics | null {
  const timed = (synced || []).map((line, index, all): LyricsLine => {
    const firstWordStart = Array.isArray(line.words) ? line.words.find((word) => hasTimestamp(word.start))?.start : undefined;
    const start = hasTimestamp((line as any).start) ? (line as any).start : hasTimestamp(line.time) ? line.time : firstWordStart;
    const nextStart = all.slice(index + 1).map((next) => hasTimestamp((next as any).start) ? (next as any).start : next.time).find(hasTimestamp);
    const words = Array.isArray(line.words) ? line.words.map((word) => ({
      text: word.text,
      start: hasTimestamp(word.start) ? word.start : undefined,
      end: hasTimestamp(word.end) ? word.end : undefined,
    })) : undefined;
    return {
      text: line.text,
      start,
      end: hasTimestamp((line as any).end) ? (line as any).end : nextStart,
      words: words?.length ? words : undefined,
    };
  }).filter((line) => !!line.text?.trim());
  if (timed.length) return { provider, confidence, synced: timed.some((line) => hasTimestamp(line.start)), lines: timed };
  const unsynced = (plain || []).map((text) => ({ text: text.trim() })).filter((line) => !!line.text);
  return unsynced.length ? { provider, confidence, synced: false, lines: unsynced } : null;
}

const ytmusicProvider: LyricsProvider = {
  id: 'ytmusic',
  async fetch(track) {
    const videoId = track.videoId && /^[a-zA-Z0-9_-]{11}$/.test(track.videoId) ? track.videoId : undefined;
    if (!videoId) return null;
    const data = await getLyrics(videoId).catch(() => null);
    if (!data) return null;
    return normalizeLyrics(`ytmusic${data.source ? `:${data.source}` : ''}`, data.synced, data.plain, data.synced?.length ? 0.85 : 0.6);
  },
};

const saavnProvider: LyricsProvider = {
  id: 'saavn',
  async fetch(track) {
    if (!track.lyricsId) return null;
    const data = await getSaavnLyrics(track.lyricsId).catch(() => null);
    if (!data?.lyrics) return null;
    const plain = data.lyrics.split('\n').map((line: string) => line.trim()).filter(Boolean);
    return normalizeLyrics('saavn', null, plain, 0.55);
  },
};

const PROVIDERS: LyricsProvider[] = [ytmusicProvider, saavnProvider];

export function wordAt(lines: LyricsLine[] | null, progress: number): { line: number; word: number } {
  if (!lines?.length || !Number.isFinite(progress)) return { line: -1, word: -1 };
  let line = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].start;
    if (!hasTimestamp(start)) continue;
    const end = lines[i].end ?? lines.slice(i + 1).find((candidate) => hasTimestamp(candidate.start))?.start;
    if (progress >= start && (!hasTimestamp(end) || progress < end)) line = i;
  }
  if (line < 0) return { line: -1, word: -1 };
  const words = lines[line].words;
  if (!words?.length) return { line, word: -1 };
  let word = -1;
  for (let i = 0; i < words.length; i++) {
    if (hasTimestamp(words[i].start) && progress >= words[i].start!) word = i;
    else if (hasTimestamp(words[i].start)) break;
  }
  return { line, word };
}

export function canSeekLyricsLine(line: LyricsLine | undefined): line is LyricsLine & { start: number } {
  return !!line && hasTimestamp(line.start);
}

export function manualScrollUntil(now: number, durationMs = 10_000): number {
  return now + durationMs;
}

export function isManualScrollSuspended(until: number, now: number): boolean {
  return until > now;
}

/** The first provider with usable lyrics wins; each result is normalized. */
export async function fetchLyricsAll(track: { title: string; author: string; videoId?: string; lyricsId?: string }): Promise<NormalizedLyrics | null> {
  for (const provider of PROVIDERS) {
    try {
      const result = await provider.fetch(track);
      if (result?.lines.length) return result;
    } catch {}
  }
  return null;
}
