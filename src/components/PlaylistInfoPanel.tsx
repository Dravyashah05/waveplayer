import { Play, ListMusic, Disc3, Music, Clock3, User, Plus, Trash2 } from 'lucide-react';
import { Track, Playlist, Album } from '../types';

interface Props {
  playlist: Playlist | null;
  album: Album | null;
  tracks: Track[];
  queue: Track[];
  current: Track | null;
  onPlayPlaylist: () => void;
  onPlayAlbum: () => void;
  onPlayTrack: (t: Track) => void;
  onClearQueue: () => void;
}

export const PlaylistInfoPanel: React.FC<Props> = ({ playlist, album, tracks, queue, current, onPlayPlaylist, onPlayAlbum, onPlayTrack, onClearQueue }) => {
  const hasPlaylist = !!playlist;
  const hasAlbum = !!album && !hasPlaylist;
  const pick = (th: any[] | undefined) => {
    if (!Array.isArray(th) || !th.length) return '';
    let best = th[0];
    for (const t of th) if ((Number(t.width) || 0) > (Number(best.width) || 0)) best = t;
    let u = String(best?.url || '');
    if (u.includes('=w')) u = u.replace(/=w\d+-h\d+/, '=w800-h800').replace(/=w\d+/, '=w800');
    return u;
  };
  const cover = hasPlaylist
    ? pick(playlist!.thumbnails) || `https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg`
    : hasAlbum
    ? pick(album!.thumbnails) || `https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg`
    : current?.thumbnail || queue[0]?.thumbnail || `https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg`;

  const title = hasPlaylist ? playlist!.name : hasAlbum ? album!.name : current ? current.title : queue.length ? 'Your Queue' : 'Wave Player';
  const subtitle = hasPlaylist
    ? `${playlist!.author} • ${tracks.length || playlist!.videoCount || '—'} songs`
    : hasAlbum
    ? `${album!.artist.name} • ${album!.year || ''} • ${tracks.length} songs`
    : current
    ? `${current.author}`
    : queue.length
    ? `${queue.length} tracks in queue`
    : 'Select a playlist or play a song';

  return (
    <div className="rounded-[24px] border border-white/[0.07] bg-gradient-to-br from-white/[0.06] via-neutral-900 to-neutral-900 p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.45)] glass">
      <div className="rounded-[23px] bg-neutral-900 overflow-hidden">
        {/* Cover */}
        <div className="relative h-[220px] w-full bg-neutral-900 overflow-hidden">
          <img
            src={cover}
            alt={title}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              if (img.src.includes('maxresdefault')) img.src = img.src.replace('maxresdefault', 'hqdefault');
              else if (img.src.includes('w800')) img.src = img.src.replace('w800', 'w400');
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-neutral-900/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent opacity-60" />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur border border-white/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white">
            {hasPlaylist ? <><ListMusic className="h-3 w-3" /> PLAYLIST</> : hasAlbum ? <><Disc3 className="h-3 w-3" /> ALBUM</> : <><Music className="h-3 w-3" /> NOW PLAYING</>}
          </span>
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h3 className="line-clamp-2 text-[18px] font-extrabold leading-tight tracking-[-0.02em] text-white drop-shadow">{title}</h3>
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-neutral-300 line-clamp-1">
              <User className="h-3 w-3 opacity-60" /> {subtitle}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Actions */}
          <div className="flex gap-2">
            {hasPlaylist ? (
              <>
                <button onClick={onPlayPlaylist} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-neutral-900 hover:bg-neutral-100 shadow active:scale-[0.98]">
                  <Play className="h-4 w-4 fill-current" /> Play all
                </button>
                <button
                  onClick={() => tracks.forEach((t) => onPlayTrack(t))}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-neutral-300 hover:text-white hover:bg-white/[0.10]"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </>
            ) : hasAlbum ? (
              <>
                <button onClick={onPlayAlbum} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-neutral-900 hover:bg-neutral-100 shadow active:scale-[0.98]">
                  <Play className="h-4 w-4 fill-current" /> Play album
                </button>
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-neutral-300">
                  <Disc3 className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button onClick={() => current && onPlayTrack(current)} disabled={!current} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-black shadow-[0_8px_20px_rgba(255,255,255,0.18)] hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Play className="h-4 w-4 fill-current" /> {current ? 'Resume' : 'Pick a song'}
                </button>
                {queue.length > 0 && (
                  <button onClick={onClearQueue} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-neutral-500 hover:text-white">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Track preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-neutral-400 flex items-center gap-1.5">
                <Clock3 className="h-3 w-3" /> {hasPlaylist || hasAlbum ? `Tracks • ${tracks.length}` : `Up next • ${queue.length}`}
              </h4>
              {(hasPlaylist || hasAlbum) && tracks.length > 5 && <span className="text-xs text-neutral-500">{tracks.length} total</span>}
            </div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto scrollbar-none pr-1 -mr-1">
              {(hasPlaylist || hasAlbum ? tracks : queue).slice(0, 6).map((t, i) => (
                <button
                  key={`${t.id}-${i}`}
                  onClick={() => onPlayTrack(t)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left border transition-colors ${current?.id === t.id ? 'bg-white text-neutral-900 border-white' : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.10] text-neutral-300'}`}
                >
                  <span className="text-[11px] font-mono font-medium opacity-60 w-5">{String(i + 1).padStart(2, '0')}</span>
                  <img src={t.thumbnail} alt={t.title} className="h-8 w-8 rounded-lg object-cover shrink-0" referrerPolicy="no-referrer" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs font-semibold leading-tight ${current?.id === t.id ? 'text-neutral-900' : 'text-white'}`}>{t.title}</span>
                    <span className={`block truncate text-[11px] ${current?.id === t.id ? 'text-neutral-600' : 'text-neutral-500'}`}>{t.author}</span>
                  </span>
                  <span className={`text-[11px] font-mono ${current?.id === t.id ? 'text-neutral-600' : 'text-neutral-500'}`}>{t.duration}</span>
                </button>
              ))}
              {(hasPlaylist || hasAlbum ? tracks : queue).length === 0 && (
                <div className="rounded-xl border border-dashed border-white/[0.06] bg-white/[0.02] p-6 text-center">
                  <p className="text-xs font-semibold text-white">Nothing here yet</p>
                  <p className="text-xs text-neutral-500 mt-1">Search and play a playlist to see tracks here</p>
                </div>
              )}
            </div>
          </div>

          {/* Queue info footer */}
          {queue.length > 0 && (
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 flex items-center justify-between">
              <div className="text-xs">
                <p className="font-semibold text-white">{queue.length} in queue</p>
                <p className="text-neutral-500 truncate max-w-[160px]">Next: {queue[(queue.findIndex((q) => q.id === current?.id) + 1) % queue.length]?.title || '—'}</p>
              </div>
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
