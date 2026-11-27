import Matter from './vendor/matter.min.js';

const { Bodies, Body, Composite, Engine, Events, Sleeping, Vertices } = Matter;

export const WORLD = { width: 1200, height: 480, ground: 389, release: { x: 160, y: 326 } };
export const AMMO = [
  { id: 'small-stone', name: 'Small stone', cost: 10, radius: 9, density: 0.012, reload: 0.3 },
  { id: 'big-stone', name: 'Big stone', cost: 22, radius: 15, density: 0.013, reload: 0.75 },
  { id: 'small-bomb', name: 'Small bomb', cost: 35, radius: 10, density: 0.009, blast: 103, reload: 1.2 },
  { id: 'big-bomb', name: 'Big bomb', cost: 60, radius: 15, density: 0.012, blast: 158, reload: 1.85 },
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
  const count = small ? 2 : large ? 4 : 3;
  const first = (small ? 649 : large ? 418 : 537) + integer(-12, 12);
  const last = (small ? 978 : large ? 1066 : 1034) + integer(-13, 13);
  const centers = Array.from(
    { length: count },
    (_, i) => Math.round(first + ((last - first) * i) / (count - 1)) + (i && i < count - 1 ? integer(-14, 14) : 0),
  );
  const sections = [],
    walls = [],
    terrain = [{ x: 0, y: WORLD.ground }];
  let previousRight = 0;
  for (const [i, center] of centers.entries()) {
    const keep = i === count - 1,
      front = i === 0;
    const spacing = Math.min(center - (centers[i - 1] ?? -1000), (centers[i + 1] ?? 2200) - center);
    const maxWidth = Math.min(spacing - (large ? 50 : 55), 2 * (1164 - center));
    const maxBays = Math.min(keep || large ? 3 : 2, Math.max(1, Math.floor(maxWidth / 53)));
    const bays =
      keep || !small ? integer(Math.min(2, maxBays), maxBays) : front && small ? 1 : integer(1, maxBays);
    const spans = Array.from({ length: bays }, () => integer(53, Math.min(73, Math.floor(maxWidth / bays))));
    const width = spans.reduce((sum, span) => sum + span, 0),
      left = center - Math.round(width / 2);
    const peak = large
      ? keep
        ? integer(4, 5)
        : integer(3, 4)
      : keep
        ? small
          ? 3
          : integer(3, 4)
        : small
          ? 2
          : integer(2, 3);
    const heights = Array.from({ length: bays }, () => integer(large ? 2 : 1, Math.max(1, peak - 1)));
    const tower = integer(0, bays - 1);
    heights[tower] = peak;
    if (bays === 3 && tower !== 1 && !small) heights[2 - tower] = integer(2, peak - 1);
    if (large && !front && bays > 1) heights[(tower + 1) % bays] = Math.max(3, heights[(tower + 1) % bays]);
    const storey = large ? integer(47, 51) : keep ? integer(49, 57) : integer(small ? 44 : 46, 54);
    const targetBase = Math.round(
      WORLD.ground - (front ? integer(0, 9) : ((16 + index * 12 + integer(0, 11)) * i) / (count - 1)),
    );
    let hillLeft = left - 19,
      wall;
    const gap = hillLeft - previousRight;
    if ((front || gap > (large ? 63 : 87)) && (front || large || random() < 0.78)) {
      const width = integer(32, Math.min(63, Math.floor(gap * 0.55)));
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
  const par = 5 * Math.round((count * 14 + guards * 9 + index * 2) / 5);
  const ward = sections[0],
    angle = large ? 24 : 38;
  const dx = ward.left - WORLD.release.x,
    dy = ward.base - ward.storey * 0.77 - WORLD.release.y;
  const aim = { angle, power: 25 };
  let closest = Infinity;
  for (let p = 25; p <= 100; p++) {
    const v = launchVelocity(angle, p),
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
const MATERIALS = {
  stone: { density: 0.0028, toughness: 9, friction: 0.76 },
  wood: { density: 0.0011, toughness: 6.2, friction: 0.83 },
  glass: { density: 0.0016, toughness: 2.8, friction: 0.66 },
  steel: { density: 0.0038, toughness: 15, friction: 0.7 },
};
const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
const ammoById = new Map(AMMO.map((ammo) => [ammo.id, ammo]));

function launchVelocity(angle, power) {
  const radians = (clamp(angle, 5, 85) * Math.PI) / 180;
  const speed = 250 + 6.1 * clamp(power, 1, 100);
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

// Clip a blast ray against a convex collision polygon. A wall between powder
// and a guard takes the shock first, even when both are inside the blast radius.
function shieldsBlast(body, start, end) {
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
    this.engine = Engine.create({
      enableSleeping: true,
      positionIterations: difficulty === 'large' ? 14 : 9,
      velocityIterations: difficulty === 'large' ? 12 : 7,
      gravity: { x: 0, y: 1, scale: GRAVITY / 1e6 },
    });
    this.entities = new Map();
    this.projectiles = new Set();
    this.events = [];
    this.work = new Set();
    this.totalWeight = 0;
    this.lostWeight = 0;
    this.accumulator = 0;
    this.time = 0;
    this.ticks = 0;
    this.wokenColumns = new Set();
    this.nextId = 1;
    this.debrisSeed = this.seed ^ 91463;
    this.shots = 0;
    this.spent = 0;
    this.reloadTick = 0;
    this.clearAt = Infinity;
    this.cleared = false;
    this.buildTerrain();
    for (const section of level.sections) this.buildFort(section);
    for (const wall of level.walls) this.buildWall(wall);
    // Settle the mortar-free stacks before measuring displacement for scoring.
    for (let i = 0; i < (difficulty === 'large' ? 300 : difficulty === 'medium' ? 230 : 90); i++)
      Engine.update(this.engine, STEP * 1000);
    for (const e of this.entities.values()) {
      e.home = { ...e.body.position, angle: e.body.angle };
      this.sync(e);
    }
    this.torches = [];
    this.mountTorches();
    this.orcsTotal = level.sections.reduce((sum, section) => sum + section.orcs.length, 0);
    this.orcsRemaining = this.orcsTotal;
    Events.on(this.engine, 'collisionStart', (event) => this.collisions(event.pairs));
    Events.on(this.engine, 'collisionEnd', ({ pairs }) => {
      for (const pair of pairs) {
        pair.collision.parentA.plugin.fortress?.contacts?.delete(pair);
        pair.collision.parentB.plugin.fortress?.contacts?.delete(pair);
      }
    });
    return true;
  }

  random() {
    this.debrisSeed = (Math.imul(this.debrisSeed, 1664525) + 1013904223) >>> 0;
    return this.debrisSeed / 4294967296;
  }

  add(kind, material, x, y, width, height, detail, options = {}, customBody) {
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
    if (kind === 'block') {
      e.weight = Math.sqrt(width * height);
      this.totalWeight += e.weight;
    }
    return e;
  }

  terrainHeight(x) {
    const points = this.terrain;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (x <= b.x) return a.y + (b.y - a.y) * clamp((x - a.x) / (b.x - a.x), 0, 1);
    }
    return points.at(-1).y;
  }

  buildTerrain() {
    const points = [{ x: -1000, y: WORLD.ground }, ...this.terrain, { x: 2200, y: WORLD.ground }];
    this.hills = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        bottom = WORLD.height + 120;
      const shape = [a, b, { x: b.x, y: bottom }, { x: a.x, y: bottom }];
      const center = Vertices.centre(shape);
      const body = Bodies.fromVertices(center.x, center.y, [shape], {
        isStatic: true,
        friction: 0.94,
        sleepThreshold: 0,
      });
      Composite.add(this.engine.world, body);
      this.hills.push(body);
    }
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

  buildFort(level) {
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
          // Independent courses can shear, rock or fracture under the lintel.
          const courses = stage === 4 ? 4 : stage === 2 ? 3 : 2;
          for (let course = 0; course < courses; course++) {
            const width = course === 0 ? 28 : course === courses - 1 && stage ? 29 : 25;
            block('stone', columns[c], base - ((course + 0.5) * h) / courses, width, h / courses, 'masonry');
          }
        } else {
          // In a larger ward each load-bearing post sits on a broad sill. The
          // socket can slip independently of the timber or glazing it carries.
          const sill = stage === 4 ? 7 : stage && row === 0 ? 6 : 0;
          const capital = stage === 4 ? 5 : 0;
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
        const leftEnd = columns[c] - (heights[c - 1] > row ? -0.35 : 15);
        const rightEnd = columns[c + 1] + (heights[c + 1] > row ? -0.35 : 15);
        const material =
          stage >= 2 && (c + row + pattern) % 5 === 0 ? 'steel' : (c + row + pattern) % 3 === 0 ? 'stone' : 'wood';
        block(
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
      this.add('orc', 'orc', (columns[c] + columns[c + 1]) / 2, level.base - row * storey - 15, 24, 30, 'guard', {
        density: 0.0012,
        chamfer: { radius: 4 },
      });
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
    for (const section of this.level.sections) {
      const right = section.left + section.spans.reduce((sum, n) => sum + n, 0);
      const mounts = bodies.filter(
        (e) =>
          e.kind === 'block' &&
          ['stone', 'steel'].includes(e.material) &&
          e.home.x >= section.left - 2 &&
          e.home.x <= right + 2 &&
          e.height >= 13,
      );
      const count = section.style === 'keep' && this.difficulty !== 'small' ? 2 : 1;
      let placed = 0;
      for (let i = 0; i < mounts.length && placed < count; i++) {
        const host = mounts[(i + section.pattern) % mounts.length];
        for (const side of [1, -1]) {
          const offset = side * (host.width / 2 + 4);
          const p = pointOnBody(host.body, offset, 2);
          const clear = bodies.every(
            (e) =>
              e === host ||
              Math.hypot(e.x - p.x, e.y - p.y) > 135 ||
              distanceToBody(e, { x: p.x, y: p.y - 8 }) > (e.material === 'wood' || e.kind === 'barrel' ? 13 : 3),
          );
          if (!clear || this.torches.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 47)) continue;
          this.attachTorch(host, offset);
          placed++;
          break;
        }
      }
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
      Body.setPosition(torch.body, p);
      Body.setAngle(torch.body, turn);
      torch.flameX = p.x + 8 * Math.sin(turn);
      torch.flameY = p.y - 8 * Math.cos(turn);
      if (Math.hypot(p.x - torch.home.x, p.y - torch.home.y) > 3 || Math.abs(turn) > 0.065) this.extinguish(torch);
    }
  }

  heatMaterials() {
    const bodies = this.bodies;
    const flames = this.torches.filter((e) => e.lit);
    const embers = bodies.filter((e) => e.burning && e.burn > 0.12);
    for (const e of bodies) {
      if (e.material !== 'wood' && e.kind !== 'barrel') continue;
      if (!e.burning) {
        const heated =
          flames.some((flame) => distanceToBody(e, { x: flame.flameX, y: flame.flameY }) < 6) ||
          embers.some((source) => source !== e && touchingHeatSource(source, e));
        // A grazing contact cannot set a plank alight. Heat bleeds away when
        // it rolls clear; sustained contact heats a timber or powder barrel.
        e.heat = clamp(e.heat + (heated ? 0.1 : -0.16), 0, 1);
        if (e.heat < 0.69) continue;
        e.burning = true;
        this.emit('ignite', e, 0.6);
        if (e.kind === 'barrel') e.fuse = Math.min(e.fuse, this.time + 0.45);
      }
      e.burn = Math.min(1, e.burn + 0.014);
      if (e.burn === 1) {
        if (e.kind === 'block') {
          e.damage = 1;
          this.work.add(e);
        } else if (e.kind === 'fragment') this.remove(e);
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
      shots: this.shots,
      orcsRemaining: this.orcsRemaining,
      orcsTotal: this.orcsTotal,
      destruction: Math.min(100, Math.round((100 * this.lostWeight) / this.totalWeight)),
      cleared: this.cleared,
      reloadRemaining,
      ready: reloadRemaining === 0 && this.clearAt === Infinity && !this.cleared,
    };
  }

  drainEvents() {
    return this.events.splice(0);
  }

  emit(type, e, strength, point = e.body.position) {
    this.events.push({ type, x: point.x, y: point.y, material: e.material, strength: clamp(strength, 0, 1) });
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
    const v = launchVelocity(angle, power),
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
    const v = launchVelocity(angle, power),
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
      v = launchVelocity(angle, power);
    const body = Bodies.circle(x, y, r, {
      density: ammo.density,
      frictionAir: 0,
      friction: 0.65,
      restitution: 0.19,
    });
    const e = this.add('projectile', ammo.id, x, y, r * 2, r * 2, 'shot', { radius: r }, body);
    e.blast = ammo.blast;
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

  update(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || !this.shots) return;
    this.accumulator += Math.min(seconds, 0.125);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      this.time += STEP;
      this.ticks++;
      this.wokenColumns.clear();
      for (const shot of this.projectiles) {
        if (!shot.body.isSleeping && !shot.contacts.size)
          shot.body.force.x += (shot.body.mass * this.level.wind) / 1e6;
      }
      Engine.update(this.engine, STEP * 1000);
      this.resolveDamage();
      this.updateTorches();
      if (this.ticks % 12 === 0) {
        this.checkLoads();
        this.heatMaterials();
      }
      for (const e of this.entities.values()) {
        if (e.body.position.y > WORLD.height + 100 || e.body.position.x < -70 || e.body.position.x > 1320) {
          if (e.kind === 'orc') this.faint(e);
          this.remove(e);
        } else if (e.fuse <= this.time) this.explode(e);
        else if (e.kind === 'projectile') {
          if (this.time - e.born > 14 && e.body.speed < 0.25) this.remove(e);
          else if (!e.body.isSleeping && e.body.bounds.max.y >= this.terrainHeight(e.body.position.x) - 0.1) {
            // The turf absorbs rolling energy after a shot lands.
            const velocity = Body.getVelocity(e.body);
            Body.setVelocity(e.body, { x: velocity.x * TURF_ROLL, y: velocity.y });
            Body.setAngularVelocity(e.body, Body.getAngularVelocity(e.body) * TURF_ROLL);
          }
        } else if (e.kind === 'block' && !e.destroyed) {
          const p = e.body.position;
          if (Math.abs(e.body.angle - e.home.angle) > 0.55 || Math.hypot(p.x - e.home.x, p.y - e.home.y) > 23)
            this.markDestroyed(e);
        }
      }
      if (this.orcsRemaining === 0 && !this.cleared) {
        if (this.time >= this.clearAt) {
          this.cleared = true;
          this.events.push({ type: 'clear', x: 900, y: 280, strength: 0.8 });
        }
      }
    }
    for (const e of this.entities.values()) this.sync(e);
  }

  sync(e) {
    e.x = e.body.position.x;
    e.y = e.body.position.y;
    e.angle = e.body.angle;
  }

  wakeWard(x) {
    // A disturbed pier wakes the entire height and width of its ward. Leave
    // distant, disconnected stacks sleeping during a local shower of debris.
    const column = Math.floor(x / 84);
    if (this.wokenColumns.has(column)) return;
    this.wokenColumns.add(column);
    const middle = (column + 0.5) * 84;
    for (const e of this.entities.values()) {
      if (e.body.sleepCounter && Math.abs(e.body.position.x - middle) <= 210) Sleeping.set(e.body, false);
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
      if (ea && eb && (speed >= 1.4 || ea.kind === 'projectile' || eb.kind === 'projectile'))
        this.wakeWard(contact.x);
      if (speed < 0.9) continue;
      for (const [e, other, otherBody] of [
        [ea, eb, b],
        [eb, ea, a],
      ]) {
        if (!e) continue;
        const energy = speed * Math.sqrt(Math.min(otherBody.mass, 12) / Math.max(0.38, e.body.mass));
        if (e.kind === 'block') {
          this.hit(e, energy, contact);
        } else if (
          e.kind === 'orc' &&
          (speed > 3.8 || (energy > 3 && (other?.kind === 'block' || other?.kind === 'projectile')))
        ) {
          this.faint(e);
        } else if ((e.kind === 'barrel' && (energy > 4 || other?.kind === 'projectile')) || e.blast) {
          e.fuse = Math.min(e.fuse, this.time + (e.blast ? 0.025 : 0.13));
        }
        if (speed > 2.5 && e.kind === 'projectile' && this.time - e.lastImpact > 0.18) {
          this.emit('impact', other || e, speed / 10, contact);
          e.lastImpact = this.time;
        }
      }
    }
  }

  hit(e, energy, point) {
    const threshold = MATERIALS[e.material].toughness * (1 - 0.68 * e.burn);
    if (energy < threshold * 0.32) return;
    e.damage = Math.min(1, e.damage + (energy / threshold - 0.28) * 1.12);
    if (e.material === 'steel' && !e.bend && e.damage > 0.25 && e.damage < 1) {
      e.bend = (point.x < e.body.position.x ? -1 : 1) * clamp(e.damage, 0.28, 0.85);
      this.work.add(e);
    }
    if (e.damage >= 1) this.work.add(e);
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
      const links = supports.get(up.id) || [];
      const x = supportCount === 2 ? (contacts[0].x + contacts[1].x) / 2 : contacts[0].x;
      links.push({ e: lower.plugin.fortress, x });
      supports.set(up.id, links);
    }
    const byHeight = this.bodies.sort((a, b) => a.body.position.y - b.body.position.y);
    for (const e of byHeight) {
      const load = carried.get(e.id) || 0,
        base = supports.get(e.id) || [];
      for (const support of base) {
        if (support.e)
          carried.set(support.e.id, (carried.get(support.e.id) || 0) + (e.body.mass + load) / base.length);
      }
      if (!load || !base.length) continue;
      if (e.kind === 'orc' && load > e.body.mass * 2.2) this.faint(e);
      if (e.kind !== 'block' || !['wood', 'steel'].includes(e.material) || e.width < 2 * e.height) continue;
      const middle = e.body.position.x;
      const left = Math.min(...base.map((p) => p.x)),
        right = Math.max(...base.map((p) => p.x));
      const eccentricity = Math.max(0, left - middle, middle - right);
      const moment = load * (e.width * 0.09 + eccentricity);
      const capacity = e.height ** 2 * (e.material === 'steel' ? 2.25 : 1.05);
      if (moment > capacity)
        this.hit(e, (0.33 + 0.12 * Math.min(3, moment / capacity)) * MATERIALS[e.material].toughness, { x: left });
    }
  }

  resolveDamage() {
    for (const e of this.work) {
      if (!this.entities.has(e.id)) continue;
      if (e.damage >= 1) this.fracture(e);
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
    if (!this.orcsRemaining) this.clearAt = this.time + 0.7;
    e.body.collisionFilter.mask = 0;
    this.remove(e);
  }

  markDestroyed(e) {
    if (e.kind !== 'block' || e.destroyed) return;
    e.destroyed = true;
    this.lostWeight += e.weight;
  }

  remove(e) {
    if (e.kind === 'torch') e.lit = false;
    if (e.kind === 'projectile') this.projectiles.delete(e);
    this.markDestroyed(e);
    Composite.remove(this.engine.world, e.body);
    this.entities.delete(e.id);
  }

  explode(source) {
    this.wakeWard(source.body.position.x);
    const origin = { ...source.body.position },
      radius = source.blast || 125;
    this.emit('explosion', source, radius / 158);
    this.remove(source);
    const walls = this.bodies.filter(
      (e) => e.kind === 'block' && (e.material === 'stone' || e.material === 'steel'),
    );
    for (const e of this.entities.values()) {
      let body = e.body;
      const nearestX = clamp(origin.x, body.bounds.min.x, body.bounds.max.x);
      const nearestY = clamp(origin.y, body.bounds.min.y, body.bounds.max.y);
      const distance = Math.hypot(origin.x - nearestX, origin.y - nearestY);
      if (distance >= radius) continue;
      let strength = 1 - distance / radius;
      if (this.hills.some((hill) => shieldsBlast(hill, origin, body.position))) strength *= 0.25;
      for (const wall of walls) {
        if (wall !== e && shieldsBlast(wall.body, origin, body.position)) strength *= 0.65;
      }
      if (e.kind === 'torch' && e.lit) {
        this.extinguish(e);
        body = e.body;
      }
      const dx = body.position.x - origin.x,
        dy = body.position.y - origin.y;
      const len = Math.hypot(dx, dy) || 1,
        kick = (strength * (radius / 11)) / (1 + body.mass * 0.12);
      const velocity = Body.getVelocity(body);
      Body.setVelocity(body, { x: velocity.x + (kick * dx) / len, y: velocity.y + kick * (dy / len - 0.3) });
      Body.setAngularVelocity(body, Body.getAngularVelocity(body) + (this.random() - 0.5) * strength * 0.35);
      if (e.kind === 'block') this.hit(e, strength * radius * 0.17, origin);
      else if (e.kind === 'orc' && strength > 0.29) this.faint(e);
      else if (e.kind === 'barrel' && strength > 0.1)
        e.fuse = Math.min(e.fuse, this.time + 0.1 + 0.18 * (1 - strength));
      else if (e.blast) e.fuse = Math.min(e.fuse, this.time + 0.07);
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
    this.emit('fracture', e, Math.min(1, 0.35 + e.weight / 65));
    this.remove(e);
    for (const shape of shapes) {
      const center = Vertices.centre(shape),
        p = pointOnBody(body, center.x, center.y);
      const local = shape.map((q) => ({ x: (q.x - center.x) * 0.96, y: (q.y - center.y) * 0.96 }));
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
      Body.setAngularVelocity(piece, Body.getAngularVelocity(body) + (this.random() - 0.5) * 0.09);
      const width = Math.max(...local.map((q) => q.x)) - Math.min(...local.map((q) => q.x));
      const height = Math.max(...local.map((q) => q.y)) - Math.min(...local.map((q) => q.y));
      const fragment = this.add('fragment', e.material, p.x, p.y, width, height, 'debris', {}, piece);
      fragment.vertices = local;
      fragment.burning = e.burning;
      fragment.burn = e.burn;
    }
  }
}
