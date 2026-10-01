import 'dotenv/config';
import express from 'express';
import YTMusic from 'ytmusic-api';
import { resolveYouTubeAudio, YOUTUBE_VIDEO_ID } from './youtubeStream.js';
import { registerYoutubeRoutes } from './googleYouTube.js';
import { pathToFileURL } from 'node:url';

const app = express();
app.use(express.json({ limit: '1mb' }));
registerYoutubeRoutes(app);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'wave-player' }));

let ytmusic: YTMusic | null = null;
let initPromise: Promise<void> | null = null;

async function getYTMusic(): Promise<YTMusic> {
  if (ytmusic) return ytmusic;
  if (initPromise) await initPromise;
  if (ytmusic) return ytmusic;
  const instance = new YTMusic();
  initPromise = instance.initialize().then(() => {
    ytmusic = instance;
    console.log('[YTMusic] initialized');
  }).catch(err => {
    console.error('[YTMusic] init failed', err);
    initPromise = null;
    throw err;
  });
  await initPromise;
  return ytmusic!;
}

// --- LRC parsing ---
function parseLRC(lrc: string): Array<{ time: number; text: string }> {
  const lines: Array<{ time: number; text: string }> = [];
  const regex = /\[(\d+):(\d+)\.(\d+)\](.*)/;
  for (const raw of lrc.split('\n')) {
    const m = raw.match(regex);
    if (!m) continue;
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const cs = parseInt(m[3].padEnd(2, '0').slice(0, 2), 10); // centiseconds
    const time = min * 60 + sec + cs / 100;
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  // sort just in case
  lines.sort((a, b) => a.time - b.time);
  return lines;
}
function isValidSynced(lines: Array<{ time: number; text: string }>): boolean {
  if (!lines.length) return false;
  if (lines.length === 1 && /^(probe|instrumental)$/i.test(lines[0].text.trim())) return false;
  if (lines.length < 3) {
    const plainLen = lines.reduce((s, l) => s + l.text.length, 0);
    if (plainLen < 20) return false;
  }
  return true;
}
function isValidPlain(plain: string[] | null): boolean {
  if (!plain || !plain.length) return false;
  if (plain.length === 1 && /^(probe|instrumental)$/i.test(plain[0].trim())) return false;
  const total = plain.join(' ').trim().length;
  if (total < 20) return false;
  return true;
}

async function fetchLrclibSynced(artist: string, track: string, album: string, duration: number): Promise<{ synced: Array<{ time: number; text: string }> | null; plain: string[] | null; source: string | null }> {
  // Use first artist only to improve matching (handles "A, B & C" cases)
  const artistFirst = artist.split(',')[0].split('&')[0].trim();
  const trackClean = track.trim();
  const tries: Array<URLSearchParams> = [];
  // Try exact with first artist + track + duration, then without duration, then track only
  for (const a of [artistFirst, artistFirst ? artistFirst : '', ''].filter((v, i, arr) => arr.indexOf(v) === i)) {
    const p1 = new URLSearchParams();
    if (a) p1.set('artist_name', a);
    if (trackClean) p1.set('track_name', trackClean);
    if (album) p1.set('album_name', album);
    if (duration) p1.set('duration', String(Math.round(duration)));
    tries.push(p1);
    if (duration) {
      const p2 = new URLSearchParams(p1); p2.delete('duration'); tries.push(p2);
    }
  }
  // Also try track only
  if (trackClean) {
    const pTrack = new URLSearchParams(); pTrack.set('track_name', trackClean); tries.push(pTrack);
  }

  for (const params of tries) {
    const urls = [
      `https://lrclib.net/api/get?${params.toString()}`,
      `https://lrclib.net/api/get_cached?${params.toString()}`,
    ];
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'WavePlayer/1.0' } });
        clearTimeout(t);
        if (!res.ok) continue;
        const data: any = await res.json();
        if (!data) continue;
        if (data.syncedLyrics) {
          const synced = parseLRC(String(data.syncedLyrics));
          if (isValidSynced(synced)) return { synced, plain: data.plainLyrics ? String(data.plainLyrics).split('\n').map((s: string) => s.trim()).filter(Boolean) : null, source: 'lrclib' };
        }
        if (data.plainLyrics) {
          const plain = String(data.plainLyrics).split('\n').map((s: string) => s.trim()).filter(Boolean);
          if (isValidPlain(plain)) return { synced: null, plain, source: 'lrclib-plain' };
        }
      } catch {}
    }
  }
  // Fallback: search endpoint with multiple queries
  const queries = [
    `${trackClean} ${artistFirst}`.trim(),
    trackClean,
    `${trackClean} ${artist}`.trim(),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);
  for (const qRaw of queries.slice(0, 2)) {
    try {
      const q = encodeURIComponent(qRaw);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`https://lrclib.net/api/search?q=${q}`, { signal: controller.signal, headers: { 'User-Agent': 'WavePlayer/1.0' } });
      clearTimeout(t);
      if (!res.ok) continue;
      const arr: any[] = await res.json();
      if (!Array.isArray(arr) || !arr.length) continue;
      // pick best by duration closeness and prefer synced
      let best = arr.find((x: any) => x.syncedLyrics) || arr[0];
      if (duration) {
        let bestDiff = Infinity;
        for (const it of arr) {
          if (!it.syncedLyrics) continue;
          const d = Math.abs((it.duration || 0) - duration);
          if (d < bestDiff) { bestDiff = d; best = it; }
        }
        // if bestDiff too large (>15s) fallback to first synced
        if (bestDiff === Infinity) best = arr.find((x: any) => x.syncedLyrics) || arr[0];
      }
      if (best?.syncedLyrics) {
        const synced = parseLRC(String(best.syncedLyrics));
        if (isValidSynced(synced)) return { synced, plain: best.plainLyrics ? String(best.plainLyrics).split('\n').map((s: string) => s.trim()).filter(Boolean) : null, source: 'lrclib-search' };
      }
      if (best?.plainLyrics) {
        const plain = String(best.plainLyrics).split('\n').map((s: string) => s.trim()).filter(Boolean);
        if (isValidPlain(plain)) return { synced: null, plain, source: 'lrclib-search-plain' };
      }
    } catch {}
  }
  return { synced: null, plain: null, source: null };
}

function shortError(e: any): string {
  if (e?.code === 'ENOTFOUND') return `DNS ENOTFOUND ${e.hostname || ''}`.trim();
  return String(e?.message || e).slice(0, 300);
}

// Vercel serverless kills the function at maxDuration (30s) with a 500, so
// every upstream call in the lyrics flow must be time-boxed well under that.
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

// Health
app.get('/api/ytmusic/health', async (_req, res) => {
  try {
    await getYTMusic();
    res.json({ ok: true, status: 'ready' });
  } catch (e:any) {
    console.error('[YTMusic] health check failed:', shortError(e));
    res.status(500).json({ ok: false, error: shortError(e) });
  }
});

// Unified search with filter support
app.get('/api/ytmusic/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = String(req.query.filter || 'all').toLowerCase();
  if (!q) return res.status(400).json({ error: 'missing q' });
  try {
    const yt = await getYTMusic();
    let results: any[] = [];
    switch(filter) {
      case 'songs': results = await yt.searchSongs(q); break;
      case 'videos': results = await yt.searchVideos(q); break;
      case 'albums': results = await yt.searchAlbums(q); break;
      case 'playlists': results = await yt.searchPlaylists(q); break;
      case 'artists': results = await yt.searchArtists(q); break;
      default: results = await yt.search(q); break;
    }
    res.json(results);
  } catch (e:any) {
    console.error('[YTMusic] search error:', shortError(e));
    res.status(500).json({ error: shortError(e) });
  }
});

// Suggestions
app.get('/api/ytmusic/suggestions', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const yt = await getYTMusic();
    const sug = await yt.getSearchSuggestions(q);
    res.json(sug);
  } catch (e:any) {
    console.error('[YTMusic] suggestions error:', shortError(e));
    // suggestions are non-critical — return empty instead of 500 to keep UI responsive offline
    res.json([]);
  }
});

// Home sections
app.get('/api/ytmusic/home', async (_req, res) => {
  try {
    const yt = await getYTMusic();
    const home = await yt.getHomeSections();
    res.json(home);
  } catch (e:any) {
    console.error('[YTMusic] home error:', shortError(e));
    // offline/no DNS — return empty rather than 500 so HomePage shows mock data gracefully
    if (e?.code === 'ENOTFOUND' || String(e?.message || '').includes('ENOTFOUND')) {
      return res.json([]);
    }
    res.status(500).json({ error: shortError(e) });
  }
});

// Song details + lyrics + upnext combined
app.get('/api/ytmusic/song/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'invalid videoId' });
  try {
    const yt = await getYTMusic();
    const [song, lyrics, upNext] = await Promise.all([
      yt.getSong(id).catch(() => null),
      yt.getLyrics(id).catch(() => null),
      yt.getUpNexts(id).catch(() => []),
    ]);
    res.json({ song, lyrics, upNext });
  } catch (e:any) {
    console.error('[YTMusic] song error:', shortError(e));
    res.status(500).json({ error: shortError(e) });
  }
});

// --- REDESIGNED LYRICS endpoint: synced via lrclib + ytmusic plain fallback — resilient to YTMusic offline ---
// Serverless budget: Vercel Hobby kills functions at ~10s, so the whole flow
// must finish fast. YTMusic init + oEmbed run IN PARALLEL (not sequentially),
// and every stage is tightly time-boxed.
app.get('/api/ytmusic/lyrics/:id', async (req,res)=>{
  const id=req.params.id;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return res.status(400).json({ error: 'invalid videoId' });
  // Cache at the edge: lyrics never change, repeat views shouldn't re-hit upstream.
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  try {
    let ytmLyrics: any = null;
    let artist = '';
    let track = '';
    let album = '';
    let duration = 0;

    const ytmWork = (async () => {
      try {
        const yt = await getYTMusic();
        const [s, l] = await Promise.all([
          yt.getSong(id).catch(() => null),
          yt.getLyrics(id).catch(() => null),
        ]);
        return { s, l } as const;
      } catch {
        return { s: null, l: null } as const;
      }
    })();
    const oembedWork = (async () => {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 3000);
        const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, { signal: controller.signal, headers: { 'User-Agent': 'WavePlayer/1.0' } });
        clearTimeout(t);
        if (!r.ok) return null;
        const j: any = await r.json();
        return { title: String(j.title || '').trim(), author: String(j.author_name || '').trim() };
      } catch {
        return null;
      }
    })();

    // Parallel metadata: YTMusic gets 4.5s, oEmbed races alongside (3s internal).
    const [{ s: song, l }, oembed] = await Promise.all([
      withTimeout(ytmWork, 4500, { s: null, l: null }),
      withTimeout(oembedWork, 3500, null),
    ]);
    ytmLyrics = l;
    artist = String((song as any)?.artist?.name || (song as any)?.author || '').trim();
    track = String((song as any)?.name || (song as any)?.title || '').trim();
    album = String((song as any)?.album?.name || '').trim();
    duration = Number((song as any)?.duration || 0);
    if ((!artist && !track) && oembed?.title) {
      artist = oembed.author || '';
      track = oembed.title || '';
    }

    // Single lrclib lookup with a tight budget.
    if (artist || track) {
      const lrclib = await withTimeout(fetchLrclibSynced(artist, track, album, duration), 6000, { synced: null, plain: null, source: null });
      if (lrclib.synced?.length) {
        return res.json({ synced: lrclib.synced, plain: lrclib.plain || ytmLyrics || null, lyrics: ytmLyrics || lrclib.plain || null, source: lrclib.source, artist, track, duration });
      }
      const plain = (lrclib.plain && lrclib.plain.length ? lrclib.plain : Array.isArray(ytmLyrics) ? ytmLyrics : null);
      if (plain && plain.length) {
        return res.json({ synced: null, plain, lyrics: plain, source: lrclib.source || 'ytmusic', artist, track, duration });
      }
      if (Array.isArray(ytmLyrics) && ytmLyrics.length) {
        return res.json({ synced: null, plain: ytmLyrics, lyrics: ytmLyrics, source: 'ytmusic', artist, track, duration });
      }
    } else if (Array.isArray(ytmLyrics) && ytmLyrics.length) {
      return res.json({ synced: null, plain: ytmLyrics, lyrics: ytmLyrics, source: 'ytmusic', artist, track, duration });
    }

    // No lyrics found — return empty but 200 so frontend shows "No lyrics" instead of 500 spinner
    return res.json({ synced: null, plain: null, lyrics: null, source: null, artist, track, duration });
  } catch(e:any){
    console.error('[YTMusic] lyrics error:', shortError(e));
    // Never return 500 for lyrics — return empty gracefully so UI doesn't spin forever
    res.json({ synced: null, plain: null, lyrics: null, source: null, artist: '', track: '', duration: 0 });
  }
});

app.get('/api/ytmusic/upnext/:id', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const up=await yt.getUpNexts(id); res.json(up); }
  catch(e:any){ console.error('[YTMusic] upnext error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

app.get('/api/ytmusic/video/:id', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const v=await yt.getVideo(id); res.json(v); }
  catch(e:any){ console.error('[YTMusic] video error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

app.get('/api/ytmusic/stream/:videoId', async (req, res) => {
  const videoId = req.params.videoId;
  if (!YOUTUBE_VIDEO_ID.test(videoId)) {
    return res.status(400).json({ success: false, error: 'INVALID_VIDEO_ID' });
  }
  try {
    const yt = await getYTMusic();
    const result = await resolveYouTubeAudio(videoId, (id) => yt.getSong(id));
    if (!result) return res.status(404).json({ success: false, error: 'AUDIO_STREAM_NOT_AVAILABLE' });
    return res.json({ success: true, ...result });
  } catch {
    return res.status(503).json({ success: false, error: 'STREAM_RESOLUTION_FAILED' });
  }
});

app.get('/api/ytmusic/album/:id', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const album=await yt.getAlbum(id); res.json(album); }
  catch(e:any){ console.error('[YTMusic] album error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

app.get('/api/ytmusic/playlist/:id', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const pl=await yt.getPlaylist(id); res.json(pl); }
  catch(e:any){ console.error('[YTMusic] playlist error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

app.get('/api/ytmusic/playlist/:id/videos', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const vids=await yt.getPlaylistVideos(id); res.json(vids); }
  catch(e:any){ console.error('[YTMusic] playlist videos error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

app.get('/api/ytmusic/artist/:id', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const artist=await yt.getArtist(id); res.json(artist); }
  catch(e:any){ console.error('[YTMusic] artist error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

app.get('/api/ytmusic/artist/:id/songs', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const songs=await yt.getArtistSongs(id); res.json(songs); }
  catch(e:any){ console.error('[YTMusic] artist songs error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

app.get('/api/ytmusic/artist/:id/albums', async (req,res)=>{
  const id=req.params.id;
  try { const yt=await getYTMusic(); const albums=await yt.getArtistAlbums(id); res.json(albums); }
  catch(e:any){ console.error('[YTMusic] artist albums error:', shortError(e)); res.status(500).json({ error: shortError(e) }); }
});

// JioSaavn proxy endpoint — hardened for Vercel serverless (datacenter IPs get
// throttled/blocked by JioSaavn, so: short timeout, browser-like headers,
// forward upstream status as 502 instead of 500 so the frontend falls back
// gracefully instead of treating it as a crash).
app.all('/api/saavn', async (req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const url = new URL('https://www.jiosaavn.com/api.php');
    Object.entries(req.query).forEach(([k, v]) => {
      if (k === 'path') return;
      url.searchParams.append(k, Array.isArray(v) ? String(v[0]) : String(v));
    });
    const saavnRes = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.jiosaavn.com/',
        'Origin': 'https://www.jiosaavn.com',
      },
    });
    clearTimeout(timer);
    if (!saavnRes.ok) {
      return res.status(502).json({ error: `SAAVN_UPSTREAM_${saavnRes.status}` });
    }
    const data = await saavnRes.text();
    // JioSaavn sometimes returns HTML (block page) — don't forward as JSON.
    const trimmed = data.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return res.status(502).json({ error: 'SAAVN_UPSTREAM_INVALID' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      return res.status(502).json({ error: 'SAAVN_UPSTREAM_TIMEOUT' });
    }
    console.error('[JioSaavn Proxy Error]:', shortError(e));
    res.status(502).json({ error: 'SAAVN_UPSTREAM_UNAVAILABLE' });
  }
});

// Fallback 404
app.use('/api/ytmusic', (_req,res)=> res.status(404).json({ error:'not found' }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  console.error('[API] unhandled request error');
  return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

export { app };

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  const PORT = Number(process.env.YTMUSIC_PORT || 8001);
  app.listen(PORT, () => {
    console.log(`[YTMusic API] listening on port ${PORT}`);
    // Start discovery metadata warmup only for the persistent local server.
    getYTMusic().catch(e => console.error('Eager init failed', shortError(e)));
  });
}
