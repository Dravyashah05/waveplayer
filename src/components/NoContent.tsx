import { Music, Search, ListMusic, Disc3, Mic2, Heart, Inbox } from 'lucide-react';

type Variant = 'songs' | 'playlists' | 'albums' | 'artists' | 'favs' | 'generic' | 'search';

const icons: Record<Variant, React.ComponentType<{ className?: string }>> = {
  songs: Music,
  playlists: ListMusic,
  albums: Disc3,
  artists: Mic2,
  favs: Heart,
  generic: Inbox,
  search: Search,
};

const messages: Record<Variant, { title: string; desc: string }> = {
  songs: { title: 'No songs available', desc: 'Search for music or play something to see it here.' },
  playlists: { title: 'No playlists available', desc: 'Create a playlist or discover one from search.' },
  albums: { title: 'No albums available', desc: 'Albums you play or save will appear here.' },
  artists: { title: 'No artists available', desc: 'Follow artists to build your collection.' },
  favs: { title: 'No favorites yet', desc: 'Tap the heart on any song to save it here.' },
  generic: { title: 'No content available', desc: 'There is nothing to show here yet.' },
  search: { title: 'No results found', desc: 'Try a different keyword or check your spelling.' },
};

export const NoContent: React.FC<{
  variant?: Variant;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}> = ({ variant = 'generic', title, description, icon, actionLabel, onAction, compact }) => {
  const Icon = icons[variant] || Inbox;
  const defaults = messages[variant] || messages.generic;
  return (
    <div className={`flex flex-col items-center justify-center text-center rounded-[20px] glass-card ${compact ? 'py-10 px-6' : 'py-16 sm:py-20 px-6'}`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] border border-white/[0.08] text-[#6e6e73]">
        {icon ?? <Icon className="h-7 w-7" />}
      </div>
      <p className="mt-4 text-[15px] font-bold tracking-[-0.01em] text-white">{title ?? defaults.title}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-[#86868b]">{description ?? defaults.desc}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="mt-5 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black hover:bg-white/90 shadow-sm active:scale-[0.97]">
          {actionLabel}
        </button>
      )}
    </div>
  );
};
