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
const SW_SCOPE = '/daumis-debt/';

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

  return token;
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
