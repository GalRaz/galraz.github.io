import { auth, googleProvider } from './firebase-config.js';
import { db } from './firebase-config.js';
import { convertToUSD } from './exchange.js';
import { categorize } from './balance.js';

/**
 * Save or update the current user's profile in the `users` collection.
 * Called on every login so partner lookups always have the latest email + name.
 */
async function saveUserProfile(user) {
  try {
    const existing = await db.collection('users').doc(user.uid).get();
    if (existing.exists && existing.data().displayName) {
      await db.collection('users').doc(user.uid).update({
        email: user.email,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await db.collection('users').doc(user.uid).set({
        email: user.email,
        displayName: user.displayName || user.email,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  } catch (err) {
    console.warn('Failed to save user profile:', err);
  }
}

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

// Safety: force hide splash after 10 seconds no matter what
setTimeout(() => { hideSplash(); }, 10000);

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
    // Don't set userNames here — showApp loads the Firestore nickname
    saveUserProfile(user);
    showApp().catch((err) => {
      console.error('showApp failed:', err);
      hideSplash();
    });
  } else {
    currentUser = null;
    hideSplash();
    showScreen('auth');
  }
});

// --- Interactive swipe to go back ---
// Uses position:fixed layering so both screens are genuinely stacked
{
  let startX = 0, startY = 0;
  let dragging = false;       // are we in a confirmed horizontal drag?
  let decided = false;        // have we decided drag vs scroll?
  let topScreen = null;       // the screen being dragged away
  const THRESHOLD = 0.3;      // fraction of screen width to complete

  document.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = false;
    decided = false;
    topScreen = null;

    // Find the active sub-screen (not dashboard, not auth)
    const active = document.querySelector('.screen.active');
    if (active && active.id !== 'screen-dashboard' && active.id !== 'screen-auth') {
      topScreen = active;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!topScreen) return;

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // First 10px of movement: decide if this is a swipe-back or a scroll
    if (!decided) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        decided = true;
        if (dx > 5 && Math.abs(dx) > Math.abs(dy)) {
          // Horizontal right — start dragging
          dragging = true;
          const dashboard = document.getElementById('screen-dashboard');
          dashboard.classList.add('swipe-base');
          topScreen.classList.add('swipe-top');
          topScreen.style.transition = 'none';
        } else {
          // Vertical or leftward — not a swipe-back, let it scroll
          topScreen = null;
        }
      }
      return;
    }

    if (!dragging) return;

    // Move the top screen to follow the finger (only rightward)
    const clampedDx = Math.max(0, dx);
    topScreen.style.transform = `translateX(${clampedDx}px)`;
  }, { passive: true });

  document.addEventListener('touchend', async (e) => {
    if (!topScreen || !dragging) {
      topScreen = null;
      return;
    }

    const finalDx = e.changedTouches[0].clientX - startX;
    const dashboard = document.getElementById('screen-dashboard');

    function cleanup() {
      topScreen.classList.remove('swipe-top');
      topScreen.style.transform = '';
      topScreen.style.transition = '';
      dashboard.classList.remove('swipe-base');
      topScreen = null;
    }

    if (finalDx > window.innerWidth * THRESHOLD) {
      // Complete: animate the top screen off screen.
      //
      // Keep the dashboard in `swipe-base` (position:fixed, viewport-anchored)
      // for the entire slide-out — the class swap to normal flow happens in
      // the setTimeout below, AFTER the top screen is fully gone. Doing it
      // synchronously caused the dashboard to reflow from position:fixed
      // → normal flow mid-animation, which read as a subtle horizontal
      // "shift" of the underneath screen during the swipe.
      topScreen.style.transition = 'transform 0.25s ease-out';
      topScreen.style.transform = `translateX(${window.innerWidth}px)`;
      setTimeout(() => {
        topScreen.classList.remove('active');
        dashboard.classList.add('active');
        cleanup(); // removes swipe-base from dashboard, swipe-top from topScreen
      }, 250);
      editingEntry = null;
      currentScreen = 'screen-dashboard';
      const { loadDashboard } = await import('./balance.js');
      loadDashboard();
    } else {
      // Snap back
      topScreen.style.transition = 'transform 0.2s ease-out';
      topScreen.style.transform = 'translateX(0)';
      setTimeout(() => cleanup(), 200);
    }

    dragging = false;
  }, { passive: true });
}

// --- Pull to refresh ---
let pullStartY = 0;
let isPulling = false;

const dashboardContent = document.querySelector('#screen-dashboard .dashboard-content');
if (dashboardContent) {
  // Synchronous check used in touchstart — dynamic import would add latency.
  function _historySheetOpen() {
    const s = document.getElementById('history-filter-sheet');
    return !!s && !s.classList.contains('hidden');
  }

  dashboardContent.addEventListener('touchstart', (e) => {
    // Don't capture P2R while the history-filter sheet is open — the user
    // may be scrolling sheet content or dragging the grabber.
    if (_historySheetOpen()) return;
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
        await loadDashboard(true);
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

  // Hide ALL screens first — no stacking
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.remove('active', 'slide-in-right');
  });

  // Show the target screen
  if (transition === 'slide-forward') {
    next.classList.add('active', 'slide-in-right');
  } else {
    next.classList.add('active');
  }

  // Scroll to top
  next.scrollTop = 0;
  window.scrollTo(0, 0);

  currentScreen = screenId;
}

// --- Smart currency dropdown ---
const ALL_CURRENCIES = [
  { code: 'USD', label: '$ USD' }, { code: 'EUR', label: '€ EUR' },
  { code: 'GBP', label: '£ GBP' }, { code: 'JPY', label: '¥ JPY' },
  { code: 'THB', label: '฿ THB' }, { code: 'BTN', label: 'Nu BTN' },
  { code: 'TWD', label: 'NT$ TWD' }, { code: 'KRW', label: '₩ KRW' },
  { code: 'CNY', label: '¥ CNY' }, { code: 'INR', label: '₹ INR' },
  { code: 'AUD', label: 'A$ AUD' }, { code: 'CAD', label: 'C$ CAD' },
  { code: 'CHF', label: 'Fr CHF' }, { code: 'SGD', label: 'S$ SGD' },
  { code: 'HKD', label: 'HK$ HKD' }, { code: 'NZD', label: 'NZ$ NZD' },
  { code: 'SEK', label: 'kr SEK' }, { code: 'NOK', label: 'kr NOK' },
  { code: 'DKK', label: 'kr DKK' }, { code: 'MXN', label: '$ MXN' },
  { code: 'BRL', label: 'R$ BRL' }, { code: 'PLN', label: 'zł PLN' },
  { code: 'CZK', label: 'Kč CZK' }, { code: 'HUF', label: 'Ft HUF' },
  { code: 'ILS', label: '₪ ILS' }, { code: 'TRY', label: '₺ TRY' },
  { code: 'ZAR', label: 'R ZAR' }, { code: 'PHP', label: '₱ PHP' },
  { code: 'MYR', label: 'RM MYR' }, { code: 'IDR', label: 'Rp IDR' }
];

// All categories — used to populate the override sheet (categorize is imported from balance.js)
const ALL_CATEGORIES = [
  { label: 'groceries', icon: '🛒', display: 'Groceries' },
  { label: 'dining', icon: '🍽️', display: 'Dining' },
  { label: 'flights', icon: '✈️', display: 'Flights' },
  { label: 'lodging', icon: '🏨', display: 'Lodging' },
  { label: 'transport', icon: '🚕', display: 'Transport' },
  { label: 'auto', icon: '⛽', display: 'Auto' },
  { label: 'entertainment', icon: '🎬', display: 'Entertainment' },
  { label: 'housing', icon: '🏠', display: 'Housing' },
  { label: 'health', icon: '💊', display: 'Health' },
  { label: 'shopping', icon: '🛍️', display: 'Shopping' },
  { label: 'gifts', icon: '🎁', display: 'Gifts' },
  { label: 'balance', icon: '📊', display: 'Balance' },
  { label: 'other', icon: '$', display: 'Other' },
];

function getCategoryDisplay(label) {
  const c = ALL_CATEGORIES.find(x => x.label === label);
  return c ? c.display : (label || 'Other').replace(/^\w/, m => m.toUpperCase());
}

function buildConsolCurrencySelect(currentValue) {
  const select = document.getElementById('settings-consolidation-currency');
  const prioritySet = new Set();
  const balanceSizes = {};

  try {
    const sizes = JSON.parse(localStorage.getItem('daumis-debt-currency-balances') || '{}');
    Object.assign(balanceSizes, sizes);
    for (const [cur, amt] of Object.entries(sizes)) {
      if (Math.abs(amt) > 0.005) prioritySet.add(cur);
    }
  } catch (e) {}

  const lastUsed = localStorage.getItem('daumis-debt-last-currency');
  if (lastUsed) prioritySet.add(lastUsed);
  if (currentValue) prioritySet.add(currentValue);

  const priorityCurrencies = ALL_CURRENCIES.filter(c => prioritySet.has(c.code));
  priorityCurrencies.sort((a, b) => {
    if (a.code === currentValue) return -1;
    if (b.code === currentValue) return 1;
    return Math.abs(balanceSizes[b.code] || 0) - Math.abs(balanceSizes[a.code] || 0);
  });
  const otherCurrencies = ALL_CURRENCIES.filter(c => !prioritySet.has(c.code));

  select.innerHTML = '';
  priorityCurrencies.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.label;
    select.appendChild(opt);
  });
  if (priorityCurrencies.length > 0 && otherCurrencies.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '── Other ──';
    select.appendChild(sep);
  }
  otherCurrencies.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.label;
    select.appendChild(opt);
  });
  select.value = currentValue;
}

// --- FAB ---
document.getElementById('fab-add').addEventListener('click', () => {
  editingEntry = null;
  openAddScreen({ editing: false });
});

/**
 * Open the Add screen and reset all state to a fresh new-expense form.
 */
function openAddScreen({ editing = false, prefill = null } = {}) {
  showScreen('add', 'slide-forward');
  const today = new Date().toISOString().split('T')[0];

  // Reset the form body
  const form = document.getElementById('form-entry');
  form.reset();
  document.getElementById('entry-date').value = today;

  // Remove any lingering category override
  delete form.dataset.catOverride;
  const chip = document.getElementById('desc-chip');
  chip.classList.add('hidden');
  chip.textContent = '';

  // Default currency
  const defaultCurrency = (prefill && prefill.currency) || localStorage.getItem('daumis-debt-last-currency') || 'USD';
  setActiveCurrency(defaultCurrency);
  renderCurrencyPills();

  // Reset split state
  splitState = { payer: 'self', splitType: 'even' };
  renderSplitSentence();

  // Reset date chips
  document.querySelectorAll('#d-chips .d-chip').forEach((b) => b.classList.remove('active'));
  document.querySelector('#d-chips .d-chip[data-date="today"]').classList.add('active');
  document.querySelector('#d-chips .d-chip[data-date="pick"]').textContent = 'Pick…';

  // Reset recurring
  recurringState = { active: false, frequency: 'monthly' };
  renderRecurringRow();

  // Reset entry-type toggle to "expense"
  setEntryType('expense');

  // Title + save button label
  document.getElementById('add-title').textContent = editing ? 'Edit expense' : 'Add expense';
  const saveBtn = document.getElementById('btn-save-entry');
  saveBtn.textContent = editing ? 'Save changes' : 'Save expense';
  saveBtn.disabled = true;
  saveBtn.classList.add('disabled');
  saveBtn.classList.remove('loading');

  // Remove any delete button from edit-mode
  const existingDelete = document.getElementById('btn-delete-entry');
  if (existingDelete) existingDelete.remove();

  // Hide any overlays
  closeSheet();
  closePopover();

  updatePartnerNames();

  if (prefill) {
    document.getElementById('entry-desc').value = prefill.description || '';
    document.getElementById('entry-amount').value = prefill.amount || '';
    onDescInput();
    onAmountInput();
    if (prefill.date) {
      const iso = prefill.date.toISOString().split('T')[0];
      document.getElementById('entry-date').value = iso;
      applyDateChip(iso);
    }
  }

  setTimeout(() => document.getElementById('entry-amount').focus(), 100);
}

// --- Back buttons ---
document.getElementById('btn-back').addEventListener('click', goBack);
document.getElementById('btn-back-duel').addEventListener('click', goBack);

// --- Insights ---
document.getElementById('btn-insights').addEventListener('click', () => {
  showScreen('insights', 'slide-forward');
  loadInsights('month');
});

document.getElementById('btn-back-insights').addEventListener('click', goBack);

document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadInsights(btn.dataset.period);
  });
});

// --- Settings ---
document.getElementById('btn-settings').addEventListener('click', () => {
  showScreen('settings', 'slide-forward');
  loadSettings();
});

document.getElementById('btn-back-settings').addEventListener('click', goBack);

async function loadSettings() {
  // Load nickname from local state (which reflects Firestore), fall back to Auth profile
  const user = getCurrentUser();
  // Load nickname from Firestore (not from userNames which may have the Google name)
  try {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists && userDoc.data().displayName) {
      document.getElementById('settings-nickname').value = userDoc.data().displayName;
    } else {
      document.getElementById('settings-nickname').value = user.displayName || '';
    }
  } catch (e) {
    document.getElementById('settings-nickname').value = userNames[user.uid] || user.displayName || '';
  }

  // Load balance view preference
  const balanceView = localStorage.getItem('daumis-debt-balance-view') || 'consolidated';
  document.querySelectorAll('#settings-balance-view .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === balanceView);
  });

  // Load consolidation currency with smart sorting
  const consolCurrency = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
  buildConsolCurrencySelect(consolCurrency);

  // Load recurring expenses
  await loadRecurringList();

  // Load duel status
  await loadDuelSettings();
}

async function loadRecurringList() {
  const container = document.getElementById('recurring-list');
  if (!container) return;

  try {
    const { getRecurring, deactivateRecurring } = await import('./recurring.js');
    const items = await getRecurring();

    if (items.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No recurring expenses</p>';
      return;
    }

    container.innerHTML = '';
    items.forEach(item => {
      const sym = getCurrencySymbol(item.currency);
      const nextDue = item.nextDue?.toDate ? item.nextDue.toDate() : new Date(item.nextDue);
      const dateStr = nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const freqLabel = item.frequency === 'weekly' ? 'Weekly' : 'Monthly';
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:var(--surface);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:6px;cursor:pointer;';
      div.innerHTML = `
        <div>
          <div style="font-size:0.9rem;font-weight:500">${item.description}</div>
          <div style="font-size:0.75rem;color:var(--text-muted)">${sym}${item.amount.toLocaleString()} · ${freqLabel} · next: ${dateStr}</div>
        </div>
        <span style="color:var(--text-muted);font-size:1rem">›</span>`;
      div.addEventListener('click', () => {
        // Pass nextDue as date for the detail view
        item.date = nextDue;
        window.dispatchEvent(new CustomEvent('edit-recurring', { detail: { data: item, fromSettings: true } }));
      });
      container.appendChild(div);
    });
  } catch (err) {
    console.error('Failed to load recurring:', err);
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Could not load</p>';
  }
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

    const rows = [];

    expSnap.forEach((doc) => {
      const d = doc.data();
      const ts = d.date?.toDate ? d.date.toDate() : new Date(d.date?.seconds ? d.date.seconds * 1000 : d.date);
      const date = ts.toISOString().split('T')[0];
      const whoPaid = d.paidBy === getCurrentUser().uid ? 'Me' : 'Partner';
      rows.push({ ts, line: `${date},Expense,"${(d.description || '').replace(/"/g, '""')}",${d.amount},${d.currency},${d.usdAmount},${d.splitType},${whoPaid}\n` });
    });

    paySnap.forEach((doc) => {
      const d = doc.data();
      const ts = d.date?.toDate ? d.date.toDate() : new Date(d.date?.seconds ? d.date.seconds * 1000 : d.date);
      const date = ts.toISOString().split('T')[0];
      const whoPaid = d.paidBy === getCurrentUser().uid ? 'Me' : 'Partner';
      rows.push({ ts, line: `${date},Payment,,${d.amount},${d.currency},${d.usdAmount},,${whoPaid}\n` });
    });

    duelSnap.forEach((doc) => {
      const d = doc.data();
      const ts = d.playedAt?.toDate ? d.playedAt.toDate() : new Date(d.playedAt?.seconds ? d.playedAt.seconds * 1000 : 0);
      const date = ts.toISOString().split('T')[0];
      rows.push({ ts, line: `${date},Duel,${d.game || ''},${d.balanceAdjust},USD,${d.balanceAdjust},,\n` });
    });

    rows.sort((a, b) => b.ts - a.ts);
    rows.forEach(r => { csv += r.line; });

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

// --- Edit recurring ---
window.addEventListener('edit-recurring', (e) => {
  const { data, fromSettings } = e.detail;

  showScreen('add', 'slide-forward');
  const title = document.getElementById('add-title');
  title.textContent = 'Edit Recurring';

  // Hide entry type toggle and form
  const entToggle = document.getElementById('entry-type');
  if (entToggle) entToggle.style.display = 'none';
  document.getElementById('form-entry').style.display = 'none';

  let container = document.getElementById('settle-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'settle-container';
    document.getElementById('form-entry').parentNode.insertBefore(container, document.getElementById('form-entry'));
  }

  const nextDate = data.date instanceof Date ? data.date : new Date(data.date);
  const partnerName = getUserName(getPartnerUid());

  // Build editable form
  container.innerHTML = `
    <div style="text-align:center;padding:20px 0 16px">
      <div style="font-size:2rem;margin-bottom:6px">🔄</div>
    </div>
    <div class="form" style="gap:14px">
      <div class="toggle-group">
        <label class="settings-label" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600">Description</label>
        <input type="text" id="recur-desc" class="settings-input" value="${data.description || ''}">
      </div>
      <div class="toggle-group">
        <label class="settings-label" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600">Amount</label>
        <div style="display:flex;gap:8px">
          <input type="number" id="recur-amount" class="settings-input" style="flex:1" value="${data.amount}" step="0.01" inputmode="decimal">
          <select id="recur-currency" class="settings-input" style="width:110px;text-align:center">
            ${ALL_CURRENCIES.map(c => `<option value="${c.code}" ${c.code === data.currency ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="toggle-group">
        <label class="settings-label" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600">Frequency</label>
        <div class="toggle" id="recur-frequency">
          <button type="button" class="toggle-btn ${data.frequency === 'weekly' ? 'active' : ''}" data-value="weekly">Weekly</button>
          <button type="button" class="toggle-btn ${data.frequency === 'monthly' ? 'active' : ''}" data-value="monthly">Monthly</button>
        </div>
      </div>
      <div class="toggle-group">
        <label class="settings-label" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600">Who is paying</label>
        <div class="toggle" id="recur-paid-by">
          <button type="button" class="toggle-btn ${data.paidBy === currentUser.uid ? 'active' : ''}" data-value="self">Me</button>
          <button type="button" class="toggle-btn ${data.paidBy !== currentUser.uid ? 'active' : ''}" data-value="partner">${partnerName}</button>
        </div>
      </div>
      <div class="toggle-group">
        <label class="settings-label" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600">Split</label>
        <div class="toggle" id="recur-split">
          <button type="button" class="toggle-btn ${data.splitType === 'even' ? 'active' : ''}" data-value="even">Split evenly</button>
          <button type="button" class="toggle-btn ${data.splitType === 'full' ? 'active' : ''}" data-value="full">Owed fully</button>
        </div>
      </div>
      <div class="toggle-group">
        <label class="settings-label" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600">Next charge</label>
        <input type="date" id="recur-next-date" class="settings-input" value="${nextDate.toISOString().split('T')[0]}">
      </div>
      <button class="btn btn-primary" id="btn-save-recurring">Save Changes</button>
      <button class="btn btn-delete" id="btn-cancel-recurring">Cancel Recurring</button>
    </div>`;
  container.style.display = '';

  // Wire up toggle buttons
  container.querySelectorAll('.toggle').forEach(toggle => {
    toggle.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  });

  // Save
  document.getElementById('btn-save-recurring').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-recurring');
    const desc = document.getElementById('recur-desc').value.trim();
    const amount = parseFloat(document.getElementById('recur-amount').value);
    if (!desc || !amount || amount <= 0) { alert('Please fill in all fields.'); return; }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const paidByVal = document.querySelector('#recur-paid-by .toggle-btn.active').dataset.value;
      await db.collection('recurring').doc(data.id).update({
        description: desc,
        amount: amount,
        currency: document.getElementById('recur-currency').value,
        frequency: document.querySelector('#recur-frequency .toggle-btn.active').dataset.value,
        paidBy: paidByVal === 'self' ? currentUser.uid : getPartnerUid(),
        owedBy: paidByVal === 'self' ? getPartnerUid() : currentUser.uid,
        splitType: document.querySelector('#recur-split .toggle-btn.active').dataset.value,
        nextDue: new Date(document.getElementById('recur-next-date').value + 'T12:00:00')
      });
      btn.textContent = 'Saved!';
      setTimeout(() => {
        if (fromSettings) {
          showScreen('settings');
          loadSettings();
        } else {
          goBack();
        }
      }, 500);
    } catch (err) {
      console.error('Save recurring failed:', err);
      alert('Failed to save.');
      btn.textContent = 'Save Changes';
      btn.disabled = false;
    }
  });

  // Cancel
  document.getElementById('btn-cancel-recurring').addEventListener('click', async () => {
    if (!confirm(`Cancel recurring "${data.description}"? Future charges will stop.`)) return;
    try {
      const { deactivateRecurring } = await import('./recurring.js');
      await deactivateRecurring(data.id);
      if (fromSettings) {
        showScreen('settings');
        loadSettings();
      } else {
        goBack();
      }
    } catch (err) {
      console.error('Cancel recurring failed:', err);
      alert('Failed to cancel.');
    }
  });
});

// --- Edit entry ---
window.addEventListener('edit-entry', (e) => {
  const { type, data } = e.detail;
  editingEntry = { id: data.id, type };

  // Payments get a detail view with delete, not the full edit form
  if (type === 'payment') {
    showScreen('add', 'slide-forward');
    const title = document.getElementById('add-title');
    title.textContent = 'Settlement Details';

    // Hide the entry type toggle and form
    const entToggle = document.getElementById('entry-type');
    if (entToggle) entToggle.style.display = 'none';
    document.getElementById('form-entry').style.display = 'none';

    const container = document.getElementById('settle-container');
    const sym = getCurrencySymbol(data.currency);
    const dateObj = data.date instanceof Date ? data.date : (data.date?.toDate ? data.date.toDate() : new Date(data.date));
    const dateStr = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const paidByName = data.paidBy === currentUser.uid ? getUserName(currentUser.uid) : getUserName(data.paidBy);
    const paidToName = data.paidTo === currentUser.uid ? getUserName(currentUser.uid) : getUserName(data.paidTo);

    container.innerHTML = `
      <div style="text-align:center;padding:30px 0 20px">
        <div style="font-size:2rem;font-weight:700;color:var(--text);margin-bottom:8px">${sym}${data.amount.toLocaleString()}</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">${data.currency} · ${dateStr}</div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">${paidByName} paid ${paidToName}</div>
      </div>
      <button class="btn btn-delete" id="btn-delete-payment">Delete Settlement</button>`;
    container.style.display = '';

    document.getElementById('btn-delete-payment').addEventListener('click', async () => {
      if (!confirm('Delete this settlement? The debt will be restored.')) return;
      try {
        await db.collection('payments').doc(editingEntry.id).delete();
        editingEntry = null;
        showScreen('dashboard');
        const { loadDashboard } = await import('./balance.js');
        invalidateAllCaches(); loadDashboard(true);
      } catch (err) {
        console.error('Delete failed:', err);
        alert('Failed to delete.');
      }
    });
    return;
  }

  // Expense edit — open screen, then populate fields
  openAddScreen({ editing: true });

  // Pre-fill
  document.getElementById('entry-desc').value = data.description || '';
  document.getElementById('entry-amount').value = data.amount || '';
  setActiveCurrency(data.currency || 'USD');
  renderCurrencyPills();

  // Map paidBy + splitType back onto the sentence state.
  // Only two type keys now: 'even' (split evenly) or 'full' (whoever-didn't-pay owes full).
  const paidBySelf = data.paidBy === currentUser.uid;
  const typeKey = data.splitType === 'full' ? 'full' : 'even';
  splitState = {
    payer: paidBySelf ? 'self' : 'partner',
    splitType: typeKey,
    typeKey,
  };
  renderSplitSentence();

  // Set date
  const dateObj = data.date?.toDate ? data.date.toDate() : new Date(data.date);
  const iso = dateObj.toISOString().split('T')[0];
  document.getElementById('entry-date').value = iso;
  applyDateChip(iso);

  // Hide the recurring row when editing an existing expense
  const recRow = document.getElementById('recur-row');
  if (recRow) recRow.style.display = 'none';

  // Trigger input derivations
  onDescInput();
  onAmountInput();

  // Edit-mode UI: title + button label + trash icon in the header (top-left,
  // immediately after the back button — destructive action stays out of the
  // way of the primary Save flow rather than sitting under it).
  document.getElementById('add-title').textContent = 'Edit expense';
  const saveBtn = document.getElementById('btn-save-entry');
  saveBtn.textContent = 'Save changes';

  const header = document.querySelector('#screen-add .screen-header');
  let deleteBtn = document.getElementById('btn-delete-entry');
  if (!deleteBtn) {
    deleteBtn = document.createElement('button');
    deleteBtn.id = 'btn-delete-entry';
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-icon btn-delete-icon';
    deleteBtn.setAttribute('aria-label', 'Delete entry');
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '🗑';
    // Top-right: appended last, pushed to the far edge via CSS margin-left:auto.
    header.appendChild(deleteBtn);
  }
  deleteBtn.onclick = async () => {
    if (!confirm('Delete this entry?')) return;
    try {
      const collection = editingEntry.type === 'expense' ? 'expenses' : 'payments';
      await db.collection(collection).doc(editingEntry.id).delete();
      editingEntry = null;
      showScreen('dashboard', 'slide-back');
      const { loadDashboard } = await import('./balance.js');
      invalidateAllCaches(); loadDashboard(true);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete.');
    }
  };
});

// --- Entry-type toggle (Expense ↔ Settle up) ---
document.querySelectorAll('#entry-type button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setEntryType(btn.dataset.value);
  });
});

function setEntryType(type) {
  document.querySelectorAll('#entry-type button').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === type);
  });
  const form = document.getElementById('form-entry');
  const settleContainer = document.getElementById('settle-container');
  const title = document.getElementById('add-title');

  if (type === 'payment') {
    form.style.display = 'none';
    settleContainer.style.display = '';
    title.textContent = 'Settle up';
    renderSettleUp();
  } else {
    settleContainer.style.display = 'none';
    settleContainer.innerHTML = '';
    form.style.display = '';
    title.textContent = editingEntry ? 'Edit expense' : 'Add expense';
  }
  updatePartnerNames();
}

function getCurrencySymbol(code) {
  const symbols = {
    USD:'$', EUR:'€', GBP:'£', JPY:'¥', THB:'฿', BTN:'Nu ', TWD:'NT$', KRW:'₩',
    CNY:'¥', INR:'₹', AUD:'A$', CAD:'C$', CHF:'Fr', SGD:'S$', HKD:'HK$', NZD:'NZ$',
    SEK:'kr', NOK:'kr', DKK:'kr', MXN:'$', BRL:'R$', PLN:'zł', CZK:'Kč', HUF:'Ft',
    ILS:'₪', TRY:'₺', ZAR:'R', PHP:'₱', MYR:'RM', IDR:'Rp'
  };
  return symbols[code] || code + ' ';
}

// =========================================================================
// Add Expense — interactive state machine
// =========================================================================

// Active currency — which pill is hot and which symbol renders in the amount row.
let activeCurrency = 'USD';
// Split sentence state — mapped to Firestore paidBy/splitType on save.
//   payer:     'self'   = I paid,  'partner' = partner paid.
//   splitType: 'even'   = both owe half, 'full' = owed-by side owes the whole thing.
// The legacy data shape only has paidBy + splitType, so we derive owedBy from payer.
let splitState = { payer: 'self', splitType: 'even' };
// Recurring inline expansion state
let recurringState = { active: false, frequency: 'monthly' };

// --- Currency pills ---
function getTopCurrencies() {
  const out = [];
  const seen = new Set();
  const push = (c) => { if (c && !seen.has(c) && ALL_CURRENCIES.some(x => x.code === c)) { out.push(c); seen.add(c); } };

  const last = localStorage.getItem('daumis-debt-last-currency');
  push(last);

  // Partner's home / consolidation currency
  const consol = localStorage.getItem('daumis-debt-consol-currency');
  push(consol);

  try {
    const used = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
    used.forEach(push);
  } catch (e) {}

  // Fallbacks
  ['USD', 'EUR', 'GBP', 'JPY'].forEach(push);

  return out.slice(0, 4);
}

function renderCurrencyPills() {
  const pills = document.getElementById('cur-pills');
  if (!pills) return;
  const top = getTopCurrencies();
  // Ensure active currency is one of the visible pills — if not, swap in.
  if (!top.includes(activeCurrency)) {
    top[top.length - 1] = activeCurrency;
  }
  pills.innerHTML = '';
  top.forEach((code) => {
    const sym = getCurrencySymbol(code).trim() || '$';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cur-pill' + (code === activeCurrency ? ' active' : '');
    btn.dataset.cur = code;
    btn.textContent = `${sym} ${code}`;
    btn.addEventListener('click', () => {
      setActiveCurrency(code);
      renderCurrencyPills();
      renderSplitSentence();
    });
    pills.appendChild(btn);
  });
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'cur-pill more';
  more.textContent = '+ More';
  more.addEventListener('click', openCurrencySheet);
  pills.appendChild(more);
}

function setActiveCurrency(code) {
  activeCurrency = code;
  const sym = getCurrencySymbol(code).trim() || '$';
  document.getElementById('amt-sym').textContent = sym;
}

function openCurrencySheet() {
  const home = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]'); } catch (e) {}
  const recentsSet = new Set(recents);

  function rank(code) {
    if (code === activeCurrency) return 0;
    if (code === home) return 1;
    if (recentsSet.has(code)) return 2;
    return 3;
  }

  const sorted = [...ALL_CURRENCIES].sort((a, b) => {
    const ra = rank(a.code), rb = rank(b.code);
    if (ra !== rb) return ra - rb;
    return a.code.localeCompare(b.code);
  });

  function rowsHtml(filter) {
    const q = (filter || '').toLowerCase().trim();
    return sorted
      .filter(c => !q || c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      .map(c => {
        const sym = getCurrencySymbol(c.code).trim() || c.code;
        const on = c.code === activeCurrency ? ' on' : '';
        return `<div class="sheet-row${on}" data-cur="${c.code}">
          <span><strong>${sym}</strong> &nbsp;${c.code}</span>
          <span class="r">${c.label.replace(c.code, '').trim()}</span>
        </div>`;
      })
      .join('');
  }

  openSheet({
    title: 'Pick currency',
    searchable: true,
    bodyHtml: `<div class="sheet-list" id="cur-sheet-list">${rowsHtml('')}</div>`,
    onReady: (sheet) => {
      const input = sheet.querySelector('.sheet-search');
      const list = sheet.querySelector('#cur-sheet-list');
      if (input) {
        input.addEventListener('input', () => {
          list.innerHTML = rowsHtml(input.value);
          wireRows();
        });
      }
      function wireRows() {
        list.querySelectorAll('.sheet-row').forEach(r => {
          r.addEventListener('click', () => {
            const code = r.dataset.cur;
            setActiveCurrency(code);
            // Mark as recent
            try {
              const used = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
              if (!used.includes(code)) {
                used.unshift(code);
                localStorage.setItem('daumis-debt-used-currencies', JSON.stringify(used.slice(0, 12)));
              }
            } catch (e) {}
            renderCurrencyPills();
            renderSplitSentence();
            closeSheet();
          });
        });
      }
      wireRows();
    }
  });
}

// --- Description auto-detect chip ---
function onDescInput() {
  const form = document.getElementById('form-entry');
  const desc = document.getElementById('entry-desc').value;
  const chip = document.getElementById('desc-chip');
  const override = form.dataset.catOverride;

  let cat;
  if (override) {
    cat = ALL_CATEGORIES.find(c => c.label === override) || { icon: '$', label: 'other', display: 'Other' };
  } else {
    if (!desc || desc.trim().length < 3) {
      chip.classList.add('hidden');
      chip.textContent = '';
      updateSaveEnabled();
      return;
    }
    cat = categorize(desc);
    if (cat.label === 'other') {
      chip.classList.add('hidden');
      chip.textContent = '';
      updateSaveEnabled();
      return;
    }
  }
  const display = cat.display || getCategoryDisplay(cat.label);
  chip.textContent = `${cat.icon} ${display}`;
  chip.classList.remove('hidden');
  updateSaveEnabled();
}

function openCategorySheet() {
  const desc = document.getElementById('entry-desc').value;
  const autoLabel = (categorize(desc) || {}).label;
  const form = document.getElementById('form-entry');
  const current = form.dataset.catOverride || autoLabel;

  const rows = ALL_CATEGORIES.map(c => {
    const isAuto = c.label === autoLabel;
    const isOn = c.label === current;
    return `<div class="sheet-row${isOn ? ' on' : ''}" data-cat="${c.label}">
      <span>${c.icon} &nbsp;${c.display}${isAuto ? ' <span class="r">(auto-detected)</span>' : ''}</span>
      ${isOn ? '<span class="check">✓</span>' : ''}
    </div>`;
  }).join('');

  openSheet({
    title: 'Pick category',
    bodyHtml: `<div class="sheet-list">${rows}</div>`,
    onReady: (sheet) => {
      sheet.querySelectorAll('.sheet-row').forEach(r => {
        r.addEventListener('click', () => {
          form.dataset.catOverride = r.dataset.cat;
          onDescInput();
          closeSheet();
        });
      });
    }
  });
}

// --- Amount input ---
function onAmountInput() {
  renderSplitSentence();
  updateSaveEnabled();
}

function updateSaveEnabled() {
  const btn = document.getElementById('btn-save-entry');
  const amt = parseFloat(document.getElementById('entry-amount').value);
  // Design spec: enable the moment amount > 0. Description is still required
  // at submit time (existing validation there), no need to gate the button too.
  const ok = !isNaN(amt) && amt > 0;
  btn.disabled = !ok;
  btn.classList.toggle('disabled', !ok);
}

// --- Split (segmented control variant from design bundle: Variant A) ---
// Two stacked segmented controls — top row picks payer, bottom row picks
// "Split evenly" vs "For [the other person]". The second tile renames itself
// based on payer so the label always reads as "this expense was for X".
async function renderSplitSentence() {
  const segPayer = document.getElementById('seg-payer');
  const segType = document.getElementById('seg-type');
  const outcome = document.getElementById('split-outcome');
  const hint = document.getElementById('split-hint');
  // Defensive: bail if the new markup isn't present (e.g., during tests).
  if (!segPayer || !segType || !outcome) return;

  const partnerName = getUserName(getPartnerUid());

  // Normalize state
  const payer = splitState.payer === 'partner' ? 'partner' : 'self';
  splitState.payer = payer;
  const typeKey = splitState.typeKey === 'full' ? 'full' : 'even';
  splitState.typeKey = typeKey;
  splitState.splitType = typeKey;

  // --- Update payer segment ---
  segPayer.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.val === payer);
  });
  // The "partner" button label uses the dynamic partner name.
  const partnerBtn = segPayer.querySelector('button[data-val="partner"]');
  if (partnerBtn) {
    const span = partnerBtn.querySelector('.partner-name');
    if (span) span.textContent = partnerName;
  }

  // --- Update split-type segment ---
  segType.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.val === typeKey);
  });
  // Dynamic relabel of the "full" tile based on who paid.
  // Payer = self  →  "For <Partner>"  / "<Partner> owes full"
  // Payer = partner → "For you"       / "You owes full"  → grammar fix: "You owe full"
  const fullMain = document.getElementById('seg-full-main');
  const fullSub = document.getElementById('seg-full-sub');
  if (fullMain) {
    fullMain.textContent = payer === 'self' ? `For ${partnerName}` : 'For you';
  }
  if (fullSub) {
    fullSub.textContent = payer === 'self' ? `${partnerName} owes full` : 'You owe full';
  }

  // --- Result line ---
  const amt = parseFloat(document.getElementById('entry-amount').value);
  if (!amt || isNaN(amt) || amt <= 0) {
    outcome.textContent = '';
    outcome.classList.add('empty');
    if (hint) {
      hint.style.display = 'none'; // hint is redundant once segments are visible
    }
    return;
  }
  outcome.classList.remove('empty');
  if (hint) hint.style.display = 'none';

  const sym = getCurrencySymbol(activeCurrency).trim() || activeCurrency;
  const owedBy = payer === 'self' ? partnerName : 'You';
  const verb = payer === 'self' ? 'owes' : 'owe';
  const owedAmount = typeKey === 'even' ? amt / 2 : amt;
  const owedStr = `${sym}${formatAmt(owedAmount)}`;

  // USD-consolidated parenthetical when active currency != consol currency
  const consol = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
  let fx = '';
  if (activeCurrency !== consol) {
    try {
      const { getExchangeRate } = await import('./exchange.js');
      const rate = await getExchangeRate(activeCurrency);
      let consolAmt;
      if (consol === 'USD') {
        consolAmt = owedAmount * rate;
      } else {
        const consolRate = await getExchangeRate(consol);
        consolAmt = owedAmount * rate / consolRate;
      }
      const consolSym = getCurrencySymbol(consol).trim() || consol;
      fx = ` · ≈ ${consolSym}${formatAmt(consolAmt)}`;
    } catch (e) {}
  }

  outcome.innerHTML = `${owedBy} ${verb} <strong>${owedStr}</strong>${fx}`;
}

function formatAmt(v) {
  const abs = Math.abs(v);
  const intPart = Math.floor(abs);
  const digits = intPart === 0 ? 1 : String(intPart).length;
  if (digits >= 7) return abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (digits >= 5) return abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- Popover infrastructure ---
function openPopover({ anchor, items, onPick }) {
  const pop = document.getElementById('popover');
  pop.innerHTML = items.map((it, i) => `
    <div class="pop-item${it.on ? ' on' : ''}" data-i="${i}">
      <span>${it.label}${it.sub ? `<br><span class="sub">${it.sub}</span>` : ''}</span>
      ${it.on ? '<span class="check">✓</span>' : ''}
    </div>
  `).join('');

  // Position under anchor, relative to #screen-add
  const screen = document.getElementById('screen-add');
  const aRect = anchor.getBoundingClientRect();
  const sRect = screen.getBoundingClientRect();
  pop.style.left = (aRect.left - sRect.left) + 'px';
  pop.style.top = (aRect.bottom - sRect.top + 10) + 'px';
  pop.classList.remove('hidden');
  anchor.classList.add('hot');

  pop.querySelectorAll('.pop-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.i, 10);
      onPick(items[idx]);
      closePopover();
    });
  });

  // Close on outside tap
  function outside(ev) {
    if (!pop.contains(ev.target) && ev.target !== anchor) {
      closePopover();
    }
  }
  setTimeout(() => document.addEventListener('click', outside, { once: true, capture: true }), 0);
  pop._cleanup = () => { anchor.classList.remove('hot'); };
}

function closePopover() {
  const pop = document.getElementById('popover');
  if (pop._cleanup) pop._cleanup();
  pop.classList.add('hidden');
  pop.innerHTML = '';
}

// --- Bottom sheet infrastructure ---
function openSheet({ title, bodyHtml, searchable = false, onReady }) {
  const sheet = document.getElementById('bottom-sheet');
  const scrim = document.getElementById('scrim');
  sheet.innerHTML = `
    <div class="sheet-title">
      <span>${title}</span>
      <span class="done" id="sheet-done">Done</span>
    </div>
    ${searchable ? '<input type="text" class="sheet-search" placeholder="Search…">' : ''}
    ${bodyHtml}
  `;
  sheet.classList.remove('hidden');
  scrim.classList.remove('hidden');
  scrim.onclick = () => closeSheet();
  sheet.querySelector('#sheet-done')?.addEventListener('click', closeSheet);
  if (onReady) onReady(sheet);
}

function closeSheet() {
  const sheet = document.getElementById('bottom-sheet');
  const scrim = document.getElementById('scrim');
  sheet.classList.add('hidden');
  sheet.innerHTML = '';
  scrim.classList.add('hidden');
  scrim.onclick = null;
}

// --- Segmented split control handlers (Variant A) ---
// Direct tap-to-select; no popover. Each segment is a 2-button group whose
// active state is reflected by `.active`. Re-render after each change so the
// dynamic label ("For Alice" / "For you") and the result line stay in sync.
function bindSegment(containerId, onPick) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-val]');
    if (!btn || !el.contains(btn)) return;
    onPick(btn.dataset.val);
  });
}

bindSegment('seg-payer', (val) => {
  splitState.payer = val;
  renderSplitSentence();
});

bindSegment('seg-type', (val) => {
  splitState.typeKey = val;
  splitState.splitType = val;
  renderSplitSentence();
});

// --- Date chips ---
function applyDateChip(iso) {
  const today = new Date().toISOString().split('T')[0];
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().split('T')[0];

  document.querySelectorAll('#d-chips .d-chip').forEach(b => b.classList.remove('active'));
  const pickChip = document.querySelector('#d-chips .d-chip[data-date="pick"]');
  pickChip.textContent = 'Pick…';

  if (iso === today) {
    document.querySelector('#d-chips .d-chip[data-date="today"]').classList.add('active');
  } else if (iso === yesterday) {
    document.querySelector('#d-chips .d-chip[data-date="yesterday"]').classList.add('active');
  } else {
    pickChip.classList.add('active');
    const d = new Date(iso + 'T12:00:00');
    pickChip.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

document.querySelectorAll('#d-chips .d-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const which = btn.dataset.date;
    if (which === 'today') {
      const iso = new Date().toISOString().split('T')[0];
      document.getElementById('entry-date').value = iso;
      applyDateChip(iso);
    } else if (which === 'yesterday') {
      const d = new Date(); d.setDate(d.getDate() - 1);
      const iso = d.toISOString().split('T')[0];
      document.getElementById('entry-date').value = iso;
      applyDateChip(iso);
    } else {
      openCalendarSheet();
    }
  });
});

// --- Calendar sheet ---
function openCalendarSheet() {
  const initIso = document.getElementById('entry-date').value || new Date().toISOString().split('T')[0];
  let viewDate = new Date(initIso + 'T12:00:00');
  let selectedIso = initIso;

  function monthGridHtml() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const first = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();
    const startDow = first.getDay(); // 0=Sun
    const todayIso = new Date().toISOString().split('T')[0];

    const dayHeaders = ['S','M','T','W','T','F','S'].map(d => `<div class="d-h">${d}</div>`).join('');
    let cells = '';
    // Previous month's trailing days
    for (let i = startDow - 1; i >= 0; i--) {
      const day = prevLastDay - i;
      cells += `<button class="d muted" disabled>${day}</button>`;
    }
    // Current month
    for (let day = 1; day <= lastDay; day++) {
      const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const cls = ['d'];
      if (iso === todayIso) cls.push('today');
      if (iso === selectedIso) cls.push('sel');
      cells += `<button class="${cls.join(' ')}" data-iso="${iso}">${day}</button>`;
    }
    // Pad trailing next-month days to fill the grid
    const totalCells = startDow + lastDay;
    const pad = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= pad; i++) {
      cells += `<button class="d muted" disabled>${i}</button>`;
    }

    const monthName = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return `
      <div class="cal">
        <div class="cal-head">
          <button class="cal-nav" id="cal-prev">‹</button>
          <span>${monthName}</span>
          <button class="cal-nav" id="cal-next">›</button>
        </div>
        <div class="cal-grid">
          ${dayHeaders}
          ${cells}
        </div>
      </div>`;
  }

  function mount(sheet) {
    sheet.querySelector('#cal-prev')?.addEventListener('click', () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      sheet.querySelector('.cal').outerHTML = monthGridHtml();
      mount(sheet);
    });
    sheet.querySelector('#cal-next')?.addEventListener('click', () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
      sheet.querySelector('.cal').outerHTML = monthGridHtml();
      mount(sheet);
    });
    sheet.querySelectorAll('.cal-grid .d[data-iso]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedIso = btn.dataset.iso;
        sheet.querySelectorAll('.cal-grid .d').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
      });
    });
  }

  openSheet({
    title: 'Pick a date',
    bodyHtml: monthGridHtml(),
    onReady: (sheet) => {
      mount(sheet);
      sheet.querySelector('#sheet-done')?.addEventListener('click', () => {
        document.getElementById('entry-date').value = selectedIso;
        applyDateChip(selectedIso);
      });
    },
  });
}

// --- Recurring inline expand ---
function renderRecurringRow() {
  const row = document.getElementById('recur-row');
  if (!row) return;
  if (!recurringState.active) {
    row.classList.remove('open');
    row.innerHTML = `<span class="recur-label">Repeat this expense</span><span class="plus">+</span>`;
    row.onclick = () => { recurringState.active = true; renderRecurringRow(); updateSaveLabel(); };
    // Reset save label
    updateSaveLabel();
    return;
  }
  row.classList.add('open');
  const dateIso = document.getElementById('entry-date').value || new Date().toISOString().split('T')[0];
  const base = new Date(dateIso + 'T12:00:00');
  let next = new Date(base);
  if (recurringState.frequency === 'weekly') next.setDate(next.getDate() + 7);
  else if (recurringState.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  const nextLabel = next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  row.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="recur-label">Repeat this expense</span>
      <span class="plus" id="recur-close" style="transform:rotate(45deg);cursor:pointer">+</span>
    </div>
    <div class="recur-toggle" id="recur-freq">
      <button type="button" data-f="weekly" class="${recurringState.frequency === 'weekly' ? 'active' : ''}">Weekly</button>
      <button type="button" data-f="monthly" class="${recurringState.frequency === 'monthly' ? 'active' : ''}">Monthly</button>
      <button type="button" data-f="yearly" class="${recurringState.frequency === 'yearly' ? 'active' : ''}">Yearly</button>
    </div>
    <div style="font-size:10.5px;color:var(--text-muted)">Next occurrence: <strong>${nextLabel}</strong></div>
  `;
  row.onclick = null;
  document.getElementById('recur-close').addEventListener('click', (ev) => {
    ev.stopPropagation();
    recurringState.active = false;
    renderRecurringRow();
  });
  row.querySelectorAll('#recur-freq button').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      recurringState.frequency = b.dataset.f;
      renderRecurringRow();
    });
  });
  updateSaveLabel();
}

function updateSaveLabel() {
  const saveBtn = document.getElementById('btn-save-entry');
  if (!saveBtn) return;
  if (editingEntry) return; // don't change label when editing
  saveBtn.textContent = recurringState.active ? 'Save recurring' : 'Save expense';
}

// --- Description chip tap → open category sheet ---
document.getElementById('desc-chip').addEventListener('click', openCategorySheet);

// --- Description + amount wiring ---
document.getElementById('entry-desc').addEventListener('input', () => {
  // User edited description — clear any prior override so auto-detect resumes
  const form = document.getElementById('form-entry');
  delete form.dataset.catOverride;
  onDescInput();
});
document.getElementById('entry-amount').addEventListener('input', onAmountInput);

function updatePartnerNames() {
  const partnerName = getUserName(getPartnerUid());
  document.querySelectorAll('.partner-name').forEach(el => {
    el.textContent = partnerName;
  });
  renderSplitSentence();
}

// =========================================================================
// Settle Up — hero + per-currency rows + settle-all + zero-state
// =========================================================================

let _settleDebts = null;       // cached debts array for the current render
let _settleCurrencyBalances = null;
let _settleTotalUsd = 0;

async function renderSettleUp() {
  const container = document.getElementById('settle-container');
  const form = document.getElementById('form-entry');
  form.style.display = 'none';
  container.style.display = '';
  container.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px 0">Loading balances…</p>`;

  try {
    const { computeCurrencyBalances, formatAmountByDigits } = await import('./balance.js');
    const { getExchangeRate } = await import('./exchange.js');
    const { currencyBalances, balance: totalUsdBalance } = await computeCurrencyBalances();

    // Filter dust. `usdSigned` keeps the direction:
    //   > 0 → partner owes me in this currency
    //   < 0 → I owe partner in this currency
    const allDebts = Object.entries(currencyBalances).filter(([, v]) => Math.abs(v) > 0.005);
    const debts = [];
    for (const [cur, amount] of allDebts) {
      try {
        const rate = await getExchangeRate(cur);
        const usdSigned = amount * rate;
        if (Math.abs(usdSigned) >= 0.10) debts.push([cur, amount, usdSigned]);
      } catch (e) { debts.push([cur, amount, amount]); }
    }
    // Sort by magnitude so the biggest row (either direction) is on top.
    debts.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));

    _settleDebts = debts;
    _settleCurrencyBalances = currencyBalances;
    _settleTotalUsd = totalUsdBalance;

    if (debts.length === 0) {
      renderSettleZero({ firstLoad: true });
      return;
    }

    const partnerName = getUserName(getPartnerUid());

    const consol = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
    const consolSym = getCurrencySymbol(consol).trim() || consol;

    // Signed sum across currencies, converted to consol. Taking abs at the end
    // gives the magnitude; the sign tells us the net direction.
    let totalConsolSigned = 0;
    for (const [cur, amount] of debts) {
      if (cur === consol) {
        totalConsolSigned += amount;
      } else {
        try {
          const curToUsd = await getExchangeRate(cur);
          if (consol === 'USD') totalConsolSigned += amount * curToUsd;
          else {
            const consolToUsd = await getExchangeRate(consol);
            totalConsolSigned += amount * (curToUsd / consolToUsd);
          }
        } catch (e) {}
      }
    }
    const totalConsol = Math.abs(totalConsolSigned);
    const iOweNet = totalConsolSigned < 0;
    // The hero headline — use "you" on the viewer's side so the sentence
    // reads naturally regardless of the viewer's display name.
    const label = iOweNet
      ? `You owe ${partnerName}, net`
      : `${partnerName} owes you, net`;

    // Per-row meta: just direction. Percentages were removed because rows can
    // point in opposite directions ("you owe €100" + "they owe you $100"),
    // where each row's share of total activity magnitude doesn't correspond
    // to its share of the net hero total — and is actively misleading.
    let rowsHtml = '';
    debts.forEach(([cur, amount]) => {
      const abs = Math.abs(amount);
      const sym = getCurrencySymbol(cur).trim() || cur;
      const iOweThis = amount < 0;
      const sign = iOweThis ? '−' : '+';
      const color = iOweThis ? 'var(--red)' : 'var(--green)';
      const dirLabel = iOweThis ? 'you owe' : 'they owe you';
      rowsHtml += `
        <div class="settle-row" data-cur="${cur}">
          <div>
            <div class="settle-amt" style="color:${color}">${sign}${sym}${formatAmountByDigits(abs)}</div>
            <div class="settle-meta">${cur} · ${dirLabel}</div>
          </div>
          <button class="settle-btn" data-cur="${cur}">Mark paid</button>
        </div>`;
    });

    container.innerHTML = `
      <div class="settle-hero">
        <div class="settle-label">${label}</div>
        <div class="settle-total" style="color:${iOweNet ? 'var(--red)' : 'var(--green)'}">${consolSym}${formatAmountByDigits(totalConsol)}</div>
        <div class="settle-sub">across ${debts.length} ${debts.length === 1 ? 'currency' : 'currencies'} · as of today</div>
      </div>
      <div id="settle-rows">${rowsHtml}</div>
      <div class="save" style="margin-top:14px">
        <button type="button" id="btn-settle-all">Settle everything</button>
      </div>
    `;

    container.querySelectorAll('.settle-btn').forEach(btn => {
      btn.addEventListener('click', () => onMarkPaidClick(btn.dataset.cur));
    });
    document.getElementById('btn-settle-all').addEventListener('click', onSettleAllClick);
  } catch (err) {
    console.error('renderSettleUp failed:', err);
    container.innerHTML = `<p style="color:var(--red);text-align:center">Failed to load balances.</p>`;
  }
}

function renderSettleZero({ firstLoad = false, settledCount = 0 } = {}) {
  const container = document.getElementById('settle-container');
  const partnerName = getUserName(getPartnerUid());
  const body = firstLoad
    ? `All settled. Nothing to pay.`
    : `You don’t owe ${partnerName} a yen. ${partnerName} doesn’t owe you a yen.`;
  const today = new Date();
  const stamp = `SETTLED ${today.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase()} · ${today.getFullYear()}`;
  container.innerHTML = `
    <div class="settle-zero">
      <div class="settle-zero-check">✓</div>
      <div class="settle-zero-title">All square.</div>
      <div class="settle-zero-body">${body}</div>
      ${!firstLoad ? `<div class="settle-zero-footer">${stamp}</div>` : ''}
    </div>
    ${!firstLoad ? `<div class="settle-zero-quip">Until the next ramen.</div>` : ''}
    <div class="save">
      <button type="button" id="btn-back-to-dash" class="back-to-dash">Back to dashboard</button>
    </div>
  `;
  document.getElementById('btn-back-to-dash').addEventListener('click', async () => {
    showScreen('dashboard', 'slide-back');
    const { loadDashboard } = await import('./balance.js');
    invalidateAllCaches(); loadDashboard(true);
  });
}

function onMarkPaidClick(currency) {
  const entry = _settleDebts.find(([c]) => c === currency);
  if (!entry) return;
  const [, amount, usdSigned] = entry;
  const abs = Math.round(Math.abs(amount) * 100) / 100;
  const usdAbs = Math.abs(usdSigned);
  const sym = getCurrencySymbol(currency).trim() || currency;
  const partnerName = getUserName(getPartnerUid());
  const consol = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
  const consolSym = getCurrencySymbol(consol).trim() || consol;
  const iOweThis = amount < 0;
  const row = document.querySelector(`.settle-row[data-cur="${currency}"]`);
  if (row) row.classList.add('selected');

  const question = iOweThis
    ? `Mark <strong>${sym}${abs.toLocaleString()}</strong> (≈ ${consolSym}${usdAbs.toFixed(2)}) as paid to ${partnerName}?`
    : `Mark <strong>${sym}${abs.toLocaleString()}</strong> (≈ ${consolSym}${usdAbs.toFixed(2)}) as received from ${partnerName}?`;

  openSheet({
    title: 'Confirm',
    bodyHtml: `
      <div style="padding:10px 4px 14px;font-size:14px;color:var(--text);line-height:1.5">
        ${question}
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:8px">The other currencies stay open — this just zeros out ${currency}.</div>
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" id="settle-cancel" style="flex:1;padding:11px;border-radius:12px;background:var(--bg);border:none;font-weight:600;font-family:inherit">Cancel</button>
        <button type="button" id="settle-ok" style="flex:1;padding:11px;border-radius:12px;background:var(--accent);color:#fff;border:none;font-weight:700;font-family:inherit">${iOweThis ? 'Yes, mark paid' : 'Yes, mark received'}</button>
      </div>
    `,
    onReady: (sheet) => {
      sheet.querySelector('#settle-cancel').addEventListener('click', () => {
        if (row) row.classList.remove('selected');
        closeSheet();
      });
      sheet.querySelector('#settle-ok').addEventListener('click', async () => {
        closeSheet();
        await confirmMarkPaid(currency, abs, usdAbs);
      });
    },
  });
}

async function confirmMarkPaid(currency, abs, usdAbs) {
  try {
    const { convertToUSD } = await import('./exchange.js');
    const { usdAmount, exchangeRate } = await convertToUSD(abs, currency);
    const curBalance = _settleCurrencyBalances[currency] || 0;
    const paidBy = curBalance < 0 ? currentUser.uid : getPartnerUid();
    const paidTo = curBalance < 0 ? getPartnerUid() : currentUser.uid;

    const docRef = await db.collection('payments').add({
      amount: abs,
      currency,
      usdAmount,
      exchangeRate,
      paidBy,
      paidTo,
      date: new Date(),
      addedBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // Track used currency
    localStorage.setItem('daumis-debt-last-currency', currency);
    try {
      const used = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
      if (!used.includes(currency)) { used.push(currency); localStorage.setItem('daumis-debt-used-currencies', JSON.stringify(used)); }
    } catch (e) {}

    // Replace the row with a dashed just-settled affordance + 8s undo
    const row = document.querySelector(`.settle-row[data-cur="${currency}"]`);
    if (row) {
      row.classList.remove('selected');
      row.classList.add('just-settled');
      const sym = getCurrencySymbol(currency).trim() || currency;
      row.innerHTML = `
        <div>
          <div class="settle-amt">${sym}${abs.toLocaleString()} settled just now</div>
          <div class="settle-meta">Logged as a settle entry</div>
        </div>
        <button class="settle-btn" data-undo="${docRef.id}">Undo</button>
      `;
      const undoBtn = row.querySelector('[data-undo]');
      let undone = false;
      const timer = setTimeout(() => {
        if (undone) return;
        row.style.transition = 'opacity 400ms ease';
        row.style.opacity = '0';
        setTimeout(() => { renderSettleUp(); }, 450);
      }, 8000);
      undoBtn.addEventListener('click', async () => {
        undone = true;
        clearTimeout(timer);
        try { await db.collection('payments').doc(docRef.id).delete(); } catch (e) {}
        invalidateAllCaches();
        renderSettleUp();
      });
    }

    // Toast
    showToast(`${currency} cleared · balance update pending`);
    invalidateAllCaches();

    // Recompute hero/totals to reflect the cleared currency (but keep the
    // just-settled row visible) — we do a softer re-render after 8s above.
    // For now, update the hero label immediately by re-fetching totals.
    // Simpler: re-render after a short beat so the undo window stays stable.
  } catch (err) {
    console.error('Mark paid failed:', err);
    alert('Failed to save settlement.');
  }
}

function onSettleAllClick() {
  if (!_settleDebts || _settleDebts.length === 0) return;
  const partnerName = getUserName(getPartnerUid());
  const breakdown = _settleDebts.map(([cur, amount]) => {
    const sym = getCurrencySymbol(cur).trim() || cur;
    return `${sym}${Math.abs(amount).toLocaleString()}`;
  }).join(' · ');

  const consol = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
  const consolSym = getCurrencySymbol(consol).trim() || consol;
  const totalUsd = _settleDebts.reduce((s, [, , usd]) => s + usd, 0);

  openSheet({
    title: `Settle all ${_settleDebts.length}?`,
    bodyHtml: `
      <div style="padding:10px 4px 14px;font-size:14px;color:var(--text);line-height:1.5">
        <div style="font-size:26px;font-weight:700;letter-spacing:-0.5px;margin-bottom:4px">${consolSym}${totalUsd.toFixed(2)}</div>
        <div style="font-size:11.5px;color:var(--text-muted)">${breakdown}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:8px">Creates one settlement per currency at the exact amount.</div>
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" id="sa-cancel" style="flex:1;padding:11px;border-radius:12px;background:var(--bg);border:none;font-weight:600;font-family:inherit">Cancel</button>
        <button type="button" id="sa-ok" style="flex:1;padding:11px;border-radius:12px;background:var(--accent);color:#fff;border:none;font-weight:700;font-family:inherit">Yes — settle all</button>
      </div>
    `,
    onReady: (sheet) => {
      sheet.querySelector('#sa-cancel').addEventListener('click', closeSheet);
      sheet.querySelector('#sa-ok').addEventListener('click', async () => {
        closeSheet();
        await settleEverything();
      });
    }
  });
}

async function settleEverything() {
  const count = _settleDebts.length;
  try {
    const { convertToUSD } = await import('./exchange.js');
    for (const [currency, amount] of _settleDebts) {
      const abs = Math.round(Math.abs(amount) * 100) / 100;
      const { usdAmount, exchangeRate } = await convertToUSD(abs, currency);
      const paidBy = amount < 0 ? currentUser.uid : getPartnerUid();
      const paidTo = amount < 0 ? getPartnerUid() : currentUser.uid;
      await db.collection('payments').add({
        amount: abs,
        currency,
        usdAmount,
        exchangeRate,
        paidBy,
        paidTo,
        date: new Date(),
        addedBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    invalidateAllCaches();
    renderSettleZero({ firstLoad: false, settledCount: count });
    showToast(`All ${count} currencies cleared`);
  } catch (err) {
    console.error('Settle all failed:', err);
    alert('Failed to settle.');
  }
}

// --- Toast helper ---
function showToast(text, { screen = 'add' } = {}) {
  let toast;
  if (screen === 'add') {
    toast = document.getElementById('entry-toast');
    if (!toast) return;
    const textEl = document.getElementById('entry-toast-text');
    if (textEl) textEl.textContent = text;
    toast.classList.remove('hidden');
    // Force reflow so transition fires
    void toast.offsetWidth;
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.classList.add('hidden'), 250);
    }, 2500);
  } else {
    // Dashboard toast — reuse the entry-toast node but position it in viewport
    toast = document.getElementById('entry-toast');
    if (!toast) return;
    const textEl = document.getElementById('entry-toast-text');
    if (textEl) textEl.textContent = text;
    toast.classList.remove('hidden');
    void toast.offsetWidth;
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.classList.add('hidden'), 250);
    }, 2500);
  }
}

// =========================================================================
// Form submission — Save Expense / Save Recurring
// =========================================================================
let _pendingNewEntry = null; // { description, at: Date } used to glow the new history row

document.getElementById('form-entry').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const amount = parseFloat(document.getElementById('entry-amount').value);
  const currency = activeCurrency;
  const date = document.getElementById('entry-date').value;
  const description = document.getElementById('entry-desc').value.trim();

  // Two split types:
  //   'even' — both owe half (paidBy is who paid, owedBy is the other party)
  //   'full' — whoever paid is owed in full (owedBy is the other party)
  const typeKey = splitState.typeKey === 'full' ? 'full' : 'even';
  const paidByValue = splitState.payer; // 'self' | 'partner'
  const owedByValue = paidByValue === 'self' ? 'partner' : 'self';
  const splitType = typeKey;

  // Validation
  if (!description) { alert('Please add a description.'); return; }
  if (description.length > 200) { alert('Description is too long (max 200 characters).'); return; }
  if (!amount || isNaN(amount) || amount <= 0) { alert('Please enter a valid positive amount.'); return; }
  if (amount > 1000000) { alert('Amount seems too large.'); return; }

  const saveBtn = document.getElementById('btn-save-entry');
  saveBtn.disabled = true;
  saveBtn.classList.add('loading');
  const prevLabel = saveBtn.textContent;
  saveBtn.innerHTML = `<span class="spinner"></span> Saving…`;

  try {
    const { usdAmount, exchangeRate } = await convertToUSD(amount, currency);
    const paidByUid = paidByValue === 'self' ? currentUser.uid : getPartnerUid();
    const owedByUid = owedByValue === 'self' ? currentUser.uid : getPartnerUid();
    const expenseDate = new Date(date + 'T12:00:00');
    const isFuture = expenseDate > new Date();

    const isRecurring = !editingEntry && recurringState.active;
    const freq = recurringState.frequency;

    if (isFuture && isRecurring) {
      const { createRecurring } = await import('./recurring.js');
      await createRecurring({
        description, amount, currency, paidBy: paidByUid, splitType,
        owedBy: owedByUid, frequency: freq,
        addedBy: currentUser.uid, startDate: expenseDate,
      });
    } else if (editingEntry && editingEntry.type === 'expense') {
      await db.collection('expenses').doc(editingEntry.id).update({
        description, amount, currency, usdAmount, exchangeRate,
        paidBy: paidByUid, splitType, owedBy: owedByUid, date: expenseDate,
      });
    } else {
      await db.collection('expenses').add({
        description, amount, currency, usdAmount, exchangeRate,
        paidBy: paidByUid, splitType, owedBy: owedByUid, date: expenseDate,
        addedBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (isRecurring && !isFuture) {
        const { createRecurring } = await import('./recurring.js');
        await createRecurring({
          description, amount, currency, paidBy: paidByUid, splitType,
          owedBy: owedByUid, frequency: freq,
          addedBy: currentUser.uid, startDate: expenseDate,
        });
      }
    }

    // Track used currencies
    localStorage.setItem('daumis-debt-last-currency', currency);
    try {
      const used = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
      if (!used.includes(currency)) { used.push(currency); localStorage.setItem('daumis-debt-used-currencies', JSON.stringify(used)); }
    } catch (e) {}

    _pendingNewEntry = { description, at: Date.now(), isRecurring };
    const wasEditing = !!editingEntry;
    editingEntry = null;

    // Navigate to dashboard and refresh
    showScreen('dashboard', 'slide-back');
    const { loadDashboard } = await import('./balance.js');
    invalidateAllCaches();
    await loadDashboard(true);
    glowMostRecentHistoryRow();
    showDashboardToast(isRecurring ? 'Recurring saved' : (wasEditing ? 'Updated' : 'Added · balance updated'));
  } catch (err) {
    console.error('Error saving entry:', err);
    alert('Failed to save. Check your connection.');
  } finally {
    saveBtn.classList.remove('loading');
    saveBtn.disabled = false;
    saveBtn.textContent = prevLabel;
  }
});

/**
 * Flag the topmost history row so its CSS animation runs.
 * The `.new-entry` rule in style.css handles the fade.
 */
function glowMostRecentHistoryRow() {
  const first = document.querySelector('#history-list li');
  if (!first) return;
  first.classList.add('new-entry');
  setTimeout(() => first.classList.remove('new-entry'), 3200);
}

/**
 * Show the app-wide toast (sibling of all screens — works on any screen).
 */
function showDashboardToast(text) {
  const toast = document.getElementById('entry-toast');
  if (!toast) return;
  const label = document.getElementById('entry-toast-text');
  if (label) label.textContent = text;
  toast.classList.remove('hidden');
  // Force reflow so the transition runs when we add .visible.
  void toast.offsetWidth;
  toast.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.classList.add('hidden'), 260);
  }, 2500);
}

// --- Insights ---
let _insightsCache = null; // { expenses, duelSnap } — reused across period switches

async function loadInsights(period) {
  const container = document.getElementById('insights-content');
  container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px">Loading...</p>';

  try {
    if (!_insightsCache) {
      const [expSnap, paySnap, duelSnap] = await Promise.all([
        db.collection('expenses').get(),
        db.collection('payments').get(),
        db.collection('duels').get()
      ]);

      const rawExpenses = [];
      expSnap.forEach(doc => {
        const d = doc.data();
        let date;
        try {
          date = d.date?.toDate ? d.date.toDate() : (d.date?.seconds ? new Date(d.date.seconds * 1000) : new Date(d.date));
        } catch(e) { date = new Date(); }
        rawExpenses.push({ ...d, date, id: doc.id });
      });
      _insightsCache = { expenses: rawExpenses, duelSnap };
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const expenses = _insightsCache.expenses;
    const duelSnap = _insightsCache.duelSnap;

    // Filter by period
    const filtered = period === 'month'
      ? expenses.filter(e => e.date >= thirtyDaysAgo)
      : expenses;

    function categorizeLocal(desc) {
      if (!desc) return { icon: '$', label: 'other' };
      const d = desc.toLowerCase();
      const cats = [
        { keywords: ['grocery','groceries','supermarket','market','produce','trader joe','whole foods','lawson','conbini','7/11','7-11','jmart','vegg','fruit','egg','milk','bread','rice','olive oil','seaweed','detergent','snack'], icon: '🛒', label: 'groceries' },
        { keywords: ['restaurant','dinner','lunch','breakfast','cafe','coffee','eat','sushi','pizza','burger','ramen','noodle','brunch','bistro','datshi','thai','korean','japanese','indian','chinese','mexican','italian','pastry','bakery','bar','pub','beer','wine','drink','cocktail','boba','bubble tea','tea','matcha','latte','cappuccino','capuccino','falafel','kebab','hummus','salad','momo','dosa','paneer','shabu','chipotle','mcdo','ice cream','cookie','chocolate','yogurt','smoothie','soho','munch','dimsum','wok'], icon: '🍽️', label: 'dining' },
        { keywords: ['flight','flights','airline','airport','plane','boarding','eurowings','eva air','air'], icon: '✈️', label: 'flights' },
        { keywords: ['hotel','hostel','airbnb','accommodation','stay','booking','resort','room upgrade'], icon: '🏨', label: 'lodging' },
        { keywords: ['uber','lyft','taxi','cab','bus','train','metro','subway','transport','transit','grab','bolt','driver','sim card','data'], icon: '🚕', label: 'transport' },
        { keywords: ['gas','fuel','petrol','parking','car','rental','toll','suv'], icon: '⛽', label: 'auto' },
        { keywords: ['movie','cinema','ticket','concert','show','museum','park','tour','attraction','entertainment','game','entrance','festival','spa','massage','hot stone','spotify'], icon: '🎬', label: 'entertainment' },
        { keywords: ['rent','electric','electricity','water','internet','wifi','utility','utilities','bill','phone','laundry','household','house stuff','machine','fitlab'], icon: '🏠', label: 'housing' },
        { keywords: ['doctor','hospital','medicine','pharmacy','health','medical','dental','drugstore'], icon: '💊', label: 'health' },
        { keywords: ['clothes','clothing','shoes','shirt','dress','shopping','mall','store','shop','uniqlo'], icon: '🛍️', label: 'shopping' },
        { keywords: ['gift','present','birthday','anniversary','bday','tip'], icon: '🎁', label: 'gifts' },
        { keywords: ['splitwise','balance','transfer','settle','cash','money exchange','pay off'], icon: '📊', label: 'balance' },
      ];
      for (const cat of cats) {
        if (cat.keywords.some(kw => d.includes(kw))) return cat;
      }
      return { icon: '$', label: 'other' };
    }

    // --- Category breakdown ---
    const catTotals = {};
    const catIcons = {};
    filtered.forEach(e => {
      const cat = categorizeLocal(e.description);
      if (!catTotals[cat.label]) { catTotals[cat.label] = 0; catIcons[cat.label] = cat.icon; }
      catTotals[cat.label] += (e.usdAmount || e.amount || 0);
    });

    const catSorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const maxCat = catSorted.length > 0 ? catSorted[0][1] : 1;

    // --- Monthly trend ---
    const monthlyTotals = {};
    expenses.forEach(e => {
      const key = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`;
      monthlyTotals[key] = (monthlyTotals[key] || 0) + (e.usdAmount || e.amount || 0);
    });
    const monthKeys = Object.keys(monthlyTotals).sort();
    const recentMonths = monthKeys.slice(-6);
    const maxMonth = Math.max(...recentMonths.map(k => monthlyTotals[k]), 1);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // --- Country breakdown ---
    const CURRENCY_COUNTRY = {
      BTN: { flag: '🇧🇹', name: 'Bhutan' }, INR: { flag: '🇮🇳', name: 'India' },
      JPY: { flag: '🇯🇵', name: 'Japan' }, USD: { flag: '🇺🇸', name: 'United States' },
      GBP: { flag: '🇬🇧', name: 'United Kingdom' }, EUR: { flag: '🇪🇺', name: 'Europe' },
      THB: { flag: '🇹🇭', name: 'Thailand' }, SGD: { flag: '🇸🇬', name: 'Singapore' },
      KRW: { flag: '🇰🇷', name: 'South Korea' }, TWD: { flag: '🇹🇼', name: 'Taiwan' },
      AUD: { flag: '🇦🇺', name: 'Australia' }, CAD: { flag: '🇨🇦', name: 'Canada' },
      AED: { flag: '🇦🇪', name: 'UAE' }, CNY: { flag: '🇨🇳', name: 'China' },
    };
    const countryTotals = {};
    filtered.forEach(e => {
      if (!e.currency) return;
      const country = CURRENCY_COUNTRY[e.currency] || { flag: '🌍', name: e.currency };
      const key = country.name;
      if (!countryTotals[key]) countryTotals[key] = { flag: country.flag, total: 0 };
      countryTotals[key].total += (e.usdAmount || e.amount || 0);
    });
    const countrySorted = Object.entries(countryTotals).sort((a, b) => b[1].total - a[1].total);

    // --- Fun stats ---
    let biggest = { desc: '-', amount: 0 };
    let smallest = { desc: '-', amount: Infinity };
    filtered.forEach(e => {
      const usd = e.usdAmount || e.amount || 0;
      if (usd > biggest.amount) biggest = { desc: e.description || 'Unknown', amount: usd };
      if (usd < smallest.amount && usd > 0) smallest = { desc: e.description || 'Unknown', amount: usd };
    });
    if (smallest.amount === Infinity) smallest = { desc: '-', amount: 0 };

    const catCounts = {};
    filtered.forEach(e => {
      const cat = categorizeLocal(e.description);
      catCounts[cat.label] = (catCounts[cat.label] || 0) + 1;
    });
    const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];

    // Duel record
    let galWins = 0, daumWins = 0;
    duelSnap.forEach(doc => {
      const d = doc.data();
      if (!d.result || !d.balanceAdjust) return;
      if (d.favoredUser === currentUser.uid) galWins++;
      else if (d.favoredUser) daumWins++;
    });

    // Average daily spend
    const daySpan = filtered.length > 0
      ? Math.max(1, Math.ceil((now - Math.min(...filtered.map(e => e.date.getTime()))) / 86400000))
      : 1;
    const totalSpend = filtered.reduce((sum, e) => sum + (e.usdAmount || e.amount || 0), 0);
    const avgDaily = totalSpend / daySpan;

    const partnerName = getUserName(getPartnerUid());

    // Get consolidation currency for display
    const consolCurrency = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
    let usdToConsol = 1;
    if (consolCurrency !== 'USD') {
      const { getExchangeRate } = await import('./exchange.js');
      const rate = await getExchangeRate(consolCurrency);
      usdToConsol = rate ? 1 / rate : 1;
    }
    const sym = getCurrencySymbol(consolCurrency);
    const fmt = (usd) => sym + Math.round(usd * usdToConsol).toLocaleString();
    const fmtDec = (usd) => sym + (usd * usdToConsol).toFixed(2);

    // --- Render ---
    let html = '';

    // Category breakdown
    html += '<div class="insight-card"><h3>Spending by Category</h3>';
    catSorted.slice(0, 8).forEach(([label, total]) => {
      const pct = (total / maxCat * 100).toFixed(0);
      html += `<div class="cat-row">
        <span class="cat-icon">${catIcons[label]}</span>
        <span class="cat-name">${label}</span>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div>
        <span class="cat-amount">${fmt(total)}</span>
      </div>`;
    });
    html += '</div>';

    // Monthly trend (only for "all time")
    if (period === 'all' && recentMonths.length > 1) {
      html += '<div class="insight-card"><h3>Monthly Spending</h3><div class="trend-chart">';
      recentMonths.forEach(k => {
        const val = monthlyTotals[k];
        const pct = (val / maxMonth * 100).toFixed(0);
        const [y, m] = k.split('-');
        const label = monthNames[parseInt(m) - 1];
        html += `<div class="trend-bar" style="height:${pct}%">
          <span class="t-val">${fmt(val)}</span>
          <span class="t-label">${label}</span>
        </div>`;
      });
      html += '</div></div>';
    }

    // Country breakdown
    if (countrySorted.length > 0) {
      html += '<div class="insight-card"><h3>Where You Spend</h3>';
      countrySorted.forEach(([name, { flag, total }]) => {
        html += `<div class="country-row">
          <span class="country-flag">${flag}</span>
          <span class="country-name">${name}</span>
          <span class="country-amount">${fmt(total)}</span>
        </div>`;
      });
      html += '</div>';
    }

    // Fun stats
    html += '<div class="insight-card"><h3>Fun Stats</h3>';
    html += `<div class="stat-row"><span class="stat-label">Biggest expense</span><span class="stat-value">${fmt(biggest.amount)} 🤯</span></div>`;
    html += `<div class="stat-row"><span class="stat-label">Smallest expense</span><span class="stat-value">${fmtDec(smallest.amount)} 🔍</span></div>`;
    if (topCat) html += `<div class="stat-row"><span class="stat-label">Top category</span><span class="stat-value">${catIcons[topCat[0]]} ${topCat[0]} (${topCat[1]}x)</span></div>`;
    html += `<div class="stat-row"><span class="stat-label">Total expenses</span><span class="stat-value">${filtered.length}</span></div>`;
    const myName = getUserName(currentUser.uid);
    html += `<div class="stat-row"><span class="stat-label">Duel record</span><span class="stat-value">${myName} ${galWins} — ${daumWins} ${partnerName}</span></div>`;
    html += `<div class="stat-row"><span class="stat-label">Avg daily spend</span><span class="stat-value">${fmtDec(avgDaily)}/day</span></div>`;
    html += '</div>';

    container.innerHTML = html;

  } catch (err) {
    console.error('Insights error:', err);
    container.innerHTML = '<p style="text-align:center;color:var(--red)">Failed to load insights.</p>';
  }
}

// --- App entry ---
async function showApp() {
  showScreen('dashboard');

  const balanceMod = await import('./balance.js');

  // Paint last-known balance from localStorage while Firestore loads. This
  // stamps real numbers into the DOM so they're already visible the moment
  // the splash hides, regardless of how fast Firestore responds.
  balanceMod.paintCachedBalance();

  // Load user profiles (cache-first).
  const userProfilesPromise = (async () => {
    try {
      const usersSnap = await db.collection('users').get({ source: 'cache' })
        .then(s => s.empty ? db.collection('users').get() : s)
        .catch(() => db.collection('users').get());
      usersSnap.forEach((doc) => {
        const data = doc.data();
        if (data.displayName) {
          userNames[doc.id] = data.displayName;
        } else if (doc.id === currentUser.uid) {
          userNames[doc.id] = currentUser.displayName || data.email || currentUser.email;
        } else {
          userNames[doc.id] = data.email || 'Partner';
        }
      });
    } catch (e) { console.warn('Could not load user profiles:', e); }
  })();

  // Populate the dashboard cache-first BEFORE hiding the splash — otherwise
  // the user sees an empty shell on first load / when localStorage is stale.
  // On repeat loads IndexedDB is warm and this completes in <300ms; on a
  // truly-first load we fall through to the network. The 10s safety
  // timeout in app.js still bounds the splash.
  await userProfilesPromise;
  const cacheResult = await balanceMod.loadDashboard(false, { source: 'cache' });
  if (cacheResult && cacheResult.cacheEmpty) {
    await balanceMod.loadDashboard(true);
  }
  hideSplash();

  // Background refresh so server data eventually reconciles with the cache.
  // Skipped when we just fetched from the network above.
  if (!cacheResult || !cacheResult.cacheEmpty) {
    setTimeout(() => {
      balanceMod.invalidateDataCache();
      balanceMod.loadDashboard(true);
    }, 500);
  }

  // Run backfill and recurring in background (don't block the UI)
  backfillPartnerUids().then(() => {
    import('./recurring.js').then(({ processRecurring }) => {
      processRecurring(currentUser).then(count => {
        if (count > 0) { invalidateAllCaches(); import('./balance.js').then(({ loadDashboard }) => loadDashboard(true)); }
      });
    });
  });
}

/**
 * Backfill docs where paidBy, owedBy, or paidTo is null.
 * This happens when expenses were created before the partner logged in.
 * Replaces null with the partner's UID now that both users are known.
 */
let backfillDone = false;
const BACKFILL_KEY = 'daumis-debt-backfill-v1';
async function backfillPartnerUids() {
  if (backfillDone) return;
  if (localStorage.getItem(BACKFILL_KEY)) return;
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

  backfillDone = true;
  localStorage.setItem(BACKFILL_KEY, '1');
  if (patched > 0) console.log(`Backfilled ${patched} docs with partner UID`);
}

export function invalidateAllCaches() {
  _insightsCache = null;
  import('./balance.js').then(({ invalidateDataCache }) => invalidateDataCache());
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
      // Check for updates immediately on load, then every 60 seconds
      reg.update();
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
