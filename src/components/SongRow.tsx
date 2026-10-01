import { Play, Heart, MoreHorizontal, Clock3 } from 'lucide-react';
import { Track } from '../types';
import { playerStore } from '../services/playerStore';
import { useState, useEffect } from 'react';

interface Props {
  track: Track;
  index: number;
  isActive?: boolean;
  onPlay: () => void;
  showAlbum?: boolean;
}

export const SongRow: React.FC<Props> = ({ track, index, isActive, onPlay, showAlbum = true }) => {
  const [isFav, setIsFav] = useState(() => playerStore.isFav(track.id));
  useEffect(() => {
    const unsub = playerStore.subscribe(() => setIsFav(playerStore.isFav(track.id)));
    return () => { unsub(); };
  }, [track.id]);

  const toggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    playerStore.toggleFav(track);
    setIsFav(playerStore.isFav(track.id));
  };

  return (
    <div
      onClick={onPlay}
      className={`group flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 transition-all cursor-pointer border-b border-white/[0.04] last:border-0 ${
        isActive ? 'bg-white/[0.04] backdrop-blur' : 'hover:bg-white/[0.04] hover:backdrop-blur-sm'
      }`}
    >
      {/* index / wave / play on hover */}
      <div className="hidden sm:flex w-6 shrink-0 items-center justify-center">
        <span className="text-[11px] font-mono text-[#6e6e73] tabular-nums group-hover:hidden w-5 text-center">{String(index + 1).padStart(2, '0')}</span>
        <span className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full bg-white text-black shadow-sm">
          <Play className="h-3 w-3 fill-current ml-0.5" />
        </span>
        {isActive && (
          <span className="hidden group-hover:hidden flex items-center justify-center">
            <span className="flex items-end gap-[2px] h-3">
              <span className="wave-bar !bg-white" />
              <span className="wave-bar !bg-white" />
              <span className="wave-bar !bg-white" />
            </span>
          </span>
        )}
      </div>

      {/* artwork — 44px min tap target on mobile */}
      <div className="relative h-11 w-11 sm:h-12 sm:w-12 shrink-0 overflow-hidden rounded-[12px] bg-[#1c1c1e] ring-1 ring-white/[0.06] shadow-sm">
        <img src={track.thumbnail} alt={track.title} loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 hidden sm:flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <Play className="h-4 w-4 fill-white text-white" />
        </div>
      </div>

      {/* title / artist */}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13.5px] font-semibold tracking-[-0.01em] leading-tight ${isActive ? 'text-white' : 'text-white group-hover:text-white'}`}>{track.title}</p>
        <p className="truncate text-[12.5px] font-normal text-[#86868b]">{track.author}</p>
      </div>

      {/* album - desktop */}
      {showAlbum && (
        <div className="hidden lg:block min-w-0 w-[180px] shrink-0">
          <p className="truncate text-[13px] font-normal text-[#86868b]">{track.albumName || '—'}</p>
        </div>
      )}

      {/* duration */}
      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono font-medium text-[#86868b] shrink-0 w-12 justify-end tabular-nums">
        <Clock3 className="h-3 w-3 opacity-60 hidden lg:inline" /> {track.duration}
      </span>

      {/* favorite + more - premium — visible on touch, hover on desktop */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={toggleFav}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 ${isFav ? 'bg-white border-white text-black opacity-100' : 'bg-white/[0.06] border-white/[0.07] text-[#9a9aa0] hover:text-white hover:bg-white/[0.10]'}`}
          aria-label="Favorite"
        >
          <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-current' : ''}`} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); }}
          className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.06] text-[#9a9aa0] hover:text-white hover:bg-white/[0.10] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity focus-visible:opacity-100"
          aria-label="More"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onPlay(); }} className={`inline-flex sm:hidden h-8 w-8 items-center justify-center rounded-full shadow-sm active:scale-95 ${isActive ? 'bg-white text-black' : 'bg-white text-black'}`}>
          <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
        </button>
      </div>
    </div>
  );
};
