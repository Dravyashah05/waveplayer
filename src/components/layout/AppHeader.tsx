import React, { useState, useEffect, useRef } from 'react';
import { Search, X, ArrowLeft, Clock, ArrowUpRight, UserRound, Settings2, LogOut, Maximize2, Minimize2, Sparkles, Music2 } from 'lucide-react';
import { settingsStore } from '../../services/settingsStore';
import { googleLogout, useGoogleAccount } from '../../hooks/useGoogleAccount';
import { UserAvatar } from '../UserAvatar';

interface AppHeaderProps {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onNavigateSearch?: () => void;
  suggestions?: string[];
  onSelectSuggestion?: (s: string) => void;
  onFocusSuggestions?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onNavigate?: (page: string, param?: string) => void;
  canGoBack?: boolean;
  onBack?: () => void;
  active?: string;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  query,
  onQueryChange,
  onSearch,
  onNavigateSearch,
  suggestions = [],
  onSelectSuggestion,
  onFocusSuggestions,
  isFullscreen,
  onToggleFullscreen,
  onNavigate,
  canGoBack,
  onBack,
  active,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedSug, setSelectedSug] = useState(-1);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);

  const profileRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);

  const { connected: accountConnected, user: accountUser, reload: reloadAccount } = useGoogleAccount();

  const signOut = async () => {
    setProfileOpen(false);
    await googleLogout();
    await reloadAccount();
  };

  useEffect(() => {
    setSelectedSug(-1);
  }, [suggestions, query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        // click outside search container
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (mobileSearchOpen) {
      setTimeout(() => mobileInputRef.current?.focus(), 50);
    }
  }, [mobileSearchOpen]);

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassEnabled(settingsStore.get().glassEnabled);
      setGlassIntensity(settingsStore.get().glassIntensity);
    });
    return () => unsub();
  }, []);

  const highlight = (text: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <span>{text}</span>;
    return (
      <span>
        {text.slice(0, idx)}
        <span className="font-bold text-white bg-white/[0.12] rounded px-0.5">
          {text.slice(idx, idx + q.length)}
        </span>
        {text.slice(idx + q.length)}
      </span>
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSug((s) => (s + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSug((s) => (s <= 0 ? suggestions.length - 1 : s - 1));
    } else if (e.key === 'Enter' && selectedSug >= 0) {
      e.preventDefault();
      onSelectSuggestion?.(suggestions[selectedSug]);
      if (onNavigateSearch) onNavigateSearch();
      setMobileSearchOpen(false);
    } else if (e.key === 'Escape') {
      setSelectedSug(-1);
      setMobileSearchOpen(false);
    }
  };

  const blurPx = glassEnabled ? Math.round(16 + (glassIntensity / 100) * 24) : 0;
  const bgStyle = glassEnabled
    ? {
        backgroundColor: `rgba(10, 10, 12, ${(0.82 - (glassIntensity / 100) * 0.25).toFixed(2)})`,
        backdropFilter: `blur(${blurPx}px) saturate(160%)`,
        WebkitBackdropFilter: `blur(${blurPx}px) saturate(160%)`,
      }
    : {
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
      };

  const isDetailPage = active && ['artist', 'album', 'playlist', 'nowplaying'].includes(active);

  return (
    <header
      className="sticky top-0 z-40 w-full transition-all duration-200 border-b border-white/[0.06] safe-top"
      style={bgStyle}
    >
      <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-6 lg:px-8">

        {/* Left Section: Back button / Brand */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {canGoBack && isDetailPage ? (
            <button
              type="button"
              onClick={onBack}
              className="touch-target h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-white/[0.08] hover:bg-white text-white hover:text-black border border-white/10 flex items-center justify-center transition-all active:scale-95"
              title="Go back"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : null}

          <div
            onClick={() => onNavigate?.('discover')}
            className="flex items-center gap-2 cursor-pointer select-none group touch-target px-1"
          >
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-white text-black font-black text-sm shadow-[0_2px_10px_rgba(255,255,255,0.2)]">
              W
            </div>
            <span className="text-[18px] sm:text-[19px] font-black tracking-tight text-white group-hover:text-white/90">
              Wave
            </span>
          </div>
        </div>

        {/* Center Section: Desktop Search bar */}
        <div
          ref={searchContainerRef}
          className="relative hidden lg:flex flex-1 max-w-md mx-4 items-center"
        >
          <div className="relative flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] hover:bg-white/[0.09] focus-within:bg-white/[0.09] focus-within:border-white/25 px-3 py-1.5 shadow-sm transition-all">
            <Search className="h-4 w-4 text-white/50 shrink-0" />
            <input
              ref={desktopInputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={() => onFocusSuggestions?.()}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => {
                if (e.key === 'Enter') onSearch();
              }}
              placeholder="Search songs, albums, artists…"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-[13.5px] font-medium text-white outline-none placeholder:text-white/40"
            />
            {query ? (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="h-6 w-6 rounded-full bg-white/10 hover:bg-white text-white hover:text-black flex items-center justify-center transition-colors"
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="hidden xl:inline-flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white/40">
                /
              </kbd>
            )}
          </div>

          {/* Desktop Suggestions dropdown */}
          {suggestions.length > 0 && (
            <div
              className="absolute left-0 right-0 top-[48px] z-50 overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/95 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
            >
              <div className="p-1.5 space-y-0.5 max-h-[300px] overflow-y-auto scrollbar-none">
                {suggestions.map((s, i) => {
                  const isSelected = i === selectedSug;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        onSelectSuggestion?.(s);
                        if (onNavigateSearch) onNavigateSearch();
                      }}
                      onMouseEnter={() => setSelectedSug(i)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
                        isSelected
                          ? 'bg-white text-black font-semibold'
                          : 'text-white/80 hover:bg-white/[0.06] hover:text-white font-medium'
                      }`}
                    >
                      <Search className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-black' : 'text-white/40'}`} />
                      <span className="flex-1 truncate">{highlight(s)}</span>
                      <ArrowUpRight className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-black' : 'text-white/20'}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Section: Mobile search button + Fullscreen + Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mobile search trigger */}
          <button
            type="button"
            onClick={() => {
              if (active !== 'search') onNavigate?.('search');
              setMobileSearchOpen((v) => !v);
            }}
            className="lg:hidden touch-target h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-white/[0.08] hover:bg-white text-white hover:text-black border border-white/10 flex items-center justify-center transition-all active:scale-95"
            title="Search"
            aria-label="Search"
          >
            <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>

          {/* Desktop Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="hidden sm:flex touch-target h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-white/[0.08] hover:bg-white text-white hover:text-black border border-white/10 items-center justify-center transition-all active:scale-95"
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}

          {/* Profile Avatar Button */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => setProfileOpen((v) => !v)}
              className="touch-target-lg flex items-center justify-center rounded-full hover:scale-105 active:scale-95 transition-all"
              title={accountUser?.name ? `Signed in as ${accountUser.name}` : 'Profile'}
              aria-label="User profile and settings"
              aria-expanded={profileOpen}
            >
              <UserAvatar
                user={accountUser}
                sizeClass="h-9 w-9 sm:h-10 sm:w-10"
                iconSizeClass="h-4 w-4"
                textSizeClass="text-xs font-bold"
                showStatus={accountConnected}
              />
            </button>

            {/* Profile Popup Menu */}
            {profileOpen && (
              <div
                className="absolute right-0 top-[calc(100%+8px)] w-[260px] max-w-[calc(100vw-32px)] rounded-2xl border border-white/10 bg-[#121215]/95 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden z-50"
              >
                <div className="p-4 flex items-center gap-3 border-b border-white/[0.06]">
                  <UserAvatar
                    user={accountUser}
                    sizeClass="h-10 w-10"
                    iconSizeClass="h-5 w-5"
                    textSizeClass="text-sm font-bold"
                    showStatus={accountConnected}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold tracking-tight text-white truncate">
                      {accountUser?.name || 'Wave Music'}
                    </p>
                    <p className="text-[12px] text-white/50 truncate">
                      {accountUser?.email || 'wave@music.app'}
                    </p>
                    <p className="text-[10.5px] font-medium text-white/30">
                      {accountConnected ? 'Google Connected' : 'Guest Account'}
                    </p>
                  </div>
                </div>

                <div className="p-2 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onNavigate?.('profile');
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white hover:bg-white hover:text-black text-left transition-colors"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white">
                      <UserRound className="h-4 w-4" />
                    </span>
                    Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onNavigate?.('settings');
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white hover:bg-white hover:text-black text-left transition-colors"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white">
                      <Settings2 className="h-4 w-4" />
                    </span>
                    Settings
                  </button>
                  <div className="h-px bg-white/[0.06] my-1" />
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white/60 hover:bg-red-500/10 hover:text-red-400 text-left transition-colors"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-white/60">
                      <LogOut className="h-4 w-4" />
                    </span>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Mobile search expanded bar */}
      {mobileSearchOpen && (
        <div className="lg:hidden px-3 pb-3 pt-1 border-t border-white/[0.06]">
          <div className="relative flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3 py-2">
            <Search className="h-4 w-4 text-white/50 shrink-0" />
            <input
              ref={mobileInputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={() => onFocusSuggestions?.()}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => {
                if (e.key === 'Enter') {
                  onSearch();
                  setMobileSearchOpen(false);
                }
              }}
              placeholder="Search songs, artists…"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-[15px] font-medium text-white outline-none placeholder:text-white/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="h-6 w-6 rounded-full bg-white/10 text-white flex items-center justify-center"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileSearchOpen(false)}
              className="text-xs font-semibold text-white/60 hover:text-white px-1"
            >
              Cancel
            </button>
          </div>

          {/* Mobile suggestions list */}
          {suggestions.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#121215] shadow-2xl max-h-[260px] overflow-y-auto">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onSelectSuggestion?.(s);
                    if (onNavigateSearch) onNavigateSearch();
                    setMobileSearchOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/[0.08] border-b border-white/[0.04] last:border-0"
                >
                  <Search className="h-4 w-4 text-white/40 shrink-0" />
                  <span className="flex-1 truncate">{highlight(s)}</span>
                  <ArrowUpRight className="h-4 w-4 text-white/20 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
};
