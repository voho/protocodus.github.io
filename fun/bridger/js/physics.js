/* Bridge physics. Every member is an axial spring between two pin joints,
   solved with XPBD (small substeps, one projection each), so a stiff steel
   truss and a sagging rope stay stable at the same time step. Vehicles roll
   along road members and press on their two joints with their own weight. */

export const CELL = 2; // metres between grid points
export const GRAVITY = 9.81;
export const STEP = 1 / 60;
const SUBSTEPS = 24;
const DAMPING = 1.2; // 1/s, bleeds off ringing so a bridge settles
const FORCE_SMOOTHING = 0.04; // s, a member breaks on a sustained force, not one noisy substep

/* Strength is the force a member carries before it snaps (newtons), the
   same in tension and compression, except a cable, which only pulls. */
export const MATERIALS = {
  road: { name: 'Road', cost: 30, kgPerM: 120, ea: 1e8, strength: 80e3, maxLength: 4.1 },
  wood: { name: 'Wood', cost: 10, kgPerM: 20, ea: 3e7, strength: 40e3, maxLength: 6 },
  steel: { name: 'Steel', cost: 25, kgPerM: 40, ea: 1.2e8, strength: 110e3, maxLength: 8.5 },
  cable: { name: 'Cable', cost: 12, kgPerM: 5, ea: 1.5e8, strength: 90e3, maxLength: 20.5, tensionOnly: true },
};

/* Axles carry the weight; offsets are metres behind the vehicle's nose. */
export const VEHICLES = {
  car: { name: 'Car', speed: 7, length: 4.2, axles: [[0.8, 800], [3.4, 700]] },
  truck: { name: 'Truck', speed: 5, length: 7.4, axles: [[1.2, 1600], [5.4, 2200], [6.6, 2200]] },
  train: {
    name: 'Train', speed: 4.5, length: 22.6,
    axles: [[1.5, 2500], [5.5, 2500], [9, 1800], [13, 1800], [16.5, 1800], [20.5, 1800]],
  },
};

export const memberLength = (m) => Math.hypot((m.b[0] - m.a[0]) * CELL, (m.b[1] - m.a[1]) * CELL);
export const memberCost = (m) => Math.round(memberLength(m) * MATERIALS[m.mat].cost);
export const bridgeCost = (members) => members.reduce((sum, m) => sum + memberCost(m), 0);
export const key = (p) => `${p[0]},${p[1]}`;

/* mission: { left, right (m, bank edges), deck (m), anchors, ground(x), water }
   members: [{ a: [gx, gy], b: [gx, gy], mat }] */
export function createSim(mission, members, vehicleId = mission.vehicle, { abortOnBreak = false } = {}) {
  const anchorKeys = new Set(mission.anchors.map(key));
  const index = new Map();
  const nodes = [];
  const nodeAt = (p) => {
    const k = key(p);
    if (!index.has(k)) {
      index.set(k, nodes.length);
      nodes.push({ x: p[0] * CELL, y: p[1] * CELL, vx: 0, vy: 0, px: 0, py: 0, mass: 4, extra: 0, fixed: anchorKeys.has(k) });
    }
    return index.get(k);
  };
  const beams = members.map((m) => {
    const mat = MATERIALS[m.mat];
    const a = nodeAt(m.a), b = nodeAt(m.b);
    const length = memberLength(m);
    nodes[a].mass += mat.kgPerM * length / 2;
    nodes[b].mass += mat.kgPerM * length / 2;
    return { a, b, mat: m.mat, tensionOnly: !!mat.tensionOnly, length, compliance: length / mat.ea, strength: mat.strength, force: 0, smooth: 0, usage: 0, peak: 0, broken: false, road: m.mat === 'road' };
  });

  // The ground line sampled every 10 cm: the solver asks for it every substep.
  const g0 = mission.left - 60;
  const groundTable = Float64Array.from({ length: Math.ceil((mission.right - mission.left + 120) * 10) + 1 }, (_, i) => mission.ground(g0 + i / 10));
  const groundAt = (x) => {
    const f = (x - g0) * 10;
    const i = Math.max(0, Math.min(groundTable.length - 2, Math.floor(f)));
    return groundTable[i] + (groundTable[i + 1] - groundTable[i]) * (f - i);
  };

  const vehicle = VEHICLES[vehicleId];
  const startX = mission.left - vehicle.length - 3;
  const car = {
    id: vehicleId, def: vehicle,
    front: startX + vehicle.length,
    axles: vehicle.axles.map(([offset, mass]) => ({ offset, mass, x: 0, y: mission.deck, beam: -1, t: 0 })),
    state: 'waiting', // waiting, driving, falling, crossed
    fallVy: 0, tilt: 0,
  };
  const sim = { nodes, beams, car, time: 0, result: null, brokeCount: 0, events: [] };
  const settle = 1;

  function support(x, previousY) {
    if (x <= mission.left || x >= mission.right) return { y: mission.ground(x), beam: -1, t: 0 };
    let best = null;
    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i];
      if (!beam.road || beam.broken) continue;
      const na = nodes[beam.a], nb = nodes[beam.b];
      const lo = Math.min(na.x, nb.x), hi = Math.max(na.x, nb.x);
      if (x < lo - 1e-6 || x > hi + 1e-6 || hi - lo < 0.2) continue;
      const t = (x - na.x) / (nb.x - na.x);
      const y = na.y + (nb.y - na.y) * t;
      // Wheels stay on the road they are on; a road far below is a fall.
      if (y > previousY + 0.9 || y < previousY - 0.9) continue;
      if (!best || Math.abs(y - previousY) < Math.abs(best.y - previousY)) best = { y, beam: i, t };
    }
    return best;
  }

  function placeVehicle() {
    for (const axle of car.axles) {
      axle.x = car.front - axle.offset;
      const s = support(axle.x, axle.y);
      if (!s) return false;
      axle.y = s.y; axle.beam = s.beam; axle.t = s.t;
    }
    return true;
  }
  placeVehicle();

  function step() {
    if (sim.result && sim.time > sim.resultAt + 3) return;
    sim.time += STEP;
    sim.events.length = 0;
    if (car.state === 'waiting' && sim.time >= settle) car.state = 'driving';
    if (car.state === 'driving') {
      car.front += vehicle.speed * STEP;
      if (!placeVehicle()) {
        car.state = 'falling';
        sim.events.push('fall');
      } else if (car.front - vehicle.length > mission.right + 1.5) {
        car.state = 'crossed';
        finish('win');
      }
    }
    if (car.state === 'falling') {
      car.fallVy -= GRAVITY * STEP;
      car.tilt += STEP * 0.9;
      for (const axle of car.axles) { axle.y += car.fallVy * STEP; axle.beam = -1; }
      car.front += vehicle.speed * 0.5 * STEP;
      if (!sim.result) finish('fall');
      if (car.axles[0].y < mission.water && !sim.splashed) { sim.splashed = true; sim.events.push('splash'); }
    }

    for (const node of nodes) node.extra = 0;
    if (car.state === 'driving' || car.state === 'waiting') {
      for (const axle of car.axles) {
        if (axle.beam < 0) continue;
        const beam = beams[axle.beam];
        nodes[beam.a].extra += axle.mass * (1 - axle.t);
        nodes[beam.b].extra += axle.mass * axle.t;
      }
    }

    const h = STEP / SUBSTEPS;
    const h2 = h * h;
    const damp = Math.exp(-DAMPING * h);
    const blend = 1 - Math.exp(-h / FORCE_SMOOTHING);
    for (const beam of beams) beam.force = 0;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const n of nodes) {
        if (n.fixed) continue;
        n.vy -= GRAVITY * h;
        n.vx *= damp; n.vy *= damp;
        n.px = n.x; n.py = n.y;
        n.x += n.vx * h; n.y += n.vy * h;
      }
      for (const beam of beams) {
        if (beam.broken) continue;
        const na = nodes[beam.a], nb = nodes[beam.b];
        const wa = na.fixed ? 0 : 1 / (na.mass + na.extra);
        const wb = nb.fixed ? 0 : 1 / (nb.mass + nb.extra);
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const c = d - beam.length;
        let tension = 0;
        if (!(beam.tensionOnly && c < 0) && wa + wb > 0) {
          const lambda = -c / (wa + wb + beam.compliance / h2);
          const ux = dx / d, uy = dy / d;
          na.x -= wa * lambda * ux; na.y -= wa * lambda * uy;
          nb.x += wb * lambda * ux; nb.y += wb * lambda * uy;
          tension = -lambda / h2;
        }
        beam.smooth += (tension - beam.smooth) * blend;
        beam.force = tension;
      }
      for (const n of nodes) {
        if (n.fixed) continue;
        // Wreckage lands on the banks and the river bed instead of falling through.
        const ground = n.y < 0.01 ? groundAt(n.x) : -1e9;
        if (n.y < ground) { n.y = ground; n.vx *= 0.6; }
        n.vx = (n.x - n.px) / h; n.vy = (n.y - n.py) / h;
        if (n.y < mission.water) { n.vx *= 0.97; n.vy *= 0.97; }
      }
      for (const beam of beams) {
        if (beam.broken) continue;
        beam.usage = Math.abs(beam.smooth) / beam.strength;
        if (beam.usage > beam.peak) beam.peak = Math.min(beam.usage, 1);
        if (beam.usage > 1) {
          beam.broken = true; beam.usage = 0;
          sim.brokeCount++;
          sim.events.push('break');
          if (abortOnBreak && !sim.result) finish('break');
        }
      }
    }
    if (!sim.result && sim.time > 60) finish('timeout');
  }

  function finish(result) {
    sim.result = result;
    sim.resultAt = sim.time;
  }

  sim.step = step;
  /* Run to the end with no drawing: true when the vehicle crosses. */
  sim.run = (limit = 60) => {
    while (!sim.result && sim.time < limit) step();
    return sim.result === 'win';
  };
  sim.peakUsage = () => beams.reduce((max, b) => Math.max(max, b.broken ? 1 : b.peak), 0);
  return sim;
}
