import { ListMusic, Play } from 'lucide-react';
import { Playlist } from '../types';

interface Props {
  playlist: Playlist;
  onClick: () => void;
}

export const PlaylistCard: React.FC<Props> = ({ playlist, onClick }) => {
  const thumb = playlist.thumbnails?.[2]?.url || playlist.thumbnails?.[1]?.url || playlist.thumbnails?.[0]?.url || `https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg`;
  return (
    <div onClick={onClick} className="group cursor-pointer flex flex-col rounded-xl glass-card overflow-hidden hover:glass-hover transition-all min-w-[172px] w-[172px]">
      <div className="relative aspect-square w-full bg-[#2c2c2e] overflow-hidden">
        <img
          src={thumb}
          alt={playlist.name}
          loading="lazy"
          className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
            else if (img.src.includes('w800')) img.src = img.src.replace('w800', 'w400');
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-60" />
        <button className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 backdrop-blur text-black opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all shadow-lg">
          <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
        </button>
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/60 backdrop-blur px-1.5 py-1 text-[10px] font-semibold tracking-wide text-white border border-white/10"><ListMusic className="h-3 w-3" /> PLAYLIST</span>
      </div>
      <div className="p-3">
        <p className="line-clamp-1 text-[13px] font-medium leading-tight text-white tracking-[-0.01em]">{playlist.name}</p>
        <p className="truncate text-xs font-normal text-[#86868b]">{playlist.author}</p>
      </div>
    </div>
  );
};
