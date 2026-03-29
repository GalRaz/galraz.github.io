import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid } from './app.js';
import { convertToUSD } from './exchange.js';

const form = document.getElementById('form-payment');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  const amount = parseFloat(document.getElementById('payment-amount').value);
  const currency = document.getElementById('payment-currency').value;
  const directionValue = document.querySelector('#payment-direction .toggle-btn.active').dataset.value;
  const date = document.getElementById('payment-date').value;

  if (!amount || amount <= 0) {
    alert('Please enter a valid amount.');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    const { usdAmount, exchangeRate } = await convertToUSD(amount, currency);
    const paidBy = directionValue === 'self' ? user.uid : getPartnerUid();
    const paidTo = directionValue === 'self' ? getPartnerUid() : user.uid;

    await db.collection('payments').add({
      amount,
      currency,
      usdAmount,
      exchangeRate,
      paidBy,
      paidTo,
      date: new Date(date + 'T12:00:00'),
      addedBy: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    form.reset();
    document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
    document.querySelectorAll('#payment-direction .toggle-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0)
    );
    alert('Payment recorded!');
  } catch (err) {
    console.error('Error saving payment:', err);
    alert('Failed to save payment. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Payment';
  }
});

/** Fetch all payments ordered by date descending. */
export async function getAllPayments() {
  const snapshot = await db.collection('payments').orderBy('date', 'desc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
