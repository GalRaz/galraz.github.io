# EmailJS Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send email notifications via EmailJS to the partner when an expense, payment, or duel result is recorded.

**Architecture:** New `js/notifications.js` module handles all email logic. It saves user profiles to a Firestore `users` collection on login, looks up the partner's email from that collection, and sends templated emails via the EmailJS client SDK. Existing code in `app.js` and `duel.js` calls into it after Firestore writes. All email sends are fire-and-forget.

**Tech Stack:** EmailJS browser SDK (loaded dynamically), Firebase Firestore (existing), ES modules (existing pattern)

**Note:** This project has no test framework. Verification is manual in the browser. Steps focus on implementation and manual verification.

---

### Task 1: Create the notifications module

**Files:**
- Create: `daumis-debt/js/notifications.js`

This is the core module. It exports four functions: `initNotifications`, `saveUserProfile`, `getPartnerEmail`, and `notifyPartner`. It dynamically loads the EmailJS SDK script and uses the Firestore `users` collection for partner lookup.

- [ ] **Step 1: Create `js/notifications.js` with EmailJS SDK loader and init**

```js
import { db } from './firebase-config.js';
import { getCurrentUser, getUserName } from './app.js';
import { computeBalance } from './balance.js';

// EmailJS configuration — fill these in after creating your EmailJS account
const EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';
const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';

const APP_URL = 'https://galraz.github.io/daumis-debt/';

let emailjsReady = false;

/**
 * Dynamically load the EmailJS SDK and initialize it.
 * Called once at app startup after auth.
 */
export async function initNotifications() {
  if (emailjsReady) return;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    emailjs.init(EMAILJS_PUBLIC_KEY);
    emailjsReady = true;
  } catch (err) {
    console.warn('EmailJS failed to load:', err);
  }
}

/**
 * Save or update the current user's profile in the `users` collection.
 * Called on every login to keep email/name current.
 */
export async function saveUserProfile(user) {
  try {
    await db.collection('users').doc(user.uid).set({
      email: user.email,
      displayName: user.displayName || user.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn('Failed to save user profile:', err);
  }
}

/**
 * Look up the partner's email and displayName from the `users` collection.
 * Returns { email, displayName } or null if no partner profile exists.
 */
async function getPartnerEmail() {
  const user = getCurrentUser();
  if (!user) return null;
  try {
    const snapshot = await db.collection('users').get();
    for (const doc of snapshot.docs) {
      if (doc.id !== user.uid) {
        const data = doc.data();
        return { email: data.email, displayName: data.displayName };
      }
    }
    return null;
  } catch (err) {
    console.warn('Failed to get partner email:', err);
    return null;
  }
}

/**
 * Format the balance from the partner's perspective.
 */
async function formatBalanceForPartner() {
  try {
    const balance = await computeBalance();
    const user = getCurrentUser();
    const myName = user.displayName || 'your partner';
    if (balance > 0.005) {
      return `You owe ${myName} $${balance.toFixed(2)}`;
    } else if (balance < -0.005) {
      return `${myName} owes you $${Math.abs(balance).toFixed(2)}`;
    }
    return 'All settled up!';
  } catch {
    return '';
  }
}

/**
 * Build the action and description strings for the email template.
 */
function formatEmailDetails({ type, details }) {
  if (type === 'expense') {
    const action = `added a $${details.amount.toFixed(2)} ${details.currency} expense`;
    const splitLabel = details.splitType === 'even' ? 'split evenly' : 'owed fully';
    const description = `${details.description} — ${splitLabel}`;
    return { action, description };
  }
  if (type === 'payment') {
    const action = `recorded a $${details.amount.toFixed(2)} ${details.currency} payment`;
    return { action, description: 'Settle-up payment' };
  }
  if (type === 'duel') {
    const action = 'completed a duel';
    const adj = details.balanceAdjust.toFixed(2);
    const description = `${details.game} — $${adj} adjustment`;
    return { action, description };
  }
  return { action: 'did something', description: '' };
}

/**
 * Send an email notification to the partner.
 * Fire-and-forget: logs a warning on failure, never blocks or throws.
 *
 * @param {{ type: 'expense'|'payment'|'duel', details: object }} params
 */
export async function notifyPartner({ type, details }) {
  if (!emailjsReady) return;

  const partner = await getPartnerEmail();
  if (!partner) return;

  const user = getCurrentUser();
  const fromName = user.displayName || user.email;
  const { action, description } = formatEmailDetails({ type, details });
  const balance = await formatBalanceForPartner();

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: partner.email,
      to_name: partner.displayName,
      from_name: fromName,
      action,
      description,
      balance,
      app_link: APP_URL
    });
  } catch (err) {
    console.warn('Email notification failed:', err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add daumis-debt/js/notifications.js
git commit -m "feat: add EmailJS notification module"
```

---

### Task 2: Wire up user profile saving and init on login

**Files:**
- Modify: `daumis-debt/js/app.js:18-27` (auth state change handler)
- Modify: `daumis-debt/js/app.js:325-332` (showApp function)

On login, save the user profile to Firestore and initialize EmailJS.

- [ ] **Step 1: Add notification imports and calls to `app.js`**

In the `auth.onAuthStateChanged` callback (line 18), after setting `currentUser` and `userNames`, add the `saveUserProfile` call. In `showApp()` (line 325), add `initNotifications()`.

Add this import at the top of `app.js` (after line 3):

```js
import { initNotifications, saveUserProfile, notifyPartner } from './notifications.js';
```

Replace the `auth.onAuthStateChanged` callback (lines 18-27) with:

```js
auth.onAuthStateChanged((user) => {
  if (user) {
    currentUser = user;
    userNames[user.uid] = user.displayName || user.email;
    saveUserProfile(user);
    showApp();
  } else {
    currentUser = null;
    showScreen('auth');
  }
});
```

Replace the `showApp` function (lines 325-332) with:

```js
async function showApp() {
  showScreen('dashboard');
  await initNotifications();
  const { loadDashboard } = await import('./balance.js');
  await loadDashboard();
  const { processRecurring } = await import('./recurring.js');
  const count = await processRecurring(currentUser);
  if (count > 0) await loadDashboard();
}
```

- [ ] **Step 2: Verify the app still loads**

Open the app in a browser, sign in, and check:
- No console errors
- Dashboard loads normally
- In Firestore console, verify a `users/{uid}` document was created with your email

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/app.js
git commit -m "feat: save user profile and init EmailJS on login"
```

---

### Task 3: Add notification calls after expense and payment saves

**Files:**
- Modify: `daumis-debt/js/app.js:231-286` (form submit handler, inside the expense and payment branches)

Add `notifyPartner()` calls after successful Firestore writes. Only notify for new entries, not edits.

- [ ] **Step 1: Add notification after new expense save**

In the form submit handler, after the `db.collection('expenses').add(...)` call (line 248-260), add a `notifyPartner` call. This goes inside the `else` block (the "not editing" branch), right after the `await db.collection('expenses').add(...)` statement.

After line 260 (`});`), insert:

```js
        notifyPartner({
          type: 'expense',
          details: { description, amount, currency, splitType, usdAmount }
        });
```

- [ ] **Step 2: Add notification after new payment save**

Similarly, after the `db.collection('payments').add(...)` call (line 274-284), inside the `else` block for new payments, add:

After line 284 (`});`), insert:

```js
        notifyPartner({
          type: 'payment',
          details: { amount, currency, usdAmount }
        });
```

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/app.js
git commit -m "feat: notify partner on new expense and payment"
```

---

### Task 4: Add notification after duel result

**Files:**
- Modify: `daumis-debt/js/duel.js:118-131` (recordDuelResult function)

Add a `notifyPartner` call at the end of `recordDuelResult`, after the Firestore write.

- [ ] **Step 1: Import notifyPartner in duel.js**

Add this import at the top of `duel.js` (after line 2):

```js
import { notifyPartner } from './notifications.js';
```

- [ ] **Step 2: Add notification call in recordDuelResult**

Replace the `recordDuelResult` function (lines 118-131) with:

```js
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

  notifyPartner({
    type: 'duel',
    details: { game: GAME_NAMES[game] || game, balanceAdjust: Math.abs(balanceAdjust), favoredUser }
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add daumis-debt/js/duel.js
git commit -m "feat: notify partner on duel result"
```

---

### Task 5: Update service worker

**Files:**
- Modify: `daumis-debt/sw.js:1-21` (cache name and asset list)

Add `notifications.js` to the cache list, remove the three phantom files that don't exist, and bump the cache version so existing installs pick up the change.

- [ ] **Step 1: Update sw.js**

Replace lines 1-21 with:

```js
const CACHE_NAME = 'daumis-debt-v5';
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
```

Also add `emailjs` CDN to the fetch bypass list. Replace the fetch handler (lines 37-46) with:

```js
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('firestore.googleapis.com') ||
      e.request.url.includes('frankfurter.app') ||
      e.request.url.includes('googleapis.com/identitytoolkit') ||
      e.request.url.includes('cdn.jsdelivr.net') ||
      e.request.url.includes('api.emailjs.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add daumis-debt/sw.js
git commit -m "feat: update service worker for notifications, remove phantom files"
```

---

### Task 6: Manual EmailJS setup and end-to-end verification

This task requires manual steps in the browser — not code changes.

- [ ] **Step 1: Create EmailJS account and configure**

1. Go to https://www.emailjs.com and sign up
2. Add a Gmail email service (connect your Google account)
3. Create an email template with these fields:
   - Subject: `Daumi's Debt: {{from_name}} {{action}}`
   - Body:
     ```
     Hi {{to_name}},

     {{from_name}} {{action}}: {{description}}

     {{balance}}

     Open Daumi's Debt → {{app_link}}
     ```
4. Copy the public key, service ID, and template ID

- [ ] **Step 2: Update the placeholder values in `notifications.js`**

Replace the three `YOUR_*` constants at the top of `js/notifications.js` with the real values from step 1:

```js
const EMAILJS_PUBLIC_KEY = '<your-actual-public-key>';
const EMAILJS_SERVICE_ID = '<your-actual-service-id>';
const EMAILJS_TEMPLATE_ID = '<your-actual-template-id>';
```

- [ ] **Step 3: End-to-end test**

1. Open the app, sign in as yourself
2. Add a test expense (e.g. "Test notification" for $1.00 USD)
3. Check that the partner receives an email with the correct details and balance
4. Record a settle-up payment and verify the email
5. If a duel is available, play it and verify the duel email

- [ ] **Step 4: Commit the config values**

```bash
git add daumis-debt/js/notifications.js
git commit -m "feat: add EmailJS credentials"
```
