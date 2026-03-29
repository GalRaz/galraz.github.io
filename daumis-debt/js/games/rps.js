import { db } from '../firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName } from '../app.js';
import { recordDuelResult, getCurrentWeekInfo } from '../duel.js';

const CHOICES = { rock: '✊', paper: '✋', scissors: '✌️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const partnerUid = getPartnerUid();

  const pendingSnap = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();

  let duelDocRef = null;
  let existingSubmissions = {};

  if (!pendingSnap.empty) {
    const doc = pendingSnap.docs[0];
    const data = doc.data();
    if (data.submissions) {
      existingSubmissions = data.submissions;
      duelDocRef = doc.ref;
    }
    if (data.result) {
      container.innerHTML = `<p>Duel already played this week!</p>`;
      return;
    }
  }

  const mySubmission = existingSubmissions[user.uid];
  const partnerSubmission = existingSubmissions[partnerUid];

  if (mySubmission && !partnerSubmission) {
    container.innerHTML = `
      <p>You picked ${CHOICES[mySubmission]}. Waiting for ${getUserName(partnerUid)} to play...</p>
      <button class="btn btn-primary" id="btn-refresh" style="max-width:200px;margin:0 auto">Refresh</button>`;
    document.getElementById('btn-refresh').addEventListener('click', () => play(container, { year, week, seed }));
    return;
  }

  if (partnerSubmission && !mySubmission) {
    container.innerHTML = `
      <p>${getUserName(partnerUid)} has played! Your turn.</p>
      ${renderChoices()}
      <div id="rps-result"></div>`;
    setupChoiceHandlers(container, { year, week, seed, duelDocRef, partnerSubmission, existingSubmissions });
    return;
  }

  container.innerHTML = `
    <p>Pick your weapon! Your choice is hidden until ${getUserName(partnerUid) || 'your partner'} plays.</p>
    ${renderChoices()}
    <div id="rps-result"></div>`;
  setupChoiceHandlers(container, { year, week, seed, duelDocRef: null, partnerSubmission: null, existingSubmissions });
}

function renderChoices() {
  return `<div class="rps-choices">
    ${Object.entries(CHOICES).map(([key, emoji]) =>
      `<div class="rps-choice" data-choice="${key}">${emoji}</div>`
    ).join('')}
  </div>`;
}

function setupChoiceHandlers(container, { year, week, seed, duelDocRef, partnerSubmission, existingSubmissions }) {
  const user = getCurrentUser();
  const partnerUid = getPartnerUid();

  container.querySelectorAll('.rps-choice').forEach((el) => {
    el.addEventListener('click', async () => {
      container.querySelectorAll('.rps-choice').forEach((c) => c.classList.remove('selected'));
      el.classList.add('selected');

      const myChoice = el.dataset.choice;

      if (partnerSubmission) {
        const resultEl = document.getElementById('rps-result');
        let favoredUser = null;
        let resultText = '';

        if (myChoice === partnerSubmission) {
          resultText = `Tie! Both picked ${CHOICES[myChoice]}. No change.`;
        } else if (BEATS[myChoice] === partnerSubmission) {
          favoredUser = user.uid;
          resultText = `You win! ${CHOICES[myChoice]} beats ${CHOICES[partnerSubmission]}. $10 in your favor!`;
        } else {
          favoredUser = partnerUid;
          resultText = `You lose! ${CHOICES[partnerSubmission]} beats ${CHOICES[myChoice]}. $10 to ${getUserName(partnerUid)}.`;
        }

        const color = favoredUser === user.uid ? 'var(--green)' : favoredUser ? 'var(--red)' : 'var(--text)';
        resultEl.innerHTML = `<div class="duel-result" style="color:${color}">${resultText}</div>`;

        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myChoice },
            result: { [user.uid]: myChoice, [partnerUid]: partnerSubmission },
            balanceAdjust: myChoice === partnerSubmission ? 0 : 10,
            favoredUser: favoredUser || null,
            playedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } else {
          await recordDuelResult({
            game: 'rps',
            result: { [user.uid]: myChoice, [partnerUid]: partnerSubmission },
            balanceAdjust: myChoice === partnerSubmission ? 0 : 10,
            favoredUser: favoredUser || null,
            seed, year, week
          });
        }

        container.querySelectorAll('.rps-choice').forEach((c) => {
          c.style.pointerEvents = 'none';
        });
      } else {
        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myChoice }
          });
        } else {
          await db.collection('duels').add({
            year, week, seed,
            game: 'Rock Paper Scissors',
            submissions: { [user.uid]: myChoice },
            result: null,
            balanceAdjust: 0,
            favoredUser: null,
            playedAt: null
          });
        }

        const resultEl = document.getElementById('rps-result');
        resultEl.innerHTML = `<div class="duel-result">You picked ${CHOICES[myChoice]}. Waiting for ${getUserName(partnerUid) || 'partner'}...</div>`;
        container.querySelectorAll('.rps-choice').forEach((c) => {
          c.style.pointerEvents = 'none';
        });
      }
    });
  });
}
