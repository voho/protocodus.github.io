/* Meteora — the briefing's tactical map.

   The mission seen from above, and true to it: the rocks are the belt the
   mission will fly through (its cleared lanes and the room round its
   stations show as they are), the icons and routes are the mission's own,
   and the briefing's stages are numbered on it in the order the Commander
   goes through them. A legend names whatever is on this map and nothing
   else. */

import { beltOf } from './field.js';

const ICON_COLOURS = {
  player: '#7fd8ff', nav: '#7fd8ff', friend: '#5dff8f', capital: '#5dff8f', station: '#f2d27a',
  enemy: '#ff4a3a', 'capital-enemy': '#ff4a3a', danger: '#ff7a5a', unknown: '#ffb347',
};
const ICON_NAMES = {
  player: 'You', nav: 'Waypoint', friend: 'Friendly', capital: 'Friendly capital', station: 'Station',
  enemy: 'Hostile', 'capital-enemy': 'Hostile capital', danger: 'Hazard', unknown: 'Unknown contact',
};
const ROUTES = {
  convoy: ['rgba(93, 255, 143, 0.7)', 'Convoy route'], hostile: ['rgba(255, 74, 58, 0.75)', 'Hostile route'],
  plan: ['rgba(127, 216, 255, 0.65)', 'Flight plan'],
};
const FONT = '"Space Grotesk", sans-serif';
const STEP = '#ffb347';

/* One icon, `k` times its size on the map (the legend's are smaller). */
function drawIcon(ctx, kind, x, y, pulse = 1, k = 1) {
  const c = ICON_COLOURS[kind] ?? '#e9edf3';
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
  switch (kind) {
    case 'player': ctx.beginPath(); ctx.moveTo(x, y - 8 * k); ctx.lineTo(x + 6 * k, y + 6 * k); ctx.lineTo(x - 6 * k, y + 6 * k); ctx.closePath(); ctx.fill(); break;
    case 'nav': { const r = 8 * k * pulse; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke(); break; }
    case 'friend': ctx.beginPath(); ctx.arc(x, y, 6 * k, 0, Math.PI * 2); ctx.stroke(); break;
    case 'capital': case 'capital-enemy': ctx.strokeRect(x - 16 * k, y - 6 * k, 32 * k, 12 * k); ctx.globalAlpha = 0.25; ctx.fillRect(x - 16 * k, y - 6 * k, 32 * k, 12 * k); ctx.globalAlpha = 1; break;
    case 'station': ctx.strokeRect(x - 9 * k, y - 9 * k, 18 * k, 18 * k); break;
    case 'enemy': ctx.beginPath(); ctx.moveTo(x, y + 7 * k); ctx.lineTo(x + 7 * k, y - 6 * k); ctx.lineTo(x - 7 * k, y - 6 * k); ctx.closePath(); ctx.fill(); break;
    case 'danger': ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 10 * k * pulse, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); break;
    default: ctx.font = `700 ${16 * k}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, y);
  }
}

/* The mission's rocks from above, drawn once into a picture the map then
   pans: twenty thousand dots a frame would cost more than the scene behind
   the briefing. `span` is metres from the origin to the picture's edge.
   Only the last mission's picture is kept. */
const LAYER = 1024;
let rockLayer = null;
function rocksOf(mission) {
  if (rockLayer?.mission === mission) return rockLayer;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = LAYER;
  const layer = rockLayer = { mission, canvas, span: 1 };
  // Making a dense belt takes a few tenths of a second (the launch then
  // finds it made): after the briefing has appeared, not before.
  if (mission.field?.types?.some(t => t.count > 0)) setTimeout(() => { if (rockLayer === layer) paintRocks(layer); }, 150);
  return layer;
}
function paintRocks(layer) {
  const belt = beltOf(layer.mission.fieldSeed, layer.mission.field);
  let span = 1000;
  for (let i = 0; i < belt.count; i++) span = Math.max(span, Math.abs(belt.pos[3 * i]) + belt.radius[i], Math.abs(belt.pos[3 * i + 2]) + belt.radius[i]);
  layer.span = span;
  const ctx = layer.canvas.getContext('2d'), k = LAYER / 2 / span;
  // The belt is two kilometres deep, and seen from above all of it would
  // lie over the lanes cut through it: the map is a slice 500 m thick at
  // the height the mission is flown at (landmarks show wherever they are).
  const icons = layer.mission.map.icons ?? [];
  const level = icons.reduce((sum, i) => sum + i.pos[1], 0) / (icons.length || 1);
  for (let i = 0; i < belt.count; i++) {
    if (!belt.landmark[i] && Math.abs(belt.pos[3 * i + 1] - level) > 250 + belt.radius[i]) continue;
    const r = belt.radius[i] * k;
    const x = LAYER / 2 + belt.pos[3 * i] * k, y = LAYER / 2 + belt.pos[3 * i + 2] * k;
    if (r < 0.8) { ctx.fillStyle = 'rgba(160, 172, 196, 0.2)'; ctx.fillRect(x, y, 1, 1); continue; }
    ctx.fillStyle = belt.landmark[i] ? 'rgba(196, 184, 160, 0.16)' : 'rgba(170, 180, 200, 0.34)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (belt.landmark[i]) { ctx.strokeStyle = 'rgba(196, 184, 160, 0.5)'; ctx.lineWidth = 1; ctx.stroke(); }
  }
}

/* `focus`: the world point at the map's centre. `plan`: the stages' focus
   points in order and which one is being read (`current`, or null). */
export function drawMap(canvas, mission, focus, t, plan = null) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const extent = mission.map.extent ?? 8000;
  const scale = Math.min(W, H) / extent * 1.15;
  const cx = W / 2 - focus[0] * scale, cy = H / 2 - focus[2] * scale;
  const X = p => cx + p[0] * scale, Y = p => cy + p[2] * scale;

  // A kilometre grid, every fifth line stronger.
  const step = 1000 * scale;
  ctx.lineWidth = 1;
  const gridLine = n => { ctx.strokeStyle = n % 5 ? 'rgba(127, 216, 255, 0.06)' : 'rgba(127, 216, 255, 0.14)'; };
  for (let n = Math.ceil(-cx / step); n * step + cx < W; n++) {
    const x = Math.round(cx + n * step) + 0.5;
    gridLine(n); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let n = Math.ceil(-cy / step); n * step + cy < H; n++) {
    const y = Math.round(cy + n * step) + 0.5;
    gridLine(n); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  const rocks = rocksOf(mission), size = 2 * rocks.span * scale;
  ctx.drawImage(rocks.canvas, cx - size / 2, cy - size / 2, size, size);

  // Routes, with arrowheads the way they run.
  const routeKinds = new Set();
  for (const r of mission.map.routes ?? []) {
    const kind = ROUTES[r.kind] ? r.kind : 'plan';
    routeKinds.add(kind);
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -t * 30;
    ctx.strokeStyle = ctx.fillStyle = ROUTES[kind][0];
    ctx.lineWidth = 2;
    ctx.beginPath();
    r.path.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 1; i < r.path.length; i++) {
      const ax = X(r.path[i - 1]), ay = Y(r.path[i - 1]), bx = X(r.path[i]), by = Y(r.path[i]);
      if (Math.hypot(bx - ax, by - ay) < 40) continue;
      ctx.save();
      ctx.translate((ax + bx) / 2, (ay + by) / 2);
      ctx.rotate(Math.atan2(by - ay, bx - ax));
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // Icons, their labels on a dark plate so the rock behind cannot eat the text.
  for (const i of mission.map.icons ?? []) {
    const x = X(i.pos), y = Y(i.pos);
    drawIcon(ctx, i.kind, x, y, 1 + 0.15 * Math.sin(t * 3 + x));
    if (!i.label || (i.kind === 'unknown' && i.label === '?')) continue;
    ctx.font = `500 12px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(i.label).width + 10;
    ctx.fillStyle = 'rgba(6, 10, 18, 0.72)';
    ctx.fillRect(x - w / 2, y + 13, w, 18);
    ctx.fillStyle = 'rgba(233, 237, 243, 0.92)';
    ctx.fillText(i.label, x, y + 22.5);
  }

  // The briefing's stages, numbered beside where each one points; the one
  // being read is filled in and its place ringed.
  if (plan) {
    const placed = [];
    plan.points.forEach((p, n) => {
      // Stages that point at the same place sit side by side.
      const twins = placed.filter(q => Math.hypot(q[0] - p[0], q[2] - p[2]) * scale < 20).length;
      placed.push(p);
      const x = X(p) + 20 + twins * 22, y = Y(p) - 20, on = n === plan.current;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = on ? STEP : 'rgba(6, 10, 18, 0.8)'; ctx.fill();
      ctx.strokeStyle = on ? STEP : 'rgba(255, 179, 71, 0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = on ? '#10141c' : STEP;
      ctx.fillText(String(n + 1), x, y + 0.5);
      if (!on) return;
      const r = 30 + 3 * Math.sin(t * 2.4);
      ctx.strokeStyle = 'rgba(255, 179, 71, 0.75)';
      for (let q = 0; q < 4; q++) {
        const a = t * 0.5 + q * Math.PI / 2;
        ctx.beginPath(); ctx.arc(X(p), Y(p), r, a, a + 0.9); ctx.stroke();
      }
    });
  }

  // The legend, where the map is wide enough to spare the corner.
  const entries = [...new Set((mission.map.icons ?? []).map(i => i.kind))].filter(k => ICON_NAMES[k]).map(k => [k, ICON_NAMES[k]]);
  for (const k of routeKinds) entries.push([`route:${k}`, ROUTES[k][1]]);
  if (plan) entries.push(['step', 'Briefing step']);
  if (entries.length && W > 360) {
    ctx.font = `500 11px ${FONT}`;
    const width = Math.max(...entries.map(e => ctx.measureText(e[1]).width)) + 58, height = entries.length * 20 + 12;
    const x0 = W - width - 12, y0 = H - height - 12;
    ctx.fillStyle = 'rgba(6, 10, 18, 0.78)'; ctx.fillRect(x0, y0, width, height);
    ctx.strokeStyle = 'rgba(127, 216, 255, 0.18)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
    entries.forEach(([kind, name], n) => {
      const x = x0 + 22, y = y0 + 16 + n * 20;
      if (kind.startsWith('route:')) {
        ctx.strokeStyle = ROUTES[kind.slice(6)][0]; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.stroke(); ctx.setLineDash([]);
      } else if (kind === 'step') {
        ctx.strokeStyle = STEP; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
      } else drawIcon(ctx, kind, x, y, 1, 0.6);
      ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(214, 221, 232, 0.9)';
      ctx.fillText(name, x0 + 44, y + 0.5);
    });
  }

  // Scale bar.
  ctx.fillStyle = 'rgba(160, 178, 205, 0.8)'; ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillRect(14, H - 18, 1000 * scale, 2); ctx.fillRect(14, H - 22, 1, 6); ctx.fillRect(13 + 1000 * scale, H - 22, 1, 6);
  ctx.fillText('1 km', 14, H - 30);
}
