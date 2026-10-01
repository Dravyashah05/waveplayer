import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Disc3, Music, ListMusic, Download, LayoutGrid, List, Play, Plus, Sparkles, Mic2 } from 'lucide-react';
import { playerStore } from '../services/playerStore';
import { createYTMusicPlaylist, checkYTMusicAuth } from '../services/ytmusicApi';
import { Track } from '../types';
import { SongRow } from '../components/SongRow';
import { NoContent } from '../components/NoContent';

type TabId = 'playlists' | 'songs' | 'albums' | 'artists' | 'favs' | 'downloads';
type View = 'grid' | 'list';
type YouTubePlaylist = { id: string; title: string; description: string; thumbnail: string; itemCount: number; privacy: string };

export const LibraryPage: React.FC<{ onPlay: (t: Track, list?: Track[]) => void; initialTab?: TabId }> = ({ onPlay, initialTab = 'playlists' }) => {
  const [view, setView] = useState<View>('grid');
  const [tab, setTab] = useState<TabId>(initialTab);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [authMode, setAuthMode] = useState<string>('checking...');
  const [localPlaylists, setLocalPlaylists] = useState<any[]>(() => {
    try { const raw = localStorage.getItem('wave:local_playlists'); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  const [favs, setFavs] = useState<Track[]>(() => playerStore.favsList());
  const [history, setHistory] = useState<Track[]>(() => playerStore.historyList());
  const [youtubePlaylists, setYoutubePlaylists] = useState<YouTubePlaylist[]>([]);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeMessage, setYoutubeMessage] = useState('');
  useEffect(() => {
    const unsub = playerStore.subscribe(() => {
      setFavs([...playerStore.favsList()]);
      setHistory([...playerStore.historyList()]);
    });
    return () => { unsub(); };
  }, []);

  useEffect(() => { checkYTMusicAuth().then((r) => setAuthMode(r.mode)).catch(() => setAuthMode('mock')); }, []);
  const loadYoutubePlaylists = async (refresh = false) => {
    setYoutubeLoading(true); setYoutubeMessage('');
    try {
      const status = await fetch('/api/auth/youtube/status', { credentials: 'include' }).then(r => r.json());
      setYoutubeConnected(!!status.connected);
      if (!status.connected) { setYoutubePlaylists([]); return; }
      const response = await fetch(`/api/youtube/playlists?maxResults=50${refresh ? '&refresh=1' : ''}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load YouTube playlists.');
      setYoutubePlaylists(data.items || []);
    } catch (error: any) { setYoutubeMessage(error.message || 'Could not load YouTube playlists.'); }
    finally { setYoutubeLoading(false); }
  };
  useEffect(() => { void loadYoutubePlaylists(); }, []);
  const getYoutubeTracks = async (playlist: YouTubePlaylist) => {
    const response = await fetch(`/api/youtube/playlists/${encodeURIComponent(playlist.id)}/items?maxResults=50`, { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load playlist tracks.');
    return (data.items || []).filter((item: any) => item.videoId).map((item: any): Track => ({ id: item.videoId, title: item.title, author: item.artist || 'YouTube channel', thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`, duration: '', durationSeconds: 0, url: `https://www.youtube.com/watch?v=${item.videoId}`, source: 'youtube', type: 'VIDEO' }));
  };
  const importYoutubePlaylist = async (playlist: YouTubePlaylist) => {
    try {
      const songs = await getYoutubeTracks(playlist);
      const raw = localStorage.getItem('wave:local_playlists'); const local = raw ? JSON.parse(raw) : [];
      const imported = { id: `LOCAL_YT_${playlist.id}`, title: playlist.title, description: playlist.description, songs, createdAt: new Date().toISOString(), source: 'youtube-import', youtubePlaylistId: playlist.id };
      const next = [...local.filter((p: any) => p.id !== imported.id), imported];
      localStorage.setItem('wave:local_playlists', JSON.stringify(next)); setLocalPlaylists(next); setYoutubeMessage(`Imported “${playlist.title}” into Wave.`);
    } catch (error: any) { setYoutubeMessage(error.message || 'Import failed.'); }
  };
  useEffect(() => {
    const onStorage = () => { try { const raw = localStorage.getItem('wave:local_playlists'); setLocalPlaylists(raw ? JSON.parse(raw) : []); } catch {} };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleCreate = async () => {
    const t = title.trim(); if (!t) { void 0; return; }
    setCreating(true);
    try {
      const res = await createYTMusicPlaylist(t, desc, 'PRIVATE');
      setTitle(''); setDesc('');
      try { const raw = localStorage.getItem('wave:local_playlists'); setLocalPlaylists(raw ? JSON.parse(raw) : []); } catch {}
    } catch (e: any) { void 0; } finally { setCreating(false); }
  };

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'playlists', label: 'Playlists', icon: ListMusic },
    { id: 'songs', label: 'Songs', icon: Music },
    { id: 'albums', label: 'Albums', icon: Disc3 },
    { id: 'artists', label: 'Artists', icon: Mic2 },
    { id: 'favs', label: 'Favorites', icon: Heart },
    { id: 'downloads', label: 'Downloads', icon: Download },
  ];

  return (
    <div className="space-y-6">
      {/* ——— HEADER: Large My Library + filter tabs + Grid/List switch ——— */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-[-0.03em] leading-none text-white">My Library</h1>
            <p className="mt-1.5 text-[13px] font-medium text-[#a1a1aa]">Your personal collection • Premium Liquid Glass</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full glass p-1 border border-white/[0.06]">
              <button onClick={() => setView('grid')} className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${view === 'grid' ? 'bg-white text-black shadow-sm' : 'text-[#a1a1aa] hover:text-white'}`} aria-label="Grid"><LayoutGrid className="h-4 w-4" /></button>
              <button onClick={() => setView('list')} className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${view === 'list' ? 'bg-white text-black shadow-sm' : 'text-[#a1a1aa] hover:text-white'}`} aria-label="List"><List className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold border whitespace-nowrap transition-colors ${tab === t.id ? 'bg-white text-black border-white shadow-sm' : 'glass text-[#a1a1aa] border-white/[0.06] hover:text-white hover:bg-white/[0.06]'}`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}{t.id === 'favs' && favs.length ? ` • ${favs.length}` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ——— CONTENT — with smooth transition ——— */}
      <AnimatePresence mode="wait">
        <motion.div key={`${tab}-${view}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          {/* Songs — no dummy catalog, show NoContent */}
          {tab === 'songs' && (
            <NoContent variant="songs" title="No songs in library" description="Songs you like or play will appear here. Use search to discover music — history and favorites populate automatically." />
          )}

          {/* Albums — no dummy */}
          {tab === 'albums' && (
            <NoContent variant="albums" description="Albums you save or play will appear here. Search for an album to get started." />
          )}

          {/* Artists — no dummy */}
          {tab === 'artists' && (
            <NoContent variant="artists" description="Artists you follow will appear here. Explore popular artists via search." />
          )}

          {/* Playlists */}
          {tab === 'playlists' && (
            <div className="space-y-4">
              <div className="rounded-[20px] glass-card p-4 sm:p-5">
                <h3 className="text-[13px] font-bold tracking-[-0.01em] text-white flex items-center gap-2"><Sparkles className="h-4 w-4 text-white" /> Create Playlist <span className="rounded-full bg-white/[0.06] border border-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-[#a1a1aa]">{authMode}</span></h3>
                <p className="text-xs font-normal text-[#a1a1aa] mt-1">Real YouTube Music when <code className="rounded bg-white/10 border border-white/10 px-1 py-0.5 text-white">oauth.json</code> present, else local mock.</p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Playlist title (e.g. My Mix)" className="rounded-full glass-search px-4 py-2.5 text-[13px] text-white outline-none placeholder:text-[#71717a]" />
                  <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" className="rounded-full glass-search px-4 py-2.5 text-[13px] text-white outline-none placeholder:text-[#71717a]" />
                  <button onClick={handleCreate} disabled={creating || !title.trim()} className="rounded-full bg-white px-6 py-2.5 text-[13px] font-bold text-black hover:bg-white/90 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"><Plus className="h-4 w-4" /> {creating ? 'Creating…' : 'Create'}</button>
                </div>
              </div>

              <div className="rounded-[20px] glass-card p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[13px] font-bold text-white">YouTube Playlists</h3><p className="mt-1 text-xs text-white/50">Browse and import playlists from your connected account.</p></div><div className="flex gap-2">{!youtubeConnected && <button onClick={() => location.assign('/api/auth/youtube/connect')} className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-black">Connect YouTube</button>}<button onClick={() => void loadYoutubePlaylists(true)} disabled={youtubeLoading} className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/75">{youtubeLoading ? 'Loading…' : 'Refresh'}</button></div></div>
                {youtubeMessage && <p role="status" className="text-xs text-white/60">{youtubeMessage}</p>}
                {youtubePlaylists.map(playlist => <div key={playlist.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/20 p-2.5">
                  <img src={playlist.thumbnail || `https://i.ytimg.com/vi/${playlist.id}/default.jpg`} alt="" className="h-12 w-12 rounded-lg object-cover bg-white/5" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{playlist.title}<span className="ml-2 rounded-full bg-red-400/10 px-1.5 py-0.5 text-[10px] text-red-300">YouTube</span></p><p className="truncate text-xs text-white/45">{playlist.itemCount} tracks · {playlist.privacy}</p></div>
                  <button onClick={async () => { try { const tracks = await getYoutubeTracks(playlist); if (tracks.length) onPlay(tracks[0], tracks); else setYoutubeMessage('This playlist has no playable videos.'); } catch (error: any) { setYoutubeMessage(error.message); } }} className="rounded-full border border-white/10 px-3 py-2 text-xs text-white">Play</button>
                  <button onClick={() => void importYoutubePlaylist(playlist)} className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-black">Import</button>
                </div>)}
                {youtubeConnected && !youtubeLoading && youtubePlaylists.length === 0 && !youtubeMessage && <p className="text-xs text-white/45">No YouTube playlists found.</p>}
              </div>

              {localPlaylists.length > 0 ? (
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#a1a1aa] mb-2">Your Playlists • Local + Real</h4>
                  {view === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {localPlaylists.map((pl: any) => (
                        <div key={pl.id} className="rounded-[20px] glass-card p-4 flex gap-3">
                          <div className="h-20 w-20 rounded-[14px] bg-gradient-to-br from-[#0a0a0c]/30 to-[#ff6b35]/20 border border-white/10 flex items-center justify-center text-white font-bold text-[18px] shrink-0">{pl.title.slice(0, 2).toUpperCase()}</div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-white">{pl.title} <span className="rounded-full bg-white/10 border border-white/10 px-1.5 py-0.5 text-[10px] font-bold text-[#a1a1aa]">{pl.id.startsWith('LOCAL_') ? 'LOCAL' : 'YT'}</span></p>
                            <p className="truncate text-xs text-[#a1a1aa]">{pl.description || 'No description'} • {pl.privacyStatus}</p>
                            <p className="text-xs font-medium text-[#71717a] mt-1">{(pl.songs || []).length} songs • {new Date(pl.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[20px] glass-card divide-y divide-white/[0.04]">
                      {localPlaylists.map((pl: any) => (
                        <div key={pl.id} className="flex gap-3 px-4 py-3 hover:bg-white/[0.04]">
                          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#0a0a0c]/30 to-[#ff6b35]/20 border border-white/10 flex items-center justify-center text-white font-bold shrink-0">{pl.title.slice(0, 2).toUpperCase()}</div>
                          <div className="min-w-0 flex-1"><p className="truncate text-[13.5px] font-semibold text-white">{pl.title}</p><p className="truncate text-xs text-[#a1a1aa]">{pl.description || 'No description'}</p></div>
                          <span className="text-xs text-[#71717a] hidden sm:block">{(pl.songs || []).length} songs</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <NoContent variant="playlists" description="No playlists yet — create one above. Playlists you create or add to via YouTube Music will appear here." compact />
              )}

              {/* Favorites placed in My Playlists — moved from separate sidebar item */}
              <div className="pt-2">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#a1a1aa] mb-2 flex items-center gap-2"><Heart className="h-3.5 w-3.5" /> Favorites • in My Playlists {favs.length ? `• ${favs.length}` : ''}</h4>
                {favs.length === 0 ? (
                  <NoContent variant="favs" compact description="No favorites yet — favorites are now shown inside My Playlists. Tap ♥ on any song to add it here." />
                ) : view === 'grid' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {favs.map((t) => (
                      <div key={t.id} onClick={() => onPlay(t, favs)} className="group cursor-pointer">
                        <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#1c1c1e] ring-1 ring-white/[0.06] shadow-[0_8px_24px_rgba(0,0,0,0.32)]">
                          <img src={t.thumbnail} alt={t.title} className="h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-500" />
                          <div className="absolute top-2.5 left-2.5 rounded-full bg-white text-black p-1.5 shadow-md"><Heart className="h-3 w-3 fill-current" /></div>
                          <button className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-full bg-white text-black flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all shadow-lg"><Play className="h-4 w-4 fill-current ml-0.5" /></button>
                        </div>
                        <p className="mt-2.5 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-white">{t.title}</p>
                        <p className="truncate text-xs font-normal text-[#a1a1aa]">{t.author}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[20px] glass-card divide-y divide-white/[0.04]">
                    {favs.map((t, i) => <SongRow key={t.id} track={t} index={i} onPlay={() => onPlay(t, favs)} />)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Favorites */}
          {tab === 'favs' && (
            favs.length === 0 ? (
              <NoContent variant="favs" actionLabel="Browse songs" onAction={() => setTab('songs')} />
            ) : view === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {favs.map((t) => (
                  <div key={t.id} onClick={() => onPlay(t, favs)} className="group cursor-pointer">
                    <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#1c1c1e] ring-1 ring-white/[0.06] shadow-[0_8px_24px_rgba(0,0,0,0.32)]">
                      <img src={t.thumbnail} alt={t.title} className="h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-500" />
                      <div className="absolute top-2.5 left-2.5 rounded-full bg-white text-black p-1.5 shadow-md"><Heart className="h-3 w-3 fill-current" /></div>
                      <button className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-full bg-white text-black flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all shadow-lg"><Play className="h-4 w-4 fill-current ml-0.5" /></button>
                    </div>
                    <p className="mt-2.5 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-white">{t.title}</p>
                    <p className="truncate text-xs font-normal text-[#a1a1aa]">{t.author}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[20px] glass-card divide-y divide-white/[0.04]">
                {favs.map((t, i) => <SongRow key={t.id} track={t} index={i} onPlay={() => onPlay(t, favs)} />)}
              </div>
            )
          )}

          {/* Downloads — polished empty state per spec */}
          {tab === 'downloads' && (
            history.length === 0 ? (
              <NoContent variant="generic" title="No downloads yet" description="Downloads appear here when you save tracks for offline listening. Tap the download icon on any song." />
            ) : view === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {history.slice(0, 8).map((t) => (
                  <div key={t.id} onClick={() => onPlay(t, history)} className="group cursor-pointer">
                    <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#1c1c1e] ring-1 ring-white/[0.06] shadow-[0_8px_24px_rgba(0,0,0,0.32)]">
                      <img src={t.thumbnail} alt={t.title} className="h-full w-full object-cover group-hover:scale-[1.04] transition-transform duration-500" />
                      <span className="absolute top-2.5 left-2.5 rounded-full bg-white px-2 py-1 text-[10px] font-bold tracking-wide text-black">DOWNLOADED</span>
                      <button className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-full bg-white text-black flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-lg"><Play className="h-4 w-4 fill-current ml-0.5" /></button>
                    </div>
                    <p className="mt-2.5 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-white">{t.title}</p>
                    <p className="truncate text-xs font-normal text-[#a1a1aa]">{t.author}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-[20px] glass-card divide-y divide-white/[0.04]">
                {history.slice(0, 10).map((t, i) => <SongRow key={t.id} track={t} index={i} onPlay={() => onPlay(t, history)} />)}
              </div>
            )
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
