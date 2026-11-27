import Matter from './vendor/matter.min.js';
import { roofVertices, selectRoofs } from './roofs.js';
import { FORTRESS_STYLES, planArchitecture } from './architecture.js';
import { createGuardDefense, splitShot } from './guard-fire.js';
import { addGuardRig, balanceGuards, removeGuardRig, wakeGuardRig } from './guard-rig.js';
import { chooseMaterialProfile, planMaterials } from './material-profile.js';
import { buildJoints, releaseJoint, updateJoints } from './joints.js';

const { Bodies, Body, Composite, Engine, Events, Sleeping, Vertices } = Matter;

export const WORLD = {
  width: 1200, height: 480, ground: 389, minX: -115, maxX: 1625,
  release: { x: 40, y: 326 }, rightRelease: { x: 1470, y: 326 },
};
const terrainStart = { x: -1000, y: WORLD.ground };
const terrainEnd = { x: 2200, y: WORLD.ground };

const RELOAD_SECONDS = 0.2;
const SIEGE_BLAST_RADIUS = 205;

export const AMMO = [
  { id: 'small-stone', name: 'Small stone', cost: 10, radius: 9, density: 0.012 },
  { id: 'big-stone', name: 'Big stone', cost: 22, radius: 15, density: 0.013 },
  { id: 'small-bomb', name: 'Small bomb', cost: 35, radius: 10, density: 0.009, blast: 103 },
  { id: 'big-bomb', name: 'Big bomb', cost: 60, radius: 15, density: 0.012, blast: 158 },
  { id: 'fireball', name: 'Fireball', cost: 45, radius: 11, density: 0.0027, flameRadius: 112 },
  {
    id: 'siege-bomb',
    name: 'Siege bomb',
    cost: 90,
    radius: 19,
    density: 0.012,
    launchScale: 0.74,
    blast: SIEGE_BLAST_RADIUS,
    remote: true,
  },
  { id: 'magic-bomb', name: 'Magic bomb', cost: 110, radius: 13, density: 0.006, implosionRadius: 168,
    burstRadius: SIEGE_BLAST_RADIUS * 1.2, remote: true },
].map((ammo) => ({ ...ammo, reload: RELOAD_SECONDS }));

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

// Smoothstep shoulders meet the pads horizontally. The maximum grade is
// 1.5 times the average grade (about 31 degrees with this limit).
const SHOULDER_GRADE = 0.4;
function terrainShoulder(points, start, end, targetY) {
  const last = points.at(-1),
    run = end - start;
  const rise = clamp(targetY - last.y, -SHOULDER_GRADE * run, SHOULDER_GRADE * run);
  if (start > last.x) points.push({ x: start, y: last.y });
  const segments = Math.abs(rise) < 1 ? 1 : 5;
  for (let n = 1; n <= segments; n++) {
    const t = n / segments;
    points.push({ x: start + run * t, y: last.y + rise * t * t * (3 - 2 * t) });
  }
  return last.y + rise;
}

export const LAYOUT_VERSION = 3;

export function generateLevel(difficulty, seed, version = LAYOUT_VERSION, style = 'random') {
  const small = difficulty === 'small',
    large = difficulty === 'large';
  const index = small ? 0 : large ? 4 : 2;
  const themeIndex = Math.floor(seededRandom(seed ^ 0x51e651ad)() * THEMES.length);
  const sky = seededRandom(seed ^ 0xa45912f1);
  const wind = (sky() < 0.5 ? -1 : 1) * (8 + Math.floor(sky() * 17));
  const front = sky();
  const weather = sky() < 0.52 ? 'clear' : front < 0.38 ? 'snow' : front < 0.73 ? 'rain' : 'storm';
  const gale = weather === 'storm' || (weather === 'clear' && front > 0.88 && Math.abs(wind) >= 20);
  const gust = gale ? {
    strength: (weather === 'storm' ? 57 : 40) + 18 * sky(),
    period: 3.4 + sky() * 3.8,
    phase: sky() * 2 * Math.PI,
  } : null;
  const random = seededRandom(seed ^ Math.imul(index + 1, 0x85ebca6b));
  const integer = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const bays = small ? integer(4, 5) + (version === 1 ? 0 : 1) : large ? integer(11, 12) : integer(7, 8);
  const spans = Array.from({ length: bays }, () => integer(52, large ? 64 : 66));
  const right = (large ? 1122 : small ? 980 : 1064) + integer(-16, 16);
  const storey = large ? integer(47, 51) : integer(46, 52);
  const peak = large ? integer(10, 12) : small ? integer(3, 4) : integer(5, 7);
  const crownWidth = small ? integer(1, 2) : large ? integer(2, 4) : integer(2, 3);
  const crown = clamp(Math.floor((bays - crownWidth) / 2) + integer(-1, 1), 1, bays - crownWidth - 1);
  const eaves = () => large ? integer(4, 6) : small ? integer(1, 2) : integer(2, 3);
  const leftEave = eaves(), rightEave = eaves();
  const architecture = version === 1 ? null : planArchitecture(seededRandom(seed ^ 0xc17ade1), spans, peak, style);
  const heights = architecture?.heights ?? spans.map((_, bay) => {
    const fromLeft = crown - bay, fromRight = bay - (crown + crownWidth - 1);
    if (fromLeft <= 0 && fromRight <= 0) return peak;
    const distance = Math.max(fromLeft, fromRight), depth = fromLeft > 0 ? crown : bays - crown - crownWidth;
    const eave = fromLeft > 0 ? leftEave : rightEave;
    return eave + Math.max(0, Math.round((peak - eave - 2) * (1 - distance / depth)));
  });
  if (architecture) for (const [c, zone] of architecture.zones.entries()) {
    if (zone === 'hall' || zone === 'gallery') spans[c] += 9;
    else if (zone === 'stair' || zone === 'tower') spans[c] = Math.max(54, spans[c] - 4);
  }
  const width = spans.reduce((sum, span) => sum + span, 0);
  const left = right - width, center = left + width / 2;
  const terrain = [{ x: WORLD.minX, y: WORLD.ground }];
  const hill = left - 24;
  const leftToe = Math.max(208, hill - integer(105, 151));
  const base = terrainShoulder(terrain, leftToe, hill,
    WORLD.ground - integer(large ? 22 : 8, large ? 53 : 38));
  terrain.push({ x: right + 25, y: base });
  // Give both approaches a level stretch for the field guards to stand on.
  const rightToe = version >= 3
    ? Math.max(WORLD.width, right + 25 + Math.ceil((WORLD.ground - base) / SHOULDER_GRADE)) : WORLD.width;
  terrainShoulder(terrain, right + 25, rightToe, WORLD.ground);
  terrain.push({ x: WORLD.maxX, y: WORLD.ground });

  const gate = architecture?.gate ?? integer(1, Math.max(1, crown));
  const crest = architecture?.stairBay ?? crown + integer(0, crownWidth - 1);
  const lookouts = version >= 3 && !small
    ? [[0, heights[0], 'left'], [bays - 1, heights[bays - 1], 'right']] : [];
  const crestRow = heights[crest] - integer(0, 1);
  const crestOccupied = lookouts.some(([bay, row]) => bay === crest && row === crestRow);
  const orcs = [[gate, 0], [crest, crestRow - (crestOccupied ? 1 : 0)], ...lookouts];
  const barrels = [];
  // Distribute the rest of the garrison through the wings as well as the keep's crown.
  const guards = small ? 3 : large ? 11 : 6;
  for (let i = 0; orcs.length < guards + lookouts.length; i++) {
    const bay = (integer(0, bays - 1) + i) % bays;
    const row = integer(1 + (architecture?.openFloors[bay] || 0), heights[bay]);
    if (!orcs.some(([c, r]) => c === bay && r === row)) orcs.push([bay, row]);
  }
  const stores = small ? 2 : large ? 5 : 3;
  for (let i = 0; i < stores; i++) {
    const startBay = Math.min(bays - 1, Math.floor((i + random()) * bays / stores));
    const first = integer(1, Math.max(1, heights[startBay] - 1));
    for (let next = 0; next < bays && barrels.length === i; next++) {
      const bay = (startBay + next) % bays;
      for (let offset = 0; offset < heights[bay]; offset++) {
        const row = 1 + (first + offset - 1) % heights[bay];
        if (architecture && row <= architecture.openFloors[bay]) continue;
        if (orcs.some(([c, r]) => c === bay && r === row) ||
            barrels.some(([c, r]) => c === bay && r === row)) continue;
        barrels.push([bay, row]);
        break;
      }
    }
  }
  const ward = { left, center, base, spans, heights, storey, orcs, barrels, gate,
    style: 'keep', ...architecture, pattern: integer(0, 30000) };
  if (version >= 3) {
    const postRandom = seededRandom(seed ^ 0x3ca4d97);
    const distance = (minimum) => minimum + Math.floor(postRandom() * 11);
    const leftPost = leftToe - distance(22), rightPost = rightToe + distance(22);
    ward.outposts = [leftPost, rightPost];
    if (large) ward.outposts.push(leftPost - distance(49), rightPost + distance(49));
  }
  const rooms = heights.reduce((n, h, bay) => n + h - (architecture?.openFloors[bay] || 0), 0);
  const extraGuards = lookouts.length + (ward.outposts?.length ?? 0);
  const par = 5 * Math.round(((small ? 50 : large ? 170 : 100) + rooms * 1.5) / 5) + extraGuards * AMMO[0].cost;
  const angle = large ? 24 : 38;
  const dx = ward.left - WORLD.release.x,
    dy = ward.base - ward.storey * 0.77 - WORLD.release.y;
  const aim = { angle, power: 25 };
  const initialDrift = gust && windDrift(wind, gust, 0, new Float64Array(FORECAST_STEPS + 1));
  let closest = Infinity;
  for (let p = 25; p <= 100; p++) {
    const v = launchVelocity(angle, p, undefined, large),
      t = flightTime(dx, v.x, wind, initialDrift);
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
    version,
    ...(version >= 3 && { materialProfile: chooseMaterialProfile(seededRandom(seed ^ 0x734c17b5)) }),
    themeIndex,
    seed,
    sections: [ward],
    catapults: { left: WORLD.release, right: WORLD.rightRelease },
    walls: [],
    terrain,
    par,
    phase,
    weather,
    gust,
    wind,
    aim,
  };
}

const STEP = 1 / 120;
const RELOAD_TICKS = Math.round(RELOAD_SECONDS / STEP);
const FLIGHT_SAMPLE_TICKS = 6;
export const FLIGHT_SAMPLE_SECONDS = STEP * FLIGHT_SAMPLE_TICKS;
const FORECAST_STEPS = 600;
const TURF_ROLL = Math.exp(-2.4 * STEP);
const GRAVITY = 680;
const ROOF = 13;
const MIN_BREAKABLE_RUBBLE_AREA = 65;
const MAX_BLAST_DUST_AREA = 320;
const BLAST_DUST_RESISTANCE = { glass: 0.55, stone: 1, wood: 1.75 };
const MAX_RUBBLE_GENERATION = 2;
const MATERIALS = {
  stone: { density: 0.0028, toughness: 10, bluntDamage: 0.7, friction: 0.76, skidFriction: 0.68, rebound: 0.27 },
  wood: { density: 0.0011, toughness: 6.2, bluntDamage: 0.86, friction: 0.83, skidFriction: 0.78, rebound: 0.06 },
  glass: { density: 0.0016, toughness: 2.8, bluntDamage: 1.22, friction: 0.66, skidFriction: 0.20, rebound: 0.12 },
  steel: { density: 0.0038, toughness: 15, bluntDamage: 0.58, friction: 0.7, skidFriction: 0.24, rebound: 0.48 },
};
const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
const ammoById = new Map(AMMO.map((ammo) => [ammo.id, ammo]));


function launchSpeed(draw, large) {
  // The large-fortress engine has a longer draw for clearing the rear keep.
  // A progressive boost at full extension preserves short, precise low shots.
  const reserve = large ? 270 * (Math.max(0, draw - 70) / 30) ** 2 : 0;
  return 250 + 6.1 * draw + reserve;
}

function launchVelocity(angle, power, ammo, large = false) {
  const radians = (clamp(angle, 5, 85) * Math.PI) / 180;
  const speed = launchSpeed(clamp(power, 1, 100), large) * (ammo?.launchScale ?? 1);
  return { x: Math.cos(radians) * speed, y: -Math.sin(radians) * speed };
}

function windAt(wind, gust, tick) {
  if (!gust) return wind;
  const phase = tick * STEP * 2 * Math.PI / gust.period + gust.phase;
  const pulse = 0.5 - 0.5 * Math.cos(phase);
  const envelope = 0.83 + 0.17 * Math.sin(phase * 0.37);
  return wind + Math.sign(wind) * gust.strength * (0.14 + 0.86 * pulse * pulse) * envelope;
}

function windDrift(wind, gust, startTick, offsets) {
  // Every shot launched on this tick shares the same horizontal wind integral.
  let velocity = 0;
  for (let step = 1; step < offsets.length; step++) {
    velocity += windAt(wind, gust, startTick + step) * STEP;
    offsets[step] = offsets[step - 1] + velocity * STEP;
  }
  return offsets;
}

function flightTime(dx, vx, wind, drift, direction = 1) {
  if (drift) {
    const x = (step) => step * STEP * vx + direction * drift[step];
    let lo = 0, hi = drift.length - 1;
    if (wind < 0 && x(hi) < x(hi - 1)) {
      // A headwind can turn a very steep, low-power shot back toward the sling.
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (x(mid + 1) > x(mid)) lo = mid + 1;
        else hi = mid;
      }
      lo = 0;
    }
    if (x(hi) < dx) return Infinity;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (x(mid) < dx) lo = mid;
      else hi = mid;
    }
    const run = x(hi) - x(lo);
    return (lo + (run ? (dx - x(lo)) / run : 0)) * STEP;
  }
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

function localPoint(body, point) {
  const x = point.x - body.position.x, y = point.y - body.position.y;
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return { x: x * c + y * s, y: y * c - x * s };
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

// Reactions split between the two seats bracketing a load. A pier that
// lines up with a bearing transfers its weight there without flexing a span.
function transferWeight(piece, seats, carried, pressure) {
  seats.sort((a, b) => a.x - b.x);
  for (const seat of seats) {
    seat.mass = 0;
    seat.moment = 0;
  }
  let leftOverhang = 0, rightOverhang = 0;
  const loads = pressure.get(piece.id) ?? [];
  loads.push({ x: piece.body.position.x, mass: piece.body.mass });
  for (const { x, mass } of loads) {
    const next = seats.findIndex((seat) => seat.x >= x);
    if (next < 0) {
      const last = seats.at(-1);
      last.mass += mass;
      rightOverhang += mass * (x - last.x);
    } else if (next === 0) {
      seats[0].mass += mass;
      leftOverhang += mass * (seats[0].x - x);
    } else {
      const left = seats[next - 1], right = seats[next];
      const fraction = (x - left.x) / (right.x - left.x);
      left.mass += mass * (1 - fraction);
      right.mass += mass * fraction;
      // Broad contact faces distribute a load over some of the clear span.
      left.moment += 0.40 * mass * (x - left.x) * (1 - fraction);
    }
  }
  let maximum = Math.max(leftOverhang, rightOverhang);
  for (const seat of seats) {
    maximum = Math.max(maximum, seat.moment);
    if (!seat.e || !seat.mass) continue;
    const key = seat.e.id;
    carried.set(key, (carried.get(key) || 0) + seat.mass);
    let below = pressure.get(key);
    if (!below) pressure.set(key, below = []);
    below.push({ x: seat.x, mass: seat.mass });
  }
  return maximum;
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

// Sources are entered in insertion order in each band their bounds can reach.
// Looking up a target band keeps the same candidates as a full contact scan.
function indexSpan(bands, start, end, piece, bandSize = 64) {
  const last = Math.floor(end / bandSize);
  for (let band = Math.floor(start / bandSize); band <= last; band++) {
    let pieces = bands.get(band);
    if (!pieces) bands.set(band, pieces = []);
    pieces.push(piece);
  }
}

export class FortressSimulation {
  constructor(difficulty = 'small', seed = newSeed(), version = LAYOUT_VERSION, style = 'random') {
    this.loadLevel(difficulty, seed, version, style);
  }

  loadLevel(difficulty = this.difficulty, seed = difficulty === this.difficulty ? this.seed : newSeed(),
            version = this.level?.version ?? LAYOUT_VERSION, style = this.styleChoice ?? 'random') {
    const builder = this.buildLevel(difficulty, seed, version, style);
    let step;
    do step = builder.next(); while (!step.done);
    return step.value;
  }

  // Drive the identical generator a few steps per idle frame when preparing a
  // new siege. A separate simulation owns all collision pairs and callbacks.
  static *prepareLevel(difficulty, seed, version = LAYOUT_VERSION, style = 'random') {
    const sim = Object.create(FortressSimulation.prototype);
    if (yield* sim.buildLevel(difficulty, seed, version, style)) return sim;
  }

  *buildLevel(difficulty, seed, version, style) {
    if (!DIFFICULTIES.some((size) => size.id === difficulty)) return false;
    if (this.engine) {
      Events.off(this.engine);
      Composite.clear(this.engine.world, false);
      Engine.clear(this.engine);
    }
    this.difficulty = difficulty;
    this.seed = seed >>> 0 || 1;
    this.styleChoice = version !== 1 && FORTRESS_STYLES.includes(style) ? style : 'random';
    const level = (this.level = generateLevel(difficulty, this.seed, version, this.styleChoice));
    this.themeIndex = level.themeIndex;
    this.terrain = level.terrain;
    this.terrainVersion = 0;
    this.weatherTick = 0;
    this.forecastTick = -1;
    this.forecast = null;
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
    this.side = 'left';
    this.reloadEnd = { left: 0, right: 0 };
    this.clearAt = Infinity;
    this.cleared = false;
    this.buildTerrain();
    yield* this.buildFort(level.sections[0]);
    this.joints = new Set();
    if (level.materialProfile) {
      const blocks = this.bodies.filter((e) => e.kind === 'block');
      const materials = planMaterials(blocks, level.sections[0], level.materialProfile, seededRandom(this.seed ^ 0x43b837ad));
      for (const [e, material] of materials) {
        if (e.material === material) continue;
        e.material = material;
        Body.setDensity(e.body, MATERIALS[material].density);
        e.body.friction = MATERIALS[material].friction;
      }
      this.joints = buildJoints(blocks);
      Events.on(this.engine, 'beforeUpdate', () => updateJoints(this.joints));
      yield;
    }
    // Let the original load paths settle before measuring displacement for scoring.
    for (let i = 0; i < (difficulty === 'large' ? 300 : difficulty === 'medium' ? 230 : 90); i++) {
      Engine.update(this.engine, STEP * 1000);
      yield;
    }
    for (const e of this.entities.values()) {
      // The large keep is pre-settled before play. Its undisturbed rooms can
      // sleep until an impact, a removed support, or a fire wakes them.
      if (difficulty === 'large') Sleeping.set(e.body, true);
      e.home = { ...e.body.position, angle: e.body.angle };
      this.sync(e);
    }
    if (difficulty === 'large' || level.version >= 3) {
      // Keep the initial bearing contacts, including pairs the solver has put
      // to sleep. A departing pier must wake its ceiling even after that pair expires.
      const pieces = this.bodies.filter((e) => e.kind !== 'torch');
      const seatsByHeight = new Map();
      for (const upper of pieces) {
        const y = upper.body.bounds.max.y;
        indexSpan(seatsByHeight, y - 2.5, y + 2.5, upper, 8);
      }
      for (const lower of pieces) {
        if (lower.kind !== 'block') continue;
        const base = lower.body.bounds;
        const candidates = seatsByHeight.get(Math.floor(base.min.y / 8)) || [];
        const seated = candidates.filter((upper) => {
          const top = upper.body.bounds;
          return upper !== lower && Math.abs(top.max.y - base.min.y) < 2.5 &&
            Math.min(base.max.x, top.max.x) - Math.max(base.min.x, top.min.x) > 1;
        });
        if (difficulty === 'large') lower.carried = seated;
        if (level.version >= 3) for (const upper of seated) {
          if (upper.kind === 'block') (upper.originalSeats ??= []).push(lower);
        }
      }
    }
    this.torches = [];
    this.mountTorches();
    this.defend = createGuardDefense(this, shieldsBlast);
    this.orcsTotal = this.guards.size;
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
    const left = Math.max(WORLD.minX, Math.floor((origin.x - reach) / grid) * grid);
    const right = Math.min(WORLD.maxX, Math.ceil((origin.x + reach) / grid) * grid);
    if (right <= left) return;
    const original = this.terrain;
    const inside = original.filter((p) => p.x >= left && p.x <= right);
    // Use a shared grid for all blasts, preserving the original breakpoints.
    // Repeated impacts can deepen bedrock scars without growing the mesh forever.
    for (let x = Math.ceil(left / grid) * grid; x <= right; x += grid) {
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

  *buildFort(level) {
    const { heights, spans, left, storey, pattern } = level;
    const columns = [left];
    for (const span of spans) columns.push(columns.at(-1) + span);
    const stage = this.difficulty === 'large' ? 4 : this.difficulty === 'medium' ? 2 : 0;
    const highest = Math.max(...heights);
    const flagBay = heights.lastIndexOf(highest);
    const stairBay = level.stairBay ?? heights.indexOf(highest);
    const pitched = selectRoofs(level, flagBay);
    const hasRoom = (bay, row) => heights[bay] > row && row >= (level.openFloors?.[bay] || 0);
    const block = (material, x, y, w, h, detail) => this.add('block', material, x, y, w, h, detail);

    for (let row = 0; row < highest; row++) {
      const base = level.base - row * storey;
      const roofY = base - storey + ROOF / 2;
      for (let c = 0; c < columns.length; c++) {
        const leftRoom = hasRoom(c - 1, row), rightRoom = hasRoom(c, row);
        if (!leftRoom && !rightRoom) continue;
        const outer = !leftRoom || !rightRoom;
        let material = outer ? 'stone' : 'wood';
        if (!outer && (c + row + pattern) % 4 === 2) material = 'glass';
        if (stage >= 2 && (c * 3 + row + pattern) % 5 === 1) material = 'steel';
        if (outer && row > 0 && (c + pattern + row) % 3 === 1) material = 'wood';
        const zone = level.zones?.[rightRoom ? c : c - 1];
        const column = row > 0 && (zone === 'hall' || ((c + pattern) % 3 === 0 || (!stage && c === stairBay)) && row % 3 !== 2);
        if (zone === 'gallery' || zone === 'stair') material = row % 3 === 2 ? 'steel' : 'wood';
        if (zone === 'wall' || level.style === 'citadel' && outer) material = 'stone';
        if (level.style === 'spire' && zone === 'tower') material = !outer && row % 3 === 2 ? 'glass' : 'steel';
        if (row === 0 || column) material = 'stone';
        const h = storey - ROOF;
        if (material === 'stone') {
          // Large towers use coursed foundations and full-height upper piers.
          // Tall stacks of thin, loose courses would settle unevenly under their own weight.
          const courses = column || row >= 3 ? 1 : 2;
          for (let course = 0; course < courses; course++) {
            const width = course === 0 ? 28 : course === courses - 1 && stage ? 29 : 25;
            block('stone', columns[c], base - ((course + 0.5) * h) / courses, width, h / courses,
              column ? 'column' : 'masonry');
          }
        } else {
          block(
            material,
            columns[c],
            base - h / 2,
            material === 'wood' ? 17 : 18,
            h,
            material === 'wood' ? 'beam' : material === 'glass' ? 'pane' : 'girder',
          );
        }
      }
      let supportingLintel;
      for (let c = 0; c < spans.length; c++) {
        if (!hasRoom(c, row)) continue;
        const zone = level.zones?.[c];
        const leftEnd = columns[c] - (hasRoom(c - 1, row) ? -0.35 : 15);
        const tieBay = c - ((c + row + pattern) % 3);
        const tied = stage >= 2 && row % 3 !== 2 && tieBay !== stairBay && tieBay + 1 !== stairBay &&
          tieBay >= 0 && hasRoom(tieBay, row) && hasRoom(tieBay + 1, row) &&
          (c === tieBay || c === tieBay + 1);
        const endBay = tied ? tieBay + 1 : c;
        const rightEnd = columns[endBay + 1] + (hasRoom(endBay + 1, row) ? -0.35 : 15);
        let material =
          stage >= 2 && (c + row + pattern) % 5 === 0 ? 'steel' : (c + row + pattern) % 3 === 0 ? 'stone' : 'wood';
        if (stage === 4 && heights[c] - row >= 3) material = 'stone';
        if (zone === 'gallery' || zone === 'stair') material = 'wood';
        if (zone === 'wall' || level.style === 'citadel') material = 'stone';
        if (level.style === 'spire' && zone === 'tower') material = 'steel';
        // Deep galleries have a second load path from their lintels to the
        // floor. Leave occupied cells and the upper timberwork open.
        const reinforced = row === 0 ? c !== level.gate : zone === 'wall' ||
          zone !== 'gallery' && zone !== 'hall' && stage && row < (stage === 4 ? 4 : 2) && c !== stairBay && (c + pattern) % 2 === 0;
        if (reinforced &&
            !level.orcs.some(([bay, floor]) => bay === c && floor === row) &&
            !level.barrels.some(([bay, floor]) => bay === c && floor === row)) {
          const cx = (columns[c] + columns[c + 1]) / 2;
          const h = storey - ROOF;
          if (row === 0 || zone === 'wall') {
            const width = spans[c] - 32, course = h / 3;
            const bond = row === 0 ? 'brickwork' : 'wall-course';
            block('stone', cx, base - course * 0.5, width, course, bond);
            for (const side of [-1, 1])
              block('stone', cx + side * width / 4, base - course * 1.5, width / 2 - 0.3, course, bond);
            block('stone', cx, base - course * 2.5, width, course, bond);
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
            : material === 'stone' ? 'masonry' : 'beam',
        );
        if (roof) supportingLintel = roof;
        if (roof && c === stairBay && row + 1 < heights[c]) roof.stairs = row % 2 ? 'left' : 'right';
        if (heights[c] !== row + 1) continue;
        const top = base - storey;
        const cap = pitched.get(c);
        if (cap) {
          const height = Math.min(storey * 0.87, cap.width * (cap.type === 'tile' ? 0.43 : 0.57));
          const x = columns[c] + cap.left + cap.width / 2;
          const material = cap.type === 'tile' ? 'wood' : cap.type === 'copper' ? 'steel' : 'stone';
          const piece = block(material, x, top - height / 3, cap.width, height, 'pitched-roof');
          piece.roofType = cap.type;
          piece.vertices = roofVertices(cap.width, height);
          Body.setVertices(piece.body, piece.vertices);
          // A two-bay tie is created with its first bay and also bears the second.
          (supportingLintel.carried ??= []).push(piece);
          continue;
        }
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
      yield;
    }
    for (const [c, row, flank] of level.orcs) {
      const guard = addGuardRig(this, (columns[c] + columns[c + 1]) / 2, level.base - row * storey);
      if (flank) guard.exterior = flank;
    }
    for (const x of level.outposts ?? []) {
      const guard = addGuardRig(this, x, this.terrainHeight(x));
      guard.exterior = x < left ? 'left' : 'right';
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
          e.kind === 'block' && !e.roofType &&
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
          if (this.torches.some((t) => (t.x - p.x) ** 2 + (t.y - p.y) ** 2 < 47 ** 2)) continue;
          const clear = bodies.every(
            (e) =>
              e === host ||
              (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > 135 ** 2 ||
              distanceToBody(e, flame) > (e.material === 'wood' || e.kind === 'barrel' ? 13 : 3),
          );
          if (!clear) continue;
          this.attachTorch(host, offset);
          placed++;
          break;
        }
      }
    };
    const keep = this.level.sections[0];
    let x = keep.left;
    for (const [bay, width] of keep.spans.entries()) {
      mount(x, x + width, 1, keep.pattern + bay * 31, 12);
      x += width;
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
    if (!torch.body.isStatic) return;
    this.resumePhysics();
    if (torch.lit) this.emit('extinguish', torch, 0.6, { x: torch.flameX, y: torch.flameY });
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
      if (!torch.body.isStatic || !this.entities.has(torch.id)) continue;
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
    if (e.wet) e.wet = Math.min(e.wet, 0.45);
    e.ignitedAt = this.time;
    this.emit('ignite', e, 0.7).id = e.id;
    if (e.kind === 'barrel') e.fuse = Math.min(e.fuse, this.time + 0.6);
  }

  heatMaterials() {
    const bodies = this.bodies;
    const flames = this.torches.filter((e) => e.lit);
    const embers = bodies.filter((e) => e.burning && e.burn > 0.12);
    let hotColumns;
    if (embers.length > 8) {
      hotColumns = new Map();
      for (const source of embers) {
        const { min, max } = source.body.bounds;
        indexSpan(hotColumns, min.x - 2, max.x + 2, source);
      }
    }
    for (const e of bodies) {
      if (e.material !== 'wood' && e.kind !== 'barrel') continue;
      if (!e.burning) {
        let heated = flames.some((flame) => {
          const reach = (e.width + e.height) / 2 + 6, p = e.body.position;
          return Math.abs(p.x - flame.flameX) < reach && Math.abs(p.y - flame.flameY) < reach &&
            distanceToBody(e, { x: flame.flameX, y: flame.flameY }) < 6;
        });
        if (!heated && hotColumns) {
          const { min, max } = e.body.bounds;
          for (let col = Math.floor(min.x / 64); !heated && col <= Math.floor(max.x / 64); col++) {
            heated = hotColumns.get(col)?.some((source) => touchingHeatSource(source, e));
          }
        } else if (!heated) heated = embers.some((source) => touchingHeatSource(source, e));
        // A grazing contact cannot set a plank alight. Heat bleeds away when
        // it rolls clear; sustained contact heats a timber or powder barrel.
        e.heat = clamp(e.heat + (heated ? 0.1 - 0.15 * (e.wet || 0) : -0.16), 0, 1);
        if (e.heat < 0.69) continue;
        this.ignite(e);
      }
      e.burn = Math.min(1, e.burn + 0.014 * (1 - 0.8 * (e.wet || 0)));
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

  applyWeather(wind, rain, gale) {
    // Index the current roof and wall positions once per weather sample; an
    // opening left by a collapsing roof admits rain on the next sample.
    const columns = new Map(), targets = [];
    for (const e of this.entities.values()) {
      const soak = rain && ((e.kind === 'torch' && e.lit) || (e.material === 'wood' && (e.burning || e.wet || e.heat)));
      const push = gale && !e.body.isStatic && (e.kind === 'fragment' ||
        (e.kind === 'block' && (e.damage >= 0.3 || e.destroyed || e.burning)));
      if (soak || push) targets.push({ e, soak, push });
    }
    if (!targets.length) return;
    for (const e of this.entities.values()) {
      if (e.kind !== 'block') continue;
      indexSpan(columns, e.body.bounds.min.x, e.body.bounds.max.x, e);
    }
    const openSky = (target, x, y) => {
      const column = columns.get(Math.floor(x / 64));
      if (!column) return true;
      for (const roof of column) {
        const { bounds, vertices } = roof.body;
        if (roof === target || bounds.min.y >= y || x < bounds.min.x || x > bounds.max.x) continue;
        for (let i = 0; i < vertices.length; i++) {
          const a = vertices[i], b = vertices[(i + 1) % vertices.length];
          if ((a.x <= x) === (b.x <= x)) continue;
          if (a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) < y) return false;
        }
      }
      return true;
    };
    for (const { e, soak, push } of targets) {
      const body = e.body, p = body.position, bounds = body.bounds;
      if (soak) {
        const torch = e.kind === 'torch';
        const spread = (bounds.max.x - bounds.min.x) * 0.3;
        const exposure = torch ? Number(openSky(e, e.flameX, e.flameY)) :
          (Number(openSky(e, p.x - spread, p.y)) + Number(openSky(e, p.x + spread, p.y))) / 2;
        const rainfall = this.level.weather === 'storm' ? 0.085 : 0.055;
        e.wet = clamp((e.wet || 0) + exposure * rainfall - (1 - exposure) * 0.018, 0, 1);
        if (e.wet === 1 && (torch || e.burning)) {
          const point = torch ? { x: e.flameX, y: e.flameY } : p;
          this.emit('extinguish', e, 0.35, point).rain = true;
          if (torch) e.lit = false;
          else {
            e.burning = false;
            e.heat = 0;
          }
        }
      }
      if (push) {
        const height = bounds.max.y - bounds.min.y;
        // Grounded rubble that already resists this gust needs no windward
        // visibility check through the rest of the collapsed wall.
        const acceleration = (Math.abs(wind) - 26) * clamp(height * 0.055 / body.mass, 0.09, 3);
        if (e.kind === 'fragment' && body.isSleeping && acceleration < GRAVITY * body.friction &&
            bounds.max.y >= this.terrainHeight(p.x) - 0.5) continue;
        const start = { x: p.x - Math.sign(wind) * (90 + (bounds.max.x - bounds.min.x) / 2), y: p.y };
        let sheltered = false;
        for (let i = Math.floor(Math.min(start.x, p.x) / 64); i <= Math.floor(Math.max(start.x, p.x) / 64); i++) {
          if (columns.get(i)?.some((wall) => wall !== e && shieldsBlast(wall.body, start, p))) {
            sheltered = true;
            break;
          }
        }
        if (sheltered) continue;
        this.resumePhysics();
        if (body.isSleeping) Sleeping.set(body, false);
        Body.applyForce(body, { x: p.x, y: p.y - height * 0.22 },
          { x: Math.sign(wind) * 12 * body.mass * acceleration / 1e6, y: 0 });
      }
    }
  }

  get bodies() {
    return Array.from(this.entities.values());
  }

  selectSide(side) {
    if (side === this.side || (side !== 'left' && side !== 'right') || this.remoteBombs.size) return false;
    this.side = side;
    return true;
  }

  get release() {
    return this.level.catapults[this.side];
  }

  recovery(side) {
    return clamp(1 - (this.reloadEnd[side] - this.ticks) / RELOAD_TICKS, 0, 1);
  }

  get stats() {
    const reloadRemaining = Math.max(0, this.reloadEnd[this.side] - this.ticks) * STEP;
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
      ready: reloadRemaining === 0 && this.remoteBombs.size === 0,
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

  get wind() {
    return windAt(this.level.wind, this.level.gust, this.weatherTick);
  }

  forecastDrift() {
    if (!this.level.gust) return null;
    if (this.forecastTick !== this.weatherTick) {
      this.forecast ||= new Float64Array(FORECAST_STEPS + 1);
      windDrift(this.level.wind, this.level.gust, this.weatherTick, this.forecast);
      this.forecastTick = this.weatherTick;
    }
    return this.forecast;
  }

  heightAt(ammoId, angle, power, x) {
    const ammo = ammoById.get(ammoId);
    const origin = this.release, direction = this.side === 'left' ? 1 : -1;
    if (
      !ammo ||
      !Number.isFinite(angle) ||
      !Number.isFinite(power) ||
      !Number.isFinite(x) ||
      (x - origin.x) * direction < 0 ||
      x < WORLD.minX ||
      x > WORLD.maxX
    )
      return Infinity;
    const v = launchVelocity(angle, power, ammo, this.difficulty === 'large');
    const drift = this.forecastDrift();
    const height = (px) => {
      const t = flightTime((px - origin.x) * direction, v.x, this.level.wind * direction, drift, direction);
      if (!Number.isFinite(t)) return Infinity;
      return origin.y + t * (v.y + 0.5 * GRAVITY * (t + STEP));
    };
    // On each straight terrain segment, the downward-curving arc has its
    // largest y relative to that segment at one of its ends. Checking the
    // intervening ridge vertices handles a sharp bluff between sample points.
    for (const p of this.terrain) {
      if ((p.x - origin.x) * direction > 0 && (x - p.x) * direction > 0 &&
          height(p.x) + ammo.radius >= p.y) return Infinity;
    }
    const y = height(x);
    return y + ammo.radius < this.terrainHeight(x) ? y : Infinity;
  }

  aimForPoint(ammoId, x, y) {
    const ammo = ammoById.get(ammoId);
    const origin = this.release, direction = this.side === 'left' ? 1 : -1;
    x = clamp(x, WORLD.minX, WORLD.maxX);
    y = Math.min(y, this.terrainHeight(x) - ammo.radius - 0.6);
    const dx = (x - origin.x) * direction, dy = y - origin.y;
    const large = this.difficulty === 'large', scale = ammo.launchScale ?? 1;
    const minSpeed = launchSpeed(25, large) * scale, maxSpeed = launchSpeed(100, large) * scale;
    const degrees = 180 / Math.PI;
    const preferred = clamp(Math.atan2(-dy, Math.max(1, dx)) * degrees + 22, 12, 75);
    const drift = this.forecastDrift();
    let best;
    // For a given arrival time, undo wind and gravity to find the required launch velocity.
    // Project it onto the legal draw and elevation limits so distant targets get the nearest arc.
    const search = (avoidTerrain) => {
      let score = Infinity;
      const sample = (tick) => {
        const t = STEP * tick, i = Math.floor(tick);
        const windX = drift ? drift[i] + (tick - i) * ((drift[i + 1] ?? drift[i]) - drift[i])
          : 0.5 * this.level.wind * t * (t + STEP);
        const down = 0.5 * GRAVITY * t * (t + STEP);
        const vx = (dx - windX * direction) / t, up = (down - dy) / t;
        const angle = clamp(Math.atan2(up, vx) * degrees, 12, 75);
        const cos = Math.cos(angle / degrees), sin = Math.sin(angle / degrees);
        const speed = clamp(vx * cos + up * sin, minSpeed, maxSpeed);
        const miss = Math.hypot(t * speed * cos + direction * windX - dx, down - t * speed * sin - dy);
        const cost = miss + Math.abs(angle - preferred) * 0.012;
        if (cost >= score) return;
        const rawSpeed = speed / scale, extra = rawSpeed - launchSpeed(70, large);
        // Invert the extra quadratic draw of the large catapults above 70%.
        const power = large && extra > 0 ? 70 + 2 * extra / (6.1 + Math.sqrt(6.1 ** 2 + 1.2 * extra))
          : (rawSpeed - 250) / 6.1;
        if (avoidTerrain && !Number.isFinite(this.heightAt(ammoId, angle, power, x))) return;
        score = cost;
        best = { angle, power, tick };
      };
      for (const angle of [12, 75]) for (const speed of [minSpeed, maxSpeed]) {
        const t = flightTime(dx, speed * Math.cos(angle / degrees), direction * this.level.wind, drift, direction);
        if (t > 0 && t <= FORECAST_STEPS * STEP) sample(t / STEP);
      }
      for (let tick = 1; tick <= FORECAST_STEPS; tick += 6) sample(tick);
      for (const spacing of [1, 0.125, 0.015625]) {
        const center = best.tick;
        for (let i = -7; i <= 7; i++) sample(clamp(center + i * spacing, 0.01, FORECAST_STEPS));
      }
    };
    search(false);
    if (dx > 0 && !Number.isFinite(this.heightAt(ammoId, best.angle, best.power, x))) search(true);
    return { angle: Math.round(best.angle * 100) / 100, power: Math.round(best.power * 100) / 100 };
  }

  trajectory(ammoId, angle, power) {
    const ammo = ammoById.get(ammoId);
    if (!ammo || !Number.isFinite(angle) || !Number.isFinite(power)) return [];
    const v = launchVelocity(angle, power, ammo, this.difficulty === 'large'),
      origin = this.release;
    const direction = this.side === 'left' ? 1 : -1;
    const points = [];
    const drift = this.forecastDrift();
    // Semi-implicit integration adds half a step of acceleration to the
    // continuous parabola. This matches the trajectory used by the solver.
    for (let i = 0; i <= FORECAST_STEPS; i += FLIGHT_SAMPLE_TICKS) {
      const t = i * STEP;
      const x = origin.x + direction * v.x * t + (drift ? drift[i] : 0.5 * this.level.wind * t * (t + STEP));
      const y = origin.y + v.y * t + 0.5 * GRAVITY * t * (t + STEP);
      points.push({ x, y });
      if (y + ammo.radius >= this.terrainHeight(x) || x < WORLD.minX || x > WORLD.maxX) break;
    }
    return points;
  }

  fire(ammoId, angle, power) {
    const ammo = ammoById.get(ammoId);
    if (!ammo || !this.stats.ready || !Number.isFinite(angle) || !Number.isFinite(power)) return false;
    const { x, y } = this.release,
      r = ammo.radius,
      v = launchVelocity(angle, power, ammo, this.difficulty === 'large');
    const direction = this.side === 'left' ? 1 : -1;
    const body = Bodies.circle(x, y, r, {
      density: ammo.density,
      frictionAir: 0,
      friction: 0.65,
      restitution: 0.19,
    });
    const e = this.add('projectile', ammo.id, x, y, r * 2, r * 2, 'shot', { radius: r }, body);
    e.side = this.side;
    e.blast = ammo.blast;
    if (ammo.remote) this.remoteBombs.add(e);
    e.flameRadius = ammo.flameRadius;
    e.implosionRadius = ammo.implosionRadius;
    e.burstRadius = ammo.burstRadius;
    e.flightPath = this.trajectory(ammoId, angle, power);
    e.contacts = new Set();
    this.projectiles.add(e);
    Body.setVelocity(body, { x: direction * v.x / 60, y: v.y / 60 });
    Body.setAngularVelocity(body, direction * 0.075);
    this.shots++;
    this.spent += ammo.cost;
    this.reloadEnd[this.side] = this.ticks + RELOAD_TICKS;
    this.emit('launch', e, 0.6).side = this.side;
    return true;
  }

  armedBomb(ammoId, side) {
    for (const bomb of this.remoteBombs) {
      if ((!side || bomb.side === side) && (!ammoId || bomb.material === ammoId)) return bomb;
    }
  }

  detonateRemote(ammoId, side) {
    const armed = this.armedBomb(ammoId, side);
    if (!armed) return false;
    this.explode(armed);
    return true;
  }

  detonateSiegeBomb() {
    return this.detonateRemote('siege-bomb');
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
      this.guardBolts.length ||
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
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const rain = this.level.weather === 'rain' || this.level.weather === 'storm';
    if (!this.shots && !rain && !this.level.gust) return;
    const wasResting = this.resting;
    this.accumulator += Math.min(seconds, 0.125);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      this.weatherTick++;
      const wind = this.wind;
      const gale = this.shots && Math.abs(wind) > 30;
      if ((rain || gale) && this.weatherTick % 12 === 0) this.applyWeather(wind, rain, gale);
      if (!this.shots) continue;
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
          shot.body.force.x += (shot.body.mass * wind) / 1e6;
      }
      Engine.update(this.engine, STEP * 1000);
      this.resolveDamage();
      this.defend(STEP);
      this.updateTorches();
      if (this.ticks % 12 === 0) {
        this.checkLoads();
        this.heatMaterials();
      }
      for (const e of this.entities.values()) {
        if (e.body.position.y > WORLD.height + 100 || e.body.position.x < WORLD.minX - 70 || e.body.position.x > WORLD.maxX + 70) {
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
    if (this.shots && (!wasResting || !this.resting)) for (const e of this.entities.values()) this.sync(e);
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
        if (torch?.kind === 'torch' && other && other.id !== torch.hostId && (other.kind === 'projectile' || speed > 2))
          this.extinguish(torch);
        continue;
      }
      ea?.contacts?.add(pair);
      eb?.contacts?.add(pair);
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
          if (e.material === 'glass' && e.damage >= 1 && other?.kind === 'projectile' && !e.glassHit)
            e.glassHit = localPoint(e.body, contact);
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
        if (e.kind === 'projectile' && (e.material === 'small-stone' || e.material === 'big-stone' || e.detail === 'split-shot') &&
            (other?.kind === 'block' || other?.kind === 'fragment')) {
          // At shallow incidence the surface governs the skip. Give Matter
          // the contact coefficients before it resolves linear and angular momentum.
          const tangent = Math.abs((va.x - vb.x) * n.y - (va.y - vb.y) * n.x);
          const graze = clamp(tangent / speed - 0.5, 0, 1), surface = MATERIALS[other.material];
          pair.friction += (surface.skidFriction - pair.friction) * graze;
          pair.restitution += (surface.rebound - pair.restitution) * graze;
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
    e.rockHit = { ...localPoint(e.body, point), shock, contact: point.blast ? point : null };
    this.work.add(e);
  }

  hit(e, energy, point) {
    const threshold = MATERIALS[e.material].toughness * (1 - 0.68 * e.burn);
    if (energy < threshold * 0.32) return;
    this.damageBlock(e, (energy / threshold - 0.28) * 1.12, point);
    if (e.material === 'steel' && !e.roofType && !e.bend && e.damage > 0.25 && e.damage < 1) {
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
    let supports;
    for (const e of this.entities.values()) {
      if (e.body.isSleeping && !e.burning) continue;
      if (e.kind === 'orc' || (e.kind === 'block' && (e.material === 'wood' || e.material === 'steel'))) {
        supports = new Map();
        break;
      }
    }
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
      // Loose ammunition may still roll while every load-sensitive member
      // sleeps. Only rolling resistance is needed during those samples.
      if (!supports) continue;
      const links = supports.get(up.id) || [];
      const x = supportCount === 2 ? (contacts[0].x + contacts[1].x) / 2 : contacts[0].x;
      links.push({ e: lower.plugin.fortress, x });
      supports.set(up.id, links);
    }
    if (!supports) return;
    const pressure = this.level.version >= 3 ? new Map() : null;
    if (pressure) for (const e of this.entities.values()) {
      if (!e.originalSeats || Math.abs(e.body.angle) > 0.08) continue;
      const top = e.body.bounds;
      let links = supports.get(e.id);
      for (const lower of e.originalSeats) {
        if (!this.entities.has(lower.id) || Math.abs(lower.body.angle) > 0.08) continue;
        const seat = lower.body.bounds;
        const left = Math.max(top.min.x, seat.min.x), right = Math.min(top.max.x, seat.max.x);
        if (right - left < 1 || Math.abs(top.max.y - seat.min.y) > 2.5 || links?.some((p) => p.e === lower)) continue;
        if (!links) supports.set(e.id, links = []);
        links.push({ e: lower, x: (left + right) / 2 });
      }
    }
    if (!supports.size) return;
    const carried = new Map();
    const byHeight = [];
    for (const e of this.entities.values()) if (supports.has(e.id)) byHeight.push(e);
    byHeight.sort((a, b) => a.body.position.y - b.body.position.y);
    for (const e of byHeight) {
      const load = carried.get(e.id) || 0,
        base = supports.get(e.id);
      if (pressure && e.body.isStatic) continue;
      let moment;
      if (pressure) moment = transferWeight(e, base, carried, pressure);
      else for (const support of base) {
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
      let left = base[0].x;
      if (!pressure) {
        const middle = e.body.position.x;
        const seats = base.map((seat) => seat.x).sort((a, b) => a - b);
        left = seats[0];
        const right = seats.at(-1);
        const eccentricity = Math.max(0, left - middle, middle - right);
        let span = e.width;
        if (this.difficulty === 'large' && seats.length > 1) {
          span = Math.max(left - (middle - e.width / 2), middle + e.width / 2 - right);
          for (let i = 1; i < seats.length; i++) span = Math.max(span, seats[i] - seats[i - 1]);
        }
        moment = load * (0.09 * span * span / e.width + eccentricity);
      }
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

  disintegrate(e, type, contact) {
    this.wakeWard(e.body.position.x);
    const size = Math.sqrt(e.width * e.height);
    const dust = this.emit(type, e, clamp(size / 36, 0.2, 1), contact);
    Object.assign(dust, e.body.position, { id: e.id, size, width: e.width, height: e.height, angle: e.body.angle });
    this.remove(e);
  }

  markDestroyed(e) {
    if (e.kind !== 'block' || e.destroyed) return;
    e.destroyed = true;
    this.lostWeight += e.weight;
  }

  remove(e) {
    this.resumePhysics();

    if (e.joints) for (const joint of e.joints) releaseJoint(this.joints, joint);
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
    const origin = { ...source.body.position };
    this.remove(source);
    if (source.implosionRadius) {
      const radius = source.implosionRadius;
      const twist = (this.blastRandom() - 0.5) * 0.16;
      this.implosions.push({ ...origin, radius, burstRadius: source.burstRadius, twist, start: this.ticks, crushed: new Set() });
      this.events.push({ type: 'implosion', ...origin, material: source.material, radius, strength: 1 });
      return;
    }
    this.blastAt(origin, source.flameRadius || source.blast || 125, source.material,
      source.kind === 'projectile', Boolean(source.flameRadius));
  }

  blastAt(origin, radius, material, fromProjectile, fireball = false) {
    this.events.push({
      type: fireball ? 'fireburst' : 'explosion',
      x: origin.x, y: origin.y,
      radius,
      material,
      strength: fireball ? 1 : radius / 158,
    });
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
      if (e.kind === 'torch' && body.isStatic) {
        if (fireball) continue;
        this.extinguish(e);
        body = e.body;
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
      const core = strength * strength * strength;
      const shock = radius * 0.095 * core;
      const resistance = !fireball && e.kind === 'fragment' && BLAST_DUST_RESISTANCE[e.material];
      // Use polygon area so a thin shard powders more readily than a full brick.
      if (resistance && body.area <= MAX_BLAST_DUST_AREA && shock >= resistance * (1.1 + 0.105 * Math.sqrt(body.area))) {
        this.disintegrate(e, 'stone-dust', contact);
        continue;
      }
      if (e.material === 'wood' || e.kind === 'barrel') {
        e.heat = Math.min(1, e.heat + strength * heatTransmission * (fireball ? 1.65 : 1.05));
        if (e.heat >= 0.69) this.ignite(e);
      }
      if (fireball) continue;
      if (e.kind === 'block') {
        const damageScale = fromProjectile ? 0.13 : 0.17;
        this.hit(e, radius * (strength * damageScale + core * 0.065), contact);
      } else if (e.kind === 'fragment' && e.material === 'stone') {
        this.crackStone(e, shock, contact);
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
      if (age > 42) {
        this.implosions.splice(i, 1);
        this.blastAt(field, field.burstRadius, 'magic-bomb', true);
        continue;
      }
      if (age % 3 !== 1) continue;
      const pulse = Math.sin(Math.PI * (age + 2) / 45);
      for (const e of this.entities.values()) {
        const body = e.body;
        const dx = field.x - body.position.x, dy = field.y - body.position.y;
        if (Math.abs(dx) >= field.radius || Math.abs(dy) >= field.radius) continue;
        const distance = Math.hypot(dx, dy);
        if (distance >= field.radius) continue;
        if (e.kind === 'torch' && body.isStatic) this.extinguish(e);
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
    if (e.roofType) {
      shapes = splitStone(e.vertices, { x: dx, y: dy });
    } else if (e.material === 'wood' || e.material === 'steel') {
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
      // A pane fans out from the strike, leaving short shards at the rim and
      // long ones on its far side. Inset the origin so each shard has thickness.
      const hub = e.glassHit ? {
        x: clamp(e.glassHit.x + dx * 0.15, -w * 0.82, w * 0.82),
        y: clamp(e.glassHit.y + dy * 0.15, -h * 0.82, h * 0.82),
      } : { x: dx, y: dy };
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
      if (e.wet) fragment.wet = e.wet;
      fragment.ignitedAt = e.ignitedAt;
    }
  }
}
