import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult } from '../duel.js';
import { computeBalance } from '../balance.js';

const SLICES = [
  { value: -10, label: '-$10', color: '#e94560' },
  { value: -5, label: '-$5', color: '#c73e54' },
  { value: 0, label: '$0', color: '#16213e' },
  { value: 0, label: '$0', color: '#0f3460' },
  { value: 5, label: '+$5', color: '#3a8a6a' },
  { value: 10, label: '+$10', color: '#4ecca3' }
];

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();
  const balance = await computeBalance();
  const userIsDebtor = balance < 0;

  container.innerHTML = `
    <p>Values are from the debtor's perspective.</p>
    <div class="wheel-container">
      <div class="wheel-pointer"></div>
      <canvas id="wheel-canvas" width="280" height="280"></canvas>
    </div>
    <button class="btn btn-primary" id="btn-spin" style="max-width:200px;margin:0 auto">Spin!</button>
    <div id="spin-result"></div>`;

  const canvas = document.getElementById('wheel-canvas');
  const ctx = canvas.getContext('2d');
  let currentAngle = 0;

  function drawWheel(angle) {
    ctx.clearRect(0, 0, 280, 280);
    const cx = 140, cy = 140, r = 130;
    const sliceAngle = (2 * Math.PI) / SLICES.length;

    SLICES.forEach((slice, i) => {
      const start = angle + i * sliceAngle;
      const end = start + sliceAngle;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.fill();
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + sliceAngle / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eee';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(slice.label, r * 0.65, 5);
      ctx.restore();
    });
  }

  drawWheel(0);

  document.getElementById('btn-spin').addEventListener('click', async () => {
    const btn = document.getElementById('btn-spin');
    btn.disabled = true;

    const resultIndex = Math.floor(Math.random() * SLICES.length);
    const resultSlice = SLICES[resultIndex];

    const sliceAngle = (2 * Math.PI) / SLICES.length;
    const targetSliceCenter = resultIndex * sliceAngle + sliceAngle / 2;
    const spins = 5 + Math.random() * 3;
    const totalAngle = spins * 2 * Math.PI + (2 * Math.PI - targetSliceCenter);

    const duration = 3000;
    const start = performance.now();
    const startAngle = currentAngle;

    function animate(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      currentAngle = startAngle + totalAngle * eased;
      drawWheel(-currentAngle);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        const resultEl = document.getElementById('spin-result');
        const debtorUid = userIsDebtor ? user.uid : getPartnerUid();
        const creditorUid = userIsDebtor ? getPartnerUid() : user.uid;

        let favoredUser = null;
        if (resultSlice.value > 0) {
          favoredUser = debtorUid;
        } else if (resultSlice.value < 0) {
          favoredUser = creditorUid;
        }

        if (resultSlice.value > 0) {
          resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">${resultSlice.label} — debt reduced!</div>`;
        } else if (resultSlice.value < 0) {
          resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">${resultSlice.label} — debt increased!</div>`;
        } else {
          resultEl.innerHTML = `<div class="duel-result">$0 — no change!</div>`;
        }

        recordDuelResult({
          game: 'wheel',
          result: { value: resultSlice.value },
          balanceAdjust: Math.abs(resultSlice.value),
          favoredUser,
          seed, year, week
        });

        btn.textContent = 'Done!';
      }
    }

    requestAnimationFrame(animate);
  });
}
