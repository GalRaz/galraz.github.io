import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult } from '../duel.js';
import { computeBalance } from '../balance.js';

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const balance = await computeBalance();
  const userIsDebtor = balance < 0;
  const debtorName = userIsDebtor ? 'You' : 'Partner';

  container.innerHTML = `
    <p>${debtorName} flip${userIsDebtor ? '' : 's'} the coin.</p>
    <p style="margin-top:8px;color:var(--text-muted)">Heads: $10 forgiven. Tails: $10 added.</p>
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
      const debtorUid = userIsDebtor ? user.uid : partnerUid;
      const creditorUid = userIsDebtor ? partnerUid : user.uid;
      const favoredUser = isHeads ? debtorUid : creditorUid;

      if (isHeads) {
        resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">Heads! $10 forgiven!</div>`;
      } else {
        resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">Tails! $10 added to debt.</div>`;
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
