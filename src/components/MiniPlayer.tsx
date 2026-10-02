import { memo } from 'react';
import { motion } from 'motion/react';
import { Heart, Loader2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Track } from '../types';
import { MarqueeText } from './MarqueeText';
import { ArtworkImage } from './ArtworkImage';

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
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * MiniPlayer — iOS 26 "Liquid Glass" floating dock.
 *
 * Glass recipe: deep blur + saturation boost, specular top-edge highlight,
 * diagonal light sheen, inset edge refraction and a soft ambient shadow so
 * the pill floats above content. Concentric squircles (26px shell → 17px
 * artwork → full-round controls). Tap anywhere opens fullscreen; transport
 * buttons stop propagation so they never trigger open.
 */
/**
 * Memoized: PlayerBar re-renders ~4Hz on engine progress ticks. Stable
 * callbacks (see PlayerBar useCallbacks) keep this cheap — only track,
 * transport state, progress and fav changes re-render the dock.
 */
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
}) => {
  const safeDuration = duration > 1 ? duration : 180;
  const pct = Math.min(100, Math.max(0, (progress / safeDuration) * 100));

  return (
    <motion.div
      className="fixed bottom-[calc(112px+env(safe-area-inset-bottom))] sm:bottom-[calc(108px+env(safe-area-inset-bottom))] lg:bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-12px)] sm:w-[calc(100%-24px)] max-w-[560px] lg:max-w-[620px] z-40"
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        role="button"
        tabIndex={0}
        title="Open player"
        aria-label={`Open player — ${track.title} by ${track.author}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
        }}
        className="relative flex items-center gap-2 sm:gap-2.5 pl-2 pr-2 sm:pl-2.5 sm:pr-2.5 pt-2 pb-2 rounded-[26px] border border-white/10 overflow-hidden min-h-[64px] cursor-pointer focus-visible:outline-2 focus-visible:outline-white/40"
        style={{
          backgroundColor: '#0c0c0c',
          boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
        }}
      >
        {/* Artwork */}
        <motion.div
          key={track.id}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={`relative h-11 w-11 sm:h-12 sm:w-12 overflow-hidden bg-[#1a1a1a] ring-1 shrink-0 shadow-[0_8px_24px_rgba(0,0,0,0.6)] rounded-[17px] ring-white/15`}
        >
          <ArtworkImage src={track.thumbnail} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" decoding="async" draggable={false} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.18] via-transparent to-transparent" />
        </motion.div>

        {/* Title / artist */}
        <div className="relative min-w-0 flex-1">
          <div className="min-w-0">
            <MarqueeText
              text={track.title}
              className="text-[13px] sm:text-sm font-semibold text-white leading-tight tracking-[-0.01em]"
            />
          </div>
          <p className="truncate text-[11px] sm:text-xs font-medium text-white/60 leading-tight mt-[2px]">
            {track.author}
            <span className="text-white/30"> • {track.duration || fmt(safeDuration)}</span>
          </p>
        </div>

        {/* Like (compact+) */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
          aria-label={isFav ? 'Unlike' : 'Like'}
          title={isFav ? 'Liked' : 'Like'}
          className={`relative hidden min-[420px]:flex h-8 w-8 items-center justify-center rounded-full border shrink-0 transition-all active:scale-90 ${isFav ? 'bg-white text-black border-white' : 'bg-white/[0.08] border-white/15 text-white/60 hover:bg-white hover:text-black hover:border-white'}`}
        >
          <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-current' : ''}`} />
        </button>

        {/* Transport */}
        <div className="relative flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous"
            title="Previous"
            className="hidden min-[360px]:flex h-8 w-8 sm:h-9 sm:w-9 rounded-full items-center justify-center text-white/85 hover:bg-white/15 active:scale-90 transition-all"
          >
            <SkipBack className="h-4 w-4 fill-current" />
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.88 }}
            onClick={onToggle}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
            className="h-11 w-11 rounded-full bg-white text-black flex items-center justify-center ring-1 ring-white/20 shadow-[0_8px_20px_rgba(0,0,0,0.5)]"
          >
            <motion.span
              key={isBuffering ? 'loading' : isPlaying ? 'pause' : 'play'}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.16 }}
              className="flex items-center justify-center"
            >
              {isBuffering
                ? <Loader2 className="h-[18px] w-[18px] animate-spin" />
                : isPlaying
                  ? <Pause className="h-[18px] w-[18px] fill-current" />
                  : <Play className="h-[18px] w-[18px] fill-current ml-0.5" />}
            </motion.span>
          </motion.button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next"
            title="Next"
            className="flex h-8 w-8 sm:h-9 sm:w-9 rounded-full items-center justify-center text-white/85 hover:bg-white/15 active:scale-90 transition-all"
          >
            <SkipForward className="h-4 w-4 fill-current" />
          </button>
        </div>

        {/* Progress — thin bar so mobile users see position without opening */}
        <div className="pointer-events-none absolute inset-x-4 bottom-1 h-[3px] overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-white/80" style={{ width: `${pct}%` }} />
        </div>

      </div>
    </motion.div>
  );
});

MiniPlayer.displayName = 'MiniPlayer';
