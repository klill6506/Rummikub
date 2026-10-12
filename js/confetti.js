// A quick purple-and-gold confetti burst on a full-screen canvas.

const COLORS = ['#c084fc', '#a855f7', '#e879f9', '#f0abfc', '#ffd166', '#7e22ce', '#ffffff'];

export function confetti(canvas, { count = 220, duration = 4200 } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: h * 0.45,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 17 - 6,
    size: 6 + Math.random() * 7,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    color: COLORS[(Math.random() * COLORS.length) | 0],
    shape: Math.random() < 0.3 ? 'circle' : 'rect',
  }));

  const start = performance.now();
  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = Math.max(0, 1 - Math.max(0, elapsed - duration * 0.6) / (duration * 0.4));
    for (const p of parts) {
      p.vy += 0.38;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  }
  requestAnimationFrame(frame);
}
