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
      container.innerHTML = `<p>이번 주 결투는 이미 끝났어요!</p>`;
      return;
    }
  }

  const mySubmission = existingSubmissions[user.uid];
  const partnerSubmission = existingSubmissions[partnerUid];

  if (mySubmission && !partnerSubmission) {
    container.innerHTML = `
      <p>${CHOICES[mySubmission]} 선택. ${getUserName(partnerUid)}의 플레이를 기다리는 중...</p>
      <button class="btn btn-primary" id="btn-refresh" style="max-width:200px;margin:0 auto">새로고침</button>`;
    document.getElementById('btn-refresh').addEventListener('click', () => play(container, { year, week, seed }));
    return;
  }

  if (partnerSubmission && !mySubmission) {
    container.innerHTML = `
      <p>${getUserName(partnerUid)}이(가) 먼저 냈어요! 네 차례.</p>
      ${renderChoices()}
      <div id="rps-result"></div>`;
    setupChoiceHandlers(container, { year, week, seed, duelDocRef, partnerSubmission, existingSubmissions });
    return;
  }

  container.innerHTML = `
    <p>선택해! ${getUserName(partnerUid) || '상대'}가 낼 때까지 비공개로 보관됩니다.</p>
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
          resultText = `무승부! 둘 다 ${CHOICES[myChoice]}. 변동 없음.`;
        } else if (BEATS[myChoice] === partnerSubmission) {
          favoredUser = user.uid;
          resultText = `승리! ${CHOICES[myChoice]} > ${CHOICES[partnerSubmission]}. +$10!`;
        } else {
          favoredUser = partnerUid;
          resultText = `패배! ${CHOICES[partnerSubmission]} > ${CHOICES[myChoice]}. ${getUserName(partnerUid)}에게 $10.`;
        }

        const resultClass = favoredUser === user.uid ? 'win' : favoredUser ? 'loss' : 'tie';
        resultEl.innerHTML = `<div class="duel-result ${resultClass}">${resultText}</div>`;

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
            game: '가위바위보',
            submissions: { [user.uid]: myChoice },
            result: null,
            balanceAdjust: 0,
            favoredUser: null,
            playedAt: null
          });
        }

        const resultEl = document.getElementById('rps-result');
        resultEl.innerHTML = `<div class="duel-result">${CHOICES[myChoice]} 선택. ${getUserName(partnerUid) || '상대'}를 기다리는 중...</div>`;
        container.querySelectorAll('.rps-choice').forEach((c) => {
          c.style.pointerEvents = 'none';
        });
      }
    });
  });
}
