// Vercel serverless entry — hardened against total-function failure.
//
// Observed: every /api/* route returned bare 500 on Vercel while the same
// express app works locally. A static `import { app }` means one broken
// dependency (or one throwing middleware) takes down ALL routes with an
// opaque 500. So:
//  1. /api/saavn is handled inline here with zero app dependencies — search,
//     browse and radio keep working even if the main app module fails.
//  2. The express app is lazy-imported per invocation; load failures become
//     a JSON 503 with a reason instead of an opaque 500.
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
      if (!res.headersSent) res.status(503).json({ error: 'API_INIT_FAILED' });
    } catch {}
  }
}
