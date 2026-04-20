// Firebase configuration for the Gapara (갚아라) instance.
// These values are public by design — security is enforced by Firestore
// rules (scoped to the two allowed UIDs), not by hiding this config.
const firebaseConfig = {
  apiKey: "AIzaSyDtVYUvmATMtJ0TY7Uwk6eK9tIfugQTs2Q",
  authDomain: "gapara-99a38.firebaseapp.com",
  projectId: "gapara-99a38",
  storageBucket: "gapara-99a38.firebasestorage.app",
  messagingSenderId: "370093105713",
  appId: "1:370093105713:web:8a830f0c81104bdc4a6b10"
};

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
