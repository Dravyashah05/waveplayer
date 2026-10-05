import React, { useEffect, useState } from 'react';
import { Home, Compass, ListMusic, Search, Heart, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
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
  collapsed: boolean;
  count?: number;
  onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ icon, label, active, collapsed, count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={collapsed ? `${label}${count ? ` (${count})` : ''}` : undefined}
    className={`group relative flex w-full items-center rounded-2xl text-[14px] font-semibold tracking-[-0.01em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${collapsed ? 'justify-center px-2 py-3' : 'gap-3.5 px-3.5 py-3'} ${
      active
        ? 'text-black shadow-[0_2px_16px_rgba(255,255,255,0.18)]'
        : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
    }`}
  >
    {active && (
      <motion.span
        layoutId="desktop-sidebar-active"
        className="absolute inset-0 rounded-2xl bg-white"
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      />
    )}
    <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-colors ${active ? 'text-black' : 'text-white/60 group-hover:text-white'}`}>
      {icon}
    </span>
    <motion.span
      aria-hidden={collapsed}
      initial={false}
      animate={{ maxWidth: collapsed ? 0 : 180, opacity: collapsed ? 0 : 1, x: collapsed ? -4 : 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="relative z-10 flex-1 overflow-hidden whitespace-nowrap text-left leading-none"
    >
      {label}
    </motion.span>
    {!collapsed && typeof count === 'number' && count > 0 && (
      <span className={`relative z-10 rounded-full px-2 py-0.5 text-[11px] font-bold leading-none ${active ? 'bg-black/15 text-black' : 'bg-white/10 text-white/70'}`}>
        {count}
      </span>
    )}
  </button>
);

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({ active, onNavigate, favCount = 0 }) => {
  const { connected, user } = useGoogleAccount();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('wave:sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('wave:sidebar-collapsed', String(collapsed));
    } catch {
      // Keep the control usable for this session when storage is unavailable.
    }
  }, [collapsed]);

  const isLibraryActive = ['playlists', 'liked', 'history', 'songs', 'albums', 'artists', 'all'].includes(active);

  return (
    <aside className={`hidden lg:flex shrink-0 flex-col sticky top-0 h-[100dvh] p-3 pr-0 z-30 select-none transition-[width] duration-300 ease-out ${collapsed ? 'w-[76px]' : 'w-[260px] xl:w-[280px]'}`}>
      <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0c0c0e]/95 shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
        <div className={`flex items-center pt-5 pb-3 ${collapsed ? 'flex-col gap-2 px-2' : 'justify-between gap-2 px-5'}`}>
          <button type="button" onClick={() => onNavigate('discover')} aria-label="Wave home" title="Wave home" className={`group flex min-w-0 items-center gap-2.5 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${collapsed ? 'justify-center' : ''}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-base font-black text-black shadow-[0_4px_16px_rgba(255,255,255,0.2)] transition-transform group-hover:scale-105">W</span>
            {!collapsed && <span className="min-w-0">
              <span className="block text-[19px] font-extrabold leading-tight tracking-tight text-white">Wave</span>
              <span className="block text-[11px] font-semibold leading-none text-white/40">Music Player</span>
            </span>}
          </button>
          <button type="button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${collapsed ? 'self-end' : ''}`}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <div className="mx-4 my-1 h-px bg-white/[0.06]" />

        <nav aria-label="Main navigation" className={`flex-1 space-y-1.5 overflow-y-auto py-3 scrollbar-none ${collapsed ? 'px-2' : 'px-3'}`}>
          {!collapsed && <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">Menu</p>}
          <SidebarItem icon={<Home className="h-4 w-4" />} label="Home" active={active === 'discover'} collapsed={collapsed} onClick={() => onNavigate('discover')} />
          <SidebarItem icon={<Search className="h-4 w-4" />} label="Search" active={active === 'search'} collapsed={collapsed} onClick={() => onNavigate('search')} />
          <SidebarItem icon={<Compass className="h-4 w-4" />} label="Explore" active={active === 'explore'} collapsed={collapsed} onClick={() => onNavigate('explore')} />

          <div className={collapsed ? 'pt-2' : 'pt-4 pb-1'}>
            {!collapsed && <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">Library</p>}
          </div>
          <SidebarItem icon={<ListMusic className="h-4 w-4" />} label="My Library" active={isLibraryActive} collapsed={collapsed} onClick={() => onNavigate('playlists')} />
          <SidebarItem icon={<Heart className="h-4 w-4" />} label="Liked Songs" count={favCount} active={active === 'liked'} collapsed={collapsed} onClick={() => onNavigate('liked')} />
        </nav>

        <div className={`flex items-center border-t border-white/[0.06] bg-white/[0.02] ${collapsed ? 'flex-col gap-2 p-2' : 'gap-2 p-3'}`}>
          <button type="button" onClick={() => onNavigate('profile')} title={collapsed ? (user?.name || 'Profile') : undefined} aria-label="Open profile" className={`flex min-w-0 items-center rounded-2xl p-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${collapsed ? 'justify-center' : 'flex-1 gap-3'}`}>
            <UserAvatar user={user} sizeClass="h-9 w-9" iconSizeClass="h-4 w-4" textSizeClass="text-xs font-bold" showStatus={connected} />
            {!collapsed && <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-white">{user?.name || 'Guest User'}</span>
              <span className="block truncate text-[11px] text-white/40">{connected ? 'Google Connected' : 'Local library'}</span>
            </span>}
          </button>
          <button type="button" onClick={() => onNavigate('settings')} aria-label="Settings" title="Settings" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
