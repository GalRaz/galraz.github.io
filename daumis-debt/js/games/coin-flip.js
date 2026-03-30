import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult } from '../duel.js';

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();

  container.innerHTML = `
    <p>Flip the coin! Heads: you win $10. Tails: you lose $10.</p>
    <div class="coin" id="coin">?</div>
    <button class="btn btn-primary" id="btn-flip" style="max-width:200px;margin:0 auto">Flip!</button>
    <div id="flip-result"></div>`;

  document.getElementById('btn-flip').addEventListener('click', async () => {
    const btn = document.getElementById('btn-flip');
    btn.disabled = true;
    const coinEl = document.getElementById('coin');

    const isHeads = Math.random() < 0.5;
    coinEl.classList.add('flipping');
    coinEl.textContent = '';

    setTimeout(async () => {
      coinEl.classList.remove('flipping');
      coinEl.textContent = isHeads ? 'H' : 'T';

      const resultEl = document.getElementById('flip-result');
      const partnerUid = getPartnerUid() || 'partner';
      const favoredUser = isHeads ? user.uid : partnerUid;

      if (isHeads) {
        resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">Heads! You win $10!</div>`;
      } else {
        resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">Tails! You lose $10.</div>`;
      }

      await recordDuelResult({
        game: 'coin-flip',
        result: { side: isHeads ? 'heads' : 'tails' },
        balanceAdjust: 10,
        favoredUser,
        seed, year, week
      });

      btn.textContent = 'Done!';
    }, 1000);
  });
}
