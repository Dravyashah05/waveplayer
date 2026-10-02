import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDismiss } from '../hooks/useDismiss';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Play,
  Pause,
  Shuffle,
  Heart,
  Share2,
  Disc3,
  Clock,
  Download,
  Sparkles,
  ArrowLeft,
  Loader2,
  Calendar,
  Layers,
  Music2,
  Check,
  CheckCircle2,
  Plus,
  Radio,
  MoreVertical,
  ListPlus,
  Bookmark,
} from 'lucide-react';
import { Track, Album } from '../types';
import { searchSaavnAlbums, getSaavnBrowseModules } from '../services/saavnApi';
import { deduplicateAlbums } from '../services/searchEngine';
import {
  fetchAlbumDetail,
  isAlbumSaved,
  toggleAlbumSaved,
  type CanonicalAlbum,
} from '../services/artistAlbum';
import { startRadioAndPlay } from '../services/radioEngine';
import { recommendTracks } from '../services/recommendationEngine';
import { playerStore } from '../services/playerStore';
import { usePlayerEngine } from '../services/playerEngine';
import { SongRow } from '../components/SongRow';
import { SongContextMenu } from '../components/SongContextMenu';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';

interface AlbumPageProps {
  albumId?: string;
  onPlay: (t: Track, list?: Track[]) => void;
  onNavigate?: (page: string, param?: string) => void;
  onBack?: () => void;
}

export const AlbumPage: React.FC<AlbumPageProps> = ({
  albumId,
  onPlay,
  onNavigate,
  onBack,
}) => {
  const [album, setAlbum] = useState<Album | null>(null);
  const [canonical, setCanonical] = useState<CanonicalAlbum | null>(null);
  const [alternate, setAlternate] = useState<{ id: string; edition: string; title: string } | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [recommendedAlbums, setRecommendedAlbums] = useState<Album[]>([]);
  const [moreLikeThis, setMoreLikeThis] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSecondary, setLoadingSecondary] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useDismiss(moreOpen, moreRef, () => setMoreOpen(false));
  const [isAlbumFav, setIsAlbumFav] = useState(false);
  const [saved, setSaved] = useState(false);
  const reduceMotion = useReducedMotion();

  // Discovery / Idle State
  const [popularAlbums, setPopularAlbums] = useState<Album[]>([]);

  // Player Engine State
  const { isPlaying } = usePlayerEngine();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => playerStore.current());

  // Context Menu & Add to Playlist Modals
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [playlistModalTracks, setPlaylistModalTracks] = useState<Track[]>([]);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Toast Auto-dismiss
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Subscribe to Player Store
  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setCurrentTrack(playerStore.current());
    });
    return () => {
      unsub();
    };
  }, []);

  // Multi-source Album loader (canonical layer, progressive: core first).
  const loadAlbumData = useCallback(async (id: string) => {
    setLoading(true);
    setLoadingSecondary(false);
    setLoadError('');
    setAlbum(null);
    setCanonical(null);
    setAlternate(null);
    setTracks([]);
    setRecommendedAlbums([]);
    setMoreLikeThis([]);
    setSaved(false);

    const applyDetail = (
      detail: {
        album: CanonicalAlbum;
        tracks: Track[];
        alternate?: { id: string; edition: string; title: string };
      } | null,
      isComplete: boolean,
    ) => {
      if (!detail) return;
      const c = detail.album;
      const compat: Album = {
        albumId: c.sourceIds.saavn || c.sourceIds.ytmusic || c.id,
        playlistId: c.sourceIds.ytmusic || '',
        name: c.title,
        artist: { artistId: c.artistId, name: c.artist },
        year: c.year,
        thumbnails: c.artwork ? [{ url: c.artwork, width: 0, height: 0 }] : [],
        type: 'ALBUM',
        songCount: c.trackCount,
        source: c.sourceIds.ytmusic ? 'ytmusic' : 'saavn',
      };
      setCanonical(c);
      setAlbum(compat);
      setTracks(detail.tracks);
      setAlternate(detail.alternate || null);
      setSaved(isAlbumSaved(compat.albumId));
      if (detail.tracks.length > 0) {
        setIsAlbumFav(detail.tracks.some((t) => playerStore.isFav(t.id)));
      }
      if (isComplete) {
        // Secondary: same-artist albums + engine recommendations.
        setLoadingSecondary(true);
        let settled = 0;
        const done = () => {
          settled += 1;
          if (settled >= 2) setLoadingSecondary(false);
        };
        searchSaavnAlbums(c.artist, 1, 8)
          .then((res) => {
            const others = (res.albums || []).filter((a) => a.albumId !== id);
            setRecommendedAlbums(deduplicateAlbums(others).slice(0, 6));
          })
          .catch(() => {})
          .finally(done);
        if (detail.tracks.length) {
          const seeds = detail.tracks.slice(0, 3);
          const exclude = new Set(detail.tracks.map((t) => t.id));
          recommendTracks({ seedTracks: seeds, excludeIds: exclude, limit: 8 })
            .then((recs) => setMoreLikeThis(recs.filter((t) => !exclude.has(t.id)).slice(0, 8)))
            .catch(() => setMoreLikeThis([]))
            .finally(done);
        } else {
          done();
        }
      }
    };

    try {
      const detail = await fetchAlbumDetail(id, (stage, partial) => {
        if (stage === 'core' && partial) {
          applyDetail(partial, false);
          setLoading(false);
        }
      });
      if (!detail) {
        setLoadError('Album not found. It may have been removed or the link is wrong.');
      } else {
        applyDetail(detail, true);
      }
    } catch (err) {
      setLoadError('Something went wrong loading this album. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggleSave = () => {
    if (!canonical || !album) return;
    const nowSaved = toggleAlbumSaved({
      id: album.albumId,
      title: canonical.title,
      artist: canonical.artist,
      artwork: canonical.artwork,
    });
    setSaved(nowSaved);
    setToastMessage(nowSaved ? `Saved "${canonical.title}" to your library` : `Removed "${canonical.title}" from your library`);
  };

  // Idle / Featured albums loader
  const loadFeaturedAlbums = useCallback(async () => {
    setLoading(true);
    try {
      const modules = await getSaavnBrowseModules().catch(() => null);
      if (modules && modules.newAlbums?.length) {
        setPopularAlbums(modules.newAlbums);
      } else {
        const fallback = await searchSaavnAlbums('Trending Hits', 1, 12);
        setPopularAlbums(fallback.albums || []);
      }
    } catch {
      setPopularAlbums([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (albumId) {
      void loadAlbumData(albumId);
    } else {
      void loadFeaturedAlbums();
    }
  }, [albumId, loadAlbumData, loadFeaturedAlbums]);

  // Total runtime calculation
  const totalDurationSeconds = tracks.reduce((acc, t) => acc + (t.durationSeconds || 180), 0);
  const totalDurationFormatted =
    totalDurationSeconds > 3600
      ? `${Math.floor(totalDurationSeconds / 3600)} hr ${Math.floor((totalDurationSeconds % 3600) / 60)} min`
      : `${Math.floor(totalDurationSeconds / 60)} min`;

  // Action Handlers
  const handlePlayAll = () => {
    if (!tracks.length) return;
    onPlay(tracks[0], tracks);
  };

  const handleShuffle = () => {
    if (!tracks.length) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playerStore.setQueue(shuffled, 0);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
    onPlay(shuffled[0], shuffled);
  };

  const handleToggleFavAlbum = () => {
    if (!tracks.length) return;
    const nextState = !isAlbumFav;
    setIsAlbumFav(nextState);
    tracks.forEach((t) => {
      const isCurrentlyFav = playerStore.isFav(t.id);
      if (nextState && !isCurrentlyFav) playerStore.toggleFav(t);
      else if (!nextState && isCurrentlyFav) playerStore.toggleFav(t);
    });
    setToastMessage(nextState ? 'Added album to Liked Songs' : 'Removed album from Liked Songs');
  };

  const handleShare = () => {
    if (navigator.share && album) {
      navigator
        .share({
          title: album.name,
          text: `Listen to "${album.name}" by ${album.artist?.name || 'Various Artists'} on Wave Player`,
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      void navigator.clipboard.writeText(window.location.href);
      setToastMessage('Album link copied to clipboard');
    }
  };

  const handleAddAllToPlaylist = () => {
    if (!tracks.length) return;
    setPlaylistModalTracks(tracks);
    setIsPlaylistModalOpen(true);
  };

  const handleAddAllToQueue = () => {
    if (!tracks.length) return;
    let added = 0;
    for (const t of tracks) {
      const before = playerStore.queue().length;
      playerStore.addToQueue(t);
      if (playerStore.queue().length > before) added++;
    }
    setToastMessage(added ? `Added ${added} song${added === 1 ? '' : 's'} to queue` : 'Already in queue');
  };

  const handleStartRadio = async () => {
    if (!tracks.length) return;
    setToastMessage(`Starting radio for "${album?.name || 'this album'}"...`);
    try {
      await startRadioAndPlay('album', {
        track: tracks[0],
        albumId: (album as any)?.albumId,
        albumName: album?.name,
        contextTracks: tracks,
      });
    } catch {
      setToastMessage('Could not start radio');
    }
  };

  const handleOpenContextMenu = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuTrack(track);
    setIsMenuOpen(true);
  };

  const handleOpenAddToPlaylist = (track: Track) => {
    setPlaylistModalTracks([track]);
    setIsPlaylistModalOpen(true);
  };

  // 1. DISCOVERY / IDLE STATE (when no albumId is provided)
  if (!albumId) {
    return (
      <div className="space-y-6 pb-20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-cyan-400 flex items-center gap-1.5">
              <Disc3 className="h-3.5 w-3.5" /> Explore Albums
            </p>
            <h1 className="mt-1 text-[26px] sm:text-[32px] font-extrabold tracking-[-0.03em] text-white">
              Featured Albums
            </h1>
            <p className="mt-1 text-[13px] text-[#8e8e93]">
              Trending album releases, soundtrack collections, and top discographies
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {popularAlbums.map((a) => (
              <motion.div
                key={a.albumId}
                whileHover={{ y: -4 }}
                onClick={() => onNavigate?.('album', a.albumId)}
                role="button"
                tabIndex={0}
                aria-label={`Open album ${a.name}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate?.('album', a.albumId);
                  }
                }}
                className="group relative cursor-pointer rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-sm"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-[16px] bg-[#141416] ring-1 ring-white/10">
                  <img
                    src={a.thumbnails?.[0]?.url || ''}
                    alt={a.name}
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
                  <p className="truncate text-[13.5px] font-bold text-white group-hover:text-cyan-300 transition-colors">
                    {a.name}
                  </p>
                  <p className="truncate text-[12px] text-[#8e8e93] mt-0.5">
                    {a.artist?.name || 'Various Artists'}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 2. LOADING STATE
  if (loading && !album) {
    return (
      <div className="space-y-8 pb-24" aria-busy="true" aria-label="Loading album">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.02] p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="h-[190px] w-[190px] sm:h-[220px] sm:w-[220px] shrink-0 animate-pulse rounded-[24px] bg-white/10" />
            <div className="flex-1 space-y-3 w-full">
              <div className="h-9 w-2/3 animate-pulse rounded-lg bg-white/10" />
              <div className="h-4 w-1/3 animate-pulse rounded-lg bg-white/10" />
              <div className="flex gap-3 pt-2">
                <div className="h-11 w-32 animate-pulse rounded-full bg-white/10" />
                <div className="h-11 w-28 animate-pulse rounded-full bg-white/10" />
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-1.5">
              <div className="h-12 w-12 animate-pulse rounded-xl bg-white/10" />
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

  // 2b. ERROR STATE
  if (!loading && (loadError || !album)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[15px] font-bold text-white">{loadError || 'Album not found'}</p>
        <p className="max-w-[36ch] text-xs text-white/50">Nothing was changed. Check the link or your connection.</p>
        <div className="flex gap-2 pt-1">
          {albumId && (
            <button type="button" onClick={() => void loadAlbumData(albumId)} className="rounded-full bg-white px-5 py-2 text-xs font-bold text-black">
              Try Again
            </button>
          )}
          <button type="button" onClick={() => (onBack ? onBack() : window.history.back())} className="rounded-full border border-white/10 px-5 py-2 text-xs font-semibold text-white/75">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const coverUrl = album?.thumbnails?.[0]?.url || '';

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0.01 : 0.3 }}
      className="space-y-8 pb-24"
    >
      {/* Back Button */}
      <button
        type="button"
        onClick={() => (onBack ? onBack() : window.history.back())}
        className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] px-3.5 py-1.5 text-xs font-semibold text-white/90 transition-all cursor-pointer active:scale-95 shadow-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      {/* ======================================================= */}
      {/* 1. ALBUM HERO BANNER */}
      {/* ======================================================= */}
      <div className="relative overflow-hidden rounded-[28px] sm:rounded-[36px] bg-[#121214] border border-white/10 p-6 sm:p-8 lg:p-10 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
        {/* Ambient Blur Backdrop */}
        {coverUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover scale-150 blur-[60px] opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/50" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
          </div>
        )}

        <div className="relative flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8">
          {/* Cover Art */}
          <div className="relative h-[190px] w-[190px] sm:h-[220px] sm:w-[220px] shrink-0 rounded-[24px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] ring-1 ring-white/20 bg-[#161619]">
            <img
              src={coverUrl}
              alt={album?.name || 'Album'}
              className="h-full w-full object-cover"
            />
          </div>

          {/* Details */}
          <div className="flex flex-1 flex-col justify-end min-w-0 text-center sm:text-left">
            <div className="inline-flex items-center justify-center sm:justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-cyan-400">
              <Disc3 className="h-3.5 w-3.5" />
              {canonical?.edition ? `${canonical.edition} Edition` : canonical?.releaseType || 'Album'}
              {canonical?.year ? ` • ${canonical.year}` : ''}
            </div>

            <h1 className="mt-2 text-[26px] sm:text-[36px] lg:text-[44px] font-black tracking-[-0.03em] leading-tight text-white line-clamp-2">
              {album?.name || 'Album'}
            </h1>

            <p className="mt-2 text-[15px] sm:text-[16px] font-semibold text-white/90">
              <span
                onClick={() => album?.artist?.artistId && onNavigate?.('artist', album.artist.artistId)}
                className={`transition-colors ${album?.artist?.artistId && onNavigate ? 'hover:underline hover:text-cyan-300 cursor-pointer' : ''}`}
              >
                {album?.artist?.name || 'Various Artists'}
              </span>
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-white/70">
              {album?.year && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                  <Calendar className="h-3 w-3" /> {album.year}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                <Music2 className="h-3 w-3" /> {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                <Clock className="h-3 w-3" /> {totalDurationFormatted}
              </span>
              {album?.language && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08] uppercase text-[10px] font-bold text-cyan-300">
                  {album.language}
                </span>
              )}
              {alternate && (
                <button
                  type="button"
                  onClick={() => onNavigate?.('album', alternate.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/25 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25 transition-colors"
                  title={`Open the ${alternate.edition} edition`}
                >
                  <Disc3 className="h-3 w-3" /> Also: {alternate.edition} Edition
                </button>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <button
                type="button"
                onClick={handlePlayAll}
                disabled={tracks.length === 0}
                className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-bold text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.4)] active:scale-95 transition-all disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-current ml-0.5" /> Play All
              </button>

              <button
                type="button"
                onClick={handleShuffle}
                disabled={tracks.length === 0}
                className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-5 text-[14px] font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
              >
                <Shuffle className="h-4 w-4" /> Shuffle
              </button>

              <button
                type="button"
                onClick={handleToggleFavAlbum}
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all active:scale-95 ${
                  isAlbumFav
                    ? 'bg-red-500/20 border-red-500/40 text-red-400'
                    : 'bg-white/[0.08] hover:bg-white/[0.14] border-white/[0.1] text-white'
                }`}
                title={isAlbumFav ? 'Liked' : 'Like Album'}
              >
                <Heart className={`h-4 w-4 ${isAlbumFav ? 'fill-red-400' : ''}`} />
              </button>

              <button
                type="button"
                onClick={handleToggleSave}
                disabled={!album}
                aria-pressed={saved}
                className={`flex h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                  saved
                    ? 'bg-white text-black border-white hover:bg-white/90'
                    : 'bg-white/[0.08] hover:bg-white/[0.14] border-white/[0.1] text-white'
                }`}
                title={saved ? 'Remove from your Wave library' : 'Save to your Wave library'}
              >
                <Bookmark className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
                {saved ? 'Saved' : 'Save'}
              </button>

              <button
                type="button"
                onClick={handleAddAllToPlaylist}
                className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-4 text-[13px] font-semibold text-white transition-all active:scale-95"
                title="Add all songs to playlist"
              >
                <Plus className="h-4 w-4" /> Add to Playlist
              </button>

              <button
                type="button"
                onClick={() => void handleStartRadio()}
                disabled={tracks.length === 0}
                className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-4 text-[13px] font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
                title="Start album radio"
              >
                <Radio className="h-4 w-4 text-cyan-300" /> Radio
              </button>

              <div className="relative" ref={moreRef}>
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white transition-all active:scale-95"
                  title="More actions"
                  aria-label="More album actions"
                  aria-expanded={moreOpen}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {moreOpen && (
                  <div className="absolute left-0 z-30 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#141416]/98 shadow-[0_24px_64px_rgba(0,0,0,0.85)] backdrop-blur-2xl">
                    <div className="p-2">
                      <button type="button" onClick={() => { setMoreOpen(false); handleAddAllToQueue(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black">
                        <Plus className="h-4 w-4" /> Add album to queue
                      </button>
                      <button type="button" onClick={() => { setMoreOpen(false); void handleStartRadio(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black">
                        <Radio className="h-4 w-4" /> Start album radio
                      </button>
                      <button type="button" onClick={() => { setMoreOpen(false); handleShare(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-white hover:bg-white hover:text-black">
                        <Share2 className="h-4 w-4" /> Share album
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleShare}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white transition-all active:scale-95"
                title="Share"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================= */}
      {/* 2. ALBUM TRACKLIST */}
      {/* ======================================================= */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[19px] sm:text-[22px] font-extrabold text-white tracking-tight flex items-center gap-2">
            <Music2 className="h-5 w-5 text-cyan-400" /> Tracklist ({tracks.length})
          </h2>
        </div>

        {/* Sticky mini transport: playback stays reachable while scrolling */}
        {tracks.length > 0 && (
          <div className="sticky top-2 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-[#141416]/90 backdrop-blur-xl px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            <button
              type="button"
              onClick={handlePlayAll}
              aria-label={`Play ${album?.name || 'album'} from the start`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-white/90 active:scale-95 transition-all"
            >
              <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
            </button>
            <button
              type="button"
              onClick={handleShuffle}
              aria-label="Shuffle album"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition-all"
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleAddAllToQueue}
              aria-label="Add album to queue"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition-all"
            >
              <ListPlus className="h-3.5 w-3.5" />
            </button>
            <span className="truncate text-xs font-semibold text-white/60 pl-1">
              {album?.name || 'Album'} • {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
            </span>
          </div>
        )}

        {tracks.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.02] p-8 text-center">
            <p className="text-[14px] font-bold text-white">No tracks available for this album</p>
            <p className="mt-1 text-xs text-white/50">Try another source or check your connection.</p>
          </div>
        ) : (
        <div className="rounded-[28px] border border-white/10 bg-white/[0.02] p-2 divide-y divide-white/[0.04]">
          {tracks.map((track, idx) => (
            <SongRow
              key={`album-track-${track.id}-${idx}`}
              track={track}
              index={idx}
              isActive={currentTrack?.id === track.id}
              isPlaying={isPlaying}
              onPlay={() => onPlay(track, tracks)}
              showAlbum={false}
              showCover={true}
              onOpenMenu={handleOpenContextMenu}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        )}
      </div>

      {/* ======================================================= */}
      {/* 3. MORE LIKE THIS SONGS (central recommendation engine) */}
      {/* ======================================================= */}
      {loadingSecondary && moreLikeThis.length === 0 ? (
        <div className="space-y-3" aria-label="Loading similar songs">
          <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 rounded-2xl bg-white/[0.04] border border-white/5 animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
        moreLikeThis.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[19px] sm:text-[22px] font-extrabold text-white tracking-tight flex items-center gap-2 px-1">
            <Sparkles className="h-5 w-5 text-amber-400" /> More Like This
          </h2>
          <p className="-mt-2 px-1 text-[12px] text-white/45">
            Because you listened to {album?.artist?.name || 'this album'} • Similar to songs in this album
          </p>
          <div className="rounded-[28px] border border-white/10 bg-white/[0.02] p-2 divide-y divide-white/[0.04]">
            {moreLikeThis.map((track, idx) => (
              <SongRow
                key={`album-rec-${track.id}-${idx}`}
                track={track}
                index={idx}
                isActive={currentTrack?.id === track.id}
                isPlaying={isPlaying}
                onPlay={() => onPlay(track, moreLikeThis)}
                showAlbum={true}
                onOpenMenu={handleOpenContextMenu}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
        )
      )}

      {/* ======================================================= */}
      {/* 4. ABOUT / DESCRIPTION */}
      {/* ======================================================= */}
      {album?.description && (
        <div className="rounded-[24px] bg-white/[0.03] border border-white/10 p-6 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
            About this Album
          </p>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">
            {album.description}
          </p>
        </div>
      )}

      {/* ======================================================= */}
      {/* 4. MORE LIKE THIS / RECOMMENDED ALBUMS */}
      {/* ======================================================= */}
      {loadingSecondary && recommendedAlbums.length === 0 ? (
        <div className="space-y-3.5 pt-4" aria-label="Loading more albums">
          <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-[22px] bg-white/[0.03] border border-white/10 p-3 animate-pulse">
                <div className="aspect-square w-full rounded-[16px] bg-white/[0.04]" />
                <div className="mt-2.5 h-3 w-3/4 rounded-full bg-white/[0.06]" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        recommendedAlbums.length > 0 && (
        <div className="space-y-3.5 pt-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[19px] sm:text-[22px] font-extrabold text-white tracking-tight flex items-center gap-2">
              <Disc3 className="h-5 w-5 text-amber-400" /> More from {album?.artist?.name || 'this Artist'}
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {recommendedAlbums.map((rec) => (
              <motion.div
                key={rec.albumId}
                whileHover={reduceMotion ? undefined : { y: -4 }}
                onClick={() => onNavigate?.('album', rec.albumId)}
                role="button"
                tabIndex={0}
                aria-label={`Open album ${rec.name}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate?.('album', rec.albumId);
                  }
                }}
                className="group cursor-pointer rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-sm"
              >
                <div className="relative aspect-square w-full rounded-[16px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                  <img
                    src={rec.thumbnails?.[0]?.url || ''}
                    alt={rec.name}
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
                  {rec.name}
                </p>
                <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                  {rec.year ? `${rec.year} • ` : ''}Album
                </p>
              </motion.div>
            ))}
          </div>
        </div>
        )
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
          if (menuTrack) onPlay(menuTrack, tracks);
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
            role="status"
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
            className="fixed bottom-[calc(112px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 rounded-full bg-white text-black px-4 py-2 text-xs font-bold shadow-[0_8px_30px_rgba(0,0,0,0.6)] flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

