import { REQUEST_POLICY, type RequestPolicy } from './cacheConfig';

/**
 * Consistent network resilience: AbortController timeout per attempt,
 * bounded retries per policy (never infinite), safe user-facing errors.
 * Retries apply to network/timeout failures only — HTTP error statuses
 * resolve immediately so auth/permission failures surface honestly.
 */

export class ResilientFetchError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message?: string, status?: number) {
    super(message || code);
    this.name = 'ResilientFetchError';
    this.code = code;
    this.status = status;
  }
}

export interface ResilientOptions extends RequestInit {
  policy?: RequestPolicy;
  /** Override the policy timeout for this call only. */
  timeoutMs?: number;
}

function errorForStatus(status: number): string {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 504) return 'TIMEOUT';
  if (status === 503) return 'UNAVAILABLE';
  return `HTTP_${status}`;
}

export async function fetchResilient(path: string, opts: ResilientOptions = {}): Promise<Response> {
  const policy = REQUEST_POLICY[opts.policy || 'normal'];
  const timeoutMs = opts.timeoutMs ?? policy.timeoutMs;
  const { policy: _drop, timeoutMs: _drop2, ...init } = opts;
  let lastError: unknown = new ResilientFetchError('UNAVAILABLE', 'Service unavailable');
  for (let attempt = 0; attempt <= policy.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(path, { credentials: 'include', ...init, signal: controller.signal });
      if (!res.ok) throw new ResilientFetchError(errorForStatus(res.status), errorForStatus(res.status), res.status);
      return res;
    } catch (e) {
      lastError = e;
      // Retry network/timeout failures only — never auth/permission errors.
      const retryable =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof ResilientFetchError && (e.code === 'TIMEOUT' || e.code === 'UNAVAILABLE')) ||
        e instanceof TypeError;
      if (!retryable || attempt >= policy.retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof ResilientFetchError) throw lastError;
  if (lastError instanceof DOMException && lastError.name === 'AbortError') {
    throw new ResilientFetchError('TIMEOUT', 'Request timed out');
  }
  throw new ResilientFetchError('UNAVAILABLE', 'Service unavailable');
}

/** fetchResilient + JSON parse (null on empty/invalid bodies, never throws that). */
export async function fetchJsonResilient<T>(path: string, opts: ResilientOptions = {}): Promise<T> {
  const res = await fetchResilient(path, { headers: { Accept: 'application/json' }, ...opts });
  return (await res.json().catch(() => null)) as T;
}
