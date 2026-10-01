import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { WavePlayerNavbar } from './components/WavePlayerNavbar';
import { PlayerBar } from './components/PlayerBar';
import { QueueDrawer } from './components/QueueDrawer';
import { ToastViewport } from './components/Toast';
import { BottomNavigation } from './components/BottomNavigation';
import { HomePage } from './pages/Home';
import { SearchPage } from './pages/Search';
import { LibraryPage } from './pages/Library';
import { ArtistPage } from './pages/Artist';
import { AlbumPage } from './pages/Album';
import { PlaylistPage } from './pages/Playlist';
import { SettingsPage } from './pages/Settings';
import { ProfilePage } from './pages/Profile';
import { ExplorePage } from './pages/Explore';
import { ytmusicSuggestions } from './services/ytmusicApi';
import { playerStore } from './services/playerStore';
import { startAutoplay } from './services/autoplay';
import { settingsStore } from './services/settingsStore';
import { Track } from './types';

type Page = 'discover' | 'explore' | 'search' | 'artist' | 'album' | 'playlist' | 'songs' | 'playlists' | 'albums' | 'artists' | 'all' | 'liked' | 'history' | 'settings' | 'profile';

interface NavState {
  page: Page;
  param?: string;
}

function AppContent() {
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState<Track[]>(() => playerStore.queue());
  const [currentIndex, setCurrentIndex] = useState(() => playerStore.currentIndex());
  const [current, setCurrent] = useState<Track | null>(() => playerStore.current());
  const [queueOpen, setQueueOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [page, setPage] = useState<Page>('discover');
  const [pageParam, setPageParam] = useState<string | undefined>(undefined);
  const [navStack, setNavStack] = useState<NavState[]>([{ page: 'discover' }]);
  const [favs, setFavs] = useState<Track[]>(() => playerStore.favsList());
  const [history, setHistory] = useState<Track[]>(() => playerStore.historyList());
  const [isAppFs, setIsAppFs] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profilePopupOpen, setProfilePopupOpen] = useState(false);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const sugTimeout = useRef<number | null>(null);

  // Smart autoplay: extend the queue before it runs dry (never touches the engine).
  useEffect(() => startAutoplay(), []);

  // Sync with browser Back/Forward (popstate)
  useEffect(() => {
    if (!window.history.state || !window.history.state.page) {
      window.history.replaceState({ page: 'discover' }, '', '');
    }

    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.page) {
        setPage(e.state.page);
        setPageParam(e.state.param);
        setNavStack((prev) => {
          if (prev.length > 1) return prev.slice(0, -1);
          return [{ page: e.state.page, param: e.state.param }];
        });
      } else {
        setPage('discover');
        setPageParam(undefined);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // sync with playerStore
  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setQueue([...playerStore.queue()]);
      setCurrentIndex(playerStore.currentIndex());
      setCurrent(playerStore.current());
      setFavs([...playerStore.favsList()]);
      setHistory([...playerStore.historyList()]);
    });
    return () => { unsub(); };
  }, []);
  // sync glass settings for modals
  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassEnabled(settingsStore.get().glassEnabled);
      setGlassIntensity(settingsStore.get().glassIntensity);
    });
    return () => { unsub(); };
  }, []);
  // Liquid Glass theme vars — drive every .glass/.lg-* surface from settings
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const { glassEnabled: on, glassIntensity: i } = settingsStore.get();
      root.dataset.lg = on ? 'on' : 'off';
      if (!on) return;
      root.style.setProperty('--lg-blur', `${Math.round(10 + (i / 100) * 30)}px`);
      root.style.setProperty('--lg-sat', `${Math.round(140 + (i / 100) * 50)}%`);
      root.style.setProperty('--lg-bg', `rgba(255,255,255,${(0.04 + (i / 100) * 0.08).toFixed(3)})`);
      root.style.setProperty('--lg-bg-strong', `rgba(255,255,255,${(0.06 + (i / 100) * 0.1).toFixed(3)})`);
      root.style.setProperty('--lg-bg-card', `rgba(255,255,255,${(0.03 + (i / 100) * 0.06).toFixed(3)})`);
    };
    sync();
    const unsub = settingsStore.subscribe(sync);
    return () => { unsub(); };
  }, []);

  // suggestions debounce
  useEffect(() => {
    if (!query.trim() || !showSug) { setSuggestions([]); return; }
    if (sugTimeout.current) window.clearTimeout(sugTimeout.current);
    sugTimeout.current = window.setTimeout(async () => {
      try { const s = await ytmusicSuggestions(query); setSuggestions(s); } catch { setSuggestions([]); }
    }, 280);
    return () => { if (sugTimeout.current) window.clearTimeout(sugTimeout.current); };
  }, [query, showSug]);

  // close suggestions when clicking outside header
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('header')) setShowSug(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === '/') {
        e.preventDefault();
        const inputs = Array.from(document.querySelectorAll('header input')) as HTMLInputElement[];
        const visible = inputs.find(i => (i as any).offsetParent !== null) || inputs[0];
        visible?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // fullscreen
  useEffect(() => {
    const onFs = () => setIsAppFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    const onKeyFs = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); toggleFs(); }
      if (e.key === 'F11') { e.preventDefault(); toggleFs(); }
    };
    window.addEventListener('keydown', onKeyFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('keydown', onKeyFs); };
  }, []);

  // close popups on Escape
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        if (profilePopupOpen) setProfilePopupOpen(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [settingsOpen, profilePopupOpen]);

  const toggleFs = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const handleSuggestionSelect = (s: string) => { setQuery(s); setSuggestions([]); setShowSug(false); navigate('search'); };

  const handleNavbarSearch = () => {
    if (!query.trim()) return;
    navigate('search');
  };

  const playTrack = (track: Track, list: Track[] = [track]) => {
    const idx = list.findIndex(t => t.id === track.id);
    if (!queue.find(q => q.id === track.id)) playerStore.setQueue(list, idx >= 0 ? idx : 0);
    else { const qIdx = queue.findIndex(q => q.id === track.id); if (qIdx >= 0) playerStore.setIndex(qIdx); }
    if (idx === -1) playerStore.setQueue([track], 0);
  };
  const removeFromQueue = (idx: number) => { playerStore.removeFromQueue(idx); };
  const playIndex = (i: number) => playerStore.setIndex(i);

  const navigate = (p: Page, param?: string) => {
    if (p === 'settings') { setSettingsOpen(true); return; }
    if (p === 'profile') { setProfilePopupOpen(true); return; }
    setNavStack((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.page === p && top.param === (param || undefined)) {
        return prev;
      }
      return [...prev, { page: p, param: param || undefined }];
    });
    setPage(p);
    setPageParam(param || undefined);
    window.history.pushState({ page: p, param: param || undefined }, '', '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    if (window.history.state?.page && navStack.length > 1) {
      window.history.back();
    } else if (navStack.length > 1) {
      const nextStack = navStack.slice(0, -1);
      const prev = nextStack[nextStack.length - 1];
      setNavStack(nextStack);
      setPage(prev.page);
      setPageParam(prev.param);
    } else {
      navigate('discover');
    }
  };

  const canGoBack = navStack.length > 1 || page !== 'discover';

  const renderPage = () => {
    if (page === 'discover') return <HomePage onPlay={playTrack} onPlayPlaylist={(id) => navigate('playlist', id)} onNavigate={(p, param) => navigate(p as Page, param)} history={queue.length ? queue : favs.length ? favs : history} />;
    if (page === 'search') return <SearchPage onPlay={playTrack} initialQuery={query} onQueryChange={setQuery} onNavigate={(p, param) => navigate(p as Page, param)} />;
    if (page === 'explore') return <ExplorePage onPlay={playTrack} onPlayPlaylist={(id) => navigate('playlist', id)} onSearch={(q) => { setQuery(q); navigate('search'); }} onNavigate={(p, param) => navigate(p as Page, param)} />;
    if (page === 'artist') return <ArtistPage artistId={pageParam} onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} onBack={goBack} />;
    if (page === 'album') return <AlbumPage albumId={pageParam} onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} onBack={goBack} />;
    if (page === 'playlist') return <PlaylistPage playlistId={pageParam} onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} onBack={goBack} />;
    if (page === 'playlists') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="playlists" />;
    if (page === 'albums') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="albums" />;
    if (page === 'artists') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="artists" />;
    if (page === 'liked') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="favs" />;
    if (page === 'history') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="recent" />;
    if (page === 'songs') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="songs" />;
    return <HomePage onPlay={playTrack} onPlayPlaylist={(id) => navigate('playlist', id)} onNavigate={(p, param) => navigate(p as Page, param)} history={queue.length ? queue : favs.length ? favs : history} />;
  };

  return (
    <div className="h-[100dvh] w-full max-w-[100vw] overflow-hidden overflow-x-hidden flex flex-col bg-black text-white antialiased selection:bg-white selection:text-black">
      {/* Dynamic cover-art background */}
      {glassEnabled && current?.thumbnail && (
        <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
          <img
            key={current.thumbnail}
            src={current.thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover scale-110"
            style={{
              filter: `blur(${glassEnabled ? Math.round(48 + (glassIntensity / 100) * 32) : 64}px)`,
              opacity: glassEnabled ? 0.22 : 0.18,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: glassEnabled
                ? `rgba(0,0,0,${(0.72 - (glassIntensity / 100) * 0.22).toFixed(2)})`
                : 'rgba(0,0,0,0.68)',
              backdropFilter: `blur(${glassEnabled ? Math.round((glassIntensity / 100) * 8) : 8}px)`,
              WebkitBackdropFilter: `blur(${glassEnabled ? Math.round((glassIntensity / 100) * 8) : 8}px)`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
        </div>
      )}
      {/* AMOLED — void orbs */}
      {glassEnabled && (
      <>
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[680px] w-[1020px] -translate-x-1/2 rounded-full bg-gradient-to-r from-white/[0.025] via-white/[0.015] to-white/[0.01] blur-[130px]" />
        {/* Liquid Glass iridescence — whisper of refracted color in the void */}
        <div className="absolute top-[-8%] left-[6%] h-[420px] w-[420px] rounded-full bg-indigo-500/[0.05] blur-[130px]" />
        <div className="absolute bottom-[4%] right-[2%] h-[380px] w-[380px] rounded-full bg-cyan-400/[0.04] blur-[130px]" />
        <div className="absolute top-[44%] -right-24 h-[560px] w-[560px] rounded-full bg-white/[0.012] blur-[150px]" />
        <div className="absolute bottom-0 left-[-10%] h-[520px] w-[720px] rounded-full bg-white/[0.018] blur-[140px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/[0.012]" />
      </div>
      {/* Glass background */}
      <div className="pointer-events-none fixed inset-0 -z-[5] bg-white/[0.02] backdrop-blur-[20px] ring-1 ring-white/[0.03] ring-inset" />
      </>
      )}

      {/* Rebuilt Mixed Navbar — sidebar + navbar combined */}
      <WavePlayerNavbar
          query={query}
          onQueryChange={(v) => { setQuery(v); if (v.trim().length >= 1) setShowSug(true); else setShowSug(false); }}
          onSearch={handleNavbarSearch}
          onNavigateSearch={handleNavbarSearch}
          queueCount={queue.length}
          onOpenQueue={() => setQueueOpen(true)}
          suggestions={showSug ? suggestions : []}
          onSelectSuggestion={handleSuggestionSelect}
          onFocusSuggestions={() => query.trim() && setShowSug(true)}
          isFullscreen={isAppFs}
          onToggleFullscreen={toggleFs}
          onNavigate={(p) => navigate(p as Page)}
          canGoBack={canGoBack}
          onBack={goBack}
          active={page}
          onActive={(s) => navigate(s as Page)}
          favCount={favs.length}
        />

        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin scroll-smooth overflow-x-clip">
          <div className="w-full max-w-[1200px] mx-auto px-3 min-[400px]:px-4 sm:px-6 lg:px-8 pt-[100px] sm:pt-[120px] space-y-5 sm:space-y-6 pb-[calc(228px+env(safe-area-inset-bottom))] sm:pb-[calc(240px+env(safe-area-inset-bottom))] lg:pb-[120px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {renderPage()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[45] bg-black/60"
              style={
                glassEnabled
                  ? {
                      backdropFilter: `blur(${Math.round(8 + (glassIntensity / 100) * 12)}px)`,
                      WebkitBackdropFilter: `blur(${Math.round(8 + (glassIntensity / 100) * 12)}px)`,
                    }
                  : {}
              }
              onClick={() => setSettingsOpen(false)}
            />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div
                className="relative w-full max-w-[640px] max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 glass-panel flex flex-col"
                style={
                  glassEnabled
                    ? {
                        backgroundColor: `rgba(18,18,18,${(0.55 + (glassIntensity / 100) * 0.25).toFixed(2)})`,
                        backdropFilter: `blur(${Math.round((glassIntensity / 100) * 24)}px) saturate(180%) brightness(1.08)`,
                        WebkitBackdropFilter: `blur(${Math.round((glassIntensity / 100) * 24)}px) saturate(180%) brightness(1.08)`,
                      }
                    : { backgroundColor: '#0f0f0f' }
                }
              >
                <button onClick={() => setSettingsOpen(false)} className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/10 hover:bg-white text-white hover:text-black flex items-center justify-center z-10 border border-white/10">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex-1 overflow-y-auto p-6 scrollbar-none">
                  <SettingsPage />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {profilePopupOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[45] bg-black/60"
              style={
                glassEnabled
                  ? {
                      backdropFilter: `blur(${Math.round(8 + (glassIntensity / 100) * 12)}px)`,
                      WebkitBackdropFilter: `blur(${Math.round(8 + (glassIntensity / 100) * 12)}px)`,
                    }
                  : {}
              }
              onClick={() => setProfilePopupOpen(false)}
            />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div
                className="relative w-full max-w-[480px] max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 glass-panel flex flex-col"
                style={
                  glassEnabled
                    ? {
                        backgroundColor: `rgba(18,18,18,${(0.55 + (glassIntensity / 100) * 0.25).toFixed(2)})`,
                        backdropFilter: `blur(${Math.round((glassIntensity / 100) * 24)}px) saturate(180%) brightness(1.08)`,
                        WebkitBackdropFilter: `blur(${Math.round((glassIntensity / 100) * 24)}px) saturate(180%) brightness(1.08)`,
                      }
                    : { backgroundColor: '#0f0f0f' }
                }
              >
                <button onClick={() => setProfilePopupOpen(false)} className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/10 hover:bg-white text-white hover:text-black flex items-center justify-center z-10 border border-white/10">
                  <X className="h-4 w-4" />
                </button>
                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                  <ProfilePage />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <PlayerBar onOpenQueue={() => setQueueOpen(true)} />
      <BottomNavigation active={page} onChange={(p) => navigate(p as Page)} />
      <QueueDrawer open={queueOpen} queue={queue} currentIndex={currentIndex} onClose={() => setQueueOpen(false)} onPlayIndex={playIndex} onClear={() => { playerStore.clearQueue(); setQueueOpen(false); }} onRemove={removeFromQueue} />
      <ToastViewport />
    </div>
  );
}

export default function App() {
  return <AppContent />;
}
