const CACHE_NAME = 'gapara-v1';
const ASSETS = [
  '/gapara/',
  '/gapara/index.html',
  '/gapara/css/style.css',
  '/gapara/js/app.js',
  '/gapara/js/firebase-config.js',
  '/gapara/js/exchange.js',
  '/gapara/js/balance.js',
  '/gapara/js/duel.js',
  '/gapara/js/recurring.js',
  '/gapara/js/games/coin-flip.js',
  '/gapara/js/games/wheel.js',
  '/gapara/js/games/rps.js',
  '/gapara/js/games/lucky-number.js',
  '/gapara/js/games/scratch-card.js',
  '/gapara/manifest.json',
  '/gapara/assets/icons/icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Let API calls go straight to network (no SW interference)
  if (e.request.url.includes('firestore.googleapis.com') ||
      e.request.url.includes('frankfurter.app') ||
      e.request.url.includes('open.er-api.com') ||
      e.request.url.includes('googleapis.com/identitytoolkit') ||
      e.request.url.includes('gstatic.com/firebasejs')) {
    return;
  }
  // Only cache GET requests
  if (e.request.method !== 'GET') return;

  // Stale-while-revalidate: return cache immediately, update in background.
  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(e.request);
      const networkFetch = fetch(e.request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(e.request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
