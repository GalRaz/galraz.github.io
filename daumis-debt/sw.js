const CACHE_NAME = 'daumis-debt-v16';
const ASSETS = [
  '/daumis-debt/',
  '/daumis-debt/index.html',
  '/daumis-debt/css/style.css',
  '/daumis-debt/js/app.js',
  '/daumis-debt/js/firebase-config.js',
  '/daumis-debt/js/exchange.js',
  '/daumis-debt/js/balance.js',
  '/daumis-debt/js/notifications.js',
  '/daumis-debt/js/duel.js',
  '/daumis-debt/js/recurring.js',
  '/daumis-debt/js/games/coin-flip.js',
  '/daumis-debt/js/games/wheel.js',
  '/daumis-debt/js/games/rps.js',
  '/daumis-debt/js/games/lucky-number.js',
  '/daumis-debt/js/games/scratch-card.js',
  '/daumis-debt/manifest.json'
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
  // Let API calls go straight to network
  if (e.request.url.includes('firestore.googleapis.com') ||
      e.request.url.includes('frankfurter.app') ||
      e.request.url.includes('open.er-api.com') ||
      e.request.url.includes('googleapis.com/identitytoolkit') ||
      e.request.url.includes('gstatic.com/firebasejs') ||
      e.request.url.includes('cdn.jsdelivr.net') ||
      e.request.url.includes('api.emailjs.com')) {
    return;
  }
  // Network-first: try network, update cache, fall back to cache if offline
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
