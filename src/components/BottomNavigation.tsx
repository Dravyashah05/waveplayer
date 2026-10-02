import React, { useState, useEffect } from 'react';
import { Home, Search, Compass, ListMusic, User } from 'lucide-react';
import { motion } from 'motion/react';
import { settingsStore } from '../services/settingsStore';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { UserAvatar } from './UserAvatar';

interface Props {
  active: string;
  onChange: (s: string) => void;
  onPrefetch?: (s: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
}

export const BottomNavigation: React.FC<Props> = ({ active, onChange, onPrefetch }) => {
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  const { connected, user } = useGoogleAccount();

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassIntensity(settingsStore.get().glassIntensity);
      setGlassEnabled(settingsStore.get().glassEnabled);
    });
    return () => unsub();
  }, []);

  const blurPx = glassEnabled ? Math.round(16 + (glassIntensity / 100) * 24) : 0;
  const bgAlpha = glassEnabled ? (0.75 + (glassIntensity / 100) * 0.18).toFixed(2) : '0.96';

  const items: NavItem[] = [
    { id: 'discover', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'playlists', label: 'Library', icon: ListMusic },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  const isTabActive = (id: string) => {
    if (id === 'discover') return active === 'discover';
    if (id === 'search') return active === 'search';
    if (id === 'explore') return active === 'explore';
    if (id === 'playlists') return ['playlists', 'liked', 'history', 'songs', 'albums', 'artists', 'all'].includes(active);
    if (id === 'profile') return active === 'profile';
    return false;
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className="lg:hidden fixed bottom-2.5 left-2 right-2 sm:left-4 sm:right-4 z-40 safe-bottom select-none"
    >
      <div
        className="mx-auto w-full max-w-[440px] rounded-[26px] border border-white/[0.10] p-1.5 flex items-center justify-between gap-1 shadow-[0_16px_48px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.12)]"
        style={
          glassEnabled
            ? {
                backgroundColor: `rgba(12,12,14,${bgAlpha})`,
                backdropFilter: `blur(${blurPx}px) saturate(160%)`,
                WebkitBackdropFilter: `blur(${blurPx}px) saturate(160%)`,
              }
            : {
                backgroundColor: 'rgba(14,14,16,0.96)',
              }
        }
      >
        {items.map((item) => {
          const isActive = isTabActive(item.id);
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={item.label}
              onClick={() => onChange(item.id)}
              onMouseEnter={() => onPrefetch?.(item.id)}
              onFocus={() => onPrefetch?.(item.id)}
              className={`relative flex flex-1 min-h-[48px] touch-target flex-col items-center justify-center gap-1 rounded-[20px] px-1.5 py-1.5 text-[11px] font-semibold tracking-tight transition-all isolate overflow-hidden ${
                isActive ? 'text-black' : 'text-white/60 hover:text-white active:scale-95'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-active-pill"
                  className="absolute inset-0 rounded-[20px] bg-white shadow-[0_2px_12px_rgba(255,255,255,0.18)]"
                  transition={{ type: 'spring', stiffness: 450, damping: 36 }}
                />
              )}

              <span
                className={`relative z-10 flex h-6 w-6 items-center justify-center transition-colors ${
                  isActive ? 'text-black' : 'text-white/70'
                }`}
              >
                {item.id === 'profile' && connected ? (
                  <UserAvatar
                    user={user}
                    sizeClass="h-5 w-5"
                    iconSizeClass="h-3 w-3"
                    textSizeClass="text-[9px] font-bold"
                  />
                ) : (
                  <Icon className="h-[18px] w-[18px]" />
                )}
              </span>

              <span className="relative z-10 leading-none text-[10.5px] min-[380px]:text-[11px] font-bold truncate max-w-full">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
