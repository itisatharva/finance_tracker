// ─── Message handler ──────────────────────────────────────────────────────────
// Allows the update toast in pwa.js to trigger a SW swap immediately.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// CACHE_VERSION is injected by the GitHub Actions build step.
// If you're running locally, bump this manually when you change files.
const CACHE_VERSION = 'BUILD_TIMESTAMP';
const CACHE_NAME    = `ft-shell-${CACHE_VERSION}`;

// All files that form the app shell — cached on install.
// Keep this list in sync with your public/ directory.
const SHELL_ASSETS = [
  '/index.html',
  '/landing.html',
  '/login.html',
  '/category-setup.html',
  '/404.html',
  '/styles.css',
  '/app.js',
  '/auth.js',
  '/category-setup.js',
  '/theme.js',
  '/pwa.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Hosts we never intercept — let the Firebase SDK handle these directly.
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'www.googleapis.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.plot.ly',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())   // activate immediately
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('ft-shell-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // take control of existing tabs
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET and all Firebase/CDN requests — never cache these.
  if (request.method !== 'GET') return;
  if (BYPASS_HOSTS.some(h => url.hostname.includes(h))) return;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // 2. Navigation requests (HTML pages) → Network-first, fallback to cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache a fresh copy on success
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // 3. CSS, JS, images versioned with ?v= → Cache-first (versioning means stale = impossible).
  if (url.search.includes('v=') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. Everything else → Stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => cached);  // network failed — fall back to cache
        return cached || fetchPromise;
      })
    )
  );
});