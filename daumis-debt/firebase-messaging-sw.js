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

// Background pushes (app not focused). The Cloud Function sends data-only
// payloads (no `notification` field) so this handler is the SINGLE source
// of displayed notifications — preventing the FCM Web SDK's auto-display
// from doubling up on top of our showNotification call.
//
// Title and body live inside `payload.data` (FCM data values are always
// strings, which is fine). Tag remains for collapse-replace if the same
// doc id is pushed more than once.
function tagFor(data) {
  const d = data || {};
  if (d.expenseId) return `expense-${d.expenseId}`;
  if (d.paymentId) return `payment-${d.paymentId}`;
  if (d.duelId) return `duel-${d.duelId}`;
  if (d.type === 'duel-reminder') return `duel-reminder-${d.week || ''}-${d.year || ''}`;
  return 'daumis-debt';
}

messaging.onBackgroundMessage((payload) => {
  const data = payload?.data || {};
  const title = data.title || "Daumi's Debt";
  const body = data.body || 'Something changed.';
  return self.registration.showNotification(title, {
    body,
    icon: '/daumis-debt/assets/icons/icon.png',
    badge: '/daumis-debt/assets/icons/icon.png',
    tag: tagFor(data),
    renotify: false,
    data,
  });
});

// Tap → route to the relevant screen based on the push payload's `data.type`.
// We pass the route via the URL hash so a cold-start launch (no existing tab)
// reads it from location.hash, and an in-app focus path can read it from a
// postMessage so the app can navigate without a full reload.
function routeForPayload(data) {
  if (!data || !data.type) return '/daumis-debt/';
  switch (data.type) {
    case 'expense':
      return data.expenseId
        ? `/daumis-debt/#/expense/${data.expenseId}`
        : '/daumis-debt/';
    case 'payment':
      return data.paymentId
        ? `/daumis-debt/#/payment/${data.paymentId}`
        : '/daumis-debt/';
    case 'duel':
    case 'duel-reminder':
      return '/daumis-debt/#/duel';
    default:
      return '/daumis-debt/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const target = routeForPayload(data);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/daumis-debt/') && 'focus' in c) {
        // Existing tab — focus it and ask the page to route itself, so we
        // don't trigger a full reload that would discard transient state.
        c.postMessage({ kind: 'push-route', route: target, data });
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
