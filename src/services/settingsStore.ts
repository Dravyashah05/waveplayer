export type Quality = 'auto' | 'high' | 'medium' | 'low';
export type Theme = 'midnight' | 'prism' | 'pure';

export interface AppSettings {
  autoplay: boolean;
  crossfade: boolean;
  normalizeVolume: boolean;
  highQualityThumbs: boolean;
  showLyricsSource: boolean;
  reduceMotion: boolean;
  explicitFilter: boolean;
  gapless: boolean;
  quality: Quality;
  theme: Theme;
  language: string;
  glassIntensity: number;
  glassEnabled: boolean;
}

const LS_SETTINGS = 'wave:settings:v2';

const DEFAULTS: AppSettings = {
  autoplay: true,
  crossfade: false,
  normalizeVolume: true,
  highQualityThumbs: true,
  showLyricsSource: true,
  reduceMotion: false,
  explicitFilter: false,
  gapless: true,
  quality: 'auto',
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
