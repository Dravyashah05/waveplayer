import React from 'react';
import { Play, MoreVertical } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { Track } from '../types';

/**
 * Shared Home shelf primitives: horizontal track rail + per-section
 * skeletons. Touch-friendly, no page-level horizontal overflow
 * (rails scroll internally), reduced-motion aware, keyboard accessible.
 */

function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  const s = Math.floor(totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export const RailSkeleton: React.FC<{ cards?: number }> = ({ cards = 6 }) => (
  <div className="flex gap-3.5 sm:gap-4 overflow-hidden" aria-hidden="true">
    {[...Array(cards)].map((_, i) => (
      <div
        key={i}
        className="min-w-[150px] w-[150px] sm:min-w-[170px] sm:w-[170px] shrink-0 animate-pulse"
      >
        <div className="aspect-square rounded-[20px] bg-white/[0.04] border border-white/5" />
        <div className="mt-2 h-3 w-3/4 rounded-full bg-white/[0.06]" />
        <div className="mt-1.5 h-2.5 w-1/2 rounded-full bg-white/[0.04]" />
      </div>
    ))}
  </div>
);

export const GridSkeleton: React.FC<{ cards?: number }> = ({ cards = 8 }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3" aria-hidden="true">
    {[...Array(cards)].map((_, i) => (
      <div key={i} className="h-16 rounded-2xl bg-white/[0.04] border border-white/5 animate-pulse" />
    ))}
  </div>
);

interface RailCard {
  track: Track;
  context: Track[];
  badge?: string;
  progressFraction?: number;
  resumeLabel?: string;
}

interface TrackRailProps {
  items: RailCard[];
  currentTrackId?: string | null;
  onPlay: (track: Track, list: Track[]) => void;
  onOpenMenu?: (track: Track, e: React.MouseEvent) => void;
  minWidth?: string;
}

export const TrackRail: React.FC<TrackRailProps> = ({
  items,
  currentTrackId,
  onPlay,
  onOpenMenu,
  minWidth = 'min-w-[150px] w-[150px] sm:min-w-[170px] sm:w-[170px]',
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
      {items.map(({ track, context, badge, progressFraction, resumeLabel }) => {
        const isActive = currentTrackId === track.id;
        return (
          <motion.div
            key={`rail-${track.id}`}
            whileHover={reduceMotion ? undefined : { y: -3 }}
            className="snap-start shrink-0"
          >
            <button
              type="button"
              onClick={() => onPlay(track, context)}
              aria-label={`Play ${track.title} by ${track.author}`}
              className={`group block cursor-pointer text-left ${minWidth}`}
            >
              <span className={`relative block aspect-square overflow-hidden rounded-[20px] bg-[#18181b] shadow-md ${isActive ? 'ring-2 ring-white' : 'ring-1 ring-white/10'}`}>
                <img
                  src={track.thumbnail}
                  alt=""
                  loading="lazy"
                  className={`h-full w-full object-cover ${reduceMotion ? '' : 'transition-transform duration-500 group-hover:scale-105'}`}
                  referrerPolicy="no-referrer"
                />
                <span className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                    <Play className="h-4 w-4 fill-current ml-0.5" aria-hidden="true" />
                  </span>
                </span>
                {badge && (
                  <span className="absolute top-2 left-2 rounded-full bg-black/70 backdrop-blur border border-white/10 px-2 py-0.5 text-[9.5px] font-bold text-white">
                    {badge}
                  </span>
                )}
                {onOpenMenu && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`More options for ${track.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenMenu(track, e as unknown as React.MouseEvent);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenMenu(track, e as unknown as React.MouseEvent);
                      }
                    }}
                    className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 backdrop-blur text-white/80 hover:text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  </span>
                )}
                {typeof progressFraction === 'number' && (
                  <span className="absolute bottom-0 left-0 right-0 h-1 bg-white/15">
                    <span
                      className="block h-full bg-white/90"
                      style={{ width: `${Math.round(Math.max(0, Math.min(1, progressFraction)) * 100)}%` }}
                    />
                  </span>
                )}
              </span>
              <span className="block min-w-0 pt-2">
                <span
                  className={`block truncate text-[13px] sm:text-[13.5px] font-bold leading-tight ${
                    isActive ? 'text-white' : 'text-white/95 group-hover:text-white transition-colors'
                  }`}
                >
                  {track.title}
                </span>
                <span className="block truncate text-xs font-medium text-[#8e8e93] mt-0.5">
                  {resumeLabel || track.author}
                </span>
              </span>
            </button>
          </motion.div>
        );
      })}
    </div>
  );
};

export function formatResumeLabel(positionSeconds: number): string {
  if (!(positionSeconds > 0)) return '';
  return `Resume from ${formatClock(positionSeconds)}`;
}
