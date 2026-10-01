import { useEffect, useState } from 'react';
import { Youtube, RefreshCw, Unplug, CheckCircle2 } from 'lucide-react';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { UserAvatar } from './UserAvatar';

export function GoogleAccountCard() {
  const { connected, user, youtubeConnected, reload } = useGoogleAccount();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

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
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      setMessage('Google disconnected. Local Wave data is unchanged.');
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const disconnectYoutube = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/youtube/disconnect', { method: 'POST', credentials: 'include' });
      await reload();
      setMessage('YouTube disconnected.');
    } finally {
      setBusy(false);
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
      </div>
      <p className="text-xs text-white/45">
        YouTube access is optional and requested only when you connect YouTube. Wave keeps OAuth credentials on the server.
      </p>
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
              <button
                disabled={busy}
                onClick={() => void disconnectYoutube()}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs text-white/75 hover:bg-white/10 hover:text-white active:scale-95 transition-all"
              >
                <Unplug className="h-3.5 w-3.5" /> Disconnect YouTube
              </button>
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
