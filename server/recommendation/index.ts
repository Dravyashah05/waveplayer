// Express route registration for the recommendation core. All endpoints use
// public YouTube Music data (no OAuth needed); personalization comes from
// optional client-supplied taste hints (?artists=, ?lang=, ?exclude=).
// Upstream failures degrade to per-endpoint empty/partial answers — never a
// bare 500, and never the whole API.

import type { Express, Request, Response } from 'express';
import { LIMITS, rateLimit } from '../rateLimit.js';
import type { YTMusicLike } from './candidates.js';
import { artistCandidates, homeSectionCandidates, searchCandidates, toCandidate, trendingCandidates } from './candidates.js';
import { buildAutoplay, buildRadio, buildSimilar, toResolvedTrack } from './autoplay.js';
import { diversify } from './diversity.js';
import { rankCandidates } from './ranker.js';
import type { Candidate, ResolvedTrack } from './types.js';

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: any }>();

function cacheGet(key: string): any | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  if (hit) cache.delete(key);
  return null;
}

function cacheSet(key: string, value: any): void {
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { at: Date.now(), value });
}

function timed<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T | null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer!));
}

function tasteOf(req: Request) {
  // Bounded tokens: huge query strings can't bloat cache keys or ranking.
  const csv = (v: unknown) => String(v || '').slice(0, 500).split(',').map((s) => s.trim().slice(0, 64)).filter(Boolean).slice(0, 10);
  return {
    artists: csv(req.query.artists),
    languages: csv(req.query.lang || req.query.language),
    excludeIds: [],
  };
}

function excludeOf(req: Request): string[] {
  return String(req.query.exclude || '').split(',').map((s) => s.trim()).filter((s) => VIDEO_ID.test(s)).slice(0, 50);
}

function shortError(e: any): string {
  return String(e?.message || e).slice(0, 200);
}

export function registerRecommendationRoutes(app: Express, getYt: () => Promise<YTMusicLike>) {
  // Generous: normal browsing/radio/autoplay never notices; bursts do.
  app.use('/api/recommendations', rateLimit(LIMITS.recommendations));
  async function yt(): Promise<YTMusicLike | null> {
    try {
      return await getYt();
    } catch (e: any) {
      console.error('[Rec] YTMusic unavailable:', shortError(e));
      return null;
    }
  }

  // Home uses the available YT Music Home feed plus Wave taste hints. The
  // current ytmusic-api client is anonymous, so this is not account-personalized.
  app.get('/api/recommendations/home', async (req, res) => {
    const cacheKey = `home:${String(req.query.artists || '')}:${String(req.query.lang || '')}`;
    const hit = cacheGet(cacheKey);
    if (hit) return res.json(hit);
    try {
      const ytm = await yt();
      if (!ytm) return res.json({ personalized: false, source: 'wave-fallback', personalizationAvailable: false, sections: [] });
      const taste = tasteOf(req);
      const sections: Array<{ id: string; title: string; subtitle: string; tracks: ResolvedTrack[] }> = [];
      const push = (id: string, title: string, subtitle: string, pool: Candidate[], limit = 10) => {
        const ranked = rankCandidates(pool, { seed: null, taste });
        ranked.sort((a, b) => b.score - a.score);
        const picked = diversify(ranked, limit, { artistCap: 2, albumCap: 2 });
        if (picked.length) sections.push({ id, title, subtitle, tracks: picked.map((s) => toResolvedTrack(s.candidate)) });
      };

      const home = (await timed(homeSectionCandidates(ytm, 30), 10000)) || [];
      for (const section of home) {
        push(section.id, section.title, section.subtitle, section.candidates, 12);
      }
      const trending = (await timed(trendingCandidates(ytm, 30), 9000)) || [];
      push('quick-picks', 'Quick Picks', 'Jump back in', trending, 10);
      if (taste.artists.length) {
        const fav = taste.artists[0];
        const because = (await timed(searchCandidates(ytm, fav, 'artist-search', 15), 9000)) || [];
        push('because', `Because you listen to ${fav}`, 'More from a favourite', because, 10);
        const mixPool = [...because, ...trending];
        push('your-mix', 'Your Mix', 'Taste meets discovery', mixPool, 12);
      } else {
        push('your-mix', 'Your Mix', 'Trending picks', trending, 10);
      }
      const known = new Set(taste.artists.map((a) => a.toLowerCase()));
      push(
        'discover',
        'Discover something new',
        'Beyond your usual',
        trending.filter((c) => !known.has(c.artist.toLowerCase())),
        10,
      );
      push('trending', 'Trending for you', 'What is hot now', trending, 10);

      const payload = { personalized: false, source: 'ytmusic-public', personalizationAvailable: false, sections };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e: any) {
      console.error('[Rec] home error:', shortError(e));
      res.json({ personalized: false, source: 'wave-fallback', personalizationAvailable: false, sections: [] });
    }
  });

  const collectionHandler = (relation: 'for-you' | 'discover') => async (req: Request, res: Response) => {
    try {
      const ytm = await yt();
      if (!ytm) return res.json({ personalized: false, source: 'wave-fallback', tracks: [] });
      const taste = tasteOf(req);
      const home = await timed(homeSectionCandidates(ytm, 40), 10000) || [];
      const candidates = home.flatMap((section) => section.candidates);
      const pool = candidates.length ? candidates : (await timed(trendingCandidates(ytm, 30), 9000) || []);
      const ordered = rankCandidates(pool, { seed: null, taste }).sort((a, b) => b.score - a.score);
      const tracks = diversify(ordered, 20, { artistCap: relation === 'discover' ? 1 : 2, albumCap: 2 })
        .map((entry) => toResolvedTrack(entry.candidate));
      res.json({ personalized: false, source: 'ytmusic-public', tracks });
    } catch (e: any) {
      console.error(`[Rec] ${relation} error:`, shortError(e));
      res.json({ personalized: false, source: 'wave-fallback', tracks: [] });
    }
  };
  app.get('/api/recommendations/for-you', collectionHandler('for-you'));
  app.get('/api/recommendations/discover', collectionHandler('discover'));

  app.get('/api/recommendations/quick-picks', async (req, res) => {
    const cacheKey = `qp:${String(req.query.artists || '')}:${String(req.query.lang || '')}`;
    const hit = cacheGet(cacheKey);
    if (hit) return res.json(hit);
    try {
      const ytm = await yt();
      if (!ytm) return res.json({ tracks: [] });
      const taste = tasteOf(req);
      const limit = Math.min(15, Math.max(5, Number(req.query.limit || 10)));
      let pool = (await timed(trendingCandidates(ytm, 20), 9000)) || [];
      if (taste.artists.length) {
        const fav = (await timed(searchCandidates(ytm, taste.artists[0], 'artist-search', 12), 9000)) || [];
        pool = [...fav, ...pool];
      }
      const ranked = rankCandidates(pool, { seed: null, taste });
      ranked.sort((a, b) => b.score - a.score);
      const picked = diversify(ranked, limit, { artistCap: 2, albumCap: 2 });
      const payload = { tracks: picked.map((s) => toResolvedTrack(s.candidate)) };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e: any) {
      console.error('[Rec] quick-picks error:', shortError(e));
      res.json({ tracks: [] });
    }
  });

  const seedHandler = (
    builder: (yt: YTMusicLike, id: string, opts: any) => Promise<{ seed: string; tracks: ResolvedTrack[]; reasons: string[][] }>,
    def: number, min: number, max: number,
  ) => async (req: Request, res: Response) => {
    const id = String(req.params.trackId || '');
    if (!VIDEO_ID.test(id)) return res.status(400).json({ error: 'INVALID_TRACK_ID' });
    const cacheKey = `${builder.name}:${id}:${String(req.query.artists || '')}`;
    const hit = cacheGet(cacheKey);
    if (hit) return res.json(hit);
    try {
      const ytm = await yt();
      if (!ytm) return res.json({ seed: id, tracks: [], reasons: [] });
      const limit = Math.min(max, Math.max(min, Number(req.query.limit || def)));
      const payload = await timed(
        builder(ytm, id, { taste: tasteOf(req), excludeIds: excludeOf(req), limit }),
        20000,
      );
      if (!payload) return res.json({ seed: id, tracks: [], reasons: [] });
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e: any) {
      console.error(`[Rec] ${builder.name} error:`, shortError(e));
      res.json({ seed: id, tracks: [], reasons: [] });
    }
  };

  app.get('/api/recommendations/autoplay/:trackId', seedHandler(buildAutoplay, 8, 5, 10));
  app.get('/api/recommendations/radio/:trackId', seedHandler(buildRadio, 20, 10, 30));
  app.get('/api/recommendations/similar/:trackId', seedHandler(buildSimilar, 20, 10, 30));

  app.get('/api/recommendations/artist/:artistId', async (req, res) => {
    const artistId = String(req.params.artistId || '').trim();
    if (!artistId || artistId.length > 100) return res.status(400).json({ error: 'INVALID_ARTIST_ID' });
    const cacheKey = `artist:${artistId}`;
    const hit = cacheGet(cacheKey);
    if (hit) return res.json(hit);
    try {
      const ytm = await yt();
      if (!ytm) return res.json({ artist: null, tracks: [] });
      const [artist, songs] = await Promise.all([
        timed(ytm.getArtist(artistId), 9000),
        timed(ytm.getArtistSongs(artistId), 9000),
      ]);
      const tracks: ResolvedTrack[] = [];
      for (const item of songs || []) {
        const c = toCandidate(item, 'artist');
        if (c) tracks.push(toResolvedTrack(c));
        if (tracks.length >= 25) break;
      }
      const payload = {
        artist: artist
          ? { id: artistId, name: String(artist?.name || artist?.title || ''), description: String(artist?.description || '').slice(0, 500) }
          : { id: artistId, name: '', description: '' },
        tracks,
      };
      cacheSet(cacheKey, payload);
      res.json(payload);
    } catch (e: any) {
      console.error('[Rec] artist error:', shortError(e));
      res.json({ artist: null, tracks: [] });
    }
  });
}
