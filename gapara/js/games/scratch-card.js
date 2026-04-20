import { getCurrentUser, getPartnerUid } from '../app.js';
import { recordDuelResult, seededRandom } from '../duel.js';

const VALUES = [-10, -5, 0, 5, 10];

export async function play(container, { year, week, seed }) {
  const user = getCurrentUser();

  const rng = seededRandom(seed * 13 + 7);
  const netAdjust = VALUES[Math.floor(rng() * VALUES.length)];

  container.innerHTML = `
    <p>Scratch your card to reveal the result!</p>
    <div class="scratch-card" id="scratch-card">
      <div class="scratch-value" id="scratch-value">
        ${netAdjust >= 0 ? '+' : ''}$${netAdjust}
      </div>
      <canvas id="scratch-canvas" width="200" height="140"></canvas>
    </div>
    <p id="scratch-hint" style="color:var(--text-muted);font-size:0.85rem;margin-top:8px">
      Drag or tap to scratch
    </p>
    <div id="scratch-result"></div>`;

  const canvas = document.getElementById('scratch-canvas');
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f3460';
  ctx.fillRect(0, 0, 200, 140);
  ctx.fillStyle = '#eee';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SCRATCH ME', 100, 75);

  let isScratching = false;
  let scratchedPixels = 0;
  const totalPixels = 200 * 140;
  let revealed = false;

  function scratch(x, y) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, 2 * Math.PI);
    ctx.fill();

    const imageData = ctx.getImageData(0, 0, 200, 140);
    let cleared = 0;
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] === 0) cleared++;
    }
    scratchedPixels = cleared;

    if (scratchedPixels / totalPixels > 0.4 && !revealed) {
      revealed = true;
      revealResult();
    }
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: (touch.clientX - rect.left) * (200 / rect.width),
      y: (touch.clientY - rect.top) * (140 / rect.height)
    };
  }

  canvas.addEventListener('mousedown', (e) => { isScratching = true; const p = getPos(e); scratch(p.x, p.y); });
  canvas.addEventListener('mousemove', (e) => { if (isScratching) { const p = getPos(e); scratch(p.x, p.y); } });
  canvas.addEventListener('mouseup', () => { isScratching = false; });
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); isScratching = true; const p = getPos(e); scratch(p.x, p.y); });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (isScratching) { const p = getPos(e); scratch(p.x, p.y); } });
  canvas.addEventListener('touchend', () => { isScratching = false; });

  async function revealResult() {
    ctx.clearRect(0, 0, 200, 140);
    document.getElementById('scratch-hint').textContent = '';

    const resultEl = document.getElementById('scratch-result');
    const partnerUid = getPartnerUid() || 'partner';

    let favoredUser = null;
    if (netAdjust > 0) {
      favoredUser = user.uid;
      resultEl.innerHTML = `<div class="duel-result" style="color:var(--green)">+$${netAdjust} — you win!</div>`;
    } else if (netAdjust < 0) {
      favoredUser = partnerUid;
      resultEl.innerHTML = `<div class="duel-result" style="color:var(--red)">-$${Math.abs(netAdjust)} — you lose!</div>`;
    } else {
      resultEl.innerHTML = `<div class="duel-result">$0 — no change!</div>`;
    }

    await recordDuelResult({
      game: 'scratch-card',
      result: { netAdjust },
      balanceAdjust: Math.abs(netAdjust),
      favoredUser,
      seed, year, week
    });
  }
}
