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
    if (d.favoredUser === user.uid) {
      balance += d.balanceAdjust;
    } else if (d.favoredUser) {
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
  }
}

async function loadFullHistory() {
  const user = getCurrentUser();
  const list = document.getElementById('history-list');
  list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">Loading...</li>';

  const [expSnap, paySnap, duelSnap] = await Promise.all([
    db.collection('expenses').orderBy('date', 'desc').get(),
    db.collection('payments').orderBy('date', 'desc').get(),
    db.collection('duels').orderBy('playedAt', 'desc').get()
  ]);

  const items = [];
  expSnap.forEach((doc) => {
    const d = doc.data();
    items.push({ type: 'expense', date: d.date?.toDate?.() || new Date(d.date), ...d });
  });
  paySnap.forEach((doc) => {
    const d = doc.data();
    items.push({ type: 'payment', date: d.date?.toDate?.() || new Date(d.date), ...d });
  });
  duelSnap.forEach((doc) => {
    const d = doc.data();
    items.push({ type: 'duel', date: d.playedAt?.toDate?.() || new Date(), ...d });
  });

  items.sort((a, b) => b.date - a.date);
  list.innerHTML = '';

  if (items.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No history yet. Tap + to add an expense.</li>';
    return;
  }

  items.forEach((item) => {
    const li = document.createElement('li');
    const dateStr = item.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (item.type === 'expense') {
      const isCredit = item.paidBy === user.uid;
      const effectiveAmount = item.splitType === 'even' ? item.usdAmount / 2 : item.usdAmount;
      li.innerHTML = `
        <div class="entry-icon expense">$</div>
        <div class="entry-info">
          <div class="entry-desc">${item.description}</div>
          <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency} · ${item.splitType}</div>
        </div>
        <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
          ${isCredit ? '+' : '-'}$${effectiveAmount.toFixed(2)}
        </div>`;
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
    } else if (item.type === 'duel') {
      const won = item.favoredUser === user.uid;
      li.innerHTML = `
        <div class="entry-icon duel">⚔</div>
        <div class="entry-info">
          <div class="entry-desc">${item.game}</div>
          <div class="entry-meta">${dateStr} · Week ${item.week}</div>
        </div>
        <div class="entry-amount ${won ? 'credit' : 'debit'}">
          ${won ? '+' : '-'}$${item.balanceAdjust.toFixed(2)}
        </div>`;
    }
    list.appendChild(li);
  });
}
