import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult } from '../duel.js';

// Fixed KRW amounts — this is the Korean instance of the app, so KRW is the
// basis of balance math. balanceAdjust is stored directly in KRW.
const SLICE_BASE = [
  { valueKrw: -10000, color: '#e94560' },
  { valueKrw: -5000, color: '#c73e54' },
  { valueKrw: 0, color: '#16213e' },
  { valueKrw: 0, color: '#0f3460' },
  { valueKrw: 5000, color: '#3a8a6a' },
  { valueKrw: 10000, color: '#4ecca3' }
];

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();

  function krwLabel(krw) {
    if (krw === 0) return '₩0';
    return `${krw > 0 ? '+' : '-'}₩${Math.abs(krw).toLocaleString()}`;
  }

  const SLICES = SLICE_BASE.map(s => ({
    valueKrw: s.valueKrw,
    label: krwLabel(s.valueKrw),
    color: s.color
  }));

  container.innerHTML = `
    <p>수레바퀴를 돌려라! 양수면 네가 이긴다.</p>
    <div class="wheel-container">
      <div class="wheel-pointer"></div>
      <canvas id="wheel-canvas" width="280" height="280"></canvas>
    </div>
    <button class="btn btn-primary" id="btn-spin" style="max-width:200px;margin:0 auto">시작!</button>
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

    const duration = 3000;
    const start = performance.now();
    const startAngle = currentAngle;

    // Pointer is at canvas top (-PI/2). For slice center to align with pointer:
    // -currentAngle + targetSliceCenter = -PI/2  →  currentAngle = targetSliceCenter + PI/2
    const targetFinal = Math.PI / 2 + targetSliceCenter;
    const remainder = ((targetFinal - startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const totalAngle = spins * 2 * Math.PI + remainder;

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
        const partnerUid = getPartnerUid() || 'partner';

        let favoredUser = null;
        if (resultSlice.valueKrw > 0) {
          favoredUser = user.uid;
        } else if (resultSlice.valueKrw < 0) {
          favoredUser = partnerUid;
        }

        if (resultSlice.valueKrw > 0) {
          resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">${resultSlice.label} — 승리!</div>`;
        } else if (resultSlice.valueKrw < 0) {
          resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">${resultSlice.label} — 패배!</div>`;
        } else {
          resultEl.innerHTML = `<div class="duel-result">₩0 — 무승부!</div>`;
        }

        recordDuelResult({
          game: 'wheel',
          result: { value: resultSlice.valueKrw },
          balanceAdjust: Math.abs(resultSlice.valueKrw),
          favoredUser,
          seed, year, week
        });

        btn.textContent = '완료!';
      }
    }

    requestAnimationFrame(animate);
  });
}
