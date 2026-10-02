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
  History,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Track, Album, Playlist, SearchArtist } from '../types';
import { playerStore } from '../services/playerStore';
import { playerEngine, requestResumePosition, usePlayerEngine } from '../services/playerEngine';
import { fetchRadio, fetchSimilar } from '../services/recommendationApi';
import { startRadioAndPlay } from '../services/radioEngine';
import {
  usePersonalizedHome,
  type PersonalizedMix,
  type BecauseSection,
  type ContinueItem,
} from '../hooks/usePersonalizedHome';
import { TrackRail, RailSkeleton, GridSkeleton, formatResumeLabel } from '../components/HomeShelf';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { SongContextMenu } from '../components/SongContextMenu';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { ArtworkImage } from '../components/ArtworkImage';
import { SectionHeader } from '../components/ui/SectionHeader';

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
  <SectionHeader
    title={title}
    subtitle={subtitle}
    icon={icon}
    actionLabel={actionText || (onAction ? 'See all' : undefined)}
    onAction={onAction}
    action2Label={action2Text}
    onAction2={onAction2}
    action2Icon={<Radio className="h-3 w-3" />}
  />
);

export const HomePage: React.FC<{
  onPlay: (t: Track, list?: Track[]) => void;
  onPlayPlaylist?: (id: string) => void;
  onNavigate?: (page: string, param?: string) => void;
  history: Track[];
}> = ({ onPlay, onNavigate, history }) => {
  const { user } = useGoogleAccount();
  const { greeting, caption } = useMemo(() => getDynamicGreeting(user?.name), [user?.name]);
  const reduceMotion = useReducedMotion();

  // Personalized Home data layer (cached, per-section failure isolation).
  const { data, status, loading, refreshing, refresh } = usePersonalizedHome();
  const [startingRadio, setStartingRadio] = useState(false);

  const quickPicks = data?.quickPicks ?? [];
  const madeForYou = data?.madeForYou ?? [];
  const continueListening = data?.continueListening ?? [];
  const becauseSections = data?.becauseSections ?? [];
  const personalizedMixes = data?.mixes ?? [];
  const discoverTracks = data?.discover ?? [];
  const basedOnLibrary = data?.basedOnLibrary ?? { tracks: [], explanation: '' };
  const trendingForYou = data?.trendingForYou ?? { tracks: [], label: 'Popular Now' };
  const recentHistory = data?.recentHistory ?? [];
  const recommendedAlbums = data?.albums ?? [];
  const recommendedArtists = data?.artists ?? [];
  const topPlaylists = data?.playlists ?? [];
  const coldStart = data?.coldStart ?? false;

  // Player Store & Engine States
  const { isPlaying } = usePlayerEngine();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => playerStore.current());
  const [favs, setFavs] = useState<Track[]>(() => playerStore.favsList());

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

  // Start Radio Action (smart session radio: personalized or track-seeded)
  const handleStartPersonalizedRadio = async (seed?: Track | null) => {
    if (startingRadio) return;
    setStartingRadio(true);
    try {
      if (seed) {
        setToastMessage(`Starting Radio for "${seed.title}"...`);
        await startRadioAndPlay('track', { track: seed });
      } else {
        const targetSeed = quickPicks[0] || madeForYou[0] || history[0] || FALLBACK_HITS[0];
        setToastMessage('Starting Your Radio...');
        await startRadioAndPlay('personalized', { track: targetSeed });
      }
    } catch {
      const targetSeed = seed || quickPicks[0] || FALLBACK_HITS[0];
      if (targetSeed) onPlay(targetSeed, [targetSeed]);
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

  // Resume a partially-heard track near its previous position (engine
  // honors it through the existing pendingSeek path; falls back to normal
  // start when unavailable).
  const handleResumeTrack = (item: ContinueItem, list: Track[]) => {
    requestResumePosition(item.track.id, item.positionSeconds);
    onPlay(item.track, list);
    setToastMessage(`Resuming "${item.track.title}"`);
  };

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
              onClick={() => void refresh(true)}
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

      {/* Sections render progressively with per-section skeletons (shell first). */}
      {/* Failed sections hide individually — a banner offers one-tap retry. */}
      {Object.values(status).some((s) => s === 'error') && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-2.5" role="alert">
          <p className="text-xs font-medium text-amber-200/90">
            Some sections couldn&apos;t load. Your music and playback are unaffected.
          </p>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-white/90 disabled:opacity-40"
          >
            {refreshing ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
      <>
          {/* ======================================================= */}
          {/* 1. QUICK PICKS (PROMINENT COMPACT GRID) */}
          {/* ======================================================= */}
          {status.quickPicks === 'loading' && quickPicks.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-36 bg-white/10 rounded-full animate-pulse" />
              <GridSkeleton cards={8} />
            </div>
          ) : (
            quickPicks.length > 0 && (
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
                      whileHover={reduceMotion ? undefined : { scale: 1.01 }}
                      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                      onClick={() => handlePlaySong(track, quickPicks)}
                      className={`group relative flex items-center gap-3 p-2.5 rounded-[18px] border transition-all cursor-pointer select-none backdrop-blur-md ${
                        isActive
                          ? 'bg-white/[0.12] border-white/25 shadow-[0_4px_20px_rgba(255,255,255,0.08)]'
                          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.08] hover:border-white/15'
                      }`}
                    >
                      {/* Thumbnail with overlay play */}
                      <div className="relative h-12 w-12 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-[14px] bg-[#1a1a1c] ring-1 ring-white/10 shadow-sm">
                        <ArtworkImage
                          src={track.thumbnail}
                          alt={track.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          referrerPolicy="no-referrer"
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
                              : 'text-white/40 hover:text-white opacity-0 group-hover:opacity-100 max-sm:opacity-100'
                          }`}
                          aria-label="Like song"
                        >
                          <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleOpenContextMenu(track, e)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 max-sm:opacity-100 transition-all"
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
            )
          )}

          {/* ======================================================= */}
          {/* 2. MADE FOR YOU (PERSONALIZED SELECTION) */}
          {/* ======================================================= */}
          {status.madeForYou === 'loading' && madeForYou.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
              <RailSkeleton />
            </div>
          ) : (
            madeForYou.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title={coldStart ? 'Recommended To Get Started' : 'Made For You'}
                subtitle={
                  coldStart
                    ? 'Popular tracks to begin exploring'
                    : 'Deep recommendations tuned to your taste profile'
                }
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
                        <ArtworkImage
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
            )
          )}

          {/* ======================================================= */}
          {/* 3. CONTINUE LISTENING (RESUME UNFINISHED TRACKS) */}
          {/* ======================================================= */}
          {continueListening.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Continue Listening"
                subtitle="Pick up where you left off"
                icon={<History className="h-3.5 w-3.5 text-sky-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(continueListening.map((c) => c.track))}
              />
              <TrackRail
                items={continueListening.map((c) => ({
                  track: c.track,
                  context: continueListening.map((x) => x.track),
                  badge: 'Resume',
                  progressFraction: c.completionFraction,
                  resumeLabel: formatResumeLabel(c.positionSeconds),
                }))}
                currentTrackId={currentTrack?.id}
                onPlay={(t, list) => {
                  const item = continueListening.find((c) => c.track.id === t.id);
                  if (item) handleResumeTrack(item, list);
                  else handlePlaySong(t, list);
                }}
                onOpenMenu={handleOpenContextMenu}
              />
            </div>
          )}

          {/* ======================================================= */}
          {/* 5. YOUR MIX (PERSONALIZED MIX CARDS) */}
          {/* ======================================================= */}
          {status.mixes === 'loading' && personalizedMixes.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
              <RailSkeleton />
            </div>
          ) : (
            personalizedMixes.length > 0 && (
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
                    whileHover={reduceMotion ? undefined : { y: -4 }}
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
            )
          )}

          {/* ======================================================= */}
          {/* 9. RECENTLY PLAYED (UNIFIED WAVE + YT MUSIC HISTORY) */}
          {/* ======================================================= */}
          {status.recent === 'loading' && recentHistory.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
              <RailSkeleton />
            </div>
          ) : (
            recentHistory.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Recently Played"
                subtitle="Pick up right where you left off"
                icon={<Clock3 className="h-3.5 w-3.5 text-cyan-400" />}
                actionText="See all"
                onAction={() => onNavigate?.('history')}
              />
              <TrackRail
                items={recentHistory.map((track) => ({ track, context: recentHistory, badge: 'Recent' }))}
                currentTrackId={currentTrack?.id}
                onPlay={handlePlaySong}
                onOpenMenu={handleOpenContextMenu}
              />
            </div>
            )
          )}

          {/* ======================================================= */}
          {/* 4. BECAUSE YOU LISTEN TO [ARTIST] (DYNAMIC SECTIONS) */}
          {/* ======================================================= */}
          {becauseSections.map((section) => (
            <div key={`because-${section.artist}`} className="space-y-3.5">
              <RailHeader
                title={`Because you listen to ${section.artist}`}
                subtitle={section.reason || `Similar tracks & top hits from ${section.artist}`}
                icon={<Heart className="h-3.5 w-3.5 text-rose-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(section.tracks)}
                action2Text="Radio"
                onAction2={() => handleStartPersonalizedRadio(section.seedTrack)}
              />
              <TrackRail
                items={section.tracks.map((track) => ({ track, context: section.tracks }))}
                currentTrackId={currentTrack?.id}
                onPlay={handlePlaySong}
                onOpenMenu={handleOpenContextMenu}
              />
            </div>
          ))}

          {/* ======================================================= */}
          {/* 6. DISCOVER SOMETHING NEW (FRESH ARTISTS & GENRES) */}
          {/* ======================================================= */}
          {status.discover === 'loading' && discoverTracks.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
              <RailSkeleton />
            </div>
          ) : (
            discoverTracks.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title={coldStart ? 'Explore Music' : 'Discover Something New'}
                subtitle={
                  coldStart
                    ? 'Fresh tracks across genres to start exploring'
                    : 'Fresh tracks and related artists beyond your usual rotation'
                }
                icon={<Compass className="h-3.5 w-3.5 text-emerald-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(discoverTracks)}
              />
              <TrackRail
                items={discoverTracks.map((track) => ({ track, context: discoverTracks, badge: 'New' }))}
                currentTrackId={currentTrack?.id}
                onPlay={handlePlaySong}
                onOpenMenu={handleOpenContextMenu}
              />
            </div>
            )
          )}

          {/* ======================================================= */}
          {/* 7. BASED ON YOUR LIBRARY (YT MUSIC + WAVE SIGNALS) */}
          {/* ======================================================= */}
          {basedOnLibrary.tracks.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title="Based On Your Library"
                subtitle={basedOnLibrary.explanation || 'Inspired by artists you saved'}
                icon={<Layers className="h-3.5 w-3.5 text-violet-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(basedOnLibrary.tracks)}
                action2Text="Radio"
                onAction2={() => handleStartPersonalizedRadio(basedOnLibrary.tracks[0])}
              />
              <TrackRail
                items={basedOnLibrary.tracks.map((track) => ({ track, context: basedOnLibrary.tracks }))}
                currentTrackId={currentTrack?.id}
                onPlay={handlePlaySong}
                onOpenMenu={handleOpenContextMenu}
              />
            </div>
          )}

          {/* ======================================================= */}
          {/* 8. TRENDING FOR YOU (TASTE-FILTERED POPULARITY) */}
          {/* ======================================================= */}
          {trendingForYou.tracks.length > 0 && (
            <div className="space-y-3.5">
              <RailHeader
                title={trendingForYou.label}
                subtitle={
                  coldStart
                    ? 'What everyone is listening to right now'
                    : 'Popular tracks filtered through your taste'
                }
                icon={<TrendingUp className="h-3.5 w-3.5 text-orange-400" />}
                actionText="Play All"
                onAction={() => handlePlayAll(trendingForYou.tracks)}
              />
              <TrackRail
                items={trendingForYou.tracks.map((track) => ({ track, context: trendingForYou.tracks }))}
                currentTrackId={currentTrack?.id}
                onPlay={handlePlaySong}
                onOpenMenu={handleOpenContextMenu}
              />
            </div>
          )}

          {/* ======================================================= */}
          {/* 10. RECOMMENDED ALBUMS */}
          {/* ======================================================= */}
          {status.albums === 'loading' && recommendedAlbums.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
              <RailSkeleton />
            </div>
          ) : (
            recommendedAlbums.length > 0 && (
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
                      <ArtworkImage
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
            )
          )}

          {/* ======================================================= */}
          {/* 11. RECOMMENDED ARTISTS (CIRCULAR AVATARS) */}
          {/* ======================================================= */}
          {status.artists === 'loading' && recommendedArtists.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
              <RailSkeleton />
            </div>
          ) : (
            recommendedArtists.length > 0 && (
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
                      <ArtworkImage
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
            )
          )}

          {/* ======================================================= */}
          {/* 12. PERSONALIZED RADIO BANNER */}
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
          {/* 13. CURATED PLAYLISTS */}
          {/* ======================================================= */}
          {status.playlists === 'loading' && topPlaylists.length === 0 ? (
            <div className="space-y-3.5">
              <div className="h-6 w-44 bg-white/10 rounded-full animate-pulse" />
              <RailSkeleton />
            </div>
          ) : (
            topPlaylists.length > 0 && (
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
                      <ArtworkImage
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
            )
          )}
        </>

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

