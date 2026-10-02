import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search as SearchIcon,
  Clock,
  Music,
  Disc3,
  ListMusic,
  Mic2,
  X,
  Heart,
  Loader2,
  Play,
  Pause,
  Sparkles,
  ChevronRight,
  RotateCw,
  Radio,
  MoreVertical,
  CheckCircle2,
  Compass,
  ArrowRight,
  TrendingUp,
  Volume2,
} from 'lucide-react';
import { Track, SearchArtist, Album, Playlist, SearchFilter } from '../types';
import { playerStore } from '../services/playerStore';
import { usePlayerEngine } from '../services/playerEngine';
import {
  executeUnifiedSearch,
  getUnifiedSuggestions,
  getRecentSearches,
  saveRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
  nextSearchRun,
  isStaleRun,
  searchWavePlaylists,
  deduplicatePlaylists,
  UnifiedSearchResults,
  TopResultItem,
} from '../services/searchEngine';
import { getLocalPlaylists } from '../services/libraryStore';
import { getSaavnBrowseModules } from '../services/saavnApi';
import { fetchRadio } from '../services/recommendationApi';
import { startRadioAndPlay } from '../services/radioEngine';
import { SongRow } from '../components/SongRow';
import { SongContextMenu } from '../components/SongContextMenu';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'artists', label: 'Artists' },
  { id: 'albums', label: 'Albums' },
  { id: 'playlists', label: 'Playlists' },
];

const EMPTY_COPY: Record<SearchFilter, { title: string; hint: string }> = {
  all: { title: 'No results found', hint: 'Check spelling or try exploring popular artists and albums.' },
  songs: { title: 'No songs found', hint: 'Try a different title, artist, or check your spelling.' },
  videos: { title: 'No videos found', hint: 'Try a different title, artist, or check your spelling.' },
  artists: { title: 'No artists found', hint: 'Try the full artist name or check your spelling.' },
  albums: { title: 'No albums found', hint: 'Try the full album or artist name.' },
  playlists: { title: 'No playlists found', hint: 'Try a mood, genre, or artist name instead.' },
};

/**
 * Merge device-local Wave playlists into provider results (Wave first,
 * deduped). Private YouTube playlists stay out of global search — they
 * surface only in Library for the signed-in owner.
 */
function withWavePlaylists(results: UnifiedSearchResults, query: string): UnifiedSearchResults {
  if (!results) return results;
  let wave: Playlist[] = [];
  try {
    wave = searchWavePlaylists(query, getLocalPlaylists());
  } catch {
    wave = [];
  }
  if (!wave.length) return results;
  const seen = new Set(wave.map((p) => p.playlistId));
  const rest = (results.playlists || []).filter((p) => p?.playlistId && !seen.has(p.playlistId));
  return { ...results, playlists: deduplicatePlaylists([...wave, ...rest]) };
}

const POPULAR_SEARCH_CHIPS = [
  'Arijit Singh',
  'The Weeknd',
  'Taylor Swift',
  'AP Dhillon',
  'Bollywood Hits',
  'Lofi Chill',
  'Punjabi Hits',
  'Anuv Jain',
];

export const SearchPage: React.FC<{
  onPlay: (t: Track, list?: Track[]) => void;
  initialQuery?: string;
  onQueryChange?: (q: string) => void;
  onNavigate?: (page: string, param?: string) => void;
}> = ({ onPlay, initialQuery = '', onQueryChange, onNavigate }) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeFilter, setActiveFilter] = useState<SearchFilter>('all');
  const [results, setResults] = useState<UnifiedSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => getRecentSearches());

  // Suggestions
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSugIdx, setSelectedSugIdx] = useState(-1);

  // Browse Discovery Data for Empty State
  const [browseTrending, setBrowseTrending] = useState<Track[]>([]);
  const [browseAlbums, setBrowseAlbums] = useState<Album[]>([]);
  const [browsePlaylists, setBrowsePlaylists] = useState<Playlist[]>([]);
  const [browseLoading, setBrowseLoading] = useState(true);

  // Player Engine State
  const { isPlaying } = usePlayerEngine();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => playerStore.current());

  // Context Menu & Add to Playlist Modals
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [playlistModalTracks, setPlaylistModalTracks] = useState<Track[]>([]);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const sugTimeoutRef = useRef<number | null>(null);

  // Toast Auto-dismiss
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Player Store subscription
  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setCurrentTrack(playerStore.current());
    });
    return () => {
      unsub();
    };
  }, []);

  // Keyboard shortcut: Ctrl + K or / to focus search input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load Browse Modules for Idle/Empty State
  useEffect(() => {
    let isMounted = true;
    getSaavnBrowseModules()
      .then((modules) => {
        if (!isMounted) return;
        setBrowseTrending(modules.trending?.slice(0, 8) || []);
        setBrowseAlbums(modules.newAlbums?.slice(0, 6) || []);
        setBrowsePlaylists(modules.topPlaylists?.slice(0, 6) || []);
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setBrowseLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Debounced Unified Search
  const performSearch = useCallback(
    async (q: string, filter: SearchFilter = activeFilter) => {
      const cleanQ = q.trim();
      if (!cleanQ) {
        setResults(null);
        setSearched(false);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setSearched(true);
      setShowSuggestions(false);
      const runId = nextSearchRun();

      // Save to recent
      const updatedRecent = saveRecentSearch(cleanQ);
      setRecent(updatedRecent);
      onQueryChange?.(cleanQ);

      try {
        const searchResults = await executeUnifiedSearch(
          cleanQ,
          filter,
          (partial) => {
            if (isStaleRun(runId)) return;
            setResults(withWavePlaylists(partial, cleanQ));
            setLoading(false);
          },
          runId,
        );
        if (isStaleRun(runId)) return;
        setResults(withWavePlaylists(searchResults, cleanQ));
      } catch (err: any) {
        if (isStaleRun(runId)) return;
        console.error('[SearchPage] search error:', err);
        setError('Search is temporarily unavailable. Please try again.');
      } finally {
        if (!isStaleRun(runId)) setLoading(false);
      }
    },
    [activeFilter, onQueryChange]
  );

  // Trigger search on query change (300ms debounce)
  useEffect(() => {
    if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
    const cleanQ = query.trim();

    if (!cleanQ) {
      setResults(null);
      setSearched(false);
      setError(null);
      setLoading(false);
      setSuggestions([]);
      return;
    }

    searchTimeoutRef.current = window.setTimeout(() => {
      void performSearch(cleanQ, activeFilter);
    }, 320);

    return () => {
      if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
    };
  }, [query, activeFilter, performSearch]);

  // Suggestions Fetcher (150ms debounce)
  useEffect(() => {
    if (sugTimeoutRef.current) window.clearTimeout(sugTimeoutRef.current);
    const cleanQ = query.trim();

    if (!cleanQ || cleanQ.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    sugTimeoutRef.current = window.setTimeout(async () => {
      const sugs = await getUnifiedSuggestions(cleanQ, getRecentSearches());
      setSuggestions(sugs);
      setShowSuggestions(sugs.length > 0);
      setSelectedSugIdx(-1);
    }, 160);

    return () => {
      if (sugTimeoutRef.current) window.clearTimeout(sugTimeoutRef.current);
    };
  }, [query]);

  const handleApplySearch = (text: string) => {
    setQuery(text);
    onQueryChange?.(text);
    setShowSuggestions(false);
    void performSearch(text, activeFilter);
  };

  const handleClear = () => {
    setQuery('');
    onQueryChange?.('');
    setResults(null);
    setSearched(false);
    setError(null);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleRemoveRecent = (item: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = removeRecentSearch(item);
    setRecent(updated);
  };

  const handleClearAllRecent = () => {
    clearRecentSearches();
    setRecent([]);
  };

  // Keyboard navigation for search input and suggestions
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      return;
    }

    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSugIdx((prev) => (prev + 1 < suggestions.length ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSugIdx((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedSugIdx >= 0 && selectedSugIdx < suggestions.length) {
          handleApplySearch(suggestions[selectedSugIdx]);
        } else {
          handleApplySearch(query);
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleApplySearch(query);
    }
  };

  // Start Radio from Artist or Song (smart session radio)
  const handleStartRadio = async (seed: Track | SearchArtist) => {
    try {
      if ('title' in seed) {
        setToastMessage(`Starting Radio for "${seed.title}"...`);
        await startRadioAndPlay('track', { track: seed });
      } else {
        setToastMessage(`Starting ${seed.name} Radio...`);
        const artistSeed: Track = {
          id: seed.artistId,
          title: seed.name,
          author: seed.name,
          thumbnail: seed.thumbnails?.[0]?.url || '',
          duration: '3:30',
          durationSeconds: 210,
          url: '',
          type: 'SONG',
        };
        await startRadioAndPlay('artist', {
          track: artistSeed,
          artistId: seed.artistId,
          artistName: seed.name,
        });
      }
    } catch {
      setToastMessage('Could not start radio');
    }
  };

  // Context Menu Handlers
  const handleOpenContextMenu = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuTrack(track);
    setIsMenuOpen(true);
  };

  const handleOpenAddToPlaylist = (track: Track) => {
    setPlaylistModalTracks([track]);
    setIsPlaylistModalOpen(true);
  };

  const isIdle = !searched && !loading && !results && !error;
  const isEmpty =
    searched &&
    !loading &&
    !error &&
    results &&
    !results.tracks.length &&
    !results.artists.length &&
    !results.albums.length &&
    !results.playlists.length;

  return (
    <div className="w-full space-y-6 pb-24">
      {/* ======================================================= */}
      {/* 1. PROMINENT SEARCH HEADER & SEARCH BAR */}
      {/* ======================================================= */}
      <div className="sticky top-0 z-20 -mx-3 sm:-mx-6 lg:-mx-8 px-3 sm:px-6 lg:px-8 pt-2 pb-3 bg-black/85 backdrop-blur-2xl border-b border-white/[0.06]">
        <div className="relative max-w-3xl mx-auto">
          <div className="relative flex items-center gap-2 rounded-full bg-white px-3 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)] ring-1 ring-white/20 transition-all focus-within:ring-2 focus-within:ring-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white shrink-0 shadow-sm">
              <SearchIcon className="h-4 w-4" />
            </span>

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              placeholder="What do you want to listen to?"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-[15px] sm:text-[16px] font-semibold text-black placeholder:text-black/40 outline-none min-w-0"
              aria-label="Search music"
            />

            {loading && <Loader2 className="h-4 w-4 animate-spin text-black/50 shrink-0 mr-1" />}

            {query ? (
              <button
                type="button"
                onClick={handleClear}
                className="h-8 w-8 rounded-full bg-black/5 hover:bg-black text-black hover:text-white grid place-items-center shrink-0 transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <div className="hidden sm:flex items-center gap-1 text-[11px] font-mono font-bold text-black/40 bg-black/[0.06] rounded-md px-2 py-1 select-none">
                <span>Ctrl</span>
                <span>K</span>
              </div>
            )}
          </div>

          {/* Autocomplete Suggestions Dropdown */}
          <AnimatePresence>
            {showSuggestions && suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 right-0 mt-2 z-30 rounded-[20px] bg-[#161619] border border-white/15 shadow-[0_20px_48px_rgba(0,0,0,0.85)] backdrop-blur-2xl overflow-hidden py-2"
              >
                {suggestions.map((sug, idx) => (
                  <button
                    key={`sug-${sug}-${idx}`}
                    type="button"
                    onClick={() => handleApplySearch(sug)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold transition-colors ${
                      selectedSugIdx === idx
                        ? 'bg-white text-black'
                        : 'text-white/90 hover:bg-white/10'
                    }`}
                  >
                    <SearchIcon className="h-3.5 w-3.5 opacity-50 shrink-0" />
                    <span className="truncate">{sug}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Filter Tabs (All, Songs, Videos, Artists, Albums, Playlists) */}
        {(query.trim().length > 0 || searched) && (
          <div className="max-w-3xl mx-auto mt-3 flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            {FILTERS.map((f) => {
              const active = activeFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setActiveFilter(f.id);
                    if (query.trim()) void performSearch(query, f.id);
                  }}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs sm:text-[13px] font-bold border transition-all ${
                    active
                      ? 'bg-white text-black border-white shadow-sm'
                      : 'bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.10] hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ======================================================= */}
      {/* 2. IDLE STATE: RECENT SEARCHES & BROWSE DISCOVERY */}
      {/* ======================================================= */}
      <AnimatePresence mode="wait">
        {isIdle && (
          <motion.div
            key="idle-browse"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-8"
          >
            {/* Recent Searches */}
            {recent.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93] flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-cyan-400" /> Recent Searches
                  </h2>
                  <button
                    type="button"
                    onClick={handleClearAllRecent}
                    className="text-xs font-semibold text-white/40 hover:text-white transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((r) => (
                    <div
                      key={r}
                      onClick={() => handleApplySearch(r)}
                      className="group inline-flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white cursor-pointer transition-all active:scale-95"
                    >
                      <Clock className="h-3.5 w-3.5 text-white/40 group-hover:text-cyan-400" />
                      <span>{r}</span>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveRecent(r, e)}
                        className="h-4 w-4 rounded-full text-white/30 hover:text-white hover:bg-white/20 flex items-center justify-center transition-colors ml-0.5"
                        title="Remove from recent searches"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Popular Searches */}
            <div className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93] flex items-center gap-1.5 px-1">
                <TrendingUp className="h-3.5 w-3.5 text-amber-400" /> Popular Searches
              </h2>
              <div className="flex flex-wrap gap-2">
                {POPULAR_SEARCH_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleApplySearch(chip)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] hover:bg-white text-white/80 hover:text-black border border-white/[0.08] hover:border-white px-4 py-2 text-xs sm:text-sm font-semibold transition-all active:scale-95 shadow-sm"
                  >
                    <SearchIcon className="h-3.5 w-3.5 opacity-40" />
                    <span>{chip}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Trending Now Rail */}
            {browseTrending.length > 0 && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[17px] sm:text-[19px] font-extrabold text-white tracking-tight flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-orange-400" /> Trending Music
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {browseTrending.slice(0, 8).map((track, idx) => {
                    const isActive = currentTrack?.id === track.id;
                    return (
                      <div
                        key={`trend-${track.id}-${idx}`}
                        onClick={() => onPlay(track, browseTrending)}
                        className={`group flex items-center gap-3 p-2 rounded-[16px] border transition-all cursor-pointer select-none ${
                          isActive
                            ? 'bg-white/[0.12] border-white/20'
                            : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] hover:border-white/15'
                        }`}
                      >
                        <div className="relative h-11 w-11 rounded-[12px] overflow-hidden bg-[#1a1a1c] shrink-0 ring-1 ring-white/10">
                          <img
                            src={track.thumbnail}
                            alt={track.title}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Play className="h-4 w-4 fill-white text-white ml-0.5" />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs sm:text-[13px] font-bold text-white">
                            {track.title}
                          </p>
                          <p className="truncate text-[11px] text-[#8e8e93] font-medium">
                            {track.author}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* New Release Albums */}
            {browseAlbums.length > 0 && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[17px] sm:text-[19px] font-extrabold text-white tracking-tight flex items-center gap-2">
                    <Disc3 className="h-4 w-4 text-cyan-400" /> New Releases
                  </h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
                  {browseAlbums.map((album) => (
                    <div
                      key={album.albumId}
                      onClick={() => onNavigate?.('album', album.albumId)}
                      className="group cursor-pointer rounded-[20px] bg-white/[0.03] border border-white/10 p-2.5 hover:bg-white/[0.08] hover:border-white/20 transition-all"
                    >
                      <div className="relative aspect-square w-full rounded-[14px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                        <img
                          src={album.thumbnails?.[0]?.url || ''}
                          alt={album.name}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <span className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          </span>
                        </div>
                      </div>
                      <p className="truncate text-xs sm:text-[13px] font-bold text-white mt-2 group-hover:text-cyan-300">
                        {album.name}
                      </p>
                      <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                        {album.artist?.name || 'Various'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ======================================================= */}
        {/* 3. LOADING SKELETON */}
        {/* ======================================================= */}
        {loading && !results && (
          <motion.div
            key="loading-skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-6 pt-4"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-white/50 px-1">
              <Loader2 className="h-4 w-4 animate-spin text-white" /> Searching across YouTube Music & JioSaavn...
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1 h-56 rounded-[24px] bg-white/[0.04] border border-white/5 animate-pulse" />
              <div className="lg:col-span-2 space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-14 rounded-2xl bg-white/[0.04] border border-white/5 animate-pulse" />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ======================================================= */}
        {/* 4. ERROR STATE */}
        {/* ======================================================= */}
        {error && !loading && (
          <motion.div
            key="error-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-16 text-center space-y-4"
          >
            <div className="h-12 w-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <X className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Search temporarily unavailable</h3>
              <p className="text-xs text-[#8e8e93] mt-1">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void performSearch(query, activeFilter)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 shadow-md"
            >
              <RotateCw className="h-3.5 w-3.5" /> Try Again
            </button>
          </motion.div>
        )}

        {/* ======================================================= */}
        {/* 5. NO RESULTS STATE */}
        {/* ======================================================= */}
        {isEmpty && (
          <motion.div
            key="empty-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-16 text-center space-y-4"
          >
            <div className="h-12 w-12 rounded-full bg-white/10 text-white/50 flex items-center justify-center mx-auto">
              <SearchIcon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                {EMPTY_COPY[activeFilter].title} for “{query}”
              </h3>
              <p className="text-xs text-[#8e8e93] mt-1">
                {EMPTY_COPY[activeFilter].hint}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {POPULAR_SEARCH_CHIPS.slice(0, 5).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleApplySearch(chip)}
                  className="rounded-full bg-white/[0.08] hover:bg-white hover:text-black border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition-all"
                >
                  {chip}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ======================================================= */}
        {/* 6. SEARCH RESULTS (ALL & FILTERED VIEWS) */}
        {/* ======================================================= */}
        {results && !isEmpty && !error && (
          <motion.div
            key="results-view"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            {/* Partial-source notice: one provider failed, showing the other */}
            {results.sources && (!results.sources.ytmusic || !results.sources.saavn) && (
              <p className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-2.5 text-xs font-medium text-amber-200/90">
                {results.sources.ytmusic
                  ? 'JioSaavn is unreachable right now — showing YouTube Music results.'
                  : 'YouTube Music is unreachable right now — showing JioSaavn results.'}
              </p>
            )}
            {/* ——— ALL TAB VIEW ——— */}
          {activeFilter === 'all' && (
            <div className="space-y-8">
                {/* Desktop Multi-column Layout for Top Result & Top Songs */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left Column: Top Result Card */}
                  {results.topResult && (
                    <div className="lg:col-span-5 space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93] px-1">
                        Top Result
                      </h3>
                      {results.topResult.type === 'artist' && (
                        <div
                          onClick={() => {
                            const ar = results.topResult!.item as SearchArtist;
                            if (ar.artistId && onNavigate) onNavigate('artist', ar.artistId);
                          }}
                          className="group relative cursor-pointer rounded-[28px] border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] p-6 transition-all shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-md flex flex-col justify-between h-[240px]"
                        >
                          <div className="flex items-center gap-4">
                            <div className="relative h-24 w-24 rounded-full overflow-hidden bg-[#18181b] ring-2 ring-white/20 shrink-0 shadow-lg">
                              <img
                                src={(results.topResult.item as SearchArtist).thumbnails?.[0]?.url || ''}
                                alt={(results.topResult.item as SearchArtist).name}
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="rounded-full bg-purple-500/20 border border-purple-500/30 px-2.5 py-0.5 text-[10px] font-black text-purple-300 uppercase tracking-wider">
                                Artist
                              </span>
                              <h4 className="text-[22px] sm:text-[26px] font-black text-white tracking-tight mt-1 truncate">
                                {(results.topResult.item as SearchArtist).name}
                              </h4>
                              <p className="text-xs text-[#8e8e93] font-medium mt-0.5">
                                {(results.topResult.item as SearchArtist).role || 'Artist'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-4">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRadio(results.topResult!.item as SearchArtist);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/90 shadow-md active:scale-95 transition-all"
                            >
                              <Radio className="h-3.5 w-3.5" /> Start Radio
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const ar = results.topResult!.item as SearchArtist;
                                if (ar.artistId && onNavigate) onNavigate('artist', ar.artistId);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.16] border border-white/10 px-4 py-2 text-xs font-semibold text-white transition-all"
                            >
                              View Profile <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {results.topResult.type === 'song' && (
                        <div
                          onClick={() => {
                            const track = results.topResult!.item as Track;
                            onPlay(track, results.tracks);
                          }}
                          className="group relative cursor-pointer rounded-[28px] border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] p-6 transition-all shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-md flex flex-col justify-between h-[240px]"
                        >
                          <div className="flex items-center gap-4">
                            <div className="relative h-24 w-24 rounded-[20px] overflow-hidden bg-[#18181b] ring-1 ring-white/20 shrink-0 shadow-lg">
                              <img
                                src={(results.topResult.item as Track).thumbnail}
                                alt={(results.topResult.item as Track).title}
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Play className="h-8 w-8 fill-white text-white ml-0.5" />
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="rounded-full bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-0.5 text-[10px] font-black text-cyan-300 uppercase tracking-wider">
                                Song
                              </span>
                              <h4 className="text-[20px] sm:text-[22px] font-black text-white tracking-tight mt-1 truncate">
                                {(results.topResult.item as Track).title}
                              </h4>
                              <p className="text-xs text-[#8e8e93] font-medium mt-0.5 truncate">
                                {(results.topResult.item as Track).author}
                              </p>
                              <p className="text-[11px] font-mono text-white/40 mt-1">
                                {(results.topResult.item as Track).duration}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-4">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPlay(results.topResult!.item as Track, results.tracks);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 shadow-md active:scale-95 transition-all"
                            >
                              <Play className="h-3.5 w-3.5 fill-current ml-0.5" /> Play Now
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRadio(results.topResult!.item as Track);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.16] border border-white/10 px-4 py-2 text-xs font-semibold text-white transition-all"
                            >
                              <Radio className="h-3.5 w-3.5" /> Radio
                            </button>
                          </div>
                        </div>
                      )}

                      {results.topResult.type === 'album' && (
                        <div
                          onClick={() => {
                            const al = results.topResult!.item as Album;
                            if (al.albumId && onNavigate) onNavigate('album', al.albumId);
                          }}
                          className="group relative cursor-pointer rounded-[28px] border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] p-6 transition-all shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-md flex flex-col justify-between h-[240px]"
                        >
                          <div className="flex items-center gap-4">
                            <div className="relative h-24 w-24 rounded-[20px] overflow-hidden bg-[#18181b] ring-1 ring-white/20 shrink-0 shadow-lg">
                              <img
                                src={(results.topResult.item as Album).thumbnails?.[0]?.url || ''}
                                alt={(results.topResult.item as Album).name}
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 text-[10px] font-black text-amber-300 uppercase tracking-wider">
                                Album
                              </span>
                              <h4 className="text-[20px] sm:text-[22px] font-black text-white tracking-tight mt-1 truncate">
                                {(results.topResult.item as Album).name}
                              </h4>
                              <p className="text-xs text-[#8e8e93] font-medium mt-0.5 truncate">
                                {(results.topResult.item as Album).artist?.name || 'Various'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-4">
                            <button
                              type="button"
                              onClick={() => {
                                const al = results.topResult!.item as Album;
                                if (al.albumId && onNavigate) onNavigate('album', al.albumId);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 shadow-md active:scale-95 transition-all"
                            >
                              <Disc3 className="h-3.5 w-3.5" /> View Album
                            </button>
                          </div>
                        </div>
                      )}
                      {results.topResult.type === 'playlist' && (
                        <div
                          onClick={() => {
                            const pl = results.topResult!.item as Playlist;
                            if (pl.playlistId && onNavigate) onNavigate('playlist', pl.playlistId);
                          }}
                          className="group relative cursor-pointer rounded-[28px] border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] p-6 transition-all shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-md flex flex-col justify-between h-[240px]"
                        >
                          <div className="flex items-center gap-4">
                            <div className="relative h-24 w-24 rounded-[20px] overflow-hidden bg-[#18181b] ring-1 ring-white/20 shrink-0 shadow-lg">
                              <img
                                src={(results.topResult.item as Playlist).thumbnails?.[0]?.url || ''}
                                alt={(results.topResult.item as Playlist).name}
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-black text-emerald-300 uppercase tracking-wider">
                                Playlist
                              </span>
                              <h4 className="text-[20px] sm:text-[22px] font-black text-white tracking-tight mt-1 truncate">
                                {(results.topResult.item as Playlist).name}
                              </h4>
                              <p className="text-xs text-[#8e8e93] font-medium mt-0.5 truncate">
                                {(results.topResult.item as Playlist).author || 'Curated'}
                                {(results.topResult.item as Playlist).videoCount
                                  ? ` • ${(results.topResult.item as Playlist).videoCount} tracks`
                                  : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-4">
                            <button
                              type="button"
                              onClick={() => {
                                const pl = results.topResult!.item as Playlist;
                                if (pl.playlistId && onNavigate) onNavigate('playlist', pl.playlistId);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 shadow-md active:scale-95 transition-all"
                            >
                              <ListMusic className="h-3.5 w-3.5" /> View Playlist
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Right Column: Top Song Results */}
                  {results.tracks.length > 0 && (
                    <div className={`${results.topResult ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-2.5`}>
                      <div className="flex items-center justify-between px-1">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93]">
                          Songs
                        </h3>
                        <button
                          type="button"
                          onClick={() => setActiveFilter('songs')}
                          className="inline-flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white transition-colors"
                        >
                          See all <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-1.5 sm:p-2 divide-y divide-white/[0.04]">
                        {results.tracks.slice(0, 4).map((track, idx) => (
                          <SongRow
                            key={`search-song-${track.id}-${idx}`}
                            track={track}
                            index={idx}
                            isActive={currentTrack?.id === track.id}
                            isPlaying={isPlaying}
                            onPlay={() => onPlay(track, results.tracks)}
                            showAlbum={false}
                            onOpenMenu={handleOpenContextMenu}
                            onNavigate={onNavigate}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Artists Rail */}
                {results.artists.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[17px] sm:text-[19px] font-extrabold text-white tracking-tight flex items-center gap-2">
                        <Mic2 className="h-4 w-4 text-purple-400" /> Artists
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveFilter('artists')}
                        className="inline-flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white transition-colors"
                      >
                        See all <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2 -mx-1 px-1">
                      {results.artists.slice(0, 8).map((artist) => (
                        <div
                          key={artist.artistId}
                          onClick={() => {
                            if (artist.artistId && onNavigate) onNavigate('artist', artist.artistId);
                            else handleApplySearch(artist.name);
                          }}
                          className="group flex flex-col items-center text-center cursor-pointer min-w-[120px] w-[120px] shrink-0 p-2 rounded-2xl hover:bg-white/[0.04] transition-all"
                        >
                          <div className="relative aspect-square w-full rounded-full overflow-hidden bg-[#18181b] ring-2 ring-white/10 group-hover:ring-white/30 shadow-md transition-all">
                            <img
                              src={artist.thumbnails?.[0]?.url || ''}
                              alt={artist.name}
                              loading="lazy"
                              className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Play className="h-5 w-5 fill-white text-white" />
                            </div>
                          </div>
                          <p className="mt-2 text-xs sm:text-[13px] font-bold text-white group-hover:text-purple-300 truncate w-full transition-colors">
                            {artist.name}
                          </p>
                          <p className="text-[11px] text-[#8e8e93] font-medium">
                            {artist.role || 'Artist'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Albums Rail */}
                {results.albums.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[17px] sm:text-[19px] font-extrabold text-white tracking-tight flex items-center gap-2">
                        <Disc3 className="h-4 w-4 text-cyan-400" /> Albums
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveFilter('albums')}
                        className="inline-flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white transition-colors"
                      >
                        See all <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2 -mx-1 px-1">
                      {results.albums.slice(0, 8).map((album) => (
                        <div
                          key={album.albumId}
                          onClick={() => {
                            if (album.albumId && onNavigate) onNavigate('album', album.albumId);
                            else handleApplySearch(album.name);
                          }}
                          className="group cursor-pointer min-w-[145px] w-[145px] sm:min-w-[165px] sm:w-[165px] shrink-0 rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all"
                        >
                          <div className="relative aspect-square w-full rounded-[16px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                            <img
                              src={album.thumbnails?.[0]?.url || ''}
                              alt={album.name}
                              loading="lazy"
                              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <span className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                                <Play className="h-4 w-4 fill-current ml-0.5" />
                              </span>
                            </div>
                          </div>
                          <p className="truncate text-xs sm:text-[13.5px] font-bold text-white mt-2 group-hover:text-cyan-300 transition-colors">
                            {album.name}
                          </p>
                          <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                            {album.artist?.name || 'Various'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Playlists Rail */}
                {results.playlists.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[17px] sm:text-[19px] font-extrabold text-white tracking-tight flex items-center gap-2">
                        <ListMusic className="h-4 w-4 text-amber-400" /> Playlists
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveFilter('playlists')}
                        className="inline-flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white transition-colors"
                      >
                        See all <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2 -mx-1 px-1">
                      {results.playlists.slice(0, 8).map((playlist) => (
                        <div
                          key={playlist.playlistId}
                          onClick={() => {
                            if (playlist.playlistId && onNavigate) onNavigate('playlist', playlist.playlistId);
                            else handleApplySearch(playlist.name);
                          }}
                          className="group cursor-pointer min-w-[145px] w-[145px] sm:min-w-[165px] sm:w-[165px] shrink-0 rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all"
                        >
                          <div className="relative aspect-square w-full rounded-[16px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                            <img
                              src={playlist.thumbnails?.[0]?.url || ''}
                              alt={playlist.name}
                              loading="lazy"
                              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <span className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                                <Play className="h-4 w-4 fill-current ml-0.5" />
                              </span>
                            </div>
                          </div>
                          <p className="truncate text-xs sm:text-[13.5px] font-bold text-white mt-2 group-hover:text-amber-300 transition-colors">
                            {playlist.name}
                          </p>
                          <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                            {playlist.author || 'Curated'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ——— SONGS FILTER TAB ——— */}
            {activeFilter === 'songs' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93]">
                    Song Results ({results.tracks.length})
                  </h3>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-white/[0.02] p-2 divide-y divide-white/[0.04]">
                  {results.tracks.map((track, idx) => (
                    <SongRow
                      key={`filter-song-${track.id}-${idx}`}
                      track={track}
                      index={idx}
                      isActive={currentTrack?.id === track.id}
                      isPlaying={isPlaying}
                      onPlay={() => onPlay(track, results.tracks)}
                      showAlbum={true}
                      onOpenMenu={handleOpenContextMenu}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ——— VIDEOS FILTER TAB ——— */}
            {activeFilter === 'videos' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93]">
                    Video Results ({results.tracks.filter((t) => t.type === 'VIDEO').length || results.tracks.length})
                  </h3>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-white/[0.02] p-2 divide-y divide-white/[0.04]">
                  {(results.tracks.some((t) => t.type === 'VIDEO')
                    ? results.tracks.filter((t) => t.type === 'VIDEO')
                    : results.tracks
                  ).map((track, idx) => (
                    <SongRow
                      key={`filter-video-${track.id}-${idx}`}
                      track={track}
                      index={idx}
                      isActive={currentTrack?.id === track.id}
                      isPlaying={isPlaying}
                      onPlay={() => onPlay(track, results.tracks)}
                      showAlbum={true}
                      onOpenMenu={handleOpenContextMenu}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ——— ARTISTS FILTER TAB ——— */}
            {activeFilter === 'artists' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93]">
                    Artist Results ({results.artists.length})
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {results.artists.map((artist) => (
                    <div
                      key={artist.artistId}
                      onClick={() => {
                        if (artist.artistId && onNavigate) onNavigate('artist', artist.artistId);
                        else handleApplySearch(artist.name);
                      }}
                      className="group flex flex-col items-center text-center cursor-pointer p-3 rounded-[24px] bg-white/[0.03] border border-white/10 hover:bg-white/[0.07] hover:border-white/20 transition-all"
                    >
                      <div className="relative aspect-square w-28 sm:w-32 rounded-full overflow-hidden bg-[#18181b] ring-2 ring-white/10 group-hover:ring-white/30 shadow-lg transition-all">
                        <img
                          src={artist.thumbnails?.[0]?.url || ''}
                          alt={artist.name}
                          loading="lazy"
                          className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Play className="h-6 w-6 fill-white text-white" />
                        </div>
                      </div>
                      <p className="mt-3 text-xs sm:text-[14px] font-bold text-white group-hover:text-purple-300 truncate w-full transition-colors">
                        {artist.name}
                      </p>
                      <p className="text-[11px] text-[#8e8e93] font-medium">
                        {artist.role || 'Artist'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ——— ALBUMS FILTER TAB ——— */}
            {activeFilter === 'albums' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93]">
                    Album Results ({results.albums.length})
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {results.albums.map((album) => (
                    <div
                      key={album.albumId}
                      onClick={() => {
                        if (album.albumId && onNavigate) onNavigate('album', album.albumId);
                        else handleApplySearch(album.name);
                      }}
                      className="group cursor-pointer rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all"
                    >
                      <div className="relative aspect-square w-full rounded-[16px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                        <img
                          src={album.thumbnails?.[0]?.url || ''}
                          alt={album.name}
                          loading="lazy"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <span className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          </span>
                        </div>
                      </div>
                      <p className="truncate text-xs sm:text-[13.5px] font-bold text-white mt-2 group-hover:text-cyan-300 transition-colors">
                        {album.name}
                      </p>
                      <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                        {album.artist?.name || 'Various'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ——— PLAYLISTS FILTER TAB ——— */}
            {activeFilter === 'playlists' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#8e8e93]">
                    Playlist Results ({results.playlists.length})
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {results.playlists.map((playlist) => (
                    <div
                      key={playlist.playlistId}
                      onClick={() => {
                        if (playlist.playlistId && onNavigate) onNavigate('playlist', playlist.playlistId);
                        else handleApplySearch(playlist.name);
                      }}
                      className="group cursor-pointer rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all"
                    >
                      <div className="relative aspect-square w-full rounded-[16px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                        <img
                          src={playlist.thumbnails?.[0]?.url || ''}
                          alt={playlist.name}
                          loading="lazy"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <span className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          </span>
                        </div>
                      </div>
                      <p className="truncate text-xs sm:text-[13.5px] font-bold text-white mt-2 group-hover:text-amber-300 transition-colors">
                        {playlist.name}
                      </p>
                      <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                        {playlist.author || 'Curated'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Song Context Menu (⋮) */}
      <SongContextMenu
        isOpen={isMenuOpen}
        onClose={() => {
          setIsMenuOpen(false);
          setMenuTrack(null);
        }}
        track={menuTrack}
        onPlay={() => {
          if (menuTrack) onPlay(menuTrack, results?.tracks || [menuTrack]);
        }}
        onOpenAddToPlaylist={handleOpenAddToPlaylist}
        onNavigate={onNavigate}
        onShowToast={(msg) => setToastMessage(msg)}
      />

      {/* Add To Playlist Modal */}
      <AddToPlaylistModal
        isOpen={isPlaylistModalOpen}
        onClose={() => {
          setIsPlaylistModalOpen(false);
          setPlaylistModalTracks([]);
        }}
        tracks={playlistModalTracks}
        onSuccess={(plTitle, count) => {
          setToastMessage(`Added ${count} ${count === 1 ? 'song' : 'songs'} to "${plTitle}"`);
        }}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-[calc(112px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 rounded-full bg-white text-black px-4 py-2 text-xs font-bold shadow-[0_8px_30px_rgba(0,0,0,0.6)] flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

