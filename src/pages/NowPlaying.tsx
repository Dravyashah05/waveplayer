import React, { useEffect, useMemo, useState } from 'react';
import { ArtworkImage } from '../components/ArtworkImage';
import { MarqueeText } from '../components/MarqueeText';
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'motion/react';
import {
  ArrowLeft,
  Disc3,
  FolderPlus,
  Heart,
  ListMusic,
  Loader2,
  Maximize,
  Mic2,
  MicVocal,
  Minimize,
  MoreVertical,
  Radio,
  Share2,
  Volume2,
  VolumeX,
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

// Staggered stage entrance — replays per track via key={track.id}.
const stageContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const stageItem: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

const iconBtn =
  'flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-xl transition-colors active:scale-95';
const iconBtnIdle = 'border-white/10 bg-white/[0.07] text-white/90 hover:bg-white hover:text-black';
const iconBtnActive = 'border-white bg-white text-black';

const HeaderBtn: React.FC<{
  label: string;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}> = ({ label, title, onClick, active = false, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={title ?? label}
    aria-pressed={active || undefined}
    className={`${iconBtn} ${active ? iconBtnActive : iconBtnIdle}`}
  >
    {children}
  </button>
);

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

const ArtistCard: React.FC<{ track: Track; onNavigate?: Props['onNavigate'] }> = ({ track, onNavigate }) => {
  const artistId = track.artists?.primary?.find((artist) => artist.name === track.author)?.id
    || track.artists?.primary?.[0]?.id
    || track.author;
  const content = (
    <>
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/15">
        <ArtworkImage src={track.thumbnail} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">Artist</p>
        <p className="truncate text-[13px] font-bold text-white/90">{track.author}</p>
      </div>
      {onNavigate && (
        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2 text-xs font-bold text-white/90 group-hover:bg-white group-hover:text-black">
          View artist
        </span>
      )}
    </>
  );

  return onNavigate ? (
    <button
      type="button"
      onClick={() => onNavigate('artist', artistId)}
      aria-label={`View artist ${track.author}`}
      className="group mt-4 flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/[0.08] px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
    >
      {content}
    </button>
  ) : (
    <div className="mt-4 flex items-center gap-3 px-2 py-2">{content}</div>
  );
};

export const NowPlayingPage: React.FC<Props> = ({ onNavigate, onBack, onOpenQueue }) => {
  const eng = usePlayerEngine();
  const reduceMotion = useReducedMotion();
  const [track, setTrack] = useState<Track | null>(() => playerStore.current());
  const [isFav, setIsFav] = useState(() => (playerStore.current() ? playerStore.isFav(playerStore.current()!.id) : false));
  const [moreOpen, setMoreOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Desktop shows lyrics side-by-side by default; mobile keeps them one tap away.
  const [showLyrics, setShowLyrics] = useState(true);
  const [palette, setPalette] = useState<ArtworkPalette>(DEFAULT_PALETTE);
  const [isFs, setIsFs] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const [fsSupported] = useState(
    () => typeof document !== 'undefined' && typeof document.documentElement?.requestFullscreen === 'function',
  );

  useEffect(() => {
    const onFsChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* unsupported display — stay in normal mode */ }
  };

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

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(eng.playbackRate);
    playerEngine.setPlaybackRate(SPEEDS[(idx + 1) % SPEEDS.length] ?? 1);
  };

  const src = sourceName(track);
  const artistTarget = track.artists?.primary?.find((artist) => artist.name === track.author)?.id
    || track.artists?.primary?.[0]?.id
    || track.author;
  const stageMotion = reduceMotion ? undefined : stageContainer;
  const itemMotion = reduceMotion ? undefined : stageItem;

  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative min-h-[100dvh] overflow-hidden bg-black lg:h-[100dvh]"
    >
      {/* Fullscreen album-art background — viewport-locked so no gap can ever show below the panel */}
      <div className="fixed inset-0 bg-[#0b0b0d]" aria-hidden="true">
        <ArtworkImage
          src={track.thumbnail}
          alt=""
          className="h-full w-full scale-110 object-cover opacity-30 blur-[22px]"
          fetchPriority="high"
          decoding="async"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/90" />
        <div className="absolute inset-0 bg-black/30" />
        {!reduceMotion && (
          <div className="absolute inset-0 overflow-hidden opacity-30" aria-hidden="true">
            <motion.div
              className="absolute -top-28 left-[12%] h-96 w-96 rounded-full blur-3xl"
              style={{ backgroundColor: `${palette.primary}30` }}
              animate={{ x: [0, 48, 0], y: [0, 32, 0] }}
              transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute bottom-[-6rem] right-[8%] h-[26rem] w-[26rem] rounded-full blur-3xl"
              style={{ backgroundColor: `${palette.surface}` }}
              animate={{ x: [0, -56, 0], y: [0, -36, 0] }}
              transition={{ duration: 21, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        )}
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 md:h-[100dvh] md:min-h-0 md:max-w-7xl md:px-8 lg:px-12">
        <header className="flex shrink-0 items-center justify-between gap-3">
          <HeaderBtn label="Go back" onClick={() => (onBack ? onBack() : window.history.back())}>
            <ArrowLeft className="h-5 w-5" />
          </HeaderBtn>
        </header>

        <div className={`mx-auto grid w-full max-w-[560px] flex-1 min-h-0 gap-6 md:gap-5 lg:gap-8 ${showLyrics ? 'md:max-w-none md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : 'md:max-w-[620px] md:grid-cols-[minmax(0,620px)] md:justify-center'}`}>
          <div className="min-w-0 md:flex md:min-h-0 md:flex-col md:justify-center md:gap-3">
            <motion.main
              key={track.id}
              variants={stageMotion}
              initial="hidden"
              animate="show"
              className="relative flex w-full shrink-0 flex-col items-center px-1 py-3 text-center sm:px-4 md:min-h-0 md:flex-1 md:justify-center md:overflow-y-auto md:px-2 md:py-3 lg:px-6"
            >
              <motion.div
                variants={itemMotion}
                className="relative w-[min(68vw,280px)] sm:w-[300px] md:w-[min(30vw,280px)] lg:w-[min(25vw,320px)]"
              >
                <motion.div
                  animate={reduceMotion ? undefined : { scale: eng.isPlaying ? 1 : 0.97 }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="relative aspect-square overflow-hidden rounded-[24px] bg-white/5 ring-1 ring-white/20"
                >
                  <ArtworkImage
                    src={track.thumbnail}
                    alt={`${track.title} artwork`}
                    className="h-full w-full object-cover"
                    fetchPriority="high"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/[0.06]" />
                </motion.div>
              </motion.div>

              <motion.div variants={itemMotion} className="mt-5 w-full max-w-xl text-left">
                <div className="flex w-full items-center gap-3 text-left">
                  <div className="min-w-0 flex-1">
                    <h1 className="min-w-0 max-w-full overflow-hidden whitespace-nowrap text-[25px] font-extrabold leading-tight tracking-[-0.035em] text-white sm:text-[28px] lg:text-[32px]">
                      <MarqueeText
                        text={track.title}
                        className="text-[25px] font-extrabold leading-tight tracking-[-0.035em] text-white sm:text-[28px] lg:text-[32px]"
                      />
                    </h1>
                    <p className="mt-1.5 truncate text-[14px] font-medium text-white/65">{track.author}</p>
                    <div className="mt-2.5 flex min-h-6 flex-wrap items-center gap-2">
                      {track.albumName && (
                        onNavigate && track.albumId ? (
                          <button type="button" onClick={() => onNavigate('album', track.albumId!)} title={`Open album ${track.albumName}`} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-semibold text-white/55 transition-colors hover:border-white/25 hover:text-white">
                            <Disc3 className="h-3 w-3 shrink-0" /> <span className="truncate">{track.albumName}</span>
                          </button>
                        ) : (
                          <span className="inline-flex max-w-full items-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-semibold text-white/55">
                            <Disc3 className="h-3 w-3 shrink-0" /> <span className="truncate">{track.albumName}</span>
                          </span>
                        )
                      )}
                      {src && <span className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-semibold text-white/45">{src}</span>}
                    </div>
                  </div>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.85 }}
                    onClick={toggleFav}
                    aria-label={isFav ? 'Unlike' : 'Like'}
                    aria-pressed={isFav}
                    title={isFav ? 'Liked' : 'Like'}
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors ${isFav ? 'border-white bg-white text-black' : 'border-white/15 bg-white/[0.06] text-white/80 backdrop-blur-xl hover:bg-white/15'}`}
                  >
                    <Heart className={`h-5 w-5 ${isFav ? 'fill-current text-red-500' : ''}`} />
                  </motion.button>
                </div>
                {(meta?.addedBy === 'radio' || meta?.addedBy === 'autoplay') && (
                  <div className="mt-2.5 flex" aria-label="Track provenance">
                    <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black" title={reason || undefined}>
                      {meta.addedBy === 'autoplay' ? 'Autoplay' : 'Radio'}{reason && reason !== 'Radio' ? ` • ${reason}` : ''}
                    </span>
                  </div>
                )}
                <ArtistCard track={track} onNavigate={onNavigate} />
              </motion.div>
            </motion.main>

            <footer className="w-full shrink-0 select-none rounded-[24px] border border-white/[0.09] bg-black/25 px-4 py-4 md:px-4 md:py-4">
              <div className="relative mb-1 flex justify-end">
                <HeaderBtn label="Player options" title="Player options" onClick={() => setMoreOpen((v) => !v)}>
                  <MoreVertical className="h-5 w-5" />
                </HeaderBtn>
                {moreOpen && (
                  <div role="menu" aria-label="Player options" className="absolute right-0 bottom-[calc(100%+8px)] z-30 max-h-[min(70dvh,32rem)] w-56 overflow-y-auto rounded-2xl border border-white/10 bg-[#141416] p-1.5">
                    <MenuRow icon={<ListMusic className="h-4 w-4" />} label="Open queue" onClick={() => { setMoreOpen(false); onOpenQueue?.(); }} />
                    {fsSupported && (
                      <MenuRow
                        icon={isFs ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                        label={isFs ? 'Exit fullscreen' : 'Enter fullscreen'}
                        onClick={() => { setMoreOpen(false); void toggleFullscreen(); }}
                      />
                    )}
                    {(src || onNavigate) && <div className="my-1 h-px bg-white/[0.06]" />}
                    {src && <p className="px-3 py-2 text-[11px] font-semibold text-white/45">Source • {src}</p>}
                    <MenuRow icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => { setMoreOpen(false); void handleShare(); }} />
                    {onNavigate && (
                      <MenuRow icon={<Mic2 className="h-4 w-4" />} label="Open artist" onClick={() => { setMoreOpen(false); onNavigate('artist', artistTarget); }} />
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
              <PlayerControls durationSeconds={track.durationSeconds} accent={palette.primary} idPrefix="np" />

              <div className="mt-3 flex items-center gap-3 border-t border-white/[0.08] pt-3">
                <button
                  type="button"
                  onClick={() => playerEngine.toggleMute()}
                  aria-label={eng.muted ? 'Unmute' : 'Mute'}
                  title={eng.muted ? 'Unmute' : 'Mute'}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white active:scale-90"
                >
                  {eng.muted || eng.volume === 0 ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
                </button>
                <label className="sr-only" htmlFor="np-volume">Volume</label>
                <input
                  id="np-volume"
                  type="range"
                  min={0}
                  max={100}
                  value={eng.muted ? 0 : eng.volume}
                  onChange={(e) => playerEngine.setVolume(Number(e.target.value))}
                  className="min-w-0 flex-1 accent-white"
                  aria-label="Volume"
                />
                <button
                  type="button"
                  onClick={cycleSpeed}
                  aria-label={`Playback speed ${eng.playbackRate}x — tap to change`}
                  title="Tap to cycle playback speed"
                  className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-xs font-bold text-white/80 backdrop-blur transition-colors hover:bg-white/15 active:scale-95"
                >
                  {eng.playbackRate}x
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Track actions">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[12px] font-semibold text-white/75 transition-colors hover:bg-white/10 active:scale-95"
                >
                  <FolderPlus className="h-4 w-4" /> Add
                </button>
                <button
                  type="button"
                  onClick={handleRadio}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[12px] font-semibold text-white/75 transition-colors hover:bg-white/10 active:scale-95"
                >
                  <Radio className="h-4 w-4" /> Radio
                </button>
                <button
                  type="button"
                  onClick={() => setShowLyrics((v) => !v)}
                  aria-expanded={showLyrics}
                  className={`flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-[12px] font-semibold transition-colors active:scale-95 ${showLyrics ? 'border-white bg-white text-black' : 'border-white/10 bg-white/[0.035] text-white/75 hover:bg-white/10'}`}
                >
                  <MicVocal className="h-4 w-4" /> Lyrics
                </button>
              </div>
            </footer>

            {eng.error && (
              <p role="alert" className="mt-3 shrink-0 text-center text-xs font-medium text-amber-300">
                {eng.error} — the engine skips failed tracks automatically; your queue is intact.
              </p>
            )}
          </div>

          {/* Lyrics stay in the reading flow on mobile and fill the right column on wider screens. */}
          <AnimatePresence initial={false}>
            {showLyrics && (
              <motion.aside
                key="np-lyrics"
                initial={reduceMotion ? undefined : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: 12 }}
                transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
                aria-label="Lyrics panel"
                className="flex h-[58dvh] min-h-[360px] min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/[0.08] px-3 py-3 sm:px-5 md:h-full md:min-h-0 md:rounded-[28px] md:px-4 md:py-4 lg:px-6 lg:py-5"
              >
                {lyrics.loading && !lyrics.plain && !lyrics.synced ? (
                  <p className="flex min-h-0 flex-1 items-center gap-2 py-6 text-xs text-white/50" role="status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading lyrics…
                  </p>
                ) : (
                  <div className="min-h-0 flex-1">
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
                  </div>
                )}
              </motion.aside>
            )}
          </AnimatePresence>
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
