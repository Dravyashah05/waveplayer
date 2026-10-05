import { useRef, useEffect, useState } from 'react';
import { Mic2, Loader2 } from 'lucide-react';
import type { SyncedLine } from '../services/ytmusicApi';
import { canSeekLyricsLine, isManualScrollSuspended, manualScrollUntil, normalizeLyrics, wordAt } from '../services/lyricsSources';
import { settingsStore } from '../services/settingsStore';

interface Props {
  synced: SyncedLine[] | null;
  plain: string[] | null;
  isPlaying: boolean;
  source: string | null;
  loading: boolean;
  progress: number;
  duration: number;
  onSeek: (seconds: number) => void;
  artwork?: string;
  title?: string;
  artist?: string;
  trackId?: string;
  onClose?: () => void;
}

export const LyricsView: React.FC<Props> = ({ synced, plain, isPlaying, loading, onSeek, progress, source, title, artist, trackId }) => {
  const lineRefs = useRef<(HTMLParagraphElement | HTMLButtonElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const overrideTimer = useRef<number | null>(null);
  const programmaticScroll = useRef(false);
  const programmaticScrollTimer = useRef<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(() => settingsStore.get().lyricsAutoScroll);
  const [manualOverride, setManualOverride] = useState(false);
  const [resumeRequested, setResumeRequested] = useState(false);
  const normalized = normalizeLyrics(source || 'lyrics', synced, plain);
  const lines = normalized?.lines || [];
  const isSynced = !!normalized?.synced;
  const position = wordAt(lines, progress);
  const activeIndex = isSynced ? position.line : -1;
  const scrollEnabled = !manualOverride && (autoScroll || resumeRequested);

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => setAutoScroll(settingsStore.get().lyricsAutoScroll));
    return unsub;
  }, []);

  // Keep the focused line pinned to the vertical center of the lyrics
  // panel. Scrolls the panel itself (never the page) so the active line
  // stays in focus whether playing or paused.
  const centerActiveLine = (smooth: boolean) => {
    const container = scrollRef.current;
    const el = activeIndex >= 0 ? lineRefs.current[activeIndex] : null;
    if (!container || !el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const target = container.scrollTop + (elRect.top - containerRect.top) - container.clientHeight / 2 + elRect.height / 2;
    programmaticScroll.current = true;
    container.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
    if (programmaticScrollTimer.current != null) window.clearTimeout(programmaticScrollTimer.current);
    programmaticScrollTimer.current = window.setTimeout(() => {
      programmaticScroll.current = false;
      programmaticScrollTimer.current = null;
    }, 700);
  };

  useEffect(() => {
    if (!scrollEnabled || activeIndex < 0) return;
    centerActiveLine(true);
  }, [activeIndex, scrollEnabled]);

  useEffect(() => {
    if (overrideTimer.current != null) window.clearTimeout(overrideTimer.current);
    setManualOverride(false);
    setResumeRequested(false);
    return () => {
      if (overrideTimer.current != null) window.clearTimeout(overrideTimer.current);
      if (programmaticScrollTimer.current != null) window.clearTimeout(programmaticScrollTimer.current);
    };
  }, [title, artist, trackId]);

  useEffect(() => () => {
    if (overrideTimer.current != null) window.clearTimeout(overrideTimer.current);
    if (programmaticScrollTimer.current != null) window.clearTimeout(programmaticScrollTimer.current);
  }, []);

  const pauseAutoScroll = () => {
    setManualOverride(true);
    setResumeRequested(false);
    if (overrideTimer.current != null) window.clearTimeout(overrideTimer.current);
    const until = manualScrollUntil(Date.now());
    overrideTimer.current = window.setTimeout(() => {
      if (!isManualScrollSuspended(until, Date.now())) setManualOverride(false);
      overrideTimer.current = null;
    }, Math.max(0, until - Date.now()));
  };

  const resumeSync = () => {
    if (overrideTimer.current != null) window.clearTimeout(overrideTimer.current);
    overrideTimer.current = null;
    setManualOverride(false);
    setResumeRequested(true);
    if (activeIndex >= 0) centerActiveLine(true);
  };

  const onManualScroll = () => {
    if (!programmaticScroll.current) pauseAutoScroll();
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col justify-center space-y-3 px-2 py-10 sm:px-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[22px] animate-pulse rounded-full bg-white/[0.06] sm:h-[26px]" style={{ width: `${42 + (i % 4) * 14}%`, opacity: 1 - i * 0.08 }} />)}
          <p className="mt-6 flex items-center gap-2 text-[11px] uppercase tracking-widest text-white/35"><Loader2 className="h-3 w-3 animate-spin" /> Loading lyrics</p>
        </div>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.06]"><Mic2 className="h-6 w-6 text-white/30" /></div>
        <p className="mt-4 text-[15px] font-semibold text-white">No lyrics found</p>
        <p className="mt-1.5 max-w-[260px] text-xs leading-relaxed text-white/40">Lyrics aren’t available for this track.</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      {manualOverride && isSynced && (
        <button type="button" onClick={resumeSync} className="absolute right-3 top-2 z-10 rounded-full border border-white/15 bg-black/70 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur" aria-label="Resume lyric synchronization">
          Resume sync
        </button>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-none scroll-smooth"
        onWheel={pauseAutoScroll}
        onTouchMove={pauseAutoScroll}
        onScroll={onManualScroll}
        onKeyDown={(event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseAutoScroll();
        }}
        tabIndex={0}
        aria-label="Lyrics"
      >
        <div className="px-5 py-8 sm:px-8 lg:px-10">
          {isSynced && activeIndex === -1 && <p className="py-8 text-center text-[12px] font-medium uppercase tracking-widest text-white/25">Intro — lyrics follow playback</p>}
          {lines.map((line, i) => {
            const isActive = i === activeIndex;
            const distance = activeIndex < 0 ? 99 : Math.abs(i - activeIndex);
            const canSeek = isSynced && canSeekLyricsLine(line);
            const words = line.words?.some((word) => typeof word.start === 'number') ? line.words : undefined;
            const activeWord = isActive && words ? position.word : -1;
            const opacity = !isSynced ? 0.9 : isActive ? 1 : distance === 1 ? 0.62 : distance === 2 ? 0.32 : 0.14;
            const content = (
              <>
                {words ? words.map((word, wordIndex) => (
                  <span key={wordIndex} className={`transition-colors duration-200 ${wordIndex === activeWord ? 'text-white' : wordIndex < activeWord ? 'text-white/85' : 'text-white/45'}`}>
                    {word.text}{wordIndex < words.length - 1 ? ' ' : ''}
                  </span>
                )) : line.text || <span className="opacity-30">—</span>}
              </>
            );
            const sharedClass = `block w-full break-words py-2.5 text-left text-balance tracking-[-0.025em] transition-[opacity,transform,color] duration-300 ${isActive ? 'py-3.5 sm:py-4' : ''} ${canSeek ? 'cursor-pointer' : 'cursor-default'}`;
            const sharedStyle = { opacity, transform: isActive ? 'scale(1)' : `scale(${distance === 1 ? 0.99 : 0.97})` };

            return canSeek ? (
              <button
                key={`${i}-${line.text.slice(0, 24)}`}
                ref={(el) => { lineRefs.current[i] = el; }}
                type="button"
                onClick={() => onSeek(line.start!)}
                className={`${sharedClass} ${isActive ? 'text-[30px] font-extrabold leading-[1.2] text-white sm:text-[38px] lg:text-[46px]' : 'text-[16px] font-medium leading-[1.55] text-white sm:text-[19px] lg:text-[21px]'}`}
                style={sharedStyle}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`Seek to lyric: ${line.text}`}
              >{content}</button>
            ) : (
              <p
                key={`${i}-${line.text.slice(0, 24)}`}
                ref={(el) => { lineRefs.current[i] = el; }}
                className={`${sharedClass} ${isActive ? 'text-[30px] font-extrabold leading-[1.2] text-white sm:text-[38px] lg:text-[46px]' : 'text-[16px] font-medium leading-[1.55] text-white sm:text-[19px] lg:text-[21px]'}`}
                style={sharedStyle}
              >{content}</p>
            );
          })}
          <div className="flex items-center justify-center gap-2 pb-2 pt-12">
            <span className="h-px w-6 bg-white/10" />
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/25">
              {isSynced ? (isPlaying ? 'Live synced • tap a line to seek' : 'Synced • paused') : 'Lyrics'}
            </p>
            <span className="h-px w-6 bg-white/10" />
          </div>
        </div>
      </div>
    </div>
  );
};
