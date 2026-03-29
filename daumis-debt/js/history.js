import { db } from './firebase-config.js';
import { getCurrentUser } from './app.js';

export async function loadHistory() {
  const user = getCurrentUser();
  const list = document.getElementById('history-list');
  list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">Loading...</li>';

  try {
    const [expSnap, paySnap, duelSnap] = await Promise.all([
      db.collection('expenses').orderBy('date', 'desc').get(),
      db.collection('payments').orderBy('date', 'desc').get(),
      db.collection('duels').orderBy('playedAt', 'desc').get()
    ]);

    const items = [];
    expSnap.forEach((doc) => {
      const d = doc.data();
      items.push({
        type: 'expense',
        date: d.date?.toDate?.() || new Date(d.date),
        ...d
      });
    });
    paySnap.forEach((doc) => {
      const d = doc.data();
      items.push({
        type: 'payment',
        date: d.date?.toDate?.() || new Date(d.date),
        ...d
      });
    });
    duelSnap.forEach((doc) => {
      const d = doc.data();
      items.push({
        type: 'duel',
        date: d.playedAt?.toDate?.() || new Date(),
        ...d
      });
    });

    items.sort((a, b) => b.date - a.date);
    list.innerHTML = '';

    if (items.length === 0) {
      list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">No history yet</li>';
      return;
    }

    items.forEach((item) => {
      const li = document.createElement('li');
      const dateStr = item.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      if (item.type === 'expense') {
        const isCredit = item.paidBy === user.uid;
        const effectiveAmount = item.splitType === 'even' ? item.usdAmount / 2 : item.usdAmount;
        li.innerHTML = `
          <span class="entry-type expense">Expense</span>
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
          <span class="entry-type payment">Payment</span>
          <div class="entry-info">
            <div class="entry-desc">Settlement</div>
            <div class="entry-meta">${dateStr} · ${item.amount} ${item.currency}</div>
          </div>
          <div class="entry-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : '-'}$${item.usdAmount.toFixed(2)}
          </div>`;
      } else if (item.type === 'duel') {
        const won = item.favoredUser === user.uid;
        li.innerHTML = `
          <span class="entry-type duel">Duel</span>
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
  } catch (err) {
    console.error('Error loading history:', err);
    list.innerHTML = '<li style="justify-content:center;color:var(--text-muted)">Error loading history</li>';
  }
}
