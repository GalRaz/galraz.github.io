import { auth, googleProvider } from './firebase-config.js';
import './expenses.js';
import './payments.js';
import './duel.js';

// --- State ---
let currentUser = null;

// User name mapping — populated after auth. Keys are UIDs, values are display names.
const userNames = {};

// --- Auth ---
document.getElementById('btn-google-login').addEventListener('click', () => {
  auth.signInWithPopup(googleProvider).catch((err) => {
    console.error('Auth error:', err);
    alert('Sign-in failed. Make sure you use an authorized Google account.');
  });
});

auth.onAuthStateChanged((user) => {
  if (user) {
    currentUser = user;
    userNames[user.uid] = user.displayName || user.email;
    showApp();
  } else {
    currentUser = null;
    showScreen('auth');
    document.getElementById('bottom-nav').classList.add('hidden');
  }
});

// --- Routing ---
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.screen === name);
  });
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    showScreen(btn.dataset.screen);
    if (btn.dataset.screen === 'dashboard') {
      const { loadDashboard } = await import('./balance.js');
      loadDashboard();
    }
    if (btn.dataset.screen === 'history') {
      const { loadHistory } = await import('./history.js');
      loadHistory();
    }
  });
});

// --- Toggle buttons ---
document.querySelectorAll('.toggle').forEach((toggle) => {
  toggle.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
});

// --- App entry ---
async function showApp() {
  document.getElementById('bottom-nav').classList.remove('hidden');
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('expense-date').value = today;
  document.getElementById('payment-date').value = today;
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
}

// Expose for other modules
export { currentUser, userNames, showScreen };
export function getCurrentUser() { return currentUser; }
export function getPartnerUid() {
  return Object.keys(userNames).find((uid) => uid !== currentUser.uid) || null;
}
export function getUserName(uid) {
  return userNames[uid] || 'Partner';
}
export function setPartnerInfo(uid, name) {
  userNames[uid] = name;
}

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/daumis-debt/sw.js')
    .then(() => console.log('SW registered'))
    .catch((err) => console.error('SW registration failed:', err));
}
