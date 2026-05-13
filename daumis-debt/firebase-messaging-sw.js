// Dedicated service worker for Firebase Cloud Messaging.
//
// Firebase requires a service worker at this exact filename to receive
// background push messages. It's separate from the app's main sw.js
// (which handles offline caching) so the two don't fight over scope.
//
// Phase 1 stub: just enough to register cleanly and surface a sensible
// notification if anything does get pushed during testing. The actual
// notification payload + tap-to-deep-link handlers land in Phase 4.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCLdsk7GWR9C6juy_6IqBqaMymAhujm9pc',
  authDomain: 'daumis-debt.firebaseapp.com',
  projectId: 'daumis-debt',
  storageBucket: 'daumis-debt.firebasestorage.app',
  messagingSenderId: '632130093638',
  appId: '1:632130093638:web:31be5718f150d0eb0c8047',
});

const messaging = firebase.messaging();

// Background pushes (app not focused). The display payload is whatever the
// Cloud Function sends in `notification`; if none, fall back to a generic
// "Daumi's Debt — something changed" message so we never silently drop a push.
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload?.notification || {};
  return self.registration.showNotification(title || "Daumi's Debt", {
    body: body || 'Something changed.',
    icon: '/daumis-debt/assets/icons/icon.png',
    badge: '/daumis-debt/assets/icons/icon.png',
    data: payload?.data || {},
  });
});

// Tap → focus an existing tab if any, otherwise open the dashboard.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = '/daumis-debt/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/daumis-debt/') && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
