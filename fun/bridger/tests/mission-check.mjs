// Run with: node fun/bridger/tests/mission-check.mjs
// Every mission must come with a bridge that the real simulation carries
// across, and a budget within the difficulty's margin of that bridge's cost.
import assert from 'node:assert/strict';
import { createMission, restoreMission, randomSolution, choosePreparedSolution, riverSlot, V3_RIVERS, memberProblem, pairKey, MARGINS, DESIGN_NAMES } from '../js/mission.js';
import { createSim, bridgeCost, MATERIALS, WHEEL } from '../js/physics.js';
import { createRng } from '../../shared/rng.js';

const strip = (mission) => JSON.stringify({ ...mission, ground: undefined });
const seeds = Array.from({ length: 12 }, (_, i) => `check${i}`);
const vehicles = new Set(), features = new Set(), kinds = new Set();
let slowest = 0;

// Exercise every shipped layout through an actual shareable seed and its
// selected waterline. Tight budgets still have a second, distinct proof.
const testedSlots = new Set();
for (let i = 0; testedSlots.size < V3_RIVERS; i++) {
  const seed = `v3-qa${i}`, slot = riverSlot(seed);
  if (testedSlots.has(slot)) continue;
  testedSlots.add(slot);
  const river = createMission('hard', seed);
  const hint = choosePreparedSolution(river, [river.reference]);
  assert.notDeepEqual(hint.members.map(pairKey), river.reference.map(pairKey));
  for (const bridge of [river.reference, hint.members]) {
    assert.ok(bridgeCost(bridge) <= river.budget && createSim(river, bridge).run(), `${seed}: ready-to-play hard crossing`);
    for (const member of bridge) assert.equal(memberProblem(river, [], member), null);
  }
  const { ground, ...fields } = river;
  assert.equal(restoreMission(fields).ground(river.left + 1), ground(river.left + 1));
}
const published = createMission('hard', 'v3-qa2');
assert.deepEqual([riverSlot(published.seed), published.vehicle, published.span, published.budget, published.referenceKind],
  [73, 'truck', 9, 1660, 'below'], 'A published v3 seed keeps its layout and budget');

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

// This river supports several visibly different, affordable designs. Replay
// the editor's selection history, counting geometry independently of material.
function tourSolutions() {
  const valley = createMission('easy', 'check6'), rng = createRng('shapes');
  const history = [], shapes = [], families = new Set();
  for (let i = 0; i < 5; i++) {
    const solution = randomSolution(valley, rng.next, Infinity, history);
    assert.ok(bridgeCost(solution.members) <= valley.budget && createSim(valley, solution.members).run());
    for (const member of solution.members) assert.equal(memberProblem(valley, [], member), null);
    families.add(solution.kind);
    const shape = solution.members.filter((m) => m.mat !== 'road').map(pairKey).sort();
    if (shapes.length) {
      const previous = shapes.at(-1);
      const common = shape.filter((edge) => previous.includes(edge)).length;
      assert.ok(common / (shape.length + previous.length - common) < 0.55, 'Successive solutions change the visible support layout');
    }
    shapes.push(shape); history.push(solution.members);
  }
  assert.ok(families.has('warren') && families.has('bowstring'), 'The wider triangular panels and arched ribs both cross');
  assert.equal(new Set(shapes.map((s) => s.join('/'))).size, shapes.length);
  // Even with the search time exhausted, choose a different proven option.
  const cached = randomSolution(valley, rng.next, 0, history);
  assert.notDeepEqual(cached.members.filter((m) => m.mat !== 'road').map(pairKey).sort(), shapes.at(-1));
  assert.deepEqual(randomSolution({ ...valley }, rng.next, 0, history).members, valley.reference);
  return shapes;
}
assert.deepEqual(tourSolutions(), tourSolutions(), 'The same river and solution choices replay the same designs');

for (const [seed, kind] of [['v2-check0', 'channel'], ['v2-check4', 'ceiling'], ['v2-check2', null]]) {
  const easy = createMission('easy', seed), hard = createMission('hard', seed);
  const { ground, ...fields } = easy;
  const restored = restoreMission(structuredClone(fields));
  for (let x = easy.left - 5; x <= easy.right + 5; x += 0.125) assert.equal(restored.ground(x), ground(x));
  assert.equal(strip(restored), strip(easy), 'The river received from the survey worker keeps its build rules and proof');
  assert.equal(easy.clearance?.kind ?? null, kind);
  assert.deepEqual(easy.clearance, hard.clearance, 'Changing difficulty keeps the clearance');
  assert.deepEqual(easy.reference, hard.reference);
  assert.ok(easy.budget >= hard.budget);
  for (const m of [easy, hard]) {
    const solution = randomSolution(m, createRng(seed).next, Infinity);
    for (const members of [m.reference, solution.members]) {
      for (const piece of members) assert.equal(memberProblem(m, [], piece), null);
      assert.ok(bridgeCost(members) <= m.budget && createSim(m, members).run(), `${seed}: a legal design crosses on ${m.difficulty}`);
    }
  }
  if (kind === 'channel') {
    const { x0, x1, y0, y1 } = easy.clearance;
    for (let x = x0; x <= x1; x += 0.25) assert.ok(easy.ground(x) < y0, 'The marked shipping channel lies over water');
    const beam = (ax, ay, bx, by) => ({ a: [ax / 2, ay / 2], b: [bx / 2, by / 2], mat: 'steel' });
    assert.equal(memberProblem(easy, [], beam(x0 - 0.5, y1 - 0.5, x1 + 0.5, y1 - 0.5)), 'channel', 'A crossing is blocked even with both ends outside');
    assert.equal(memberProblem(easy, [], beam(x0, y1, x1, y1)), null, 'The line above the channel can carry a beam');
    assert.equal(memberProblem(easy, [], beam(x0 - 1, y1 - 1, x0 + 1, y1 + 1)), null, 'A member can touch the corner');
  } else if (kind === 'ceiling') {
    assert.equal(memberProblem(easy, [], { a: [1, 1], b: [2, 2.5], mat: 'wood' }), 'ceiling');
    assert.equal(memberProblem(easy, [], { a: [1, 2], b: [2, 2], mat: 'wood' }), null, 'A horizontal beam can sit on the ceiling boundary');
  }
}

// Rules a player meets: road can't climb walls, nothing grows into rock or
// water, and lengths are capped per material.
const mission = createMission('medium', 'rules');
assert.equal(mission.clearance, undefined, 'An unversioned river retains its original unrestricted rules');
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

// Let a road panel give way once the truck has driven onto it. Either
// back tyre can carry the tandem's load, but losing both tips the truck.
const truckDeck = Array.from({ length: 8 }, (_, i) => ({ a: [i, 0], b: [i + 1, 0], mat: 'road' }));
const truckRiver = {
  vehicle: 'truck', left: 0, right: 16, deck: 0, water: -4,
  ground: (x) => x <= 0 || x >= 16 ? 0 : -8, anchors: [...truckDeck.map((m) => m.a), truckDeck.at(-1).b],
};
for (const [unsupported, at, outcome] of [[2, 5.5, 'win'], [1, 4.1, 'fall']]) {
  const sim = createSim(truckRiver, truckDeck);
  while (!sim.result && sim.car.axles[unsupported].x < at) sim.step();
  assert.equal(sim.result, null);
  sim.beams[2].broken = true; // the panel between 4 and 6 m
  sim.step();
  const { axles } = sim.car;
  assert.equal(sim.car.state, 'driving');
  assert.equal(axles[unsupported].load, 0);
  assert.ok(axles.every((a) => a.load >= 0));
  assert.equal(axles.reduce((sum, a) => sum + a.load, 0), 6000);
  assert.ok(Math.abs(axles.reduce((sum, a) => sum + (a.load - a.mass) * a.offset, 0)) < 1e-8);
  sim.run();
  assert.equal(sim.result, outcome);
}

// Finishing the proof and driving the on-screen vehicle off the bank use
// separate clocks. The exit can last longer than the bridge needs to settle.
for (const vehicle of ['car', 'truck', 'train']) {
  const farSlope = truckRiver.right + 40;
  const ground = (x) => x >= farSlope ? (x - farSlope) * 0.06 : truckRiver.ground(x);
  const sim = createSim({ ...truckRiver, vehicle, ground }, truckDeck);
  const initial = sim.car.front;
  sim.advanceRunout(1);
  assert.equal(sim.car.front, initial, 'A parked vehicle cannot begin its exit');
  assert.ok(sim.run());
  const finish = sim.car.front;
  for (let i = 0; i < 200; i++) sim.step();
  assert.ok(sim.settled);
  assert.equal(sim.car.front, finish, 'Headless bridge settling has no runout work');
  const time = sim.time, { axles, def } = sim.car;
  const edge = sim.runoutRearX();
  const rearOverhang = axles.at(-1).x - edge;
  assert.ok(rearOverhang > 0.75 && rearOverhang < 1.75, 'The rear bumper extends behind the last axle');
  const angles = axles.map((a) => a.worldAngle);
  for (const dt of [0.05, 0.20, 0.50, 0.25]) sim.advanceRunout(dt);
  assert.ok(Math.abs(sim.car.front - finish - def.speed) < 1e-8);
  assert.ok(Math.abs(sim.runoutRearX() - edge - def.speed) < 1e-8);
  axles.forEach((axle, i) => {
    const radius = vehicle === 'train' ? (i < 2 ? WHEEL.loco : WHEEL.wagon) : WHEEL[vehicle];
    assert.ok(Math.abs((axle.worldAngle - angles[i]) * radius - def.speed) < 1e-8, 'Each exit tyre rolls its own distance');
    assert.ok(Math.abs(axle.angularSpeed * radius - def.speed) < 1e-8, 'Wheel speed is independent of frame length');
  });
  for (let i = 0; i < 120; i++) sim.advanceRunout(0.1);
  assert.ok(axles.every((a) => a.x > farSlope && Math.abs(a.y - ground(a.x)) < 1e-8), 'Every carriage follows the far approach');
  assert.ok(axles.at(-1).x - sim.runoutRearX() > rearOverhang, 'The uphill chassis projects farther behind the last axle');
  assert.equal(sim.time, time, 'The vehicle can leave after the solver is asleep');
  assert.equal(sim.result, 'win');
}

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
  let splashes = 0;
  for (let frame = 0; frame < 60 * 12; frame++) {
    sim.step();
    if (sim.events.includes('splash')) splashes++;
    for (const a of sim.car.axles) highest = Math.max(highest, a.y);
  }
  assert.equal(splashes, sim.waterEntry ? 1 : 0, 'A wreck entering the water makes one splash');
  assert.equal(sim.settled, true, 'The display can stop scheduling simulation frames after the wreck settles');
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
