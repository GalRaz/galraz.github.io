// Push-notification opt-in for daumis-debt.
//
// Phase 1: handle the toggle in Settings — request browser permission, fetch
// the FCM token, and write it to Firestore at users/{uid}.fcmToken so a
// Cloud Function can address pushes to the partner in a later phase.
//
// No actual pushes are sent yet — this commit only wires up the token capture
// and the UI state machine.

import { db, VAPID_PUBLIC_KEY } from './firebase-config.js';

const MESSAGING_SDK_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js';
const SW_PATH = '/daumis-debt/firebase-messaging-sw.js';
// Dedicated sub-scope so the FCM SW can coexist with the app's offline-cache
// SW (sw.js), which is registered at scope '/daumis-debt/'. Two SWs cannot
// share a scope — the second registration silently replaces the first, which
// is what was killing background push delivery (the token was bound to an SW
// that got unregistered on the next page load).
const SW_SCOPE = '/daumis-debt/fcm-push-scope/';

let _messaging = null;
let _swReg = null;

/** Lazy-load the messaging SDK (it's ~50KB so we don't pull it on every page). */
async function loadMessagingSdk() {
  if (window.firebase?.messaging) return window.firebase.messaging();
  if (_messaging) return _messaging;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MESSAGING_SDK_URL;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  _messaging = firebase.messaging();
  return _messaging;
}

/**
 * Browser/feature support check. iOS Safari only supports web push inside
 * an installed PWA, and even then only on iOS 16.4+. Other browsers gate
 * on Notification + ServiceWorker + PushManager + Firebase Messaging.
 */
export function pushIsSupported() {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  // Firebase Messaging in browsers we don't support fails fast on .isSupported(),
  // but that's async — for the sync gate, the three above plus VAPID configured
  // are sufficient. We re-check inside enable() with firebase.messaging.isSupported().
  return true;
}

/** Current state: 'off' | 'pending' | 'on' | 'denied' | 'unsupported' | 'no-vapid' */
export async function getPushState(currentUser) {
  if (!pushIsSupported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'no-vapid';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  if (!currentUser) return 'off';
  try {
    const snap = await db.collection('users').doc(currentUser.uid).get();
    const token = snap.exists ? snap.data().fcmToken : null;
    return token ? 'on' : 'off';
  } catch (e) {
    console.warn('getPushState: could not read users doc', e);
    return 'off';
  }
}

/** Register (or reuse) the dedicated FCM service worker. */
async function getOrRegisterSw() {
  if (_swReg) return _swReg;
  // Reuse the registration if it's already there from a prior session.
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing && existing.active && existing.active.scriptURL.endsWith('firebase-messaging-sw.js')) {
    _swReg = existing;
    return existing;
  }
  _swReg = await navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
  return _swReg;
}

/** Ask the browser for permission, fetch a token, write to Firestore. */
export async function enablePush(currentUser) {
  if (!pushIsSupported()) throw new Error('Push not supported in this browser');
  if (!VAPID_PUBLIC_KEY) throw new Error('VAPID public key not configured');
  if (!currentUser) throw new Error('Must be signed in');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied' ? 'Permission denied' : 'Permission not granted');
  }

  const messaging = await loadMessagingSdk();
  const swReg = await getOrRegisterSw();
  const token = await messaging.getToken({
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: swReg,
  });
  if (!token) throw new Error('Failed to obtain FCM token');

  await db.collection('users').doc(currentUser.uid).set({
    fcmToken: token,
    fcmTokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Foreground handler: when a push arrives while the app is open and
  // focused, FCM routes the payload here instead of the service worker's
  // onBackgroundMessage. Without this, the push is silent. Show the same
  // system notification ourselves so the UX matches the background case.
  bindForegroundHandler();

  return token;
}

let _foregroundBound = false;
function bindForegroundHandler() {
  if (_foregroundBound) return;
  if (!window.firebase?.messaging) return;
  const messaging = firebase.messaging();
  // Intentionally a no-op: when a push has a `notification` payload, the FCM
  // Web SDK fires BOTH onBackgroundMessage (in the SW) and onMessage (in the
  // page) on the same event. The SW will already display the system
  // notification — so if we also call showNotification here, the user sees
  // two banners for every push. The app's Firestore listeners will update
  // the in-app UI on their own.
  messaging.onMessage(() => {});
  _foregroundBound = true;
}

/**
 * Re-bind the foreground handler on every app load (not just when the user
 * first opts in). If they already have a token, the SDK can be loaded and
 * the handler attached so foreground pushes don't get dropped.
 */
export async function rehydrateForegroundHandler(currentUser) {
  if (!pushIsSupported() || !VAPID_PUBLIC_KEY || !currentUser) return;
  if (Notification.permission !== 'granted') return;
  try {
    const snap = await db.collection('users').doc(currentUser.uid).get();
    if (!snap.exists || !snap.data().fcmToken) return;
    const oldToken = snap.data().fcmToken;
    const messaging = await loadMessagingSdk();
    const swReg = await getOrRegisterSw();
    bindForegroundHandler();
    // The SW scope changed (was `/daumis-debt/` — conflicting with sw.js —
    // now `/daumis-debt/fcm-push-scope/`), so the previously-stored token
    // is bound to an SW that no longer exists. Re-mint the token against
    // the current SW registration and write it back if it differs.
    const freshToken = await messaging.getToken({
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: swReg,
    }).catch(() => null);
    if (freshToken && freshToken !== oldToken) {
      await db.collection('users').doc(currentUser.uid).set({
        fcmToken: freshToken,
        fcmTokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.info('FCM token refreshed after SW scope change');
    }
  } catch (e) {
    console.warn('rehydrateForegroundHandler failed:', e?.message || e);
  }
}

/** Remove the token (so the Cloud Function stops addressing this user). */
export async function disablePush(currentUser) {
  if (!currentUser) return;
  try {
    if (window.firebase?.messaging) {
      const messaging = firebase.messaging();
      await messaging.deleteToken().catch(() => {});
    }
  } catch (e) {}
  await db.collection('users').doc(currentUser.uid).set({
    fcmToken: firebase.firestore.FieldValue.delete(),
    fcmTokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}
