const CACHE = 'wave-v1';
const CORE = ['/', '/index.html', '/manifest.json'];

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

function safePut(request, response) {
  // Cache Storage rejects non-GET requests and opaque/error responses — never
  // let that rejection turn into "Failed to convert value to 'Response'".
  try {
    if (request.method !== 'GET') return;
    if (!response || !response.ok) return;
    if (response.type !== 'basic') return;
    const clone = response.clone();
    caches.open(CACHE).then((c) => c.put(request, clone).catch(() => {})).catch(() => {});
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
    // Account and YouTube API responses are private and session-dependent.
    if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/youtube/')) {
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
