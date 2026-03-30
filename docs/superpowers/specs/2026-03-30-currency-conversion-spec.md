# Currency Handling Overhaul — Spec

## Problem

The app currently converts every expense to USD at today's exchange rate via `usdAmount`. This is the source of truth for balance computation (`itemImpact` uses `usdAmount`). This causes:

1. **Balance drift** — The displayed balance changes daily even when no one spends or pays anything, because exchange rates fluctuate.
2. **Phantom debt after settle-up** — You settle a BTN balance at today's rate. Tomorrow the BTN/USD rate changes, and the "settled" expenses now compute to a different USD total than the payment that settled them. You're no longer settled.
3. **Double conversion** — Expenses store `usdAmount` at write time. The dashboard then converts that USD amount to the user's display currency. That's two conversions, each using a possibly different rate.

## Current Architecture (what exists)

- `itemImpact(item, myUid)` in `balance.js` — returns the USD impact of an item using `item.usdAmount`. This is the core function used by both `computeBalance()` and `loadDashboard()`.
- `computeBalance()` — sums `itemImpact` across all expenses/payments/duels. Returns a single USD number.
- `computeCurrencyBalances()` — already tracks per-currency balances correctly using `item.amount` and `item.currency` (not `usdAmount`). This is used by the settle-up screen.
- `loadDashboard()` — computes both a USD total balance and `currencyBalances`. The balance card toggles between a consolidated view (one number in a chosen currency) and a breakdown view (per-currency lines).
- Settle-up (`renderSettleUp()` in `app.js`) — already settles per currency. Shows each currency debt separately. "Settle All" creates one payment per currency at the exact original-currency amount.
- History entries — show amounts in either original currency or consolidated currency, toggled by user preference.

## What's Actually Working vs What's Broken

**Working correctly (per-currency, no drift):**
- `currencyBalances` computation in `loadDashboard()` — uses `item.amount` and `item.currency` directly
- `computeCurrencyBalances()` — same correct per-currency logic
- Settle-up screen — settles per currency at exact amounts
- Breakdown view — shows per-currency balances from the correct source

**Broken (USD-dependent, drifts):**
- `itemImpact()` — uses `usdAmount`, which changes with exchange rates
- `computeBalance()` — returns USD total from `itemImpact`
- Consolidated balance card — converts the USD total to display currency (double conversion)
- "Settle All" total — converts USD total to consolidation currency
- Balance label ("You owe X" / "X owes you") — based on USD total sign
- `applyMood()` — based on USD balance
- `getBalanceQuote()` — based on USD balance
- Notifications `formatBalanceForPartner()` — calls `computeBalance()` which returns USD
- Games that use `computeBalance()` to determine who the debtor is

## Recommendation: Per-Currency as Source of Truth

Make the per-currency balances the canonical source. The USD/consolidated amount becomes a **display-only estimate** computed on the fly from per-currency balances × today's rates. This means:

- Balance doesn't drift (you owe Nu 500 BTN, period)
- Settling Nu 500 BTN creates a Nu 500 BTN payment that exactly zeroes out the BTN balance
- The consolidated view is clearly labeled as an estimate

## Changes Required

### 1. Remove `usdAmount` from balance computation

`itemImpact()` should NOT be used for balance computation anymore. The per-currency balance loop in `loadDashboard()` (lines 195-204) is already correct — it uses `item.amount` and `item.currency`. This should become the single source of truth.

**Delete or deprecate `computeBalance()`**. Replace all callers with `computeCurrencyBalances()` and derive the consolidated estimate from that.

### 2. Derive consolidated balance from per-currency balances

Instead of summing `usdAmount`, compute the consolidated display amount as:

```
consolidatedBalance = sum of (currencyBalances[cur] × liveRate(cur → consolCurrency))
```

This is what the settle-up screen already does for its "Settle All" total. Apply the same approach to the balance card.

### 3. Fix the balance label direction

Currently: `if (balance > 0.005)` where `balance` is the USD total.

Change to: derive direction from the consolidated estimate. Or better: if ALL per-currency balances have the same sign, the direction is unambiguous. If they have mixed signs (you owe BTN but are owed JPY), show "Mixed — tap for details" and default to the breakdown view.

### 4. Fix `computeBalance()` callers

These call `computeBalance()` and need to be updated:

- **`formatBalanceForPartner()` in `notifications.js`** — Used in email notifications. Should compute a consolidated estimate from `computeCurrencyBalances()` instead, or just report the largest per-currency balance.
- **Game modules** (coin-flip, wheel, scratch-card) — Call `computeBalance()` to determine who the debtor is. Should use `computeCurrencyBalances()` and derive direction from the consolidated estimate.
- **`applyMood()` and `getBalanceQuote()` in `balance.js`** — Use the USD balance for mood/quotes. Should use the consolidated estimate.

### 5. Stop writing `usdAmount` on new expenses (optional, low priority)

Currently, adding an expense calls `convertToUSD()` and stores `usdAmount` and `exchangeRate`. This field is no longer needed for balance computation after this change. However:

- Keep writing it for backwards compatibility (old code, import tools, etc.)
- Don't use it in balance logic
- It can serve as a historical snapshot ("what was the rate when I logged this?")

So: **keep writing `usdAmount`, just stop reading it for balance math.**

### 6. Update the "Settle All" consolidated total

The settle-up screen already computes a consolidated total from the USD balance. After this change, compute it the same way as the balance card: sum per-currency balances × live rates.

This may already work correctly if `renderSettleUp()` is changed to derive its total from `computeCurrencyBalances()` + live conversion instead of the USD total.

## Files to Modify

| File | Change |
|------|--------|
| `js/balance.js` | Rewrite consolidated balance to derive from per-currency balances × live rates. Remove `itemImpact` from balance computation. Update `computeBalance()` or replace it. Fix mood/quote to use new balance. |
| `js/notifications.js` | Update `formatBalanceForPartner()` to use `computeCurrencyBalances()` |
| `js/app.js` | Update `renderSettleUp()` total to derive from per-currency × live rates |
| `js/games/coin-flip.js` | Update debtor detection to use new balance API |
| `js/games/wheel.js` | Same |
| `js/games/scratch-card.js` | Same |
| `sw.js` | Bump cache version |

## What NOT to Change

- **Per-currency balance computation** — already correct in both `loadDashboard()` and `computeCurrencyBalances()`
- **Settle-up per-currency flow** — already correct, settles at exact original amounts
- **History display** — already shows original currency in breakdown mode
- **`usdAmount` field on Firestore docs** — keep writing it, just stop using it for balance
- **Exchange rate fetching** — `exchange.js` is fine, still needed for the consolidated estimate

## Edge Cases

- **Duel results** — Duels are denominated in USD (e.g. "$10 forgiven"). They should contribute to the USD currency balance, not be converted from anything. Currently `itemImpact` returns `d.balanceAdjust` for duels — this is already in USD and should go into `currencyBalances['USD']`.
- **Mixed-sign balances** — You owe BTN but are owed JPY. The "You owe X" / "X owes you" label doesn't apply cleanly. Show "Mixed balance" or similar, and default to the breakdown view.
- **`balanceExcluded` entries** — Continue to skip these in all balance computation (already implemented).
- **Zero-balance currencies** — Filter out currencies with near-zero balance (already done with the `> 0.005` threshold).

## Testing

No test framework exists. Verify manually:

1. Balance card shows same per-currency amounts as before
2. Consolidated total is close to (but may differ slightly from) the old USD total
3. Adding an expense in BTN increases the BTN balance by the right amount, without affecting other currencies
4. Settling a single currency zeroes that currency's balance exactly
5. "Settle All" creates correct per-currency payments
6. Refreshing the page on different days does NOT change per-currency balances
7. Games still correctly determine who the debtor is
8. Email notifications show a reasonable balance summary
