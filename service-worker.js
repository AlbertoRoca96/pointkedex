/* ─────────────────────────
   Pointkedex Service Worker
   ───────────────────────── */

const CACHE_VERSION = 'v3';           // bump when assets change
const CACHE_NAME    = `pointkedex-${CACHE_VERSION}`;

/* ---------------------------
   Core files needed offline
   --------------------------- */
const CORE_ASSETS = [
  '/',                  // default route
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/flavor_text.json',
  '/class_indices.json',

  /* First shard + json of the TF‑JS model.
     Remaining shards stream from network on demand. */
  '/web_model/model.json',
  '/web_model/group1-shard1of25.bin'
];

/* --------------------------
   Install – pre‑cache core
   -------------------------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();   // activate worker immediately
});

/* --------------------------
   Activate – clean old cache
   -------------------------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(name => name.startsWith('pointkedex-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

/* -------------------------------------------
   Fetch – network‑first, cache‑fallback
   -------------------------------------------
   • HTML & core files: serve cache if offline.
   • Other GETs: race network vs cache; update cache
     in background (“stale‑while‑revalidate”).
-------------------------------------------- */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url     = new URL(request.url);
  const isCore  = CORE_ASSETS.includes(url.pathname) ||
                  request.mode === 'navigate';

  if (isCore) {
    // Cache‑only fallback for app shell
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
            .then(resp => resp || fetch(request))
    );
    return;
  }

  // For everything else: network‑first, cache‑fallback, update cache async
  event.respondWith(
    fetch(request)
      .then(resp => {
        if (resp.ok && resp.type === 'basic') {
          // clone & stash a fresh copy
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(request)) // offline fallback
  );
});
