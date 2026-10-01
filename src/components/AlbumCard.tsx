import { Disc3, Play } from 'lucide-react';
import { Album } from '../types';

interface Props {
  album: Album;
  onClick: () => void;
}

export const AlbumCard: React.FC<Props> = ({ album, onClick }) => {
  const thumb = album.thumbnails?.[2]?.url || album.thumbnails?.[1]?.url || album.thumbnails?.[0]?.url || `https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg`;
  return (
    <div onClick={onClick} className="group cursor-pointer flex flex-col rounded-xl glass-card overflow-hidden hover:glass-hover transition-all min-w-[160px] w-[160px]">
      <div className="relative aspect-square w-full bg-[#2c2c2e] overflow-hidden">
        <img
          src={thumb}
          alt={album.name}
          loading="lazy"
          className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
            else if (img.src.includes('w800')) img.src = img.src.replace('w800', 'w400');
          }}
        />
        <button className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 backdrop-blur text-black opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all shadow-lg">
          <Play className="h-3 w-3 fill-current ml-0.5" />
        </button>
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/60 backdrop-blur px-1.5 py-1 text-[10px] font-semibold tracking-wide text-white border border-white/10"><Disc3 className="h-3 w-3" /> ALBUM</span>
      </div>
      <div className="p-3">
        <p className="line-clamp-1 text-[13px] font-medium leading-tight text-white tracking-[-0.01em]">{album.name}</p>
        <p className="truncate text-xs font-normal text-[#86868b]">{album.artist.name} {album.year ? `• ${album.year}` : ''}</p>
      </div>
    </div>
  );
};
