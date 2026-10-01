import { useCallback, useEffect, useState } from 'react';
import { Youtube, UserRound, RefreshCw, Unplug } from 'lucide-react';

type Status = { connected: boolean; user: { id: string; email: string; name: string; picture?: string } | null; youtubeConnected: boolean; scopes: string[] };
const empty: Status = { connected: false, user: null, youtubeConnected: false, scopes: [] };

export function GoogleAccountCard() {
  const [status, setStatus] = useState<Status>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    try { const r = await fetch('/api/auth/me', { credentials: 'include' }); if (r.ok) setStatus(await r.json()); else setStatus(empty); }
    catch { setStatus(empty); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const params = new URLSearchParams(location.search); const result = params.get('google');
    if (!result) return;
    setMessage(result === 'connected' ? 'Account connected.' : result === 'cancelled' ? 'Google sign-in was cancelled.' : result === 'required' ? 'Sign in with Google first.' : 'Google connection failed. Check your configuration and try again.');
    params.delete('google'); history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
    void reload();
  }, [reload]);
  const disconnect = async () => {
    setBusy(true);
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); setStatus(empty); setMessage('Google disconnected. Local Wave data is unchanged.'); }
    finally { setBusy(false); }
  };
  const disconnectYoutube = async () => {
    setBusy(true);
    try { await fetch('/api/auth/youtube/disconnect', { method: 'POST', credentials: 'include' }); await reload(); setMessage('YouTube disconnected.'); }
    finally { setBusy(false); }
  };
  return <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
    <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10"><UserRound className="h-4 w-4" /></span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">Google / YouTube</h3><p className="text-xs text-white/50">{status.user ? `${status.user.name} · ${status.user.email}` : 'Connect an account to manage YouTube playlists.'}</p></div>{status.user?.picture && <img src={status.user.picture} alt="" className="h-8 w-8 rounded-full" />}</div>
    <div className="flex flex-wrap gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 ${status.connected ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-white/50'}`}>{status.connected ? 'Google connected' : 'Google not connected'}</span><span className={`rounded-full px-2.5 py-1 ${status.youtubeConnected ? 'bg-red-400/10 text-red-300' : 'bg-white/5 text-white/50'}`}>{status.youtubeConnected ? 'YouTube connected' : 'YouTube not connected'}</span></div>
    <p className="text-xs text-white/45">YouTube access is optional and requested only when you connect YouTube. Wave keeps OAuth credentials on the server.</p>
    <div className="flex flex-wrap gap-2">
      {!status.connected ? <button onClick={() => location.assign('/api/auth/google')} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">Continue with Google</button> : <>
        {!status.youtubeConnected ? <button onClick={() => location.assign('/api/auth/youtube/connect')} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black"><Youtube className="h-3.5 w-3.5" /> Connect YouTube</button> : <button disabled={busy} onClick={() => void disconnectYoutube()} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs text-white/75"><Unplug className="h-3.5 w-3.5" /> Disconnect YouTube</button>}
        <button disabled={busy} onClick={() => void disconnect()} className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/75">Disconnect Google</button>
      </>}
      <button aria-label="Refresh account status" onClick={() => void reload()} className="rounded-full border border-white/10 p-2 text-white/60"><RefreshCw className="h-3.5 w-3.5" /></button>
    </div>
    {message && <p role="status" className="text-xs text-white/60">{message}</p>}
  </section>;
}
