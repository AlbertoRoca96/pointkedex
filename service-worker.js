/* ─────────────────────────
   Pointkedex Service Worker
   ───────────────────────── */

const CACHE_VERSION = 'v4';
const CACHE_NAME    = `pointkedex-${CACHE_VERSION}`;

/* Core offline assets (kept minimal + dynamic) */
const CORE_ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js',
  '/manifest.webmanifest', '/flavor_text.json', '/class_indices.json',
  '/usage_data.json'
];

/* Install */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

/* Activate: purge old versions */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k.startsWith('pointkedex-') && k !== CACHE_NAME)
        .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* Fetch strategy */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API calls: try network first, but fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(resp => {
          if (resp.ok) {
            // optional: cache useful API responses (like usage_data.json) for offline
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => {
              if (url.pathname.includes('usage') || url.pathname.includes('pokemon')) {
                c.put(request, clone);
              }
            });
          }
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Core static assets / navigation – stale-while-revalidate
  const isCore = CORE_ASSETS.includes(url.pathname) || request.mode === 'navigate';
  if (isCore) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(cached => {
        const network = fetch(request).then(fresh => {
          if (fresh.ok) {
            caches.open(CACHE_NAME).then(c => c.put(request, fresh.clone()));
          }
          return fresh;
        }).catch(() => null);
        return cached || network;
      })
    );
    return;
  }

  // Default: network, fallback to cache
  event.respondWith(
    fetch(request)
      .then(resp => {
        if (resp.ok && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(request))
  );
});
