// Run with: node fun/bridger/tests/mission-check.mjs
// Every mission must come with a bridge that the real simulation carries
// across, and a budget within the difficulty's margin of that bridge's cost.
import assert from 'node:assert/strict';
import { createMission, randomSolution, memberProblem, MARGINS, DESIGN_NAMES } from '../js/mission.js';
import { createSim, bridgeCost, MATERIALS } from '../js/physics.js';
import { createRng } from '../../shared/rng.js';

const strip = (mission) => JSON.stringify({ ...mission, ground: undefined });
const seeds = Array.from({ length: 12 }, (_, i) => `check${i}`);
const vehicles = new Set(), features = new Set(), kinds = new Set();
let slowest = 0;

for (const seed of seeds) {
  for (const difficulty of Object.keys(MARGINS)) {
    const started = performance.now();
    const mission = createMission(difficulty, seed);
    slowest = Math.max(slowest, performance.now() - started);
    vehicles.add(mission.vehicle);
    features.add(mission.feature?.kind || 'none');

    const cost = bridgeCost(mission.reference);
    assert.ok(createSim(mission, mission.reference).run(), `${seed}/${difficulty}: the proof bridge crosses`);
    assert.ok(mission.budget >= cost, `${seed}/${difficulty}: the proof bridge fits the budget`);
    assert.ok(mission.budget <= cost * (1 + MARGINS[difficulty]) + 1e-9, `${seed}/${difficulty}: budget ${mission.budget} is within ${MARGINS[difficulty] * 100}% of ${cost}`);
    for (const m of mission.reference) assert.equal(memberProblem(mission, [], m), null, `${seed}: proof members follow the building rules`);

    // Seeded, so a failure here can be replayed.
    const { members, kind } = randomSolution(mission, createRng(`${seed}:${difficulty}`).next, 600);
    kinds.add(kind);
    assert.ok(DESIGN_NAMES[kind], `${seed}: the solution names its bridge family`);
    assert.ok(bridgeCost(members) <= mission.budget, `${seed}/${difficulty}: Show solution stays within budget`);
    assert.ok(createSim(mission, members).run(), `${seed}/${difficulty}: Show solution crosses`);
  }
  // The river is the seed's; only the budget changes with difficulty.
  const easy = createMission('easy', seed), hard = createMission('hard', seed);
  assert.equal(easy.span, hard.span);
  assert.equal(easy.vehicle, hard.vehicle);
  assert.ok(easy.budget >= hard.budget);
  assert.equal(strip(createMission('medium', seed)), strip(createMission('medium', seed)), `${seed}: missions are reproducible`);
}

// Rules a player meets: road can't climb walls, nothing grows into rock or
// water, and lengths are capped per material.
const mission = createMission('medium', 'rules');
assert.equal(memberProblem(mission, [], { a: [0, 0], b: [1, 1], mat: 'road' }), 'steep');
assert.equal(memberProblem(mission, [], { a: [0, 0], b: [4, 0], mat: 'wood' }), 'long');
assert.equal(memberProblem(mission, [], { a: [-1, 0], b: [-1, -1], mat: 'wood' }), 'ground');
assert.equal(memberProblem(mission, [], { a: [1, 0], b: [1, Math.floor(mission.water / 2) - 1], mat: 'steel' }), 'ground');
assert.equal(memberProblem(mission, [], { a: [0, 0], b: [mission.span, 0], mat: 'cable' }), mission.span * 2 > MATERIALS.cable.maxLength ? 'long' : 'anchors');

// Road on its own is not a bridge for anything heavier than a car.
const truck = { ...mission, vehicle: 'truck' };
const road = Array.from({ length: mission.span }, (_, i) => ({ a: [i, 0], b: [i + 1, 0], mat: 'road' }));
assert.equal(createSim(truck, road).run(), false, 'A bare road drops the truck');

// A fall is physics, not a script: the wreck stays finite, never flies off,
// and never ends up inside the ground.
for (const vehicle of ['car', 'truck', 'train']) {
  const sim = createSim({ ...mission, vehicle }, road);
  let highest = -Infinity;
  for (let frame = 0; frame < 60 * 12; frame++) {
    sim.step();
    for (const a of sim.car.axles) highest = Math.max(highest, a.y);
  }
  assert.ok(sim.car.bodies, `${vehicle}: the vehicle falls as a body`);
  assert.ok(sim.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), `${vehicle}: the wreck stays finite`);
  assert.ok(highest < 3, `${vehicle}: nothing is flung into the air (highest axle ${highest.toFixed(1)} m)`);
  assert.ok(sim.nodes.every((n) => n.fixed || n.y > mission.ground(n.x) - 0.3), `${vehicle}: nothing ends up inside the ground`);
  // The whole body is solid and rigid, not just its wheels.
  for (const body of sim.car.bodies) {
    const a = sim.nodes[body.rear], b = sim.nodes[body.front];
    const [ra, rb] = [body.rear, body.front].map((i) => body.rest[i - body.first]);
    const drift = Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - Math.hypot(rb[0] - ra[0], rb[1] - ra[1]));
    assert.ok(drift < 1e-6, `${vehicle}: a fallen body keeps its shape (drift ${drift})`);
    const ring = body.outline.map((i) => sim.nodes[i]);
    const inside = sim.nodes.filter((p, j) => (j < body.first || j >= body.first + body.rest.length) && ring.every((v, k) => {
      const w = ring[(k + 1) % ring.length];
      return (p.x - v.x) * (w.y - v.y) - (p.y - v.y) * (w.x - v.x) < -0.1 * Math.hypot(w.x - v.x, w.y - v.y);
    }));
    assert.equal(inside.length, 0, `${vehicle}: no joint ends up inside a vehicle body`);
  }
}

console.log(`Bridger missions passed: ${seeds.length * 3} missions (${[...vehicles].join(', ')}; ${[...features].join(', ')}), solutions: ${[...kinds].join(', ')}; slowest ${Math.round(slowest)} ms.`);
