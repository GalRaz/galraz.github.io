// Firebase configuration — these values are public by design.
// Security is enforced by Firestore rules, not by hiding this config.
const firebaseConfig = {
  apiKey: "AIzaSyCLdsk7GWR9C6juy_6IqBqaMymAhujm9pc",
  authDomain: "daumis-debt.firebaseapp.com",
  projectId: "daumis-debt",
  storageBucket: "daumis-debt.firebasestorage.app",
  messagingSenderId: "632130093638",
  appId: "1:632130093638:web:31be5718f150d0eb0c8047"
};

// VAPID public key for Web Push (Firebase Cloud Messaging).
// Generate one in Firebase Console → Project Settings → Cloud Messaging
// → Web Push certificates → Generate key pair. Paste the PUBLIC key here.
// Leave as null to disable push entirely (the Settings toggle will say so).
export const VAPID_PUBLIC_KEY = null;

firebase.initializeApp(firebaseConfig);

// Enable offline persistence — queues writes when offline, syncs when back online
firebase.firestore().enablePersistence({ synchronizeTabs: true })
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Offline persistence unavailable: multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.warn('Offline persistence not supported in this browser');
    }
  });

export const auth = firebase.auth();
export const db = firebase.firestore();
export const googleProvider = new firebase.auth.GoogleAuthProvider();
