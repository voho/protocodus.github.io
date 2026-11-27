// Run with node fun/fortress/tests/simulation-check.mjs.
import assert from 'node:assert/strict';
import { AMMO, DIFFICULTIES, FortressSimulation, generateLevel, THEMES, WORLD } from '../simulation.js';
import Matter from '../vendor/matter.min.js';
import './guard-check.mjs';

function advance(sim, frames) {
  for (let i = 0; i < frames; i++) sim.update(1 / 60);
}

// The fixtures use the public ammunition, angle, power and optional launch side.
// The final optional value is the click time in 60 Hz frames. Shots are four seconds apart.
const flankBombardment = [
  ['small-bomb', 70, 82, 'right'],
  ['small-bomb', 40, 94],
  ['small-bomb', 15, 97],
  ['small-bomb', 55, 97, 'right'],
  ['big-bomb', 60, 94, 'right'],
];
const replays = {
  small: [
    { seed: 1, shots: [['big-bomb', 30, 94]] },
    { seed: 12345, shots: [['small-bomb', 65, 100]] },
  ],
  medium: [
    { seed: 1, shots: [
      ['small-stone', 45, 99],
      ['small-stone', 65, 81],
      ['small-bomb', 35, 90],
      ['small-stone', 45, 99],
      ['small-bomb', 50, 100],
    ] },
    { seed: 12345, shots: [['small-stone', 45, 88], ['small-bomb', 25, 80]] },
  ],
  large: [
    { seed: 52, shots: flankBombardment },
    // Rubble can settle over a different approach. Replay both legal finishing
    // shots from the original seed; at least one must clear this same keep.
    { seed: 57, shots: flankBombardment, endings: [
      ['siege-bomb', 52, 94, 'right', 107],
      ['siege-bomb', 68, 100, 'left', 125],
    ] },
  ],
};
const phases = new Set();
for (const [index, size] of DIFFICULTIES.entries()) {
  const themes = new Set();
  const profiles = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const level = generateLevel(size.id, seed);
    phases.add(level.phase);
    themes.add(level.themeIndex);
    assert.equal(
      level.themeIndex,
      generateLevel('small', seed).themeIndex,
      'Any size can use the same seeded biome',
    );
    assert.ok(Math.abs(level.wind) >= 8 && Math.abs(level.wind) <= 24);
    for (const [j, p] of level.terrain.entries()) {
      if (!j) continue;
      const last = level.terrain[j - 1];
      assert.ok(
        Number.isFinite(p.y) && p.x > last.x && Math.abs(p.y - last.y) / (p.x - last.x) <= 0.6,
        'No terrain needles or reversed segments',
      );
    }
    profiles.add(JSON.stringify(level.sections.map((s) => [s.heights, s.spans, s.orcs, s.barrels, s.pattern])));
    assert.equal(level.sections.length, 1, 'The fortress occupies one connected keep');
    assert.equal(level.walls.length, 0);
    const [keep] = level.sections;
    assert.ok(keep.spans.length >= [3, 5, 9][index] && keep.heights.length === keep.spans.length);
    assert.ok(keep.spans.every((width) => width > 0) && keep.heights.every((floors) => floors >= 1));
    assert.ok(Math.max(...keep.heights) >= [2, 4, 9][index], 'The keep has upper chambers');
    assert.ok(level.terrain.slice(1).every((p, j) => p.x > level.terrain[j].x));
    const cells = [...keep.orcs, ...keep.barrels];
    assert.ok(cells.every(([bay, floor]) => floor >= 0 && floor <= keep.heights[bay]),
      'Every guard and powder store has a floor to stand on');
    assert.equal(new Set(cells.map((cell) => cell.join('/'))).size, cells.length,
      'Guards and powder stores occupy separate rooms');
    assert.ok(keep.orcs.some(([bay, row]) => row === 0 && bay > 0 && bay < keep.spans.length - 1),
      'The keep protects a guard inside its ground floor');
    assert.ok(keep.orcs.some(([, row]) => row >= Math.max(...keep.heights) - 1),
      'A guard also occupies an upper gallery');
  }
  assert.equal(profiles.size, 400, 'All sampled seeds have distinct castles');
  assert.equal(themes.size, THEMES.length);
  for (const { seed, shots, endings } of replays[size.id]) {
    const sim = new FortressSimulation(size.id, seed);
    const generated = sim.level;
    const initial = sim.bodies.map((b) => [b, b.x, b.y]);
    const lit = sim.torches.length;
    assert.ok(lit > 0);
    if (size.id === 'large') {
      assert.ok(lit >= 6, 'The large keep has sconces across its rooms');
      assert.ok(Math.max(...sim.torches.map((t) => t.x)) - Math.min(...sim.torches.map((t) => t.x)) >
        generated.sections[0].spans.reduce((sum, width) => sum + width, 0) / 2,
        'The garrison has light at both ends of the keep');
    }
    assert.deepEqual(generateLevel(size.id, seed), generated);

    // Check both sides of each terrain segment against the actual collision mesh.
    for (let x = WORLD.minX + 8; x < WORLD.maxX; x += 9) {
      const y = sim.terrainHeight(x);
      assert.equal(Matter.Query.point(sim.hills, { x, y: y - 0.3 }).length, 0);
      assert.ok(Matter.Query.point(sim.hills, { x, y: y + 0.3 }).length > 0);
    }
    const blockCount = sim.bodies.filter((e) => e.kind === 'block').length;
    assert.ok(blockCount >= [30, 75, 215][index]);
    if (size.id !== 'small') assert.ok(sim.bodies.some((e) => e.detail === 'buttress'));
    const [keep] = sim.level.sections;
    const backWall = keep.left + keep.spans.reduce((sum, width) => sum + width, 0);
    const target = keep.base - keep.storey;
    let miss = Infinity;
    for (let angle = 20; angle <= 70; angle += 2)
      for (let power = 45; power <= 100; power++) {
        miss = Math.min(miss, Math.abs(target - sim.heightAt('small-stone', angle, power, backWall)));
      }
    assert.ok(miss < 9, 'Even in a headwind the far gallery is within ballistic reach');
    if (size.id === 'large') {
      const highestBay = keep.heights.indexOf(Math.max(...keep.heights));
      const center = keep.left + keep.spans.slice(0, highestBay).reduce((sum, width) => sum + width, 0) + keep.spans[highestBay] / 2;
      const top = keep.base - keep.heights[highestBay] * keep.storey;
      const crest = sim.bodies.filter((b) => b.kind === 'block' && Math.abs(b.x - center) <= keep.spans[highestBay] / 2 + 2);
      assert.ok(Math.min(...crest.map((b) => b.body.bounds.min.y)) < top + 5,
        'The keep stands at its designed height after settling');
      let roofMiss = Infinity;
      for (let angle = 35; angle <= 75; angle++)
        for (let power = 75; power <= 100; power++)
          roofMiss = Math.min(roofMiss, Math.abs(top - sim.heightAt('small-stone', angle, power, center)));
      assert.ok(roofMiss < 9, 'A full draw can reach the upper parapet');
    }
    // Remove the shot before it touches a pier. Run the full two minutes with
    // no rolling projectile that could invalidate the stability measurement.
    sim.fire('small-stone', 75, 25);
    const shot = sim.bodies.find((e) => e.kind === 'projectile');
    sim.remove(shot);
    advance(sim, 7200);
    assert.equal(sim.stats.destruction, 0, size.name);
    assert.equal(sim.stats.orcsRemaining, sim.stats.orcsTotal);
    assert.equal(sim.torches.length, lit);
    assert.ok(sim.torches.every((t) => t.body.isStatic), 'Undisturbed sconces stay mounted');
    if (generated.weather === 'rain' || generated.weather === 'storm') {
      assert.ok(sim.events.filter((e) => e.type === 'extinguish').every((e) => e.rain));
    } else {
      assert.ok(sim.torches.every((t) => t.lit), 'Dry conditions keep undisturbed sconces lit');
    }
    assert.ok(sim.bodies.every((e) => !e.burning && e.damage === 0));
    for (const [body, x, y] of initial) {
      assert.ok(Math.hypot(body.x - x, body.y - y) < 2, size.name + ' stands on its original supports');
    }

    const recipes = endings ? endings.map((lastShot) => [...shots, lastShot]) : [shots];
    let won = false;
    for (const recipe of recipes) {
      sim.loadLevel(size.id);
      assert.deepEqual(sim.level, generated);
      assert.equal(sim.seed, seed);
      let cost = 0;
      const events = [];
      for (const shot of recipe) {
        if (!sim.orcsRemaining) break;
        sim.selectSide(shot[3] || 'left');
        assert.ok(
          sim.fire(...shot),
          size.name + ' seed ' + seed + ' ' + JSON.stringify(shot) + ' ' + JSON.stringify(sim.stats),
        );
        cost += AMMO.find((a) => a.id === shot[0]).cost;
        assert.equal(sim.fire(...shot), false, 'Reload does not charge a second time');
        const detonationFrame = shot[4];
        if (detonationFrame !== undefined) {
          advance(sim, detonationFrame);
          assert.ok(sim.detonateRemote(shot[0]), 'The player activates the armed bomb');
          assert.equal(sim.stats.spent, cost, 'Manual activation is free');
        }
        advance(sim, 240 - (detonationFrame ?? 0));
        events.push(...sim.drainEvents());
      }
      advance(sim, 48);
      events.push(...sim.drainEvents());
      assert.equal(sim.stats.spent, cost);
      assert.ok(cost <= sim.level.par, size.name + ' stays within par');
      const survivors = sim.bodies.filter((e) => e.kind === 'orc').length;
      const cleared = survivors === 0;
      assert.equal(sim.stats.orcsRemaining, survivors);
      assert.equal(sim.stats.cleared, cleared);
      assert.equal(sim.stats.winningCost, cleared ? cost : null);
      assert.equal(events.filter((e) => e.type === 'faint').length, sim.stats.orcsTotal - survivors);
      assert.equal(events.filter((e) => e.type === 'clear').length, cleared ? 1 : 0);
      if (cleared) won = true;
      assert.ok(events.some((e) => e.type === 'impact'));
      assert.equal(sim.seed, seed, 'Debris randomness preserves replay identity');
    }
    assert.ok(won, size.name + ' seed ' + seed + ' must clear under par');
  }
}
assert.deepEqual(phases, new Set(['day', 'dusk', 'night', 'dawn']));

// Removing the ground storey must wake even the topmost sleeping members.
const unsupportedKeep = new FortressSimulation('large', 47);
const [building] = unsupportedKeep.level.sections;
const firstFloor = building.base - building.storey - 5;
const upstairs = unsupportedKeep.bodies.filter((b) => b.kind === 'block' && b.y < firstFloor).map((b) => [b, b.y]);
unsupportedKeep.fire('small-stone', 75, 25);
unsupportedKeep.remove([...unsupportedKeep.projectiles][0]);
for (const b of unsupportedKeep.bodies) {
  if (b.y >= firstFloor && !b.body.isStatic) unsupportedKeep.remove(b);
}
advance(unsupportedKeep, 420);
assert.ok(upstairs.length > 30 && upstairs.every(([b, y]) => !unsupportedKeep.entities.has(b.id) || b.y > y + 12));

// A sustained salvo exercises colliding rubble, powder chains and fire throughout the keep.
const barrage = new FortressSimulation('large', 6);
const intact = barrage.bodies.length;
const samples = [];
let peak = intact;
for (let frame = 0; frame < 600; frame++) {
  if (frame % 120 === 0) barrage.fire('big-bomb', 32 + frame / 24, 60 + frame / 15);
  const started = performance.now();
  barrage.update(1 / 60);
  samples.push(performance.now() - started);
  if (frame % 12 === 0) peak = Math.max(peak, barrage.bodies.length);
  if (frame === 119) assert.ok(barrage.orcsRemaining > 0, 'The reinforced keep survives an opening bomb');
}
assert.ok(peak > intact + 60, 'Benchmark must exercise actual fragmentation');
assert.ok(barrage.events.some((e) => e.type === 'fracture' && e.secondary), 'Falling rubble fractures during the siege');
assert.ok(barrage.events.some((e) => e.type === 'stone-dust'));
assert.ok(barrage.bodies.some((e) => e.kind === 'fragment' && e.material === 'stone' && e.body.area > 130));
assert.ok(
  samples.reduce((sum, ms) => sum + ms, 0) < 10000,
  'The solver sustains the ten-second physics sequence in real time',
);
samples.sort((a, b) => a - b);
console.log(
  'Large barrage:',
  intact,
  'initial bodies,',
  peak,
  'peak,',
  samples[570].toFixed(2),
  'ms p95 physics per frame.',
);

// Skipping dormant solver steps must preserve the next collision, including
// its cached contacts, sleep-counter phase and seeded debris sequence.
const dormant = new FortressSimulation('small', 1);
const continuous = new FortressSimulation('small', 1);
continuous.canRest = () => false;
for (const s of [dormant, continuous]) {
  s.fire('small-stone', 75, 25);
  s.remove([...s.projectiles][0]);
  advance(s, 728);
  assert.ok(s.fire('small-stone', 50, 86));
  advance(s, 180);
}
const poses = (s) => s.bodies.map((e) => [e.id, e.x, e.y, e.angle, e.damage, e.burn, e.body.sleepCounter]);
assert.deepEqual(poses(dormant), poses(continuous));
assert.deepEqual(dormant.events, continuous.events);

const miss = new FortressSimulation('small', 1);
miss.fire('small-stone', 20, 25);
const shortShot = miss.bodies.find((e) => e.kind === 'projectile');
advance(miss, 7200);
assert.ok(shortShot.x < miss.level.sections[0].left - 12, 'An approach shot loses its rolling energy on turf');
assert.equal(miss.stats.destruction, 0);

for (const seed of [1, 4, 12, 75, 12345, 54123]) {
  const sim = new FortressSimulation('small', seed);
  sim.fire('small-stone', sim.level.aim.angle, sim.level.aim.power);
  advance(sim, 160);
  assert.ok(
    sim.events.some(
      (e) => e.type === 'impact' && ['stone', 'wood', 'steel', 'glass', 'orc', 'barrel', 'torch'].includes(e.material),
    ),
  );
}

// The aim preview agrees with the launched body at different display refresh rates.
for (const fps of [30, 120]) {
  for (const ammo of AMMO)
    for (const seed of [1, 2]) {
      const sim = new FortressSimulation('small', seed);
      const prediction = sim.trajectory(ammo.id, 42, 78)[10];
      const predictedHeight = sim.heightAt(ammo.id, 42, 78, prediction.x);
      assert.ok(sim.fire(ammo.id, 42, 78));
      for (let i = 0; i < fps / 2; i++) sim.update(1 / fps);
      const shot = sim.bodies.find((b) => b.kind === 'projectile');
      assert.ok(Math.hypot(shot.x - prediction.x, shot.y - prediction.y) < 0.01);
      assert.ok(Math.abs(predictedHeight - shot.y) < 0.01);
      assert.equal(sim.heightAt(ammo.id, 15, 25, 1120), Infinity, 'Ground blocks low undershoots');
      assert.equal(sim.stats.spent, ammo.cost);
    }
}

for (const ammo of AMMO) {
  const sim = new FortressSimulation('small', 2);
  assert.ok(sim.fire(ammo.id, 18, 60));
  advance(sim, Math.round(ammo.reload * 60) - 1);
  assert.ok(!sim.fire('small-stone', 18, 60) && !sim.fire('big-bomb', 18, 60));
  assert.equal(sim.stats.spent, ammo.cost, 'Switching ammunition cannot bypass or extend the current reload');
  advance(sim, 1);
  assert.ok(sim.stats.ready && sim.stats.reloadRemaining === 0);
  assert.ok(sim.fire('small-stone', 18, 60));
  if (ammo.id === 'small-stone') {
    const shots = sim.bodies.filter((b) => b.kind === 'projectile');
    assert.equal(shots.length, 2);
    assert.ok(
      shots.every((b) => b.y + b.radius < sim.terrainHeight(b.x)),
      'Two small stones are airborne on a low arc',
    );
  }
}

const finish = new FortressSimulation('small', 1);
finish.fire('small-stone', 75, 25);
advance(finish, 24);
for (const orc of finish.bodies.filter((b) => b.kind === 'orc')) finish.faint(orc);
assert.equal(finish.stats.destruction, 0);
assert.equal(finish.stats.winningCost, 10, 'The last guard fixes the winning score immediately');
assert.equal(finish.bodies.filter((b) => b.kind === 'orc').length, 0);
assert.ok(finish.fire('big-bomb', finish.level.aim.angle, finish.level.aim.power));
assert.equal(finish.stats.ready, false, 'Post-victory shots still reload');
advance(finish, 180);
assert.equal(finish.stats.cleared, true, 'Only the garrison is required for victory');
assert.ok(finish.stats.destruction > 0, 'Shooting after the last guard can bring down the surviving tower');
assert.ok(finish.fire('siege-bomb', 55, 65));
advance(finish, 15);
assert.ok(finish.detonateSiegeBomb());
assert.equal(finish.stats.spent, 160);
assert.equal(finish.stats.winningCost, 10, 'Further ammunition leaves the winning score intact');
assert.equal(finish.events.filter((e) => e.type === 'clear').length, 1);
finish.loadLevel();
assert.equal(finish.stats.winningCost, null);

function lab() {
  const sim = new FortressSimulation('small', 1);
  for (const e of sim.bodies) sim.remove(e);
  sim.fire('small-stone', 75, 25);
  sim.remove(sim.bodies.find((e) => e.kind === 'projectile'));
  return sim;
}
const materials = lab();
const [glass, wood, stone, steel] = ['glass', 'wood', 'stone', 'steel'].map((mat, i) =>
  materials.add('block', mat, 310 + i * 40, 370, 20, 30, 'sample'),
);
for (const e of [glass, wood, stone, steel]) materials.hit(e, 8, e.body.position);
materials.resolveDamage();
assert.ok(wood.damage >= 1 && glass.damage >= 1);
assert.ok(steel.damage < stone.damage && stone.damage < 1);
assert.equal(steel.body.parts.length, 3, 'The yielded girder has two angled contact surfaces');
assert.ok(
  materials.bodies.some((e) => e.kind === 'fragment' && e.material === 'glass' && e.vertices.length === 3),
);
materials.hit(stone, 12, stone.body.position);
materials.hit(steel, 22, steel.body.position);
materials.resolveDamage();
assert.equal(materials.bodies.filter((e) => e.kind === 'fragment' && e.material === 'stone').length, 4);
assert.equal(materials.bodies.filter((e) => e.kind === 'fragment' && e.material === 'steel').length, 2);

function loadSpan(height) {
  const sim = lab();
  sim.add('block', 'stone', 312, 379, 18, 20, 'masonry');
  sim.add('block', 'stone', 402, 379, 18, 20, 'masonry');
  const beam = sim.add('block', 'wood', 357, 364, 110, 10, 'beam');
  sim.add('block', 'stone', 357, 359 - height / 2, 76, height, 'masonry');
  advance(sim, 90);
  return beam.damage;
}
assert.equal(loadSpan(12), 0);
assert.equal(loadSpan(120), 1);

// A burning torch conducts heat to a stationary near timber; flame spreads to
// the second touching plank, beyond the torch's own reach. Teardown is physical.
function torchLab() {
  const sim = lab(),
    host = sim.add('block', 'stone', 330, 374, 20, 30, 'masonry');
  const torch = sim.attachTorch(host, 14);
  return { sim, host, torch };
}
const fire = torchLab();
const first = fire.sim.add('block', 'wood', 353, 378, 10, 22, 'beam');
const second = fire.sim.add('block', 'wood', 363, 378, 10, 22, 'beam');
advance(fire.sim, 65);
assert.ok(first.burning && first.burn > 0 && !second.burning);
advance(fire.sim, 150);
assert.ok(second.burning, 'Heat crosses a touching wood joint');
advance(fire.sim, 540);
assert.ok(!fire.sim.entities.has(first.id) && !fire.sim.entities.has(second.id), 'Burned timbers fail');

const consumed = lab();
const plinth = consumed.add('block', 'wood', 340, 374, 34, 30, 'beam');
const cap = consumed.add('block', 'stone', 340, 349, 18, 20, 'masonry');
advance(consumed, 240);
consumed.ignite(plinth);
advance(consumed, 240);
assert.ok(plinth.burn > 0.45 && plinth.burn < 0.65 && Math.abs(cap.y - 349) < 1);
advance(consumed, 260);
const ash = consumed.events.filter((e) => e.type === 'burnout' && e.id === plinth.id);
assert.ok(ash.length === 1 && ash[0].width === 34 && ash[0].height === 30);
assert.ok(!consumed.entities.has(plinth.id) && cap.y > 375, 'Ash no longer supports the capstone');

const splinters = lab();
const timber = splinters.add('block', 'wood', 345, 379, 48, 20, 'beam');
splinters.ignite(timber);
advance(splinters, 180);
splinters.fracture(timber);
const halves = splinters.bodies.filter((e) => e.kind === 'fragment' && e.material === 'wood');
assert.equal(halves.length, 2);
assert.ok(halves.every((e) => e.burning && e.ignitedAt === timber.ignitedAt && e.burn === timber.burn));
advance(splinters, 300);
assert.ok(halves.every((e) => !splinters.entities.has(e.id)));
assert.equal(splinters.events.filter((e) => e.type === 'burnout').length, 2);

const pebbles = lab();
const pebble = pebbles.add('block', 'stone', 320, 375, 9, 8, 'masonry');
pebbles.fracture(pebble);
const chips = pebbles.bodies.filter((e) => e.kind === 'fragment');
const rubble = pebbles.add('fragment', 'stone', 360, 369, 15, 12, 'debris');
const tinyBlock = pebbles.add('block', 'stone', 390, 387, 6, 4, 'masonry');
advance(pebbles, 180);
assert.ok(chips.length === 4 && chips.every((e) => e.dustProgress > 0.35 && e.dustProgress < 0.55));
advance(pebbles, 100);
assert.ok(chips.every((e) => !pebbles.entities.has(e.id)));
assert.equal(pebbles.events.filter((e) => e.type === 'stone-dust').length, 4);
assert.ok(pebbles.entities.has(rubble.id) && pebbles.entities.has(tinyBlock.id));

const grip = lab();
const slider = grip.add('fragment', 'stone', 310, grip.terrainHeight(310) - 7.2, 24, 14, 'debris');
Matter.Body.setVelocity(slider.body, { x: 0.34, y: 0 });
Matter.Body.setAngularVelocity(slider.body, 0.006);
advance(grip, 45);
assert.ok(slider.body.isSleeping && Math.abs(slider.x - 310) < 2, 'Loose stone comes to rest on almost-flat terrain');
const settledX = slider.x;
advance(grip, 120);
assert.equal(slider.x, settledX, 'Settled rubble stays put');
assert.ok(grip.fire('small-stone', 30, 50));
const [nudge] = grip.projectiles;
Matter.Body.setPosition(nudge.body, { x: slider.x - 21.2, y: slider.y - 6 });
Matter.Body.setVelocity(nudge.body, { x: 3, y: 0 });
Matter.Body.setAngularVelocity(nudge.body, 0);
advance(grip, 8);
assert.ok(grip.entities.has(slider.id) && !slider.body.isSleeping && slider.x > settledX + 4,
  'A fresh impact wakes and pushes settled rubble');

// Use a triangular chip broken from masonry, including its irregular collision
// hull. Drop it from two different heights onto the same stretch of flat ground.
function dropMasonryChunk(height) {
  const sim = lab();
  const parent = sim.add('block', 'stone', 300, 260, 54, 48, 'masonry');
  sim.fracture(parent);
  const [chunk, ...others] = sim.bodies;
  for (const other of others) sim.remove(other);
  const body = chunk.body;
  Matter.Body.setAngle(body, 0.35);
  const y = body.position.y + sim.terrainHeight(300) - body.bounds.max.y - height;
  Matter.Body.setPosition(body, { x: 300, y });
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(body, 0);
  sim.drainEvents();
  return { sim, chunk };
}
const restingChunk = dropMasonryChunk(2);
advance(restingChunk.sim, 300);
assert.ok(
  restingChunk.sim.entities.has(restingChunk.chunk.id) && restingChunk.chunk.body.isSleeping,
  'A gentle landing leaves a permanent stone chunk',
);
const { sim: drop, chunk } = dropMasonryChunk(210);
const destroyedWeight = drop.lostWeight;
for (let step = 0; step < 360 && drop.entities.has(chunk.id); step++) drop.update(1 / 120);
assert.ok(!drop.entities.has(chunk.id), 'A hard impact splits an existing chunk');
const gravel = drop.bodies;
assert.ok(gravel.length >= 2 && gravel.length <= 4);
for (const piece of gravel) {
  assert.equal(piece.kind, 'fragment');
  assert.ok(piece.body.area > 0 && piece.body.area < chunk.body.area);
  // Each physical child must fit inside the irregular parent immediately after splitting.
  assert.ok(piece.body.vertices.every((p) => Matter.Vertices.contains(chunk.body.vertices, p)));
}
const solidArea = gravel.reduce((area, piece) => area + piece.body.area, 0);
assert.ok(solidArea >= chunk.body.area * 0.75 && solidArea <= chunk.body.area * 1.01);
assert.equal(drop.lostWeight, destroyedWeight, 'Breaking rubble does not score the same stone again');
assert.ok(drop.events.some((e) => e.type === 'fracture' && e.material === 'stone' && e.secondary));
advance(drop, 420);
assert.ok(drop.bodies.some((e) => e.kind === 'fragment' && e.body.area > 30 && e.body.isSleeping));

const moved = torchLab();
Matter.Body.translate(moved.host.body, { x: 7, y: 0 });
advance(moved.sim, 5);
assert.equal(moved.torch.lit, false);
assert.equal(moved.torch.body.isStatic, false);
assert.equal(moved.sim.events.filter((e) => e.type === 'extinguish').length, 1);

// A real shot sends wood against a sconce inside a generated fortress.
const liveFire = new FortressSimulation('small', 2);
liveFire.fire('small-stone', 38, 92);
advance(liveFire, 175);
const ember = liveFire.bodies.find((e) => e.material === 'wood' && e.burning);
assert.ok(ember, 'A falling timber ignites');
const sconce = liveFire.torches
  .filter((t) => t.lit)
  .sort((a, b) => Math.hypot(a.x - ember.x, a.y - ember.y) - Math.hypot(b.x - ember.x, b.y - ember.y))[0];
assert.ok(sconce && Math.hypot(sconce.flameX - ember.x, sconce.flameY - ember.y) < 50);
assert.ok(!liveFire.events.some((e) => e.type === 'explosion'), 'The timber caught from a torch');
const initialBurn = ember.burn;
liveFire.remove(liveFire.entities.get(sconce.hostId));
advance(liveFire, 60);
assert.ok(
  !sconce.lit && (ember.burn > initialBurn || liveFire.bodies.some((e) => e.material === 'wood' && e.burning)),
);

// The load stays safely below the cold beam's capacity. Charring reduces the
// section carrying that load and snaps the beam well before it burns through.
for (const burning of [false, true]) {
  const sim = lab();
  sim.add('block', 'stone', 300, 369, 18, 40, 'masonry');
  sim.add('block', 'stone', 405, 369, 18, 40, 'masonry');
  const girder = sim.add('block', 'wood', 352.5, 344, 119, 10, 'beam');
  const stone = sim.add('block', 'stone', 352.5, 304, 35, 70, 'masonry');
  if (burning) sim.ignite(girder);
  advance(sim, 420);
  if (burning) {
    assert.ok(girder.damage === 1 && girder.burn > 0.1 && girder.burn < 0.6);
    assert.ok(stone.y > stone.home.y + 28, 'Load drops through the burning span');
  } else assert.ok(girder.damage === 0 && Math.abs(stone.y - stone.home.y) < 1);
}

function openGroundShot(ammo) {
  const sim = new FortressSimulation('small', 1),
    initial = sim.terrain;
  const pristine = JSON.stringify(initial);
  const distant = sim.hills.at(-2);
  // Land on the flat approach, beyond the reach of the first powder store.
  sim.fire(ammo, 67, 25);
  const shot = [...sim.projectiles][0];
  assert.ok(shot.flightPath.length > 8 && shot.flightPath[0].x === sim.release.x);
  advance(sim, 150);
  assert.equal(JSON.stringify(sim.level.terrain), pristine);
  assert.ok(sim.hills.includes(distant), 'Remote ground contacts remain intact');
  return sim;
}
const smallCrater = openGroundShot('small-bomb'),
  bigCrater = openGroundShot('big-bomb');

function successiveBlasts() {
  const sim = lab();
  const impulses = [];
  for (let i = 0; i < 3; i++) {
    const chip = sim.add('fragment', 'wood', 370, 130, 12, 10, 'debris');
    const barrel = sim.add('barrel', 'barrel', 300, 130, 16, 20, 'powder');
    sim.explode(barrel);
    impulses.push(chip.body.velocity.x);
    sim.remove(chip);
  }
  return impulses;
}
const impulses = successiveBlasts();
assert.ok(Math.max(...impulses) - Math.min(...impulses) > 0.05, 'Successive blasts vary in the same room');
assert.deepEqual(successiveBlasts(), impulses, 'A seeded restart reproduces the pressure variation');
const smallCut = smallCrater.events.find((e) => e.type === 'crater'),
  bigCut = bigCrater.events.find((e) => e.type === 'crater');
assert.ok(bigCut.depth > smallCut.depth * 1.3 && bigCut.radius > smallCut.radius * 1.25);
assert.equal(bigCrater.terrainVersion, 1);
for (let x = bigCut.x - bigCut.radius + 0.4; x < bigCut.x + bigCut.radius; x += 3) {
  const y = bigCrater.terrainHeight(x);
  assert.equal(Matter.Query.point(bigCrater.hills, { x, y: y - 0.3 }).length, 0);
  assert.ok(Matter.Query.point(bigCrater.hills, { x, y: y + 0.3 }).length > 0);
}
assert.equal(openGroundShot('small-stone').terrainVersion, 0);
const impactImplosion = openGroundShot('magic-bomb');
const waitingOrb = impactImplosion.armedBomb('magic-bomb');
advance(impactImplosion, 1000);
assert.ok(waitingOrb.body.isSleeping && impactImplosion.entities.has(waitingOrb.id));
assert.ok(!impactImplosion.events.some((e) => e.type === 'implosion'));
assert.ok(impactImplosion.detonateRemote('magic-bomb'));
assert.ok(!impactImplosion.detonateRemote('magic-bomb'));
assert.equal(impactImplosion.events.filter((e) => e.type === 'implosion').length, 1);
assert.equal(impactImplosion.terrainVersion, 0);
assert.ok(!impactImplosion.events.some((e) => e.type === 'fireburst' || e.type === 'explosion'));

const well = lab();
advance(well, 12);
const pullLeft = well.add('fragment', 'wood', 225, 150, 12, 8, 'debris');
const pullRight = well.add('fragment', 'wood', 375, 150, 12, 8, 'debris');
const outside = well.add('fragment', 'wood', 480, 150, 12, 8, 'debris');
assert.ok(well.fire('magic-bomb', 40, 65));
const orb = [...well.projectiles][0];
Matter.Body.setPosition(orb.body, { x: 300, y: 150 });
assert.ok(well.detonateRemote('magic-bomb'));
advance(well, 8);
assert.ok(pullLeft.x > 225 && pullRight.x < 375, 'The implosion draws pieces in from both sides');
assert.equal(outside.x, 480, 'Distant rubble is outside the pull');
advance(well, 35);
assert.equal(well.implosions.length, 0, 'The pull expires after its core collapses');
assert.ok(!pullLeft.burning && !pullRight.burning);
const cleanFire = openGroundShot('fireball');
assert.equal(cleanFire.events.filter((e) => e.type === 'fireburst').length, 1);
assert.equal(cleanFire.terrainVersion, 0, 'The fireball trades excavation for sustained heat');
bigCrater.loadLevel('small', 1);
assert.ok(bigCrater.terrainVersion === 0 && bigCrater.terrain === bigCrater.level.terrain);

const undermined = lab();
const pier = undermined.add('block', 'stone', 348, 379, 24, 20, 'masonry');
advance(undermined, 150);
const oldHeight = undermined.terrainHeight(348);
undermined.excavate({ x: 348, y: oldHeight - 100 }, 158);
assert.equal(undermined.terrainVersion, 0, 'A high airburst leaves the earth intact');
undermined.excavate({ x: 348, y: oldHeight - 9 }, 158);
advance(undermined, 120);
assert.ok(pier.y > pier.home.y + 25, 'Unsupported sleeping masonry falls into the hole');
for (let i = 0; i < 90; i++) {
  const x = 210 + (i % 25) * 15;
  undermined.excavate({ x, y: undermined.terrainHeight(x) - 7 }, 158);
}
for (let x = 220; x < 550; x += 9)
  assert.ok(undermined.terrainHeight(x) > 425, 'Overlapping blasts leave a continuous trench');
assert.ok(undermined.terrain.length <= undermined.level.terrain.length + 151);
for (const x of [-55, 1500]) {
  const surface = undermined.terrainHeight(x);
  undermined.excavate({ x, y: surface - 5 }, 158);
  assert.ok(undermined.terrainHeight(x) > surface + 15, 'Both catapult approaches can be cratered');
}
assert.ok(
  undermined.terrain.every(
    (p, i) => Number.isFinite(p.y) && p.y <= 465 && (!i || p.x > undermined.terrain[i - 1].x),
  ),
);

// A masonry shield covers the central portion of this shelf. A shot lands
// on its protruding tip, where the contact must ignite this exact timber.
const shelf = lab();
const timberShelf = shelf.add('block', 'wood', 360, 328, 150, 10, 'beam', { isStatic: true });
shelf.add('block', 'stone', 320, 305, 24, 36, 'masonry', { isStatic: true });
advance(shelf, 30);
assert.ok(shelf.fire('fireball', 40, 60));
const spark = [...shelf.projectiles][0];
Matter.Body.setPosition(spark.body, { x: 294, y: 286 });
Matter.Body.setVelocity(spark.body, { x: 0, y: 5 });
advance(shelf, 35);
assert.ok(timberShelf.burning && timberShelf.ignitedAt < 0.85);
assert.equal(shelf.events.filter((e) => e.type === 'ignite' && e.id === timberShelf.id).length, 1);

const remote = new FortressSimulation('small', 1);
assert.equal(remote.detonateSiegeBomb(), false);
assert.ok(remote.fire('siege-bomb', 70, 35));
advance(remote, 24);
assert.ok(remote.detonateSiegeBomb(), 'Remote detonation fires in mid-air');
assert.equal(remote.terrainVersion, 0);
assert.equal(remote.events.filter((e) => e.type === 'explosion' && e.material === 'siege-bomb').length, 1);
advance(remote, 145);
assert.ok(remote.fire('siege-bomb', 22, 28));
const firstRemote = [...remote.remoteBombs][0];
advance(remote, 970);
assert.ok(remote.entities.has(firstRemote.id) && firstRemote.body.isSleeping, 'A landed remote survives cleanup');
assert.ok(remote.fire('siege-bomb', 22, 28));
const secondRemote = [...remote.remoteBombs][1];
advance(remote, 190);
assert.equal(remote.stats.remoteBombs, 2);
assert.ok(remote.detonateSiegeBomb());
advance(remote, 40);
assert.ok(!remote.entities.has(firstRemote.id) && remote.entities.has(secondRemote.id));
assert.equal(remote.stats.remoteBombs, 1, 'A nearby remote blast leaves the second bomb armed');
assert.ok(remote.terrainVersion > 0 && remote.detonateSiegeBomb());
assert.equal(remote.stats.remoteBombs, 0);
assert.equal(remote.stats.spent, 270);

// Each crew has its own reload and both incoming arcs feel the same world wind.
const flanks = new FortressSimulation('large', 14);
for (const side of ['left', 'right']) {
  flanks.selectSide(side);
  assert.equal(flanks.stats.ready, true);
  const arc = flanks.trajectory('small-stone', 56, 76);
  assert.deepEqual(arc[0], flanks.level.catapults[side]);
  assert.ok(Math.abs(flanks.heightAt('small-stone', 56, 76, arc[5].x) - arc[5].y) < 0.001);
  assert.ok(flanks.fire('small-stone', 56, 76));
  assert.equal(flanks.stats.ready, false);
  assert.equal(flanks.events.at(-1).side, side);
  assert.ok(!flanks.fire('small-stone', 56, 76));
}
const [fromLeft, fromRight] = flanks.projectiles;
assert.ok(fromLeft.body.velocity.x > 0 && fromRight.body.velocity.x < 0);
for (let i = 0; i < 30; i++) flanks.update(1 / 120);
for (const shot of [fromLeft, fromRight]) {
  assert.ok(Math.hypot(shot.x - shot.flightPath[5].x, shot.y - shot.flightPath[5].y) < 0.1);
}
assert.equal(flanks.stats.spent, 20);

const charges = new FortressSimulation('small', 1);
assert.ok(charges.fire('magic-bomb', 38, 55));
charges.selectSide('right');
assert.ok(charges.fire('siege-bomb', 38, 55));
const charge = charges.armedBomb('magic-bomb');
Matter.Body.setPosition(charges.armedBomb('siege-bomb').body, { x: 320, y: 150 });
Matter.Body.setPosition(charge.body, { x: 347, y: 150 });
assert.ok(charges.detonateSiegeBomb());
advance(charges, 25);
assert.equal(charges.armedBomb(), charge, 'The other charge survives a nearby explosion');
assert.ok(!charges.events.some((e) => e.type === 'implosion'));
assert.ok(charges.detonateRemote('magic-bomb'));
assert.equal(charges.stats.spent, 165, 'Activation costs no gold');

const magic = new FortressSimulation('small', 1);
magic.fire('fireball', 38, 85);
advance(magic, 500);
assert.ok(magic.events.some((e) => e.type === 'ignite' && e.material === 'wood'));
assert.ok(magic.events.some((e) => e.type === 'ignite' && e.material === 'barrel'));
assert.ok(magic.events.some((e) => e.type === 'explosion' && e.material === 'barrel'));
assert.equal(magic.events.filter((e) => e.type === 'fireburst').length, 1);
const chain = lab();
const primed = chain.add('barrel', 'barrel', 285, 373, 20, 32, 'powder');
chain.add('block', 'wood', 311, 378, 12, 22, 'beam');
chain.add('barrel', 'barrel', 329, 373, 20, 32, 'powder');
chain.explode(primed);
advance(chain, 90);
assert.ok(
  chain.events.some((e) => e.type === 'ignite' && e.material === 'wood'),
  'Blast heat lights exposed timber',
);
assert.equal(chain.events.filter((e) => e.type === 'explosion' && e.material === 'barrel').length, 2);
assert.ok(chain.terrainVersion > 0);

const powder = torchLab();
powder.sim.add('barrel', 'barrel', 357, 374, 22, 30, 'powder');
advance(powder.sim, 110);
assert.ok(powder.sim.events.some((e) => e.type === 'explosion' && e.material === 'barrel'));
console.log(
  'Fortress passed seeded generation, six par replays, two-minute stability, smooth terrain, windy ballistics, reload, crater meshes, load failure, falling rubble, fireball chains and post-victory destruction.',
);
