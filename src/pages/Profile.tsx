import { UserRound, Music2, Heart, Clock, Shield } from 'lucide-react';
import { playerStore } from '../services/playerStore';
import { settingsStore } from '../services/settingsStore';
import { GoogleAccountCard } from '../components/GoogleAccountCard';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { useState, useEffect } from 'react';

const DEFAULT_AVATAR = 'https://i.pravatar.cc/100?img=12';

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
      <div className="rounded-xl border border-white/10 lg-surface p-4 flex items-center gap-4" style={cardStyle}>
        <img src={user?.picture || DEFAULT_AVATAR} alt="Profile" className="h-14 w-14 rounded-full object-cover ring-1 ring-white/20 shadow-[0_4px_12px_rgba(0,0,0,0.3)]" referrerPolicy="no-referrer" />
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold text-white leading-none truncate">{user?.name || 'Wave User'}</h2>
          <p className="text-[12px] text-white/60 truncate">{user ? `${user.email} • Premium` : 'wave@music.app • Premium'}</p>
          <p className="text-[11px] text-white/30">{connected ? (youtubeConnected ? 'Google • YouTube connected' : 'Google connected') : 'Member since 2024'}</p>
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
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black"><UserRound className="h-4 w-4" /></span>
        <p className="text-xs text-white/50">Wave • Minimal profile • Edit coming soon</p>
      </div>
    </div>
  );
};
