/* Missions: a river valley from a seed, the rules for where joints and
   members may go, and a builder that designs bridges and tests them in the
   real simulation. A mission is only handed out once one of its designs has
   carried the vehicle across, and its budget is that design's cost plus the
   difficulty's margin. */
import { createRng } from '../../shared/rng.js';
import { CELL, MATERIALS, createSim, bridgeCost, memberLength, key } from './physics.js';

export const MARGINS = { easy: 0.5, medium: 0.25, hard: 0.1 };
const CLEARANCE = 1; // metres a joint must stay above the water

/* Spans in grid cells for each vehicle; a heavier vehicle gets a shorter river. */
const VEHICLE_SPANS = { car: [5, 11], truck: [5, 10], train: [5, 9] };

/* Rock that rises out of the river: a pier is narrow and tall, an island is
   low and wide. Each has bolts on top that a bridge can stand on. */
function riverFeature(rng, span, water) {
  const kind = span >= 7 ? rng.pick(['none', 'pier', 'island', 'island', 'pier']) : 'none';
  if (kind === 'none') return null;
  if (kind === 'pier') {
    const x = rng.range(3, span - 3), top = -rng.range(1, 2);
    if (top * CELL <= water + CLEARANCE) return null;
    return { kind, x0: x, x1: x, top, bolts: [[x, top]] };
  }
  const width = rng.range(1, Math.min(3, span - 6));
  const x0 = rng.range(3, span - 3 - width);
  const top = -rng.range(1, 2);
  return { kind, x0, x1: x0 + width, top, bolts: [[x0, top], [x0 + width, top]] };
}

export function createTerrain(rng) {
  const vehicle = rng.pick(['car', 'car', 'truck', 'truck', 'train']);
  const [lo, hi] = VEHICLE_SPANS[vehicle];
  const span = rng.range(lo, hi);
  const leftG = 0, rightG = span;
  const left = leftG * CELL, right = rightG * CELL;
  const bed = -rng.range(8, 12);
  let water = -rng.range(2, 6) - rng.next() * 0.9;
  const feature = riverFeature(rng, span, water);
  // An island always stands clear of the water, so lower the river around it.
  if (feature?.kind === 'island') water = Math.min(water, feature.top * CELL - 1.1 - rng.next() * 0.8);
  // Keep a steep face where a lower bolt is exposed. Elsewhere the bank
  // can roll into the gorge over a much wider shoulder.
  const faceL = rng.range(1, 3) * CELL, faceR = rng.range(1, 3) * CELL;
  const maxSlope = (right - left) * 0.46;
  const slopeL = Math.min(rng.range(3, 7), maxSlope), slopeR = Math.min(rng.range(3, 7), maxSlope);
  const lipL = -faceL > water + CLEARANCE ? 0.06 : slopeL * 0.34;
  const lipR = -faceR > water + CLEARANCE ? 0.06 : slopeR * 0.34;
  const bumps = Array.from({ length: 4 }, () => (rng.next() - 0.5) * 1.6);
  // A short shelf partway down an exposed bluff breaks up even a tall face.
  const shelf = (x, dir, lip, face, noise) => {
    if (lip < 0.1) return [];
    const depth = face * (0.42 + noise * 0.15);
    return [[x + dir * lip * 0.36, -depth], [x + dir * lip * 0.62, -depth - face * 0.05]];
  };
  const bank = [
    [left, 0], ...shelf(left, 1, lipL, faceL, bumps[0]), [left + lipL, -faceL],
    [left + slopeL * 0.6, (-faceL + bed) / 2 + bumps[0]], [left + slopeL, bed + 0.6 + bumps[1] * 0.4],
    [right - slopeR, bed + 0.6 + bumps[2] * 0.4], [right - slopeR * 0.6, (-faceR + bed) / 2 + bumps[3]],
    [right - lipR, -faceR], ...shelf(right, -1, lipR, faceR, bumps[3]).reverse(), [right, 0],
  ];
  const along = (points, x) => {
    if (x <= points[0][0] || x >= points[points.length - 1][0]) return -Infinity;
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      if (x <= x1) {
        const t = (x - x0) / (x1 - x0);
        return y0 + (y1 - y0) * t * t * (3 - 2 * t);
      }
    }
    return -Infinity;
  };
  let rock = null;
  if (feature) {
    const a = feature.x0 * CELL, b = feature.x1 * CELL, top = feature.top * CELL;
    const shoulder = feature.kind === 'pier' ? 0.9 : 1.2, foot = feature.kind === 'pier' ? 2.4 : 4.5;
    rock = [[a - foot, bed], [a - shoulder, top - 0.3], [a - shoulder * 0.4, top], [b + shoulder * 0.4, top], [b + shoulder, top - 0.3], [b + foot, bed]];
  }
  // Natural roughness so no slope or bed is a ruled line: a few sine waves at
  // unrelated frequencies, faded out at the cliff tops and the rock's bolts so
  // those stay where the bolts are.
  const waves = Array.from({ length: 4 }, (_, i) => [0.6 * 2.3 ** i, rng.next() * Math.PI * 2, 0.75 / 1.8 ** i]);
  const rough = (x) => waves.reduce((sum, [f, phase, amp]) => sum + Math.sin(x * f + phase) * amp, 0);
  const fade = (d, width) => Math.max(0, Math.min(1, d / width));
  const ground = (x) => {
    if (x <= left || x >= right) {
      const d = Math.max(left - x, x - right);
      const boltDistance = Math.min(d, Math.abs(d - 2 * CELL));
      const blend = fade(boltDistance, 2);
      return -(0.27 + 0.18 * Math.sin(x * 0.51 + waves[0][1]) + 0.07 * Math.sin(x * 0.89 + waves[1][1])) * blend * blend * (3 - 2 * blend);
    }
    const edge = fade(Math.min(x - left, right - x), 1.2);
    const bankY = along(bank, x) + rough(x) * edge;
    const bedY = bed + rough(x * 1.3 + 7) * 0.8;
    let rockY = -Infinity;
    if (rock) {
      const bolt = fade(Math.min(...feature.bolts.map(([bx]) => Math.abs(x - bx * CELL))), 1);
      rockY = along(rock, x) + rough(x + 3) * bolt;
    }
    return Math.max(bedY, bankY, rockY);
  };
  const anchors = [[leftG, 0], [rightG, 0], [leftG - 2, 0], [rightG + 2, 0]];
  const lowerL = -faceL / CELL, lowerR = -faceR / CELL;
  if (lowerL * CELL > water + CLEARANCE) anchors.push([leftG, lowerL]);
  if (lowerR * CELL > water + CLEARANCE) anchors.push([rightG, lowerR]);
  if (feature) anchors.push(...feature.bolts);
  return {
    vehicle, span, left, right, deck: 0, bed, water, ground, anchors, feature,
    supports: feature ? feature.bolts : [],
    bounds: { minX: leftG - 4, maxX: rightG + 4, minY: Math.ceil((water + CLEARANCE) / CELL), maxY: 5 },
  };
}

/* ---------- building rules ---------- */

/* The road is always laid flat from bank to bank in 2 m pieces: every mission
   starts with it, and the player builds what holds it up. */
export const roadDeck = (mission) => Array.from({ length: mission.span }, (_, i) => ({ a: [i, 0], b: [i + 1, 0], mat: 'road' }));

export function isAnchor(mission, p) {
  return mission.anchors.some((a) => a[0] === p[0] && a[1] === p[1]);
}

// Build-space reservations are stored in world metres. A shipping lane
// spans a continuous stretch of open water, clear of islands and piers.
function chooseClearance(mission, kind, rng) {
  if (kind === 'ceiling') return {
    kind, x0: mission.bounds.minX * CELL, x1: mission.bounds.maxX * CELL, y0: mission.deck + 4, y1: mission.bounds.maxY * CELL,
  };
  if (kind !== 'channel') return null;
  const width = (mission.span >= 8 && rng.chance(0.5) ? 3 : 2) * CELL;
  const starts = [];
  for (let x = mission.left + CELL; x + width <= mission.right - CELL; x += CELL) {
    let open = true;
    for (let at = x; at <= x + width; at += 0.25) if (mission.ground(at) > mission.water - 0.25) { open = false; break; }
    if (open) starts.push(x);
  }
  if (!starts.length) return null;
  const x0 = rng.pick(starts);
  return { kind, x0, x1: x0 + width, y0: mission.water, y1: mission.deck - 0.5 };
}

function clearanceProblem(mission, p, q = p) {
  const zone = mission.clearance;
  if (!zone) return null;
  const epsilon = 1e-6;
  if (zone.kind === 'ceiling') return Math.max(p[1], q[1]) * CELL > zone.y0 + epsilon ? 'ceiling' : null;
  // Clip the entire member against the open rectangle. Both endpoints may
  // lie outside a channel even when the member cuts across its middle.
  let enter = 0, leave = 1;
  for (const [axis, lower, upper] of [[0, zone.x0, zone.x1], [1, zone.y0, zone.y1]]) {
    const a = p[axis] * CELL, delta = (q[axis] - p[axis]) * CELL;
    if (!delta) {
      if (a <= lower + epsilon || a >= upper - epsilon) return null;
      continue;
    }
    const t0 = (lower + epsilon - a) / delta, t1 = (upper - epsilon - a) / delta;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
    if (enter > leave) return null;
  }
  return 'channel';
}

export function jointAllowed(mission, p) {
  if (isAnchor(mission, p)) return true;
  if (clearanceProblem(mission, p)) return false;
  const { minX, maxX, minY, maxY } = mission.bounds;
  if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) return false;
  const x = p[0] * CELL, y = p[1] * CELL;
  if (y < mission.water + CLEARANCE) return false;
  return y >= mission.ground(x) - 1e-6;
}

/* Why a member can't be built, or null when it can. */
export function memberProblem(mission, members, m) {
  if (m.a[0] === m.b[0] && m.a[1] === m.b[1]) return 'same';
  const reserved = clearanceProblem(mission, m.a, m.b);
  if (reserved) return reserved;
  if (!jointAllowed(mission, m.a) || !jointAllowed(mission, m.b)) return 'ground';
  if (memberLength(m) > MATERIALS[m.mat].maxLength + 1e-6) return 'long';
  if (isAnchor(mission, m.a) && isAnchor(mission, m.b)) return 'anchors';
  if (m.mat === 'road' && Math.abs(m.b[1] - m.a[1]) * 2 > Math.abs(m.b[0] - m.a[0])) return 'steep';
  // Inside the rock? Sample the member's length against the ground line.
  const ax = m.a[0] * CELL, ay = m.a[1] * CELL, bx = m.b[0] * CELL, by = m.b[1] * CELL;
  for (let t = 0.04; t < 0.97; t += 0.04) {
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (y < mission.ground(x) - 0.05) return 'ground';
  }
  const k = pairKey(m);
  if (members.some((o) => pairKey(o) === k)) return 'exists';
  return null;
}

/* Put a socket at each metre along the dominant axis. A sloping member
   can take a brace between grid lines as well as at a grid intersection. */
export function attachmentPoints(m) {
  if (m.mat === 'road') return [];
  const dx = m.b[0] - m.a[0], dy = m.b[1] - m.a[1];
  const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
  const a = m.a[axis], b = m.b[axis], points = [];
  const round = (v) => Math.round(v * 1e6) / 1e6;
  for (let tick = Math.floor(Math.min(a, b) * CELL) + 1; tick < Math.max(a, b) * CELL; tick++) {
    const t = (tick / CELL - a) / (b - a);
    points.push([round(m.a[0] + t * dx), round(m.a[1] + t * dy)]);
  }
  return points;
}

export const pairKey = (m) => {
  const a = key(m.a), b = key(m.b);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

/* ---------- designs ---------- */

export const DESIGN_NAMES = {
  below: 'deck truss', above: 'through truss', both: 'deep truss', arch: 'arch',
  stayed: 'cable-stayed bridge', beam: 'beam bridge on piers',
  warren: 'Warren truss', bowstring: 'bowstring truss', fan: 'single-tower cable-stayed bridge',
};

/* One of the classic bridge families with random proportions. Returns
   { members, kind } with every member legal but not yet tested. */
function design(mission, rng, family) {
  const n = mission.span;
  const supports = mission.supports;
  const maxDepth = Math.min(3, Math.floor(-mission.bounds.minY));
  const lowerL = mission.anchors.find((a) => a[0] === 0 && a[1] < 0);
  const lowerR = mission.anchors.find((a) => a[0] === n && a[1] < 0);
  // Suspension bridges are left for players to discover: on a 2 m grid the
  // main cable can't be shaped tall and smooth enough to carry a stiff road.
  const kinds = ['above', 'above', 'stayed'];
  if (maxDepth >= 1) kinds.push('below', 'both');
  if (lowerL && lowerR) kinds.push('arch', 'arch');
  if (supports.length) kinds.push('beam', 'beam');
  const kind = family ?? rng.pick(kinds);
  const members = [];
  const add = (a, b, mat) => {
    const m = { a, b, mat };
    if (!memberProblem(mission, members, m)) { members.push(m); return true; }
    if (mat === 'wood' && !memberProblem(mission, members, { ...m, mat: 'steel' })) {
      members.push({ ...m, mat: 'steel' });
      return true;
    }
    return false;
  };
  const deck = (i) => [i, 0];
  for (let i = 0; i < n; i++) add(deck(i), deck(i + 1), 'road');
  // Posts from every rock bolt up to the road, braced to the road on both sides.
  const posts = () => {
    for (const [x, y] of supports) {
      add([x, y], deck(x), 'wood');
      if (rng.chance(0.7)) { add([x, y], deck(x - 1), 'wood'); add([x, y], deck(x + 1), 'wood'); }
    }
  };

  /* Chords drawn as a profile of heights, one per deck joint, then joined to
     the road by verticals and diagonals in a classic pattern. */
  const truss = (profile, sign) => {
    const pattern = rng.pick(['pratt', 'howe', 'warren', 'x']);
    const node = (i) => [i, profile[i]];
    for (let i = 0; i < n; i++) if (profile[i] !== 0 || profile[i + 1] !== 0) add(node(i), node(i + 1), 'wood');
    for (let i = 0; i <= n; i++) if (profile[i] !== 0) add(deck(i), node(i), 'wood');
    for (let i = 0; i < n; i++) {
      const leftHalf = i < n / 2;
      // Pratt diagonals hang in tension towards the middle; Howe's lean the other way.
      const down = pattern === 'pratt' ? leftHalf : pattern === 'howe' ? !leftHalf : pattern === 'warren' ? i % 2 === 0 : null;
      const pairs = down === null ? [[deck(i), node(i + 1)], [node(i), deck(i + 1)]]
        : (down === (sign < 0)) ? [[deck(i), node(i + 1)]] : [[node(i), deck(i + 1)]];
      for (const [a, b] of pairs) if (a[1] !== 0 || b[1] !== 0) add(a, b, 'wood');
    }
  };
  const belowProfile = (d, endL, endR) => {
    const profile = [];
    for (let i = 0; i <= n; i++) {
      let depth = Math.min(d, endL + i, endR + (n - i));
      for (const [x, y] of supports) depth = Math.max(depth, -y - Math.abs(i - x));
      profile.push(-Math.min(depth, maxDepth));
    }
    return profile;
  };
  const aboveProfile = (h) => {
    const flat = rng.chance(0.4);
    return Array.from({ length: n + 1 }, (_, i) => (flat ? (i === 0 || i === n ? 0 : h) : Math.min(h, i, n - i)));
  };
  /* A pylon on each bank: a vertical mast braced back to the land bolt. */
  const pylons = (h) => {
    for (const [base, back] of [[0, -2], [n, n + 2]]) {
      add([base, 0], [base, h], 'steel');
      add([back, 0], [base, h], 'steel');
    }
  };

  if (kind === 'warren') {
    // Each top joint spans two road panels. The triangles alternate across
    // the river, with a hanger for the deck joint between each pair of feet.
    const height = rng.range(mission.vehicle === 'car' ? 1 : 2, 3);
    const hanger = rng.pick(['wood', 'cable']);
    let previous;
    for (let i = 1; i < n; i += 2) {
      const top = [i, height];
      if (i > 1) add(previous, top, 'wood');
      add(deck(i - 1), top, 'wood');
      add(top, deck(i), hanger);
      add(top, deck(i + 1), 'wood');
      previous = top;
    }
    if (n % 2) add(previous, deck(n), 'wood');
    posts();
  } else if (kind === 'bowstring') {
    // A polygonal upper arch meets the deck tie at both banks. Hangers
    // suspend each deck joint, with diagonal webs to resist uneven loading.
    const rise = rng.range(2, Math.min(4, Math.ceil(n / 2)));
    const hanger = rng.pick(['wood', 'cable']);
    const rib = (i) => [i, Math.round(rise * 4 * i * (n - i) / (n * n))];
    for (let i = 0; i < n; i++) {
      add(rib(i), rib(i + 1), 'wood');
      if (i) add(deck(i), rib(i), hanger);
      if (i > 0 && i < n - 1) {
        if (i < n / 2) add(rib(i), deck(i + 1), 'wood');
        else add(rib(i + 1), deck(i), 'wood');
      }
    }
    posts();
  } else if (kind === 'fan') {
    const bank = rng.pick([0, n]), inland = bank === 0 ? -2 : n + 2;
    const height = rng.range(2, 4), top = [bank, height];
    add(deck(bank), top, 'steel');
    add(deck(inland), top, 'cable');
    for (let i = 1; i < n; i++) add(top, deck(i), 'cable');
    posts();
  } else if (kind === 'below' || kind === 'both') {
    truss(belowProfile(rng.range(1, maxDepth), 0, 0), -1);
    if (kind === 'both') truss(aboveProfile(rng.range(1, 2)), 1);
  } else if (kind === 'arch') {
    const d = Math.max(-lowerL[1], -lowerR[1], rng.range(1, maxDepth));
    if (d > maxDepth) return null;
    truss(belowProfile(d, -lowerL[1], -lowerR[1]), -1);
  } else if (kind === 'above') {
    truss(aboveProfile(rng.range(1, 3)), 1);
    posts();
  } else if (kind === 'beam') {
    posts();
    // Short spans between bank and rock, each with a shallow truss of its own.
    truss(aboveProfile(1), 1);
  } else if (kind === 'stayed') {
    const h = rng.range(2, 3);
    pylons(h);
    for (let i = 1; i < n; i++) add(i <= n / 2 ? [0, h] : [n, h], deck(i), 'cable');
    posts();
  }
  return members.length > n ? { members, kind } : null;
}

/* Test a design and strengthen its weak members until it carries the
   vehicle with a little to spare, then try lighter members where it can. */
function testDesign(mission, members) {
  let current = members.map((m) => ({ ...m }));
  for (let round = 0; round < 5; round++) {
    const sim = createSim(mission, current, mission.vehicle, { abortOnBreak: true });
    const passed = sim.run();
    let changed = false;
    current.forEach((m, i) => {
      const beam = sim.beams[i];
      const used = beam.broken ? 1.2 : beam.peak;
      if (used > 0.85 && current[i].mat === 'wood' && memberLength(current[i]) <= MATERIALS.steel.maxLength) {
        current[i].mat = 'steel';
        changed = true;
      }
    });
    // An upgrade changes the load and the clearance. Accept only the
    // exact set of members that just completed the crossing.
    if (!changed) return passed && sim.peakUsage() < 0.95 ? lighten(mission, current, sim) : null;
  }
  return null;
}

// Several randomized families can produce exactly the same draft. Include
// endpoint direction and member order because the solver projects in order.
const testedDrafts = new WeakMap();
function strengthen(mission, members) {
  let cache = testedDrafts.get(mission);
  if (!cache) { cache = new Map(); testedDrafts.set(mission, cache); }
  const id = members.map((m) => `${m.mat}:${m.a}>${m.b}`).join('|');
  if (cache.has(id)) return cache.get(id);
  const result = testDesign(mission, members);
  if (cache.size === 64) cache.delete(cache.keys().next().value);
  cache.set(id, result);
  return result;
}

function lighten(mission, members, sim) {
  const lighter = members.map((m, i) => (m.mat === 'steel' && sim.beams[i].peak < 0.28 && memberLength(m) <= MATERIALS.wood.maxLength ? { ...m, mat: 'wood' } : m));
  if (lighter.every((m, i) => m.mat === members[i].mat)) return members;
  const check = createSim(mission, lighter);
  return check.run() && check.peakUsage() < 0.95 ? lighter : members;
}

// Strengthening changes only wood and steel. Even if every eligible steel
// member could become wood, an already over-budget design cannot be a hint.
function cheapestMaterials(members) {
  let cost = 0;
  for (const m of members) {
    const length = memberLength(m);
    const mat = m.mat === 'steel' && length <= MATERIALS.wood.maxLength ? MATERIALS.wood : MATERIALS[m.mat];
    cost += Math.round(length * mat.cost);
  }
  return cost;
}

/* Several strengthened designs; the cheapest becomes the mission's proof. */
export function solve(mission, rng, attempts = 10, varied = false, margin = Infinity) {
  const found = [];
  let ceiling = Infinity;
  const families = varied ? rng.shuffle(['warren', 'bowstring', 'fan', null, null]) : [];
  for (let i = 0; i < attempts; i++) {
    const draft = design(mission, rng, families[i]);
    if (!draft || (ceiling < Infinity && cheapestMaterials(draft.members) > ceiling)) continue;
    const solution = strengthen(mission, draft.members);
    if (solution) {
      const cost = bridgeCost(solution);
      found.push({ members: solution, cost, kind: draft.kind });
      ceiling = Math.min(ceiling, cost * (1 + margin));
    }
  }
  found.sort((a, b) => a.cost - b.cost);
  return found;
}

// Cache designs the solver has already driven across this particular
// river, including the original survey candidates that fit the budget.
const verified = new WeakMap();
function geometry(members) {
  return new Set(members.filter((m) => m.mat !== 'road').map(pairKey));
}
function difference(a, b) {
  let shared = 0;
  for (const member of a) if (b.has(member)) shared++;
  const total = a.size + b.size - shared;
  return total ? 1 - shared / total : 0;
}
function remember(pool, members, kind) {
  const edges = geometry(members);
  if (!pool.some((candidate) => difference(edges, candidate.edges) === 0)) pool.push({ members, kind, edges });
}

const surveyRng = (seed, tries) => createRng(`${seed}:${tries}`);

// The ground closure cannot cross a worker boundary. Recreate only the
// sampled terrain from its survey seed, alongside the already proven design.
export function restoreMission(fields) {
  const { ground } = createTerrain(surveyRng(fields.seed, fields.tries));
  return { ...fields, ground };
}

export function createMission(difficulty, seed) {
  const margin = MARGINS[difficulty] ?? MARGINS.medium;
  const varied = typeof seed === 'string' && seed.startsWith('v2-');
  const reservation = varied ? createRng(`${seed}:clearance`).pick(['channel', 'ceiling', null]) : null;
  // A valley with no bridge we can prove is thrown away for the next one.
  for (let tries = 0; tries < 40; tries++) {
    const rng = surveyRng(seed, tries);
    const terrain = createTerrain(rng);
    if (varied) {
      terrain.clearance = chooseClearance(terrain, reservation, rng);
      if (reservation && !terrain.clearance) continue;
    }
    const solutions = solve(terrain, rng, 10, varied, margin);
    if (!solutions.length) continue;
    const best = solutions[0];
    const budget = Math.floor(best.cost * (1 + margin) / 10) * 10;
    const mission = { ...terrain, seed, difficulty, margin, budget: Math.max(budget, best.cost), reference: best.members, referenceKind: best.kind, tries };
    testedDrafts.set(mission, testedDrafts.get(terrain));
    const pool = [];
    for (const s of solutions) if (s.cost <= mission.budget) remember(pool, s.members, s.kind);
    verified.set(mission, pool);
    return mission;
  }
  throw new Error(`No solvable valley for seed ${seed}`);
}

/* Try several new shapes, then choose among all the proven options. The
   recent drawings come from the editor and are compared by their members'
   endpoints, so a material swap alone cannot count as a new shape. */
export function randomSolution(mission, random = Math.random, timeLimitMs = 600, recent = []) {
  const rng = createRng(Math.floor(random() * 2 ** 32));
  const pool = verified.get(mission) ?? [];
  if (!pool.length) remember(pool, mission.reference, mission.referenceKind);
  verified.set(mission, pool);
  const families = rng.shuffle(['warren', 'bowstring', 'fan', null, null, null]);
  const started = Date.now();
  for (const family of families) {
    if (pool.length >= 32 || Date.now() - started >= timeLimitMs) break;
    const draft = design(mission, rng, family);
    if (!draft || cheapestMaterials(draft.members) > mission.budget) continue;
    const edges = geometry(draft.members);
    if (pool.some((s) => difference(edges, s.edges) === 0)) continue;
    const solution = strengthen(mission, draft.members);
    if (solution && bridgeCost(solution) <= mission.budget) remember(pool, solution, draft.kind);
  }
  let choices = pool;
  if (recent.length) {
    const history = recent.map(geometry), previous = history.at(-1);
    const distances = pool.map((s) => difference(previous, s.edges));
    const farthest = Math.max(...distances);
    // Prefer a visibly changed web. If all known options are close, take
    // the most different one, including a small change on a tight budget.
    choices = pool.filter((s, i) => distances[i] >= Math.min(0.55, farthest));
    const unseen = choices.filter((s) => history.every((edges) => difference(edges, s.edges) > 0));
    if (unseen.length) choices = unseen;
  }
  const pick = rng.pick(choices);
  return { members: pick.members.map((m) => ({ ...m })), kind: pick.kind };
}
