import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName, setPartnerInfo } from './app.js';

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
      item.sortDate = toJSDate(d.createdAt || d[dateField]);
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

    // Render balance
    const label = balanceEl.querySelector('.balance-label');
    const amount = balanceEl.querySelector('.balance-amount');
    const partnerName = getUserName(getPartnerUid());

    if (balance > 0.005) {
      label.textContent = `${partnerName} owes you`;
      amount.textContent = `$${balance.toFixed(2)}`;
      amount.className = 'balance-amount positive';
    } else if (balance < -0.005) {
      label.textContent = `You owe ${partnerName}`;
      amount.textContent = `$${Math.abs(balance).toFixed(2)}`;
      amount.className = 'balance-amount negative';
    } else {
      label.textContent = "You're all settled up!";
      amount.textContent = '$0.00';
      amount.className = 'balance-amount';
    }

    // Add fun quote
    let quoteEl = balanceEl.querySelector('.balance-quote');
    if (!quoteEl) {
      quoteEl = document.createElement('p');
      quoteEl.className = 'balance-quote';
      amount.insertAdjacentElement('afterend', quoteEl);
    }
    quoteEl.textContent = getBalanceQuote(balance);

    // Render currency breakdown (hidden by default)
    const breakdown = document.getElementById('balance-breakdown');
    const hint = document.getElementById('balance-hint');
    breakdown.innerHTML = '';
    const nonZeroCurrencies = Object.entries(currencyBalances)
      .filter(([, v]) => Math.abs(v) > 0.005)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    if (nonZeroCurrencies.length > 0) {
      hint.classList.remove('hidden');
      for (const [cur, val] of nonZeroCurrencies) {
        const rounded = Math.round(Math.abs(val) * 100) / 100;
        const sign = val >= 0 ? '+' : '-';
        const cls = val >= 0 ? 'positive' : 'negative';
        const span = document.createElement('span');
        span.className = `currency-line ${cls}`;
        span.textContent = `${sign}${rounded.toLocaleString()} ${cur}`;
        breakdown.appendChild(span);
      }
    }

    // Toggle breakdown on tap
    balanceEl.onclick = () => {
      breakdown.classList.toggle('hidden');
    };

    // Apply mood theme
    applyMood(balance);

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
    renderHistory(items, user.uid, balance);

  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

// You owe → escalating dread
const OWE_MOODS = [
  { max: 500, name: 'warm', bg: 'linear-gradient(180deg, #fff3e0, #ffe0b2)', card: 'rgba(255,255,255,0.7)', label: '#e65100', amount: '#bf360c', quote: '#ff8a65', item: 'rgba(255,255,255,0.5)', icon: 'rgba(230,81,0,0.08)', name_: '#4e342e', meta: '#ff8a65', section: '#ff8a65', pos: '#2e7d32', neg: '#bf360c', emojis: ['😬','💸'] },
  { max: 1000, name: 'tense', bg: 'linear-gradient(180deg, #37242a, #2a1520)', card: 'rgba(80,30,40,0.6)', label: '#e57373', amount: '#ff5252', quote: '#b05060', item: 'rgba(255,255,255,0.06)', icon: 'rgba(255,82,82,0.12)', name_: '#e0ccd0', meta: '#8a6070', section: '#8a6070', pos: '#69f0ae', neg: '#ff5252', emojis: ['🫠','💀','🔥','😰'] },
  { max: 5000, name: 'drama', bg: 'linear-gradient(180deg, #1a0a1e, #0d0510)', card: 'linear-gradient(135deg, rgba(120,40,80,0.4), rgba(60,20,80,0.4))', label: '#ce93d8', amount: '#f48fb1', quote: '#8e6090', item: 'rgba(255,255,255,0.04)', icon: 'rgba(244,143,177,0.12)', name_: '#d0b0c0', meta: '#7a5070', section: '#7a5070', pos: '#69f0ae', neg: '#f48fb1', emojis: ['💸','😱','🪦','💀','🔥','😭'] },
  { max: Infinity, name: 'chaos', bg: 'linear-gradient(180deg, #1a0000, #0a0000)', card: 'linear-gradient(135deg, rgba(180,20,20,0.3), rgba(80,0,0,0.3))', label: '#ff6b6b', amount: '#ff1744', quote: '#b71c1c', item: 'rgba(255,255,255,0.03)', icon: 'rgba(255,23,68,0.1)', name_: '#c0a0a0', meta: '#6a3030', section: '#6a3030', pos: '#69f0ae', neg: '#ff1744', emojis: ['🔥','💀','💸','😱','🪦','☠️','😭','🔥','💀','💸'] }
];

// They owe you → escalating smugness
const OWED_MOODS = [
  { max: 500, name: 'cozy', bg: 'linear-gradient(180deg, #fdf6e3, #f5e6c8)', card: 'rgba(255,255,255,0.75)', label: '#b8860b', amount: '#8b6914', quote: '#c4a35a', item: 'rgba(255,255,255,0.55)', icon: 'rgba(184,134,11,0.08)', name_: '#4a3e28', meta: '#c4a35a', section: '#c4a35a', pos: '#2e7d32', neg: '#c0392b', emojis: ['😌','☕'] },
  { max: 1000, name: 'golden', bg: 'linear-gradient(180deg, #fff8e1, #ffecb3)', card: 'rgba(255,248,225,0.8)', label: '#f9a825', amount: '#e65100', quote: '#ffa726', item: 'rgba(255,255,255,0.6)', icon: 'rgba(249,168,37,0.1)', name_: '#4e342e', meta: '#ffa726', section: '#ffa726', pos: '#2e7d32', neg: '#e65100', emojis: ['😏','💅','✨'] },
  { max: 5000, name: 'champagne', bg: 'linear-gradient(180deg, #1a1510, #0f0d08)', card: 'linear-gradient(135deg, rgba(212,175,55,0.2), rgba(180,140,40,0.15))', label: '#d4af37', amount: '#ffd700', quote: '#a08520', item: 'rgba(212,175,55,0.06)', icon: 'rgba(212,175,55,0.1)', name_: '#e0d8c0', meta: '#8a7a50', section: '#8a7a50', pos: '#ffd700', neg: '#e57373', emojis: ['🍾','👑','💰','😏','💅'] },
  { max: Infinity, name: 'throne', bg: 'linear-gradient(180deg, #0a0510, #050208)', card: 'linear-gradient(135deg, rgba(180,140,255,0.15), rgba(255,215,0,0.1))', label: '#b388ff', amount: '#ffd700', quote: '#7c5cbf', item: 'rgba(255,215,0,0.04)', icon: 'rgba(179,136,255,0.1)', name_: '#d0c0e0', meta: '#6a508a', section: '#6a508a', pos: '#ffd700', neg: '#e57373', emojis: ['👑','🏆','💎','🍾','🎩','💰','🤑','👑'] }
];

// Settled
const ZEN_MOOD = { name: 'zen', bg: 'linear-gradient(180deg, #e8f5e9, #c8e6c9)', card: 'rgba(255,255,255,0.7)', label: '#66bb6a', amount: '#2e7d32', quote: '#81c784', item: 'rgba(255,255,255,0.5)', icon: 'rgba(102,187,106,0.15)', name_: '#2e7d32', meta: '#81c784', section: '#81c784', pos: '#2e7d32', neg: '#c62828', emojis: ['🧘','☮️','🌿'] };

function applyMood(balance) {
  const abs = Math.abs(balance);
  let mood;
  if (abs < 50) {
    mood = ZEN_MOOD;
  } else if (balance < 0) {
    mood = OWE_MOODS.find(m => abs < m.max);
  } else {
    mood = OWED_MOODS.find(m => abs < m.max);
  }
  const dashboard = document.getElementById('screen-dashboard');
  const card = document.getElementById('balance-display');

  // Apply background
  dashboard.style.background = mood.bg;
  dashboard.style.minHeight = '100dvh';

  // Apply card colors
  card.style.background = mood.card;
  card.querySelector('.balance-label').style.color = mood.label;
  card.querySelector('.balance-amount').style.color = mood.amount;
  const quoteEl = card.querySelector('.balance-quote');
  if (quoteEl) quoteEl.style.color = mood.quote;

  // Apply to history section
  const sectionH3 = dashboard.querySelector('h3');
  if (sectionH3) sectionH3.style.color = mood.section;

  // Apply to history items via CSS custom properties
  dashboard.style.setProperty('--mood-item', mood.item);
  dashboard.style.setProperty('--mood-icon', mood.icon);
  dashboard.style.setProperty('--mood-name', mood.name_);
  dashboard.style.setProperty('--mood-meta', mood.meta);
  dashboard.style.setProperty('--mood-pos', mood.pos);
  dashboard.style.setProperty('--mood-neg', mood.neg);

  // Chaos tier: pulse + shake
  if (mood.name === 'chaos') {
    card.style.animation = 'chaosPulse 2s ease-in-out infinite';
    card.querySelector('.balance-amount').style.animation = 'chaosShake 0.5s ease-in-out infinite';
  } else {
    card.style.animation = '';
    const amtEl = card.querySelector('.balance-amount');
    if (amtEl) amtEl.style.animation = '';
  }

  // Emojis — burst for 5 seconds then fade
  let emojiContainer = document.getElementById('emoji-burst');
  if (emojiContainer) emojiContainer.remove();

  if (mood.emojis.length > 0) {
    emojiContainer = document.createElement('div');
    emojiContainer.id = 'emoji-burst';
    emojiContainer.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:100;overflow:hidden;transition:opacity 1s;';
    document.body.appendChild(emojiContainer);

    for (let i = 0; i < mood.emojis.length * 2; i++) {
      const emoji = document.createElement('span');
      emoji.textContent = mood.emojis[i % mood.emojis.length];
      emoji.style.cssText = `
        position:absolute;
        font-size:${1 + Math.random() * 0.8}rem;
        left:${5 + Math.random() * 85}%;
        bottom:-30px;
        opacity:0;
        animation: emojiBurst ${2 + Math.random() * 2}s ease-out ${Math.random() * 2}s forwards;
      `;
      emojiContainer.appendChild(emoji);
    }

    // Fade out after 5 seconds
    setTimeout(() => {
      if (emojiContainer) {
        emojiContainer.style.opacity = '0';
        setTimeout(() => { if (emojiContainer.parentNode) emojiContainer.remove(); }, 1000);
      }
    }, 5000);
  }
}

function renderHistory(items, myUid, totalBalance) {
  const list = document.getElementById('history-list');
  // Sort by creation time (most recent first), falling back to entry date
  items.sort((a, b) => (b.sortDate || b.date) - (a.sortDate || a.date));
  list.innerHTML = '';

  if (items.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No history yet. Tap + to add an expense.</li>';
    return;
  }

  // Verify consistency: sum of displayed items should equal the balance
  let historySum = 0;

  items.forEach((item) => {
    try {
      const li = document.createElement('li');
      const dateStr = formatDate(item.date);
      const impact = itemImpact(item, myUid);
      historySum += impact;
      const isCredit = impact >= 0;
      const absAmount = Math.abs(impact);

      if (item.type === 'expense') {
        li.innerHTML = `
          <div class="entry-icon expense">${categorize(item.description).icon}</div>
          <div class="entry-info">
            <div class="entry-desc">${item.description || 'Expense'}</div>
            <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency} · ${item.splitType}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${absAmount.toFixed(2)}
          </div>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => editEntry(item.type, item));
      } else if (item.type === 'payment') {
        li.innerHTML = `
          <div class="entry-icon payment">↗</div>
          <div class="entry-info">
            <div class="entry-desc">Settle up</div>
            <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${absAmount.toFixed(2)}
          </div>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => editEntry(item.type, item));
      } else if (item.type === 'duel') {
        li.innerHTML = `
          <div class="entry-icon duel">⚔</div>
          <div class="entry-info">
            <div class="entry-desc">${item.game || 'Duel'}</div>
            <div class="entry-meta">${dateStr} · Week ${item.week}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${absAmount.toFixed(2)}
          </div>`;
      }
      list.appendChild(li);
    } catch (e) {
      console.error('Error rendering item:', item, e);
    }
  });

  // Consistency check
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
      d.type = type;
      balance += itemImpact(d, user.uid);
    });
  };

  processSnap(expSnap, 'expense');
  processSnap(paySnap, 'payment');
  processSnap(duelSnap, 'duel');

  return Math.round(balance * 100) / 100;
}
