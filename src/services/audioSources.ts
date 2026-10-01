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
  lossless: boolean;
  formats: string[];
}

export interface ResolvedAudio {
  url: string;
  source: AudioSourceType;
  sourceId: string;
  mimeType?: string;
  bitrateKbps?: number;
  expiresAt?: number;
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
  lossless: boolean;
}

const UNKNOWN = 'Unknown';
const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return UNKNOWN;
  }
}

function codecFromMime(mime?: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('mp4a') || m.includes('aac')) return 'AAC';
  if (m.includes('webm') || m.includes('opus')) return 'Opus';
  if (m.includes('mpeg') || m.includes('mp3')) return 'MP3';
  if (m.includes('flac')) return 'FLAC';
  if (m.includes('wav')) return 'WAV';
  return UNKNOWN;
}

/** Honest stats: only values confirmed by resolved metadata; else Unknown. */
export function describeStream(r: ResolvedAudio, track?: Track | null): StreamStats {
  const labels: Record<AudioSourceType, string> = {
    saavn: 'JioSaavn',
    youtube: 'YouTube',
    local: 'Local file',
    custom: r.sourceId,
  };
  let bitrate = UNKNOWN;
  if (typeof r.bitrateKbps === 'number' && r.bitrateKbps > 0) bitrate = `${r.bitrateKbps} kbps`;
  else if (r.source === 'saavn') bitrate = r.url.includes('_320') ? '320 kbps' : r.url.includes('_160') ? '160 kbps' : UNKNOWN;
  void track;
  return {
    source: labels[r.source] || r.source,
    codec: codecFromMime(r.mimeType),
    bitrate,
    sampleRate: UNKNOWN,
    bitDepth: UNKNOWN,
    channels: UNKNOWN,
    container: hostOf(r.url).includes('googlevideo') ? 'progressive stream' : hostOf(r.url) === 'Unknown' ? UNKNOWN : 'HTTP stream',
    host: hostOf(r.url),
    lossless: false,
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

const saavnSource: AudioSource = {
  id: 'saavn',
  name: 'JioSaavn',
  type: 'saavn',
  capabilities: { codecs: ['AAC'], maxBitrateKbps: 320, lossless: false, formats: ['AAC 320kbps', 'AAC 160kbps'] },
  isEnabled: () => enabled('saavn'),
  async resolve(track) {
    if (track.streamUrl) {
      return { url: track.streamUrl, source: 'saavn', sourceId: 'saavn', bitrateKbps: track.streamUrl.includes('_320') ? 320 : track.streamUrl.includes('_160') ? 160 : undefined };
    }
    try {
      const d = await getSaavnSongDetails(track.id);
      if (!d) return null;
      const wantLow = preferredSaavnQuality() === 'low';
      const q160 = d.qualities?.find((q) => q.quality === '160kbps')?.url;
      const url = (wantLow && q160) || d.streamUrl;
      if (!url) return null;
      return { url, source: 'saavn', sourceId: 'saavn', bitrateKbps: url.includes('_320') ? 320 : url.includes('_160') ? 160 : undefined };
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

const youtubeSource: AudioSource = {
  id: 'youtube',
  name: 'YouTube',
  type: 'youtube',
  capabilities: { codecs: ['AAC', 'Opus'], maxBitrateKbps: 192, lossless: false, formats: ['AAC/Opus adaptive'] },
  isEnabled: () => enabled('youtube'),
  async resolve(track) {
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

const localSource: AudioSource = {
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

function customSources(): AudioSource[] {
  return getCustomSources().map((def) => ({
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
  }));
}

export function listSources(): AudioSource[] {
  const order = settingsStore.get().sourcePriority;
  const all: AudioSource[] = [saavnSource, youtubeSource, localSource, ...customSources()];
  const rank = new Map(order.map((id, i) => [id, i]));
  return all.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}

/** Resolve through enabled sources in priority order; first success wins. */
export async function resolveWithFallback(track: Track): Promise<{ resolved: ResolvedAudio | null; tried: string[] }> {
  const tried: string[] = [];
  for (const src of listSources()) {
    if (!src.isEnabled()) continue;
    tried.push(src.id);
    try {
      const r = await src.resolve(track);
      if (r?.url) return { resolved: r, tried };
    } catch {}
  }
  return { resolved: null, tried };
}
