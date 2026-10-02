import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, ListPlus, FolderPlus, Heart, X, CheckSquare } from 'lucide-react';
import { Track } from '../types';

interface BulkActionBarProps {
  selectedTracks: Track[];
  onPlayAll: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
  onLikeAll: () => void;
  onClearSelection: () => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedTracks,
  onPlayAll,
  onAddToQueue,
  onAddToPlaylist,
  onLikeAll,
  onClearSelection,
}) => {
  const count = selectedTracks.length;
  if (count === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.95 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="fixed bottom-[calc(112px+env(safe-area-inset-bottom))] lg:bottom-[calc(120px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 w-[calc(100%-24px)] max-w-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-white/15 bg-[#121214]/95 p-2 px-3 sm:px-4 shadow-[0_16px_48px_rgba(0,0,0,0.85)] backdrop-blur-2xl">
          {/* Count Badge */}
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black text-xs font-black">
              {count}
            </span>
            <span className="text-xs sm:text-sm font-bold text-white tracking-tight hidden sm:inline">
              Selected
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={onPlayAll}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all shadow-sm"
              title="Play selected songs"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Play</span>
            </button>

            <button
              type="button"
              onClick={onAddToQueue}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1.5 text-xs font-semibold text-white active:scale-95 transition-all"
              title="Add to queue"
            >
              <ListPlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Queue</span>
            </button>

            <button
              type="button"
              onClick={onAddToPlaylist}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1.5 text-xs font-semibold text-white active:scale-95 transition-all"
              title="Add to playlist"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Playlist</span>
            </button>

            <button
              type="button"
              onClick={onLikeAll}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1.5 text-xs font-semibold text-white active:scale-95 transition-all"
              title="Save all to Liked"
            >
              <Heart className="h-3.5 w-3.5 text-red-400" />
              <span className="hidden md:inline">Like</span>
            </button>

            <button
              type="button"
              onClick={onClearSelection}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/20 hover:text-white transition-colors"
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

