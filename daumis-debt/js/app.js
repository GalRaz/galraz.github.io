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

  // Set the correct option
  const paidBySelf = data.paidBy === currentUser.uid;
  const paidValue = paidBySelf ? 'self' : 'partner';

  if (type === 'expense') {
    const splitValue = data.splitType || 'even';
    document.querySelectorAll('.split-option').forEach(b => {
      b.classList.toggle('active', b.dataset.paid === paidValue && b.dataset.split === splitValue);
    });
  } else {
    document.querySelectorAll('#entry-paid-by .toggle-btn').forEach(b => {
      b.classList.toggle('active', (b.dataset.value === 'self') === paidBySelf);
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
  const expenseOptions = document.getElementById('expense-options');
  const paymentDirection = document.getElementById('payment-direction');
  const title = document.getElementById('add-title');
  const recurringGroup = document.getElementById('recurring-group');

  if (type === 'payment') {
    descField.style.display = 'none';
    descField.removeAttribute('required');
    expenseOptions.style.display = 'none';
    paymentDirection.style.display = '';
    recurringGroup.style.display = 'none';
    title.textContent = 'Settle Up';
  } else {
    descField.style.display = '';
    expenseOptions.style.display = '';
    paymentDirection.style.display = 'none';
    recurringGroup.style.display = '';
    title.textContent = 'Add Expense';
  }
  updatePartnerNames();
}

function updatePartnerNames() {
  const partnerName = getUserName(getPartnerUid());
  document.querySelectorAll('.partner-name').forEach(el => {
    el.textContent = partnerName;
  });
}

// --- Split option buttons ---
document.querySelectorAll('.split-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.split-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

function resetToggles() {
  document.querySelectorAll('#screen-add .toggle').forEach((toggle) => {
    toggle.querySelectorAll('.toggle-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  });
  document.querySelectorAll('.split-option').forEach((b, i) => b.classList.toggle('active', i === 0));
}

// --- Combined form submission ---
document.getElementById('form-entry').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const entryType = document.querySelector('#entry-type .toggle-btn.active').dataset.value;
  const amount = parseFloat(document.getElementById('entry-amount').value);
  const currency = document.getElementById('entry-currency').value;
  const date = document.getElementById('entry-date').value;

  // Get paid-by and split from the appropriate UI
  let paidByValue, splitType;
  if (entryType === 'expense') {
    const activeOption = document.querySelector('.split-option.active');
    paidByValue = activeOption?.dataset.paid || 'self';
    splitType = activeOption?.dataset.split || 'even';
  } else {
    paidByValue = document.querySelector('#entry-paid-by .toggle-btn.active').dataset.value;
  }

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
  // Load partner name from users collection
  try {
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach((doc) => {
      const data = doc.data();
      if (doc.id !== currentUser.uid) {
        userNames[doc.id] = data.displayName || data.email || 'Partner';
      }
    });
  } catch (e) { console.warn('Could not load user profiles:', e); }
  // Backfill any docs with null paidBy/owedBy/paidTo now that partner UID is known
  await backfillPartnerUids();
  const { loadDashboard } = await import('./balance.js');
  await loadDashboard();
  const { processRecurring } = await import('./recurring.js');
  const count = await processRecurring(currentUser);
  if (count > 0) await loadDashboard();
}

/**
 * Backfill docs where paidBy, owedBy, or paidTo is null.
 * This happens when expenses were created before the partner logged in.
 * Replaces null with the partner's UID now that both users are known.
 */
async function backfillPartnerUids() {
  const partnerUid = getPartnerUid();
  if (!partnerUid) return; // partner still unknown

  let patched = 0;

  // Fix expenses with null paidBy or owedBy
  const expenses = await db.collection('expenses').get();
  for (const doc of expenses.docs) {
    const d = doc.data();
    const updates = {};
    if (d.paidBy === null || d.paidBy === undefined) updates.paidBy = partnerUid;
    if (d.owedBy === null || d.owedBy === undefined) updates.owedBy = partnerUid;
    if (Object.keys(updates).length > 0) {
      try { await doc.ref.update(updates); patched++; } catch (e) { console.warn('Backfill failed for expense', doc.id, e); }
    }
  }

  // Fix payments with null paidBy or paidTo
  const payments = await db.collection('payments').get();
  for (const doc of payments.docs) {
    const d = doc.data();
    const updates = {};
    if (d.paidBy === null || d.paidBy === undefined) updates.paidBy = partnerUid;
    if (d.paidTo === null || d.paidTo === undefined) updates.paidTo = partnerUid;
    if (Object.keys(updates).length > 0) {
      try { await doc.ref.update(updates); patched++; } catch (e) { console.warn('Backfill failed for payment', doc.id, e); }
    }
  }

  // Fix duels with null favoredUser (check result.netAdjust for direction)
  const duels = await db.collection('duels').get();
  for (const doc of duels.docs) {
    const d = doc.data();
    if (d.favoredUser === null && d.balanceAdjust > 0) {
      // netAdjust > 0 means debtor was favored. The recorder was the debtor (only user at the time).
      // So favoredUser should be the recorder (addedBy or the only known user).
      const favoredUser = d.result?.netAdjust > 0 ? (d.addedBy || currentUser.uid) : partnerUid;
      try { await doc.ref.update({ favoredUser }); patched++; } catch (e) { console.warn('Backfill failed for duel', doc.id, e); }
    }
  }

  if (patched > 0) console.log(`Backfilled ${patched} docs with partner UID`);
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
  // Don't overwrite an existing name with an empty one
  if (!name && userNames[uid]) return;
  userNames[uid] = name;
}

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/daumis-debt/sw.js')
    .then(() => console.log('SW registered'))
    .catch((err) => console.error('SW registration failed:', err));
}
