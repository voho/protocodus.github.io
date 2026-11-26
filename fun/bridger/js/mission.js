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
  // A vertical rock face under each bank edge, as deep as its lower bolt.
  const faceL = rng.range(1, 3) * CELL, faceR = rng.range(1, 3) * CELL;
  const slopeL = rng.range(3, 7), slopeR = rng.range(3, 7);
  const bumps = Array.from({ length: 4 }, () => (rng.next() - 0.5) * 1.6);
  const bank = [
    [left, 0], [left + 0.02, -faceL], [left + slopeL * 0.5, (-faceL + bed) / 2 + bumps[0]], [left + slopeL, bed + 0.6 + bumps[1] * 0.4],
    [right - slopeR, bed + 0.6 + bumps[2] * 0.4], [right - slopeR * 0.5, (-faceR + bed) / 2 + bumps[3]], [right - 0.02, -faceR], [right, 0],
  ];
  const along = (points, x) => {
    if (x <= points[0][0] || x >= points[points.length - 1][0]) return -Infinity;
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      if (x <= x1) return y0 + (y1 - y0) * (x - x0) / Math.max(1e-6, x1 - x0);
    }
    return -Infinity;
  };
  let rock = null;
  if (feature) {
    const a = feature.x0 * CELL, b = feature.x1 * CELL, top = feature.top * CELL;
    const shoulder = feature.kind === 'pier' ? 0.9 : 1.2, foot = feature.kind === 'pier' ? 2.4 : 4.5;
    rock = [[a - foot, bed], [a - shoulder, top - 0.3], [a - shoulder * 0.4, top], [b + shoulder * 0.4, top], [b + shoulder, top - 0.3], [b + foot, bed]];
  }
  const ground = (x) => {
    if (x <= left || x >= right) return 0;
    return Math.max(bed, along(bank, x), rock ? along(rock, x) : -Infinity);
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

export function isAnchor(mission, p) {
  return mission.anchors.some((a) => a[0] === p[0] && a[1] === p[1]);
}

export function jointAllowed(mission, p) {
  if (isAnchor(mission, p)) return true;
  const { minX, maxX, minY, maxY } = mission.bounds;
  if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) return false;
  const x = p[0] * CELL, y = p[1] * CELL;
  if (y < mission.water + CLEARANCE) return false;
  return y >= mission.ground(x) - 1e-6;
}

/* Why a member can't be built, or null when it can. */
export function memberProblem(mission, members, m) {
  if (m.a[0] === m.b[0] && m.a[1] === m.b[1]) return 'same';
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

export const pairKey = (m) => {
  const a = key(m.a), b = key(m.b);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

/* ---------- designs ---------- */

export const DESIGN_NAMES = {
  below: 'deck truss', above: 'through truss', both: 'deep truss', arch: 'arch',
  stayed: 'cable-stayed bridge', beam: 'beam bridge on piers',
};

/* One of the classic bridge families with random proportions. Returns
   { members, kind } with every member legal but not yet tested. */
function design(mission, rng) {
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
  const kind = rng.pick(kinds);
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

  if (kind === 'below' || kind === 'both') {
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
function strengthen(mission, members) {
  let current = members.map((m) => ({ ...m }));
  for (let round = 0; round < 5; round++) {
    const sim = createSim(mission, current, mission.vehicle, { abortOnBreak: true });
    const passed = sim.run();
    let changed = false;
    sim.beams.forEach((beam, i) => {
      const used = beam.broken ? 1.2 : beam.peak;
      if (used > 0.85 && current[i].mat === 'wood' && memberLength(current[i]) <= MATERIALS.steel.maxLength) {
        current[i].mat = 'steel';
        changed = true;
      }
    });
    if (passed && sim.peakUsage() < 0.95) return lighten(mission, current, sim);
    if (!changed) return null;
  }
  return null;
}

function lighten(mission, members, sim) {
  const lighter = members.map((m, i) => (m.mat === 'steel' && sim.beams[i].peak < 0.28 && memberLength(m) <= MATERIALS.wood.maxLength ? { ...m, mat: 'wood' } : m));
  if (lighter.every((m, i) => m.mat === members[i].mat)) return members;
  const check = createSim(mission, lighter);
  return check.run() && check.peakUsage() < 0.95 ? lighter : members;
}

/* Several strengthened designs; the cheapest becomes the mission's proof. */
export function solve(mission, rng, attempts = 10) {
  const found = [];
  for (let i = 0; i < attempts; i++) {
    const draft = design(mission, rng);
    if (!draft) continue;
    const solution = strengthen(mission, draft.members);
    if (solution) found.push({ members: solution, cost: bridgeCost(solution), kind: draft.kind });
  }
  found.sort((a, b) => a.cost - b.cost);
  return found;
}

export function createMission(difficulty, seed) {
  const margin = MARGINS[difficulty] ?? MARGINS.medium;
  // A valley with no bridge we can prove is thrown away for the next one.
  for (let tries = 0; tries < 40; tries++) {
    const rng = createRng(`${seed}:${tries}`);
    const terrain = createTerrain(rng);
    const solutions = solve(terrain, rng);
    if (!solutions.length) continue;
    const best = solutions[0];
    const budget = Math.floor(best.cost * (1 + margin) / 10) * 10;
    return { ...terrain, seed, difficulty, margin, budget: Math.max(budget, best.cost), reference: best.members, referenceKind: best.kind, tries };
  }
  throw new Error(`No solvable valley for seed ${seed}`);
}

/* A fresh design for "Show solution": a random family and proportions,
   within budget, always one the simulation has seen carry the vehicle across. */
export function randomSolution(mission, random = Math.random, timeLimitMs = 1500) {
  const rng = createRng(Math.floor(random() * 2 ** 32));
  const started = Date.now();
  while (Date.now() - started < timeLimitMs) {
    const draft = design(mission, rng);
    if (!draft) continue;
    const solution = strengthen(mission, draft.members);
    if (solution && bridgeCost(solution) <= mission.budget) return { members: solution, kind: draft.kind };
  }
  return { members: mission.reference.map((m) => ({ ...m })), kind: mission.referenceKind };
}
