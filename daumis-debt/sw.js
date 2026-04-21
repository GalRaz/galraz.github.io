const CACHE_NAME = 'daumis-debt-v26';
const ASSETS = [
  '/daumis-debt/',
  '/daumis-debt/index.html',
  '/daumis-debt/css/style.css',
  '/daumis-debt/js/app.js',
  '/daumis-debt/js/firebase-config.js',
  '/daumis-debt/js/exchange.js',
  '/daumis-debt/js/balance.js',
  '/daumis-debt/js/duel.js',
  '/daumis-debt/js/recurring.js',
  '/daumis-debt/js/games/coin-flip.js',
  '/daumis-debt/js/games/wheel.js',
  '/daumis-debt/js/games/rps.js',
  '/daumis-debt/js/games/lucky-number.js',
  '/daumis-debt/js/games/scratch-card.js',
  '/daumis-debt/manifest.json',
  '/daumis-debt/assets/icons/icon.png'
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
  // Dramatically improves repeat-load speed for the app shell.
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
