import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Shuffle,
  Share2,
  ListMusic,
  Clock,
  ArrowLeft,
  Loader2,
  Music2,
  User,
  Heart,
  MoreVertical,
  Plus,
  Pencil,
  Trash2,
  Radio,
  LibraryBig,
  ArrowUp,
  ArrowDown,
  GripVertical,
  X,
  Search,
  ListPlus,
} from 'lucide-react';
import { Track, Playlist } from '../types';
import { getSaavnPlaylistDetails, searchSaavnPlaylists } from '../services/saavnApi';
import { fetchRadio } from '../services/recommendationApi';
import { playerStore } from '../services/playerStore';
import {
  LocalPlaylist,
  getLocalPlaylists,
  saveLocalPlaylists,
  createLocalPlaylist,
  removeTrackFromPlaylist,
  deleteLocalPlaylist,
  sortTracks,
  formatTotalDuration,
} from '../services/libraryStore';
import { SongRow } from '../components/SongRow';
import { SongContextMenu } from '../components/SongContextMenu';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { PlaylistModal, PlaylistModalValue } from '../components/PlaylistModal';
import { NoContent } from '../components/NoContent';
import { toast } from '../components/Toast';

interface PlaylistPageProps {
  playlistId?: string;
  onPlay: (t: Track, list?: Track[]) => void;
  onNavigate?: (page: string, param?: string) => void;
  onBack?: () => void;
}

type SortMode = 'custom' | 'recent_added' | 'recent_played' | 'title_asc' | 'artist_asc' | 'album_asc' | 'duration_desc' | 'year_desc';

const SORT_LABELS: Array<{ id: SortMode; label: string }> = [
  { id: 'custom', label: 'Custom order' },
  { id: 'recent_added', label: 'Recently added' },
  { id: 'recent_played', label: 'Recently played' },
  { id: 'title_asc', label: 'Title A–Z' },
  { id: 'artist_asc', label: 'Artist A–Z' },
  { id: 'album_asc', label: 'Album A–Z' },
  { id: 'duration_desc', label: 'Longest first' },
  { id: 'year_desc', label: 'Newest first' },
];

const isLocalRef = (id: string | undefined) => !!id && id.startsWith('local:');
const localIdOf = (id: string) => id.slice('local:'.length);
const sortKeyOf = (id: string) => `wave:playlist:sort:${id}`;

function sourceBadge(source?: string, youtubeId?: string) {
  if (source === 'youtube' || youtubeId) return { label: 'YouTube import', cls: 'bg-red-500/15 text-red-300 border-red-500/25' };
  if (source === 'youtube-pure') return { label: 'YouTube', cls: 'bg-red-500/15 text-red-300 border-red-500/25' };
  return { label: 'Wave Player', cls: 'bg-white/10 text-white/70 border-white/10' };
}

export const PlaylistPage: React.FC<PlaylistPageProps> = ({ playlistId, onPlay, onNavigate, onBack }) => {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [localPl, setLocalPl] = useState<LocalPlaylist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [featuredPlaylists, setFeaturedPlaylists] = useState<Playlist[]>([]);

  const [sortMode, setSortMode] = useState<SortMode>('custom');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reorderMode, setReorderMode] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerTracks, setPickerTracks] = useState<Track[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [radioTracks, setRadioTracks] = useState<Track[]>([]);
  const [radioLoading, setRadioLoading] = useState(false);
  const searchTimer = useRef<number | null>(null);

  const currentPlayingId = playerStore.current()?.id;
  const isLocal = isLocalRef(playlistId);
  const canEdit = !!localPl;

  // Debounced in-playlist search (client-side only — never refetches).
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query]);

  useEffect(() => {
    if (playlistId) {
      try {
        setSortMode((localStorage.getItem(sortKeyOf(playlistId)) as SortMode) || 'custom');
      } catch {
        setSortMode('custom');
      }
      setQuery('');
      setSelectMode(false);
      setSelected(new Set());
      setReorderMode(false);
      if (isLocalRef(playlistId)) loadLocalPlaylist(localIdOf(playlistId));
      else loadPlaylist(playlistId);
    } else {
      loadFeaturedPlaylists();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  const persistLocal = (pl: LocalPlaylist) => {
    const all = getLocalPlaylists().map((p) => (p.id === pl.id ? pl : p));
    saveLocalPlaylists(all);
    setLocalPl({ ...pl });
    setTracks([...(pl.songs || [])]);
  };

  const loadLocalPlaylist = (id: string) => {
    setLoading(true);
    setLoadError('');
    setPlaylist(null);
    try {
      const found = getLocalPlaylists().find((p) => p.id === id) || null;
      if (!found) {
        setLoadError('This playlist is no longer available on this device.');
        setLocalPl(null);
        setTracks([]);
      } else {
        setLocalPl(found);
        setTracks([...(found.songs || [])]);
      }
    } catch {
      setLoadError('Could not read this playlist from local storage.');
    } finally {
      setLoading(false);
    }
  };

  const loadPlaylist = async (id: string) => {
    setLoading(true);
    setLoadError('');
    setLocalPl(null);
    try {
      const res = await getSaavnPlaylistDetails(id);
      if (res && res.playlist) {
        setPlaylist(res.playlist);
        setTracks(res.tracks || []);
      } else {
        setLoadError('This playlist is unavailable right now.');
      }
    } catch {
      setLoadError('Could not load this playlist. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  };

  const loadFeaturedPlaylists = async () => {
    setLoading(true);
    try {
      const res = await searchSaavnPlaylists('Top Hits 2024');
      setFeaturedPlaylists(res.playlists || []);
    } catch {
      setFeaturedPlaylists([]);
    } finally {
      setLoading(false);
    }
  };

  // Playlist radio + More Like This (central recommendation engine).
  useEffect(() => {
    if (!playlistId || loading || !tracks.length) return;
    let cancelled = false;
    setRadioLoading(true);
    fetchRadio(tracks[0], 12)
      .then((list) => {
        if (!cancelled) setRadioTracks(list.filter((t) => !tracks.some((x) => x.id === t.id)).slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setRadioTracks([]);
      })
      .finally(() => {
        if (!cancelled) setRadioLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId, loading]);

  const visibleTracks = useMemo(() => {
    let list = [...tracks];
    if (debouncedQuery) {
      const q = debouncedQuery;
      list = list.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.author?.toLowerCase().includes(q) ||
          t.albumName?.toLowerCase().includes(q),
      );
    }
    if (sortMode === 'custom' || sortMode === 'recent_added') return list;
    if (sortMode === 'year_desc') {
      return [...list].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
    }
    if (sortMode === 'recent_played') {
      const hist = playerStore.historyList();
      const rank = new Map<string, number>();
      hist.forEach((t, i) => {
        if (!rank.has(t.id)) rank.set(t.id, i);
      });
      return [...list].sort((a, b) => (rank.has(a.id) ? rank.get(a.id)! : 1e9) - (rank.has(b.id) ? rank.get(b.id)! : 1e9));
    }
    return sortTracks(list, sortMode);
  }, [tracks, debouncedQuery, sortMode]);

  const changeSort = (mode: SortMode) => {
    setSortMode(mode);
    try {
      if (playlistId) localStorage.setItem(sortKeyOf(playlistId), mode);
    } catch {}
  };

  const hero = useMemo(() => {
    if (localPl) {
      const cover = localPl.thumbnail || localPl.songs?.[0]?.thumbnail || '';
      return {
        title: localPl.title,
        description: localPl.description || '',
        owner: localPl.source === 'youtube' ? 'YouTube import' : 'Wave Player',
        cover,
        privacy: localPl.privacyStatus,
        badge: sourceBadge(localPl.source, localPl.youtubePlaylistId || localPl.sourcePlaylistId),
        showLocalOrder: localPl.source === 'youtube' || !!localPl.youtubePlaylistId,
      };
    }
    if (playlist) {
      return {
        title: playlist.name,
        description: playlist.description || '',
        owner: playlist.author || 'JioSaavn Editorial',
        cover: playlist.thumbnails?.[0]?.url || '',
        privacy: undefined,
        badge: { label: 'JioSaavn', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
        showLocalOrder: false,
      };
    }
    return null;
  }, [localPl, playlist]);

  const handlePlayAll = () => {
    if (!visibleTracks.length) return;
    onPlay(visibleTracks[0], visibleTracks);
  };

  const handleShuffle = () => {
    if (!visibleTracks.length) return;
    const shuffled = [...visibleTracks].sort(() => Math.random() - 0.5);
    playerStore.setQueue(shuffled, 0);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
  };

  const handleAddQueue = () => {
    if (!visibleTracks.length) return;
    let added = 0;
    for (const t of visibleTracks) {
      const before = playerStore.queue().length;
      playerStore.addToQueue(t);
      if (playerStore.queue().length > before) added++;
    }
    toast.success(added ? `Added ${added} song${added === 1 ? '' : 's'} to queue` : 'Already in queue');
  };

  const handlePlayNext = () => {
    if (!visibleTracks.length) return;
    for (let i = visibleTracks.length - 1; i >= 0; i--) playerStore.playNext(visibleTracks[i]);
    toast.success('Playlist will play next');
  };

  const handleStartRadio = async () => {
    if (!visibleTracks.length) return;
    const list = radioTracks.length ? [visibleTracks[0], ...radioTracks.filter((t) => t.id !== visibleTracks[0].id)] : null;
    if (list) {
      onPlay(list[0], list);
      return;
    }
    const fresh = await fetchRadio(visibleTracks[0], 15).catch(() => [] as Track[]);
    if (fresh.length) onPlay(fresh[0], fresh);
    else toast.error('Radio is unavailable right now');
  };

  const handleShare = async () => {
    const name = hero?.title || 'Wave playlist';
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: name, text: `Listen to ${name} on Wave Music`, url });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const handleAddToLibrary = () => {
    if (!playlist || !tracks.length) return;
    const created = createLocalPlaylist(playlist.name, playlist.description || '', tracks);
    toast.success(`Saved “${created.title}” to your library`);
    onNavigate?.('playlist', `local:${created.id}`);
  };

  const handleRename = (value: { title: string; description: string; privacyStatus: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' }) => {
    if (!localPl) return;
    setEditBusy(true);
    try {
      persistLocal({ ...localPl, title: value.title, description: value.description, privacyStatus: value.privacyStatus, updatedAt: new Date().toISOString() });
      toast.success('Playlist updated');
      setEditOpen(false);
    } finally {
      setEditBusy(false);
    }
  };

  const handleDelete = () => {
    if (!localPl) return;
    if (!window.confirm(`Delete “${localPl.title}”? This cannot be undone.`)) return;
    deleteLocalPlaylist(localPl.id);
    toast.success('Playlist deleted');
    if (onBack) onBack();
    else window.history.back();
  };

  const handleRemoveTrack = (track: Track) => {
    if (!localPl) return;
    if (removeTrackFromPlaylist(localPl.id, track.id)) {
      const next = getLocalPlaylists().find((p) => p.id === localPl.id) || null;
      if (next) {
        setLocalPl(next);
        setTracks([...(next.songs || [])]);
      }
      if (currentPlayingId === track.id) toast.info('Removed the currently playing song from this playlist');
      else toast.success('Removed from playlist');
    } else {
      toast.error('Could not remove that song');
    }
  };

  const moveTrack = (from: number, to: number) => {
    if (!localPl || to < 0 || to >= tracks.length || from === to) return;
    const songs = [...tracks];
    const [moved] = songs.splice(from, 1);
    songs.splice(to, 0, moved);
    persistLocal({ ...localPl, songs, updatedAt: new Date().toISOString() });
  };

  const handleOpenMenu = (track: Track) => {
    setMenuTrack(track);
    setMenuOpen(true);
  };

  const toggleSelect = (track: Track, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(track.id);
      else next.delete(track.id);
      return next;
    });
  };

  const selectedTracks = useMemo(() => tracks.filter((t) => selected.has(t.id)), [tracks, selected]);

  const bulkPlay = () => {
    if (selectedTracks.length) onPlay(selectedTracks[0], selectedTracks);
  };
  const bulkQueue = () => {
    let added = 0;
    for (const t of selectedTracks) {
      const before = playerStore.queue().length;
      playerStore.addToQueue(t);
      if (playerStore.queue().length > before) added++;
    }
    toast.success(added ? `Queued ${added} song${added === 1 ? '' : 's'}` : 'Already in queue');
  };
  const bulkLike = () => {
    for (const t of selectedTracks) if (!playerStore.isFav(t.id)) playerStore.toggleFav(t);
    toast.success(`Liked ${selectedTracks.length} song${selectedTracks.length === 1 ? '' : 's'}`);
  };
  const bulkRemove = () => {
    if (!localPl || !selectedTracks.length) return;
    let all = getLocalPlaylists();
    const pl = all.find((p) => p.id === localPl.id);
    if (!pl) return;
    const ids = new Set(selectedTracks.map((t) => t.id));
    pl.songs = (pl.songs || []).filter((s) => !ids.has(s.id));
    pl.updatedAt = new Date().toISOString();
    saveLocalPlaylists(all);
    const next = getLocalPlaylists().find((p) => p.id === localPl.id) || null;
    if (next) {
      setLocalPl(next);
      setTracks([...(next.songs || [])]);
    }
    setSelected(new Set());
    setSelectMode(false);
    toast.success('Removed from playlist');
  };

  // If no playlist is selected, render Playlist Discovery grid
  if (!playlistId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#86868b] flex items-center gap-1.5">
              <ListMusic className="h-3 w-3 text-amber-400" /> Playlists
            </p>
            <h1 className="mt-1 text-[26px] sm:text-[30px] font-extrabold tracking-[-0.03em] text-white">
              Curated Playlists
            </h1>
            <p className="mt-1 text-[13px] text-[#86868b]">
              Editorial mixes and trending chart collections
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {featuredPlaylists.map((p) => (
              <motion.div
                key={p.playlistId}
                whileHover={{ y: -4 }}
                onClick={() => onNavigate?.('playlist', p.playlistId)}
                className="group relative cursor-pointer lg-card p-3"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#141416] ring-1 ring-white/10">
                  <img
                    src={p.thumbnails?.[0]?.url || ''}
                    alt={p.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </span>
                  </div>
                </div>
                <div className="mt-3 min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-white group-hover:text-amber-300 transition-colors">
                    {p.name}
                  </p>
                  <p className="truncate text-[12px] text-[#86868b] mt-0.5">
                    {p.author || 'JioSaavn Editorial'}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-7 pb-8" aria-busy="true" aria-label="Loading playlist">
        <div className="h-9 w-24 animate-pulse rounded-full bg-white/10" />
        <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="h-[190px] w-[190px] sm:h-[220px] sm:w-[220px] shrink-0 animate-pulse rounded-[22px] bg-white/10" />
            <div className="flex-1 space-y-3 w-full">
              <div className="h-8 w-2/3 animate-pulse rounded-lg bg-white/10" />
              <div className="h-4 w-1/3 animate-pulse rounded-lg bg-white/10" />
              <div className="flex gap-2">
                <div className="h-5 w-20 animate-pulse rounded-full bg-white/10" />
                <div className="h-5 w-24 animate-pulse rounded-full bg-white/10" />
              </div>
              <div className="flex gap-3 pt-2">
                <div className="h-11 w-32 animate-pulse rounded-full bg-white/10" />
                <div className="h-11 w-28 animate-pulse rounded-full bg-white/10" />
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <div className="h-11 w-11 animate-pulse rounded-[12px] bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/10" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError || (!localPl && !playlist)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[15px] font-bold text-white">{loadError || 'Playlist unavailable'}</p>
        <p className="max-w-[36ch] text-xs text-white/50">It may have been deleted or the connection failed. Nothing was changed.</p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => (isLocal ? loadLocalPlaylist(localIdOf(playlistId || '')) : loadPlaylist(playlistId || ''))}
            className="rounded-full bg-white px-5 py-2 text-xs font-bold text-black"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="rounded-full border border-white/10 px-5 py-2 text-xs font-semibold text-white/75"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const coverUrl = hero?.cover || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-7 pb-8"
    >
      {/* Back button */}
      <button
        type="button"
        onClick={() => (onBack ? onBack() : window.history.back())}
        className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] px-3.5 py-1.5 text-xs font-semibold text-white/90 transition-all cursor-pointer active:scale-95 shadow-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      {/* Hero Playlist Header Banner */}
      <div className="relative overflow-hidden rounded-[28px] sm:rounded-[32px] lg-hero p-6 sm:p-8 lg:p-10">
        {coverUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
            <img src={coverUrl} alt="" className="h-full w-full object-cover scale-150 blur-[54px] opacity-35" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/50" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
          </div>
        )}

        <div className="relative flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8">
          <div className="relative h-[190px] w-[190px] sm:h-[220px] sm:w-[220px] shrink-0 rounded-[22px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] ring-1 ring-white/20 bg-[#161619]">
            {coverUrl ? (
              <img src={coverUrl} alt={hero?.title} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-white/30">
                <Music2 className="h-12 w-12" />
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col justify-end min-w-0 text-center sm:text-left">
            <div className="inline-flex items-center justify-center sm:justify-start gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-400">
              <ListMusic className="h-3.5 w-3.5" /> {hero?.owner || 'Playlist'}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal ${hero?.badge.cls}`}>
                {hero?.badge.label}
              </span>
            </div>

            <h1 className="mt-2 text-[26px] sm:text-[34px] lg:text-[40px] font-black tracking-[-0.03em] leading-tight text-white line-clamp-2">
              {hero?.title}
            </h1>

            <p className="mt-2 text-[15px] sm:text-[16px] font-semibold text-white/90 flex items-center justify-center sm:justify-start gap-2">
              <User className="h-4 w-4 text-[#86868b]" />
              {hero?.owner}
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[12px] text-white/70">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                <Music2 className="h-3 w-3" /> {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
                {tracks.length > 0 && ` • ${formatTotalDuration(tracks)}`}
              </span>
              {hero?.privacy && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08] uppercase text-[10px] font-bold">
                  {hero.privacy}
                </span>
              )}
              {hero?.showLocalOrder && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08] text-[10px] font-bold text-white/60">
                  Local order
                </span>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <button
                type="button"
                onClick={handlePlayAll}
                disabled={!visibleTracks.length}
                className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-bold text-black hover:bg-white/90 shadow-[0_4px_20px_rgba(255,255,255,0.25)] active:scale-95 transition-all disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" /> Play
              </button>
              <button
                type="button"
                onClick={handleShuffle}
                disabled={!visibleTracks.length}
                className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-5 text-[14px] font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
              >
                <Shuffle className="h-4 w-4" /> Shuffle
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white transition-all"
                title="Share playlist"
                aria-label="Share playlist"
              >
                <Share2 className="h-4 w-4" />
              </button>
              {!localPl && (
                <button
                  type="button"
                  onClick={handleAddToLibrary}
                  disabled={!tracks.length}
                  className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-5 text-[14px] font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
                  title="Save a copy to your library"
                >
                  <LibraryBig className="h-4 w-4" /> <span className="hidden sm:inline">Add to Library</span>
                </button>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white transition-all"
                  title="More actions"
                  aria-label="More playlist actions"
                  aria-expanded={moreOpen}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {moreOpen && (
                  <div className="absolute left-0 z-30 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#141416]/98 shadow-[0_24px_64px_rgba(0,0,0,0.85)] backdrop-blur-2xl">
                    <div className="p-2">
                      <button type="button" onClick={() => { setMoreOpen(false); handleAddQueue(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black">
                        <Plus className="h-4 w-4" /> Add playlist to queue
                      </button>
                      <button type="button" onClick={() => { setMoreOpen(false); handlePlayNext(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black">
                        <ListPlus className="h-4 w-4" /> Play next
                      </button>
                      <button type="button" onClick={() => { setMoreOpen(false); void handleStartRadio(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black">
                        <Radio className="h-4 w-4" /> Start playlist radio
                      </button>
                      {canEdit && (
                        <>
                          <button type="button" onClick={() => { setMoreOpen(false); setEditOpen(true); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black">
                            <Pencil className="h-4 w-4" /> Rename / edit
                          </button>
                          <button type="button" onClick={() => { setMoreOpen(false); handleDelete(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-rose-300 hover:bg-rose-500 hover:text-white">
                            <Trash2 className="h-4 w-4" /> Delete playlist
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tracklist toolbar: search + sort + select + reorder */}
      {tracks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this playlist"
              aria-label="Search this playlist"
              className="w-full rounded-full bg-white/[0.06] border border-white/[0.08] pl-9 pr-8 py-2 text-[13px] text-white placeholder:text-white/35 outline-none focus:border-white/25"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white" aria-label="Clear search">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <label className="sr-only" htmlFor="pl-sort">Sort tracks</label>
          <select
            id="pl-sort"
            value={sortMode}
            onChange={(e) => changeSort(e.target.value as SortMode)}
            className="rounded-full bg-white/[0.06] border border-white/[0.08] px-3.5 py-2 text-xs font-semibold text-white outline-none focus:border-white/25 [&>option]:bg-neutral-900"
          >
            {SORT_LABELS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
            aria-pressed={selectMode}
            className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${selectMode ? 'border-white bg-white text-black' : 'border-white/10 bg-white/[0.06] text-white/70 hover:bg-white hover:text-black'}`}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setReorderMode((v) => !v)}
              aria-pressed={reorderMode}
              title={hero?.showLocalOrder ? 'Reorder your local copy (YouTube order is unchanged)' : 'Reorder tracks'}
              className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${reorderMode ? 'border-white bg-white text-black' : 'border-white/10 bg-white/[0.06] text-white/70 hover:bg-white hover:text-black'}`}
            >
              {reorderMode ? 'Done' : 'Reorder'}
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectMode && selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#141416]/95 px-4 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
          >
            <span className="text-xs font-bold text-white">{selected.size} selected</span>
            <span className="h-4 w-px bg-white/10" />
            <button type="button" onClick={bulkPlay} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-black"><Play className="h-3 w-3 fill-current" /> Play</button>
            <button type="button" onClick={bulkQueue} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/85 hover:bg-white hover:text-black"><ListPlus className="h-3 w-3" /> Queue</button>
            <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/85 hover:bg-white hover:text-black"><Plus className="h-3 w-3" /> Playlist</button>
            <button type="button" onClick={bulkLike} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/85 hover:bg-white hover:text-black"><Heart className="h-3 w-3" /> Like</button>
            {canEdit && (
              <button type="button" onClick={bulkRemove} className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 px-3.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500 hover:text-white"><Trash2 className="h-3 w-3" /> Remove</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tracklist */}
      <div className="lg-panel">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/[0.06] text-[11px] font-bold uppercase tracking-[0.08em] text-[#86868b]">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <span className="w-6 text-center hidden min-[420px]:block">#</span>
            <span className="w-10 hidden sm:block text-center"><Music2 className="h-3 w-3 mx-auto" /></span>
            <span>Title {debouncedQuery ? `· ${visibleTracks.length} of ${tracks.length}` : ''}</span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6 shrink-0">
            <span className="w-12 text-right hidden min-[420px]:flex items-center justify-end gap-1">
              <Clock className="h-3 w-3" /> Time
            </span>
            <span className="w-10 sm:w-16 text-right">Action</span>
          </div>
        </div>

        {visibleTracks.length === 0 ? (
          <div className="px-4 py-10 text-center">
            {tracks.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[14px] font-bold text-white">This playlist is empty.</p>
                <p className="text-xs text-white/50">Add songs from any track menu, or discover music to fill it up.</p>
                <div className="flex justify-center gap-2 pt-2">
                  <button type="button" onClick={() => onNavigate?.('search')} className="rounded-full bg-white px-5 py-2 text-xs font-bold text-black">Explore music</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/50">No tracks match “{debouncedQuery}”.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {visibleTracks.map((t, idx) => {
              const isTrackActive = currentPlayingId === t.id;
              const realIdx = tracks.findIndex((x) => x.id === t.id);
              return (
                <div
                  key={t.id || idx}
                  draggable={reorderMode && canEdit && sortMode === 'custom' && !debouncedQuery}
                  onDragStart={() => setDragIdx(realIdx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== realIdx) moveTrack(dragIdx, realIdx);
                    setDragIdx(null);
                  }}
                  className={dragIdx === realIdx ? 'opacity-40' : ''}
                >
                  <div className="flex items-center gap-1">
                    {reorderMode && canEdit && (
                      <span className="flex flex-col pl-1" role="group" aria-label={`Reorder ${t.title}`}>
                        <button type="button" onClick={() => moveTrack(realIdx, realIdx - 1)} disabled={realIdx <= 0} className="p-1 text-white/50 hover:text-white disabled:opacity-25" aria-label={`Move ${t.title} up`}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => moveTrack(realIdx, realIdx + 1)} disabled={realIdx < 0 || realIdx >= tracks.length - 1} className="p-1 text-white/50 hover:text-white disabled:opacity-25" aria-label={`Move ${t.title} down`}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                    {reorderMode && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-white/30" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <SongRow
                        track={t}
                        index={idx}
                        isActive={isTrackActive}
                        onPlay={() => onPlay(t, visibleTracks)}
                        onNavigate={onNavigate}
                        selectable={selectMode}
                        selected={selected.has(t.id)}
                        onToggleSelect={(on) => toggleSelect(t, on)}
                        onOpenMenu={handleOpenMenu}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* About */}
      {(localPl?.description || (playlist as Playlist | null)?.description) && (
        <div className="rounded-[20px] glass p-5 text-xs text-[#86868b] leading-relaxed">
          <p className="font-semibold text-white/70 uppercase tracking-wider text-[10px] mb-1">About this Playlist</p>
          {localPl?.description || (playlist as Playlist | null)?.description}
        </div>
      )}

      {/* More Like This Playlist (central recommendation engine) */}
      {(radioTracks.length > 0 || radioLoading) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Heart className="h-3.5 w-3.5 text-rose-400" />
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-white">More Like This Playlist</h2>
          </div>
          <p className="-mt-2 text-[12px] text-white/45">
            {tracks[0] ? `Because you listen to ${(tracks[0].author || '').split(',')[0] || 'these artists'} • Similar to songs in this playlist` : 'Recommended for this playlist'}
          </p>
          {radioLoading && !radioTracks.length ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                  <div className="h-11 w-11 animate-pulse rounded-[12px] bg-white/10" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04] rounded-2xl border border-white/[0.06] bg-white/[0.02]">
              {radioTracks.map((t, i) => (
                <SongRow
                  key={`mlt-${t.id}`}
                  track={t}
                  index={i}
                  isActive={currentPlayingId === t.id}
                  onPlay={() => onPlay(t, radioTracks)}
                  onNavigate={onNavigate}
                  onOpenMenu={handleOpenMenu}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <SongContextMenu
        isOpen={menuOpen}
        onClose={() => {
          setMenuOpen(false);
          setMenuTrack(null);
        }}
        track={menuTrack}
        onPlay={() => {
          if (menuTrack) {
            const list = visibleTracks.some((t) => t.id === menuTrack.id) ? visibleTracks : [menuTrack];
            onPlay(menuTrack, list);
          }
        }}
        onOpenAddToPlaylist={(t) => {
          setPickerTracks([t]);
          setPickerOpen(true);
        }}
        onRemoveFromPlaylist={canEdit && menuTrack ? () => handleRemoveTrack(menuTrack) : undefined}
        onNavigate={onNavigate}
        onShowToast={(msg) => toast.info(msg)}
      />

      <AddToPlaylistModal
        isOpen={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setPickerTracks([]);
        }}
        tracks={pickerTracks.length ? pickerTracks : selectedTracks}
        onSuccess={(name, count) => {
          toast.success(`Added ${count} song${count === 1 ? '' : 's'} to “${name}”`);
          setSelected(new Set());
          setSelectMode(false);
        }}
      />

      <PlaylistModal
        isOpen={editOpen}
        mode="edit"
        initial={localPl ? { title: localPl.title, description: localPl.description || '', privacyStatus: localPl.privacyStatus || 'PRIVATE' } : undefined}
        busy={editBusy}
        onClose={() => setEditOpen(false)}
        onSubmit={handleRename}
      />
    </motion.div>
  );
};
