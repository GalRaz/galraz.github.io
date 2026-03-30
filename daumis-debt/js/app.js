import { auth, googleProvider } from './firebase-config.js';
import { db } from './firebase-config.js';
import { convertToUSD } from './exchange.js';
import { initNotifications, saveUserProfile, notifyPartner } from './notifications.js';

// --- Splash screen ---
const SPLASH_MESSAGES = [
  { emoji: '💰', text: 'Counting the damage...' },
  { emoji: '🧮', text: 'Crunching numbers...' },
  { emoji: '🔍', text: 'Investigating expenses...' },
  { emoji: '📊', text: 'Tallying the receipts...' },
  { emoji: '🤔', text: 'Who paid for what again?' },
  { emoji: '💸', text: 'Following the money trail...' },
  { emoji: '🧾', text: 'Reviewing the evidence...' },
  { emoji: '🎲', text: 'Preparing the weekly duel...' },
];

let splashInterval = null;
function startSplashCycle() {
  const subEl = document.getElementById('splash-sub');
  if (!subEl) return;
  let idx = Math.floor(Math.random() * SPLASH_MESSAGES.length);
  subEl.textContent = SPLASH_MESSAGES[idx].text;
  splashInterval = setInterval(() => {
    idx = (idx + 1) % SPLASH_MESSAGES.length;
    subEl.textContent = SPLASH_MESSAGES[idx].text;
  }, 800);
}

function hideSplash() {
  if (splashInterval) { clearInterval(splashInterval); splashInterval = null; }
  const splash = document.getElementById('splash');
  const app = document.getElementById('app');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => { splash.remove(); }, 500);
  }
  if (app) app.style.display = '';
}

startSplashCycle();

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
    hideSplash();
    showScreen('auth');
  }
});

// --- Interactive swipe to go back ---
let swipeStartX = 0;
let swipeStartY = 0;
let isSwiping = false;
let swipeTarget = null;

document.addEventListener('touchstart', (e) => {
  // Only start if touch begins within 30px of left edge
  if (e.touches[0].clientX > 30) {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    return;
  }
  const active = document.querySelector('.screen.active');
  if (active && active.id !== 'screen-dashboard' && active.id !== 'screen-auth') {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeTarget = active;
    isSwiping = false;
  }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!swipeTarget) return;
  const dx = e.touches[0].clientX - swipeStartX;
  const dy = e.touches[0].clientY - swipeStartY;

  // Must be moving mostly horizontally to the right
  if (!isSwiping && dx > 10 && Math.abs(dy) < Math.abs(dx) * 0.5) {
    isSwiping = true;
    swipeTarget.style.transition = 'none';
    // Show dashboard underneath
    document.getElementById('screen-dashboard').classList.add('active');
  }

  if (isSwiping && dx > 0) {
    swipeTarget.style.transform = `translateX(${dx}px)`;
    // Slight dim on the revealed dashboard
    swipeTarget.style.opacity = Math.max(0.3, 1 - dx / window.innerWidth);
  }
}, { passive: true });

document.addEventListener('touchend', async (e) => {
  if (!swipeTarget || !isSwiping) {
    // Check for non-edge swipes (original threshold)
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (dx > 80 && Math.abs(dy) < Math.abs(dx) * 0.5) {
      const active = document.querySelector('.screen.active');
      if (active && active.id !== 'screen-dashboard' && active.id !== 'screen-auth') {
        goBack();
      }
    }
    swipeTarget = null;
    isSwiping = false;
    return;
  }

  const dx = e.changedTouches[0].clientX - swipeStartX;
  swipeTarget.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';

  if (dx > window.innerWidth * 0.35) {
    // Complete the swipe — slide fully off screen
    swipeTarget.style.transform = `translateX(${window.innerWidth}px)`;
    swipeTarget.style.opacity = '0';
    setTimeout(() => {
      swipeTarget.classList.remove('active');
      swipeTarget.style.transform = '';
      swipeTarget.style.opacity = '';
      swipeTarget.style.transition = '';
      swipeTarget = null;
    }, 250);
    // Load dashboard
    editingEntry = null;
    currentScreen = 'screen-dashboard';
    const { loadDashboard } = await import('./balance.js');
    loadDashboard();
  } else {
    // Snap back
    swipeTarget.style.transform = 'translateX(0)';
    swipeTarget.style.opacity = '1';
    setTimeout(() => {
      swipeTarget.style.transition = '';
      document.getElementById('screen-dashboard').classList.remove('active');
      swipeTarget = null;
    }, 250);
  }

  isSwiping = false;
});

// --- Pull to refresh ---
let pullStartY = 0;
let isPulling = false;

const dashboardContent = document.querySelector('#screen-dashboard .dashboard-content');
if (dashboardContent) {
  dashboardContent.addEventListener('touchstart', (e) => {
    // Only activate if scrolled to top
    if (dashboardContent.scrollTop <= 0) {
      pullStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  dashboardContent.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const dy = e.touches[0].clientY - pullStartY;
    const indicator = document.getElementById('pull-indicator');
    if (dy > 30 && dashboardContent.scrollTop <= 0) {
      indicator.classList.add('pulling');
      document.getElementById('pull-text').textContent = dy > 80 ? '↑ Release to refresh' : '↓ Pull to refresh';
    } else {
      indicator.classList.remove('pulling');
    }
  }, { passive: true });

  dashboardContent.addEventListener('touchend', async (e) => {
    if (!isPulling) return;
    isPulling = false;
    const dy = e.changedTouches[0].clientY - pullStartY;
    const indicator = document.getElementById('pull-indicator');

    if (dy > 80 && dashboardContent.scrollTop <= 0) {
      indicator.classList.remove('pulling');
      indicator.classList.add('refreshing');
      document.getElementById('pull-text').textContent = 'Refreshing...';

      try {
        const { loadDashboard } = await import('./balance.js');
        await loadDashboard();
      } catch (e) { console.error('Refresh failed:', e); }

      indicator.classList.remove('refreshing');
    } else {
      indicator.classList.remove('pulling');
    }
  });
}

async function goBack() {
  editingEntry = null;
  showScreen('dashboard', 'slide-back');
  const { loadDashboard } = await import('./balance.js');
  loadDashboard();
}

// --- Routing ---
let currentScreen = null;

function showScreen(name, transition) {
  const screenId = name === 'add' ? 'screen-add' : `screen-${name}`;
  const next = document.getElementById(screenId);
  const prev = currentScreen ? document.getElementById(currentScreen) : null;

  if (prev && transition === 'slide-back' && prev !== next) {
    // Slide current screen out to the right, then show next
    prev.classList.add('slide-out-right');
    prev.addEventListener('animationend', () => {
      prev.classList.remove('active', 'slide-out-right', 'slide-in-right');
    }, { once: true });
    next.classList.remove('slide-in-right', 'slide-out-right');
    next.classList.add('active');
  } else if (prev && transition === 'slide-forward' && prev !== next) {
    // Slide next screen in from the right
    prev.classList.remove('active', 'slide-in-right', 'slide-out-right');
    next.classList.add('active', 'slide-in-right');
  } else {
    // No animation (initial load, auth)
    document.querySelectorAll('.screen').forEach((s) => {
      s.classList.remove('active', 'slide-in-right', 'slide-out-right');
    });
    next.classList.add('active');
  }

  currentScreen = screenId;
}

// --- Currency select reordering ---
function reorderCurrencySelect() {
  const select = document.getElementById('entry-currency');
  const allOptions = Array.from(select.options);

  // Get currencies with balances from localStorage
  const usedCurrencies = new Set();
  try {
    const used = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
    used.forEach(c => usedCurrencies.add(c));
  } catch (e) {}

  // Also add last used and default
  const lastUsed = localStorage.getItem('daumis-debt-last-currency');
  if (lastUsed) usedCurrencies.add(lastUsed);
  const defaultCur = localStorage.getItem('daumis-debt-default-currency');
  if (defaultCur) usedCurrencies.add(defaultCur);

  if (usedCurrencies.size === 0) return;

  // Clear and rebuild
  select.innerHTML = '';

  // Add used currencies first
  const usedOpts = allOptions.filter(o => usedCurrencies.has(o.value));
  const otherOpts = allOptions.filter(o => !usedCurrencies.has(o.value));

  usedOpts.forEach(o => select.appendChild(o.cloneNode(true)));

  // Add separator
  const sep = document.createElement('option');
  sep.disabled = true;
  sep.textContent = '──────────';
  select.appendChild(sep);

  otherOpts.forEach(o => select.appendChild(o.cloneNode(true)));
}

// --- FAB ---
document.getElementById('fab-add').addEventListener('click', () => {
  editingEntry = null;
  showScreen('add', 'slide-forward');
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
  // Apply default currency (prefer last-used, fall back to default setting)
  const defaultCurrency = localStorage.getItem('daumis-debt-last-currency')
    || localStorage.getItem('daumis-debt-default-currency') || 'USD';
  reorderCurrencySelect();
  document.getElementById('entry-currency').value = defaultCurrency;
  // Reset edit UI
  const deleteBtn = document.getElementById('btn-delete-entry');
  if (deleteBtn) deleteBtn.style.display = 'none';
  const submitBtn = document.querySelector('#form-entry button[type="submit"]');
  submitBtn.textContent = 'Save';
});

// --- Back buttons ---
document.getElementById('btn-back').addEventListener('click', goBack);
document.getElementById('btn-back-duel').addEventListener('click', goBack);

// --- Settings ---
document.getElementById('btn-settings').addEventListener('click', () => {
  showScreen('settings', 'slide-forward');
  loadSettings();
});

document.getElementById('btn-back-settings').addEventListener('click', goBack);

async function loadSettings() {
  // Load nickname from local state (which reflects Firestore), fall back to Auth profile
  const user = getCurrentUser();
  document.getElementById('settings-nickname').value = userNames[user.uid] || user.displayName || '';

  // Load balance view preference
  const balanceView = localStorage.getItem('daumis-debt-balance-view') || 'consolidated';
  document.querySelectorAll('#settings-balance-view .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === balanceView);
  });

  // Load consolidation currency
  const consolCurrency = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
  document.getElementById('settings-consolidation-currency').value = consolCurrency;

  // Load default expense currency
  const defaultCurrency = localStorage.getItem('daumis-debt-default-currency') || 'USD';
  document.getElementById('settings-default-currency').value = defaultCurrency;

  // Load duel status
  await loadDuelSettings();
}

async function loadDuelSettings() {
  const hint = document.getElementById('duel-status-hint');
  const btn = document.getElementById('btn-toggle-duel');
  const user = getCurrentUser();

  try {
    const doc = await db.collection('settings').doc('duel').get();
    const data = doc.exists ? doc.data() : { active: true, optInRequests: [] };
    const isActive = data.active !== false;
    const optInRequests = data.optInRequests || [];
    const iRequested = optInRequests.includes(user.uid);

    if (isActive) {
      hint.textContent = 'Duels are active. Either player can opt out.';
      btn.textContent = 'Turn Off Duels';
      btn.className = 'btn btn-logout'; // red style
      btn.onclick = async () => {
        if (!confirm('This will disable weekly duels for both of you. Continue?')) return;
        await db.collection('settings').doc('duel').set({ active: false, optInRequests: [], disabledBy: user.uid }, { merge: true });
        await loadDuelSettings();
      };
    } else {
      if (iRequested) {
        hint.textContent = 'You voted to turn duels back on. Waiting for your partner to agree.';
        btn.textContent = 'Cancel Request';
        btn.className = 'btn btn-secondary';
        btn.onclick = async () => {
          const updated = optInRequests.filter(uid => uid !== user.uid);
          await db.collection('settings').doc('duel').update({ optInRequests: updated });
          await loadDuelSettings();
        };
      } else if (optInRequests.length > 0) {
        hint.textContent = 'Your partner wants to turn duels back on. Agree to reactivate.';
        btn.textContent = 'Agree — Turn On Duels';
        btn.className = 'btn btn-primary';
        btn.onclick = async () => {
          await db.collection('settings').doc('duel').set({ active: true, optInRequests: [] }, { merge: true });
          await loadDuelSettings();
        };
      } else {
        hint.textContent = 'Duels are off. Both players must agree to turn them back on.';
        btn.textContent = 'Request to Turn On';
        btn.className = 'btn btn-secondary';
        btn.onclick = async () => {
          await db.collection('settings').doc('duel').set({
            active: false,
            optInRequests: firebase.firestore.FieldValue.arrayUnion(user.uid)
          }, { merge: true });
          await loadDuelSettings();
        };
      }
    }
  } catch (err) {
    console.error('Failed to load duel settings:', err);
    hint.textContent = 'Could not load duel settings.';
    btn.style.display = 'none';
  }
}

document.getElementById('btn-save-nickname').addEventListener('click', async () => {
  const nickname = document.getElementById('settings-nickname').value.trim();
  if (!nickname) { alert('Please enter a nickname.'); return; }

  const btn = document.getElementById('btn-save-nickname');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const user = getCurrentUser();
    await db.collection('users').doc(user.uid).set({
      displayName: nickname,
      email: user.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Update local state
    userNames[user.uid] = nickname;
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
  } catch (err) {
    console.error('Failed to save nickname:', err);
    alert('Failed to save. Try again.');
    btn.textContent = 'Save';
    btn.disabled = false;
  }
});

document.getElementById('settings-default-currency').addEventListener('change', (e) => {
  localStorage.setItem('daumis-debt-default-currency', e.target.value);
});

document.querySelectorAll('#settings-balance-view .toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#settings-balance-view .toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    localStorage.setItem('daumis-debt-balance-view', btn.dataset.value);
  });
});

document.getElementById('settings-consolidation-currency').addEventListener('change', (e) => {
  localStorage.setItem('daumis-debt-consol-currency', e.target.value);
});

document.getElementById('btn-export-csv').addEventListener('click', async () => {
  const btn = document.getElementById('btn-export-csv');
  btn.disabled = true;
  btn.textContent = 'Exporting...';

  try {
    const [expSnap, paySnap, duelSnap] = await Promise.all([
      db.collection('expenses').get(),
      db.collection('payments').get(),
      db.collection('duels').get()
    ]);

    let csv = 'Date,Type,Description,Amount,Currency,USD Amount,Split,Who Paid\n';

    expSnap.forEach((doc) => {
      const d = doc.data();
      const date = d.date?.toDate ? d.date.toDate().toISOString().split('T')[0] : '';
      const whoPaid = d.paidBy === getCurrentUser().uid ? 'Me' : 'Partner';
      csv += `${date},Expense,"${(d.description || '').replace(/"/g, '""')}",${d.amount},${d.currency},${d.usdAmount},${d.splitType},${whoPaid}\n`;
    });

    paySnap.forEach((doc) => {
      const d = doc.data();
      const date = d.date?.toDate ? d.date.toDate().toISOString().split('T')[0] : '';
      const whoPaid = d.paidBy === getCurrentUser().uid ? 'Me' : 'Partner';
      csv += `${date},Payment,,${d.amount},${d.currency},${d.usdAmount},,${whoPaid}\n`;
    });

    duelSnap.forEach((doc) => {
      const d = doc.data();
      const date = d.playedAt?.toDate ? d.playedAt.toDate().toISOString().split('T')[0] : '';
      csv += `${date},Duel,${d.game || ''},${d.balanceAdjust},USD,${d.balanceAdjust},,\n`;
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daumis-debt-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    btn.textContent = 'Export CSV';
    btn.disabled = false;
  } catch (err) {
    console.error('Export failed:', err);
    alert('Export failed.');
    btn.textContent = 'Export CSV';
    btn.disabled = false;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  if (!confirm('Log out?')) return;
  try {
    await auth.signOut();
    showScreen('auth');
  } catch (err) {
    console.error('Logout failed:', err);
  }
});

// --- Edit entry ---
window.addEventListener('edit-entry', (e) => {
  const { type, data } = e.detail;
  editingEntry = { id: data.id, type };

  showScreen('add', 'slide-forward');

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
      showScreen('dashboard', 'slide-back');
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

// Pre-fill settle-up amount when switching to payment
document.querySelectorAll('#entry-type .toggle-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.dataset.value === 'payment' && !editingEntry) {
      try {
        const { computeBalance } = await import('./balance.js');
        const balance = await computeBalance();
        if (Math.abs(balance) > 0.005) {
          const currency = document.getElementById('entry-currency').value;
          if (currency === 'USD' || currency === (localStorage.getItem('daumis-debt-consol-currency') || 'USD')) {
            document.getElementById('entry-amount').value = Math.abs(balance).toFixed(2);
          }
        }
      } catch (e) { console.warn('Could not pre-fill settle amount:', e); }
    }
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

    // Track last-used and used currencies
    localStorage.setItem('daumis-debt-last-currency', currency);
    try {
      const usedCurrencies = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
      if (!usedCurrencies.includes(currency)) {
        usedCurrencies.push(currency);
        localStorage.setItem('daumis-debt-used-currencies', JSON.stringify(usedCurrencies));
      }
    } catch (e) {}

    // Go back to dashboard
    editingEntry = null;
    showScreen('dashboard', 'slide-back');
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
  hideSplash();
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

  // Fix expenses with null/missing/string-"null" paidBy or owedBy
  const isBad = (v) => !v || v === 'null' || v === 'undefined';
  const expenses = await db.collection('expenses').get();
  for (const doc of expenses.docs) {
    const d = doc.data();
    const updates = {};
    if (isBad(d.paidBy)) updates.paidBy = partnerUid;
    if (isBad(d.owedBy)) updates.owedBy = partnerUid;
    if (Object.keys(updates).length > 0) {
      try { await doc.ref.update(updates); patched++; } catch (e) { console.warn('Backfill failed for expense', doc.id, e); }
    }
  }

  // Fix payments with null/missing/string-"null" paidBy or paidTo
  const payments = await db.collection('payments').get();
  for (const doc of payments.docs) {
    const d = doc.data();
    const updates = {};
    if (isBad(d.paidBy)) updates.paidBy = partnerUid;
    if (isBad(d.paidTo)) updates.paidTo = partnerUid;
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
  if (!uid || uid === 'null' || uid === 'undefined') return;
  if (!name && userNames[uid]) return;
  userNames[uid] = name;
}

// Register service worker for PWA + auto-reload on updates
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/daumis-debt/sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      console.log('SW registered');
      // Check for updates every 60 seconds
      setInterval(() => reg.update(), 60000);
    })
    .catch((err) => console.error('SW registration failed:', err));

  // Auto-reload when a new SW takes control
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
