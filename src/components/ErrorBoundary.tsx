import React from 'react';

interface State {
  error: Error | null;
}

const WAVE_KEYS = [
  'wave:queue', 'wave:index', 'wave:fav', 'wave:history',
  'wave:shuffle', 'wave:repeat', 'wave:volume', 'wave:muted',
  'wave:local_playlists', 'wave:recent_searches', 'wave:settings',
  'wave:settings:v2', 'wave:library:sort', 'wave:recently_played',
  'wave:listening_events', 'wave:skip_counts', 'wave:play_counts',
  'wave:user_profile', 'wave:custom_sources',
];

/**
 * Last-resort crash screen. Any uncaught render error anywhere in the tree
 * lands here instead of a blank white page, with a one-tap recovery that
 * clears Wave's saved data (the most common crash cause is corrupt
 * localStorage) and reloads.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    try {
      console.error('[Wave] UI crash captured:', error);
    } catch {}
  }

  private reset = () => {
    try {
      for (const k of WAVE_KEYS) {
        try { localStorage.removeItem(k); } catch {}
      }
      // Drop any recommendation caches too.
      const doomed: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('wave:cache:') || k.startsWith('wave:playlist:sort:'))) doomed.push(k);
        }
      } catch {}
      for (const k of doomed) {
        try { localStorage.removeItem(k); } catch {}
      }
    } catch {}
    window.location.reload();
  };

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-[100dvh] w-full flex items-center justify-center bg-black text-white p-6">
        <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#111] p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-black text-2xl font-black">W</div>
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="text-[13px] text-white/60">
            Wave hit an unexpected error. Your music is safe — this is usually caused by outdated saved data.
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.retry}
              className="rounded-full bg-white/10 hover:bg-white/20 px-4 py-2 text-[13px] font-semibold"
            >
              Try again
            </button>
            <button
              onClick={this.reset}
              className="rounded-full bg-white text-black hover:bg-white/90 px-4 py-2 text-[13px] font-bold"
            >
              Clear saved data & reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
