import type { Track } from '../types';
import { getSaavnSongDetails } from './saavnApi';
import { resolveYouTubeAudio } from './ytmusicApi';
import { searchYouTube } from './youtubeSearch';
import { settingsStore } from './settingsStore';

export type AudioSourceType = 'saavn' | 'youtube' | 'local' | 'custom';
export type SourceStatus = 'available' | 'unavailable' | 'resolving' | 'failed' | 'disabled' | 'unknown';

export interface SourceCapabilities {
  codecs: string[];
  maxBitrateKbps: number | null;
  lossless: boolean | null;
  formats: string[];
}

export interface ResolvedAudio {
  url: string;
  source: AudioSourceType;
  sourceId: string;
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
  expiresAt?: number;
}

export interface NormalizedAudioMetadata {
  source?: string;
  codec?: string;
  mimeType?: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number | string;
  container?: string;
  duration?: number;
  isLossless?: boolean;
  streamType?: string;
  networkType?: string;
  bufferedSeconds?: number;
}

export function normalizeNetworkType(connection?: { effectiveType?: unknown; type?: unknown } | null): string | undefined {
  if (typeof connection?.effectiveType === 'string' && connection.effectiveType) return connection.effectiveType;
  if (typeof connection?.type === 'string' && connection.type) return connection.type;
  return undefined;
}

export interface StreamStats {
  source: string;
  codec: string;
  bitrate: string;
  sampleRate: string;
  bitDepth: string;
  channels: string;
  container: string;
  host: string;
  lossless: boolean | null;
}

const UNKNOWN = 'Unknown';
const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function saavnBitrate(url: string, qualities?: Track['qualities']): number | undefined {
  const quality = qualities?.find((entry) => entry.url === url)?.quality.match(/\d+/)?.[0];
  const value = Number(quality);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return UNKNOWN;
  }
}

export function codecFromMime(mime?: string): string | undefined {
  const m = (mime || '').toLowerCase();
  if (m.includes('mp4a') || m.includes('aac')) return 'AAC';
  if (m.includes('opus')) return 'Opus';
  if (m.includes('mpeg') || m.includes('mp3')) return 'MP3';
  if (m.includes('flac')) return 'FLAC';
  if (m.includes('wav')) return 'WAV';
  return undefined;
}

/** Copy only stream facts supplied by a resolver or an actual media element. */
export function normalizeAudioMetadata(resolved: ResolvedAudio, duration?: number): NormalizedAudioMetadata {
  const codec = resolved.codec || codecFromMime(resolved.mimeType);
  const mimeContainer = resolved.mimeType?.split(';', 1)[0]?.split('/')[1]?.trim().toUpperCase();
  const isLossless = typeof resolved.isLossless === 'boolean'
    ? resolved.isLossless
    : codec === 'FLAC' ? true
      : codec === 'AAC' || codec === 'Opus' || codec === 'MP3' ? false : undefined;
  return {
    source: resolved.source === 'saavn' ? 'JioSaavn' : resolved.source === 'youtube' ? 'YouTube' : resolved.source === 'local' ? 'Local file' : resolved.sourceId,
    codec,
    mimeType: resolved.mimeType,
    bitrate: resolved.bitrate ?? resolved.bitrateKbps,
    sampleRate: resolved.sampleRate,
    bitDepth: resolved.bitDepth,
    channels: resolved.channels,
    container: resolved.container || mimeContainer,
    duration: duration ?? resolved.duration,
    isLossless,
    streamType: resolved.streamType,
    networkType: resolved.networkType,
    bufferedSeconds: resolved.bufferedSeconds,
  };
}

/** Honest stats: only values confirmed by resolved metadata; else Unknown. */
export function describeStream(r: ResolvedAudio, track?: Track | null): StreamStats {
  const labels: Record<AudioSourceType, string> = {
    saavn: 'JioSaavn',
    youtube: 'YouTube',
    local: 'Local file',
    custom: r.sourceId,
  };
  const metadata = normalizeAudioMetadata(r);
  let bitrate = UNKNOWN;
  if (typeof metadata.bitrate === 'number' && metadata.bitrate > 0) bitrate = `${metadata.bitrate} kbps`;
  void track;
  return {
    source: labels[r.source] || r.source,
    codec: metadata.codec || UNKNOWN,
    bitrate,
    sampleRate: UNKNOWN,
    bitDepth: UNKNOWN,
    channels: UNKNOWN,
    container: hostOf(r.url).includes('googlevideo') ? 'progressive stream' : hostOf(r.url) === 'Unknown' ? UNKNOWN : 'HTTP stream',
    host: hostOf(r.url),
    lossless: metadata.isLossless ?? null,
  };
}

export interface CustomSourceDef {
  id: string;
  name: string;
  baseUrl: string;
}

const LS_CUSTOM_SOURCES = 'wave:custom_sources';

export function getCustomSources(): CustomSourceDef[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_SOURCES);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => s && s.id && s.baseUrl) : [];
  } catch {
    return [];
  }
}

export function saveCustomSources(list: CustomSourceDef[]): void {
  try {
    localStorage.setItem(LS_CUSTOM_SOURCES, JSON.stringify(list.slice(0, 20)));
  } catch {}
}

// Local blob registry (populated by the local library; never persisted —
// blob URLs die with the session, metadata lives in IndexedDB).
const localRegistry = new Map<string, { url: string; mimeType?: string; bitrateKbps?: number }>();

export function registerLocalAudio(id: string, entry: { url: string; mimeType?: string; bitrateKbps?: number }): void {
  localRegistry.set(id, entry);
}

export function unregisterLocalAudio(id: string): void {
  localRegistry.delete(id);
}

export interface AudioSource {
  id: string;
  name: string;
  type: AudioSourceType;
  capabilities: SourceCapabilities;
  isEnabled(): boolean;
  resolve(track: Track): Promise<ResolvedAudio | null>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

const healthCache = new Map<string, { at: number; ok: boolean; detail: string }>();
const HEALTH_TTL = 60_000;

async function cachedHealth(id: string, work: () => Promise<{ ok: boolean; detail: string }>) {
  const hit = healthCache.get(id);
  if (hit && Date.now() - hit.at < HEALTH_TTL) return hit;
  try {
    const r = await work();
    const v = { at: Date.now(), ...r };
    healthCache.set(id, v);
    return v;
  } catch {
    const v = { at: Date.now(), ok: false, detail: 'request failed' };
    healthCache.set(id, v);
    return v;
  }
}

function enabled(id: string): boolean {
  return !settingsStore.get().disabledSources.includes(id);
}

function preferredSaavnQuality(): 'high' | 'low' {
  const s = settingsStore.get();
  const conn = (navigator as any)?.connection;
  const saveData = !!conn?.saveData;
  const effective = String(conn?.effectiveType || '');
  const onMobile = /2g|3g/.test(effective) || saveData;
  const pref = onMobile ? s.mobileQuality : s.wifiQuality;
  if (pref === 'low' || pref === 'medium') return 'low';
  if (pref === 'high' || pref === 'maximum' || pref === 'auto') return 'high';
  return s.quality === 'low' ? 'low' : 'high';
}

export const saavnSource: AudioSource = {
  id: 'saavn',
  name: 'JioSaavn',
  type: 'saavn',
  capabilities: { codecs: ['AAC'], maxBitrateKbps: 320, lossless: false, formats: ['AAC 320kbps', 'AAC 160kbps'] },
  isEnabled: () => enabled('saavn'),
  async resolve(track) {
    if (track.source === 'local' || (track.source !== 'saavn' && YT_ID_RE.test(track.id))) return null;
    if (track.streamUrl) {
      return { url: track.streamUrl, source: 'saavn', sourceId: 'saavn', bitrateKbps: saavnBitrate(track.streamUrl, track.qualities) };
    }
    try {
      const d = await getSaavnSongDetails(track.id);
      if (!d) return null;
      const wantLow = preferredSaavnQuality() === 'low';
      const q160 = d.qualities?.find((q) => q.quality === '160kbps')?.url;
      const url = (wantLow && q160) || d.streamUrl;
      if (!url) return null;
      return { url, source: 'saavn', sourceId: 'saavn', bitrateKbps: saavnBitrate(url, d.qualities) };
    } catch {
      return null;
    }
  },
  healthCheck: () =>
    cachedHealth('saavn', async () => {
      const res = await fetch(`/api/saavn?__call=search.getResults&q=${encodeURIComponent('test')}&p=1&n=1&_format=json&_marker=0&api_version=4&ctx=web6dot0`);
      if (!res.ok) return { ok: false, detail: `proxy ${res.status}` };
      const data = await res.json().catch(() => null);
      const n = Array.isArray(data?.results) ? data.results.length : 0;
      return n > 0 ? { ok: true, detail: 'metadata + streams available' } : { ok: false, detail: 'empty metadata response' };
    }),
};

export const youtubeSource: AudioSource = {
  id: 'youtube',
  name: 'YouTube',
  type: 'youtube',
  capabilities: { codecs: ['AAC', 'Opus'], maxBitrateKbps: 192, lossless: false, formats: ['AAC/Opus adaptive'] },
  isEnabled: () => enabled('youtube'),
  async resolve(track) {
    if (track.source === 'local') return null;
    try {
      const id = YT_ID_RE.test(track.id) ? track.id : undefined;
      if (id) {
        const a = await resolveYouTubeAudio(id);
        if (a) return { url: a.streamUrl, source: 'youtube', sourceId: 'youtube', mimeType: a.mimeType, bitrateKbps: a.bitrate ? Math.round(a.bitrate / 1000) : undefined, expiresAt: a.expiresAt };
      }
      const hits = await searchYouTube(`${track.title} ${track.author}`);
      const m = hits.find((h) => YT_ID_RE.test(h.id));
      if (!m) return null;
      const a = await resolveYouTubeAudio(m.id);
      if (!a) return null;
      return { url: a.streamUrl, source: 'youtube', sourceId: 'youtube', mimeType: a.mimeType, bitrateKbps: a.bitrate ? Math.round(a.bitrate / 1000) : undefined, expiresAt: a.expiresAt };
    } catch {
      return null;
    }
  },
  healthCheck: () =>
    cachedHealth('youtube', async () => {
      const res = await fetch('/api/ytmusic/health');
      return res.ok ? { ok: true, detail: 'metadata service reachable' } : { ok: false, detail: `service ${res.status}` };
    }),
};

export const localSource: AudioSource = {
  id: 'local',
  name: 'Local files',
  type: 'local',
  capabilities: { codecs: ['MP3', 'AAC', 'Opus', 'FLAC', 'WAV'], maxBitrateKbps: null, lossless: false, formats: ['user-provided files'] },
  isEnabled: () => enabled('local'),
  async resolve(track) {
    const hit = localRegistry.get(track.id);
    if (hit) return { url: hit.url, source: 'local', sourceId: 'local', mimeType: hit.mimeType, bitrateKbps: hit.bitrateKbps };
    if (track.source === 'local' && track.streamUrl?.startsWith('blob:')) {
      return { url: track.streamUrl, source: 'local', sourceId: 'local' };
    }
    return null;
  },
  healthCheck: async () => ({ ok: true, detail: 'browser playback always available' }),
};

/** Build a live adapter for one user-configured static host. Exported so the
 *  AudioSourceManager can register configured sources without duplicating
 *  the probing logic. */
export function buildCustomSource(def: CustomSourceDef): AudioSource {
  return {
    id: `custom:${def.id}`,
    name: def.name,
    type: 'custom' as AudioSourceType,
    capabilities: { codecs: [], maxBitrateKbps: null, lossless: false, formats: ['static file host'] },
    isEnabled: () => enabled(`custom:${def.id}`),
    async resolve(track: Track) {
      const base = def.baseUrl.replace(/\/+$/, '');
      const url = `${base}/${encodeURIComponent(track.id)}.mp3`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) return null;
        return { url, source: 'custom' as AudioSourceType, sourceId: def.name };
      } catch {
        return null;
      }
    },
    healthCheck: () =>
      cachedHealth(`custom:${def.id}`, async () => {
        try {
          const res = await fetch(def.baseUrl, { method: 'HEAD' });
          return res.ok ? { ok: true, detail: 'host reachable' } : { ok: false, detail: `host ${res.status}` };
        } catch {
          return { ok: false, detail: 'host unreachable' };
        }
      }),
  };
}

function customSources(): AudioSource[] {
  return getCustomSources().map(buildCustomSource);
}

export function listSources(): AudioSource[] {
  const order = settingsStore.get().sourcePriority;
  const all: AudioSource[] = [saavnSource, youtubeSource, localSource, ...customSources()];
  const rank = new Map(order.map((id, i) => [id, i]));
  return all.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}
