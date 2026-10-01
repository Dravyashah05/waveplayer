import { Play, Plus, Clock3 } from 'lucide-react';
import { Track } from '../types';

interface Props {
  track: Track;
  index: number;
  isActive?: boolean;
  isPlaying?: boolean;
  onPlay: () => void;
  onAdd: () => void;
}

export const TrackListRow: React.FC<Props> = ({ track, index, isActive, isPlaying, onPlay, onAdd }) => {
  return (
    <div
      className={`group flex items-center gap-3 px-3 sm:px-4 py-2.5 transition-all border-b border-white/[0.04] last:border-0 backdrop-blur-sm ${
        isActive ? 'glass bg-white/[0.06] border border-white/20 shadow-[0_4px_20px_rgba(255,255,255,0.08)]' : 'hover:glass-hover hover:bg-white/[0.04]'
      }`}
    >
      <button
        onClick={onPlay}
        className="hidden sm:flex h-6 w-6 items-center justify-center shrink-0 text-[#86868b] hover:text-white transition-colors"
        aria-label="Play"
      >
        {isActive && isPlaying ? (
          <span className="flex items-end gap-[2px] h-3">
            <span className="wave-bar !bg-white" />
            <span className="wave-bar !bg-white" />
            <span className="wave-bar !bg-white" />
          </span>
        ) : isActive ? (
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
        ) : (
          <span className="text-[11px] font-medium tabular-nums w-5 text-center group-hover:hidden text-[#86868b]">{index + 1}</span>
        )}
        <Play className={`h-3 w-3 fill-current hidden group-hover:block ${isActive ? '!block text-white' : 'text-white'}`} />
      </button>

      <div className="relative h-10 w-10 sm:h-11 sm:w-11 shrink-0 overflow-hidden rounded-[6px] bg-[#2c2c2e] border border-white/[0.06]">
        <img
          src={track.thumbnail}
          alt={track.title}
          loading="lazy"
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
            else if (img.src.includes('w800')) img.src = img.src.replace('w800', 'w400');
          }}
        />
        <button onClick={onPlay} className="absolute inset-0 hidden sm:flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <Play className="h-4 w-4 fill-white text-white" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13px] font-medium tracking-[-0.01em] leading-tight ${isActive ? 'text-white' : 'text-white'}`}>{track.title}</p>
        <p className="truncate text-[12px] font-normal text-[#86868b]">{track.author} {track.albumName ? `• ${track.albumName}` : ''}</p>
      </div>

      <div className="hidden lg:block min-w-0 w-[160px] shrink-0">
        <p className="truncate text-[13px] font-normal text-[#86868b]">{track.albumName || '—'}</p>
      </div>

      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono font-medium text-[#86868b] shrink-0 w-12 justify-end tabular-nums">
        {track.duration}
      </span>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onAdd}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#2c2c2e] border border-white/[0.06] text-[#aeaeb2] hover:text-white hover:bg-[#3a3a3c] transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
          title="Add to queue"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onPlay}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full active:scale-95 transition-colors ${isActive ? 'bg-white text-black shadow-sm' : 'bg-white text-black hover:bg-white/90'}`}
        >
          <Play className="h-3 w-3 fill-current ml-0.5" />
        </button>
      </div>
    </div>
  );
};
