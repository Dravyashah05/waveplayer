import { Home, Compass, ListMusic } from 'lucide-react';

interface Props {
  active?: string;
  onActive?: (s: string) => void;
  favCount?: number;
  variant?: 'pill' | 'sidebar';
}

export const NavOptions: React.FC<Props> = ({ active, onActive, favCount }) => {
  const isActive = (id: string) => active === id;

  return (
    <nav className="hidden lg:flex items-center gap-1.5 shrink-0 ml-1">
      <button type="button" onClick={() => onActive?.('discover')} className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold leading-none min-h-[36px] ${isActive('discover') ? 'bg-white text-black shadow-[0_2px_10px_rgba(255,255,255,0.15)]' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
        <Home className="h-4 w-4" /> Home
      </button>
      <button type="button" onClick={() => onActive?.('explore')} className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold leading-none min-h-[36px] ${isActive('explore') ? 'bg-white text-black shadow-[0_2px_10px_rgba(255,255,255,0.15)]' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
        <Compass className="h-4 w-4" /> Explore
      </button>
      <button type="button" onClick={() => onActive?.('playlists')} className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold leading-none min-h-[36px] ${isActive('playlists') || isActive('liked') ? 'bg-white text-black shadow-[0_2px_10px_rgba(255,255,255,0.15)]' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
        <ListMusic className="h-4 w-4" /> My Playlists {typeof favCount === 'number' && favCount > 0 ? `• ${favCount}` : ''}
      </button>
    </nav>
  );
};
