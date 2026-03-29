import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName, setPartnerInfo } from './app.js';

/**
 * Compute net balance from all expenses, payments, and duels.
 * Returns a number: positive means the current user is owed money,
 * negative means the current user owes money.
 */
export async function computeBalance() {
  const user = getCurrentUser();
  let balance = 0; // positive = current user is owed

  // Process expenses
  const expenses = await db.collection('expenses').get();
  expenses.forEach((doc) => {
    const e = doc.data();
    // Track partner info for display
    if (e.paidBy !== user.uid) setPartnerInfo(e.paidBy, e.paidByName || 'Partner');
    if (e.owedBy && e.owedBy !== user.uid) setPartnerInfo(e.owedBy, '');

    if (e.splitType === 'even') {
      // paidBy is owed half by the other person
      if (e.paidBy === user.uid) {
        balance += e.usdAmount / 2; // partner owes me half
      } else {
        balance -= e.usdAmount / 2; // I owe partner half
      }
    } else {
      // "full" — owedBy owes the full amount to paidBy
      if (e.paidBy === user.uid && e.owedBy !== user.uid) {
        balance += e.usdAmount; // partner owes me full
      } else if (e.owedBy === user.uid && e.paidBy !== user.uid) {
        balance -= e.usdAmount; // I owe partner full
      }
    }
  });

  // Process payments
  const payments = await db.collection('payments').get();
  payments.forEach((doc) => {
    const p = doc.data();
    if (p.paidBy !== user.uid) setPartnerInfo(p.paidBy, '');
    if (p.paidTo !== user.uid) setPartnerInfo(p.paidTo, '');

    if (p.paidBy === user.uid) {
      balance += p.usdAmount; // I paid partner, so they owe me more (or I owe less)
    } else {
      balance -= p.usdAmount; // Partner paid me
    }
  });

  // Process duels
  const duels = await db.collection('duels').get();
  duels.forEach((doc) => {
    const d = doc.data();
    if (!d.balanceAdjust) return; // no adjustment (tie or $0)
    if (d.favoredUser === user.uid) {
      balance += d.balanceAdjust;
    } else {
      // favoredUser is partner (or null due to missing partner UID) — count against us
      balance -= d.balanceAdjust;
    }
  });

  return Math.round(balance * 100) / 100;
}

/**
 * Load and render the dashboard.
 */
export async function loadDashboard() {
  const user = getCurrentUser();
  const balanceEl = document.getElementById('balance-display');

  try {
    const balance = await computeBalance();
    const label = balanceEl.querySelector('.balance-label');
    const amount = balanceEl.querySelector('.balance-amount');

    if (balance > 0.005) {
      const partnerName = getUserName(getPartnerUid());
      label.textContent = `${partnerName} owes you`;
      amount.textContent = `$${balance.toFixed(2)}`;
      amount.className = 'balance-amount positive';
    } else if (balance < -0.005) {
      const partnerName = getUserName(getPartnerUid());
      label.textContent = `You owe ${partnerName}`;
      amount.textContent = `$${Math.abs(balance).toFixed(2)}`;
      amount.className = 'balance-amount negative';
    } else {
      label.textContent = "You're all settled up!";
      amount.textContent = '$0.00';
      amount.className = 'balance-amount';
    }

    // Check for weekly duel availability
    const { isDuelAvailable, startDuel } = await import('./duel.js');
    const duelBanner = document.getElementById('duel-banner');
    if (await isDuelAvailable()) {
      duelBanner.classList.remove('hidden');
      document.getElementById('btn-play-duel').onclick = startDuel;
    } else {
      duelBanner.classList.add('hidden');
    }

    // Load full history
    await loadFullHistory();
  } catch (err) {
    console.error('Error loading dashboard:', err);
    // Still try to show history even if balance computation failed
    try { await loadFullHistory(); } catch (e) { console.error('History also failed:', e); }
  }
}

async function loadFullHistory() {
  const user = getCurrentUser();
  const list = document.getElementById('history-list');
  list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">Loading...</li>';

  // Fetch all collections — use try/catch per collection so one failure doesn't block all
  let expSnap, paySnap, duelSnap;
  try {
    [expSnap, paySnap, duelSnap] = await Promise.all([
      db.collection('expenses').get(),
      db.collection('payments').get(),
      db.collection('duels').get()
    ]);
  } catch (err) {
    console.error('Error fetching history:', err);
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">Error loading history. Pull down to retry.</li>';
    return;
  }

  const items = [];

  function parseDate(d) {
    try {
      if (d?.toDate) return d.toDate();
      if (d?.seconds) return new Date(d.seconds * 1000);
      if (d instanceof Date) return d;
      if (typeof d === 'string' || typeof d === 'number') return new Date(d);
    } catch (e) {}
    return new Date();
  }

  expSnap.forEach((doc) => {
    try {
      const d = doc.data();
      items.push({ ...d, type: 'expense', id: doc.id, date: parseDate(d.date) });
    } catch (e) { console.error('Bad expense doc:', doc.id, e); }
  });
  paySnap.forEach((doc) => {
    try {
      const d = doc.data();
      items.push({ ...d, type: 'payment', id: doc.id, date: parseDate(d.date) });
    } catch (e) { console.error('Bad payment doc:', doc.id, e); }
  });
  duelSnap.forEach((doc) => {
    try {
      const d = doc.data();
      items.push({ ...d, type: 'duel', id: doc.id, date: parseDate(d.playedAt) });
    } catch (e) { console.error('Bad duel doc:', doc.id, e); }
  });

  items.sort((a, b) => b.date - a.date);
  list.innerHTML = '';

  if (items.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No history yet. Tap + to add an expense.</li>';
    return;
  }

  items.forEach((item) => {
    try {
      const li = document.createElement('li');
      const dateStr = item.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      if (item.type === 'expense') {
        const isCredit = item.paidBy === user.uid;
        const effectiveAmount = item.splitType === 'even' ? item.usdAmount / 2 : item.usdAmount;
        li.innerHTML = `
          <div class="entry-icon expense">$</div>
          <div class="entry-info">
            <div class="entry-desc">${item.description || 'Expense'}</div>
            <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency} · ${item.splitType}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${effectiveAmount.toFixed(2)}
          </div>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => editEntry(item.type, item));
      } else if (item.type === 'payment') {
        const isCredit = item.paidBy === user.uid;
        li.innerHTML = `
          <div class="entry-icon payment">↗</div>
          <div class="entry-info">
            <div class="entry-desc">Settle up</div>
            <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${item.usdAmount.toFixed(2)}
          </div>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => editEntry(item.type, item));
      } else if (item.type === 'duel') {
        const won = item.favoredUser === user.uid;
        li.innerHTML = `
          <div class="entry-icon duel">⚔</div>
          <div class="entry-info">
            <div class="entry-desc">${item.game || 'Duel'}</div>
            <div class="entry-meta">${dateStr} · Week ${item.week}</div>
          </div>
          <div class="entry-amount ${won ? 'credit' : 'debit'}">
            ${won ? '+' : '-'}$${(item.balanceAdjust || 0).toFixed(2)}
          </div>`;
      }
      list.appendChild(li);
    } catch (e) {
      console.error('Error rendering item:', item, e);
    }
  });
}

export function editEntry(type, data) {
  // Dispatch custom event that app.js listens for
  window.dispatchEvent(new CustomEvent('edit-entry', { detail: { type, data } }));
}
