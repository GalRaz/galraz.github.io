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

  await sendPushToUid(partner.uid, partner.token, {
    notification: {
      title: `${actorName} added an expense`,
      body,
    },
    data: {
      type: 'expense',
      expenseId: event.params.expenseId,
    },
    webpush: {
      fcmOptions: { link: 'https://galraz.github.io/daumis-debt/' },
      notification: {
        icon: 'https://galraz.github.io/daumis-debt/assets/icons/icon.png',
        badge: 'https://galraz.github.io/daumis-debt/assets/icons/icon.png',
      },
    },
  });
});
