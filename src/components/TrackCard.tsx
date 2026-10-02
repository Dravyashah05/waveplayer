import { Play, User, Plus, Clock3 } from 'lucide-react';
import { Track } from '../types';

interface Props {
  track: Track;
  isActive?: boolean;
  onPlay: () => void;
  onAdd: () => void;
}

export const TrackCard: React.FC<Props> = ({ track, isActive, onPlay, onAdd }) => {
  return (
    <div className={`group relative flex gap-3 rounded-[20px] border glass p-3 transition-all duration-300 ${isActive ? 'border-white/20 bg-white/[0.06] shadow-[0_8px_30px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.10] hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)] hover:-translate-y-[1px]'}`}>
      {isActive && <span className="pointer-events-none absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/[0.07] to-transparent" />}
      <div className="relative h-[64px] w-[88px] min-[400px]:h-[68px] min-[400px]:w-[100px] shrink-0 overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/10">
        <img src={track.thumbnail} alt={track.title} loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-500" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <button onClick={onPlay} aria-label={`Play ${track.title}`} className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:focus-within:opacity-100 transition-all backdrop-blur-[2px]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-900 shadow-lg scale-90 group-hover:scale-100 transition-transform">
            <Play className="h-4 w-4 ml-0.5 fill-current" />
          </span>
        </button>
        <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-full bg-black/70 backdrop-blur px-1.5 py-0.5 text-[10px] font-semibold text-white border border-white/10"><Clock3 className="h-3 w-3 opacity-70" />{track.duration}</span>
        {isActive && <span className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-black shadow"><span className="h-1.5 w-1.5 rounded-full bg-black animate-pulse" /> NOW</span>}
      </div>
      <div className="min-w-0 flex-1 relative">
        <p className={`line-clamp-2 text-[13px] font-semibold leading-[1.35] ${isActive ? 'text-white' : 'text-white group-hover:text-white'}`}>{track.title}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500 truncate"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.06]"><User className="h-3 w-3" /></span>{track.author}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button onClick={onPlay} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold shadow-sm active:scale-[0.98] ${isActive ? 'bg-white text-neutral-900 shadow-[0_6px_16px_rgba(255,255,255,0.2)]' : 'bg-white text-neutral-900 hover:bg-neutral-100'}`}>
            <Play className="h-3 w-3 fill-current" /> Play
          </button>
          <button onClick={onAdd} className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.05] backdrop-blur px-2.5 py-1.5 text-xs font-semibold text-neutral-300 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.12]">
            <Plus className="h-3 w-3" /> Queue
          </button>
        </div>
      </div>
    </div>
  );
};
