import { Home, Compass, ListMusic } from 'lucide-react';
import { useState, useEffect } from 'react';
import { settingsStore } from '../services/settingsStore';

interface Props {
  active: string;
  onChange: (s: string) => void;
  onPrefetch?: (s: string) => void;
}

export const BottomNavigation: React.FC<Props> = ({ active, onChange, onPrefetch }) => {
  const [glassIntensity, setGlassIntensity] = useState(() => settingsStore.get().glassIntensity);
  const [glassEnabled, setGlassEnabled] = useState(() => settingsStore.get().glassEnabled);
  useEffect(() => {
    const unsub = settingsStore.subscribe(() => {
      setGlassIntensity(settingsStore.get().glassIntensity);
      setGlassEnabled(settingsStore.get().glassEnabled);
    });
    return () => { unsub(); };
  }, []);
  const blurPx = glassEnabled ? Math.round((glassIntensity / 100) * 24) : 0;
  const bgAlpha = glassEnabled ? (0.55 + (glassIntensity / 100) * 0.18).toFixed(3) : '0.96';
  const items = [
    { id: 'discover', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'playlists', label: 'My Library', icon: ListMusic },
  ];
  const isActive = (id: string) =>
    active === id ||
    (id === 'discover' && active === 'discover') ||
    (id === 'explore' && active === 'explore') ||
    (id === 'playlists' && ['playlists', 'liked', 'history', 'songs', 'albums', 'artists', 'all'].includes(active));
  return (
    <nav className="lg:hidden fixed bottom-3 left-2 right-2 sm:left-3 sm:right-3 z-30 safe-bottom">
      <div
        className="mx-auto w-full max-w-[420px] border border-white/[0.12] shadow-[0_12px_40px_rgba(0,0,0,0.5), inset_0_1px_0_rgba(255,255,255,0.10)] rounded-[28px] px-1.5 sm:px-2 py-2 flex items-center justify-around gap-1"
        style={
          glassEnabled
            ? {
                backgroundColor: `rgba(10,10,10,${bgAlpha})`,
                backdropFilter: `blur(${blurPx}px) saturate(150%)`,
                WebkitBackdropFilter: `blur(${blurPx}px) saturate(150%)`,
              }
            : {
                backgroundColor: `rgba(18,18,18,${bgAlpha})`,
              }
        }
      >
        {items.map(it => {
          const activeState = isActive(it.id);
          return (
            <button
              key={it.id}
              onClick={() => onChange(it.id)}
              onMouseEnter={() => onPrefetch?.(it.id)}
              onFocus={() => onPrefetch?.(it.id)}
              className={`relative flex flex-1 flex-col items-center gap-1 rounded-[16px] px-3 py-2 text-[11px] font-[650] tracking-[-0.01em] transition-all overflow-hidden isolate ${activeState ? 'text-black' : 'text-[#9a9aa0] hover:text-white'}`}
            >
              {activeState && (
                <span className="absolute inset-0 rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.12)]" />
              )}
              <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full ${activeState ? 'bg-[#0a0a0c] text-white' : 'bg-white/[0.06] border border-white/[0.08] text-[#9a9aa0]'}`}>
                <it.icon className="h-[15px] w-[15px]" />
              </span>
              <span className="relative z-10 leading-none">{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
