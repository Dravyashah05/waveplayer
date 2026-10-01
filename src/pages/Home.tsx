import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  Heart,
  Flame,
  Disc3,
  ListMusic,
  Mic2,
  ChevronRight,
  Shuffle,
  Clock3,
  Sparkles,
  Loader2,
  TrendingUp,
  Radio,
  RotateCw,
  MoreVertical,
  Volume2,
  CheckCircle2,
  Headphones,
  Compass,
  Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Track, Album, Playlist, SearchArtist } from '../types';
import { playerStore } from '../services/playerStore';
import { playerEngine, usePlayerEngine } from '../services/playerEngine';
import { getSaavnBrowseModules, searchSaavnArtists, searchSaavnSongs } from '../services/saavnApi';
import {
  recommendTracks,
  getSimilarTracks,
  getDiscoverTracks,
  ScoredTrack,
} from '../services/recommendationEngine';
import {
  fetchQuickPicks,
  fetchRadio,
  fetchRecHome,
  fetchForYou,
  fetchDiscover,
  HomeSections,
} from '../services/recommendationApi';
import { getProfile } from '../services/userProfile';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { getRecentlyPlayed, getListeningEvents } from '../services/listeningStore';
import { formatRelativeTime } from '../services/libraryStore';
import { SongContextMenu } from '../components/SongContextMenu';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';

// Time-of-day greeting generator
function getDynamicGreeting(userName?: string | null): { greeting: string; caption: string } {
  const hour = new Date().getHours();
  let timeGreeting = 'Good morning';
  let caption = 'Start your day with your favorite sounds';

  if (hour >= 5 && hour < 12) {
    timeGreeting = 'Good morning';
    caption = 'Kickstart your morning with fresh tunes';
  } else if (hour >= 12 && hour < 17) {
    timeGreeting = 'Good afternoon';
    caption = 'Music tailored for your afternoon flow';
  } else if (hour >= 17 && hour < 22) {
    timeGreeting = 'Good evening';
    caption = 'Unwind with your personalized evening mixes';
  } else {
    timeGreeting = 'Good night';
    caption = 'Relax and dive into late-night sessions';
  }

  const firstName = userName ? userName.trim().split(' ')[0] : null;
  const greeting = firstName ? `${timeGreeting}, ${firstName}` : timeGreeting;

  return { greeting, caption };
}

export interface PersonalizedMix {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  gradient: string;
  badge: string;
  tracks: Track[];
  coverThumb?: string;
}

const FALLBACK_HITS: Track[] = [
  {
    id: 'BddP6PYo2gs',
    title: 'Kesariya (From "Brahmastra")',
    author: 'Arijit Singh, Pritam, Amitabh Bhattacharya',
    thumbnail: 'https://i.ytimg.com/vi/BddP6PYo2gs/hqdefault.jpg',
    duration: '4:28',
    durationSeconds: 268,
    url: 'https://www.youtube.com/watch?v=BddP6PYo2gs',
    albumName: 'Brahmastra',
    type: 'SONG',
  },
  {
    id: '4NRXx6U8ABQ',
    title: 'Blinding Lights',
    author: 'The Weeknd',
    thumbnail: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg',
    duration: '3:20',
    durationSeconds: 200,
    url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
    albumName: 'After Hours',
    type: 'SONG',
  },
  {
    id: 'V1Pl8CzNzCw',
    title: 'Chaleya (From "Jawan")',
    author: 'Arijit Singh, Shilpa Rao, Anirudh Ravichander',
    thumbnail: 'https://i.ytimg.com/vi/V1Pl8CzNzCw/hqdefault.jpg',
    duration: '3:20',
    durationSeconds: 200,
    url: 'https://www.youtube.com/watch?v=V1Pl8CzNzCw',
    albumName: 'Jawan',
    type: 'SONG',
  },
];

const RailHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actionText?: string;
  onAction?: () => void;
  action2Text?: string;
  onAction2?: () => void;
}> = ({ title, subtitle, icon, actionText, onAction, action2Text, onAction2 }) => (
  <div className="flex items-end justify-between gap-4 mb-3.5">
    <div className="min-w-0">
      <h2 className="flex items-center gap-2 text-[17px] sm:text-[20px] font-extrabold tracking-[-0.02em] text-white">
        {icon && (
          <span className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-white/[0.08] text-white shrink-0">
            {icon}
          </span>
        )}
        <span className="truncate">{title}</span>
      </h2>
      {subtitle && <p className="mt-0.5 text-xs sm:text-[13px] font-medium text-[#8e8e93] truncate">{subtitle}</p>}
    </div>
    <div className="flex items-center gap-2 shrink-0">
      {onAction2 && (
        <button
          type="button"
          onClick={onAction2}
          className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/[0.08] px-3 sm:px-3.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white hover:text-black transition-all shrink-0"
        >
          <Radio className="h-3 w-3" /> {action2Text || 'Radio'}
        </button>
      )}
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/[0.08] px-3 sm:px-3.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white hover:text-black transition-all shrink-0"
        >
          {actionText || 'See all'} <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  </div>
);

export const HomePage: React.FC<{
  onPlay: (t: Track, list?: Track[]) => void;
  onPlayPlaylist?: (id: string) => void;
  onNavigate?: (page: string, param?: string) => void;
  history: Track[];
}> = ({ onPlay, onNavigate, history }) => {
  const { user } = useGoogleAccount();
  const { greeting, caption } = useMemo(() => getDynamicGreeting(user?.name), [user?.name]);

  // Loading & Refreshing States
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startingRadio, setStartingRadio] = useState(false);

  // Player Store & Engine States
  const { isPlaying } = usePlayerEngine();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => playerStore.current());
  const [favs, setFavs] = useState<Track[]>(() => playerStore.favsList());

  // Recommendation Data Stores
  const [quickPicks, setQuickPicks] = useState<Track[]>([]);
  const [madeForYou, setMadeForYou] = useState<ScoredTrack[]>([]);
  const [becauseSections, setBecauseSections] = useState<
    Array<{ artist: string; seedTrack: Track; tracks: Track[] }>
  >([]);
  const [discoverTracks, setDiscoverTracks] = useState<Track[]>([]);
  const [recommendedAlbums, setRecommendedAlbums] = useState<Album[]>([]);
  const [recommendedArtists, setRecommendedArtists] = useState<SearchArtist[]>([]);
  const [topPlaylists, setTopPlaylists] = useState<Playlist[]>([]);
  const [personalizedMixes, setPersonalizedMixes] = useState<PersonalizedMix[]>([]);

  // Modals & Toast
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [playlistModalTracks, setPlaylistModalTracks] = useState<Track[]>([]);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Toast Auto-dismiss
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Player Subscription
  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setCurrentTrack(playerStore.current());
      setFavs([...playerStore.favsList()]);
    });
    return () => {
      unsub();
    };
  }, []);

  // Main Data Fetcher
  const loadHomeRecommendations = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const profile = getProfile();
      const hist = playerStore.historyList();
      const currentFavs = playerStore.favsList();
      const recentListening = getRecentlyPlayed(30);

      // Seed pool selection
      const seedPool = [
        hist[0] || currentFavs[0] || recentListening[0],
        hist[1] || currentFavs[1] || recentListening[1],
        hist[2] || currentFavs[2] || recentListening[2],
      ]
        .filter((t, i, a): t is Track => !!t && !!t.id && a.findIndex((x) => x && x.id === t.id) === i)
        .slice(0, 3);
      const primarySeed = seedPool[0] || null;

      // 1. Fetch Backend Quick Picks & Home Sections
      const [backendQP, backendHome, backendForYou, backendDiscover, saavnBrowse] = await Promise.all([
        fetchQuickPicks(12).catch(() => null),
        fetchRecHome().catch(() => null),
        fetchForYou().catch(() => [] as Track[]),
        fetchDiscover().catch(() => [] as Track[]),
        getSaavnBrowseModules().catch(() => ({
          trending: [] as Track[],
          topPlaylists: [] as Playlist[],
          newAlbums: [] as Album[],
          charts: [] as Playlist[],
        })),
      ]);

      // Process Quick Picks
      let qpResults: Track[] = [];
      if (backendQP && backendQP.length > 0) {
        qpResults = backendQP;
      } else {
        const localQP = await recommendTracks({
          seedTrack: primarySeed,
          limit: 12,
          weights: { taste: 0.4, similarity: 0.25, collaborative: 0.15, popularity: 0.1, discovery: 0.1 },
        }).catch(() => [] as ScoredTrack[]);
        qpResults = localQP.length ? localQP : (saavnBrowse.trending?.slice(0, 12) || FALLBACK_HITS);
      }
      setQuickPicks(qpResults.slice(0, 12));

      // Process Made For You
      let forYouResults: ScoredTrack[] = [];
      if (backendForYou && backendForYou.length > 0) {
        forYouResults = backendForYou.map((t) => ({
          ...t,
          _score: 0.9,
          _reasons: ['Picked for your taste', 'YouTube Music Recommendation'],
        }));
      } else {
        forYouResults = await recommendTracks({
          seedTracks: seedPool,
          limit: 16,
        }).catch(() => [] as ScoredTrack[]);
      }
      setMadeForYou(forYouResults.slice(0, 16));

      // Process Discover Something New
      let discResults: Track[] = [];
      if (backendDiscover && backendDiscover.length > 0) {
        discResults = backendDiscover;
      } else {
        const excludeSet = new Set([
          ...(primarySeed ? [primarySeed.id] : []),
          ...hist.slice(0, 10).map((t) => t.id),
        ]);
        discResults = await getDiscoverTracks(profile, excludeSet, 12).catch(() => [] as Track[]);
      }
      setDiscoverTracks(discResults.slice(0, 12));

      // 2. Process "Because You Listen To [Artist]" Sections
      const topArtists = Object.entries(profile.artists || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name]) => name);

      const dynamicBecause: Array<{ artist: string; seedTrack: Track; tracks: Track[] }> = [];

      for (const artistName of topArtists) {
        const matchingTrack =
          hist.find((t) => t.author?.toLowerCase().includes(artistName.toLowerCase())) ||
          currentFavs.find((t) => t.author?.toLowerCase().includes(artistName.toLowerCase())) ||
          qpResults.find((t) => t.author?.toLowerCase().includes(artistName.toLowerCase()));

        if (matchingTrack) {
          const similar = await getSimilarTracks(matchingTrack.id, 10).catch(() => [] as Track[]);
          if (similar.length) {
            dynamicBecause.push({
              artist: artistName,
              seedTrack: matchingTrack,
              tracks: similar,
            });
          }
        }
      }

      // If no history artists, use primary seed
      if (dynamicBecause.length === 0 && primarySeed) {
        const seedArtist = primarySeed.author?.split(',')[0]?.trim() || primarySeed.author;
        const similar = await getSimilarTracks(primarySeed.id, 10).catch(() => [] as Track[]);
        if (similar.length) {
          dynamicBecause.push({
            artist: seedArtist,
            seedTrack: primarySeed,
            tracks: similar,
          });
        }
      }
      setBecauseSections(dynamicBecause);

      // 3. Generate Personalized Mixes ("Your Mix")
      const allCandidateTracks = [
        ...qpResults,
        ...forYouResults,
        ...discResults,
        ...currentFavs,
        ...hist,
      ];
      const seenMixIds = new Set<string>();
      const dedupedMixPool = allCandidateTracks.filter((t) => {
        if (!t?.id || seenMixIds.has(t.id)) return false;
        seenMixIds.add(t.id);
        return true;
      });

      const mixes: PersonalizedMix[] = [
        {
          id: 'my-supermix',
          title: 'My Supermix',
          subtitle: 'Endless personalized mix',
          description: 'A signature blend of your current favorites, recent replays, and fresh discoveries.',
          gradient: 'from-amber-500 via-rose-600 to-purple-800',
          badge: 'SUPERMIX',
          tracks: dedupedMixPool.slice(0, 25),
          coverThumb: qpResults[0]?.thumbnail || dedupedMixPool[0]?.thumbnail,
        },
        {
          id: 'chill-mix',
          title: 'Chill Mix',
          subtitle: 'Relax & unwind',
          description: 'Mellow melodies, acoustic sounds, and relaxing rhythms tailored to your taste.',
          gradient: 'from-cyan-600 via-teal-700 to-slate-900',
          badge: 'CHILL',
          tracks: dedupedMixPool
            .filter((t) => {
              const str = (t.title + ' ' + (t.albumName || '')).toLowerCase();
              return str.includes('lofi') || str.includes('chill') || str.includes('acoustic') || str.includes('love') || str.includes('slow');
            })
            .concat(dedupedMixPool.slice(5, 20))
            .slice(0, 20),
          coverThumb: dedupedMixPool[2]?.thumbnail,
        },
        {
          id: 'energy-mix',
          title: 'Energy Mix',
          subtitle: 'High tempo & upbeat',
          description: 'Electrifying beats, powerhouse anthems, and high-energy bangers to fuel your day.',
          gradient: 'from-orange-500 via-red-600 to-pink-700',
          badge: 'ENERGY',
          tracks: dedupedMixPool
            .filter((t) => {
              const str = (t.title + ' ' + (t.albumName || '')).toLowerCase();
              return str.includes('dance') || str.includes('party') || str.includes('remix') || str.includes('bass') || str.includes('workout');
            })
            .concat(dedupedMixPool.slice(10, 25))
            .slice(0, 20),
          coverThumb: dedupedMixPool[4]?.thumbnail,
        },
        {
          id: 'focus-mix',
          title: 'Focus Mix',
          subtitle: 'Deep focus & flow',
          description: 'Smooth instrumentals, melodic atmospheres, and deep concentration soundscapes.',
          gradient: 'from-violet-600 via-indigo-700 to-zinc-950',
          badge: 'FOCUS',
          tracks: dedupedMixPool.slice(8, 28),
          coverThumb: dedupedMixPool[6]?.thumbnail,
        },
        {
          id: 'discovery-mix',
          title: 'Discover Mix',
          subtitle: 'New music for you',
          description: 'Emerging artists, fresh releases, and songs outside your regular rotation.',
          gradient: 'from-emerald-500 via-teal-600 to-cyan-900',
          badge: 'DISCOVERY',
          tracks: discResults.length ? discResults : dedupedMixPool.slice(12, 30),
          coverThumb: discResults[0]?.thumbnail || dedupedMixPool[1]?.thumbnail,
        },
      ];
      setPersonalizedMixes(mixes);

      // 4. Extract Recommended Albums
      const albumsList: Album[] = [];
      if (saavnBrowse.newAlbums && saavnBrowse.newAlbums.length) {
        albumsList.push(...saavnBrowse.newAlbums);
      }
      setRecommendedAlbums(albumsList.slice(0, 8));

      // 5. Extract Recommended Artists
      const artistQuery = topArtists[0] || (primarySeed?.author?.split(',')[0]?.trim()) || 'Arijit Singh';
      const saavnArtists = await searchSaavnArtists(artistQuery).catch(() => ({ total: 0, artists: [] as SearchArtist[] }));
      if (saavnArtists.artists && saavnArtists.artists.length) {
        setRecommendedArtists(saavnArtists.artists.slice(0, 8));
      }

      // 6. Playlists
      if (saavnBrowse.topPlaylists && saavnBrowse.topPlaylists.length) {
        setTopPlaylists(saavnBrowse.topPlaylists.slice(0, 8));
      }
    } catch (err) {
      console.warn('[HomePage] recommendation fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial Load & Profile Sync
  useEffect(() => {
    void loadHomeRecommendations();
    const handleProfileChange = () => {
      void loadHomeRecommendations();
    };
    window.addEventListener('wave:profile', handleProfileChange);
    return () => {
      window.removeEventListener('wave:profile', handleProfileChange);
    };
  }, [loadHomeRecommendations]);

  // Start Radio Action
  const handleStartPersonalizedRadio = async (seed?: Track | null) => {
    if (startingRadio) return;
    setStartingRadio(true);
    const targetSeed = seed || quickPicks[0] || madeForYou[0] || history[0] || FALLBACK_HITS[0];
    try {
      setToastMessage(`Starting Radio for "${targetSeed.title}"...`);
      const radioTracks = await fetchRadio(targetSeed, 25);
      if (radioTracks && radioTracks.length) {
        onPlay(radioTracks[0], radioTracks);
      } else {
        const fallback = await getSimilarTracks(targetSeed.id, 20);
        onPlay(fallback[0] || targetSeed, fallback.length ? fallback : [targetSeed]);
      }
    } catch {
      onPlay(targetSeed, [targetSeed]);
    } finally {
      setStartingRadio(false);
    }
  };

  // Play Actions
  const handlePlaySong = (track: Track, list: Track[]) => {
    onPlay(track, list);
  };

  const handlePlayAll = (tracks: Track[]) => {
    if (!tracks.length) return;
    onPlay(tracks[0], tracks);
    setToastMessage(`Playing ${tracks.length} tracks`);
  };

  const handleShuffleAll = (tracks: Track[]) => {
    if (!tracks.length) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playerStore.setQueue(shuffled, 0);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
    setToastMessage(`Shuffling ${tracks.length} tracks`);
  };

  const handleToggleFav = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    const added = playerStore.toggleFav(track);
    setFavs([...playerStore.favsList()]);
    setToastMessage(added ? `Saved to Liked Songs` : `Removed from Liked Songs`);
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

  const recentHistory = useMemo(() => {
    const fromListening = getRecentlyPlayed(20);
    const pool = fromListening.length ? fromListening : history;
    const seen = new Set<string>();
    return pool.filter((t) => {
      if (!t?.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }).slice(0, 10);
  }, [history]);

  return (
    <div className="space-y-8 sm:space-y-10 pb-24">
      {/* ——— GREETING & HERO HEADER ——— */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] sm:text-[34px] font-black tracking-[-0.03em] leading-tight text-white">
              {greeting}
            </h1>
            <button
              onClick={() => void loadHomeRecommendations(true)}
              disabled={refreshing}
              className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] border border-white/10 text-white/70 hover:text-white hover:bg-white/[0.12] active:scale-95 transition-all ${
                refreshing ? 'animate-spin text-white' : ''
              }`}
              title="Refresh personalized recommendations"
              aria-label="Refresh recommendations"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs sm:text-[13.5px] font-medium text-[#8e8e93] mt-0.5">
            {caption}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {quickPicks.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => handlePlayAll(quickPicks)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs sm:text-[13px] font-bold text-black hover:bg-white/90 active:scale-95 transition-all shadow-[0_4px_16px_rgba(255,255,255,0.18)]"
              >
                <Play className="h-3.5 w-3.5 fill-current ml-0.5" /> Play All
              </button>
              <button
                type="button"
                onClick={() => handleShuffleAll(quickPicks)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.08] px-3.5 py-2 text-xs sm:text-[13px] font-semibold text-white active:scale-95 transition-all"
              >
                <Shuffle className="h-3.5 w-3.5" /> Shuffle
              </button>
            </>
          )}
        </div>
      </div>

      {/* ——— SKELETON LOADING STATE ——— */}
      {loading && !refreshing ? (
        <div className="space-y-8 animate-pulse">
          {/* Quick Picks Skeleton */}
          <div className="space-y-3">
            <div className="h-6 w-36 bg-white/10 rounded-full" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl bg-white/[0.04] border border-white/5" />
              ))}
            </div>
          </div>
          {/* Rails Skeleton */}
          <div className="space-y-3">
            <div className="h-6 w-44 bg-white/10 rounded-full" />
            <div className="flex gap-4 overflow-hidden">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="min-w-[160px] w-[160px] h-48 rounded-[20px] bg-white/[0.04] border border-white/5 shrink-0" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ======================================================= */}
          {/* 1. QUICK PICKS (PROMINENT COMPACT GRID) */}
          {/* ======================================================= */}
          {quickPicks.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Quick Picks"
                subtitle="Start listening to songs you love"
                icon={<Flame className="h-3.5 w-3.5 text-orange-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(quickPicks)}
                action2Text={startingRadio ? 'Starting…' : 'Radio'}
                onAction2={() => handleStartPersonalizedRadio(quickPicks[0])}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                {quickPicks.slice(0, 12).map((track, idx) => {
                  const isActive = currentTrack?.id === track.id;
                  const isFav = playerStore.isFav(track.id);
                  return (
                    <motion.div
                      key={`qp-${track.id}-${idx}`}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => handlePlaySong(track, quickPicks)}
                      className={`group relative flex items-center gap-3 p-2.5 rounded-[18px] border transition-all cursor-pointer select-none backdrop-blur-md ${
                        isActive
                          ? 'bg-white/[0.12] border-white/25 shadow-[0_4px_20px_rgba(255,255,255,0.08)]'
                          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] hover:border-white/15'
                      }`}
                    >
                      {/* Thumbnail with overlay play */}
                      <div className="relative h-12 w-12 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-[14px] bg-[#1a1a1c] ring-1 ring-white/10 shadow-sm">
                        <img
                          src={track.thumbnail}
                          alt={track.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          onError={(e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
                          }}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          {isActive && isPlaying ? (
                            <Pause className="h-4 w-4 fill-white text-white" />
                          ) : (
                            <Play className="h-4 w-4 fill-white text-white ml-0.5" />
                          )}
                        </div>
                        {isActive && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <span className="flex items-end gap-[2px] h-3.5">
                              <span className="wave-bar !bg-white animate-[wave_0.8s_ease-in-out_infinite]" />
                              <span className="wave-bar !bg-white animate-[wave_1.1s_ease-in-out_infinite_0.2s]" />
                              <span className="wave-bar !bg-white animate-[wave_0.9s_ease-in-out_infinite_0.4s]" />
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Title & Artist */}
                      <div className="min-w-0 flex-1 py-0.5">
                        <p
                          className={`truncate text-[13.5px] sm:text-[14px] font-bold leading-tight ${
                            isActive ? 'text-white' : 'text-white/95 group-hover:text-white'
                          }`}
                        >
                          {track.title}
                        </p>
                        <p className="truncate text-xs text-[#8e8e93] font-medium mt-0.5">
                          {track.author}
                        </p>
                      </div>

                      {/* Actions: Heart & ⋮ */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleToggleFav(track, e)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
                            isFav
                              ? 'text-red-400 opacity-100 scale-100'
                              : 'text-white/40 hover:text-white opacity-0 group-hover:opacity-100'
                          }`}
                          aria-label="Like song"
                        >
                          <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleOpenContextMenu(track, e)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                          aria-label="More options"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* 2. YOUR MIX (PERSONALIZED MIX CARDS) */}
          {/* ======================================================= */}
          {personalizedMixes.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Your Mix"
                subtitle="Personalized mixes updated for your taste"
                icon={<Sparkles className="h-3.5 w-3.5 text-amber-400" />}
                actionText="Play Supermix"
                onAction={() => personalizedMixes[0] && handlePlayAll(personalizedMixes[0].tracks)}
              />
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
                {personalizedMixes.map((mix) => (
                  <motion.div
                    key={mix.id}
                    whileHover={{ y: -4 }}
                    onClick={() => handlePlayAll(mix.tracks)}
                    className="snap-start group cursor-pointer min-w-[190px] w-[190px] sm:min-w-[215px] sm:w-[215px] shrink-0 rounded-[24px] border border-white/10 bg-white/[0.03] p-3.5 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-[0_8px_24px_rgba(0,0,0,0.3)] backdrop-blur-md flex flex-col justify-between"
                  >
                    <div className={`relative aspect-square w-full rounded-[18px] overflow-hidden bg-gradient-to-br ${mix.gradient} shadow-md p-4 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-black/40 backdrop-blur px-2.5 py-0.5 text-[10px] font-black tracking-wider text-white border border-white/15">
                          {mix.badge}
                        </span>
                        <span className="h-7 w-7 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white">
                          <Headphones className="h-3.5 w-3.5" />
                        </span>
                      </div>

                      <div>
                        <h3 className="text-[17px] sm:text-[19px] font-black text-white leading-tight tracking-tight drop-shadow">
                          {mix.title}
                        </h3>
                        <p className="text-[11px] font-medium text-white/80 mt-0.5 line-clamp-1">
                          {mix.subtitle}
                        </p>
                      </div>

                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-2xl transform scale-90 group-hover:scale-100 transition-transform">
                          <Play className="h-5 w-5 fill-current ml-0.5" />
                        </span>
                      </div>
                    </div>

                    <div className="mt-3">
                      <p className="text-xs text-white/60 line-clamp-2 leading-relaxed font-medium">
                        {mix.description}
                      </p>
                      <p className="text-[11px] font-mono text-white/40 mt-1.5">
                        {mix.tracks.length} tracks
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* 3. RECENTLY PLAYED (HORIZONTAL RAIL) */}
          {/* ======================================================= */}
          {recentHistory.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Recently Played"
                subtitle="Pick up right where you left off"
                icon={<Clock3 className="h-3.5 w-3.5 text-cyan-400" />}
                actionText="See library"
                onAction={() => onNavigate?.('library', 'recent')}
              />
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
                {recentHistory.map((track) => (
                  <div
                    key={`rec-hist-${track.id}`}
                    onClick={() => handlePlaySong(track, recentHistory)}
                    className="snap-start group cursor-pointer min-w-[145px] w-[145px] sm:min-w-[165px] sm:w-[165px] shrink-0"
                  >
                    <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#18181b] ring-1 ring-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4)]">
                      <img
                        src={track.thumbnail}
                        alt={track.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                          <Play className="h-4 w-4 fill-current ml-0.5" />
                        </div>
                      </div>
                      <span className="absolute bottom-2 left-2 rounded-full bg-black/70 backdrop-blur border border-white/10 px-2 py-0.5 text-[9.5px] font-bold text-white">
                        Recent
                      </span>
                    </div>
                    <p className="truncate text-[13px] sm:text-[13.5px] font-bold text-white mt-2 leading-tight group-hover:text-cyan-300 transition-colors">
                      {track.title}
                    </p>
                    <p className="truncate text-xs font-medium text-[#8e8e93] mt-0.5">
                      {track.author}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* 4. BECAUSE YOU LISTEN TO [ARTIST] (DYNAMIC SECTIONS) */}
          {/* ======================================================= */}
          {becauseSections.map((section) => (
            <div key={`because-${section.artist}`} className="space-y-3.5">
              <RailHeader
                title={`Because you listen to ${section.artist}`}
                subtitle={`Similar tracks & top hits from ${section.artist}`}
                icon={<Heart className="h-3.5 w-3.5 text-rose-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(section.tracks)}
                action2Text="Radio"
                onAction2={() => handleStartPersonalizedRadio(section.seedTrack)}
              />
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
                {section.tracks.map((track) => (
                  <div
                    key={`because-item-${track.id}`}
                    onClick={() => handlePlaySong(track, section.tracks)}
                    className="snap-start group cursor-pointer min-w-[150px] w-[150px] sm:min-w-[170px] sm:w-[170px] shrink-0"
                  >
                    <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#18181b] ring-1 ring-white/10 shadow-md">
                      <img
                        src={track.thumbnail}
                        alt={track.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                          <Play className="h-4 w-4 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <p className="truncate text-[13px] sm:text-[13.5px] font-bold text-white mt-2 leading-tight group-hover:text-rose-300 transition-colors">
                      {track.title}
                    </p>
                    <p className="truncate text-xs font-medium text-[#8e8e93] mt-0.5">
                      {track.author}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* ======================================================= */}
          {/* 5. MADE FOR YOU (PERSONALIZED HYBRID SELECTION) */}
          {/* ======================================================= */}
          {madeForYou.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Made For You"
                subtitle="Deep recommendations tuned to your taste profile"
                icon={<Sparkles className="h-3.5 w-3.5 text-amber-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(madeForYou)}
                action2Text={startingRadio ? 'Starting…' : 'Radio'}
                onAction2={() => handleStartPersonalizedRadio(madeForYou[0])}
              />
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
                {madeForYou.map((track) => {
                  const reason = track._reasons?.[0] || 'Matches your taste';
                  return (
                    <div
                      key={`for-you-${track.id}`}
                      onClick={() => handlePlaySong(track, madeForYou)}
                      className="snap-start group cursor-pointer min-w-[155px] w-[155px] sm:min-w-[175px] sm:w-[175px] shrink-0"
                    >
                      <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#18181b] ring-1 ring-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                        <img
                          src={track.thumbnail}
                          alt={track.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-2 left-2 rounded-full bg-black/70 backdrop-blur border border-white/10 px-2 py-0.5 text-[9.5px] font-bold text-white hidden group-hover:inline-flex">
                          <Sparkles className="h-2.5 w-2.5 mr-1 text-amber-400" /> {reason}
                        </div>
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="h-11 w-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                            <Play className="h-5 w-5 fill-current ml-0.5" />
                          </div>
                        </div>
                      </div>
                      <div className="pt-2">
                        <p className="truncate text-[13px] sm:text-[13.5px] font-bold text-white leading-tight group-hover:text-amber-300 transition-colors">
                          {track.title}
                        </p>
                        <p className="truncate text-xs font-medium text-[#8e8e93] mt-0.5">
                          {track.author}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* 6. DISCOVER SOMETHING NEW (FRESH ARTISTS & GENRES) */}
          {/* ======================================================= */}
          {discoverTracks.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Discover Something New"
                subtitle="Fresh tracks and related artists beyond your usual rotation"
                icon={<Compass className="h-3.5 w-3.5 text-emerald-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(discoverTracks)}
              />
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
                {discoverTracks.map((track) => (
                  <div
                    key={`disc-${track.id}`}
                    onClick={() => handlePlaySong(track, discoverTracks)}
                    className="snap-start group cursor-pointer min-w-[150px] w-[150px] sm:min-w-[170px] sm:w-[170px] shrink-0"
                  >
                    <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#18181b] ring-1 ring-white/10 shadow-md">
                      <img
                        src={track.thumbnail}
                        alt={track.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                      <span className="absolute top-2 left-2 rounded-full bg-emerald-500 text-black px-2 py-0.5 text-[9.5px] font-black uppercase tracking-wider shadow">
                        New
                      </span>
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                          <Play className="h-4 w-4 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <p className="truncate text-[13px] sm:text-[13.5px] font-bold text-white mt-2 leading-tight group-hover:text-emerald-300 transition-colors">
                      {track.title}
                    </p>
                    <p className="truncate text-xs font-medium text-[#8e8e93] mt-0.5">
                      {track.author}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* 7. RECOMMENDED ALBUMS */}
          {/* ======================================================= */}
          {recommendedAlbums.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Recommended Albums"
                subtitle="Official albums and hit discographies"
                icon={<Disc3 className="h-3.5 w-3.5 text-cyan-400" />}
                onAction={() => onNavigate?.('albums')}
              />
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4">
                {recommendedAlbums.slice(0, 6).map((album) => (
                  <div
                    key={album.albumId}
                    onClick={() => onNavigate?.('album', album.albumId)}
                    className="group relative cursor-pointer rounded-[22px] border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-[0_8px_20px_rgba(0,0,0,0.3)] backdrop-blur-md"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-[16px] bg-[#141416] ring-1 ring-white/10">
                      <img
                        src={album.thumbnails?.[0]?.url || ''}
                        alt={album.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg">
                          <Play className="h-5 w-5 fill-current ml-0.5" />
                        </span>
                      </div>
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[9.5px] font-bold text-white border border-white/10">
                        <Disc3 className="h-3 w-3 text-cyan-400" /> ALBUM
                      </span>
                    </div>
                    <div className="mt-2.5 min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-white group-hover:text-cyan-300 transition-colors">
                        {album.name}
                      </p>
                      <p className="truncate text-xs text-[#8e8e93] mt-0.5">
                        {album.artist?.name || 'Various Artists'} {album.year ? `• ${album.year}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* 8. RECOMMENDED ARTISTS (CIRCULAR AVATARS) */}
          {/* ======================================================= */}
          {recommendedArtists.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Recommended Artists"
                subtitle="Singers & producers based on your music taste"
                icon={<Mic2 className="h-3.5 w-3.5 text-purple-400" />}
                onAction={() => onNavigate?.('artists')}
              />
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
                {recommendedArtists.slice(0, 6).map((artist) => (
                  <div
                    key={artist.artistId}
                    onClick={() => onNavigate?.('artist', artist.artistId)}
                    className="group flex flex-col items-center text-center cursor-pointer p-2 rounded-2xl hover:bg-white/[0.04] transition-all"
                  >
                    <div className="relative aspect-square w-full max-w-[120px] rounded-full overflow-hidden bg-[#18181b] ring-2 ring-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4)] group-hover:ring-white/30 transition-all">
                      <img
                        src={artist.thumbnails?.[0]?.url || ''}
                        alt={artist.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Play className="h-6 w-6 text-white fill-current" />
                      </div>
                    </div>
                    <p className="mt-2.5 text-[12.5px] sm:text-[13.5px] font-bold text-white group-hover:text-purple-300 truncate w-full transition-colors">
                      {artist.name}
                    </p>
                    <p className="text-[11px] text-[#8e8e93] font-medium">{artist.role || 'Artist'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* 9. PERSONALIZED RADIO BANNER */}
          {/* ======================================================= */}
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-r from-purple-900/40 via-indigo-900/30 to-black/80 p-6 sm:p-8 backdrop-blur-xl shadow-[0_16px_40px_rgba(79,70,229,0.15)]">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
              <div className="flex items-center gap-4 text-center sm:text-left">
                <div className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-[0_8px_24px_rgba(99,102,241,0.4)] shrink-0">
                  <Radio className="h-7 w-7 sm:h-8 sm:w-8 animate-pulse" />
                </div>
                <div>
                  <span className="rounded-full bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-0.5 text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                    Wave Radio
                  </span>
                  <h3 className="text-[20px] sm:text-[24px] font-black text-white tracking-tight leading-tight mt-1">
                    Your Personalized Radio
                  </h3>
                  <p className="text-xs sm:text-[13.5px] text-white/60 mt-0.5">
                    Endless stream blending YouTube Music intelligence with your unique listening taste.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleStartPersonalizedRadio()}
                disabled={startingRadio}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-xs sm:text-[13.5px] font-bold text-black hover:bg-white/90 active:scale-95 transition-all shadow-lg shrink-0"
              >
                <Play className="h-4 w-4 fill-current ml-0.5" />
                <span>{startingRadio ? 'Starting Radio…' : 'Start Radio'}</span>
              </button>
            </div>
          </div>

          {/* ======================================================= */}
          {/* 10. CURATED PLAYLISTS */}
          {/* ======================================================= */}
          {topPlaylists.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Curated Playlists"
                subtitle="Top editorial mixes and chart collections"
                icon={<ListMusic className="h-3.5 w-3.5 text-amber-400" />}
                onAction={() => onNavigate?.('playlists')}
              />
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4">
                {topPlaylists.slice(0, 6).map((pl) => (
                  <div
                    key={pl.playlistId}
                    onClick={() => onNavigate?.('playlist', pl.playlistId)}
                    className="group relative cursor-pointer rounded-[22px] border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.07] hover:border-white/20 transition-all shadow-sm"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-[16px] bg-[#141416] ring-1 ring-white/10">
                      <img
                        src={pl.thumbnails?.[0]?.url || ''}
                        alt={pl.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg">
                          <Play className="h-5 w-5 fill-current ml-0.5" />
                        </span>
                      </div>
                    </div>
                    <div className="mt-2.5 min-w-0">
                      <p className="truncate text-[13.5px] font-bold text-white group-hover:text-amber-300 transition-colors">
                        {pl.name}
                      </p>
                      <p className="truncate text-xs text-[#8e8e93] mt-0.5">
                        {pl.author || 'Curated Editorial'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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
          if (menuTrack) handlePlaySong(menuTrack, [menuTrack]);
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
    </div>
  );
};
