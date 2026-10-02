import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ListMusic,
  Disc3,
  Music,
  Mic2,
  Heart,
  Clock,
  Play,
  Shuffle,
  ListPlus,
  ListVideo,
  RefreshCw,
  CheckCircle2,
  Youtube,
} from 'lucide-react';
import type { Album, Playlist, SearchArtist, Track } from '../types';
import { playerStore } from '../services/playerStore';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import {
  YTMusicLibraryError,
  checkYTMusicLibraryAuth,
  clearYTMusicLibraryCache,
  getAlbums,
  getArtists,
  getHistory,
  getLikedSongs,
  getPlaylists,
  getSongs,
} from '../services/ytmusicLibrary';
import { SongRow } from './SongRow';
import { NoContent } from './NoContent';
import { SongContextMenu } from './SongContextMenu';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { subscribeLibraryChanged, subscribeSync } from '../services/accountSync';

type YTCategory = 'playlists' | 'liked' | 'songs' | 'albums' | 'artists' | 'history';

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'auth' | 'error';

interface CategoryState<T> {
  status: Status;
  data: T;
  message: string;
}

const initialPlaylists: CategoryState<Playlist[]> = { status: 'idle', data: [], message: '' };
const initialTracks: CategoryState<Track[]> = { status: 'idle', data: [], message: '' };
const initialAlbums: CategoryState<Album[]> = { status: 'idle', data: [], message: '' };
const initialArtists: CategoryState<SearchArtist[]> = { status: 'idle', data: [], message: '' };

interface YTMusicLibraryPanelProps {
  onPlay: (t: Track, list?: Track[]) => void;
  onNavigate?: (page: string, param?: string) => void;
  searchQuery?: string;
}

function userMessage(e: unknown): string {
  // Never expose backend errors to the user.
  if (e instanceof YTMusicLibraryError) {
    if (e.code === 'YTMUSIC_PY_TIMEOUT') return 'The request timed out. Please try again.';
    return 'Your YouTube Music library couldn\u2019t be loaded.';
  }
  return 'Your YouTube Music library couldn\u2019t be loaded.';
}

/**
 * YouTube Music library panel. Lazy-loads one category at a time when the
 * Library source is opened — never on app startup, never blocking playback
 * or Home. All playback goes through onPlay → playerStore → playerEngine.
 */
export const YTMusicLibraryPanel: React.FC<YTMusicLibraryPanelProps> = ({
  onPlay,
  onNavigate,
  searchQuery = '',
}) => {
  const { connected: googleConnected, user } = useGoogleAccount();
  const userKey = user?.id || '';

  const [category, setCategory] = useState<YTCategory>('playlists');
  const [authChecking, setAuthChecking] = useState(false);
  const [ytAuthenticated, setYtAuthenticated] = useState(false);
  const [ytAvailable, setYtAvailable] = useState(true);

  const [playlists, setPlaylists] = useState(initialPlaylists);
  const [liked, setLiked] = useState(initialTracks);
  const [songs, setSongs] = useState(initialTracks);
  const [albums, setAlbums] = useState(initialAlbums);
  const [artists, setArtists] = useState(initialArtists);
  const [history, setHistory] = useState(initialTracks);

  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => playerStore.current());
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [playlistModalTracks, setPlaylistModalTracks] = useState<Track[]>([]);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    const unsub = playerStore.subscribe(() => setCurrentTrack(playerStore.current()));
    return () => {
      unsub();
    };
  }, []);

  // Invalidate everything when the signed-in user changes (or signs out).
  // No client persistence → another user's private data can never linger.
  useEffect(() => {
    clearYTMusicLibraryCache();
    setPlaylists(initialPlaylists);
    setLiked(initialTracks);
    setSongs(initialTracks);
    setAlbums(initialAlbums);
    setArtists(initialArtists);
    setHistory(initialTracks);
    setYtAuthenticated(false);
    setYtAvailable(true);
    if (!googleConnected) return;
    let cancelled = false;
    setAuthChecking(true);
    checkYTMusicLibraryAuth()
      .then((s) => {
        if (cancelled) return;
        setYtAuthenticated(s.authenticated);
        setYtAvailable(s.available);
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [googleConnected, userKey]);

  const recheckAuth = useCallback(() => {
    if (!googleConnected) return;
    setAuthChecking(true);
    checkYTMusicLibraryAuth()
      .then((s) => {
        setYtAuthenticated(s.authenticated);
        setYtAvailable(s.available);
      })
      .finally(() => setAuthChecking(false));
  }, [googleConnected]);

  // ---- Per-category loaders (lazy, one at a time, isolated failures) ----

  const loadPlaylists = useCallback(async () => {
    setPlaylists((p) => ({ ...p, status: 'loading', message: '' }));
    try {
      const data = await getPlaylists();
      setPlaylists({ status: data.length ? 'ready' : 'empty', data, message: '' });
    } catch (e) {
      setPlaylists({
        status: e instanceof YTMusicLibraryError && e.code === 'YTMUSIC_AUTH_REQUIRED' ? 'auth' : 'error',
        data: [],
        message: userMessage(e),
      });
    }
  }, []);

  const loadTracks = useCallback(
    async (
      setter: React.Dispatch<React.SetStateAction<CategoryState<Track[]>>>,
      loader: () => Promise<Track[]>,
    ) => {
      setter((p) => ({ ...p, status: 'loading', message: '' }));
      try {
        const data = await loader();
        setter({ status: data.length ? 'ready' : 'empty', data, message: '' });
      } catch (e) {
        setter({
          status: e instanceof YTMusicLibraryError && e.code === 'YTMUSIC_AUTH_REQUIRED' ? 'auth' : 'error',
          data: [],
          message: userMessage(e),
        });
      }
    },
    [],
  );

  const loadAlbums = useCallback(async () => {
    setAlbums((p) => ({ ...p, status: 'loading', message: '' }));
    try {
      const data = await getAlbums();
      setAlbums({ status: data.length ? 'ready' : 'empty', data, message: '' });
    } catch (e) {
      setAlbums({
        status: e instanceof YTMusicLibraryError && e.code === 'YTMUSIC_AUTH_REQUIRED' ? 'auth' : 'error',
        data: [],
        message: userMessage(e),
      });
    }
  }, []);

  const loadArtists = useCallback(async () => {
    setArtists((p) => ({ ...p, status: 'loading', message: '' }));
    try {
      const data = await getArtists();
      setArtists({ status: data.length ? 'ready' : 'empty', data, message: '' });
    } catch (e) {
      setArtists({
        status: e instanceof YTMusicLibraryError && e.code === 'YTMUSIC_AUTH_REQUIRED' ? 'auth' : 'error',
        data: [],
        message: userMessage(e),
      });
    }
  }, []);

  const loadCategory = useCallback(
    (cat: YTCategory) => {
      if (cat === 'playlists') void loadPlaylists();
      else if (cat === 'liked') void loadTracks(setLiked, getLikedSongs);
      else if (cat === 'songs') void loadTracks(setSongs, getSongs);
      else if (cat === 'albums') void loadAlbums();
      else if (cat === 'artists') void loadArtists();
      else void loadTracks(setHistory, getHistory);
    },
    [loadPlaylists, loadTracks, loadAlbums, loadArtists],
  );

  // Refresh the visible category after an explicit sync (reconnect, Sync
  // button, or playlist mutation). Single reload, no polling.
  const categoryRef = React.useRef(category);
  categoryRef.current = category;
  useEffect(() => subscribeSync((r) => {
    if (r.status === 'success' || r.status === 'partial') loadCategory(categoryRef.current);
  }), [loadCategory]);
  useEffect(() => subscribeLibraryChanged(() => loadCategory(categoryRef.current)), [loadCategory]);

  // Lazy: fetch the active category on first open (after auth is confirmed).
  useEffect(() => {
    if (!googleConnected || !ytAuthenticated) return;
    const states: Record<YTCategory, Status> = {
      playlists: playlists.status,
      liked: liked.status,
      songs: songs.status,
      albums: albums.status,
      artists: artists.status,
      history: history.status,
    };
    if (states[category] === 'idle') loadCategory(category);
  }, [googleConnected, ytAuthenticated, category, playlists.status, liked.status, songs.status, albums.status, artists.status, history.status, loadCategory]);

  // ---- Playback actions (existing playerStore / onPlay only) ----

  const handlePlayAll = (tracks: Track[]) => {
    if (!tracks.length) return;
    onPlay(tracks[0], tracks);
  };

  const handleShuffle = (tracks: Track[]) => {
    if (!tracks.length) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playerStore.setQueue(shuffled, 0);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
    setToastMessage(`Shuffling ${tracks.length} songs`);
  };

  const handleQueueAll = (tracks: Track[]) => {
    if (!tracks.length) return;
    playerStore.addMultipleToQueue(tracks);
    setToastMessage(`Added ${tracks.length} songs to queue`);
  };

  const handlePlayNext = (tracks: Track[]) => {
    if (!tracks.length) return;
    for (let i = tracks.length - 1; i >= 0; i--) playerStore.playNext(tracks[i]);
    setToastMessage(tracks.length === 1 ? 'Will play next' : `${tracks.length} songs will play next`);
  };

  const handleOpenContextMenu = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuTrack(track);
    setIsMenuOpen(true);
  };

  const q = searchQuery.trim().toLowerCase();
  const matchesTrack = (t: Track) =>
    !q ||
    t.title.toLowerCase().includes(q) ||
    (t.author && t.author.toLowerCase().includes(q)) ||
    (t.albumName && t.albumName.toLowerCase().includes(q));

  const filteredLiked = useMemo(() => liked.data.filter(matchesTrack), [liked.data, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredSongs = useMemo(() => songs.data.filter(matchesTrack), [songs.data, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredHistory = useMemo(() => history.data.filter(matchesTrack), [history.data, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredPlaylists = useMemo(
    () => (q ? playlists.data.filter((p) => p.name.toLowerCase().includes(q)) : playlists.data),
    [playlists.data, q],
  );
  const filteredAlbums = useMemo(
    () =>
      q
        ? albums.data.filter(
            (a) => a.name.toLowerCase().includes(q) || a.artist.name.toLowerCase().includes(q),
          )
        : albums.data,
    [albums.data, q],
  );
  const filteredArtists = useMemo(
    () => (q ? artists.data.filter((a) => a.name.toLowerCase().includes(q)) : artists.data),
    [artists.data, q],
  );

  const cats: { id: YTCategory; label: string; icon: any }[] = [
    { id: 'playlists', label: 'Playlists', icon: ListMusic },
    { id: 'liked', label: 'Liked Songs', icon: Heart },
    { id: 'songs', label: 'Saved Songs', icon: Music },
    { id: 'albums', label: 'Albums', icon: Disc3 },
    { id: 'artists', label: 'Artists', icon: Mic2 },
    { id: 'history', label: 'History', icon: Clock },
  ];

  // ---- Auth / availability gates ----

  if (!googleConnected) {
    return (
      <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-8 sm:p-10 text-center backdrop-blur-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 border border-red-500/20 text-red-300">
          <Youtube className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-lg font-extrabold text-white tracking-tight">Connect YouTube Music</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-white/55">
          Sign in with Google to browse your YouTube Music playlists, liked songs, albums and artists right
          inside Wave Player.
        </p>
        <button
          onClick={() => location.assign('/api/auth/google')}
          className="mt-5 rounded-full bg-white px-6 py-2.5 text-xs font-bold text-black hover:bg-white/90 shadow-sm active:scale-95 transition-all"
        >
          Connect with Google
        </button>
      </div>
    );
  }

  if (authChecking) {
    return (
      <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur-md">
        <p className="text-xs text-white/55 animate-pulse">Checking YouTube Music connection…</p>
      </div>
    );
  }

  if (!ytAuthenticated || !ytAvailable) {
    return (
      <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-8 sm:p-10 text-center backdrop-blur-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] border border-white/10 text-white/60">
          <Youtube className="h-7 w-7" />
        </div>
        <h3 className="mt-4 text-[15px] font-bold text-white">Your YouTube Music library couldn’t be loaded.</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-white/55">
          {!ytAvailable
            ? 'The YouTube Music service is unavailable right now.'
            : 'Your Google account isn’t linked to YouTube Music yet.'}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
          <button
            onClick={recheckAuth}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
          {!ytAuthenticated && ytAvailable && (
            <button
              onClick={() => location.assign('/api/auth/youtube/connect')}
              className="rounded-full border border-white/15 px-5 py-2 text-xs font-semibold text-white/85 hover:bg-white/10 transition-all"
            >
              Connect YouTube
            </button>
          )}
        </div>
      </div>
    );
  }

  const renderTrackActions = (tracks: Track[], label: string) => (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => handlePlayAll(tracks)}
        disabled={!tracks.length}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/90 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
      >
        <Play className="h-3.5 w-3.5 fill-current ml-0.5" /> Play
      </button>
      <button
        onClick={() => handleShuffle(tracks)}
        disabled={!tracks.length}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 text-xs font-semibold text-white active:scale-95 disabled:opacity-40 transition-all"
      >
        <Shuffle className="h-3.5 w-3.5" /> Shuffle
      </button>
      <button
        onClick={() => handleQueueAll(tracks)}
        disabled={!tracks.length}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 text-xs font-semibold text-white active:scale-95 disabled:opacity-40 transition-all"
      >
        <ListPlus className="h-3.5 w-3.5" /> Queue
      </button>
      <button
        onClick={() => handlePlayNext(tracks)}
        disabled={!tracks.length}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 text-xs font-semibold text-white active:scale-95 disabled:opacity-40 transition-all"
      >
        <ListVideo className="h-3.5 w-3.5" /> Play next
      </button>
      <span className="ml-auto hidden sm:inline text-[11px] text-white/40 font-medium">{label}</span>
    </div>
  );

  const renderTrackList = (
    state: CategoryState<Track[]>,
    filtered: Track[],
    emptyTitle: string,
    emptyDesc: string,
    retry: () => void,
    likeBadge = false,
  ) => {
    if (state.status === 'loading' || state.status === 'idle') {
      return (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-white/[0.04] animate-pulse border border-white/5" />
          ))}
        </div>
      );
    }
    if (state.status === 'auth' || state.status === 'error') {
      return (
        <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-[14px] font-bold text-white">{state.message}</p>
          <button
            onClick={() => {
              recheckAuth();
              retry();
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      );
    }
    if (state.status === 'empty' || !filtered.length) {
      return (
        <NoContent
          variant="songs"
          title={q && state.data.length ? `No matching songs for “${searchQuery}”` : emptyTitle}
          description={q && state.data.length ? 'Try a different keyword.' : emptyDesc}
        />
      );
    }
    return (
      <div className="rounded-[20px] border border-white/10 bg-[#101012]/80 backdrop-blur-xl p-1 sm:p-2 divide-y divide-white/[0.04]">
        {filtered.map((t, idx) => (
          <SongRow
            key={`${t.id}-${idx}`}
            track={t}
            index={idx}
            isActive={currentTrack?.id === t.id}
            onPlay={() => onPlay(t, filtered)}
            subtitleExtra={likeBadge ? 'Liked on YouTube Music' : undefined}
            onOpenMenu={handleOpenContextMenu}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Category sub-tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
        {cats.map((c) => {
          const isActive = category === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold border whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-red-500 text-white border-red-500 shadow-[0_2px_12px_rgba(239,68,68,0.35)]'
                  : 'bg-white/[0.04] text-[#a1a1aa] border-white/[0.08] hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <c.icon className="h-3.5 w-3.5" />
              <span>{c.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => loadCategory(category)}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-all"
          title="Refresh YouTube Music"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Playlists */}
      {category === 'playlists' && (
        <div className="space-y-4">
          {playlists.status === 'loading' || playlists.status === 'idle' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="aspect-square rounded-[20px] bg-white/[0.04] animate-pulse border border-white/5" />
              ))}
            </div>
          ) : playlists.status === 'error' || playlists.status === 'auth' ? (
            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-8 text-center">
              <p className="text-[14px] font-bold text-white">{playlists.message}</p>
              <button
                onClick={() => {
                  recheckAuth();
                  void loadPlaylists();
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : !filteredPlaylists.length ? (
            <NoContent
              variant="playlists"
              title="No YouTube Music playlists"
              description="Playlists you save on YouTube Music will show up here."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {filteredPlaylists.map((pl) => (
                <motion.div
                  key={pl.playlistId}
                  whileHover={{ y: -4 }}
                  onClick={() => onNavigate?.('playlist', `ytmusic:${pl.playlistId}`)}
                  className="group cursor-pointer rounded-[20px] border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#1a1a1c] ring-1 ring-white/10 shadow-sm">
                    {pl.thumbnails?.[0]?.url ? (
                      <img
                        src={pl.thumbnails[0].url}
                        alt={pl.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/30">
                        <ListMusic className="h-10 w-10" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-xl">
                        <Play className="h-5 w-5 fill-current ml-0.5" />
                      </span>
                    </div>
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[9.5px] font-bold text-white border border-white/10">
                      <ListMusic className="h-3 w-3 text-red-400" /> PLAYLIST
                    </span>
                  </div>
                  <div className="mt-2.5 min-w-0">
                    <p className="truncate text-[13.5px] font-bold text-white">{pl.name}</p>
                    <p className="truncate text-xs text-white/50 mt-0.5">
                      {typeof pl.videoCount === 'number' ? `${pl.videoCount} tracks` : pl.author}
                    </p>
                    <span className="mt-1.5 inline-block rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300 border border-red-500/20">
                      YouTube Music
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Liked Songs */}
      {category === 'liked' && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-br from-red-600/25 via-[#18181b]/95 to-rose-950/30 p-5 sm:p-6 backdrop-blur-xl">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-[18px] bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-[0_8px_24px_rgba(239,68,68,0.4)] shrink-0">
                <Heart className="h-8 w-8 fill-current" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-[10.5px] font-bold text-red-300 uppercase tracking-wider border border-red-500/25">
                  YouTube Music
                </span>
                <h2 className="text-[20px] sm:text-[24px] font-extrabold text-white tracking-tight leading-tight mt-1">
                  Liked Songs
                </h2>
                <p className="text-xs sm:text-[13px] text-white/60 mt-0.5 font-medium">
                  {liked.data.length} tracks • YouTube likes stay separate from Wave favorites
                </p>
              </div>
            </div>
            {(liked.status === 'ready' || liked.status === 'empty') && liked.data.length > 0 && (
              <div className="mt-4">{renderTrackActions(filteredLiked, `${filteredLiked.length} songs`)}</div>
            )}
          </div>
          {renderTrackList(
            liked,
            filteredLiked,
            'No liked songs on YouTube Music',
            'Songs you like (thumbs-up) on YouTube Music will appear here.',
            () => loadTracks(setLiked, getLikedSongs),
            true,
          )}
        </div>
      )}

      {/* Saved Songs */}
      {category === 'songs' && (
        <div className="space-y-4">
          {(songs.status === 'ready' || songs.status === 'empty') && songs.data.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              {renderTrackActions(filteredSongs, `${filteredSongs.length} songs`)}
            </div>
          )}
          {renderTrackList(
            songs,
            filteredSongs,
            'No saved songs on YouTube Music',
            'Songs you save to your YouTube Music library will appear here.',
            () => loadTracks(setSongs, getSongs),
          )}
        </div>
      )}

      {/* Albums */}
      {category === 'albums' && (
        <div className="space-y-4">
          {albums.status === 'loading' || albums.status === 'idle' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="aspect-square rounded-[20px] bg-white/[0.04] animate-pulse border border-white/5" />
              ))}
            </div>
          ) : albums.status === 'error' || albums.status === 'auth' ? (
            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-8 text-center">
              <p className="text-[14px] font-bold text-white">{albums.message}</p>
              <button
                onClick={() => {
                  recheckAuth();
                  void loadAlbums();
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : !filteredAlbums.length ? (
            <NoContent
              variant="albums"
              title="No YouTube Music albums"
              description="Albums you save on YouTube Music will show up here."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {filteredAlbums.map((album) => {
                const navigable = album.albumId !== album.name;
                return (
                  <motion.div
                    key={album.albumId}
                    whileHover={{ y: -4 }}
                    onClick={() => {
                      if (navigable) onNavigate?.('album', album.albumId);
                      else setToastMessage('Album details unavailable for this item');
                    }}
                    className="group cursor-pointer rounded-[20px] border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#1a1a1c] ring-1 ring-white/10 shadow-sm">
                      {album.thumbnails?.[0]?.url ? (
                        <img
                          src={album.thumbnails[0].url}
                          alt={album.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/30">
                          <Disc3 className="h-10 w-10" />
                        </div>
                      )}
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[9.5px] font-bold text-white border border-white/10">
                        <Disc3 className="h-3 w-3 text-amber-400" /> ALBUM
                      </span>
                    </div>
                    <div className="mt-2.5 min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-white">{album.name}</p>
                      <p className="truncate text-xs text-white/50 mt-0.5">
                        {album.artist.name} {album.year ? `• ${album.year}` : ''}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Artists */}
      {category === 'artists' && (
        <div className="space-y-4">
          {artists.status === 'loading' || artists.status === 'idle' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="aspect-square rounded-full bg-white/[0.04] animate-pulse border border-white/5 max-w-[160px] mx-auto w-full" />
              ))}
            </div>
          ) : artists.status === 'error' || artists.status === 'auth' ? (
            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-8 text-center">
              <p className="text-[14px] font-bold text-white">{artists.message}</p>
              <button
                onClick={() => {
                  recheckAuth();
                  void loadArtists();
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : !filteredArtists.length ? (
            <NoContent
              variant="artists"
              title="No YouTube Music artists"
              description="Artists you follow on YouTube Music will show up here."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredArtists.map((artist) => {
                const navigable = artist.artistId !== artist.name;
                return (
                  <motion.div
                    key={artist.artistId}
                    whileHover={{ y: -4 }}
                    onClick={() => {
                      if (navigable && onNavigate) onNavigate('artist', artist.artistId);
                      else setToastMessage('Artist details unavailable for this item');
                    }}
                    className="group cursor-pointer rounded-[24px] border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.07] hover:border-white/20 transition-all flex flex-col items-center text-center shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md"
                  >
                    <div className="relative aspect-square w-full max-w-[140px] overflow-hidden rounded-full bg-[#1a1a1c] ring-2 ring-white/15 shadow-md">
                      {artist.thumbnails?.[0]?.url ? (
                        <img
                          src={artist.thumbnails[0].url}
                          alt={artist.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/30">
                          <Mic2 className="h-10 w-10" />
                        </div>
                      )}
                    </div>
                    <div className="mt-3 min-w-0 w-full">
                      <p className="truncate text-[14px] font-bold text-white">{artist.name}</p>
                      <span className="mt-1.5 inline-block rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300 border border-red-500/20">
                        YouTube Music
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {category === 'history' && (
        <div className="space-y-4">
          {(history.status === 'ready' || history.status === 'empty') && history.data.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              {renderTrackActions(filteredHistory, `${filteredHistory.length} recent tracks`)}
            </div>
          )}
          {renderTrackList(
            history,
            filteredHistory,
            'No YouTube Music history',
            'Songs you play on YouTube Music will appear here.',
            () => loadTracks(setHistory, getHistory),
          )}
        </div>
      )}

      {/* Shared context menu / add-to-playlist (existing components) */}
      <SongContextMenu
        isOpen={isMenuOpen}
        onClose={() => {
          setIsMenuOpen(false);
          setMenuTrack(null);
        }}
        track={menuTrack}
        onPlay={() => {
          if (menuTrack) onPlay(menuTrack, [menuTrack]);
        }}
        onOpenAddToPlaylist={(track) => {
          setPlaylistModalTracks([track]);
          setIsPlaylistModalOpen(true);
        }}
        onNavigate={onNavigate}
        onShowToast={(msg) => setToastMessage(msg)}
      />
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
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-full bg-white text-black px-4 py-2 text-xs font-bold shadow-[0_8px_30px_rgba(0,0,0,0.6)] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
