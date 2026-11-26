// Two glints race in from the banks. When they meet, the span throws paper
// and curled streamers from its own deck and trusses.
export const BURST_AT = 0.6;
export const CELEBRATION_LENGTH = 2.65;
const PAPER = ['#ffc536', '#ff5549', '#15d9af', '#559dff', '#ff86ce', '#fff0b5'];
const tau = 2 * Math.PI;

export function createCelebration(mission, sim, reducedMotion) {
  const confetti = [];
  if (!reducedMotion) {
    const beams = sim.beams.filter(b => !b.broken && !b.piece);
    const stations = Math.max(9, mission.span + 2);
    for (let i = 0; i < stations; i++) {
      const center = i === Math.floor(stations / 2);
      const u = center ? 0.5 : (i + 0.5) / stations, side = 2 * u - 1;
      const x = mission.left + u * (mission.right - mission.left);
      const deck = [], supports = [];
      for (const b of beams) {
        const a = sim.nodes[b.a], end = sim.nodes[b.b];
        if (a.x === end.x || x < Math.min(a.x, end.x) || x > Math.max(a.x, end.x)) continue;
        const y = a.y + (end.y - a.y) * (x - a.x) / (end.x - a.x);
        (b.road ? deck : supports).push(y);
      }
      const heights = [...deck, ...supports];
      if (!heights.length) continue;
      for (let n = 0; n < (center ? 44 : 14); n++) {
        const fountain = n >= 14;
        const streamer = n % 7 === 4;
        const early = n < 4;
        const launch = early ? 0.1 + 0.42 * (1 - Math.abs(side)) : BURST_AT + 0.20 * Math.abs(side);
        let vx = (early ? -1.5 : 3.4) * side + (Math.random() - 0.5) * 7;
        let vy = streamer ? 11 : (early ? 5 : 7);
        if (fountain) {
          const angle = (n - 14) / 29 * 2.3 - 1.15;
          vx = Math.sin(angle) * 12;
          vy = Math.cos(angle) * 10 + 5;
        }
        confetti.push({
          x, y: fountain && deck.length ? deck[0] : heights[n % heights.length],
          delay: launch + Math.random() * 0.08, vx, vy: vy + Math.random() * 5,
          size: 0.12 + Math.random() * 0.12, phase: Math.random() * tau,
          spin: (2 + Math.random() * 5) * (n % 2 ? 1 : -1),
          color: PAPER[(n + i) % PAPER.length], streamer,
        });
      }
    }
  }
  return { elapsed: 0, confetti };
}

function pulse(t, center, width) {
  const offset = Math.min(1, Math.abs(t - center) / width);
  return (1 + Math.cos(Math.PI * offset)) / 2;
}

function deckHeight(sim, x) {
  for (const beam of sim.beams) {
    if (!beam.road || beam.broken) continue;
    const a = sim.nodes[beam.a], b = sim.nodes[beam.b];
    if (a.x !== b.x && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) {
      return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    }
  }
  return null;
}

// A brief pool of warm light behind the center gives the paper contrast on
// bright painted skies. The moving bridge and vehicle stay in the foreground.
export function drawVictoryLight(ctx, view, mission, celebration) {
  const t = celebration.elapsed;
  if (t > 2.55) return;
  const strength = Math.min(1, t / 0.22, (2.55 - t) / 0.9);
  const x = view.sx((mission.left + mission.right) / 2), y = view.sy(mission.deck);
  const radius = Math.max(90, view.sx(mission.right) - x);
  ctx.save();
  ctx.fillStyle = `rgba(20, 27, 53, ${strength * 0.22})`;
  ctx.fillRect(0, 0, view.width, view.height);
  const bloom = pulse(t, BURST_AT + 0.13, 0.5);
  if (bloom) {
    const r = radius * (0.52 + 0.33 * t);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(255, 226, 156, ${0.55 * bloom})`);
    glow.addColorStop(0.35, `rgba(255, 198, 105, ${0.19 * bloom})`);
    glow.addColorStop(1, 'rgba(255, 198, 105, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

// Light follows the actual surviving members, including arches and cables.
// This pass also works in the mirrored water transform.
export function drawVictoryGlow(ctx, view, mission, sim, celebration, still) {
  const t = celebration.elapsed;
  if (!still && t > 1.9) return;
  const x0 = view.sx(mission.left), x1 = view.sx(mission.right);
  const light = ctx.createLinearGradient(x0, 0, x1, 0);
  for (let i = 0; i <= 24; i++) {
    const inward = 1 - Math.abs(i / 12 - 1);
    const wave = pulse(t, 0.06 + inward * (BURST_AT - 0.06), 0.2);
    const flash = pulse(t, BURST_AT + 0.20, 0.47);
    const afterglow = Math.max(0, 1 - t / 1.9) * 0.52;
    const strength = still ? 0.72 : Math.min(1, 0.9 * wave + flash + afterglow);
    light.addColorStop(i / 24, `rgba(255,${Math.round(185 + strength * 65)},${Math.round(80 + strength * 134)},${strength})`);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = light;
  ctx.beginPath();
  for (const b of sim.beams) {
    if (b.broken || b.piece) continue;
    const a = sim.nodes[b.a], end = sim.nodes[b.b];
    ctx.moveTo(view.sx(a.x), view.sy(a.y));
    ctx.lineTo(view.sx(end.x), view.sy(end.y));
  }
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * 0.28;
  ctx.lineWidth = Math.max(5, view.scale * 0.52);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(2.5, view.scale * 0.24);
  ctx.stroke();
  if (!still && t <= BURST_AT) {
    const travel = Math.min(1, t / BURST_AT);
    const distance = (mission.right - mission.left) * travel / 2;
    const r = Math.max(4, Math.min(15, view.scale * 0.25));
    ctx.fillStyle = '#fff4cc';
    for (const x of [mission.left + distance, mission.right - distance]) {
      const y = deckHeight(sim, x);
      if (y === null) continue;
      const px = view.sx(x), py = view.sy(y);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, radius = i % 2 ? r * 0.24 : r;
        const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px + dx, py + dy);
        else ctx.lineTo(px + dx, py + dy);
      }
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// Evaluate each flight from its launch point. Returning from a background
// tab or resizing the canvas keeps the paper attached to the same crossing.
export function drawConfetti(ctx, view, celebration) {
  const fade = Math.min(1, (CELEBRATION_LENGTH - celebration.elapsed) / 0.55);
  for (const p of celebration.confetti) {
    const t = celebration.elapsed - p.delay;
    if (t < 0) continue;
    const flight = -Math.expm1(-1.4 * t) / 1.4;
    const turn = p.phase + p.spin * t;
    const x = p.x + p.vx * flight + 0.16 * t * Math.sin(turn);
    const y = p.y + (p.vy + 4.3) * flight - 4.3 * t;
    const size = Math.max(2.7, Math.min(10, p.size * view.scale));
    ctx.save();
    ctx.translate(view.sx(x), view.sy(y));
    ctx.rotate(p.streamer ? turn * 0.38 : turn);
    ctx.globalAlpha *= Math.max(0, fade);
    if (p.streamer) {
      const curl = Math.sin(turn) * size * 1.5;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1.7, size * 0.65);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -size * 2.2);
      ctx.bezierCurveTo(curl * 2, -size, -curl * 2, size, 0, size * 2.2);
      ctx.stroke();
    } else {
      const flip = Math.cos(turn * 1.4);
      ctx.fillStyle = p.color;
      const h = size * (0.20 + 0.85 * Math.abs(flip));
      ctx.fillRect(-size, -h / 2, size * 2, h);
      ctx.fillStyle = flip > 0 ? 'rgba(255,250,214,0.7)' : 'rgba(81,44,61,0.35)';
      ctx.fillRect(-size, -h / 2, size * 2, Math.min(1.3, h / 2));
    }
    ctx.restore();
  }
}
