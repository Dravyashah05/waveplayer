import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';

type GoogleUser = { id: string; email: string; name: string; picture?: string };
type Credentials = { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string[] };
type Session = { user?: GoogleUser; google?: Credentials; youtube?: Credentials; pending?: { state: string; kind: 'login' | 'youtube'; verifier: string; expiresAt: number } };
const sessions = new Map<string, Session>();
const COOKIE = 'wave_session';
const IDENTITY = ['openid', 'email', 'profile'];
const YOUTUBE_READ = 'https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE_WRITE = 'https://www.googleapis.com/auth/youtube';
const responseCache = new Map<string, { expiresAt: number; value: any }>();
type RequestSession = { id: string; value: Session; deleted?: boolean };
const requestSessions = new WeakMap<Request, RequestSession>();

async function redisCommand<T>(...command: string[]): Promise<T> {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!endpoint || !token) throw new Error('SESSION_STORE_NOT_CONFIGURED');
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) });
  if (!response.ok) throw new Error('SESSION_STORE_UNAVAILABLE');
  const result: any = await response.json();
  if (result.error) throw new Error('SESSION_STORE_UNAVAILABLE');
  return result.result as T;
}
function clearUserCache(userId?: string) {
  if (!userId) return;
  for (const key of responseCache.keys()) if (key.startsWith(`${userId}:`)) responseCache.delete(key);
}

function sessionFor(req: Request, res: Response): Session {
  const existing = requestSessions.get(req);
  if (existing) return existing.value;
  const raw = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  let id = raw;
  if (!id || !/^[a-f0-9]{64}$/.test(id) || !sessions.has(id)) {
    id = randomBytes(32).toString('hex');
    sessions.set(id, {});
    res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  }
  return sessions.get(id)!;
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function config(res: Response): boolean {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI) return true;
  res.status(503).json({ error: 'GOOGLE_NOT_CONFIGURED' }); return false;
}
function fail(res: Response, error: unknown) {
  const e = error as any;
  const status = Number(e?.status || 502);
  const reason = String(e?.reason || e?.message || 'YOUTUBE_API_ERROR');
  if (['GOOGLE_NOT_CONNECTED', 'YOUTUBE_NOT_CONNECTED', 'GOOGLE_REAUTH_REQUIRED', 'INSUFFICIENT_SCOPE', 'PLAYLIST_NOT_FOUND', 'PRIVATE_PLAYLIST', 'VIDEO_NOT_AVAILABLE'].includes(reason)) return res.status(status >= 400 && status < 600 ? status : 400).json({ error: reason });
  const code = /quotaExceeded|dailyLimitExceeded/i.test(reason) ? 'YOUTUBE_QUOTA_EXCEEDED' : /insufficientPermissions|forbidden/i.test(reason) ? 'INSUFFICIENT_SCOPE' : /invalid_grant/i.test(reason) ? 'GOOGLE_REAUTH_REQUIRED' : 'YOUTUBE_API_ERROR';
  res.status(status >= 400 && status < 600 ? status : 502).json({ error: code });
}
async function requestToken(credentials: Credentials, session: Session): Promise<string> {
  if (credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken;
  if (!credentials.refreshToken) throw Object.assign(new Error('GOOGLE_REAUTH_REQUIRED'), { status: 401, reason: 'invalid_grant' });
  const body = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data: any = await response.json();
  if (!response.ok) { session.google = undefined; session.youtube = undefined; throw Object.assign(new Error(data.error || 'token refresh failed'), { status: 401, reason: data.error }); }
  credentials.accessToken = data.access_token; credentials.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return credentials.accessToken;
}
async function ytApi(session: Session, path: string, init: RequestInit = {}, fresh = false): Promise<any> {
  if (!session.user) throw Object.assign(new Error('GOOGLE_NOT_CONNECTED'), { status: 401, reason: 'GOOGLE_NOT_CONNECTED' });
  if (!session.youtube) throw Object.assign(new Error('YOUTUBE_NOT_CONNECTED'), { status: 401, reason: 'YOUTUBE_NOT_CONNECTED' });
  try {
    const isGet = !init.method || init.method.toUpperCase() === 'GET';
    const cacheKey = `${session.user.id}:${path}`;
    if (isGet && !fresh) { const hit = responseCache.get(cacheKey); if (hit && hit.expiresAt > Date.now()) return hit.value; }
    const token = await requestToken(session.youtube, session);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.message;
      if (response.status === 401 && session.youtube.refreshToken) { session.youtube.expiresAt = 0; return ytApi(session, path, init, fresh); }
      throw Object.assign(new Error(reason || 'YouTube API error'), { status: response.status, reason });
    }
    if (isGet) responseCache.set(cacheKey, { value: data, expiresAt: Date.now() + 45_000 });
    return data;
  } catch (error: any) {
    if (error?.message === 'GOOGLE_REAUTH_REQUIRED') { session.google = undefined; session.youtube = undefined; }
    throw error;
  }
}
async function tokenExchange(code: string, verifier: string) {
  const body = new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: process.env.GOOGLE_REDIRECT_URI!, grant_type: 'authorization_code', code_verifier: verifier });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data: any = await response.json();
  if (!response.ok) throw new Error('OAUTH_EXCHANGE_FAILED');
  return { accessToken: data.access_token as string, refreshToken: data.refresh_token as string | undefined, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000, scopes: String(data.scope || '').split(' ').filter(Boolean) } satisfies Credentials;
}
function startOAuth(session: Session, kind: 'login' | 'youtube', res: Response) {
  if (!config(res)) return;
  const state = randomBytes(32).toString('hex'); const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  session.pending = { state, kind, verifier, expiresAt: Date.now() + 10 * 60_000 };
  const scopes = kind === 'login' ? IDENTITY : [YOUTUBE_WRITE];
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: process.env.GOOGLE_REDIRECT_URI!, response_type: 'code', scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: kind === 'login' ? 'select_account' : 'consent', include_granted_scopes: 'true' }).forEach(([k, v]) => url.searchParams.set(k, v));
  res.redirect(url.toString());
}
function playlist(item: any) {
  const s = item.snippet || {}; const d = item.contentDetails || {}; const status = item.status?.privacyStatus || 'private';
  return { id: item.id, title: s.title || '', description: s.description || '', thumbnail: s.thumbnails?.maxres?.url || s.thumbnails?.high?.url || s.thumbnails?.default?.url || '', itemCount: d.itemCount ?? 0, privacy: status, source: 'youtube', youtubePlaylistId: item.id };
}
function registerYoutubeRoutes(app: Express) {
  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/auth/') && !req.path.startsWith('/api/youtube/')) return next();
    const raw = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    let id = raw && /^[a-f0-9]{64}$/.test(raw) ? raw : randomBytes(32).toString('hex');
    let session: Session = {};
    try {
      if (process.env.NODE_ENV === 'production') {
        const serialized = await redisCommand<string | null>('GET', `wave:sessions:${id}`);
        if (serialized) session = JSON.parse(serialized);
      } else {
        session = sessions.get(id) || {};
      }
    } catch {
      return res.status(503).json({ error: 'SESSION_STORE_UNAVAILABLE' });
    }
    sessions.set(id, session);
    const record = { id, value: session } as RequestSession;
    requestSessions.set(req, record);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    const persist = async () => {
      if (process.env.NODE_ENV === 'production') {
        if (record.deleted) await redisCommand('DEL', `wave:sessions:${record.id}`);
        else await redisCommand('SET', `wave:sessions:${record.id}`, JSON.stringify(record.value), 'EX', '2592000');
      } else if (record.deleted) sessions.delete(record.id);
      else sessions.set(record.id, record.value);
    };
    if (process.env.NODE_ENV === 'production') {
      const originalEnd = res.end.bind(res);
      let ending = false;
      (res as any).end = (...args: any[]) => {
        if (ending) return res;
        ending = true;
        void persist().catch(() => {}).finally(() => originalEnd(...args));
        return res;
      };
    } else res.on('finish', () => { void persist(); });
    next();
  });
  app.get('/api/auth/google', (req, res) => startOAuth(sessionFor(req, res), 'login', res));
  app.get('/api/auth/google/callback', async (req, res) => {
    const session = sessionFor(req, res); const pending = session.pending; session.pending = undefined;
    if (!pending || pending.expiresAt < Date.now() || typeof req.query.state !== 'string' || !safeEqual(pending.state, req.query.state)) return res.status(400).send('Google sign-in could not be verified. Please start again.');
    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const frontend = (process.env.FRONTEND_URL || (vercelHost ? `https://${vercelHost}` : process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001')).replace(/\/+$/, '');
    if (!frontend) return res.status(503).send('OAuth frontend URL is not configured.');
    if (req.query.error) return res.redirect(`${frontend}/?google=cancelled`);
    try {
      const credentials = await tokenExchange(String(req.query.code || ''), pending.verifier);
      if (pending.kind === 'login') {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${credentials.accessToken}` } });
        if (!response.ok) throw new Error('GOOGLE_PROFILE_FAILED');
        const profile: any = await response.json();
        session.user = { id: profile.sub, name: profile.name || '', email: profile.email || '', picture: profile.picture };
        session.google = credentials;
      } else {
        if (!session.user) return res.redirect(`${frontend}/?google=required`);
        session.youtube = { ...credentials, refreshToken: credentials.refreshToken || session.youtube?.refreshToken };
      }
      res.redirect(`${frontend}/?google=connected`);
    } catch { res.redirect(`${frontend}/?google=error`); }
  });
  app.get('/api/auth/me', (req, res) => { const s = sessionFor(req, res); res.json({ connected: !!s.user, user: s.user || null, youtubeConnected: !!s.youtube, scopes: s.youtube?.scopes || [] }); });
  app.post('/api/auth/logout', (req, res) => {
    const id = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (id) {
      sessions.delete(id);
      const record = requestSessions.get(req);
      if (record) record.deleted = true;
    }
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); res.json({ ok: true });
  });
  app.get('/api/auth/youtube/status', (req, res) => { const s = sessionFor(req, res); res.json({ connected: !!s.youtube, scopes: s.youtube?.scopes || [] }); });
  app.get('/api/auth/youtube/connect', (req, res) => { const s = sessionFor(req, res); if (!s.user) return res.status(401).json({ error: 'GOOGLE_NOT_CONNECTED' }); startOAuth(s, 'youtube', res); });
  app.post('/api/auth/youtube/disconnect', (req, res) => { const s = sessionFor(req, res); clearUserCache(s.user?.id); s.youtube = undefined; res.json({ ok: true }); });

  app.get('/api/youtube/account', async (req, res) => { try { const s = sessionFor(req, res); const data = await ytApi(s, 'channels?part=snippet%2CcontentDetails&mine=true'); const c = data.items?.[0]; if (!c) return res.status(404).json({ error: 'PLAYLIST_NOT_FOUND' }); res.json({ id: c.id, channelId: c.id, title: c.snippet?.title || '', description: c.snippet?.description || '', thumbnail: c.snippet?.thumbnails?.default?.url || '' }); } catch (e) { fail(res, e); } });
  app.get('/api/youtube/playlists', async (req, res) => { try { const s = sessionFor(req, res); const limit = Math.min(50, Math.max(1, Number(req.query.maxResults || 25))); const page = new URLSearchParams({ part: 'snippet,contentDetails,status', mine: 'true', maxResults: String(limit) }); if (req.query.pageToken) page.set('pageToken', String(req.query.pageToken)); const data = await ytApi(s, `playlists?${page}`, {}, req.query.refresh === '1'); res.json({ items: (data.items || []).map(playlist), nextPageToken: data.nextPageToken || null }); } catch (e) { fail(res, e); } });
  app.get('/api/youtube/playlists/:playlistId/items', async (req, res) => { if (!/^[A-Za-z0-9_-]{10,80}$/.test(req.params.playlistId)) return res.status(400).json({ error: 'PLAYLIST_NOT_FOUND' }); try { const s = sessionFor(req, res); const q = new URLSearchParams({ part: 'snippet,contentDetails,status', playlistId: req.params.playlistId, maxResults: String(Math.min(50, Math.max(1, Number(req.query.maxResults || 25)))) }); if (req.query.pageToken) q.set('pageToken', String(req.query.pageToken)); const data = await ytApi(s, `playlistItems?${q}`, {}, req.query.refresh === '1'); res.json({ items: (data.items || []).map((i: any) => ({ id: i.id, videoId: i.contentDetails?.videoId, title: i.snippet?.title || '', artist: i.snippet?.videoOwnerChannelTitle || i.snippet?.channelTitle || '', thumbnail: i.snippet?.thumbnails?.high?.url || i.snippet?.thumbnails?.default?.url || '', position: i.snippet?.position || 0, status: i.status?.privacyStatus || 'private', duration: null })), nextPageToken: data.nextPageToken || null }); } catch (e) { fail(res, e); } });
  app.post('/api/youtube/playlists', async (req, res) => { const { title, description = '', privacyStatus = 'private' } = req.body || {}; if (!String(title || '').trim() || String(title).length > 150 || !['private', 'public', 'unlisted'].includes(privacyStatus)) return res.status(400).json({ error: 'INVALID_PLAYLIST' }); try { const s = sessionFor(req, res); const data = await ytApi(s, 'playlists?part=snippet,status', { method: 'POST', body: JSON.stringify({ snippet: { title: String(title).trim(), description: String(description).slice(0, 5000) }, status: { privacyStatus } }) }); res.status(201).json(playlist(data)); } catch (e) { fail(res, e); } });
  app.post('/api/youtube/playlists/:playlistId/items', async (req, res) => { const videoId = req.body?.videoId; if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: 'VIDEO_NOT_AVAILABLE' }); try { const s = sessionFor(req, res); const data = await ytApi(s, 'playlistItems?part=snippet,contentDetails', { method: 'POST', body: JSON.stringify({ snippet: { playlistId: req.params.playlistId, resourceId: { kind: 'youtube#video', videoId } } }) }); res.status(201).json({ id: data.id, videoId: data.contentDetails?.videoId, title: data.snippet?.title || '', position: data.snippet?.position || 0 }); } catch (e) { fail(res, e); } });
  app.delete('/api/youtube/playlists/:playlistId/items/:itemId', async (req, res) => { try { await ytApi(sessionFor(req, res), `playlistItems?id=${encodeURIComponent(req.params.itemId)}`, { method: 'DELETE' }); res.status(204).end(); } catch (e) { fail(res, e); } });
  app.patch('/api/youtube/playlists/:playlistId/items/:itemId', async (req, res) => { const position = Number(req.body?.position); if (!Number.isInteger(position) || position < 0) return res.status(400).json({ error: 'INVALID_POSITION' }); try { const s = sessionFor(req, res); const current = await ytApi(s, `playlistItems?part=snippet&id=${encodeURIComponent(req.params.itemId)}`); const item = current.items?.[0]; if (!item || item.snippet?.playlistId !== req.params.playlistId) return res.status(404).json({ error: 'PLAYLIST_NOT_FOUND' }); item.snippet.position = position; const data = await ytApi(s, 'playlistItems?part=snippet', { method: 'PUT', body: JSON.stringify({ id: item.id, snippet: { playlistId: item.snippet.playlistId, resourceId: item.snippet.resourceId, position } }) }); res.json({ id: data.id, position: data.snippet?.position }); } catch (e) { fail(res, e); } });
  app.patch('/api/youtube/playlists/:playlistId', async (req, res) => { const { title, description, privacyStatus } = req.body || {}; if ((title !== undefined && (!String(title).trim() || String(title).length > 150)) || (privacyStatus !== undefined && !['private', 'public', 'unlisted'].includes(privacyStatus))) return res.status(400).json({ error: 'INVALID_PLAYLIST' }); try { const s = sessionFor(req, res); const current = await ytApi(s, `playlists?part=snippet,status&id=${encodeURIComponent(req.params.playlistId)}`); const p = current.items?.[0]; if (!p) return res.status(404).json({ error: 'PLAYLIST_NOT_FOUND' }); if (title !== undefined) p.snippet.title = String(title).trim(); if (description !== undefined) p.snippet.description = String(description).slice(0, 5000); if (privacyStatus !== undefined) p.status.privacyStatus = privacyStatus; const data = await ytApi(s, 'playlists?part=snippet,status', { method: 'PUT', body: JSON.stringify({ id: p.id, snippet: p.snippet, status: p.status }) }); res.json(playlist(data)); } catch (e) { fail(res, e); } });
  app.delete('/api/youtube/playlists/:playlistId', async (req, res) => { try { await ytApi(sessionFor(req, res), `playlists?id=${encodeURIComponent(req.params.playlistId)}`, { method: 'DELETE' }); res.status(204).end(); } catch (e) { fail(res, e); } });
}

export { registerYoutubeRoutes };
