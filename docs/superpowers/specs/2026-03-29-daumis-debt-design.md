# Daumi's Debt — Design Spec

A private couples expense tracker PWA hosted on GitHub Pages, backed by Firebase. Two users split expenses across five currencies, settle in USD with live exchange rates, and play a weekly mini-game that adjusts the balance.

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS single-page app served from `/daumis-debt/` on `galraz.github.io`
- **PWA:** Web manifest + service worker for home screen install on iOS/Android
- **Auth:** Firebase Auth with Google Sign-In, restricted to two whitelisted email addresses
- **Database:** Firebase Firestore (free tier)
- **Exchange Rates:** frankfurter.app — free, no API key, ECB-sourced data
- **No build step:** Static files deployed via `git push` to the existing GitHub Pages repo

## Users

Exactly two users: Gal and Daum. Both can add expenses, record payments, and play the weekly duel. Access is restricted via Firestore security rules to their two Google email addresses.

## Currencies

- Supported: THB, BTN, JPY, USD, EUR
- All balances displayed in USD
- Exchange rates fetched live from frankfurter.app at the time an expense is added
- The rate at time of entry is stored with the expense (so historical entries don't shift when rates change)

## Data Model (Firestore)

### `expenses` collection

| Field        | Type      | Description                                      |
|-------------|-----------|--------------------------------------------------|
| description | string    | What the expense was for                         |
| amount      | number    | Amount in original currency                      |
| currency    | string    | One of: THB, BTN, JPY, USD, EUR                 |
| usdAmount   | number    | Amount converted to USD at time of entry         |
| exchangeRate| number    | Rate used for conversion (currency → USD)        |
| paidBy      | string    | UID of the person who paid                       |
| splitType   | string    | "even" (50/50) or "full" (other person owes all) |
| owedBy      | string    | UID of the person who owes (for "full" splits)   |
| date        | timestamp | When the expense occurred                        |
| addedBy     | string    | UID of the person who added this entry           |
| createdAt   | timestamp | Server timestamp                                 |

For "even" splits, each expense contributes `usdAmount / 2` to the balance. For "full" splits, the full `usdAmount` is owed by `owedBy` to `paidBy`.

### `payments` collection

| Field     | Type      | Description                              |
|----------|-----------|------------------------------------------|
| amount   | number    | Amount in original currency              |
| currency | string    | One of: THB, BTN, JPY, USD, EUR          |
| usdAmount| number    | Amount converted to USD at time of entry |
| exchangeRate | number | Rate used for conversion               |
| paidBy   | string    | UID of the person who paid               |
| paidTo   | string    | UID of the person who received           |
| date     | timestamp | When the payment was made                |
| addedBy  | string    | UID of the person who added this entry   |
| createdAt| timestamp | Server timestamp                         |

### `duels` collection

| Field          | Type      | Description                                  |
|---------------|-----------|----------------------------------------------|
| year          | number    | Year                                         |
| week          | number    | ISO week number                              |
| game          | string    | Which game was played                        |
| result        | object    | Game-specific result data                    |
| balanceAdjust | number    | USD amount added/subtracted from balance     |
| favoredUser   | string    | UID of the user whose balance improved       |
| playedAt      | timestamp | When the duel was played                     |
| seed          | number    | Deterministic seed from year + week          |
| submissions   | object    | Per-user inputs for interactive games (RPS choice, Lucky Number pick). Keys are UIDs, values are the player's input. Null for single-action games. Result is revealed/computed only when both submissions exist. |

### Balance Computation

No precomputed balance. The client computes the net balance by:

1. Summing all expenses (each contributes to one user's debt based on split type)
2. Subtracting all payments
3. Adding/subtracting all duel adjustments

This is simple and correct for a two-person ledger.

## Screens

### 1. Dashboard

- Large balance display: "You owe [name] $X" or "[name] owes you $X" in USD
- Weekly Duel banner if a duel is available and hasn't been played this week
- Recent activity feed (last 5-10 entries: expenses, payments, duel results)
- Bottom navigation: Dashboard | Add | History

### 2. Add Expense

- Description (text input)
- Amount (number input)
- Currency picker (THB / BTN / JPY / USD / EUR) — default to last-used currency
- Who paid (toggle between the two users)
- Split type (toggle: "Split evenly" / "Owed fully")
- Date (defaults to today, editable)
- Save button — fetches live exchange rate, computes USD amount, writes to Firestore

### 3. Add Payment

- Amount (number input)
- Currency picker
- Who paid whom (toggle direction)
- Date (defaults to today)
- Save button — same exchange rate flow as expenses

### 4. History

- Chronological list of all expenses, payments, and duel results
- Each entry shows: date, description/type, amount in original currency, USD equivalent, who paid/owes
- Expenses and payments are visually distinct (different icons/colors)
- Duel results highlighted with game icon

### 5. Weekly Duel

- Available from Monday 00:00 UTC each week
- App uses a deterministic seed (year * 100 + week number) to select 3 games, then picks 1
- Both phones derive the same game from the same seed
- Game screen with animation and result
- Result automatically recorded to Firestore and reflected in balance

## Weekly Duel — Games

All games are **zero-sum in expectation** (fair over time, E[adjustment] = $0 for both players).

### Coin Flip (Double or Nothing)

- The debtor flips a coin
- Heads: $10 forgiven from their debt
- Tails: $10 added to their debt
- E[value] = 0.5 * (+10) + 0.5 * (-10) = $0

### Wheel of Fortune

- Wheel with 6 equal slices: -$10, -$5, $0, $0, +$5, +$10
- Values are from the debtor's perspective (positive = debt reduced)
- E[value] = (-10 + -5 + 0 + 0 + 5 + 10) / 6 = $0
- Spin animation with result reveal

### Rock Paper Scissors

- Both players submit their choice (stored in Firestore, revealed when both have submitted)
- Winner: $10 adjusted in their favor
- Tie: no adjustment, replay available
- Symmetric game — both players have equal probability of winning

### Lucky Number

- Both players pick a number 1-10 (submitted blindly, revealed together)
- App generates a target number from the weekly seed
- Closest to target wins $10 adjustment in their favor
- Exact tie in distance: no adjustment
- Symmetric — both players pick from the same range

### Scratch Card

- Each player gets a scratch card with a hidden value
- Values drawn from a symmetric distribution: {-$10, -$5, $0, +$5, +$10}
- Both cards drawn from the same pool, net adjustment = card_A - card_B
- Drag-to-reveal animation
- E[net] = 0 by symmetry

## Security Rules (Firestore)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAllowedUser() {
      return request.auth != null &&
             request.auth.token.email in ['EMAIL_1', 'EMAIL_2'];
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

## PWA Configuration

- `manifest.json` with app name "Daumi's Debt", theme color, icons
- Service worker for offline caching of app shell (not data — data requires network)
- `display: "standalone"` for native app feel
- Both users add to home screen via browser "Add to Home Screen"

## Privacy

- The GitHub repo is public — but the app is just static HTML/CSS/JS with no data
- Firebase config (API key, project ID) is in the frontend code — this is normal and safe; security is enforced by Firestore rules, not by hiding config
- All user data lives exclusively in Firebase Firestore, protected by auth + rules
- No analytics, no third-party tracking

## File Structure

```
daumis-debt/
├── index.html          # Single page app shell
├── manifest.json       # PWA manifest
├── sw.js               # Service worker
├── css/
│   └── style.css       # All styles
├── js/
│   ├── app.js          # App initialization, routing, auth
│   ├── firebase.js     # Firebase config and initialization
│   ├── expenses.js     # Add/list expenses
│   ├── payments.js     # Add/list payments
│   ├── balance.js      # Balance computation
│   ├── history.js      # History view
│   ├── duel.js         # Weekly duel logic and game selection
│   ├── games/
│   │   ├── coin-flip.js
│   │   ├── wheel.js
│   │   ├── rps.js
│   │   ├── lucky-number.js
│   │   └── scratch-card.js
│   └── exchange.js     # Exchange rate fetching
└── assets/
    └── icons/          # PWA icons (192x192, 512x512)
```
