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

const BALANCE_SNAPSHOT_KEY = 'gapara-balance-snapshot';

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
 * and settle-up amounts so large KRW numbers don't overflow the layout.
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

function categorize(description) {
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
    "딱 맞네. 수상할 정도로.",
    "빚 제로. 이상해. 누구세요?",
    "아무도 불평할 수 없는 희귀한 순간."
  ],
  youOwe: [
    ["치킨 한 마리 값도 안 돼. 굳이 기록한 게 민망하다.", "편의점 영수증보다 적어. 근데 그게 더 쪽팔려.", "이 빚은 작아서 열등감이 있을 정도다."],
    ["저녁 한 번은 사야겠는데. 제대로 된 걸로.", "'다음에 내가 살게' 시전한 지 아홉 번째.", "상대는 화난 게 아니야. 실망했을 뿐이고, 기록 중이다."],
    ["네 빚이 링크드인 프로필을 만들었어.", "어떤 나라에서는 이 돈으로 염소를 산다. 좋은 염소로.", "갚든가, 평생 눈을 못 마주치든가. 선택해."],
    ["비행기 티켓 값. 이코노미, 가운데 좌석. 그만한 자격이야.", "'부탁 없이 집안일 다 할게' 수준의 금액이다.", "네 빚이 전세 대출을 신청했다."],
    ["안 치는 기타 팔아.", "네 빚이 너보다 인생 계획이 확실해.", "이 금액이면 소규모 사이비 종교 하나 차릴 수 있다. 그냥 말해봤다."],
    ["이건 연애가 아니야. 이자 붙은 서브프라임이다.", "네 빚은 이제 자기 의견이 생길 나이야.", "재정적으로는 이미 잠적해야 할 규모다."]
  ],
  theyOwe: [
    ["상대가 잔돈만큼 갚을 게 있네. 그래도 계속 언급해라.", "쪼잔하다고? 아니. 재정 감시 중이다.", "원칙의 문제야. 아주 작은, 작은 원칙."],
    ["화장실에 앱 켜놓고 나와. 상대가 보게.", "상대가 저녁 데이트 플래닝하고 돈도 내야 하는 금액이다.", "마사지 한 번 받을 돈. 팔꿈치로 하게 두지 마라."],
    ["넌 연인이 아니라, 상대 씀씀이의 후원자다.", "스파 주말 값. 가운 포함. 보송보송한 가운.", "상대가 뭐 살 때마다 큰 소리로 헛기침해라."],
    ["상대가 휴가 한 번은 보내줘야 한다. 호텔은 네가 골라. 상대는 바닥에서 자.", "요리로 이자 받아. 특히 상대 요리로.", "기본적으로 감정 있는 사채업자다."],
    ["너 완전 자선사업가인데 아무도 상 안 줬네.", "상대 빚이면 네가 아주 못생긴 배 한 척 살 수 있다. 그 배 받을 자격 있다.", "이 연애는 대차대조표고 넌 자산 쪽이다."],
    ["넌 연인이 아니야. 유기불안 있는 벤처캐피털이다.", "상대 빚이 지역 번호를 따로 가질 정도다.", "이 정도면 그냥 출생신고서에 네 이름 올려."]
  ]
};

const QUOTES_KEY = 'gapara-daily-quotes-v1';
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
    const balanceView = localStorage.getItem('gapara-balance-view') || 'consolidated';
    const consolCurrency = localStorage.getItem('gapara-consol-currency') || 'KRW';
    let symbol = CURRENCY_SYMBOLS[consolCurrency] || consolCurrency;

    // Compute per-currency balances (source of truth)
    const currencyBalances = {};
    for (const item of items) {
      if (item.balanceExcluded) continue;
      if (item.type === 'duel') {
        const impact = itemImpact(item, user.uid);
        if (impact !== 0) {
          currencyBalances['KRW'] = (currencyBalances['KRW'] || 0) + impact;
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
      localStorage.setItem('gapara-currency-balances', JSON.stringify(currencyBalances));
      // Remove dust currencies from the used-currencies list too
      const activeCurrencies = Object.keys(currencyBalances);
      const usedCurrencies = JSON.parse(localStorage.getItem('gapara-used-currencies') || '[]');
      const filtered = usedCurrencies.filter(c => activeCurrencies.includes(c));
      localStorage.setItem('gapara-used-currencies', JSON.stringify(filtered));
    } catch (e) {}

    // Render balance label
    const label = balanceEl.querySelector('.balance-label');
    const amount = balanceEl.querySelector('.balance-amount');
    const partnerName = getUserName(getPartnerUid());

    if (consolidatedBalance > 0.005) {
      label.textContent = `${partnerName}에게 받을 돈`;
    } else if (consolidatedBalance < -0.005) {
      label.textContent = `${partnerName}에게 갚을 돈`;
    } else {
      label.textContent = "정산 완료!";
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
        hint.textContent = nonZeroCurrencies.length > 0 ? '탭해서 통화별로 보기' : '';
        hint.classList.toggle('hidden', nonZeroCurrencies.length === 0);
      } else {
        amount.style.display = 'none';
        breakdown.innerHTML = breakdownHTML;
        breakdown.classList.remove('hidden');
        hint.textContent = '탭해서 합계 보기';
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
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">아직 기록이 없습니다. +를 눌러 지출을 추가하세요.</li>';
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

  function fmtDuelConsol(krwAmount) {
    const rate = rateCache['KRW'] || 1;
    const consolAmount = Math.abs(krwAmount) * rate;
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
        const splitLabel = item.splitType === 'even' ? '반반' : '전액';
        const metaLine = `${dateStr} · ${paidByName} 결제 ${fullSym}${item.amount.toLocaleString()} · ${splitLabel}`;
        let displayAmt;
        if (showOriginal && item.currency) {
          displayAmt = `${sign}${fmtCurrency(item.splitType === 'even' ? item.amount / 2 : item.amount, item.currency)}`;
        } else {
          displayAmt = `${sign}${fmtConsol(item, impact)}`;
        }
        contentHTML = `
          <div class="entry-icon expense">${categorize(item.description).icon}</div>
          <div class="entry-info">
            <div class="entry-desc">${item.description || '지출'}</div>
            <div class="entry-meta">${metaLine}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;

      } else if (item.type === 'payment') {
        const paidToName = item.paidTo === myUid ? getUserName(myUid) : getUserName(item.paidTo);
        const fullSym = CURRENCY_SYMBOLS[item.currency] || item.currency + ' ';
        const metaLine = `${dateStr} · ${paidByName} → ${paidToName} · ${fullSym}${item.amount.toLocaleString()}`;
        let displayAmt;
        if (showOriginal && item.currency) {
          displayAmt = `${sign}${fmtCurrency(item.amount, item.currency)}`;
        } else {
          displayAmt = `${sign}${fmtConsol(item, impact)}`;
        }
        contentHTML = `
          <div class="entry-icon payment">↗</div>
          <div class="entry-info">
            <div class="entry-desc">정산</div>
            <div class="entry-meta">${metaLine}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;

      } else if (item.type === 'duel') {
        let displayAmt;
        if (showOriginal) {
          displayAmt = `${sign}₩${Math.abs(item.balanceAdjust || 0).toLocaleString()}`;
        } else {
          displayAmt = `${sign}${fmtDuelConsol(impact)}`;
        }
        const playerName = item.playedBy
          ? (item.playedBy === myUid ? getUserName(myUid) : getUserName(item.playedBy))
          : null;
        const duelMeta = `${dateStr} · ${item.week}주차${playerName ? ` · ${playerName} 플레이` : ''}`;
        contentHTML = `
          <div class="entry-icon duel">⚔</div>
          <div class="entry-info">
            <div class="entry-desc">${item.game || '결투'}</div>
            <div class="entry-meta">${duelMeta}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;
      }

      // Wrap in swipe container with delete button behind
      const canDelete = item.type === 'expense' || item.type === 'payment';
      if (canDelete) {
        li.innerHTML = `
          <div class="swipe-delete"><span class="swipe-delete-text">삭제</span></div>
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
    return jsDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
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
      currencyBalances['KRW'] = (currencyBalances['KRW'] || 0) + impact;
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

  // Pick deterministically for today so repeat renders (cache-first then
  // network refresh) don't flicker between two different memories.
  const daySeed = Math.floor(today.getTime() / 86400000);
  const memory = matches[daySeed % matches.length];
  const diffMs = today - memory.date;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const diffMonths = Math.round(diffDays / 30);
  const yearsAgo = todayYear - memory.date.getFullYear();
  const timeLabel = yearsAgo >= 1 && memory.date.getMonth() === todayMonth
    ? `${yearsAgo}년 전`
    : `${diffMonths}개월 전`;
  const dateStr = memory.date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const symbol = CURRENCY_SYMBOLS[memory.currency] || memory.currency + ' ';
  const amount = `${symbol}${memory.amount.toLocaleString()}`;

  container.innerHTML = `
    <div class="otd-polaroid">
      <div class="otd-top">
        <span class="otd-tag">오늘의 기억 · ${timeLabel}</span>
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
