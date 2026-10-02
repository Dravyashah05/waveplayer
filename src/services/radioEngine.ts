import type { Track } from '../types';
import { playerStore } from './playerStore';
import {
  fetchArtistTop,
  fetchAutoplay,
  fetchForYou,
  fetchRadio,
  fetchSimilar,
} from './recommendationApi';
import {
  getColdStartTracks,
  getDiscoverTracks,
  getSimilarTracks,
  recommendTracks,
  similarityScore,
} from './recommendationEngine';
import { buildTasteProfile, type TasteProfile } from './tasteProfile';
import { getProfile } from './userProfile';
import { hasRecentPlay } from './listeningStore';
import { historyIdentityKey } from './historyMerge';
import { googleAccountStore } from '../hooks/useGoogleAccount';

/**
 * Smart Radio engine — candidate provider ONLY.
 *
 * Contract (§17): radio produces Track[]; playerStore owns queue/index/
 * shuffle/repeat; playerEngine owns audio. This module never touches audio,
 * never owns a second queue, and never interrupts the current track — it
 * only appends via playerStore.addToQueue().
 *
 * Sources (best first, all optional): YT Music server radio/similar/
 * autoplay → on-device similar/discover/recommend → cold-start trending.
 * Any source may fail; failure degrades to the next source, never to a
 * broken queue. YT Music is never mandatory.
 */

export type RadioMode = 'track' | 'artist' | 'album' | 'playlist' | 'discovery' | 'personalized';

export interface RadioSeed {
  track?: Track;
  artistId?: string;
  artistName?: string;
  albumId?: string;
  albumName?: string;
  playlistId?: string;
  contextTracks?: Track[];
}

export interface RadioContext {
  context: `${RadioMode}-radio`;
  seedTrackId?: string;
  seedArtistId?: string;
  seedAlbumId?: string;
  seedPlaylistId?: string;
  sessionId: string;
}

export interface RadioSession {
  id: string;
  mode: RadioMode;
  seedTrackId?: string;
  seedArtistId?: string;
  seedAlbumId?: string;
  seedPlaylistId?: string;
  label: string;
  startedAt: number;
  generatedIds: string[];
  playedIds: string[];
  skippedIds: string[];
  /** songId -> artist (lowercased) for every skipped id (deterministic attribution). */
  skipArtists: Record<string, string>;
  /** artist (lowercased) -> temporary session demotion weight 0..1 */
  demotedArtists: Record<string, number>;
  /** artist (lowercased) -> session boost from likes/replays/completions */
  boostedArtists: Record<string, number>;
  batch: number;
}

/** Discovery share per mode — the ONLY place these ratios live. */
export const DISCOVERY_LEVELS: Record<RadioMode, number> = {
  track: 0.15,
  artist: 0.2,
  album: 0.2,
  playlist: 0.2,
  personalized: 0.2,
  discovery: 0.35,
};

/** Variety guards — the ONLY place these caps live. */
export const DIVERSITY = {
  maxConsecutiveArtist: 2,
  albumWindow: 5,
  maxAlbumRepeat: 2,
  extensionBatch: 7,
  maxQueue: 60,
  extendThreshold: 2,
} as const;

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const FETCH_TIMEOUT_MS = 12_000;
import { CACHE_MAX, CACHE_TTL } from './cacheConfig';

// Central policy: radio candidate pool (taste-adjacent, short-lived).
const CANDIDATE_CACHE_TTL_MS = CACHE_TTL.radioCandidatesMs;
const CANDIDATE_CACHE_MAX = CACHE_MAX.radioCandidates;
const SESSION_STORE_KEY = 'wave:radio_session';
const DEMOTE_AFTER_SKIPS = 2;
const DEMOTE_WEIGHT = 0.35;

function normArtist(t: Track): string {
  return ((t.author || '').split(',')[0]?.trim() || t.author || '').toLowerCase();
}

function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  } catch {}
  return `rs_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function scopeOf(): string {
  try {
    const s = googleAccountStore.get();
    if (s?.connected && s.user?.id) return s.user.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  } catch {}
  return 'local';
}

function withTimeout<T>(p: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('radio-timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Bounded candidate cache (deduplicates simultaneous + repeat requests)
// ---------------------------------------------------------------------------

const candidateCache = new Map<string, { at: number; tracks: Track[] }>();
const candidateInflight = new Map<string, Promise<Track[]>>();

function cacheGet(key: string): Track[] | null {
  const hit = candidateCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CANDIDATE_CACHE_TTL_MS) {
    candidateCache.delete(key);
    return null;
  }
  return hit.tracks;
}

function cacheSet(key: string, tracks: Track[]): void {
  if (candidateCache.size >= CANDIDATE_CACHE_MAX) {
    const oldest = candidateCache.keys().next();
    if (!oldest.done) candidateCache.delete(oldest.value);
  }
  candidateCache.set(key, { at: Date.now(), tracks });
}

export function clearRadioCache(): void {
  candidateCache.clear();
  candidateInflight.clear();
}

// ---------------------------------------------------------------------------
// Pure ranking helpers (exported for tests; no I/O)
// ---------------------------------------------------------------------------

export interface RankedCandidate {
  track: Track;
  score: number;
  unfamiliar: boolean;
}

export function scoreCandidate(
  track: Track,
  seed: Track | null,
  taste: TasteProfile,
  session: Pick<RadioSession, 'demotedArtists' | 'boostedArtists'> | null,
): { score: number; unfamiliar: boolean } {
  const sim = seed ? similarityScore(track, seed) : 0.3;
  const artist = normArtist(track);
  const affinity = taste.artistAffinity[artist] || 0;
  const lang = (track.language || '').trim().toLowerCase();
  const langScore = lang ? taste.languagePreference[lang] || 0 : 0;
  const unfamiliar = affinity <= 0.15 && !hasRecentPlay(track.id, 24 * 7);
  let score = sim * 0.55 + affinity * 0.3 + Math.min(0.2, langScore * 0.2);
  if (session) {
    const demote = session.demotedArtists[artist] || 0;
    const boost = session.boostedArtists[artist] || 0;
    score = score * (1 - demote) + boost * 0.25;
  }
  try {
    if (hasRecentPlay(track.id, 24)) score *= 0.35;
  } catch {}
  return { score, unfamiliar };
}

/**
 * Order candidates: relevance first, then inject the mode's discovery share
 * of unfamiliar tracks at even intervals, enforcing artist/album variety.
 * Never repeats an id already in `usedIds` unless the pool is exhausted.
 */
export function arrangeRadioQueue(
  ranked: RankedCandidate[],
  discoveryShare: number,
  usedIds: Set<string>,
): Track[] {
  const fresh = ranked.filter((r) => r?.track?.id && !usedIds.has(r.track.id));
  const pool = fresh.length ? fresh : ranked.filter((r) => r?.track?.id);
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const unfamiliarCount = Math.round(sorted.length * discoveryShare);
  const familiar = sorted.filter((r) => !r.unfamiliar);
  const unfamiliar = sorted.filter((r) => r.unfamiliar);
  // Discovery share = unfamiliar tracks injected into a familiar backbone.
  // When nothing is familiar (cold pool), keep the whole ranked pool.
  const merged: RankedCandidate[] = [...familiar];
  if (!merged.length) {
    merged.push(...unfamiliar);
  } else if (unfamiliar.length) {
    const inject = unfamiliar.slice(0, Math.max(unfamiliarCount, 0));
    const step = Math.max(2, Math.floor(merged.length / inject.length));
    inject.forEach((u, i) => {
      merged.splice(Math.min(merged.length, (i + 1) * step), 0, u);
    });
  }
  // Variety placement: insert each candidate at the earliest position that
  // keeps artist/album caps intact; append at the end only when no position
  // fits (pool exhaustion — best effort, nothing dropped).
  const out: Track[] = [];
  const violatesAt = (arr: Track[], idx: number, cand: Track): boolean => {
    const artist = normArtist(cand);
    const album = (cand.albumName || '').trim().toLowerCase();
    const tmp = [...arr.slice(0, idx), cand, ...arr.slice(idx)];
    if (artist) {
      for (let k = Math.max(0, idx - 2); k <= Math.min(idx, tmp.length - 3); k++) {
        const a = normArtist(tmp[k]);
        if (a === artist && normArtist(tmp[k + 1]) === artist && normArtist(tmp[k + 2]) === artist) return true;
      }
    }
    if (album) {
      const win = tmp.slice(Math.max(0, idx - DIVERSITY.albumWindow), idx).concat(
        tmp.slice(idx + 1, idx + 1 + DIVERSITY.albumWindow),
      );
      const same = win.filter((t) => ((t.albumName || '').trim().toLowerCase()) === album).length;
      if (same >= DIVERSITY.maxAlbumRepeat) return true;
    }
    return false;
  };
  for (const cand of merged) {
    let at = -1;
    for (let i = 0; i <= out.length; i++) {
      if (!violatesAt(out, i, cand.track)) {
        at = i;
        break;
      }
    }
    if (at === -1) out.push(cand.track);
    else out.splice(at, 0, cand.track);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate gathering (server first, local fallback, never throws)
// ---------------------------------------------------------------------------

interface GatherOpts {
  exclude: Set<string>;
  taste: TasteProfile;
  limit: number;
}

async function serverCandidates(
  mode: RadioMode,
  seed: Track | undefined,
  seedArtistId: string | undefined,
  opts: GatherOpts,
): Promise<Track[]> {
  const out: Track[] = [];
  const ytSeed = seed && YT_ID_RE.test(seed.id) ? seed : undefined;
  try {
    if (mode === 'artist' && seedArtistId) {
      const top = await fetchArtistTop(seedArtistId).catch(() => [] as Track[]);
      for (const t of top) {
        if (t?.id && !opts.exclude.has(t.id)) out.push(t);
      }
    }
    if (ytSeed) {
      const excludeArr = [...opts.exclude].slice(0, 50);
      const [radio, similar] = await Promise.all([
        fetchRadio(ytSeed, 25, excludeArr).catch(() => [] as Track[]),
        (mode === 'track' || mode === 'personalized'
          ? fetchSimilar(ytSeed, 15).catch(() => [] as Track[])
          : Promise.resolve([] as Track[])),
      ]);
      out.push(...radio, ...similar);
    }
  } catch {}
  return out;
}

async function localCandidates(
  mode: RadioMode,
  seed: Track | undefined,
  contextTracks: Track[],
  opts: GatherOpts,
): Promise<Track[]> {
  const out: Track[] = [];
  const pushAll = (tracks: Track[]) => {
    for (const t of tracks) {
      if (t?.id && !opts.exclude.has(t.id) && !out.some((o) => o.id === t.id)) out.push(t);
    }
  };
  try {
    if (mode === 'discovery') {
      const profile = getProfile();
      pushAll(await getDiscoverTracks(profile, opts.exclude, 20).catch(() => []));
    }
    if (mode === 'personalized') {
      const seeds = [...playerStore.historyList().slice(0, 2), ...playerStore.favsList().slice(0, 1)].filter(
        (t, i, a) => t?.id && a.findIndex((x) => x.id === t.id) === i,
      );
      pushAll(await recommendTracks({ seedTracks: seeds.slice(0, 3), limit: 20 }).catch(() => []));
      pushAll(await fetchForYou().catch(() => []));
    }
    if ((mode === 'artist' || mode === 'album' || mode === 'playlist') && contextTracks.length) {
      for (const ctx of contextTracks.slice(0, 3)) {
        if (!ctx?.id) continue;
        pushAll(await getSimilarTracks(ctx.id, 12).catch(() => []));
      }
      if (mode === 'album' || mode === 'playlist') pushAll(contextTracks);
    }
    if (seed?.id) {
      pushAll(await getSimilarTracks(seed.id, seed?.id && YT_ID_RE.test(seed.id) ? 15 : 12).catch(() => []));
      if (!out.length) pushAll(await recommendTracks({ seedTrack: seed, limit: 15 }).catch(() => []));
    }
    if (!out.length) pushAll(await getColdStartTracks(15).catch(() => []));
  } catch {}
  return out;
}

function boostSameContext(
  tracks: Track[],
  mode: RadioMode,
  seed: Track | undefined,
  seedArtistName: string,
): Track[] {
  if (mode !== 'artist' && mode !== 'album') return tracks;
  const want = (mode === 'artist' ? seedArtistName : seed?.albumName || '').toLowerCase();
  if (!want) return tracks;
  const matching = tracks.filter((t) =>
    mode === 'artist' ? normArtist(t) === want : (t.albumName || '').toLowerCase() === want,
  );
  const rest = tracks.filter((t) => !matching.includes(t));
  return [...matching.slice(0, 12), ...rest];
}

// ---------------------------------------------------------------------------
// Session store (in-memory + tiny persisted summary for queue labels)
// ---------------------------------------------------------------------------

type RadioListener = () => void;
const listeners = new Set<RadioListener>();
let activeSession: RadioSession | null = null;
let activeScope = scopeOf();

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {}
  }
}

function persistSession() {
  try {
    if (!activeSession) {
      localStorage.removeItem(`${SESSION_STORE_KEY}:${activeScope}`);
      return;
    }
    localStorage.setItem(
      `${SESSION_STORE_KEY}:${activeScope}`,
      JSON.stringify({
        id: activeSession.id,
        mode: activeSession.mode,
        seedTrackId: activeSession.seedTrackId,
        seedArtistId: activeSession.seedArtistId,
        seedAlbumId: activeSession.seedAlbumId,
        seedPlaylistId: activeSession.seedPlaylistId,
        label: activeSession.label,
        startedAt: activeSession.startedAt,
        generatedIds: activeSession.generatedIds.slice(-100),
        scope: activeScope,
      }),
    );
  } catch {}
}

export function subscribeRadio(fn: RadioListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getActiveSession(): RadioSession | null {
  if (activeSession && activeScope !== scopeOf()) {
    activeSession = null; // account switched → never leak sessions across users
  }
  return activeSession;
}

export function isRadioGenerated(trackId: string): boolean {
  const s = getActiveSession();
  return !!s && s.generatedIds.includes(trackId);
}

function setActive(session: RadioSession | null) {
  activeSession = session;
  activeScope = scopeOf();
  persistSession();
  notify();
}

export function stopRadio(): void {
  setActive(null);
}

function sessionLabel(mode: RadioMode, seed: RadioSeed): string {
  const track = seed.track;
  if (mode === 'artist') return `${seed.artistName || track?.author?.split(',')[0]?.trim() || 'Artist'} Radio`;
  if (mode === 'album') return `${seed.albumName || track?.albumName || 'Album'} Radio`;
  if (mode === 'playlist') return 'Playlist Radio';
  if (mode === 'discovery') return 'Discovery Radio';
  if (mode === 'personalized') return 'Your Radio';
  return track ? `Based on “${track.title}”` : 'Track Radio';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StartRadioOpts {
  contextTracks?: Track[];
}

/**
 * Build one radio batch for a mode+seed. Pure fetch+rank (no queue writes),
 * so callers and tests share the path. Returns tracks + updated session.
 */
export async function buildRadioBatch(
  session: RadioSession,
  seed: RadioSeed,
  count: number = DIVERSITY.extensionBatch,
): Promise<Track[]> {
  const track = seed.track;
  const taste = buildTasteProfile();
  const queueIds = new Set(playerStore.queue().map((t) => t.id));
  const exclude = new Set<string>([
    ...(track ? [track.id] : []),
    ...queueIds,
    ...session.generatedIds,
    ...session.playedIds,
  ]);
  const cacheKey = `${session.mode}:${track?.id || seed.artistId || seed.albumId || seed.playlistId || 'personal'}:${session.batch}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.slice(0, count);

  const opts: GatherOpts = { exclude, taste, limit: 25 };
  const [server, local] = await Promise.all([
    serverCandidates(session.mode, track, seed.artistId, opts),
    localCandidates(session.mode, track, seed.contextTracks ?? [], opts),
  ]);
  let pool = [...server, ...local.filter((t) => !server.some((s) => s.id === t.id))];
  pool = boostSameContext(pool, session.mode, track, (seed.artistName || '').toLowerCase());

  const ranked = pool.map((t) => ({
    track: t,
    ...scoreCandidate(t, track ?? null, taste, session),
  }));
  // Seed relevance first for track radio; discovery share injected per mode.
  const arranged = arrangeRadioQueue(ranked, DISCOVERY_LEVELS[session.mode], exclude);
  const batch = arranged.slice(0, Math.max(count, 5));
  session.batch += 1;
  for (const t of batch) {
    if (!session.generatedIds.includes(t.id)) session.generatedIds.push(t.id);
  }
  cacheSet(cacheKey, batch);
  persistSession();
  notify();
  return batch;
}

export async function startRadio(mode: RadioMode, seed: RadioSeed, opts: StartRadioOpts = {}): Promise<RadioSession> {
  const session: RadioSession = {
    id: uid(),
    mode,
    seedTrackId: seed.track?.id,
    seedArtistId: seed.artistId,
    seedAlbumId: seed.albumId,
    seedPlaylistId: seed.playlistId,
    label: sessionLabel(mode, seed),
    startedAt: Date.now(),
    generatedIds: [],
    playedIds: [],
    skippedIds: [],
    skipArtists: {},
    demotedArtists: {},
    boostedArtists: {},
    batch: 0,
  };
  if (opts.contextTracks?.length && !seed.contextTracks) seed.contextTracks = opts.contextTracks;
  setActive(session);
  await buildRadioBatch(session, seed, 12).catch(() => []);
  return session;
}

/** Start radio and hand the queue to playerStore (seed first, then batch). */
export async function startRadioAndPlay(mode: RadioMode, seed: RadioSeed, opts: StartRadioOpts = {}): Promise<void> {
  const session = await startRadio(mode, seed, opts);
  const tracks = session.generatedIds
    .map((id) => findTrackEverywhere(id))
    .filter((t): t is Track => !!t);
  const head = seed.track ? [seed.track, ...tracks.filter((t) => t.id !== seed.track!.id)] : tracks;
  const context = `${mode}-radio` as const;
  const metaFor = (t: Track, i: number) =>
    i === 0 && seed.track && t.id === seed.track.id
      ? { addedBy: 'user' as const, context, radioSessionId: session.id }
      : {
          addedBy: 'radio' as const,
          context,
          radioSessionId: session.id,
          seedTrackId: seed.track?.id,
          seedTitle: seed.track?.title,
          playlistId: seed.playlistId,
          albumId: seed.albumId,
        };
  if (head.length) {
    playerStore.setQueue(
      head.slice(0, 25),
      0,
      head.slice(0, 25).map(metaFor),
    );
  } else if (seed.track) {
    playerStore.setQueue([seed.track], 0, [{ addedBy: 'user', context, radioSessionId: session.id }]);
  }
}

// Small lookup across the last built batches (kept in cache values).
function findTrackEverywhere(id: string): Track | null {
  for (const entry of candidateCache.values()) {
    const hit = entry.tracks.find((t) => t.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Append the next batch to the queue (infinite extension). Respects
 * MAX_QUEUE, never touches the current track, never throws.
 */
export async function extendRadioQueue(count: number = DIVERSITY.extensionBatch): Promise<Track[]> {
  const session = getActiveSession();
  if (!session) return [];
  const seed: RadioSeed = {
    track: playerStore.queue().find((t) => t.id === session.seedTrackId) ?? playerStore.current() ?? undefined,
    artistId: session.seedArtistId,
    artistName: undefined,
    albumId: session.seedAlbumId,
    playlistId: session.seedPlaylistId,
  };
  const batch = await buildRadioBatch(session, seed, count).catch(() => []);
  const room = Math.max(0, DIVERSITY.maxQueue - playerStore.queue().length);
  const fresh = batch.filter((t) => t?.id).slice(0, room);
  for (const t of fresh) {
    try {
      playerStore.addToQueue(t, {
        addedBy: 'radio',
        context: `${session.mode}-radio`,
        radioSessionId: session.id,
        seedTrackId: seed.track?.id,
        seedTitle: seed.track?.title,
        playlistId: session.seedPlaylistId,
        albumId: session.seedAlbumId,
      });
    } catch {}
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Feedback loop — reacts to real listening behavior within the session
// ---------------------------------------------------------------------------

/** Skip feedback for an explicit session (temporary demotion, never a ban). */
export function applySkipFeedback(session: RadioSession, track: Track | undefined, songId: string): void {
  if (!session.generatedIds.includes(songId)) return;
  if (!session.skippedIds.includes(songId)) session.skippedIds.push(songId);
  const artist = normArtist(track ?? ({ author: '' } as Track));
  if (!artist) return;
  if (!session.skipArtists) session.skipArtists = {};
  session.skipArtists[songId] = artist;
  const skips = Object.values(session.skipArtists).filter((a) => a === artist).length;
  // Temporary demotion after repeated skips — never a permanent ban.
  if (skips >= DEMOTE_AFTER_SKIPS) {
    session.demotedArtists[artist] = Math.max(session.demotedArtists[artist] || 0, DEMOTE_WEIGHT);
  }
  persistSession();
}

/** Positive feedback for an explicit session (likes/replays/completions). */
export function applyPositiveFeedback(
  session: RadioSession,
  track: Track | undefined,
  songId: string,
  weight: number,
): void {
  if (!session.generatedIds.includes(songId)) return;
  if (!session.playedIds.includes(songId)) session.playedIds.push(songId);
  const artist = normArtist(track ?? ({ author: '' } as Track));
  if (!artist) return;
  session.boostedArtists[artist] = Math.min(1, (session.boostedArtists[artist] || 0) + weight);
  // A liked artist is explicitly forgiven.
  if (weight >= 0.5) delete session.demotedArtists[artist];
  persistSession();
}

function noteSkip(track: Track | undefined, songId: string) {
  const s = getActiveSession();
  if (!s) return;
  applySkipFeedback(s, track, songId);
}

function notePositive(track: Track | undefined, songId: string, weight: number) {
  const s = getActiveSession();
  if (!s) return;
  applyPositiveFeedback(s, track, songId, weight);
}

let feedbackAttached = false;

/** Listen to normalized listening events (one shared listener, no spam). */
export function attachRadioFeedback(): void {
  if (feedbackAttached || typeof window === 'undefined') return;
  feedbackAttached = true;
  window.addEventListener('wave:listening', ((e: CustomEvent) => {
    try {
      const detail = e?.detail as { songId?: string; track?: Track; event?: string } | undefined;
      if (!detail?.songId) return;
      if (detail.event === 'skip') noteSkip(detail.track, detail.songId);
      else if (detail.event === 'like' || detail.event === 'replay') notePositive(detail.track, detail.songId, 0.5);
      else if (detail.event === 'complete') notePositive(detail.track, detail.songId, 0.3);
    } catch {}
  }) as EventListener);
}

// ---------------------------------------------------------------------------
// Autoplay decision (pure — tested; the watcher lives in autoplay.ts)
// ---------------------------------------------------------------------------

export interface ExtendDecision {
  extend: boolean;
  reason: 'off' | 'repeat-one' | 'empty' | 'enough' | 'full' | 'ready';
}

/** Should the infinite queue extend right now? Never blocks, never throws. */
export function shouldExtendQueue(opts: {
  queueLength: number;
  remaining: number;
  repeat: string;
  autoplayOn: boolean;
}): ExtendDecision {
  if (!opts.autoplayOn) return { extend: false, reason: 'off' };
  if (opts.repeat === 'one') return { extend: false, reason: 'repeat-one' };
  if (opts.queueLength === 0) return { extend: false, reason: 'empty' };
  if (opts.queueLength >= DIVERSITY.maxQueue) return { extend: false, reason: 'full' };
  if (opts.remaining > DIVERSITY.extendThreshold) return { extend: false, reason: 'enough' };
  return { extend: true, reason: 'ready' };
}

/** Canonical identity for queue comparisons (stable ids win, never title-only). */
export function radioIdentity(t: Track): string {
  try {
    return historyIdentityKey(t);
  } catch {
    return `id:${t?.id || 'unknown'}`;
  }
}
