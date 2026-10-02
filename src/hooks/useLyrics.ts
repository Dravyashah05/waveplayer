import { useEffect, useState } from 'react';
import type { Track } from '../types';
import type { SyncedLine } from '../services/ytmusicApi';
import { getLyrics, searchLrcLib } from '../services/ytmusicApi';
import { getSaavnLyrics } from '../services/saavnApi';

export interface LyricsState {
  plain: string[] | null;
  synced: SyncedLine[] | null;
  source: string | null;
  loading: boolean;
}

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Shared lyric fetch pipeline (JioSaavn official → YouTube Music → LRCLIB).
 * One cascade used by every lyrics surface — no duplicate fetching logic.
 * Playback never depends on it: failures resolve to an empty clean state.
 */
export function useLyrics(track: Track | null): LyricsState {
  const [plain, setPlain] = useState<string[] | null>(null);
  const [synced, setSynced] = useState<SyncedLine[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!track?.id) {
      setPlain(null);
      setSynced(null);
      setSource(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPlain(null);
    setSynced(null);
    setSource(null);
    (async () => {
      // 1. JioSaavn official lyrics
      if (track.source === 'saavn' || track.lyricsId || track.hasLyrics || !YT_ID_RE.test(track.id)) {
        try {
          const res = await getSaavnLyrics(track.lyricsId || track.id);
          if (!cancelled && res?.lyrics) {
            setPlain(res.lyrics.split('\n').map((l) => l.trim()).filter(Boolean));
            setSource('JioSaavn Official');
            return;
          }
        } catch { /* next source */ }
      }
      // 2. YouTube Music lyrics endpoint (valid video ids only)
      if (!cancelled && YT_ID_RE.test(track.id)) {
        try {
          const res = await getLyrics(track.id);
          if (!cancelled && res && (res.synced?.length || res.plain?.length)) {
            setSynced(res.synced);
            setPlain(res.plain);
            setSource(res.source || 'YouTube Music');
            return;
          }
        } catch { /* next source */ }
      }
      // 3. LRCLIB fallback by title + artist
      if (!cancelled) {
        try {
          const lrc = await searchLrcLib(track.title, track.author, track.durationSeconds);
          if (!cancelled && lrc && (lrc.synced?.length || lrc.plain?.length)) {
            setSynced(lrc.synced);
            setPlain(lrc.plain);
            setSource(lrc.source || 'LRCLIB');
          }
        } catch { /* clean unavailable state below */ }
      }
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id]);

  return { plain, synced, source, loading };
}
