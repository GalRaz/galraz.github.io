# CLAUDE.md — Firebase PWA (Draft Template)

> Copy this to `CLAUDE.md` at the root of a new project and fill in the bracketed placeholders.

---

## Project Overview

**[App name]** — [one sentence description].

Deployed at: `[GitHub Pages URL]`
Firebase project: `[project-id]`
Repo: `[github.com/user/repo]`

---

## Tech Stack

- **Vanilla JS with ES modules** — no build step, no bundler. Files are served directly. Use `import`/`export` throughout.
- **Firebase** — Firestore (database) + Google Auth (authentication). Loaded via CDN compat scripts, available as globals (`firebase`, `firebase.firestore()`, `firebase.auth()`).
- **GitHub Pages** — static hosting. `index.html` at repo root or in a subfolder. No server-side rendering.
- **Service worker** — `sw.js` at the root of the served path (not the repo root if deploying from a subfolder). Cache strategy: network-first for HTML/JS, cache-first for static assets.
- **EmailJS** — transactional notifications. Credentials stored in `config.js` (gitignored).
- **Exchange rates** — `frankfurter.app` (primary), `open.er-api.com` (fallback). Rates cached in `localStorage` with a 24h TTL.

---

## Repository Layout

```
/
├── index.html
├── sw.js                    # Service worker — must be at served root
├── manifest.json
├── config.js                # Gitignored — contains Firebase + EmailJS credentials
├── config.example.js        # Committed — safe placeholder values, documents all keys
├── js/
│   ├── app.js               # Main entry — auth, routing, top-level state
│   ├── firebase-config.js   # Reads from config.js; redirects to setup if missing
│   ├── balance.js           # Balance calculations and history rendering
│   ├── exchange.js          # Exchange rate fetching and caching
│   ├── notifications.js     # EmailJS wrapper
│   └── [feature].js         # One file per major feature
├── css/
│   └── style.css
├── firestore.rules          # Committed — use placeholder emails, not real ones
└── docs/
```

---

## Config System

`config.js` is **gitignored**. It exports a single `APP_CONFIG` object:

```js
// config.js — DO NOT COMMIT
window.APP_CONFIG = {
  firebase: {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    // etc.
  },
  emailjs: {
    publicKey: "...",
    serviceId: "...",
    templateId: "..."
  },
  appUrl: "https://[your-pages-url]/"
};
```

`firebase-config.js` checks for `window.APP_CONFIG` and redirects to `setup.html` if absent. Never hardcode credentials in committed files.

When creating a public/shareable version of the project, replace all credentials with `YOUR_VALUE_HERE` placeholders and squash history before the first public commit.

---

## Firebase Patterns

### Auth

```js
firebase.auth().onAuthStateChanged(user => {
  if (!user) { showLoginScreen(); return; }
  // user is signed in
});
```

Google sign-in only — no email/password. Partner linking is done by sharing a `partnerId` stored in a Firestore `settings` document.

### Firestore document conventions

- **Timestamps** — always use `firebase.firestore.FieldValue.serverTimestamp()` for `createdAt`. For user-visible dates, store as a Firestore Timestamp (not a string) so `.toDate()` works.
- **Reading dates from Firestore:**
  ```js
  const date = d.date?.toDate ? d.date.toDate()
    : d.date?.seconds ? new Date(d.date.seconds * 1000)
    : new Date(d.date);
  ```
  Use this pattern everywhere — Firestore Timestamps, plain objects with `.seconds`, and ISO strings all appear depending on context.
- **Currency amounts** — store both raw `amount + currency` and a converted `usdAmount + exchangeRate`. This lets you display in any currency later without re-fetching rates.
- **Soft deletes** — prefer `active: false` over actual deletion. Makes recovery and audit easier.

### Firestore rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email in [
          'YOUR_EMAIL_1@example.com',
          'YOUR_EMAIL_2@example.com'
        ];
    }
  }
}
```

Replace placeholder emails before deploying. Never commit real email addresses to a public repo.

---

## Service Worker

The SW must live at the **root of the served path**. If deploying from a GitHub Pages subfolder (e.g. `/myapp/`), the SW goes in that folder, not the repo root.

Register with:
```js
navigator.serviceWorker.register('./sw.js');
```
(relative path, not absolute).

Cache strategy:
- Network-first for `index.html` and all `.js` files — ensures users get updates.
- Cache-first for icons, fonts, and other static assets.
- Always include `manifest.json`, `icon.png`, and `favicon.ico` in the SW cache — these are needed for PWA install and offline display.

When making SW changes, bump the cache version constant at the top of `sw.js` to force cache invalidation.

---

## localStorage Key Conventions

Prefix all keys with the app name slug to avoid collisions:

```
[appname]-consol-currency     # user's display/consolidation currency
[appname]-balance-view        # e.g. 'simple' | 'breakdown'
[appname]-last-currency       # last currency used in a form
[appname]-used-currencies     # JSON array of currencies the user has used
[appname]-exchange-cache      # JSON: { rates: {...}, timestamp: ms }
```

---

## Exchange Rate Handling

`exchange.js` exports:
- `getExchangeRate(currency)` — returns rate from `currency` → USD (multiply by this to get USD).
- `convertToUSD(amount, currency)` — returns `{ usdAmount, exchangeRate }`.

To display amounts in the consolidation currency instead of USD:
```js
const consolCurrency = localStorage.getItem('[appname]-consol-currency') || 'USD';
let usdToConsol = 1;
if (consolCurrency !== 'USD') {
  const { getExchangeRate } = await import('./exchange.js');
  const rate = await getExchangeRate(consolCurrency);
  usdToConsol = rate ? 1 / rate : 1;
}
```

Rates are fetched from `frankfurter.app` first, `open.er-api.com` as fallback, cached in localStorage for 24h.

---

## Recurring Expenses

When advancing a monthly recurring charge:

```js
// Always store originalDay when creating the recurring rule
originalDay: base.getDate()

// When advancing:
const originalDay = r.originalDay || nextDue.getDate();
next.setDate(1);                                         // prevent day overflow
next.setMonth(next.getMonth() + 1);
const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
next.setDate(Math.min(originalDay, daysInMonth));        // clamp to last day of month
next.setHours(0, 0, 0, 0);                              // fire at midnight local time
```

This handles the May 31 → June 30 → July 31 edge case correctly.

---

## Data Export (CSV)

When exporting history, merge all collections (expenses, payments, etc.) into one array sorted by date before writing CSV rows:

```js
const rows = [];
// push { ts: Date, line: string } for each entry
rows.sort((a, b) => b.ts - a.ts);  // newest first, matching history view order
rows.forEach(r => { csv += r.line; });
```

Parse Firestore timestamps defensively (same pattern as above).

---

## Insights / Analytics

- Aggregate amounts in USD (using stored `usdAmount`), then convert to the user's consolidation currency at display time.
- Do not store pre-converted amounts — store USD + rate, convert on the fly.
- Category classification is done client-side with a keyword list. Keep the list in a single array of `{ keywords, icon, label }` objects. Order matters — first match wins.

---

## Testing with Chrome MCP

When an agent is testing the live app via Chrome MCP (`mcp__claude-in-chrome__*`):

### Useful helper snippet (paste into console at session start)

```js
// Get session state
const user = firebase.auth().currentUser;
const now = new Date();
const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const dayNum = d.getUTCDay() || 7;
d.setUTCDate(d.getUTCDate() + 4 - dayNum);
const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
console.log({ uid: user?.uid, email: user?.email, week, seed: now.getFullYear() * 100 + week });
```

### Overriding Math.random for deterministic tests

The game uses `Math.random()` in two places per action (result + animation):

```js
let _c = 0;
Math.random = () => { _c++; return _c === 1 ? TARGET_VALUE : 0.5; };
// ... trigger action ...
delete Math.random; // restore
```

### Simulating a second user

Google OAuth prevents two simultaneous sessions in one browser. Simulate the partner's moves by writing directly to Firestore:

```js
await firebase.firestore().collection('duels').add({
  year: YEAR, week: WEEK,
  submissions: { [PARTNER_UID]: 'rock' },
  result: null, favoredUser: null, balanceAdjust: 0, playedAt: null
});
```

### Triggering canvas-based interactions

For scratch cards and canvas games, dispatch synthetic events rather than trying to physically drag:

```js
const canvas = document.getElementById('scratch-canvas');
const ctx = canvas.getContext('2d');
ctx.globalCompositeOperation = 'destination-out';
ctx.fillStyle = 'rgba(0,0,0,1)';
ctx.fillRect(0, 0, canvas.width, canvas.height);
canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
  clientX: canvas.getBoundingClientRect().left + 100,
  clientY: canvas.getBoundingClientRect().top + 70
}));
```

---

## Gotchas Learned

| Area | Gotcha |
|---|---|
| Service worker scope | SW must be in the subfolder if deploying to a Pages subfolder. A SW at repo root won't control `/myapp/` pages. |
| Firestore date parsing | Firestore can return a Timestamp object, a plain `{seconds, nanoseconds}` object, or a string depending on context. Always use the three-way parse pattern above. |
| `Math.random` in games | If a game uses `Math.random()` more than once per action (e.g. result + animation), a simple `() => X` override breaks the animation. Use a call counter. |
| Monthly recurrence | `setMonth(m + 1)` on a date with `getDate() > 28` silently overflows into the next month. Always set date to 1, advance month, then set date. |
| CSV sort | Firestore snapshot order is not guaranteed. Always collect rows into an array and sort by timestamp before writing CSV. |
| Scratch card value in DOM | The revealed value is in the HTML before scratching — only hidden by canvas. If CSS z-index breaks, the result is visible immediately. |
| RPS / multiplayer notifications | The second player to resolve uses `duelDocRef.update()` directly, bypassing any notification call. If you want notifications on resolution, call them explicitly after the update. |
| First player UX gap | In two-player async games (RPS, Lucky Number), the first player only sees "already played" after the second player resolves. They never see the outcome. Consider storing result text for both players. |
| Secrets in git history | When creating a public fork from a private repo, check `git log -p` for any commit that ever contained real API keys. Squash all commits before the initial push: `git reset --soft $(git rev-list --max-parents=0 HEAD) && git commit --amend`. |
| ISO week vs calendar year | ISO week 1 of a new year can start in December of the prior year. If you use `year * 100 + week` as a seed, the calendar year and ISO week year may diverge in late December. Use `d.getUTCFullYear()` after the ISO week calculation, not `now.getFullYear()`. |
| Firestore rules with real emails | Never commit real email addresses to a public repo's `firestore.rules`. Use `YOUR_EMAIL@example.com` placeholders. |
| SW registration path | Use `./sw.js` (relative) not `/sw.js` (absolute) when registering, if the app is served from a subfolder. |
| `getPartnerUid()` null fallback | Several game files fall back to the string `'partner'` when `getPartnerUid()` returns null. This stores `'partner'` as a real UID in Firestore. Add a guard before writing. |

---

## Agent Workflow Notes

- Use subagents (via `Agent` tool) for independent parallel tasks: scaffolding, file edits in different areas, pushing to multiple repos.
- When two repos need to stay in sync (e.g. a public fork of a private repo), apply changes to both in the same session using parallel agent dispatches.
- For browser testing, load Chrome MCP tools via `ToolSearch` before calling them (`select:mcp__claude-in-chrome__<tool_name>`).
- Do not push automatically — push only when explicitly asked.
- When a pre-commit hook fails, fix the issue and create a **new** commit rather than amending.

---

## Deployment Checklist

Before pushing to production:

- [ ] `config.js` is in `.gitignore` and not staged
- [ ] `firestore.rules` uses placeholder emails (if public repo)
- [ ] SW cache version bumped if SW changed
- [ ] `manifest.json` start_url and scope match the actual served path
- [ ] Exchange rate fallback tested (block `frankfurter.app` in devtools → confirm `open.er-api.com` is used)
- [ ] App works offline (disconnect network after first load)
- [ ] CSV export order matches history view (newest first)
- [ ] Recurring charges normalized to midnight local time
