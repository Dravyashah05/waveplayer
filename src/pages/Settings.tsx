import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Settings2, Palette, Trash2, Info, Check, Play, SlidersHorizontal, Wifi, Mic2, Sparkles, Plug, FlaskConical, FolderDown } from 'lucide-react';
import { settingsStore, AppSettings, Quality, Theme, NetworkQuality, EqPresetId } from '../services/settingsStore';
import { playerStore } from '../services/playerStore';
import { playerEngine } from '../services/playerEngine';
import { GoogleAccountCard } from '../components/GoogleAccountCard';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { UserAvatar } from '../components/UserAvatar';
import { listSources, getCustomSources, saveCustomSources, type AudioSource } from '../services/audioSources';
import { setLastfmCredentials, lastfmConnected, setListenbrainzToken, listenbrainzConnected } from '../services/scrobbleProviders';
import { discordState, setDiscordCompanion } from '../services/discordPresence';
import { queueUserFiles, downloadItems, subscribeDownloads, clearFinishedDownloads } from '../services/downloads';
import { clearScopedKey } from '../services/scopedStorage';
import { listLocalFiles, playLocalFile, deleteLocalFile, type LocalFileMeta } from '../services/localLibrary';
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

  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const clearAll = () => {
    ['wave:queue', 'wave:index', 'wave:fav', 'wave:history', 'wave:shuffle', 'wave:repeat', 'wave:volume', 'wave:local_playlists', 'wave:recent_searches', 'wave:settings'].forEach((k) => localStorage.removeItem(k));
    clearScopedKey('yt_history_v1');
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
          <div className="px-4 py-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-white">Crossfade</p>
              <span className="text-xs font-bold text-white/60">{settings.crossfadeSeconds === 0 ? 'Off' : `${settings.crossfadeSeconds}s`}</span>
            </div>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={settings.crossfadeSeconds}
              onChange={(e) => update('crossfadeSeconds', Number(e.target.value))}
              className="w-full accent-white"
              aria-label="Crossfade seconds"
            />
            <div className="flex flex-wrap gap-1.5">
              {[0, 2, 4, 6, 8, 10, 12].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update('crossfadeSeconds', s)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${settings.crossfadeSeconds === s ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:text-white'}`}
                >
                  {s === 0 ? 'Off' : `${s}s`}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 py-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-white">Automix <span className="ml-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">Beta</span></p>
                <p className="text-[11px] text-white/40">DJ-style overlap. No beat analysis — intelligent fade.</p>
              </div>
              <Toggle value={settings.automix} onChange={() => update('automix', !settings.automix)} />
            </div>
            {settings.automix && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/50">Transition</span>
                <input type="range" min={2} max={12} step={1} value={settings.automixSeconds} onChange={(e) => update('automixSeconds', Number(e.target.value))} className="flex-1 accent-white" aria-label="Automix seconds" />
                <span className="text-xs font-bold text-white/60 w-8 text-right">{settings.automixSeconds}s</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Playback speed</p>
            <select
              value={String(settings.playbackRate)}
              onChange={(e) => {
                const r = Number(e.target.value);
                update('playbackRate', r);
                playerEngine.setPlaybackRate(r);
              }}
              className="rounded-full bg-white text-black px-3 py-1.5 text-xs font-semibold outline-none"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                <option key={r} value={r}>{r}x</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-[13px] font-medium text-white">Skip silence <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/50">Experimental</span></p>
              <p className="text-[11px] text-white/40">Needs the equalizer graph; off unless stable.</p>
            </div>
            <Toggle value={settings.skipSilence} onChange={() => update('skipSilence', !settings.skipSilence)} />
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
          <Wifi className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Audio quality by network</p>
        </div>
        <div className="divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Wi-Fi</p>
            <select value={settings.wifiQuality} onChange={(e) => update('wifiQuality', e.target.value as NetworkQuality)} className="rounded-full bg-white text-black px-3 py-1.5 text-xs font-semibold outline-none">
              <option value="auto">Auto</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="maximum">Maximum</option>
            </select>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-[13px] font-medium text-white">Mobile data</p>
              <p className="text-[11px] text-white/40">Applies on next track resolution, never mid-song.</p>
            </div>
            <select value={settings.mobileQuality} onChange={(e) => update('mobileQuality', e.target.value as NetworkQuality)} className="rounded-full bg-white text-black px-3 py-1.5 text-xs font-semibold outline-none">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden" style={glassCardStyle}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
          <SlidersHorizontal className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Equalizer</p>
        </div>
        <div className="divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-[13px] font-medium text-white">Enable equalizer</p>
              <p className="text-[11px] text-white/40">Web Audio 9-band. Falls back to plain playback if a stream blocks it.</p>
            </div>
            <Toggle value={settings.eqEnabled} onChange={() => playerEngine.setEqEnabled(!settings.eqEnabled)} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Preset</p>
            <select value={settings.eqPreset} onChange={(e) => playerEngine.setEqPreset(e.target.value)} className="rounded-full bg-white text-black px-3 py-1.5 text-xs font-semibold outline-none">
              {(['flat', 'bass', 'treble', 'vocal', 'rock', 'pop', 'classical', 'custom'] as EqPresetId[]).map((p) => (
                <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
          {settings.eqEnabled && (
            <div className="px-4 py-3.5 space-y-1.5">
              {[60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000].map((f, i) => (
                <div key={f} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 font-mono text-[10px] text-white/50">{f >= 1000 ? `${f / 1000}k` : f}</span>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={settings.eqGains[i] || 0}
                    onChange={(e) => {
                      const next = [...settings.eqGains];
                      next[i] = Number(e.target.value);
                      playerEngine.setEqGains(next);
                    }}
                    className="flex-1 accent-white"
                    aria-label={`${f} Hz gain`}
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] text-white/60">{(settings.eqGains[i] || 0) > 0 ? '+' : ''}{settings.eqGains[i] || 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden" style={glassCardStyle}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
          <Mic2 className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Lyrics</p>
        </div>
        <div className="divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-[13px] font-medium text-white">Auto-scroll</p>
              <p className="text-[11px] text-white/40">Manual scrolling pauses it briefly. Word highlight appears only when timing data exists.</p>
            </div>
            <Toggle value={settings.lyricsAutoScroll} onChange={() => update('lyricsAutoScroll', !settings.lyricsAutoScroll)} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden" style={glassCardStyle}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
          <Sparkles className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Appearance extras</p>
        </div>
        <div className="divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Animated canvas</p>
            <Toggle value={settings.animatedCanvas} onChange={() => update('animatedCanvas', !settings.animatedCanvas)} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Dynamic artwork colors</p>
            <Toggle value={settings.dynamicColors} onChange={() => update('dynamicColors', !settings.dynamicColors)} />
          </div>
        </div>
      </div>

      <IntegrationsCard />
      <SourcesCard />
      <LocalFilesCard />

      <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden" style={glassCardStyle}>
        <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
          <FlaskConical className="h-4 w-4 text-white/60" />
          <p className="text-[13px] font-semibold text-white">Advanced</p>
        </div>
        <div className="divide-y divide-white/5">
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Experimental: offline mode</p>
            <Toggle value={settings.experimentalOffline} onChange={() => update('experimentalOffline', !settings.experimentalOffline)} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Experimental: skip silence</p>
            <Toggle value={settings.experimentalSkipSilence} onChange={() => update('experimentalSkipSilence', !settings.experimentalSkipSilence)} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <p className="text-[13px] font-medium text-white">Experimental: automix / tempo</p>
            <Toggle value={settings.experimentalAutomix} onChange={() => update('experimentalAutomix', !settings.experimentalAutomix)} />
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
          <button onClick={() => setConfirmClearAll(true)} className="rounded-full bg-white text-black px-4 py-1.5 text-xs font-bold hover:bg-white/90">Clear</button>
        </div>
        <ConfirmDialog
          open={confirmClearAll}
          title="Clear all Wave data?"
          body="Queue, history, favorites and playlists on this device will be removed. This cannot be undone."
          confirmLabel="Clear everything"
          onCancel={() => setConfirmClearAll(false)}
          onConfirm={() => {
            setConfirmClearAll(false);
            clearAll();
          }}
        />
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

const IntegrationsCard: React.FC = () => {
  const [settings, setSettings] = useState(() => settingsStore.get());
  const [lbToken, setLbToken] = useState('');
  const [lfKey, setLfKey] = useState('');
  const [lfSecret, setLfSecret] = useState('');
  const [lfSession, setLfSession] = useState('');
  const [companion, setCompanion] = useState('');
  useEffect(() => {
    const unsub = settingsStore.subscribe(() => setSettings({ ...settingsStore.get() }));
    return () => {
      unsub();
    };
  }, []);
  return (
    <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
        <Plug className="h-4 w-4 text-white/60" />
        <p className="text-[13px] font-semibold text-white">Integrations</p>
      </div>
      <div className="divide-y divide-white/5">
        <div className="px-4 py-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-white">ListenBrainz scrobbling</p>
              <p className="text-[11px] text-white/40">Token stays in memory for this session only.</p>
            </div>
            <Toggle
              value={settings.scrobbleListenbrainz}
              onChange={() => settingsStore.set('scrobbleListenbrainz', !settings.scrobbleListenbrainz)}
            />
          </div>
          {settings.scrobbleListenbrainz && (
            <div className="flex gap-2">
              <input
                type="password"
                value={lbToken}
                onChange={(e) => setLbToken(e.target.value)}
                placeholder="ListenBrainz user token"
                autoComplete="off"
                className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
              />
              <button
                type="button"
                onClick={() => {
                  setListenbrainzToken(lbToken);
                  setLbToken('');
                }}
                className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
              >
                Save
              </button>
            </div>
          )}
          {listenbrainzConnected() && <p className="text-[11px] text-emerald-300">Token active for this session.</p>}
        </div>
        <div className="px-4 py-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-white">Last.fm scrobbling</p>
              <p className="text-[11px] text-white/40">Needs your own API key + session. Memory only.</p>
            </div>
            <Toggle value={settings.scrobbleLastfm} onChange={() => settingsStore.set('scrobbleLastfm', !settings.scrobbleLastfm)} />
          </div>
          {settings.scrobbleLastfm && (
            <div className="space-y-2">
              <input type="password" value={lfKey} onChange={(e) => setLfKey(e.target.value)} placeholder="Last.fm API key" autoComplete="off" className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30" />
              <div className="flex gap-2">
                <input type="password" value={lfSecret} onChange={(e) => setLfSecret(e.target.value)} placeholder="Shared secret" autoComplete="off" className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30" />
                <input value={lfSession} onChange={(e) => setLfSession(e.target.value)} placeholder="Session key" autoComplete="off" className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setLastfmCredentials(null)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-white/60">Forget</button>
                <button
                  type="button"
                  onClick={() => {
                    setLastfmCredentials({ apiKey: lfKey.trim(), secret: lfSecret.trim(), sessionKey: lfSession.trim(), username: '' });
                    setLfKey('');
                    setLfSecret('');
                    setLfSession('');
                  }}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black"
                >
                  Save
                </button>
              </div>
            </div>
          )}
          {lastfmConnected() && <p className="text-[11px] text-emerald-300">Connected for this session.</p>}
        </div>
        <div className="px-4 py-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-white">Discord Rich Presence</p>
              <p className="text-[11px] text-white/40">Browsers cannot reach Discord directly — a companion bridge is required.</p>
            </div>
            <Toggle value={settings.discordPresence} onChange={() => settingsStore.set('discordPresence', !settings.discordPresence)} />
          </div>
          {settings.discordPresence && (
            <div className="flex gap-2">
              <input value={companion} onChange={(e) => setCompanion(e.target.value)} placeholder="Companion URL, e.g. http://localhost:3002 (optional)" className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30" />
              <button type="button" onClick={() => setDiscordCompanion(companion)} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">
                Set
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SourcesCard: React.FC = () => {
  const [, tick] = useState(0);
  const [health, setHealth] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [checking, setChecking] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const refresh = () => tick((n) => n + 1);
  const sources: AudioSource[] = listSources();
  const move = (id: string, dir: -1 | 1) => {
    const order = [...settingsStore.get().sourcePriority];
    const known = sources.map((s) => s.id).filter((x) => !order.includes(x));
    const full = [...order, ...known];
    const i = full.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= full.length) return;
    [full[i], full[j]] = [full[j], full[i]];
    settingsStore.set('sourcePriority', full);
    refresh();
  };
  const toggleSource = (id: string) => {
    const disabled = settingsStore.get().disabledSources;
    settingsStore.set('disabledSources', disabled.includes(id) ? disabled.filter((d) => d !== id) : [...disabled, id]);
    refresh();
  };
  const testAll = async () => {
    setChecking(true);
    const out: Record<string, { ok: boolean; detail: string }> = {};
    for (const s of sources) {
      try {
        out[s.id] = await s.healthCheck();
      } catch {
        out[s.id] = { ok: false, detail: 'check failed' };
      }
    }
    setHealth(out);
    setChecking(false);
  };
  const addCustom = () => {
    const base = customUrl.trim().replace(/\/+$/, '');
    if (!customName.trim() || !/^https?:\/\//.test(base)) return;
    const list = getCustomSources();
    list.push({ id: `c${Date.now().toString(36)}`, name: customName.trim().slice(0, 40), baseUrl: base });
    saveCustomSources(list);
    setCustomName('');
    setCustomUrl('');
    refresh();
  };
  const removeCustom = (id: string) => {
    saveCustomSources(getCustomSources().filter((c) => `custom:${c.id}` !== id));
    refresh();
  };
  return (
    <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
        <Plug className="h-4 w-4 text-white/60" />
        <p className="text-[13px] font-semibold text-white">Audio sources</p>
        <span className="flex-1" />
        <button type="button" onClick={() => void testAll()} disabled={checking} className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-bold text-white/70 hover:text-white disabled:opacity-50">
          {checking ? 'Testing…' : 'Test all'}
        </button>
      </div>
      <div className="divide-y divide-white/5">
        {sources.map((s, idx) => {
          const h = health[s.id];
          const disabled = settingsStore.get().disabledSources.includes(s.id);
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-white">
                  {s.name} <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">{s.type}</span>
                </p>
                <p className="truncate text-[11px] text-white/40">
                  {s.capabilities.lossless ? 'Lossless capable • ' : ''}
                  {(s.capabilities.formats || []).slice(0, 2).join(' • ') || 'standard'}
                  {h ? (h.ok ? ` • ✓ ${h.detail}` : ` • ✕ ${h.detail}`) : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(s.id, -1)} disabled={idx === 0} className="rounded-full px-2 py-1 text-white/50 hover:text-white disabled:opacity-25" aria-label={`Move ${s.name} up`}>↑</button>
                <button type="button" onClick={() => move(s.id, 1)} disabled={idx === sources.length - 1} className="rounded-full px-2 py-1 text-white/50 hover:text-white disabled:opacity-25" aria-label={`Move ${s.name} down`}>↓</button>
                <button
                  type="button"
                  onClick={() => toggleSource(s.id)}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${disabled ? 'bg-white/10 text-white/40' : 'bg-white text-black'}`}
                >
                  {disabled ? 'Off' : 'On'}
                </button>
                {s.type === 'custom' && (
                  <button type="button" onClick={() => removeCustom(s.id)} className="rounded-full px-2 py-1 text-[11px] text-rose-300 hover:text-white" aria-label={`Remove ${s.name}`}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="px-4 py-3 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Add static file host (resolves {"{baseUrl}/{trackId}.mp3"})</p>
          <div className="flex gap-2">
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Name" className="w-28 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30" />
            <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://files.example.com/audio" className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30" />
            <button type="button" onClick={addCustom} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const LocalFilesCard: React.FC = () => {
  const [files, setFiles] = useState<LocalFileMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const reload = () => {
    listLocalFiles().then(setFiles).catch(() => setFiles([]));
  };
  useEffect(() => {
    reload();
    const unsub = subscribeDownloads(() => reload());
    return unsub;
  }, []);
  const pick = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setBusy(true);
    try {
      await queueUserFiles(picked);
      reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl border border-white/10 lg-surface overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-white/5">
        <FolderDown className="h-4 w-4 text-white/60" />
        <p className="text-[13px] font-semibold text-white">Local files & offline</p>
        <span className="flex-1" />
        <label className="cursor-pointer rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-white/90">
          {busy ? 'Importing…' : 'Import files'}
          <input type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.mp4" multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
        </label>
      </div>
      <div className="divide-y divide-white/5">
        {downloadItems().filter((d) => d.state === 'downloading' || d.state === 'queued').length > 0 && (
          <div className="px-4 py-2.5">
            <p className="text-[11px] text-white/50">Importing {downloadItems().filter((d) => d.state === 'downloading' || d.state === 'queued').length} file(s)…</p>
          </div>
        )}
        {files.length === 0 ? (
          <p className="px-4 py-3.5 text-xs text-white/40">No local files yet. Imported audio is stored privately in your browser (IndexedDB) and plays offline.</p>
        ) : (
          files.slice(0, 20).map((f) => (
            <LocalFileRow key={f.id} meta={f} onChange={reload} />
          ))
        )}
        {files.length > 20 && <p className="px-4 py-2 text-[11px] text-white/40">+{files.length - 20} more — use Search to find them.</p>}
      </div>
      <div className="px-4 py-2.5 border-t border-white/5 flex justify-end">
        <button type="button" onClick={() => { clearFinishedDownloads(); }} className="text-[11px] font-semibold text-white/40 hover:text-white">
          Clear finished imports
        </button>
      </div>
    </div>
  );
};

const LocalFileRow: React.FC<{ meta: LocalFileMeta; onChange: () => void }> = ({ meta, onChange }) => {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const play = async () => {
    const t = await playLocalFile(meta).catch(() => null);
    if (t) playerStore.setQueue([t], 0);
  };
  const remove = async () => {
    await deleteLocalFile(meta.id).catch(() => {});
    onChange();
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-white">{meta.title}</p>
        <p className="truncate text-[11px] text-white/40">{meta.artist}{meta.durationSeconds ? ` • ${Math.floor(meta.durationSeconds / 60)}:${String(meta.durationSeconds % 60).padStart(2, '0')}` : ''}</p>
      </div>
      <button type="button" onClick={() => void play()} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black" aria-label={`Play ${meta.title}`}>
        <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
      </button>
      <button type="button" onClick={() => setConfirmRemove(true)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 hover:text-red-400" aria-label={`Remove ${meta.title}`}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove “${meta.title}”?`}
        body="The file reference will be removed from your local library. This cannot be undone."
        confirmLabel="Remove file"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          void remove();
        }}
      />
    </div>
  );
};
