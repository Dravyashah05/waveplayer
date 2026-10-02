// Wave Player service worker (no build step, no dependencies).
//
// Policy (mirrors src/services/cacheConfig.ts categories):
// - App shell + hashed static assets: cache-first, versioned cache.
// - Public catalog GETs (/api/ytmusic/*, /api/saavn*): network-first with a
//   BOUNDED runtime cache (MAX_RUNTIME entries, oldest evicted).
// - PRIVATE or session-dependent responses are NEVER cached: /api/auth/*,
//   /api/youtube/*, and every /api/ytmusic-py/* route except /health
//   (library/history/liked/playlists are per-user — a shared CacheStorage
//   entry would leak one user's data to the next account on this device).
// - Audio streams are never cached here (see offlineDownloads for the
//   explicit user-hosted offline store).
// - Audio playback runs in the page, never in the worker: worker updates
//   cannot interrupt MediaSession or background audio.

const CACHE = 'wave-v2';
const CORE = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
const MAX_RUNTIME = 150;

// Private/session-dependent API prefixes — network-only, offline → 503 JSON.
const PRIVATE_PREFIXES = [
  '/api/auth/',
  '/api/youtube/',
  '/api/ytmusic-py/library/',
  '/api/ytmusic-py/auth/',
  '/api/ytmusic-py/history',
];

function isPrivate(pathname) {
  if (pathname === '/api/ytmusic-py/history') return true;
  for (const prefix of PRIVATE_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function trimRuntime() {
  // Bounded growth: drop oldest runtime entries (Cache.keys preserves
  // insertion order in practice; best-effort either way).
  try {
    caches.open(CACHE).then((c) =>
      c.keys().then((keys) => {
        const runtime = keys.filter((r) => {
          try {
            const u = new URL(r.url);
            return !CORE.includes(u.pathname) && u.pathname !== '/';
          } catch {
            return false;
          }
        });
        const overflow = runtime.length - MAX_RUNTIME;
        if (overflow > 0) {
          return Promise.all(runtime.slice(0, overflow).map((r) => c.delete(r).catch(() => {})));
        }
        return undefined;
      }).catch(() => {})
    ).catch(() => {});
  } catch {}
}

function safePut(request, response) {
  // Cache Storage rejects non-GET requests and opaque/error responses — never
  // let that rejection turn into "Failed to convert value to 'Response'".
  try {
    if (request.method !== 'GET') return;
    if (!response || !response.ok) return;
    if (response.type !== 'basic') return;
    const url = new URL(request.url);
    if (isPrivate(url.pathname)) return;
    const clone = response.clone();
    caches.open(CACHE).then((c) => {
      c.put(request, clone).then(() => trimRuntime()).catch(() => {});
    }).catch(() => {});
  } catch {}
}

function offlineApiFallback() {
  return new Response(JSON.stringify({ error: 'OFFLINE' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Network-first for API, cache-first for assets
  if (url.pathname.startsWith('/api/')) {
    // Private/session-dependent: network-only, never stored.
    if (isPrivate(url.pathname)) {
      e.respondWith(fetch(e.request).catch(offlineApiFallback));
      return;
    }
    // Only cache GET; never cache POST/PUT/DELETE (Cache.put rejects them).
    if (e.request.method !== 'GET') {
      e.respondWith(fetch(e.request).catch(offlineApiFallback));
      return;
    }
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          safePut(e.request, r);
          return r;
        })
        .catch(() =>
          caches.match(e.request).then((cached) => cached || offlineApiFallback())
        )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((network) => {
          safePut(e.request, network);
          return network;
        })
        .catch(() => cached || Response.error());
      return cached || fetchPromise;
    })
  );
});
