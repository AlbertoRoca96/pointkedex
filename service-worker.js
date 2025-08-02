/* ─────────────────────────
   Pointkedex Service Worker
   ───────────────────────── */

const CACHE_VERSION = 'v5';
const CACHE_NAME    = `pointkedex-${CACHE_VERSION}`;

/* ---------------------------
   Core files needed offline
   --------------------------- */
const CORE_ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js',
  '/manifest.webmanifest', '/flavor_text.json', '/class_indices.json',
  '/usage_data.json',
  '/web_model/model.json', '/web_model/group1-shard1of25.bin'
];

/* --------------------------  Install  -------------------------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

/* -------------------------- Activate --------------------------- */
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

/* --------------------------- Fetch ----------------------------- */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  const isCore = CORE_ASSETS.includes(url.pathname) || request.mode === 'navigate';
  if (isCore) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
            .then(resp => resp || fetch(request))
    );
    return;
  }

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
