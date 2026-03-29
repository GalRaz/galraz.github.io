# Daumi's Debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private couples expense tracker PWA with multi-currency support, settlement tracking, and weekly mini-games, hosted on GitHub Pages with Firebase backend.

**Architecture:** Single-page vanilla JS app using ES modules, served from `/daumis-debt/` on the existing GitHub Pages site. Firebase provides auth (Google Sign-In) and data storage (Firestore). Exchange rates from frankfurter.app. No build step — static files only.

**Tech Stack:** Vanilla HTML/CSS/JS (ES modules), Firebase Auth + Firestore, frankfurter.app API, Service Worker for PWA

**Note on testing:** This is a vanilla JS app with no build step and no test framework. Each task includes manual verification steps. The app is for two users — correctness is validated by running in the browser against the live Firebase project.

---

### Task 0: Firebase Project Setup (Manual)

This task is done by the user in the Firebase Console, not by code.

- [ ] **Step 1: Create Firebase project**

Go to https://console.firebase.google.com. Create a new project called "daumis-debt". Disable Google Analytics (not needed).

- [ ] **Step 2: Enable Authentication**

In the Firebase Console → Authentication → Sign-in method → Enable "Google" provider. Add both Gal's and Daum's email addresses as authorized users (this is done via Firestore rules, not here — just enable the provider).

- [ ] **Step 3: Enable Firestore**

In Firebase Console → Firestore Database → Create database → Start in **test mode** (we'll deploy proper rules in Task 15). Choose the closest region.

- [ ] **Step 4: Register web app**

In Firebase Console → Project settings → Add app → Web. Register app name "Daumi's Debt". Copy the Firebase config object (apiKey, authDomain, projectId, etc.) — you'll need it in Task 2.

- [ ] **Step 5: Add GitHub Pages domain to authorized domains**

In Firebase Console → Authentication → Settings → Authorized domains → Add `galraz.github.io`.

---

### Task 1: Project Scaffold + PWA Shell

**Files:**
- Create: `daumis-debt/index.html`
- Create: `daumis-debt/manifest.json`
- Create: `daumis-debt/sw.js`
- Create: `daumis-debt/css/style.css`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p daumis-debt/css daumis-debt/js/games daumis-debt/assets/icons
```

- [ ] **Step 2: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#1a1a2e">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Daumi's Debt</title>
  <link rel="manifest" href="manifest.json">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="app">
    <!-- Auth screen -->
    <div id="screen-auth" class="screen active">
      <div class="auth-container">
        <h1>Daumi's Debt</h1>
        <p class="subtitle">Expense tracker for two</p>
        <button id="btn-google-login" class="btn btn-primary">Sign in with Google</button>
      </div>
    </div>

    <!-- Dashboard screen -->
    <div id="screen-dashboard" class="screen">
      <div class="dashboard-content">
        <div id="balance-display" class="balance-card">
          <p class="balance-label">Loading...</p>
          <p class="balance-amount"></p>
        </div>
        <div id="duel-banner" class="duel-banner hidden">
          <p>Weekly Duel available!</p>
          <button id="btn-play-duel" class="btn btn-accent">Play</button>
        </div>
        <div id="recent-activity">
          <h3>Recent Activity</h3>
          <ul id="activity-list" class="activity-list"></ul>
        </div>
      </div>
    </div>

    <!-- Add Expense screen -->
    <div id="screen-add-expense" class="screen">
      <h2>Add Expense</h2>
      <form id="form-expense" class="form">
        <input type="text" id="expense-desc" placeholder="What was it for?" required>
        <div class="row">
          <input type="number" id="expense-amount" placeholder="Amount" step="0.01" required>
          <select id="expense-currency">
            <option value="USD">USD</option>
            <option value="THB">THB</option>
            <option value="BTN">BTN</option>
            <option value="JPY">JPY</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div class="toggle-group">
          <label>Paid by</label>
          <div class="toggle" id="expense-paid-by">
            <button type="button" class="toggle-btn active" data-value="self">Me</button>
            <button type="button" class="toggle-btn" data-value="partner">Partner</button>
          </div>
        </div>
        <div class="toggle-group">
          <label>Split</label>
          <div class="toggle" id="expense-split">
            <button type="button" class="toggle-btn active" data-value="even">Split evenly</button>
            <button type="button" class="toggle-btn" data-value="full">Owed fully</button>
          </div>
        </div>
        <input type="date" id="expense-date">
        <button type="submit" class="btn btn-primary">Save Expense</button>
      </form>
    </div>

    <!-- Add Payment screen -->
    <div id="screen-add-payment" class="screen">
      <h2>Record Payment</h2>
      <form id="form-payment" class="form">
        <div class="row">
          <input type="number" id="payment-amount" placeholder="Amount" step="0.01" required>
          <select id="payment-currency">
            <option value="USD">USD</option>
            <option value="THB">THB</option>
            <option value="BTN">BTN</option>
            <option value="JPY">JPY</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div class="toggle-group">
          <label>Who paid</label>
          <div class="toggle" id="payment-direction">
            <button type="button" class="toggle-btn active" data-value="self">I paid</button>
            <button type="button" class="toggle-btn" data-value="partner">Partner paid</button>
          </div>
        </div>
        <input type="date" id="payment-date">
        <button type="submit" class="btn btn-primary">Save Payment</button>
      </form>
    </div>

    <!-- History screen -->
    <div id="screen-history" class="screen">
      <h2>History</h2>
      <ul id="history-list" class="history-list"></ul>
    </div>

    <!-- Duel screen -->
    <div id="screen-duel" class="screen">
      <div id="duel-content"></div>
    </div>
  </div>

  <!-- Bottom nav -->
  <nav id="bottom-nav" class="bottom-nav hidden">
    <button data-screen="dashboard" class="nav-btn active">Home</button>
    <button data-screen="add-expense" class="nav-btn">Expense</button>
    <button data-screen="add-payment" class="nav-btn">Payment</button>
    <button data-screen="history" class="nav-btn">History</button>
  </nav>

  <!-- Firebase SDK (compat for no-build-step usage) -->
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create manifest.json**

```json
{
  "name": "Daumi's Debt",
  "short_name": "Daumi's Debt",
  "start_url": "/daumis-debt/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#1a1a2e",
  "icons": [
    {
      "src": "assets/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "assets/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

- [ ] **Step 4: Create sw.js**

```js
const CACHE_NAME = 'daumis-debt-v1';
const ASSETS = [
  '/daumis-debt/',
  '/daumis-debt/index.html',
  '/daumis-debt/css/style.css',
  '/daumis-debt/js/app.js',
  '/daumis-debt/js/firebase-config.js',
  '/daumis-debt/js/exchange.js',
  '/daumis-debt/js/balance.js',
  '/daumis-debt/js/expenses.js',
  '/daumis-debt/js/payments.js',
  '/daumis-debt/js/history.js',
  '/daumis-debt/js/duel.js',
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
  // Network-first for API calls, cache-first for app shell
  if (e.request.url.includes('firestore.googleapis.com') ||
      e.request.url.includes('frankfurter.app') ||
      e.request.url.includes('googleapis.com/identitytoolkit')) {
    return; // Let network handle Firebase and API calls
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
```

- [ ] **Step 5: Create css/style.css — base styles and layout**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #1a1a2e;
  --surface: #16213e;
  --surface-2: #0f3460;
  --accent: #e94560;
  --text: #eee;
  --text-muted: #999;
  --green: #4ecca3;
  --red: #e94560;
  --radius: 12px;
  --nav-height: 60px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100dvh;
  padding-bottom: var(--nav-height);
  -webkit-font-smoothing: antialiased;
}

/* Screens */
.screen { display: none; padding: 20px; max-width: 480px; margin: 0 auto; }
.screen.active { display: block; }

/* Auth */
.auth-container {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 80dvh; text-align: center;
}
.auth-container h1 { font-size: 2rem; margin-bottom: 8px; }
.subtitle { color: var(--text-muted); margin-bottom: 32px; }

/* Buttons */
.btn {
  padding: 12px 24px; border: none; border-radius: var(--radius);
  font-size: 1rem; cursor: pointer; width: 100%;
  transition: opacity 0.2s;
}
.btn:active { opacity: 0.7; }
.btn-primary { background: var(--accent); color: white; }
.btn-accent { background: var(--green); color: var(--bg); font-weight: 600; }

/* Balance card */
.balance-card {
  background: var(--surface); border-radius: var(--radius);
  padding: 24px; text-align: center; margin-bottom: 20px;
}
.balance-label { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 4px; }
.balance-amount { font-size: 2.2rem; font-weight: 700; }
.balance-amount.positive { color: var(--green); }
.balance-amount.negative { color: var(--red); }

/* Duel banner */
.duel-banner {
  background: linear-gradient(135deg, var(--surface-2), var(--accent));
  border-radius: var(--radius); padding: 16px; margin-bottom: 20px;
  display: flex; align-items: center; justify-content: space-between;
}
.duel-banner .btn { width: auto; }

/* Forms */
.form { display: flex; flex-direction: column; gap: 12px; }
.form input, .form select {
  padding: 12px; border-radius: var(--radius); border: 1px solid var(--surface-2);
  background: var(--surface); color: var(--text); font-size: 1rem;
}
.row { display: flex; gap: 8px; }
.row input { flex: 1; }
.row select { width: 90px; }

/* Toggle */
.toggle-group { display: flex; flex-direction: column; gap: 6px; }
.toggle-group label { font-size: 0.85rem; color: var(--text-muted); }
.toggle {
  display: flex; background: var(--surface); border-radius: var(--radius);
  overflow: hidden;
}
.toggle-btn {
  flex: 1; padding: 10px; border: none; background: transparent;
  color: var(--text-muted); font-size: 0.9rem; cursor: pointer;
  transition: all 0.2s;
}
.toggle-btn.active { background: var(--surface-2); color: var(--text); }

/* Activity / History list */
.activity-list, .history-list { list-style: none; }
.activity-list li, .history-list li {
  background: var(--surface); border-radius: var(--radius);
  padding: 12px 16px; margin-bottom: 8px;
  display: flex; justify-content: space-between; align-items: center;
}
.entry-info { flex: 1; }
.entry-desc { font-size: 0.95rem; }
.entry-meta { font-size: 0.8rem; color: var(--text-muted); }
.entry-amount { font-weight: 600; text-align: right; }
.entry-amount.credit { color: var(--green); }
.entry-amount.debit { color: var(--red); }
.entry-type {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 2px 6px; border-radius: 4px; margin-right: 8px;
}
.entry-type.expense { background: var(--accent); color: white; }
.entry-type.payment { background: var(--green); color: var(--bg); }
.entry-type.duel { background: #f0a500; color: var(--bg); }

/* Bottom nav */
.bottom-nav {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--surface); border-top: 1px solid var(--surface-2);
  display: flex; height: var(--nav-height);
  padding-bottom: env(safe-area-inset-bottom);
}
.nav-btn {
  flex: 1; border: none; background: none; color: var(--text-muted);
  font-size: 0.75rem; cursor: pointer; padding: 8px 0;
  transition: color 0.2s;
}
.nav-btn.active { color: var(--accent); }

/* Utilities */
.hidden { display: none !important; }
h2 { margin-bottom: 16px; }
h3 { font-size: 1rem; color: var(--text-muted); margin-bottom: 12px; }

/* Duel game styles */
.duel-game { text-align: center; padding: 20px 0; }
.duel-game h2 { font-size: 1.5rem; margin-bottom: 20px; }
.duel-result {
  font-size: 1.8rem; font-weight: 700; margin: 20px 0;
  padding: 16px; border-radius: var(--radius); background: var(--surface);
}

/* Coin flip */
.coin {
  width: 120px; height: 120px; border-radius: 50%;
  background: linear-gradient(135deg, #f0a500, #d4900a);
  display: flex; align-items: center; justify-content: center;
  font-size: 2rem; margin: 30px auto;
  transition: transform 0.6s;
}
.coin.flipping { animation: coinFlip 1s ease-out; }
@keyframes coinFlip {
  0% { transform: rotateY(0); }
  100% { transform: rotateY(1800deg); }
}

/* Wheel */
.wheel-container { position: relative; width: 280px; height: 280px; margin: 20px auto; }
.wheel {
  width: 100%; height: 100%; border-radius: 50%;
  transition: transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99);
}
.wheel-pointer {
  position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 12px solid transparent; border-right: 12px solid transparent;
  border-top: 24px solid var(--accent); z-index: 1;
}

/* RPS */
.rps-choices { display: flex; gap: 12px; justify-content: center; margin: 20px 0; }
.rps-choice {
  width: 80px; height: 80px; border-radius: var(--radius);
  background: var(--surface); border: 2px solid var(--surface-2);
  font-size: 2.5rem; cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  transition: border-color 0.2s;
}
.rps-choice.selected { border-color: var(--accent); }
.rps-choice:active { transform: scale(0.95); }

/* Lucky Number */
.number-grid {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 8px; max-width: 300px; margin: 20px auto;
}
.number-btn {
  padding: 12px; border-radius: var(--radius); background: var(--surface);
  border: 2px solid var(--surface-2); color: var(--text);
  font-size: 1.2rem; cursor: pointer; transition: all 0.2s;
}
.number-btn.selected { border-color: var(--accent); background: var(--surface-2); }
.number-btn.target { border-color: var(--green); background: var(--green); color: var(--bg); }

/* Scratch Card */
.scratch-card {
  width: 200px; height: 140px; margin: 20px auto;
  border-radius: var(--radius); position: relative; overflow: hidden;
  cursor: pointer; user-select: none;
}
.scratch-card canvas {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
}
.scratch-value {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 2rem; font-weight: 700;
  background: var(--surface);
}
```

- [ ] **Step 6: Verify scaffold**

Open `daumis-debt/index.html` in a browser (can use `python3 -m http.server` from the repo root). Confirm: dark themed page with "Daumi's Debt" heading and sign-in button. No JS errors in console (Firebase SDK loads, app.js will 404 — that's expected, we create it next).

- [ ] **Step 7: Commit**

```bash
git add daumis-debt/
git commit -m "feat: scaffold Daumi's Debt PWA shell with HTML, CSS, manifest, and service worker"
```

---

### Task 2: Firebase Config + Auth

**Files:**
- Create: `daumis-debt/js/firebase-config.js`
- Create: `daumis-debt/js/app.js`

- [ ] **Step 1: Create js/firebase-config.js**

Replace the placeholder values with the config from Task 0, Step 4.

```js
// Firebase configuration — these values are public by design.
// Security is enforced by Firestore rules, not by hiding this config.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();
export const googleProvider = new firebase.auth.GoogleAuthProvider();
```

- [ ] **Step 2: Create js/app.js — auth + routing**

```js
import { auth, googleProvider } from './firebase-config.js';

// --- State ---
let currentUser = null;
let partnerInfo = null; // { uid, name, email } — resolved after first data load

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
  btn.addEventListener('click', () => {
    showScreen(btn.dataset.screen);
    if (btn.dataset.screen === 'dashboard') loadDashboard();
    if (btn.dataset.screen === 'history') loadHistory();
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
  // Set default dates to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('expense-date').value = today;
  document.getElementById('payment-date').value = today;
  // Load dashboard
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
}

// Expose for other modules
export { currentUser, userNames, showScreen };
export function getCurrentUser() { return currentUser; }
export function getPartnerUid() {
  // Find the other user's UID from userNames
  return Object.keys(userNames).find((uid) => uid !== currentUser.uid) || null;
}
export function getUserName(uid) {
  return userNames[uid] || 'Partner';
}
export function setPartnerInfo(uid, name) {
  userNames[uid] = name;
}
```

- [ ] **Step 3: Verify auth flow**

Run `python3 -m http.server 8080` from the repo root. Open `http://localhost:8080/daumis-debt/`. Click "Sign in with Google". Confirm: Google popup appears, sign-in works, dashboard screen shows. Check console for errors.

- [ ] **Step 4: Commit**

```bash
git add daumis-debt/js/firebase-config.js daumis-debt/js/app.js
git commit -m "feat: add Firebase config and Google Sign-In auth flow"
```

---

### Task 3: Exchange Rate Module

**Files:**
- Create: `daumis-debt/js/exchange.js`

- [ ] **Step 1: Create js/exchange.js**

```js
// Exchange rate cache — avoids repeated API calls in a single session
const rateCache = {};

/**
 * Get exchange rate from a currency to USD.
 * Uses frankfurter.app (ECB data, free, no API key).
 * Returns the rate (multiply by this to get USD).
 * For USD → USD, returns 1.
 * Note: BTN is pegged 1:1 to INR. frankfurter.app doesn't support BTN,
 * so we use INR rate as a proxy.
 */
export async function getExchangeRate(currency) {
  if (currency === 'USD') return 1;

  const cacheKey = currency;
  if (rateCache[cacheKey]) return rateCache[cacheKey];

  // BTN (Bhutanese Ngultrum) is pegged 1:1 to INR
  const queryCurrency = currency === 'BTN' ? 'INR' : currency;

  const response = await fetch(
    `https://api.frankfurter.app/latest?from=${queryCurrency}&to=USD`
  );

  if (!response.ok) {
    throw new Error(`Exchange rate fetch failed for ${currency}`);
  }

  const data = await response.json();
  const rate = data.rates.USD;
  rateCache[cacheKey] = rate;
  return rate;
}

/**
 * Convert an amount in a given currency to USD.
 * Returns { usdAmount, exchangeRate }.
 */
export async function convertToUSD(amount, currency) {
  const exchangeRate = await getExchangeRate(currency);
  return {
    usdAmount: Math.round(amount * exchangeRate * 100) / 100,
    exchangeRate
  };
}
```

- [ ] **Step 2: Verify exchange rates**

Open browser console on the app page and run:
```js
import('./js/exchange.js').then(m => m.convertToUSD(1000, 'THB').then(console.log));
```
Expected: `{ usdAmount: ~28-30, exchangeRate: ~0.028-0.030 }` (varies with live rates).

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/exchange.js
git commit -m "feat: add exchange rate module with BTN/INR proxy support"
```

---

### Task 4: Expense Module

**Files:**
- Create: `daumis-debt/js/expenses.js`

- [ ] **Step 1: Create js/expenses.js**

```js
import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, setPartnerInfo } from './app.js';
import { convertToUSD } from './exchange.js';

const form = document.getElementById('form-expense');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  const description = document.getElementById('expense-desc').value.trim();
  const amount = parseFloat(document.getElementById('expense-amount').value);
  const currency = document.getElementById('expense-currency').value;
  const paidByValue = document.querySelector('#expense-paid-by .toggle-btn.active').dataset.value;
  const splitType = document.querySelector('#expense-split .toggle-btn.active').dataset.value;
  const date = document.getElementById('expense-date').value;

  if (!description || !amount || amount <= 0) {
    alert('Please fill in all fields.');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    const { usdAmount, exchangeRate } = await convertToUSD(amount, currency);
    const paidBy = paidByValue === 'self' ? user.uid : getPartnerUid();
    const owedBy = paidByValue === 'self' ? getPartnerUid() : user.uid;

    await db.collection('expenses').add({
      description,
      amount,
      currency,
      usdAmount,
      exchangeRate,
      paidBy,
      splitType,
      owedBy,
      date: new Date(date + 'T12:00:00'),
      addedBy: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    form.reset();
    document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
    // Reset toggles to default
    document.querySelectorAll('#expense-paid-by .toggle-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0)
    );
    document.querySelectorAll('#expense-split .toggle-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0)
    );
    alert('Expense saved!');
  } catch (err) {
    console.error('Error saving expense:', err);
    alert('Failed to save expense. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Expense';
  }
});

/** Fetch all expenses ordered by date descending. */
export async function getAllExpenses() {
  const snapshot = await db.collection('expenses').orderBy('date', 'desc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
```

- [ ] **Step 2: Verify expense creation**

Open the app, sign in, navigate to "Expense" tab. Fill in a test expense (e.g. "Lunch", 500, THB, split evenly). Submit. Check Firebase Console → Firestore → expenses collection to confirm the document was created with correct fields including usdAmount.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/expenses.js
git commit -m "feat: add expense creation with currency conversion"
```

---

### Task 5: Payment Module

**Files:**
- Create: `daumis-debt/js/payments.js`

- [ ] **Step 1: Create js/payments.js**

```js
import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid } from './app.js';
import { convertToUSD } from './exchange.js';

const form = document.getElementById('form-payment');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  const amount = parseFloat(document.getElementById('payment-amount').value);
  const currency = document.getElementById('payment-currency').value;
  const directionValue = document.querySelector('#payment-direction .toggle-btn.active').dataset.value;
  const date = document.getElementById('payment-date').value;

  if (!amount || amount <= 0) {
    alert('Please enter a valid amount.');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    const { usdAmount, exchangeRate } = await convertToUSD(amount, currency);
    const paidBy = directionValue === 'self' ? user.uid : getPartnerUid();
    const paidTo = directionValue === 'self' ? getPartnerUid() : user.uid;

    await db.collection('payments').add({
      amount,
      currency,
      usdAmount,
      exchangeRate,
      paidBy,
      paidTo,
      date: new Date(date + 'T12:00:00'),
      addedBy: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    form.reset();
    document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
    document.querySelectorAll('#payment-direction .toggle-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0)
    );
    alert('Payment recorded!');
  } catch (err) {
    console.error('Error saving payment:', err);
    alert('Failed to save payment. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Payment';
  }
});

/** Fetch all payments ordered by date descending. */
export async function getAllPayments() {
  const snapshot = await db.collection('payments').orderBy('date', 'desc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
```

- [ ] **Step 2: Verify payment creation**

Open the app, go to "Payment" tab. Record a test payment ($50, USD). Check Firestore to confirm the document.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/payments.js
git commit -m "feat: add payment recording with currency conversion"
```

---

### Task 6: Balance Computation + Dashboard

**Files:**
- Create: `daumis-debt/js/balance.js`

- [ ] **Step 1: Create js/balance.js**

```js
import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName, setPartnerInfo } from './app.js';

/**
 * Compute net balance from all expenses, payments, and duels.
 * Returns a number: positive means the current user is owed money,
 * negative means the current user owes money.
 */
export async function computeBalance() {
  const user = getCurrentUser();
  let balance = 0; // positive = current user is owed

  // Process expenses
  const expenses = await db.collection('expenses').get();
  expenses.forEach((doc) => {
    const e = doc.data();
    // Track partner info for display
    if (e.paidBy !== user.uid) setPartnerInfo(e.paidBy, e.paidByName || 'Partner');
    if (e.owedBy && e.owedBy !== user.uid) setPartnerInfo(e.owedBy, '');

    if (e.splitType === 'even') {
      // paidBy is owed half by the other person
      if (e.paidBy === user.uid) {
        balance += e.usdAmount / 2; // partner owes me half
      } else {
        balance -= e.usdAmount / 2; // I owe partner half
      }
    } else {
      // "full" — owedBy owes the full amount to paidBy
      if (e.paidBy === user.uid && e.owedBy !== user.uid) {
        balance += e.usdAmount; // partner owes me full
      } else if (e.owedBy === user.uid && e.paidBy !== user.uid) {
        balance -= e.usdAmount; // I owe partner full
      }
    }
  });

  // Process payments
  const payments = await db.collection('payments').get();
  payments.forEach((doc) => {
    const p = doc.data();
    if (p.paidBy !== user.uid) setPartnerInfo(p.paidBy, '');
    if (p.paidTo !== user.uid) setPartnerInfo(p.paidTo, '');

    if (p.paidBy === user.uid) {
      balance += p.usdAmount; // I paid partner, so they owe me more (or I owe less)
    } else {
      balance -= p.usdAmount; // Partner paid me
    }
  });

  // Process duels
  const duels = await db.collection('duels').get();
  duels.forEach((doc) => {
    const d = doc.data();
    if (d.favoredUser === user.uid) {
      balance += d.balanceAdjust;
    } else if (d.favoredUser) {
      balance -= d.balanceAdjust;
    }
  });

  return Math.round(balance * 100) / 100;
}

/**
 * Load and render the dashboard.
 */
export async function loadDashboard() {
  const user = getCurrentUser();
  const balanceEl = document.getElementById('balance-display');

  try {
    const balance = await computeBalance();
    const label = balanceEl.querySelector('.balance-label');
    const amount = balanceEl.querySelector('.balance-amount');

    if (balance > 0.005) {
      const partnerName = getUserName(getPartnerUid());
      label.textContent = `${partnerName} owes you`;
      amount.textContent = `$${balance.toFixed(2)}`;
      amount.className = 'balance-amount positive';
    } else if (balance < -0.005) {
      const partnerName = getUserName(getPartnerUid());
      label.textContent = `You owe ${partnerName}`;
      amount.textContent = `$${Math.abs(balance).toFixed(2)}`;
      amount.className = 'balance-amount negative';
    } else {
      label.textContent = "You're all settled up!";
      amount.textContent = '$0.00';
      amount.className = 'balance-amount';
    }

    // Check for weekly duel availability
    const { isDuelAvailable } = await import('./duel.js');
    const duelBanner = document.getElementById('duel-banner');
    if (await isDuelAvailable()) {
      duelBanner.classList.remove('hidden');
    } else {
      duelBanner.classList.add('hidden');
    }

    // Load recent activity
    await loadRecentActivity();
  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

async function loadRecentActivity() {
  const user = getCurrentUser();
  const list = document.getElementById('activity-list');
  list.innerHTML = '';

  // Fetch recent expenses and payments, merge and sort
  const [expSnap, paySnap, duelSnap] = await Promise.all([
    db.collection('expenses').orderBy('createdAt', 'desc').limit(10).get(),
    db.collection('payments').orderBy('createdAt', 'desc').limit(5).get(),
    db.collection('duels').orderBy('playedAt', 'desc').limit(3).get()
  ]);

  const items = [];
  expSnap.forEach((doc) => {
    const d = doc.data();
    items.push({ type: 'expense', date: d.date?.toDate?.() || new Date(d.date), ...d });
  });
  paySnap.forEach((doc) => {
    const d = doc.data();
    items.push({ type: 'payment', date: d.date?.toDate?.() || new Date(d.date), ...d });
  });
  duelSnap.forEach((doc) => {
    const d = doc.data();
    items.push({ type: 'duel', date: d.playedAt?.toDate?.() || new Date(), ...d });
  });

  items.sort((a, b) => b.date - a.date);
  items.slice(0, 10).forEach((item) => {
    const li = document.createElement('li');
    if (item.type === 'expense') {
      const isCredit = item.paidBy === user.uid;
      li.innerHTML = `
        <span class="entry-type expense">Expense</span>
        <div class="entry-info">
          <div class="entry-desc">${item.description}</div>
          <div class="entry-meta">${item.amount} ${item.currency} · ${item.splitType}</div>
        </div>
        <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
          ${isCredit ? '+' : '-'}$${(item.splitType === 'even' ? item.usdAmount / 2 : item.usdAmount).toFixed(2)}
        </div>`;
    } else if (item.type === 'payment') {
      const isCredit = item.paidBy === user.uid;
      li.innerHTML = `
        <span class="entry-type payment">Payment</span>
        <div class="entry-info">
          <div class="entry-desc">Settlement</div>
          <div class="entry-meta">${item.amount} ${item.currency}</div>
        </div>
        <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
          ${isCredit ? '+' : '-'}$${item.usdAmount.toFixed(2)}
        </div>`;
    } else if (item.type === 'duel') {
      const won = item.favoredUser === user.uid;
      li.innerHTML = `
        <span class="entry-type duel">Duel</span>
        <div class="entry-info">
          <div class="entry-desc">${item.game}</div>
          <div class="entry-meta">Week ${item.week}</div>
        </div>
        <div class="entry-amount ${won ? 'credit' : 'debit'}">
          ${won ? '+' : '-'}$${item.balanceAdjust.toFixed(2)}
        </div>`;
    }
    list.appendChild(li);
  });

  if (items.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No activity yet</li>';
  }
}
```

- [ ] **Step 2: Update app.js to import balance module on dashboard load**

In `js/app.js`, update the `showApp` function to properly import and call `loadDashboard`:

Replace the existing `showApp` function:

```js
async function showApp() {
  document.getElementById('bottom-nav').classList.remove('hidden');
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('expense-date').value = today;
  document.getElementById('payment-date').value = today;
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
}
```

Also add imports for expenses and payments at the top of app.js so their form listeners register:

```js
import './expenses.js';
import './payments.js';
```

And update the nav click handler to call loadDashboard:

```js
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
```

- [ ] **Step 3: Verify dashboard**

Sign in, add a couple test expenses via the Expense tab, return to Dashboard. Confirm the balance displays correctly and recent activity shows the entries.

- [ ] **Step 4: Commit**

```bash
git add daumis-debt/js/balance.js daumis-debt/js/app.js
git commit -m "feat: add balance computation and dashboard with recent activity"
```

---

### Task 7: History View

**Files:**
- Create: `daumis-debt/js/history.js`

- [ ] **Step 1: Create js/history.js**

```js
import { db } from './firebase-config.js';
import { getCurrentUser } from './app.js';

export async function loadHistory() {
  const user = getCurrentUser();
  const list = document.getElementById('history-list');
  list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">Loading...</li>';

  try {
    const [expSnap, paySnap, duelSnap] = await Promise.all([
      db.collection('expenses').orderBy('date', 'desc').get(),
      db.collection('payments').orderBy('date', 'desc').get(),
      db.collection('duels').orderBy('playedAt', 'desc').get()
    ]);

    const items = [];
    expSnap.forEach((doc) => {
      const d = doc.data();
      items.push({
        type: 'expense',
        date: d.date?.toDate?.() || new Date(d.date),
        ...d
      });
    });
    paySnap.forEach((doc) => {
      const d = doc.data();
      items.push({
        type: 'payment',
        date: d.date?.toDate?.() || new Date(d.date),
        ...d
      });
    });
    duelSnap.forEach((doc) => {
      const d = doc.data();
      items.push({
        type: 'duel',
        date: d.playedAt?.toDate?.() || new Date(),
        ...d
      });
    });

    items.sort((a, b) => b.date - a.date);
    list.innerHTML = '';

    if (items.length === 0) {
      list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No history yet</li>';
      return;
    }

    items.forEach((item) => {
      const li = document.createElement('li');
      const dateStr = item.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      if (item.type === 'expense') {
        const isCredit = item.paidBy === user.uid;
        const effectiveAmount = item.splitType === 'even' ? item.usdAmount / 2 : item.usdAmount;
        li.innerHTML = `
          <span class="entry-type expense">Expense</span>
          <div class="entry-info">
            <div class="entry-desc">${item.description}</div>
            <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency} · ${item.splitType}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${effectiveAmount.toFixed(2)}
          </div>`;
      } else if (item.type === 'payment') {
        const isCredit = item.paidBy === user.uid;
        li.innerHTML = `
          <span class="entry-type payment">Payment</span>
          <div class="entry-info">
            <div class="entry-desc">Settlement</div>
            <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${item.usdAmount.toFixed(2)}
          </div>`;
      } else if (item.type === 'duel') {
        const won = item.favoredUser === user.uid;
        li.innerHTML = `
          <span class="entry-type duel">Duel</span>
          <div class="entry-info">
            <div class="entry-desc">${item.game}</div>
            <div class="entry-meta">${dateStr} · Week ${item.week}</div>
          </div>
          <div class="entry-amount ${won ? 'credit' : 'debit'}">
            ${won ? '+' : '-'}$${item.balanceAdjust.toFixed(2)}
          </div>`;
      }
      list.appendChild(li);
    });
  } catch (err) {
    console.error('Error loading history:', err);
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">Error loading history</li>';
  }
}
```

- [ ] **Step 2: Verify history**

Sign in, navigate to History tab. Confirm all test expenses and payments from earlier tasks appear in reverse chronological order with correct formatting.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/history.js
git commit -m "feat: add history view with merged expense/payment/duel timeline"
```

---

### Task 8: Weekly Duel Engine + Game Selection

**Files:**
- Create: `daumis-debt/js/duel.js`

- [ ] **Step 1: Create js/duel.js**

```js
import { db } from './firebase-config.js';
import { getCurrentUser, showScreen } from './app.js';

const GAMES = ['coin-flip', 'wheel', 'rps', 'lucky-number', 'scratch-card'];
const GAME_NAMES = {
  'coin-flip': 'Coin Flip',
  'wheel': 'Wheel of Fortune',
  'rps': 'Rock Paper Scissors',
  'lucky-number': 'Lucky Number',
  'scratch-card': 'Scratch Card'
};

/**
 * Simple seeded PRNG (mulberry32).
 * Returns a function that produces deterministic floats in [0, 1).
 */
function seededRandom(seed) {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Get ISO week number for a date. */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/** Get the current week's seed, year, and week number. */
function getCurrentWeekInfo() {
  const now = new Date();
  const week = getISOWeek(now);
  const year = now.getFullYear();
  const seed = year * 100 + week;
  return { year, week, seed };
}

/**
 * Select this week's game deterministically from the seed.
 * Picks 3 candidates, then selects 1.
 */
export function getWeeklyGame(seed) {
  const rng = seededRandom(seed);
  // Shuffle and pick 3
  const shuffled = [...GAMES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const candidates = shuffled.slice(0, 3);
  // Pick 1 from the 3
  const picked = candidates[Math.floor(rng() * 3)];
  return picked;
}

/** Check if a duel has been played this week. */
export async function isDuelAvailable() {
  const { year, week } = getCurrentWeekInfo();
  const snapshot = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();
  return snapshot.empty;
}

/** Start the weekly duel. */
export async function startDuel() {
  const available = await isDuelAvailable();
  if (!available) {
    alert('Duel already played this week!');
    return;
  }

  const { year, week, seed } = getCurrentWeekInfo();
  const game = getWeeklyGame(seed);

  showScreen('duel');
  const content = document.getElementById('duel-content');
  content.innerHTML = `
    <div class="duel-game">
      <h2>Weekly Duel</h2>
      <p class="subtitle">Week ${week} · ${GAME_NAMES[game]}</p>
      <div id="game-area"></div>
    </div>`;

  // Dynamically load the game module
  const gameModule = await import(`./games/${game}.js`);
  gameModule.play(document.getElementById('game-area'), { year, week, seed });
}

/**
 * Record duel result to Firestore.
 * Called by individual game modules when the game completes.
 */
export async function recordDuelResult({ game, result, balanceAdjust, favoredUser, seed, year, week }) {
  await db.collection('duels').add({
    year,
    week,
    game: GAME_NAMES[game] || game,
    result,
    balanceAdjust: Math.abs(balanceAdjust),
    favoredUser,
    playedAt: firebase.firestore.FieldValue.serverTimestamp(),
    seed,
    submissions: null
  });
}

// Wire up the duel banner button
document.getElementById('btn-play-duel').addEventListener('click', startDuel);

export { GAME_NAMES, getCurrentWeekInfo, seededRandom };
```

- [ ] **Step 2: Import duel module in app.js**

Add to the top of `js/app.js`:

```js
import './duel.js';
```

- [ ] **Step 3: Verify game selection is deterministic**

In the browser console:
```js
import('./js/duel.js').then(m => {
  console.log('This week:', m.getWeeklyGame(202613));
  console.log('Same seed again:', m.getWeeklyGame(202613));
  console.log('Different week:', m.getWeeklyGame(202614));
});
```
Confirm: same seed produces same game, different seed produces (likely) different game.

- [ ] **Step 4: Commit**

```bash
git add daumis-debt/js/duel.js daumis-debt/js/app.js
git commit -m "feat: add weekly duel engine with deterministic game selection"
```

---

### Task 9: Coin Flip Game

**Files:**
- Create: `daumis-debt/js/games/coin-flip.js`

- [ ] **Step 1: Create js/games/coin-flip.js**

```js
import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult } from '../duel.js';
import { computeBalance } from '../balance.js';

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const balance = await computeBalance();
  // Debtor is the person who owes; if balance > 0, partner is debtor; if < 0, user is debtor
  const userIsDebtor = balance < 0;
  const debtorName = userIsDebtor ? 'You' : 'Partner';

  container.innerHTML = `
    <p>${debtorName} flip${userIsDebtor ? '' : 's'} the coin.</p>
    <p style="margin-top:8px;color:var(--text-muted)">Heads: $10 forgiven. Tails: $10 added.</p>
    <div class="coin" id="coin">?</div>
    <button class="btn btn-primary" id="btn-flip" style="max-width:200px;margin:0 auto">Flip!</button>
    <div id="flip-result"></div>`;

  document.getElementById('btn-flip').addEventListener('click', async () => {
    const btn = document.getElementById('btn-flip');
    btn.disabled = true;
    const coinEl = document.getElementById('coin');

    // Random result
    const isHeads = Math.random() < 0.5;
    coinEl.classList.add('flipping');
    coinEl.textContent = '';

    setTimeout(async () => {
      coinEl.classList.remove('flipping');
      coinEl.textContent = isHeads ? 'H' : 'T';

      const resultEl = document.getElementById('flip-result');
      // If heads, debtor gets $10 forgiven (favored). If tails, $10 added to their debt.
      // favoredUser: heads → debtor (their debt decreases), tails → creditor (debt increases)
      const debtorUid = userIsDebtor ? user.uid : getPartnerUid();
      const creditorUid = userIsDebtor ? getPartnerUid() : user.uid;
      const favoredUser = isHeads ? debtorUid : creditorUid;

      if (isHeads) {
        resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">Heads! $10 forgiven!</div>`;
      } else {
        resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">Tails! $10 added to debt.</div>`;
      }

      await recordDuelResult({
        game: 'coin-flip',
        result: { side: isHeads ? 'heads' : 'tails' },
        balanceAdjust: 10,
        favoredUser,
        seed, year, week
      });

      btn.textContent = 'Done!';
    }, 1000);
  });
}
```

- [ ] **Step 2: Verify coin flip**

Sign in, if a duel is available, click "Play" on the banner. If the game selected isn't coin flip, temporarily override in console:
```js
import('./js/games/coin-flip.js').then(m => m.play(document.getElementById('game-area'), {year:2026, week:13, seed:202613}));
```
Confirm: coin animates, result shows, Firestore `duels` collection gets a new document.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/games/coin-flip.js
git commit -m "feat: add coin flip duel game"
```

---

### Task 10: Wheel of Fortune Game

**Files:**
- Create: `daumis-debt/js/games/wheel.js`

- [ ] **Step 1: Create js/games/wheel.js**

```js
import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult } from '../duel.js';
import { computeBalance } from '../balance.js';

const SLICES = [
  { value: -10, label: '-$10', color: '#e94560' },
  { value: -5, label: '-$5', color: '#c73e54' },
  { value: 0, label: '$0', color: '#16213e' },
  { value: 0, label: '$0', color: '#0f3460' },
  { value: 5, label: '+$5', color: '#3a8a6a' },
  { value: 10, label: '+$10', color: '#4ecca3' }
];

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const balance = await computeBalance();
  const userIsDebtor = balance < 0;

  // Draw the wheel using canvas
  container.innerHTML = `
    <p>Values are from the debtor's perspective.</p>
    <div class="wheel-container">
      <div class="wheel-pointer"></div>
      <canvas id="wheel-canvas" width="280" height="280"></canvas>
    </div>
    <button class="btn btn-primary" id="btn-spin" style="max-width:200px;margin:0 auto">Spin!</button>
    <div id="spin-result"></div>`;

  const canvas = document.getElementById('wheel-canvas');
  const ctx = canvas.getContext('2d');
  let currentAngle = 0;

  function drawWheel(angle) {
    ctx.clearRect(0, 0, 280, 280);
    const cx = 140, cy = 140, r = 130;
    const sliceAngle = (2 * Math.PI) / SLICES.length;

    SLICES.forEach((slice, i) => {
      const start = angle + i * sliceAngle;
      const end = start + sliceAngle;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + sliceAngle / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eee';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(slice.label, r * 0.65, 5);
      ctx.restore();
    });
  }

  drawWheel(0);

  document.getElementById('btn-spin').addEventListener('click', async () => {
    const btn = document.getElementById('btn-spin');
    btn.disabled = true;

    // Determine result
    const resultIndex = Math.floor(Math.random() * SLICES.length);
    const resultSlice = SLICES[resultIndex];

    // Calculate target angle: spin several full rotations + land on the slice
    // The pointer is at top (angle 0). Slice i occupies from i*60deg to (i+1)*60deg.
    // To land pointer on slice `resultIndex`, we need the center of that slice at angle 0 (top).
    const sliceAngle = (2 * Math.PI) / SLICES.length;
    const targetSliceCenter = resultIndex * sliceAngle + sliceAngle / 2;
    // Wheel rotates clockwise, pointer is fixed at top
    const spins = 5 + Math.random() * 3; // 5-8 full spins
    const totalAngle = spins * 2 * Math.PI + (2 * Math.PI - targetSliceCenter);

    // Animate
    const duration = 3000;
    const start = performance.now();
    const startAngle = currentAngle;

    function animate(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      currentAngle = startAngle + totalAngle * eased;
      drawWheel(-currentAngle); // negative because we rotate the wheel opposite to pointer

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Show result
        const resultEl = document.getElementById('spin-result');
        const debtorUid = userIsDebtor ? user.uid : getPartnerUid();
        const creditorUid = userIsDebtor ? getPartnerUid() : user.uid;

        let favoredUser = null;
        if (resultSlice.value > 0) {
          favoredUser = debtorUid; // debt reduced
        } else if (resultSlice.value < 0) {
          favoredUser = creditorUid; // debt increased
        }

        if (resultSlice.value > 0) {
          resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">${resultSlice.label} — debt reduced!</div>`;
        } else if (resultSlice.value < 0) {
          resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">${resultSlice.label} — debt increased!</div>`;
        } else {
          resultEl.innerHTML = `<div class="duel-result">$0 — no change!</div>`;
        }

        recordDuelResult({
          game: 'wheel',
          result: { value: resultSlice.value },
          balanceAdjust: Math.abs(resultSlice.value),
          favoredUser,
          seed, year, week
        });

        btn.textContent = 'Done!';
      }
    }

    requestAnimationFrame(animate);
  });
}
```

- [ ] **Step 2: Verify wheel**

Test in browser by directly calling:
```js
import('./js/games/wheel.js').then(m => m.play(document.getElementById('game-area'), {year:2026, week:13, seed:202613}));
```
Confirm: wheel renders with colored slices and labels, spins with easing, lands on a slice, result is recorded.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/games/wheel.js
git commit -m "feat: add Wheel of Fortune duel game with spin animation"
```

---

### Task 11: Rock Paper Scissors Game

**Files:**
- Create: `daumis-debt/js/games/rps.js`

- [ ] **Step 1: Create js/games/rps.js**

This game requires both players to submit. The first player submits their choice (stored in Firestore under the duel doc's `submissions` field). When the second player opens the game, they see that the opponent has submitted. They submit their choice, and the result is revealed and recorded.

```js
import { db } from '../firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName } from '../app.js';
import { recordDuelResult, getCurrentWeekInfo } from '../duel.js';

const CHOICES = { rock: '✊', paper: '✋', scissors: '✌️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const partnerUid = getPartnerUid();

  // Check if there's a pending duel doc for this week (with submissions)
  const pendingSnap = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();

  let duelDocRef = null;
  let existingSubmissions = {};

  if (!pendingSnap.empty) {
    const doc = pendingSnap.docs[0];
    const data = doc.data();
    if (data.submissions) {
      existingSubmissions = data.submissions;
      duelDocRef = doc.ref;
    }
    // If the duel has a result already, it's been played
    if (data.result) {
      container.innerHTML = `<p>Duel already played this week!</p>`;
      return;
    }
  }

  const mySubmission = existingSubmissions[user.uid];
  const partnerSubmission = existingSubmissions[partnerUid];

  if (mySubmission && !partnerSubmission) {
    // I already submitted, waiting for partner
    container.innerHTML = `
      <p>You picked ${CHOICES[mySubmission]}. Waiting for ${getUserName(partnerUid)} to play...</p>
      <button class="btn btn-primary" id="btn-refresh" style="max-width:200px;margin:0 auto">Refresh</button>`;
    document.getElementById('btn-refresh').addEventListener('click', () => play(container, { year, week, seed }));
    return;
  }

  if (partnerSubmission && !mySubmission) {
    // Partner submitted, my turn
    container.innerHTML = `
      <p>${getUserName(partnerUid)} has played! Your turn.</p>
      ${renderChoices()}
      <div id="rps-result"></div>`;
    setupChoiceHandlers(container, { year, week, seed, duelDocRef, partnerSubmission, existingSubmissions });
    return;
  }

  // Nobody has submitted yet — first player
  container.innerHTML = `
    <p>Pick your weapon! Your choice is hidden until ${getUserName(partnerUid) || 'your partner'} plays.</p>
    ${renderChoices()}
    <div id="rps-result"></div>`;
  setupChoiceHandlers(container, { year, week, seed, duelDocRef: null, partnerSubmission: null, existingSubmissions });
}

function renderChoices() {
  return `<div class="rps-choices">
    ${Object.entries(CHOICES).map(([key, emoji]) =>
      `<div class="rps-choice" data-choice="${key}">${emoji}</div>`
    ).join('')}
  </div>`;
}

function setupChoiceHandlers(container, { year, week, seed, duelDocRef, partnerSubmission, existingSubmissions }) {
  const user = getCurrentUser();
  const partnerUid = getPartnerUid();

  container.querySelectorAll('.rps-choice').forEach((el) => {
    el.addEventListener('click', async () => {
      // Highlight selection
      container.querySelectorAll('.rps-choice').forEach((c) => c.classList.remove('selected'));
      el.classList.add('selected');

      const myChoice = el.dataset.choice;

      if (partnerSubmission) {
        // Both have chosen — resolve!
        const resultEl = document.getElementById('rps-result');
        let favoredUser = null;
        let resultText = '';

        if (myChoice === partnerSubmission) {
          resultText = `Tie! Both picked ${CHOICES[myChoice]}. No change.`;
        } else if (BEATS[myChoice] === partnerSubmission) {
          favoredUser = user.uid;
          resultText = `You win! ${CHOICES[myChoice]} beats ${CHOICES[partnerSubmission]}. $10 in your favor!`;
        } else {
          favoredUser = partnerUid;
          resultText = `You lose! ${CHOICES[partnerSubmission]} beats ${CHOICES[myChoice]}. $10 to ${getUserName(partnerUid)}.`;
        }

        const color = favoredUser === user.uid ? 'var(--green)' : favoredUser ? 'var(--red)' : 'var(--text)';
        resultEl.innerHTML = `<div class="duel-result" style="color:${color}">${resultText}</div>`;

        // Update the existing duel doc with result
        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myChoice },
            result: { [user.uid]: myChoice, [partnerUid]: partnerSubmission },
            balanceAdjust: myChoice === partnerSubmission ? 0 : 10,
            favoredUser: favoredUser || null,
            playedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } else {
          await recordDuelResult({
            game: 'rps',
            result: { [user.uid]: myChoice, [partnerUid]: partnerSubmission },
            balanceAdjust: myChoice === partnerSubmission ? 0 : 10,
            favoredUser: favoredUser || null,
            seed, year, week
          });
        }

        // Disable further clicks
        container.querySelectorAll('.rps-choice').forEach((c) => {
          c.style.pointerEvents = 'none';
        });
      } else {
        // First player — save submission and wait
        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myChoice }
          });
        } else {
          // Create a pending duel doc
          await db.collection('duels').add({
            year, week, seed,
            game: 'Rock Paper Scissors',
            submissions: { [user.uid]: myChoice },
            result: null,
            balanceAdjust: 0,
            favoredUser: null,
            playedAt: null
          });
        }

        const resultEl = document.getElementById('rps-result');
        resultEl.innerHTML = `<div class="duel-result">You picked ${CHOICES[myChoice]}. Waiting for ${getUserName(partnerUid) || 'partner'}...</div>`;
        container.querySelectorAll('.rps-choice').forEach((c) => {
          c.style.pointerEvents = 'none';
        });
      }
    });
  });
}
```

- [ ] **Step 2: Verify RPS**

Test by calling directly. Since RPS needs two players, test the first-player flow: pick a choice, confirm a duel doc is created in Firestore with `submissions` containing only your UID. Then test with a second account (or manually add a partner submission in Firestore) to confirm the resolution flow.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/games/rps.js
git commit -m "feat: add Rock Paper Scissors duel game with async two-player submission"
```

---

### Task 12: Lucky Number Game

**Files:**
- Create: `daumis-debt/js/games/lucky-number.js`

- [ ] **Step 1: Create js/games/lucky-number.js**

Same async two-player pattern as RPS.

```js
import { db } from '../firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName } from '../app.js';
import { recordDuelResult, getCurrentWeekInfo, seededRandom } from '../duel.js';

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const partnerUid = getPartnerUid();

  // Generate target number from seed (deterministic, but hidden until both submit)
  const rng = seededRandom(seed * 7 + 31); // offset so it's different from game-selection RNG
  const targetNumber = Math.floor(rng() * 10) + 1;

  // Check for existing duel doc with submissions
  const pendingSnap = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();

  let duelDocRef = null;
  let existingSubmissions = {};

  if (!pendingSnap.empty) {
    const doc = pendingSnap.docs[0];
    const data = doc.data();
    if (data.result) {
      container.innerHTML = `<p>Duel already played this week!</p>`;
      return;
    }
    if (data.submissions) {
      existingSubmissions = data.submissions;
      duelDocRef = doc.ref;
    }
  }

  const mySubmission = existingSubmissions[user.uid];
  const partnerSubmission = existingSubmissions[partnerUid];

  if (mySubmission && !partnerSubmission) {
    container.innerHTML = `
      <p>You picked ${mySubmission}. Waiting for ${getUserName(partnerUid)} to pick...</p>
      <button class="btn btn-primary" id="btn-refresh" style="max-width:200px;margin:0 auto">Refresh</button>`;
    document.getElementById('btn-refresh').addEventListener('click', () => play(container, { year, week, seed }));
    return;
  }

  const showGrid = (disabled = false) => {
    const preamble = partnerSubmission && !mySubmission
      ? `<p>${getUserName(partnerUid)} has picked! Your turn.</p>`
      : `<p>Pick a number 1-10. Closest to the target wins $10!</p>`;

    container.innerHTML = `
      ${preamble}
      <div class="number-grid">
        ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
          `<button class="number-btn" data-num="${n}" ${disabled ? 'disabled' : ''}>${n}</button>`
        ).join('')}
      </div>
      <div id="lucky-result"></div>`;
  };

  showGrid();

  container.querySelectorAll('.number-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const myPick = parseInt(btn.dataset.num);
      container.querySelectorAll('.number-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      container.querySelectorAll('.number-btn').forEach((b) => { b.disabled = true; });

      if (partnerSubmission) {
        // Both have picked — reveal
        const partnerPick = parseInt(partnerSubmission);
        const myDist = Math.abs(myPick - targetNumber);
        const partnerDist = Math.abs(partnerPick - targetNumber);

        // Highlight target
        container.querySelector(`.number-btn[data-num="${targetNumber}"]`).classList.add('target');

        const resultEl = document.getElementById('lucky-result');
        let favoredUser = null;
        let resultText = '';

        if (myDist < partnerDist) {
          favoredUser = user.uid;
          resultText = `Target: ${targetNumber}. You picked ${myPick}, ${getUserName(partnerUid)} picked ${partnerPick}. You win! $10 in your favor!`;
        } else if (partnerDist < myDist) {
          favoredUser = partnerUid;
          resultText = `Target: ${targetNumber}. You picked ${myPick}, ${getUserName(partnerUid)} picked ${partnerPick}. ${getUserName(partnerUid)} wins! $10 to them.`;
        } else {
          resultText = `Target: ${targetNumber}. Both equally close (${myPick} vs ${partnerPick}). No change!`;
        }

        const color = favoredUser === user.uid ? 'var(--green)' : favoredUser ? 'var(--red)' : 'var(--text)';
        resultEl.innerHTML = `<div class="duel-result" style="color:${color}">${resultText}</div>`;

        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myPick },
            result: { target: targetNumber, [user.uid]: myPick, [partnerUid]: partnerPick },
            balanceAdjust: favoredUser ? 10 : 0,
            favoredUser,
            playedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } else {
          await recordDuelResult({
            game: 'lucky-number',
            result: { target: targetNumber, [user.uid]: myPick, [partnerUid]: partnerPick },
            balanceAdjust: favoredUser ? 10 : 0,
            favoredUser,
            seed, year, week
          });
        }
      } else {
        // First player — save and wait
        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myPick }
          });
        } else {
          await db.collection('duels').add({
            year, week, seed,
            game: 'Lucky Number',
            submissions: { [user.uid]: myPick },
            result: null,
            balanceAdjust: 0,
            favoredUser: null,
            playedAt: null
          });
        }
        document.getElementById('lucky-result').innerHTML =
          `<div class="duel-result">You picked ${myPick}. Waiting for ${getUserName(partnerUid)}...</div>`;
      }
    });
  });
}
```

- [ ] **Step 2: Verify Lucky Number**

Test first-player flow in browser. Confirm number grid renders, clicking a number saves submission to Firestore. Test resolution by adding a partner submission manually.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/games/lucky-number.js
git commit -m "feat: add Lucky Number duel game with async two-player submission"
```

---

### Task 13: Scratch Card Game

**Files:**
- Create: `daumis-debt/js/games/scratch-card.js`

- [ ] **Step 1: Create js/games/scratch-card.js**

```js
import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult, seededRandom } from '../duel.js';
import { computeBalance } from '../balance.js';

const VALUES = [-10, -5, 0, 5, 10];

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const balance = await computeBalance();
  const userIsDebtor = balance < 0;

  // Use seed to assign values to both cards (deterministic)
  const rng = seededRandom(seed * 13 + 7);
  const userValue = VALUES[Math.floor(rng() * VALUES.length)];
  const partnerValue = VALUES[Math.floor(rng() * VALUES.length)];
  // Net adjustment from debtor's perspective
  const debtorCard = userIsDebtor ? userValue : partnerValue;
  const creditorCard = userIsDebtor ? partnerValue : userValue;
  // Positive debtorCard = good for debtor, negative = bad
  // Net: debtorCard value is the adjustment from debtor's POV
  const netAdjust = debtorCard;

  container.innerHTML = `
    <p>Scratch your card to reveal the result!</p>
    <p style="color:var(--text-muted);margin-top:4px">Values from debtor's perspective.</p>
    <div class="scratch-card" id="scratch-card">
      <div class="scratch-value" id="scratch-value">
        ${netAdjust >= 0 ? '+' : ''}$${netAdjust}
      </div>
      <canvas id="scratch-canvas" width="200" height="140"></canvas>
    </div>
    <p id="scratch-hint" style="color:var(--text-muted);font-size:0.85rem;margin-top:8px">
      Drag or tap to scratch
    </p>
    <div id="scratch-result"></div>`;

  const canvas = document.getElementById('scratch-canvas');
  const ctx = canvas.getContext('2d');

  // Fill canvas with scratch-off coating
  ctx.fillStyle = '#0f3460';
  ctx.fillRect(0, 0, 200, 140);
  ctx.fillStyle = '#eee';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SCRATCH ME', 100, 75);

  let isScratching = false;
  let scratchedPixels = 0;
  const totalPixels = 200 * 140;
  let revealed = false;

  function scratch(x, y) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, 2 * Math.PI);
    ctx.fill();

    // Check how much has been scratched
    const imageData = ctx.getImageData(0, 0, 200, 140);
    let cleared = 0;
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] === 0) cleared++;
    }
    scratchedPixels = cleared;

    if (scratchedPixels / totalPixels > 0.4 && !revealed) {
      revealed = true;
      revealResult();
    }
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: (touch.clientX - rect.left) * (200 / rect.width),
      y: (touch.clientY - rect.top) * (140 / rect.height)
    };
  }

  canvas.addEventListener('mousedown', (e) => { isScratching = true; const p = getPos(e); scratch(p.x, p.y); });
  canvas.addEventListener('mousemove', (e) => { if (isScratching) { const p = getPos(e); scratch(p.x, p.y); } });
  canvas.addEventListener('mouseup', () => { isScratching = false; });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); isScratching = true; const p = getPos(e); scratch(p.x, p.y); });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (isScratching) { const p = getPos(e); scratch(p.x, p.y); } });
  canvas.addEventListener('touchend', () => { isScratching = false; });

  async function revealResult() {
    // Clear remaining coating
    ctx.clearRect(0, 0, 200, 140);
    document.getElementById('scratch-hint').textContent = '';

    const resultEl = document.getElementById('scratch-result');
    const debtorUid = userIsDebtor ? user.uid : getPartnerUid();
    const creditorUid = userIsDebtor ? getPartnerUid() : user.uid;

    let favoredUser = null;
    if (netAdjust > 0) {
      favoredUser = debtorUid;
      resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">+$${netAdjust} — debt reduced!</div>`;
    } else if (netAdjust < 0) {
      favoredUser = creditorUid;
      resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">-$${Math.abs(netAdjust)} — debt increased!</div>`;
    } else {
      resultEl.innerHTML = `<div class="duel-result">$0 — no change!</div>`;
    }

    await recordDuelResult({
      game: 'scratch-card',
      result: { userCard: userValue, partnerCard: partnerValue, netAdjust },
      balanceAdjust: Math.abs(netAdjust),
      favoredUser,
      seed, year, week
    });
  }
}
```

- [ ] **Step 2: Verify scratch card**

Test in browser. Confirm: card renders with scratch coating, dragging/tapping reveals the value underneath, after ~40% scratched the result auto-reveals and records to Firestore.

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/games/scratch-card.js
git commit -m "feat: add Scratch Card duel game with touch/mouse scratch interaction"
```

---

### Task 14: PWA Icons

**Files:**
- Create: `daumis-debt/assets/icons/icon-192.png`
- Create: `daumis-debt/assets/icons/icon-512.png`

- [ ] **Step 1: Generate simple PWA icons**

Create minimal icons using an inline SVG → PNG approach. We'll generate a simple icon with "DD" initials.

```bash
# Generate a 512x512 SVG icon and convert to PNG using sips (macOS built-in)
cat > /tmp/icon.svg << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1a1a2e"/>
  <text x="256" y="300" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="220" fill="#e94560">DD</text>
</svg>
SVGEOF

# Use rsvg-convert if available, otherwise use python or a web tool
# On macOS with Homebrew: brew install librsvg
# Alternative: open the SVG in a browser, screenshot, and crop

# If rsvg-convert is not available, use python:
python3 -c "
import subprocess, os
# Create a simple 512x512 PNG with PIL if available
try:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new('RGBA', (512, 512), (26, 26, 46, 255))
    draw = ImageDraw.Draw(img)
    # Draw rounded rect background
    draw.rounded_rectangle([0, 0, 512, 512], radius=96, fill=(26, 26, 46, 255))
    # Draw text
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 200)
    except:
        font = ImageFont.load_default()
    draw.text((256, 256), 'DD', fill=(233, 69, 96, 255), font=font, anchor='mm')
    img.save('daumis-debt/assets/icons/icon-512.png')
    img.resize((192, 192), Image.LANCZOS).save('daumis-debt/assets/icons/icon-192.png')
    print('Icons created successfully')
except ImportError:
    print('PIL not available - create icons manually')
    # Create minimal valid 1x1 PNGs as placeholders
    import struct, zlib
    def make_png(w, h, r, g, b):
        def chunk(ctype, data):
            c = ctype + data
            return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        raw = b''
        for _ in range(h):
            raw += b'\x00' + bytes([r,g,b]) * w
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    with open('daumis-debt/assets/icons/icon-512.png','wb') as f: f.write(make_png(512,512,26,26,46))
    with open('daumis-debt/assets/icons/icon-192.png','wb') as f: f.write(make_png(192,192,26,26,46))
    print('Placeholder icons created - replace with proper icons later')
"
```

- [ ] **Step 2: Verify PWA installability**

Serve the app locally, open in Chrome. Check Application → Manifest in DevTools. Confirm: manifest loads, icons are referenced, "Add to Home Screen" criteria are met (manifest + service worker + served over HTTPS — localhost counts for dev).

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/assets/icons/
git commit -m "feat: add PWA icons"
```

---

### Task 15: Firestore Security Rules

**Files:**
- Create: `firestore.rules` (in repo root, for reference — deploy via Firebase Console)

- [ ] **Step 1: Create firestore.rules**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAllowedUser() {
      return request.auth != null &&
             request.auth.token.email in ['REPLACE_WITH_GAL_EMAIL', 'REPLACE_WITH_DAUM_EMAIL'];
    }

    function isOwnEntry() {
      return request.resource.data.addedBy == request.auth.uid;
    }

    match /expenses/{doc} {
      allow read: if isAllowedUser();
      allow create: if isAllowedUser() && isOwnEntry();
      allow update, delete: if isAllowedUser() && resource.data.addedBy == request.auth.uid;
    }

    match /payments/{doc} {
      allow read: if isAllowedUser();
      allow create: if isAllowedUser() && isOwnEntry();
      allow update, delete: if isAllowedUser() && resource.data.addedBy == request.auth.uid;
    }

    match /duels/{doc} {
      allow read: if isAllowedUser();
      allow create: if isAllowedUser();
      allow update: if isAllowedUser();
      allow delete: if false;
    }
  }
}
```

- [ ] **Step 2: Deploy rules**

Replace the placeholder emails with Gal's and Daum's actual Google email addresses. Then deploy:

Option A — Firebase Console: Go to Firestore → Rules → paste the rules → Publish.

Option B — Firebase CLI (if installed):
```bash
npm install -g firebase-tools
firebase login
firebase init firestore  # select existing project
firebase deploy --only firestore:rules
```

- [ ] **Step 3: Verify rules**

Sign in with an authorized email — confirm you can read/write expenses and payments. Sign in with a different Google account (or use incognito) — confirm access is denied.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat: add Firestore security rules restricting access to two users"
```

---

### Task 16: Final Integration + Register Service Worker

**Files:**
- Modify: `daumis-debt/js/app.js` (add service worker registration)

- [ ] **Step 1: Add service worker registration to app.js**

Add at the very end of `js/app.js`:

```js
// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/daumis-debt/sw.js')
    .then(() => console.log('SW registered'))
    .catch((err) => console.error('SW registration failed:', err));
}
```

- [ ] **Step 2: End-to-end manual test**

Full test checklist:
1. Open `https://galraz.github.io/daumis-debt/` (after pushing to GitHub)
2. Sign in with Google — confirm it works
3. Add an expense in THB — confirm USD conversion is correct
4. Add a payment in USD — confirm it appears
5. Check Dashboard — balance reflects expenses and payments correctly
6. Check History — all entries appear in order
7. If a weekly duel is available, play it — confirm game works and result is recorded
8. On mobile: "Add to Home Screen" — confirm PWA installs and opens standalone
9. Sign in on partner's phone — confirm they see the same data
10. Have partner add an expense — confirm it appears on your phone after refresh

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/app.js
git commit -m "feat: register service worker for PWA support"
```

- [ ] **Step 4: Push to GitHub Pages**

```bash
git push origin master
```

Wait ~2 minutes for GitHub Pages to deploy. Open `https://galraz.github.io/daumis-debt/` and run through the test checklist above.
