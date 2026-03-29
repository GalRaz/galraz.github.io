import { db } from './firebase-config.js';
import { getCurrentUser, getUserName } from './app.js';
import { computeBalance } from './balance.js';

// EmailJS configuration — fill these in after creating your EmailJS account
const EMAILJS_PUBLIC_KEY = 'aSONqzmG8TcCSKYCh';
const EMAILJS_SERVICE_ID = 'daumis-debt';
const EMAILJS_TEMPLATE_ID = 'template_xc1bk27';

const APP_URL = 'https://galraz.github.io/daumis-debt/';

let emailjsReady = false;

/**
 * Dynamically load the EmailJS SDK and initialize it.
 * Called once at app startup after auth.
 */
export async function initNotifications() {
  if (emailjsReady) return;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    emailjs.init(EMAILJS_PUBLIC_KEY);
    emailjsReady = true;
  } catch (err) {
    console.warn('EmailJS failed to load:', err);
  }
}

/**
 * Save or update the current user's profile in the `users` collection.
 * Called on every login to keep email/name current.
 */
export async function saveUserProfile(user) {
  try {
    await db.collection('users').doc(user.uid).set({
      email: user.email,
      displayName: user.displayName || user.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn('Failed to save user profile:', err);
  }
}

/**
 * Look up the partner's email and displayName from the `users` collection.
 * Returns { email, displayName } or null if no partner profile exists.
 */
async function getPartnerEmail() {
  const user = getCurrentUser();
  if (!user) return null;
  try {
    const snapshot = await db.collection('users').get();
    for (const doc of snapshot.docs) {
      if (doc.id !== user.uid) {
        const data = doc.data();
        return { email: data.email, displayName: data.displayName };
      }
    }
    return null;
  } catch (err) {
    console.warn('Failed to get partner email:', err);
    return null;
  }
}

/**
 * Format the balance from the partner's perspective.
 */
async function formatBalanceForPartner() {
  try {
    const balance = await computeBalance();
    const user = getCurrentUser();
    const myName = user.displayName || 'your partner';
    if (balance > 0.005) {
      return `You owe ${myName} $${balance.toFixed(2)}`;
    } else if (balance < -0.005) {
      return `${myName} owes you $${Math.abs(balance).toFixed(2)}`;
    }
    return 'All settled up!';
  } catch {
    return '';
  }
}

/**
 * Build the action and description strings for the email template.
 */
function formatEmailDetails({ type, details }) {
  if (type === 'expense') {
    const action = `added a $${details.amount.toFixed(2)} ${details.currency} expense`;
    const splitLabel = details.splitType === 'even' ? 'split evenly' : 'owed fully';
    const description = `${details.description} — ${splitLabel}`;
    return { action, description };
  }
  if (type === 'payment') {
    const action = `recorded a $${details.amount.toFixed(2)} ${details.currency} payment`;
    return { action, description: 'Settle-up payment' };
  }
  if (type === 'duel') {
    const action = 'completed a duel';
    const adj = details.balanceAdjust.toFixed(2);
    const description = `${details.game} — $${adj} adjustment`;
    return { action, description };
  }
  return { action: 'did something', description: '' };
}

/**
 * Send an email notification to the partner.
 * Fire-and-forget: logs a warning on failure, never blocks or throws.
 *
 * @param {{ type: 'expense'|'payment'|'duel', details: object }} params
 */
export async function notifyPartner({ type, details }) {
  if (!emailjsReady) return;

  const partner = await getPartnerEmail();
  if (!partner) return;

  const user = getCurrentUser();
  const fromName = user.displayName || user.email;
  const { action, description } = formatEmailDetails({ type, details });
  const balance = await formatBalanceForPartner();

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: partner.email,
      to_name: partner.displayName,
      from_name: fromName,
      action,
      description,
      balance,
      app_link: APP_URL
    });
  } catch (err) {
    console.warn('Email notification failed:', err);
  }
}
