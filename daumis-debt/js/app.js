import { auth, googleProvider } from './firebase-config.js';
import { db } from './firebase-config.js';
import { convertToUSD } from './exchange.js';

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
      // Complete: animate off screen
      topScreen.style.transition = 'transform 0.25s ease-out';
      topScreen.style.transform = `translateX(${window.innerWidth}px)`;
      setTimeout(() => {
        topScreen.classList.remove('active');
        cleanup();
      }, 250);
      editingEntry = null;
      currentScreen = 'screen-dashboard';
      dashboard.classList.remove('swipe-base');
      dashboard.classList.add('active');
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

function buildCurrencySelect(extraCurrency) {
  const select = document.getElementById('entry-currency');
  const prioritySet = new Set();
  if (extraCurrency) prioritySet.add(extraCurrency);

  // Get currencies with balances and their sizes
  const balanceSizes = {};
  try {
    const used = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
    used.forEach(c => prioritySet.add(c));
    const sizes = JSON.parse(localStorage.getItem('daumis-debt-currency-balances') || '{}');
    Object.assign(balanceSizes, sizes);
    // Add any currency with a non-zero balance to priority
    for (const [cur, amt] of Object.entries(sizes)) {
      if (Math.abs(amt) > 0.005) prioritySet.add(cur);
    }
  } catch (e) {}

  // Always include last used
  const lastUsed = localStorage.getItem('daumis-debt-last-currency');
  if (lastUsed) prioritySet.add(lastUsed);

  // Always include consolidation currency
  const consolCur = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
  prioritySet.add(consolCur);

  select.innerHTML = '';

  // Priority currencies sorted: last-used first, then by balance size
  const priorityCurrencies = ALL_CURRENCIES.filter(c => prioritySet.has(c.code));
  priorityCurrencies.sort((a, b) => {
    // Last used always first
    if (a.code === lastUsed) return -1;
    if (b.code === lastUsed) return 1;
    // Then by absolute balance size (largest first)
    const balA = Math.abs(balanceSizes[a.code] || 0);
    const balB = Math.abs(balanceSizes[b.code] || 0);
    if (balA !== balB) return balB - balA;
    // Then consolidation currency
    if (a.code === consolCur) return -1;
    if (b.code === consolCur) return 1;
    return 0;
  });
  const otherCurrencies = ALL_CURRENCIES.filter(c => !prioritySet.has(c.code));

  priorityCurrencies.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.label;
    select.appendChild(opt);
  });

  // Separator
  if (priorityCurrencies.length > 0 && otherCurrencies.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '── Other ──';
    select.appendChild(sep);
  }

  // All other currencies
  otherCurrencies.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.label;
    select.appendChild(opt);
  });
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
  showScreen('add', 'slide-forward');
  // Restore entry type toggle visibility
  document.querySelector('#screen-add > .toggle-group').style.display = '';
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
  // Build smart currency dropdown and select last-used
  buildCurrencySelect();
  const defaultCurrency = localStorage.getItem('daumis-debt-last-currency') || 'USD';
  document.getElementById('entry-currency').value = defaultCurrency;
  // Reset edit UI
  const deleteBtn = document.getElementById('btn-delete-entry');
  if (deleteBtn) deleteBtn.style.display = 'none';
  const submitBtn = document.querySelector('#form-entry button[type="submit"]');
  submitBtn.textContent = 'Save';
  // Auto-focus the amount field
  setTimeout(() => document.getElementById('entry-amount').focus(), 100);
});

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
  document.querySelector('#screen-add > .toggle-group').style.display = 'none';
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
    document.querySelector('#screen-add > .toggle-group').style.display = 'none';
    document.getElementById('form-entry').style.display = 'none';

    // Show detail in settle container
    let container = document.getElementById('settle-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'settle-container';
      document.getElementById('form-entry').parentNode.insertBefore(container, document.getElementById('form-entry'));
    }

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
        invalidateAllCaches(); loadDashboard();
      } catch (err) {
        console.error('Delete failed:', err);
        alert('Failed to delete.');
      }
    });
    return;
  }

  showScreen('add', 'slide-forward');

  // Set entry type toggle to expense
  document.querySelectorAll('#entry-type .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === 'expense');
  });
  // Show entry type toggle
  document.querySelector('#screen-add > .toggle-group').style.display = '';
  updateFormForType('expense');

  // Pre-fill fields
  document.getElementById('entry-desc').value = data.description || '';
  document.getElementById('entry-amount').value = data.amount || '';
  buildCurrencySelect(data.currency);
  document.getElementById('entry-currency').value = data.currency || 'USD';

  // Set the correct split option
  const paidBySelf = data.paidBy === currentUser.uid;
  const paidValue = paidBySelf ? 'self' : 'partner';
  const splitValue = data.splitType || 'even';
  document.querySelectorAll('.split-option').forEach(b => {
    b.classList.toggle('active', b.dataset.paid === paidValue && b.dataset.split === splitValue);
  });

  // Set date
  const dateObj = data.date?.toDate ? data.date.toDate() : new Date(data.date);
  document.getElementById('entry-date').value = dateObj.toISOString().split('T')[0];

  // Hide recurring group when editing
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
      invalidateAllCaches(); loadDashboard();
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
  const form = document.getElementById('form-entry');
  const settleContainer = document.getElementById('settle-container');

  if (type === 'payment') {
    form.style.display = 'none';
    title.textContent = 'Settle Up';
    renderSettleUp();
  } else {
    if (settleContainer) settleContainer.style.display = 'none';
    form.style.display = '';
    descField.style.display = '';
    expenseOptions.style.display = '';
    paymentDirection.style.display = 'none';
    recurringGroup.style.display = '';
    title.textContent = 'Add Expense';
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

async function renderSettleUp() {
  // Get or create the settle container
  let container = document.getElementById('settle-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'settle-container';
    const form = document.getElementById('form-entry');
    form.parentNode.insertBefore(container, form);
  }
  container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center">Loading balances...</p>';
  container.style.display = '';

  // Hide the regular form
  document.getElementById('form-entry').style.display = 'none';

  try {
    // Compute per-currency balances
    const { computeCurrencyBalances } = await import('./balance.js');
    const { currencyBalances, balance: totalUsdBalance } = await computeCurrencyBalances();

    // Get exchange rates for "settle all"
    const { getExchangeRate } = await import('./exchange.js');

    // Filter to non-zero currencies, excluding dust (< $0.10 USD equivalent)
    const allDebts = Object.entries(currencyBalances).filter(([, v]) => Math.abs(v) > 0.005);
    const debts = [];
    for (const [cur, amount] of allDebts) {
      try {
        const rate = await getExchangeRate(cur);
        if (Math.abs(amount * rate) >= 0.10) {
          debts.push([cur, amount]);
        }
      } catch (e) {
        debts.push([cur, amount]); // keep if can't check
      }
    }
    debts.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    if (debts.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0">All settled up! Nothing to pay.</p>';
      return;
    }

    // Determine who owes whom overall
    const partnerName = getUserName(getPartnerUid());
    const iOwe = totalUsdBalance < 0;
    const directionLabel = iOwe ? `You owe ${partnerName}` : `${partnerName} owes you`;

    let html = `<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px">${directionLabel}</p>`;
    html += '<div class="settle-list">';

    debts.forEach(([currency, amount]) => {
      const abs = Math.round(Math.abs(amount) * 100) / 100;
      const sym = getCurrencySymbol(currency);
      const isOwed = amount > 0; // positive = they owe me
      const label = isOwed ? 'Collect' : 'Pay';
      html += `
        <div class="settle-row">
          <div class="settle-currency">
            <span class="settle-amount-text">${sym}${abs.toLocaleString(undefined, { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 })}</span>
            <span class="settle-cur-code">${currency}</span>
          </div>
          <button class="btn btn-small settle-btn" data-currency="${currency}" data-amount="${abs}">${label}</button>
        </div>`;
    });

    html += '</div>';

    // Settle All section
    const consolCurrency = localStorage.getItem('daumis-debt-consol-currency') || 'USD';
    const consolSym = getCurrencySymbol(consolCurrency);

    // Convert per-currency balances to consolCurrency via live rates (signed sum, same as dashboard)
    let totalConsolSigned = 0;
    for (const [cur, amount] of debts) {
      if (cur === consolCurrency) {
        totalConsolSigned += amount;
      } else {
        try {
          const curToUsd = await getExchangeRate(cur);
          if (consolCurrency === 'USD') {
            totalConsolSigned += amount * curToUsd;
          } else {
            const consolToUsd = await getExchangeRate(consolCurrency);
            totalConsolSigned += amount * (curToUsd / consolToUsd);
          }
        } catch (e) {}
      }
    }
    const totalConsol = Math.round(Math.abs(totalConsolSigned) * 100) / 100;

    html += `
      <div class="settle-divider"></div>
      <div class="settle-all-section">
        <p class="settle-all-label">Settle everything at once</p>
        <p class="settle-all-total">${consolSym}${totalConsol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${consolCurrency}</p>
        <p class="settle-all-hint">Creates one settlement per currency at exact amounts</p>
        <button class="btn btn-primary settle-all-btn" id="btn-settle-all">Settle All</button>
      </div>`;

    container.innerHTML = html;

    // Wire up individual settle buttons
    container.querySelectorAll('.settle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const currency = btn.dataset.currency;
        const amount = parseFloat(btn.dataset.amount);
        const sym = getCurrencySymbol(currency);
        if (!confirm(`Settle ${sym}${amount.toLocaleString()} ${currency}?`)) return;
        btn.disabled = true;
        btn.textContent = 'Settling...';

        try {
          const { convertToUSD } = await import('./exchange.js');
          const { usdAmount, exchangeRate } = await convertToUSD(amount, currency);

          // Determine paidBy: if I owe (negative balance in this currency), I'm paying
          const curBalance = currencyBalances[currency];
          const paidBy = curBalance < 0 ? currentUser.uid : getPartnerUid();
          const paidTo = curBalance < 0 ? getPartnerUid() : currentUser.uid;

          await db.collection('payments').add({
            amount,
            currency,
            usdAmount,
            exchangeRate,
            paidBy,
            paidTo,
            date: new Date(),
            addedBy: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });

          // Track used currency
          localStorage.setItem('daumis-debt-last-currency', currency);
          const usedCurrencies = JSON.parse(localStorage.getItem('daumis-debt-used-currencies') || '[]');
          if (!usedCurrencies.includes(currency)) {
            usedCurrencies.push(currency);
            localStorage.setItem('daumis-debt-used-currencies', JSON.stringify(usedCurrencies));
          }

          btn.textContent = 'Done!';
          btn.style.background = 'var(--green)';

          // Refresh the settle screen after a moment
          setTimeout(() => renderSettleUp(), 800);
        } catch (err) {
          console.error('Settle failed:', err);
          btn.textContent = 'Failed';
          btn.disabled = false;
        }
      });
    });

    // Wire up Settle All button
    document.getElementById('btn-settle-all')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-settle-all');
      if (!confirm('Settle all outstanding debts?')) return;
      btn.disabled = true;
      btn.textContent = 'Settling...';

      try {
        const { convertToUSD } = await import('./exchange.js');

        for (const [currency, amount] of debts) {
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
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }

        btn.textContent = 'All settled!';
        btn.style.background = 'var(--green)';
        setTimeout(async () => {
          showScreen('dashboard');
          const { loadDashboard } = await import('./balance.js');
          invalidateAllCaches(); loadDashboard();
        }, 1000);
      } catch (err) {
        console.error('Settle all failed:', err);
        btn.textContent = 'Failed';
        btn.disabled = false;
      }
    });

  } catch (err) {
    console.error('Failed to load settle-up:', err);
    container.innerHTML = '<p style="color:var(--red);text-align:center">Failed to load balances.</p>';
  }
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
      const expenseDate = new Date(date + 'T12:00:00');
      const isFuture = expenseDate > new Date();
      const recurringValue = !editingEntry ? (document.querySelector('#entry-recurring .toggle-btn.active')?.dataset.value || 'none') : 'none';

      if (isFuture && recurringValue !== 'none') {
        // Future recurring: don't create expense now, just schedule it
        const { createRecurring } = await import('./recurring.js');
        await createRecurring({
          description, amount, currency, paidBy, splitType,
          owedBy: otherUid, frequency: recurringValue,
          addedBy: currentUser.uid, startDate: expenseDate
        });
      } else if (editingEntry && editingEntry.type === 'expense') {
        await db.collection('expenses').doc(editingEntry.id).update({
          description, amount, currency, usdAmount, exchangeRate,
          paidBy, splitType, owedBy: otherUid, date: expenseDate,
        });
      } else {
        await db.collection('expenses').add({
          description, amount, currency, usdAmount, exchangeRate,
          paidBy, splitType, owedBy: otherUid, date: expenseDate,
          addedBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
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
      }
    }

    // Create recurring if selected (only for new, non-future expenses — future ones handled above)
    if (!editingEntry && entryType === 'expense') {
      const expenseDate = new Date(date + 'T12:00:00');
      const isFuture = expenseDate > new Date();
      const recurringValue = document.querySelector('#entry-recurring .toggle-btn.active')?.dataset.value || 'none';
      if (recurringValue !== 'none' && !isFuture) {
        const { createRecurring } = await import('./recurring.js');
        await createRecurring({
          description: document.getElementById('entry-desc').value.trim(),
          amount, currency, paidBy, splitType,
          owedBy: otherUid, frequency: recurringValue,
          addedBy: currentUser.uid, startDate: expenseDate
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
    invalidateAllCaches(); loadDashboard();
  } catch (err) {
    console.error('Error saving entry:', err);
    alert('Failed to save. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingEntry ? 'Save Changes' : 'Save';
  }
});

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
        if (count > 0) { invalidateAllCaches(); import('./balance.js').then(({ loadDashboard }) => loadDashboard()); }
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
