import assert from 'node:assert/strict';
import { FortressSimulation } from '../simulation.js';
import Matter from '../vendor/matter.min.js';

const { Body } = Matter;

// Isolate one sentry's line of sight. The production guard AI and the actual
// projectile bodies still handle aiming, obstruction, interception and splitting.
function intercept(seed, ammo, { wall = false, range = 140 } = {}) {
  const sim = new FortressSimulation('medium', seed);
  const guard = [...sim.guards][0];
  for (const e of sim.bodies) if (e !== guard) sim.remove(e);
  Body.setPosition(guard.body, { x: 360, y: 130 });
  Body.setAngle(guard.body, 0);
  Body.setVelocity(guard.body, { x: 0, y: 0 });
  if (wall) sim.add('block', 'stone', 300, 128, 12, 75, 'masonry', { isStatic: true });
  assert.ok(sim.fire(ammo, 36, 70));
  const [shot] = sim.projectiles;
  Body.setPosition(shot.body, { x: 350 - range, y: 128 });
  sim.time = 0.25;
  sim.ticks = 30;
  sim.defend();
  assert.equal(sim.events.filter((e) => e.type === 'guard-shot').length, 0, 'Guards take time to aim');
  sim.time = 0.4;
  sim.ticks = 48;
  sim.defend();
  return { sim, shot, flash: sim.events.find((e) => e.type === 'guard-shot') };
}

const split = intercept(1, 'big-stone');
assert.ok(split.flash);
assert.ok(!split.sim.entities.has(split.shot.id));
assert.equal(split.sim.projectiles.size, 2, 'The camera follows both stone halves');
let mass = 0;
for (const piece of split.sim.projectiles) {
  assert.ok(piece.vertices.length >= 3 && piece.body.velocity.x > 0);
  mass += piece.body.mass;
}
assert.ok(Math.abs(mass - split.shot.body.mass) < 0.001);
const glance = intercept(6, 'big-stone');
assert.ok(glance.flash && glance.shot.flightPath === null, 'A deflection invalidates the original flight prediction');
assert.equal(glance.sim.projectiles.size, 1);
const premature = intercept(1, 'siege-bomb');
assert.ok(premature.flash && premature.sim.events.some((e) => e.type === 'explosion'));
assert.equal(premature.sim.remoteBombs.size, 0);
const warded = intercept(1, 'magic-bomb');
assert.ok(warded.flash && warded.shot.flightPath === null);
assert.equal(warded.sim.armedBomb('magic-bomb'), warded.shot, 'An intercepted Magic bomb stays armed');
assert.ok(!warded.sim.events.some((e) => e.type === 'implosion'));
const covered = intercept(1, 'big-stone', { wall: true });
assert.ok(!covered.flash && covered.shot.flightPath);
const miss = intercept(47, 'small-stone', { range: 300 });
assert.ok(miss.flash && miss.shot.flightPath && miss.sim.projectiles.has(miss.shot));

function hitSample(material) {
  const sim = new FortressSimulation('small', 2);
  for (const e of sim.bodies) sim.remove(e);
  const post = sim.add('block', material, 180, 180, 18, 26, 'sample');
  sim.fire('big-stone', 30, 65);
  const [shot] = sim.projectiles;
  Body.setPosition(shot.body, { x: 150, y: 180 });
  Body.setVelocity(shot.body, { x: 5.8, y: 0 });
  for (let i = 0; i < 9; i++) sim.update(1 / 120);
  return { post, fragments: sim.bodies.filter((e) => e.kind === 'fragment') };
}
const glass = hitSample('glass'), timber = hitSample('wood'), stone = hitSample('stone'), steel = hitSample('steel');
assert.equal(glass.fragments.length, 4, 'Glass breaks into shards');
assert.equal(timber.fragments.length, 2, 'Wood parts along its grain');
assert.ok(stone.post.damage < 1 && stone.post.x > 189, 'The masonry yields ground under the blow');
assert.ok(steel.post.bend && steel.post.damage < stone.post.damage, 'Steel folds under the same shot');

// Detonate from open air before any bodies touch. This separates blast damage
// from the subsequent impact when a displaced stone hits a floor or wall.
function blastStone(ammo, kind, gap, covered = false) {
  const sim = new FortressSimulation('small', 2);
  for (const e of sim.bodies) sim.remove(e);
  const origin = { x: 350, y: 120 };
  const width = 32;
  const stone = sim.add(kind, 'stone', origin.x + gap + width / 2, origin.y, width, 20,
    kind === 'block' ? 'masonry' : 'debris');
  if (covered) sim.add('block', 'steel', origin.x + gap / 2, origin.y, 8, 70, 'girder', { isStatic: true });
  const initialLoss = sim.lostWeight;
  sim.time = 1;
  assert.ok(sim.fire(ammo, 35, 65));
  const [shot] = sim.projectiles;
  Body.setPosition(shot.body, origin);
  sim.explode(shot);
  sim.update(1 / 120);
  const pieces = sim.bodies.filter((e) => e.kind === 'fragment' && e.material === 'stone' && e !== stone);
  const fracture = sim.events.find((e) => e.type === 'fracture' && e.material === 'stone');
  return { stone, pieces, fracture, intact: sim.entities.has(stone.id), loss: sim.lostWeight - initialLoss };
}

const blastedWall = blastStone('small-bomb', 'block', 12);
assert.ok(!blastedWall.intact && blastedWall.pieces.length >= 2, 'A close small bomb crushes masonry');
assert.ok(Math.abs(blastedWall.loss - blastedWall.stone.weight) < 1e-6, 'Crushed masonry counts once');
const blastedChunk = blastStone('small-bomb', 'fragment', 12);
assert.ok(!blastedChunk.intact && blastedChunk.pieces.length >= 2, 'The blast itself splits loose stone');
for (const { fracture } of [blastedWall, blastedChunk]) {
  assert.ok(fracture?.blast && Math.abs(fracture.x - 362) < 0.01 && fracture.outX > 0.99,
    'Dust originates at the exposed face and travels away from the explosion');
}
const rubbleMass = blastedChunk.pieces.reduce((sum, e) => sum + e.body.mass, 0);
assert.ok(rubbleMass > blastedChunk.stone.body.mass * 0.85 && rubbleMass <= blastedChunk.stone.body.mass * 1.01,
  'Most of the crushed stone remains as physical rubble');
assert.equal(blastedChunk.loss, 0, 'Crushing rubble does not award structural damage again');
const smallAtRange = blastStone('small-bomb', 'block', 60);
const bigAtRange = blastStone('big-bomb', 'block', 60);
assert.ok(smallAtRange.intact && bigAtRange.stone.damage > smallAtRange.stone.damage,
  'The big bomb delivers more pressure farther from the blast');
const shielded = blastStone('small-bomb', 'block', 12, true);
assert.ok(shielded.intact && shielded.stone.damage < blastedWall.stone.damage, 'Steel cover protects nearby masonry');
assert.ok(blastStone('big-bomb', 'fragment', 180).intact, 'Distant rubble survives');
for (const kind of ['block', 'fragment']) {
  const warm = blastStone('fireball', kind, 12);
  assert.ok(warm.intact && warm.stone.damage === 0, 'A fireball does not crush stone');
}

// A powder barrel beside the flight path can break a live shot before it lands.
const powder = new FortressSimulation('small', 2);
for (const e of powder.bodies) powder.remove(e);
const keg = powder.add('barrel', 'barrel', 300, 100, 18, 23, 'powder');
assert.ok(powder.fire('big-stone', 35, 75));
const [boulder] = powder.projectiles;
Body.setPosition(boulder.body, { x: 327, y: 100 });
powder.explode(keg);
powder.update(1 / 120);
assert.ok(!powder.entities.has(boulder.id) && powder.projectiles.size >= 2, 'The powder blast splits the airborne boulder');
const shotMass = [...powder.projectiles].reduce((sum, shard) => sum + shard.body.mass, 0);
assert.ok(Math.abs(shotMass - boulder.body.mass) < 0.001);
assert.equal(powder.spent, 22, 'Split projectile pieces carry no additional charge');

// The ground floor carries shared upper galleries on destructible piers and courses.
for (const size of ['small', 'medium', 'large']) {
  const keep = new FortressSimulation(size, 1);
  const [plan] = keep.level.sections;
  const blocks = keep.bodies.filter((e) => e.kind === 'block');
  const bricks = blocks.filter((e) => e.detail === 'brickwork');
  assert.ok(bricks.length >= (plan.spans.length - 1) * 3);
  assert.ok(bricks.every((e) => !e.body.isStatic && e.material === 'stone' &&
    e.y < plan.base && e.y > plan.base - plan.storey), 'The foundation uses real courses of masonry');
  assert.ok(blocks.some((e) => e.detail === 'column' && e.material === 'stone' &&
    e.height > e.width && !e.body.isStatic), 'A solid stone pier carries the upper gallery');
  const stairs = blocks.filter((e) => e.stairs).sort((a, b) => b.y - a.y);
  assert.equal(stairs.length, Math.max(...plan.heights) - 1);
  for (const [i, flight] of stairs.entries()) {
    assert.ok(!flight.body.isStatic && flight.width > flight.height);
    assert.equal(flight.stairs, i % 2 ? 'left' : 'right');
    if (i) assert.ok(Math.abs(stairs[i - 1].y - flight.y - plan.storey) < 2,
      'Each flight starts one floor above the previous one');
  }
}

const speeds = ['big-stone', 'siege-bomb'].map((id) => {
  const sim = new FortressSimulation('small', 2);
  sim.fire(id, 35, 75);
  const [shot] = sim.projectiles;
  return { speed: shot.body.speed, momentum: shot.body.speed * shot.body.mass };
});
assert.ok(speeds[1].speed < speeds[0].speed * 0.8);
assert.ok(speeds[1].momentum > speeds[0].momentum * 0.8, 'The slow siege bomb still carries a heavy impact');
console.log('Fortress sentry countershots, material responses, blast-crushed stone and heavy siege-bomb flight passed.');
