import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  ListPlus,
  Plus,
  FolderPlus,
  Heart,
  Radio,
  Mic2,
  Disc3,
  Share2,
  Download,
  Trash2,
  X,
  Sparkles,
  Check,
  Loader2,
} from 'lucide-react';
import { Track } from '../types';
import { playerStore } from '../services/playerStore';
import { startRadioAndPlay } from '../services/radioEngine';
import { ArtworkImage } from './ArtworkImage';
import {
  canDownloadOffline,
  cancelOfflineDownload,
  formatBytes,
  getOfflineEntry,
  queueOfflineDownload,
  removeOfflineDownload,
  retryOfflineDownload,
  subscribeOffline,
} from '../services/offlineDownloads';

export interface SongContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  onPlay?: () => void;
  onOpenAddToPlaylist?: (track: Track) => void;
  onRemoveFromPlaylist?: () => void;
  onNavigate?: (page: string, param?: string) => void;
  onShowToast?: (msg: string) => void;
}

export const SongContextMenu: React.FC<SongContextMenuProps> = ({
  isOpen,
  onClose,
  track,
  onPlay,
  onOpenAddToPlaylist,
  onRemoveFromPlaylist,
  onNavigate,
  onShowToast,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [, setDlTick] = useState(0);

  useEffect(() => subscribeOffline(() => setDlTick((n) => n + 1)), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !track) return null;

  const isFav = playerStore.isFav(track.id);

  const handlePlay = () => {
    onClose();
    if (onPlay) onPlay();
    else playerStore.setQueue([track], 0);
  };

  const handlePlayNext = () => {
    onClose();
    playerStore.playNext(track);
    onShowToast?.(`Playing next: "${track.title}"`);
  };

  const handleAddToQueue = () => {
    onClose();
    playerStore.addToQueue(track);
    onShowToast?.(`Added to queue: "${track.title}"`);
  };

  const handleToggleFav = () => {
    onClose();
    const added = playerStore.toggleFav(track);
    onShowToast?.(added ? `Saved to Liked Songs` : `Removed from Liked Songs`);
  };

  const handleStartRadio = async () => {
    onClose();
    onShowToast?.(`Starting radio for "${track.title}"...`);
    try {
      // Smart track radio: server relations + local engine, session-tracked,
      // infinite extension via autoplay. Falls back to the seed alone.
      await startRadioAndPlay('track', { track });
    } catch {
      playerStore.setQueue([track], 0);
    }
  };

  const handleGoToArtist = () => {
    onClose();
    if (onNavigate) {
      const artistId = (track as any).artists?.primary?.[0]?.id || track.author;
      onNavigate('artist', artistId);
    }
  };

  const handleGoToAlbum = () => {
    onClose();
    if (onNavigate && track.albumId) {
      onNavigate('album', track.albumId);
    }
  };

  const handleShare = async () => {
    onClose();
    const shareText = `Listen to "${track.title}" by ${track.author} on Wave Music`;
    const shareUrl = track.url || window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: track.title,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch {}
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      onShowToast?.('Link copied to clipboard!');
    } catch {
      onShowToast?.('Could not copy link');
    }
  };

  const handleQueueOffline = () => {
    onClose();
    queueOfflineDownload(track);
    onShowToast?.(`Downloading "${track.title}" for offline…`);
  };

  const handleCancelOffline = () => {
    onClose();
    cancelOfflineDownload(track.id);
    onShowToast?.(`Cancelled offline download`);
  };

  const handleRemoveOffline = () => {
    onClose();
    void removeOfflineDownload(track.id).then(() => onShowToast?.(`Removed offline copy of "${track.title}"`));
  };

  const handleRetryOffline = () => {
    onClose();
    retryOfflineDownload(track.id);
    onShowToast?.(`Retrying offline download…`);
  };

  const dlEntry = getOfflineEntry(track.id);
  const dlGate = canDownloadOffline(track);
  const dlPct = dlEntry && dlEntry.state === 'downloading' ? Math.round((dlEntry.progress || 0) * 100) : 0;
  const rowClass =
    'flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white/80 hover:bg-white hover:text-black transition-colors group';
  const iconClass =
    'flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 group-hover:bg-black/10 text-white/70 group-hover:text-black transition-colors shrink-0';

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 safe-bottom"
        onClick={onClose}
      >
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-sm rounded-t-[28px] sm:rounded-[24px] border border-white/10 bg-[#141416]/98 shadow-[0_24px_64px_rgba(0,0,0,0.85)] backdrop-blur-2xl overflow-hidden max-h-[85vh] flex flex-col"
        >
          {/* Track Summary Header */}
          <div className="flex items-center gap-3.5 p-4 border-b border-white/[0.06] bg-white/[0.02]">
            <ArtworkImage
              src={track.thumbnail}
              alt={track.title}
              className="h-12 w-12 rounded-xl object-cover ring-1 ring-white/10 shadow-sm shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-bold text-white tracking-tight leading-tight">
                {track.title}
              </h4>
              <p className="truncate text-xs text-white/50 mt-0.5 font-medium">
                {track.author} {track.albumName ? `• ${track.albumName}` : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close menu"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/50 hover:bg-white/15 hover:text-white transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Action List */}
          <div className="p-2 space-y-0.5 overflow-y-auto scrollbar-none flex-1">
            <button
              onClick={handlePlay}
              className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                <Play className="h-4 w-4 fill-current ml-0.5" />
              </span>
              Play
            </button>

            <button
              onClick={handlePlayNext}
              className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                <ListPlus className="h-4 w-4" />
              </span>
              Play next
            </button>

            <button
              onClick={handleAddToQueue}
              className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                <Plus className="h-4 w-4" />
              </span>
              Add to queue
            </button>

            <button
              onClick={() => {
                onClose();
                onOpenAddToPlaylist?.(track);
              }}
              className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                <FolderPlus className="h-4 w-4" />
              </span>
              Add to playlist
            </button>

            {onRemoveFromPlaylist && (
              <button
                onClick={() => {
                  onClose();
                  onRemoveFromPlaylist();
                }}
                className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-rose-300 hover:bg-rose-500 hover:text-white transition-colors group"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-300 group-hover:bg-white/20 group-hover:text-white transition-colors">
                  <Trash2 className="h-4 w-4" />
                </span>
                Remove from this playlist
              </button>
            )}

            <button
              onClick={handleToggleFav}
              className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                <Heart className={`h-4 w-4 ${isFav ? 'fill-red-500 text-red-500 group-hover:fill-black group-hover:text-black' : ''}`} />
              </span>
              {isFav ? 'Remove from Liked' : 'Like song'}
            </button>

            <button
              onClick={handleStartRadio}
              className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                <Radio className="h-4 w-4" />
              </span>
              Start radio
            </button>

            {onNavigate && (
              <button
                onClick={handleGoToArtist}
                className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                  <Mic2 className="h-4 w-4" />
                </span>
                Go to artist
              </button>
            )}

            {onNavigate && track.albumId && (
              <button
                onClick={handleGoToAlbum}
                className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white hover:bg-white hover:text-black transition-colors group"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 group-hover:bg-black/10 text-white group-hover:text-black transition-colors">
                  <Disc3 className="h-4 w-4" />
                </span>
                Go to album
              </button>
            )}

            <div className="h-px bg-white/[0.06] my-1" />

            <button
              onClick={handleShare}
              className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white/80 hover:bg-white hover:text-black transition-colors group"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 group-hover:bg-black/10 text-white/70 group-hover:text-black transition-colors">
                <Share2 className="h-4 w-4" />
              </span>
              Share
            </button>

            {track.source !== 'local' && (!dlEntry || dlEntry.state === 'cancelled') && dlGate.eligible && (
              <button onClick={handleQueueOffline} className={rowClass}>
                <span className={iconClass}>
                  <Download className="h-4 w-4" />
                </span>
                Download
              </button>
            )}

            {track.source !== 'local' && (!dlEntry || dlEntry.state === 'cancelled') && !dlGate.eligible && !dlGate.alreadyOffline && (
              <div
                title={dlGate.reason}
                aria-disabled="true"
                className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-white/35 cursor-not-allowed"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/30 shrink-0">
                  <Download className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block">Download</span>
                  <span className="block truncate text-[11px] font-normal text-white/30">{dlGate.reason}</span>
                </span>
              </div>
            )}

            {(dlEntry?.state === 'queued' || dlEntry?.state === 'downloading') && (
              <button onClick={handleCancelOffline} className={rowClass}>
                <span className={iconClass}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
                <span className="min-w-0">
                  <span className="block">Downloading… {dlEntry.state === 'downloading' ? `${dlPct}%` : ''}</span>
                  <span className="block text-[11px] font-normal opacity-60">Tap to cancel</span>
                </span>
              </button>
            )}

            {dlEntry?.state === 'completed' && (
              <>
                <div className="flex w-full items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-medium text-emerald-300">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300 shrink-0">
                    <Check className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block">Downloaded</span>
                    {typeof dlEntry.size === 'number' && (
                      <span className="block text-[11px] font-normal opacity-60">{formatBytes(dlEntry.size)} • offline ready</span>
                    )}
                  </span>
                </div>
                <button onClick={handleRemoveOffline} className={rowClass}>
                  <span className={iconClass}>
                    <Trash2 className="h-4 w-4" />
                  </span>
                  Remove download
                </button>
              </>
            )}

            {dlEntry?.state === 'failed' && (
              <button onClick={handleRetryOffline} className={rowClass}>
                <span className={iconClass}>
                  <Download className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block">Retry download</span>
                  {dlEntry.error && <span className="block truncate text-[11px] font-normal opacity-60">{dlEntry.error}</span>}
                </span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
