import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Play,
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
} from 'lucide-react';
import { Track, Album, SearchArtist } from '../types';
import { getSaavnArtistDetails, searchSaavnArtists } from '../services/saavnApi';
import { playerStore } from '../services/playerStore';
import { ArtistBio } from '../components/ArtistBio';

interface ArtistPageProps {
  artistId?: string;
  onPlay: (t: Track, list?: Track[]) => void;
  onNavigate?: (page: string, param?: string) => void;
  onBack?: () => void;
}

export const ArtistPage: React.FC<ArtistPageProps> = ({ artistId, onPlay, onNavigate, onBack }) => {
  const [artist, setArtist] = useState<SearchArtist | null>(null);
  const [topSongs, setTopSongs] = useState<Track[]>([]);
  const [topAlbums, setTopAlbums] = useState<Album[]>([]);
  const [bio, setBio] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [featuredArtists, setFeaturedArtists] = useState<SearchArtist[]>([]);

  const currentPlayingId = playerStore.current()?.id;

  useEffect(() => {
    if (artistId) {
      loadArtist(artistId);
    } else {
      loadFeaturedArtists();
    }
  }, [artistId]);

  const loadArtist = async (id: string) => {
    setLoading(true);
    try {
      const res = await getSaavnArtistDetails(id);
      if (res && res.artist) {
        setArtist(res.artist);
        setTopSongs(res.topSongs || []);
        setTopAlbums(res.topAlbums || []);
        setBio(res.bio || '');
      } else {
      }
    } catch (err) {
      console.error('[ArtistPage] load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFeaturedArtists = async () => {
    setLoading(true);
    try {
      const res = await searchSaavnArtists('Arijit Singh');
      setFeaturedArtists(res.artists || []);
    } catch {
      setFeaturedArtists([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAll = () => {
    if (!topSongs.length) return;
    onPlay(topSongs[0], topSongs);
  };

  const handleShuffle = () => {
    if (!topSongs.length) return;
    const shuffled = [...topSongs].sort(() => Math.random() - 0.5);
    playerStore.setQueue(shuffled, 0);
    if (!playerStore.shuffle) playerStore.toggleShuffle();
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

  const handleShare = () => {
    if (navigator.share && artist) {
      navigator.share({
        title: artist.name,
        text: `Listen to ${artist.name} on Wave Music`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  // If no artist is selected, render Artist Discovery grid
  if (!artistId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#86868b] flex items-center gap-1.5">
              <Mic2 className="h-3 w-3 text-purple-400" /> Artists
            </p>
            <h1 className="mt-1 text-[26px] sm:text-[30px] font-extrabold tracking-[-0.03em] text-white">
              Popular Artists
            </h1>
            <p className="mt-1 text-[13px] text-[#86868b]">
              Top singers, producers, and composer profiles
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {featuredArtists.map((a) => (
              <motion.div
                key={a.artistId}
                whileHover={{ y: -4 }}
                onClick={() => onNavigate?.('artist', a.artistId)}
                className="group relative cursor-pointer lg-card p-4 text-center flex flex-col items-center"
              >
                <div className="relative aspect-square w-28 sm:w-32 overflow-hidden rounded-full bg-[#141416] ring-2 ring-white/10 shadow-lg">
                  <img
                    src={a.thumbnails?.[0]?.url || ''}
                    alt={a.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg">
                      <Play className="h-4 w-4 fill-current ml-0.5" />
                    </span>
                  </div>
                </div>
                <div className="mt-3 min-w-0 w-full">
                  <p className="truncate text-[14px] font-bold text-white group-hover:text-purple-300 transition-colors">
                    {a.name}
                  </p>
                  <p className="truncate text-[11.5px] text-[#86868b] mt-0.5">
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

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="h-9 w-9 animate-spin text-purple-400" />
        <p className="text-sm font-medium text-[#86868b]">Loading artist profile & discography...</p>
      </div>
    );
  }

  const avatarUrl = artist?.thumbnails?.[0]?.url || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-8 pb-8"
    >
      {/* Back button */}
      <button
        type="button"
        onClick={() => (onBack ? onBack() : window.history.back())}
        className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] px-3.5 py-1.5 text-xs font-semibold text-white/90 transition-all cursor-pointer active:scale-95 shadow-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      {/* Hero Artist Header Banner */}
      <div className="relative overflow-hidden rounded-[28px] sm:rounded-[32px] lg-hero p-6 sm:p-8 lg:p-10">
        {/* Ambient Backdrop */}
        {avatarUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover scale-150 blur-[54px] opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/50" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
          </div>
        )}

        <div className="relative flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8">
          {/* Avatar Art */}
          <div className="relative h-[170px] w-[170px] sm:h-[200px] sm:w-[200px] shrink-0 rounded-full overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] ring-2 ring-white/20 bg-[#161619]">
            <img
              src={avatarUrl}
              alt={artist?.name}
              className="h-full w-full object-cover"
            />
          </div>

          {/* Details */}
          <div className="flex flex-1 flex-col justify-end min-w-0 text-center sm:text-left">
            <div className="inline-flex items-center justify-center sm:justify-start gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-purple-400">
              <Mic2 className="h-3.5 w-3.5" /> Verified Artist
            </div>

            <h1 className="mt-2 text-[28px] sm:text-[36px] lg:text-[44px] font-black tracking-[-0.03em] leading-tight text-white line-clamp-2">
              {artist?.name}
            </h1>

            <p className="mt-1 text-[14px] sm:text-[15px] font-medium text-white/80">
              {artist?.role || 'Lead Artist / Singer'}
            </p>

            {/* Quick Actions */}
            <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <button
                type="button"
                onClick={handlePlayAll}
                className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-bold text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.4)] active:scale-95 transition-all"
              >
                <Play className="h-4 w-4 fill-current" /> Play Top Songs
              </button>
              <button
                type="button"
                onClick={handleShuffle}
                className="flex h-11 items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] px-5 text-[14px] font-semibold text-white transition-all active:scale-95"
              >
                <Shuffle className="h-4 w-4" /> Shuffle
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white transition-all"
                title="Share"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Top Songs Section */}
      <div className="space-y-4">
        <h2 className="text-[18px] sm:text-[20px] font-bold text-white tracking-[-0.02em] flex items-center gap-2">
          <Music2 className="h-5 w-5 text-purple-400" /> Popular Releases
        </h2>

        <div className="lg-panel">
          <div className="divide-y divide-white/[0.04]">
            {topSongs.map((t, idx) => {
              const isTrackActive = currentPlayingId === t.id;
              return (
                <div
                  key={t.id || idx}
                  onClick={() => onPlay(t, topSongs)}
                  className={`group flex items-center justify-between px-4 sm:px-6 py-3.5 hover:bg-white/[0.05] transition-all cursor-pointer ${
                    isTrackActive ? 'bg-white/[0.08]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
                    <span className="w-6 text-center text-xs font-mono text-[#86868b] group-hover:hidden">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="hidden group-hover:flex w-6 items-center justify-center">
                      <Play className="h-3.5 w-3.5 fill-white text-white" />
                    </span>

                    <div className="h-10 w-10 shrink-0 rounded-[10px] overflow-hidden bg-[#161618] ring-1 ring-white/10">
                      <img
                        src={t.thumbnail}
                        alt={t.title}
                        className="h-full w-full object-cover"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[14px] font-semibold ${isTrackActive ? 'text-purple-400 font-bold' : 'text-white'}`}>
                        {t.title}
                      </p>
                      <p className="truncate text-[12px] text-[#86868b]">
                        {t.albumName || t.author}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                    

                    <span className="text-[12px] font-mono text-[#86868b] w-12 text-right">
                      {t.duration || '3:30'}
                    </span>

                    <div className="flex items-center gap-1.5 w-16 justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadTrack(t);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] text-white/80 hover:text-white transition-all"
                        title="Download MP3"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Albums Section */}
      {topAlbums.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-[18px] sm:text-[20px] font-bold text-white tracking-[-0.02em] flex items-center gap-2">
            <Disc3 className="h-5 w-5 text-cyan-400" /> Discography & Albums
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {topAlbums.map((a) => (
              <motion.div
                key={a.albumId}
                whileHover={{ y: -4 }}
                onClick={() => onNavigate?.('album', a.albumId)}
                className="group relative cursor-pointer lg-card p-3"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-[14px] bg-[#141416] ring-1 ring-white/10">
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
                  <p className="truncate text-[12px] text-[#86868b] mt-0.5">
                    {a.year ? `${a.year} • ` : ''}Album
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {bio && (
        <ArtistBio
          bio={bio}
          artistName={artist?.name}
          onNavigate={onNavigate}
        />
      )}
    </motion.div>
  );
};
