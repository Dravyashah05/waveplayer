import React, { useState, useEffect } from 'react';
import { Play, Pause, Heart, MoreVertical, Clock3, Check, X } from 'lucide-react';
import { Track } from '../types';
import { playerStore } from '../services/playerStore';
import { formatTrackDuration } from '../services/libraryStore';
import { ArtworkImage } from './ArtworkImage';

interface SongRowProps {
  track: Track;
  index: number;
  isActive?: boolean;
  isPlaying?: boolean;
  onPlay: () => void;
  showAlbum?: boolean;
  showCover?: boolean;
  subtitleExtra?: string; // e.g. "5m ago" or "4 plays"
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (selected: boolean) => void;
  onOpenMenu?: (track: Track, e: React.MouseEvent) => void;
  onNavigate?: (page: string, param?: string) => void;
  /** Optional history removal (rendered as a small ×; History UI only). */
  onRemove?: () => void;
}

export const SongRow: React.FC<SongRowProps> = ({
  track,
  index,
  isActive = false,
  isPlaying = false,
  onPlay,
  showAlbum = true,
  showCover = true,
  subtitleExtra,
  selectable = false,
  selected = false,
  onToggleSelect,
  onOpenMenu,
  onNavigate,
  onRemove,
}) => {
  const [isFav, setIsFav] = useState(() => playerStore.isFav(track.id));

  useEffect(() => {
    const unsub = playerStore.subscribe(() => setIsFav(playerStore.isFav(track.id)));
    return () => {
      unsub();
    };
  }, [track.id]);

  const toggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    playerStore.toggleFav(track);
    setIsFav(playerStore.isFav(track.id));
  };

  const handleRowClick = (e: React.MouseEvent) => {
    if (selectable && onToggleSelect) {
      onToggleSelect(!selected);
      return;
    }
    onPlay();
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenMenu?.(track, e);
  };

  const handleArtistClick = (e: React.MouseEvent) => {
    if (!onNavigate) return;
    e.stopPropagation();
    const artistId = (track as any).artists?.primary?.[0]?.id || track.author;
    onNavigate('artist', artistId);
  };

  const handleAlbumClick = (e: React.MouseEvent) => {
    if (!onNavigate || !track.albumId) return;
    e.stopPropagation();
    onNavigate('album', track.albumId);
  };

  const formattedDuration = formatTrackDuration(track.durationSeconds || track.duration);

  return (
    <div
      onClick={handleRowClick}
      className={`group relative flex items-center gap-3 sm:gap-3.5 px-3 sm:px-4 py-2 sm:py-2.5 transition-all cursor-pointer select-none border-b border-white/[0.04] last:border-0 rounded-xl sm:rounded-2xl ${
        selected
          ? 'bg-white/[0.12] border-white/20 shadow-[0_4px_16px_rgba(255,255,255,0.06)]'
          : isActive
          ? 'bg-white/[0.08] backdrop-blur-md border-white/15 shadow-[0_4px_20px_rgba(0,0,0,0.4)]'
          : 'hover:bg-white/[0.05] hover:backdrop-blur-sm'
      }`}
    >
      {/* 1. Leading column: Checkbox / Index / Play Icon / Equalizer */}
      <div className="flex w-6 sm:w-7 shrink-0 items-center justify-center">
        {selectable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.(!selected);
            }}
            aria-label={selected ? 'Deselect song' : 'Select song'}
            aria-pressed={selected}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center"
          >
            <span
              aria-hidden="true"
              className={`flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-md border transition-all ${
                selected
                  ? 'bg-white border-white text-black'
                  : 'border-white/30 bg-black/40 hover:border-white/60 text-transparent'
              }`}
            >
              <Check className="h-3 w-3 stroke-[3]" />
            </span>
          </button>
        ) : (
          <>
            {/* Desktop index number (hidden on hover or when playing) */}
            <span
              className={`text-[11px] sm:text-xs font-mono tabular-nums text-[#86868b] text-center w-5 ${
                isActive ? 'hidden' : 'group-hover:hidden'
              }`}
            >
              {String(index + 1).padStart(2, '0')}
            </span>

            {/* Hover play button */}
            <span
              className={`hidden ${
                isActive ? '' : 'group-hover:flex'
              } h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-white text-black shadow-sm transform group-hover:scale-105 transition-transform`}
            >
              {isActive && isPlaying ? (
                <Pause className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-current" />
              ) : (
                <Play className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-current ml-0.5" />
              )}
            </span>

            {/* Animated 3-bar equalizer when active */}
            {isActive && (
              <span className={`flex ${isPlaying ? 'group-hover:hidden' : 'group-hover:hidden'} items-center justify-center`}>
                <span className="flex items-end gap-[2.5px] h-3.5">
                  <span className="wave-bar !bg-white animate-[wave_0.8s_ease-in-out_infinite]" />
                  <span className="wave-bar !bg-white animate-[wave_1.1s_ease-in-out_infinite_0.2s]" />
                  <span className="wave-bar !bg-white animate-[wave_0.9s_ease-in-out_infinite_0.4s]" />
                </span>
              </span>
            )}
          </>
        )}
      </div>

      {/* 2. Cover Artwork */}
      {showCover && (
        <div className="relative h-11 w-11 sm:h-12 sm:w-12 shrink-0 overflow-hidden rounded-[10px] sm:rounded-[12px] bg-[#1a1a1c] ring-1 ring-white/[0.08] shadow-sm">
          <ArtworkImage
            src={track.thumbnail}
            alt={track.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 hidden sm:flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="h-4 w-4 fill-white text-white" />
          </div>
        </div>
      )}

      {/* 3. Title & Artist (Main info) */}
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <p
            className={`line-clamp-2 text-[13.5px] sm:text-[14px] font-semibold tracking-[-0.01em] leading-tight ${
              isActive ? 'text-white font-bold' : 'text-white/95 group-hover:text-white'
            }`}
          >
            {track.title}
          </p>
          {track.explicit && (
            <span className="shrink-0 rounded bg-white/20 px-1 py-0.2 text-[9px] font-black text-white leading-none">
              E
            </span>
          )}
          {(track.source === 'youtube' || track.source === 'ytmusic') && (
            <span className="hidden sm:inline-flex shrink-0 rounded-full bg-red-500/15 border border-red-500/20 px-1.5 py-0.5 text-[9.5px] font-bold text-red-300 leading-none">
              {track.source === 'ytmusic' ? 'YT Music' : 'YT'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-[#8e8e93] truncate mt-0.5">
          <span
            onClick={handleArtistClick}
            className={`truncate ${onNavigate ? 'hover:text-white hover:underline cursor-pointer' : ''}`}
          >
            {track.author || 'Unknown Artist'}
          </span>
          {/* Mobile album subtitle */}
          {track.albumName && (
            <span className="lg:hidden truncate text-white/40">
              • {track.albumName}
            </span>
          )}
          {subtitleExtra && (
            <span className="shrink-0 text-white/40">
              • {subtitleExtra}
            </span>
          )}
        </div>
      </div>

      {/* 4. Desktop Album Column */}
      {showAlbum && (
        <div className="hidden lg:block min-w-0 w-[180px] xl:w-[220px] shrink-0">
          <p
            onClick={handleAlbumClick}
            className={`truncate text-[13px] font-normal text-[#8e8e93] ${
              track.albumId && onNavigate ? 'hover:text-white hover:underline cursor-pointer' : ''
            }`}
          >
            {track.albumName || '—'}
          </p>
        </div>
      )}

      {/* 5. Duration Column */}
      <div className="hidden sm:flex items-center justify-end w-14 shrink-0 text-right">
        <span className="text-[11.5px] sm:text-xs font-mono font-medium text-[#8e8e93] tabular-nums">
          {formattedDuration}
        </span>
      </div>

      {/* 6. Action buttons: Remove / Heart & Context Menu (⋮) */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Optional History Remove Button */}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] border border-white/[0.06] text-[#8e8e93] hover:text-red-300 hover:bg-red-500/10 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity focus-visible:opacity-100 active:scale-95"
            aria-label={`Remove ${track.title} from history`}
            title="Remove from history"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {/* Heart Favorite Button */}
        <button
          type="button"
          onClick={toggleFav}
          className={`touch-target inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all active:scale-95 ${
            isFav
              ? 'bg-red-500/20 border-red-500/40 text-red-400 opacity-100 scale-100'
              : 'bg-white/[0.04] border-white/[0.06] text-[#8e8e93] hover:text-white hover:bg-white/[0.10] sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100'
          }`}
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-red-400 text-red-400' : ''}`} />
        </button>

        {/* More Options Context Menu Button (⋮) */}
        <button
          type="button"
          onClick={handleMenuClick}
          className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] border border-white/[0.06] text-[#8e8e93] hover:text-white hover:bg-white/[0.12] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity focus-visible:opacity-100 active:scale-95"
          aria-label="More options"
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {/* Mobile Quick Play indicator */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className={`sm:hidden touch-target inline-flex h-8 w-8 items-center justify-center rounded-full shadow-sm active:scale-90 transition-all ${
            isActive ? 'bg-white text-black' : 'bg-white/10 text-white'
          }`}
          aria-label={isActive && isPlaying ? 'Pause' : 'Play'}
        >
          {isActive && isPlaying ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
          )}
        </button>
      </div>
    </div>
  );
};
