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
import { Track } from '../types';
import { SyncedLine, getLyrics, searchLrcLib } from '../services/ytmusicApi';
import { getSaavnLyrics } from '../services/saavnApi';
import { LyricsView } from './LyricsView';
import { MiniPlayer } from './MiniPlayer';
import { playerStore } from '../services/playerStore';
import { getActiveSession, subscribeRadio } from '../services/radioEngine';
import { settingsStore } from '../services/settingsStore';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import { StatsPanel } from './StatsPanel';
import { AlbumCanvas } from './AlbumCanvas';
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
}

export const PlayerBar: React.FC<Props> = ({ onOpenQueue, onOpenNowPlaying }) => {
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

  const [plainLyrics, setPlainLyrics] = useState<string[] | null>(null);
  const [syncedLyrics, setSyncedLyrics] = useState<SyncedLine[] | null>(null);
  const [lyricsSource, setLyricsSource] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

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

  // Lyrics fetching
  useEffect(() => {
    if (!track?.id) {
      setPlainLyrics(null);
      setSyncedLyrics(null);
      setLyricsSource(null);
      return;
    }
    let cancelled = false;
    setLyricsLoading(true);
    setPlainLyrics(null);
    setSyncedLyrics(null);
    setLyricsSource(null);

    const loadLyrics = async () => {
      // 1. JioSaavn official lyrics
      if (track.source === 'saavn' || track.lyricsId || track.hasLyrics || !/^[a-zA-Z0-9_-]{11}$/.test(track.id)) {
        try {
          const res = await getSaavnLyrics(track.lyricsId || track.id);
          if (!cancelled && res?.lyrics) {
            setPlainLyrics(
              res.lyrics
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
            );
            setLyricsSource('JioSaavn Official');
            setLyricsLoading(false);
            return;
          }
        } catch {}
      }

      // 2. YouTube Music lyrics endpoint ONLY if track.id is a valid 11-character video ID
      if (/^[a-zA-Z0-9_-]{11}$/.test(track.id)) {
        try {
          const res = await getLyrics(track.id);
          if (!cancelled && res && (res.synced?.length || res.plain?.length)) {
            setSyncedLyrics(res.synced);
            setPlainLyrics(res.plain);
            setLyricsSource(res.source || 'YouTube Music');
            setLyricsLoading(false);
            return;
          }
        } catch {}
      }

      // 3. LRCLIB Synced / Plain lyrics search fallback by title & artist
      try {
        const lrc = await searchLrcLib(track.title, track.author, track.durationSeconds);
        if (!cancelled && lrc && (lrc.synced?.length || lrc.plain?.length)) {
          setSyncedLyrics(lrc.synced);
          setPlainLyrics(lrc.plain);
          setLyricsSource(lrc.source || 'LRCLIB');
        }
      } catch {} finally {
        if (!cancelled) setLyricsLoading(false);
      }
    };

    loadLyrics();
    return () => {
      cancelled = true;
    };
  }, [track?.id]);

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
    return (
      <div className="fixed bottom-[calc(112px+env(safe-area-inset-bottom))] sm:bottom-[calc(108px+env(safe-area-inset-bottom))] lg:bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-12px)] sm:w-[calc(100%-24px)] max-w-[560px] lg:max-w-[640px] z-30 liquid-dock rounded-[22px] px-4 sm:px-5 py-3 sm:py-3.5 border border-white/[0.06] shadow-[0_12px_36px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-center gap-2.5 text-xs sm:text-sm text-[#9a9aa0]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 shrink-0">
            <Music2 className="h-3.5 w-3.5" />
          </span>
          <p className="truncate">Select a track to start playing <span className="text-white/30">— Wave Music</span></p>
        </div>
      </div>
    );
  }

  return (
    <>
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
      />

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
              <AlbumCanvas artwork={track.thumbnail} title={track.title} />
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

            {/* Top Bar — background removed */}
            <div className="relative z-20 p-4 sm:p-5">
              <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-3 py-2 rounded-full border border-transparent bg-transparent">
                <button
                  type="button"
                  onClick={() => setFullscreen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 shadow-sm transition-all active:scale-95"
                  title="Close"
                  aria-label="Close fullscreen player"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>

                <div className="flex items-center gap-2">
                  <p className="text-[18px] sm:text-[19px] font-extrabold tracking-[-0.03em] leading-none text-white" style={{ color: '#ffffff' }}>Wave</p>
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

            {/* Center — adaptive layout, scrolls on short screens */}
            <div className="relative z-10 flex-1 min-h-0 w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-4 sm:gap-6 lg:gap-8 px-4 sm:px-6 lg:px-8 pb-4 overflow-y-auto scrollbar-none">
              {/* Art Section */}
              <div className={`flex flex-col items-center justify-center gap-4 sm:gap-5 shrink-0 ${showFsLyrics ? 'lg:w-[44%] lg:py-6' : 'lg:flex-1 py-1 sm:py-2'}`}>
                <div className="relative group">
                  {/* vinyl glow */}
                  <motion.div
                    animate={{ scale: isPlaying ? 1 : 0.97, rotate: isPlaying ? 0 : 0 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className={`relative rounded-[24px] sm:rounded-[28px] overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.75),0_8px_20px_rgba(0,0,0,0.4)] ring-1 ring-white/15 bg-[#0f0f0f] shrink-0 ${showFsLyrics ? 'w-[clamp(140px,44vw,220px)] h-[clamp(140px,44vw,220px)] sm:w-[280px] sm:h-[280px] lg:w-[380px] lg:h-[380px]' : 'w-[clamp(180px,62vw,260px)] h-[clamp(180px,62vw,260px)] sm:w-[340px] sm:h-[340px] lg:w-[380px] lg:h-[380px]'}`}
                  >
                    <img src={track.thumbnail} alt={track.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    {/* inner glass sheen */}
                    <div className="absolute inset-0 rounded-[28px] border border-white/10 pointer-events-none bg-gradient-to-br from-white/[0.07] via-transparent to-transparent" />
                    {/* playing ring */}
                    {isPlaying && <div className="absolute inset-0 rounded-[28px] ring-1 ring-white/20 pointer-events-none animate-pulse" />}
                  </motion.div>
                </div>

                <div className="w-full max-w-[380px] text-center space-y-1.5 sm:space-y-2 px-2">
                  <h2 className="text-[19px] min-[400px]:text-[22px] sm:text-[26px] font-black tracking-[-0.02em] leading-tight text-white line-clamp-2 break-words">{track.title}</h2>
                  <p className="text-[12px] sm:text-[13px] font-medium text-white/70 truncate">{track.author} {track.albumName ? `• ${track.albumName}` : ''}</p>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/70">
                      <Music2 className="h-3 w-3" /> {track.type || 'SONG'}
                    </span>
                    {lyricsSource && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white text-black px-2.5 py-1 text-[11px] font-bold">
                        <Mic2 className="h-3 w-3" /> {lyricsSource}
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
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom — progress + controls dock - background removed */}
            <div className="relative z-10 p-3 sm:p-5 pb-[max(12px,env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-5xl p-2 sm:p-4">
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
                {/* progress — tall hit area, invisible native input over a custom bar */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-mono font-medium text-white/60 w-10 text-right tabular-nums">{fmt(progress)}</span>
                  <div className="flex-1 relative h-6 flex items-center group/progress">
                    <div className="relative h-[5px] w-full rounded-full bg-white/15 overflow-hidden">
                      <div className="h-full bg-white rounded-full transition-[width] duration-150" style={{ width: `${pct}%` }} />
                    </div>
                    {/* visible thumb — appears on hover / while dragging / keyboard focus */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 opacity-0 scale-75 group-hover/progress:opacity-100 group-hover/progress:scale-100 group-focus-within/progress:opacity-100 group-focus-within/progress:scale-100 group-active/progress:opacity-100 group-active/progress:scale-100 transition-all duration-150"
                      style={{ left: `calc(${(seekMax > 0 ? (seekValue / seekMax) * 100 : 0).toFixed(2)}% )` }}
                    >
                      <div className="h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.6)] ring-4 ring-white/10" />
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
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      style={{ margin: 0 }}
                    />
                  </div>
                  <span className="text-xs font-mono font-medium text-white/60 w-10 tabular-nums">{fmt(effectiveDuration)}</span>
                </div>

                {/* dock — queue left, controls centered (stack-safe on narrow screens) */}
                <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                  <div className="flex items-center shrink-0">
                    <button type="button" onClick={() => onOpenQueue?.()} className="h-8 w-8 sm:h-9 sm:w-9 rounded-full flex items-center justify-center bg-white/10 border border-white/10 text-white hover:bg-white hover:text-black backdrop-blur relative" title={`Queue • ${queue.length}${radioActive ? ' • Radio on' : ''}`}>
                      <ListMusic className="h-4 w-4" />
                      {queue.length > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-white text-black text-[10px] font-bold grid place-items-center ring-1 ring-black/10">{queue.length}</span>}
                      {radioActive && <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-white text-black ring-1 ring-black/20" title="Radio session active"><Radio className="h-2.5 w-2.5" /></span>}
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-1 sm:gap-1.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="h-8 w-8 sm:h-9 sm:w-9 rounded-full flex items-center justify-center bg-white/10 border border-white/10 text-white hover:bg-white hover:text-black backdrop-blur transition-all active:scale-95 shrink-0"
                      title="Prev"
                      aria-label="Previous track"
                    >
                      <SkipBack className="h-3.5 w-3.5 sm:h-4 sm:w-4 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-[0_8px_20px_rgba(0,0,0,0.5)] transition-all shrink-0"
                      title={isPlaying ? 'Pause' : 'Play'}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isBuffering
                        ? <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                        : isPlaying
                          ? <Pause className="h-4 w-4 sm:h-5 sm:w-5 fill-current" />
                          : <Play className="h-4 w-4 sm:h-5 sm:w-5 fill-current ml-0.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="h-8 w-8 sm:h-9 sm:w-9 rounded-full flex items-center justify-center bg-white/10 border border-white/10 text-white hover:bg-white hover:text-black backdrop-blur transition-all active:scale-95 shrink-0"
                      title="Next"
                      aria-label="Next track"
                    >
                      <SkipForward className="h-3.5 w-3.5 sm:h-4 sm:w-4 fill-current" />
                    </button>
                  </div>

                  <div className="hidden lg:flex items-center gap-2 shrink-0 mr-1">
                    <button
                      type="button"
                      onClick={() => playerEngine.toggleMute()}
                      aria-label={muted ? 'Unmute' : 'Mute'}
                      title={muted ? 'Unmute' : 'Mute'}
                      className="h-8 w-8 rounded-full flex items-center justify-center text-white/70 hover:bg-white hover:text-black active:scale-90 transition-all"
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
                      className="w-24 accent-white"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowFsLyrics((v) => !v)}
                      className={`h-8 w-8 sm:h-9 sm:w-9 rounded-full flex items-center justify-center border transition-all ${showFsLyrics ? 'bg-white text-black border-white shadow' : 'bg-white/10 border-white/10 text-white/70 hover:bg-white hover:text-black backdrop-blur'}`}
                      title={showFsLyrics ? 'Hide panel' : 'Show lyrics/queue'}
                    >
                      {showFsLyrics ? <X className="h-4 w-4" /> : <Mic2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <StatsPanel isOpen={statsOpen} onClose={() => setStatsOpen(false)} track={track} />
    </>
  );
};
