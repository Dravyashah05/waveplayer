import { useEffect, useState } from 'react';
import { Settings2, Palette, Trash2, Info, Check } from 'lucide-react';
import { settingsStore, AppSettings, Quality, Theme } from '../services/settingsStore';
import { playerStore } from '../services/playerStore';
import { GoogleAccountCard } from '../components/GoogleAccountCard';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { UserAvatar } from '../components/UserAvatar';
const Toggle: React.FC<{ value: boolean; onChange: () => void }> = ({ value, onChange }) => (
  <button onClick={onChange} className={`relative inline-flex h-6 w-11 items-center rounded-full border ${value ? 'bg-white border-white' : 'bg-white/10 border-white/10'}`}>
    <span className={`inline-block h-4 w-4 rounded-full shadow transition-transform ${value ? 'translate-x-6 bg-black' : 'translate-x-1 bg-white'}`} />
  </button>
);

export const SettingsPage: React.FC = () => {
  const { user } = useGoogleAccount();
  const [settings, setSettings] = useState<AppSettings>(() => settingsStore.get());
  const [storageUsed, setStorageUsed] = useState('--');

  useEffect(() => {
    const unsub = settingsStore.subscribe(() => setSettings({ ...settingsStore.get() }));
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        total += k.length + (localStorage.getItem(k) || '').length;
      }
      setStorageUsed(`${(total / 1024).toFixed(1)} KB`);
    } catch { setStorageUsed('--'); }
  }, []);

  const update = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => {
    settingsStore.set(k, v);
  };

  const clearAll = () => {
    if (!confirm('Clear all Wave data?')) return;
    ['wave:queue', 'wave:index', 'wave:fav', 'wave:history', 'wave:shuffle', 'wave:repeat', 'wave:volume', 'wave:local_playlists', 'wave:recent_searches', 'wave:settings'].forEach((k) => localStorage.removeItem(k));
    settingsStore.reset();
    setTimeout(() => window.location.reload(), 600);
  };

  const glassBlur = settings.glassEnabled ? Math.round((settings.glassIntensity / 100) * 18) : 0;
  const glassCardStyle = settings.glassEnabled
    ? {
        backgroundColor: `rgba(255,255,255,${(0.04 + (settings.glassIntensity / 100) * 0.06).toFixed(3)})`,
        backdropFilter: `blur(${glassBlur}px) saturate(180%) brightness(1.08)`,
        WebkitBackdropFilter: `blur(${glassBlur}px) saturate(180%) brightness(1.08)`,
      }
    : { backgroundColor: 'rgba(18,18,18,0.98)' };

  return (
    <div className="w-full space-y-6">
      <div className="rounded-2xl border border-white/10 lg-surface p-4 flex items-center gap-3" style={glassCardStyle}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-black shadow"><Settings2 className="h-5 w-5" /></span>
        <div>
          <h1 className="text-[22px] font-black tracking-[-0.03em] text-white leading-none">Settings</h1>
          <p className="text-[12px] text-white/60 mt-1">Minimal preferences • {storageUsed}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface p-4 flex items-center gap-3" style={glassCardStyle}>
        <UserAvatar
          user={user}
          sizeClass="h-10 w-10"
          iconSizeClass="h-5 w-5"
          textSizeClass="text-sm font-bold"
          showStatus={!!user}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-white leading-none truncate">{user?.name || 'Wave User'}</p>
          <p className="text-[11px] text-white/60 truncate">{user ? `${user.email} • Wave Premium` : 'wave@music.app • Premium'}</p>
        </div>
        <span className="rounded-full bg-white text-black px-2.5 py-1 text-[10px] font-bold">Profile</span>
      </div>

      <div className="space-y-2">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-white/50">Accounts</h2>
        <GoogleAccountCard />
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden" style={glassCardStyle}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
          <Palette className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Appearance</p>
        </div>
        <div className="divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Theme</p>
            <select value={settings.theme} onChange={(e) => update('theme', e.target.value as Theme)} className="rounded-full bg-white text-black px-3 py-1.5 text-xs font-semibold outline-none">
              <option value="midnight">Midnight</option>
              <option value="crystal">Light</option>
              <option value="pure">Pure</option>
            </select>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">High-quality artwork</p>
            <Toggle value={settings.highQualityThumbs} onChange={() => update('highQualityThumbs', !settings.highQualityThumbs)} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden" style={glassCardStyle}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
          <Settings2 className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Playback</p>
        </div>
        <div className="divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Autoplay</p>
            <Toggle value={settings.autoplay} onChange={() => update('autoplay', !settings.autoplay)} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Quality</p>
            <select value={settings.quality} onChange={(e) => update('quality', e.target.value as Quality)} className="rounded-full bg-white text-black px-3 py-1.5 text-xs font-semibold outline-none">
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden" style={glassCardStyle}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
          <Trash2 className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Storage</p>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-white">Clear all data</p>
            <p className="text-xs text-white/40">Queue • History • Favorites • Playlists</p>
          </div>
          <button onClick={clearAll} className="rounded-full bg-white text-black px-4 py-1.5 text-xs font-bold hover:bg-white/90">Clear</button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface p-4 flex items-center gap-3" style={glassCardStyle}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/60"><Info className="h-4 w-4" /></span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-white flex items-center gap-2">Wave <span className="rounded-full bg-white text-black px-2 py-0.5 text-[10px] font-bold">1.0.0</span></p>
          <p className="text-xs text-white/40">© 2026 Wave • Minimal</p>
        </div>
        <Check className="h-4 w-4 text-white/20" />
      </div>
    </div>
  );
};
