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
  truck: { name: 'Truck', speed: 5, length: 7.4, axles: [[1.2, 1600], [5.56, 2200], [6.6, 2200]] },
  train: {
    name: 'Train', speed: 4.5, length: 22.6,
    axles: [[1.5, 2500], [5.5, 2500], [9, 1800], [13, 1800], [16.5, 1800], [20.5, 1800]],
  },
};

/* Vehicle bodies, each on a pair of axles: [front axle, rear axle, kind]. */
export const BODIES = { car: [[0, 1, 'car']], truck: [[0, 2, 'truck']], train: [[0, 1, 'loco'], [2, 3, 'wagon'], [4, 5, 'wagon']] };
// Sprite pixels: rear axle x, front axle x, ground y and tyre radius.
export const SPRITE_AXLES = {
  car: [220.36, 830.66, 390.41, 85.26], truck: [130.68, 867.29, 338.44, 64.32],
  loco: [209.76, 772.91, 444.84, 90.93], wagon: [183.45, 801.73, 382.42, 74.74],
};
// Buffer attachment points in body metres, in the same frame as the hull.
export const BODY_COUPLERS = {
  loco: { rear: [-1.32, 1.02], front: [5.73, 1.02] },
  wagon: { rear: [-1.15, 0.78], front: [5.39, 0.78] },
};
/* Body outlines traced from the sprites (convex, above the axles), in body
   metres for each kind's own wheelbase: rear axle on the road at the origin,
   x forward, y up. Wheels are circles of their own below them. */
const OUTLINE = {
  car: { base: 2.6, points: [[-0.91, 0.44], [-0.73, 0.36], [3.03, 0.36], [3.21, 0.38], [3.41, 0.49], [3.35, 0.91], [1.49, 1.64], [-0.37, 1.64], [-0.64, 1.48], [-0.7, 1.41], [-0.87, 0.87], [-0.93, 0.51]] },
  truck: { base: 5.4, points: [[-0.91, 0.53], [-0.68, 0.41], [6.3, 0.46], [6.4, 0.53], [6.51, 1.07], [6.19, 2.22], [6.07, 2.35], [5.86, 2.42], [-0.82, 2.36], [-0.93, 2.25]] },
  loco: { base: 4, points: [[-1.31, 0.86], [5.69, 0.86], [5.73, 0.92], [5.75, 1.2], [5.51, 2.51], [4.74, 3.11], [-0.63, 3.14], [-1.28, 2.97], [-1.46, 2.78]] },
  wagon: { base: 4, points: [[-1.09, 0.66], [5.33, 0.66], [5.41, 0.77], [5.17, 2.12], [5.02, 2.25], [3.64, 2.42], [1.58, 2.45], [0.1, 2.4], [-0.84, 2.23], [-0.93, 2.12], [-1.17, 0.75]] },
};
export const WHEEL = Object.fromEntries(Object.entries(SPRITE_AXLES).map(([kind, [rear, front, , radius]]) =>
  [kind, OUTLINE[kind].base * radius / (front - rear)]));
/* Spacing of the contact points along a body's outline (m). */
const OUTLINE_STEP = 0.3;
/* How close wreckage gets to a member's centre line before it touches. */
const THICKNESS = { road: 0.06, wood: 0.1, steel: 0.1, cable: 0.04 };
/* The most a contact pushes in one substep (m): deep overlaps resolve over a
   few substeps instead of firing pieces off at hundreds of metres a second. */
const PUSH = 0.02;

/* Clip a member against all the outward faces of a convex body. Keeping
   the whole segment catches a cable crossing the roof with both ends outside. */
function touchesHull(ring, a, b, thickness) {
  let enter = 0, leave = 1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const nx = q.y - p.y, ny = p.x - q.x;
    const offset = (a.x - p.x) * nx + (a.y - p.y) * ny - thickness * Math.hypot(nx, ny);
    const rate = (b.x - a.x) * nx + (b.y - a.y) * ny;
    if (Math.abs(rate) < 1e-9) {
      if (offset > 0) return false;
    } else if (rate < 0) enter = Math.max(enter, -offset / rate);
    else leave = Math.min(leave, -offset / rate);
    if (enter > leave) return false;
  }
  return true;
}

function touchesWheel(a, b, x, y, radius) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <= radius ** 2;
}

// Signed rolling distance is relative to the surface. An unsupported tyre
// coasts on its own bearings until it makes contact again.
function rollWheel(axle, distance, radius, dt) {
  if (distance === null) axle.angularSpeed *= Math.exp(-0.45 * dt);
  else axle.angularSpeed = distance / (radius * dt);
  axle.worldAngle += axle.angularSpeed * dt;
}

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
    // In side view the upright and diagonal braces flank the lane. A level
    // chord above the deck spans the vehicle's clearance envelope.
    const inLane = m.mat === 'road' || (m.a[1] === m.b[1] && m.a[1] * CELL > mission.deck);
    return { a, b, mat: m.mat, tensionOnly: !!mat.tensionOnly, length, compliance: length / mat.ea, strength: mat.strength, force: 0, smooth: 0, usage: 0, peak: 0, broken: false, road: m.mat === 'road', inLane };
  });

  // The ground line sampled every 10 cm: the solver asks for it every substep.
  const g0 = mission.left - 60;
  const groundTable = Float64Array.from({ length: Math.ceil((mission.right - mission.left + 120) * 10) + 1 }, (_, i) => mission.ground(g0 + i / 10));
  const highestGround = groundTable.reduce((highest, y) => Math.max(highest, y), -Infinity);
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
    axles: vehicle.axles.map(([offset, mass]) => ({
      offset, mass, load: mass, x: 0, y: mission.deck, supportY: mission.deck, beam: -1, t: 0,
      angle: 0, worldAngle: 0, angularSpeed: 0,
    })),
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
    let supported = true;
    for (const axle of car.axles) {
      axle.x = car.front - axle.offset;
      axle.load = axle.mass;
      const s = support(axle.x, axle.supportY);
      if (!s) { axle.beam = -1; supported = false; continue; }
      axle.y = axle.supportY = s.y; axle.beam = s.beam; axle.t = s.t;
    }
    // If a crest picks up the middle tyre, the truck pivots about its front
    // and middle axles (its centre of mass lies between them).
    if (vehicleId === 'truck') {
      const [front, middle, rear] = car.axles;
      const projected = front.y + (middle.y - front.y) * (rear.offset - front.offset) / (middle.offset - front.offset);
      const lifted = projected > rear.y ? rear : middle;
      const pivot = lifted === rear ? middle : rear;
      const t = (lifted.offset - front.offset) / (pivot.offset - front.offset);
      lifted.y = front.y + (pivot.y - front.y) * t;
      // Once the suspension travel is used up, transfer that axle's load
      // to the other two while conserving the weight and its moment.
      if (lifted.y > lifted.supportY + 0.08) {
        front.load += lifted.mass * (1 - t);
        pivot.load += lifted.mass * t;
        lifted.load = 0;
      }
    }
    return supported;
  }
  function rollOnRoad() {
    for (const [fi, ri, kind] of BODIES[vehicleId]) {
      const f = car.axles[fi], r = car.axles[ri], base = OUTLINE[kind].base;
      const c = (f.x - r.x) / base, s = (f.y - r.y) / base;
      const heading = Math.atan2(s, c), radius = WHEEL[kind] * Math.hypot(c, s);
      for (let i = fi; i <= ri; i++) {
        const axle = car.axles[i], along = r.offset - axle.offset;
        const x = r.x + c * along - s * WHEEL[kind], y = r.y + s * along + c * WHEEL[kind];
        if (axle.centerX === undefined) axle.worldAngle = -heading;
        else {
          let dx = x - axle.centerX, dy = y - axle.centerY;
          if (axle.beam >= 0) {
            const beam = beams[axle.beam], a = nodes[beam.a], b = nodes[beam.b];
            dx -= (a.vx * (1 - axle.t) + b.vx * axle.t) * STEP;
            dy -= (a.vy * (1 - axle.t) + b.vy * axle.t) * STEP;
          }
          const supported = axle.load > 0 && (axle.beam >= 0 || axle.x <= mission.left || axle.x >= mission.right);
          const travel = Math.sign(dx * c + dy * s) * Math.hypot(dx, dy);
          rollWheel(axle, supported ? travel : null, radius, STEP);
        }
        axle.centerX = x; axle.centerY = y;
        axle.angle = axle.worldAngle + heading;
      }
    }
  }
  placeVehicle();
  rollOnRoad();

  function bodyObstructed() {
    for (const [fi, ri, kind] of BODIES[vehicleId]) {
      const f = car.axles[fi], r = car.axles[ri];
      const { points, base } = OUTLINE[kind];
      // Same rotation and wheelbase scale as the sprite, including on slopes.
      const c = (f.x - r.x) / base, s = (f.y - r.y) / base;
      const ring = points.map(([x, y]) => ({ x: r.x + c * x - s * y, y: r.y + s * x + c * y }));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of ring) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      if (y0 <= highestGround) {
        // Both the ground table and each hull edge are piecewise linear.
        // Their endpoints and the ground samples under the belly suffice.
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          if (a.y <= groundAt(a.x)) return true;
          if (b.x <= a.x) continue; // only the underside faces the terrain
          const slope = (b.y - a.y) / (b.x - a.x);
          const end = Math.min(groundTable.length - 1, Math.floor((b.x - g0) * 10));
          for (let j = Math.max(0, Math.ceil((a.x - g0) * 10)); j <= end; j++) {
            if (a.y + (g0 + j / 10 - a.x) * slope <= groundTable[j]) return true;
          }
        }
      }
      const radius = WHEEL[kind] * Math.hypot(c, s);
      for (const beam of beams) {
        if (beam.broken || !(beam.inLane || beam.piece || colliders.has(beam.a) || colliders.has(beam.b))) continue;
        const a = nodes[beam.a], b = nodes[beam.b], t = THICKNESS[beam.mat];
        if (Math.max(a.x, b.x) < x0 - t || Math.min(a.x, b.x) > x1 + t ||
            Math.max(a.y, b.y) < y0 - t - 2 * radius || Math.min(a.y, b.y) > y1 + t) continue;
        if (Math.max(a.y, b.y) >= y0 - t && touchesHull(ring, a, b, t)) return true;
        if (beam.road) continue; // rolling contact is handled by support()
        for (let i = fi; i <= ri; i++) {
          const along = r.offset - car.axles[i].offset;
          if (touchesWheel(a, b, r.x + c * along - s * WHEEL[kind], r.y + s * along + c * WHEEL[kind], radius + t)) return true;
        }
      }
    }
    return false;
  }

  function step() {
    sim.events.length = 0;
    if (sim.result && sim.time > sim.resultAt + (sim.result === 'win' ? 3 : 8)) return;
    sim.time += STEP;
    if (car.state === 'waiting' && sim.time >= settle) car.state = 'driving';
    if (car.state === 'driving') {
      car.front += vehicle.speed * STEP;
      const supported = placeVehicle();
      if (!supported || bodyObstructed()) {
        car.state = 'falling';
        sim.events.push('fall');
        if (supported) {
          // Let the contact solver advance from the last clear pose to
          // impact. Starting a frame inside a member creates a false impulse.
          car.front -= vehicle.speed * STEP;
          placeVehicle();
          sim.events.push('impact:0.75');
          finish('collision');
        }
      } else if (car.front - vehicle.length > mission.right + 1.5) {
        car.state = 'crossed';
        finish('win');
      }
      rollOnRoad();
    }
    if (car.state === 'falling' && !car.bodies) {
      releaseVehicle();
      if (!sim.result) finish('fall');
    }

    for (const node of nodes) node.extra = 0;
    if (car.state === 'driving' || car.state === 'waiting') {
      for (const axle of car.axles) {
        if (axle.beam < 0) continue;
        const beam = beams[axle.beam];
        nodes[beam.a].extra += axle.load * (1 - axle.t);
        nodes[beam.b].extra += axle.load * axle.t;
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
        if (n.tyre) n.rolling = false;
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
          for (let i = body.first; i < body.first + body.rest.length; i++) if (nodes[i].y - nodes[i].radius <= highestGround) touchGround(nodes[i]);
          keepOut(body);
          holdShape(body);
        }
      }
      for (const n of nodes) {
        if (n.fixed) continue;
        // Wreckage lands on the banks and the river bed instead of falling through.
        if (!n.body && n.y - n.radius <= highestGround) touchGround(n);
        n.vx = (n.x - n.px) / h; n.vy = (n.y - n.py) / h;
        if (n.tyre) {
          const distance = n.rolling ? ((n.vx - n.surfaceVx) * n.normalY - (n.vy - n.surfaceVy) * n.normalX) * h : null;
          rollWheel(n.tyre, distance, n.radius, h);
        }
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
      if (!sim.waterEntry) {
        const contact = nodes.find(n => n.body && n.y - n.radius <= mission.water);
        if (contact) {
          sim.waterEntry = { x: contact.x, speed: Math.max(0, -contact.vy) };
          sim.events.push('splash');
        }
      }
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
    if (n.tyre) wheelContact(n, nx, ny, 0, 0);
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

  function wheelContact(n, nx, ny, vx, vy) {
    n.rolling = true;
    n.normalX = nx; n.normalY = ny;
    n.surfaceVx = vx; n.surfaceVy = vy;
  }

  /* A collider against every member it isn't part of; both sides move by
     their inverse mass, so a falling truck really lands on the bridge. */
  function collide(i) {
    const n = nodes[i];
    for (const beam of beams) {
      if (beam.broken || beam.a === i || beam.b === i) continue;
      const na = nodes[beam.a], nb = nodes[beam.b];
      // Axle placement uses the road line as the running surface. Keep a
      // released tyre tangent there so switching solvers adds no impulse.
      const reach = n.radius + (n.tyre && beam.road ? 0 : THICKNESS[beam.mat]);
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
      if (n.tyre) wheelContact(n, nx, ny, na.vx * (1 - t) + nb.vx * t, na.vy * (1 - t) + nb.vy * t);
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

  /* On a fall or impact, release every tyre and the outline from their
     current rendered pose as one rigid shape per vehicle or carriage. */
  function releaseVehicle() {
    car.bodies = BODIES[vehicleId].map(([fi, ri, kind]) => {
      const f = car.axles[fi], r = car.axles[ri];
      const d = Math.hypot(f.x - r.x, f.y - r.y);
      const ux = (f.x - r.x) / d, uy = (f.y - r.y) / d;
      const { base, points } = OUTLINE[kind];
      const w = WHEEL[kind] * d / base;
      const outline = points.map(([x, y]) => [x * d / base, y * d / base]);
      const wheels = [[0, w], [d, w]];
      const tyres = [r, f];
      for (let i = fi + 1; i < ri; i++) {
        wheels.push([(r.offset - car.axles[i].offset) * d / base, w]);
        tyres.push(car.axles[i]);
      }
      const local = [...wheels, ...outline];
      outline.forEach(([x0, y0], i) => {
        const [x1, y1] = outline[(i + 1) % outline.length];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / OUTLINE_STEP);
        for (let k = 1; k < steps; k++) local.push([x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps]);
      });
      const fittings = BODY_COUPLERS[kind];
      const couplers = local.length;
      if (fittings) for (const [x, y] of [fittings.rear, fittings.front]) local.push([x * d / base, y * d / base]);
      const mass = car.axles.slice(fi, ri + 1).reduce((sum, a) => sum + a.mass, 0);
      const first = nodes.length;
      for (const [i, [lx, ly]] of local.entries()) {
        nodes.push({
          x: r.x + ux * lx - uy * ly, y: r.y + uy * lx + ux * ly, px: 0, py: 0,
          vx: ux * vehicle.speed, vy: uy * vehicle.speed,
          mass: mass / local.length, extra: 0, fixed: false, body: true,
          tyre: tyres[i], radius: i < wheels.length ? w : 0.08, grip: i < wheels.length ? 0.04 : 0.35,
        });
        colliders.add(first + i);
      }
      const cx = local.reduce((sum, p) => sum + p[0], 0) / local.length;
      const cy = local.reduce((sum, p) => sum + p[1], 0) / local.length;
      const xs = outline.map((p) => p[0]);
      const ringStart = first + wheels.length;
      // The outline samples have a small radius, and a tyre on a bank can
      // meet its slope slightly before the axle's vertical ground sample.
      // Resolve existing ground overlap before velocity integration begins.
      let lift = 0;
      for (let i = first; i < nodes.length; i++) lift = Math.max(lift, groundAt(nodes[i].x) + nodes[i].radius - nodes[i].y);
      for (let i = first; i < nodes.length; i++) nodes[i].y += lift;
      return {
        fi, ri, first, d, w,
        rest: local.map(([x, y]) => [x - cx, y - cy]),
        outline: outline.map((_, i) => ringStart + i),
        rear: fittings ? first + couplers : ringStart + xs.indexOf(Math.min(...xs)),
        front: fittings ? first + couplers + 1 : ringStart + xs.indexOf(Math.max(...xs)),
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
      const heading = Math.atan2(uy, ux);
      const rear = car.axles[ri];
      const scale = d / (rear.offset - car.axles[fi].offset);
      for (let i = fi; i <= ri; i++) {
        const axle = car.axles[i], along = (rear.offset - axle.offset) * scale;
        axle.centerX = R.x + ux * along; axle.centerY = R.y + uy * along;
        axle.x = axle.centerX + uy * w; axle.y = axle.centerY - ux * w;
        axle.angle = axle.worldAngle + heading;
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
