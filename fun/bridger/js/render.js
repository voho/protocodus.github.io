/* Canvas drawing: sky, valley, river, the bridge and the vehicle. World
   units are metres with y up; the view maps them onto the canvas. */
import { CELL, MATERIALS } from './physics.js';
import { jointAllowed } from './mission.js';
import { drawBackdrop, drawGround, drawWater } from './scenery.js';

const WIDTH = { road: 0.5, wood: 0.3, steel: 0.28, cable: 0.09 };
const COLOR = { road: '#3a3f48', wood: '#c98b4f', steel: '#8aa3bd', cable: '#1c2128' };

/* Green while relaxed, yellow past half, red as it nears its strength. */
export function stressColor(u) {
  const t = Math.max(0, Math.min(1, u));
  const lerp = (a, b, k) => Math.round(a + (b - a) * k);
  if (t < 0.55) {
    const k = t / 0.55;
    return `rgb(${lerp(60, 255, k)},${lerp(207, 210, k)},${lerp(110, 63, k)})`;
  }
  const k = (t - 0.55) / 0.45;
  return `rgb(255,${lerp(210, 59, k)},${lerp(63, 48, k)})`;
}

export function createView(mission, width, height, top, bottom) {
  // Frame the river and its bolts; extra land and river bed show only when
  // the screen has room, so a phone held upright still gets big joints.
  const x0 = -2.7 * CELL, x1 = (mission.span + 2.7) * CELL;
  const y0 = mission.water - 2.5, y1 = mission.bounds.maxY * CELL + 1;
  const avail = Math.max(120, height - top - bottom);
  const scale = Math.min(width / (x1 - x0), avail / (y1 - y0));
  const ox = (width - (x1 - x0) * scale) / 2 - x0 * scale;
  const oy = top + (avail - (y1 - y0) * scale) / 2 + y1 * scale;
  return {
    scale, ox, oy, width, height,
    sx: (x) => ox + x * scale,
    sy: (y) => oy - y * scale,
    wx: (px) => (px - ox) / scale,
    wy: (py) => (oy - py) / scale,
  };
}

function grid(ctx, view, mission, focus, theme) {
  const { minX, maxX, minY, maxY } = mission.bounds;
  const r = Math.max(1.2, view.scale * 0.09);
  for (let gx = minX; gx <= maxX; gx++) {
    for (let gy = minY; gy <= maxY; gy++) {
      if (!jointAllowed(mission, [gx, gy])) continue;
      const near = focus && Math.hypot(gx - focus[0], gy - focus[1]) <= focus[2];
      ctx.fillStyle = theme.grid;
      ctx.globalAlpha = near ? 1 : 0.75;
      ctx.beginPath();
      ctx.arc(view.sx(gx * CELL), view.sy(gy * CELL), near ? r * 1.6 : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function anchors(ctx, view, mission) {
  const s = Math.max(7, view.scale * 0.42);
  for (const [gx, gy] of mission.anchors) {
    const x = view.sx(gx * CELL), y = view.sy(gy * CELL);
    ctx.fillStyle = '#e2533f';
    ctx.strokeStyle = '#ffd2c4';
    ctx.lineWidth = Math.max(1.5, s * 0.22);
    ctx.beginPath();
    ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd2c4';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* One member as a thick line in its material, or in its stress colour. */
function beam(ctx, view, ax, ay, bx, by, mat, stress, overlay) {
  const w = Math.max(mat === 'cable' ? 1.6 : 3, WIDTH[mat] * view.scale);
  ctx.lineCap = 'round';
  if (mat === 'road') {
    ctx.strokeStyle = stress == null ? COLOR.road : stress;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = stress == null ? '#f2c94c' : 'rgba(30, 34, 40, 0.55)';
    ctx.lineWidth = Math.max(1, w * 0.14);
    ctx.setLineDash([w * 0.9, w * 0.9]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = stress == null ? COLOR[mat] : stress;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    if (stress == null && mat === 'steel') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = Math.max(1, w * 0.25);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
  if (overlay) {
    ctx.strokeStyle = overlay;
    ctx.lineWidth = Math.max(1.5, w * 0.36);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
}

function joints(ctx, view, points) {
  const r = Math.max(2.5, view.scale * 0.16);
  ctx.fillStyle = '#f7f7f2';
  ctx.strokeStyle = '#2a2f36';
  ctx.lineWidth = Math.max(1, r * 0.45);
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/* Bodies sit on pairs of axles: [front axle, rear axle, kind]. */
const BODIES = { car: [[0, 1, 'car']], truck: [[0, 2, 'truck']], train: [[0, 1, 'loco'], [2, 3, 'wagon'], [4, 5, 'wagon']] };

function vehicle(ctx, view, car) {
  const s = view.scale;
  for (const [fi, ri, kind] of BODIES[car.id]) {
    const f = car.axles[fi], r = car.axles[ri];
    const d = Math.hypot(f.x - r.x, f.y - r.y);
    ctx.save();
    ctx.translate(view.sx(r.x), view.sy(r.y));
    ctx.rotate(-Math.atan2(f.y - r.y, f.x - r.x) + car.tilt * (kind === 'wagon' ? 0.6 : 1));
    ctx.scale(s, -s); // local metres, y up, rear axle at the origin
    const wheel = kind === 'car' ? 0.42 : 0.5;
    const box = (x0, y0, x1, y1, fill, radius = 0.25) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, radius);
      ctx.fill();
    };
    if (kind === 'car') {
      box(-0.85, wheel * 0.7, d + 0.85, 1.25, '#e8473b', 0.35);
      box(0.15, 1.1, d - 0.4, 1.85, '#e8473b', 0.4);
      box(0.4, 1.25, d * 0.5 - 0.05, 1.72, '#bfe4ff', 0.15);
      box(d * 0.5 + 0.1, 1.25, d - 0.65, 1.72, '#bfe4ff', 0.15);
      box(d + 0.55, 0.75, d + 0.85, 0.95, '#fff6c4', 0.08);
    } else if (kind === 'truck') {
      box(-0.9, 0.9, d - 1.6, 3.1, '#f6a623', 0.15);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let x = -0.5; x < d - 1.8; x += 0.7) ctx.fillRect(x, 1.05, 0.08, 1.9);
      box(d - 1.45, 0.75, d + 1.2, 2.7, '#2f80d1', 0.3);
      box(d - 0.2, 1.7, d + 0.95, 2.45, '#bfe4ff', 0.12);
      box(-0.9, 0.6, d + 1.2, 0.9, '#30353d', 0.1);
    } else if (kind === 'loco') {
      box(-1.1, 0.7, d + 1.5, 2.8, '#2a6fd6', 0.3);
      box(-1.1, 2.6, 1.6, 3.6, '#2a6fd6', 0.2);
      box(-0.7, 2.75, 1.2, 3.35, '#bfe4ff', 0.1);
      box(d + 0.4, 2.8, d + 0.8, 3.7, '#30353d', 0.08);
      box(-1.1, 1.35, d + 1.5, 1.6, '#ffd23f', 0);
    } else {
      box(-1.25, 0.75, d + 1.25, 2.6, '#7c4dbd', 0.2);
      box(-1.25, 1.4, d + 1.25, 1.6, '#c9a6f2', 0);
    }
    for (const x of [0, d]) {
      ctx.fillStyle = '#22262c';
      ctx.beginPath(); ctx.arc(x, wheel, wheel, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9ced6';
      ctx.beginPath(); ctx.arc(x, wheel, wheel * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    if (kind === 'truck') {
      // The truck's middle axle, between the two drawn wheels.
      const m = car.axles[1];
      const u = Math.hypot(m.x - r.x, m.y - r.y);
      ctx.fillStyle = '#22262c';
      ctx.beginPath(); ctx.arc(d - u, wheel, wheel, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function label(ctx, x, y, text, color = '#fff') {
  ctx.font = '600 13px "Space Grotesk", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(12, 16, 22, 0.86)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 26, w, 21, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - 15.5);
}

/* state: { mission, view, time, theme, scenery, mode, members, sim, peakOf, parked, hover, drag, particles, focus } */
export function draw(ctx, state) {
  const { mission, view, time, theme } = state;
  drawBackdrop(ctx, view, state.scenery, theme, time);
  drawGround(ctx, view, mission, state.scenery, theme);
  if (state.mode === 'build') grid(ctx, view, mission, state.focus, theme);

  const points = new Map();
  if (state.mode === 'build') {
    for (const m of state.members) {
      const ax = view.sx(m.a[0] * CELL), ay = view.sy(m.a[1] * CELL);
      const bx = view.sx(m.b[0] * CELL), by = view.sy(m.b[1] * CELL);
      const peak = state.peakOf?.(m);
      const hot = state.hover?.member === m;
      beam(ctx, view, ax, ay, bx, by, m.mat, null, peak != null ? stressColor(peak) : hot ? 'rgba(255, 255, 255, 0.6)' : null);
      points.set(`${m.a}`, [ax, ay]);
      points.set(`${m.b}`, [bx, by]);
    }
  } else if (state.sim) {
    const { nodes, beams } = state.sim;
    for (const b of beams) {
      if (b.broken) continue;
      const na = nodes[b.a], nb = nodes[b.b];
      beam(ctx, view, view.sx(na.x), view.sy(na.y), view.sx(nb.x), view.sy(nb.y), b.mat, stressColor(b.usage));
    }
    for (const b of beams) {
      if (b.broken) continue;
      for (const n of [nodes[b.a], nodes[b.b]]) if (!n.fixed) points.set(n, [view.sx(n.x), view.sy(n.y)]);
    }
  }
  joints(ctx, view, points.values());
  anchors(ctx, view, mission);

  if (state.sim && state.mode === 'test') vehicle(ctx, view, state.sim.car);
  else vehicle(ctx, view, state.parked);
  drawWater(ctx, view, mission, theme, time);

  if (state.mirrorX != null && state.mode === 'build') {
    // A faint centre line while mirror building is on.
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(view.sx(state.mirrorX), view.sy(mission.bounds.maxY * CELL + 0.5));
    ctx.lineTo(view.sx(state.mirrorX), view.sy(mission.water));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (state.drag) {
    const { from, to, ok, mat, plan } = state.drag;
    const ax = view.sx(from[0] * CELL), ay = view.sy(from[1] * CELL);
    if (mat !== 'road') {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(ax, ay, MATERIALS[mat].maxLength * view.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (to) {
      const bx = view.sx(to[0] * CELL), by = view.sy(to[1] * CELL);
      const shown = ok ? plan.add : [{ a: from, b: to, mat }];
      ctx.globalAlpha = 0.85;
      for (const m of shown) beam(ctx, view, view.sx(m.a[0] * CELL), view.sy(m.a[1] * CELL), view.sx(m.b[0] * CELL), view.sy(m.b[1] * CELL), mat, ok ? null : '#ff5a4a');
      ctx.globalAlpha = 1;
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]) * CELL;
      const cost = ok ? plan.add.reduce((sum, m) => sum + Math.round(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * CELL * MATERIALS[mat].cost), 0) : Math.round(length * MATERIALS[mat].cost);
      label(ctx, bx, by - 8, `${length.toFixed(1)} m · $${cost}`, ok ? '#fff' : '#ff9b8f');
    }
  }

  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
    ctx.fillStyle = p.color;
    const r = Math.max(1.5, p.size * view.scale);
    if (p.square) ctx.fillRect(view.sx(p.x) - r, view.sy(p.y) - r, r * 2, r * 1.2);
    else { ctx.beginPath(); ctx.arc(view.sx(p.x), view.sy(p.y), r, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;

  if (state.hover?.label) label(ctx, state.hover.px, state.hover.py - 6, state.hover.label, state.hover.color);
}
