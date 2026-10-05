import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import { playerStore } from '../services/playerStore';

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface PlayerControlsProps {
  /** Fallback duration when the engine has not loaded metadata yet. */
  durationSeconds?: number;
  /** Accent for the play button + progress fill (e.g. artwork palette). */
  accent?: string;
  /** Prefix for range-input ids so multiple instances never collide. */
  idPrefix?: string;
  /** Extra classes for the wrapping section. */
  className?: string;
}

/**
 * Standalone playback deck: slim progress row + five-way transport
 * (shuffle / prev / play / next / repeat). Subscribes to the player
 * stores itself — drop it on any surface. Volume + speed live with the
 * host layout so every screen places them consistently.
 */
export const PlayerControls: React.FC<PlayerControlsProps> = ({
  durationSeconds,
  accent = '#ffffff',
  idPrefix = 'pc',
  className = '',
}) => {
  const eng = usePlayerEngine();
  const [shuffle, setShuffle] = useState(() => playerStore.shuffle);
  const [repeat, setRepeat] = useState(() => playerStore.repeat);

  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setShuffle(playerStore.shuffle);
      setRepeat(playerStore.repeat);
    });
    return () => {
      unsub();
    };
  }, []);

  const duration = eng.duration > 1 ? eng.duration : durationSeconds && durationSeconds > 0 ? durationSeconds : 180;
  const seekMax = Math.max(1, Math.round(duration));
  const seekValue = Math.min(Math.round(eng.progress), seekMax);
  const repeatLabel = repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat queue' : 'Repeat off';

  return (
    <section aria-label="Playback controls" className={`w-full select-none ${className}`}>
      {/* Progress */}
      <div className="flex items-center gap-3">
        <span className="w-10 shrink-0 text-right text-[10px] font-semibold tabular-nums text-white/50">{fmt(eng.progress)}</span>
        <div className="relative flex h-8 flex-1 items-center">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full transition-[width] duration-150"
              style={{ width: `${seekMax > 0 ? (seekValue / seekMax) * 100 : 0}%`, background: accent }}
            />
          </div>
          <input
            id={`${idPrefix}-seek`}
            type="range"
            min={0}
            max={seekMax}
            value={seekValue}
            onChange={(e) => playerEngine.seek(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            style={{ margin: 0 }}
            aria-label="Seek"
            aria-valuetext={`${fmt(eng.progress)} of ${fmt(duration)}`}
          />
        </div>
        <span className="w-10 shrink-0 text-[10px] font-semibold tabular-nums text-white/50">{fmt(duration)}</span>
      </div>

      {/* Transport */}
      <div className="mt-1 flex w-full items-center justify-between gap-1" role="group" aria-label="Transport">
        <motion.button
          type="button"
          whileTap={{ scale: 0.85 }}
          onClick={() => playerStore.toggleShuffle()}
          aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
          aria-pressed={shuffle}
          title="Shuffle"
          className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${shuffle ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10 hover:text-white'}`}
        >
          <Shuffle className="h-[18px] w-[18px]" />
        </motion.button>
        <div className="flex items-center gap-1 sm:gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.85 }}
            onClick={() => playerEngine.prev()}
            aria-label="Previous track"
            title="Previous (P)"
            className="flex h-12 w-12 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
          >
            <SkipBack className="h-[22px] w-[22px] fill-current" />
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => playerEngine.toggle()}
            aria-label={eng.isPlaying ? 'Pause' : 'Play'}
            title="Play/Pause (Space)"
            className="mx-1 flex h-[60px] w-[60px] items-center justify-center rounded-full text-black transition-transform hover:scale-[1.03]"
            style={{ background: accent }}
          >
            {eng.isBuffering ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={eng.isPlaying ? 'pause' : 'play'}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="grid place-items-center"
                >
                  {eng.isPlaying ? (
                  <Pause className="h-7 w-7 fill-current" />
                  ) : (
                  <Play className="ml-1 h-7 w-7 fill-current" />
                  )}
                </motion.span>
              </AnimatePresence>
            )}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.85 }}
            onClick={() => playerEngine.next()}
            aria-label="Next track"
            title="Next (N)"
            className="flex h-12 w-12 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
          >
            <SkipForward className="h-[22px] w-[22px] fill-current" />
          </motion.button>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.85 }}
          onClick={() => playerStore.cycleRepeat()}
          aria-label={repeatLabel}
          aria-pressed={repeat !== 'off'}
          title={repeatLabel}
          className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-colors ${repeat !== 'off' ? 'bg-white text-black' : 'text-white/55 hover:bg-white/10 hover:text-white'}`}
        >
          {repeat === 'one' ? <Repeat1 className="h-[18px] w-[18px]" /> : <Repeat className="h-[18px] w-[18px]" />}
          {repeat === 'one' && <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black text-[9px] font-black text-white ring-1 ring-white/30">1</span>}
        </motion.button>
      </div>
    </section>
  );
};
