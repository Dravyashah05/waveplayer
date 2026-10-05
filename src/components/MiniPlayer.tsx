import React, { memo, useState, useEffect } from 'react';
import { motion, PanInfo } from 'motion/react';
import { Heart, Loader2, Pause, Play, SkipBack, SkipForward, ListMusic } from 'lucide-react';
import { Track } from '../types';
import { MarqueeText } from './MarqueeText';
import { ArtworkImage } from './ArtworkImage';
import { settingsStore } from '../services/settingsStore';

interface MiniPlayerProps {
  track: Track;
  isPlaying: boolean;
  isBuffering: boolean;
  progress?: number;
  duration: number;
  isFav: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleFav: () => void;
  onOpenQueue?: () => void;
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = memo(({
  track,
  isPlaying,
  isBuffering,
  progress = 0,
  duration,
  isFav,
  onOpen,
  onToggle,
  onNext,
  onPrev,
  onToggleFav,
  onOpenQueue,
}) => {
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassIntensity(settingsStore.get().glassIntensity);
      setGlassEnabled(settingsStore.get().glassEnabled);
    });
    return () => unsub();
  }, []);

  const safeDuration = duration > 1 ? duration : 180;
  const pct = Math.min(100, Math.max(0, (progress / safeDuration) * 100));

  const blurPx = glassEnabled ? Math.round(18 + (glassIntensity / 100) * 24) : 0;
  const bgAlpha = glassEnabled ? (0.80 + (glassIntensity / 100) * 0.16).toFixed(2) : '0.96';

  const handlePanEnd = (_: unknown, info: PanInfo) => {
    // Swipe Up: Open Now Playing
    if (info.offset.y < -35 || info.velocity.y < -300) {
      onOpen();
      return;
    }
    // Swipe Left: Next Track
    if (info.offset.x < -60 || info.velocity.x < -400) {
      onNext();
      return;
    }
    // Swipe Right: Prev Track
    if (info.offset.x > 60 || info.velocity.x > 400) {
      onPrev();
      return;
    }
  };

  return (
    <motion.div
      className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] lg:bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-14px)] sm:w-[calc(100%-28px)] max-w-[560px] lg:max-w-[640px] z-30 select-none"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onPanEnd={handlePanEnd}
    >
      <div
        role="button"
        tabIndex={0}
        title="Open Now Playing"
        aria-label={`Open player — ${track.title} by ${track.author}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        className="relative flex items-center gap-2 sm:gap-3 p-2 rounded-[24px] border border-white/[0.10] shadow-[0_16px_48px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.12)] cursor-pointer focus-visible:outline-2 focus-visible:outline-white/40 group overflow-hidden"
        style={
          glassEnabled
            ? {
                backgroundColor: `rgba(12,12,15,${bgAlpha})`,
                backdropFilter: `blur(${blurPx}px) saturate(160%)`,
                WebkitBackdropFilter: `blur(${blurPx}px) saturate(160%)`,
              }
            : {
                backgroundColor: 'rgba(14,14,16,0.96)',
              }
        }
      >
        {/* Top Progress Line Indicator */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] bg-white/[0.08]"
          aria-hidden
        >
          <div
            className="h-full bg-white transition-[width] duration-200 ease-linear rounded-r-full shadow-[0_0_8px_rgba(255,255,255,0.5)]"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Artwork */}
        <motion.div
          key={track.id}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative h-12 w-12 sm:h-14 sm:w-14 rounded-[16px] overflow-hidden bg-[#18181b] ring-1 ring-white/10 shrink-0 shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
        >
          <ArtworkImage
            src={track.thumbnail}
            alt={track.title}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            decoding="async"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.14] via-transparent to-transparent" />
        </motion.div>

        {/* Title & Artist */}
        <div className="relative min-w-0 flex-1 pl-0.5">
          <div className="min-w-0">
            <MarqueeText
              text={track.title}
              className="text-[14px] sm:text-[15px] font-bold text-white leading-tight tracking-[-0.01em]"
            />
          </div>
          <p className="truncate text-[12px] sm:text-[13px] font-medium text-white/60 leading-tight mt-0.5">
            {track.author}
            <span className="text-white/30"> • {track.duration || fmt(safeDuration)}</span>
          </p>
        </div>

        {/* Controls Section */}
        <div
          className="relative flex items-center gap-1 sm:gap-1.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Favorite Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFav();
            }}
            aria-label={isFav ? 'Unlike' : 'Like'}
            title={isFav ? 'Liked' : 'Like'}
            className={`touch-target h-9 w-9 rounded-full flex items-center justify-center transition-all active:scale-90 ${
              isFav
                ? 'text-red-400 hover:text-red-300'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
          </button>

          {/* Play / Pause Toggle Button */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.90 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
            className="touch-target-lg h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-white text-black flex items-center justify-center shadow-[0_4px_16px_rgba(255,255,255,0.2)] hover:bg-white/95 transition-transform"
          >
            {isBuffering ? (
              <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-4 w-4 sm:h-5 sm:w-5 fill-current" />
            ) : (
              <Play className="h-4 w-4 sm:h-5 sm:w-5 fill-current ml-0.5" />
            )}
          </motion.button>

          {/* Skip Forward */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            aria-label="Next track"
            title="Next"
            className="touch-target h-9 w-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
          >
            <SkipForward className="h-4 w-4 fill-current" />
          </button>

          {/* Queue Button */}
          {onOpenQueue && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenQueue();
              }}
              aria-label="Open queue"
              title="Queue"
              className="hidden min-[420px]:flex touch-target h-9 w-9 rounded-full items-center justify-center text-white/60 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
            >
              <ListMusic className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
});

MiniPlayer.displayName = 'MiniPlayer';