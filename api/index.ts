import { app } from '../server/ytmusic.js';

const SAAVN_TIMEOUT_MS = 12000;
const SAAVN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sendJson(res: any, statusCode: number, data: unknown) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode).json(data);
  } else {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }
}

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
      sendJson(res, 502, { error: `SAAVN_UPSTREAM_${upstream.status}` });
      return;
    }
    const text = await upstream.text();
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      sendJson(res, 502, { error: 'SAAVN_UPSTREAM_INVALID' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (typeof res.status === 'function' && typeof res.send === 'function') {
      res.status(200).send(text);
    } else {
      res.statusCode = 200;
      res.end(text);
    }
  } catch (e: any) {
    clearTimeout(timer);
    const reason = e?.name === 'AbortError' ? 'SAAVN_UPSTREAM_TIMEOUT' : 'SAAVN_UPSTREAM_UNAVAILABLE';
    try {
      sendJson(res, 502, { error: reason });
    } catch {}
  }
}

function normalizeUrl(req: any): string {
  const raw = String(req.url || '/');
  const url = new URL(raw, 'https://wave.invalid');
  const queryParam = (req as any).query?.path;
  const pathParts = queryParam
    ? (Array.isArray(queryParam) ? queryParam : String(queryParam).split('/'))
    : url.searchParams.getAll('path');

  let pathname = url.pathname;
  if (pathParts && pathParts.length > 0) {
    url.searchParams.delete('path');
    pathname = `/api/${pathParts.map((part: string) => encodeURIComponent(part)).join('/')}`;
    req.url = `${pathname}${url.search}`;
  } else if (pathname === '/api/[...]' || pathname === '/api/index' || pathname === '/api') {
    req.url = `/api/${url.search}`;
    pathname = '/api/';
  }
  return pathname;
}

export default async function handler(req: any, res: any) {
  let pathname = '/';
  try {
    pathname = normalizeUrl(req);
  } catch {
    // fall through to Express app
  }

  // Safe health endpoint — zero external service dependencies
  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'wave-player' });
    return;
  }

  if (pathname === '/api/saavn') {
    await handleSaavnInline(req, res);
    return;
  }

  // Delegate all other API routes to Express, waiting for the HTTP response stream to finish.
  return new Promise<void>((resolve) => {
    let finished = false;
    const onFinish = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };
    res.once('finish', onFinish);
    res.once('close', onFinish);
    res.once('error', onFinish);

    try {
      app(req, res);
    } catch (e: any) {
      console.error('[api] express dispatch error:', String(e?.message || e).slice(0, 300));
      if (!res.headersSent) {
        // Stable code only — never upstream messages, paths or internals.
        sendJson(res, 500, { error: 'INTERNAL_SERVER_ERROR' });
      }
      onFinish();
    }
  });
}
