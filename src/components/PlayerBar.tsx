import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  Mic2,
  Heart,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Radio,
  Share2,
  ChevronDown,
  Download,
  Music2,
  Loader2,
  RotateCcw,
  AlertTriangle,
  Check,
  MoreVertical,
  Trash2,
  Clock3,
  Activity,
} from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Track } from '../types';
import { useLyrics } from '../hooks/useLyrics';
// Fullscreen-only surfaces split out of the initial chunk; the dock and
// transport stay eager. Fallbacks are inline spinners (never layout shifts).
const LyricsView = lazy(() => import('./LyricsView').then((m) => ({ default: m.LyricsView })));
const StatsPanel = lazy(() => import('./StatsPanel').then((m) => ({ default: m.StatsPanel })));
const AlbumCanvas = lazy(() => import('./AlbumCanvas').then((m) => ({ default: m.AlbumCanvas })));
import { MiniPlayer } from './MiniPlayer';
import { ArtworkImage } from './ArtworkImage';
import { playerStore } from '../services/playerStore';
import { getActiveSession, subscribeRadio } from '../services/radioEngine';
import { settingsStore } from '../services/settingsStore';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import { toast } from './Toast';
import {
  canDownloadOffline,
  cancelOfflineDownload,
  formatBytes,
  getOfflineEntry,
  queueOfflineDownload,
  removeOfflineDownload,
  retryOfflineDownload,
  subscribeOffline,
} from '../services/offlineDownloads';

interface Props {
  onOpenQueue?: () => void;
  /** Dedicated Now Playing page (MiniPlayer tap). Falls back to the overlay. */
  onOpenNowPlaying?: () => void;
  /** Hide the mini-player dock (used when the fullscreen Now Playing takeover is showing). */
  hideMini?: boolean;
}

export const PlayerBar: React.FC<Props> = ({ onOpenQueue, onOpenNowPlaying, hideMini = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ——— Playback engine: single source of truth (backends, intent, buffering,
  //     progress, volume, errors, MediaSession). This component is pure UI. ———
  const eng = usePlayerEngine();
  const { isPlaying, isBuffering, progress, duration, volume, muted, error, resolved } = eng;
  const [statsOpen, setStatsOpen] = useState(false);

  const cycleSpeed = () => {
    const steps = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];
    const next = steps[(steps.indexOf(eng.playbackRate) + 1) % steps.length] ?? 1;
    playerEngine.setPlaybackRate(next);
  };

  const cycleSleep = () => {
    // Off → 5 → 10 → 15 → 30 → 60 → end of track → Off
    const cur = eng.sleepRemainingSec;
    if (cur == null) playerEngine.setSleepTimer(5);
    else if (cur === 5 * 60) playerEngine.setSleepTimer(10);
    else if (cur === 10 * 60) playerEngine.setSleepTimer(15);
    else if (cur === 15 * 60) playerEngine.setSleepTimer(30);
    else if (cur === 30 * 60) playerEngine.setSleepTimer(60);
    else if (cur === 60 * 60) playerEngine.setSleepEndOfTrack(true);
    else playerEngine.clearSleepTimer();
  };

  const sleepLabel = (() => {
    const cur = eng.sleepRemainingSec;
    if (cur == null) return 'Off';
    if (cur < 0) return 'End of track';
    const m = Math.ceil(cur / 60);
    return `${m}m left`;
  })();

  // Mount the hidden YouTube surface once; the engine follows playerStore itself.
  useEffect(() => {
    playerEngine.attach(containerRef.current);
  }, []);

  // Overflow menu: close on outside tap or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const [current, setCurrent] = useState<Track | null>(() => playerStore.current());
  const track = current;
  const [fullscreen, setFullscreen] = useState(false);

  const { plain: plainLyrics, synced: syncedLyrics, source: lyricsSource, loading: lyricsLoading } = useLyrics(track);

  const [isFav, setIsFav] = useState(() => (track ? playerStore.isFav(track.id) : false));
  const [shuffle, setShuffle] = useState(() => playerStore.shuffle);
  const [repeat, setRepeat] = useState(() => playerStore.repeat);
  const [queue, setQueue] = useState<Track[]>(() => playerStore.queue());
  const [radioActive, setRadioActive] = useState(() => getActiveSession() !== null);
  useEffect(() => subscribeRadio(() => setRadioActive(getActiveSession() !== null)), []);
  const [showFsLyrics, setShowFsLyrics] = useState(false);
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassIntensity(settingsStore.get().glassIntensity);
      setGlassEnabled(settingsStore.get().glassEnabled);
    });
    return () => { unsub(); };
  }, []);
  const glassBlur = glassEnabled ? Math.round(8 + (glassIntensity / 100) * 24) : 0;

  // Keep heart state in sync when track changes
  useEffect(() => {
    setIsFav(track ? playerStore.isFav(track.id) : false);
  }, [track?.id]);

  // Sync state with playerStore
  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setShuffle(playerStore.shuffle);
      setRepeat(playerStore.repeat);
      setQueue([...playerStore.queue()]);
      const cur = playerStore.current();
      setCurrent(cur);
      if (cur) setIsFav(playerStore.isFav(cur.id));
    });
    return () => {
      unsub();
    };
  }, []);

  // Re-render download menu rows on offline state changes
  const [, setDlTick] = useState(0);
  useEffect(() => subscribeOffline(() => setDlTick((n) => n + 1)), []);

  // Surface engine errors once (the engine auto-skips poisoned tracks first)
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      lastErrorRef.current = error;
      toast.error(error);
    }
    if (!error) lastErrorRef.current = null;
  }, [error]);

  // (playback engine lives in services/playerEngine.ts)

  // Playback controls — thin wrappers over the engine (analytics live in engine/store).
  // Stable references so the memoized MiniPlayer skips progress-tick re-renders
  // unless its own props actually changed.
  const togglePlay = useCallback(() => playerEngine.toggle(), []);
  const openPlayer = useCallback(
    () => (onOpenNowPlaying ? onOpenNowPlaying() : setFullscreen(true)),
    [onOpenNowPlaying],
  );

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    playerEngine.setSeeking(false);
    playerEngine.seek(Number(e.target.value));
  };
  const seekBegin = () => playerEngine.setSeeking(true);
  const seekEnd = () => playerEngine.setSeeking(false);

  const handleNext = useCallback(() => playerEngine.next(), []);
  const handlePrev = useCallback(() => playerEngine.prev(), []);

  const toggleFav = useCallback(() => {
    const cur = playerStore.current();
    if (!cur) return;
    setIsFav(playerStore.toggleFav(cur));
  }, []);

  const handleRemove = () => {
    const idx = playerStore.currentIndex();
    if (idx >= 0) playerStore.removeFromQueue(idx);
    setMenuOpen(false);
  };

  const handleDownloadAction = () => {
    if (!track) return;
    const st = getOfflineEntry(track.id)?.state;
    if (st === 'completed') {
      void removeOfflineDownload(track.id);
      toast.success(`Removed offline copy`);
    } else if (st === 'queued' || st === 'downloading') {
      cancelOfflineDownload(track.id);
    } else if (st === 'failed' || st === 'cancelled') {
      retryOfflineDownload(track.id);
    } else if (canDownloadOffline(track).eligible) {
      queueOfflineDownload(track);
    }
    setMenuOpen(false);
  };

  const downloadMenu = (() => {
    if (!track || track.source === 'local') return null;
    const entry = getOfflineEntry(track.id);
    if (entry?.state === 'completed') {
      return {
        label: `Downloaded${typeof entry.size === 'number' ? ` • ${formatBytes(entry.size)}` : ''}`,
        icon: <Check className="h-4 w-4 shrink-0 text-emerald-400" />,
        disabled: false as const,
        title: 'Remove the offline copy',
      };
    }
    if (entry?.state === 'queued' || entry?.state === 'downloading') {
      const pct = entry.state === 'downloading' ? ` ${Math.round((entry.progress || 0) * 100)}%` : '';
      return {
        label: `Downloading…${pct}`,
        icon: <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/60" />,
        disabled: false as const,
        title: 'Cancel the offline download',
      };
    }
    if (entry?.state === 'failed') {
      return {
        label: 'Retry download',
        icon: <Download className="h-4 w-4 shrink-0 text-white/60" />,
        disabled: false as const,
        title: entry.error || 'Retry the offline download',
      };
    }
    const gate = canDownloadOffline(track);
    if (!gate.eligible) {
      return {
        label: 'Download',
        icon: <Download className="h-4 w-4 shrink-0 text-white/25" />,
        disabled: true as const,
        title: gate.reason || 'Download unavailable',
      };
    }
    return {
      label: 'Download',
      icon: <Download className="h-4 w-4 shrink-0 text-white/60" />,
      disabled: false as const,
      title: 'Download for offline listening',
    };
  })();

  const handleShare = () => {
    if (navigator.share && track) {
      navigator
        .share({
          title: track.title,
          text: `Listening to ${track.title} by ${track.author} on Wave Music`,
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const effectiveDuration =
    duration > 1
      ? duration
      : track?.durationSeconds && track.durationSeconds > 0
      ? track.durationSeconds
      : 180;
  const pct = Math.min(100, (progress / effectiveDuration) * 100);
  const seekMax = Math.max(1, Math.round(effectiveDuration));
  const seekValue = Math.min(Math.round(progress), seekMax);

  if (!track) {
    if (hideMini) return null;
    return (
      <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] lg:bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-14px)] sm:w-[calc(100%-28px)] max-w-[560px] lg:max-w-[640px] z-30 rounded-[24px] px-4 py-3 border border-white/[0.10] bg-[#0c0c0e]/95 backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] select-none">
        <div className="flex items-center justify-center gap-2.5 text-xs sm:text-sm text-white/50">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 shrink-0">
            <Music2 className="h-3.5 w-3.5" />
          </span>
          <p className="truncate">Select a track to start playing <span className="text-white/30">— Wave</span></p>
        </div>
      </div>
    );
  }

  return (
    <>
      {!hideMini && (
        <MiniPlayer
          track={track}
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          progress={progress}
          duration={effectiveDuration}
          isFav={isFav}
          onOpen={openPlayer}
          onToggle={togglePlay}
          onNext={handleNext}
          onPrev={handlePrev}
          onToggleFav={toggleFav}
          onOpenQueue={onOpenQueue}
        />
      )}

      {/* Hidden YouTube surface mount */}
      <div
        ref={containerRef}
        className="fixed -left-[9999px] -top-[9999px] w-0 h-0 overflow-hidden"
        aria-hidden
      />


      {/* Fullscreen — Rebuilt Premium */}
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 20 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-50 flex flex-col text-white overflow-hidden bg-black"
          >
            {/* Background — flat void with fade gradients */}
            <div className="absolute inset-0 overflow-hidden">
              <Suspense fallback={null}>
                <AlbumCanvas artwork={track.thumbnail} title={track.title} />
              </Suspense>
              <div className="absolute inset-0 bg-black/55" />
              <div
                className="absolute inset-0"
                style={
                  glassEnabled
                    ? {
                        backgroundColor: `rgba(255,255,255,0.04)`,
                        backdropFilter: `blur(${Math.round(glassBlur * 0.4)}px) saturate(160%)`,
                        WebkitBackdropFilter: `blur(${Math.round(glassBlur * 0.4)}px) saturate(160%)`,
                      }
                    : {}
                }
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-transparent" />
            </div>

            {/* Top Bar — redesigned: drag cue + eyebrow + glass actions */}
            <div className="relative z-20 px-4 pt-3 sm:px-6 sm:pt-4">
              <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2">
                <div className="h-1 w-10 rounded-full bg-white/25" aria-hidden />
                <div className="flex w-full items-center justify-between gap-3 py-1">
                  <button
                    type="button"
                    onClick={() => setFullscreen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur-xl transition-all hover:bg-white hover:text-black active:scale-95"
                    title="Close"
                    aria-label="Close fullscreen player"
                  >
                    <ChevronDown className="h-5 w-5" />
                  </button>

                  <div className="flex min-w-0 flex-col items-center leading-none">
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/45">Now Playing</p>
                    <p className="mt-1 max-w-[40vw] truncate text-[13px] font-semibold text-white/85 sm:max-w-md">{track.author}{radioActive ? ' • Radio' : ''}</p>
                  </div>

                <div className="relative shrink-0" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="More options"
                    aria-expanded={menuOpen}
                    title="More options"
                    className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all active:scale-95 ${menuOpen ? 'bg-white text-black border-white' : 'bg-white/10 border-white/10 text-white hover:bg-white hover:text-black'}`}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                    {menuOpen && (
                      <div className="absolute right-0 top-[calc(100%+8px)] z-10 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#141416] py-2 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
                      {onOpenNowPlaying && (
                        <button
                          type="button"
                          onClick={() => { onOpenNowPlaying(); setMenuOpen(false); }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                        >
                          <ListMusic className="h-4 w-4 shrink-0 text-white/60" />
                          <span className="flex-1">Open Now Playing</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { toggleFav(); setMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                      >
                        <Heart className={`h-4 w-4 shrink-0 ${isFav ? 'fill-current' : 'text-white/60'}`} />
                        <span className="flex-1">{isFav ? 'Unlike' : 'Like'}</span>
                        {isFav && <Check className="h-3.5 w-3.5 text-white/50" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => { playerStore.toggleShuffle(); setMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                      >
                        <Shuffle className="h-4 w-4 shrink-0 text-white/60" />
                        <span className="flex-1">Shuffle</span>
                        <span className={`text-[11px] font-bold ${shuffle ? 'text-white' : 'text-white/40'}`}>{shuffle ? 'On' : 'Off'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { playerStore.cycleRepeat(); setMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                      >
                        {repeat === 'one'
                          ? <Repeat1 className="h-4 w-4 shrink-0 text-white/60" />
                          : <Repeat className="h-4 w-4 shrink-0 text-white/60" />}
                        <span className="flex-1">Repeat</span>
                        <span className={`text-[11px] font-bold capitalize ${repeat !== 'off' ? 'text-white' : 'text-white/40'}`}>{repeat}</span>
                      </button>
                      {downloadMenu && (
                        <button
                          type="button"
                          onClick={handleDownloadAction}
                          disabled={downloadMenu.disabled}
                          title={downloadMenu.title}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {downloadMenu.icon}
                          <span className="flex-1">{downloadMenu.label}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { handleShare(); setMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                      >
                        <Share2 className="h-4 w-4 shrink-0 text-white/60" />
                        <span className="flex-1">Share</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { cycleSpeed(); setMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                      >
                        <RotateCcw className="h-4 w-4 shrink-0 text-white/60" />
                        <span className="flex-1">Playback speed</span>
                        <span className="text-[11px] font-bold text-white">{eng.playbackRate}x</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { cycleSleep(); setMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                      >
                        <Clock3 className="h-4 w-4 shrink-0 text-white/60" />
                        <span className="flex-1">Sleep timer</span>
                        <span className="text-[11px] font-bold text-white">{sleepLabel}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setStatsOpen(true); setMenuOpen(false); }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white/10 transition-colors"
                      >
                        <Activity className="h-4 w-4 shrink-0 text-white/60" />
                        <span className="flex-1">Stats for Nerds</span>
                      </button>
                      <div className="mx-4 my-1.5 h-px bg-white/10" />
                      <button
                        type="button"
                        onClick={handleRemove}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4 shrink-0" />
                        <span className="flex-1">Remove from queue</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>

            {/* Center — adaptive layout, scrolls on short screens */}
            <div className="relative z-10 flex-1 min-h-0 w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-4 sm:gap-6 lg:gap-8 px-4 sm:px-6 lg:px-8 pb-4 overflow-y-auto scrollbar-none">
              {/* Art Section — redesigned stage */}
              <div className={`flex flex-col items-center justify-center gap-5 shrink-0 ${showFsLyrics ? 'lg:w-[44%] lg:py-6' : 'lg:flex-1 py-2'}`}>
                <div className="relative">
                  {/* ambient glow */}
                  <div aria-hidden className="absolute -inset-6 overflow-hidden rounded-[40px] opacity-50 blur-3xl">
                    <ArtworkImage src={track.thumbnail} alt="" className="h-full w-full scale-110 object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <motion.div
                    animate={{ scale: isPlaying ? 1 : 0.975 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className={`relative overflow-hidden rounded-[28px] sm:rounded-[32px] bg-[#0f0f0f] shadow-[0_32px_80px_rgba(0,0,0,0.8)] ring-1 ring-white/20 shrink-0 ${showFsLyrics ? 'h-[clamp(140px,44vw,220px)] w-[clamp(140px,44vw,220px)] sm:h-[280px] sm:w-[280px] lg:h-[360px] lg:w-[360px]' : 'h-[clamp(200px,64vw,280px)] w-[clamp(200px,64vw,280px)] sm:h-[340px] sm:w-[340px] lg:h-[400px] lg:w-[400px]'}`}
                  >
                    <ArtworkImage src={track.thumbnail} alt={track.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/[0.08]" />
                    <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/10" />
                    {isBuffering && (
                      <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]">
                        <Loader2 className="h-8 w-8 animate-spin text-white" />
                      </div>
                    )}
                  </motion.div>
                  {/* floating like */}
                  <button
                    type="button"
                    onClick={toggleFav}
                    aria-label={isFav ? 'Unlike' : 'Like'}
                    className={`absolute -bottom-3 right-4 flex h-11 w-11 items-center justify-center rounded-full shadow-xl ring-1 transition-all active:scale-90 ${isFav ? 'bg-white text-red-500 ring-white' : 'border border-white/15 bg-black/60 text-white backdrop-blur-xl hover:bg-white hover:text-black'}`}
                  >
                    <Heart className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} />
                  </button>
                </div>

                <div className="w-full max-w-[420px] space-y-2 px-2 text-center">
                  <h2 className="break-words text-[24px] font-black leading-[1.05] tracking-[-0.03em] text-white line-clamp-2 min-[400px]:text-[28px] sm:text-[32px]">{track.title}</h2>
                  <p className="truncate text-[13px] font-medium text-white/60 sm:text-[14px]">{track.author}{track.albumName ? ` — ${track.albumName}` : ''}</p>
                  <div className="flex items-center justify-center gap-1.5 pt-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1 text-[11px] font-semibold text-white/70 backdrop-blur">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                      {track.type || 'SONG'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1 text-[11px] font-semibold text-white/70 backdrop-blur">
                      <Music2 className="h-3 w-3" /> {track.source === 'ytmusic' ? 'YouTube Music' : track.source ?? 'Wave'}
                    </span>
                    {lyricsSource && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black">
                        <Mic2 className="h-3 w-3" /> Lyrics
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Lyrics Panel — no header */}
              <div className={`${showFsLyrics ? 'flex' : 'hidden lg:hidden'} flex-1 min-h-0 flex-col overflow-hidden lg:max-w-[56%]`}>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-transparent border-0 shadow-none">
                  {/* Content — lyrics only */}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <div className="h-full overflow-hidden">
                      <Suspense fallback={<div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>}>
                      <LyricsView
                        synced={syncedLyrics}
                        plain={plainLyrics}
                        isPlaying={isPlaying}
                        source={lyricsSource}
                        loading={lyricsLoading}
                        progress={progress}
                        duration={effectiveDuration}
                        onSeek={(seconds) => playerEngine.seek(seconds)}
                        artwork={track.thumbnail}
                        title={track.title}
                        artist={track.author}
                        trackId={track.id}
                      />
                      </Suspense>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom — redesigned floating glass dock */}
            <div className="relative z-10 px-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
              <div className="mx-auto w-full max-w-2xl rounded-[28px] border border-white/10 bg-white/[0.07] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.6)] backdrop-blur-2xl sm:p-5">
                {error && (
                  <div className="mb-3 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur px-3.5 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-white/70 shrink-0" />
                    <p className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">{error}</p>
                    <button type="button" onClick={() => playerEngine.retry()} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-black hover:bg-neutral-100 shrink-0 active:scale-95 transition-all">
                      <RotateCcw className="h-3 w-3" /> Retry
                    </button>
                    <button type="button" onClick={() => playerEngine.next()} className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white hover:text-black shrink-0 transition-colors">
                      Next
                    </button>
                  </div>
                )}
                {/* progress — redesigned chunky bar */}
                <div className="flex items-center gap-3">
                  <span className="w-10 text-right text-[11px] font-semibold tabular-nums text-white/60">{fmt(progress)}</span>
                  <div className="group/progress relative flex h-7 flex-1 items-center">
                    <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-white/15">
                      <div className="h-full rounded-full bg-gradient-to-r from-white/80 to-white shadow-[0_0_12px_rgba(255,255,255,0.45)] transition-[width] duration-150" style={{ width: `${pct}%` }} />
                    </div>
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 transition-all duration-150 sm:opacity-0 sm:scale-75 sm:group-hover/progress:opacity-100 sm:group-hover/progress:scale-100"
                      style={{ left: `calc(${(seekMax > 0 ? (seekValue / seekMax) * 100 : 0).toFixed(2)}%)` }}
                    >
                      <div className="h-4 w-4 -translate-x-1/2 rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.6)] ring-4 ring-white/20" />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={seekMax}
                      step={1}
                      value={seekValue}
                      onChange={handleSeek}
                      onPointerDown={seekBegin}
                      onPointerUp={seekEnd}
                      onPointerCancel={seekEnd}
                      onTouchStart={seekBegin}
                      onTouchEnd={seekEnd}
                      onBlur={seekEnd}
                      aria-label="Seek"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      style={{ margin: 0 }}
                    />
                  </div>
                  <span className="w-10 text-[11px] font-semibold tabular-nums text-white/60">{fmt(effectiveDuration)}</span>
                </div>

                {/* dock — redesigned 5-cluster */}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => onOpenQueue?.()} className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white backdrop-blur transition-all hover:bg-white hover:text-black active:scale-95" title={`Queue • ${queue.length}${radioActive ? ' • Radio on' : ''}`}>
                      <ListMusic className="h-[18px] w-[18px]" />
                      {queue.length > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-white px-1 text-[10px] font-black text-black ring-2 ring-black/40">{queue.length}</span>}
                      {radioActive && <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-400 text-black ring-2 ring-black/40" title="Radio session active"><Radio className="h-2.5 w-2.5" /></span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => playerStore.toggleShuffle()}
                      aria-pressed={shuffle}
                      title="Shuffle"
                      className={`hidden h-10 w-10 items-center justify-center rounded-full border transition-all active:scale-95 sm:flex ${shuffle ? 'border-white bg-white text-black' : 'border-white/10 bg-white/[0.06] text-white/60 hover:text-white'}`}
                    >
                      <Shuffle className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-all hover:bg-white/10 active:scale-90"
                      title="Previous"
                      aria-label="Previous track"
                    >
                      <SkipBack className="h-5 w-5 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-[0_12px_32px_rgba(255,255,255,0.25)] transition-all hover:scale-105 active:scale-95 sm:h-16 sm:w-16"
                      title={isPlaying ? 'Pause' : 'Play'}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isBuffering
                        ? <Loader2 className="h-6 w-6 animate-spin" />
                        : isPlaying
                          ? <Pause className="h-6 w-6 fill-current" />
                          : <Play className="ml-1 h-6 w-6 fill-current" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-all hover:bg-white/10 active:scale-90"
                      title="Next"
                      aria-label="Next track"
                    >
                      <SkipForward className="h-5 w-5 fill-current" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => playerStore.cycleRepeat()}
                      title={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat queue' : 'Repeat off'}
                      aria-label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat queue' : 'Repeat off'}
                      className={`hidden h-10 w-10 items-center justify-center rounded-full border transition-all active:scale-95 sm:flex ${repeat !== 'off' ? 'border-white bg-white text-black' : 'border-white/10 bg-white/[0.06] text-white/60 hover:text-white'}`}
                    >
                      {repeat === 'one' ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                    </button>
                    <div className="hidden items-center gap-2 lg:flex">
                      <button
                        type="button"
                        onClick={() => playerEngine.toggleMute()}
                        aria-label={muted ? 'Unmute' : 'Mute'}
                        className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition-all hover:bg-white/10 hover:text-white active:scale-90"
                      >
                        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={muted ? 0 : volume}
                        onChange={(e) => playerEngine.setVolume(Number(e.target.value))}
                        aria-label="Volume"
                        className="w-20 accent-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFsLyrics((v) => !v)}
                      className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all active:scale-95 ${showFsLyrics ? 'border-white bg-white text-black shadow-lg' : 'border-white/10 bg-white/[0.08] text-white/75 backdrop-blur hover:bg-white hover:text-black'}`}
                      title={showFsLyrics ? 'Hide lyrics' : 'Show lyrics'}
                    >
                      {showFsLyrics ? <X className="h-[18px] w-[18px]" /> : <Mic2 className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        <StatsPanel isOpen={statsOpen} onClose={() => setStatsOpen(false)} track={track} />
      </Suspense>
    </>
  );
};
