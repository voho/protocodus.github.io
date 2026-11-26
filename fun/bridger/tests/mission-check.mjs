// Run with: node fun/bridger/tests/mission-check.mjs
// Every mission must come with a bridge that the real simulation carries
// across, and a budget within the difficulty's margin of that bridge's cost.
import assert from 'node:assert/strict';
import { createMission, randomSolution, memberProblem, MARGINS, DESIGN_NAMES } from '../js/mission.js';
import { createSim, bridgeCost, MATERIALS, WHEEL } from '../js/physics.js';
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
    for (const [bank, outward] of [[mission.left, -1], [mission.right, 1]]) {
      assert.ok(Math.abs(mission.ground(bank)) < 1e-6, `${seed}: approach meets the road deck`);
      assert.ok(Math.abs(mission.ground(bank + outward * 4)) < 1e-6, `${seed}: the land bolt sits on the approach`);
      assert.ok(mission.ground(bank + outward * 2) < -0.01, `${seed}: the approach curves between its bolts`);
    }

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

const flat = createSim({ ...truck, ground: () => 0 }, []);
const parkedX = flat.car.axles.map((a) => a.x);
assert.ok(flat.car.axles.every((a) => a.angle === 0), 'Parked wheels begin at rest');
for (let frame = 0; frame < 78; frame++) flat.step();
flat.car.axles.forEach((a, i) => {
  assert.ok(Math.abs(a.angle * WHEEL.truck - (a.x - parkedX[i])) < 1e-8, 'Each tyre rolls one circumference per revolution');
});
const rolling = createSim({ ...truck, ground: (x) => 0.13 * (Math.sin(x * 1.3) - 1) }, []);
for (let frame = 0; frame < 78; frame++) rolling.step();
assert.equal(rolling.car.state, 'driving');
const spins = rolling.car.axles.map((a) => a.angle);
assert.ok(Math.max(...spins) - Math.min(...spins) > 0.01, 'The three tyres can roll and coast independently on a crest');

// Level members cross the traffic lane. A supported vehicle can hit its
// roof while every wheel still has road underneath it. Side braces flank it.
for (const [vehicle, roof] of [['car', 0.75], ['truck', 1], ['train', 1.5]]) {
  const deck = Array.from({ length: 8 }, (_, i) => ({ a: [i, 0], b: [i + 1, 0], mat: 'road' }));
  const runWith = (member) => {
    const ground = (x) => x <= 0 || x >= 16 ? 0 : -8;
    const anchors = [...deck.map((m) => m.a), deck.at(-1).b, member.a, member.b];
    const sim = createSim({ vehicle, ground, left: 0, right: 16, deck: 0, water: -4, anchors }, [...deck, member]);
    sim.run();
    return sim;
  };
  for (const mat of ['wood', 'steel', 'cable']) {
    const hit = runWith({ a: [3, roof], b: [5, roof], mat });
    assert.equal(hit.result, 'collision', `${vehicle}: low ${mat} catches the body above the wheels`);
    assert.ok(hit.car.bodies && hit.car.axles[0].beam >= 0, `${vehicle}: roof contact releases a still-supported vehicle`);
  }
  const clearance = { car: 1, truck: 1.5, train: 1.75 }[vehicle];
  assert.equal(runWith({ a: [3, clearance], b: [5, clearance], mat: 'wood' }).result, 'win', `${vehicle}: the vehicle clears a beam just above its own roof`);
  assert.equal(runWith({ a: [3, 0], b: [5, 2], mat: 'steel' }).result, 'win', `${vehicle}: diagonal truss sides leave the lane open`);
}

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
