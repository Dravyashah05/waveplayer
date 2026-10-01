import type { SyncedLine, SyncedWord } from './ytmusicApi';
import { getLyrics } from './ytmusicApi';
import { getSaavnLyrics } from './saavnApi';

export interface NormalizedLyrics {
  provider: string;
  confidence: number;
  synced: SyncedLine[] | null;
  plain: string[] | null;
  wordSynced: boolean;
}

export interface LyricsProvider {
  id: string;
  fetch(track: { title: string; author: string; videoId?: string }): Promise<NormalizedLyrics | null>;
}

function plainLines(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Word timings are only reported when a provider actually supplies them —
 *  plain/line lyrics are never presented as word-synchronized. */
function hasWordTiming(synced: SyncedLine[] | null): boolean {
  return !!synced?.some((l) => Array.isArray(l.words) && l.words.length > 0);
}

const ytmusicProvider: LyricsProvider = {
  id: 'ytmusic',
  async fetch(track) {
    const videoId = track.videoId && /^[a-zA-Z0-9_-]{11}$/.test(track.videoId) ? track.videoId : undefined;
    if (!videoId) return null;
    const data = await getLyrics(videoId).catch(() => null);
    if (!data || (!data.synced?.length && !data.plain?.length)) return null;
    const synced = data.synced?.length ? data.synced : null;
    return {
      provider: `ytmusic${data.source ? `:${data.source}` : ''}`,
      confidence: synced ? 0.85 : 0.6,
      synced,
      plain: data.plain?.length ? data.plain : null,
      wordSynced: hasWordTiming(synced),
    };
  },
};

const saavnProvider: LyricsProvider = {
  id: 'saavn',
  async fetch(track) {
    const lyricsId = (track as any)?.lyricsId;
    if (!lyricsId) return null;
    const data = await getSaavnLyrics(lyricsId).catch(() => null);
    if (!data?.lyrics) return null;
    return { provider: 'saavn', confidence: 0.55, synced: null, plain: plainLines(data.lyrics), wordSynced: false };
  },
};

const PROVIDERS: LyricsProvider[] = [ytmusicProvider, saavnProvider];

export function wordAt(synced: SyncedLine[] | null, progress: number): { line: number; word: number } {
  if (!synced?.length) return { line: -1, word: -1 };
  let line = -1;
  for (let i = 0; i < synced.length; i++) {
    if (progress >= synced[i].time) line = i;
    else break;
  }
  if (line < 0) return { line: -1, word: -1 };
  const words: SyncedWord[] | undefined = synced[line].words;
  if (!words?.length) return { line, word: -1 };
  let word = -1;
  for (let i = 0; i < words.length; i++) {
    if (progress >= words[i].start) word = i;
    else break;
  }
  return { line, word };
}

/** First provider with usable lyrics wins, annotated with confidence. */
export async function fetchLyricsAll(track: { title: string; author: string; videoId?: string }): Promise<NormalizedLyrics | null> {
  for (const p of PROVIDERS) {
    try {
      const r = await p.fetch(track);
      if (r && (r.synced?.length || r.plain?.length)) return r;
    } catch {}
  }
  return null;
}
