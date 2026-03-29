# Daumi's Debt — EmailJS Notification System

## Overview

Add email notifications to Daumi's Debt so that when one user adds an expense, records a payment, or completes a duel, the partner receives an email with the event details, current balance, and a link to the app. Uses EmailJS (client-side) to send emails without a server.

## User Profiles in Firestore

New `users` collection. On Google sign-in, upsert a document keyed by UID:

```
users/{uid}: {
  email: string,        // from Firebase Auth profile
  displayName: string,  // from Firebase Auth profile
  updatedAt: timestamp
}
```

The partner is determined by querying the `users` collection for any document whose UID differs from the current user. Since this is a two-person app, there will be at most one result.

## Email Notification Module

New file: `js/notifications.js`

### Exports

- **`initNotifications()`** — Dynamically loads the EmailJS SDK script and calls `emailjs.init(publicKey)`. Called once at app startup after auth.
- **`saveUserProfile(user)`** — Takes a Firebase Auth user object, writes `{ email, displayName, updatedAt }` to `users/{uid}` with `setDoc` (merge). Called on every login to keep email/name current.
- **`getPartnerEmail()`** — Queries the `users` collection, returns the email and displayName of the user whose UID is not the current user. Returns `null` if no partner profile exists yet.
- **`notifyPartner({ type, details })`** — Builds template parameters from the event type and details, calls `emailjs.send()`. Fire-and-forget: logs a warning on failure, never blocks the UI or throws to the caller.

### EmailJS Configuration

Three constants at the top of `notifications.js`:

```js
const EMAILJS_PUBLIC_KEY = '...';  // from EmailJS dashboard
const EMAILJS_SERVICE_ID = '...';  // from EmailJS dashboard
const EMAILJS_TEMPLATE_ID = '...'; // from EmailJS dashboard
```

These are public-safe values (EmailJS is designed for client-side use).

## Email Template

A single EmailJS template handles all three event types via dynamic fields:

| Field | Description | Example |
|-------|-------------|---------|
| `to_email` | Partner's email | daum@gmail.com |
| `to_name` | Partner's display name | Daum |
| `from_name` | Current user's display name | Gal |
| `action` | Human-readable event summary | added a $25.00 USD expense |
| `description` | Event detail line | "Dinner — split evenly" |
| `balance` | Current balance sentence | "You owe Gal $12.50" |
| `app_link` | Link to the app | https://galraz.github.io/daumis-debt/ |

**Subject:** `Daumi's Debt: {{from_name}} {{action}}`

**Body (configured in EmailJS dashboard):**

```
Hi {{to_name}},

{{from_name}} {{action}}: {{description}}

{{balance}}

Open Daumi's Debt → {{app_link}}
```

## Trigger Points

### 1. Expense Added (`app.js` — expense form submit handler)

After the Firestore write succeeds, call:

```js
notifyPartner({
  type: 'expense',
  details: { description, amount, currency, splitType, usdAmount }
});
```

Formats as: "added a $25.00 USD expense" / "Dinner — split evenly"

### 2. Payment Recorded (`app.js` — payment form submit handler)

After the Firestore write succeeds, call:

```js
notifyPartner({
  type: 'payment',
  details: { amount, currency, usdAmount }
});
```

Formats as: "recorded a $50.00 USD payment" / "Settle-up payment"

### 3. Duel Completed (`duel.js` — after result is saved)

After the duel result is written to Firestore, call:

```js
notifyPartner({
  type: 'duel',
  details: { game, balanceAdjust, favoredUser }
});
```

Formats as: "completed a duel" / "Wheel of Fortune — $10.00 forgiven"

## Balance in Email

Each notification includes the current balance. The existing `computeBalance()` function in `balance.js` returns the net USD balance. The notification module calls this and formats it from the partner's perspective:

- Positive (partner owes current user): "You owe {currentUser} ${amount}"
- Negative (current user owes partner): "{currentUser} owes you ${amount}"
- Zero: "All settled up!"

## Service Worker Updates

In `sw.js`:

- **Add** `/daumis-debt/js/notifications.js` to the cached assets list
- **Remove** three phantom files that don't exist: `expenses.js`, `payments.js`, `history.js`

## Error Handling

- Email sending is fire-and-forget. On failure, `console.warn()` with the error. No user-facing error, no retry.
- If the partner hasn't signed in yet (no profile in `users` collection), `getPartnerEmail()` returns `null` and `notifyPartner()` silently skips sending.
- If EmailJS SDK fails to load (network issue), `notifyPartner()` silently skips.

## Manual Setup Required

These steps must be done manually in the EmailJS dashboard before the integration works:

1. Create a free EmailJS account at https://www.emailjs.com
2. Add an email service (Gmail recommended)
3. Create an email template matching the fields above
4. Copy the public key, service ID, and template ID into `js/notifications.js`

## Files Changed

| File | Change |
|------|--------|
| `js/notifications.js` | **New** — EmailJS integration module |
| `js/app.js` | Import notifications, call `initNotifications()` + `saveUserProfile()` on login, call `notifyPartner()` after expense/payment saves |
| `js/duel.js` | Import and call `notifyPartner()` after duel result save |
| `index.html` | Add `<script>` for notifications.js (or rely on ES module import) |
| `sw.js` | Update cached asset list |
