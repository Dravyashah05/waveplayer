import { Search, X, Clock, TrendingUp, ArrowUpRight, UserRound, Settings2, LogOut } from 'lucide-react';
import { NavOptions } from './NavOptions';
import { useState, useEffect, useRef } from 'react';
import { settingsStore } from '../services/settingsStore';

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onNavigateSearch?: () => void;
  queueCount: number;
  onOpenQueue: () => void;
  suggestions?: string[];
  onSelectSuggestion?: (s: string) => void;
  onFocusSuggestions?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onNavigate?: (page: string) => void;
  canGoBack?: boolean;
  onBack?: () => void;
  active?: string;
  onActive?: (s: string) => void;
  favCount?: number;
}

export const WavePlayerNavbar: React.FC<Props> = ({ query, onQueryChange, onSearch, onNavigateSearch, suggestions = [], onSelectSuggestion, onFocusSuggestions, onNavigate, canGoBack, onBack, active, onActive, favCount }) => {
  const [selected, setSelected] = useState(-1);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  const profileRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const searchRefDesktop = useRef<HTMLDivElement>(null);
  const searchRefMobile = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(-1), [suggestions, query]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
      const target = e.target as Node;
      const insideDesktop = searchRefDesktop.current?.contains(target);
      const insideMobile = searchRefMobile.current?.contains(target);
      if (searchExpanded && !insideDesktop && !insideMobile) setSearchExpanded(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [searchExpanded]);
  useEffect(() => {
    if (searchExpanded) setTimeout(() => {
      // focus whichever input is visible
      const isDesktop = window.innerWidth >= 1024;
      if (isDesktop) desktopInputRef.current?.focus();
      else inputRef.current?.focus();
    }, 50);
  }, [searchExpanded]);
  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassIntensity(settingsStore.get().glassIntensity);
      setGlassEnabled(settingsStore.get().glassEnabled);
    });
    return () => { unsub(); };
  }, []);
  const highlight = (text: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <span>{text}</span>;
    return (
      <span>
        {text.slice(0, idx)}
        <span className="font-bold text-white bg-white/[0.08] rounded px-0.5">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </span>
    );
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => (s + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => (s <= 0 ? suggestions.length - 1 : s - 1)); }
    else if (e.key === 'Enter' && selected >= 0) { e.preventDefault(); onSelectSuggestion?.(suggestions[selected]); if (onNavigateSearch) onNavigateSearch(); }
    else if (e.key === 'Escape') setSelected(-1);
  };
  const blurPx = glassEnabled ? Math.round(18 + (glassIntensity / 100) * 26) : 0;
  const bgAlpha = glassEnabled ? (0.92 - (glassIntensity / 100) * 0.5).toFixed(2) : '0.98';
  // Dropdown panels need their own frosted fill — over the near-black page a
  // dark fill makes backdrop-blur invisible, so edges + sheen carry the glass read.
  const dropBg = glassEnabled ? `rgba(26,26,28,${(0.62 + (glassIntensity / 100) * 0.16).toFixed(2)})` : '#0f0f0f';
  const dropShadow = '0 24px 64px rgba(0,0,0,0.65)';
  return (
    <header className="fixed top-2 sm:top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-12px)] sm:w-[calc(100%-16px)] max-w-[1200px] px-1 sm:px-2 safe-top pt-0">
      <div
        className="w-full relative flex h-[60px] sm:h-[68px] items-center justify-between gap-2 sm:gap-4 px-3 sm:px-5 rounded-full border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.5)] overflow-visible"
        style={
          glassEnabled
            ? {
                backgroundColor: `rgba(10,10,10,${bgAlpha})`,
                backdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)`,
                WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)`,
              }
            : {
                backgroundColor: `rgba(10,10,10,${bgAlpha})`,
              }
        }
      >

        <div className={`relative items-center shrink-0 min-w-0 ${searchExpanded ? 'hidden min-[420px]:flex lg:flex' : 'flex'}`}>
          <div onClick={() => onNavigate?.('discover')} className="cursor-pointer select-none group">
            <p className="text-[17px] sm:text-[16px] font-extrabold tracking-[-0.03em] leading-none text-white group-hover:scale-105 transition-all duration-300 transform whitespace-nowrap" style={{ color: '#ffffff' }}>Wave</p>
          </div>
        </div>

        <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <NavOptions active={active} onActive={onActive} favCount={favCount} />
          </div>
        </div>

        <div className={`flex items-center gap-2 sm:gap-3 min-w-0 ${searchExpanded ? 'flex-1 lg:flex-none' : 'shrink-0'}`}>
          {/* Desktop search — hidden by default, expands on click */}
          <div ref={searchRefDesktop} className="relative hidden lg:flex items-center min-w-0">
            {!searchExpanded ? (
              <button type="button" onClick={() => setSearchExpanded(true)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.4)] ring-1 ring-white/10" title="Search">
                <Search className="h-4 w-4" />
              </button>
            ) : (
              <div
                className="relative flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] w-[220px] xl:w-[280px]"
              style={
                glassEnabled
                  ? {
                      backgroundColor: `rgba(255,255,255,0.06)`,
                      backdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)`,
                      WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)`,
                      borderColor: 'rgba(255,255,255,0.08)',
                    }
                  : { backgroundColor: 'rgba(255,255,255,0.06)' }
              }
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shrink-0 shadow">
                <Search className="h-4 w-4" />
              </span>
              <input
                ref={desktopInputRef as any}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onFocus={() => onFocusSuggestions?.()}
                onKeyDown={onKeyDown}
                onKeyUp={(e) => { if (e.key === 'Enter') onSearch(); }}
                placeholder="Search songs, artists…"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent text-[13.5px] font-medium tracking-[-0.01em] text-white outline-none placeholder:text-white/40 min-w-0"
              />
              {query ? (
                <button type="button" onClick={() => onQueryChange("")} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white text-white hover:text-black border border-white/10 shrink-0 transition-colors" title="Clear">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="hidden xl:flex items-center rounded-full bg-white/10 border border-white/10 px-2 py-1 text-[10px] font-bold tracking-wide text-white/40">⌘K</span>
              )}
              <button type="button" onClick={() => { onQueryChange(""); setSearchExpanded(false); }} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white text-white hover:text-black border border-white/10 shrink-0 transition-colors" title="Clear">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {searchExpanded && suggestions.length > 0 && (
              <div
                className="absolute right-0 top-[52px] z-50 w-[280px] max-w-[calc(100vw-16px)] overflow-hidden rounded-[20px] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.7)]"
                style={
                  glassEnabled
                    ? {
                        backgroundColor: dropBg,
                        backdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.12)`,
                        WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.12)`,
                        boxShadow: dropShadow,
                      }
                    : { backgroundColor: '#0f0f0f' }
                }
              >
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.06]">
                  <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.07em] text-white/60"><Search className="h-3 w-3" /> Suggestions</span>
                  <span className="text-[11px] font-mono text-white/30">{suggestions.length}</span>
                </div>
                <div className="p-2 space-y-1 max-h-[320px] overflow-y-auto scrollbar-none">
                {suggestions.map((s, i) => {
                  const active = i === selected;
                  const isRecent = i < 2;
                  return (
                  <button key={i} onClick={() => { onSelectSuggestion?.(s); }} onMouseEnter={() => setSelected(i)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${active ? 'bg-white text-black' : 'hover:bg-white/[0.06] text-white/80 hover:text-white'}`}>
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${active ? 'bg-black text-white' : 'bg-white/10 text-white/60'}`}>{isRecent ? <Clock className="h-4 w-4" /> : <Search className="h-4 w-4" />}</span>
                    <span className={`truncate text-[13.5px] flex-1 min-w-0 ${active ? 'font-semibold' : 'font-medium'}`}>{highlight(s)}</span>
                    <ArrowUpRight className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-black' : 'text-white/20'}`} />
                  </button>
                )})}
                </div>
              </div>
            )}
          </div>

          {/* Mobile search — expandable */}
          <div ref={searchRefMobile} className={`relative flex lg:hidden items-center min-w-0 ${searchExpanded ? 'flex-1' : ''}`}>
            {!searchExpanded ? (
              <button type="button" onClick={() => setSearchExpanded(true)} className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.4)] ring-1 ring-white/10" title="Search">
                <Search className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
            ) : (
              <div
                className="relative flex items-center gap-2 rounded-full border border-white/10 px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-full min-w-0 max-w-[420px] min-[420px]:w-[260px] sm:w-[300px]"
                style={
                  glassEnabled
                    ? {
                        backgroundColor: `rgba(10,10,10,${bgAlpha})`,
                        backdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)`,
                        WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)`,
                      }
                    : { backgroundColor: '#0f0f0f' }
                }
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shrink-0">
                  <Search className="h-4 w-4" />
                </span>
                <input
                  ref={inputRef as any}
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onFocus={() => onFocusSuggestions?.()}
                  onKeyDown={onKeyDown}
                  placeholder="Search…"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 bg-transparent text-[16px] sm:text-[14px] font-medium tracking-[-0.01em] text-white outline-none placeholder:text-white/40 min-w-0"
                />
                <button type="button" onClick={() => { onQueryChange(""); setSearchExpanded(false); }} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 hover:bg-white text-white hover:text-black border border-white/10 hover:border-white shrink-0" title="Close">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {searchExpanded && suggestions.length > 0 && (
              <div
                className="absolute right-0 top-[52px] sm:top-[56px] z-50 w-[260px] max-w-[calc(100vw-16px)] sm:w-[300px] overflow-hidden rounded-[20px] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.7)]"
                style={
                  glassEnabled
                    ? {
                        backgroundColor: dropBg,
                        backdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.12)`,
                        WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.12)`,
                        boxShadow: dropShadow,
                      }
                    : { backgroundColor: '#0f0f0f' }
                }
              >
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.06]">
                  <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.07em] text-white/60"><Search className="h-3 w-3" /> Suggestions</span>
                  <span className="text-[11px] font-mono text-white/30">{suggestions.length}</span>
                </div>
                <div className="p-2 space-y-1 max-h-[320px] overflow-y-auto scrollbar-none">
                {suggestions.map((s, i) => {
                  const active = i === selected;
                  const isRecent = i < 2;
                  return (
                  <button key={i} onClick={() => { onSelectSuggestion?.(s); setSearchExpanded(false); }} onMouseEnter={() => setSelected(i)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${active ? 'bg-white text-black' : 'hover:bg-white/[0.06] text-white/80 hover:text-white'}`}>
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${active ? 'bg-black text-white' : 'bg-white/10 text-white/60'}`}>{isRecent ? <Clock className="h-4 w-4" /> : <Search className="h-4 w-4" />}</span>
                    <span className={`truncate text-[13.5px] flex-1 min-w-0 ${active ? 'font-semibold' : 'font-medium'}`}>{highlight(s)}</span>
                    <ArrowUpRight className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-black' : 'text-white/20 group-hover:text-white/60'}`} />
                  </button>
                )})}
                </div>
              </div>
            )}
          </div>

          <div className="relative shrink-0" ref={profileRef}>
            <button onClick={() => setProfileOpen(v => !v)} className="relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full overflow-hidden bg-[#1a1a1a] ring-1 ring-white/15 hover:ring-white/25 shadow-[0_4px_16px_rgba(0,0,0,0.2)]">
              <img src="https://i.pravatar.cc/100?img=12" alt="Profile" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              <span className="absolute inset-0 grid place-items-center bg-[#1a1a1a] text-white/60"><UserRound className="h-4 w-4" /></span>
            </button>
            {profileOpen && (
                <div
                  className="absolute right-0 top-[48px] w-[260px] max-w-[calc(100vw-48px)] rounded-2xl border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.6)] overflow-hidden z-50"
                  style={
                    glassEnabled
                      ? {
                          backgroundColor: dropBg,
                          backdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.12)`,
                          WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.12)`,
                          boxShadow: dropShadow,
                        }
                      : {
                          backgroundColor: '#0f0f0f',
                        }
                  }
                >
                  <div className="p-4 flex items-center gap-3">
                    <img src="https://i.pravatar.cc/100?img=12" alt="Profile" className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10" referrerPolicy="no-referrer" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold tracking-[-0.01em] text-white leading-none truncate">Wave User</p>
                      <p className="text-[12px] font-medium text-white/60 truncate">wave@music.app</p>
                      <p className="text-[11px] font-medium text-white/30">Premium • Wave</p>
                    </div>
                  </div>
                  <div className="h-px bg-white/10 mx-4" />
                  <div className="p-2">
                    <button onClick={() => { setProfileOpen(false); if (onNavigate) onNavigate('profile'); else void 0; }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white hover:bg-white hover:text-black text-left">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 group-hover:bg-black/10 text-white"><UserRound className="h-4 w-4" /></span> Profile
                    </button>
                    <button onClick={() => { setProfileOpen(false); if (onNavigate) onNavigate('settings'); else void 0; }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white hover:bg-white hover:text-black text-left">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 group-hover:bg-black/10 text-white"><Settings2 className="h-4 w-4" /></span> Settings
                    </button>
                    <button onClick={() => { setProfileOpen(false); void 0; }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white/60 hover:bg-white/10 hover:text-white text-left">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60"><LogOut className="h-4 w-4" /></span> Sign out
                    </button>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </header>
  );
};
