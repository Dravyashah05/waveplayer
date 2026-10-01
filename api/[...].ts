// Vercel serverless entry — hardened against total-function failure.
//
// Observed: every /api/* route returned bare 500 on Vercel while the same
// express app works locally. A static `import { app }` means one broken
// dependency (or one throwing middleware) takes down ALL routes with an
// opaque 500. So:
//  1. /api/saavn is handled inline here with zero app dependencies — search,
//     browse and radio keep working even if the main app module fails.
//  2. The express app is lazy-imported per invocation; load failures fall back
//     to graceful inline handlers (lyrics → oEmbed+lrclib, auth → disconnected)
//     instead of an opaque 500/503.
//  3. URL normalization doesn't depend on `req.query.path` being present.

const SAAVN_TIMEOUT_MS = 12000;
const SAAVN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function handleSaavnInline(req: any, res: any) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAAVN_TIMEOUT_MS);
  try {
    const fullUrl = new URL(String(req.url || '/api/saavn'), 'https://wave.invalid');
    const target = new URL('https://www.jiosaavn.com/api.php');
    fullUrl.searchParams.forEach((value, key) => {
      if (key === 'path') return;
      target.searchParams.append(key, value);
    });
    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': SAAVN_UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.jiosaavn.com/',
        Origin: 'https://www.jiosaavn.com',
      },
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      res.status(502).json({ error: `SAAVN_UPSTREAM_${upstream.status}` });
      return;
    }
    const text = await upstream.text();
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      res.status(502).json({ error: 'SAAVN_UPSTREAM_INVALID' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (e: any) {
    clearTimeout(timer);
    const reason = e?.name === 'AbortError' ? 'SAAVN_UPSTREAM_TIMEOUT' : 'SAAVN_UPSTREAM_UNAVAILABLE';
    try {
      res.status(502).json({ error: reason });
    } catch {}
  }
}

function normalizeUrl(req: any): string {
  const raw = String(req.url || '/');
  const url = new URL(raw, 'https://wave.invalid');
  const queryPath = (req as any).query?.path;
  let pathname = url.pathname;
  if (queryPath && (!Array.isArray(queryPath) || queryPath.length > 0)) {
    const segments = Array.isArray(queryPath) ? queryPath : String(queryPath).split('/');
    url.searchParams.delete('path');
    pathname = `/api/${segments.map((part: string) => encodeURIComponent(part)).join('/')}`;
    req.url = `${pathname}${url.search}`;
  } else if (pathname === '/api/[...]') {
    // Rewrite leaked through without params — recover from referer-less path is
    // impossible; let the app return its 404 JSON.
    req.url = `/api/${url.search}`;
    pathname = '/api/';
  }
  // Defensive: some runtimes don't populate req.query for programmatic use.
  // Express parses req.url itself, so nothing else is required here.
  return pathname;
}

function parseLRCInline(lrc: string): Array<{ time: number; text: string }> {
  const lines: Array<{ time: number; text: string }> = [];
  const regex = /\[(\d+):(\d+)\.(\d+)\](.*)/;
  for (const raw of String(lrc || '').split('\n')) {
    const m = raw.match(regex);
    if (!m) continue;
    const time = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3].padEnd(2, '0').slice(0, 2), 10) / 100;
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines.filter((l) => l.text && !/^(probe|instrumental)$/i.test(l.text.trim()));
}

// Zero-dependency lyrics fallback: oEmbed (title/artist) + lrclib. Used only
// when the full express app fails to load, so lyrics degrades to 200 with
// plain/synced data (or empty) instead of a 503 console error.
async function handleLyricsInline(pathname: string, res: any) {
  const id = pathname.split('/').pop() || '';
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    res.status(400).json({ error: 'invalid videoId' });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, { signal: ctrl.signal, headers: { 'User-Agent': 'WavePlayer/1.0' } });
    clearTimeout(t);
    if (!r.ok) {
      res.json({ synced: null, plain: null, lyrics: null, source: null, artist: '', track: '', duration: 0 });
      return;
    }
    const j: any = await r.json();
    const title = String(j.title || '').trim();
    const author = String(j.author_name || '').trim();
    if (!title) {
      res.json({ synced: null, plain: null, lyrics: null, source: null, artist: author, track: title, duration: 0 });
      return;
    }
    const params = new URLSearchParams({ track_name: title });
    if (author) params.set('artist_name', author);
    const lctrl = new AbortController();
    const lt = setTimeout(() => lctrl.abort(), 4000);
    const lr = await fetch(`https://lrclib.net/api/get?${params.toString()}`, { signal: lctrl.signal, headers: { 'User-Agent': 'WavePlayer/1.0' } });
    clearTimeout(lt);
    if (!lr.ok) {
      res.json({ synced: null, plain: null, lyrics: null, source: null, artist: author, track: title, duration: 0 });
      return;
    }
    const data: any = await lr.json();
    if (data?.syncedLyrics) {
      const synced = parseLRCInline(String(data.syncedLyrics));
      if (synced.length >= 3) {
        const plain = data.plainLyrics ? String(data.plainLyrics).split('\n').map((s: string) => s.trim()).filter(Boolean) : null;
        res.json({ synced, plain, lyrics: plain, source: 'lrclib', artist: author, track: title, duration: 0 });
        return;
      }
    }
    if (data?.plainLyrics) {
      const plain = String(data.plainLyrics).split('\n').map((s: string) => s.trim()).filter(Boolean);
      if (plain.join(' ').length >= 20) {
        res.json({ synced: null, plain, lyrics: plain, source: 'lrclib-plain', artist: author, track: title, duration: 0 });
        return;
      }
    }
    res.json({ synced: null, plain: null, lyrics: null, source: null, artist: author, track: title, duration: 0 });
  } catch {
    try { res.json({ synced: null, plain: null, lyrics: null, source: null, artist: '', track: '', duration: 0 }); } catch {}
  }
}

export default async function handler(req: any, res: any) {
  let pathname = '/';
  try {
    pathname = normalizeUrl(req);
  } catch {
    // fall through to app 404
  }

  if (pathname === '/api/saavn') {
    await handleSaavnInline(req, res);
    return;
  }

  try {
    const mod = await import('../server/ytmusic');
    return (mod as any).app(req, res);
  } catch (e: any) {
    console.error('[api] app load/handle failed:', String(e?.message || e).slice(0, 300));
    try {
      if (res.headersSent) return;
      // Graceful degradation instead of 503 noise:
      // - lyrics: answer inline (frontend falls back to direct lrclib anyway)
      // - auth status: answer disconnected (GoogleAccountCard handles it)
      if (pathname.startsWith('/api/ytmusic/lyrics/')) {
        await handleLyricsInline(pathname, res);
        return;
      }
      if (pathname === '/api/auth/me' || pathname === '/api/auth/youtube/status') {
        res.json({ connected: false, user: null, youtubeConnected: false, scopes: [] });
        return;
      }
      res.status(503).json({ error: 'API_INIT_FAILED' });
    } catch {}
  }
}
