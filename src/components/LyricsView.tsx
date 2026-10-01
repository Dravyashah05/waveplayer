import { useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Mic2, Loader2 } from 'lucide-react';
import { SyncedLine } from '../services/ytmusicApi';

interface Props {
  synced: SyncedLine[] | null;
  plain: string[] | null;
  currentIndex: number;
  isPlaying: boolean;
  source: string | null;
  loading: boolean;
  progress: number;
  duration: number;
  onSeek: (index: number) => void;
  artwork?: string;
  title?: string;
  artist?: string;
  onClose?: () => void;
}

export const LyricsView: React.FC<Props> = ({ synced, plain, currentIndex, isPlaying, loading, onSeek }) => {
  const lines = synced ? synced.map((s) => s.text) : plain || [];
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const isSynced = !!synced?.length;

  useEffect(() => {
    if (currentIndex >= 0 && lineRefs.current[currentIndex]) {
      lineRefs.current[currentIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentIndex]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col h-full min-h-0">
        <div className="flex-1 flex flex-col justify-center px-2 sm:px-4 py-10 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[22px] sm:h-[26px] rounded-full bg-white/[0.06] animate-pulse"
              style={{ width: `${42 + (i % 4) * 14}%`, opacity: 1 - i * 0.08 }}
            />
          ))}
          <p className="text-[11px] tracking-widest uppercase text-white/35 flex items-center gap-2 mt-6">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading lyrics
          </p>
        </div>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="flex flex-1 flex-col h-full min-h-0 items-center justify-center px-6 py-20 text-center">
        <div className="h-14 w-14 rounded-full bg-white/[0.06] border border-white/[0.06] flex items-center justify-center">
          <Mic2 className="h-6 w-6 text-white/30" />
        </div>
        <p className="mt-4 text-[15px] font-semibold text-white">No lyrics found</p>
        <p className="mt-1.5 text-xs text-white/40 max-w-[260px] leading-relaxed">
          We couldn’t find synced lyrics for this track. Try another song.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-1 flex-col h-full min-h-0 relative">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none scroll-smooth">
        <div className="px-2 sm:px-4 lg:px-6 py-8">
          {currentIndex === -1 && (
            <p className="text-center text-[12px] tracking-widest uppercase text-white/25 py-8 font-medium">
              {isSynced ? 'Intro — tap any line to jump' : 'Plain lyrics'}
            </p>
          )}

          {lines.map((line, i) => {
            const isActive = i === currentIndex;
            const isPast = i < currentIndex;
            const distance = Math.abs(i - currentIndex);

            // focus = big + sharp, others = smaller + blurred (Apple Music style)
            let opacity = 0.12;
            let blur = 5;
            let scale = 0.96;
            if (isActive) {
              opacity = 1;
              blur = 0;
              scale = 1;
            } else if (distance === 1) {
              opacity = isPast ? 0.55 : 0.62;
              blur = 0.8;
              scale = 0.985;
            } else if (distance === 2) {
              opacity = 0.32;
              blur = 2.2;
              scale = 0.97;
            } else if (distance === 3) {
              opacity = 0.18;
              blur = 3.5;
              scale = 0.96;
            } else {
              opacity = 0.1;
              blur = 5;
              scale = 0.95;
            }

            return (
              <motion.p
                key={`${i}-${line.slice(0, 24)}`}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
                animate={{ opacity, y: 0, scale, filter: `blur(${blur}px)` }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => onSeek(i)}
                className={`group cursor-pointer select-none will-change-transform ${isActive ? 'py-4 sm:py-5' : 'py-3 sm:py-3.5'}`}
                style={{ transformOrigin: 'left center' }}
              >
                <span
                  className={`block tracking-[-0.04em] transition-all break-words text-balance ${
                    isActive
                      ? 'text-[27px] min-[400px]:text-[32px] sm:text-[48px] lg:text-[56px] xl:text-[62px] font-black leading-[1.15] text-white'
                      : 'text-[17px] min-[400px]:text-[19px] sm:text-[22px] lg:text-[26px] font-semibold leading-[1.6] text-white'
                  }`}
                  style={{
                    textShadow: isActive
                      ? '0 4px 32px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.8)'
                      : '0 1px 14px rgba(0,0,0,0.45)',
                  }}
                >
                  <span className={isActive ? 'bg-gradient-to-r from-white to-white bg-clip-text' : ''}>
                    {line || <span className="opacity-20">—</span>}
                  </span>
                  {isActive && (
                    <span className="ml-3 inline-block h-[4px] w-8 rounded-full bg-white align-middle opacity-90 -translate-y-1.5 shadow-[0_2px_12px_rgba(255,255,255,0.5)]" />
                  )}
                </span>
              </motion.p>
            );
          })}

          <div className="pt-12 pb-2 flex items-center justify-center gap-2">
            <span className="h-px w-6 bg-white/10" />
            <p className="text-[10px] tracking-[0.18em] uppercase text-white/25 font-medium">
              {isSynced ? (isPlaying ? 'Live synced • tap to seek' : 'Synced • paused') : 'Plain lyrics'}
            </p>
            <span className="h-px w-6 bg-white/10" />
          </div>
        </div>
      </div>
    </div>
  );
};
