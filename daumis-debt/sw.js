// Local development kill-switch: on localhost this SW must never cache.
// It unregisters itself, wipes every cache, and reloads its clients so a
// stale SW from an earlier session can't serve old files during dev.
// Production hosts are completely unaffected.
const IS_LOCAL_DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

const CACHE_NAME = 'daumis-debt-v53';
const ASSETS = [
  '/daumis-debt/',
  '/daumis-debt/index.html',
  '/daumis-debt/css/style.css',
  '/daumis-debt/js/app.js',
  '/daumis-debt/js/firebase-config.js',
  '/daumis-debt/js/exchange.js',
  '/daumis-debt/js/balance.js',
  '/daumis-debt/js/duel.js',
  '/daumis-debt/js/duel-logic.js',
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
  if (IS_LOCAL_DEV) { self.skipWaiting(); return; }
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  if (IS_LOCAL_DEV) {
    // Self-destruct: wipe caches, unregister, hard-reload every open tab.
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })());
    return;
  }
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Local dev: never intercept anything.
  if (IS_LOCAL_DEV) return;
  // Let API calls go straight to network (no SW interference)
  if (e.request.url.includes('firestore.googleapis.com') ||
      e.request.url.includes('frankfurter.app') ||
      e.request.url.includes('open.er-api.com') ||
      e.request.url.includes('googleapis.com/identitytoolkit') ||
      e.request.url.includes('gstatic.com/firebasejs')) {
    return;
  }
  // NEVER cache the FCM service worker — the browser's own SW update
  // check fetches it via the network layer, and a stale cached copy
  // here will mask new versions, leaving users on outdated FCM logic
  // (e.g. reading title/body from the old payload field).
  if (e.request.url.includes('/firebase-messaging-sw.js')) return;
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
