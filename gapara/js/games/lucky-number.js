import { db } from '../firebase-config.js';
import { getCurrentUser, getPartnerUid, getUserName } from '../app.js';
import { recordDuelResult, getCurrentWeekInfo, seededRandom } from '../duel.js';

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const partnerUid = getPartnerUid();

  const rng = seededRandom(seed * 7 + 31);
  const targetNumber = Math.floor(rng() * 10) + 1;

  const pendingSnap = await db.collection('duels')
    .where('year', '==', year)
    .where('week', '==', week)
    .get();

  let duelDocRef = null;
  let existingSubmissions = {};

  if (!pendingSnap.empty) {
    const doc = pendingSnap.docs[0];
    const data = doc.data();
    if (data.result) {
      container.innerHTML = `<p>이번 주 결투는 이미 끝났어요!</p>`;
      return;
    }
    if (data.submissions) {
      existingSubmissions = data.submissions;
      duelDocRef = doc.ref;
    }
  }

  const mySubmission = existingSubmissions[user.uid];
  const partnerSubmission = existingSubmissions[partnerUid];

  if (mySubmission && !partnerSubmission) {
    container.innerHTML = `
      <p>${mySubmission} 선택. ${getUserName(partnerUid)}의 선택을 기다리는 중...</p>
      <button class="btn btn-primary" id="btn-refresh" style="max-width:200px;margin:0 auto">새로고침</button>`;
    document.getElementById('btn-refresh').addEventListener('click', () => play(container, { year, week, seed }));
    return;
  }

  const preamble = partnerSubmission && !mySubmission
    ? `<p>${getUserName(partnerUid)}이(가) 먼저 골랐어요! 네 차례.</p>`
    : `<p>1-10 중 하나를 고르세요. 목표 숫자에 가장 가까운 사람이 $10 획득!</p>`;

  container.innerHTML = `
    ${preamble}
    <div class="number-grid">
      ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
        `<button class="number-btn" data-num="${n}">${n}</button>`
      ).join('')}
    </div>
    <div id="lucky-result"></div>`;

  container.querySelectorAll('.number-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const myPick = parseInt(btn.dataset.num);
      container.querySelectorAll('.number-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      container.querySelectorAll('.number-btn').forEach((b) => { b.disabled = true; });

      if (partnerSubmission) {
        const partnerPick = parseInt(partnerSubmission);
        const myDist = Math.abs(myPick - targetNumber);
        const partnerDist = Math.abs(partnerPick - targetNumber);

        container.querySelector(`.number-btn[data-num="${targetNumber}"]`).classList.add('target');

        const resultEl = document.getElementById('lucky-result');
        let favoredUser = null;
        let resultText = '';

        if (myDist < partnerDist) {
          favoredUser = user.uid;
          resultText = `목표: ${targetNumber}. 내 선택 ${myPick}, ${getUserName(partnerUid)} 선택 ${partnerPick}. 승리! +$10!`;
        } else if (partnerDist < myDist) {
          favoredUser = partnerUid;
          resultText = `목표: ${targetNumber}. 내 선택 ${myPick}, ${getUserName(partnerUid)} 선택 ${partnerPick}. ${getUserName(partnerUid)} 승! $10 상실.`;
        } else {
          resultText = `목표: ${targetNumber}. 둘 다 동점 (${myPick} vs ${partnerPick}). 변동 없음!`;
        }

        const color = favoredUser === user.uid ? 'var(--green)' : favoredUser ? 'var(--red)' : 'var(--text)';
        resultEl.innerHTML = `<div class="duel-result" style="color:${color}">${resultText}</div>`;

        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myPick },
            result: { target: targetNumber, [user.uid]: myPick, [partnerUid]: partnerPick },
            balanceAdjust: favoredUser ? 10 : 0,
            favoredUser,
            playedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } else {
          await recordDuelResult({
            game: 'lucky-number',
            result: { target: targetNumber, [user.uid]: myPick, [partnerUid]: partnerPick },
            balanceAdjust: favoredUser ? 10 : 0,
            favoredUser,
            seed, year, week
          });
        }
      } else {
        if (duelDocRef) {
          await duelDocRef.update({
            submissions: { ...existingSubmissions, [user.uid]: myPick }
          });
        } else {
          await db.collection('duels').add({
            year, week, seed,
            game: '행운의 숫자',
            submissions: { [user.uid]: myPick },
            result: null,
            balanceAdjust: 0,
            favoredUser: null,
            playedAt: null
          });
        }
        document.getElementById('lucky-result').innerHTML =
          `<div class="duel-result">${myPick} 선택. ${getUserName(partnerUid)}을(를) 기다리는 중...</div>`;
      }
    });
  });
}
