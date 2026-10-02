import React, { useEffect, useMemo, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ChevronDown,
  Disc3,
  FolderPlus,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  MicVocal,
  MoreVertical,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Track } from '../types';
import { playerStore } from '../services/playerStore';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import { settingsStore } from '../services/settingsStore';
import { startRadioAndPlay } from '../services/radioEngine';
import { DEFAULT_PALETTE, extractPalette, type ArtworkPalette } from '../services/artworkPalette';
import { describeSource, radioReason } from '../services/queueMeta';
import { useLyrics } from '../hooks/useLyrics';
import { LyricsView } from '../components/LyricsView';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { toast } from '../components/Toast';

interface Props {
  onNavigate?: (page: string, param?: string) => void;
  onBack?: () => void;
  onOpenQueue?: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function sourceName(t: Track): string | null {
  if (t.source === 'saavn') return 'JioSaavn';
  if (t.source === 'ytmusic') return 'YouTube Music';
  if (t.source === 'youtube') return 'YouTube';
  if (t.source === 'local') return 'Local file';
  if (t.source === 'custom') return 'Custom URL';
  return null;
}

export const NowPlayingPage: React.FC<Props> = ({ onNavigate, onBack, onOpenQueue }) => {
  const eng = usePlayerEngine();
  const reduceMotion = useReducedMotion();
  const [track, setTrack] = useState<Track | null>(() => playerStore.current());
  const [isFav, setIsFav] = useState(() => (playerStore.current() ? playerStore.isFav(playerStore.current()!.id) : false));
  const [shuffle, setShuffle] = useState(() => playerStore.shuffle);
  const [repeat, setRepeat] = useState(() => playerStore.repeat);
  const [moreOpen, setMoreOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [palette, setPalette] = useState<ArtworkPalette>(DEFAULT_PALETTE);

  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      const cur = playerStore.current();
      setTrack(cur);
      setIsFav(cur ? playerStore.isFav(cur.id) : false);
      setShuffle(playerStore.shuffle);
      setRepeat(playerStore.repeat);
    });
    return () => {
      unsub();
    };
  }, []);

  // Artwork-reactive theme (cached, lazy, never blocks playback).
  useEffect(() => {
    let cancelled = false;
    if (!settingsStore.get().dynamicColors || !track?.thumbnail) {
      setPalette(DEFAULT_PALETTE);
      return;
    }
    extractPalette(track.thumbnail).then((p) => {
      if (!cancelled) setPalette(p);
    }).catch(() => {
      if (!cancelled) setPalette(DEFAULT_PALETTE);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.thumbnail]);

  const lyrics = useLyrics(track);

  const meta = useMemo(() => {
    const idx = playerStore.currentIndex();
    return idx >= 0 ? playerStore.metaForIndex(idx) : null;
  }, [track?.id]);
  const provenance = describeSource(meta);
  const reason = radioReason(meta);

  const duration = eng.duration > 1 ? eng.duration : track?.durationSeconds && track.durationSeconds > 0 ? track.durationSeconds : 180;
  const seekMax = Math.max(1, Math.round(duration));
  const seekValue = Math.min(Math.round(eng.progress), seekMax);

  if (!track) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[15px] font-bold text-white">Nothing playing yet</p>
        <p className="max-w-[36ch] text-xs text-white/50">Pick a song and it will show up here with lyrics, queue and controls.</p>
        <button type="button" onClick={() => (onBack ? onBack() : window.history.back())} className="rounded-full bg-white px-5 py-2 text-xs font-bold text-black">
          Go back
        </button>
      </div>
    );
  }

  const toggleFav = () => setIsFav(playerStore.toggleFav(track));

  const handleShare = async () => {
    const text = `Listening to “${track.title}” by ${track.author}${track.albumName ? ` from ${track.albumName}` : ''} on Wave Music`;
    try {
      if (navigator.share) {
        await navigator.share({ title: track.title, text, url: window.location.href });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
      toast.success('Link copied to clipboard');
    } catch { /* dismissed — never an error */ }
  };

  const handleRadio = async () => {
    toast.info(`Starting radio for “${track.title}”…`);
    try {
      await startRadioAndPlay('track', { track });
    } catch {
      playerStore.setQueue([track], 0);
    }
  };

  const repeatLabel = repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat queue' : 'Repeat off';
  const src = sourceName(track);

  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[28px] border border-white/10 p-5 sm:p-8"
      style={{ background: `linear-gradient(160deg, ${palette.surface}, rgba(0,0,0,0.6) 70%)` }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true" style={{ background: `radial-gradient(60% 45% at 20% 0%, ${palette.surface}, transparent)` }} />

      <div className="relative mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : window.history.back())}
          aria-label="Go back"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/[0.14]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">Now playing</p>
        <button
          type="button"
          onClick={onOpenQueue}
          aria-label="Open queue"
          title="Open queue"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/[0.14]"
        >
          <ListMusic className="h-3.5 w-3.5" /> Queue
        </button>
      </div>

      <div className="relative grid gap-6 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:gap-8">
        {/* Artwork + core controls */}
        <div>
          <div className="mx-auto aspect-square w-full max-w-[380px] overflow-hidden rounded-[24px] bg-[#161619] shadow-[0_24px_64px_rgba(0,0,0,0.6)] ring-1 ring-white/15">
            <ArtworkImage
              src={track.thumbnail}
              alt={`${track.title} artwork`}
              className="h-full w-full object-cover"
              fetchPriority="high"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          </div>

          <div className="mt-4 text-center md:text-left">
            <h1 className="text-[22px] font-black leading-tight tracking-[-0.02em] text-white">{track.title}</h1>
            <p className="mt-1 truncate text-[14px] font-medium text-white/60">
              {track.author}
              {track.albumName ? ` • ${track.albumName}` : ''}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px] md:justify-start" aria-label="Track provenance">
              {src && (
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 font-semibold text-white/60">{src}</span>
              )}
              {provenance && (
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 font-semibold text-white/60">{provenance}</span>
              )}
              {(meta?.addedBy === 'radio' || meta?.addedBy === 'autoplay') && (
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 font-bold text-white/70" title={reason || undefined}>
                  {meta.addedBy === 'autoplay' ? 'Autoplay' : 'Radio'}{reason && reason !== 'Radio' ? ` • ${reason}` : ''}
                </span>
              )}
            </p>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <label className="sr-only" htmlFor="np-seek">Seek</label>
            <input
              id="np-seek"
              type="range"
              min={0}
              max={seekMax}
              value={seekValue}
              onChange={(e) => playerEngine.seek(Number(e.target.value))}
              className="w-full accent-white"
              aria-valuetext={`${fmt(eng.progress)} of ${fmt(duration)}`}
            />
            <div className="mt-1 flex justify-between text-[11px] font-medium tabular-nums text-white/45">
              <span>{fmt(eng.progress)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          {/* Transport */}
          <div className="mt-2 flex items-center justify-center gap-2" role="group" aria-label="Playback controls">
            <button
              type="button"
              onClick={() => playerStore.toggleShuffle()}
              aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
              aria-pressed={shuffle}
              title="Shuffle"
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${shuffle ? 'bg-white text-black' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => playerEngine.prev()}
              aria-label="Previous track"
              title="Previous (P)"
              className="flex h-12 w-12 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <SkipBack className="h-5 w-5 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => playerEngine.toggle()}
              aria-label={eng.isPlaying ? 'Pause' : 'Play'}
              title="Play/Pause (Space)"
              className="flex h-14 w-14 items-center justify-center rounded-full text-black shadow-lg"
              style={{ background: palette.primary }}
            >
              {eng.isBuffering ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : eng.isPlaying ? (
                <Pause className="h-6 w-6 fill-current" />
              ) : (
                <Play className="ml-0.5 h-6 w-6 fill-current" />
              )}
            </button>
            <button
              type="button"
              onClick={() => playerEngine.next()}
              aria-label="Next track"
              title="Next (N)"
              className="flex h-12 w-12 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <SkipForward className="h-5 w-5 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => playerStore.cycleRepeat()}
              aria-label={repeatLabel}
              aria-pressed={repeat !== 'off'}
              title={repeatLabel}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${repeat !== 'off' ? 'bg-white text-black' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
            >
              {repeat === 'one' ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-center text-[11px] font-medium text-white/35" role="status">
            {shuffle ? 'Shuffle on • ' : ''}{repeatLabel}
            {eng.playbackRate !== 1 ? ` • ${eng.playbackRate}x` : ''}
          </p>

          {/* Volume + speed (desktop inline; mobile keeps volume in overflow) */}
          <div className="mt-3 hidden items-center gap-2 md:flex">
            <button
              type="button"
              onClick={() => playerEngine.toggleMute()}
              aria-label={eng.muted ? 'Unmute' : 'Mute'}
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              {eng.muted || eng.volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <label className="sr-only" htmlFor="np-volume">Volume</label>
            <input
              id="np-volume"
              type="range"
              min={0}
              max={100}
              value={eng.muted ? 0 : eng.volume}
              onChange={(e) => playerEngine.setVolume(Number(e.target.value))}
              className="w-32 accent-white"
            />
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setSpeedOpen((v) => !v)}
                aria-label={`Playback speed ${eng.playbackRate}x`}
                aria-expanded={speedOpen}
                className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/15"
              >
                {eng.playbackRate}x
              </button>
              {speedOpen && (
                <div role="menu" aria-label="Playback speed" className="absolute bottom-10 right-0 z-30 w-32 overflow-hidden rounded-2xl border border-white/10 bg-[#141416] p-1.5 shadow-xl">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={eng.playbackRate === s}
                      onClick={() => {
                        playerEngine.setPlaybackRate(s);
                        setSpeedOpen(false);
                      }}
                      className={`block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold ${eng.playbackRate === s ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10'}`}
                    >
                      {s}x{s === 1 ? ' (normal)' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions + lyrics */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Track actions">
            <button
              type="button"
              onClick={toggleFav}
              aria-label={isFav ? 'Unlike' : 'Like'}
              aria-pressed={isFav}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors ${isFav ? 'bg-white text-black' : 'border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/15'}`}
            >
              <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-current' : ''}`} /> {isFav ? 'Liked' : 'Like'}
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/15"
            >
              <FolderPlus className="h-3.5 w-3.5" /> Add to Playlist
            </button>
            <button
              type="button"
              onClick={handleRadio}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/15"
            >
              <Radio className="h-3.5 w-3.5" /> Start Radio
            </button>
            <button
              type="button"
              onClick={() => setShowLyrics((v) => !v)}
              aria-expanded={showLyrics}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${showLyrics ? 'bg-white text-black' : 'border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/15'}`}
            >
              <MicVocal className="h-3.5 w-3.5" /> Lyrics
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="More track actions"
                aria-expanded={moreOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/15"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {moreOpen && (
                <div role="menu" aria-label="More actions" className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#141416] p-1.5 shadow-xl">
                  <MenuRow icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => { setMoreOpen(false); void handleShare(); }} />
                  {onNavigate && (
                    <MenuRow icon={<Mic2 className="h-4 w-4" />} label="Open artist" onClick={() => { setMoreOpen(false); onNavigate('artist', track.author); }} />
                  )}
                  {onNavigate && track.albumId && (
                    <MenuRow icon={<Disc3 className="h-4 w-4" />} label="Open album" onClick={() => { setMoreOpen(false); onNavigate('album', track.albumId!); }} />
                  )}
                  <div className="my-1 h-px bg-white/[0.06]" />
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/35">Speed (audio only)</p>
                  <div className="grid grid-cols-3 gap-1 px-1.5 pb-1.5">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          playerEngine.setPlaybackRate(s);
                          setMoreOpen(false);
                        }}
                        aria-pressed={eng.playbackRate === s}
                        className={`rounded-lg px-2 py-1.5 text-xs font-bold ${eng.playbackRate === s ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/15'}`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 md:hidden">
                    <Volume2 className="h-4 w-4 shrink-0 text-white/60" />
                    <label className="sr-only" htmlFor="np-volume-m">Volume</label>
                    <input
                      id="np-volume-m"
                      type="range"
                      min={0}
                      max={100}
                      value={eng.muted ? 0 : eng.volume}
                      onChange={(e) => playerEngine.setVolume(Number(e.target.value))}
                      className="w-full accent-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Lyrics panel (existing LyricsView — no duplicate fetching) */}
          {showLyrics ? (
            <div className="mt-4 max-h-[420px] overflow-y-auto rounded-[20px] border border-white/10 bg-black/30 p-4">
              {lyrics.loading && !lyrics.plain && !lyrics.synced ? (
                <p className="flex items-center gap-2 text-xs text-white/50" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading lyrics…
                </p>
              ) : (
                <LyricsView
                  synced={lyrics.synced}
                  plain={lyrics.plain}
                  isPlaying={eng.isPlaying}
                  source={lyrics.source}
                  loading={lyrics.loading}
                  progress={eng.progress}
                  duration={duration}
                  onSeek={(s) => playerEngine.seek(s)}
                  title={track.title}
                  artist={track.author}
                  trackId={track.id}
                />
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] p-4 text-xs leading-relaxed text-white/40">
              Lyrics, Up Next suggestions and the full queue stay one tap away — open Lyrics for the synced
              view or Queue to manage what plays next. Playback continues uninterrupted.
            </div>
          )}

          {eng.error && (
            <p role="alert" className="mt-3 text-xs font-medium text-amber-300">
              {eng.error} — the engine skips failed tracks automatically; your queue is intact.
            </p>
          )}
        </div>
      </div>

      <AddToPlaylistModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        tracks={[track]}
        onSuccess={(name) => toast.success(`Added to “${name}”`)}
      />
    </motion.div>
  );
};

const MenuRow: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({ icon, label, onClick }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black"
  >
    <span className="shrink-0">{icon}</span>
    {label}
  </button>
);
