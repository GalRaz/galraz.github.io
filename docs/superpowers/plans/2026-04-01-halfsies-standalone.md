# Halfsies Standalone App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a standalone, open-source version of the Daumi's Debt expense tracker at `/Users/galraz/Developer/halfsies/`, stripped of all personal data, with a setup wizard for new users, and push to `github.com/GalRaz/halfsies`.

**Architecture:** Copy the `daumis-debt/` directory and root Firebase files into a new repo. Replace all hardcoded secrets/names with a centralized `config.js` system. Add an in-app setup wizard that generates `config.js` for new users. Rename everything from "Daumi's Debt" to "Halfsies".

**Tech Stack:** Vanilla JS, Firebase (Firestore + Auth), EmailJS, PWA (service worker), no build step.

---

## File Structure

```
/Users/galraz/Developer/halfsies/
├── index.html              (copied from daumis-debt, modified)
├── setup.html              (NEW — setup wizard)
├── manifest.json           (copied, renamed app)
├── sw.js                   (copied, renamed cache)
├── config.example.js       (NEW — template config)
├── firestore.rules         (copied from repo root, emails replaced)
├── firebase.json           (copied from repo root)
├── LICENSE                 (NEW — MIT)
├── README.md               (NEW)
├── SETUP.md                (NEW)
├── .gitignore              (NEW)
├── css/
│   ├── style.css           (copied as-is)
│   └── setup.css           (NEW — wizard styles)
├── js/
│   ├── app.js              (copied, refactored to use APP_CONFIG)
│   ├── firebase-config.js  (rewritten to use APP_CONFIG)
│   ├── notifications.js    (rewritten to use APP_CONFIG)
│   ├── balance.js          (copied as-is — names come from Firestore, not hardcoded)
│   ├── exchange.js          (copied as-is)
│   ├── recurring.js         (copied as-is)
│   ├── duel.js              (copied as-is)
│   ├── setup.js             (NEW — wizard logic)
│   └── games/
│       ├── coin-flip.js     (copied as-is)
│       ├── lucky-number.js  (copied as-is)
│       ├── scratch-card.js  (copied as-is)
│       ├── rps.js           (copied as-is)
│       └── wheel.js         (copied as-is)
└── assets/
    └── icons/
        ├── icon.svg         (NEW — Halfsies icon source)
        ├── icon.png         (NEW — generated from SVG)
        ├── icon-192.png     (NEW — generated from SVG)
        └── icon-512.png     (NEW — generated from SVG)
```

---

### Task 1: Scaffold Directory and Copy Files

**Files:**
- Create: `/Users/galraz/Developer/halfsies/` (entire tree)

- [ ] **Step 1: Create directory and copy all source files**

```bash
mkdir -p /Users/galraz/Developer/halfsies/{css,js/games,assets/icons}

# Copy app files
cp /Users/galraz/Developer/galraz.github.io/daumis-debt/index.html /Users/galraz/Developer/halfsies/
cp /Users/galraz/Developer/galraz.github.io/daumis-debt/manifest.json /Users/galraz/Developer/halfsies/
cp /Users/galraz/Developer/galraz.github.io/daumis-debt/sw.js /Users/galraz/Developer/halfsies/
cp /Users/galraz/Developer/galraz.github.io/daumis-debt/css/style.css /Users/galraz/Developer/halfsies/css/
cp /Users/galraz/Developer/galraz.github.io/daumis-debt/js/*.js /Users/galraz/Developer/halfsies/js/
cp /Users/galraz/Developer/galraz.github.io/daumis-debt/js/games/*.js /Users/galraz/Developer/halfsies/js/games/

# Copy root-level Firebase files
cp /Users/galraz/Developer/galraz.github.io/firestore.rules /Users/galraz/Developer/halfsies/
cp /Users/galraz/Developer/galraz.github.io/firebase.json /Users/galraz/Developer/halfsies/
```

- [ ] **Step 2: Init git repo**

```bash
cd /Users/galraz/Developer/halfsies
git init
git remote add origin git@github.com:GalRaz/halfsies.git
```

- [ ] **Step 3: Create .gitignore**

Write `/Users/galraz/Developer/halfsies/.gitignore`:
```
config.js
node_modules/
.env*
.DS_Store
_site/
```

- [ ] **Step 4: Commit scaffold**

```bash
git add -A
git commit -m "chore: scaffold from daumis-debt source"
```

---

### Task 2: Create Config System

**Files:**
- Create: `config.example.js`
- Modify: `js/firebase-config.js`
- Modify: `js/notifications.js`
- Modify: `index.html`

- [ ] **Step 1: Create config.example.js**

Write `/Users/galraz/Developer/halfsies/config.example.js`:
```javascript
// Halfsies Configuration
// Copy this file to config.js and fill in your values.
// See SETUP.md or run setup.html for a guided walkthrough.

const APP_CONFIG = {
  // App name (shown in header and browser tab)
  appName: "Halfsies",

  // Firebase — create a project at https://console.firebase.google.com
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },

  // EmailJS — optional email notifications
  // Sign up at https://www.emailjs.com
  emailjs: {
    enabled: false,
    publicKey: "",
    serviceId: "",
    templateId: "",
  },

  // App URL — used in notification emails
  appUrl: "",
};
```

- [ ] **Step 2: Rewrite firebase-config.js to use APP_CONFIG**

Replace the entire contents of `/Users/galraz/Developer/halfsies/js/firebase-config.js` with:
```javascript
// Firebase initialization — reads from APP_CONFIG (config.js)

if (typeof APP_CONFIG === 'undefined' || !APP_CONFIG.firebase.apiKey) {
  // Redirect to setup wizard if config is missing
  if (!window.location.pathname.endsWith('setup.html')) {
    window.location.href = 'setup.html';
  }
} else {
  firebase.initializeApp(APP_CONFIG.firebase);
}

const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
```

- [ ] **Step 3: Rewrite notifications.js to use APP_CONFIG**

Replace the hardcoded constants at the top of `/Users/galraz/Developer/halfsies/js/notifications.js`. The four constants become:
```javascript
const EMAILJS_PUBLIC_KEY = APP_CONFIG.emailjs.publicKey;
const EMAILJS_SERVICE_ID = APP_CONFIG.emailjs.serviceId;
const EMAILJS_TEMPLATE_ID = APP_CONFIG.emailjs.templateId;
const APP_URL = APP_CONFIG.appUrl || window.location.origin + window.location.pathname;
```

And wrap the `initEmailJS()` function body to check `APP_CONFIG.emailjs.enabled` first — if false, return early without loading the SDK.

- [ ] **Step 4: Add config.js script tag to index.html**

In `/Users/galraz/Developer/halfsies/index.html`, add before the Firebase SDK scripts:
```html
<script src="config.js"></script>
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add config system, externalize all secrets"
```

---

### Task 3: Rename Daumi's Debt → Halfsies

**Files:**
- Modify: `index.html`
- Modify: `manifest.json`
- Modify: `sw.js`
- Modify: `js/app.js`

- [ ] **Step 1: Update index.html**

In `/Users/galraz/Developer/halfsies/index.html`:
- `<title>Daumi's Debt</title>` → `<title>Halfsies</title>`
- All visible text "Daumi's Debt" → "Halfsies"

- [ ] **Step 2: Update manifest.json**

```json
{
  "name": "Halfsies",
  "short_name": "Halfsies",
  ...
}
```

- [ ] **Step 3: Update sw.js cache name**

```javascript
const CACHE_NAME = 'halfsies-v1';
```

- [ ] **Step 4: Update localStorage key prefixes in app.js**

Replace all `daumis-debt-` prefixes with `halfsies-` in localStorage keys:
- `daumis-debt-balance-view` → `halfsies-balance-view`
- `daumis-debt-consol-currency` → `halfsies-consol-currency`
- `daumis-debt-used-currencies` → `halfsies-used-currencies`
- `daumis-debt-currency-balances` → `halfsies-currency-balances`
- `daumis-debt-last-currency` → `halfsies-last-currency`
- `daumis-debt-rates` (in exchange.js) → `halfsies-rates`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rename Daumi's Debt to Halfsies"
```

---

### Task 4: Sanitize Firestore Rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Replace emails with placeholders**

In `/Users/galraz/Developer/halfsies/firestore.rules`, replace:
- `'galraz@gmail.com'` → `'YOUR_EMAIL_1@example.com'`
- `'kdaumk@gmail.com'` → `'YOUR_EMAIL_2@example.com'`

Add a comment at the top:
```
// Replace YOUR_EMAIL_1 and YOUR_EMAIL_2 with the Gmail addresses
// of the two users who will share this app.
```

- [ ] **Step 2: Commit**

```bash
git add firestore.rules
git commit -m "feat: template firestore rules with placeholder emails"
```

---

### Task 5: Create New Favicon

**Files:**
- Create: `assets/icons/icon.svg`
- Create: `assets/icons/icon.png`, `icon-192.png`, `icon-512.png`

- [ ] **Step 1: Create SVG icon**

Create `/Users/galraz/Developer/halfsies/assets/icons/icon.svg` — a simple split-circle design:
- A circle divided in half vertically
- Left half one color, right half another
- Clean, flat design that works at small sizes
- Colors that complement the existing app aesthetic

- [ ] **Step 2: Generate PNG exports**

Use `sips` (macOS built-in) or `rsvg-convert` to create:
- `icon.png` — 32x32
- `icon-192.png` — 192x192
- `icon-512.png` — 512x512

- [ ] **Step 3: Commit**

```bash
git add assets/icons/
git commit -m "feat: add Halfsies favicon and PWA icons"
```

---

### Task 6: Build Setup Wizard

**Files:**
- Create: `setup.html`
- Create: `js/setup.js`
- Create: `css/setup.css`

- [ ] **Step 1: Create setup.html**

A standalone HTML page with the same viewport/meta as index.html. Loads `css/setup.css` and `js/setup.js`. No Firebase or config.js dependency. Contains 8 wizard screens as `<section>` elements, shown/hidden via JS:

1. Welcome — intro text, "Get Started" button
2. Firebase Project — instructions + project ID input
3. Authentication — instructions + two email inputs
4. Firestore — instructions + generated rules with copy button
5. Firebase Config — paste area that auto-parses the config snippet
6. Names — two name/nickname input pairs with preview
7. Notifications — optional EmailJS toggle + fields
8. Generate — shows generated config.js, download/copy buttons, deploy instructions

Progress bar at top. Back/Next navigation at bottom.

- [ ] **Step 2: Create css/setup.css**

Styles for the wizard: same font/color scheme as main app (`style.css`), card-based step layout, progress bar, input styling, copy-button, code block styling.

- [ ] **Step 3: Create js/setup.js**

Wizard logic:
- `currentStep` state, `nextStep()`/`prevStep()` navigation
- Per-step validation (non-empty required fields, email format, Firebase config parsing)
- `parseFirebaseConfig(text)` — extracts config values from pasted Firebase snippet (handles both JS object and JSON formats)
- `generateConfig()` — builds the `config.js` file content from all collected inputs
- `generateFirestoreRules()` — builds rules with emails substituted
- `downloadFile(name, content)` — triggers browser file download
- `copyToClipboard(text)` — copies to clipboard with visual feedback

- [ ] **Step 4: Commit**

```bash
git add setup.html js/setup.js css/setup.css
git commit -m "feat: add setup wizard for guided onboarding"
```

---

### Task 7: Create Documentation

**Files:**
- Create: `README.md`
- Create: `SETUP.md`
- Create: `LICENSE`

- [ ] **Step 1: Create README.md**

Content:
- "Halfsies" heading + one-line description
- Feature list (expenses, balance, categories, currency exchange, recurring, duels/games, insights, history, PWA)
- "Deploy Your Own" section pointing to setup wizard and SETUP.md
- Tech stack
- MIT license badge

- [ ] **Step 2: Create SETUP.md**

Detailed markdown version of the wizard flow:
1. Clone/fork repo
2. Create Firebase project (with console links)
3. Enable Google Auth
4. Create Firestore database + deploy rules
5. Get Firebase config + create config.js
6. Set user names
7. (Optional) EmailJS setup
8. Deploy options (Firebase Hosting, GitHub Pages, Netlify, Vercel)

- [ ] **Step 3: Create LICENSE**

MIT license with copyright "2026 Halfsies Contributors".

- [ ] **Step 4: Commit**

```bash
git add README.md SETUP.md LICENSE
git commit -m "docs: add README, setup guide, and MIT license"
```

---

### Task 8: Final Audit and Push

- [ ] **Step 1: Scan for leftover sensitive data**

Search all files for:
- `galraz` (email, GitHub username)
- `kdaumk` (partner email)
- `AIzaSy` (Firebase API key prefix)
- `aSONqz` (EmailJS key)
- `daumis-debt` (old project name in functional contexts — localStorage, cache, Firebase project references)
- `632130` (messaging sender ID)

Fix any hits.

- [ ] **Step 2: Scan for leftover personal data in import.html**

The source import.html contains embedded Splitwise CSV data with personal transactions. This file should NOT be copied to the standalone repo (it was listed in the spec but the embedded CSV data is personal). If it was copied, delete it.

- [ ] **Step 3: Verify the app loads without config.js**

Open `index.html` in a browser. It should redirect to `setup.html` (because `APP_CONFIG` is undefined).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: final audit, remove leftover sensitive data"
```

- [ ] **Step 5: Push to GitHub**

```bash
git push -u origin main
```
