import { db } from './firebase-config.js';
import { getCurrentUser, showScreen, getPartnerUid, getUserName } from './app.js';
import { notifyPartner } from './notifications.js';

const GAMES = ['coin-flip', 'wheel', 'rps', 'lucky-number', 'scratch-card'];
const GAME_NAMES = {
  'coin-flip': 'Coin Flip',
  'wheel': 'Wheel of Fortune',
  'rps': 'Rock Paper Scissors',
  'lucky-number': 'Lucky Number',
  'scratch-card': 'Scratch Card'
};

/**
 * Simple seeded PRNG (mulberry32).
 * Returns a function that produces deterministic floats in [0, 1).
 */
function seededRandom(seed) {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Get ISO week number for a date. */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/** Get the current week's seed, year, and week number. */
function getCurrentWeekInfo() {
  const now = new Date();
  const week = getISOWeek(now);
  const year = now.getFullYear();
  const seed = year * 100 + week;
  return { year, week, seed };
}

/**
 * Select this week's game deterministically from the seed.
 * Picks 3 candidates, then selects 1.
 */
export function getWeeklyGame(seed) {
  const rng = seededRandom(seed);
  // Shuffle and pick 3
  const shuffled = [...GAMES];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const candidates = shuffled.slice(0, 3);
  // Pick 1 from the 3
  const picked = candidates[Math.floor(rng() * 3)];
  return picked;
}

/** Check if today is Wednesday or later in the week. */
function isDuelDay() {
  return new Date().getDay() >= 3; // 0=Sun, 3=Wed
}

/** Check if duels are enabled in shared settings. */
async function areDuelsEnabled() {
  try {
    const doc = await db.collection('settings').doc('duel').get();
    if (!doc.exists) return true; // default: on
    return doc.data().active !== false;
  } catch (e) { return true; }
}

/** Check if a duel is available this week (enabled, correct day, not yet played). */
export async function isDuelAvailable() {
  if (!isDuelDay()) return false;
  if (!(await areDuelsEnabled())) return false;
  const { year, week } = getCurrentWeekInfo();
  const snapshot = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();
  // Available if no duel doc exists, or if one exists but has no final result yet
  if (snapshot.empty) return true;
  const data = snapshot.docs[0].data();
  return !data.result;
}

/** Start the weekly duel. */
export async function startDuel() {
  const { year, week, seed } = getCurrentWeekInfo();

  // Check if there's already a pending duel (partner may have started it)
  const existing = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();

  if (!existing.empty && existing.docs[0].data().result) {
    alert('Duel already played this week!');
    return;
  }

  // Use the game from existing doc if partner already started,
  // otherwise pick deterministically from the seed
  let game;
  if (!existing.empty && existing.docs[0].data().game) {
    const gameName = existing.docs[0].data().game;
    game = Object.entries(GAME_NAMES).find(([k, v]) => v === gameName)?.[0] || getWeeklyGame(seed);
  } else {
    game = getWeeklyGame(seed);
  }

  showScreen('duel', 'slide-forward');
  const content = document.getElementById('duel-content');
  content.innerHTML = `
    <div class="duel-game">
      <h2>Weekly Duel</h2>
      <p class="subtitle">Week ${week} · ${GAME_NAMES[game]}</p>
      <div id="game-area"></div>
    </div>
    <div id="duel-history-area"></div>`;

  const gameModule = await import(`./games/${game}.js`);
  gameModule.play(document.getElementById('game-area'), { year, week, seed });
  renderDuelHistory(document.getElementById('duel-history-area'));
}

/**
 * Record duel result to Firestore.
 * Called by individual game modules when the game completes.
 */
export async function recordDuelResult({ game, result, balanceAdjust, favoredUser, seed, year, week }) {
  await db.collection('duels').add({
    year,
    week,
    game: GAME_NAMES[game] || game,
    result,
    balanceAdjust: Math.abs(balanceAdjust),
    favoredUser,
    playedAt: firebase.firestore.FieldValue.serverTimestamp(),
    seed,
    submissions: null
  });
  notifyPartner({
    type: 'duel',
    details: { game: GAME_NAMES[game] || game, balanceAdjust: Math.abs(balanceAdjust), favoredUser }
  });
}

/** Render past duel history and score summary into the given container. */
async function renderDuelHistory(container) {
  const user = getCurrentUser();
  const partnerUid = getPartnerUid();
  const myName = getUserName(user.uid) || 'You';
  const partnerName = getUserName(partnerUid) || 'Partner';

  try {
    const snap = await db.collection('duels')
      .orderBy('year', 'desc')
      .orderBy('week', 'desc')
      .limit(15)
      .get();

    if (snap.empty) return;

    const duels = snap.docs.map(d => d.data()).filter(d => d.result);

    // Compute cumulative score (wins)
    let myWins = 0, partnerWins = 0, myBalance = 0;
    for (const d of duels) {
      if (!d.favoredUser) continue;
      if (d.favoredUser === user.uid) { myWins++; myBalance += (d.balanceAdjust || 0); }
      else { partnerWins++; myBalance -= (d.balanceAdjust || 0); }
    }

    const balanceNote = myBalance > 0
      ? `+$${myBalance} ahead`
      : myBalance < 0
      ? `$${Math.abs(myBalance)} behind`
      : 'Even';

    const rows = duels.map(d => {
      if (!d.result) return '';
      const iWon = d.favoredUser === user.uid;
      const tie = !d.favoredUser;
      const resultClass = tie ? 'result-tie' : iWon ? 'result-win' : 'result-loss';
      const resultText = tie ? 'Tie' : iWon ? `+$${d.balanceAdjust}` : `−$${d.balanceAdjust}`;
      const whoWon = tie ? 'Tie' : iWon ? `${myName} wins` : `${partnerName} wins`;
      return `<div class="history-row">
        <div>
          <div class="history-game">${d.game || 'Duel'}</div>
          <div class="history-date">Week ${d.week} · ${whoWon}</div>
        </div>
        <div class="${resultClass}">${resultText}</div>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="duel-score-card">
        <div class="duel-score-player">
          <div class="duel-score-name">${myName}</div>
          <div class="duel-score-val${myWins >= partnerWins ? ' winning' : ''}">${myWins}</div>
          <div class="duel-score-note">${myBalance > 0 ? balanceNote : ''}</div>
        </div>
        <div class="duel-score-vs">vs</div>
        <div class="duel-score-player">
          <div class="duel-score-name">${partnerName}</div>
          <div class="duel-score-val${partnerWins > myWins ? ' winning' : ''}">${partnerWins}</div>
          <div class="duel-score-note">${myBalance < 0 ? balanceNote.replace('-', '') + ' ahead' : ''}</div>
        </div>
      </div>
      <div class="duel-history-section">
        <div class="duel-history-label">Past Duels</div>
        ${rows}
      </div>`;
  } catch (e) {
    // Silently skip if index not yet built
  }
}

export { GAME_NAMES, getCurrentWeekInfo, seededRandom };
