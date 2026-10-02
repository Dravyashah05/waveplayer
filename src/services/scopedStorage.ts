import { googleAccountStore } from '../hooks/useGoogleAccount';

/**
 * User-scoped storage keys for listening intelligence.
 *
 * - Signed in with Google → keys are namespaced per Google user id, so two
 *   accounts on one device (or a sign-out/sign-in cycle) can never mix
 *   private listening data.
 * - Logged out / local mode → safe device-local `local` namespace, exactly
 *   like the existing wave:* keys.
 *
 * Only normalized library/listening data is ever stored. Authentication
 * material (tokens, cookies, headers) never touches localStorage.
 */

const SCOPE_PREFIX = 'wave:uid:';

function sanitizeScope(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return clean || 'local';
}

/** Current storage scope: Google user id when connected, else 'local'. */
export function currentScope(): string {
  try {
    const status = googleAccountStore.get();
    if (status?.connected && status.user?.id) return sanitizeScope(status.user.id);
  } catch {}
  return 'local';
}

/** Namespace a base key for the current user. */
export function scopeKey(base: string): string {
  return `${SCOPE_PREFIX}${currentScope()}:${base}`;
}

/** Namespace a base key for an explicit user id (tests / migration). */
export function scopeKeyFor(userId: string, base: string): string {
  return `${SCOPE_PREFIX}${sanitizeScope(userId)}:${base}`;
}

/** Remove every scoped entry for a base key across all users (wipe/logout). */
export function clearScopedKey(base: string): void {
  try {
    const suffix = `:${base}`;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SCOPE_PREFIX) && k.endsWith(suffix)) doomed.push(k);
    }
    doomed.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });
  } catch {}
}
