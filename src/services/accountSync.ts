import { googleAccountStore } from '../hooks/useGoogleAccount';
import { currentScope, scopeKey, clearScopedKey } from './scopedStorage';
import { clearYTMusicLibraryCache } from './ytmusicLibrary';
import { clearPlaylistCache } from './playlistModel';
import { clearRadioCache, stopRadio } from './radioEngine';

/**
 * Google + YouTube Music Account Sync 2.0.
 *
 * Unified account state + explicit sync over the EXISTING auth architecture:
 * Google OAuth (identity/session), official YouTube Data API (account ops),
 * ytmusicapi (Music-specific data). Nothing here touches tokens, cookies or
 * headers — those stay server-side; the browser only sees normalized state
 * via session-cookie fetches. No background mutation of the user's account
 * ever happens: sync only refreshes Wave's cached representation, and
 * playlist transfers stay explicit (Import/Export with preview + confirm).
 */

export type ConnectionState =
  | 'signed-out'
  | 'ok'
  | 'partial'
  | 'expired'
  | 'unavailable';

export interface AccountCapabilities {
  readLibrary: boolean;
  readHistory: boolean;
  managePlaylists: boolean;
  manageLikes: boolean;
}

export interface AccountState {
  googleConnected: boolean;
  googleProfile: { id: string; name: string; email: string; picture?: string } | null;
  youtubeConnected: boolean;
  youtubeMusicConnected: boolean;
  youtubeServiceAvailable: boolean;
  capabilities: AccountCapabilities;
  connection: ConnectionState;
  checkedAt: number;
}

export const YOUTUBE_WRITE_SCOPE = 'https://www.googleapis.com/auth/youtube';

const FETCH_TIMEOUT_MS = 10_000;

async function fetchJson(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(path, { credentials: 'include', ...init, signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function hasManageScope(scopes: unknown): boolean {
  return Array.isArray(scopes) && scopes.includes(YOUTUBE_WRITE_SCOPE);
}

/**
 * Probe the three existing auth surfaces and merge them into one honest
 * account state. Capabilities are never claimed beyond what the current
 * authentication actually provides:
 * - manage* requires the YouTube Data API `youtube` (manage) scope;
 * - readHistory requires ytmusicapi credentials (the Data API has no
 *   watch-history surface);
 * - readLibrary is true when either surface is connected.
 */
export function buildAccountState(
  me: { connected?: boolean; user?: { id?: string; email?: string; name?: string; picture?: string } | null; youtubeConnected?: boolean; scopes?: string[] },
  ytStatus: { connected?: boolean; scopes?: string[] },
  pyStatus: { authenticated?: boolean; available?: boolean },
  meReachable: boolean,
): AccountState {
  const googleConnected = !!me?.connected && !!me?.user?.id;
  const youtubeConnected = googleConnected && !!me?.youtubeConnected;
  const youtubeMusicConnected = !!pyStatus?.authenticated;
  const youtubeServiceAvailable = meReachable && (pyStatus?.available !== false);
  const canWrite = (youtubeConnected && hasManageScope(me?.scopes)) || hasManageScope(ytStatus?.scopes);
  const capabilities: AccountCapabilities = {
    readLibrary: youtubeConnected || youtubeMusicConnected,
    readHistory: youtubeMusicConnected,
    managePlaylists: canWrite,
    manageLikes: canWrite,
  };
  let connection: ConnectionState;
  if (!meReachable) {
    connection = 'unavailable';
  } else if (!googleConnected) {
    connection = 'signed-out';
  } else if (me?.connected && !me?.user) {
    connection = 'expired';
  } else if (youtubeConnected || youtubeMusicConnected) {
    connection = 'ok';
  } else if (youtubeServiceAvailable) {
    // Google identity works but no YouTube surface is linked.
    connection = 'partial';
  } else {
    connection = 'partial';
  }
  return {
    googleConnected,
    googleProfile: googleConnected
      ? {
          id: String(me!.user!.id),
          name: String(me!.user!.name || ''),
          email: String(me!.user!.email || ''),
          picture: me!.user!.picture ? String(me!.user!.picture) : undefined,
        }
      : null,
    youtubeConnected,
    youtubeMusicConnected,
    youtubeServiceAvailable,
    capabilities,
    connection,
    checkedAt: Date.now(),
  };
}

export async function fetchAccountState(): Promise<AccountState> {
  const [me, yt, py] = await Promise.all([
    fetchJson('/api/auth/me'),
    fetchJson('/api/auth/youtube/status'),
    fetchJson('/api/ytmusic-py/auth/status'),
  ]);
  return buildAccountState(
    (me.ok ? me.data : {}) as any,
    (yt.ok ? yt.data : {}) as any,
    (py.ok ? py.data : { available: false }) as any,
    me.status !== 0,
  );
}

// ---------------------------------------------------------------------------
// Explicit sync (refresh Wave's cached representation only)
// ---------------------------------------------------------------------------

export type SyncCategory = 'playlists' | 'likedSongs' | 'songs' | 'albums' | 'artists' | 'history';
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'partial' | 'error';

export interface SyncResult {
  status: SyncStatus;
  categories: Record<SyncCategory, 'success' | 'failed' | 'skipped'>;
  counts: Partial<Record<SyncCategory, number>>;
  lastSyncedAt: number | null;
  message: string;
}

const SYNC_BASE = 'yt_sync_v1';
const SYNC_EVENT = 'wave:yt_sync';

function readStoredSync(): { at: number | null; counts: Partial<Record<SyncCategory, number>> } {
  try {
    const raw = localStorage.getItem(scopeKey(SYNC_BASE));
    if (!raw) return { at: null, counts: {} };
    const parsed = JSON.parse(raw) as { scope?: string; at?: number; counts?: Partial<Record<SyncCategory, number>> };
    if (!parsed || parsed.scope !== currentScope()) return { at: null, counts: {} };
    return { at: typeof parsed.at === 'number' ? parsed.at : null, counts: parsed.counts || {} };
  } catch {
    return { at: null, counts: {} };
  }
}

function writeStoredSync(at: number, counts: Partial<Record<SyncCategory, number>>): void {
  try {
    localStorage.setItem(scopeKey(SYNC_BASE), JSON.stringify({ scope: currentScope(), at, counts }));
  } catch { /* sync stamp is best-effort */ }
}

export function lastSyncInfo(): { at: number | null; counts: Partial<Record<SyncCategory, number>> } {
  return readStoredSync();
}

export function notifySync(result: SyncResult): void {
  try {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: result }));
  } catch { /* listeners are optional */ }
}

export function subscribeSync(fn: (r: SyncResult) => void): () => void {
  const handler = (e: Event) => {
    try {
      fn((e as CustomEvent).detail as SyncResult);
    } catch { /* never break publishers */ }
  };
  window.addEventListener(SYNC_EVENT, handler);
  return () => window.removeEventListener(SYNC_EVENT, handler);
}

const LIB_EVENT = 'wave:yt_library_changed';

/**
 * Light refresh signal after an explicit playlist mutation (export, import,
 * add, remove). Reloads the visible library category only — never a full
 * account refresh, never after every track play.
 */
export function notifyLibraryChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(LIB_EVENT));
  } catch { /* listeners are optional */ }
}

export function subscribeLibraryChanged(fn: () => void): () => void {
  const handler = () => {
    try {
      fn();
    } catch { /* never break publishers */ }
  };
  window.addEventListener(LIB_EVENT, handler);
  return () => window.removeEventListener(LIB_EVENT, handler);
}

function syncMessage(status: SyncStatus): string {
  if (status === 'success') return 'YouTube Music synced';
  if (status === 'partial') return 'Some YouTube Music data could not be synced';
  if (status === 'error') return "Couldn't sync YouTube Music";
  return 'Syncing YouTube Music…';
}

let inflight: Promise<SyncResult> | null = null;

/**
 * Explicit "Sync YouTube Music": bounded refresh of each category through
 * the existing gateway getters (which warm the per-user server cache).
 * Concurrent calls share one job; one failed category degrades to `partial`,
 * never total failure. No polling, no background mutation.
 */
export function startSync(): Promise<SyncResult> {
  if (inflight) return inflight;
  inflight = runSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSync(): Promise<SyncResult> {
  // Dynamic import keeps the sync engine out of the startup bundle.
  const lib = await import('./ytmusicLibrary');
  const categories: SyncCategory[] = ['playlists', 'likedSongs', 'songs', 'albums', 'artists', 'history'];
  const states = {} as Record<SyncCategory, 'success' | 'failed' | 'skipped'>;
  const counts: Partial<Record<SyncCategory, number>> = {};
  const loaders: Record<SyncCategory, () => Promise<{ length?: number } | unknown[]>> = {
    playlists: () => lib.getPlaylists(50),
    likedSongs: () => lib.getLikedSongs(100),
    songs: () => lib.getSongs(100),
    albums: () => lib.getAlbums(50),
    artists: () => lib.getArtists(50),
    history: () => lib.getHistory(),
  };
  for (const c of categories) {
    try {
      const data: any = await loaders[c]();
      states[c] = 'success';
      counts[c] = Array.isArray(data) ? data.length : typeof data?.length === 'number' ? data.length : 0;
    } catch {
      states[c] = 'failed';
    }
  }
  const failed = categories.filter((c) => states[c] === 'failed');
  const status: SyncStatus = failed.length === 0 ? 'success' : failed.length === categories.length ? 'error' : 'partial';
  const at = status === 'error' ? readStoredSync().at : Date.now();
  if (status !== 'error') writeStoredSync(at!, counts);
  const result: SyncResult = { status, categories: states, counts, lastSyncedAt: at, message: syncMessage(status) };
  notifySync(result);
  return result;
}

// ---------------------------------------------------------------------------
// Logout / disconnect / account switching (local Wave data is preserved)
// ---------------------------------------------------------------------------

/** Scoped bases holding private per-user data (verified against the codebase).
 * Local playlists/history/favs are NOT listed — logout never deletes them. */
const PRIVATE_BASES = [
  'yt_history_v1', // historyMerge YT history cache (scoped)
  'yt_sync_v1', // this module's sync stamp (scoped)
  'home_cache_v1', // personalized home payload (scoped)
];

/** Drop every in-memory + scoped private cache for the current user. */
export function clearPrivateCaches(): void {
  try {
    clearYTMusicLibraryCache();
  } catch {}
  try {
    clearPlaylistCache();
  } catch {}
  try {
    clearRadioCache();
  } catch {}
  for (const base of PRIVATE_BASES) {
    try {
      clearScopedKey(base);
    } catch {}
  }
}

export interface DisconnectResult {
  ok: boolean;
  message: string;
}

/**
 * Full Google logout: destroy the server session, clear frontend account
 * state + private caches + radio session, keep local Wave data.
 */
export async function logoutEverywhere(): Promise<DisconnectResult> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* session expiry is best-effort; local cleanup still runs */ }
  try {
    stopRadio();
  } catch {}
  clearPrivateCaches();
  try {
    googleAccountStore.set({ connected: false, user: null, youtubeConnected: false, scopes: [] });
  } catch {}
  return { ok: true, message: 'Signed out. Local Wave data is unchanged.' };
}

/**
 * YouTube-only disconnect: revoke the YouTube credential server-side,
 * clear YT-derived caches, keep Google identity + local Wave data.
 */
export async function disconnectYoutube(): Promise<DisconnectResult> {
  try {
    await fetch('/api/auth/youtube/disconnect', { method: 'POST', credentials: 'include' });
  } catch { /* local cleanup still runs */ }
  try {
    stopRadio();
  } catch {}
  clearPrivateCaches();
  try {
    await googleAccountStore.reload();
  } catch {}
  return { ok: true, message: 'YouTube disconnected. Local Wave data is unchanged.' };
}

/**
 * Account-switch guard: when the signed-in user changed since the last
 * check, wipe private caches BEFORE new data loads so stale data from the
 * previous account is never displayed.
 */
let lastScope: string | null = null;

export function ensureAccountIsolation(): boolean {
  let scope: string;
  try {
    scope = currentScope();
  } catch {
    return false;
  }
  if (lastScope === null) {
    lastScope = scope;
    return false;
  }
  if (lastScope !== scope) {
    lastScope = scope;
    clearPrivateCaches();
    return true;
  }
  return false;
}

export function resetAccountIsolation(): void {
  lastScope = null;
}
