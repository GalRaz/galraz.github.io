# Duel System — Agent Test Runbook

This is a fully executable test suite for an agent with Chrome MCP connected. Read the entire **Session Bootstrap** section before running any test. Each test case is written as numbered steps you execute in order.

**App URL:** `https://galraz.github.io/daumis-debt/`

---

## Chrome MCP Tool Reference

| Task | Tool |
|---|---|
| Navigate to URL | `mcp__claude-in-chrome__navigate` |
| Click / interact | `mcp__claude-in-chrome__find` + `mcp__claude-in-chrome__computer` |
| Run JavaScript | `mcp__claude-in-chrome__javascript_tool` |
| Take screenshot | `mcp__claude-in-chrome__computer` |
| Read page text | `mcp__claude-in-chrome__get_page_text` |
| Watch network | `mcp__claude-in-chrome__read_network_requests` |

---

## Session Bootstrap

Run this **once at the start of every testing session** before any individual test. It collects the UIDs, week info, and current game — values you'll reuse throughout.

### Step B-1: Navigate and confirm login

Navigate to `https://galraz.github.io/daumis-debt/`. Take a screenshot. If a login screen is shown, stop and ask the user to sign in, then re-take the screenshot and confirm the main dashboard is visible.

### Step B-2: Collect session state

Run in `javascript_tool`:

```js
// Collect all values needed for tests
const user = firebase.auth().currentUser;
const now = new Date();
const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const dayNum = d.getUTCDay() || 7;
d.setUTCDate(d.getUTCDate() + 4 - dayNum);
const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
const year = now.getFullYear();
const seed = year * 100 + week;

// Get partner UID from app state
const { getPartnerUid, getUserName } = await import('./js/app.js');
const partnerUid = getPartnerUid();

// Compute this week's game
const { getWeeklyGame } = await import('./js/duel.js');
const thisWeeksGame = getWeeklyGame(seed);

console.log(JSON.stringify({
  myUid: user.uid,
  myEmail: user.email,
  partnerUid,
  year,
  week,
  seed,
  thisWeeksGame,
  isWeekday: now.getDay(), // 0=Sun, 3=Wed+
  isDuelDay: now.getDay() >= 3
}));
```

**Record the output.** You will refer to `MY_UID`, `PARTNER_UID`, `YEAR`, `WEEK`, `SEED`, and `THIS_WEEKS_GAME` throughout the tests.

### Step B-3: Override duel day gate (if not Wednesday or later)

If `isDuelDay` is false, run this once to patch the gate for this session:

```js
// Patch isDuelDay in the loaded module — we override at the window level
// The duel module calls new Date().getDay() inline, so we mock Date
const RealDate = Date;
class MockDate extends RealDate {
  getDay() { return 3; } // Wednesday
}
window.Date = MockDate;
console.log('isDuelDay override active');
```

### Step B-4: Helper functions (paste once, reuse everywhere)

Run in `javascript_tool` to define helpers used in all tests:

```js
// HELPER: delete this week's duel doc(s) — run before each test
window._cleanDuel = async () => {
  const snap = await firebase.firestore().collection('duels')
    .where('year', '==', YEAR).where('week', '==', WEEK).get();
  const dels = snap.docs.map(d => d.ref.delete());
  await Promise.all(dels);
  console.log(`Deleted ${snap.docs.length} duel doc(s) for ${YEAR}W${WEEK}`);
};

// HELPER: read this week's duel doc
window._getDuel = async () => {
  const snap = await firebase.firestore().collection('duels')
    .where('year', '==', YEAR).where('week', '==', WEEK).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

// HELPER: write a partial duel doc to simulate the other player's submission
window._seedDuel = async (data) => {
  await firebase.firestore().collection('duels').add({
    year: YEAR, week: WEEK, seed: SEED,
    result: null, balanceAdjust: 0, favoredUser: null, playedAt: null,
    ...data
  });
  console.log('Seeded duel doc:', data);
};

// REPLACE these with values from Step B-2
const YEAR = /* from B-2 */ 2026;
const WEEK = /* from B-2 */ 14;
const SEED = /* from B-2 */ 202614;
const MY_UID = /* from B-2 */ 'paste-uid-here';
const PARTNER_UID = /* from B-2 */ 'paste-uid-here';

console.log('Helpers ready');
```

**Important:** Fill in `YEAR`, `WEEK`, `SEED`, `MY_UID`, `PARTNER_UID` from the B-2 output before running this block.

---

## Multi-User Test Strategy

RPS and Lucky Number require two players. The app uses Google OAuth so you cannot be signed in as two users simultaneously in one Chrome instance.

**Approach for all two-player tests:** simulate the partner's submission by writing directly to Firestore using `_seedDuel()` or by directly updating the duel doc. You are always signed in as User A (yourself). You inject User B's (the partner's) moves via Firestore, then observe what A's UI does.

---

## Known Issues Reference

| ID | File | Issue |
|---|---|---|
| KI-1 | `coin-flip.js:18` | Uses `Math.random()` not the week seed — result not reproducible without override |
| KI-2 | `wheel.js:64` | Same — `Math.random()` for spin result |
| KI-3 | `wheel.js:98-100` | `favoredUser` falls back to string `'partner'` if `getPartnerUid()` returns null |
| KI-4 | `rps.js:97-104` | Second player uses `duelDocRef.update()` directly, bypassing `notifyPartner` |
| KI-5 | `rps.js` / `lucky-number.js` | First player (A) never sees the result if B resolved — only "Duel already played this week!" |
| KI-6 | `lucky-number.js:9` | Target is computable from the public seed before either player picks |
| KI-7 | `scratch-card.js:16` | Result value is in the DOM before scratching, only hidden by canvas overlay |

---

## Game 1: Coin Flip

**Mechanic:** Single player. `Math.random() < 0.5` → heads (you win $10) / tails (partner wins $10). Fires `recordDuelResult` after 1000ms animation.

### CF-1: Heads — you win

1. Run `await _cleanDuel()`.
2. Inject `Math.random` override:
   ```js
   Math.random = () => 0.3; // < 0.5 → heads
   ```
3. Navigate to the duel screen (click the duel button in the app nav).
4. Confirm game title shows "Coin Flip". Take screenshot.
5. Click "Flip!".
6. Wait 1500ms:
   ```js
   await new Promise(r => setTimeout(r, 1500));
   ```
7. Take screenshot. Confirm coin shows "H" and result text contains "Heads! You win $10!".
8. Restore `Math.random`:
   ```js
   delete Math.random;
   ```
9. Read Firestore:
   ```js
   const d = await _getDuel(); console.log(JSON.stringify(d));
   ```
10. **Assert:** `d.favoredUser === MY_UID`, `d.balanceAdjust === 10`, `d.result.side === 'heads'`.
11. **Assert:** Button text is "Done!" — run:
    ```js
    console.log(document.getElementById('btn-flip')?.textContent, document.getElementById('btn-flip')?.disabled);
    ```
    Expected: `"Done!" true`.

### CF-2: Tails — you lose

1. Run `await _cleanDuel()`.
2. ```js
   Math.random = () => 0.7; // >= 0.5 → tails
   ```
3. Navigate to duel screen. Click "Flip!".
4. Wait 1500ms.
5. Take screenshot. Confirm "Tails! You lose $10."
6. `delete Math.random;`
7. Read Firestore. **Assert:** `d.favoredUser === PARTNER_UID`, `d.balanceAdjust === 10`, `d.result.side === 'tails'`.
8. **Assert (KI-3):** `d.favoredUser` is a real UID string, not the literal string `'partner'`. If it equals `'partner'`, log this as a bug.

### CF-3: Double-click prevention

1. Run `await _cleanDuel()`.
2. `Math.random = () => 0.3;`
3. Navigate to duel screen.
4. Click "Flip!" twice in rapid succession (use `find` to click, then immediately click again).
5. Wait 1500ms.
6. `delete Math.random;`
7. Query all duel docs for the week:
   ```js
   const snap = await firebase.firestore().collection('duels')
     .where('year', '==', YEAR).where('week', '==', WEEK).get();
   console.log('Doc count:', snap.docs.length);
   ```
8. **Assert:** Exactly 1 document.

---

## Game 2: Wheel of Fortune

**Mechanic:** Single player. `Math.random()` picks from 6 slices (index 0–5): `-$10, -$5, $0, $0, +$5, +$10`. Canvas animates for ~3000ms then fires `recordDuelResult`.

Slice mapping:
| `Math.random()` value | `Math.floor(v * 6)` | Slice | Value |
|---|---|---|---|
| 0.01 | 0 | -$10 | -10 |
| 0.18 | 1 | -$5 | -5 |
| 0.35 | 2 | $0 | 0 |
| 0.52 | 3 | $0 | 0 |
| 0.69 | 4 | +$5 | 5 |
| 0.9 | 5 | +$10 | 10 |

**Note:** `Math.random()` is called twice per spin — once for `resultIndex`, once for `spins` in the animation. Override must return the target value consistently or use a counter:
```js
let _callCount = 0;
Math.random = () => { _callCount++; return _callCount === 1 ? TARGET_VALUE : 0.5; };
```

### WH-1: Positive result (+$10)

1. Run `await _cleanDuel()`.
2. ```js
   let _c = 0; Math.random = () => { _c++; return _c === 1 ? 0.9 : 0.5; };
   ```
3. Navigate to duel screen. Confirm "Wheel of Fortune" subtitle.
4. Take screenshot — confirm canvas with 6 labeled slices is visible.
5. Click "Spin!".
6. Wait 3500ms:
   ```js
   await new Promise(r => setTimeout(r, 3500));
   ```
7. `delete Math.random;`
8. Take screenshot. Confirm result text contains "+$10 — you win!".
9. Read Firestore. **Assert:** `d.favoredUser === MY_UID`, `d.balanceAdjust === 10`, `d.result.value === 10`.

### WH-2: Negative result (-$10)

1. Run `await _cleanDuel()`.
2. ```js
   let _c = 0; Math.random = () => { _c++; return _c === 1 ? 0.01 : 0.5; };
   ```
3. Navigate to duel screen. Click "Spin!". Wait 3500ms. `delete Math.random;`
4. Take screenshot. Confirm "-$10 — you lose!".
5. Read Firestore. **Assert:** `d.favoredUser === PARTNER_UID`, `d.balanceAdjust === 10`.
6. **Assert (KI-3):** `d.favoredUser` is a real UID, not the string `'partner'`.

### WH-3: Zero result ($0)

1. Run `await _cleanDuel()`.
2. ```js
   let _c = 0; Math.random = () => { _c++; return _c === 1 ? 0.35 : 0.5; };
   ```
3. Navigate to duel screen. Click "Spin!". Wait 3500ms. `delete Math.random;`
4. Read Firestore. **Assert:** `d.favoredUser === null`, `d.balanceAdjust === 0`.

### WH-4: Spin button disabled during animation

1. Run `await _cleanDuel()`.
2. `Math.random = () => 0.9;`
3. Navigate to duel screen. Click "Spin!".
4. Immediately check button state (before 3s elapses):
   ```js
   const btn = document.getElementById('btn-spin');
   console.log('disabled:', btn.disabled);
   ```
5. **Assert:** `disabled === true`.
6. Wait 3500ms. `delete Math.random;`

---

## Game 3: Rock Paper Scissors

**Mechanic:** Two-player. Choices: `rock ✊`, `paper ✋`, `scissors ✌️`. `BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' }`. $10 stake.

For all RPS tests, you are signed in as User A (yourself). User B's moves are injected via Firestore.

### RPS-1: A goes first — waiting state

1. Run `await _cleanDuel()`.
2. Navigate to duel screen. Confirm "Rock Paper Scissors".
3. Click the rock choice (`data-choice="rock"`):
   ```js
   document.querySelector('.rps-choice[data-choice="rock"]').click();
   ```
4. Wait 500ms.
5. Read Firestore:
   ```js
   const d = await _getDuel(); console.log(JSON.stringify(d));
   ```
6. **Assert:** `d.result === null`, `d.submissions[MY_UID] === 'rock'`.
7. Read page text. **Assert:** Page contains "Waiting" and shows a Refresh button.

### RPS-2: A sees "partner has played" on refresh

Continues from RPS-1 (doc has `submissions: { [MY_UID]: 'rock' }`).

1. Simulate B submitting (inject into existing doc):
   ```js
   const snap = await firebase.firestore().collection('duels')
     .where('year', '==', YEAR).where('week', '==', WEEK).get();
   const ref = snap.docs[0].ref;
   await ref.update({ submissions: { [MY_UID]: 'rock', [PARTNER_UID]: 'scissors' } });
   console.log('B submission injected');
   ```
2. Click the Refresh button:
   ```js
   document.getElementById('btn-refresh').click();
   ```
3. Wait 500ms. Take screenshot.
4. Read page text. **Assert:** Page contains "[partner name] has played! Your turn." and all 3 choice buttons are visible.

### RPS-3: A resolves — A wins (rock beats scissors)

Continues from RPS-2 (doc has `submissions: { [MY_UID]: 'rock', [PARTNER_UID]: 'scissors' }`).

1. Click rock:
   ```js
   document.querySelector('.rps-choice[data-choice="rock"]').click();
   ```
2. Wait 500ms. Take screenshot.
3. Read page text. **Assert:** Contains "You win!" and "✊ beats ✌️".
4. Read Firestore. **Assert:** `d.favoredUser === MY_UID`, `d.balanceAdjust === 10`, `d.result[MY_UID] === 'rock'`, `d.result[PARTNER_UID] === 'scissors'`.
5. **Assert:** Choice buttons are no longer clickable:
   ```js
   const choices = document.querySelectorAll('.rps-choice');
   console.log('pointerEvents:', [...choices].map(c => c.style.pointerEvents));
   ```
   Expected: all `'none'`.

### RPS-4: Tie

1. Run `await _cleanDuel()`.
2. Inject B's submission first:
   ```js
   await _seedDuel({ game: 'Rock Paper Scissors', submissions: { [PARTNER_UID]: 'scissors' } });
   ```
3. Navigate to duel screen. Wait 500ms.
4. Read page text. Confirm "[partner] has played! Your turn."
5. Click scissors:
   ```js
   document.querySelector('.rps-choice[data-choice="scissors"]').click();
   ```
6. Wait 500ms.
7. Read Firestore. **Assert:** `d.favoredUser === null`, `d.balanceAdjust === 0`.
8. Read page text. **Assert:** Contains "Tie!" and "No change".

### RPS-5: Already played guard

1. Run `await _cleanDuel()`.
2. Inject a completed duel doc:
   ```js
   await _seedDuel({
     game: 'Rock Paper Scissors',
     submissions: { [MY_UID]: 'rock', [PARTNER_UID]: 'paper' },
     result: { [MY_UID]: 'rock', [PARTNER_UID]: 'paper' },
     favoredUser: PARTNER_UID,
     balanceAdjust: 10
   });
   ```
3. Navigate to duel screen. Wait 500ms.
4. Read page text. **Assert:** Contains "Duel already played this week!".
5. **Assert:** No `.rps-choice` elements in DOM:
   ```js
   console.log('choices:', document.querySelectorAll('.rps-choice').length);
   ```
   Expected: `0`.

### RPS-6: Refresh re-polls (still waiting)

1. Run `await _cleanDuel()`.
2. Inject doc with only A's submission:
   ```js
   await _seedDuel({ game: 'Rock Paper Scissors', submissions: { [MY_UID]: 'paper' } });
   ```
3. Navigate to duel screen. Wait 500ms. Confirm waiting state shown.
4. Click Refresh:
   ```js
   document.getElementById('btn-refresh').click();
   ```
5. Wait 500ms. Read page text.
6. **Assert:** Still shows waiting message (B still hasn't submitted). No choice grid.

### RPS-7: A sees "already played" after B resolved — UX gap (KI-5)

1. Run `await _cleanDuel()`.
2. Inject doc with A's submission:
   ```js
   await _seedDuel({ game: 'Rock Paper Scissors', submissions: { [MY_UID]: 'rock' } });
   ```
3. Navigate to duel screen. Confirm waiting state.
4. Now simulate B resolving by updating the doc to a final state:
   ```js
   const snap = await firebase.firestore().collection('duels')
     .where('year', '==', YEAR).where('week', '==', WEEK).get();
   await snap.docs[0].ref.update({
     submissions: { [MY_UID]: 'rock', [PARTNER_UID]: 'paper' },
     result: { [MY_UID]: 'rock', [PARTNER_UID]: 'paper' },
     favoredUser: PARTNER_UID,
     balanceAdjust: 10
   });
   console.log('B resolved');
   ```
5. Click Refresh. Wait 500ms. Take screenshot.
6. Read page text. **Assert:** Shows "Duel already played this week!" — no win/loss breakdown visible.
7. **Log as KI-5:** A played first but never gets to see the result.

### RPS-8: B goes first — A resolves and wins

1. Run `await _cleanDuel()`.
2. Inject B's submission as the first doc:
   ```js
   await _seedDuel({ game: 'Rock Paper Scissors', submissions: { [PARTNER_UID]: 'scissors' } });
   ```
3. Navigate to duel screen. Wait 500ms.
4. Read page text. **Assert:** "[partner] has played! Your turn." preamble.
5. Click rock:
   ```js
   document.querySelector('.rps-choice[data-choice="rock"]').click();
   ```
6. Wait 500ms. Take screenshot.
7. Read Firestore. **Assert:** `d.favoredUser === MY_UID`, `d.balanceAdjust === 10`.
8. **Assert (KI-4):** Check network for EmailJS — run before clicking in a fresh test:
   ```js
   // Start watching network, then perform the action
   // After action: mcp__claude-in-chrome__read_network_requests
   // Assert: no request to api.emailjs.com
   ```
   Use `mcp__claude-in-chrome__read_network_requests` and confirm no `emailjs.com` request fires.

### RPS-9: A loses to B

1. Run `await _cleanDuel()`.
2. Inject B's submission:
   ```js
   await _seedDuel({ game: 'Rock Paper Scissors', submissions: { [PARTNER_UID]: 'paper' } });
   ```
3. Navigate to duel screen. Click rock (paper beats rock → A loses).
4. Wait 500ms. Take screenshot.
5. Read Firestore. **Assert:** `d.favoredUser === PARTNER_UID`, `d.balanceAdjust === 10`.
6. Read page text. **Assert:** Contains "You lose!" and "✋ beats ✊".

---

## Game 4: Lucky Number

**Mechanic:** Two-player. Target 1–10 determined by `seededRandom(seed * 7 + 31)`. Closest pick wins $10.

### Step: Pre-compute this week's target

Run once at the start of Lucky Number tests:

```js
function seededRandom(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = seededRandom(SEED * 7 + 31);
const TARGET = Math.floor(rng() * 10) + 1;
console.log('Lucky Number TARGET:', TARGET);
```

Record `TARGET`. All LN tests reference it.

### LN-1: A goes first — waiting state

1. Run `await _cleanDuel()`.
2. Navigate to duel screen. Confirm "Lucky Number".
3. Click the button for number 4 (arbitrary pick far from target):
   ```js
   document.querySelector('.number-btn[data-num="4"]').click();
   ```
4. Wait 500ms.
5. Read Firestore. **Assert:** `d.result === null`, `d.submissions[MY_UID] === 4`.
6. Read page text. **Assert:** Contains "You picked 4. Waiting".

### LN-2: A wins (closer to target)

Choose `MY_PICK` to be 1 step from `TARGET` and `B_PICK` to be 4+ steps away. Example: if TARGET=7, MY_PICK=6, B_PICK=1.

1. Run `await _cleanDuel()`.
2. Compute picks based on TARGET:
   ```js
   const MY_PICK = TARGET === 1 ? 2 : TARGET - 1; // 1 away
   const B_PICK = TARGET >= 6 ? 1 : 10;           // far away
   console.log('MY_PICK:', MY_PICK, 'B_PICK:', B_PICK);
   ```
3. Inject B's submission:
   ```js
   await _seedDuel({ game: 'Lucky Number', submissions: { [PARTNER_UID]: B_PICK } });
   ```
4. Navigate to duel screen. Confirm "[partner] has picked! Your turn."
5. Click MY_PICK:
   ```js
   document.querySelector(`.number-btn[data-num="${MY_PICK}"]`).click();
   ```
6. Wait 500ms. Take screenshot.
7. Read page text. **Assert:** Contains "You win!" and `Target: ${TARGET}`.
8. Read Firestore. **Assert:** `d.favoredUser === MY_UID`, `d.balanceAdjust === 10`, `d.result.target === TARGET`.

### LN-3: A loses (B is closer)

1. Run `await _cleanDuel()`.
2. ```js
   const B_PICK = TARGET; // B picks exactly the target — distance 0
   const MY_PICK = TARGET >= 6 ? 1 : 10; // far away
   ```
3. Inject B's submission:
   ```js
   await _seedDuel({ game: 'Lucky Number', submissions: { [PARTNER_UID]: B_PICK } });
   ```
4. Navigate to duel screen. Click MY_PICK.
5. Wait 500ms. Take screenshot.
6. Read Firestore. **Assert:** `d.favoredUser === PARTNER_UID`, `d.balanceAdjust === 10`.
7. Read page text. **Assert:** Contains partner's name and "wins!".

### LN-4: Tie (equal distance)

1. Run `await _cleanDuel()`.
2. Pick two numbers equidistant from TARGET:
   ```js
   // If TARGET=5: picks 3 and 7 (both distance 2)
   const T = TARGET;
   const B_PICK = T > 1 ? T - 2 : T + 2;
   const MY_PICK = T < 10 ? T + 2 : T - 2;
   // Ensure both are in range 1-10
   console.log('T:', T, 'B_PICK:', B_PICK, 'MY_PICK:', MY_PICK);
   ```
   If B_PICK or MY_PICK is out of range, adjust to nearest equidistant pair.
3. Inject B's submission:
   ```js
   await _seedDuel({ game: 'Lucky Number', submissions: { [PARTNER_UID]: B_PICK } });
   ```
4. Navigate to duel screen. Click MY_PICK.
5. Wait 500ms.
6. Read Firestore. **Assert:** `d.favoredUser === null`, `d.balanceAdjust === 0`.
7. Read page text. **Assert:** Contains "equally close" and "No change".

### LN-5: Target button highlighted after reveal

Reuse the state after any of LN-2 or LN-3 resolving.

1. After resolution, run:
   ```js
   const targetBtn = document.querySelector('.number-btn.target');
   console.log('target btn num:', targetBtn?.dataset.num, 'expected:', TARGET);
   ```
2. **Assert:** `parseInt(targetBtn.dataset.num) === TARGET`.

### LN-6: A sees "already played" after B resolved — UX gap (KI-5)

1. Run `await _cleanDuel()`.
2. Inject A's submission:
   ```js
   await _seedDuel({ game: 'Lucky Number', submissions: { [MY_UID]: 5 } });
   ```
3. Navigate to duel screen. Confirm waiting state.
4. Simulate B resolving the duel:
   ```js
   const snap = await firebase.firestore().collection('duels')
     .where('year', '==', YEAR).where('week', '==', WEEK).get();
   await snap.docs[0].ref.update({
     submissions: { [MY_UID]: 5, [PARTNER_UID]: TARGET },
     result: { target: TARGET, [MY_UID]: 5, [PARTNER_UID]: TARGET },
     favoredUser: PARTNER_UID,
     balanceAdjust: 10
   });
   ```
5. Click Refresh. Wait 500ms. Take screenshot.
6. Read page text. **Assert:** Contains "Duel already played this week!". No result breakdown shown.
7. **Log as KI-5.**

### LN-7: B goes first — A resolves

1. Run `await _cleanDuel()`.
2. Inject B's submission:
   ```js
   const B_PICK = TARGET >= 6 ? 1 : 10;
   await _seedDuel({ game: 'Lucky Number', submissions: { [PARTNER_UID]: B_PICK } });
   ```
3. Navigate to duel screen. Read page text. **Assert:** "[partner] has picked! Your turn."
4. Click `TARGET` (pick the exact target to guarantee a win):
   ```js
   document.querySelector(`.number-btn[data-num="${TARGET}"]`).click();
   ```
5. Wait 500ms.
6. Read Firestore. **Assert:** `d.favoredUser === MY_UID`.

### LN-8: Same pick — exact tie

1. Run `await _cleanDuel()`.
2. ```js
   await _seedDuel({ game: 'Lucky Number', submissions: { [PARTNER_UID]: TARGET } });
   ```
3. Navigate to duel screen. Click TARGET:
   ```js
   document.querySelector(`.number-btn[data-num="${TARGET}"]`).click();
   ```
4. Wait 500ms.
5. Read Firestore. **Assert:** `d.favoredUser === null`, `d.balanceAdjust === 0`.
6. Read page text. **Assert:** Contains "equally close" (both distance 0).

---

## Game 5: Scratch Card

**Mechanic:** Single player. `netAdjust` from `[-10, -5, 0, 5, 10]` is seeded. Value hidden under canvas. Reveal fires when > 40% of canvas pixels are cleared.

### Step: Pre-compute this week's scratch card result

```js
function seededRandom(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const VALUES = [-10, -5, 0, 5, 10];
const rng = seededRandom(SEED * 13 + 7);
const SC_RESULT = VALUES[Math.floor(rng() * VALUES.length)];
console.log('Scratch Card result this week:', SC_RESULT);
```

Record `SC_RESULT`.

### SC-1: Partial scratch — no trigger

1. Run `await _cleanDuel()`.
2. Navigate to duel screen. Confirm "Scratch Card".
3. Scratch a tiny area via synthetic mouse events (small circle, well under 40%):
   ```js
   const canvas = document.getElementById('scratch-canvas');
   const rect = canvas.getBoundingClientRect();
   // Scratch just 3 pixels in the top-left corner
   canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + 5, clientY: rect.top + 5, bubbles: true }));
   canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + 6, clientY: rect.top + 5, bubbles: true }));
   canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
   ```
4. Wait 300ms.
5. Read Firestore. **Assert:** `(await _getDuel()) === null` — no doc created yet.
6. **Assert:** Hint text still visible:
   ```js
   console.log(document.getElementById('scratch-hint')?.textContent);
   ```
   Expected: "Drag or tap to scratch".

### SC-2: Full scratch — reveal triggers

1. Continuing from SC-1 (same session, same page).
2. Scratch across the full canvas:
   ```js
   const canvas = document.getElementById('scratch-canvas');
   const rect = canvas.getBoundingClientRect();
   const ctx = canvas.getContext('2d');
   // Use destination-out to clear the whole canvas directly
   ctx.globalCompositeOperation = 'destination-out';
   ctx.fillStyle = 'rgba(0,0,0,1)';
   ctx.fillRect(0, 0, 200, 140);
   // Manually fire the pixel check by dispatching a mousemove
   canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + 100, clientY: rect.top + 70, bubbles: true }));
   ```
3. Wait 500ms. Take screenshot.
4. Read Firestore. **Assert:** Doc exists with correct `d.result.netAdjust === SC_RESULT`.
5. Read page text. **Assert:**
   - If `SC_RESULT > 0`: contains "you win!" in page.
   - If `SC_RESULT < 0`: contains "you lose!".
   - If `SC_RESULT === 0`: contains "no change".

### SC-3: Value in DOM before scratching (KI-7)

1. Run `await _cleanDuel()`.
2. Navigate to duel screen. Before any scratching, read the hidden value:
   ```js
   const val = document.getElementById('scratch-value')?.textContent.trim();
   console.log('Value in DOM:', val, 'Expected:', SC_RESULT >= 0 ? `+$${SC_RESULT}` : `$${SC_RESULT}`);
   ```
3. Take screenshot. **Assert visually:** The value text is NOT visible (canvas covers it).
4. **Log as KI-7:** The result is readable from the DOM before any interaction.

### SC-4: Correct favoredUser for negative result

Run this only if `SC_RESULT < 0` (otherwise skip or use a seed override — see note below).

1. Run `await _cleanDuel()`.
2. Navigate to duel screen. Perform full scratch (step SC-2).
3. Wait 500ms.
4. Read Firestore. **Assert:** `d.favoredUser === PARTNER_UID` and it is a real UID, not the string `'partner'` (KI-3).

**Note on seed override for specific SC values:** To force a specific `netAdjust` when the week's natural result doesn't match, the seeded RNG runs at module load time — you cannot override it via `Math.random`. Instead, test whatever the week naturally produces and note it. To test a specific value in isolation, directly call `recordDuelResult` and inspect Firestore manually.

---

## Game Selection Tests

### GS-1: Determinism

```js
const { getWeeklyGame } = await import('./js/duel.js');
const results = Array.from({ length: 5 }, () => getWeeklyGame(SEED));
console.log('All same?', new Set(results).size === 1, results);
```
**Assert:** All 5 results are identical.

### GS-2: All games reachable across a year

```js
const { getWeeklyGame } = await import('./js/duel.js');
const seen = new Set();
for (let w = 1; w <= 52; w++) seen.add(getWeeklyGame(2026 * 100 + w));
console.log('Games seen:', [...seen]);
console.log('All 5 covered?', seen.size === 5);
```
**Assert:** All 5 game IDs appear: `coin-flip`, `wheel`, `rps`, `lucky-number`, `scratch-card`.

### GS-3: Both players see the same game

```js
// Compute seed independently and confirm same game
const { getWeeklyGame, getCurrentWeekInfo } = await import('./js/duel.js');
const { seed } = getCurrentWeekInfo();
console.log('Game from seed:', getWeeklyGame(seed));
```
Compare this output with the `thisWeeksGame` from Step B-2. **Assert:** Identical.

---

## Balance Impact Tests

### BI-1: Duel win increases balance

1. Read current balance from the page (navigate to dashboard and note the displayed balance in the consolidation currency).
2. Run a solo game (Coin Flip, CF-1) and win.
3. Navigate back to dashboard.
4. **Assert:** Balance has shifted by $10 × exchange rate in the consolidation currency.

### BI-2: Tie has no balance impact

1. Note current balance.
2. Complete RPS-4 (tie).
3. Navigate to dashboard.
4. **Assert:** Balance unchanged.

### BI-3: Duel record in Insights

1. Complete any duel.
2. Navigate to Insights.
3. Read page text. **Assert:** "Duel record" row shows updated win count.

---

## Test Run Log Template

After completing each test, record:

```
| Test | Result | Notes |
|------|--------|-------|
| CF-1 | PASS/FAIL | |
| CF-2 | PASS/FAIL | |
| CF-3 | PASS/FAIL | |
| CF-4 | PASS/FAIL | |
| WH-1 | PASS/FAIL | |
| WH-2 | PASS/FAIL | |
| WH-3 | PASS/FAIL | |
| WH-4 | PASS/FAIL | |
| RPS-1 | PASS/FAIL | |
| RPS-2 | PASS/FAIL | |
| RPS-3 | PASS/FAIL | |
| RPS-4 | PASS/FAIL | |
| RPS-5 | PASS/FAIL | |
| RPS-6 | PASS/FAIL | |
| RPS-7 | PASS/FAIL | KI-5 expected |
| RPS-8 | PASS/FAIL | |
| RPS-9 | PASS/FAIL | |
| LN-1 | PASS/FAIL | |
| LN-2 | PASS/FAIL | |
| LN-3 | PASS/FAIL | |
| LN-4 | PASS/FAIL | |
| LN-5 | PASS/FAIL | |
| LN-6 | PASS/FAIL | KI-5 expected |
| LN-7 | PASS/FAIL | |
| LN-8 | PASS/FAIL | |
| SC-1 | PASS/FAIL | |
| SC-2 | PASS/FAIL | |
| SC-3 | PASS/FAIL | KI-7 expected |
| SC-4 | PASS/FAIL | skip if SC_RESULT >= 0 |
| GS-1 | PASS/FAIL | |
| GS-2 | PASS/FAIL | |
| GS-3 | PASS/FAIL | |
| BI-1 | PASS/FAIL | |
| BI-2 | PASS/FAIL | |
| BI-3 | PASS/FAIL | |
```
