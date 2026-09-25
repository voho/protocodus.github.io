/* Tyran choreography: Galaga-style squadron flights, a breathing hive with
 * diving attackers, and a Tyrian-style script of waves for every sector.
 * This module decides where hostile craft want to be and what to launch next;
 * combat rules, damage and rewards stay in sim.js. */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const smooth = t => t * t * (3 - 2 * t);

// Flight paths are authored for a 1200-pixel arena around its center line and
// scaled to the actual width. 'L' and 'R' sit just beyond either screen edge.
// Entry paths end in the upper arena where ships peel off to their hive slot;
// exit paths leave the screen and are used by sweeping squadrons.
export const PATHS = Object.freeze({
  dropLoop: { exit: false, points: [[-90, -110], [-90, 120], [-50, 320], [70, 460], [220, 430], [262, 300], [180, 210], [60, 232]] },
  sideHook: { exit: false, points: [['L', 540], [-440, 525], [-240, 465], [-130, 360], [-178, 250], [-305, 228], [-338, 318], [-236, 360]] },
  topSpiral: { exit: false, points: [[330, -110], [330, 140], [196, 322], [-28, 330], [-84, 196], [36, 120], [150, 188], [92, 290]] },
  sideSweep: { exit: false, points: [['L', 290], [-340, 322], [-60, 420], [210, 392], [322, 270], [212, 170], [40, 202]] },
  zigzag: { exit: true, points: [[-460, -110], [380, 150], [-380, 340], [360, 520], [-120, 700], [40, 1070]] },
  uTurn: { exit: true, points: [[-420, -110], [-420, 320], [-350, 520], [-170, 610], [20, 560], [120, 400], [150, 180], [160, -150]] },
  cross: { exit: true, points: [['L', 110], [-240, 212], [220, 430], ['R', 600]] },
  arc: { exit: true, points: [['L', 430], [-320, 262], [0, 190], [320, 262], ['R', 430]] },
  plunge: { exit: true, points: [[-330, -110], [-262, 262], [-60, 620], [170, 1070]] },
  snake: { exit: true, points: [[-60, -110], [200, 140], [-200, 340], [200, 540], [-160, 740], [40, 1070]] },
  // Acrobatic challenge flights: a figure eight through the middle, and an orbit.
  figure: { exit: true, points: [['L', 200], [-220, 262], [0, 420], [150, 560], [0, 660], [-150, 560], [0, 420], [220, 262], ['R', 200]] },
  orbit: { exit: true, points: [['L', 330], [-240, 330], [-130, 250], [0, 222], [130, 250], [180, 360], [130, 470], [0, 500], [-130, 470], [-180, 360], [-130, 250], [0, 222], [240, 160], ['R', 90]] },
});
const HIVE_PATHS = ['dropLoop', 'sideHook', 'topSpiral', 'sideSweep'];
const SWEEP_PATHS = ['zigzag', 'cross', 'arc', 'snake', 'uTurn'];
const CHALLENGE_PATHS = ['figure', 'orbit', 'dropLoop', 'sideHook', 'topSpiral'];
export const WAVE_KINDS = Object.freeze(['hive', 'sweep', 'gunship', 'midboss', 'captor', 'formation']);
export const AI_MODES = Object.freeze(['drift', 'entry', 'join', 'hive', 'dive', 'station', 'retreat', 'leave', 'captor']);
export const CHALLENGE_SIZE = 40;
export const DIVE_LOOP = .7;

const tables = new Map();
function edgeX(x, width, scale) {
  if (x === 'L') return -(width / 2 + 95);
  if (x === 'R') return width / 2 + 95;
  return x * scale;
}

/** Arc-length table for a path at this arena width; cached per width. */
export function pathTable(name, width) {
  const key = `${name}:${Math.round(width)}`;
  let table = tables.get(key);
  if (table) return table;
  const def = PATHS[name];
  if (!def) return null;
  const scale = clamp((width - 140) / 1060, .38, 1.3);
  const points = def.points.map(([x, y]) => [edgeX(x, width, scale), y]);
  const xs = [points[0][0]], ys = [points[0][1]], ds = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let k = 1; k <= 20; k++) {
      const t = k / 20, t2 = t * t, t3 = t2 * t;
      const x = .5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3);
      const y = .5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3);
      ds.push(ds.at(-1) + Math.hypot(x - xs.at(-1), y - ys.at(-1))); xs.push(x); ys.push(y);
    }
  }
  table = { xs, ys, ds, length: ds.at(-1), exit: def.exit };
  if (tables.size > 96) tables.clear();
  tables.set(key, table);
  return table;
}

/** Position and unit tangent at a travelled distance along a path table. */
export function pathPoint(table, distance) {
  const { xs, ys, ds } = table, last = ds.length - 1;
  if (distance <= 0) return { x: xs[0], y: ys[0], tx: xs[1] - xs[0], ty: ys[1] - ys[0], done: false };
  if (distance >= ds[last]) {
    const tx = xs[last] - xs[last - 1], ty = ys[last] - ys[last - 1], length = Math.hypot(tx, ty) || 1;
    return { x: xs[last], y: ys[last], tx: tx / length, ty: ty / length, done: true };
  }
  let low = 0, high = last;
  while (high - low > 1) { const mid = (low + high) >> 1; if (ds[mid] <= distance) low = mid; else high = mid; }
  const span = ds[high] - ds[low] || 1, t = (distance - ds[low]) / span;
  const tx = xs[high] - xs[low], ty = ys[high] - ys[low], length = Math.hypot(tx, ty) || 1;
  return { x: xs[low] + tx * t, y: ys[low] + ty * t, tx: tx / length, ty: ty / length, done: false };
}

/** Ships waiting their turn in a conga line are held offscreen and inert. */
export const isDormant = enemy => enemy.ai === 'entry' && enemy.pathD < 0;

export function enemyPathPosition(s, enemy) {
  const table = pathTable(enemy.path, s.width);
  if (!table) return null;
  const point = pathPoint(table, enemy.pathD), mirror = enemy.mirror < 0 ? -1 : 1;
  return { x: s.width / 2 + point.x * mirror + (enemy.pathOx || 0), y: point.y + (enemy.pathOy || 0), tx: point.tx * mirror, ty: point.ty, done: point.done, exit: table.exit };
}

// Every sector opens and closes with a swarm; the middle of the script rotates
// so neighbouring sectors never fly the same order.
const SCRIPT_MIDDLES = [
  ['sweep', 'gunship', 'hive', 'midboss', 'sweep', 'captor'],
  ['gunship', 'sweep', 'hive', 'midboss', 'captor', 'sweep'],
  ['sweep', 'hive', 'gunship', 'midboss', 'sweep', 'captor'],
];
export function sectorPlan(level) {
  const plan = ['hive', ...SCRIPT_MIDDLES[level % SCRIPT_MIDDLES.length], 'hive'];
  if (level >= 3) plan.splice(plan.indexOf('midboss') + 1, 0, 'formation');
  if (level >= 6) plan.splice(plan.length - 1, 0, 'gunship');
  return plan;
}

export function createDirector(level) {
  return { plan: sectorPlan(level), wave: -1, kind: '', state: 'rest', clock: 0, rest: 2.6, timeout: 0, dive: 3, potshot: 4, pending: 0, pendingAt: 0, hold: false, done: false, abandon: false };
}

/** Fraction of the sector's scripted waves already flown, for the HUD. */
export function directorProgress(s) {
  const d = s.director;
  if (!d || s.bossSpawned) return 1;
  const total = Math.max(1, d.plan.length), current = Math.max(0, d.wave);
  const partial = d.state === 'wave' ? clamp(d.clock / Math.max(12, d.timeout * .6), 0, .92) : d.wave >= 0 ? 1 : 0;
  return clamp((current + partial) / total, 0, 1);
}

// ——— Hive formation ———
export function hiveCenter(s) {
  const age = s.hive?.age || 0;
  return { x: s.width / 2 + Math.sin(age * .42) * Math.min(58, s.width * .04), y: 176 };
}

export function hiveSlot(s, enemy) {
  const age = s.hive?.age || 0, center = hiveCenter(s);
  const columns = Math.max(1, enemy.slotCount || 1), col = enemy.slotCol || 0, row = enemy.slotRow || 0;
  const spacing = Math.min(62, (s.width - 180) / 8.5);
  // The hive breathes like a living swarm; outer ships travel furthest.
  const breath = 1 + .085 * (1 - Math.cos(age * 1.55)) / 2;
  return { x: center.x + (col - (columns - 1) / 2) * spacing * breath, y: center.y + row * 55 + (breath - 1) * row * 40 };
}

// ——— Dives ———
function diveTiming(s, enemy) {
  const span = s.height + 140 - enemy.diveY0;
  return { span, duration: span / Math.max(120, enemy.diveSpeed || 280) };
}

function diveGoal(s, enemy, t) {
  const r = 40 + enemy.radius * .5, side = enemy.diveSide || 1;
  if (t < DIVE_LOOP) {
    const a = Math.PI * t / DIVE_LOOP;
    return { x: enemy.diveX0 + side * r * (1 - Math.cos(a)), y: enemy.diveY0 - r * 1.15 * Math.sin(a) };
  }
  const { span, duration } = diveTiming(s, enemy), u = (t - DIVE_LOOP) / duration;
  const startX = enemy.diveX0 + side * r * 2, ease = u < .6 ? smooth(u / .6) : 1;
  const weave = Math.sin(u * Math.PI * 2.4) * (enemy.diveWeave || 0) * (1 - ease * .45);
  return { x: startX + (enemy.diveTx - startX) * ease + weave, y: enemy.diveY0 + span * (u * .55 + u * u * .45) };
}

export function startDive(s, enemy, target, speedScale = 1) {
  const center = s.width / 2, r = 40 + enemy.radius * .5;
  let side = enemy.x < center ? -1 : 1;
  if (enemy.x + side * r * 2.4 < 40 || enemy.x + side * r * 2.4 > s.width - 40) side = -side;
  Object.assign(enemy, {
    ai: 'dive', diveT: 0, diveX0: enemy.x, diveY0: enemy.y, diveSide: side, diveFired: 0,
    diveTx: clamp(target?.x ?? center, 50, s.width - 50), diveSpeed: (250 + s.level * 11) * speedScale,
    diveWeave: enemy.type === 0 ? 0 : 55 + enemy.type * 8, diveHome: enemy.type === 0 ? 1 : 0,
  });
  s.events.push({ type: 'dive', x: enemy.x, y: enemy.y, shipType: enemy.type });
}

// ——— Per-ship movement goals ———
/** Returns where a scripted ship wants to be. `track` goals are followed with a
 * feed-forward velocity; `velocity` goals steer straight to that velocity. */
export function enemyGoal(s, enemy, dt, pilot) {
  const H = s.height;
  switch (enemy.ai) {
    case 'entry': {
      enemy.pathD += enemy.pathSpeed * dt;
      const point = enemyPathPosition(s, enemy);
      if (!point) { enemy.ai = 'leave'; break; }
      if (point.done) {
        if (!point.exit && enemy.slotCount) { enemy.ai = 'join'; return enemyGoal(s, enemy, 0, pilot); }
        enemy.ai = 'leave'; enemy.leaveDx = point.tx; enemy.leaveDy = point.ty;
        return { velocity: true, vx: point.tx * enemy.pathSpeed, vy: point.ty * enemy.pathSpeed, response: .05 };
      }
      return { x: point.x, y: point.y, vx: point.tx * enemy.pathSpeed, vy: point.ty * enemy.pathSpeed, tau: .08, response: .045, max: enemy.pathSpeed * 1.8 };
    }
    case 'join': {
      const slot = hiveSlot(s, enemy), distance = Math.hypot(slot.x - enemy.x, slot.y - enemy.y);
      if (distance < 7 && Math.hypot(enemy.vx, enemy.vy) < 90) enemy.ai = 'hive';
      return { x: slot.x, y: slot.y, vx: 0, vy: 0, tau: .24, response: .08, max: 460 };
    }
    case 'hive': {
      const slot = hiveSlot(s, enemy);
      return { x: slot.x, y: slot.y, vx: 0, vy: 0, tau: .12, response: .06, max: 260 };
    }
    case 'dive': {
      enemy.diveT += dt;
      if (enemy.diveHome && pilot?.alive && enemy.diveT > DIVE_LOOP && enemy.y < pilot.y - 60) {
        enemy.diveTx += (pilot.x - enemy.diveTx) * Math.min(1, dt * 2.2);
      }
      const { duration } = diveTiming(s, enemy);
      if (enemy.y > H + 70 || enemy.diveT > DIVE_LOOP + duration + .4) {
        if (!enemy.slotCount || enemy.returnToHive === false) { enemy.gone = true; return null; }
        // Wrap unseen to the top and return to the swarm, as in the arcade.
        const slot = hiveSlot(s, enemy);
        enemy.x = enemy.px = slot.x; enemy.y = enemy.py = -70 - enemy.radius;
        enemy.vx = 0; enemy.vy = 180; enemy.blastVx = enemy.blastVy = 0;
        enemy.ai = 'join';
        return enemyGoal(s, enemy, 0, pilot);
      }
      const now = diveGoal(s, enemy, enemy.diveT), next = diveGoal(s, enemy, enemy.diveT + .03);
      return { x: now.x, y: now.y, vx: (next.x - now.x) / .03, vy: (next.y - now.y) / .03, tau: .07, response: .045, max: 1100 };
    }
    case 'station': {
      enemy.hold = (enemy.hold ?? 10) - dt;
      if (enemy.hold <= 0) { enemy.ai = 'retreat'; return enemyGoal(s, enemy, 0, pilot); }
      const x = clamp(enemy.stationX + Math.sin(enemy.age * .55 + (enemy.seed || 0)) * (enemy.sway || 0), enemy.radius + 20, s.width - enemy.radius - 20);
      return { x, y: enemy.stationY + Math.sin(enemy.age * .9) * 10, vx: 0, vy: 0, tau: .5, response: .07 + Math.sqrt(enemy.mass) * .09, max: Math.max(90, enemy.speed * 2.4) };
    }
    case 'captor': return captorGoal(s, enemy, dt, pilot);
    case 'retreat': return { velocity: true, vx: enemy.vx * .4, vy: -Math.max(150, enemy.speed * 3), response: .35 };
    case 'leave': {
      const speed = Math.max(240, enemy.pathSpeed || enemy.speed * 3);
      const dx = enemy.leaveDx ?? 0, dy = enemy.leaveDy ?? 1, length = Math.hypot(dx, dy) || 1;
      return { velocity: true, vx: dx / length * speed, vy: dy / length * speed, response: .12 };
    }
  }
  return null;
}

// Captor: hovers above the pilot, then projects a tractor cone. The cone steals
// one wing drone; destroying the captor while it holds the drone rescues it.
export const CAPTOR_Y = 226;
export const CAPTOR_CHARGE = .6, CAPTOR_BEAM = 2.5;
function captorGoal(s, enemy, dt, pilot) {
  enemy.capTimer = (enemy.capTimer ?? 2) - dt;
  const trackX = pilot?.alive ? pilot.x : s.width / 2;
  if (enemy.capState === 0) {
    enemy.capX += (clamp(trackX, 80, s.width - 80) - enemy.capX) * Math.min(1, dt * 1.1);
    if (enemy.capTimer <= 0 && enemy.y > CAPTOR_Y - 30) {
      if ((enemy.capBeams || 0) >= 3) { enemy.ai = 'retreat'; return enemyGoal(s, enemy, 0, pilot); }
      enemy.capState = 1; enemy.capTimer = CAPTOR_CHARGE;
      s.events.push({ type: 'tractor-charge', x: enemy.x, y: enemy.y });
    }
  } else if (enemy.capState === 1 && enemy.capTimer <= 0) {
    enemy.capState = 2; enemy.capTimer = CAPTOR_BEAM; enemy.capBeams = (enemy.capBeams || 0) + 1; enemy.capGrip = 0;
    s.events.push({ type: 'tractor', x: enemy.x, y: enemy.y });
  } else if (enemy.capState === 2 && enemy.capTimer <= 0) {
    enemy.capState = 0; enemy.capTimer = 3.2;
  } else if (enemy.capState === 3) {
    // Holding a captured drone: keep station high and parade the prize.
    if (enemy.capTimer <= 0) { enemy.ai = 'retreat'; return enemyGoal(s, enemy, 0, pilot); }
    return { x: s.width / 2 + Math.sin(enemy.age * .5) * Math.min(300, s.width * .28), y: 150, vx: 0, vy: 0, tau: .6, response: .07 + Math.sqrt(enemy.mass) * .09, max: 170 };
  }
  return { x: enemy.capX, y: CAPTOR_Y + (enemy.capState ? 0 : Math.sin(enemy.age * 1.3) * 8), vx: 0, vy: 0, tau: .45, response: .07 + Math.sqrt(enemy.mass) * .09, max: 210 };
}

/** Tractor cone half-width at a point below the captor, or 0 outside it. */
export function tractorReach(enemy, x, y) {
  const apexY = enemy.y + enemy.radius * .55, depth = y - apexY;
  if (depth <= 0 || enemy.ai !== 'captor' || enemy.capState !== 2) return 0;
  const half = 26 + depth * .3;
  return Math.abs(x - enemy.x) < half ? half : 0;
}

// ——— Wave construction ———
function newSquad(s, size, wave, options = {}) {
  const squad = { id: s.nextSquadId++, size, killed: 0, broken: false, wave, ...options };
  s.squadrons.push(squad);
  return squad;
}

function launchLine(s, spawn, { type, count, path, mirror = 1, delay = 0, spacing = .17, speed, wave, squad, slotRow = null, slotCols = null, slotCount = 0, ox = 0, oy = 0, flags = {} }) {
  const ships = [];
  for (let i = 0; i < count; i++) {
    const enemy = spawn(s, type, s.width / 2, -200);
    Object.assign(enemy, { ai: 'entry', path, pathD: -(delay + i * spacing) * speed, pathSpeed: speed, mirror, pathOx: ox, pathOy: oy,
      wave, squad: squad?.id ?? 0, vx: 0, vy: 0, ...flags });
    if (slotRow != null) Object.assign(enemy, { slotRow, slotCol: slotCols[i], slotCount });
    const start = enemyPathPosition(s, enemy);
    enemy.x = enemy.px = start.x; enemy.y = enemy.py = start.y;
    ships.push(enemy);
  }
  return ships;
}

function hiveRows(level, compact = false) {
  if (compact) return [[1, 4], [1, 4]];
  const rows = level >= 3 ? [[3, 4], [2, 8], [1, 8], [0, 8]] : [[3, 4], [2, 6], [1, 6], [0, 6]];
  return level >= 1 ? rows : rows.slice(0, 3).map(([type, count], index) => [index === 2 ? 0 : type, count]);
}

function buildHive(s, spawn, wave, compact = false) {
  const rows = hiveRows(s.level, compact), speed = 330 + s.level * 9;
  // A captor's escorts sit lower so the captor and its prize stay in the clear.
  const offset = compact ? 2 : 0;
  rows.forEach(([type, count], row) => {
    const path = HIVE_PATHS[(row + wave + s.level) % HIVE_PATHS.length];
    const squad = newSquad(s, count, wave);
    const delay = .6 + row * 2.5, columns = Array.from({ length: count }, (_, i) => i);
    // Wider rows arrive as two mirrored lines, the centre ships first.
    if (count >= 6) {
      const half = count / 2, left = columns.slice(0, half).reverse(), right = columns.slice(half);
      launchLine(s, spawn, { type, count: half, path, mirror: -1, delay, speed, wave, squad, slotRow: row + offset, slotCols: left, slotCount: count });
      launchLine(s, spawn, { type, count: half, path, mirror: 1, delay, speed, wave, squad, slotRow: row + offset, slotCols: right, slotCount: count });
    } else {
      const mirror = row % 2 ? -1 : 1, order = mirror < 0 ? columns.slice().reverse() : columns;
      launchLine(s, spawn, { type, count, path, mirror, delay, speed, wave, squad, slotRow: row + offset, slotCols: order, slotCount: count });
    }
  });
  return 30 + s.level * .8 + rows.length * 1.5;
}

function buildSweep(s, spawn, wave, second = false) {
  const squads = 3 + (s.level >= 4 ? 1 : 0), size = s.level >= 6 ? 6 : 5, speed = 285 + s.level * 8;
  const types = second ? [3, 7, 2, 7] : [1, 7, 2, 3];
  for (let k = 0; k < squads; k++) {
    const type = types[k % types.length], reaper = type === 7;
    const path = reaper ? 'plunge' : SWEEP_PATHS[(k + wave + s.level) % SWEEP_PATHS.length];
    const count = reaper ? 3 : size;
    const squad = newSquad(s, count, wave);
    launchLine(s, spawn, { type, count, path, mirror: k % 2 ? -1 : 1, delay: .5 + k * 2.8, spacing: reaper ? .3 : .2,
      speed: reaper ? speed * 1.45 : speed, wave, squad, ox: reaper ? (k % 2 ? -1 : 1) * s.width * .06 : 0 });
  }
  return 20 + squads * 1.5;
}

function stationShip(s, spawn, type, x, y, wave, options = {}) {
  const enemy = spawn(s, type, x, -80 - ENEMY_SIZE(type));
  Object.assign(enemy, { ai: 'station', stationX: x, stationY: y, hold: 11 + s.level * .35, sway: 42, wave, vx: 0, vy: 90, ...options });
  return enemy;
}
const ENEMY_SIZE = type => [12, 17, 22, 27, 32, 36, 41, 46, 54, 110][type] || 30;

function buildGunship(s, spawn, wave, second = false) {
  const span = Math.min(s.width - 200, 1000), center = s.width / 2;
  const heavies = second ? [5, 4, 5] : [4, 5, 4];
  const count = s.level >= 5 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const x = count === 2 ? center + (i ? 1 : -1) * span * .26 : center + (i - 1) * span * .34;
    const heavy = stationShip(s, spawn, heavies[i], x, 216 + (i % 2) * 46, wave, { seed: i * 2.1 });
    heavy.hp *= 1.6; heavy.maxHp = heavy.hp;
  }
  const squad = newSquad(s, 5, wave);
  launchLine(s, spawn, { type: 0, count: 5, path: 'arc', mirror: wave % 2 ? -1 : 1, delay: 3.4, spacing: .18, speed: 330 + s.level * 8, wave, squad });
  return 24 + s.level * .4;
}

function buildMidboss(s, spawn, wave) {
  const boss = stationShip(s, spawn, 8, s.width / 2, 230, wave, { hold: 40, sway: Math.min(210, s.width * .18), role: 'midboss' });
  boss.hp *= 4; boss.maxHp = boss.hp;
  for (let k = 0; k < 2; k++) {
    const squad = newSquad(s, 4, wave);
    launchLine(s, spawn, { type: 2, count: 4, path: 'cross', mirror: k ? -1 : 1, delay: 4 + k * 9, spacing: .22, speed: 300 + s.level * 8, wave, squad });
  }
  s.events.push({ type: 'midboss', x: boss.x, y: 120 });
  return 44;
}

function buildCaptor(s, spawn, wave) {
  const captor = spawn(s, 6, s.width / 2, -120);
  Object.assign(captor, { ai: 'captor', wave, capState: 0, capTimer: 3.4, capBeams: 0, capX: s.width / 2, captive: 0, capGrip: 0, vx: 0, vy: 120, role: 'captor' });
  buildHive(s, spawn, wave, true);
  s.events.push({ type: 'captor', x: captor.x, y: 120 });
  return 40;
}

/** Scripted sector: waves in order, rests between them, then the guardian. */
export function updateDirector(s, dt, spawn, spawnFormation, pilot) {
  const d = s.director;
  if (!d || d.hold || d.done || s.bossSpawned) return false;
  s.hive = s.hive || { age: 0 };
  s.hive.age += dt;
  d.clock += dt;
  if (d.state === 'rest') {
    if (d.clock < d.rest) return false;
    if (d.wave + 1 >= d.plan.length) { d.done = true; return true; }
    d.wave++; d.kind = d.plan[d.wave]; d.state = 'wave'; d.clock = 0; d.abandon = false; d.dive = 3.2 - Math.min(1.2, s.level * .1); d.potshot = 3;
    const count = d.plan.slice(0, d.wave + 1).filter(kind => kind === d.kind).length;
    d.timeout = d.kind === 'hive' ? buildHive(s, spawn, d.wave)
      : d.kind === 'sweep' ? buildSweep(s, spawn, d.wave, count > 1)
      : d.kind === 'gunship' ? buildGunship(s, spawn, d.wave, count > 1)
      : d.kind === 'midboss' ? buildMidboss(s, spawn, d.wave)
      : d.kind === 'captor' ? buildCaptor(s, spawn, d.wave)
      : (spawnFormation(s, null, d.wave), d.pending = 1, d.pendingAt = 6.5, 28);
    s.events.push({ type: 'wave', wave: d.wave + 1, total: d.plan.length, kind: d.kind });
    return false;
  }
  if (d.pending > 0 && d.clock >= d.pendingAt) { d.pending--; spawnFormation(s, null, d.wave); }
  let live = 0, hive = 0, diving = 0;
  for (const enemy of s.enemies) {
    if (enemy.dead || enemy.wave !== d.wave || enemy.challenge) continue;
    if (enemy.ai === 'leave' || enemy.ai === 'retreat') continue;
    live++;
    if (enemy.ai === 'hive') hive++;
    if (enemy.ai === 'dive') diving++;
  }
  if (!live && !d.pending) { d.state = 'rest'; d.clock = 0; d.rest = 1.5; s.events.push({ type: 'wave-clear', wave: d.wave + 1 }); return false; }
  if (!d.abandon && d.clock > d.timeout) {
    // The swarm abandons the attack: queued ships stay home, gunships withdraw.
    d.abandon = true; d.pending = 0;
    for (const enemy of s.enemies) {
      if (enemy.dead || enemy.wave !== d.wave || enemy.challenge) continue;
      if (isDormant(enemy)) enemy.gone = true;
      else if (enemy.ai === 'station' || enemy.ai === 'captor') enemy.ai = 'retreat';
    }
  }
  if (d.abandon) {
    // Late arrivals and the remaining swarm make one last pass and leave.
    for (const enemy of s.enemies) {
      if (enemy.dead || enemy.wave !== d.wave || enemy.challenge) continue;
      if (enemy.ai === 'hive' || enemy.ai === 'join') startDive(s, enemy, pilot);
      if (enemy.ai === 'dive') enemy.returnToHive = false;
    }
    return false;
  }
  if (hive > 0 && d.clock > 1.2) {
    // Galaga pacing: dives grow more frequent as the swarm thins.
    const members = s.enemies.filter(enemy => !enemy.dead && enemy.wave === d.wave && enemy.ai === 'hive');
    const entering = s.enemies.some(enemy => !enemy.dead && enemy.wave === d.wave && enemy.ai === 'entry' && enemy.slotCount && !isDormant(enemy));
    d.dive -= dt * (entering ? .45 : 1);
    const maxDivers = 2 + Math.floor(s.level / 3) + (members.length <= 6 ? 1 : 0);
    if (d.dive <= 0 && diving < maxDivers && pilot?.alive) {
      const lead = members[Math.floor(Math.random() * members.length)];
      startDive(s, lead, pilot);
      // Commanders take escorts from the row beneath them.
      if (lead.type === 3 || lead.slotRow === 0) {
        const escorts = members.filter(enemy => enemy !== lead && enemy.slotRow === lead.slotRow + 1 && Math.abs(hiveSlot(s, enemy).x - lead.x) < 110).slice(0, 2);
        for (const escort of escorts) { startDive(s, escort, pilot); escort.diveSide = lead.diveSide; escort.diveTx = lead.diveTx + (escort.x - lead.x) * .6; }
      }
      d.dive = Math.max(.6, 2.15 - s.level * .13) * (members.length > 8 ? 1 : .68) * (.8 + Math.random() * .4);
    }
    d.potshot -= dt;
    if (d.potshot <= 0 && members.length) {
      const bottom = Math.max(...members.map(enemy => enemy.slotRow || 0));
      const shooters = members.filter(enemy => enemy.slotRow === bottom);
      const shooter = shooters[Math.floor(Math.random() * shooters.length)];
      if (shooter) shooter.potshot = 1;
      d.potshot = Math.max(.9, 2.4 - s.level * .16);
    }
  }
  return false;
}

// ——— Challenge stage ———
export function startChallenge(s, spawn) {
  s.challenge = { clock: 0, total: CHALLENGE_SIZE, hits: 0, done: false, result: 0 };
  const speed = 420 + s.level * 6;
  for (let k = 0; k < 5; k++) {
    const squad = newSquad(s, 8, -1, { challenge: true });
    const path = CHALLENGE_PATHS[(k + s.level) % CHALLENGE_PATHS.length];
    const lines = PATHS[path].exit ? [[1, 8]] : [[-1, 4], [1, 4]];
    for (const [mirror, count] of lines) {
      const ships = launchLine(s, spawn, { type: (k + s.level) % 4, count, path, mirror: k % 2 && lines.length === 1 ? -1 : mirror, delay: 1.2 + k * 3.6,
        spacing: .15, speed, wave: -1, squad, flags: { challenge: true, harmless: true, noFire: true } });
      for (const enemy of ships) { enemy.hp = enemy.maxHp = 8 + s.level * 2; }
    }
  }
  s.events.push({ type: 'challenge', total: CHALLENGE_SIZE });
}

/** Returns true once the challenge is resolved and its result was paid. */
export function updateChallenge(s, dt) {
  const c = s.challenge;
  if (!c || c.done) return !!c?.done;
  c.clock += dt;
  // Entry paths finish by peeling off the top of the screen instead of joining a hive.
  const remaining = s.enemies.some(enemy => enemy.challenge && !enemy.dead && !enemy.gone);
  if ((!remaining && c.clock > 2) || c.clock > 36) {
    for (const enemy of s.enemies) if (enemy.challenge) enemy.gone = true;
    const perfect = c.hits >= c.total;
    const credits = c.hits * 9 + (perfect ? 450 : 0), score = c.hits * 150 * (1 + s.level * .1) + (perfect ? 10000 : 0);
    s.credits += Math.round(credits); s.score += Math.round(score);
    c.done = true; c.result = s.time; c.credits = Math.round(credits);
    s.events.push({ type: 'challenge-result', hits: c.hits, total: c.total, perfect, credits: Math.round(credits), score: Math.round(score) });
  }
  return false;
}

