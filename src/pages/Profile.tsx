import { Music2, Heart, Clock, Shield, CheckCircle2, Sparkles } from 'lucide-react';
import { playerStore } from '../services/playerStore';
import { settingsStore } from '../services/settingsStore';
import { GoogleAccountCard } from '../components/GoogleAccountCard';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { UserAvatar } from '../components/UserAvatar';
import { useState, useEffect } from 'react';

export const ProfilePage: React.FC = () => {
  const { connected, user, youtubeConnected } = useGoogleAccount();
  const favs = playerStore.favsList();
  const history = playerStore.historyList();
  const queue = playerStore.queue();
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassEnabled(settingsStore.get().glassEnabled);
      setGlassIntensity(settingsStore.get().glassIntensity);
    });
    return () => { unsub(); };
  }, []);

  const blurPx = glassEnabled ? Math.round((glassIntensity / 100) * 18) : 0;
  const cardBg = glassEnabled ? `rgba(255,255,255,${(0.04 + (glassIntensity / 100) * 0.06).toFixed(3)})` : 'rgba(24,24,24,0.98)';
  const cardStyle = glassEnabled
    ? { backgroundColor: cardBg, backdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)`, WebkitBackdropFilter: `blur(${blurPx}px) saturate(180%) brightness(1.08)` }
    : { backgroundColor: cardBg };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 lg-surface p-4 sm:p-5 flex items-center gap-4" style={cardStyle}>
        <UserAvatar
          user={user}
          sizeClass="h-16 w-16"
          iconSizeClass="h-7 w-7"
          textSizeClass="text-2xl font-black"
          showStatus={connected}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[19px] sm:text-[20px] font-bold text-white leading-tight truncate">
              {user?.name || (connected ? 'Google User' : 'Wave User')}
            </h2>
            {connected && (
              <span className="shrink-0 flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500/20 text-emerald-400" title="Verified Google Account">
                <CheckCircle2 className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-white/60 truncate font-medium">
            {user?.email ? `${user.email} • Wave Premium` : 'wave@music.app • Premium'}
          </p>
          <div className="flex items-center gap-1.5 pt-0.5">
            {connected ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {youtubeConnected ? 'Google & YouTube Connected' : 'Google Connected'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-white/5 text-white/40 border border-white/10">
                Guest Mode • Member since 2024
              </span>
            )}
          </div>
        </div>
      </div>

      <GoogleAccountCard />

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/10 lg-surface p-3 text-center" style={cardStyle}>
          <p className="text-[18px] font-black text-white leading-none">{favs.length}</p>
          <p className="text-[11px] font-medium text-white/50 flex items-center justify-center gap-1 mt-1"><Heart className="h-3 w-3" /> Favorites</p>
        </div>
        <div className="rounded-xl border border-white/10 lg-surface p-3 text-center" style={cardStyle}>
          <p className="text-[18px] font-black text-white leading-none">{history.length}</p>
          <p className="text-[11px] font-medium text-white/50 flex items-center justify-center gap-1 mt-1"><Clock className="h-3 w-3" /> History</p>
        </div>
        <div className="rounded-xl border border-white/10 lg-surface p-3 text-center" style={cardStyle}>
          <p className="text-[18px] font-black text-white leading-none">{queue.length}</p>
          <p className="text-[11px] font-medium text-white/50 flex items-center justify-center gap-1 mt-1"><Music2 className="h-3 w-3" /> Queue</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 lg-surface p-3 flex items-center gap-3" style={cardStyle}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/60"><Shield className="h-4 w-4" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-white">Private listening</p>
          <p className="text-xs text-white/40">Your activity stays on this device</p>
        </div>
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      </div>

      <div className="rounded-xl border border-white/10 lg-surface p-3 flex items-center gap-2" style={cardStyle}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black"><Sparkles className="h-4 w-4" /></span>
        <p className="text-xs text-white/60">
          {connected && user ? `Signed in as ${user.name} (${user.email})` : 'Wave • Minimal profile • Sign in with Google to sync'}
        </p>
      </div>
    </div>
  );
};
