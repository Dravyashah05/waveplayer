import React, { useEffect, useState } from 'react';
import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import { playerStore } from '../services/playerStore';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
 * Standalone playback controls: progress seek bar, transport cluster
 * (shuffle / prev / play / next / repeat), status line and desktop
 * volume + speed row. Subscribes to the player stores itself, so any
 * surface (Now Playing page, fullscreen overlay, …) can drop it in.
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
  const [speedOpen, setSpeedOpen] = useState(false);

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
    <section aria-label="Playback controls" className={`w-full ${className}`}>
      {/* Progress — chunky glass bar */}
      <div className="w-full rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="w-10 text-right text-[11px] font-semibold tabular-nums text-white/60">{fmt(eng.progress)}</span>
          <div className="relative flex h-6 flex-1 items-center">
            <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${seekMax > 0 ? (seekValue / seekMax) * 100 : 0}%`, background: accent }} />
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
          <span className="w-10 text-[11px] font-semibold tabular-nums text-white/60">{fmt(duration)}</span>
        </div>
      </div>

      {/* Transport — 5-cluster */}
      <div className="mt-4 flex w-full items-center justify-between gap-2" role="group" aria-label="Transport">
        <button
          type="button"
          onClick={() => playerStore.toggleShuffle()}
          aria-label={shuffle ? 'Shuffle on' : 'Shuffle off'}
          aria-pressed={shuffle}
          title="Shuffle"
          className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all active:scale-95 ${shuffle ? 'border-white bg-white text-black shadow-lg' : 'border-white/10 bg-white/[0.06] text-white/60 hover:text-white'}`}
        >
          <Shuffle className="h-[18px] w-[18px]" />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => playerEngine.prev()}
            aria-label="Previous track"
            title="Previous (P)"
            className="flex h-12 w-12 items-center justify-center rounded-full text-white transition-all hover:bg-white/10 active:scale-90"
          >
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => playerEngine.toggle()}
            aria-label={eng.isPlaying ? 'Pause' : 'Play'}
            title="Play/Pause (Space)"
            className="flex h-16 w-16 items-center justify-center rounded-full text-black shadow-[0_16px_40px_rgba(0,0,0,0.5)] transition-all hover:scale-105 active:scale-95"
            style={{ background: accent }}
          >
            {eng.isBuffering ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : eng.isPlaying ? (
              <Pause className="h-7 w-7 fill-current" />
            ) : (
              <Play className="ml-1 h-7 w-7 fill-current" />
            )}
          </button>
          <button
            type="button"
            onClick={() => playerEngine.next()}
            aria-label="Next track"
            title="Next (N)"
            className="flex h-12 w-12 items-center justify-center rounded-full text-white transition-all hover:bg-white/10 active:scale-90"
          >
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => playerStore.cycleRepeat()}
          aria-label={repeatLabel}
          aria-pressed={repeat !== 'off'}
          title={repeatLabel}
          className={`relative flex h-11 w-11 items-center justify-center rounded-full border transition-all active:scale-95 ${repeat !== 'off' ? 'border-white bg-white text-black shadow-lg' : 'border-white/10 bg-white/[0.06] text-white/60 hover:text-white'}`}
        >
          {repeat === 'one' ? <Repeat1 className="h-[18px] w-[18px]" /> : <Repeat className="h-[18px] w-[18px]" />}
          {repeat === 'one' && <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black text-[9px] font-black text-white ring-1 ring-white/30">1</span>}
        </button>
      </div>
      {/* Volume + speed (desktop inline) */}
      <div className="mt-4 hidden items-center gap-2 md:flex">
        <button
          type="button"
          onClick={() => playerEngine.toggleMute()}
          aria-label={eng.muted ? 'Unmute' : 'Mute'}
          className="touch-target flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white transition-all active:scale-95"
        >
          {eng.muted || eng.volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <label className="sr-only" htmlFor={`${idPrefix}-volume`}>Volume</label>
        <input
          id={`${idPrefix}-volume`}
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
            className="touch-target rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-xs font-bold text-white/80 hover:bg-white/15 transition-all active:scale-95"
          >
            {eng.playbackRate}x
          </button>
          {speedOpen && (
            <div role="menu" aria-label="Playback speed" className="absolute bottom-10 right-0 z-30 w-32 overflow-hidden rounded-2xl border border-white/10 bg-[#141416] p-1.5 shadow-xl backdrop-blur-xl">
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
                  className={`block w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${eng.playbackRate === s ? 'bg-white text-black font-bold' : 'text-white/80 hover:bg-white/10'}`}
                >
                  {s}x{s === 1 ? ' (normal)' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
