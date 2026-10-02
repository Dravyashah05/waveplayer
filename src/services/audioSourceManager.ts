import type { Track } from '../types';
import {
  listSources,
  saavnSource,
  youtubeSource,
  localSource,
  type AudioSource,
  type ResolvedAudio as AdapterResolvedAudio,
} from './audioSources';
import { resolveYouTubeAudio } from './ytmusicApi';
import { searchYouTube } from './youtubeSearch';
import { resolutionRoute } from './playbackSource';
import { settingsStore } from './settingsStore';
import {
  UNKNOWN_STREAM_LIFETIME_MS,
  IFRAME_FALLBACK_CACHE_MS,
  runDeduped,
} from './temporaryStreamCache';

/**
 * Audio Source Manager — the only module that knows about individual audio
 * sources. playerEngine asks `audioSourceManager.resolve(track)` and stays
 * the sole owner of Audio playback, volume, seeking and MediaSession.
 *
 * Chain (priority order comes from settingsStore.sourcePriority):
 *   configured source → JioSaavn → YouTube direct → local → YouTube player
 *   (iframe fallback, videoPlayback only — no direct audio URL)
 *
 * Guarantees:
 * - disabled sources are skipped, never probed
 * - every attempt is recorded in `tried` (no silent skips, no same-source loops)
 * - in-flight resolutions for one track share a single promise (no duplicates)
 * - failures are never cached, so retry() genuinely retries
 * - temporary URLs honor expiresAt (5s safety window); unknown lifetimes get a
 *   conservative TTL; iframe fallbacks expire quickly so direct audio can win
 * - metadata is never fabricated: every optional field stays undefined unless
 *   a source confirmed it
 */

export type ManagerSourceType = 'saavn' | 'youtube' | 'local' | 'custom' | 'youtube-player';

export interface SourceCapabilities {
  /** Source yields a directly playable audio URL. */
  directAudio: boolean;
  /** Source can only play through a hosted player surface (YouTube iframe). */
  videoPlayback: boolean;
  /** Random seek is supported on the resolved stream. */
  seekable: boolean;
  /** Source is capable of lossless delivery. Always false today. */
  lossless: boolean;
  /** Playable with no network (local files). */
  offline: boolean;
  /** Caller can choose a quality/bitrate. */
  qualitySelection: boolean;
  /** Source also provides rich metadata (lyrics ids, qualities). */
  hasMetadata: boolean;
}

export type ResolvedAudioKind = 'direct' | 'iframe';

export interface ResolvedAudio {
  /** Adapter id that produced this result ('saavn' | 'youtube' | 'local' | 'custom:<id>' | 'youtube-player'). */
  sourceId: string;
  /** Direct audio URL. Absent for iframe fallbacks. */
  url?: string;
  type: ResolvedAudioKind;
  codec?: string;
  mimeType?: string;
  bitrate?: number;
  bitrateKbps?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number | string;
  container?: string;
  duration?: number;
  isLossless?: boolean;
  streamType?: string;
  networkType?: string;
  bufferedSeconds?: number;
  /** Epoch ms after which the URL is unusable. Absent when unknown. */
  expiresAt?: number;
  /** Canonical 11-char YouTube id when the result is YouTube-backed. */
  ytId?: string;
  downloadUrl?: string;
}

export interface SourceInfo {
  id: string;
  name: string;
  type: ManagerSourceType;
  enabled: boolean;
  /** Lower wins. Unknown ids sort last. */
  priority: number;
  capabilities: SourceCapabilities;
}

export interface ResolveResult {
  resolved: ResolvedAudio | null;
  /** Every source id attempted, in order — including the iframe fallback. */
  tried: string[];
  fromCache: boolean;
}

export interface ResolveOptions {
  forceRefresh?: boolean;
  /** Test seam / scoped resolution: use exactly these adapters in this order. */
  adapters?: AudioSource[];
}

export const YOUTUBE_PLAYER_SOURCE_ID = 'youtube-player';
export const OFFLINE_SOURCE_ID = 'offline';

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const EXPIRY_SKEW_MS = 5_000;

/** True unless the browser explicitly reports offline. Node/tests count as online. */
function isOnline(): boolean {
  try {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  } catch {
    return true;
  }
}

/**
 * Offline playback provider (wired by the offline-downloads module).
 * The manager consults it before any network source; a missing blob falls
 * through to the normal chain so a stale record never blocks playback.
 */
export interface OfflinePlayback {
  url: string;
  mimeType?: string;
}

export interface OfflineProvider {
  sourceId: string;
  has(trackId: string): boolean;
  load(trackId: string): Promise<OfflinePlayback | null>;
}

function https(url: string): string {
  return url.startsWith('http://') ? url.replace('http://', 'https://') : url;
}

const CAPABILITIES: Record<string, SourceCapabilities> = {
  saavn: { directAudio: true, videoPlayback: false, seekable: true, lossless: false, offline: false, qualitySelection: true, hasMetadata: true },
  youtube: { directAudio: true, videoPlayback: false, seekable: true, lossless: false, offline: false, qualitySelection: false, hasMetadata: false },
  local: { directAudio: true, videoPlayback: false, seekable: true, lossless: false, offline: true, qualitySelection: false, hasMetadata: true },
  custom: { directAudio: true, videoPlayback: false, seekable: true, lossless: false, offline: false, qualitySelection: false, hasMetadata: false },
  'youtube-player': { directAudio: false, videoPlayback: true, seekable: true, lossless: false, offline: false, qualitySelection: false, hasMetadata: false },
  offline: { directAudio: true, videoPlayback: false, seekable: true, lossless: false, offline: true, qualitySelection: false, hasMetadata: true },
};

function capabilitiesFor(sourceId: string): SourceCapabilities {
  const base = sourceId.startsWith('custom:') ? 'custom' : sourceId;
  return CAPABILITIES[base] ?? CAPABILITIES.custom;
}

function typeFor(sourceId: string): ManagerSourceType {
  if (sourceId === 'youtube-player') return 'youtube-player';
  if (sourceId.startsWith('custom:')) return 'custom';
  if (sourceId === 'saavn' || sourceId === 'youtube' || sourceId === 'local') return sourceId;
  return 'custom';
}

/** Expiry-aware resolution cache. Mirrors TemporaryStreamCache policy. */
class ResolutionCache {
  private entries = new Map<string, { value: ResolvedAudio; at: number }>();

  get(key: string, now = Date.now()): ResolvedAudio | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const { value, at } = entry;
    if (value.type === 'iframe') {
      if (now - at >= IFRAME_FALLBACK_CACHE_MS) {
        this.entries.delete(key);
        return undefined;
      }
      return value;
    }
    if (value.expiresAt !== undefined) {
      if (now + EXPIRY_SKEW_MS >= value.expiresAt) {
        this.entries.delete(key);
        return undefined;
      }
      return value;
    }
    if (now - at >= UNKNOWN_STREAM_LIFETIME_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return value;
  }

  set(key: string, value: ResolvedAudio): void {
    this.entries.set(key, { value, at: Date.now() });
  }

  has(key: string, now = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

export class AudioSourceManager {
  private cache = new ResolutionCache();
  private inflight = new Map<string, Promise<ResolveResult>>();
  private extra = new Map<string, AudioSource>();
  private lastErrors = new Map<string, { message: string; at: number }>();
  private offlineProvider: OfflineProvider | null = null;

  constructor() {
    // Built-in adapters live here for chain visibility; configured (custom)
    // sources are read live from storage inside listSources(), so Settings
    // changes apply without a reload.
    this.extra.set(saavnSource.id, saavnSource);
    this.extra.set(youtubeSource.id, youtubeSource);
    this.extra.set(localSource.id, localSource);
  }

  /** Register a programmatic adapter. False when the id is taken or invalid. */
  register(source: AudioSource): boolean {
    if (!source || typeof source.id !== 'string' || !source.id) return false;
    if (typeof source.resolve !== 'function') return false;
    if (this.extra.has(source.id)) return false;
    if (listSources().some((s) => s.id === source.id)) return false;
    this.extra.set(source.id, source);
    return true;
  }

  unregister(sourceId: string): boolean {
    return this.extra.delete(sourceId);
  }

  /** Live resolution chain: settings priority order, disabled kept for visibility. */
  chain(adapters?: AudioSource[]): AudioSource[] {
    if (adapters) return [...adapters];
    const live = listSources();
    const out = [...live];
    for (const [id, adapter] of this.extra) {
      if (!out.some((s) => s.id === id)) out.push(adapter);
    }
    return out;
  }

  isEnabled(sourceId: string): boolean {
    try {
      return !settingsStore.get().disabledSources.includes(sourceId);
    } catch {
      return true;
    }
  }

  /** Settings-level disable OR the adapter's own availability gate. */
  private isAdapterEnabled(src: AudioSource): boolean {
    if (!this.isEnabled(src.id)) return false;
    if (typeof src.isEnabled === 'function') {
      try {
        return src.isEnabled();
      } catch {
        return false;
      }
    }
    return true;
  }

  setEnabled(sourceId: string, on: boolean): void {
    const disabled = settingsStore.get().disabledSources;
    const next = on ? disabled.filter((d) => d !== sourceId) : [...new Set([...disabled, sourceId])];
    settingsStore.set('disabledSources', next);
  }

  getPriority(): string[] {
    return [...settingsStore.get().sourcePriority];
  }

  setPriority(ids: string[]): void {
    settingsStore.set('sourcePriority', [...ids]);
  }

  describeSources(): SourceInfo[] {
    const rank = new Map(this.getPriority().map((id, i) => [id, i]));
    const infos: SourceInfo[] = this.chain().map((s) => ({
      id: s.id,
      name: s.name,
      type: typeFor(s.id),
      enabled: this.isEnabled(s.id),
      priority: rank.get(s.id) ?? 99,
      capabilities: capabilitiesFor(s.id),
    }));
    if (this.offlineProvider) {
      infos.push({
        id: this.offlineProvider.sourceId,
        name: 'Offline downloads',
        type: 'local',
        enabled: this.isEnabled(this.offlineProvider.sourceId),
        priority: -1,
        capabilities: capabilitiesFor('offline'),
      });
      infos.sort((a, b) => a.priority - b.priority);
    }
    return infos;
  }

  /** Wire the offline-downloads module. Null detaches (tests). */
  setOfflineProvider(provider: OfflineProvider | null): void {
    this.offlineProvider = provider;
  }

  hasCached(trackId: string): boolean {
    return this.cache.has(trackId);
  }

  invalidate(trackId: string): void {
    this.cache.delete(trackId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  getLastError(sourceId: string): { message: string; at: number } | null {
    return this.lastErrors.get(sourceId) ?? null;
  }

  resolve(track: Track, opts: ResolveOptions = {}): Promise<ResolveResult> {
    if (!track || typeof track.id !== 'string' || !track.id) {
      return Promise.resolve({ resolved: null, tried: [], fromCache: false });
    }
    // Offline-first: a permitted cached track wins over every network source.
    // A missing blob falls through so stale records never block playback.
    if (this.offlineProvider) {
      try {
        if (this.offlineProvider.has(track.id)) {
          const sourceId = this.offlineProvider.sourceId;
          return this.offlineProvider.load(track.id).then((hit) => {
            if (hit?.url) {
              return {
                resolved: { sourceId, url: hit.url, type: 'direct' as const, mimeType: hit.mimeType },
                tried: [sourceId],
                fromCache: false,
              };
            }
            return this.resolveOnline(track, opts);
          });
        }
      } catch {
        // Fall through to the online chain.
      }
    }
    return this.resolveOnline(track, opts);
  }

  private resolveOnline(track: Track, opts: ResolveOptions = {}): Promise<ResolveResult> {
    if (opts.forceRefresh) {
      this.cache.delete(track.id);
    } else {
      const hit = this.cache.get(track.id);
      if (hit) return Promise.resolve({ resolved: hit, tried: [], fromCache: true });
    }
    // One shared promise per track: overlapping UI + preload + engine calls
    // never fan out into duplicate network requests.
    return runDeduped(this.inflight, track.id, () => this.resolveUncached(track, opts.adapters));
  }

  private async resolveUncached(track: Track, adapters?: AudioSource[]): Promise<ResolveResult> {
    const tried: string[] = [];
    // Offline: never probe network sources. Only the on-device local adapter
    // runs; anything else would be a doomed fetch storm.
    let chain = this.chain(adapters);
    if (!adapters && !isOnline()) chain = chain.filter((s) => s.id === 'local');
    for (const src of chain) {
      if (!this.isAdapterEnabled(src)) continue;
      tried.push(src.id);
      let candidate: AdapterResolvedAudio | null = null;
      try {
        candidate = await src.resolve(track);
      } catch (err) {
        this.noteError(src.id, err);
        continue;
      }
      if (!candidate || typeof candidate.url !== 'string' || !candidate.url) continue;
      if (candidate.expiresAt !== undefined && Date.now() + EXPIRY_SKEW_MS >= candidate.expiresAt) {
        // Already-expired URL is a miss, not a result — fall through so the
        // next source is tried and nothing poisoned enters the cache.
        continue;
      }
      const normalized = this.normalize(track, src.id, candidate);
      this.cache.set(track.id, normalized);
      return { resolved: normalized, tried, fromCache: false };
    }
    const ytId = await this.youtubePlayerFallback(track);
    if (ytId) {
      tried.push(YOUTUBE_PLAYER_SOURCE_ID);
      const fallback: ResolvedAudio = { sourceId: YOUTUBE_PLAYER_SOURCE_ID, type: 'iframe', ytId };
      this.cache.set(track.id, fallback);
      return { resolved: fallback, tried, fromCache: false };
    }
    return { resolved: null, tried, fromCache: false };
  }

  private normalize(track: Track, sourceId: string, r: AdapterResolvedAudio): ResolvedAudio {
    return {
      sourceId,
      url: https(r.url),
      type: 'direct',
      codec: r.codec,
      mimeType: r.mimeType,
      bitrate: r.bitrate,
      bitrateKbps: r.bitrateKbps,
      sampleRate: r.sampleRate,
      bitDepth: r.bitDepth,
      channels: r.channels,
      container: r.container,
      duration: r.duration,
      isLossless: r.isLossless,
      streamType: r.streamType,
      networkType: r.networkType,
      bufferedSeconds: r.bufferedSeconds,
      expiresAt: r.expiresAt,
      ytId: sourceId === 'youtube' && YT_ID_RE.test(track.id) ? track.id : undefined,
      downloadUrl: track.downloadUrl ? https(track.downloadUrl) : undefined,
    };
  }

  /** Final fallback policy (moved verbatim from the old engine inline logic). */
  private async youtubePlayerFallback(track: Track): Promise<string | null> {
    // The iframe player is a network surface — never attempt it offline.
    if (!isOnline()) return null;
    if (YT_ID_RE.test(track.id)) return track.id;
    if (resolutionRoute(track) !== 'saavn') return null;
    return this.findYoutubeMatch(track);
  }

  /** Best-effort YouTube match for a non-YouTube track. Null, never throws. */
  async findYoutubeMatch(track: Track): Promise<string | null> {
    if (!isOnline()) return null;
    try {
      const hits = await searchYouTube(`${track.title} ${track.author}`);
      return hits.find((h) => h && YT_ID_RE.test(h.id))?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fresh YouTube direct URL for backend recovery (expired-URL retry,
   * Saavn→YouTube switch). Caches under the track on success. Null, never throws.
   */
  async refreshYoutubeDirect(track: Track, videoId: string): Promise<ResolvedAudio | null> {
    if (!isOnline()) return null;
    let fresh = null;
    try {
      fresh = await resolveYouTubeAudio(videoId);
    } catch {
      return null;
    }
    if (!fresh) return null;
    const normalized: ResolvedAudio = {
      sourceId: 'youtube',
      url: https(fresh.streamUrl),
      type: 'direct',
      mimeType: fresh.mimeType,
      bitrateKbps: typeof fresh.bitrate === 'number' ? Math.round(fresh.bitrate / 1000) : undefined,
      expiresAt: fresh.expiresAt,
      ytId: videoId,
      downloadUrl: track.downloadUrl ? https(track.downloadUrl) : undefined,
    };
    this.cache.set(track.id, normalized);
    return normalized;
  }

  /** Record an iframe fallback chosen outside the normal chain (recovery path). */
  cacheIframeFallback(trackId: string, ytId: string): void {
    if (!trackId || !YT_ID_RE.test(ytId)) return;
    this.cache.set(trackId, { sourceId: YOUTUBE_PLAYER_SOURCE_ID, type: 'iframe', ytId });
  }

  async healthCheckAll(): Promise<Record<string, { ok: boolean; detail: string }>> {
    const out: Record<string, { ok: boolean; detail: string }> = {};
    for (const src of this.chain()) {
      try {
        out[src.id] = await src.healthCheck();
      } catch {
        out[src.id] = { ok: false, detail: 'check failed' };
      }
    }
    return out;
  }

  private noteError(sourceId: string, err: unknown): void {
    this.lastErrors.set(sourceId, {
      message: err instanceof Error ? err.message : String(err),
      at: Date.now(),
    });
  }
}

export const audioSourceManager = new AudioSourceManager();
