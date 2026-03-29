import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName, setPartnerInfo } from './app.js';

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

    expSnap.forEach((doc) => {
      try {
        const d = doc.data();
        // Track partner info
        if (d.paidBy !== user.uid && isValidUid(d.paidBy)) setPartnerInfo(d.paidBy, '');
        if (d.owedBy !== user.uid && isValidUid(d.owedBy)) setPartnerInfo(d.owedBy, '');
        const parsed = { ...d };
        parsed.type = 'expense';
        parsed.id = doc.id;
        parsed.date = toJSDate(d.date);
        parsed.sortDate = toJSDate(d.createdAt || d.date);
        items.push(parsed);
      } catch (e) { console.error('Bad expense doc:', doc.id, e); }
    });

    paySnap.forEach((doc) => {
      try {
        const d = doc.data();
        if (d.paidBy !== user.uid && isValidUid(d.paidBy)) setPartnerInfo(d.paidBy, '');
        if (d.paidTo !== user.uid && isValidUid(d.paidTo)) setPartnerInfo(d.paidTo, '');
        const parsed = { ...d };
        parsed.type = 'payment';
        parsed.id = doc.id;
        parsed.date = toJSDate(d.date);
        parsed.sortDate = toJSDate(d.createdAt || d.date);
        items.push(parsed);
      } catch (e) { console.error('Bad payment doc:', doc.id, e); }
    });

    duelSnap.forEach((doc) => {
      try {
        const d = doc.data();
        const parsed = { ...d };
        parsed.type = 'duel';
        parsed.id = doc.id;
        parsed.date = toJSDate(d.playedAt);
        parsed.sortDate = toJSDate(d.playedAt);
        items.push(parsed);
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
          <div class="entry-icon expense">$</div>
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
