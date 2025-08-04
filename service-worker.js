/* ─────────────────────────
   Pointkedex Service Worker
   ───────────────────────── */

const CACHE_VERSION = 'v4';                       // bump to flush bad cache
const CACHE_NAME    = `pointkedex-${CACHE_VERSION}`;

/* dynamic prefix: "" on HF Space, "/pointkedex" on GitHub Pages */
const ROOT = self.registration.scope
               .replace(self.location.origin, '')   // strip origin
               .replace(/\/$/, '');                 // trim trailing slash

/* helper to prefix asset paths with ROOT */
const withRoot = p => `${ROOT}/${p}`;

/* ---------------------------
   Core files needed offline
   (NO leading slash -> scope-relative)
   --------------------------- */
const CORE_FILES = [
  'index.html', 'styles.css', 'app.js',
  'manifest.webmanifest', 'flavor_text.json',
  'class_indices.json', 'usage_data.json',
  'web_model/model.json', 'web_model/group1-shard1of25.bin'
];

/* --------------------------  Install  -------------------------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
          .then(cache => cache.addAll(CORE_FILES.map(withRoot)))
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

  /* never intercept API calls */
  if (url.pathname.startsWith(`${ROOT}/api/`)) return;

  /* treat nav requests and core files as cache-first */
  const isCore =
    url.pathname === `${ROOT}/` ||
    url.pathname === `${ROOT}/index.html` ||
    CORE_FILES.some(p => url.pathname === `${ROOT}/${p}`);

  if (isCore) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
            .then(resp => resp || fetch(request))
    );
    return;
  }

  /* everything else: network-first, then cache fallback */
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
