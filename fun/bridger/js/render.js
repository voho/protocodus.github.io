/* Canvas drawing: sky, valley, river, the bridge and the vehicle. World
   units are metres with y up; the view maps them onto the canvas. */
import { CELL, MATERIALS, BODIES, SPRITE_AXLES, BODY_COUPLERS } from './physics.js';
import { image, ready } from './art.js';
import { jointAllowed } from './mission.js';
import { drawBackdrop, drawAmbient, drawWeather, drawGround, drawWater } from './scenery.js';
import { drawVictoryLight, drawVictoryGlow, drawConfetti } from './celebration.js';

const WIDTH = { road: 0.5, wood: 0.3, steel: 0.28, cable: 0.09 };
const OUTLINE = '#141620';
export const beamWidth = (view, mat) => Math.max(mat === 'cable' ? 1.9 : 3, WIDTH[mat] * view.scale);
export const anchorHalfSize = (view) => Math.max(7, view.scale * 0.42);
export const jointRadius = (view) => Math.max(2.65, view.scale * 0.16);

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
  // Keep edge joints visible and reachable, including on narrow phones.
  const x0 = (mission.bounds.minX - 0.4) * CELL, x1 = (mission.bounds.maxX + 0.4) * CELL;
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

// A view changes on resize. The legal grid and its two dot sizes change
// only when the mission or the starting point of a drag changes.
const gridViews = new WeakMap();
function grid(ctx, view, mission, focus, theme) {
  let grid = gridViews.get(view);
  if (grid?.mission !== mission) {
    const points = [];
    const { minX, maxX, minY, maxY } = mission.bounds;
    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        if (jointAllowed(mission, [gx, gy])) points.push([gx, gy, view.sx(gx * CELL), view.sy(gy * CELL)]);
      }
    }
    grid = { mission, points };
    gridViews.set(view, grid);
  }
  if (!grid.far || grid.focus !== focus) {
    const r = Math.max(1.2, view.scale * 0.09);
    grid.far = new Path2D();
    grid.near = new Path2D();
    for (const [gx, gy, x, y] of grid.points) {
      const near = focus && Math.hypot(gx - focus[0], gy - focus[1]) <= focus[2];
      const radius = near ? r * 1.6 : r;
      const path = near ? grid.near : grid.far;
      path.moveTo(x + radius, y);
      path.arc(x, y, radius, 0, Math.PI * 2);
    }
    grid.focus = focus;
  }
  ctx.fillStyle = theme.grid;
  ctx.globalAlpha = 0.75;
  ctx.fill(grid.far);
  ctx.globalAlpha = 1;
  if (focus) ctx.fill(grid.near);
}

/* The hatch is on the reserved side of the boundary. A ceiling needs only
   a short band above the line, leaving the rest of the sky unobstructed. */
function clearanceMarker(ctx, view, zone, theme) {
  const channel = zone.kind === 'channel';
  const left = Math.max(-2, view.sx(zone.x0)), right = Math.min(view.width + 2, view.sx(zone.x1));
  const bottom = view.sy(zone.y0);
  const top = Math.max(view.sy(zone.y1), channel ? 0 : bottom - Math.max(7, view.scale * 0.28));
  const height = bottom - top;
  if (right <= left || height <= 0) return;
  const dark = theme.ui === 'dark';
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, right - left, height); ctx.clip();
  ctx.fillStyle = dark ? 'rgba(255, 215, 159, 0.10)' : 'rgba(119, 60, 34, 0.09)';
  ctx.fillRect(left, top, right - left, height);
  ctx.strokeStyle = dark ? 'rgba(255, 226, 182, 0.52)' : 'rgba(101, 52, 33, 0.42)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = left - height; x < right; x += 12) {
    ctx.moveTo(x, bottom); ctx.lineTo(x + height, top);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  if (channel) ctx.rect(left, top, right - left, height);
  else { ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); }
  ctx.strokeStyle = 'rgba(255, 241, 212, 0.76)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#795343';
  ctx.lineWidth = 1.35;
  ctx.stroke();
  ctx.restore();
}

function anchors(ctx, view, mission) {
  const s = anchorHalfSize(view);
  for (const [gx, gy] of mission.anchors) {
    const x = view.sx(gx * CELL), y = view.sy(gy * CELL);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(47, 31, 23, 0.38)';
    ctx.beginPath();
    ctx.roundRect(-s + s * 0.15, -s + s * 0.24, s * 2, s * 2, s * 0.25);
    ctx.fill();

    const plate = ctx.createLinearGradient(-s, -s, s * 0.5, s);
    plate.addColorStop(0, '#fa9674');
    plate.addColorStop(0.32, '#c96047');
    plate.addColorStop(1, '#a44632');
    ctx.fillStyle = plate;
    ctx.strokeStyle = '#674331';
    ctx.lineWidth = Math.max(1.1, s * 0.12);
    ctx.beginPath();
    ctx.roundRect(-s, -s, s * 2, s * 2, s * 0.23);
    ctx.fill(); ctx.stroke();
    if (s > 9) {
      ctx.fillStyle = '#824532';
      ctx.fillRect(-s * 0.76, -s * 0.71, s * 0.21, s * 0.12);
      ctx.fillRect(s * 0.52, s * 0.63, s * 0.24, s * 0.13);
    }
    // A hex nut and a recessed stud at the centre of the bolted plate.
    const radius = s * 0.54;
    ctx.fillStyle = '#e4c8a3';
    ctx.strokeStyle = '#734f3b';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#846d55';
    ctx.beginPath(); ctx.arc(0, s * 0.035, radius * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/* Paint in the member's own coordinates. Fine grain and wire twists drop
   out when they would be smaller than a pixel. */
function beam(ctx, view, ax, ay, bx, by, mat, stress, overlay) {
  const w = beamWidth(view, mat);
  if (stress) {
    // A loaded member has two concentric strokes; both use the same path.
    // Neither the material grain nor a rotated coordinate system is needed.
    if (ax === bx && ay === by) return;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = '#38423d'; ctx.lineWidth = w + 1.5; ctx.stroke();
    ctx.strokeStyle = stress; ctx.lineWidth = w; ctx.stroke();
    return;
  }
  const length = Math.hypot(bx - ax, by - ay);
  if (!length) return;
  const reverse = bx < ax || (ax === bx && by < ay);
  ctx.save();
  ctx.translate(reverse ? bx : ax, reverse ? by : ay);
  ctx.rotate(Math.atan2(reverse ? ay - by : by - ay, reverse ? ax - bx : bx - ax));
  ctx.lineCap = 'round';
  const band = (color, width, y = 0) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(length, y); ctx.stroke();
  };

  if (mat === 'wood') {
    const timber = ctx.createLinearGradient(0, -w * 0.5, 0, w * 0.5);
    timber.addColorStop(0, '#ddaa70'); timber.addColorStop(0.53, '#bd834b'); timber.addColorStop(1, '#a16c40');
    band('#64462e', w + 1.7);
    band(timber, w);
    band('#e3b47b', Math.max(0.85, w * 0.16), -w * 0.33);
    if (w >= 5 && length > 15) {
      ctx.strokeStyle = '#94623c'; ctx.lineWidth = Math.max(0.65, w * 0.09);
      ctx.beginPath();
      ctx.moveTo(length * 0.08, w * 0.16);
      ctx.bezierCurveTo(length * 0.36, w * 0.17, length * 0.47, -w * 0.18, length * 0.72, w * 0.04);
      ctx.moveTo(length * 0.55, w * 0.22);
      ctx.quadraticCurveTo(length * 0.72, w * 0.1, length * 0.91, w * 0.23);
      ctx.stroke();
    }
  } else if (mat === 'steel') {
    band('#3e5456', w + 1.8);
    band('#809a9c', w);
    band('#cfdbd4', Math.max(0.9, w * 0.22), -w * 0.35);
    band('#546a71', Math.max(0.8, w * 0.20), w * 0.35);
  } else if (mat === 'cable') {
    band('#344440', w + 0.85);
    band('#84938d', Math.max(0.8, w * 0.49), -w * 0.16);
    if (w >= 2.4) {
      ctx.strokeStyle = '#ccd0bd'; ctx.lineWidth = Math.max(0.8, w * 0.29);
      ctx.beginPath();
      for (let x = w; x < length - w; x += w * 2.25) {
        ctx.moveTo(x, w * 0.20); ctx.lineTo(x + w * 0.58, -w * 0.29);
      }
      ctx.stroke();
    }
  } else {
    // A cut edge of asphalt over the aggregate deck, seen from the side.
    band('#434640', w + 1.7);
    band('#8b8474', w);
    band('#424847', Math.max(1.5, w * 0.36), -w * 0.29);
    band('#a4a18c', Math.max(0.8, w * 0.10), -w * 0.08);
    if (w >= 5) {
      for (let x = w * 0.41, i = 1; x < length - 2; i++) {
        const scatter = (i * 0.618034) % 1;
        ctx.fillStyle = i % 3 ? '#a39b87' : '#707469';
        ctx.fillRect(x, w * (scatter * 0.29 - 0.02), w * (0.10 + scatter * 0.10), Math.max(0.65, w * 0.075));
        x += w * (0.37 + scatter * 0.52);
      }
    }
  }
  if (overlay) band(overlay, Math.max(1.5, w * 0.36));
  ctx.restore();
}

/* A soft offset shadow under every member, so the bridge lifts off the scenery. */
function shadows(ctx, view, lines) {
  const d = Math.max(1.5, view.scale * 0.1);
  ctx.strokeStyle = 'rgba(10, 18, 30, 0.2)';
  ctx.lineCap = 'round';
  for (const { ax, ay, bx, by, mat } of lines) {
    ctx.lineWidth = Math.max(mat === 'cable' ? 1.6 : 3, WIDTH[mat] * view.scale) + d;
    ctx.beginPath(); ctx.moveTo(ax + d * 0.6, ay + d); ctx.lineTo(bx + d * 0.6, by + d); ctx.stroke();
  }
}

function joints(ctx, view, points, minY = -Infinity) {
  const r = jointRadius(view);
  ctx.lineWidth = Math.max(0.9, r * 0.23);
  for (const [x, y] of points) {
    if (y < minY) continue;
    ctx.fillStyle = '#778079';
    ctx.strokeStyle = '#394039';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d8d8bd';
    ctx.beginPath(); ctx.arc(x - r * 0.10, y - r * 0.15, r * 0.68, 0, Math.PI * 2); ctx.fill();
    if (r > 3.1) {
      ctx.strokeStyle = '#737a6e';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.30, y + r * 0.12); ctx.lineTo(x + r * 0.20, y - r * 0.25);
      ctx.stroke();
    }
  }
}

function drawTrainCouplings(ctx, view, car) {
  ctx.save();
  ctx.strokeStyle = '#3b3531';
  ctx.lineWidth = Math.max(1.4, view.scale * 0.11);
  ctx.lineCap = 'round';
  ctx.beginPath();
  let previous = null;
  for (const [fi, ri, kind] of BODIES.train) {
    const f = car.axles[fi], r = car.axles[ri], base = r.offset - f.offset;
    const c = (f.x - r.x) / base, s = (f.y - r.y) / base;
    const at = ([x, y]) => [view.sx(r.x + c * x - s * y), view.sy(r.y + s * x + c * y)];
    if (previous) { ctx.moveTo(...previous); ctx.lineTo(...at(BODY_COUPLERS[kind].front)); }
    previous = at(BODY_COUPLERS[kind].rear);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawVehicle(ctx, view, car) {
  if (car.id === 'train') drawTrainCouplings(ctx, view, car);
  const wheel = image(car.id === 'train' ? 'wheel-rail' : 'wheel-road');
  for (const [fi, ri, kind] of BODIES[car.id]) {
    const front = car.axles[fi], rear = car.axles[ri];
    const [rearPixel, frontPixel, groundPixel, wheelPixel] = SPRITE_AXLES[kind];
    const wheelbase = Math.hypot(front.x - rear.x, front.y - rear.y);
    const scale = view.scale * wheelbase / (frontPixel - rearPixel);
    ctx.save();
    ctx.translate(view.sx(rear.x), view.sy(rear.y));
    ctx.rotate(-Math.atan2(front.y - rear.y, front.x - rear.x));
    ctx.scale(scale, scale);
    for (let i = fi; i <= ri; i++) {
      const axle = car.axles[i];
      const x = (rear.offset - axle.offset) / (rear.offset - front.offset) * (frontPixel - rearPixel);
      ctx.save();
      ctx.translate(x, -wheelPixel);
      ctx.rotate(axle.angle);
      if (ready(wheel)) ctx.drawImage(wheel, -wheelPixel, -wheelPixel, wheelPixel * 2, wheelPixel * 2);
      ctx.restore();
    }
    // The fenders cover the wheel sprites at every axle angle.
    const body = image(kind);
    if (ready(body)) ctx.drawImage(body, -rearPixel, -groundPixel);
    ctx.restore();
  }
}

function label(ctx, view, x, y, text, color = '#fff') {
  ctx.font = '600 13px "Space Grotesk", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  const cx = Math.max(w / 2 + 2, Math.min(view.width - w / 2 - 2, x));
  const top = Math.max(2, Math.min(view.height - 23, y - 26));
  ctx.fillStyle = 'rgba(12, 16, 22, 0.86)';
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, top, w, 21, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, top + 10.5);
}

// The editor replaces the member array on each edit and the peak map on
// each test. Both drawing passes share the projected joints and stresses.
const buildViews = new WeakMap();
function buildGeometry(state) {
  const { view, mission, members, peaks } = state;
  let bridge = buildViews.get(view);
  const cacheable = peaks || !state.peakOf;
  if (cacheable && bridge?.mission === mission && bridge.members === members && bridge.peaks === peaks) return bridge;
  const points = new Map(), lines = [];
  for (const m of members) {
    const ax = view.sx(m.a[0] * CELL), ay = view.sy(m.a[1] * CELL);
    const bx = view.sx(m.b[0] * CELL), by = view.sy(m.b[1] * CELL);
    const peak = state.peakOf?.(m);
    lines.push({ ax, ay, bx, by, mat: m.mat, member: m, overlay: peak != null ? stressColor(peak) : null });
    points.set(`${m.a}`, [ax, ay]);
    points.set(`${m.b}`, [bx, by]);
  }
  // Include fasteners, beam widths and offset shadows around the end points.
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (x, y) => {
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  };
  for (const [x, y] of points.values()) include(x, y);
  for (const [gx, gy] of mission.anchors) include(view.sx(gx * CELL), view.sy(gy * CELL));
  const pad = Math.max(14, view.scale);
  const bounds = { left: left - pad, right: right + pad, top: top - pad, bottom: bottom + pad };
  bridge = { mission, members, peaks, lines, joints: Array.from(points.values()), bounds };
  buildViews.set(view, bridge);
  return bridge;
}

const testBridges = new WeakMap();
function testGeometry(view, sim) {
  let bridge = testBridges.get(sim);
  if (!bridge) {
    bridge = { lines: [], joints: [], projected: [], seen: new Uint8Array(0) };
    testBridges.set(sim, bridge);
  }
  const { nodes, beams } = sim;
  const { projected, lines, joints } = bridge;
  if (bridge.seen.length < nodes.length) bridge.seen = new Uint8Array(nodes.length);
  else bridge.seen.fill(0);
  for (let i = 0; i < nodes.length; i++) {
    const p = projected[i] ??= [0, 0];
    p[0] = view.sx(nodes[i].x);
    p[1] = view.sy(nodes[i].y);
  }
  let count = 0;
  joints.length = 0;
  for (const b of beams) {
    if (b.broken) continue;
    const a = projected[b.a], end = projected[b.b];
    const line = lines[count++] ??= {};
    line.ax = a[0]; line.ay = a[1]; line.bx = end[0]; line.by = end[1];
    line.mat = b.mat;
    // Snapped pieces retain the paint of their original material.
    line.stress = b.piece ? null : stressColor(b.usage);
    if (!nodes[b.a].fixed && !bridge.seen[b.a]) { bridge.seen[b.a] = 1; joints.push(a); }
    if (!nodes[b.b].fixed && !b.piece && !bridge.seen[b.b]) { bridge.seen[b.b] = 1; joints.push(end); }
  }
  lines.length = count;
  return bridge;
}

function paintBridge(ctx, view, mission, bridge, reflection, hot, minY = -Infinity) {
  if (!reflection) shadows(ctx, view, bridge.lines);
  for (const l of bridge.lines) {
    if (l.ay < minY && l.by < minY) continue;
    const overlay = l.overlay || (hot && hot === l.member ? 'rgba(255, 255, 255, 0.6)' : null);
    beam(ctx, view, l.ax, l.ay, l.bx, l.by, l.mat, l.stress, overlay);
  }
  joints(ctx, view, bridge.joints, minY);
  if (!reflection) anchors(ctx, view, mission);
}

// Paint the editor's stationary material strokes at their final device
// resolution. The river needs its own layer: translucent strokes overlap
// differently from an opaque bridge faded after composition.
function paintBuildLayer(ctx, view, mission, bridge, reflection, hot) {
  const { a, b, c, d, e, f } = ctx.getTransform();
  if (b || c || a <= 0) {
    paintBridge(ctx, view, mission, bridge, reflection, hot);
    return;
  }
  const key = reflection ? 'reflection' : 'foreground';
  const alpha = ctx.globalAlpha, width = ctx.canvas.width, height = ctx.canvas.height;
  let layer = bridge[key];
  if (!layer || layer.hot !== hot || layer.a !== a || layer.d !== d || layer.e !== e || layer.f !== f ||
      layer.width !== width || layer.height !== height || layer.alpha !== alpha) {
    const box = bridge.bounds;
    const x = Math.max(0, Math.floor(a * box.left + e));
    const y = Math.max(0, Math.floor(d * (d < 0 ? box.bottom : box.top) + f));
    const w = Math.min(width, Math.ceil(a * box.right + e)) - x;
    const h = Math.min(height, Math.ceil(d * (d < 0 ? box.top : box.bottom) + f)) - y;
    const canvas = layer?.canvas || document.createElement('canvas');
    layer = { a, d, e, f, hot, alpha, width, height, x, y, canvas };
    bridge[key] = layer;
    if (w > 0 && h > 0) {
      const paint = canvas.getContext('2d');
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      else { paint.resetTransform(); paint.clearRect(0, 0, w, h); }
      paint.setTransform(a, 0, 0, d, e - x, f - y);
      paint.globalAlpha = alpha;
      paint.lineCap = 'round';
      paintBridge(paint, view, mission, bridge, reflection, hot);
    } else layer.canvas = null;
  }
  if (layer.canvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(layer.canvas, layer.x, layer.y);
    ctx.restore();
  }
  if (!reflection) ctx.lineCap = 'round';
}

export function draw(ctx, labelCtx, state) {
  const { mission, view, time, theme } = state;
  labelCtx.clearRect(0, 0, view.width, view.height);
  drawBackdrop(ctx, view, state.scenery, theme, time);
  drawAmbient(ctx, view, state.scenery, theme, time);
  drawGround(ctx, view, mission, state.scenery, theme, time);
  if (state.celebration && !state.reducedMotion) drawVictoryLight(ctx, view, mission, state.celebration);
  if (state.mode === 'build') {
    if (mission.clearance) clearanceMarker(ctx, view, mission.clearance, theme);
    grid(ctx, view, mission, state.focus, theme);
  }

  const building = state.mode === 'build';
  const bridge = building ? buildGeometry(state) : state.sim ? testGeometry(view, state.sim) : { lines: [], joints: [] };
  const car = !building && state.sim ? state.sim.car : state.parked;
  const structure = (reflection) => {
    drawVehicle(ctx, view, car);
    const hot = reflection ? null : state.hover?.member;
    if (building) paintBuildLayer(ctx, view, mission, bridge, reflection, hot);
    else {
      // A high truss often reflects entirely below the viewport. Allow for
      // stroke widths and joint caps on pieces that cross the last pixel.
      const transform = reflection && ctx.getTransform();
      const minY = transform && transform.d < 0 && !transform.b
        ? (ctx.canvas.height - transform.f) / transform.d - Math.max(10, view.scale * 0.5) : -Infinity;
      paintBridge(ctx, view, mission, bridge, reflection, hot, minY);
      if (state.celebration) drawVictoryGlow(ctx, view, mission, state.sim, state.celebration, state.reducedMotion);
    }
  };
  structure(false);
  drawWater(ctx, view, mission, state.scenery, theme, time, () => structure(true));

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
      for (const m of shown) beam(ctx, view, view.sx(m.a[0] * CELL), view.sy(m.a[1] * CELL), view.sx(m.b[0] * CELL), view.sy(m.b[1] * CELL), m.mat, ok ? null : '#ff5a4a');
      ctx.globalAlpha = 1;
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]) * CELL;
      const cost = ok ? state.drag.cost : Math.round(length * MATERIALS[mat].cost);
      label(labelCtx, view, bx, by - 8, `${length.toFixed(1)} m · $${cost}`, ok ? '#fff' : '#ff9b8f');
    }
  }

  // Paint sockets over the moving beam so the selected connection remains visible.
  const targets = state.drag?.targets || state.hover?.targets || [];
  for (const p of targets) {
    const x = view.sx(p[0] * CELL), y = view.sy(p[1] * CELL);
    const selected = state.drag?.to === p;
    const r = Math.max(3.4, view.scale * 0.15) + (selected ? 1.8 : 0);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = selected ? '#fff' : '#ffd469';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (selected) {
      ctx.strokeStyle = '#ffd469';
      ctx.beginPath();
      ctx.arc(x, y, r + 2.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawWeather(ctx, view, theme, time);
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
    ctx.fillStyle = p.color;
    const r = Math.max(1.5, p.size * view.scale);
    if (p.square) ctx.fillRect(view.sx(p.x) - r, view.sy(p.y) - r, r * 2, r * 1.2);
    else { ctx.beginPath(); ctx.arc(view.sx(p.x), view.sy(p.y), r, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;

  if (state.celebration && !state.reducedMotion) drawConfetti(ctx, view, state.celebration);
  if (state.hover?.label) label(labelCtx, view, state.hover.px, state.hover.py - 6, state.hover.label, state.hover.color);
}
