import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, ListMusic, Sparkles, FolderPlus } from 'lucide-react';
import { Track } from '../types';
import {
  LocalPlaylist,
  getLocalPlaylists,
  createLocalPlaylist,
  addTrackToPlaylist,
  addTracksToPlaylist,
} from '../services/libraryStore';
import { logEvent } from '../services/listeningStore';
import {
  addVideoToYoutubePlaylist,
  getYoutubeCapability,
  isInsufficientScope,
  listYoutubePlaylists,
} from '../services/youtubePlaylists';
import { youtubeVideoIdOf, type UnifiedPlaylist } from '../services/playlistModel';
import { ArtworkImage } from './ArtworkImage';

interface AddToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  tracks: Track[]; // 1 or more tracks
  onSuccess?: (playlistName: string, count: number) => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  isOpen,
  onClose,
  tracks,
  onSuccess,
}) => {
  const [playlists, setPlaylists] = useState<LocalPlaylist[]>(() => getLocalPlaylists());
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [addedPlaylistIds, setAddedPlaylistIds] = useState<Set<string>>(new Set());
  // YouTube targets appear ONLY when the account actually holds write scope.
  // Read-only sessions never see an action the backend cannot perform.
  const [ytPlaylists, setYtPlaylists] = useState<UnifiedPlaylist[]>([]);
  const [ytCanWrite, setYtCanWrite] = useState(false);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setPlaylists(getLocalPlaylists());
    setNewTitle('');
    setShowCreate(false);
    setAddedPlaylistIds(new Set());
    setYtPlaylists([]);
    setYtError('');
    setYtCanWrite(false);
    setYtLoading(true);
    getYoutubeCapability()
      .then((cap) => {
        setYtCanWrite(cap.connected && cap.canWrite);
        if (cap.connected && cap.canWrite) {
          return listYoutubePlaylists(25).then(setYtPlaylists);
        }
      })
      .catch(() => setYtError('YouTube playlists are unavailable.'))
      .finally(() => setYtLoading(false));
  }, [isOpen]);

  if (!isOpen || !tracks.length) return null;

  const logPlaylistAdds = (playlistId: string) => {
    // Strong positive taste signal (weighted centrally in affinityWeights).
    for (const t of tracks) {
      try {
        logEvent({
          songId: t.id, track: t, event: 'add_to_playlist',
          playedSeconds: 0, duration: t.durationSeconds || 0,
          meta: { playlistId },
        });
      } catch {}
    }
  };

  const handleCreateAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    const newPl = createLocalPlaylist(title, '', tracks);
    setPlaylists(getLocalPlaylists());
    setAddedPlaylistIds((prev) => new Set([...prev, newPl.id]));
    setNewTitle('');
    setShowCreate(false);
    logPlaylistAdds(newPl.id);
    onSuccess?.(newPl.title, tracks.length);
    setTimeout(onClose, 600);
  };

  const [ytBusy, setYtBusy] = useState(false);

  const handleSelectYoutube = async (pl: UnifiedPlaylist) => {
    // Only tracks with a usable videoId can be added; others are reported,
    // never pretended. Failures report per-track without closing the modal.
    const usable = tracks
      .map((t) => ({ track: t, videoId: youtubeVideoIdOf(t) }))
      .filter((x): x is { track: Track; videoId: string } => !!x.videoId);
    if (!usable.length) {
      setYtError('None of these tracks have a YouTube video id, so they cannot be added to YouTube.');
      return;
    }
    setYtBusy(true);
    setYtError('');
    let added = 0;
    const failed: string[] = [];
    for (const u of usable) {
      try {
        const r = await addVideoToYoutubePlaylist(pl.sourceId || pl.id, u.videoId);
        if (r.ok) added++;
        else failed.push(u.track.title);
      } catch (e) {
        if (isInsufficientScope(e)) {
          setYtError('YouTube is read-only for this account. Reconnect with playlist access.');
          setYtBusy(false);
          return;
        }
        failed.push(u.track.title);
      }
    }
    setYtBusy(false);
    if (added) {
      setAddedPlaylistIds((prev) => new Set([...prev, pl.id]));
      onSuccess?.(pl.title, added);
      setTimeout(onClose, 600);
    }
    if (failed.length) setYtError(`${failed.length} track${failed.length === 1 ? '' : 's'} could not be added.`);
  };

  const handleSelectPlaylist = (pl: LocalPlaylist) => {
    if (tracks.length === 1) {
      addTrackToPlaylist(pl.id, tracks[0]);
    } else {
      addTracksToPlaylist(pl.id, tracks);
    }
    setAddedPlaylistIds((prev) => new Set([...prev, pl.id]));
    setPlaylists(getLocalPlaylists());
    logPlaylistAdds(pl.id);
    onSuccess?.(pl.title, tracks.length);
    setTimeout(onClose, 600);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-md p-4 safe-bottom safe-top">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md overflow-hidden rounded-[24px] border border-white/10 bg-[#121214]/95 shadow-[0_24px_64px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
          role="dialog"
          aria-modal="true"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                <FolderPlus className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-[15px] font-bold tracking-tight text-white">Add to Playlist</h3>
                <p className="text-[11px] font-medium text-white/50">
                  {tracks.length === 1 ? tracks[0].title : `${tracks.length} songs selected`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close add to playlist"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/15 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto scrollbar-none">
            {/* Create New Playlist option */}
            {!showCreate ? (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] p-3 text-left hover:border-white/40 hover:bg-white/[0.06] transition-all group"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black shadow-sm group-hover:scale-105 transition-transform">
                  <Plus className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-white">New playlist</p>
                  <p className="text-xs text-white/45">Create and add songs</p>
                </div>
              </button>
            ) : (
              <form onSubmit={handleCreateAndAdd} className="rounded-2xl border border-white/15 bg-white/[0.04] p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Playlist name"
                    autoFocus
                    className="w-full rounded-xl bg-black/40 border border-white/10 px-3.5 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newTitle.trim()}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-white/90 disabled:opacity-40 shadow-sm"
                  >
                    Create & Add
                  </button>
                </div>
              </form>
            )}

            {/* YouTube targets — write access only, never a dead action */}
            {ytCanWrite && (
              <div className="space-y-1.5 pt-1">
                <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-white/40">
                  YouTube playlists
                </p>
                {ytLoading && <p className="px-1 text-xs text-white/45">Loading YouTube playlists…</p>}
                {!ytLoading &&
                  ytPlaylists.map((pl) => {
                    const isAdded = addedPlaylistIds.has(pl.id);
                    return (
                      <button
                        key={pl.id}
                        onClick={() => void handleSelectYoutube(pl)}
                        disabled={ytBusy}
                        className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-white/[0.06] transition-colors group disabled:opacity-50"
                      >
                        <div className="h-10 w-10 rounded-lg bg-red-500/15 border border-red-500/25 flex items-center justify-center text-red-300 font-extrabold text-xs shrink-0 overflow-hidden">
                          {pl.artwork ? (
                            <ArtworkImage src={pl.artwork} alt="" className="h-full w-full object-cover" />
                          ) : (
                            pl.title.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-white">
                            {pl.title}
                          </p>
                          <p className="truncate text-xs text-white/45">
                            {pl.trackCount} songs • YouTube
                          </p>
                        </div>
                        {isAdded ? (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-black">
                            <Check className="h-4 w-4 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-white/40 group-hover:bg-white/15 group-hover:text-white transition-colors">
                            <Plus className="h-4 w-4" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                {!ytLoading && ytPlaylists.length === 0 && !ytError && (
                  <p className="px-1 text-xs text-white/45">No YouTube playlists in this account.</p>
                )}
                {ytError && <p role="alert" className="px-1 text-xs text-rose-300">{ytError}</p>}
              </div>
            )}

            {/* Existing Playlists list */}
            {playlists.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-white/40">Wave playlists</p>
                {playlists.map((pl) => {
                  const isAdded = addedPlaylistIds.has(pl.id);
                  return (
                    <button
                      key={pl.id}
                      onClick={() => handleSelectPlaylist(pl)}
                      className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-white/[0.06] transition-colors group"
                    >
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-white/15 to-white/5 border border-white/10 flex items-center justify-center text-white font-extrabold text-xs shrink-0">
                        {pl.title.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-white group-hover:text-white">
                          {pl.title}
                        </p>
                        <p className="truncate text-xs text-white/45">
                          {(pl.songs || []).length} songs
                        </p>
                      </div>
                      {isAdded ? (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-black">
                          <Check className="h-4 w-4 stroke-[3]" />
                        </span>
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-white/40 group-hover:bg-white/15 group-hover:text-white transition-colors">
                          <Plus className="h-4 w-4" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
