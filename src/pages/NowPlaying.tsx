import React, { useEffect, useMemo, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { MarqueeText } from '../components/MarqueeText';
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
  Radio,
  Share2,
  Volume2,
} from 'lucide-react';
import { PlayerControls } from '../components/PlayerControls';
import type { Track } from '../types';
import { playerStore } from '../services/playerStore';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import { settingsStore } from '../services/settingsStore';
import { startRadioAndPlay } from '../services/radioEngine';
import { DEFAULT_PALETTE, extractPalette, type ArtworkPalette } from '../services/artworkPalette';
import { radioReason } from '../services/queueMeta';
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [palette, setPalette] = useState<ArtworkPalette>(DEFAULT_PALETTE);

  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      const cur = playerStore.current();
      setTrack(cur);
      setIsFav(cur ? playerStore.isFav(cur.id) : false);
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
  const reason = radioReason(meta);

  const duration = eng.duration > 1 ? eng.duration : track?.durationSeconds && track.durationSeconds > 0 ? track.durationSeconds : 180;

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

  const src = sourceName(track);

  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative min-h-[100dvh] overflow-hidden"
    >
      {/* Fullscreen album-art background — blurred + darkened so content stays legible */}
      <div className="absolute inset-0 bg-[#0b0b0d]" aria-hidden="true">
        <ArtworkImage
          src={track.thumbnail}
          alt=""
          className="h-full w-full scale-105 object-cover blur-[3px]"
          fetchPriority="high"
          decoding="async"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/90" />
        <div className="absolute inset-0 bg-black/30" />
      </div>
      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">

      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => (onBack ? onBack() : window.history.back())}
          aria-label="Go back"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-white/90 backdrop-blur-xl transition-all hover:bg-white hover:text-black active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <p className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden /> Now Playing
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenQueue}
            aria-label="Open queue"
            title="Open queue"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-white/90 backdrop-blur-xl transition-all hover:bg-white hover:text-black active:scale-95"
          >
            <ListMusic className="h-5 w-5" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="More track actions"
              aria-expanded={moreOpen}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-white/90 backdrop-blur-xl transition-all hover:bg-white hover:text-black active:scale-95"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {moreOpen && (
              <div role="menu" aria-label="More actions" className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#141416] p-1.5 shadow-xl">
                {src && (
                  <>
                    <p className="px-3 py-2 text-[11px] font-semibold text-white/45">Source • {src}</p>
                    <div className="mx-1 mb-1 h-px bg-white/[0.06]" />
                  </>
                )}
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
      </header>

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center py-6 text-center">
        <motion.div
          animate={reduceMotion ? undefined : { scale: eng.isPlaying ? 1 : 0.96 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-[min(64vw,300px)] sm:w-[320px]"
        >
          <div aria-hidden="true" className="absolute -inset-4 overflow-hidden rounded-[36px] opacity-45 blur-2xl">
            <ArtworkImage src={track.thumbnail} alt="" className="h-full w-full scale-110 object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="relative aspect-square overflow-hidden rounded-[28px] bg-white/5 shadow-[0_32px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/20">
            <ArtworkImage
              src={track.thumbnail}
              alt={`${track.title} artwork`}
              className="h-full w-full object-cover"
              fetchPriority="high"
              decoding="async"
              referrerPolicy="no-referrer"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/[0.06]" />
          </div>
        </motion.div>

        <div className="mt-5 w-full [text-shadow:0_2px_18px_rgba(0,0,0,0.9)]">
          <h1 className="mx-auto min-w-0 max-w-full overflow-hidden whitespace-nowrap text-[24px] font-black leading-[1.05] tracking-[-0.03em] text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.9)] sm:text-[28px]">
            <MarqueeText
              text={track.title}
              className="text-[24px] font-black leading-[1.05] tracking-[-0.03em] text-white sm:text-[28px]"
            />
          </h1>
          <p className="mt-1.5 truncate text-[14px] font-semibold text-white/85 drop-shadow-[0_1px_10px_rgba(0,0,0,0.9)]">
            {track.author}
            {track.albumName ? ` — ${track.albumName}` : ''}
          </p>
          {(meta?.addedBy === 'radio' || meta?.addedBy === 'autoplay') && (
            <div className="mt-2.5 flex justify-center" aria-label="Track provenance">
              <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black" title={reason || undefined}>
                {meta.addedBy === 'autoplay' ? 'Autoplay' : 'Radio'}{reason && reason !== 'Radio' ? ` • ${reason}` : ''}
              </span>
            </div>
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-[560px]">
        <div className="rounded-[24px] border border-white/10 bg-black/30 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-5">
          <PlayerControls durationSeconds={track.durationSeconds} accent={palette.primary} idPrefix="np" />
        </div>

        <div className="mt-2 grid grid-cols-4 gap-2" role="group" aria-label="Track actions">
          <button
            type="button"
            onClick={toggleFav}
            aria-label={isFav ? 'Unlike' : 'Like'}
            aria-pressed={isFav}
            className={`flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${isFav ? 'border-white bg-white text-black shadow-lg' : 'border-white/10 bg-white/[0.06] text-white/75 backdrop-blur hover:bg-white/10'}`}
          >
            <Heart className={`h-5 w-5 ${isFav ? 'fill-current text-red-500' : ''}`} /> Like
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.06] py-2.5 text-[10px] font-bold uppercase tracking-wider text-white/75 backdrop-blur transition-all hover:bg-white/10 active:scale-95"
          >
            <FolderPlus className="h-5 w-5" /> Add
          </button>
          <button
            type="button"
            onClick={handleRadio}
            className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.06] py-2.5 text-[10px] font-bold uppercase tracking-wider text-white/75 backdrop-blur transition-all hover:bg-white/10 active:scale-95"
          >
            <Radio className="h-5 w-5" /> Radio
          </button>
          <button
            type="button"
            onClick={() => setShowLyrics((v) => !v)}
            aria-expanded={showLyrics}
            className={`flex flex-col items-center gap-1 rounded-2xl border py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${showLyrics ? 'border-white bg-white text-black shadow-lg' : 'border-white/10 bg-white/[0.06] text-white/75 backdrop-blur hover:bg-white/10'}`}
          >
            <MicVocal className="h-5 w-5" /> Lyrics
          </button>
        </div>

        {showLyrics ? (
          <div className="mt-2 max-h-[460px] overflow-y-auto rounded-[24px] border border-white/10 bg-black/40 p-5 shadow-[0_16px_48px_rgba(0,0,0,0.4)] backdrop-blur-xl">
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
        ) : null}

        {eng.error && (
          <p role="alert" className="mt-3 text-center text-xs font-medium text-amber-300">
            {eng.error} — the engine skips failed tracks automatically; your queue is intact.
          </p>
        )}
      </footer>
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
