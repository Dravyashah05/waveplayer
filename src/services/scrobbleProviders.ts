import { settingsStore } from './settingsStore';
import { md5Hex } from './md5';
import { registerScrobbleProvider, type ScrobblePayload, type ScrobbleProvider } from './scrobbleService';

// Credentials live ONLY in module memory for the session (never localStorage,
// never React state, never URLs). Persisting them requires a backend vault,
// which this project does not have — reconnect each session.

interface LastfmCreds {
  apiKey: string;
  secret: string;
  sessionKey: string;
  username: string;
}
let lastfmCreds: LastfmCreds | null = null;

export function setLastfmCredentials(c: LastfmCreds | null): void {
  lastfmCreds = c && c.apiKey && c.secret && c.sessionKey ? c : null;
}

export function lastfmConnected(): boolean {
  return !!lastfmCreds;
}

async function lastfmCall(params: Record<string, string>): Promise<any> {
  if (!lastfmCreds) throw new Error('not connected');
  const all: Record<string, string> = { api_key: lastfmCreds.apiKey, sk: lastfmCreds.sessionKey, format: 'json', ...params };
  // Last.fm mandates MD5 api_sig over sorted key+value pairs + secret.
  const sigBase = Object.keys(all)
    .filter((k) => k !== 'format')
    .sort()
    .map((k) => `${k}${all[k]}`)
    .join('') + lastfmCreds.secret;
  const body = new URLSearchParams({ ...all, api_sig: md5Hex(sigBase) });
  const res = await fetch('https://ws.audioscrobbler.com/2.0/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`lastfm ${res.status}`);
  return res.json();
}

const lastfmProvider: ScrobbleProvider = {
  id: 'lastfm',
  isEnabled: () => settingsStore.get().scrobbleLastfm && !!lastfmCreds,
  async nowPlaying(p: ScrobblePayload) {
    await lastfmCall({ method: 'track.updateNowPlaying', artist: p.artist, track: p.title, album: p.album || '', duration: String(p.duration) });
  },
  async scrobble(p: ScrobblePayload) {
    await lastfmCall({ method: 'track.scrobble', artist: p.artist, track: p.title, album: p.album || '', timestamp: String(p.timestamp), duration: String(p.duration) });
  },
};

let listenbrainzToken: string | null = null;

export function setListenbrainzToken(token: string | null): void {
  listenbrainzToken = token?.trim() ? token.trim() : null;
}

export function listenbrainzConnected(): boolean {
  return !!listenbrainzToken;
}

async function lbSubmit(type: 'playing_now' | 'single', p: ScrobblePayload): Promise<void> {
  if (!listenbrainzToken) throw new Error('not connected');
  const res = await fetch('https://api.listenbrainz.org/1/submit-listens', {
    method: 'POST',
    headers: { Authorization: `Token ${listenbrainzToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listen_type: type,
      payload: [
        {
          listened_at: type === 'single' ? p.timestamp : undefined,
          track_metadata: {
            artist_name: p.artist,
            track_name: p.title,
            release_name: p.album,
            additional_info: { duration: p.duration, media_player: 'Wave Player' },
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`listenbrainz ${res.status}`);
}

const listenbrainzProvider: ScrobbleProvider = {
  id: 'listenbrainz',
  isEnabled: () => settingsStore.get().scrobbleListenbrainz && !!listenbrainzToken,
  async nowPlaying(p) {
    await lbSubmit('playing_now', p);
  },
  async scrobble(p) {
    await lbSubmit('single', p);
  },
};

let registered = false;
export function registerScrobbleProviders(): void {
  if (registered) return;
  registered = true;
  registerScrobbleProvider(lastfmProvider);
  registerScrobbleProvider(listenbrainzProvider);
}
