import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search as SearchIcon,
  Clock,
  Music,
  Disc3,
  ListMusic,
  Mic2,
  X,
  Heart,
  Loader2,
  Play,
  Sparkles,
} from 'lucide-react';
import { ytmusicSearch } from '../services/ytmusicApi';
import {
  searchSaavnAll,
  searchSaavnSongs,
  searchSaavnAlbums,
  searchSaavnPlaylists,
  searchSaavnArtists,
} from '../services/saavnApi';
import { Track, SearchArtist, Album, Playlist } from '../types';
import { playerStore } from '../services/playerStore';
import { searchYouTube } from '../services/youtubeSearch';
import { logEvent } from '../services/listeningStore';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'artists', label: 'Artists' },
  { id: 'albums', label: 'Albums' },
  { id: 'playlists', label: 'Playlists' },
] as const;
type FilterId = typeof FILTERS[number]['id'];

const SUGGESTIONS = ['arijit singh', 'lofi beats', 'punjabi hits', 'a r rahman', 'weeknd', 'taylor swift'];

const LS_RECENT = 'wave:recent_searches';
function loadRecent(): string[] { try { const v = localStorage.getItem(LS_RECENT); return v ? JSON.parse(v) : []; } catch { return []; } }
function saveRecent(q: string) { try { const arr = loadRecent(); const next = [q, ...arr.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 6); localStorage.setItem(LS_RECENT, JSON.stringify(next)); } catch {} }

export const SearchPage: React.FC<{
  onPlay: (t: Track, list?: Track[]) => void;
  initialQuery?: string;
  onQueryChange?: (q: string) => void;
  onNavigate?: (page: string, param?: string) => void;
}> = ({ onPlay, initialQuery = '', onQueryChange, onNavigate }) => {
  const [query, setQuery] = useState(initialQuery);
  const [activeFilter, setFilter] = useState<FilterId>('all');
  const [results, setResults] = useState<{ tracks: Track[]; playlists: Playlist[]; albums: Album[]; artists: SearchArtist[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === '/') { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // auto search — no button needed
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearched(false); setError(null); setLoading(false); return; }
    const t = window.setTimeout(() => doSearch(q, activeFilter), 400);
    return () => window.clearTimeout(t);
  }, [query]);

  const doSearch = async (q: string, filter: FilterId = activeFilter) => {
    const qq = q.trim(); if (!qq) return;
    setLoading(true); setError(null); setSearched(true);
    saveRecent(qq); setRecent(loadRecent()); onQueryChange?.(qq);
    try { logEvent({ songId: `search:${qq}`, event: 'search', playedSeconds: 0, duration: 0, meta: { query: qq, filter } }); } catch {}
    try {
      if (filter === 'all') {
        const r = await searchSaavnAll(qq);
        if (r.tracks.length || r.albums.length || r.playlists.length || r.artists.length) { setResults(r); return; }
      } else if (filter === 'songs') {
        const r = await searchSaavnSongs(qq, 1, 20); if (r.tracks.length) { setResults({ tracks: r.tracks, playlists: [], albums: [], artists: [] }); return; }
      } else if (filter === 'albums') {
        const r = await searchSaavnAlbums(qq, 1, 20); if (r.albums.length) { setResults({ tracks: [], playlists: [], albums: r.albums, artists: [] }); return; }
      } else if (filter === 'playlists') {
        const r = await searchSaavnPlaylists(qq, 1, 20); if (r.playlists.length) { setResults({ tracks: [], playlists: r.playlists, albums: [], artists: [] }); return; }
      } else if (filter === 'artists') {
        const r = await searchSaavnArtists(qq, 1, 20); if (r.artists.length) { setResults({ tracks: [], playlists: [], albums: [], artists: r.artists }); return; }
      }
      const r = await ytmusicSearch(qq, filter as any);
      const empty = !r.tracks.length && !r.playlists.length && !r.albums.length && !(r as any).artists?.length;
      if (empty) { const fb = await searchYouTube(qq); if (fb.length) setResults({ tracks: fb, playlists: [], albums: [], artists: [] }); else setResults(r as any); }
      else setResults(r as any);
    } catch (e: any) {
      try { const fb = await searchYouTube(q); if (fb.length) { setResults({ tracks: fb, playlists: [], albums: [], artists: [] }); setError(null); } else throw e; }
      catch { setError('Search failed'); setResults(null); }
    } finally { setLoading(false); }
  };

  const apply = (q: string) => { setQuery(q); onQueryChange?.(q); doSearch(q); };
  const clear = () => { setQuery(''); onQueryChange?.(''); setResults(null); setSearched(false); setError(null); inputRef.current?.focus(); };

  const isIdle = !searched && !loading && !results && !error;
  const isEmpty = searched && !loading && !error && results && !results.tracks.length && !results.playlists.length && !results.albums.length && !(results.artists?.length);

  return (
    <div className="w-full">
      {/* Single clear search field */}
      <div className="sticky top-0 z-10 -mx-3 min-[400px]:-mx-4 sm:-mx-6 lg:-mx-8 px-3 min-[400px]:px-4 sm:px-6 lg:px-8 pt-2 pb-3 bg-black/80 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="relative flex items-center gap-2 rounded-full bg-white px-2 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shrink-0">
            <SearchIcon className="h-5 w-5" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') clear(); }}
            placeholder="Search songs, artists, albums"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-[16px] font-medium text-black placeholder:text-black/40 outline-none min-w-0"
          />
          {query ? (
            <button onClick={clear} className="h-9 w-9 rounded-full bg-black/5 hover:bg-black text-black hover:text-white grid place-items-center shrink-0 transition-colors" aria-label="Clear">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <span className="hidden sm:block text-xs font-medium text-black/30 pr-2">Press /</span>
          )}
        </div>

        {/* Filters — only show when typing/searching to keep idle clean */}
        {(query.trim().length > 0 || searched) && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto scrollbar-none">
            {FILTERS.map(f => {
              const active = activeFilter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => { setFilter(f.id); if (query.trim()) doSearch(query, f.id); }}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold border transition-colors ${active ? 'bg-white text-black border-white' : 'bg-transparent text-white/50 border-white/10 hover:border-white/20 hover:text-white'}`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {isIdle && (
          <motion.div key="idle" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pt-6 space-y-6">
            {recent.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-white/30 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Recent</span>
                  <button onClick={() => { localStorage.removeItem(LS_RECENT); setRecent([]); }} className="text-xs text-white/30 hover:text-white">Clear</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recent.map(r => (
                    <button key={r} onClick={() => apply(r)} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white text-white hover:text-black px-3.5 py-2 text-sm transition-colors">
                      <Clock className="h-3.5 w-3.5 opacity-40" /> {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="px-1 text-xs font-semibold text-white/30">Try searching</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => apply(s)} className="rounded-full bg-white text-black px-4 py-2 text-sm font-medium capitalize hover:bg-white/90 transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <p className="pt-2 text-center text-xs text-white/20">Just start typing — results appear instantly</p>
          </motion.div>
        )}

        {loading && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-white/40 px-1"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-2">
                <div className="h-12 w-12 rounded-xl bg-white/10 animate-pulse" />
                <div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-white/10 animate-pulse" /><div className="h-2.5 w-1/3 rounded bg-white/5 animate-pulse" /></div>
              </div>
            ))}
          </motion.div>
        )}

        {error && !loading && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-8 text-center">
            <p className="text-sm font-semibold text-white">Search failed</p>
            <p className="mt-1 text-sm text-white/40">{error}</p>
            <button onClick={() => doSearch(query)} className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-bold text-black">Retry</button>
          </motion.div>
        )}

        {isEmpty && (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-8 text-center">
            <div className="h-12 w-12 rounded-full bg-white/10 grid place-items-center mx-auto text-white/40"><SearchIcon className="h-6 w-6" /></div>
            <p className="mt-3 font-semibold text-white">No results for “{query}”</p>
            <p className="text-sm text-white/40">Try different words</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.slice(0, 4).map(s => (
                <button key={s} onClick={() => apply(s)} className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black capitalize">{s}</button>
              ))}
            </div>
          </motion.div>
        )}

        {results && !loading && !error && !isEmpty && (
          <motion.div key="results" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="pt-4 space-y-6">
            {results.tracks.length > 0 && (
              <div>
                <p className="px-1 text-xs font-semibold text-white/30 mb-2">Songs</p>
                <div className="space-y-1 lg-panel p-2">
                  {results.tracks.slice(0, 10).map(t => {
                    const fav = playerStore.isFav(t.id); const active = playerStore.current()?.id === t.id;
                    return (
                      <div key={t.id} onClick={() => onPlay(t, results.tracks)} className={`flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white/[0.06] cursor-pointer transition-colors ${active ? 'bg-white/[0.06]' : ''}`}>
                        <img src={t.thumbnail} alt={t.title} className="h-12 w-12 rounded-xl object-cover shrink-0" referrerPolicy="no-referrer" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold leading-none text-white">{t.title}</p>
                          <p className="truncate text-xs text-white/40 mt-1">{t.author}</p>
                        </div>
                        <button type="button" onClick={e => { e.stopPropagation(); playerStore.toggleFav(t); }} className={`h-8 w-8 rounded-full grid place-items-center shrink-0 border ${fav ? 'bg-white border-white text-black' : 'border-white/10 text-white/30'}`}>
                          <Heart className={`h-3.5 w-3.5 ${fav ? 'fill-current' : ''}`} />
                        </button>
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black">
                          <Play className="h-4 w-4 fill-current ml-0.5" />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {results.artists.length > 0 && (
              <div>
                <p className="px-1 text-xs font-semibold text-white/30 mb-2">Artists</p>
                <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
                  {results.artists.slice(0, 10).map((ar: SearchArtist) => {
                    const url = (ar as any).thumbnails?.[1]?.url || (ar as any).thumbnails?.[0]?.url || '';
                    return (
                      <button key={ar.artistId} onClick={() => ar.artistId && onNavigate ? onNavigate('artist', ar.artistId) : apply(ar.name)} className="shrink-0 flex flex-col items-center gap-1.5 w-[80px]">
                        <img src={url} alt={ar.name} className="h-16 w-16 rounded-full object-cover bg-white/5" referrerPolicy="no-referrer" />
                        <span className="w-full truncate text-center text-xs font-medium text-white">{ar.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {results.albums.length > 0 && (
              <div>
                <p className="px-1 text-xs font-semibold text-white/30 mb-2">Albums</p>
                <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
                  {results.albums.slice(0, 8).map((al: any) => (
                    <button key={al.albumId} onClick={() => al.albumId && onNavigate ? onNavigate('album', al.albumId) : apply(al.name)} className="shrink-0 w-[128px] text-left">
                      <img src={al.thumbnails?.[1]?.url || al.thumbnails?.[0]?.url || ''} alt={al.name} className="aspect-square w-full rounded-xl object-cover bg-white/5" referrerPolicy="no-referrer" />
                      <p className="mt-1.5 truncate text-xs font-semibold text-white">{al.name}</p>
                      <p className="truncate text-[11px] text-white/40">{al.artist?.name}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {results.playlists.length > 0 && (
              <div>
                <p className="px-1 text-xs font-semibold text-white/30 mb-2">Playlists</p>
                <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
                  {results.playlists.slice(0, 8).map((pl: any) => (
                    <button key={pl.playlistId} onClick={() => pl.playlistId && onNavigate ? onNavigate('playlist', pl.playlistId) : apply(pl.name)} className="shrink-0 w-[140px] text-left">
                      <img src={pl.thumbnails?.[1]?.url || pl.thumbnails?.[0]?.url || ''} alt={pl.name} className="aspect-square w-full rounded-xl object-cover bg-white/5" referrerPolicy="no-referrer" />
                      <p className="mt-1.5 truncate text-xs font-semibold text-white">{pl.name}</p>
                      <p className="truncate text-[11px] text-white/40">{pl.author}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
