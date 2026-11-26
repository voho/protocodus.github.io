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

/* Vehicle bodies, each on a pair of axles: [front axle, rear axle, kind]. */
export const BODIES = { car: [[0, 1, 'car']], truck: [[0, 2, 'truck']], train: [[0, 1, 'loco'], [2, 3, 'wagon'], [4, 5, 'wagon']] };
export const WHEEL = { car: 0.42, truck: 0.5, loco: 0.5, wagon: 0.5 };
/* Body outlines traced from the sprites (convex, above the axles), in body
   metres for each kind's own wheelbase: rear axle on the road at the origin,
   x forward, y up. Wheels are circles of their own below them. */
const OUTLINE = {
  car: { base: 2.6, points: [[-0.67, 0.44], [3.38, 0.44], [3.46, 0.61], [3.33, 0.91], [1.66, 1.6], [1.29, 1.65], [0.12, 1.64], [-0.13, 1.57], [-0.63, 1.1], [-0.77, 0.63]] },
  truck: { base: 5.4, points: [[-1.81, 0.77], [-1.65, 0.57], [-0.58, 0.53], [5.93, 0.53], [6.99, 0.55], [6.95, 1.85], [6.57, 2.57], [5.96, 3.21], [4.51, 3.66], [-1.69, 3.66]] },
  loco: { base: 4, points: [[-1.56, 0.69], [-1.05, 0.54], [5.06, 0.54], [5.6, 0.98], [5.1, 1.91], [4.28, 2.58], [0.98, 2.83], [-0.53, 2.83], [-0.8, 2.69], [-1.59, 1.02]] },
  wagon: { base: 4, points: [[-1.39, 0.66], [-0.92, 0.54], [4.38, 0.53], [5.33, 0.63], [5.38, 0.89], [4.99, 2.07], [4.78, 2.21], [-0.81, 2.2], [-1.01, 2.01], [-1.39, 0.87]] },
};
/* Spacing of the contact points along a body's outline (m). */
const OUTLINE_STEP = 0.3;
/* How close wreckage gets to a member's centre line before it touches. */
const THICKNESS = { road: 0.06, wood: 0.1, steel: 0.1, cable: 0.04 };
/* The most a contact pushes in one substep (m): deep overlaps resolve over a
   few substeps instead of firing pieces off at hundreds of metres a second. */
const PUSH = 0.02;

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
      nodes.push({ x: p[0] * CELL, y: p[1] * CELL, vx: 0, vy: 0, px: 0, py: 0, mass: 4, extra: 0, fixed: anchorKeys.has(k), radius: 0, grip: 0.4 });
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
    bodies: null,
  };
  // Stiff links between the bodies of a fallen train; never drawn.
  const links = [];
  // Nodes that bump into members: vehicle bodies after a fall, and joints
  // and pieces set loose by a break. An intact bridge never collides with
  // itself, so a bridge that holds behaves exactly as before.
  const colliders = new Set();
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
    if (sim.result && sim.time > sim.resultAt + (sim.result === 'win' ? 3 : 8)) return;
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
    if (car.state === 'falling' && !car.bodies) {
      releaseVehicle();
      finish('fall');
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
      for (const link of links) {
        const na = nodes[link.a], nb = nodes[link.b];
        const wa = 1 / na.mass, wb = 1 / nb.mass;
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const k = (d - link.length) / (d * (wa + wb));
        na.x += wa * k * dx; na.y += wa * k * dy;
        nb.x -= wb * k * dx; nb.y -= wb * k * dy;
      }
      for (const i of colliders) collide(i);
      if (car.bodies) {
        for (const body of car.bodies) {
          for (let i = body.first; i < body.first + body.rest.length; i++) if (nodes[i].y - nodes[i].radius < 0.05) touchGround(nodes[i]);
          keepOut(body);
          holdShape(body);
        }
      }
      for (const n of nodes) {
        if (n.fixed) continue;
        // Wreckage lands on the banks and the river bed instead of falling through.
        if (!n.body && n.y - n.radius < 0.05) touchGround(n);
        n.vx = (n.x - n.px) / h; n.vy = (n.y - n.py) / h;
        if (n.y < mission.water) {
          // Water drag: pieces sink at a metre or two a second.
          const drag = n.body ? 0.99 : 0.995;
          n.vx *= drag; n.vy *= drag;
          // A sinking vehicle is mostly air at first, so it goes down slowly.
          if (n.body) n.vy += GRAVITY * h * 0.6;
        }
      }
      for (const beam of beams) {
        if (beam.broken || beam.piece) continue;
        beam.usage = Math.abs(beam.smooth) / beam.strength;
        if (beam.usage > beam.peak) beam.peak = Math.min(beam.usage, 1);
        if (beam.usage > 1) {
          snap(beam);
          sim.brokeCount++;
          sim.events.push('break');
          if (abortOnBreak && !sim.result) finish('break');
        }
      }
    }
    if (!sim.result && sim.time > 60) finish('timeout');
    if (car.bodies) {
      followBodies();
      if (!sim.splashed && car.axles.some((a) => a.y < mission.water)) { sim.splashed = true; sim.events.push('splash'); }
    }
  }

  /* Push a node out of the ground along the slope's normal, with friction. */
  function touchGround(n) {
    const g = groundAt(n.x);
    const depth = Math.min(g + n.radius - n.y, PUSH * 4);
    if (depth <= 0) return;
    const slope = (groundAt(n.x + 0.1) - groundAt(n.x - 0.1)) / 0.2;
    const len = Math.hypot(slope, 1);
    const nx = -slope / len, ny = 1 / len;
    // depth is vertical; the distance to the slope's tangent is depth * ny.
    n.x += nx * depth * ny; n.y += ny * depth * ny;
    slide(n, nx, ny, n.grip);
    // A wreck landing hard, for the sound.
    const hit = -(n.vx * nx + n.vy * ny);
    if (n.body && hit > 3 && sim.time - (sim.impactAt ?? -1) > 0.3) {
      sim.impactAt = sim.time;
      sim.events.push(`impact:${Math.min(1, hit / 10).toFixed(2)}`);
    }
  }

  /* Friction: cancel part of this substep's sliding along the surface. */
  function slide(n, nx, ny, grip) {
    const tx = -ny, ty = nx;
    const s = (n.x - n.px) * tx + (n.y - n.py) * ty;
    n.x -= tx * s * grip; n.y -= ty * s * grip;
  }

  /* A collider against every member it isn't part of; both sides move by
     their inverse mass, so a falling truck really lands on the bridge. */
  function collide(i) {
    const n = nodes[i];
    for (const beam of beams) {
      if (beam.broken || beam.a === i || beam.b === i) continue;
      const na = nodes[beam.a], nb = nodes[beam.b];
      const reach = n.radius + THICKNESS[beam.mat];
      if (n.x < Math.min(na.x, nb.x) - reach || n.x > Math.max(na.x, nb.x) + reach || n.y < Math.min(na.y, nb.y) - reach || n.y > Math.max(na.y, nb.y) + reach) continue;
      const dx = nb.x - na.x, dy = nb.y - na.y;
      const len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((n.x - na.x) * dx + (n.y - na.y) * dy) / len2));
      const ex = n.x - (na.x + dx * t), ey = n.y - (na.y + dy * t);
      const d = Math.hypot(ex, ey);
      if (d >= reach) continue;
      const len = Math.sqrt(len2);
      // Dead on the line: push out on the side it came from.
      const side = (n.px - na.x) * -dy + (n.py - na.y) * dx >= 0 ? 1 : -1;
      const nx = d > 1e-6 ? ex / d : side * -dy / len, ny = d > 1e-6 ? ey / d : side * dx / len;
      const wn = 1 / n.mass;
      const wa = na.fixed ? 0 : 1 / (na.mass + na.extra), wb = nb.fixed ? 0 : 1 / (nb.mass + nb.extra);
      const lambda = Math.min(reach - d, PUSH) / (wn + wa * (1 - t) ** 2 + wb * t * t);
      n.x += wn * lambda * nx; n.y += wn * lambda * ny;
      na.x -= wa * (1 - t) * lambda * nx; na.y -= wa * (1 - t) * lambda * ny;
      nb.x -= wb * t * lambda * nx; nb.y -= wb * t * lambda * ny;
      slide(n, nx, ny, n.grip);
    }
  }

  /* A snapped member becomes two loose halves, each still pinned to its own
     joint, so it dangles, swings and falls instead of vanishing. */
  function snap(beam) {
    beam.broken = true; beam.usage = 0;
    const half = MATERIALS[beam.mat].kgPerM * beam.length / 2;
    for (const [end, other] of [[beam.a, beam.b], [beam.b, beam.a]]) {
      const e = nodes[end], o = nodes[other];
      if (!e.fixed) e.mass -= half / 2;
      const tip = nodes.push({
        x: e.x + (o.x - e.x) * 0.47, y: e.y + (o.y - e.y) * 0.47, vx: e.vx, vy: e.vy, px: 0, py: 0,
        mass: half / 2, extra: 0, fixed: false, radius: 0, grip: 0.4,
      }) - 1;
      beams.push({
        a: end, b: tip, mat: beam.mat, tensionOnly: beam.tensionOnly, length: Math.hypot(o.x - e.x, o.y - e.y) * 0.47,
        compliance: beam.compliance / 2, strength: Infinity, force: 0, smooth: 0, usage: 0, peak: 0, broken: false, road: false, piece: true,
      });
      colliders.add(tip);
      if (!e.fixed) colliders.add(end);
    }
  }

  /* The vehicle leaves the road: each body becomes a rigid shape, its two
     wheels plus contact points all along its outline, moving at driving
     speed, and from now on it is physics. */
  function releaseVehicle() {
    car.bodies = BODIES[vehicleId].map(([fi, ri, kind]) => {
      const f = car.axles[fi], r = car.axles[ri];
      const d = Math.hypot(f.x - r.x, f.y - r.y);
      const ux = (f.x - r.x) / d, uy = (f.y - r.y) / d;
      const w = WHEEL[kind];
      // Wheels sit just clear of the road's surface so they don't start inside it.
      const lift = w + THICKNESS.road + 0.01;
      const { base, points } = OUTLINE[kind];
      const outline = points.map(([x, y]) => [x * d / base, y * d / base + lift - w]);
      const local = [[0, lift], [d, lift], ...outline];
      outline.forEach(([x0, y0], i) => {
        const [x1, y1] = outline[(i + 1) % outline.length];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / OUTLINE_STEP);
        for (let k = 1; k < steps; k++) local.push([x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps]);
      });
      const mass = car.axles.slice(fi, ri + 1).reduce((sum, a) => sum + a.mass, 0);
      const first = nodes.length;
      for (const [i, [lx, ly]] of local.entries()) {
        nodes.push({
          x: r.x + ux * lx - uy * ly, y: r.y + uy * lx + ux * ly, px: 0, py: 0,
          vx: ux * vehicle.speed, vy: uy * vehicle.speed,
          mass: mass / local.length, extra: 0, fixed: false, body: true,
          radius: i < 2 ? w : 0.08, grip: i < 2 ? 0.04 : 0.35,
        });
        colliders.add(first + i);
      }
      const cx = local.reduce((sum, p) => sum + p[0], 0) / local.length;
      const cy = local.reduce((sum, p) => sum + p[1], 0) / local.length;
      const xs = outline.map((p) => p[0]);
      return {
        fi, ri, first, d, w: lift,
        rest: local.map(([x, y]) => [x - cx, y - cy]),
        outline: outline.map((_, i) => first + 2 + i),
        rear: first + 2 + xs.indexOf(Math.min(...xs)), front: first + 2 + xs.indexOf(Math.max(...xs)),
      };
    });
    // Train couplings: rear of one body to the front of the next.
    for (let k = 0; k + 1 < car.bodies.length; k++) {
      const a = car.bodies[k].rear, b = car.bodies[k + 1].front;
      links.push({ a, b, length: Math.hypot(nodes[b].x - nodes[a].x, nodes[b].y - nodes[a].y) });
    }
  }

  /* Shape matching: put a body's points back on its rest shape at the
     position and angle that best fit where they have been pushed. */
  function holdShape(body) {
    const { first, rest } = body;
    let cx = 0, cy = 0;
    for (let i = 0; i < rest.length; i++) { cx += nodes[first + i].x; cy += nodes[first + i].y; }
    cx /= rest.length; cy /= rest.length;
    let dot = 0, cross = 0;
    for (let i = 0; i < rest.length; i++) {
      const qx = nodes[first + i].x - cx, qy = nodes[first + i].y - cy;
      dot += rest[i][0] * qx + rest[i][1] * qy;
      cross += rest[i][0] * qy - rest[i][1] * qx;
    }
    const len = Math.hypot(dot, cross) || 1;
    const c = dot / len, s = cross / len;
    for (let i = 0; i < rest.length; i++) {
      const [rx, ry] = rest[i];
      nodes[first + i].x = cx + c * rx - s * ry;
      nodes[first + i].y = cy + s * rx + c * ry;
    }
  }

  /* Joints, loose pieces and other vehicle bodies can't get inside a body:
     a point found inside its outline is pushed out through the nearest side. */
  function keepOut(body) {
    const ring = body.outline.map((i) => nodes[i]);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of ring) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    const end = body.first + body.rest.length;
    for (let j = 0; j < nodes.length; j++) {
      if (j >= body.first && j < end) continue;
      const p = nodes[j];
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      let depth = Infinity, edge = -1, nx = 0, ny = 0;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        const ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey) || 1e-9;
        // The outline runs anticlockwise, so its outward normal is (ey, -ex).
        const out = ((p.x - a.x) * ey - (p.y - a.y) * ex) / len;
        if (out >= 0) { edge = -1; break; }
        if (-out < depth) { depth = -out; edge = k; nx = ey / len; ny = -ex / len; }
      }
      if (edge < 0) continue;
      const a = ring[edge], b = ring[(edge + 1) % ring.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1e-9)));
      const wp = p.fixed ? 0 : 1 / (p.mass + p.extra), wa = 1 / a.mass, wb = 1 / b.mass;
      const lambda = Math.min(depth, PUSH) / (wp + wa * (1 - t) ** 2 + wb * t * t);
      p.x += wp * lambda * nx; p.y += wp * lambda * ny;
      a.x -= wa * (1 - t) * lambda * nx; a.y -= wa * (1 - t) * lambda * ny;
      b.x -= wb * t * lambda * nx; b.y -= wb * t * lambda * ny;
    }
  }

  /* Axle contact points from the bodies, for drawing. */
  function followBodies() {
    for (const { fi, ri, first, d, w } of car.bodies) {
      const R = nodes[first], F = nodes[first + 1];
      const ux = (F.x - R.x) / d, uy = (F.y - R.y) / d;
      const rear = car.axles[ri];
      for (let i = fi; i <= ri; i++) {
        const along = rear.offset - car.axles[i].offset;
        car.axles[i].x = R.x + ux * along + uy * w;
        car.axles[i].y = R.y + uy * along - ux * w;
      }
    }
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
