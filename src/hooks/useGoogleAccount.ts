import { useCallback, useEffect, useState } from 'react';

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

export const emptyAccountStatus: GoogleAccountStatus = {
  connected: false,
  user: null,
  youtubeConnected: false,
  scopes: [],
};

/** Shared Google/Youtube connection state (server session, credentials stay server-side). */
export function useGoogleAccount() {
  const [status, setStatus] = useState<GoogleAccountStatus>(emptyAccountStatus);
  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      setStatus(r.ok ? await r.json() : emptyAccountStatus);
    } catch {
      setStatus(emptyAccountStatus);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { ...status, reload };
}

export async function googleLogout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // logout is best-effort; session cookie is cleared server-side when reachable
  }
}
