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

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Network-first for API, cache-first for assets
  if (url.pathname.startsWith('/api/')) {
    // Account and YouTube API responses are private and session-dependent.
    if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/youtube/')) {
      e.respondWith(fetch(e.request));
      return;
    }
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const clone = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((network) => {
          if (network.ok && e.request.method === 'GET') {
            const clone = network.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return network;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
