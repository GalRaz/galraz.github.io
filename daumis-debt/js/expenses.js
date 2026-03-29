import { db } from './firebase-config.js';
import { getCurrentUser, getPartnerUid, setPartnerInfo } from './app.js';
import { convertToUSD } from './exchange.js';

const form = document.getElementById('form-expense');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  const description = document.getElementById('expense-desc').value.trim();
  const amount = parseFloat(document.getElementById('expense-amount').value);
  const currency = document.getElementById('expense-currency').value;
  const paidByValue = document.querySelector('#expense-paid-by .toggle-btn.active').dataset.value;
  const splitType = document.querySelector('#expense-split .toggle-btn.active').dataset.value;
  const date = document.getElementById('expense-date').value;

  if (!description || !amount || amount <= 0) {
    alert('Please fill in all fields.');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    const { usdAmount, exchangeRate } = await convertToUSD(amount, currency);
    const paidBy = paidByValue === 'self' ? user.uid : getPartnerUid();
    const owedBy = paidByValue === 'self' ? getPartnerUid() : user.uid;

    await db.collection('expenses').add({
      description,
      amount,
      currency,
      usdAmount,
      exchangeRate,
      paidBy,
      splitType,
      owedBy,
      date: new Date(date + 'T12:00:00'),
      addedBy: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    form.reset();
    document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
    document.querySelectorAll('#expense-paid-by .toggle-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0)
    );
    document.querySelectorAll('#expense-split .toggle-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0)
    );
    alert('Expense saved!');
  } catch (err) {
    console.error('Error saving expense:', err);
    alert('Failed to save expense. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Expense';
  }
});

/** Fetch all expenses ordered by date descending. */
export async function getAllExpenses() {
  const snapshot = await db.collection('expenses').orderBy('date', 'desc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
