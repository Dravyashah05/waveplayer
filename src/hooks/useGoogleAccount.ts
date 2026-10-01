import { useCallback, useEffect, useSyncExternalStore } from 'react';

export interface GoogleAccountUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleAccountStatus {
  connected: boolean;
  user: GoogleAccountUser | null;
  youtubeConnected: boolean;
  scopes: string[];
}

const LS_GOOGLE_STATUS = 'wave:google_account_status';

export const emptyAccountStatus: GoogleAccountStatus = {
  connected: false,
  user: null,
  youtubeConnected: false,
  scopes: [],
};

function loadStoredStatus(): GoogleAccountStatus {
  if (typeof window === 'undefined') return emptyAccountStatus;
  try {
    const raw = localStorage.getItem(LS_GOOGLE_STATUS);
    if (!raw) return emptyAccountStatus;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.connected === 'boolean') {
      return parsed as GoogleAccountStatus;
    }
  } catch {}
  return emptyAccountStatus;
}

function saveStoredStatus(status: GoogleAccountStatus) {
  if (typeof window === 'undefined') return;
  try {
    if (status.connected && status.user) {
      localStorage.setItem(LS_GOOGLE_STATUS, JSON.stringify(status));
    } else {
      localStorage.removeItem(LS_GOOGLE_STATUS);
    }
  } catch {}
}

class GoogleAccountStore {
  private status: GoogleAccountStatus = loadStoredStatus();
  private listeners = new Set<() => void>();
  private inflightPromise: Promise<GoogleAccountStatus> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      // If URL contains google redirect query params, immediately trigger reload
      const params = new URLSearchParams(window.location.search);
      if (params.has('google')) {
        void this.reload();
      }
      // Cross-tab synchronization
      window.addEventListener('storage', (e) => {
        if (e.key === LS_GOOGLE_STATUS) {
          this.status = loadStoredStatus();
          this.notify();
        }
      });
    }
  }

  get = (): GoogleAccountStatus => {
    return this.status;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  set(newStatus: GoogleAccountStatus) {
    this.status = newStatus;
    saveStoredStatus(newStatus);
    this.notify();
  }

  async reload(): Promise<GoogleAccountStatus> {
    if (this.inflightPromise) return this.inflightPromise;
    this.inflightPromise = (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data: GoogleAccountStatus = await res.json();
          this.status = data;
          saveStoredStatus(data);
        } else {
          this.status = emptyAccountStatus;
          saveStoredStatus(emptyAccountStatus);
        }
      } catch {
        // Keep cached data if network momentarily fails, or clear if unauthenticated
        if (!this.status.connected) {
          this.status = emptyAccountStatus;
        }
      } finally {
        this.inflightPromise = null;
        this.notify();
      }
      return this.status;
    })();
    return this.inflightPromise;
  }

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    this.status = emptyAccountStatus;
    saveStoredStatus(emptyAccountStatus);
    this.notify();
  }
}

export const googleAccountStore = new GoogleAccountStore();

/** Shared Google/Youtube connection state (server session, credentials stay server-side). */
export function useGoogleAccount() {
  const status = useSyncExternalStore(
    googleAccountStore.subscribe,
    googleAccountStore.get,
    () => emptyAccountStatus
  );

  const reload = useCallback(() => googleAccountStore.reload(), []);

  useEffect(() => {
    void googleAccountStore.reload();
  }, []);

  return { ...status, reload };
}

export async function googleLogout(): Promise<void> {
  await googleAccountStore.logout();
}
