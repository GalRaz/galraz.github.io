import { auth, googleProvider } from './firebase-config.js';
import { db } from './firebase-config.js';
import { convertToUSD } from './exchange.js';

// --- State ---
let currentUser = null;
const userNames = {};

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
  showScreen('add');
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('entry-date').value = today;
  document.getElementById('form-entry').reset();
  document.getElementById('entry-date').value = today;
  // Reset toggles
  resetToggles();
  updateFormForType('expense');
});

// --- Back buttons ---
document.getElementById('btn-back').addEventListener('click', async () => {
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
});
document.getElementById('btn-back-duel').addEventListener('click', async () => {
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
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

  if (type === 'payment') {
    descField.style.display = 'none';
    descField.removeAttribute('required');
    splitGroup.style.display = 'none';
    title.textContent = 'Settle Up';
    paidByLabel.textContent = 'Who paid';
  } else {
    descField.style.display = '';
    splitGroup.style.display = '';
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

  if (!amount || amount <= 0) {
    alert('Please enter a valid amount.');
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

      if (!description) {
        alert('Please add a description.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';
        return;
      }

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
    }

    // Go back to dashboard
    showScreen('dashboard');
    const { loadDashboard } = await import('./balance.js');
    loadDashboard();
  } catch (err) {
    console.error('Error saving entry:', err);
    alert('Failed to save. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

// --- App entry ---
async function showApp() {
  showScreen('dashboard');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
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
