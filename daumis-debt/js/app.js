import { auth, googleProvider } from './firebase-config.js';
import { db } from './firebase-config.js';
import { convertToUSD } from './exchange.js';
import { initNotifications, saveUserProfile, notifyPartner } from './notifications.js';

// --- State ---
let currentUser = null;
const userNames = {};
let editingEntry = null; // { id, type } when editing, null when creating

// --- Auth ---
document.getElementById('btn-google-login').addEventListener('click', () => {
  auth.signInWithPopup(googleProvider).catch((err) => {
    console.error('Auth error:', err);
    alert('Sign-in failed. Make sure you use an authorized Google account.');
  });
});

auth.onAuthStateChanged((user) => {
  if (user) {
    currentUser = user;
    userNames[user.uid] = user.displayName || user.email;
    saveUserProfile(user);
    showApp();
  } else {
    currentUser = null;
    showScreen('auth');
  }
});

// --- Routing ---
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const screenId = name === 'add' ? 'screen-add' : `screen-${name}`;
  document.getElementById(screenId).classList.add('active');
}

// --- FAB ---
document.getElementById('fab-add').addEventListener('click', () => {
  editingEntry = null;
  showScreen('add');
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('entry-date').value = today;
  document.getElementById('form-entry').reset();
  document.getElementById('entry-date').value = today;
  // Reset toggles
  resetToggles();
  updateFormForType('expense');
  // Reset recurring toggle
  document.querySelectorAll('#entry-recurring .toggle-btn').forEach((b, i) =>
    b.classList.toggle('active', i === 0)
  );
  // Reset edit UI
  const deleteBtn = document.getElementById('btn-delete-entry');
  if (deleteBtn) deleteBtn.style.display = 'none';
  const submitBtn = document.querySelector('#form-entry button[type="submit"]');
  submitBtn.textContent = 'Save';
});

// --- Back buttons ---
document.getElementById('btn-back').addEventListener('click', async () => {
  editingEntry = null;
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
});
document.getElementById('btn-back-duel').addEventListener('click', async () => {
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
});

// --- Edit entry ---
window.addEventListener('edit-entry', (e) => {
  const { type, data } = e.detail;
  editingEntry = { id: data.id, type };

  showScreen('add');

  // Set entry type toggle
  document.querySelectorAll('#entry-type .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === type);
  });
  updateFormForType(type);

  // Pre-fill fields
  if (type === 'expense') {
    document.getElementById('entry-desc').value = data.description || '';
  }
  document.getElementById('entry-amount').value = data.amount || '';
  document.getElementById('entry-currency').value = data.currency || 'USD';

  // Set paid-by toggle
  const paidBySelf = data.paidBy === currentUser.uid;
  document.querySelectorAll('#entry-paid-by .toggle-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.value === 'self') === paidBySelf);
  });

  // Set split toggle for expenses
  if (type === 'expense' && data.splitType) {
    document.querySelectorAll('#entry-split .toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.value === data.splitType);
    });
  }

  // Set date
  const dateObj = data.date?.toDate ? data.date.toDate() : new Date(data.date);
  document.getElementById('entry-date').value = dateObj.toISOString().split('T')[0];

  // Hide recurring group when editing (editing doesn't change recurrence)
  document.getElementById('recurring-group').style.display = 'none';

  // Update UI for edit mode
  const submitBtn = document.querySelector('#form-entry button[type="submit"]');
  submitBtn.textContent = 'Save Changes';

  // Show delete button
  let deleteBtn = document.getElementById('btn-delete-entry');
  if (!deleteBtn) {
    deleteBtn = document.createElement('button');
    deleteBtn.id = 'btn-delete-entry';
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-delete';
    deleteBtn.textContent = 'Delete';
    submitBtn.parentNode.insertBefore(deleteBtn, submitBtn.nextSibling);
  }
  deleteBtn.style.display = '';
  deleteBtn.onclick = async () => {
    if (!confirm('Delete this entry?')) return;
    try {
      const collection = editingEntry.type === 'expense' ? 'expenses' : 'payments';
      await db.collection(collection).doc(editingEntry.id).delete();
      editingEntry = null;
      showScreen('dashboard');
      const { loadDashboard } = await import('./balance.js');
      loadDashboard();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete.');
    }
  };
});

// --- Toggle buttons ---
document.querySelectorAll('.toggle').forEach((toggle) => {
  toggle.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
});

// --- Entry type toggle (expense vs payment) ---
document.querySelectorAll('#entry-type .toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    updateFormForType(btn.dataset.value);
  });
});

function updateFormForType(type) {
  const descField = document.getElementById('entry-desc');
  const splitGroup = document.getElementById('split-group');
  const title = document.getElementById('add-title');
  const paidByLabel = document.querySelector('#entry-paid-by').closest('.toggle-group').querySelector('label');

  const recurringGroup = document.getElementById('recurring-group');
  if (type === 'payment') {
    descField.style.display = 'none';
    descField.removeAttribute('required');
    splitGroup.style.display = 'none';
    recurringGroup.style.display = 'none';
    title.textContent = 'Settle Up';
    paidByLabel.textContent = 'Who paid';
  } else {
    descField.style.display = '';
    splitGroup.style.display = '';
    recurringGroup.style.display = '';
    title.textContent = 'Add Expense';
    paidByLabel.textContent = 'Paid by';
  }
}

function resetToggles() {
  document.querySelectorAll('#screen-add .toggle').forEach((toggle) => {
    toggle.querySelectorAll('.toggle-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  });
}

// --- Combined form submission ---
document.getElementById('form-entry').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const entryType = document.querySelector('#entry-type .toggle-btn.active').dataset.value;
  const amount = parseFloat(document.getElementById('entry-amount').value);
  const currency = document.getElementById('entry-currency').value;
  const paidByValue = document.querySelector('#entry-paid-by .toggle-btn.active').dataset.value;
  const date = document.getElementById('entry-date').value;

  // Validation
  if (entryType === 'expense') {
    const desc = document.getElementById('entry-desc').value.trim();
    if (!desc) {
      alert('Please add a description.');
      return;
    }
    if (desc.length > 200) {
      alert('Description is too long (max 200 characters).');
      return;
    }
  }

  if (!amount || isNaN(amount) || amount <= 0) {
    alert('Please enter a valid positive amount.');
    return;
  }

  if (amount > 1000000) {
    alert('Amount seems too large. Please check and try again.');
    return;
  }

  const submitBtn = document.querySelector('#form-entry button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    const { usdAmount, exchangeRate } = await convertToUSD(amount, currency);
    const paidBy = paidByValue === 'self' ? currentUser.uid : getPartnerUid();
    const otherUid = paidByValue === 'self' ? getPartnerUid() : currentUser.uid;

    if (entryType === 'expense') {
      const description = document.getElementById('entry-desc').value.trim();
      const splitType = document.querySelector('#entry-split .toggle-btn.active').dataset.value;

      if (editingEntry && editingEntry.type === 'expense') {
        await db.collection('expenses').doc(editingEntry.id).update({
          description,
          amount,
          currency,
          usdAmount,
          exchangeRate,
          paidBy,
          splitType,
          owedBy: otherUid,
          date: new Date(date + 'T12:00:00'),
        });
      } else {
        await db.collection('expenses').add({
          description,
          amount,
          currency,
          usdAmount,
          exchangeRate,
          paidBy,
          splitType,
          owedBy: otherUid,
          date: new Date(date + 'T12:00:00'),
          addedBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        notifyPartner({
          type: 'expense',
          details: { description, amount, currency, splitType, usdAmount }
        });
      }
    } else {
      if (editingEntry && editingEntry.type === 'payment') {
        await db.collection('payments').doc(editingEntry.id).update({
          amount,
          currency,
          usdAmount,
          exchangeRate,
          paidBy,
          paidTo: otherUid,
          date: new Date(date + 'T12:00:00'),
        });
      } else {
        await db.collection('payments').add({
          amount,
          currency,
          usdAmount,
          exchangeRate,
          paidBy,
          paidTo: otherUid,
          date: new Date(date + 'T12:00:00'),
          addedBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        notifyPartner({
          type: 'payment',
          details: { amount, currency, usdAmount }
        });
      }
    }

    // Create recurring if selected (only for new expenses, not edits)
    if (!editingEntry && entryType === 'expense') {
      const recurringValue = document.querySelector('#entry-recurring .toggle-btn.active').dataset.value;
      if (recurringValue !== 'none') {
        const description = document.getElementById('entry-desc').value.trim();
        const splitType = document.querySelector('#entry-split .toggle-btn.active').dataset.value;
        const otherUid = paidByValue === 'self' ? getPartnerUid() : currentUser.uid;
        const paidBy = paidByValue === 'self' ? currentUser.uid : getPartnerUid();
        const { createRecurring } = await import('./recurring.js');
        await createRecurring({
          description,
          amount,
          currency,
          paidBy,
          splitType,
          owedBy: otherUid,
          frequency: recurringValue,
          addedBy: currentUser.uid
        });
      }
    }

    // Go back to dashboard
    editingEntry = null;
    showScreen('dashboard');
    const { loadDashboard } = await import('./balance.js');
    loadDashboard();
  } catch (err) {
    console.error('Error saving entry:', err);
    alert('Failed to save. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingEntry ? 'Save Changes' : 'Save';
  }
});

// --- App entry ---
async function showApp() {
  showScreen('dashboard');
  await initNotifications();
  const { loadDashboard } = await import('./balance.js');
  await loadDashboard();
  const { processRecurring } = await import('./recurring.js');
  const count = await processRecurring(currentUser);
  if (count > 0) await loadDashboard();
}

// Expose for other modules
export { currentUser, userNames, showScreen };
export function getCurrentUser() { return currentUser; }
export function getPartnerUid() {
  return Object.keys(userNames).find((uid) => uid !== currentUser.uid) || null;
}
export function getUserName(uid) {
  return userNames[uid] || 'Partner';
}
export function setPartnerInfo(uid, name) {
  userNames[uid] = name;
}

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/daumis-debt/sw.js')
    .then(() => console.log('SW registered'))
    .catch((err) => console.error('SW registration failed:', err));
}
