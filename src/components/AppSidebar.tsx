import { Home, ListMusic, Compass } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  active: string;
  onActive: (s: string) => void;
  favCount: number;
  historyCount?: number;
  queueCount?: number;
  onOpenQueue?: () => void;
  onOpenFavs?: () => void;
  onOpenHistory?: () => void;
  onSearchFocus?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
}> = ({ icon, label, active, count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group relative w-full flex items-center gap-3 rounded-[14px] px-3.5 py-[10px] text-[13.5px] font-[550] tracking-[-0.01em] transition-colors ${
      active ? 'text-black' : 'text-[#8e8e93] hover:text-white hover:bg-white/[0.04]'
    }`}
  >
    {active && (
      <motion.div
        layoutId="sidebar-active"
        className="absolute inset-0 rounded-[14px] bg-white shadow-[0_4px_20px_rgba(255,255,255,0.15),inset_0_1px_0_rgba(255,255,255,0.9)]"
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      />
    )}
    <span
      className={`relative z-10 flex h-[28px] w-[28px] items-center justify-center rounded-[10px] shrink-0 transition-colors ${
        active
          ? 'bg-gradient-to-br from-zinc-800 to-black text-white shadow-sm ring-1 ring-black/20'
          : 'bg-white/[0.06] text-[#9a9aa0] group-hover:bg-white/[0.10] group-hover:text-white border border-white/[0.05]'
      }`}
    >
      {icon}
    </span>
    <span className="relative z-10 flex-1 text-left leading-none font-semibold">{label}</span>
    {typeof count === 'number' && count > 0 && (
      <span
        className={`relative z-10 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold leading-none min-w-[20px] text-center ${
          active ? 'bg-black text-white' : 'bg-white/[0.12] text-white/90'
        }`}
      >
        {count}
      </span>
    )}
  </button>
);

export const AppSidebar: React.FC<Props> = ({ active, onActive, favCount }) => {
  const isActive = (id: string) => active === id;

  return (
    <aside className="hidden lg:flex w-[260px] xl:w-[280px] shrink-0 flex-col sticky top-0 self-start h-[100dvh] p-3 pr-0 z-30">
      <div className="flex h-full flex-col overflow-hidden rounded-[26px] glass-sidebar bg-[#09090b]/90 backdrop-blur-2xl border border-white/[0.08] shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
        {/* Brand Header - only app name */}
        <div className="px-4 pt-4 pb-3.5">
          <p className="text-[17px] font-extrabold tracking-[-0.02em] leading-none text-white cursor-pointer select-none" onClick={() => onActive('discover')}>Wave</p>
        </div>

        <div className="h-px bg-white/[0.06] mx-3.5" />

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-2.5 py-3 scrollbar-none space-y-1">
          <div className="space-y-1">
            <NavItem
              icon={<Home className="h-4 w-4" />}
              label="Home"
              active={isActive('discover')}
              onClick={() => onActive('discover')}
            />
            <NavItem
              icon={<Compass className="h-4 w-4" />}
              label="Explore"
              active={isActive('explore')}
              onClick={() => onActive('explore')}
            />
            <NavItem
              icon={<ListMusic className="h-4 w-4" />}
              label="My Playlists"
              active={isActive('playlists')}
              onClick={() => onActive('playlists')}
            />
          </div>

        </div>

      </div>
    </aside>
  );
};
