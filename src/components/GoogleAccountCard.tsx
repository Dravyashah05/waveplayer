import { useCallback, useEffect, useState } from 'react';
import { Youtube, RefreshCw, Unplug, CheckCircle2, CloudDownload, Music2 } from 'lucide-react';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { UserAvatar } from './UserAvatar';
import {
  disconnectYoutube as disconnectYoutubeEverywhere,
  fetchAccountState,
  lastSyncInfo,
  logoutEverywhere,
  startSync,
  subscribeSync,
  type AccountState,
  type SyncResult,
} from '../services/accountSync';

function formatAgo(at: number | null): string {
  if (!at) return 'Never';
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function GoogleAccountCard() {
  const { connected, user, youtubeConnected, reload } = useGoogleAccount();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Unified account state (Google + YouTube Data + YouTube Music surfaces).
  const [account, setAccount] = useState<AccountState | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [lastSync, setLastSync] = useState<{ at: number | null; counts: Partial<Record<string, number>> }>(() => lastSyncInfo());

  const refreshAccount = useCallback(async () => {
    try {
      const s = await fetchAccountState();
      setAccount(s);
    } catch {
      // Card keeps last-known state; connection errors surface as messages.
    }
    setLastSync(lastSyncInfo());
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount, connected, youtubeConnected]);

  useEffect(() => subscribeSync((r: SyncResult) => {
    setSyncBusy(false);
    setSyncMsg(r.message);
    setLastSync(lastSyncInfo());
  }), []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('google');
    if (!result) return;
    setMessage(
      result === 'connected'
        ? 'Account connected successfully.'
        : result === 'cancelled'
        ? 'Google sign-in was cancelled.'
        : result === 'required'
        ? 'Sign in with Google first.'
        : 'Google connection failed. Check your configuration and try again.'
    );
    params.delete('google');
    history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    void reload();
  }, [reload]);

  const disconnect = async () => {
    setBusy(true);
    try {
      const r = await logoutEverywhere();
      setMessage(r.message);
    } finally {
      await reload();
      await refreshAccount();
      setBusy(false);
    }
  };

  const disconnectYoutube = async () => {
    setBusy(true);
    try {
      const r = await disconnectYoutubeEverywhere();
      setMessage(r.message);
    } finally {
      await reload();
      await refreshAccount();
      setBusy(false);
    }
  };

  const runSync = async () => {
    if (syncBusy) return;
    // Offline actions report instead of silently failing.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncMsg('You are offline. Reconnect, then sync — cached content still works.');
      return;
    }
    setSyncBusy(true);
    setSyncMsg('Syncing YouTube Music…');
    try {
      await startSync();
      // Final message + stamp arrive via the sync subscription above.
      await refreshAccount();
    } catch {
      setSyncBusy(false);
      setSyncMsg("Couldn't sync YouTube Music");
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-3">
        <UserAvatar
          user={user}
          sizeClass="h-10 w-10"
          iconSizeClass="h-5 w-5"
          textSizeClass="text-sm font-bold"
          showStatus={connected}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-white truncate">
              {user?.name || 'Google / YouTube'}
            </h3>
            {connected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
          </div>
          <p className="text-xs text-white/50 truncate">
            {user ? user.email : 'Connect an account to manage YouTube playlists.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
            connected ? 'bg-emerald-400/10 text-emerald-300 border border-emerald-500/20' : 'bg-white/5 text-white/50'
          }`}
        >
          {connected ? 'Google connected' : 'Google not connected'}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
            youtubeConnected ? 'bg-red-400/10 text-red-300 border border-red-500/20' : 'bg-white/5 text-white/50'
          }`}
        >
          {youtubeConnected ? 'YouTube connected' : 'YouTube not connected'}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
            account?.youtubeMusicConnected ? 'bg-red-400/10 text-red-300 border border-red-500/20' : 'bg-white/5 text-white/50'
          }`}
        >
          {account?.youtubeMusicConnected ? 'YouTube Music connected' : 'YouTube Music not connected'}
        </span>
      </div>
      {account && (account.youtubeConnected || account.youtubeMusicConnected) && (
        <div className="flex flex-wrap gap-2 text-xs" aria-label="YouTube capabilities">
          {account.capabilities.readLibrary && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/60">Read library</span>
          )}
          {account.capabilities.readHistory && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/60">Read history</span>
          )}
          {account.capabilities.managePlaylists && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/60">Manage playlists</span>
          )}
          {!account.capabilities.managePlaylists && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-white/40">Playlists read-only</span>
          )}
        </div>
      )}
      <p className="text-xs text-white/45">
        YouTube access is optional and requested only when you connect YouTube. Wave keeps OAuth credentials on the server.
      </p>
      {/* Explicit sync — refreshes Wave's cached copy only, never the account. */}
      {(account?.capabilities.readLibrary || lastSync.at) && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <Music2 className="h-3.5 w-3.5 text-white/60" />
              <span className="font-semibold text-white/80">YouTube Music sync</span>
            </div>
            <span className="text-[11px] text-white/45">
              Last synced: {formatAgo(lastSync.at)}
            </span>
          </div>
          {!!(lastSync.counts.playlists || lastSync.counts.likedSongs) && (
            <p className="text-[11px] text-white/45">
              Playlists: {lastSync.counts.playlists ?? '—'} • Liked songs: {lastSync.counts.likedSongs ?? '—'}
              {typeof lastSync.counts.albums === 'number' ? ` • Albums: ${lastSync.counts.albums}` : ''}
              {typeof lastSync.counts.artists === 'number' ? ` • Artists: ${lastSync.counts.artists}` : ''}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={syncBusy || !account?.capabilities.readLibrary}
              onClick={() => void runSync()}
              title={account?.capabilities.readLibrary ? 'Refresh your cached YouTube Music library' : 'Connect YouTube Music first'}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 active:scale-95 transition-all shadow disabled:opacity-40"
            >
              <CloudDownload className={`h-3.5 w-3.5 ${syncBusy ? 'animate-pulse' : ''}`} />
              {syncBusy ? 'Syncing…' : 'Sync YouTube Music'}
            </button>
            {account && !account.youtubeMusicConnected && account.youtubeConnected && (
              <span className="text-[11px] text-white/40">Music credentials not linked — library sync may be limited.</span>
            )}
          </div>
          {syncMsg && <p role="status" className="text-xs text-white/60">{syncMsg}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <button
            onClick={() => location.assign('/api/auth/google')}
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 active:scale-95 transition-all shadow"
          >
            Continue with Google
          </button>
        ) : (
          <>
            {!youtubeConnected ? (
              <button
                onClick={() => location.assign('/api/auth/youtube/connect')}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 active:scale-95 transition-all shadow"
              >
                <Youtube className="h-3.5 w-3.5 text-red-600" /> Connect YouTube
              </button>
            ) : (
              <>
                {account && !account.capabilities.managePlaylists && (
                  <button
                    onClick={() => location.assign('/api/auth/youtube/connect?manage=1')}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 active:scale-95 transition-all shadow"
                  >
                    <Youtube className="h-3.5 w-3.5 text-red-600" /> Reconnect with playlist access
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => void disconnectYoutube()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white active:scale-95 transition-all"
                >
                  <Unplug className="h-3.5 w-3.5" /> Disconnect YouTube
                </button>
              </>
            )}
            <button
              disabled={busy}
              onClick={() => void disconnect()}
              className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white active:scale-95 transition-all"
            >
              Disconnect Google
            </button>
          </>
        )}
        <button
          aria-label="Refresh account status"
          onClick={() => void reload()}
          className="rounded-full border border-white/10 p-2 text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {message && <p role="status" className="text-xs text-white/60">{message}</p>}
    </section>
  );
}
