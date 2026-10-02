import React from 'react';
import { Home, Compass, ListMusic, Search, Heart, Settings, User, Sparkles, Disc } from 'lucide-react';
import { motion } from 'motion/react';
import { useGoogleAccount } from '../../hooks/useGoogleAccount';
import { UserAvatar } from '../UserAvatar';

interface DesktopSidebarProps {
  active: string;
  onNavigate: (page: string, param?: string) => void;
  favCount?: number;
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  icon,
  label,
  active,
  count,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`group relative flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-[14px] font-semibold tracking-[-0.01em] transition-all ${
      active
        ? 'text-black shadow-[0_2px_16px_rgba(255,255,255,0.18)]'
        : 'text-white/60 hover:text-white hover:bg-white/[0.05]'
    }`}
  >
    {active && (
      <motion.div
        layoutId="desktop-sidebar-active"
        className="absolute inset-0 rounded-2xl bg-white"
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      />
    )}
    <span
      className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-xl transition-colors ${
        active
          ? 'text-black'
          : 'text-white/60 group-hover:text-white'
      }`}
    >
      {icon}
    </span>
    <span className="relative z-10 flex-1 text-left leading-none">{label}</span>
    {typeof count === 'number' && count > 0 && (
      <span
        className={`relative z-10 rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${
          active ? 'bg-black/15 text-black' : 'bg-white/10 text-white/70'
        }`}
      >
        {count}
      </span>
    )}
  </button>
);

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  active,
  onNavigate,
  favCount = 0,
}) => {
  const { connected, user } = useGoogleAccount();

  const isLibraryActive = ['playlists', 'liked', 'history', 'songs', 'albums', 'artists', 'all'].includes(active);

  return (
    <aside className="hidden lg:flex w-[260px] xl:w-[280px] shrink-0 flex-col sticky top-0 h-[100dvh] p-3 pr-0 z-30 select-none">
      <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0c0c0e]/95 backdrop-blur-2xl shadow-[0_16px_48px_rgba(0,0,0,0.6)]">

        {/* Top Brand */}
        <div className="px-5 pt-5 pb-3">
          <div
            onClick={() => onNavigate('discover')}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-black font-black text-base shadow-[0_4px_16px_rgba(255,255,255,0.2)] group-hover:scale-105 transition-transform">
              W
            </div>
            <div>
              <p className="text-[19px] font-extrabold tracking-tight text-white leading-tight">
                Wave
              </p>
              <p className="text-[11px] font-semibold text-white/40 leading-none">
                Music Player
              </p>
            </div>
          </div>
        </div>

        <div className="h-px bg-white/[0.06] mx-4 my-1" />

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 scrollbar-none">
          <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">
            Menu
          </p>
          <SidebarItem
            icon={<Home className="h-4 w-4" />}
            label="Home"
            active={active === 'discover'}
            onClick={() => onNavigate('discover')}
          />
          <SidebarItem
            icon={<Search className="h-4 w-4" />}
            label="Search"
            active={active === 'search'}
            onClick={() => onNavigate('search')}
          />
          <SidebarItem
            icon={<Compass className="h-4 w-4" />}
            label="Explore"
            active={active === 'explore'}
            onClick={() => onNavigate('explore')}
          />

          <div className="pt-4 pb-1">
            <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">
              Library
            </p>
          </div>
          <SidebarItem
            icon={<ListMusic className="h-4 w-4" />}
            label="My Library"
            active={isLibraryActive}
            onClick={() => onNavigate('playlists')}
          />
          <SidebarItem
            icon={<Heart className="h-4 w-4" />}
            label="Liked Songs"
            count={favCount}
            active={active === 'liked'}
            onClick={() => onNavigate('liked')}
          />
        </div>

        {/* Bottom Profile / Quick settings */}
        <div className="p-3 border-t border-white/[0.06] bg-white/[0.02]">
          <div
            onClick={() => onNavigate('profile')}
            className="flex items-center gap-3 p-2 rounded-2xl hover:bg-white/[0.06] cursor-pointer transition-colors"
          >
            <UserAvatar
              user={user}
              sizeClass="h-9 w-9"
              iconSizeClass="h-4 w-4"
              textSizeClass="text-xs font-bold"
              showStatus={connected}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-white truncate">
                {user?.name || 'Guest User'}
              </p>
              <p className="text-[11px] text-white/40 truncate">
                {connected ? 'Google Connected' : 'Local library'}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate('settings');
              }}
              className="h-8 w-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

      </div>
    </aside>
  );
};
