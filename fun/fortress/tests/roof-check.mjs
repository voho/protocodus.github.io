import assert from 'node:assert/strict';
import Matter from '../vendor/matter.min.js';
import { FortressSimulation } from '../simulation.js';

for (const [seed, type] of [[1, 'slate'], [4, 'tile'], [10, 'copper']]) {
  const sim = new FortressSimulation('small', seed);
  const cap = sim.bodies.find((e) => e.roofType);
  assert.equal(cap.roofType, type);
  const body = cap.body, lintel = sim.bodies.find((e) => e.carried?.includes(cap));
  assert.ok(lintel && Math.abs(lintel.body.bounds.min.y - body.bounds.max.y) < 1,
    'The broad base bears on the actual lintel');
  assert.ok(Math.abs(body.area - cap.width * cap.height / 2) < 0.001);
  if (type === 'copper') {
    sim.hit(cap, 10, body.position);
    sim.resolveDamage();
    assert.ok(cap.damage > 0 && cap.damage < 1);
    assert.equal(body.vertices.length, 3, 'Dented copper keeps its pitched collision profile');
  }

  const outline = body.vertices.map(({ x, y }) => ({ x, y }));
  sim.hit(cap, 100, body.position);
  sim.resolveDamage();
  const shards = sim.bodies.filter((e) => e.kind === 'fragment');
  assert.ok(cap.destroyed && shards.length === 2 && shards.every((e) => e.material === cap.material));
  assert.ok(shards.every((e) => e.body.vertices.every((p) => Matter.Vertices.contains(outline, p))),
    'A fractured roof sheds pieces entirely inside its original slope');
  assert.ok(shards.reduce((area, e) => area + e.body.area, 0) > body.area * 0.9);
}

for (const size of ['small', 'medium', 'large']) {
  const sim = new FortressSimulation(size, 10);
  sim.fire('small-stone', 70, 25);
  sim.remove([...sim.projectiles][0]);
  for (let i = 0; i < 300; i++) sim.update(1 / 60);
  const cap = sim.bodies.find((e) => e.roofType);
  const lintel = sim.bodies.find((e) => e.carried?.includes(cap));
  assert.ok(lintel && cap.body.isSleeping);
  const before = cap.y;
  sim.remove(lintel);
  for (let i = 0; i < 60; i++) sim.update(1 / 60);
  assert.ok(cap.y > before + 5 || cap.destroyed, 'Removing a sleeping roof’s bearing allows it to fall');
}
