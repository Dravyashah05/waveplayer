import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Compass, Music, Mic2, Disc3, ListMusic, Sparkles, ChevronRight, Zap,
  Flame, Heart, Radio, Waves, Search, Play, TrendingUp, Library, Headphones, Users, Star
} from 'lucide-react';
import { Track, Album, Playlist, SearchArtist } from '../types';
import { getSaavnBrowseModules, searchSaavnArtists } from '../services/saavnApi';
import { playlistRouteId } from '../services/playlistModel';
import { ArtworkImage } from '../components/ArtworkImage';

const MOODS = [
  { id: 'chill', label: 'Chill', sub: 'Lo-fi & mellow', query: 'chill lofi', grad: 'from-[#5ac8fa] via-[#007aff] to-[#0a84ff]', icon: Waves, accent: '#5ac8fa' },
  { id: 'workout', label: 'Workout', sub: 'Pump & run', query: 'workout hits', grad: 'from-[#ff2d55] via-[#ff3b30] to-[#ff9500]', icon: Zap, accent: '#ff2d55' },
  { id: 'party', label: 'Party', sub: 'Dance & neon', query: 'party hits', grad: 'from-[#af52de] via-[#5856d6] to-[#007aff]', icon: Sparkles, accent: '#af52de' },
  { id: 'romance', label: 'Romance', sub: 'Love & late nights', query: 'romantic hits', grad: 'from-[#ff3b30] via-[#ff2d55] to-[#af52de]', icon: Heart, accent: '#ff3b30' },
  { id: 'focus', label: 'Focus', sub: 'Flow & deep work', query: 'focus beats', grad: 'from-[#34c759] via-[#00c7be] to-[#007aff]', icon: Headphones, accent: '#34c759' },
  { id: 'sleep', label: 'Sleep', sub: 'Calm & ambient', query: 'sleep calm', grad: 'from-[#5856d6] via-[#3634a3] to-[#1e1a5a]', icon: Library, accent: '#5856d6' },
];

const GENRES = [
  { label: 'Pop', query: 'pop hits', color: '#ff2d55', icon: '◐' },
  { label: 'Hip-Hop', query: 'hip hop', color: '#5856d6', icon: '◑' },
  { label: 'Bollywood', query: 'bollywood hits', color: '#ff9500', icon: '◎' },
  { label: 'Punjabi', query: 'punjabi hits', color: '#34c759', icon: '⬢' },
  { label: 'K-Pop', query: 'kpop', color: '#af52de', icon: '⬣' },
  { label: 'Rock', query: 'rock hits', color: '#1c1c1e', icon: '⬔' },
  { label: 'Indie', query: 'indie hits', color: '#5ac8fa', icon: '⬕' },
  { label: 'Electronic', query: 'edm', color: '#007aff', icon: '⬓' },
];

const LANGUAGES = ['Hindi', 'Punjabi', 'Tamil', 'Telugu', 'English', 'Bengali', 'Marathi', 'Gujarati'];

const BROWSE = [
  { id: 'songs', label: 'Top Songs', icon: Music, color: '#0a0a0c', desc: 'Viral & trending', count: 'New' },
  { id: 'artists', label: 'Artists', icon: Mic2, color: '#7a5cff', desc: 'Verified voices', count: '1k+' },
  { id: 'albums', label: 'Albums', icon: Disc3, color: '#00c7be', desc: 'Full discographies', count: 'Hot' },
  { id: 'playlists', label: 'Playlists', icon: ListMusic, color: '#ff9500', desc: 'Editorial mixes', count: 'Curated' },
];

const TRENDING_QUERIES = ['arijit singh', 'lofi beats', 'punjabi hits', 'a r rahman', 'weeknd', 'taylor swift', 'sidhu moose wala', 'shreya ghoshal'];

export const ExplorePage: React.FC<{
  onPlay?: (t: Track, list?: Track[]) => void;
  onPlayPlaylist?: (playlist: Playlist) => void;
  onSearch?: (q: string) => void;
  onNavigate?: (page: string, param?: string) => void;
}> = ({ onPlay, onPlayPlaylist, onSearch, onNavigate }) => {
  const [trending, setTrending] = useState<Track[]>([]);
  const [topPlaylists, setTopPlaylists] = useState<Playlist[]>([]);
  const [newAlbums, setNewAlbums] = useState<Album[]>([]);
  const [charts, setCharts] = useState<Playlist[]>([]);
  const [topArtists, setTopArtists] = useState<SearchArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGenre, setActiveGenre] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [browse, artistRes] = await Promise.all([
          getSaavnBrowseModules().catch(() => ({ trending: [], topPlaylists: [], newAlbums: [], charts: [] })),
          searchSaavnArtists('arijit').catch(() => ({ total: 0, artists: [] })),
        ]);
        if (cancelled) return;
        if (browse.trending?.length) setTrending(browse.trending.slice(0, 12));
        if (browse.topPlaylists?.length) setTopPlaylists(browse.topPlaylists.slice(0, 6));
        if (browse.newAlbums?.length) setNewAlbums(browse.newAlbums.slice(0, 6));
        if (browse.charts?.length) setCharts(browse.charts.slice(0, 4));
        if (artistRes.artists?.length) setTopArtists(artistRes.artists.slice(0, 8));
      } catch (e) {
        console.warn('[Explore] load error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const heroTrack = trending[0];

  const handleMood = (m: typeof MOODS[number]) => onSearch?.(m.query);
  const handleGenre = (g: typeof GENRES[number]) => {
    setActiveGenre(g.label);
    onSearch?.(g.query);
  };

  const sectionLinks = [
    { id: 'explore-browse', label: 'Browse' },
    { id: 'explore-moods', label: 'Moods' },
    { id: 'explore-trending', label: 'Trending' },
    { id: 'explore-genres', label: 'Genres' },
    { id: 'explore-languages', label: 'Languages' },
    ...(topPlaylists.length || charts.length ? [{ id: 'explore-playlists', label: 'Playlists & charts' }] : []),
    ...(newAlbums.length ? [{ id: 'explore-albums', label: 'New albums' }] : []),
    ...(topArtists.length ? [{ id: 'explore-artists', label: 'Artists' }] : []),
  ];

  return (
    <div className="space-y-7 sm:space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#86868b] flex items-center gap-1.5">
            <Compass className="h-3.5 w-3.5 text-[#7a5cff]" /> Explore • Discover
          </p>
          <h1 className="mt-1.5 text-[28px] sm:text-[34px] font-black tracking-[-0.04em] leading-none text-white">
            Browse everything
          </h1>
          <p className="mt-2 text-[13px] font-medium text-[#86868b] max-w-[520px] leading-relaxed">
            Moods, languages, charts and fresh drops — curated from JioSaavn. Tap any card to dive into real results.
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3.5 py-2 text-xs font-black shadow-[0_8px_20px_rgba(255,255,255,0.15)]">
          <Radio className="h-3.5 w-3.5" /> Live Browse
        </span>
      </div>

      <nav aria-label="Explore sections" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
        {sectionLinks.map(({ id, label }) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            {label}
          </a>
        ))}
      </nav>

      {/* HERO BENTO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Main hero */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
          className="lg:col-span-8 relative overflow-hidden rounded-[28px] lg-hero min-h-[280px] sm:min-h-[320px] flex flex-col"
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {heroTrack?.thumbnail ? (
              <ArtworkImage src={heroTrack.thumbnail} alt="" className="h-full w-full object-cover scale-110 blur-[32px] opacity-30" referrerPolicy="no-referrer" />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-[#7a5cff] via-[#ff2d55] to-[#007aff] opacity-40" />
            )}
            <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/20 to-black/80" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          </div>

          <div className="relative flex-1 p-6 sm:p-8 flex flex-col justify-between gap-6">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur border border-white/15 px-3 py-1.5 text-[11px] font-bold text-white">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Trending now • {loading ? 'Loading...' : `${trending.length} fresh tracks`}
              </div>
              <button type="button" onClick={() => onSearch?.('trending')} className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white text-black px-4 py-1.5 text-xs font-bold hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 transition-colors">
                Explore all <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div>
              <h2 className="text-[24px] sm:text-[32px] font-black tracking-[-0.03em] leading-none text-white max-w-[560px]">
                Find your next<br />obsession
              </h2>
              <p className="mt-2 text-[13px] font-medium text-white/70 max-w-[520px] line-clamp-2">
                {heroTrack ? `${heroTrack.title} — ${heroTrack.author}` : 'Search for any song, artist or album and get instant 320kbps playback.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {TRENDING_QUERIES.slice(0, 4).map(q => (
                  <button key={q} onClick={() => onSearch?.(q)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-bold text-black hover:bg-white/90 active:scale-95 transition-all">
                    <Search className="h-3 w-3" /> {q}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => heroTrack && onPlay?.(heroTrack, trending)}
                  disabled={!heroTrack}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.12] backdrop-blur border border-white/20 px-4 py-2 text-xs font-bold text-white hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  <Play className="h-3.5 w-3.5 fill-current" /> Play trending
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Side stack */}
        <div className="lg:col-span-4 grid grid-rows-2 gap-3 sm:gap-4">
          <div className="relative overflow-hidden rounded-[24px] border border-white/[0.07] bg-gradient-to-br from-white/[0.06] to-white/[0.02] backdrop-blur p-5 flex flex-col justify-between glass">
            <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-[#7a5cff]/20 blur-2xl" />
            <div className="flex items-center justify-between">
              <span className="h-9 w-9 rounded-xl bg-white text-black grid place-items-center shadow"><Flame className="h-4 w-4 fill-current" /></span>
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#86868b]">New Drops</span>
            </div>
            <div>
              <p className="line-clamp-2 text-[15px] font-bold tracking-[-0.02em] text-white">{newAlbums.length ? newAlbums[0]?.name : loading ? 'Finding new releases…' : 'New releases'}</p>
              <p className="text-xs text-[#86868b] truncate">{newAlbums.length ? newAlbums[0]?.artist.name : loading ? 'Loading editorial picks…' : 'Fresh from JioSaavn'}</p>
              <button onClick={() => onNavigate ? onNavigate('albums') : onSearch?.('new albums')} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white hover:text-[#7a5cff]">Browse albums <ChevronRight className="h-3 w-3" /></button>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[24px] border border-white/[0.07] bg-gradient-to-br from-[#ff9500]/15 to-[#ff2d55]/10 backdrop-blur p-5 flex flex-col justify-between glass">
            <div className="flex items-center justify-between">
              <span className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#ff9500] to-[#ff2d55] text-white grid place-items-center shadow"><TrendingUp className="h-4 w-4" /></span>
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/60">Charts</span>
            </div>
            <div>
              <p className="line-clamp-2 text-[15px] font-bold tracking-[-0.02em] text-white">{charts.length ? charts[0]?.name : 'Top Charts'}</p>
              <p className="text-xs text-white/60 truncate">{charts.length ? `${charts[0]?.videoCount || '50'} songs • Editorial` : 'Weekly most played'}</p>
              <button onClick={() => onNavigate ? onNavigate('playlists') : onSearch?.('charts')} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white hover:text-[#ff9500]">View charts <ChevronRight className="h-3 w-3" /></button>
            </div>
          </div>
        </div>
      </div>

      {/* Browse categories */}
      <div id="explore-browse" className="scroll-mt-24 space-y-3">
        <div className="flex items-end justify-between gap-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em] text-white"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black"><Compass className="h-3.5 w-3.5" /></span>Browse</h2>
          <span className="hidden sm:inline-flex text-[11px] font-medium text-[#6e6e73]">4 categories • tap to explore</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {BROWSE.map(c => (
            <button
              key={c.id}
              type="button"
              aria-label={`Browse ${c.label}: ${c.desc}`}
              onClick={() => {
                if (c.id === 'songs' || c.id === 'playlists' || c.id === 'albums' || c.id === 'artists') {
                  if (onNavigate) onNavigate(c.id);
                  else onSearch?.(c.label.toLowerCase());
                }
              }}
              className="group text-left relative overflow-hidden rounded-[20px] glass p-4 flex items-start justify-between gap-3 transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow ring-1 ring-white/10" style={{ background: c.color }}>
                  <c.icon className="h-5 w-5" />
                </span>
                <p className="mt-3 text-[14px] font-bold tracking-[-0.01em] text-white">{c.label}</p>
                <p className="text-xs text-[#86868b]">{c.desc}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white text-black px-2.5 py-1 text-[11px] font-black">{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mood & Moments — bento 3x2 */}
      <div id="explore-moods" className="scroll-mt-24 space-y-3">
        <div className="flex items-end justify-between gap-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em] text-white"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.06] text-[#aeaeb2]"><Zap className="h-3.5 w-3.5" /></span>Mood & moments</h2>
          <span className="hidden sm:inline-flex text-[11px] font-medium text-[#6e6e73]">{MOODS.length} moods • instant search</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {MOODS.map(m => (
            <button
              key={m.id}
              type="button"
              aria-label={`Explore ${m.label}: ${m.sub}`}
              onClick={() => handleMood(m)}
              className={`group relative overflow-hidden rounded-[20px] sm:rounded-[22px] p-4 sm:p-5 h-[124px] sm:h-[132px] flex flex-col justify-between text-left ring-1 ring-white/[0.06] shadow-[0_8px_24px_rgba(0,0,0,0.30)] bg-gradient-to-br ${m.grad} hover:scale-[1.015] hover:shadow-[0_14px_36px_rgba(0,0,0,0.4)] transition-all`}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-white/[0.07]" />
              <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-white/15 blur-2xl group-hover:bg-white/20 transition-colors" />
              <div className="relative flex items-start justify-between gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur border border-white/20 text-white"><m.icon className="h-4 w-4" /></span>
                <span className="h-7 w-7 rounded-full bg-white text-black grid place-items-center opacity-0 group-hover:opacity-100 -translate-y-1 group-hover:translate-y-0 transition-all"><ChevronRight className="h-4 w-4" /></span>
              </div>
              <div className="relative">
                <p className="text-[16px] font-black tracking-[-0.02em] text-white leading-none">{m.label}</p>
                <p className="text-xs font-medium text-white/85 mt-1">{m.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Trending tracks — real data */}
      <div id="explore-trending" className="scroll-mt-24 space-y-3">
        <div className="flex items-end justify-between gap-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em] text-white"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black"><TrendingUp className="h-3.5 w-3.5" /></span>Trending now</h2>
          <button onClick={() => onSearch?.('trending')} className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white hover:text-black transition-colors shrink-0">See all <ChevronRight className="h-3 w-3" /></button>
        </div>
        {loading ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="min-w-[140px] w-[140px] sm:min-w-[160px] sm:w-[160px] h-[200px] sm:h-[210px] rounded-[18px] bg-white/[0.04] animate-pulse border border-white/[0.06] shrink-0" />
            ))}
          </div>
        ) : trending.length ? (
          <div className="flex gap-3 sm:gap-3.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory">
            {trending.map(t => (
              <button key={t.id} type="button" aria-label={`Play ${t.title} by ${t.author}`} onClick={() => onPlay?.(t, trending)} className="snap-start group cursor-pointer min-w-[140px] w-[140px] sm:min-w-[175px] sm:w-[175px] shrink-0 text-left">
                <div className="relative aspect-square overflow-hidden rounded-[18px] bg-[#18181b] ring-1 ring-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
                  <ArtworkImage src={t.thumbnail} alt={t.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="h-10 w-10 rounded-full bg-white text-black grid place-items-center shadow-lg opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all"><Play className="h-4 w-4 fill-current ml-0.5" /></span>
                  </div>
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 backdrop-blur px-2 py-0.5 text-[10px] font-bold text-white border border-white/10">{t.duration}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] font-bold text-white leading-tight group-hover:text-[#7a5cff] transition-colors">{t.title}</p>
                <p className="truncate text-[11.5px] font-medium text-[#8e8e93]">{t.author}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.03] p-6 text-center text-sm text-[#86868b] glass">No trending tracks yet — try searching above.</div>
        )}
      </div>

      {/* Genres — interactive */}
      <div id="explore-genres" className="scroll-mt-24 space-y-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em] text-white"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.06] text-[#aeaeb2]"><Music className="h-3.5 w-3.5" /></span>Genres</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {GENRES.map(g => (
            <button
              key={g.label}
              type="button"
              aria-pressed={activeGenre === g.label}
              onClick={() => handleGenre(g)}
              className={`group relative overflow-hidden rounded-[20px] p-4 h-[92px] flex flex-col justify-between text-left border transition-all ${activeGenre === g.label ? 'bg-white text-black border-white shadow-[0_8px_20px_rgba(0,0,0,0.4)]' : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08] hover:border-white/10 text-white'}`}
            >
              <div className="flex items-start justify-between">
                <span className="text-[11px] font-black uppercase tracking-[0.08em] opacity-60">{g.icon}</span>
                <span className={`h-6 w-6 rounded-full grid place-items-center border text-[11px] ${activeGenre === g.label ? 'bg-black text-white border-black' : 'bg-white/10 border-white/10 group-hover:bg-white group-hover:text-black'}`}><ChevronRight className="h-3 w-3" /></span>
              </div>
              <p className="text-[15px] font-black tracking-[-0.02em] leading-none">{g.label}</p>
              <div className="absolute -right-6 -bottom-6 h-20 w-20 rounded-full opacity-20 blur-xl" style={{ background: g.color }} />
            </button>
          ))}
        </div>
      </div>

      {/* Languages */}
      <div id="explore-languages" className="scroll-mt-24 rounded-[22px] border border-white/[0.06] bg-white/[0.03] backdrop-blur p-4 sm:p-5 glass">
        <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#86868b]"><Headphones className="h-3.5 w-3.5" /> Browse by language</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {LANGUAGES.map(lang => (
            <button key={lang} onClick={() => onSearch?.(lang.toLowerCase())} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/90 border border-white shadow-sm hover:scale-[1.02] transition-all">
              {lang}
            </button>
          ))}
          <button onClick={() => onSearch?.('bhojpuri')} className="rounded-full bg-white/[0.06] border border-white/[0.08] px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white hover:text-black transition-colors">+ More</button>
        </div>
      </div>

      {/* Charts + Playlists bento */}
      {(topPlaylists.length > 0 || charts.length > 0) && (
        <div id="explore-playlists" className="scroll-mt-24 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          {topPlaylists.length > 0 && (
            <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-4 sm:p-5 glass">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[13px] font-bold text-white"><ListMusic className="h-4 w-4 text-[#ff9500]" /> Top Playlists</h3>
                <button onClick={() => onNavigate ? onNavigate('playlists') : onSearch?.('top playlists')} className="text-xs font-bold text-[#86868b] hover:text-white">See all →</button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {topPlaylists.slice(0, 3).map(pl => (
                  <div key={pl.playlistId} className="group min-w-0 text-left">
                    <div className="relative aspect-square overflow-hidden rounded-[14px] bg-[#18181b] ring-1 ring-white/10 group-hover:ring-white/20 transition-all">
                      <ArtworkImage src={pl.thumbnails?.[0]?.url || ''} alt={pl.name} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      <button type="button" aria-label={`Play playlist ${pl.name}`} onClick={() => onPlayPlaylist?.(pl)} className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-black shadow-lg opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100">
                        <Play className="h-5 w-5 fill-current ml-0.5" />
                      </button>
                    </div>
                    <button type="button" onClick={() => onNavigate?.('playlist', playlistRouteId(pl))} className="mt-2 block w-full line-clamp-2 text-left text-xs font-bold text-white hover:text-[#ff9500]">{pl.name}</button>
                    <p className="truncate text-[11px] text-[#86868b]">{pl.author}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {charts.length > 0 && (
            <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-4 sm:p-5 glass">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[13px] font-bold text-white"><Star className="h-4 w-4 text-[#5856d6]" /> Charts & Rankings</h3>
                <button onClick={() => onSearch?.('charts')} className="text-xs font-bold text-[#86868b] hover:text-white">Explore →</button>
              </div>
              <div className="mt-4 space-y-2.5">
                {charts.map(pl => (
                  <div key={pl.playlistId} className="group flex items-center gap-3 w-full rounded-xl hover:bg-white/[0.04] p-2 -mx-2 transition-colors">
                    <ArtworkImage src={pl.thumbnails?.[0]?.url || ''} alt={pl.name} className="h-12 w-12 rounded-lg object-cover ring-1 ring-white/10" />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onNavigate?.('playlist', playlistRouteId(pl))} className="block max-w-full line-clamp-2 text-left text-[13px] font-bold text-white">{pl.name}</button>
                      <p className="truncate text-xs text-[#86868b]">{pl.videoCount || '50'} songs • Charts</p>
                    </div>
                    <button type="button" onClick={() => onPlayPlaylist?.(pl)} aria-label={`Play playlist ${pl.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white hover:text-black"><Play className="h-4 w-4 fill-current" /></button>
                    <button type="button" onClick={() => onNavigate?.('playlist', playlistRouteId(pl))} aria-label={`Open playlist ${pl.name}`} className="flex h-9 w-8 shrink-0 items-center justify-center text-white/30 hover:text-white"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Albums */}
      {newAlbums.length > 0 && (
        <div id="explore-albums" className="scroll-mt-24 space-y-3">
          <div className="flex items-end justify-between gap-4">
            <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em] text-white"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#00c7be] text-black"><Disc3 className="h-3.5 w-3.5" /></span>New albums & releases</h2>
            <button onClick={() => onNavigate ? onNavigate('albums') : onSearch?.('new albums')} className="inline-flex items-center text-xs font-bold text-[#86868b] hover:text-white shrink-0">See all <ChevronRight className="h-3 w-3 inline" /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {newAlbums.map(al => (
              <button key={al.albumId} onClick={() => onNavigate?.('album', al.albumId)} className="group text-left">
                <div className="aspect-square overflow-hidden rounded-[14px] bg-[#18181b] ring-1 ring-white/10 group-hover:ring-white/20 transition-all">
                  <ArtworkImage src={al.thumbnails?.[0]?.url || ''} alt={al.name} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-bold text-white group-hover:text-[#00c7be]">{al.name}</p>
                <p className="truncate text-[11px] text-[#86868b]">{al.artist.name}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top Artists */}
      {topArtists.length > 0 && (
        <div id="explore-artists" className="scroll-mt-24 space-y-3">
          <div className="flex items-end justify-between gap-4">
            <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.02em] text-white"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#af52de] text-white"><Mic2 className="h-3.5 w-3.5" /></span>Top artists</h2>
            <button onClick={() => onNavigate ? onNavigate('artists') : onSearch?.('top artists')} className="inline-flex items-center text-xs font-bold text-[#86868b] hover:text-white shrink-0">Discover <Users className="h-3 w-3 inline" /></button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {topArtists.map(a => (
              <button key={a.artistId} onClick={() => onNavigate?.('artist', a.artistId)} className="group flex flex-col items-center gap-2">
                <div className="relative aspect-square w-full rounded-full overflow-hidden ring-1 ring-white/10 group-hover:ring-white/30 transition-all bg-[#18181b]">
                  <ArtworkImage src={a.thumbnails?.[0]?.url || ''} alt={a.name} loading="lazy" className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
                </div>
                <p className="w-full line-clamp-2 text-center text-xs font-bold text-white group-hover:text-[#af52de] leading-tight">{a.name}</p>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
