import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName, setPartnerInfo } from './app.js';
import { getExchangeRate } from './exchange.js';

// In-memory cache for Firestore snapshots — invalidated when data changes
let _snapshotCache = null;
// Cache duel availability so isDuelAvailable() doesn't re-query on every navigation
// Invalidated when a duel is played (duel screen sets it to false) or cache is cleared
let _duelAvailableCache = null;

export function invalidateDataCache() {
  _snapshotCache = null;
  _duelAvailableCache = null;
}

export function setDuelAvailableCache(value) {
  _duelAvailableCache = value;
}

const BALANCE_SNAPSHOT_KEY = 'daumis-debt-balance-snapshot';

/**
 * Paint the last-rendered balance from localStorage into the DOM.
 * Runs synchronously before any Firestore fetch so the user sees
 * yesterday's balance instantly instead of a "Loading..." flash.
 * Returns true if a snapshot was painted.
 */
export function paintCachedBalance() {
  try {
    const raw = localStorage.getItem(BALANCE_SNAPSHOT_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    const balanceEl = document.getElementById('balance-display');
    if (!balanceEl) return false;
    const label = balanceEl.querySelector('.balance-label');
    const amount = balanceEl.querySelector('.balance-amount');
    if (label && snap.label) label.textContent = snap.label;
    if (amount) {
      amount.textContent = snap.amountText || '';
      amount.className = `balance-amount ${snap.amountClass || ''}`;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function saveBalanceSnapshot({ labelText, amountText, amountClass }) {
  try {
    localStorage.setItem(BALANCE_SNAPSHOT_KEY, JSON.stringify({
      label: labelText, amountText, amountClass
    }));
  } catch (e) {}
}

const CURRENCY_SYMBOLS = {
  USD:'$', EUR:'€', GBP:'£', JPY:'¥', THB:'฿', BTN:'Nu ', TWD:'NT$', KRW:'₩',
  CNY:'¥', INR:'₹', AUD:'A$', CAD:'C$', CHF:'Fr', SGD:'S$', HKD:'HK$', NZD:'NZ$',
  SEK:'kr', NOK:'kr', DKK:'kr', MXN:'$', BRL:'R$', PLN:'zł', CZK:'Kč', HUF:'Ft',
  ILS:'₪', TRY:'₺', ZAR:'R', PHP:'₱', MYR:'RM', IDR:'Rp'
};

/**
 * Format a number following the graduated-decimals rule:
 *   - 7+ integer digits (>= 1,000,000): no decimals
 *   - 5-6 integer digits (10,000 - 999,999): one decimal
 *   - ≤4 integer digits: two decimals
 * Used for the consolidated total, per-currency breakdown, history rows,
 * and settle-up amounts so large numbers don't overflow the layout.
 */
export function formatAmountByDigits(amount) {
  const abs = Math.abs(amount);
  const intPart = Math.floor(abs);
  const digits = intPart === 0 ? 1 : String(intPart).length;
  if (digits >= 7) {
    return abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (digits >= 5) {
    return abs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function categorize(description) {
  if (!description) return { icon: '$', label: 'other' };
  const d = description.toLowerCase();

  const categories = [
    { keywords: ['grocery', 'groceries', 'supermarket', 'market', 'produce', 'trader joe', 'whole foods', 'lawson', 'conbini', '7/11', '7-11', 'jmart', 'vegg', 'fruit', 'egg', 'milk', 'bread', 'rice', 'olive oil', 'seaweed', 'detergent', 'snack'], icon: '🛒', label: 'groceries' },
    { keywords: ['restaurant', 'dinner', 'lunch', 'breakfast', 'cafe', 'coffee', 'eat', 'sushi', 'pizza', 'burger', 'ramen', 'noodle', 'brunch', 'bistro', 'datshi', 'thai', 'korean', 'japanese', 'indian', 'chinese', 'mexican', 'italian', 'pastry', 'bakery', 'bar', 'pub', 'beer', 'wine', 'drink', 'cocktail', 'boba', 'bubble tea', 'tea', 'matcha', 'latte', 'cappuccino', 'capuccino', 'falafel', 'kebab', 'hummus', 'salad', 'momo', 'dosa', 'paneer', 'shabu', 'chipotle', 'mcdo', 'ice cream', 'cookie', 'chocolate', 'yogurt', 'smoothie', 'soho', 'munch', 'dimsum', 'wok'], icon: '🍽️', label: 'dining' },
    { keywords: ['flight', 'flights', 'airline', 'airport', 'plane', 'boarding', 'eurowings', 'eva air', 'air'], icon: '✈️', label: 'flights' },
    { keywords: ['hotel', 'hostel', 'airbnb', 'accommodation', 'stay', 'booking', 'resort', 'room upgrade'], icon: '🏨', label: 'lodging' },
    { keywords: ['uber', 'lyft', 'taxi', 'cab', 'bus', 'train', 'metro', 'subway', 'transport', 'transit', 'grab', 'bolt', 'driver', 'sim card', 'data'], icon: '🚕', label: 'transport' },
    { keywords: ['gas', 'fuel', 'petrol', 'parking', 'car', 'rental', 'toll', 'suv'], icon: '⛽', label: 'auto' },
    { keywords: ['movie', 'cinema', 'ticket', 'concert', 'show', 'museum', 'park', 'tour', 'attraction', 'entertainment', 'game', 'entrance', 'festival', 'spa', 'massage', 'hot stone'], icon: '🎬', label: 'entertainment' },
    { keywords: ['rent', 'electric', 'electricity', 'water', 'internet', 'wifi', 'utility', 'utilities', 'bill', 'phone', 'spotify', 'laundry', 'household', 'house stuff', 'machine', 'fitlab'], icon: '🏠', label: 'housing' },
    { keywords: ['doctor', 'hospital', 'medicine', 'pharmacy', 'health', 'medical', 'dental', 'drugstore'], icon: '💊', label: 'health' },
    { keywords: ['clothes', 'clothing', 'shoes', 'shirt', 'dress', 'shopping', 'mall', 'store', 'shop', 'uniqlo'], icon: '🛍️', label: 'shopping' },
    { keywords: ['gift', 'present', 'birthday', 'anniversary', 'bday', 'tip'], icon: '🎁', label: 'gifts' },
    { keywords: ['splitwise', 'balance', 'transfer', 'settle', 'cash', 'money exchange', 'pay off'], icon: '📊', label: 'balance' },
  ];

  for (const cat of categories) {
    if (cat.keywords.some(kw => d.includes(kw))) return cat;
  }
  return { icon: '$', label: 'other' };
}

// --- Daily taglines ---------------------------------------------------------
// A scheduled agent refreshes daumis-debt/quotes/daily.json with new taglines
// tied to current events. We read it lazily and fall back to the static bank
// when it's missing, stale, or malformed.

const STATIC_QUOTES = {
  settled: [
    "Perfectly balanced, as all things should be.",
    "Zero debt. Suspicious. Who are you people?",
    "The rare moment where nobody can complain."
  ],
  youOwe: [
    ["That's barely a kebab and a beer. Embarrassing to even track.", "You owe less than a parking ticket. Somehow that's worse.", "This debt is so small it has an inferiority complex."],
    ["You owe a nice dinner. One where you chew with your mouth closed.", "This is 'I'll grab the next one' except you've said that nine times.", "Your partner is not mad. Just disappointed. And keeping score."],
    ["Your debt just got a LinkedIn profile.", "That's enough to buy a goat in some countries. A NICE goat.", "You could pay this off or you could avoid eye contact forever. Your call."],
    ["You now owe a plane ticket. Economy. Middle seat. You deserve it.", "This is 'I will do literally any household chore without being asked' money.", "Your debt just applied for a mortgage."],
    ["Sell the guitar you don't play.", "Your debt has more life goals than you do.", "This amount of money could start a small cult. Just saying."],
    ["You don't have a relationship. You have a subprime loan with cuddling.", "Your debt is old enough to have opinions.", "Consider faking your own death. Financially speaking."]
  ],
  theyOwe: [
    ["They owe you pocket change. Bring it up constantly anyway.", "Petty? No. Financially vigilant? Absolutely.", "It's the principle. The tiny, tiny principle."],
    ["Leave this app open on the toilet. They'll see it.", "That's a date night THEY'RE planning AND paying for.", "You're owed a massage. Don't let them use their elbows though."],
    ["You're not a partner, you're a patron of the arts of spending.", "That's a spa weekend. Robes included. FLUFFY robes.", "Start clearing your throat loudly whenever they buy something."],
    ["They owe you a vacation. You pick the hotel. They sleep on the floor.", "Charge interest in cooking. Specifically, THEIR cooking.", "You're basically a loan shark but with feelings."],
    ["You're a whole-ass philanthropist and nobody gave you a trophy.", "Their debt could buy you a very ugly boat. You deserve that boat.", "This relationship has a balance sheet and you are the asset."],
    ["You're not a partner. You're a venture capitalist with abandonment issues.", "Their debt has its own area code.", "At this point, just put your name on their birth certificate."]
  ]
};

const QUOTES_KEY = 'daumis-debt-daily-quotes-v1';
let _dailyQuotes = null;

// Hydrate from localStorage synchronously so the very first render can use
// yesterday's dynamic quotes if today's haven't been fetched yet.
try {
  const raw = localStorage.getItem(QUOTES_KEY);
  if (raw) _dailyQuotes = JSON.parse(raw);
} catch (e) {}

// Kick off a background fetch of today's quotes. No await — the first render
// will use whatever's already in localStorage (or static); later renders pick
// up today's fresh batch.
(async () => {
  try {
    const today = todayUTC();
    if (_dailyQuotes && _dailyQuotes.date === today) return;
    const res = await fetch(`quotes/daily.json?d=${today}`, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    if (!validateQuotes(data)) return;
    _dailyQuotes = data;
    try { localStorage.setItem(QUOTES_KEY, JSON.stringify(data)); } catch (e) {}
  } catch (e) {}
})();

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function validateQuotes(d) {
  if (!d || typeof d.date !== 'string') return false;
  if (!Array.isArray(d.settled) || d.settled.length < 1) return false;
  if (!Array.isArray(d.youOwe) || d.youOwe.length !== 6) return false;
  if (!Array.isArray(d.theyOwe) || d.theyOwe.length !== 6) return false;
  return d.youOwe.every(t => Array.isArray(t) && t.length > 0)
    && d.theyOwe.every(t => Array.isArray(t) && t.length > 0);
}

function getBalanceQuote(balance) {
  const abs = Math.abs(balance);
  const day = Math.floor(Date.now() / 86400000);
  const quotes = (_dailyQuotes && _dailyQuotes.date === todayUTC()) ? _dailyQuotes : STATIC_QUOTES;

  if (abs < 1) return quotes.settled[day % quotes.settled.length];

  const idx = abs < 50 ? 0 : abs < 200 ? 1 : abs < 500 ? 2 : abs < 1000 ? 3 : abs < 5000 ? 4 : 5;
  const pool = balance < 0 ? quotes.youOwe[idx] : quotes.theyOwe[idx];
  return pool[day % pool.length];
}

/** Check if a UID is valid (not null, undefined, or their string equivalents) */
function isValidUid(uid) {
  return uid && uid !== 'null' && uid !== 'undefined';
}

/**
 * Compute the signed USD impact of a single item from the current user's perspective.
 * Positive = money owed TO me, negative = money I owe.
 * Returns 0 if the item can't be attributed (bad UIDs).
 */
function itemImpact(item, myUid) {
  if (item.type === 'expense') {
    const paidByMe = item.paidBy === myUid;
    const owedByMe = item.owedBy === myUid;
    // Validate: at least one UID should be ours
    if (!paidByMe && !owedByMe) {
      // Neither UID is ours — check if either is a valid partner UID
      if (isValidUid(item.paidBy) && !isValidUid(item.owedBy)) {
        // Someone else paid, owedBy is broken — skip
        return 0;
      }
      if (!isValidUid(item.paidBy) && isValidUid(item.owedBy)) {
        return 0;
      }
      return 0;
    }
    if (item.splitType === 'even') {
      return paidByMe ? item.usdAmount / 2 : -item.usdAmount / 2;
    } else {
      // "full" split
      if (paidByMe && !owedByMe) return item.usdAmount;
      if (owedByMe && !paidByMe) return -item.usdAmount;
      return 0; // paidBy === owedBy === me (shouldn't happen)
    }
  }

  if (item.type === 'payment') {
    if (item.paidBy === myUid) return item.usdAmount;
    if (item.paidTo === myUid) return -item.usdAmount;
    // Neither matches — check for bad UIDs
    if (!isValidUid(item.paidBy) && isValidUid(item.paidTo) && item.paidTo !== myUid) return item.usdAmount;
    if (isValidUid(item.paidBy) && item.paidBy !== myUid && !isValidUid(item.paidTo)) return -item.usdAmount;
    return 0;
  }

  if (item.type === 'duel') {
    if (!item.balanceAdjust) return 0;
    if (item.favoredUser === myUid) return item.balanceAdjust;
    if (isValidUid(item.favoredUser)) return -item.balanceAdjust;
    // favoredUser is null — use result.netAdjust as heuristic
    if (item.result?.netAdjust > 0) return item.balanceAdjust;
    if (item.result?.netAdjust < 0) return -item.balanceAdjust;
    return 0;
  }

  return 0;
}

/**
 * Load and render the dashboard.
 */
async function fetchCollections(source) {
  const opts = source ? { source } : undefined;
  const [expSnap, paySnap, duelSnap] = await Promise.all([
    db.collection('expenses').get(opts),
    db.collection('payments').get(opts),
    db.collection('duels').get(opts)
  ]);
  return { expSnap, paySnap, duelSnap };
}

export async function loadDashboard(forceRefresh = false, opts = {}) {
  const { source } = opts; // 'cache' = IndexedDB only (fast), 'server' = network, undefined = default (network with cache fallback when offline)
  const user = getCurrentUser();
  const balanceEl = document.getElementById('balance-display');

  try {
    if (forceRefresh || !_snapshotCache) {
      if (source === 'cache') {
        // Cache-only read: instant if IndexedDB has data, empty snapshots if not.
        // Caller is responsible for scheduling a follow-up network refresh.
        const snaps = await fetchCollections('cache');
        if (snaps.expSnap.empty && snaps.paySnap.empty && snaps.duelSnap.empty) {
          // Nothing in cache — treat as a no-op so the caller falls back to a network load.
          return { cacheEmpty: true };
        }
        _snapshotCache = snaps;
      } else {
        _snapshotCache = await fetchCollections(source);
      }
    }
    const { expSnap, paySnap, duelSnap } = _snapshotCache;

    // Build items list
    const items = [];

    function buildItem(d, docId, type, dateField) {
      const item = {};
      // Copy all simple fields (strings, numbers, booleans, objects)
      for (const [key, val] of Object.entries(d)) {
        if (key === dateField || key === 'date' || key === 'playedAt' || key === 'createdAt') continue;
        item[key] = val;
      }
      item.type = type;
      item.id = docId;
      item.date = toJSDate(d[dateField]);
      item.sortDate = d.source === 'splitwise' ? toJSDate(d[dateField]) : toJSDate(d.createdAt || d[dateField]);
      // Keep raw amount/currency for history display
      item.amount = d.amount;
      item.currency = d.currency;
      return item;
    }

    expSnap.forEach((doc) => {
      try {
        const d = doc.data();
        if (d.paidBy !== user.uid && isValidUid(d.paidBy)) setPartnerInfo(d.paidBy, '');
        if (d.owedBy !== user.uid && isValidUid(d.owedBy)) setPartnerInfo(d.owedBy, '');
        items.push(buildItem(d, doc.id, 'expense', 'date'));
      } catch (e) { console.error('Bad expense doc:', doc.id, e); }
    });

    paySnap.forEach((doc) => {
      try {
        const d = doc.data();
        if (d.paidBy !== user.uid && isValidUid(d.paidBy)) setPartnerInfo(d.paidBy, '');
        if (d.paidTo !== user.uid && isValidUid(d.paidTo)) setPartnerInfo(d.paidTo, '');
        items.push(buildItem(d, doc.id, 'payment', 'date'));
      } catch (e) { console.error('Bad payment doc:', doc.id, e); }
    });

    duelSnap.forEach((doc) => {
      try {
        const d = doc.data();
        items.push(buildItem(d, doc.id, 'duel', 'playedAt'));
      } catch (e) { console.error('Bad duel doc:', doc.id, e); }
    });

    // Recurring items only show in history after processRecurring creates the actual expense

    // Get user preferences
    const balanceView = localStorage.getItem('daumis-debt-balance-view') || 'consolidated';
    const consolCurrency = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
    let symbol = CURRENCY_SYMBOLS[consolCurrency] || consolCurrency;

    // Compute per-currency balances (source of truth)
    const currencyBalances = {};
    for (const item of items) {
      if (item.balanceExcluded) continue;
      if (item.type === 'duel') {
        const impact = itemImpact(item, user.uid);
        if (impact !== 0) {
          currencyBalances['USD'] = (currencyBalances['USD'] || 0) + impact;
        }
      } else if (item.currency) {
        const impact = itemImpact(item, user.uid);
        if (impact !== 0) {
          const sign = impact >= 0 ? 1 : -1;
          const originalAmount = item.type === 'payment'
            ? item.amount * sign
            : (item.splitType === 'even' ? item.amount / 2 : item.amount) * sign;
          currencyBalances[item.currency] = (currencyBalances[item.currency] || 0) + originalAmount;
        }
      }
    }

    // Compute consolidated balance: fetch all exchange rates in parallel
    // Filter out dust balances (< 0.10 USD equivalent)
    const nonZeroCurrencies = Object.entries(currencyBalances).filter(([, a]) => Math.abs(a) >= 0.005);
    const currenciesToFetch = nonZeroCurrencies
      .map(([cur]) => cur)
      .filter(cur => cur !== consolCurrency);

    // Fetch all rates in parallel
    const rateResults = await Promise.allSettled(
      currenciesToFetch.map(async (cur) => {
        const curToUsd = await getExchangeRate(cur);
        return { cur, curToUsd };
      })
    );

    // Also fetch consolCurrency rate if not USD
    let consolToUsd = 1;
    if (consolCurrency !== 'USD') {
      try { consolToUsd = await getExchangeRate(consolCurrency); } catch (e) {}
    }

    const rateCache = {};
    let consolidatedBalance = 0;

    for (const [cur, amount] of nonZeroCurrencies) {
      if (cur === consolCurrency) {
        rateCache[cur] = 1;
        consolidatedBalance += amount;
      } else {
        const result = rateResults.find(r => r.status === 'fulfilled' && r.value.cur === cur);
        if (result) {
          const curToConsol = consolCurrency === 'USD' ? result.value.curToUsd : result.value.curToUsd / consolToUsd;
          rateCache[cur] = curToConsol;
          consolidatedBalance += amount * curToConsol;
        } else {
          console.warn(`Rate unavailable for ${cur}`);
        }
      }
    }
    consolidatedBalance = Math.round(consolidatedBalance * 100) / 100;

    // Remove dust balances (< $0.10 USD equivalent) from display
    const dustCurrencies = [];
    for (const [cur, amt] of Object.entries(currencyBalances)) {
      let usdValue;
      try {
        const curToUsd = await getExchangeRate(cur);
        usdValue = Math.abs(amt * curToUsd);
      } catch (e) {
        usdValue = Math.abs(amt); // assume 1:1 if rate unavailable
      }
      if (usdValue < 0.10) {
        dustCurrencies.push(cur);
      }
    }
    for (const cur of dustCurrencies) {
      delete currencyBalances[cur];
    }

    // Save filtered currency balances and sync used-currencies list
    try {
      localStorage.setItem('daumis-debt-currency-balances', JSON.stringify(currencyBalances));
      // Remove dust currencies from the used-currencies list too
      const activeCurrencies = Object.keys(currencyBalances);
      const usedCurrencies = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
      const filtered = usedCurrencies.filter(c => activeCurrencies.includes(c));
      localStorage.setItem('daumis-debt-used-currencies', JSON.stringify(filtered));
    } catch (e) {}

    // Render balance label
    const label = balanceEl.querySelector('.balance-label');
    const amount = balanceEl.querySelector('.balance-amount');
    const partnerName = getUserName(getPartnerUid());

    if (consolidatedBalance > 0.005) {
      label.textContent = `${partnerName} owes you`;
    } else if (consolidatedBalance < -0.005) {
      label.textContent = `You owe ${partnerName}`;
    } else {
      label.textContent = "You're all settled up!";
    }

    // Build consolidated view
    const consolidatedText = Math.abs(consolidatedBalance) < 0.005
      ? `${symbol}0.00`
      : `${symbol}${formatAmountByDigits(consolidatedBalance)}`;
    const consolidatedClass = consolidatedBalance > 0.005 ? 'positive' : consolidatedBalance < -0.005 ? 'negative' : '';

    // Build breakdown view (reuse nonZeroCurrencies, sort by abs value for display)
    // Use filtered currencyBalances (dust removed) for breakdown display
    const sortedCurrencies = Object.entries(currencyBalances)
      .filter(([, v]) => Math.abs(v) >= 0.005)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    let breakdownHTML = '';
    for (const [cur, val] of sortedCurrencies) {
      const s = CURRENCY_SYMBOLS[cur] || cur;
      const sign = val >= 0 ? '+' : '-';
      const cls = val >= 0 ? 'positive' : 'negative';
      breakdownHTML += `<span class="currency-line ${cls}">${sign}${s}${formatAmountByDigits(val)}</span> `;
    }

    // Render based on preference
    const breakdown = document.getElementById('balance-breakdown');
    const hint = document.getElementById('balance-hint');
    let showingConsolidated = balanceView === 'consolidated';

    function renderBalanceView() {
      if (showingConsolidated) {
        amount.textContent = consolidatedText;
        amount.className = `balance-amount ${consolidatedClass}`;
        amount.style.display = '';
        breakdown.classList.add('hidden');
        hint.textContent = nonZeroCurrencies.length > 0 ? 'tap for currency breakdown' : '';
        hint.classList.toggle('hidden', nonZeroCurrencies.length === 0);
      } else {
        amount.style.display = 'none';
        breakdown.innerHTML = breakdownHTML;
        breakdown.classList.remove('hidden');
        hint.textContent = 'tap for total';
        hint.classList.remove('hidden');
      }
    }

    renderBalanceView();

    // Toggle on tap
    balanceEl.onclick = () => {
      showingConsolidated = !showingConsolidated;
      renderBalanceView();
    };

    // Add fun quote (always visible, at bottom of card)
    let quoteEl = balanceEl.querySelector('.balance-quote');
    if (!quoteEl) {
      quoteEl = document.createElement('p');
      quoteEl.className = 'balance-quote';
      // Append to end of balance card so it's always below everything
      balanceEl.appendChild(quoteEl);
    }
    quoteEl.textContent = getBalanceQuote(consolidatedBalance);

    // Apply mood theme
    applyMood(consolidatedBalance);

    // Persist rendered balance for instant paint on next app open.
    // Always save the consolidated view — if the user has toggled to
    // per-currency breakdown, we still want a valid snapshot to paint.
    saveBalanceSnapshot({
      labelText: label.textContent,
      amountText: consolidatedText,
      amountClass: consolidatedClass
    });

    // On This Day card
    renderOnThisDay(items);

    // Check for weekly duel availability (cached — re-queries only after invalidation)
    const { isDuelAvailable, startDuel } = await import('./duel.js');
    const duelBanner = document.getElementById('duel-banner');
    if (_duelAvailableCache === null) {
      _duelAvailableCache = await isDuelAvailable();
    }
    if (_duelAvailableCache) {
      duelBanner.classList.remove('hidden');
      document.getElementById('btn-play-duel').onclick = startDuel;
    } else {
      duelBanner.classList.add('hidden');
    }

    // Render history — pass rateCache so per-item amounts match the balance card
    renderHistory(items, user.uid, consolidatedBalance, { balanceView, consolCurrency, consolSymbol: symbol, rateCache });

  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

// Emoji sets by tier — emojis only, no color changes
const EMOJI_TIERS = {
  owe: [
    { max: 50, emojis: [] },
    { max: 500, emojis: ['😬','💸'] },
    { max: 1000, emojis: ['🫠','💀','🔥','😰'] },
    { max: 5000, emojis: ['💸','😱','🪦','💀','🔥','😭'] },
    { max: Infinity, emojis: ['🔥','💀','💸','😱','🪦','☠️','😭','🔥','💀','💸'] }
  ],
  owed: [
    { max: 50, emojis: [] },
    { max: 500, emojis: ['😌','☕'] },
    { max: 1000, emojis: ['😏','💅','✨'] },
    { max: 5000, emojis: ['🍾','👑','💰','😏','💅'] },
    { max: Infinity, emojis: ['👑','🏆','💎','🍾','🎩','💰','🤑','👑'] }
  ],
  settled: ['🧘','☮️','🌿']
};

function applyMood(balance) {
  const abs = Math.abs(balance);

  // Pick emojis based on direction and tier
  let emojis;
  if (abs < 1) {
    emojis = EMOJI_TIERS.settled;
  } else {
    const tiers = balance < 0 ? EMOJI_TIERS.owe : EMOJI_TIERS.owed;
    emojis = (tiers.find(t => abs < t.max) || tiers[tiers.length - 1]).emojis;
  }

  // Emojis — burst for 7 seconds then fade
  let emojiContainer = document.getElementById('emoji-burst');
  if (emojiContainer) emojiContainer.remove();

  if (emojis.length > 0) {
    emojiContainer = document.createElement('div');
    emojiContainer.id = 'emoji-burst';
    emojiContainer.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:100;overflow:hidden;transition:opacity 1s;';
    document.body.appendChild(emojiContainer);

    for (let i = 0; i < emojis.length * 2; i++) {
      const emoji = document.createElement('span');
      emoji.textContent = emojis[i % emojis.length];
      emoji.style.cssText = `
        position:absolute;
        font-size:${1 + Math.random() * 0.8}rem;
        left:${5 + Math.random() * 85}%;
        bottom:-30px;
        opacity:0;
        animation: emojiBurst ${2.5 + Math.random() * 2.5}s ease-out ${Math.random() * 3}s forwards;
      `;
      emojiContainer.appendChild(emoji);
    }

    setTimeout(() => {
      if (emojiContainer) {
        emojiContainer.style.opacity = '0';
        setTimeout(() => { if (emojiContainer.parentNode) emojiContainer.remove(); }, 1000);
      }
    }, 7000);
  }
}

function renderHistory(items, myUid, totalBalance, displayOpts) {
  const { balanceView, consolCurrency, consolSymbol, rateCache } = displayOpts;
  const showOriginal = balanceView === 'breakdown';

  const list = document.getElementById('history-list');
  items = items.filter(item => !item.balanceExcluded);
  items.sort((a, b) => (b.sortDate || b.date) - (a.sortDate || a.date));
  list.innerHTML = '';

  if (items.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No history yet. Tap + to add an expense.</li>';
    return;
  }

  function fmtCurrency(amount, currency) {
    const sym = CURRENCY_SYMBOLS[currency] || currency + ' ';
    return `${sym}${formatAmountByDigits(amount)}`;
  }

  function fmtConsol(item, impact) {
    if (!item.currency) return `${consolSymbol}0.00`;
    const rate = rateCache[item.currency] || 1;
    const origAmount = item.type === 'payment'
      ? item.amount
      : (item.splitType === 'even' ? item.amount / 2 : item.amount);
    const consolAmount = Math.abs(origAmount) * rate;
    return `${consolSymbol}${formatAmountByDigits(consolAmount)}`;
  }

  function fmtDuelConsol(usdAmount) {
    const rate = rateCache['USD'] || 1;
    const consolAmount = Math.abs(usdAmount) * rate;
    return `${consolSymbol}${formatAmountByDigits(consolAmount)}`;
  }

  items.forEach((item) => {
    try {
      const li = document.createElement('li');
      const dateStr = formatDate(item.date);

      const impact = itemImpact(item, myUid);
      const isCredit = impact >= 0;
      const sign = isCredit ? '+' : '-';

      const paidByName = item.paidBy === myUid ? getUserName(myUid) : getUserName(item.paidBy);

      let contentHTML = '';

      if (item.type === 'expense') {
        const fullSym = CURRENCY_SYMBOLS[item.currency] || item.currency + ' ';
        const splitLabel = item.splitType === 'even' ? 'split' : 'full';
        const metaLine = `${dateStr} · ${paidByName} paid ${fullSym}${item.amount.toLocaleString()} · ${splitLabel}`;
        let displayAmt;
        if (showOriginal && item.currency) {
          displayAmt = `${sign}${fmtCurrency(item.splitType === 'even' ? item.amount / 2 : item.amount, item.currency)}`;
        } else {
          displayAmt = `${sign}${fmtConsol(item, impact)}`;
        }
        contentHTML = `
          <div class="entry-icon expense">${categorize(item.description).icon}</div>
          <div class="entry-info">
            <div class="entry-desc">${item.description || 'Expense'}</div>
            <div class="entry-meta">${metaLine}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;

      } else if (item.type === 'payment') {
        const paidToName = item.paidTo === myUid ? getUserName(myUid) : getUserName(item.paidTo);
        const fullSym = CURRENCY_SYMBOLS[item.currency] || item.currency + ' ';
        const metaLine = `${dateStr} · ${paidByName} paid ${paidToName} · ${fullSym}${item.amount.toLocaleString()}`;
        let displayAmt;
        if (showOriginal && item.currency) {
          displayAmt = `${sign}${fmtCurrency(item.amount, item.currency)}`;
        } else {
          displayAmt = `${sign}${fmtConsol(item, impact)}`;
        }
        contentHTML = `
          <div class="entry-icon payment">↗</div>
          <div class="entry-info">
            <div class="entry-desc">Settle up</div>
            <div class="entry-meta">${metaLine}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;

      } else if (item.type === 'duel') {
        let displayAmt;
        if (showOriginal) {
          displayAmt = `${sign}$${Math.abs(item.balanceAdjust || 0).toFixed(2)}`;
        } else {
          displayAmt = `${sign}${fmtDuelConsol(impact)}`;
        }
        const playerName = item.playedBy
          ? (item.playedBy === myUid ? getUserName(myUid) : getUserName(item.playedBy))
          : null;
        const duelMeta = `${dateStr} · Week ${item.week}${playerName ? ` · ${playerName} played` : ''}`;
        contentHTML = `
          <div class="entry-icon duel">⚔</div>
          <div class="entry-info">
            <div class="entry-desc">${item.game || 'Duel'}</div>
            <div class="entry-meta">${duelMeta}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;
      }

      // Wrap in swipe container with delete button behind
      const canDelete = item.type === 'expense' || item.type === 'payment';
      if (canDelete) {
        li.innerHTML = `
          <div class="swipe-delete"><span class="swipe-delete-text">Delete</span></div>
          <div class="swipe-content">${contentHTML}</div>`;

        const content = li.querySelector('.swipe-content');
        const deleteBtn = li.querySelector('.swipe-delete');
        const deleteText = li.querySelector('.swipe-delete-text');
        let startX = 0, startY = 0, swiping = false, decided = false;

        content.addEventListener('touchstart', (e) => {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          swiping = false;
          decided = false;
          content.style.transition = 'none';
          deleteText.style.transition = 'none';
        }, { passive: true });

        content.addEventListener('touchmove', (e) => {
          const dx = e.touches[0].clientX - startX;
          const dy = e.touches[0].clientY - startY;
          if (!decided) {
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
              decided = true;
              swiping = dx < -5 && Math.abs(dx) > Math.abs(dy);
              if (swiping) {
                // Immediately lock scrolling
                e.preventDefault();
                e.stopPropagation();
                // Disable scroll on parent
                const scrollParent = content.closest('.dashboard-content');
                if (scrollParent) scrollParent.style.overflow = 'hidden';
              }
            }
            return;
          }
          if (swiping) {
            e.preventDefault();
            e.stopPropagation();
            if (dx < 0) {
              const clampedDx = Math.max(dx, -200);
              content.style.transform = `translateX(${clampedDx}px)`;
              const textOffset = Math.min(Math.abs(clampedDx) - 60, 0);
              deleteText.style.transform = `translateX(${textOffset}px)`;
            }
          }
        }, { passive: false });

        async function handleDelete() {
          const isRecurring = item.description?.includes('(recurring)');
          const collection = item.type === 'expense' ? 'expenses' : 'payments';

          if (isRecurring) {
            const choice = prompt('This is a recurring expense.\nType "one" to delete just this one, or "all" to cancel all future charges.');
            if (!choice) { content.style.transform = ''; deleteText.style.transform = ''; return; }
            if (choice.toLowerCase() === 'all') {
              try {
                const { getRecurring, deactivateRecurring } = await import('./recurring.js');
                const recurrings = await getRecurring();
                const match = recurrings.find(r => item.description.replace(' (recurring)', '') === r.description);
                if (match) await deactivateRecurring(match.id);
              } catch (e) { console.warn('Could not cancel recurring:', e); }
            }
            if (choice.toLowerCase() !== 'one' && choice.toLowerCase() !== 'all') { content.style.transform = ''; deleteText.style.transform = ''; return; }
          } else {
            if (!confirm('Delete this entry?')) { content.style.transform = ''; deleteText.style.transform = ''; return; }
          }

          try {
            const { db } = await import('./firebase-config.js');
            await db.collection(collection).doc(item.id).delete();
            li.style.transition = 'opacity 0.3s, max-height 0.3s';
            li.style.opacity = '0';
            li.style.maxHeight = '0';
            li.style.overflow = 'hidden';
            setTimeout(() => li.remove(), 300);
          } catch (err) {
            console.error('Delete failed:', err);
            alert('Failed to delete.');
            content.style.transform = '';
          }
        }

        content.addEventListener('touchend', (e) => {
          // Re-enable scrolling on parent
          const scrollParent = content.closest('.dashboard-content');
          if (scrollParent) scrollParent.style.overflow = '';

          if (!swiping) {
            content.style.transition = 'transform 0.2s ease-out';
            deleteText.style.transition = 'transform 0.2s ease-out';
            content.style.transform = '';
            deleteText.style.transform = '';
            return;
          }
          const dx = e.changedTouches[0].clientX - startX;
          content.style.transition = 'transform 0.2s ease-out';
          deleteText.style.transition = 'transform 0.2s ease-out';
          if (dx < -150) {
            content.style.transform = 'translateX(-200px)';
            handleDelete();
          } else {
            content.style.transform = '';
            deleteText.style.transform = '';
          }
        }, { passive: true });

        // Tap delete button also works
        deleteBtn.addEventListener('click', () => handleDelete());

        // Tap content to edit
        content.addEventListener('click', (e) => {
          if (Math.abs(parseFloat(content.style.transform?.match(/-?\d+/)?.[0] || 0)) > 10) {
            // Swiped open — close instead of navigating
            content.style.transition = 'transform 0.2s ease-out';
            content.style.transform = '';
            return;
          }
          editEntry(item.type, item);
        });
      } else {
        // Duels — no swipe delete, just display
        li.innerHTML = `<div class="swipe-content">${contentHTML}</div>`;
      }

      list.appendChild(li);
    } catch (e) {
      console.error('Error rendering item:', item, e);
    }
  });

}

function toJSDate(d) {
  try {
    if (typeof d?.toDate === 'function') return d.toDate();
    if (typeof d?.seconds === 'number') return new Date(d.seconds * 1000);
    if (d instanceof Date) return d;
    const parsed = new Date(d);
    if (!isNaN(parsed)) return parsed;
  } catch (e) {}
  return new Date();
}

function formatDate(d) {
  try {
    const jsDate = d instanceof Date ? d : toJSDate(d);
    return jsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
}

export function editEntry(type, data) {
  window.dispatchEvent(new CustomEvent('edit-entry', { detail: { type, data } }));
}

export async function computeCurrencyBalances() {
  const user = getCurrentUser();
  const [expSnap, paySnap, duelSnap] = await Promise.all([
    db.collection('expenses').get(),
    db.collection('payments').get(),
    db.collection('duels').get()
  ]);

  let balance = 0;
  const currencyBalances = {};

  expSnap.forEach((doc) => {
    const d = doc.data();
    if (d.balanceExcluded) return;
    d.type = 'expense';
    const impact = itemImpact(d, user.uid);
    balance += impact;
    if (d.currency) {
      const sign = impact >= 0 ? 1 : -1;
      const originalAmount = (d.splitType === 'even' ? d.amount / 2 : d.amount) * sign;
      currencyBalances[d.currency] = (currencyBalances[d.currency] || 0) + originalAmount;
    }
  });

  paySnap.forEach((doc) => {
    const d = doc.data();
    if (d.balanceExcluded) return;
    d.type = 'payment';
    const impact = itemImpact(d, user.uid);
    balance += impact;
    if (d.currency) {
      const sign = impact >= 0 ? 1 : -1;
      const originalAmount = d.amount * sign;
      currencyBalances[d.currency] = (currencyBalances[d.currency] || 0) + originalAmount;
    }
  });

  duelSnap.forEach((doc) => {
    const d = doc.data();
    if (d.balanceExcluded) return;
    d.type = 'duel';
    const impact = itemImpact(d, user.uid);
    balance += impact;
    if (impact !== 0) {
      currencyBalances['USD'] = (currencyBalances['USD'] || 0) + impact;
    }
  });

  return { balance: Math.round(balance * 100) / 100, currencyBalances };
}

// Export for games that need balance to determine debtor
export async function computeBalance() {
  const { currencyBalances } = await computeCurrencyBalances();
  let usdTotal = 0;
  for (const [cur, amount] of Object.entries(currencyBalances)) {
    if (Math.abs(amount) < 0.005) continue;
    try {
      const rate = await getExchangeRate(cur);
      usdTotal += amount * rate;
    } catch (e) {}
  }
  return Math.round(usdTotal * 100) / 100;
}

/**
 * Render the "On This Day" polaroid card if there's a matching expense
 * from a previous year on today's month+day.
 */
function renderOnThisDay(items) {
  const container = document.getElementById('otd-card');
  if (!container) return;

  // Check if dismissed today
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  if (localStorage.getItem('otd-dismissed') === todayStr) {
    container.classList.add('hidden');
    return;
  }

  const todayMonth = today.getMonth();
  const todayDay = today.getDate();
  const todayYear = today.getFullYear();

  // Until July 30, 2026: also match 6 months ago (same day).
  // After that, only match same day in previous years.
  const useHalfYear = today < new Date(2026, 6, 31); // months are 0-indexed, so 6 = July
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const lookbackMonth = sixMonthsAgo.getMonth();
  const lookbackDay = sixMonthsAgo.getDate();

  const matches = items.filter(item => {
    if (item.type !== 'expense') return false;
    const d = item.date;
    if (!d) return false;
    // Always match same day in previous years
    if (d.getMonth() === todayMonth && d.getDate() === todayDay && d.getFullYear() < todayYear) return true;
    // Before July 30, 2026: also match ~6 months ago
    if (useHalfYear && d.getMonth() === lookbackMonth && d.getDate() === lookbackDay && d < today) return true;
    return false;
  });

  if (matches.length === 0) {
    container.classList.add('hidden');
    return;
  }

  // Pick one at random
  const memory = matches[Math.floor(Math.random() * matches.length)];
  const diffMs = today - memory.date;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const diffMonths = Math.round(diffDays / 30);
  const yearsAgo = todayYear - memory.date.getFullYear();
  const timeLabel = yearsAgo >= 1 && memory.date.getMonth() === todayMonth
    ? `${yearsAgo} year${yearsAgo > 1 ? 's' : ''} ago`
    : `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  const dateStr = memory.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const symbol = CURRENCY_SYMBOLS[memory.currency] || memory.currency + ' ';
  const amount = `${symbol}${memory.amount.toLocaleString()}`;

  container.innerHTML = `
    <div class="otd-polaroid">
      <div class="otd-top">
        <span class="otd-tag">On this day · ${timeLabel}</span>
        <button class="otd-dismiss" id="otd-dismiss">×</button>
      </div>
      <div class="otd-desc">${memory.description}</div>
      <div class="otd-details">
        <span class="otd-date">${dateStr}</span>
        <span class="otd-amount">${amount}</span>
      </div>
    </div>`;
  container.classList.remove('hidden');

  document.getElementById('otd-dismiss').addEventListener('click', () => {
    localStorage.setItem('otd-dismissed', todayStr);
    container.classList.add('hidden');
  });
}
