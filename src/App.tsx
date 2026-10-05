import React, { Suspense, lazy, useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2 } from 'lucide-react';
import { AppHeader } from './components/layout/AppHeader';
import { DesktopSidebar } from './components/layout/DesktopSidebar';
import { ArtworkBackground } from './components/ui/ArtworkBackground';
import { PlayerBar } from './components/PlayerBar';
import { QueueDrawer } from './components/QueueDrawer';
import { ToastViewport, toast } from './components/Toast';
import { PwaChrome } from './components/PwaChrome';
import { RouteBoundary } from './components/RouteBoundary';
import { BottomNavigation } from './components/BottomNavigation';
import { perfMark, perfMeasure } from './services/perf';

// Critical shell stays eager (Home + player chrome). Secondary pages split
// into lazy chunks for fast first paint; header prefetches on focus.
import { HomePage } from './pages/Home';
const SearchPage = lazy(() => import('./pages/Search').then((m) => ({ default: m.SearchPage })));
const LibraryPage = lazy(() => import('./pages/Library').then((m) => ({ default: m.LibraryPage })));
const ArtistPage = lazy(() => import('./pages/Artist').then((m) => ({ default: m.ArtistPage })));
const AlbumPage = lazy(() => import('./pages/Album').then((m) => ({ default: m.AlbumPage })));
const PlaylistPage = lazy(() => import('./pages/Playlist').then((m) => ({ default: m.PlaylistPage })));
const NowPlayingPage = lazy(() => import('./pages/NowPlaying').then((m) => ({ default: m.NowPlayingPage })));
const ExplorePage = lazy(() => import('./pages/Explore').then((m) => ({ default: m.ExplorePage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })));

import { usePlaybackShortcuts } from './hooks/usePlaybackShortcuts';
import { ytmusicSuggestions } from './services/ytmusicApi';
import { playerStore } from './services/playerStore';
import { googleAccountStore } from './hooks/useGoogleAccount';
import { ensureAccountIsolation } from './services/accountSync';
import { startAutoplay } from './services/autoplay';
import { startScrobbleService } from './services/scrobbleService';
import { registerScrobbleProviders } from './services/scrobbleProviders';
import { startDiscordPresence } from './services/discordPresence';
import { settingsStore } from './services/settingsStore';
import { Playlist, Track } from './types';
import { playPlaylist } from './services/playlistPlayback';

type Page = 'discover' | 'explore' | 'search' | 'artist' | 'album' | 'playlist' | 'nowplaying' | 'songs' | 'playlists' | 'albums' | 'artists' | 'all' | 'liked' | 'history' | 'settings' | 'profile';

interface NavState {
  page: Page;
  param?: string;
}

const pageLoaders: Record<string, () => Promise<unknown>> = {
  search: () => import('./pages/Search'),
  explore: () => import('./pages/Explore'),
  playlists: () => import('./pages/Library'),
  artist: () => import('./pages/Artist'),
  album: () => import('./pages/Album'),
  playlist: () => import('./pages/Playlist'),
  nowplaying: () => import('./pages/NowPlaying'),
  settings: () => import('./pages/Settings'),
  profile: () => import('./pages/Profile'),
};

const prefetchedPages = new Set<string>();
export function prefetchPage(page: string): void {
  if (prefetchedPages.has(page)) return;
  const load = pageLoaders[page];
  if (!load) return;
  prefetchedPages.add(page);
  try {
    const idle = (window as any).requestIdleCallback as ((cb: () => void) => void) | undefined;
    if (typeof idle === 'function') idle(() => void load().catch(() => {}));
    else void load().catch(() => {});
  } catch { /* prefetch is best-effort */ }
}

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading page">
      <Loader2 className="h-6 w-6 animate-spin text-white/40" />
    </div>
  );
}

function AppContent() {
  useEffect(() => {
    perfMark('shell:ready');
    perfMeasure('startup', 'bootstrap', 'shell:ready');
  }, []);

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
  const playlistPlaybackPending = useRef(false);

  // Smart autoplay
  useEffect(() => startAutoplay(), []);

  // Account isolation
  useEffect(() => googleAccountStore.subscribe(() => {
    ensureAccountIsolation();
  }), []);

  // Transport keyboard shortcuts
  usePlaybackShortcuts(true);

  // Background services: scrobbling + presence
  useEffect(() => {
    registerScrobbleProviders();
    const off1 = startScrobbleService();
    const off2 = startDiscordPresence();
    return () => {
      off1();
      off2();
    };
  }, []);

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

  // Sync with playerStore
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

  // Sync glass settings
  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassEnabled(settingsStore.get().glassEnabled);
      setGlassIntensity(settingsStore.get().glassIntensity);
    });
    return () => { unsub(); };
  }, []);

  // Theme variables sync
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

  // Suggestions debounce
  useEffect(() => {
    if (!query.trim() || !showSug) { setSuggestions([]); return; }
    if (sugTimeout.current) window.clearTimeout(sugTimeout.current);
    sugTimeout.current = window.setTimeout(async () => {
      try { const s = await ytmusicSuggestions(query); setSuggestions(s); } catch { setSuggestions([]); }
    }, 280);
    return () => { if (sugTimeout.current) window.clearTimeout(sugTimeout.current); };
  }, [query, showSug]);

  // Global search shortcut (/)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
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

  // Fullscreen shortcuts
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

  // Close modals on Escape
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

  const handleSuggestionSelect = (s: string) => {
    setQuery(s);
    setSuggestions([]);
    setShowSug(false);
    navigate('search');
  };

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

  const handlePlayPlaylist = async (playlist: Playlist) => {
    if (playlistPlaybackPending.current) return;
    playlistPlaybackPending.current = true;
    toast.info(`Loading ${playlist.name}…`);
    try {
      await playPlaylist(playlist);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      toast.error(code === 'NO_PLAYABLE_TRACKS' ? 'This playlist has no playable tracks.' : 'Unable to load this playlist.');
    } finally {
      playlistPlaybackPending.current = false;
    }
  };

  const removeFromQueue = (idx: number) => { playerStore.removeFromQueue(idx); };
  const playIndex = (i: number) => playerStore.setIndex(i);

  const navigate = useCallback((p: Page, param?: string) => {
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
    perfMark(`nav:${p}`);
  }, []);

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
    if (page === 'discover') return <HomePage onPlay={playTrack} onPlayPlaylist={(playlist) => void handlePlayPlaylist(playlist)} onNavigate={(p, param) => navigate(p as Page, param)} history={queue.length ? queue : favs.length ? favs : history} />;
    if (page === 'search') return <SearchPage onPlay={playTrack} onPlayPlaylist={(playlist) => void handlePlayPlaylist(playlist)} initialQuery={query} onQueryChange={setQuery} onNavigate={(p, param) => navigate(p as Page, param)} />;
    if (page === 'explore') return <ExplorePage onPlay={playTrack} onPlayPlaylist={(playlist) => void handlePlayPlaylist(playlist)} onSearch={(q) => { setQuery(q); navigate('search'); }} onNavigate={(p, param) => navigate(p as Page, param)} />;
    if (page === 'artist') return <ArtistPage artistId={pageParam} onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} onBack={goBack} />;
    if (page === 'album') return <AlbumPage albumId={pageParam} onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} onBack={goBack} />;
    if (page === 'playlist') return <PlaylistPage playlistId={pageParam} onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} onBack={goBack} />;
    if (page === 'nowplaying') return <NowPlayingPage onNavigate={(p, param) => navigate(p as Page, param)} onBack={goBack} onOpenQueue={() => setQueueOpen(true)} />;
    if (page === 'playlists') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="playlists" />;
    if (page === 'albums') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="albums" />;
    if (page === 'artists') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="artists" />;
    if (page === 'liked') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="favs" />;
    if (page === 'history') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="recent" />;
    if (page === 'songs') return <LibraryPage onPlay={playTrack} onNavigate={(p, param) => navigate(p as Page, param)} initialTab="songs" />;
    return <HomePage onPlay={playTrack} onPlayPlaylist={(playlist) => void handlePlayPlaylist(playlist)} onNavigate={(p, param) => navigate(p as Page, param)} history={queue.length ? queue : favs.length ? favs : history} />;
  };

  // Fullscreen takeover for Now Playing — strip all app chrome so only
  // the player panel is visible (no header, sidebar, nav, mini player).
  const isNowPlaying = page === 'nowplaying';

  return (
    <div className="flex h-[100dvh] w-full max-w-[100vw] overflow-hidden bg-black text-white antialiased selection:bg-white selection:text-black">
      {/* Artwork-driven ambient background (hidden in Now Playing takeover) */}
      {!isNowPlaying && <ArtworkBackground thumbnail={current?.thumbnail} />}

      {/* Desktop Sidebar (hidden on mobile + Now Playing takeover) */}
      {!isNowPlaying && (
        <DesktopSidebar
          active={page}
          onNavigate={(p, param) => navigate(p as Page, param)}
          favCount={favs.length}
        />
      )}

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* App Top Bar (hidden in Now Playing takeover) */}
        {!isNowPlaying && (
          <AppHeader
            query={query}
            onQueryChange={(v) => {
              setQuery(v);
              if (v.trim().length >= 1) setShowSug(true);
              else setShowSug(false);
            }}
            onSearch={handleNavbarSearch}
            onNavigateSearch={handleNavbarSearch}
            suggestions={showSug ? suggestions : []}
            onSelectSuggestion={handleSuggestionSelect}
            onFocusSuggestions={() => {
              prefetchPage('search');
              if (query.trim()) setShowSug(true);
            }}
            isFullscreen={isAppFs}
            onToggleFullscreen={toggleFs}
            onNavigate={(p, param) => navigate(p as Page, param)}
            canGoBack={canGoBack}
            onBack={goBack}
            active={page}
          />
        )}

        {/* Scrollable Main Area */}
        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin scroll-smooth overflow-x-clip">
          <div className={isNowPlaying
            ? 'w-full'
            : 'w-full max-w-7xl mx-auto px-3.5 min-[400px]:px-4 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-[calc(148px+env(safe-area-inset-bottom))] lg:pb-[110px]'}>
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <Suspense fallback={<PageFallback />}>
                  <RouteBoundary pageKey={`${page}:${pageParam || ''}`}>
                    {renderPage()}
                  </RouteBoundary>
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[45] bg-black/70 backdrop-blur-md"
              onClick={() => setSettingsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
            >
              <div
                className="relative w-full max-w-[640px] max-h-[88vh] overflow-hidden rounded-3xl border border-white/10 bg-[#121215] shadow-2xl flex flex-col"
              >
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="touch-target absolute top-3.5 right-3.5 h-9 w-9 rounded-full bg-white/10 hover:bg-white text-white hover:text-black flex items-center justify-center z-10 border border-white/10 transition-colors"
                  title="Close"
                  aria-label="Close settings"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex-1 overflow-y-auto p-5 sm:p-6 scrollbar-thin">
                  <SettingsPage />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {profilePopupOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[45] bg-black/70 backdrop-blur-md"
              onClick={() => setProfilePopupOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
            >
              <div
                className="relative w-full max-w-[480px] max-h-[88vh] overflow-hidden rounded-3xl border border-white/10 bg-[#121215] shadow-2xl flex flex-col"
              >
                <button
                  onClick={() => setProfilePopupOpen(false)}
                  className="touch-target absolute top-3.5 right-3.5 h-9 w-9 rounded-full bg-white/10 hover:bg-white text-white hover:text-black flex items-center justify-center z-10 border border-white/10 transition-colors"
                  title="Close"
                  aria-label="Close profile"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex-1 overflow-y-auto p-5 sm:p-6 scrollbar-thin">
                  <ProfilePage />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Persistent Player Chrome + Bottom Navigation (chrome hidden in Now Playing takeover) */}
      <PlayerBar
        onOpenQueue={() => setQueueOpen(true)}
        onOpenNowPlaying={useCallback(() => navigate('nowplaying'), [navigate])}
        hideMini={isNowPlaying}
      />
      {!isNowPlaying && (
        <BottomNavigation
          active={page}
          onChange={(p) => navigate(p as Page)}
          onPrefetch={(p) => prefetchPage(p)}
        />
      )}
      <QueueDrawer
        open={queueOpen}
        queue={queue}
        currentIndex={currentIndex}
        onClose={() => setQueueOpen(false)}
        onPlayIndex={playIndex}
        onClear={() => { playerStore.clearQueue(); setQueueOpen(false); }}
        onRemove={removeFromQueue}
        onNavigate={(p, param) => navigate(p as Page, param)}
      />
      <PwaChrome />
      <ToastViewport />
    </div>
  );
}

export default function App() {
  return <AppContent />;
}
