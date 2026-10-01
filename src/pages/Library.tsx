import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Heart,
  Disc3,
  Music,
  ListMusic,
  Download,
  LayoutGrid,
  List,
  Play,
  Shuffle,
  Plus,
  Sparkles,
  Mic2,
  Search,
  X,
  ArrowUpDown,
  CheckSquare,
  Clock,
  Trash2,
  Pencil,
  FolderPlus,
  CheckCircle2,
  Share2,
  ExternalLink,
  ChevronRight,
  Radio,
} from 'lucide-react';
import { playerStore } from '../services/playerStore';
import { createYTMusicPlaylist, checkYTMusicAuth } from '../services/ytmusicApi';
import {
  buildImportPreview,
  buildWavePlaylist,
  fetchAllYoutubeItems,
  isReauthError,
  reauthMessage,
  type ImportPreview,
  type Progress,
  type YoutubeItem,
} from '../services/youtubeImport';
import { Track } from '../types';
import { SongRow } from '../components/SongRow';
import { NoContent } from '../components/NoContent';
import { SongContextMenu } from '../components/SongContextMenu';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { PlaylistModal, PlaylistModalValue } from '../components/PlaylistModal';
import { BulkActionBar } from '../components/BulkActionBar';
import {
  LocalPlaylist,
  LibrarySortOption,
  formatRelativeTime,
  formatTotalDuration,
  getLocalPlaylists,
  saveLocalPlaylists,
  deleteLocalPlaylist,
  getSavedLibrarySort,
  saveLibrarySort,
  getAllLibraryTracks,
  extractLibraryAlbums,
  extractLibraryArtists,
  sortTracks,
} from '../services/libraryStore';
import { getRecentlyPlayed, getListeningEvents, getPlayCount } from '../services/listeningStore';

export type TabId = 'songs' | 'albums' | 'artists' | 'playlists' | 'favs' | 'recent' | 'downloads';
type SongFilter = 'all' | 'liked' | 'recent' | 'added';
type View = 'grid' | 'list';
type YouTubePlaylist = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle?: string;
  itemCount: number;
  privacy: string;
};

interface LibraryPageProps {
  onPlay: (t: Track, list?: Track[]) => void;
  onNavigate?: (page: string, param?: string) => void;
  initialTab?: TabId;
}

export const LibraryPage: React.FC<LibraryPageProps> = ({
  onPlay,
  onNavigate,
  initialTab = 'songs',
}) => {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [view, setView] = useState<View>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [songFilter, setSongFilter] = useState<SongFilter>('all');
  const [sortOption, setSortOption] = useState<LibrarySortOption>(() => getSavedLibrarySort());

  // Player state
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => playerStore.current());
  const [isPlaying, setIsPlaying] = useState(false);
  const [favs, setFavs] = useState<Track[]>(() => playerStore.favsList());
  const [history, setHistory] = useState<Track[]>(() => playerStore.historyList());
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(() => getRecentlyPlayed(50));
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>(() => getLocalPlaylists());

  // Multi-select state
  const [selectable, setSelectable] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Context Menu & Add to Playlist Modals
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [playlistModalTracks, setPlaylistModalTracks] = useState<Track[]>([]);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<LocalPlaylist | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  // YouTube Playlist integration state
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [authMode, setAuthMode] = useState<string>('checking...');
  const [youtubePlaylists, setYoutubePlaylists] = useState<YouTubePlaylist[]>([]);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeMessage, setYoutubeMessage] = useState('');
  const [expandedYtId, setExpandedYtId] = useState<string | null>(null);
  const [ytItemsCache, setYtItemsCache] = useState<Record<string, YoutubeItem[]>>({});
  const [ytTracksLoading, setYtTracksLoading] = useState(false);
  const [previewPlaylist, setPreviewPlaylist] = useState<YouTubePlaylist | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewProgress, setPreviewProgress] = useState<Progress | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [importing, setImporting] = useState(false);

  // Sync tab with props
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // Toast auto-hide
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Subscribe to player store changes
  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setCurrentTrack(playerStore.current());
      setFavs([...playerStore.favsList()]);
      setHistory([...playerStore.historyList()]);
    });
    return () => {
      unsub();
    };
  }, []);

  // Listen for storage events (listening events & playlist updates)
  useEffect(() => {
    const handleListening = () => {
      setRecentlyPlayed([...getRecentlyPlayed(50)]);
    };
    const handlePlaylistsChanged = () => {
      setLocalPlaylists([...getLocalPlaylists()]);
    };
    window.addEventListener('wave:listening', handleListening);
    window.addEventListener('wave:playlists_changed', handlePlaylistsChanged);
    window.addEventListener('storage', handlePlaylistsChanged);
    return () => {
      window.removeEventListener('wave:listening', handleListening);
      window.removeEventListener('wave:playlists_changed', handlePlaylistsChanged);
      window.removeEventListener('storage', handlePlaylistsChanged);
    };
  }, []);

  // YT Music Auth mode check
  useEffect(() => {
    checkYTMusicAuth()
      .then((r) => setAuthMode(r.mode))
      .catch(() => setAuthMode('mock'));
  }, []);

  // Save sort option
  const handleSortChange = (opt: LibrarySortOption) => {
    setSortOption(opt);
    saveLibrarySort(opt);
  };

  // Maps for sorting & relative time lookup
  const { playCountsMap, recentTimestampsMap } = useMemo(() => {
    const counts: Record<string, number> = {};
    const timestamps: Record<string, number> = {};
    const events = getListeningEvents(500);

    for (const ev of events) {
      if (ev.songId) {
        if (!counts[ev.songId]) counts[ev.songId] = getPlayCount(ev.songId);
        const time = new Date(ev.timestamp).getTime();
        if (!timestamps[ev.songId] || time > timestamps[ev.songId]) {
          timestamps[ev.songId] = time;
        }
      }
    }
    return { playCountsMap: counts, recentTimestampsMap: timestamps };
  }, [recentlyPlayed]);

  // 1. Unified Library Songs Pool
  const rawLibrarySongs = useMemo(() => {
    return getAllLibraryTracks();
  }, [favs, history, recentlyPlayed, localPlaylists]);

  // 2. Filtered & Sorted Songs
  const processedSongs = useMemo(() => {
    let list = [...rawLibrarySongs];

    // Apply sub-filter
    if (songFilter === 'liked') {
      const favSet = new Set(favs.map((f) => f.id));
      list = list.filter((t) => favSet.has(t.id));
    } else if (songFilter === 'recent') {
      const recSet = new Set(recentlyPlayed.map((r) => r.id));
      list = list.filter((t) => recSet.has(t.id));
    } else if (songFilter === 'added') {
      // Keep natural order (latest favorites & playlists first)
    }

    // Apply client-side search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.author && t.author.toLowerCase().includes(q)) ||
          (t.albumName && t.albumName.toLowerCase().includes(q))
      );
    }

    // Apply sorting
    return sortTracks(list, sortOption, playCountsMap, recentTimestampsMap);
  }, [rawLibrarySongs, songFilter, searchQuery, sortOption, favs, recentlyPlayed, playCountsMap, recentTimestampsMap]);

  // 3. Extracted Albums
  const libraryAlbums = useMemo(() => {
    const albums = extractLibraryAlbums(rawLibrarySongs);
    if (!searchQuery.trim()) return albums;
    const q = searchQuery.toLowerCase().trim();
    return albums.filter(
      (a) => a.name.toLowerCase().includes(q) || a.artistName.toLowerCase().includes(q)
    );
  }, [rawLibrarySongs, searchQuery]);

  // 4. Extracted Artists
  const libraryArtists = useMemo(() => {
    const artists = extractLibraryArtists(rawLibrarySongs);
    if (!searchQuery.trim()) return artists;
    const q = searchQuery.toLowerCase().trim();
    return artists.filter((a) => a.name.toLowerCase().includes(q));
  }, [rawLibrarySongs, searchQuery]);

  // 5. Liked Songs List
  const processedLikedSongs = useMemo(() => {
    let list = [...favs];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.author && t.author.toLowerCase().includes(q)) ||
          (t.albumName && t.albumName.toLowerCase().includes(q))
      );
    }
    return sortTracks(list, sortOption, playCountsMap, recentTimestampsMap);
  }, [favs, searchQuery, sortOption, playCountsMap, recentTimestampsMap]);

  // 6. Recently Played List
  const processedRecentSongs = useMemo(() => {
    let list = [...recentlyPlayed];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.author && t.author.toLowerCase().includes(q)) ||
          (t.albumName && t.albumName.toLowerCase().includes(q))
      );
    }
    return list;
  }, [recentlyPlayed, searchQuery]);

  // Play Actions
  const handlePlaySong = (track: Track, contextList: Track[]) => {
    onPlay(track, contextList);
  };

  const handlePlayAll = (tracksToPlay: Track[]) => {
    if (!tracksToPlay.length) return;
    onPlay(tracksToPlay[0], tracksToPlay);
    setToastMessage(`Playing ${tracksToPlay.length} songs`);
  };

  const handleShuffle = (tracksToShuffle: Track[]) => {
    if (!tracksToShuffle.length) return;
    const shuffled = [...tracksToShuffle].sort(() => Math.random() - 0.5);
    playerStore.setQueue(shuffled, 0);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
    setToastMessage(`Shuffling ${tracksToShuffle.length} songs`);
  };

  // Multi-select Handlers
  const handleToggleSelectSong = (trackId: string, isSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isSelected) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
  };

  const getSelectedTracksList = useCallback(
    (sourceList: Track[]) => {
      return sourceList.filter((t) => selectedIds.has(t.id));
    },
    [selectedIds]
  );

  const handleBulkPlay = (sourceList: Track[]) => {
    const selected = getSelectedTracksList(sourceList);
    if (!selected.length) return;
    handlePlayAll(selected);
    setSelectedIds(new Set());
    setSelectable(false);
  };

  const handleBulkAddToQueue = (sourceList: Track[]) => {
    const selected = getSelectedTracksList(sourceList);
    if (!selected.length) return;
    playerStore.addMultipleToQueue(selected);
    setToastMessage(`Added ${selected.length} songs to queue`);
    setSelectedIds(new Set());
    setSelectable(false);
  };

  const handleBulkAddToPlaylist = (sourceList: Track[]) => {
    const selected = getSelectedTracksList(sourceList);
    if (!selected.length) return;
    setPlaylistModalTracks(selected);
    setIsPlaylistModalOpen(true);
  };

  const handleBulkLikeAll = (sourceList: Track[]) => {
    const selected = getSelectedTracksList(sourceList);
    if (!selected.length) return;
    for (const t of selected) {
      if (!playerStore.isFav(t.id)) playerStore.toggleFav(t);
    }
    setToastMessage(`Added ${selected.length} songs to Liked Songs`);
    setSelectedIds(new Set());
    setSelectable(false);
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

  // YouTube Playlist Loaders & Importers
  const loadYoutubePlaylists = async (refresh = false) => {
    setYoutubeLoading(true);
    setYoutubeMessage('');
    try {
      const status = await fetch('/api/auth/youtube/status', { credentials: 'include' }).then((r) =>
        r.json()
      );
      setYoutubeConnected(!!status.connected);
      if (!status.connected) {
        setYoutubePlaylists([]);
        return;
      }
      const all: YouTubePlaylist[] = [];
      let pageToken: string | null = null;
      for (let page = 0; page < 5; page++) {
        const qs = new URLSearchParams({ maxResults: '50' });
        if (refresh) qs.set('refresh', '1');
        if (pageToken) qs.set('pageToken', pageToken);
        const response = await fetch(`/api/youtube/playlists?${qs}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load YouTube playlists.');
        all.push(...(data.items || []));
        pageToken = data.nextPageToken || null;
        if (!pageToken) break;
      }
      setYoutubePlaylists(all);
    } catch (error: any) {
      if (isReauthError(error)) {
        setYoutubeConnected(false);
        setYoutubePlaylists([]);
        setYoutubeMessage(reauthMessage());
      } else {
        setYoutubeMessage(error.message || 'Could not load YouTube playlists.');
      }
    } finally {
      setYoutubeLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'playlists') {
      void loadYoutubePlaylists();
    }
  }, [tab]);

  const loadYoutubeItems = async (playlistId: string): Promise<YoutubeItem[]> => {
    const cached = ytItemsCache[playlistId];
    if (cached) return cached;
    setYtTracksLoading(true);
    try {
      const { items } = await fetchAllYoutubeItems(playlistId);
      setYtItemsCache((prev) => ({ ...prev, [playlistId]: items }));
      return items;
    } catch (error: any) {
      if (isReauthError(error)) {
        setYoutubeConnected(false);
        setYoutubeMessage(reauthMessage());
      }
      throw error;
    } finally {
      setYtTracksLoading(false);
    }
  };

  const itemToTrack = (item: YoutubeItem): Track | null => {
    if (!item.videoId) return null;
    return {
      id: item.videoId,
      title: item.title || 'Unknown title',
      author: item.channelTitle || item.artist || 'YouTube',
      thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
      duration: '',
      durationSeconds: 0,
      url: `https://www.youtube.com/watch?v=${item.videoId}`,
      source: 'youtube',
      type: 'VIDEO',
    };
  };

  const getYoutubeTracks = async (playlist: YouTubePlaylist) => {
    const items = await loadYoutubeItems(playlist.id);
    return items.map(itemToTrack).filter((t): t is Track => !!t);
  };

  const openImportPreview = async (playlist: YouTubePlaylist) => {
    setPreviewPlaylist(playlist);
    setPreview(null);
    setPreviewProgress(null);
    setPreviewError('');
    setPreviewBusy(true);
    try {
      const items = await loadYoutubeItems(playlist.id);
      if (!items.length) {
        setPreviewError('This playlist is empty on YouTube.');
        return;
      }
      const data = await buildImportPreview(items, setPreviewProgress);
      setPreview(data);
    } catch (error: any) {
      setPreviewError(isReauthError(error) ? reauthMessage() : error.message || 'Could not load playlist tracks.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const closePreview = () => {
    setPreviewPlaylist(null);
    setPreview(null);
    setPreviewProgress(null);
    setPreviewError('');
    setPreviewBusy(false);
    setImporting(false);
  };

  const confirmImport = async (includePossible: boolean) => {
    if (!previewPlaylist || !preview || importing) return;
    setImporting(true);
    try {
      const chosen = [...preview.matched, ...(includePossible ? preview.possible : [])];
      if (!chosen.length) {
        setPreviewError('No matched songs to import.');
        return;
      }
      const local = getLocalPlaylists();
      const targetId = `LOCAL_YT_${previewPlaylist.id}`;
      const existing = local.find((p) => p.id === targetId) || null;
      const merged = buildWavePlaylist(previewPlaylist, chosen, existing);
      const next = [...local.filter((p) => p.id !== targetId), merged];
      saveLocalPlaylists(next);
      setLocalPlaylists(next);
      setYoutubeMessage(`Imported “${previewPlaylist.title}” into Wave (${chosen.length} tracks).`);
      setToastMessage(`Imported "${previewPlaylist.title}" with ${chosen.length} tracks`);
      closePreview();
    } catch (error: any) {
      setPreviewError(error.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = async () => {
    const t = title.trim();
    if (!t) return;
    setCreating(true);
    try {
      await createYTMusicPlaylist(t, desc, 'PRIVATE');
      setTitle('');
      setDesc('');
      setLocalPlaylists(getLocalPlaylists());
      setToastMessage(`Created playlist "${t}"`);
    } catch {
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePlaylist = (id: string, plTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete playlist "${plTitle}"?`)) return;
    deleteLocalPlaylist(id);
    setLocalPlaylists(getLocalPlaylists());
    setToastMessage(`Deleted playlist "${plTitle}"`);
  };

  const handleRenamePlaylist = (value: PlaylistModalValue) => {
    if (!renameTarget) return;
    setRenameBusy(true);
    try {
      const all = getLocalPlaylists().map((p) =>
        p.id === renameTarget.id
          ? { ...p, title: value.title, description: value.description, privacyStatus: value.privacyStatus, updatedAt: new Date().toISOString() }
          : p,
      );
      saveLocalPlaylists(all);
      setLocalPlaylists(all);
      setToastMessage(`Renamed to “${value.title}”`);
      setRenameTarget(null);
    } finally {
      setRenameBusy(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: any; count?: number }[] = [
    { id: 'songs', label: 'Songs', icon: Music, count: rawLibrarySongs.length },
    { id: 'albums', label: 'Albums', icon: Disc3, count: libraryAlbums.length },
    { id: 'artists', label: 'Artists', icon: Mic2, count: libraryArtists.length },
    { id: 'playlists', label: 'Playlists', icon: ListMusic, count: localPlaylists.length + (youtubePlaylists.length || 0) },
    { id: 'favs', label: 'Liked', icon: Heart, count: favs.length },
    { id: 'recent', label: 'Recently Played', icon: Clock, count: recentlyPlayed.length },
    { id: 'downloads', label: 'Downloads', icon: Download, count: history.length },
  ];

  return (
    <div className="space-y-6 pb-20">
      {/* ——— TOP HEADER ——— */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[34px] font-black tracking-[-0.03em] leading-none text-white">
              My Library
            </h1>
            <p className="mt-1.5 text-xs sm:text-[13px] font-medium text-[#a1a1aa]">
              {rawLibrarySongs.length} songs • {formatTotalDuration(rawLibrarySongs)} • Premium Liquid Glass
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Search Input in Header */}
            <div className="relative flex items-center">
              <span className="absolute left-3 text-white/40 pointer-events-none">
                <Search className="h-3.5 w-3.5" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in library…"
                className="h-9 w-44 sm:w-60 rounded-full bg-white/[0.06] border border-white/10 pl-8 pr-8 text-xs font-medium text-white placeholder:text-white/40 outline-none focus:border-white/30 focus:bg-white/[0.09] transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 text-white/40 hover:text-white transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* View Mode Switcher */}
            {(tab === 'albums' || tab === 'artists' || tab === 'playlists') && (
              <div className="flex items-center rounded-full bg-white/[0.06] p-0.5 border border-white/10 shadow-sm">
                <button
                  onClick={() => setView('grid')}
                  className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${
                    view === 'grid' ? 'bg-white text-black shadow' : 'text-[#a1a1aa] hover:text-white'
                  }`}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${
                    view === 'list' ? 'bg-white text-black shadow' : 'text-[#a1a1aa] hover:text-white'
                  }`}
                  aria-label="List view"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Primary Tabs Carousel */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
          {tabs.map((t) => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setSelectable(false);
                  setSelectedIds(new Set());
                }}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold border whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-white text-black border-white shadow-[0_2px_12px_rgba(255,255,255,0.18)] scale-[1.02]'
                    : 'bg-white/[0.04] text-[#a1a1aa] border-white/[0.08] hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
                {typeof t.count === 'number' && t.count > 0 && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                      isActive ? 'bg-black/15 text-black font-bold' : 'bg-white/10 text-white/60'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ——— TAB CONTENT ——— */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* ======================================================= */}
          {/* TAB 1: SONGS (UNIFIED LIBRARY TRACKS TABLE) */}
          {/* ======================================================= */}
          {tab === 'songs' && (
            <div className="space-y-4">
              {/* Controls Bar: Sub-filters + Play All + Shuffle + Sort + Select */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 backdrop-blur-md">
                {/* Filter Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                  {(
                    [
                      { id: 'all', label: 'All songs' },
                      { id: 'liked', label: 'Liked' },
                      { id: 'recent', label: 'Recently Played' },
                      { id: 'added', label: 'Recently Added' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSongFilter(f.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                        songFilter === f.id
                          ? 'bg-white text-black shadow-sm'
                          : 'bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Action Buttons & Sort Dropdown */}
                <div className="flex items-center gap-2 ml-auto flex-wrap">
                  {processedSongs.length > 0 && (
                    <>
                      <button
                        onClick={() => handlePlayAll(processedSongs)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all shadow-sm"
                      >
                        <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                        <span>Play All</span>
                      </button>

                      <button
                        onClick={() => handleShuffle(processedSongs)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-white active:scale-95 transition-all"
                      >
                        <Shuffle className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Shuffle</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectable(!selectable);
                          if (selectable) setSelectedIds(new Set());
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                          selectable
                            ? 'bg-white text-black border-white'
                            : 'bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{selectable ? 'Done' : 'Select'}</span>
                      </button>
                    </>
                  )}

                  {/* Sort Dropdown */}
                  <div className="relative inline-flex items-center">
                    <select
                      value={sortOption}
                      onChange={(e) => handleSortChange(e.target.value as LibrarySortOption)}
                      className="rounded-full bg-white/[0.06] border border-white/10 text-white text-xs font-medium px-3 py-1.5 outline-none hover:bg-white/10 focus:border-white/30 transition-all appearance-none pr-7 cursor-pointer"
                    >
                      <option value="recent_added" className="bg-[#18181b] text-white">Recently Added</option>
                      <option value="recent_played" className="bg-[#18181b] text-white">Recently Played</option>
                      <option value="title_asc" className="bg-[#18181b] text-white">Title (A-Z)</option>
                      <option value="title_desc" className="bg-[#18181b] text-white">Title (Z-A)</option>
                      <option value="artist_asc" className="bg-[#18181b] text-white">Artist (A-Z)</option>
                      <option value="album_asc" className="bg-[#18181b] text-white">Album (A-Z)</option>
                      <option value="duration_desc" className="bg-[#18181b] text-white">Duration (Longest)</option>
                      <option value="duration_asc" className="bg-[#18181b] text-white">Duration (Shortest)</option>
                      <option value="most_played" className="bg-[#18181b] text-white">Most Played</option>
                    </select>
                    <ArrowUpDown className="pointer-events-none absolute right-2.5 h-3 w-3 text-white/50" />
                  </div>
                </div>
              </div>

              {/* Table Header (Desktop) */}
              {processedSongs.length > 0 && (
                <div className="hidden sm:flex items-center gap-3 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white/40 border-b border-white/[0.06]">
                  <div className="w-7 text-center">#</div>
                  <div className="w-12">Cover</div>
                  <div className="flex-1">Title & Artist</div>
                  <div className="hidden lg:block w-[180px] xl:w-[220px]">Album</div>
                  <div className="w-14 text-right">Duration</div>
                  <div className="w-16 text-center">Actions</div>
                </div>
              )}

              {/* Songs List */}
              {processedSongs.length === 0 ? (
                <NoContent
                  variant="songs"
                  title={searchQuery ? 'No matching songs found' : 'Your song library is empty'}
                  description={
                    searchQuery
                      ? `No tracks matching "${searchQuery}". Try a different keyword.`
                      : 'Songs you favorite, play, or import will automatically show up here.'
                  }
                  actionLabel={searchQuery ? 'Clear search' : 'Discover Music'}
                  onAction={() => {
                    if (searchQuery) setSearchQuery('');
                    else if (onNavigate) onNavigate('explore');
                  }}
                />
              ) : (
                <div className="rounded-[20px] border border-white/10 bg-[#101012]/80 backdrop-blur-xl p-1 sm:p-2 divide-y divide-white/[0.04] shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
                  {processedSongs.map((t, idx) => {
                    const isActive = currentTrack?.id === t.id;
                    const isSelected = selectedIds.has(t.id);
                    return (
                      <SongRow
                        key={`${t.id}-${idx}`}
                        track={t}
                        index={idx}
                        isActive={isActive}
                        isPlaying={isActive && isPlaying}
                        onPlay={() => handlePlaySong(t, processedSongs)}
                        selectable={selectable}
                        selected={isSelected}
                        onToggleSelect={(sel) => handleToggleSelectSong(t.id, sel)}
                        onOpenMenu={handleOpenContextMenu}
                        onNavigate={onNavigate}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ======================================================= */}
          {/* TAB 2: ALBUMS GRID & LIST */}
          {/* ======================================================= */}
          {tab === 'albums' && (
            <div className="space-y-4">
              {libraryAlbums.length === 0 ? (
                <NoContent
                  variant="albums"
                  title="No albums in your library"
                  description="Albums from your liked tracks and playlists will be indexed here automatically."
                  actionLabel="Explore Albums"
                  onAction={() => onNavigate?.('explore')}
                />
              ) : view === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                  {libraryAlbums.map((album) => (
                    <motion.div
                      key={album.id}
                      whileHover={{ y: -4 }}
                      onClick={() => {
                        if (album.id && !album.id.includes('___')) {
                          onNavigate?.('album', album.id);
                        } else if (album.tracks.length) {
                          handlePlayAll(album.tracks);
                        }
                      }}
                      className="group cursor-pointer rounded-[20px] border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md"
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#1a1a1c] ring-1 ring-white/10 shadow-sm">
                        <img
                          src={album.thumbnail}
                          alt={album.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          onError={(e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
                          }}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayAll(album.tracks);
                            }}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-xl transform scale-90 group-hover:scale-100 transition-all"
                          >
                            <Play className="h-5 w-5 fill-current ml-0.5" />
                          </button>
                        </div>
                        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[9.5px] font-bold text-white border border-white/10">
                          <Disc3 className="h-3 w-3 text-amber-400" /> ALBUM
                        </span>
                      </div>
                      <div className="mt-2.5 min-w-0">
                        <p className="truncate text-[13.5px] font-bold text-white group-hover:text-white">
                          {album.name}
                        </p>
                        <p className="truncate text-xs text-white/50 mt-0.5">
                          {album.artistName} {album.year ? `• ${album.year}` : ''}
                        </p>
                        <p className="text-[11px] font-mono text-white/40 mt-1">
                          {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#101012]/80 divide-y divide-white/[0.04]">
                  {libraryAlbums.map((album) => (
                    <div
                      key={album.id}
                      onClick={() => {
                        if (album.id && !album.id.includes('___')) onNavigate?.('album', album.id);
                        else if (album.tracks.length) handlePlayAll(album.tracks);
                      }}
                      className="flex items-center gap-3.5 px-4 py-3 hover:bg-white/[0.05] transition-colors cursor-pointer group"
                    >
                      <img
                        src={album.thumbnail}
                        alt=""
                        className="h-12 w-12 rounded-xl object-cover ring-1 ring-white/10 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold text-white group-hover:text-white">
                          {album.name}
                        </p>
                        <p className="truncate text-xs text-white/50">
                          {album.artistName} {album.year ? `• ${album.year}` : ''}
                        </p>
                      </div>
                      <span className="text-xs text-white/40 font-mono">
                        {album.tracks.length} songs
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAll(album.tracks);
                        }}
                        className="h-8 w-8 rounded-full bg-white/10 group-hover:bg-white group-hover:text-black text-white flex items-center justify-center transition-all"
                      >
                        <Play className="h-4 w-4 fill-current ml-0.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ======================================================= */}
          {/* TAB 3: ARTISTS GRID & LIST */}
          {/* ======================================================= */}
          {tab === 'artists' && (
            <div className="space-y-4">
              {libraryArtists.length === 0 ? (
                <NoContent
                  variant="artists"
                  title="No artists in your library"
                  description="Artists from your favorite songs and playlists will populate here."
                  actionLabel="Discover Artists"
                  onAction={() => onNavigate?.('explore')}
                />
              ) : view === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {libraryArtists.map((artist) => (
                    <motion.div
                      key={artist.id}
                      whileHover={{ y: -4 }}
                      onClick={() => {
                        if (artist.id && onNavigate) onNavigate('artist', artist.id);
                        else if (artist.tracks.length) handlePlayAll(artist.tracks);
                      }}
                      className="group cursor-pointer rounded-[24px] border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.07] hover:border-white/20 transition-all flex flex-col items-center text-center shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md"
                    >
                      <div className="relative aspect-square w-full max-w-[140px] overflow-hidden rounded-full bg-[#1a1a1c] ring-2 ring-white/15 shadow-md">
                        <img
                          src={artist.thumbnail}
                          alt={artist.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          onError={(e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
                          }}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayAll(artist.tracks);
                            }}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-xl"
                          >
                            <Play className="h-5 w-5 fill-current ml-0.5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 min-w-0 w-full">
                        <p className="truncate text-[14px] font-bold text-white group-hover:text-white">
                          {artist.name}
                        </p>
                        <p className="text-xs text-white/50 mt-0.5 font-medium">
                          {artist.tracks.length} {artist.tracks.length === 1 ? 'track' : 'tracks'}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#101012]/80 divide-y divide-white/[0.04]">
                  {libraryArtists.map((artist) => (
                    <div
                      key={artist.id}
                      onClick={() => {
                        if (artist.id && onNavigate) onNavigate('artist', artist.id);
                        else if (artist.tracks.length) handlePlayAll(artist.tracks);
                      }}
                      className="flex items-center gap-3.5 px-4 py-3 hover:bg-white/[0.05] transition-colors cursor-pointer group"
                    >
                      <img
                        src={artist.thumbnail}
                        alt=""
                        className="h-12 w-12 rounded-full object-cover ring-1 ring-white/15 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold text-white group-hover:text-white">
                          {artist.name}
                        </p>
                        <p className="truncate text-xs text-white/50">
                          {artist.tracks.length} tracks in library
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAll(artist.tracks);
                        }}
                        className="h-8 w-8 rounded-full bg-white/10 group-hover:bg-white group-hover:text-black text-white flex items-center justify-center transition-all"
                      >
                        <Play className="h-4 w-4 fill-current ml-0.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ======================================================= */}
          {/* TAB 4: PLAYLISTS (LOCAL + YOUTUBE + CREATION) */}
          {/* ======================================================= */}
          {tab === 'playlists' && (
            <div className="space-y-6">
              {/* Liked Songs Special Hero Card */}
              <div
                onClick={() => setTab('favs')}
                className="group relative cursor-pointer overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-r from-red-600/30 via-[#18181b]/90 to-rose-900/20 p-5 sm:p-6 backdrop-blur-xl hover:border-red-500/40 transition-all shadow-[0_16px_40px_rgba(220,38,38,0.12)]"
              >
                <div className="flex items-center gap-4 sm:gap-5">
                  <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-[18px] bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-[0_8px_24px_rgba(239,68,68,0.4)] group-hover:scale-105 transition-transform shrink-0">
                    <Heart className="h-8 w-8 sm:h-10 sm:w-10 fill-current" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-[10.5px] font-bold text-red-300 uppercase tracking-wider">
                      Auto Playlist
                    </span>
                    <h2 className="text-[20px] sm:text-[24px] font-extrabold text-white tracking-tight leading-tight mt-1">
                      Liked Songs
                    </h2>
                    <p className="text-xs sm:text-[13px] text-white/60 mt-0.5 font-medium">
                      {favs.length} songs • {formatTotalDuration(favs)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayAll(favs);
                      }}
                      className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-white text-black shadow-xl hover:scale-105 active:scale-95 transition-all"
                      title="Play Liked Songs"
                    >
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Create Playlist Section */}
              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4 sm:p-5 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-bold text-white flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-400" /> Create Playlist
                  </h3>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-mono text-white/60">
                    {authMode}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Playlist title (e.g. Chill Vibes)"
                    className="rounded-full bg-black/40 border border-white/10 px-4 py-2.5 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/30"
                  />
                  <input
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="rounded-full bg-black/40 border border-white/10 px-4 py-2.5 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-white/30"
                  />
                  <button
                    onClick={handleCreate}
                    disabled={creating || !title.trim()}
                    className="rounded-full bg-white px-6 py-2.5 text-[13px] font-bold text-black hover:bg-white/90 disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all"
                  >
                    <Plus className="h-4 w-4" /> {creating ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>

              {/* User Local Playlists */}
              {localPlaylists.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 px-1">
                    Your Playlists ({localPlaylists.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {localPlaylists.map((pl) => (
                      <div
                        key={pl.id}
                        onClick={() => onNavigate?.('playlist', `local:${pl.id}`)}
                        className="group cursor-pointer rounded-[20px] border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.07] hover:border-white/20 transition-all flex items-center gap-3.5 shadow-sm"
                      >
                        <div className="h-16 w-16 rounded-[14px] bg-gradient-to-br from-white/15 to-white/5 border border-white/10 flex items-center justify-center text-white font-black text-lg shrink-0 group-hover:scale-105 transition-transform">
                          {pl.title.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-bold text-white group-hover:text-white">
                            {pl.title}
                          </p>
                          <p className="truncate text-xs text-white/50 mt-0.5">
                            {(pl.songs || []).length} songs • {formatRelativeTime(pl.updatedAt)}
                            {(pl.sourcePlaylistId || pl.youtubePlaylistId) ? ' • YouTube import' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (pl.songs && pl.songs.length) handlePlayAll(pl.songs);
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow hover:scale-105 active:scale-95 transition-all"
                            title="Play playlist"
                            aria-label={`Play ${pl.title}`}
                          >
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget(pl);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                            title="Rename playlist"
                            aria-label={`Rename ${pl.title}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeletePlaylist(pl.id, pl.title, e)}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete playlist"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* YouTube Playlists Section */}
              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4 sm:p-5 space-y-3 backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[14px] font-bold text-white flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" /> YouTube Playlists
                    </h3>
                    <p className="mt-0.5 text-xs text-white/50">
                      Sync and import playlists from your connected YouTube account.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!youtubeConnected && (
                      <button
                        onClick={() => location.assign('/api/auth/youtube/connect')}
                        className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-black hover:bg-white/90 shadow-sm"
                      >
                        Connect YouTube
                      </button>
                    )}
                    <button
                      onClick={() => void loadYoutubePlaylists(true)}
                      disabled={youtubeLoading}
                      className="rounded-full border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 transition-all"
                    >
                      {youtubeLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                </div>

                {youtubeMessage && <p role="status" className="text-xs text-white/60">{youtubeMessage}</p>}

                <div className="space-y-2 pt-1">
                  {youtubePlaylists.map((playlist) => {
                    const expanded = expandedYtId === playlist.id;
                    const items = ytItemsCache[playlist.id] || [];
                    return (
                      <div
                        key={playlist.id}
                        className="rounded-2xl border border-white/5 bg-black/30 p-3 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={playlist.thumbnail || `https://i.ytimg.com/vi/${playlist.id}/default.jpg`}
                            alt=""
                            className="h-12 w-12 rounded-xl object-cover ring-1 ring-white/10 shrink-0"
                          />
                          <button
                            onClick={async () => {
                              if (expanded) {
                                setExpandedYtId(null);
                                return;
                              }
                              setExpandedYtId(playlist.id);
                              try {
                                await loadYoutubeItems(playlist.id);
                              } catch (error: any) {
                                setYoutubeMessage(isReauthError(error) ? reauthMessage() : error.message);
                              }
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-sm font-bold text-white">
                              {playlist.title}
                              <span className="ml-2 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9.5px] font-bold text-red-300">
                                YouTube
                              </span>
                            </p>
                            <p className="truncate text-xs text-white/45 mt-0.5">
                              {playlist.itemCount} tracks • {playlist.privacy}
                              {playlist.channelTitle ? ` • ${playlist.channelTitle}` : ''}
                            </p>
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={async () => {
                                try {
                                  const tracks = await getYoutubeTracks(playlist);
                                  if (tracks.length) onPlay(tracks[0], tracks);
                                  else setYoutubeMessage('This playlist has no playable videos.');
                                } catch (error: any) {
                                  setYoutubeMessage(isReauthError(error) ? reauthMessage() : error.message);
                                }
                              }}
                              className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                            >
                              Play
                            </button>
                            <button
                              onClick={() => void openImportPreview(playlist)}
                              className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black hover:bg-white/90 shadow-sm"
                            >
                              Import
                            </button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="mt-2.5 max-h-60 overflow-y-auto divide-y divide-white/5 rounded-xl bg-black/40 p-1">
                            {ytTracksLoading && items.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-white/45">Loading tracks…</p>
                            ) : items.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-white/45">No tracks found.</p>
                            ) : (
                              items.map((item) => (
                                <button
                                  key={item.id}
                                  onClick={async () => {
                                    const t = itemToTrack(item);
                                    if (t) {
                                      const tracks = await getYoutubeTracks(playlist).catch(() => [] as Track[]);
                                      onPlay(t, tracks.length ? tracks : [t]);
                                    }
                                  }}
                                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 rounded-lg transition-colors"
                                >
                                  <img
                                    src={item.thumbnail || `https://i.ytimg.com/vi/${item.videoId || ''}/default.jpg`}
                                    alt=""
                                    className="h-8 w-8 rounded-lg object-cover bg-white/5 shrink-0"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-semibold text-white">
                                      {item.title || 'Unknown title'}
                                    </span>
                                    <span className="block truncate text-[11px] text-white/45">
                                      {item.channelTitle || item.artist || 'YouTube'}
                                    </span>
                                  </div>
                                  <Play className="h-3.5 w-3.5 shrink-0 text-white/40" />
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {youtubeConnected && !youtubeLoading && youtubePlaylists.length === 0 && !youtubeMessage && (
                    <p className="text-xs text-white/45 p-2">No YouTube playlists found in this account.</p>
                  )}
                </div>
              </div>

              {/* YouTube Import Preview Modal */}
              {previewPlaylist && (
                <div
                  className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-md p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Import to Wave Player"
                >
                  <div className="w-full max-w-lg rounded-[24px] border border-white/10 bg-[#141416] p-5 sm:p-6 space-y-4 shadow-[0_24px_64px_rgba(0,0,0,0.85)]">
                    <div>
                      <h3 className="text-base font-bold text-white">Import to Wave Player</h3>
                      <p className="truncate text-xs text-white/55 mt-0.5">
                        {previewPlaylist.title} • {previewPlaylist.itemCount} tracks on YouTube
                      </p>
                    </div>

                    {previewBusy && !preview ? (
                      <div className="space-y-3">
                        <p className="text-xs text-white/60">
                          {previewProgress
                            ? `Matching songs… ${previewProgress.loaded}/${previewProgress.total} (${previewProgress.matched} matched)`
                            : 'Loading playlist tracks…'}
                        </p>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-white transition-all duration-300"
                            style={{
                              width:
                                previewProgress && previewProgress.total
                                  ? `${Math.round((previewProgress.loaded / previewProgress.total) * 100)}%`
                                  : '8%',
                            }}
                          />
                        </div>
                        <button
                          onClick={closePreview}
                          className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/75 hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : previewError && !preview ? (
                      <div className="space-y-3">
                        <p role="alert" className="text-xs text-red-300">{previewError}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={closePreview}
                            className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/75"
                          >
                            Close
                          </button>
                          {previewError.includes('reconnect') && (
                            <button
                              onClick={() => location.assign('/api/auth/youtube/connect')}
                              className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
                            >
                              Reconnect YouTube
                            </button>
                          )}
                        </div>
                      </div>
                    ) : preview ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-emerald-400/10 border border-emerald-500/20 px-2.5 py-1 text-emerald-300 font-medium">
                            ✓ Matched: {preview.matched.length}
                          </span>
                          <span className="rounded-full bg-amber-400/10 border border-amber-500/20 px-2.5 py-1 text-amber-300 font-medium">
                            ⚠ Possible: {preview.possible.length}
                          </span>
                          <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-white/55 font-medium">
                            ✕ Unmatched: {preview.unmatched.length}
                          </span>
                        </div>
                        {preview.unmatched.length > 0 && (
                          <div className="max-h-48 overflow-y-auto rounded-xl bg-black/40 p-2 divide-y divide-white/5">
                            {[
                              ...preview.possible.map((m) => ({ ...m, mark: '⚠' })),
                              ...preview.unmatched.map((m) => ({ ...m, mark: '✕' })),
                            ]
                              .slice(0, 30)
                              .map((m) => (
                                <p
                                  key={m.youtubeVideoId || m.title}
                                  className="truncate px-2 py-1 text-xs text-white/60"
                                >
                                  {m.mark} {m.title} — {m.channelTitle || 'Unknown'}
                                  {m.tier === 'possible' ? ' (possible match)' : ''}
                                </p>
                              ))}
                          </div>
                        )}
                        <p className="text-[11.5px] text-white/45">
                          Matched tracks import as high-quality audio tracks. Unmatched tracks will be preserved as YouTube stream items.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            disabled={importing || !preview.matched.length}
                            onClick={() => void confirmImport(false)}
                            className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/90 disabled:opacity-40 shadow-sm"
                          >
                            {importing ? 'Importing…' : `Import matched (${preview.matched.length})`}
                          </button>
                          {preview.possible.length > 0 && (
                            <button
                              disabled={importing}
                              onClick={() => void confirmImport(true)}
                              className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-white/85 hover:bg-white/10 disabled:opacity-40"
                            >
                              Include possible ({preview.matched.length + preview.possible.length})
                            </button>
                          )}
                          <button
                            disabled={importing}
                            onClick={closePreview}
                            className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/75 hover:bg-white/10"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================================================= */}
          {/* TAB 5: LIKED SONGS (DEDICATED HERO SECTION) */}
          {/* ======================================================= */}
          {tab === 'favs' && (
            <div className="space-y-6">
              {/* Liked Songs Hero Banner */}
              <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-red-600/30 via-[#18181b]/95 to-rose-950/40 p-6 sm:p-8 backdrop-blur-2xl shadow-[0_20px_50px_rgba(220,38,38,0.15)]">
                <div className="flex flex-col sm:flex-row sm:items-end gap-5">
                  <div className="flex h-28 w-28 sm:h-36 sm:w-36 items-center justify-center rounded-[24px] bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-[0_12px_32px_rgba(239,68,68,0.5)] shrink-0">
                    <Heart className="h-14 w-14 sm:h-18 sm:w-18 fill-current" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 border border-red-500/30 px-3 py-0.5 text-xs font-bold text-red-300">
                      <Heart className="h-3 w-3 fill-current" /> Auto Playlist
                    </span>
                    <h2 className="text-[28px] sm:text-[38px] font-black text-white tracking-tight leading-none">
                      Liked Songs
                    </h2>
                    <p className="text-xs sm:text-sm text-white/60 font-medium">
                      {favs.length} songs • {formatTotalDuration(favs)}
                    </p>
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => handlePlayAll(processedLikedSongs)}
                        disabled={!processedLikedSongs.length}
                        className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs sm:text-sm font-bold text-black hover:bg-white/90 active:scale-95 disabled:opacity-40 transition-all shadow-md"
                      >
                        <Play className="h-4 w-4 fill-current ml-0.5" /> Play All
                      </button>
                      <button
                        onClick={() => handleShuffle(processedLikedSongs)}
                        disabled={!processedLikedSongs.length}
                        className="inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white active:scale-95 disabled:opacity-40 transition-all"
                      >
                        <Shuffle className="h-4 w-4" /> Shuffle
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Liked Songs Table */}
              {processedLikedSongs.length === 0 ? (
                <NoContent
                  variant="favs"
                  title="No liked songs yet"
                  description="Tap the heart icon on any song to save it to your Liked Songs collection."
                  actionLabel="Discover Songs"
                  onAction={() => onNavigate?.('explore')}
                />
              ) : (
                <div className="rounded-[20px] border border-white/10 bg-[#101012]/80 backdrop-blur-xl p-1 sm:p-2 divide-y divide-white/[0.04] shadow-sm">
                  {processedLikedSongs.map((t, idx) => {
                    const isActive = currentTrack?.id === t.id;
                    return (
                      <SongRow
                        key={t.id}
                        track={t}
                        index={idx}
                        isActive={isActive}
                        isPlaying={isActive && isPlaying}
                        onPlay={() => handlePlaySong(t, processedLikedSongs)}
                        onOpenMenu={handleOpenContextMenu}
                        onNavigate={onNavigate}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ======================================================= */}
          {/* TAB 6: RECENTLY PLAYED (WITH RELATIVE TIMESTAMPS) */}
          {/* ======================================================= */}
          {tab === 'recent' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                    <Clock className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Recently Played</h3>
                    <p className="text-xs text-white/50">{processedRecentSongs.length} recent tracks</p>
                  </div>
                </div>
                {processedRecentSongs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePlayAll(processedRecentSongs)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all shadow-sm"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" /> Play All
                    </button>
                    <button
                      onClick={() => handleShuffle(processedRecentSongs)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-3.5 py-1.5 text-xs font-semibold text-white active:scale-95 transition-all"
                    >
                      <Shuffle className="h-3.5 w-3.5" /> Shuffle
                    </button>
                  </div>
                )}
              </div>

              {processedRecentSongs.length === 0 ? (
                <NoContent
                  variant="songs"
                  title="No listening history yet"
                  description="Songs you listen to will appear here with relative timestamps and play counts."
                  actionLabel="Start Listening"
                  onAction={() => onNavigate?.('explore')}
                />
              ) : (
                <div className="rounded-[20px] border border-white/10 bg-[#101012]/80 backdrop-blur-xl p-1 sm:p-2 divide-y divide-white/[0.04]">
                  {processedRecentSongs.map((t, idx) => {
                    const isActive = currentTrack?.id === t.id;
                    const timestamp = recentTimestampsMap[t.id];
                    const relTime = timestamp ? formatRelativeTime(timestamp) : 'Recently';
                    const playCount = playCountsMap[t.id] || 0;
                    return (
                      <SongRow
                        key={`${t.id}-${idx}`}
                        track={t}
                        index={idx}
                        isActive={isActive}
                        isPlaying={isActive && isPlaying}
                        onPlay={() => handlePlaySong(t, processedRecentSongs)}
                        subtitleExtra={`${relTime}${playCount > 1 ? ` • ${playCount} plays` : ''}`}
                        onOpenMenu={handleOpenContextMenu}
                        onNavigate={onNavigate}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ======================================================= */}
          {/* TAB 7: DOWNLOADS (OFFLINE / SAVED TRACKS) */}
          {/* ======================================================= */}
          {tab === 'downloads' && (
            <div className="space-y-4">
              {history.length === 0 ? (
                <NoContent
                  variant="generic"
                  title="No downloaded tracks yet"
                  description="Downloaded and cached songs for offline listening will appear here."
                  actionLabel="Browse Music"
                  onAction={() => onNavigate?.('explore')}
                />
              ) : (
                <div className="rounded-[20px] border border-white/10 bg-[#101012]/80 backdrop-blur-xl p-1 sm:p-2 divide-y divide-white/[0.04]">
                  {history.map((t, idx) => {
                    const isActive = currentTrack?.id === t.id;
                    return (
                      <SongRow
                        key={`${t.id}-${idx}`}
                        track={t}
                        index={idx}
                        isActive={isActive}
                        isPlaying={isActive && isPlaying}
                        onPlay={() => handlePlaySong(t, history)}
                        subtitleExtra="Cached • High Quality"
                        onOpenMenu={handleOpenContextMenu}
                        onNavigate={onNavigate}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Floating Multi-Select Bulk Action Bar */}
      {selectable && (
        <BulkActionBar
          selectedTracks={getSelectedTracksList(
            tab === 'favs' ? processedLikedSongs : tab === 'recent' ? processedRecentSongs : processedSongs
          )}
          onPlayAll={() =>
            handleBulkPlay(
              tab === 'favs' ? processedLikedSongs : tab === 'recent' ? processedRecentSongs : processedSongs
            )
          }
          onAddToQueue={() =>
            handleBulkAddToQueue(
              tab === 'favs' ? processedLikedSongs : tab === 'recent' ? processedRecentSongs : processedSongs
            )
          }
          onAddToPlaylist={() =>
            handleBulkAddToPlaylist(
              tab === 'favs' ? processedLikedSongs : tab === 'recent' ? processedRecentSongs : processedSongs
            )
          }
          onLikeAll={() =>
            handleBulkLikeAll(
              tab === 'favs' ? processedLikedSongs : tab === 'recent' ? processedRecentSongs : processedSongs
            )
          }
          onClearSelection={() => {
            setSelectedIds(new Set());
            setSelectable(false);
          }}
        />
      )}

      {/* Song Context Menu (⋮) */}
      <SongContextMenu
        isOpen={isMenuOpen}
        onClose={() => {
          setIsMenuOpen(false);
          setMenuTrack(null);
        }}
        track={menuTrack}
        onPlay={() => {
          if (menuTrack) {
            handlePlaySong(menuTrack, [menuTrack]);
          }
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

      {/* Rename Playlist Modal */}
      <PlaylistModal
        isOpen={!!renameTarget}
        mode="edit"
        initial={
          renameTarget
            ? { title: renameTarget.title, description: renameTarget.description || '', privacyStatus: renameTarget.privacyStatus || 'PRIVATE' }
            : undefined
        }
        busy={renameBusy}
        onClose={() => setRenameTarget(null)}
        onSubmit={handleRenamePlaylist}
      />

      {/* Ephemeral Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-full bg-white text-black px-4 py-2 text-xs font-bold shadow-[0_8px_30px_rgba(0,0,0,0.6)] flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
