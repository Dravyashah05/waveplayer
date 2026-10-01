export type Quality = 'auto' | 'high' | 'medium' | 'low';
export type Theme = 'midnight' | 'prism' | 'pure';
export type NetworkQuality = 'auto' | 'low' | 'medium' | 'high' | 'maximum';
export type EqPresetId = 'flat' | 'bass' | 'treble' | 'vocal' | 'rock' | 'pop' | 'classical' | 'custom';

export interface AppSettings {
  autoplay: boolean;
  crossfade: boolean;
  crossfadeSeconds: number;
  automix: boolean;
  automixSeconds: number;
  playbackRate: number;
  skipSilence: boolean;
  normalizeVolume: boolean;
  highQualityThumbs: boolean;
  showLyricsSource: boolean;
  lyricsAutoScroll: boolean;
  reduceMotion: boolean;
  animatedCanvas: boolean;
  dynamicColors: boolean;
  explicitFilter: boolean;
  gapless: boolean;
  quality: Quality;
  wifiQuality: NetworkQuality;
  mobileQuality: NetworkQuality;
  sourcePriority: string[];
  disabledSources: string[];
  eqEnabled: boolean;
  eqPreset: EqPresetId;
  eqGains: number[];
  scrobbleLastfm: boolean;
  scrobbleListenbrainz: boolean;
  discordPresence: boolean;
  experimentalAutomix: boolean;
  experimentalSkipSilence: boolean;
  experimentalOffline: boolean;
  experimentalTempo: boolean;
  theme: Theme;
  language: string;
  glassIntensity: number;
  glassEnabled: boolean;
}

const LS_SETTINGS = 'wave:settings:v2';

const DEFAULTS: AppSettings = {
  autoplay: true,
  crossfade: false,
  crossfadeSeconds: 0,
  automix: false,
  automixSeconds: 6,
  playbackRate: 1,
  skipSilence: false,
  normalizeVolume: true,
  highQualityThumbs: true,
  showLyricsSource: true,
  lyricsAutoScroll: true,
  reduceMotion: false,
  animatedCanvas: true,
  dynamicColors: true,
  explicitFilter: false,
  gapless: true,
  quality: 'auto',
  wifiQuality: 'auto',
  mobileQuality: 'medium',
  sourcePriority: ['saavn', 'youtube', 'local', 'custom'],
  disabledSources: [],
  eqEnabled: false,
  eqPreset: 'flat',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  scrobbleLastfm: false,
  scrobbleListenbrainz: false,
  discordPresence: false,
  experimentalAutomix: true,
  experimentalSkipSilence: false,
  experimentalOffline: true,
  experimentalTempo: false,
  theme: 'midnight',
  language: 'en',
  glassIntensity: 70,
  glassEnabled: false,
};

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // clamp glassIntensity if missing or out of range
    const merged = { ...DEFAULTS, ...parsed } as AppSettings;
    if (typeof merged.glassIntensity !== 'number' || Number.isNaN(merged.glassIntensity)) merged.glassIntensity = DEFAULTS.glassIntensity;
    merged.glassIntensity = Math.max(0, Math.min(100, Math.round(merged.glassIntensity)));
    if (typeof merged.glassEnabled !== 'boolean') merged.glassEnabled = DEFAULTS.glassEnabled;
    if (typeof merged.crossfadeSeconds !== 'number' || Number.isNaN(merged.crossfadeSeconds)) merged.crossfadeSeconds = 0;
    merged.crossfadeSeconds = Math.max(0, Math.min(12, merged.crossfadeSeconds));
    if (typeof merged.automixSeconds !== 'number' || Number.isNaN(merged.automixSeconds)) merged.automixSeconds = 6;
    merged.automixSeconds = Math.max(2, Math.min(12, merged.automixSeconds));
    if (typeof merged.playbackRate !== 'number' || !(merged.playbackRate >= 0.5 && merged.playbackRate <= 2)) merged.playbackRate = 1;
    if (!Array.isArray(merged.eqGains) || merged.eqGains.length !== 9) merged.eqGains = [...DEFAULTS.eqGains];
    if (!Array.isArray(merged.sourcePriority) || !merged.sourcePriority.length) merged.sourcePriority = [...DEFAULTS.sourcePriority];
    if (!Array.isArray(merged.disabledSources)) merged.disabledSources = [];
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: AppSettings) {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  } catch {}
}

type Listener = () => void;

class SettingsStore {
  private settings: AppSettings = load();
  private listeners = new Set<Listener>();

  get(): AppSettings {
    return this.settings;
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    this.settings = { ...this.settings, [key]: value };
    save(this.settings);
    this.emit();
    // side-effects
    if (key === 'reduceMotion') {
      document.documentElement.dataset.reduceMotion = String(value);
    }
  }

  toggle<K extends keyof AppSettings>(key: K) {
    const cur = this.settings[key];
    if (typeof cur === 'boolean') this.set(key, (!cur as unknown) as AppSettings[K]);
  }

  reset() {
    this.settings = { ...DEFAULTS };
    save(this.settings);
    this.emit();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

export const settingsStore = new SettingsStore();
export const defaultSettings = DEFAULTS;
