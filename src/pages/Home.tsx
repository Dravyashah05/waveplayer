import React, { useState, useEffect } from 'react';
import {
  Play,
  Heart,
  Flame,
  Disc3,
  ListMusic,
  Mic2,
  ChevronRight,
  Shuffle,
  Clock3,
  Download,
  Sparkles,
  Loader2,
  TrendingUp,
  Radio,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Track, Album, Playlist, SearchArtist } from '../types';
import { playerStore } from '../services/playerStore';
import { getSaavnBrowseModules, searchSaavnArtists } from '../services/saavnApi';
import { recommendTracks, getSimilarTracks, getDiscoverTracks } from '../services/recommendationEngine';
import { fetchQuickPicks, fetchRadio } from '../services/recommendationApi';
import { getProfile } from '../services/userProfile';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
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
  <div className="flex items-end justify-between gap-4">
    <div className="min-w-0">
      <h2 className="flex items-center gap-2 text-[16px] sm:text-[18px] font-bold tracking-[-0.02em] text-white">
        {icon && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-white">
            {icon}
          </span>
        )}
        {title}
      </h2>
      {subtitle && <p className="mt-0.5 text-[12.5px] font-medium text-[#8e8e93]">{subtitle}</p>}
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
}> = ({ onPlay, onPlayPlaylist, onNavigate, history }) => {
  const greeting = getGreeting();
  const [trending, setTrending] = useState<Track[]>([]);
  const [topPlaylists, setTopPlaylists] = useState<Playlist[]>([]);
  const [newAlbums, setNewAlbums] = useState<Album[]>([]);
  const [charts, setCharts] = useState<Playlist[]>([]);
  const [topArtists, setTopArtists] = useState<SearchArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFav, setIsFav] = useState(false);
  const [recommended, setRecommended] = useState<Track[]>([]);
  const [recommendedSeed, setRecommendedSeed] = useState<Track | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [becauseTracks, setBecauseTracks] = useState<Track[]>([]);
  const [becauseSeed, setBecauseSeed] = useState<Track | null>(null);
  const [discoverTracks, setDiscoverTracks] = useState<Track[]>([]);
  const [trendingForYou, setTrendingForYou] = useState<Track[]>([]);
  const [youMayLike, setYouMayLike] = useState<Track[]>([]);
  const [quickPicks, setQuickPicks] = useState<Track[]>([]);
  const [startingRadio, setStartingRadio] = useState(false);

  const startRadio = async (seed: Track | null) => {
    if (!seed || startingRadio) return;
    setStartingRadio(true);
    try {
      const tracks = await fetchRadio(seed, 20);
      if (tracks.length) onPlay(tracks[0], tracks);
    } finally {
      setStartingRadio(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadHomeData() {
      setLoading(true);
      try {
        const profile = getProfile();
        const favArtist = profile.favoriteArtist
          || playerStore.historyList()[0]?.author?.split(',')[0]?.trim()
          || playerStore.favsList()[0]?.author?.split(',')[0]?.trim()
          || '';
        const [browseRes, artistRes] = await Promise.all([
          getSaavnBrowseModules().catch(() => ({
            trending: [],
            topPlaylists: [],
            newAlbums: [],
            charts: [],
          })),
          favArtist ? searchSaavnArtists(favArtist).catch(() => ({ total: 0, artists: [] })) : Promise.resolve({ total: 0, artists: [] }),
        ]);

        if (cancelled) return;

        if (browseRes.trending?.length) setTrending(browseRes.trending);
        if (browseRes.topPlaylists?.length) setTopPlaylists(browseRes.topPlaylists);
        if (browseRes.newAlbums?.length) setNewAlbums(browseRes.newAlbums);
        if (browseRes.charts?.length) setCharts(browseRes.charts);
        if (artistRes.artists?.length) setTopArtists(artistRes.artists.slice(0, 12));
      } catch (e) {
        console.warn('[HomePage] load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHomeData();
    return () => {
      cancelled = true;
    };
  }, []);

  // Personalized recommendations — hybrid engine (spec sections)
  useEffect(() => {
    let cancelled = false;
    async function loadRecommendations() {
      const hist = playerStore.historyList();
      const favs = playerStore.favsList();
      // Multi-seed blend: last plays weigh most, so one outlier can't hijack the mix
      const seedPool = [hist[0] || favs[0] || trending[0] || history[0], hist[1] || favs[1], hist[2] || favs[2]]
        .filter((t, i, a): t is Track => !!t && !!t.id && a.findIndex((x) => x && x.id === t.id) === i)
        .slice(0, 3);
      const seed = seedPool[0] || null;
      const profile = getProfile();
      // Cold start still receives a trending/discovery mix from the engine.
      setRecommendedSeed(seed);
      setRecLoading(true);
      try {
        // Quick Picks — server endpoint (YouTube Music relations + taste),
        // falling back to the on-device engine when offline/unreachable.
        const qp = await fetchQuickPicks(10).catch(() => null);
        if (!cancelled) {
          if (qp && qp.length) setQuickPicks(qp);
          else {
            const fallback = await recommendTracks({ seedTrack: seed, limit: 10, weights: { taste: 0.4, similarity: 0.2, collaborative: 0.15, popularity: 0.15, discovery: 0.1 } }).catch(() => [] as Track[]);
            setQuickPicks(fallback as Track[]);
          }
        }
        // Made For You — full hybrid (taste 35%, similarity 25%, collab 20%, pop 10%, discovery 10%)
        const madeForYou = await recommendTracks({ seedTracks: seedPool, limit: 12 }).catch(() => []);
        if (cancelled) return;
        setRecommended(madeForYou as Track[]);

        // Because You Listened To — second recent seed
        const secondSeed = hist[1] || favs[1] || trending[1] || null;
        if (secondSeed && secondSeed.id !== seed.id) {
          setBecauseSeed(secondSeed);
          const sim = await getSimilarTracks(secondSeed.id, 10).catch(() => [] as Track[]);
          if (!cancelled) setBecauseTracks(sim as Track[]);
        } else {
          setBecauseTracks([]); setBecauseSeed(null);
        }

        // You May Also Like — taste-heavy, no seed
        const tasteHeavy = await recommendTracks({ seedTrack: null, limit: 10, weights: { taste: 0.55, similarity: 0.1, collaborative: 0.15, popularity: 0.1, discovery: 0.1 } }).catch(() => [] as any);
        if (!cancelled) setYouMayLike(tasteHeavy as Track[]);

        // Discover — discovery-heavy
        const disc = await getDiscoverTracks(profile, new Set([seed.id, ...hist.slice(0, 5).map(t => t.id)]), 10).catch(() => [] as Track[]);
        if (!cancelled) setDiscoverTracks(disc as Track[]);

        // Trending For You — trending scored by profile
        const trendingScored = await recommendTracks({ seedTrack: null, limit: 10, weights: { taste: 0.25, similarity: 0, collaborative: 0.15, popularity: 0.45, discovery: 0.15 } }).catch(() => [] as any);
        if (!cancelled) setTrendingForYou(trendingScored.slice(0, 8) as Track[]);
      } catch (e) {
        console.warn('[Home] recommendations error', e);
      } finally {
        if (!cancelled) setRecLoading(false);
      }
    }
    if (!loading) loadRecommendations();
    const onProfile = () => { if (!loading) loadRecommendations(); };
    window.addEventListener('wave:profile' as any, onProfile);
    window.addEventListener('wave:listening' as any, onProfile);
    return () => { cancelled = true; window.removeEventListener('wave:profile' as any, onProfile); window.removeEventListener('wave:listening' as any, onProfile); };
  }, [loading, trending.length, history.length]);

  const songPool = trending.length > 0 ? trending : history.length > 0 ? history : FALLBACK_HITS;
  const featured = songPool[0];

  useEffect(() => {
    if (featured) {
      setIsFav(playerStore.isFav(featured.id));
    }
  }, [featured?.id]);

  const toggleFeaturedFav = () => {
    if (!featured) return;
    playerStore.toggleFav(featured);
    const fav = playerStore.isFav(featured.id);
    setIsFav(fav);
  };

  const handleDownloadTrack = (t: Track) => {
    const url = t.downloadUrl || t.streamUrl;
    if (!url) {
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.title} - ${t.author}.mp3`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-7 sm:space-y-9">
      {/* Top Greeting & Quick Actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] sm:text-[28px] font-black tracking-[-0.03em] leading-none text-white">
            {greeting},
          </h1>
          <p className="text-[13px] font-semibold text-[#8e8e93] mt-1">
            Discover Music made for you
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (songPool.length) onPlay(songPool[0], songPool);
            }}
            className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-bold text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.4)] active:scale-95 transition-all"
          >
            <Play className="h-3.5 w-3.5 fill-current" /> Play All
          </button>
          <button
            type="button"
            onClick={() => {
              const shuffled = [...songPool].sort(() => Math.random() - 0.5);
              if (shuffled.length) {
                playerStore.setQueue(shuffled, 0);
                if (!playerStore.shuffle) playerStore.toggleShuffle();
              }
            }}
            className="hidden sm:flex h-9 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.08] px-3.5 text-[13px] font-semibold text-white transition-all"
          >
            <Shuffle className="h-3.5 w-3.5" /> Shuffle
          </button>
        </div>
      </div>

      {/* Featured Spotlight Banner */}
      {featured && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-[26px] sm:rounded-[30px] lg-hero"
        >
          {/* Ambient Backdrop */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={featured.thumbnail}
              alt=""
              className="h-full w-full object-cover scale-125 blur-[48px] opacity-40 saturate-[1.2]"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/40" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          </div>

          <div className="relative flex flex-col sm:flex-row items-center sm:items-stretch gap-5 sm:gap-7 p-5 sm:p-7 lg:p-8">
            {/* Artwork */}
            <div className="relative shrink-0 group/cover">
              <div className="h-[180px] w-[180px] sm:h-[200px] sm:w-[200px] lg:h-[220px] lg:w-[220px] rounded-[20px] overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/15 bg-[#18181b]">
                <img
                  src={featured.thumbnail}
                  alt={featured.title}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover/cover:scale-105"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            {/* Content Details */}
            <div className="flex flex-1 flex-col justify-center min-w-0 text-center sm:text-left">
              <div className="inline-flex items-center justify-center sm:justify-start gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/70">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-black">
                  <Flame className="h-3 w-3 fill-current" />
                </span>
                Trending Now
              </div>

              <h2 className="mt-2 text-[22px] sm:text-[26px] lg:text-[30px] font-black leading-tight tracking-[-0.03em] text-white line-clamp-2">
                {featured.title}
              </h2>
              <p className="mt-1 text-[14px] sm:text-[15px] font-medium text-white/80">
                {featured.author}
              </p>

              <div className="mt-2 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[12px] text-white/60">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                  <Disc3 className="h-3 w-3" /> {featured.albumName || 'Single'}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                  <Clock3 className="h-3 w-3" /> {featured.duration || '3:30'}
                </span>

              </div>

              {/* Action Buttons */}
              <div className="mt-5 flex items-center justify-center sm:justify-start gap-3">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => onPlay(featured, songPool)}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 sm:py-3 text-[13.5px] font-bold text-black hover:bg-[#f4f4f5] shadow-[0_6px_16px_rgba(0,0,0,0.4)] transition-all"
                >
                  <Play className="h-4 w-4 fill-current" /> Play
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={toggleFeaturedFav}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 sm:py-3 text-[13.5px] font-semibold transition-all ${
                    isFav
                      ? 'text-black bg-white border border-white shadow-[0_4px_16px_rgba(255,255,255,0.2)]'
                      : 'text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.08]'
                  }`}
                >
                  <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
                  <span>{isFav ? 'Favorited' : 'Like'}</span>
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => handleDownloadTrack(featured)}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 sm:py-3 text-[13.5px] font-semibold text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.08] transition-all"
                  title="Download MP3"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Download</span>
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Continue listening — from history */}
      {history.length > 0 && trending.length > 0 && history.slice(0, 8).some(h => !trending.find(t => t.id === h.id)) && (
        <div className="space-y-3.5">
          <RailHeader title="Continue listening" subtitle="Pick up where you left off" icon={<Clock3 className="h-3.5 w-3.5 text-white" />} />
          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
            {history.slice(0, 10).map((t) => (
              <div key={`hist-${t.id}`} onClick={() => onPlay(t, history)} className="snap-start group cursor-pointer min-w-[140px] w-[140px] sm:min-w-[155px] sm:w-[155px] shrink-0">
                <div className="relative aspect-square overflow-hidden rounded-[18px] bg-[#18181b] ring-1 ring-white/[0.08]">
                  <img src={t.thumbnail} alt={t.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="h-9 w-9 rounded-full bg-white text-black flex items-center justify-center shadow"><Play className="h-4 w-4 fill-current ml-0.5" /></div>
                  </div>
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-white text-black px-2 py-0.5 text-[10px] font-bold">Recent</span>
                </div>
                <p className="truncate text-[13px] font-bold text-white mt-2 leading-tight">{t.title}</p>
                <p className="truncate text-[11.5px] text-[#8e8e93]">{t.author}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Picks — YouTube Music relations + taste, one-tap play */}
      {quickPicks.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader
            title="Quick Picks"
            subtitle="Jump back in"
            icon={<Flame className="h-3.5 w-3.5 text-orange-400" />}
            actionText="Play all"
            onAction={() => quickPicks.length && onPlay(quickPicks[0], quickPicks)}
            action2Text={startingRadio ? 'Starting…' : 'Radio'}
            onAction2={() => void startRadio(quickPicks[0] || recommendedSeed)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {quickPicks.slice(0, 8).map((t) => (
              <button
                key={`qp-${t.id}`}
                onClick={() => onPlay(t, quickPicks)}
                className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.05] transition-colors"
              >
                <img src={t.thumbnail} alt={t.title} loading="lazy" className="h-12 w-12 rounded-lg object-cover bg-[#18181b] ring-1 ring-white/[0.08]" referrerPolicy="no-referrer" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-white leading-tight">{t.title}</span>
                  <span className="block truncate text-[11.5px] font-medium text-[#8e8e93] mt-0.5">{t.author}</span>
                </span>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/70 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Personalized — Made for you */}
      {recommended.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader
            title={recommendedSeed ? `Because you played "${recommendedSeed.title.slice(0, 22)}${recommendedSeed.title.length > 22 ? '…' : ''}"` : 'Made for you'}
            subtitle={recommendedSeed ? `More like ${recommendedSeed.author?.split(',')[0] || 'your taste'} • ${recommendedSeed.language || 'picked for you'}` : 'Picked for you'}
            icon={<Sparkles className="h-3.5 w-3.5 text-amber-400" />}
            actionText={recLoading ? 'Updating…' : 'Play mix'}
            onAction={() => recommended.length && onPlay(recommended[0], recommended)}
            action2Text={startingRadio ? 'Starting…' : 'Radio'}
            onAction2={() => void startRadio(recommendedSeed)}
          />
          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
            {recommended.map((t) => (
              <div
                key={`rec-${t.id}`}
                onClick={() => onPlay(t, recommended)}
                className="snap-start group cursor-pointer min-w-[155px] w-[155px] sm:min-w-[175px] sm:w-[175px] shrink-0"
              >
                <div className="relative aspect-square overflow-hidden rounded-[18px] sm:rounded-[20px] bg-[#18181b] shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08]">
                  <img src={t.thumbnail} alt={t.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" referrerPolicy="no-referrer" />
                  <div className="absolute top-2 left-2 rounded-full bg-black/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-white border border-white/10 hidden group-hover:inline-flex">
                    <Sparkles className="h-3 w-3 mr-1" /> For you
                  </div>
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="h-11 w-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>
                <div className="pt-2.5 px-0.5">
                  <p className="truncate text-[13px] sm:text-[13.5px] font-bold text-white leading-tight group-hover:text-amber-300 transition-colors">{t.title}</p>
                  <p className="truncate text-[11.5px] sm:text-[12px] font-medium text-[#8e8e93] mt-0.5">{t.author}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Because You Listened To */}
      {becauseTracks.length > 0 && becauseSeed && (
        <div className="space-y-3.5">
          <RailHeader title={`Because you listened to ${becauseSeed.title.slice(0, 20)}`} subtitle={`More ${becauseSeed.author?.split(',')[0] || ''} • Similar songs`} icon={<Heart className="h-3.5 w-3.5 text-rose-400" />} actionText="Play" onAction={() => onPlay(becauseTracks[0], becauseTracks)} action2Text={startingRadio ? 'Starting…' : 'Radio'} onAction2={() => void startRadio(becauseSeed)} />
          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x">
            {becauseTracks.map(t => (
              <div key={`because-${t.id}`} onClick={() => onPlay(t, becauseTracks)} className="snap-start group cursor-pointer min-w-[155px] w-[155px] sm:min-w-[165px] sm:w-[165px] shrink-0">
                <div className="relative aspect-square overflow-hidden rounded-[18px] bg-[#18181b] ring-1 ring-white/[0.08]">
                  <img src={t.thumbnail} alt={t.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><div className="h-10 w-10 rounded-full bg-white text-black grid place-items-center shadow"><Play className="h-4 w-4 fill-current ml-0.5" /></div></div>
                </div>
                <p className="truncate text-[13px] font-bold text-white mt-2">{t.title}</p>
                <p className="truncate text-[11.5px] text-[#8e8e93]">{t.author}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* You May Also Like — taste based */}
      {youMayLike.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader title="You may also like" subtitle="Based on your taste" icon={<Sparkles className="h-3.5 w-3.5 text-cyan-400" />} />
          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x">
            {youMayLike.map(t => (
              <div key={`like-${t.id}`} onClick={() => onPlay(t, youMayLike)} className="snap-start group cursor-pointer min-w-[155px] w-[155px] shrink-0">
                <div className="relative aspect-square overflow-hidden rounded-[18px] bg-[#18181b] ring-1 ring-white/[0.08]">
                  <img src={t.thumbnail} alt={t.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><div className="h-10 w-10 rounded-full bg-white text-black grid place-items-center shadow"><Play className="h-4 w-4 fill-current ml-0.5" /></div></div>
                </div>
                <p className="truncate text-[13px] font-bold text-white mt-2">{t.title}</p>
                <p className="truncate text-[11.5px] text-[#8e8e93]">{t.author}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discover — new for you */}
      {discoverTracks.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader title="Discover" subtitle="New artists & songs for you" icon={<Mic2 className="h-3.5 w-3.5 text-emerald-400" />} />
          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x">
            {discoverTracks.map(t => (
              <div key={`disc-${t.id}`} onClick={() => onPlay(t, discoverTracks)} className="snap-start group cursor-pointer min-w-[155px] w-[155px] shrink-0">
                <div className="relative aspect-square overflow-hidden rounded-[18px] bg-[#18181b] ring-1 ring-white/[0.08]">
                  <img src={t.thumbnail} alt={t.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                  <span className="absolute top-2 left-2 rounded-full bg-emerald-500 text-white px-2 py-0.5 text-[10px] font-bold">New</span>
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><div className="h-10 w-10 rounded-full bg-white text-black grid place-items-center shadow"><Play className="h-4 w-4 fill-current ml-0.5" /></div></div>
                </div>
                <p className="truncate text-[13px] font-bold text-white mt-2">{t.title}</p>
                <p className="truncate text-[11.5px] text-[#8e8e93]">{t.author}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trending For You — personalized popularity */}
      {trendingForYou.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader title="Trending for you" subtitle="Popular filtered by your taste" icon={<Flame className="h-3.5 w-3.5 text-orange-400" />} actionText="Play" onAction={() => onPlay(trendingForYou[0], trendingForYou)} />
          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x">
            {trendingForYou.map(t => (
              <div key={`t4u-${t.id}`} onClick={() => onPlay(t, trendingForYou)} className="snap-start group cursor-pointer min-w-[155px] w-[155px] shrink-0">
                <div className="relative aspect-square overflow-hidden rounded-[18px] bg-[#18181b] ring-1 ring-white/[0.08]">
                  <img src={t.thumbnail} alt={t.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><div className="h-10 w-10 rounded-full bg-white text-black grid place-items-center shadow"><Play className="h-4 w-4 fill-current ml-0.5" /></div></div>
                </div>
                <p className="truncate text-[13px] font-bold text-white mt-2">{t.title}</p>
                <p className="truncate text-[11.5px] text-[#8e8e93]">{t.author}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trending Now / Quick Picks Horizontal Carousel */}
      <div className="space-y-3.5">
        <RailHeader
          title="Trending Hits"
          subtitle="Top releases"
          icon={<TrendingUp className="h-3.5 w-3.5 text-purple-400" />}
        />
        {loading ? (
          <div className="flex h-44 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-white/50" />
          </div>
        ) : (
          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
            {songPool.map((t) => (
              <div
                key={t.id}
                onClick={() => onPlay(t, songPool)}
                className="snap-start group cursor-pointer min-w-[155px] w-[155px] sm:min-w-[175px] sm:w-[175px] shrink-0"
              >
                <div className="relative aspect-square overflow-hidden rounded-[18px] sm:rounded-[20px] bg-[#18181b] shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08]">
                  <img
                    src={t.thumbnail}
                    alt={t.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="h-11 w-11 rounded-full bg-white text-black flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>
                <div className="pt-2.5 px-0.5">
                  <p className="truncate text-[13px] sm:text-[13.5px] font-bold text-white leading-tight group-hover:text-purple-300 transition-colors">
                    {t.title}
                  </p>
                  <p className="truncate text-[11.5px] sm:text-[12px] font-medium text-[#8e8e93] mt-0.5">
                    {t.author}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Featured Playlists */}
      {topPlaylists.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader
            title="Curated Playlists"
            subtitle="Trending editorial mixes and chart collections"
            icon={<ListMusic className="h-3.5 w-3.5 text-amber-400" />}
            onAction={() => onNavigate?.('playlists')}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4">
            {topPlaylists.slice(0, 6).map((pl) => (
              <div
                key={pl.playlistId}
                onClick={() => onNavigate?.('playlist', pl.playlistId)}
                className="group relative cursor-pointer lg-card p-3"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#141416] ring-1 ring-white/10">
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
                <div className="mt-3 min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-white group-hover:text-amber-300 transition-colors">
                    {pl.name}
                  </p>
                  <p className="truncate text-[12px] text-[#86868b] mt-0.5">
                    {pl.author || 'JioSaavn Editorial'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Albums & Releases */}
      {newAlbums.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader
            title="New Albums & Releases"
            subtitle="Official album discographies"
            icon={<Disc3 className="h-3.5 w-3.5 text-cyan-400" />}
            onAction={() => onNavigate?.('albums')}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4">
            {newAlbums.slice(0, 6).map((album) => (
              <div
                key={album.albumId}
                onClick={() => onNavigate?.('album', album.albumId)}
                className="group relative cursor-pointer lg-card p-3"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#141416] ring-1 ring-white/10">
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
                </div>
                <div className="mt-3 min-w-0">
                  <p className="truncate text-[13.5px] font-bold text-white group-hover:text-cyan-300 transition-colors">
                    {album.name}
                  </p>
                  <p className="truncate text-[12px] text-[#86868b] mt-0.5">
                    {album.artist?.name || 'Various Artists'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Artists */}
      {topArtists.length > 0 && (
        <div className="space-y-3.5">
          <RailHeader
            title="Top Artists"
            subtitle="Verified singer profiles & popular voices"
            icon={<Mic2 className="h-3.5 w-3.5 text-purple-400" />}
            onAction={() => onNavigate?.('artists')}
          />
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {topArtists.map((artist) => (
              <div
                key={artist.artistId}
                onClick={() => onNavigate?.('artist', artist.artistId)}
                className="group flex flex-col items-center text-center cursor-pointer"
              >
                <div className="relative aspect-square w-full rounded-full overflow-hidden bg-[#18181b] ring-1 ring-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4)] group-hover:ring-white/30 transition-all">
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
                <p className="mt-2 text-[12.5px] sm:text-[13px] font-bold text-white group-hover:text-purple-300 truncate w-full transition-colors">
                  {artist.name}
                </p>
                <p className="text-[11px] text-[#8e8e93]">{artist.role || 'Artist'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
