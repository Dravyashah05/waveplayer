import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Activity } from 'lucide-react';
import { playerEngine } from '../services/playerEngine';
import type { Track } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">{k}</span>
      <span className="truncate font-mono text-xs text-white/90">{v}</span>
    </div>
  );
}

/** Stats for Nerds — every value comes from resolved stream metadata or the
 *  live element. Anything unknowable renders as Unknown; nothing is faked. */
export const StatsPanel: React.FC<Props> = ({ isOpen, onClose, track }) => {
  const [, force] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [isOpen]);
  if (!isOpen) return null;

  const s = playerEngine.getStats();
  const conn = (navigator as any)?.connection;
  const net = conn
    ? `${conn.effectiveType || 'unknown'}${conn.saveData ? ' • save-data' : ''}${conn.downlink ? ` • ${conn.downlink} Mb/s` : ''}`
    : 'Unknown';
  const buffer = (() => {
    try {
      const el = (playerEngine as any)?.audio as HTMLAudioElement | null;
      const buf = el?.buffered;
      if (buf && buf.length) {
        const ahead = Math.max(0, buf.end(buf.length - 1) - (el?.currentTime || 0));
        return `${ahead.toFixed(1)}s buffered`;
      }
    } catch {}
    return s.backend === 'youtube' ? 'player-managed' : 'Unknown';
  })();

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm overflow-hidden rounded-[24px] border border-white/10 bg-[#121214]/95 shadow-2xl backdrop-blur-2xl"
          role="dialog"
          aria-modal="true"
          aria-label="Stats for nerds"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                <Activity className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-[15px] font-bold tracking-tight text-white">Stats for Nerds</h3>
                <p className="truncate text-[11px] font-medium text-white/50">{track ? `${track.title} — ${track.author}` : 'No track'}</p>
              </div>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/15 hover:text-white" aria-label="Close stats">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-3 scrollbar-none">
            <Row k="Source" v={s.source} />
            <Row k="Backend" v={s.backend} />
            <Row k="Codec" v={s.codec} />
            <Row k="Bitrate" v={s.bitrate} />
            <Row k="Sample rate" v={s.sampleRate} />
            <Row k="Bit depth" v={s.bitDepth} />
            <Row k="Channels" v={s.channels} />
            <Row k="Container" v={s.container} />
            <Row k="Host" v={s.host} />
            <Row k="Buffer" v={buffer} />
            <Row k="Network" v={net} />
            <Row k="Playback" v={`${s.progress.toFixed(1)}s / ${s.duration.toFixed(1)}s`} />
            {typeof s.expiresAt === 'number' && <Row k="Stream expiry" v={new Date(s.expiresAt).toLocaleTimeString()} />}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
