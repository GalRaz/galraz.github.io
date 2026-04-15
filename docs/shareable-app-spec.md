# Halfsies: Shareable Standalone App Spec

> **Working name: Halfsies** -- a minimal, 2-person expense splitting PWA.
> Other candidates: Halfsies, Duo Ledger, Even Steven, Twowise, Settle Up Lite.

## Goal

Extract the Daumi's Debt expense tracker from `galraz.github.io` into a standalone, open-source repository ("Halfsies") that:

1. Anyone can fork, configure, and deploy for their own use
2. Contains zero sensitive or personal information
3. Stays in sync with changes made in the source repo

---

## 1. What Needs to Move

The standalone repo would contain everything under `daumis-debt/` plus shared dependencies:

| Source Path | Purpose |
|---|---|
| `daumis-debt/index.html` | App shell |
| `daumis-debt/import.html` | Splitwise import tool (currently untracked) |
| `daumis-debt/manifest.json` | PWA manifest |
| `daumis-debt/sw.js` | Service worker |
| `daumis-debt/css/style.css` | Styles |
| `daumis-debt/js/*.js` | All app logic (app, balance, duel, exchange, firebase-config, notifications, recurring) |
| `daumis-debt/js/games/*` | Mini-games (coin-flip, lucky-number, rps, scratch-card, wheel) |
| `daumis-debt/assets/icons/*` | App icons |
| `firestore.rules` | Database security rules |
| `firebase.json` | Firebase hosting config |

**Not included:** Jekyll site (`_config.yml`, `_pages/`, `_posts/`, `_includes/`, etc.), personal files (`files/GalRaz_CV.pdf`), mockups, `.claude/` config.

---

## 2. Sensitive Data to Remove or Externalize

### Critical (must not appear in public repo)

| Item | Current Location | Resolution |
|---|---|---|
| Firebase API key (`AIzaSyCLdsk7GWR9C6juy_6IqBqaMymAhujm9pc`) | `js/firebase-config.js` | Replace with placeholder; load from `config.js` |
| Firebase project ID (`daumis-debt`) | `js/firebase-config.js` | Replace with placeholder |
| All Firebase config fields (authDomain, storageBucket, etc.) | `js/firebase-config.js` | Replace with placeholder |
| EmailJS public key (`aSONqzmG8TcCSKYCh`) | `js/notifications.js` | Replace with placeholder |
| EmailJS service ID (`daumis-debt`) | `js/notifications.js` | Replace with placeholder |
| EmailJS template ID (`template_xc1bk27`) | `js/notifications.js` | Replace with placeholder |
| Authorized emails (`galraz@gmail.com`, `kdaumk@gmail.com`) | `firestore.rules` | Replace with `YOUR_EMAIL_1`, `YOUR_EMAIL_2` |

### Medium (personal branding to generalize)

| Item | Current Location | Resolution |
|---|---|---|
| App name "Daumi's Debt" | `manifest.json`, `index.html`, various JS | Make configurable via `config.js` |
| User names/nicknames ("Gal", "Daum") | `js/app.js`, `js/balance.js` | Make configurable |
| Hardcoded 2-user assumption | Throughout | Document as a design constraint |
| Favicon/icons with personal branding | `assets/icons/` | Replace with new generic Halfsies branding (see Section 8a) |

### Low (acceptable to keep)

| Item | Notes |
|---|---|
| Expense categories and emoji mappings | Generic, useful as defaults |
| Game logic | No personal data |
| Currency/exchange logic | Generic utility |

---

## 3. Configuration System

Create a single `config.example.js` that users copy to `config.js` (gitignored):

```javascript
// config.js - Copy config.example.js to config.js and fill in your values
const APP_CONFIG = {
  // App identity
  appName: "Our Expenses",

  // Two users of the app
  users: {
    user1: { name: "Alice", nickname: "Ali", email: "alice@example.com" },
    user2: { name: "Bob",   nickname: "Bob", email: "bob@example.com" },
  },

  // Firebase (create project at https://console.firebase.google.com)
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },

  // EmailJS (optional - for email notifications)
  // Sign up at https://www.emailjs.com
  emailjs: {
    enabled: false,
    publicKey: "",
    serviceId: "",
    templateId: "",
  },
};
```

All JS files that currently hardcode values would import from `APP_CONFIG` instead.

---

## 4. New Files Needed for the Standalone Repo

| File | Purpose |
|---|---|
| `README.md` | What it is, screenshots, features list |
| `SETUP.md` | Step-by-step: create Firebase project, enable Auth, deploy Firestore rules, configure EmailJS, deploy |
| `config.example.js` | Template configuration (see above) |
| `.gitignore` | Ignore `config.js`, `node_modules/`, `.env*` |
| `LICENSE` | MIT or similar |
| `firestore.rules` | Template rules with placeholder emails |
| `firestore.indexes.json` | Required Firestore indexes (if any) |

---

## 5. Keeping Repos in Sync

### Option A: Git Subtree (recommended)

Use `git subtree` to maintain `daumis-debt/` as a subtree in the source repo that pushes to the standalone repo.

**Setup (one-time):**
```bash
# In galraz.github.io repo
git remote add splitsy-public git@github.com:galraz/splitsy.git

# Push the subtree to the standalone repo
git subtree push --prefix=daumis-debt splitsy-public main
```

**Ongoing sync workflow:**
```bash
# After making changes in galraz.github.io/daumis-debt/
git subtree push --prefix=daumis-debt splitsy-public main
```

**Pros:** Simple, no extra tooling, changes flow naturally.
**Cons:** Root-level files (`firestore.rules`, `firebase.json`) live outside the subtree, so they need manual copying or a small sync script. Sensitive data must be scrubbed before each push (see Transform Script below).

### Option B: GitHub Actions automation

A GitHub Action on the source repo that, on push to `daumis-debt/**`:

1. Checks out the source repo
2. Copies `daumis-debt/` contents to a temp directory
3. Copies root-level shared files (`firestore.rules`, `firebase.json`)
4. Runs the transform script (strips secrets, injects placeholders)
5. Pushes to the standalone repo

```yaml
# .github/workflows/sync-standalone.yml
name: Sync to standalone repo
on:
  push:
    paths:
      - 'daumis-debt/**'
      - 'firestore.rules'
      - 'firebase.json'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Prepare standalone copy
        run: |
          mkdir -p /tmp/standalone
          cp -r daumis-debt/* /tmp/standalone/
          cp firestore.rules /tmp/standalone/
          cp firebase.json /tmp/standalone/
          node scripts/strip-secrets.js /tmp/standalone

      - name: Push to standalone repo
        uses: cpina/github-action-push-to-another-repository@main
        with:
          source-directory: /tmp/standalone
          destination-github-username: galraz
          destination-repository-name: splitsy
          target-branch: main
          user-email: galraz@gmail.com
```

**Pros:** Fully automated, guaranteed no sensitive data leaks (transform script always runs), works with root-level files.
**Cons:** More setup, GitHub Actions minutes, debugging is harder.

### Option C: Syncthing + git hook (leveraging existing setup)

Since Syncthing is already running, sync the `daumis-debt/` directory to a separate local folder that is its own git repo. A file-watcher or post-commit hook triggers the scrub-and-commit in the standalone repo.

**Pros:** Real-time sync, uses existing infrastructure.
**Cons:** Most complex, relies on local machine being on, Syncthing doesn't understand git so conflicts are possible.

### Recommendation

**Option B (GitHub Actions)** is the best fit because:
- Zero chance of accidentally pushing secrets (transform always runs)
- Works without your local machine being on
- Once set up, requires no manual steps
- Handles root-level files cleanly

---

## 6. Transform Script

A Node.js script that sanitizes the codebase for public consumption:

```
scripts/strip-secrets.js
```

What it does:
1. In `js/firebase-config.js`: Replace all Firebase config values with empty strings
2. In `js/notifications.js`: Replace EmailJS keys with empty strings
3. In `firestore.rules`: Replace email addresses with placeholders
4. In `manifest.json`: Replace app name with generic default
5. In `js/app.js` and `js/balance.js`: Replace hardcoded user names with config references
6. Verify: Scan all files for known sensitive patterns (email regex, API key patterns) and fail if any remain

---

## 7. Refactoring Required in Source

To support both personal use AND a clean public version, the source code itself should be refactored to use `config.js`:

| File | Change |
|---|---|
| `js/firebase-config.js` | Import from `APP_CONFIG.firebase` |
| `js/notifications.js` | Import from `APP_CONFIG.emailjs` |
| `js/app.js` | Replace hardcoded names with `APP_CONFIG.users` |
| `js/balance.js` | Replace hardcoded names/nicknames with `APP_CONFIG.users` |
| `js/duel.js` | Replace hardcoded names with `APP_CONFIG.users` |
| `firestore.rules` | Can't use JS config; transform script handles this |
| `index.html` | Load `config.js` before other scripts |

This refactor benefits the source repo too -- centralizes configuration and makes it easier to modify.

---

## 8. Branding

The standalone app keeps the same aesthetic, colors, and UI as Daumi's Debt. Only the name and favicon change.

### What Changes

| Item | Daumi's Debt | Halfsies |
|---|---|---|
| App name in `manifest.json`, `index.html`, UI | "Daumi's Debt" | "Halfsies" |
| Favicon / PWA icons | Current Daumi's icons | New favicon (same sizes: 192x192, 512x512) |
| Everything else (colors, layout, fonts, theme) | -- | Stays the same |

### New Favicon

- One new icon design, exported at standard PWA sizes (192x192, 512x512, plus 32x32 favicon)
- Same style/vibe as the current app, just not the Daumi's-specific icon
- SVG source included so users can swap colors if they want

---

## 8a. In-App Onboarding (Setup Wizard)

Instead of relying solely on docs, the app itself should guide new users through setup. When `config.js` is missing or has empty values, the app shows a setup wizard instead of the main UI.

### Setup Wizard Flow

**Screen 1: Welcome**
- "Welcome to Halfsies -- a shared expense tracker for two."
- "Let's get you set up. You'll need about 10 minutes and a Google account."
- Overview of what's coming: Firebase project, user config, deploy.

**Screen 2: Create Firebase Project**
- Step-by-step with screenshots/illustrations:
  1. Go to Firebase Console (link opens in new tab)
  2. Click "Create a project", name it anything
  3. Disable Google Analytics (not needed)
- "Paste your Firebase project ID here: [__________]"
- Validate: non-empty, reasonable format

**Screen 3: Enable Authentication**
- Instructions:
  1. In Firebase Console -> Authentication -> Sign-in method
  2. Enable Google provider
  3. Add your two Gmail addresses as authorized users
- Input fields for both email addresses
- Explain: "Only these two accounts can sign in. Everyone else is blocked."

**Screen 4: Create Firestore Database**
- Instructions:
  1. Firebase Console -> Firestore Database -> Create database
  2. Start in production mode
  3. Pick a region close to you
- "Copy the Firestore rules from below and paste them in Firebase Console -> Firestore -> Rules"
- Display pre-filled `firestore.rules` with the emails from Screen 3 already substituted
- Copy-to-clipboard button

**Screen 5: Get Firebase Config**
- Instructions:
  1. Firebase Console -> Project Settings -> General
  2. Under "Your apps", click the web icon (</>)
  3. Register the app (name doesn't matter)
  4. Copy the config object
- Paste area that parses the Firebase config JSON/JS snippet automatically
- Validate: all required fields present

**Screen 6: Your Names**
- "What should we call you two?"
- Input: User 1 name, nickname | User 2 name, nickname
- Preview: "When Alice owes Bob $20, you'll see: Ali owes Bob $20"

**Screen 7: Notifications (Optional)**
- "Want email notifications when expenses are added?"
- Toggle: Skip / Set up EmailJS
- If yes: link to EmailJS signup, fields for public key, service ID, template ID
- "You can always set this up later."

**Screen 8: Generate & Deploy**
- The wizard generates `config.js` content based on all inputs
- Two options:
  - **Download `config.js`** -- user places it in the app root manually
  - **Copy to clipboard** -- for pasting into a hosted file
- Checklist summary of what was configured
- "Deploy to any static host: Firebase Hosting, GitHub Pages, Netlify, Vercel, or just open index.html locally."
- Quick deploy commands for each platform:
  ```
  # Firebase Hosting
  firebase init hosting && firebase deploy

  # GitHub Pages
  Just push to a repo named <username>.github.io

  # Netlify / Vercel
  Drag and drop the folder, or connect your repo
  ```

### Implementation Details

| Component | Details |
|---|---|
| `setup.html` | Standalone page, no dependencies on Firebase or config.js |
| `setup.js` | Wizard logic, validation, config generation |
| `setup.css` | Wizard styling (can share base styles with app) |
| Detection | `index.html` checks if `APP_CONFIG` exists and has valid Firebase config; if not, redirects to `setup.html` |
| Output | Generates a `config.js` file and optionally a populated `firestore.rules` |
| No server needed | Everything runs client-side; the wizard just helps you create a config file |

### Progressive Disclosure

The wizard should feel lightweight, not overwhelming:
- Each screen has 1-2 actions max
- "Why do I need this?" expandable sections for curious users
- Progress bar showing steps completed
- Back button to revisit any step
- Skip-able optional sections (EmailJS)

---

## 9. Documentation for the Standalone Repo

### README.md should cover:
- What it is (2-person shared expense tracker PWA)
- Screenshot / demo GIF
- Feature list: expenses, balance tracking, categories, currency exchange, recurring expenses, duels/games, insights, history
- "Deploy your own in 10 minutes" -- link to setup wizard
- Tech stack (Firebase, vanilla JS, PWA)
- License

### SETUP.md should cover:
- Same content as the wizard, in markdown form, for users who prefer docs
- Also serves as reference if the wizard is confusing
1. Fork/clone the repo
2. Create a Firebase project
3. Enable Google Authentication
4. Create Firestore database
5. Copy `config.example.js` to `config.js` and fill in values
6. Update `firestore.rules` with your two email addresses
7. Deploy Firestore rules (`firebase deploy --only firestore:rules`)
8. Host on Firebase Hosting, GitHub Pages, Netlify, or any static host
9. (Optional) Set up EmailJS for notifications

---

## 10. Work Estimate

### Phase 1: Refactor source to use config (prerequisite)
- Create `config.js` / `config.example.js` pattern
- Refactor all files to read from `APP_CONFIG` instead of hardcoded values
- Test that the app still works with the config system

### Phase 2: Build setup wizard
- Create `setup.html`, `setup.js`, `setup.css`
- Implement the 8-screen wizard flow
- Add config detection + redirect in `index.html`
- Test the full wizard flow end-to-end

### Phase 3: Create standalone repo
- Create `galraz/splitsy` public repo
- Write README.md and SETUP.md
- Add LICENSE, generic icons, `.gitignore`
- Copy and sanitize initial codebase

### Phase 4: Set up sync automation
- Write `scripts/strip-secrets.js` transform script
- Create GitHub Actions workflow
- Test end-to-end: change in source -> auto-update in standalone

### Phase 5: Polish
- Add screenshots/GIF to README
- Test the full setup flow from scratch (fresh Firebase project, following only the wizard)
- Verify no sensitive data in standalone repo (automated scan)
- Smoke-test on Firebase Hosting, GitHub Pages, and Netlify

---

## 11. Open Questions

1. **Final name?** Working name is "Halfsies". Alternatives: Halfsies, Duo Ledger, Even Steven, Twowise. Preference?
2. **License?** MIT is standard for this kind of project. Any preference?
3. **Should the 2-user constraint be documented as intentional or flagged as a future enhancement?**
4. **Keep the games/duels feature?** It's fun and unique but adds complexity for new users.
5. **Firebase-only or support other backends?** Current scope is Firebase-only; just want to confirm.
6. **Should import.html (Splitwise importer) be included?** It's a useful data migration tool for users switching from Splitwise.
7. **Wizard hosting:** The setup wizard runs client-side with no backend. Should it also be hostable standalone (e.g., as a GitHub Pages site at `splitsy.github.io/setup`) so people can try the wizard before even cloning?
