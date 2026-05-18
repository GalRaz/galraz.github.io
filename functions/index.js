/**
 * Cloud Functions for daumis-debt — push notifications to the partner.
 *
 * Phase 2: notify the partner when a new expense is created. Subsequent
 * phases will add settle-up payments, duel plays, and a weekly duel reminder.
 *
 * Runtime: Node 20, Gen 2 Firestore trigger.
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');

setGlobalOptions({
  // Tight cap so a runaway loop can't fan out billable invocations. The app
  // has two users — 5 concurrent function instances is way more than we'll
  // ever need.
  maxInstances: 5,
  region: 'us-central1',
});

initializeApp();

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', THB: '฿', BTN: 'Nu ', TWD: 'NT$',
  KRW: '₩', CNY: '¥', INR: '₹', AUD: 'A$', CAD: 'C$', CHF: 'Fr', SGD: 'S$',
  HKD: 'HK$', NZD: 'NZ$', SEK: 'kr', NOK: 'kr', DKK: 'kr', MXN: '$',
  BRL: 'R$', PLN: 'zł', CZK: 'Kč', HUF: 'Ft', ILS: '₪', TRY: '₺', ZAR: 'R',
  PHP: '₱', MYR: 'RM', IDR: 'Rp',
};

function symbol(code) {
  return CURRENCY_SYMBOLS[code] || (code ? code + ' ' : '');
}

function formatAmount(n) {
  if (n == null) return '';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Look up the user who is NOT the actor. Returns { uid, name, token } or null.
 * Assumes the two-user model: pick the first users doc with a different uid.
 */
async function findPartner(actorUid) {
  const db = getFirestore();
  const snap = await db.collection('users').get();
  for (const doc of snap.docs) {
    if (doc.id !== actorUid) {
      const data = doc.data();
      return {
        uid: doc.id,
        name: data.displayName || data.email || 'Your partner',
        token: data.fcmToken || null,
      };
    }
  }
  return null;
}

/**
 * Look up the actor's display name. Falls back to "Your partner" if missing.
 */
async function findActorName(actorUid) {
  if (!actorUid) return 'Your partner';
  const db = getFirestore();
  const snap = await db.collection('users').doc(actorUid).get();
  if (!snap.exists) return 'Your partner';
  const d = snap.data();
  return d.displayName || d.email || 'Your partner';
}

/**
 * Send a push to one user. If FCM rejects the token as unregistered, clear
 * it from Firestore so we don't keep retrying a dead token.
 */
async function sendPushToUid(uid, token, payload) {
  if (!token) {
    logger.info('sendPushToUid: no token, skipping', { uid });
    return;
  }
  try {
    await getMessaging().send({ token, ...payload });
    logger.info('Push sent', { uid, title: payload.notification?.title });
  } catch (err) {
    const code = err?.errorInfo?.code || err?.code;
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') {
      logger.warn('Stale FCM token — clearing', { uid, code });
      await getFirestore().collection('users').doc(uid).update({
        fcmToken: null,
      }).catch((e) => logger.warn('Failed to clear stale token', { uid, error: e.message }));
    } else {
      logger.error('Push send failed', { uid, code, message: err?.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Trigger: new expense → push to the partner
// ---------------------------------------------------------------------------
exports.notifyExpenseAdded = onDocumentCreated('expenses/{expenseId}', async (event) => {
  const expense = event.data?.data();
  if (!expense) {
    logger.warn('notifyExpenseAdded: no document data');
    return;
  }

  const actorUid = expense.addedBy;
  if (!actorUid) {
    logger.warn('notifyExpenseAdded: no addedBy on expense', { id: event.params.expenseId });
    return;
  }

  const [partner, actorName] = await Promise.all([
    findPartner(actorUid),
    findActorName(actorUid),
  ]);
  if (!partner) {
    logger.info('notifyExpenseAdded: no partner record found, skipping');
    return;
  }

  const sym = symbol(expense.currency);
  const amtStr = formatAmount(expense.amount);
  const moneyPart = `${sym}${amtStr}${expense.currency && !CURRENCY_SYMBOLS[expense.currency] ? '' : ''}`;
  const desc = (expense.description || '').toString().slice(0, 80);
  const body = desc ? `${moneyPart} — ${desc}` : moneyPart;

  await sendPushToUid(partner.uid, partner.token, withWebPushDefaults({
    data: {
      title: `${actorName} added an expense`,
      body,
      type: 'expense',
      expenseId: event.params.expenseId,
    },
  }));
});

// ---------------------------------------------------------------------------
// Trigger: new payment (settle-up) → push to the partner
// ---------------------------------------------------------------------------
exports.notifyPaymentAdded = onDocumentCreated('payments/{paymentId}', async (event) => {
  const p = event.data?.data();
  if (!p) return;

  const actorUid = p.addedBy;
  if (!actorUid) {
    logger.warn('notifyPaymentAdded: no addedBy on payment', { id: event.params.paymentId });
    return;
  }

  const [partner, actorName] = await Promise.all([
    findPartner(actorUid),
    findActorName(actorUid),
  ]);
  if (!partner) return;

  const sym = symbol(p.currency);
  const amtStr = formatAmount(p.amount);
  const body = `${sym}${amtStr}${p.currency ? ' ' + p.currency : ''}`;

  await sendPushToUid(partner.uid, partner.token, withWebPushDefaults({
    data: {
      title: `${actorName} settled up`,
      body,
      type: 'payment',
      paymentId: event.params.paymentId,
    },
  }));
});

// ---------------------------------------------------------------------------
// Trigger: new duel doc → push to the partner
// Handles both single-player games (playedBy set, result present) and two-player
// games like RPS / Lucky Number where the first submission creates the doc with
// `submissions: { [actor.uid]: choice }` and `result: null`.
// ---------------------------------------------------------------------------
exports.notifyDuelPlayed = onDocumentCreated('duels/{duelId}', async (event) => {
  const d = event.data?.data();
  if (!d) return;

  // Actor is whoever made the first move.
  const actorUid = d.playedBy || (d.submissions && Object.keys(d.submissions)[0]);
  if (!actorUid) {
    logger.warn('notifyDuelPlayed: cannot determine actor', { id: event.params.duelId });
    return;
  }

  const [partner, actorName] = await Promise.all([
    findPartner(actorUid),
    findActorName(actorUid),
  ]);
  if (!partner) return;

  const game = (d.game || 'this week\'s duel').toString();
  let title;
  let body;
  if (d.result) {
    // Single-player game (or somehow a fully-resolved doc on first write).
    if (d.favoredUser && d.favoredUser === partner.uid) {
      title = `${actorName} played — you won`;
      body = `${game} · +$${d.balanceAdjust}`;
    } else if (d.favoredUser) {
      title = `${actorName} played — you lost`;
      body = `${game} · −$${d.balanceAdjust}`;
    } else {
      title = `${actorName} played — tied`;
      body = game;
    }
  } else {
    // Two-player game waiting for the partner's submission.
    title = `${actorName} made their move`;
    body = `${game} · your turn`;
  }

  await sendPushToUid(partner.uid, partner.token, withWebPushDefaults({
    data: {
      title,
      body,
      type: 'duel',
      duelId: event.params.duelId,
      week: String(d.week || ''),
      year: String(d.year || ''),
    },
  }));
});

// ---------------------------------------------------------------------------
// Scheduled: weekly duel reminder. Wednesday 9:00 UTC = ~17:00 KST / 15:00 BTT.
// For each user who has push enabled AND hasn't played this week's duel,
// send a quiet "your turn" nudge. Skipped entirely if duels are disabled.
// ---------------------------------------------------------------------------
function getISOWeek(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  yearStart.setHours(0, 0, 0, 0);
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

exports.weeklyDuelReminder = onSchedule({
  schedule: '0 9 * * 3',
  timeZone: 'Etc/UTC',
  region: 'us-central1',
}, async () => {
  const db = getFirestore();
  const now = new Date();
  const year = now.getFullYear();
  const week = getISOWeek(now);

  // Honour the "duels disabled" setting.
  const settingsSnap = await db.collection('settings').doc('duel').get();
  if (settingsSnap.exists && settingsSnap.data().active === false) {
    logger.info('weeklyDuelReminder: duels are disabled, skipping');
    return;
  }

  // Which UIDs have already played this week (single-player playedBy OR
  // two-player submissions key)?
  const duelsSnap = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();
  const played = new Set();
  duelsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.playedBy) played.add(data.playedBy);
    if (data.submissions) Object.keys(data.submissions).forEach((u) => played.add(u));
  });

  const usersSnap = await db.collection('users').get();
  let pinged = 0;
  for (const userDoc of usersSnap.docs) {
    if (played.has(userDoc.id)) continue;
    const data = userDoc.data();
    if (!data.fcmToken) continue;

    await sendPushToUid(userDoc.id, data.fcmToken, withWebPushDefaults({
      data: {
        title: 'Weekly duel — your turn',
        body: 'Open Daumi\'s Debt and play this week\'s game.',
        type: 'duel-reminder',
        week: String(week),
        year: String(year),
      },
    }));
    pinged += 1;
  }

  logger.info('weeklyDuelReminder: done', { week, year, pinged });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spread the standard webpush options onto a message payload so the icon,
 * badge, and tap-link don't have to be copy-pasted into every trigger.
 *
 * We send DATA-ONLY payloads (title/body live inside `data`, not at the
 * top-level `notification` field). With a `notification` field, the FCM
 * Web SDK auto-displays a notification AND fires onBackgroundMessage —
 * the two paths produced duplicate banners that even matching `tag`s
 * couldn't dedupe on iOS PWA. Data-only is the only delivery path, so
 * the SW's onBackgroundMessage is the single source of truth.
 *
 * Tag remains for collapse-replace within the SW handler itself, so a
 * repeated push for the same doc id still produces only one banner.
 */
function tagForData(data) {
  const d = data || {};
  if (d.expenseId) return `expense-${d.expenseId}`;
  if (d.paymentId) return `payment-${d.paymentId}`;
  if (d.duelId) return `duel-${d.duelId}`;
  if (d.type === 'duel-reminder') return `duel-reminder-${d.week || ''}-${d.year || ''}`;
  return 'daumis-debt';
}

function withWebPushDefaults(payload) {
  return {
    ...payload,
    webpush: {
      fcmOptions: { link: 'https://galraz.github.io/daumis-debt/' },
      notification: {
        icon: 'https://galraz.github.io/daumis-debt/assets/icons/icon.png',
        badge: 'https://galraz.github.io/daumis-debt/assets/icons/icon.png',
        tag: tagForData(payload.data),
        renotify: false,
      },
      ...(payload.webpush || {}),
    },
  };
}
