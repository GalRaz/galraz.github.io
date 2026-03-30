import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName, setPartnerInfo } from './app.js';
import { getExchangeRate } from './exchange.js';

const CURRENCY_SYMBOLS = {
  USD:'$', EUR:'€', GBP:'£', JPY:'¥', THB:'฿', BTN:'Nu ', TWD:'NT$', KRW:'₩',
  CNY:'¥', INR:'₹', AUD:'A$', CAD:'C$', CHF:'Fr', SGD:'S$', HKD:'HK$', NZD:'NZ$',
  SEK:'kr', NOK:'kr', DKK:'kr', MXN:'$', BRL:'R$', PLN:'zł', CZK:'Kč', HUF:'Ft',
  ILS:'₪', TRY:'₺', ZAR:'R', PHP:'₱', MYR:'RM', IDR:'Rp'
};

function categorize(description) {
  if (!description) return { icon: '$', label: 'other' };
  const d = description.toLowerCase();

  const categories = [
    { keywords: ['grocery', 'groceries', 'supermarket', 'market', 'food', 'produce'], icon: '🛒', label: 'groceries' },
    { keywords: ['restaurant', 'dinner', 'lunch', 'breakfast', 'cafe', 'coffee', 'eat', 'sushi', 'pizza', 'burger', 'ramen', 'noodle', 'brunch', 'bistro', 'datshi', 'thai', 'korean', 'japanese', 'indian', 'chinese', 'mexican', 'italian', 'pastry', 'bakery', 'bar', 'pub', 'beer', 'wine', 'drink', 'cocktail'], icon: '🍽️', label: 'dining' },
    { keywords: ['flight', 'flights', 'airline', 'airport', 'plane', 'boarding'], icon: '✈️', label: 'flights' },
    { keywords: ['hotel', 'hostel', 'airbnb', 'accommodation', 'stay', 'booking', 'resort'], icon: '🏨', label: 'lodging' },
    { keywords: ['uber', 'lyft', 'taxi', 'cab', 'bus', 'train', 'metro', 'subway', 'transport', 'transit', 'grab', 'bolt'], icon: '🚕', label: 'transport' },
    { keywords: ['gas', 'fuel', 'petrol', 'parking', 'car', 'rental', 'toll'], icon: '⛽', label: 'auto' },
    { keywords: ['movie', 'cinema', 'ticket', 'concert', 'show', 'museum', 'park', 'tour', 'attraction', 'entertainment', 'game'], icon: '🎬', label: 'entertainment' },
    { keywords: ['rent', 'electric', 'electricity', 'water', 'internet', 'wifi', 'utility', 'utilities', 'bill', 'phone'], icon: '🏠', label: 'housing' },
    { keywords: ['doctor', 'hospital', 'medicine', 'pharmacy', 'health', 'medical', 'dental'], icon: '💊', label: 'health' },
    { keywords: ['clothes', 'clothing', 'shoes', 'shirt', 'dress', 'shopping', 'mall', 'store', 'shop'], icon: '🛍️', label: 'shopping' },
    { keywords: ['gift', 'present', 'birthday', 'anniversary'], icon: '🎁', label: 'gifts' },
    { keywords: ['splitwise', 'balance', 'transfer', 'settle'], icon: '📊', label: 'balance' },
  ];

  for (const cat of categories) {
    if (cat.keywords.some(kw => d.includes(kw))) return cat;
  }
  return { icon: '$', label: 'other' };
}

function getBalanceQuote(balance) {
  const abs = Math.abs(balance);
  const day = Math.floor(Date.now() / 86400000);

  const settledQuotes = [
    "Perfectly balanced, as all things should be.",
    "Zero debt. Suspicious. Who are you people?",
    "The rare moment where nobody can complain."
  ];

  // Negative balance = you owe
  const youOweQuotes = [
    ["That's barely a kebab and a beer. Embarrassing to even track.", "You owe less than a parking ticket. Somehow that's worse.", "This debt is so small it has an inferiority complex."],
    ["You owe a nice dinner. One where you chew with your mouth closed.", "This is 'I'll grab the next one' except you've said that nine times.", "Your partner is not mad. Just disappointed. And keeping score."],
    ["Your debt just got a LinkedIn profile.", "That's enough to buy a goat in some countries. A NICE goat.", "You could pay this off or you could avoid eye contact forever. Your call."],
    ["You now owe a plane ticket. Economy. Middle seat. You deserve it.", "This is 'I will do literally any household chore without being asked' money.", "Your debt just applied for a mortgage."],
    ["Sell the guitar you don't play.", "Your debt has more life goals than you do.", "This amount of money could start a small cult. Just saying."],
    ["You don't have a relationship. You have a subprime loan with cuddling.", "Your debt is old enough to have opinions.", "Consider faking your own death. Financially speaking."]
  ];

  // Positive balance = they owe you
  const theyOweQuotes = [
    ["They owe you pocket change. Bring it up constantly anyway.", "Petty? No. Financially vigilant? Absolutely.", "It's the principle. The tiny, tiny principle."],
    ["Leave this app open on the toilet. They'll see it.", "That's a date night THEY'RE planning AND paying for.", "You're owed a massage. Don't let them use their elbows though."],
    ["You're not a partner, you're a patron of the arts of spending.", "That's a spa weekend. Robes included. FLUFFY robes.", "Start clearing your throat loudly whenever they buy something."],
    ["They owe you a vacation. You pick the hotel. They sleep on the floor.", "Charge interest in cooking. Specifically, THEIR cooking.", "You're basically a loan shark but with feelings."],
    ["You're a whole-ass philanthropist and nobody gave you a trophy.", "Their debt could buy you a very ugly boat. You deserve that boat.", "This relationship has a balance sheet and you are the asset."],
    ["You're not a partner. You're a venture capitalist with abandonment issues.", "Their debt has its own area code.", "At this point, just put your name on their birth certificate."]
  ];

  if (abs < 1) return settledQuotes[day % settledQuotes.length];

  const idx = abs < 50 ? 0 : abs < 200 ? 1 : abs < 500 ? 2 : abs < 1000 ? 3 : abs < 5000 ? 4 : 5;
  const pool = balance < 0 ? youOweQuotes[idx] : theyOweQuotes[idx];
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
export async function loadDashboard() {
  const user = getCurrentUser();
  const balanceEl = document.getElementById('balance-display');

  try {
    // Fetch all data once
    const [expSnap, paySnap, duelSnap] = await Promise.all([
      db.collection('expenses').get(),
      db.collection('payments').get(),
      db.collection('duels').get()
    ]);

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

    // Compute USD balance and per-currency balances
    let balance = 0;
    const currencyBalances = {}; // { 'THB': 500, 'USD': -20, ... }
    for (const item of items) {
      if (item.balanceExcluded) continue;
      const impact = itemImpact(item, user.uid);
      balance += impact;
      // Track per-currency: use the original amount with the correct sign
      if (item.currency && item.type !== 'duel') {
        const sign = impact >= 0 ? 1 : -1;
        const originalAmount = (item.splitType === 'even' ? item.amount / 2 : item.amount) * sign;
        currencyBalances[item.currency] = (currencyBalances[item.currency] || 0) + originalAmount;
      }
    }
    balance = Math.round(balance * 100) / 100;

    // Get user preferences
    const balanceView = localStorage.getItem('daumis-debt-balance-view') || 'consolidated';
    const consolCurrency = localStorage.getItem('daumis-debt-consol-currency') || 'USD';

    // Convert USD balance to consolidation currency
    let displayBalance = balance;
    let symbol = CURRENCY_SYMBOLS[consolCurrency] || consolCurrency;
    if (consolCurrency !== 'USD') {
      try {
        const rate = await getExchangeRate(consolCurrency); // rate = consolCurrency → USD
        displayBalance = Math.round((balance / rate) * 100) / 100; // USD → consolCurrency
      } catch (e) { console.warn('Could not convert to', consolCurrency); }
    }

    // Render balance label
    const label = balanceEl.querySelector('.balance-label');
    const amount = balanceEl.querySelector('.balance-amount');
    const partnerName = getUserName(getPartnerUid());

    if (balance > 0.005) {
      label.textContent = `${partnerName} owes you`;
    } else if (balance < -0.005) {
      label.textContent = `You owe ${partnerName}`;
    } else {
      label.textContent = "You're all settled up!";
    }

    // Build consolidated view
    const consolidatedText = Math.abs(balance) < 0.005
      ? `${symbol}0.00`
      : `${symbol}${Math.abs(displayBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const consolidatedClass = balance > 0.005 ? 'positive' : balance < -0.005 ? 'negative' : '';

    // Build breakdown view
    const nonZeroCurrencies = Object.entries(currencyBalances)
      .filter(([, v]) => Math.abs(v) > 0.005)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    let breakdownHTML = '';
    for (const [cur, val] of nonZeroCurrencies) {
      const rounded = Math.round(Math.abs(val) * 100) / 100;
      const s = CURRENCY_SYMBOLS[cur] || cur;
      const sign = val >= 0 ? '+' : '-';
      const cls = val >= 0 ? 'positive' : 'negative';
      breakdownHTML += `<span class="currency-line ${cls}">${sign}${s}${rounded.toLocaleString()}</span> `;
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
    quoteEl.textContent = getBalanceQuote(balance);

    // Apply mood theme
    applyMood(balance);

    // On This Day card
    renderOnThisDay(items);

    // Check for weekly duel availability
    const { isDuelAvailable, startDuel } = await import('./duel.js');
    const duelBanner = document.getElementById('duel-banner');
    if (await isDuelAvailable()) {
      duelBanner.classList.remove('hidden');
      document.getElementById('btn-play-duel').onclick = startDuel;
    } else {
      duelBanner.classList.add('hidden');
    }

    // Render history using same itemImpact for consistency
    // Pass display preferences so amounts match the balance card
    let usdToConsolRate = 1;
    if (consolCurrency !== 'USD') {
      try {
        const rate = await getExchangeRate(consolCurrency);
        usdToConsolRate = 1 / rate; // USD → consolCurrency
      } catch (e) {}
    }
    renderHistory(items, user.uid, balance, { balanceView, consolCurrency, consolSymbol: symbol, usdToConsolRate });

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
  const { balanceView, consolCurrency, consolSymbol, usdToConsolRate } = displayOpts;
  const showOriginal = balanceView === 'breakdown';

  const list = document.getElementById('history-list');
  items = items.filter(item => !item.balanceExcluded);
  items.sort((a, b) => b.date - a.date);
  list.innerHTML = '';

  if (items.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No history yet. Tap + to add an expense.</li>';
    return;
  }

  /**
   * Format the display amount for a history entry.
   * - "breakdown" mode: show in original currency (e.g. ฿500, ¥45,133)
   * - "consolidated" mode: show in consolidation currency (e.g. $282.08)
   */
  function formatEntryAmount(item, impact) {
    const sign = impact >= 0 ? '+' : '-';

    if (showOriginal && item.currency) {
      // Show original currency amount
      const sym = CURRENCY_SYMBOLS[item.currency] || item.currency + ' ';
      const origAmount = item.splitType === 'even' ? item.amount / 2 : item.amount;
      const rounded = Math.round(Math.abs(origAmount) * 100) / 100;
      return `${sign}${sym}${rounded.toLocaleString(undefined, { minimumFractionDigits: rounded % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
    }

    // Consolidated: convert USD impact to consolidation currency
    const consolAmount = Math.abs(impact) * usdToConsolRate;
    const rounded = Math.round(consolAmount * 100) / 100;
    return `${sign}${consolSymbol}${rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  let historySum = 0;

  items.forEach((item) => {
    try {
      const li = document.createElement('li');
      const dateStr = formatDate(item.date);
      const impact = itemImpact(item, myUid);
      historySum += impact;
      const isCredit = impact >= 0;
      const displayAmt = formatEntryAmount(item, impact);

      // Meta line: show the "other" format as context
      let metaAmount = '';
      if (showOriginal && item.currency) {
        // In breakdown mode, show consolidated equivalent in meta
        const consolAmt = Math.abs(impact) * usdToConsolRate;
        metaAmount = ` · ${consolSymbol}${Math.round(consolAmt * 100 / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else if (!showOriginal && item.currency && item.currency !== consolCurrency) {
        // In consolidated mode, show original amount in meta
        metaAmount = ` · ${item.amount} ${item.currency}`;
      }

      if (item.type === 'expense') {
        const splitLabel = item.splitType === 'even' ? 'split' : 'full';
        li.innerHTML = `
          <div class="entry-icon expense">${categorize(item.description).icon}</div>
          <div class="entry-info">
            <div class="entry-desc">${item.description || 'Expense'}</div>
            <div class="entry-meta">${dateStr}${metaAmount} · ${splitLabel}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => editEntry(item.type, item));
      } else if (item.type === 'payment') {
        li.innerHTML = `
          <div class="entry-icon payment">↗</div>
          <div class="entry-info">
            <div class="entry-desc">Settle up</div>
            <div class="entry-meta">${dateStr}${metaAmount}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => editEntry(item.type, item));
      } else if (item.type === 'duel') {
        li.innerHTML = `
          <div class="entry-icon duel">⚔</div>
          <div class="entry-info">
            <div class="entry-desc">${item.game || 'Duel'}</div>
            <div class="entry-meta">${dateStr} · Week ${item.week}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">${displayAmt}</div>`;
      }
      list.appendChild(li);
    } catch (e) {
      console.error('Error rendering item:', item, e);
    }
  });

  historySum = Math.round(historySum * 100) / 100;
  if (Math.abs(historySum - totalBalance) > 0.01) {
    console.error(`CONSISTENCY ERROR: balance=$${totalBalance}, history sum=$${historySum}, diff=$${(totalBalance - historySum).toFixed(2)}`);
  }
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

// Export for games that need balance to determine debtor
export async function computeBalance() {
  const user = getCurrentUser();
  const [expSnap, paySnap, duelSnap] = await Promise.all([
    db.collection('expenses').get(),
    db.collection('payments').get(),
    db.collection('duels').get()
  ]);

  let balance = 0;
  const processSnap = (snap, type, dateField) => {
    snap.forEach((doc) => {
      const d = doc.data();
      if (d.balanceExcluded) return;
      d.type = type;
      balance += itemImpact(d, user.uid);
    });
  };

  processSnap(expSnap, 'expense');
  processSnap(paySnap, 'payment');
  processSnap(duelSnap, 'duel');

  return Math.round(balance * 100) / 100;
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

  // Find expenses from previous years on this month+day
  const matches = items.filter(item => {
    if (item.type !== 'expense') return false;
    const d = item.date;
    return d && d.getMonth() === todayMonth && d.getDate() === todayDay && d.getFullYear() < todayYear;
  });

  if (matches.length === 0) {
    container.classList.add('hidden');
    return;
  }

  // Pick one at random
  const memory = matches[Math.floor(Math.random() * matches.length)];
  const yearsAgo = todayYear - memory.date.getFullYear();
  const dateStr = memory.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const symbol = CURRENCY_SYMBOLS[memory.currency] || memory.currency + ' ';
  const amount = `${symbol}${memory.amount.toLocaleString()}`;

  container.innerHTML = `
    <div class="otd-polaroid">
      <div class="otd-top">
        <span class="otd-tag">On this day · ${yearsAgo} year${yearsAgo > 1 ? 's' : ''} ago</span>
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
