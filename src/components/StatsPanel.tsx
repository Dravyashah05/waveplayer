import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Activity } from 'lucide-react';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import type { Track } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">{label}</span>
      <span className="truncate text-right font-mono text-xs text-white/90">{value || 'Unknown'}</span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return 'Unknown';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Reusable diagnostics view. It observes the engine; it never creates an audio element. */
export const StatsForNerds: React.FC<Props> = ({ isOpen, onClose, track }) => {
  usePlayerEngine();
  const [, refreshNetwork] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const connection = (navigator as any)?.connection;
    const update = () => refreshNetwork((n) => n + 1);
    connection?.addEventListener?.('change', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      connection?.removeEventListener?.('change', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const stats = playerEngine.getStats();
  const buffered = typeof stats.bufferedSeconds === 'number' && Number.isFinite(stats.bufferedSeconds)
    ? `${stats.bufferedSeconds.toFixed(1)}s`
    : 'Unknown';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
        <motion.section
          initial={{ opacity: 0, y: 20, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.99 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[82dvh] w-full overflow-hidden rounded-t-[26px] border border-white/10 bg-[#121214]/95 shadow-2xl backdrop-blur-2xl sm:max-w-md sm:rounded-[24px]"
          role="dialog"
          aria-modal="true"
          aria-label="Stats for Nerds"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
          <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"><Activity className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold tracking-tight text-white">Stats for Nerds</h2>
                <p className="truncate text-[11px] font-medium text-white/50">{track ? `${track.title} — ${track.author}` : 'No track'}</p>
              </div>
            </div>
            <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/15 hover:text-white" aria-label="Close stats">
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="max-h-[calc(82dvh-80px)] overflow-y-auto px-5 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] scrollbar-none">
            <Row label="Source" value={stats.source} />
            <Row label="Codec" value={stats.codec} />
            <Row label="Bitrate" value={stats.bitrate} />
            <Row label="Sample rate" value={stats.sampleRate} />
            <Row label="Bit depth" value={stats.bitDepth} />
            <Row label="Channels" value={stats.channels} />
            <Row label="Container" value={stats.container} />
            <Row label="Duration" value={formatDuration(stats.duration)} />
            <Row label="Buffer" value={buffered} />
            <Row label="Network" value={stats.networkType} />
            <Row label="Playback state" value={stats.playbackState} />
            {stats.isLossless !== null && <Row label="Audio type" value={stats.isLossless ? 'Lossless' : 'Lossy'} />}
          </div>
        </motion.section>
      </div>
    </AnimatePresence>
  );
};

export const StatsPanel = StatsForNerds;
