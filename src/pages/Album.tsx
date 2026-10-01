import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
} from 'lucide-react';
import { Track, Album } from '../types';
import { getSaavnAlbumDetails, searchSaavnAlbums } from '../services/saavnApi';
import { playerStore } from '../services/playerStore';
interface AlbumPageProps {
  albumId?: string;
  onPlay: (t: Track, list?: Track[]) => void;
  onNavigate?: (page: string, param?: string) => void;
  onBack?: () => void;
}

export const AlbumPage: React.FC<AlbumPageProps> = ({ albumId, onPlay, onNavigate, onBack }) => {
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [popularAlbums, setPopularAlbums] = useState<Album[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [isFav, setIsFav] = useState(false);

  const currentPlayingId = playerStore.current()?.id;
  const isPlaying = playerStore.current() !== null;

  useEffect(() => {
    if (albumId) {
      loadAlbum(albumId);
    } else {
      loadPopularAlbums();
    }
  }, [albumId]);

  const loadAlbum = async (id: string) => {
    setLoading(true);
    try {
      const res = await getSaavnAlbumDetails(id);
      if (res && res.album) {
        setAlbum(res.album);
        setTracks(res.tracks || []);
      } else {
      }
    } catch (err) {
      console.error('[AlbumPage] load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadPopularAlbums = async () => {
    setLoading(true);
    try {
      const res = await searchSaavnAlbums('Bollywood Hits');
      setPopularAlbums(res.albums || []);
    } catch {
      setPopularAlbums([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAll = () => {
    if (!tracks.length) return;
    onPlay(tracks[0], tracks);
  };

  const handleShuffle = () => {
    if (!tracks.length) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
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
    if (navigator.share && album) {
      navigator.share({
        title: album.name,
        text: `Listen to ${album.name} by ${album.artist.name} on Wave Music`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  // If no album is selected, render Album Discovery grid
  if (!albumId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#86868b] flex items-center gap-1.5">
              <Disc3 className="h-3 w-3 text-cyan-400" /> Albums
            </p>
            <h1 className="mt-1 text-[26px] sm:text-[30px] font-extrabold tracking-[-0.03em] text-white">
              Featured Albums
            </h1>
            <p className="mt-1 text-[13px] text-[#86868b]">
              Discographies
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {popularAlbums.map((a) => (
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

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="h-9 w-9 animate-spin text-cyan-400" />
        <p className="text-sm font-medium text-[#86868b]">Loading album discography...</p>
      </div>
    );
  }

  const coverUrl = album?.thumbnails?.[0]?.url || '';

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

      {/* Hero Album Header Banner */}
      <div className="relative overflow-hidden rounded-[28px] sm:rounded-[32px] lg-hero p-6 sm:p-8 lg:p-10">
        {/* Ambient Backdrop */}
        {coverUrl && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover scale-150 blur-[54px] opacity-35"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/50" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
          </div>
        )}

        <div className="relative flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8">
          {/* Cover Art */}
          <div className="relative h-[190px] w-[190px] sm:h-[220px] sm:w-[220px] shrink-0 rounded-[22px] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] ring-1 ring-white/20 bg-[#161619]">
            <img
              src={coverUrl}
              alt={album?.name}
              className="h-full w-full object-cover"
            />
          </div>

          {/* Details */}
          <div className="flex flex-1 flex-col justify-end min-w-0 text-center sm:text-left">
            <div className="inline-flex items-center justify-center sm:justify-start gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-cyan-400">
              <Disc3 className="h-3.5 w-3.5" /> Official Album
            </div>

            <h1 className="mt-2 text-[26px] sm:text-[34px] lg:text-[40px] font-black tracking-[-0.03em] leading-tight text-white line-clamp-2">
              {album?.name}
            </h1>

            <p className="mt-2 text-[15px] sm:text-[16px] font-semibold text-white/90">
              <span
                onClick={() => album?.artist?.artistId && onNavigate?.('artist', album.artist.artistId)}
                className="hover:underline cursor-pointer"
              >
                {album?.artist?.name || 'Various Artists'}
              </span>
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[12px] text-white/70">
              {album?.year && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                  <Calendar className="h-3 w-3" /> {album.year}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08]">
                <Music2 className="h-3 w-3" /> {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
              </span>
              {album?.language && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 border border-white/[0.08] uppercase text-[10px] font-bold">
                  {album.language}
                </span>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <button
                type="button"
                onClick={handlePlayAll}
                className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-bold text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(0,0,0,0.4)] active:scale-95 transition-all"
              >
                <Play className="h-4 w-4 fill-current" /> Play All
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

      {/* Tracklist Table */}
      <div className="lg-panel">
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-white/[0.06] text-[11px] font-bold uppercase tracking-[0.08em] text-[#86868b]">
          <div className="flex items-center gap-4">
            <span className="w-6 text-center">#</span>
            <span>Title</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="w-12 text-right flex items-center justify-end gap-1">
              <Clock className="h-3 w-3" /> Time
            </span>
            <span className="w-16 text-right">Action</span>
          </div>
        </div>

        <div className="divide-y divide-white/[0.04]">
          {tracks.map((t, idx) => {
            const isTrackActive = currentPlayingId === t.id;
            return (
              <div
                key={t.id || idx}
                onClick={() => onPlay(t, tracks)}
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

                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[14px] font-semibold ${isTrackActive ? 'text-cyan-400 font-bold' : 'text-white'}`}>
                      {t.title}
                    </p>
                    <p className="truncate text-[12px] text-[#86868b]">
                      {t.author}
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

      {album?.description && (
        <div className="rounded-[20px] glass p-5 text-xs text-[#86868b] leading-relaxed">
          <p className="font-semibold text-white/70 uppercase tracking-wider text-[10px] mb-1">About this Album</p>
          {album.description}
        </div>
      )}
    </motion.div>
  );
};
