import { db } from './firebase-config.js';
import { convertToUSD } from './exchange.js';

/**
 * Check for due recurring expenses and create them.
 * Called on each app open.
 */
export async function processRecurring(currentUser) {
  const now = new Date();
  let created = 0;
  const snapshot = await db.collection('recurring')
    .where('active', '==', true)
    .get();

  for (const doc of snapshot.docs) {
    const r = doc.data();
    const nextDue = r.nextDue?.toDate ? r.nextDue.toDate() : new Date(r.nextDue);

    if (nextDue > now) continue; // not yet due

    // Create the expense
    try {
      const { usdAmount, exchangeRate } = await convertToUSD(r.amount, r.currency);
      await db.collection('expenses').add({
        description: r.description + ' (recurring)',
        amount: r.amount,
        currency: r.currency,
        usdAmount,
        exchangeRate,
        paidBy: r.paidBy,
        splitType: r.splitType,
        owedBy: r.owedBy,
        date: nextDue,
        addedBy: r.addedBy,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Calculate next due date
      const next = new Date(nextDue);
      if (r.frequency === 'weekly') {
        next.setDate(next.getDate() + 7);
      } else {
        next.setMonth(next.getMonth() + 1);
      }

      await doc.ref.update({ nextDue: next });
      created++;
    } catch (err) {
      console.error('Failed to process recurring expense:', r.description, err);
    }
  }

  return created;
}

/**
 * Create a new recurring expense.
 */
export async function createRecurring({ description, amount, currency, paidBy, splitType, owedBy, frequency, addedBy, startDate }) {
  const base = startDate ? new Date(startDate) : new Date();
  const now = new Date();
  let nextDue;

  if (base > now) {
    // Future start: first occurrence is the start date itself
    nextDue = base;
  } else {
    // Started today/past: next occurrence is one interval from the base date
    nextDue = new Date(base);
    if (frequency === 'weekly') {
      nextDue.setDate(nextDue.getDate() + 7);
    } else {
      nextDue.setMonth(nextDue.getMonth() + 1);
    }
  }

  // Normalize to midnight local time so charges fire at start of day
  nextDue.setHours(0, 0, 0, 0);

  await db.collection('recurring').add({
    description,
    amount,
    currency,
    paidBy,
    splitType,
    owedBy,
    frequency,
    nextDue,
    addedBy,
    active: true
  });
}

/**
 * Get all recurring expenses.
 */
export async function getRecurring() {
  const snapshot = await db.collection('recurring')
    .where('active', '==', true)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Delete (deactivate) a recurring expense.
 */
export async function deactivateRecurring(id) {
  await db.collection('recurring').doc(id).update({ active: false });
}
