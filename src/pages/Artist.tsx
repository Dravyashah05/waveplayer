import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  Shuffle,
  Share2,
  Mic2,
  Disc3,
  Clock,
  Download,
  ArrowLeft,
  Loader2,
  Sparkles,
  Music2,
  Radio,
  Heart,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Users,
} from 'lucide-react';
import { Track, Album, SearchArtist } from '../types';
import { getSaavnArtistDetails, searchSaavnArtists } from '../services/saavnApi';
import { getYTMusicArtist } from '../services/ytmusicApi';
import { deduplicateTracks, deduplicateAlbums, deduplicateArtists } from '../services/searchEngine';
import { fetchRadio } from '../services/recommendationApi';
import { playerStore } from '../services/playerStore';
import { usePlayerEngine } from '../services/playerEngine';
import { SongRow } from '../components/SongRow';
import { SongContextMenu } from '../components/SongContextMenu';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { ArtistBio } from '../components/ArtistBio';

interface ArtistPageProps {
  artistId?: string;
  onPlay: (t: Track, list?: Track[]) => void;
  onNavigate?: (page: string, param?: string) => void;
  onBack?: () => void;
}

const FEATURED_ARTIST_SEEDS = [
  'Arijit Singh',
  'Diljit Dosanjh',
  'The Weeknd',
  'Taylor Swift',
  'AP Dhillon',
  'Shreya Ghoshal',
  'Sid Sriram',
  'Pritam',
  'Anuv Jain',
  'Ed Sheeran',
  'AR Rahman',
  'Dua Lipa',
];

export const ArtistPage: React.FC<ArtistPageProps> = ({
  artistId,
  onPlay,
  onNavigate,
  onBack,
}) => {
  const [artist, setArtist] = useState<SearchArtist | null>(null);
  const [topSongs, setTopSongs] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [singles, setSingles] = useState<Album[]>([]);
  const [similarArtists, setSimilarArtists] = useState<SearchArtist[]>([]);
  const [bio, setBio] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showAllSongs, setShowAllSongs] = useState(false);

  // Discovery / Empty State
  const [featuredArtists, setFeaturedArtists] = useState<SearchArtist[]>([]);

  // Player Engine State
  const { isPlaying } = usePlayerEngine();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => playerStore.current());

  // Context Menu & Add to Playlist Modals
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [playlistModalTracks, setPlaylistModalTracks] = useState<Track[]>([]);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Toast auto-dismiss
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

  // Multi-source loader
  const loadArtistData = useCallback(async (id: string) => {
    setLoading(true);
    setTopSongs([]);
    setAlbums([]);
    setSingles([]);
    setSimilarArtists([]);
    setBio('');
    setShowAllSongs(false);

    try {
      // 1. Concurrent fetch from JioSaavn & YT Music
      const isYT = id.startsWith('UC') || id.startsWith('FEmusic') || id.length === 24;

      const [saavnRes, ytRes] = await Promise.allSettled([
        getSaavnArtistDetails(id),
        getYTMusicArtist(id),
      ]);

      const saavnData = saavnRes.status === 'fulfilled' ? saavnRes.value : null;
      const ytData = ytRes.status === 'fulfilled' ? ytRes.value : null;

      let resolvedArtist: SearchArtist | null = null;
      let rawSongs: Track[] = [];
      let rawAlbums: Album[] = [];
      let rawSingles: Album[] = [];
      let rawSimilar: SearchArtist[] = [];
      let resolvedBio = '';

      if (saavnData && saavnData.artist) {
        resolvedArtist = saavnData.artist;
        if (saavnData.topSongs?.length) rawSongs.push(...saavnData.topSongs);
        if (saavnData.topAlbums?.length) rawAlbums.push(...saavnData.topAlbums);
        if (saavnData.bio) resolvedBio = saavnData.bio;
      }

      if (ytData && ytData.artist) {
        if (!resolvedArtist) resolvedArtist = ytData.artist;
        if (ytData.topSongs?.length) rawSongs.push(...ytData.topSongs);
        if (ytData.topAlbums?.length) rawAlbums.push(...ytData.topAlbums);
        if (ytData.singles?.length) rawSingles.push(...ytData.singles);
        if (ytData.similarArtists?.length) rawSimilar.push(...ytData.similarArtists);
      }

      // If only YT Music data was found and we have an artist name, try searching Saavn for bio & 320k tracks
      if (resolvedArtist && resolvedArtist.name && !saavnData) {
        try {
          const saavnSearch = await searchSaavnArtists(resolvedArtist.name, 1, 1);
          if (saavnSearch.artists.length > 0 && saavnSearch.artists[0].artistId) {
            const secondarySaavn = await getSaavnArtistDetails(saavnSearch.artists[0].artistId);
            if (secondarySaavn) {
              if (secondarySaavn.topSongs?.length) rawSongs.push(...secondarySaavn.topSongs);
              if (secondarySaavn.topAlbums?.length) rawAlbums.push(...secondarySaavn.topAlbums);
              if (secondarySaavn.bio) resolvedBio = secondarySaavn.bio;
            }
          }
        } catch {}
      }

      setArtist(resolvedArtist);
      setTopSongs(deduplicateTracks(rawSongs));
      setAlbums(deduplicateAlbums(rawAlbums));
      setSingles(deduplicateAlbums(rawSingles));
      setSimilarArtists(deduplicateArtists(rawSimilar));
      setBio(resolvedBio);
    } catch (err) {
      console.error('[ArtistPage] Error loading artist:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Discovery Loader for idle state
  const loadFeaturedArtists = useCallback(async () => {
    setLoading(true);
    try {
      const searches = await Promise.allSettled(
        FEATURED_ARTIST_SEEDS.slice(0, 6).map((name) => searchSaavnArtists(name, 1, 2))
      );
      const collected: SearchArtist[] = [];
      for (const res of searches) {
        if (res.status === 'fulfilled' && res.value.artists?.length) {
          collected.push(...res.value.artists);
        }
      }
      setFeaturedArtists(deduplicateArtists(collected));
    } catch {
      setFeaturedArtists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (artistId) {
      void loadArtistData(artistId);
    } else {
      void loadFeaturedArtists();
    }
  }, [artistId, loadArtistData, loadFeaturedArtists]);

  // Action Handlers
  const handlePlayAll = () => {
    if (!topSongs.length) return;
    onPlay(topSongs[0], topSongs);
  };

  const handleShuffle = () => {
    if (!topSongs.length) return;
    const shuffled = [...topSongs].sort(() => Math.random() - 0.5);
    playerStore.setQueue(shuffled, 0);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
    onPlay(shuffled[0], shuffled);
  };

  const handleStartRadio = async () => {
    if (!artist) return;
    setToastMessage(`Starting Radio for "${artist.name}"...`);
    try {
      let seedTrack: Track;
      if (topSongs.length > 0) {
        seedTrack = topSongs[0];
      } else {
        seedTrack = {
          id: artist.artistId,
          title: artist.name,
          author: artist.name,
          thumbnail: artist.thumbnails?.[0]?.url || '',
          duration: '3:30',
          durationSeconds: 210,
          url: '',
          type: 'SONG',
        };
      }
      const radioTracks = await fetchRadio(seedTrack, 25);
      if (radioTracks && radioTracks.length) {
        onPlay(radioTracks[0], radioTracks);
      } else if (topSongs.length) {
        handlePlayAll();
      }
    } catch {
      setToastMessage('Could not start radio');
    }
  };

  const handleShare = () => {
    if (navigator.share && artist) {
      navigator
        .share({
          title: artist.name,
          text: `Listen to ${artist.name} on Wave Player`,
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      void navigator.clipboard.writeText(window.location.href);
      setToastMessage('Artist link copied to clipboard');
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

  // 1. DISCOVERY / IDLE STATE (when no artistId is provided)
  if (!artistId) {
    return (
      <div className="space-y-6 pb-20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-purple-400 flex items-center gap-1.5">
              <Mic2 className="h-3.5 w-3.5" /> Explore Artists
            </p>
            <h1 className="mt-1 text-[26px] sm:text-[32px] font-extrabold tracking-[-0.03em] text-white">
              Popular Artists
            </h1>
            <p className="mt-1 text-[13px] text-[#8e8e93]">
              Top singers, producers, and trending musical creators
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {featuredArtists.map((a) => (
              <motion.div
                key={a.artistId}
                whileHover={{ y: -4 }}
                onClick={() => onNavigate?.('artist', a.artistId)}
                className="group relative cursor-pointer p-4 text-center flex flex-col items-center rounded-[24px] bg-white/[0.03] border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-all shadow-sm"
              >
                <div className="relative aspect-square w-28 sm:w-32 overflow-hidden rounded-full bg-[#141416] ring-2 ring-white/10 group-hover:ring-white/30 shadow-lg transition-all">
                  <img
                    src={a.thumbnails?.[0]?.url || ''}
                    alt={a.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg">
                      <Play className="h-4 w-4 fill-current ml-0.5" />
                    </span>
                  </div>
                </div>
                <div className="mt-3 min-w-0 w-full">
                  <p className="truncate text-[14px] font-bold text-white group-hover:text-purple-300 transition-colors">
                    {a.name}
                  </p>
                  <p className="truncate text-[11.5px] text-[#8e8e93] mt-0.5">
                    {a.role || 'Artist'}
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
  if (loading && !artist) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="h-9 w-9 animate-spin text-purple-400" />
        <p className="text-sm font-semibold text-[#8e8e93]">Loading artist profile & discography...</p>
      </div>
    );
  }

  const avatarUrl = artist?.thumbnails?.[0]?.url || '';
  const visibleSongs = showAllSongs ? topSongs : topSongs.slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
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
      {/* 1. ARTIST HERO BANNER */}
      {/* ======================================================= */}
      <div className="relative overflow-hidden rounded-[28px] sm:rounded-[36px] bg-[#121214] border border-white/10 p-6 sm:p-8 lg:p-10 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
        {/* Ambient Blur Backdrop */}
        {avatarUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover scale-150 blur-[60px] opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/50" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
          </div>
        )}

        <div className="relative flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8">
          {/* Circular Artist Avatar */}
          <div className="relative h-[170px] w-[170px] sm:h-[200px] sm:w-[200px] shrink-0 rounded-full overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] ring-2 ring-white/20 bg-[#161619]">
            <img
              src={avatarUrl}
              alt={artist?.name || 'Artist'}
              className="h-full w-full object-cover"
            />
          </div>

          {/* Details */}
          <div className="flex flex-1 flex-col justify-end min-w-0 text-center sm:text-left">
            <div className="inline-flex items-center justify-center sm:justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-purple-400">
              <Sparkles className="h-3.5 w-3.5" /> Verified Artist
            </div>

            <h1 className="mt-2 text-[28px] sm:text-[38px] lg:text-[46px] font-black tracking-[-0.03em] leading-tight text-white line-clamp-2">
              {artist?.name || 'Artist'}
            </h1>

            <p className="mt-1 text-[14px] sm:text-[15px] font-medium text-white/70">
              {artist?.role || 'Lead Singer & Music Producer'}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-white/60">
              {topSongs.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                  <Music2 className="h-3 w-3" /> {topSongs.length} Top Tracks
                </span>
              )}
              {albums.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                  <Disc3 className="h-3 w-3" /> {albums.length} Releases
                </span>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <button
                type="button"
                onClick={handlePlayAll}
                disabled={topSongs.length === 0}
                className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-bold text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.4)] active:scale-95 transition-all disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-current ml-0.5" /> Play Top Songs
              </button>

              <button
                type="button"
                onClick={handleShuffle}
                disabled={topSongs.length === 0}
                className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-5 text-[14px] font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
              >
                <Shuffle className="h-4 w-4" /> Shuffle
              </button>

              <button
                type="button"
                onClick={handleStartRadio}
                className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-5 text-[14px] font-semibold text-white transition-all active:scale-95"
              >
                <Radio className="h-4 w-4 text-purple-400" /> Artist Radio
              </button>

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
      {/* 2. POPULAR SONGS SECTION */}
      {/* ======================================================= */}
      {topSongs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[19px] sm:text-[22px] font-extrabold text-white tracking-tight flex items-center gap-2">
              <Music2 className="h-5 w-5 text-purple-400" /> Popular Songs
            </h2>
            {topSongs.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllSongs(!showAllSongs)}
                className="inline-flex items-center gap-1 text-xs font-bold text-white/60 hover:text-white transition-colors"
              >
                {showAllSongs ? 'Show Less' : `See All (${topSongs.length})`}
                {showAllSongs ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.02] p-2 divide-y divide-white/[0.04]">
            {visibleSongs.map((track, idx) => (
              <SongRow
                key={`artist-song-${track.id}-${idx}`}
                track={track}
                index={idx}
                isActive={currentTrack?.id === track.id}
                isPlaying={isPlaying}
                onPlay={() => onPlay(track, topSongs)}
                showAlbum={true}
                onOpenMenu={handleOpenContextMenu}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* 3. DISCOGRAPHY / ALBUMS SECTION */}
      {/* ======================================================= */}
      {albums.length > 0 && (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[19px] sm:text-[22px] font-extrabold text-white tracking-tight flex items-center gap-2">
              <Disc3 className="h-5 w-5 text-cyan-400" /> Discography & Albums
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {albums.map((al) => (
              <motion.div
                key={al.albumId}
                whileHover={{ y: -4 }}
                onClick={() => onNavigate?.('album', al.albumId)}
                className="group cursor-pointer rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-sm"
              >
                <div className="relative aspect-square w-full rounded-[16px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                  <img
                    src={al.thumbnails?.[0]?.url || ''}
                    alt={al.name}
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
                  {al.name}
                </p>
                <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                  {al.year ? `${al.year} • ` : ''}Album
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* 4. SINGLES & EPS SECTION */}
      {/* ======================================================= */}
      {singles.length > 0 && (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[19px] sm:text-[22px] font-extrabold text-white tracking-tight flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-400" /> Singles & EPs
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {singles.map((sg) => (
              <motion.div
                key={sg.albumId}
                whileHover={{ y: -4 }}
                onClick={() => onNavigate?.('album', sg.albumId)}
                className="group cursor-pointer rounded-[22px] bg-white/[0.03] border border-white/10 p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-sm"
              >
                <div className="relative aspect-square w-full rounded-[16px] overflow-hidden bg-[#141416] ring-1 ring-white/10">
                  <img
                    src={sg.thumbnails?.[0]?.url || ''}
                    alt={sg.name}
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
                  {sg.name}
                </p>
                <p className="truncate text-[11px] text-[#8e8e93] mt-0.5">
                  {sg.year ? `${sg.year} • ` : ''}Single
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* 5. SIMILAR ARTISTS SECTION */}
      {/* ======================================================= */}
      {similarArtists.length > 0 && (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[19px] sm:text-[22px] font-extrabold text-white tracking-tight flex items-center gap-2">
              <Users className="h-5 w-5 text-purple-400" /> Fans Also Like
            </h2>
          </div>

          <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2 -mx-1 px-1">
            {similarArtists.map((sim) => (
              <div
                key={sim.artistId}
                onClick={() => onNavigate?.('artist', sim.artistId)}
                className="group flex flex-col items-center text-center cursor-pointer min-w-[125px] w-[125px] shrink-0 p-2.5 rounded-2xl hover:bg-white/[0.04] transition-all"
              >
                <div className="relative aspect-square w-full rounded-full overflow-hidden bg-[#18181b] ring-2 ring-white/10 group-hover:ring-white/30 shadow-md transition-all">
                  <img
                    src={sim.thumbnails?.[0]?.url || ''}
                    alt={sim.name}
                    loading="lazy"
                    className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Play className="h-5 w-5 fill-white text-white" />
                  </div>
                </div>
                <p className="mt-2.5 text-xs sm:text-[13px] font-bold text-white group-hover:text-purple-300 truncate w-full transition-colors">
                  {sim.name}
                </p>
                <p className="text-[11px] text-[#8e8e93] font-medium">
                  {sim.role || 'Artist'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* 6. ARTIST BIO CHAPTERS */}
      {/* ======================================================= */}
      {bio && (
        <ArtistBio
          bio={bio}
          artistName={artist?.name}
          onNavigate={onNavigate}
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
          if (menuTrack) onPlay(menuTrack, topSongs);
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
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-full bg-white text-black px-4 py-2 text-xs font-bold shadow-[0_8px_30px_rgba(0,0,0,0.6)] flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
