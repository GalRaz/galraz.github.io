import { db } from './firebase-config.js';
import { convertToUSD } from './exchange.js';

/**
 * Advance a due date by one interval of the given frequency.
 * For monthly/yearly we pin to the original day-of-month (clamped to the
 * target month's length) so e.g. a charge set up on the 31st doesn't drift
 * earlier each month.
 */
export function advanceDate(from, frequency, originalDay) {
  const next = new Date(from);
  if (frequency === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (frequency === 'yearly') {
    const day = originalDay || from.getDate();
    next.setDate(1); // avoid day overflow when advancing
    next.setFullYear(next.getFullYear() + 1);
    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, daysInMonth));
  } else { // monthly (default)
    const day = originalDay || from.getDate();
    next.setDate(1); // avoid day overflow when advancing month
    next.setMonth(next.getMonth() + 1);
    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, daysInMonth));
  }
  next.setHours(0, 0, 0, 0);
  return next;
}

/**
 * Check for due recurring expenses and create them.
 * Called on each app open. Both partners run this, so creation must be
 * idempotent: we write the generated expense at a DETERMINISTIC doc id
 * (recurringId + due-timestamp). If both devices race, the second .set()
 * just overwrites the first — no duplicate charge.
 */
export async function processRecurring(currentUser) {
  const now = new Date();
  let created = 0;
  const snapshot = await db.collection('recurring')
    .where('active', '==', true)
    .get();

  for (const doc of snapshot.docs) {
    const r = doc.data();
    let nextDue = r.nextDue?.toDate ? r.nextDue.toDate() : new Date(r.nextDue);

    if (nextDue > now) continue; // not yet due

    // A charge could be overdue by more than one interval (e.g. nobody
    // opened the app for two months). Catch up one interval at a time so
    // each missed period produces its own expense.
    try {
      while (nextDue <= now) {
        const { usdAmount, exchangeRate } = await convertToUSD(r.amount, r.currency);
        // Deterministic id → idempotent across both partners racing.
        const chargeId = `rec_${doc.id}_${nextDue.getTime()}`;
        await db.collection('expenses').doc(chargeId).set({
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
          recurringId: doc.id,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        nextDue = advanceDate(nextDue, r.frequency, r.originalDay);
        created++;
      }
      await doc.ref.update({ nextDue });
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
    nextDue = new Date(base);
    nextDue.setHours(0, 0, 0, 0);
  } else {
    // Started today/past: next occurrence is one interval from the base date
    nextDue = advanceDate(base, frequency, base.getDate());
  }

  await db.collection('recurring').add({
    description,
    amount,
    currency,
    paidBy,
    splitType,
    owedBy,
    frequency,
    nextDue,
    originalDay: base.getDate(),
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
