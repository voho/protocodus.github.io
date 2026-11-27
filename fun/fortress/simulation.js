import Matter from './vendor/matter.min.js';
import { createGuardDefense, splitShot } from './guard-fire.js';
import { addGuardRig, balanceGuards, removeGuardRig, wakeGuardRig } from './guard-rig.js';

const { Bodies, Body, Composite, Engine, Events, Sleeping, Vertices } = Matter;

export const WORLD = { width: 1200, height: 480, ground: 389, release: { x: 160, y: 326 } };
const terrainStart = { x: -1000, y: WORLD.ground };
const terrainEnd = { x: 2200, y: WORLD.ground };

export const AMMO = [
  { id: 'small-stone', name: 'Small stone', cost: 10, radius: 9, density: 0.012, reload: 0.15 },
  { id: 'big-stone', name: 'Big stone', cost: 22, radius: 15, density: 0.013, reload: 0.375 },
  { id: 'small-bomb', name: 'Small bomb', cost: 35, radius: 10, density: 0.009, blast: 103, reload: 0.6 },
  { id: 'big-bomb', name: 'Big bomb', cost: 60, radius: 15, density: 0.012, blast: 158, reload: 0.925 },
  { id: 'fireball', name: 'Fireball', cost: 45, radius: 11, density: 0.0027, flameRadius: 112, reload: 0.7 },
  {
    id: 'siege-bomb',
    name: 'Siege bomb',
    cost: 90,
    radius: 19,
    density: 0.012,
    launchScale: 0.74,
    blast: 205,
    reload: 1.3,
    remote: true,
  },
  { id: 'magic-bomb', name: 'Magic bomb', cost: 75, radius: 13, density: 0.006, implosionRadius: 168, reload: 1.05 },
];

export const DIFFICULTIES = [
  { id: 'small', name: 'Small' },
  { id: 'medium', name: 'Medium' },
  { id: 'large', name: 'Large' },
];

export const THEMES = [
  { id: 'bramblewatch', name: 'Bramblewatch Outpost' },
  { id: 'moonfen', name: 'Moonfen Crossing' },
  { id: 'cinderstone', name: 'Cinderstone Hold' },
  { id: 'frostpeak', name: 'Frostpeak Bastion' },
  { id: 'crownfall', name: 'Crownfall Citadel' },
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    let n = state ^ (state >>> 16);
    n = Math.imul(n, 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
}

function newSeed() {
  return globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] || (Math.random() * 4294967296) >>> 0 || 1;
}

// A smoothstep shoulder is horizontal where it meets either building pad.
// Its maximum analytical grade is 1.5 * .4 = .6 (about 31 degrees).
function terrainShoulder(points, start, end, targetY) {
  const last = points.at(-1),
    run = end - start;
  const rise = clamp(targetY - last.y, -0.4 * run, 0.4 * run);
  if (start > last.x) points.push({ x: start, y: last.y });
  const segments = Math.abs(rise) < 1 ? 1 : 5;
  for (let n = 1; n <= segments; n++) {
    const t = n / segments;
    points.push({ x: start + run * t, y: last.y + rise * t * t * (3 - 2 * t) });
  }
  return last.y + rise;
}

export function generateLevel(difficulty, seed) {
  const small = difficulty === 'small',
    large = difficulty === 'large';
  const index = small ? 0 : large ? 4 : 2;
  const themeIndex = Math.floor(seededRandom(seed ^ 0x51e651ad)() * THEMES.length);
  const weather = seededRandom(seed ^ 0xa45912f1);
  const wind = (weather() < 0.5 ? -1 : 1) * (8 + Math.floor(weather() * 17));
  const random = seededRandom(seed ^ Math.imul(index + 1, 0x85ebca6b));
  const integer = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const count = small ? 2 : large ? 5 : 3;
  const first = (small ? 649 : large ? 380 : 537) + integer(-12, 12);
  const last = (small ? 978 : large ? 1066 : 1034) + integer(-13, 13);
  const centers = Array.from(
    { length: count },
    (_, i) => Math.round(first + ((last - first) * i) / (count - 1)) +
      (i && i < count - 1 ? (large ? integer(-6, 6) : integer(-14, 14)) : 0),
  );
  const sections = [],
    walls = [],
    terrain = [{ x: 0, y: WORLD.ground }];
  let previousRight = 0;
  for (const [i, center] of centers.entries()) {
    const keep = i === count - 1,
      front = i === 0;
    const spacing = Math.min(center - (centers[i - 1] ?? -1000), (centers[i + 1] ?? 2200) - center);
    const maxWidth = Math.min(spacing - (large ? 43 : 55), 2 * (1164 - center));
    const maxBays = Math.min(keep || large ? 3 : 2, Math.max(1, Math.floor(maxWidth / 53)));
    const bays =
      keep || !small ? integer(Math.min(2, maxBays), maxBays) : front && small ? 1 : integer(1, maxBays);
    const spans = Array.from({ length: bays }, () => integer(53, Math.min(73, Math.floor(maxWidth / bays))));
    const width = spans.reduce((sum, span) => sum + span, 0),
      left = center - Math.round(width / 2);
    const peak = large
      ? keep
        ? integer(5, 6)
        : integer(4, 5)
      : keep
        ? small
          ? 3
          : integer(3, 4)
        : small
          ? 2
          : integer(2, 3);
    const heights = Array.from({ length: bays }, () => integer(large ? 3 : 1, Math.max(1, peak - 1)));
    const tower = integer(0, bays - 1);
    heights[tower] = peak;
    if (bays === 3 && tower !== 1 && !small) heights[2 - tower] = integer(2, peak - 1);
    if (large && !front && bays > 1) heights[(tower + 1) % bays] = Math.max(3, heights[(tower + 1) % bays]);
    if (large) for (let bay = 0; bay < heights.length; bay++) heights[bay] *= 2;
    const storey = large ? integer(47, 51) : keep ? integer(49, 57) : integer(small ? 44 : 46, 54);
    const targetBase = Math.round(
      WORLD.ground - (front ? integer(0, 9) : ((16 + index * 12 + integer(0, 11)) * i) / (count - 1)),
    );
    let hillLeft = left - 19,
      wall;
    const gap = hillLeft - previousRight;
    if ((front || gap > (large ? 63 : 87)) && (front || large || random() < 0.78)) {
      const maxWall = large && front ? Math.min(68, hillLeft - 225) : 63;
      const width = integer(large && front ? Math.min(48, maxWall) : 32, Math.min(maxWall, Math.floor(gap * 0.55)));
      const wallLeft = hillLeft - width - integer(5, 11);
      wall = { left: wallLeft, width, rows: integer(large ? 3 : small ? 1 : 2, large ? 4 : small ? 2 : 3) };
      hillLeft = wallLeft - 3;
    }
    const hillRight = left + width + 19;
    const slopeStart = Math.max(front ? 210 : previousRight, hillLeft - integer(100, 158));
    const base = terrainShoulder(terrain, slopeStart, hillLeft, targetBase);
    terrain.push({ x: hillRight, y: base });
    if (wall) walls.push({ ...wall, base });
    previousRight = hillRight;

    const cells = [];
    for (let c = 0; c < bays; c++) {
      for (let row = 0; row <= heights[c]; row++) cells.push([c, row]);
    }
    // Scatter a garrison over different floors and always leave room for powder.
    for (let n = cells.length - 1; n > 0; n--) {
      const k = integer(0, n);
      [cells[n], cells[k]] = [cells[k], cells[n]];
    }
    const guards = Math.min(cells.length - 1, keep ? (index >= 3 ? 3 : 2) : index >= 2 && bays > 1 ? 2 : 1);
    // On advanced strongholds the two distant end garrisons have a sheltered
    // ground-floor guard. A blast over the central courtyard leaves defenders.
    const sentryBay = front ? 0 : bays - 1;
    const sentry = index >= 3 && (front || keep) ? cells.findIndex(([c, r]) => c === sentryBay && r === 0) : -1;
    const orcs = sentry >= 0 ? cells.splice(sentry, 1) : [];
    orcs.push(...cells.splice(0, guards - orcs.length));
    // Fortified keeps shelter powder inside lower galleries. Exposed powder
    // on neighboring rooftops would let one blast jump the entire hillside.
    const stores =
      index >= 3 ? cells.filter(([bay, floor]) => floor < heights[bay]).sort((a, b) => a[1] - b[1]) : cells;
    const barrels = stores.slice(0, index >= 2 && keep && bays > 1 ? 2 : 1);
    sections.push({
      left,
      center,
      base,
      spans,
      heights,
      storey,
      orcs,
      barrels,
      style: keep ? 'keep' : front ? 'watch' : 'gate',
      pattern: integer(0, 30000),
    });
  }
  terrainShoulder(terrain, previousRight, WORLD.width, WORLD.ground);
  const guards = sections.reduce((sum, section) => sum + section.orcs.length, 0);
  const rooms = sections.reduce((sum, s) => sum + s.heights.reduce((n, h) => n + h, 0), 0);
  const par = 5 * Math.round((count * 14 + guards * 9 + index * 2 + rooms * (large ? 2 : small ? 0 : 0.8)) / 5);
  const ward = sections[0],
    angle = large ? 24 : 38;
  const dx = ward.left - WORLD.release.x,
    dy = ward.base - ward.storey * 0.77 - WORLD.release.y;
  const aim = { angle, power: 25 };
  let closest = Infinity;
  for (let p = 25; p <= 100; p++) {
    const v = launchVelocity(angle, p, undefined, large),
      t = flightTime(dx, v.x, wind);
    const miss = Math.abs(v.y * t + 0.5 * GRAVITY * t * (t + STEP) - dy);
    if (miss < closest) {
      closest = miss;
      aim.power = p;
    }
  }
  const phase = ['day', 'dusk', 'night', 'dawn'][integer(0, 3)];
  return {
    name: THEMES[themeIndex].name,
    difficulty,
    themeIndex,
    seed,
    sections,
    walls,
    terrain,
    par,
    phase,
    wind,
    aim,
  };
}

const STEP = 1 / 120;
const TURF_ROLL = Math.exp(-2.4 * STEP);
const GRAVITY = 680;
const ROOF = 13;
const BRIDGE_LEDGE = 10;
const MIN_BREAKABLE_RUBBLE_AREA = 65;
const MAX_RUBBLE_GENERATION = 2;
const MATERIALS = {
  stone: { density: 0.0028, toughness: 10, bluntDamage: 0.7, friction: 0.76 },
  wood: { density: 0.0011, toughness: 6.2, bluntDamage: 0.86, friction: 0.83 },
  glass: { density: 0.0016, toughness: 2.8, bluntDamage: 1.22, friction: 0.66 },
  steel: { density: 0.0038, toughness: 15, bluntDamage: 0.58, friction: 0.7 },
};
const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
const ammoById = new Map(AMMO.map((ammo) => [ammo.id, ammo]));

function planBridges(level) {
  if (level.difficulty === 'small') return [];
  const random = seededRandom(level.seed ^ 0xa746c3);
  return level.sections.slice(1).map((right, index) => {
    const left = level.sections[index];
    const highWard = level.difficulty === 'large';
    const leftHeight = highWard ? Math.max(...left.heights) : left.heights.at(-1);
    const rightHeight = highWard ? Math.max(...right.heights) : right.heights[0];
    const wanted = 1 + Math.floor(random() * Math.min(leftHeight, rightHeight, highWard ? 9 : 5));
    let best = Infinity, leftFloor = 1, rightFloor = 1;
    for (let a = 1; a <= leftHeight; a++) {
      for (let b = 1; b <= rightHeight; b++) {
        const rise = Math.abs(left.base - a * left.storey - (right.base - b * right.storey));
        // In tightly packed wards, alternate a low crossing with a longer
        // skybridge between setback towers, clear of the roofs below.
        const setback = a > left.heights.at(-1) || b > right.heights[0];
        const cost = rise + Math.abs(a - wanted) * 11 + Math.abs(b - wanted) * 11 -
          (highWard && index % 2 === 0 && setback ? 170 : 0);
        if (cost < best) {
          best = cost;
          leftFloor = a;
          rightFloor = b;
        }
      }
    }
    const leftBay = left.heights.findLastIndex((height) => height >= leftFloor);
    const rightBay = right.heights.findIndex((height) => height >= rightFloor);
    return { leftFloor, rightFloor, leftBay, rightBay, material: random() < 0.3 ? 'steel' : 'wood' };
  });
}

function launchVelocity(angle, power, ammo, large = false) {
  const radians = (clamp(angle, 5, 85) * Math.PI) / 180;
  const draw = clamp(power, 1, 100);
  // The large-fortress engine has a longer draw for clearing the rear keep.
  // A progressive boost at full extension preserves short, precise low shots.
  const reserve = large ? 270 * (Math.max(0, draw - 70) / 30) ** 2 : 0;
  const speed = (250 + 6.1 * draw + reserve) * (ammo?.launchScale ?? 1);
  return { x: Math.cos(radians) * speed, y: -Math.sin(radians) * speed };
}

function flightTime(dx, vx, wind) {
  // Invert x(t) = vx*t + wind*t*(t+STEP)/2 using the stable positive root.
  const u = vx + 0.5 * wind * STEP,
    discriminant = u * u + 2 * wind * dx;
  return discriminant >= 0 ? (2 * dx) / (u + Math.sqrt(discriminant)) : Infinity;
}

function pointOnBody(body, x, y) {
  const c = Math.cos(body.angle),
    s = Math.sin(body.angle);
  return { x: body.position.x + c * x - s * y, y: body.position.y + s * x + c * y };
}

function pointVelocity(body, point) {
  if (body.isStatic) return { x: 0, y: 0 };
  const v = Body.getVelocity(body),
    spin = Body.getAngularVelocity(body);
  return { x: v.x - spin * (point.y - body.position.y), y: v.y + spin * (point.x - body.position.x) };
}

// Split across the longest edge, offset toward the end that took the hit.
// Clipping the existing convex outline keeps even slender, rotating shards
// inside their parent and leaves one rough chip and one larger stone.
function splitStone(vertices, hit) {
  let edgeX = 0, edgeY = 0, longest = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    if (length > longest) {
      longest = length;
      edgeX = dx;
      edgeY = dy;
    }
  }
  const distances = vertices.map((p) => p.x * edgeX + p.y * edgeY);
  const min = Math.min(...distances), max = Math.max(...distances);
  const nearMin = hit.x * edgeX + hit.y * edgeY < (min + max) / 2;
  const cut = min + (max - min) * (nearMin ? 0.35 : 0.65);
  const halves = [[], []];
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const a = vertices[i], b = vertices[j], da = distances[i] - cut, db = distances[j] - cut;
    if (da <= 0) halves[0].push(a);
    if (da >= 0) halves[1].push(a);
    if (da * db < 0) {
      const t = da / (da - db);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      halves[0].push(p);
      halves[1].push(p);
    }
  }
  return halves;
}

// Clip a blast ray against a convex collision polygon. A wall between powder
// and a guard takes the shock first, even when both are inside the blast radius.
function shieldsBlast(body, start, end) {
  const bounds = body.bounds;
  if (
    (start.x < bounds.min.x && end.x < bounds.min.x) ||
    (start.x > bounds.max.x && end.x > bounds.max.x) ||
    (start.y < bounds.min.y && end.y < bounds.min.y) ||
    (start.y > bounds.max.y && end.y > bounds.max.y)
  )
    return false;
  let enter = 0,
    exit = 1;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  for (let i = 0; i < body.vertices.length; i++) {
    const a = body.vertices[i],
      b = body.vertices[(i + 1) % body.vertices.length];
    const nx = b.y - a.y,
      ny = a.x - b.x;
    const distance = (start.x - a.x) * nx + (start.y - a.y) * ny;
    const rate = dx * nx + dy * ny;
    if (Math.abs(rate) < 1e-6) {
      if (distance > 0) return false;
    } else if (rate < 0) enter = Math.max(enter, -distance / rate);
    else exit = Math.min(exit, -distance / rate);
    if (enter >= exit) return false;
  }
  return exit > 0.025 && enter < 0.95;
}

function distanceToBody(e, point) {
  const b = e.body,
    dx = point.x - b.position.x,
    dy = point.y - b.position.y;
  const c = Math.cos(b.angle),
    s = Math.sin(b.angle);
  const x = Math.max(0, Math.abs(dx * c + dy * s) - e.width / 2);
  const y = Math.max(0, Math.abs(dy * c - dx * s) - e.height / 2);
  return Math.hypot(x, y);
}

// Find the exposed face on a rotated plank or an irregular rubble outline.
// A bounding box alone can put the hit in empty air beside a leaning beam.
function blastContact(body, origin) {
  const vertices = body.vertices;
  let x = origin.x, y = origin.y, best = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((origin.x - a.x) * dx + (origin.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const px = a.x + t * dx, py = a.y + t * dy;
    const d = (px - origin.x) ** 2 + (py - origin.y) ** 2;
    if (d < best) { best = d; x = px; y = py; }
  }
  const inside = Vertices.contains(vertices, origin);
  let dx = inside ? body.position.x - origin.x : x - origin.x;
  let dy = inside ? body.position.y - origin.y : y - origin.y;
  let length = Math.hypot(dx, dy);
  if (length < 0.001) {
    dx = body.position.x - x; dy = body.position.y - y;
    length = Math.hypot(dx, dy) || 1;
  }
  return { x, y, distance: inside ? 0 : Math.sqrt(best), blast: true, outX: dx / length, outY: dy / length };
}

function touchingHeatSource(a, b) {
  const ab = a.body.bounds,
    bb = b.body.bounds;
  if (ab.min.x > bb.max.x + 2 || bb.min.x > ab.max.x + 2 || ab.min.y > bb.max.y + 2 || bb.min.y > ab.max.y + 2)
    return false;
  return (
    a.body.vertices.some((p) => distanceToBody(b, p) <= 2) ||
    b.body.vertices.some((p) => distanceToBody(a, p) <= 2)
  );
}

export class FortressSimulation {
  constructor(difficulty = 'small', seed = newSeed()) {
    this.loadLevel(difficulty, seed);
  }

  loadLevel(difficulty = this.difficulty, seed = difficulty === this.difficulty ? this.seed : newSeed()) {
    const builder = this.buildLevel(difficulty, seed);
    let step;
    do step = builder.next(); while (!step.done);
    return step.value;
  }

  // Drive the identical generator a few steps per idle frame when preparing a
  // new siege. A separate simulation owns all collision pairs and callbacks.
  static *prepareLevel(difficulty, seed) {
    const sim = Object.create(FortressSimulation.prototype);
    if (yield* sim.buildLevel(difficulty, seed)) return sim;
  }

  *buildLevel(difficulty, seed) {
    if (!DIFFICULTIES.some((size) => size.id === difficulty)) return false;
    if (this.engine) {
      Events.off(this.engine);
      Composite.clear(this.engine.world, false);
      Engine.clear(this.engine);
    }
    this.difficulty = difficulty;
    this.seed = seed >>> 0 || 1;
    const level = (this.level = generateLevel(difficulty, this.seed));
    this.themeIndex = level.themeIndex;
    this.terrain = level.terrain;
    this.terrainVersion = 0;
    this.hills = [];
    this.engine = Engine.create({
      enableSleeping: true,
      positionIterations: difficulty === 'large' ? 14 : 9,
      velocityIterations: difficulty === 'large' ? 12 : 7,
      gravity: { x: 0, y: 1, scale: GRAVITY / 1e6 },
    });
    this.entities = new Map();
    this.guards = new Set();
    Events.on(this.engine, 'beforeUpdate', () => balanceGuards(this));
    this.projectiles = new Set();
    this.remoteBombs = new Set();
    this.implosions = [];
    this.events = [];
    this.work = new Set();
    this.totalWeight = 0;
    this.lostWeight = 0;
    this.accumulator = 0;
    this.time = 0;
    this.ticks = 0;
    this.resting = false;
    this.idleSteps = 0;
    this.wokenColumns = new Set();
    this.nextId = 1;
    this.debrisSeed = this.seed ^ 91463;
    this.blastRandom = seededRandom(this.seed ^ 0xb1a574);
    this.shots = 0;
    this.spent = 0;
    this.winningCost = null;
    this.reloadTick = 0;
    this.clearAt = Infinity;
    this.cleared = false;
    this.buildTerrain();
    const bridges = planBridges(level);
    for (const [index, section] of level.sections.entries()) {
      this.buildFort(section, bridges[index - 1], bridges[index]);
      yield;
    }
    for (const wall of level.walls) this.buildWall(wall);
    for (const crossing of bridges) this.buildBridge(crossing);
    // Settle the mortar-free stacks before measuring displacement for scoring.
    for (let i = 0; i < (difficulty === 'large' ? 300 : difficulty === 'medium' ? 230 : 90); i++) {
      Engine.update(this.engine, STEP * 1000);
      yield;
    }
    for (const e of this.entities.values()) {
      // The large keep is pre-settled before play. Its undisturbed wards can
      // sleep until an impact, a removed support, or a fire wakes them.
      if (difficulty === 'large') Sleeping.set(e.body, true);
      e.home = { ...e.body.position, angle: e.body.angle };
      this.sync(e);
    }
    if (difficulty === 'large') {
      // Keep the initial bearing contacts, including pairs the solver has put
      // to sleep. A departing pier must wake its ceiling even after that pair expires.
      const pieces = this.bodies.filter((e) => e.kind !== 'torch');
      for (const lower of pieces) {
        if (lower.kind !== 'block') continue;
        const base = lower.body.bounds;
        lower.carried = pieces.filter((upper) => {
          const top = upper.body.bounds;
          return upper !== lower && Math.abs(top.max.y - base.min.y) < 2.5 &&
            Math.min(base.max.x, top.max.x) - Math.max(base.min.x, top.min.x) > 1;
        });
        for (const deck of lower.supportedDecks || []) {
          if (!lower.carried.includes(deck)) lower.carried.push(deck);
        }
      }
    }
    this.torches = [];
    this.mountTorches();
    this.defend = createGuardDefense(this, shieldsBlast);
    this.orcsTotal = level.sections.reduce((sum, section) => sum + section.orcs.length, 0);
    this.orcsRemaining = this.orcsTotal;
    Events.on(this.engine, 'collisionStart', (event) => this.collisions(event.pairs));
    Events.on(this.engine, 'collisionEnd', ({ pairs }) => {
      for (const pair of pairs) {
        const { parentA, parentB, normal } = pair.collision;
        parentA.plugin.fortress?.contacts?.delete(pair);
        parentB.plugin.fortress?.contacts?.delete(pair);
        if (difficulty === 'large' && !pair.isSensor && Math.abs(normal.y) > 0.58) {
          const lower = normal.y < 0 ? parentB : parentA;
          const upper = lower === parentB ? parentA : parentB;
          if (upper.isSleeping && !lower.isStatic && lower.speed > 0.18) Sleeping.set(upper, false);
        }
      }
    });
    return true;
  }

  random() {
    this.debrisSeed = (Math.imul(this.debrisSeed, 1664525) + 1013904223) >>> 0;
    return this.debrisSeed / 4294967296;
  }

  add(kind, material, x, y, width, height, detail, options = {}, customBody) {
    this.resumePhysics();
    const props = MATERIALS[material];
    const settings = {
      density: props?.density || 0.0014,
      friction: props?.friction ?? 0.78,
      frictionStatic: 1.2,
      restitution: 0.045,
      frictionAir: 0.002,
      slop: 0.025,
      ...options,
    };
    const body = customBody || Bodies.rectangle(x, y, width, height, settings);
    // Leave ample time for a cascading failure before sleeping a settled stack.
    body.sleepThreshold = 120;
    const e = {
      id: this.nextId++,
      kind,
      material,
      detail,
      width,
      height,
      radius: options.radius || 0,
      x,
      y,
      angle: body.angle,
      damage: 0,
      burn: 0,
      burning: false,
      heat: 0,
      bend: 0,
      fainted: false,
      body,
      home: { x, y, angle: body.angle },
      born: this.time,
      fuse: Infinity,
      destroyed: false,
      lastImpact: -1,
    };
    body.plugin.fortress = e;
    Composite.add(this.engine.world, body);
    this.entities.set(e.id, e);
    if (kind === 'fragment' && material === 'stone' && body.area <= 30) {
      e.dustAt = this.time + 2.5;
      e.dustProgress = 0;
    }
    if (kind === 'block') {
      e.weight = Math.sqrt(width * height);
      this.totalWeight += e.weight;
    }
    return e;
  }

  terrainHeight(x) {
    const points = this.terrain;
    let lo = 1,
      hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (points[mid].x < x) lo = mid + 1;
      else hi = mid;
    }
    const a = points[lo - 1],
      b = points[lo];
    if (x > b.x) return b.y;
    return a.y + (b.y - a.y) * clamp((x - a.x) / (b.x - a.x), 0, 1);
  }

  buildTerrain() {
    const points = [terrainStart, ...this.terrain, terrainEnd];
    // The two sorted meshes share point objects outside the cut. Keep those
    // bodies and their cached support contacts, rebuilding only changed edges.
    const previous = this.hills,
      removed = [],
      hills = [];
    let old = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      while (old < previous.length && previous[old].plugin.start.x < a.x) removed.push(previous[old++]);
      const candidate = previous[old];
      if (candidate && candidate.plugin.start === a && candidate.plugin.end === b) {
        hills.push(candidate);
        old++;
        continue;
      }
      const bottom = WORLD.height + 120;
      const shape = [a, b, { x: b.x, y: bottom }, { x: a.x, y: bottom }];
      const center = Vertices.centre(shape);
      const body = Bodies.fromVertices(center.x, center.y, [shape], {
        isStatic: true,
        friction: 0.94,
        sleepThreshold: 0,
      });
      body.plugin.start = a;
      body.plugin.end = b;
      Composite.add(this.engine.world, body);
      hills.push(body);
    }
    while (old < previous.length) removed.push(previous[old++]);
    if (removed.length) Composite.remove(this.engine.world, removed);
    this.hills = hills;
  }

  excavate(origin, blastRadius) {
    const reach = blastRadius * 0.54,
      verticalReach = blastRadius * 0.53,
      grid = 8;
    const left = Math.max(0, Math.floor((origin.x - reach) / grid) * grid);
    const right = Math.min(WORLD.width, Math.ceil((origin.x + reach) / grid) * grid);
    if (right <= left) return;
    const original = this.terrain;
    const inside = original.filter((p) => p.x >= left && p.x <= right);
    // Use a shared grid for all blasts, preserving the original breakpoints.
    // Repeated impacts can deepen bedrock scars without growing the mesh forever.
    for (let x = left; x <= right; x += grid) {
      if (!inside.some((p) => Math.abs(p.x - x) < 1)) inside.push({ x, y: this.terrainHeight(x) });
    }
    inside.sort((a, b) => a.x - b.x);
    let depth = 0,
      first = -1,
      last = -1;
    const cut = inside.map((p, i) => {
      const dx = (p.x - origin.x) / reach,
        air = Math.max(0, p.y - origin.y) / verticalReach;
      const exposure = Math.max(0, 1 - dx * dx - air * air);
      const delta = Math.min(WORLD.height - 15 - p.y, blastRadius * 0.29 * exposure ** 1.35);
      if (delta < 0.1) return p;
      if (first < 0) first = i;
      last = i;
      depth = Math.max(depth, delta);
      return { x: p.x, y: p.y + delta };
    });
    if (depth < 0.8) return;
    const scarLeft = inside[Math.max(0, first - 1)].x,
      scarRight = inside[Math.min(inside.length - 1, last + 1)].x;
    const x = (scarLeft + scarRight) / 2,
      y = this.terrainHeight(x);
    this.terrain = [...original.filter((p) => p.x < left), ...cut, ...original.filter((p) => p.x > right)];
    this.terrainVersion++;
    this.buildTerrain();
    this.wakeWard(x);
    if (this.difficulty === 'large') {
      for (const e of this.entities.values()) {
        const bounds = e.body.bounds;
        if (bounds.max.x >= scarLeft && bounds.min.x <= scarRight && bounds.max.y >= y - 30 && !e.body.isStatic)
          Sleeping.set(e.body, false);
      }
    }
    this.events.push({
      type: 'crater',
      x,
      y,
      radius: (scarRight - scarLeft) / 2,
      depth,
      material: 'earth',
      strength: clamp(depth / 45, 0, 1),
    });
  }

  buildWall({ left, width, base, rows }) {
    const course = 13,
      count = Math.max(2, Math.round(width / 16));
    for (let row = 0; row < rows; row++) {
      const cuts = [0];
      for (let j = row % 2 ? 0.5 : 1; j < count; j++) cuts.push((j * width) / count);
      cuts.push(width);
      for (let j = 1; j < cuts.length; j++) {
        const w = cuts[j] - cuts[j - 1];
        this.add(
          'block',
          'stone',
          left + cuts[j - 1] + w / 2,
          base - (row + 0.5) * course,
          w - 0.25,
          course,
          'curtain',
        );
      }
    }
    for (let j = 0; j < count; j += 2) {
      this.add(
        'block',
        'stone',
        left + ((j + 0.5) * width) / count,
        base - rows * course - 5,
        11,
        10,
        'battlement',
      );
    }
  }

  buildBridge({ leftSeat, rightSeat, material }) {
    const left = pointOnBody(leftSeat.body, leftSeat.width / 2 - BRIDGE_LEDGE * 0.72, -leftSeat.height / 2);
    const right = pointOnBody(rightSeat.body, -rightSeat.width / 2 + BRIDGE_LEDGE * 0.72, -rightSeat.height / 2);
    const dx = right.x - left.x, dy = right.y - left.y;
    const width = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    const height = material === 'steel' ? 8 : 9;
    // Locate the lower face on the two projecting lintels. Nothing pins the
    // span to the world: it can slide, burn or drop away with either bearing.
    const x = (left.x + right.x + Math.sin(angle) * height) / 2;
    const y = (left.y + right.y - Math.cos(angle) * height) / 2 - Math.abs(Math.sin(angle)) * BRIDGE_LEDGE;
    const deck = this.add('block', material, x, y, width, height, 'bridge', {
      angle, density: material === 'steel' ? 0.0011 : 0.00072,
    });
    for (const seat of [leftSeat, rightSeat]) (seat.supportedDecks ??= []).push(deck);
  }

  buildFort(level, bridgeToLeft, bridgeToRight) {
    const { heights, spans, left, storey, pattern } = level;
    const columns = [left];
    for (const span of spans) columns.push(columns.at(-1) + span);
    const stage = this.difficulty === 'large' ? 4 : this.difficulty === 'medium' ? 2 : 0;
    const highest = Math.max(...heights);
    const flagBay = heights.lastIndexOf(highest);
    const block = (material, x, y, w, h, detail) => this.add('block', material, x, y, w, h, detail);

    for (let row = 0; row < highest; row++) {
      const base = level.base - row * storey;
      const roofY = base - storey + ROOF / 2;
      for (let c = 0; c < columns.length; c++) {
        const leftRoom = heights[c - 1] > row,
          rightRoom = heights[c] > row;
        if (!leftRoom && !rightRoom) continue;
        const outer = !leftRoom || !rightRoom;
        let material = outer ? 'stone' : 'wood';
        if (!outer && (c + row + pattern) % 4 === 2) material = 'glass';
        if (stage >= 2 && (c * 3 + row + pattern) % 5 === 1) material = 'steel';
        if (outer && row > 0 && (c + pattern + row) % 3 === 1) material = 'wood';
        if (
          stage >= 3 &&
          row === 0 &&
          ((level.style === 'watch' && c < 2) || (level.style === 'keep' && c >= spans.length - 1))
        ) {
          material = c === 0 || c === spans.length ? 'stone' : 'steel';
        }
        const h = storey - ROOF;
        if (material === 'stone') {
          // Large towers use coursed foundations and full-height upper piers.
          // Tall stacks of thin, loose courses would settle unevenly under their own weight.
          const courses = stage === 4 ? (row < 3 ? 2 : 1) : stage === 2 ? 3 : 2;
          for (let course = 0; course < courses; course++) {
            const width = course === 0 ? 28 : course === courses - 1 && stage ? 29 : 25;
            block('stone', columns[c], base - ((course + 0.5) * h) / courses, width, h / courses, 'masonry');
          }
        } else {
          // At the foundation, a broad sill can slip independently of the post it carries.
          const sill = stage && row === 0 ? 6 : 0;
          const capital = stage === 4 && row === 0 ? 5 : 0;
          if (sill) block('stone', columns[c], base - sill / 2, 27, sill, 'masonry');
          if (capital) block('stone', columns[c], base - h + capital / 2, 26, capital, 'masonry');
          block(
            material,
            columns[c],
            base - sill - (h - sill - capital) / 2,
            material === 'wood' ? 17 : 18,
            h - sill - capital,
            material === 'wood' ? 'beam' : material === 'glass' ? 'pane' : 'girder',
          );
        }
      }
      for (let c = 0; c < spans.length; c++) {
        if (heights[c] <= row) continue;
        const leftSeat = c === bridgeToLeft?.rightBay && row + 1 === bridgeToLeft.rightFloor;
        const leftEnd = columns[c] - (heights[c - 1] > row ? -0.35 : 15) - (leftSeat ? BRIDGE_LEDGE : 0);
        const tieRow = pattern % 2;
        const tieBay = pattern % Math.max(1, spans.length - 1);
        const tied = stage === 4 && row % 3 === tieRow && heights[tieBay] > row && heights[tieBay + 1] > row &&
          (c === tieBay || c === tieBay + 1);
        const endBay = tied ? tieBay + 1 : c;
        const rightSeat = endBay === bridgeToRight?.leftBay && row + 1 === bridgeToRight.leftFloor;
        const rightEnd = columns[endBay + 1] + (heights[endBay + 1] > row ? -0.35 : 15) + (rightSeat ? BRIDGE_LEDGE : 0);
        let material =
          stage >= 2 && (c + row + pattern) % 5 === 0 ? 'steel' : (c + row + pattern) % 3 === 0 ? 'stone' : 'wood';
        if (stage === 4 && heights[c] - row >= 3) material = 'stone';
        // Deep galleries have a second load path from their lintels to the
        // floor. Leave occupied cells and the upper timberwork open.
        if (row < (stage === 4 ? 4 : stage === 2 ? 1 : 0) &&
            !level.orcs.some(([bay, floor]) => bay === c && floor === row) &&
            !level.barrels.some(([bay, floor]) => bay === c && floor === row)) {
          const cx = (columns[c] + columns[c + 1]) / 2;
          const h = storey - ROOF;
          if (stage === 4 && row === 0 && (c + pattern) % 2 === 0) {
            const width = spans[c] - 32, course = h / 3;
            block('stone', cx, base - course * 0.5, width, course, 'brickwork');
            for (const side of [-1, 1])
              block('stone', cx + side * width / 4, base - course * 1.5, width / 2 - 0.3, course, 'brickwork');
            block('stone', cx, base - course * 2.5, width, course, 'brickwork');
          } else {
            block('stone', cx, base - h * 0.25, 16, h * 0.5, 'buttress');
            block('stone', cx, base - h * 0.75, 13, h * 0.5, 'buttress');
          }
          if (stage === 4 && material === 'wood') material = 'steel';
        }
        let roof;
        if (tied && c === tieBay) {
          roof = block('steel', (leftEnd + rightEnd) / 2, roofY, rightEnd - leftEnd, ROOF, 'tie-beam');
        } else if (!tied) roof = block(
          material,
          (leftEnd + rightEnd) / 2,
          roofY,
          rightEnd - leftEnd,
          ROOF,
          material === 'steel'
            ? 'girder'
            : material === 'stone'
              ? level.style === 'gate' && row === 0
                ? 'gate'
                : 'masonry'
              : 'beam',
        );
        if (roof && leftSeat) bridgeToLeft.rightSeat = roof;
        if (roof && rightSeat) bridgeToRight.leftSeat = roof;
        if (heights[c] !== row + 1) continue;
        const top = base - storey;
        const occupied =
          level.orcs.some(([bay, floor]) => bay === c && floor === row + 1) ||
          level.barrels.some(([bay, floor]) => bay === c && floor === row + 1);
        if (stage && !occupied) {
          const center = (columns[c] + columns[c + 1]) / 2;
          block('stone', center, top - 3, spans[c] - 28, 6, 'curtain');
          block('stone', center, top - 10, 11, 8, 'battlement');
        }
        for (const side of [-1, 1]) {
          const neighbor = heights[c + (side < 0 ? -1 : 1)];
          // A higher adjoining room uses this same support line.
          if (neighbor > row + 1 || (side < 0 && neighbor === row + 1)) continue;
          const edge = side < 0 ? columns[c] : columns[c + 1];
          block('stone', edge, top - 7, 18, 14, c === flagBay && side === 1 ? 'banner' : 'battlement');
        }
      }
    }
    for (const [c, row] of level.orcs) {
      addGuardRig(this, (columns[c] + columns[c + 1]) / 2, level.base - row * storey);
    }
    for (const [c, row] of level.barrels) {
      this.add(
        'barrel',
        'barrel',
        (columns[c] + columns[c + 1]) / 2,
        level.base - row * storey - 16,
        24,
        32,
        'powder',
        { density: 0.0017, chamfer: { radius: 3 } },
      );
    }
  }

  mountTorches() {
    const bodies = this.bodies;
    const mount = (left, right, count, pattern, minHeight) => {
      const hosts = bodies.filter(
        (e) =>
          e.kind === 'block' &&
          (e.material === 'stone' || e.material === 'steel') &&
          e.home.x >= left - 2 &&
          e.home.x <= right + 2 &&
          e.height >= minHeight,
      );
      let placed = 0;
      for (let i = 0; i < hosts.length && placed < count; i++) {
        const host = hosts[(i + pattern) % hosts.length];
        for (const side of [1, -1]) {
          const offset = side * (host.width / 2 + 4);
          const p = pointOnBody(host.body, offset, 2);
          const flame = { x: p.x, y: p.y - 8 };
          if (this.torches.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 47)) continue;
          const clear = bodies.every(
            (e) =>
              e === host ||
              Math.hypot(e.x - p.x, e.y - p.y) > 135 ||
              distanceToBody(e, flame) > (e.material === 'wood' || e.kind === 'barrel' ? 13 : 3),
          );
          if (!clear) continue;
          this.attachTorch(host, offset);
          placed++;
          break;
        }
      }
    };
    for (const section of this.level.sections) {
      const right = section.left + section.spans.reduce((sum, n) => sum + n, 0);
      const large = this.difficulty === 'large';
      const count = large
        ? section.style === 'keep'
          ? 4
          : 3
        : section.style === 'keep' && this.difficulty !== 'small'
          ? 2
          : 1;
      // Large towers are built of shorter courses than the smaller towers.
      mount(section.left, right, count, section.pattern, large ? 6 : 13);
    }
    if (this.difficulty === 'large') {
      for (const wall of this.level.walls) mount(wall.left, wall.left + wall.width, 1, 0, 6);
    }
  }

  attachTorch(host, offset) {
    const p = pointOnBody(host.body, offset, 2);
    const torch = this.add('torch', 'torch', p.x, p.y, 5, 12, 'sconce', { isStatic: true, isSensor: true });
    Object.assign(torch, { lit: true, hostId: host.id, mountOffset: offset, flameX: p.x, flameY: p.y - 8 });
    this.torches.push(torch);
    return torch;
  }

  extinguish(torch) {
    if (!torch.lit) return;
    this.resumePhysics();
    this.emit('extinguish', torch, 0.6, { x: torch.flameX, y: torch.flameY });
    torch.lit = false;
    const host = this.entities.get(torch.hostId);
    // Replace the mounted sensor with a light rolling fixture. This also gives
    // it finite mass and inertia when its bracket tears away.
    const old = torch.body;
    const body = Bodies.rectangle(old.position.x, old.position.y, torch.width, torch.height, {
      density: 0.0005,
      friction: 0.7,
      angle: old.angle,
      sleepThreshold: 120,
    });
    body.plugin.fortress = torch;
    Composite.remove(this.engine.world, old);
    Composite.add(this.engine.world, body);
    torch.body = body;
    const v = host ? pointVelocity(host.body, body.position) : { x: 0, y: 0 };
    Body.setVelocity(body, { x: v.x + Math.sign(torch.mountOffset) * 0.35, y: v.y });
    Body.setAngularVelocity(body, Math.sign(torch.mountOffset) * 0.08);
  }

  updateTorches() {
    for (const torch of this.torches) {
      if (!torch.lit || !this.entities.has(torch.id)) continue;
      const host = this.entities.get(torch.hostId);
      if (!host) {
        this.extinguish(torch);
        continue;
      }
      const p = pointOnBody(host.body, torch.mountOffset, 2);
      const turn = host.body.angle - host.home.angle;
      if (p.x !== torch.body.position.x || p.y !== torch.body.position.y) Body.setPosition(torch.body, p);
      if (turn !== torch.body.angle) Body.setAngle(torch.body, turn);
      torch.flameX = p.x + 8 * Math.sin(turn);
      torch.flameY = p.y - 8 * Math.cos(turn);
      if (Math.hypot(p.x - torch.home.x, p.y - torch.home.y) > 3 || Math.abs(turn) > 0.065) this.extinguish(torch);
    }
  }

  ignite(e) {
    if (e.burning) return;
    this.resumePhysics();
    e.burning = true;
    e.ignitedAt = this.time;
    this.emit('ignite', e, 0.7).id = e.id;
    if (e.kind === 'barrel') e.fuse = Math.min(e.fuse, this.time + 0.6);
  }

  heatMaterials() {
    const bodies = this.bodies;
    const flames = this.torches.filter((e) => e.lit);
    const embers = bodies.filter((e) => e.burning && e.burn > 0.12);
    for (const e of bodies) {
      if (e.material !== 'wood' && e.kind !== 'barrel') continue;
      if (!e.burning) {
        const heated =
          flames.some((flame) => {
            const reach = (e.width + e.height) / 2 + 6,
              p = e.body.position;
            return (
              Math.abs(p.x - flame.flameX) < reach &&
              Math.abs(p.y - flame.flameY) < reach &&
              distanceToBody(e, { x: flame.flameX, y: flame.flameY }) < 6
            );
          }) || embers.some((source) => source !== e && touchingHeatSource(source, e));
        // A grazing contact cannot set a plank alight. Heat bleeds away when
        // it rolls clear; sustained contact heats a timber or powder barrel.
        e.heat = clamp(e.heat + (heated ? 0.1 : -0.16), 0, 1);
        if (e.heat < 0.69) continue;
        this.ignite(e);
      }
      e.burn = Math.min(1, e.burn + 0.014);
      if (e.kind === 'block' && this.ticks % 48 === 0) {
        this.wakeWard(e.body.position.x);
        if (this.difficulty === 'large' && e.body.isSleeping) Sleeping.set(e.body, false);
      }
      if (e.burn === 1) {
        // A timber can break early under load. Once fully consumed, only ash
        // remains and anything it was supporting must be free to fall.
        this.disintegrate(e, 'burnout');
      }
    }
  }

  get bodies() {
    return Array.from(this.entities.values());
  }

  get stats() {
    const reloadRemaining = Math.max(0, this.reloadTick - this.ticks) * STEP;
    return {
      difficulty: this.difficulty,
      themeIndex: this.themeIndex,
      spent: this.spent,
      winningCost: this.winningCost,
      shots: this.shots,
      remoteBombs: this.remoteBombs.size,
      orcsRemaining: this.orcsRemaining,
      orcsTotal: this.orcsTotal,
      destruction: Math.min(100, Math.round((100 * this.lostWeight) / this.totalWeight)),
      cleared: this.cleared,
      reloadRemaining,
      ready: reloadRemaining === 0,
    };
  }

  drainEvents() {
    return this.events.splice(0);
  }

  emit(type, e, strength, point = e.body.position) {
    const event = { type, x: point.x, y: point.y, material: e.material, strength: clamp(strength, 0, 1) };
    if (point.blast) Object.assign(event, { blast: true, outX: point.outX, outY: point.outY });
    if (e.radius || e.weight) event.size = e.radius ? e.radius * 2 : e.weight;
    this.events.push(event);
    return event;
  }

  heightAt(ammoId, angle, power, x) {
    const ammo = ammoById.get(ammoId);
    if (
      !ammo ||
      !Number.isFinite(angle) ||
      !Number.isFinite(power) ||
      !Number.isFinite(x) ||
      x < WORLD.release.x ||
      x > WORLD.width
    )
      return Infinity;
    const v = launchVelocity(angle, power, ammo, this.difficulty === 'large'),
      origin = WORLD.release;
    const height = (px) => {
      const t = flightTime(px - origin.x, v.x, this.level.wind);
      if (!Number.isFinite(t)) return Infinity;
      return origin.y + t * (v.y + 0.5 * GRAVITY * (t + STEP));
    };
    // On each straight terrain segment, the downward-curving arc has its
    // largest y relative to that segment at one of its ends. Checking the
    // intervening ridge vertices handles a sharp bluff between sample points.
    for (const p of this.terrain) {
      if (p.x >= x) break;
      if (p.x > origin.x && height(p.x) + ammo.radius >= p.y) return Infinity;
    }
    const y = height(x);
    return y + ammo.radius < this.terrainHeight(x) ? y : Infinity;
  }

  trajectory(ammoId, angle, power) {
    const ammo = ammoById.get(ammoId);
    if (!ammo || !Number.isFinite(angle) || !Number.isFinite(power)) return [];
    const v = launchVelocity(angle, power, ammo, this.difficulty === 'large'),
      origin = WORLD.release;
    const points = [];
    // Semi-implicit integration adds half a step of acceleration to the
    // continuous parabola. This matches the trajectory used by the solver.
    for (let i = 0; i <= 600; i += 6) {
      const t = i * STEP;
      const x = origin.x + v.x * t + 0.5 * this.level.wind * t * (t + STEP);
      const y = origin.y + v.y * t + 0.5 * GRAVITY * t * (t + STEP);
      points.push({ x, y });
      if (y + ammo.radius >= this.terrainHeight(x) || x > WORLD.width) break;
    }
    return points;
  }

  fire(ammoId, angle, power) {
    const ammo = ammoById.get(ammoId);
    if (!ammo || !this.stats.ready || !Number.isFinite(angle) || !Number.isFinite(power)) return false;
    const { x, y } = WORLD.release,
      r = ammo.radius,
      v = launchVelocity(angle, power, ammo, this.difficulty === 'large');
    const body = Bodies.circle(x, y, r, {
      density: ammo.density,
      frictionAir: 0,
      friction: 0.65,
      restitution: 0.19,
    });
    const e = this.add('projectile', ammo.id, x, y, r * 2, r * 2, 'shot', { radius: r }, body);
    e.blast = ammo.blast;
    if (ammo.remote) this.remoteBombs.add(e);
    e.flameRadius = ammo.flameRadius;
    e.implosionRadius = ammo.implosionRadius;
    e.flightPath = this.trajectory(ammoId, angle, power);
    e.contacts = new Set();
    this.projectiles.add(e);
    Body.setVelocity(body, { x: v.x / 60, y: v.y / 60 });
    Body.setAngularVelocity(body, 0.075);
    this.shots++;
    this.spent += ammo.cost;
    this.reloadTick = this.ticks + Math.round(ammo.reload / STEP);
    this.emit('launch', e, 0.6);
    return true;
  }

  detonateSiegeBomb() {
    const oldest = this.remoteBombs.values().next().value;
    if (!oldest) return false;
    this.explode(oldest);
    return true;
  }

  resumePhysics() {
    if (!this.resting) return;
    // Matter increments each sleeping body's counter until twice its threshold
    // at this timestep, then resets it. Restore that phase on the first wake.
    for (const { body } of this.entities.values()) {
      if (body.isSleeping && body.sleepThreshold > 0)
        body.sleepCounter =
          body.sleepThreshold + ((body.sleepCounter - body.sleepThreshold + this.idleSteps) % body.sleepThreshold);
    }
    this.resting = false;
    this.idleSteps = 0;
  }

  canRest() {
    if (
      this.projectiles.size !== this.remoteBombs.size ||
      this.implosions.length ||
      this.work.size ||
      (!this.orcsRemaining && !this.cleared)
    )
      return false;
    for (const e of this.entities.values()) {
      if (!e.body.isSleeping || (e.rig && !e.rig.resting) || e.heat || e.burning || e.dustAt !== undefined || e.fuse !== Infinity) return false;
    }
    return !this.engine.pairs.list.some((pair) => pair.isActive);
  }

  update(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || !this.shots) return;
    const wasResting = this.resting;
    this.accumulator += Math.min(seconds, 0.125);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      this.time += STEP;
      this.ticks++;
      if (this.resting) {
        this.engine.timing.timestamp += STEP * 1000;
        this.idleSteps++;
        continue;
      }
      this.wokenColumns.clear();
      if (this.implosions.length) this.pullInward();
      for (const shot of this.projectiles) {
        if (!shot.body.isSleeping && !shot.contacts.size)
          shot.body.force.x += (shot.body.mass * this.level.wind) / 1e6;
      }
      Engine.update(this.engine, STEP * 1000);
      this.resolveDamage();
      this.defend();
      this.updateTorches();
      if (this.ticks % 12 === 0) {
        this.checkLoads();
        this.heatMaterials();
      }
      for (const e of this.entities.values()) {
        if (e.body.position.y > WORLD.height + 100 || e.body.position.x < -70 || e.body.position.x > 1320) {
          if (e.kind === 'orc') this.faint(e);
          this.remove(e);
        } else if (e.dustAt !== undefined && this.time >= e.dustAt) {
          e.dustProgress = Math.min(1, (this.time - e.dustAt) / 1.15);
          if (e.dustProgress === 1) this.disintegrate(e, 'stone-dust');
        } else if (e.fuse <= this.time) this.explode(e);
        else if (e.kind === 'projectile') {
          if (this.time - e.born > 14 && e.body.speed < 0.25 && !this.remoteBombs.has(e)) this.remove(e);
          else if (!e.body.isSleeping && e.body.bounds.max.y >= this.terrainHeight(e.body.position.x) - 0.1) {
            // The turf absorbs rolling energy after a shot lands.
            const velocity = Body.getVelocity(e.body);
            Body.setVelocity(e.body, { x: velocity.x * TURF_ROLL, y: velocity.y });
            Body.setAngularVelocity(e.body, Body.getAngularVelocity(e.body) * TURF_ROLL);
          }
        } else if (e.kind === 'block' && !e.destroyed) {
          const p = e.body.position;
          const dx = p.x - e.home.x,
            dy = p.y - e.home.y;
          if (e.carried && (dx * dx + dy * dy > 3 || Math.abs(e.body.angle - e.home.angle) > 0.045))
            this.wakeBearings(e);
          if (Math.abs(e.body.angle - e.home.angle) > 0.55 || dx * dx + dy * dy > 23 * 23) this.markDestroyed(e);
        }
      }
      if (this.orcsRemaining === 0 && !this.cleared) {
        if (this.time >= this.clearAt) {
          this.cleared = true;
          this.events.push({ type: 'clear', x: 900, y: 280, strength: 0.8 });
        }
      }
      if (this.ticks % 12 === 0) this.resting = this.canRest();
    }
    if (!wasResting) for (const e of this.entities.values()) this.sync(e);
  }

  sync(e) {
    e.x = e.body.position.x;
    e.y = e.body.position.y;
    e.angle = e.body.angle;
  }

  wakeBearings(e) {
    const carried = e.carried;
    e.carried = null;
    for (const upper of carried) {
      if (!this.entities.has(upper.id)) continue;
      if (upper.body.isSleeping) Sleeping.set(upper.body, false);
      if (upper.rig && this.guards.has(upper)) wakeGuardRig(this, upper);
      if (upper.carried) this.wakeBearings(upper);
    }
  }

  wakeWard(x) {
    this.resumePhysics();
    // In a high-rise, activate bodies at the contact, the charge or the removed
    // support. A lateral window that covers the whole height wakes unrelated towers.
    if (this.difficulty === 'large') return;
    // A disturbed pier wakes the entire height and width of its ward. Leave
    // distant, disconnected stacks sleeping during a local shower of debris.
    const column = Math.floor(x / 84);
    if (this.wokenColumns.has(column)) return;
    this.wokenColumns.add(column);
    const middle = (column + 0.5) * 84;
    for (const e of this.entities.values()) {
      if (Math.abs(e.body.position.x - middle) > 210) continue;
      if (e.body.sleepCounter) Sleeping.set(e.body, false);
      if (e.rig) wakeGuardRig(this, e);
    }
  }

  collisions(pairs) {
    for (const pair of pairs) {
      const { collision } = pair;
      const a = collision.parentA,
        b = collision.parentB;
      const ea = a.plugin.fortress,
        eb = b.plugin.fortress;
      const contact = collision.supports[0];
      const va = pointVelocity(a, contact),
        vb = pointVelocity(b, contact);
      const n = collision.normal;
      const speed = Math.abs((va.x - vb.x) * n.x + (va.y - vb.y) * n.y);
      if (a.isSensor || b.isSensor) {
        const torch = a.isSensor ? ea : eb,
          other = a.isSensor ? eb : ea;
        if (torch?.lit && other && other.id !== torch.hostId && (other.kind === 'projectile' || speed > 2))
          this.extinguish(torch);
        continue;
      }
      ea?.contacts?.add(pair);
      eb?.contacts?.add(pair);
      if (ea?.implosionRadius) ea.fuse = this.time;
      if (eb?.implosionRadius) eb.fuse = this.time;
      if (ea?.flameRadius || eb?.flameRadius) {
        const shot = ea?.flameRadius ? ea : eb,
          target = shot === ea ? eb : ea;
        shot.fuse = this.time;
        // A long plank's center can stand behind a shield even when its
        // exposed tip receives a direct hit. Contact always lights that piece.
        if (target && (target.material === 'wood' || target.kind === 'barrel')) this.ignite(target);
      }
      if (ea && eb && (speed >= 1.4 || ea.kind === 'projectile' || eb.kind === 'projectile')) {
        this.wakeWard(contact.x);
        if (this.difficulty === 'large') {
          if (a.isSleeping) Sleeping.set(a, false);
          if (b.isSleeping) Sleeping.set(b, false);
        }
      }
      if (speed < 0.9) continue;
      for (const [e, other, otherBody] of [
        [ea, eb, b],
        [eb, ea, a],
      ]) {
        if (!e) continue;
        const energy = speed * Math.sqrt(Math.min(otherBody.mass, 12) / Math.max(0.38, e.body.mass));
        if (e.kind === 'block') {
          // The solver transfers the projectile's full momentum. A rounded shot
          // pushes a whole support more readily than it cuts through the stone.
          const bluntShot = other?.kind === 'projectile' && (!other.blast || this.remoteBombs.has(other));
          this.hit(e, energy * (bluntShot ? MATERIALS[e.material].bluntDamage : 1), contact);
        } else if (e.kind === 'fragment' && e.material === 'stone') {
          this.hitStoneFragment(e, other, otherBody, speed, contact);
        } else if (
          e.kind === 'orc' &&
          (speed > 3.8 || (energy > 3 && (other?.kind === 'block' || other?.kind === 'projectile')))
        ) {
          this.faint(e);
        } else if (
          (e.kind === 'barrel' && (energy > 4 || other?.kind === 'projectile')) ||
          (e.blast && !this.remoteBombs.has(e))
        ) {
          e.fuse = Math.min(e.fuse, this.time + (e.blast ? 0.025 : 0.13));
        }
        if (speed > 2.5 && e.kind === 'projectile' && this.time - e.lastImpact > 0.18) {
          const impact = this.emit('impact', other || e, speed / 10, contact);
          impact.size = e.radius * 2;
          if (!other) impact.material = 'earth';
          e.lastImpact = this.time;
        }
      }
    }
  }

  hitStoneFragment(e, other, otherBody, speed, point) {
    if (this.time - e.born < 0.075) return;
    // Only the closing speed and the collision partner's effective mass can
    // drive a crack. A soft plank or a pebble yields under the same blow.
    const hardness = !other ? 0.88 : other.material === 'steel' || other.material === 'stone' ||
      other.kind === 'projectile' ? 1 : 0.59;
    const massShare = otherBody.isStatic ? 1 : otherBody.mass / (e.body.mass + otherBody.mass);
    this.crackStone(e, speed * Math.sqrt(massShare) * hardness, point);
  }

  crackStone(e, shock, point) {
    if (e.body.area < MIN_BREAKABLE_RUBBLE_AREA || (e.generation || 0) >= MAX_RUBBLE_GENERATION ||
        shock < 2.8 + 5 / Math.sqrt(e.body.area) || (e.rockHit && e.rockHit.shock >= shock)) return;
    const dx = point.x - e.body.position.x, dy = point.y - e.body.position.y;
    const c = Math.cos(e.body.angle), s = Math.sin(e.body.angle);
    e.rockHit = { x: dx * c + dy * s, y: dy * c - dx * s, shock, contact: point.blast ? point : null };
    this.work.add(e);
  }

  hit(e, energy, point) {
    const threshold = MATERIALS[e.material].toughness * (1 - 0.68 * e.burn);
    if (energy < threshold * 0.32) return;
    this.damageBlock(e, (energy / threshold - 0.28) * 1.12, point);
    if (e.material === 'steel' && !e.bend && e.damage > 0.25 && e.damage < 1) {
      e.bend = (point.x < e.body.position.x ? -1 : 1) * clamp(e.damage, 0.28, 0.85);
      this.work.add(e);
    }
    if (e.damage >= 1) {
      if (point.blast) e.blastContact = point;
      this.work.add(e);
    }
  }

  damageBlock(e, amount, point) {
    this.resumePhysics();
    const previous = e.damage;
    e.damage = Math.min(1, previous + amount);
    const delta = e.damage - previous;
    if (e.damage < 1 && delta >= 0.15) {
      const event = this.emit('damage', e, delta, point);
      event.damage = delta;
      event.size = e.weight;
    }
  }

  checkLoads() {
    // Propagate mass down the current contact graph. A beam's unsupported
    // span determines its bending moment after a pier is knocked away.
    const supports = new Map(),
      carried = new Map();
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive || pair.isSensor || Math.abs(pair.collision.normal.y) < 0.64) continue;
      const { parentA: a, parentB: b, supports: contacts, supportCount } = pair.collision;
      const upper = a.position.y < b.position.y ? a : b;
      const lower = upper === a ? b : a;
      const up = upper.plugin.fortress;
      if (!up) continue;
      // Rolling resistance matters at the end of a slide. Apply it once per
      // sample, only while loose debris is bearing on an already steady surface.
      if ((lower.isStatic || lower.isSleeping) && Math.abs(pair.collision.normal.y) > 0.94 &&
          !upper.isSleeping && !up.rig && (up.kind !== 'block' || up.destroyed) &&
          (up.kind !== 'torch' || !up.lit) && upper.speed < 0.48 &&
          Math.abs(upper.angularVelocity) * Math.max(up.width, up.height) < 0.8 &&
          up.gripTick !== this.ticks) {
        const tick = this.ticks;
        const quiet = upper.speed < 0.085 && Math.abs(upper.angularVelocity) * Math.max(up.width, up.height) < 0.12;
        up.quietSamples = quiet ? (up.gripTick === tick - 12 ? up.quietSamples + 1 : 1) : 0;
        up.gripTick = tick;
        const v = Body.getVelocity(upper);
        Body.setVelocity(upper, { x: v.x * 0.86, y: v.y });
        Body.setAngularVelocity(upper, Body.getAngularVelocity(upper) * 0.82);
        if (up.quietSamples >= 5) Sleeping.set(upper, true);
      }
      const links = supports.get(up.id) || [];
      const x = supportCount === 2 ? (contacts[0].x + contacts[1].x) / 2 : contacts[0].x;
      links.push({ e: lower.plugin.fortress, x });
      supports.set(up.id, links);
    }
    if (!supports.size) return;
    const byHeight = [];
    for (const e of this.entities.values()) if (supports.has(e.id)) byHeight.push(e);
    byHeight.sort((a, b) => a.body.position.y - b.body.position.y);
    for (const e of byHeight) {
      const load = carried.get(e.id) || 0,
        base = supports.get(e.id);
      for (const support of base) {
        if (support.e)
          carried.set(support.e.id, (carried.get(support.e.id) || 0) + (e.body.mass + load) / base.length);
      }
      if (!load || !base.length) continue;
      if (e.body.isSleeping && !e.burning) continue;
      if (e.kind === 'orc' && load > e.body.mass * 2.2) this.faint(e);
      if (e.kind !== 'block' || !['wood', 'steel'].includes(e.material)) continue;
      const section = (1 - 0.84 * e.burn) ** 2;
      if (e.width < 2 * e.height) {
        if (e.burning && e.height > e.width && load > ((3.5 * e.width ** 2) / e.height) * section) {
          this.damageBlock(e, 0.16, e.body.position);
          if (e.damage >= 1) this.work.add(e);
        }
        continue;
      }
      const middle = e.body.position.x;
      const left = Math.min(...base.map((p) => p.x)),
        right = Math.max(...base.map((p) => p.x));
      const eccentricity = Math.max(0, left - middle, middle - right);
      let span = e.width;
      if (this.difficulty === 'large' && base.length > 1) {
        const seats = base.map((seat) => seat.x).sort((a, b) => a - b);
        span = Math.max(seats[0] - (middle - e.width / 2), middle + e.width / 2 - seats.at(-1));
        for (let i = 1; i < seats.length; i++) span = Math.max(span, seats[i] - seats[i - 1]);
      }
      const moment = load * (0.09 * span * span / e.width + eccentricity);
      const capacity = e.height ** 2 * (e.material === 'steel' ? 2.25 : 1.05) * section;
      if (moment > capacity)
        this.hit(e, (0.33 + 0.12 * Math.min(3, moment / capacity)) * MATERIALS[e.material].toughness, {
          x: left,
          y: e.body.position.y,
        });
    }
  }

  resolveDamage() {
    for (const e of this.work) {
      if (!this.entities.has(e.id)) continue;
      if (e.rockHit) this.fractureStone(e);
      else if (e.damage >= 1) this.fracture(e);
      else if (e.bend) this.bendGirder(e);
    }
    this.work.clear();
  }

  bendGirder(e) {
    // Switch the contact geometry to two rigid flanges meeting at a plastic
    // hinge. The deformed profile continues to carry load until it fractures.
    const horizontal = e.width > e.height,
      length = Math.max(e.width, e.height);
    const thickness = Math.min(e.width, e.height),
      body = e.body;
    const angle = body.angle + (horizontal ? 0 : Math.PI / 2),
      fold = e.bend * 0.13;
    const parts = [-1, 1].map((side) => {
      const a = angle - side * fold;
      return Bodies.rectangle(
        body.position.x + (side * Math.cos(a) * length) / 4,
        body.position.y + (side * Math.sin(a) * length) / 4,
        length / 2,
        thickness,
        { angle: a, density: MATERIALS.steel.density },
      );
    });
    Body.setParts(body, [body, ...parts]);
  }

  faint(e) {
    if (e.fainted) return;
    e.fainted = true;
    this.orcsRemaining--;
    this.emit('faint', e, 0.6);
    if (!this.orcsRemaining) {
      this.winningCost = this.spent;
      this.clearAt = this.time + 0.7;
    }
    e.body.collisionFilter.mask = 0;
    this.remove(e);
  }

  disintegrate(e, type) {
    this.wakeWard(e.body.position.x);
    const size = Math.sqrt(e.width * e.height);
    const dust = this.emit(type, e, clamp(size / 36, 0.2, 1));
    Object.assign(dust, { id: e.id, size, width: e.width, height: e.height, angle: e.body.angle });
    this.remove(e);
  }

  markDestroyed(e) {
    if (e.kind !== 'block' || e.destroyed) return;
    e.destroyed = true;
    this.lostWeight += e.weight;
  }

  remove(e) {
    this.resumePhysics();
    if (e.supportedDecks) for (const deck of e.supportedDecks) {
      if (this.entities.has(deck.id)) Sleeping.set(deck.body, false);
    }
    if (e.rig && this.guards.has(e)) removeGuardRig(this, e);
    if (e.kind === 'block' || e.kind === 'fragment') {
      if (e.carried) this.wakeBearings(e);
      if (this.difficulty === 'large') {
        const removed = e.body.bounds;
        for (const other of this.entities.values()) {
          if (!other.body.isSleeping || other.body.isStatic) continue;
          const b = other.body.bounds;
          if (b.max.x < removed.min.x - 1 || b.min.x > removed.max.x + 1 ||
              b.min.y > removed.max.y + 1 || b.max.y < removed.min.y - 1) continue;
          Sleeping.set(other.body, false);
        }
      }
      for (const guard of this.guards) if (guard.rig.resting && guard.rig.support === e.body) wakeGuardRig(this, guard);
    }
    if (e.kind === 'torch') e.lit = false;
    if (e.kind === 'projectile') {
      this.projectiles.delete(e);
      this.remoteBombs.delete(e);
    }
    this.markDestroyed(e);
    Composite.remove(this.engine.world, e.body);
    this.entities.delete(e.id);
  }

  explode(source) {
    this.wakeWard(source.body.position.x);
    const origin = { ...source.body.position },
      fireball = Boolean(source.flameRadius);
    if (source.implosionRadius) {
      this.remove(source);
      const radius = source.implosionRadius;
      const twist = (this.blastRandom() - 0.5) * 0.16;
      this.implosions.push({ ...origin, radius, twist, start: this.ticks, crushed: new Set() });
      this.events.push({ type: 'implosion', ...origin, material: source.material, radius, strength: 1 });
      return;
    }
    const radius = source.flameRadius || source.blast || 125;
    this.events.push({
      type: fireball ? 'fireburst' : 'explosion',
      ...origin,
      radius,
      material: source.material,
      strength: fireball ? 1 : radius / 158,
    });
    this.remove(source);
    // Snapshot what the wave can reach. A new fragment only meets a second wave
    // if another charge goes off. Nearby cover still protects the far side while it breaks.
    const targets = this.bodies.filter(({ body: { bounds } }) =>
      bounds.max.x >= origin.x - radius && bounds.min.x <= origin.x + radius &&
      bounds.max.y >= origin.y - radius && bounds.min.y <= origin.y + radius);
    const walls = targets.filter((e) => e.kind === 'block' && (e.material === 'stone' || e.material === 'steel'));
    const waveAngle = this.blastRandom() * 2 * Math.PI;
    const ripple = this.blastRandom() * 2 * Math.PI;
    for (const e of targets) {
      let body = e.body;
      const nearestX = clamp(origin.x, body.bounds.min.x, body.bounds.max.x);
      const nearestY = clamp(origin.y, body.bounds.min.y, body.bounds.max.y);
      const distance = Math.hypot(origin.x - nearestX, origin.y - nearestY);
      if (distance >= radius) continue;
      const contact = fireball ? body.position : blastContact(body, origin);
      if (!fireball && contact.distance >= radius) continue;
      const angle = fireball ? 0 : Math.atan2(contact.outY, contact.outX);
      const variation = fireball ? 1 : 1 + 0.065 * Math.cos(3 * angle + waveAngle) + 0.035 * Math.sin(5 * angle + ripple);
      let strength = (1 - (fireball ? distance : contact.distance) / radius) * variation,
        heatTransmission = 1;
      if (this.hills.some((hill) => shieldsBlast(hill, origin, contact))) strength *= 0.25;
      for (const wall of walls) {
        if (wall !== e && shieldsBlast(wall.body, origin, contact)) {
          strength *= fireball ? 0.65 : 0.55;
          heatTransmission *= 0.45;
        }
      }
      if (e.kind === 'torch' && e.lit) {
        if (fireball) continue;
        this.extinguish(e);
        body = e.body;
      }
      if (e.material === 'wood' || e.kind === 'barrel') {
        e.heat = Math.min(1, e.heat + strength * heatTransmission * (fireball ? 1.65 : 1.05));
        if (e.heat >= 0.69) this.ignite(e);
      }
      const dx = body.position.x - origin.x,
        dy = body.position.y - origin.y;
      const len = Math.hypot(dx, dy) || 1,
        kick = (strength * (fireball ? 1.1 : radius / 11)) / (1 + body.mass * 0.12);
      const velocity = Body.getVelocity(body);
      const pushX = fireball ? dx / len : contact.outX, pushY = fireball ? dy / len : contact.outY;
      if (!body.isStatic) {
        if (this.difficulty === 'large' && body.isSleeping && kick > 0.025) Sleeping.set(body, false);
        Body.setVelocity(body, { x: velocity.x + kick * pushX, y: velocity.y + kick * (pushY - 0.3) });
        const lever = (contact.x - body.position.x) * pushY - (contact.y - body.position.y) * pushX;
        const turn = fireball ? 0 : clamp(lever * kick * body.inverseInertia * body.mass, -0.35, 0.35);
        Body.setAngularVelocity(
          body,
          Body.getAngularVelocity(body) + turn + (this.random() - 0.5) * strength * (fireball ? 0.03 : 0.1),
        );
      }
      if (fireball) continue;
      const core = strength * strength * strength;
      if (e.kind === 'block') {
        const damageScale = source.kind === 'projectile' ? 0.13 : 0.17;
        this.hit(e, radius * (strength * damageScale + core * 0.065), contact);
      } else if (e.kind === 'fragment' && e.material === 'stone') {
        this.crackStone(e, radius * 0.095 * core, contact);
      } else if (e.kind === 'projectile' && (e.material === 'small-stone' || e.material === 'big-stone') &&
                 radius * core > e.radius * 3.1) {
        this.emit('fracture', e, strength, contact).material = 'stone';
        splitShot(this, e);
      } else if (e.kind === 'orc' && strength > 0.29) this.faint(e);
      else if (e.kind === 'barrel' && strength > 0.1)
        e.fuse = Math.min(e.fuse, this.time + 0.1 + 0.18 * (1 - strength));
      else if ((e.blast || e.implosionRadius) && !this.remoteBombs.has(e)) e.fuse = Math.min(e.fuse, this.time + 0.07);
    }
    if (!fireball) this.excavate(origin, radius);
  }

  pullInward() {
    // Sample the short-lived field at 40 Hz. Newly broken pieces join the pull,
    // and their actual collisions carry the collapse into neighboring rooms.
    for (let i = this.implosions.length - 1; i >= 0; i--) {
      const field = this.implosions[i], age = this.ticks - field.start;
      if (age > 42) { this.implosions.splice(i, 1); continue; }
      if (age % 3 !== 1) continue;
      const pulse = Math.sin(Math.PI * (age + 2) / 45);
      for (const e of this.entities.values()) {
        const body = e.body;
        const dx = field.x - body.position.x, dy = field.y - body.position.y;
        if (Math.abs(dx) >= field.radius || Math.abs(dy) >= field.radius) continue;
        const distance = Math.hypot(dx, dy);
        if (distance >= field.radius) continue;
        if (e.kind === 'torch' && e.lit) this.extinguish(e);
        const pulled = e.body;
        if (pulled.isStatic) continue;
        if (pulled.isSleeping) Sleeping.set(pulled, false);
        const falloff = 1 - distance / field.radius;
        const speed = 2 * pulse * falloff / (1 + pulled.mass * 0.075);
        const soften = Math.max(distance, 14);
        const drag = 1 - pulse * falloff * 0.18;
        const v = Body.getVelocity(pulled);
        Body.setVelocity(pulled, {
          x: v.x * drag + (dx - dy * field.twist) * speed / soften,
          y: v.y * drag + (dy + dx * field.twist) * speed / soften,
        });
        if (age < 16 || falloff < 0.58 || field.crushed.has(e.id)) continue;
        field.crushed.add(e.id);
        if (e.kind === 'orc' && falloff > 0.82) this.faint(e);
        else if (e.kind === 'block' || (e.kind === 'fragment' && e.material === 'stone')) {
          const point = blastContact(pulled, field);
          point.outX = -point.outX;
          point.outY = -point.outY;
          if (e.kind === 'block') this.hit(e, 21 * falloff * falloff, point);
          else this.crackStone(e, 9 * falloff * falloff, point);
        }
      }
    }
  }

  fracture(e) {
    this.wakeWard(e.body.position.x);
    const body = e.body,
      w = e.width / 2,
      h = e.height / 2;
    const dx = (this.random() - 0.5) * w * 0.48,
      dy = (this.random() - 0.5) * h * 0.48;
    const A = { x: -w, y: -h },
      B = { x: w, y: -h },
      C = { x: w, y: h },
      D = { x: -w, y: h };
    let shapes;
    if (e.material === 'wood' || e.material === 'steel') {
      if (w >= h) {
        const u = { x: dx - w * 0.1, y: -h },
          v = { x: dx + w * 0.1, y: h };
        shapes = [
          [A, u, v, D],
          [u, B, C, v],
        ];
      } else {
        const u = { x: -w, y: dy - h * 0.1 },
          v = { x: w, y: dy + h * 0.1 };
        shapes = [
          [A, B, v, u],
          [u, v, C, D],
        ];
      }
    } else {
      const hub = { x: dx, y: dy };
      shapes = [
        [A, B, hub],
        [B, C, hub],
        [C, D, hub],
        [D, A, hub],
      ];
    }
    const event = this.emit('fracture', e, Math.min(1, 0.35 + e.weight / 65), e.blastContact);
    event.size = e.weight;
    event.damage = e.damage;
    this.makeFragments(e, shapes, 0);
  }

  fractureStone(e) {
    const hit = e.rockHit;
    const body = e.body;
    const c = Math.cos(body.angle), s = Math.sin(body.angle);
    const vertices = e.vertices || body.vertices.map((p) => {
      const dx = p.x - body.position.x, dy = p.y - body.position.y;
      return { x: dx * c + dy * s, y: dy * c - dx * s };
    });
    const shapes = splitStone(vertices, hit);
    const point = hit.contact || pointOnBody(body, hit.x, hit.y);
    const event = this.emit('fracture', e, Math.min(1, hit.shock / 12), point);
    Object.assign(event, { secondary: true, id: e.id, size: Math.sqrt(body.area), damage: 1 });
    this.wakeWard(body.position.x);
    this.makeFragments(e, shapes, (e.generation || 0) + 1);
  }

  makeFragments(e, shapes, generation) {
    const body = e.body;
    const inset = generation ? 0.985 : 0.96;
    this.remove(e);
    for (const shape of shapes) {
      const center = Vertices.centre(shape),
        p = pointOnBody(body, center.x, center.y);
      const local = shape.map((q) => ({ x: (q.x - center.x) * inset, y: (q.y - center.y) * inset }));
      const props = MATERIALS[e.material];
      const piece = Bodies.fromVertices(p.x, p.y, [local], {
        density: props.density,
        friction: props.friction,
        restitution: 0.07,
        slop: 0.025,
      });
      Body.setAngle(piece, body.angle);
      const v = pointVelocity(body, p);
      const spread = e.material === 'glass' ? 0.055 : 0.02;
      Body.setVelocity(piece, {
        x: v.x + (p.x - body.position.x) * spread,
        y: v.y + (p.y - body.position.y) * spread,
      });
      Body.setAngularVelocity(piece, Body.getAngularVelocity(body) + (generation ? 0 : (this.random() - 0.5) * 0.09));
      const width = Math.max(...local.map((q) => q.x)) - Math.min(...local.map((q) => q.x));
      const height = Math.max(...local.map((q) => q.y)) - Math.min(...local.map((q) => q.y));
      const fragment = this.add('fragment', e.material, p.x, p.y, width, height, 'debris', {}, piece);
      fragment.vertices = local;
      fragment.generation = generation;
      fragment.burning = e.burning;
      fragment.burn = e.burn;
      fragment.ignitedAt = e.ignitedAt;
    }
  }
}
