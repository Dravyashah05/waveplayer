import { useCallback, useEffect, useState } from 'react';

const DISMISS_KEY = 'wave:pwa_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Unobtrusive PWA install prompt. Captures beforeinstallprompt once, never
 * re-shows after dismissal, and never blocks startup or playback.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch { /* dismissal is a valid outcome */ }
    setDeferred(null);
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setDeferred(null);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch { /* preference is best-effort */ }
  }, []);

  return { canInstall: !!deferred && !dismissed, install, dismiss };
}

export type OnlineState = 'online' | 'offline' | 'reconnecting';

/**
 * Connection state: online / offline / reconnecting (transient check after
 * regaining network before declaring healthy). Drives the lightweight
 * indicator and gates network-only actions instead of silent failures.
 */
export function useOnline(): OnlineState {
  const [state, setState] = useState<OnlineState>(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  );

  useEffect(() => {
    let cancelled = false;
    const goOffline = () => setState('offline');
    const goOnline = () => {
      setState('reconnecting');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      fetch('/api/health', { credentials: 'include', signal: controller.signal })
        .then((r) => {
          if (!cancelled) setState(r.ok ? 'online' : 'offline');
        })
        .catch(() => {
          if (!cancelled) setState('offline');
        })
        .finally(() => clearTimeout(timer));
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  return state;
}
