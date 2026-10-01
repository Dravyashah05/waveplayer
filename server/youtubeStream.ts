export interface AudioFormat {
  url?: unknown;
  mimeType?: unknown;
  bitrate?: unknown;
  contentLength?: unknown;
}

export interface SongStreamData {
  videoId?: unknown;
  formats?: unknown;
  adaptiveFormats?: unknown;
}

export interface ResolvedYouTubeAudio {
  videoId: string;
  streamUrl: string;
  expiresAt?: number;
  mimeType: string;
  bitrate?: number;
  contentLength?: number;
}

export const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
export const YOUTUBE_AUDIO_CONFIG = { preferredBitrate: 128_000, maxBitrate: 192_000 } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDirectAudioFormat(value: unknown): value is AudioFormat & { url: string; mimeType: string } {
  if (!isRecord(value) || typeof value.url !== 'string' || typeof value.mimeType !== 'string') return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' && /(^|\.)googlevideo\.com$/i.test(url.hostname) && /^audio\//i.test(value.mimeType);
  } catch {
    return false;
  }
}

function numericField(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Select only directly exposed HTTPS audio formats; cipher-only entries are deliberately ignored. */
export function selectBestAudioFormat(formats: unknown[], config = YOUTUBE_AUDIO_CONFIG): AudioFormat & { url: string; mimeType: string } | null {
  const candidates = formats.filter(isDirectAudioFormat);
  if (!candidates.length) return null;
  const mimeRank = (mime: string) => {
    const m = mime.toLowerCase();
    if (m.includes('audio/mp4')) return 0;
    if (m.includes('audio/webm')) return 1;
    if (m.includes('audio/ogg')) return 2;
    return 3;
  };
  return candidates.sort((a, b) => {
    const bitrateA = numericField(a.bitrate);
    const bitrateB = numericField(b.bitrate);
    const inRangeA = bitrateA !== undefined && bitrateA <= config.maxBitrate ? 0 : 1;
    const inRangeB = bitrateB !== undefined && bitrateB <= config.maxBitrate ? 0 : 1;
    const distanceA = bitrateA === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(bitrateA - config.preferredBitrate);
    const distanceB = bitrateB === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(bitrateB - config.preferredBitrate);
    return inRangeA - inRangeB || mimeRank(a.mimeType) - mimeRank(b.mimeType) || distanceA - distanceB;
  })[0];
}

function getExpiry(url: string): number | undefined {
  try {
    const raw = new URL(url).searchParams.get('expire');
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveYouTubeAudio(
  videoId: string,
  getSong: (id: string) => Promise<SongStreamData>,
): Promise<ResolvedYouTubeAudio | null> {
  if (!YOUTUBE_VIDEO_ID.test(videoId)) throw new TypeError('INVALID_VIDEO_ID');
  const song = await getSong(videoId);
  if (song.videoId !== videoId) return null;
  const formats = [
    ...(Array.isArray(song.adaptiveFormats) ? song.adaptiveFormats : []),
    ...(Array.isArray(song.formats) ? song.formats : []),
  ];
  const format = selectBestAudioFormat(formats);
  if (!format) return null;
  return {
    videoId,
    streamUrl: format.url,
    expiresAt: getExpiry(format.url),
    mimeType: format.mimeType,
    bitrate: numericField(format.bitrate),
    contentLength: numericField(format.contentLength),
  };
}
