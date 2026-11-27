// Run with node fun/fortress/tests/simulation-check.mjs.
import assert from 'node:assert/strict';
import { AMMO, DIFFICULTIES, FortressSimulation, generateLevel, THEMES } from '../simulation.js';
import Matter from '../vendor/matter.min.js';

function advance(sim, frames) {
  for (let i = 0; i < frames; i++) sim.update(1 / 60);
}

// Four seconds between volleys lets the single fixed-step solver finish each cascade.
const replays = [
  [
    [
      ['small-stone', 50, 86],
      ['small-stone', 25, 59],
    ],
    [
      ['small-stone', 70, 99],
      ['small-stone', 55, 100],
      ['small-stone', 50, 100],
      ['small-stone', 20, 86],
      ['small-stone', 20, 54],
    ],
    [
      ['small-stone', 45, 90],
      ['small-stone', 25, 31],
      ['small-stone', 60, 53],
      ['small-stone', 20, 39],
      ['small-stone', 50, 99],
      ['small-stone', 50, 100],
      ['small-bomb', 70, 98],
      ['small-stone', 30, 98],
    ],
  ],
  [
    [
      ['small-stone', 55, 94],
      ['small-stone', 25, 60],
      ['small-bomb', 25, 92],
    ],
    [
      ['small-stone', 35, 50],
      ['small-stone', 40, 93],
      ['small-bomb', 20, 78],
    ],
    [
      ['small-stone', 50, 86],
      ['small-stone', 60, 67],
      ['small-stone', 20, 34],
      ['small-stone', 65, 87],
      ['small-stone', 40, 100],
      ['small-stone', 50, 50],
      ['small-stone', 20, 33],
      ['small-stone', 50, 100],
    ],
  ],
];
const seeds = [1, 12345],
  phases = new Set();
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
    assert.ok(level.sections.length >= 2);
    assert.ok(level.sections.at(-1).base < level.sections[0].base);
    assert.ok(level.terrain.slice(1).every((p, j) => p.x > level.terrain[j].x));
    for (const s of level.sections) {
      const occupied = [...s.orcs, ...s.barrels].map((cell) => cell.join('/'));
      assert.equal(new Set(occupied).size, occupied.length, 'Guard and barrel occupy separate cells');
    }
  }
  assert.equal(profiles.size, 400, 'All sampled seeds have distinct castles');
  assert.equal(themes.size, THEMES.length);
  for (const [run, seed] of seeds.entries()) {
    const sim = new FortressSimulation(size.id, seed);
    const generated = sim.level;
    const initial = sim.bodies.map((b) => [b, b.x, b.y]);
    const lit = sim.torches.length;
    assert.ok(lit > 0);
    assert.deepEqual(generateLevel(size.id, seed), generated);

    // Check both sides of each terrain segment against the actual collision mesh.
    for (let x = 8; x < 1200; x += 9) {
      const y = sim.terrainHeight(x);
      assert.equal(Matter.Query.point(sim.hills, { x, y: y - 0.3 }).length, 0);
      assert.ok(Matter.Query.point(sim.hills, { x, y: y + 0.3 }).length > 0);
    }
    const blockCount = sim.bodies.filter((e) => e.kind === 'block').length;
    assert.ok(blockCount >= [30, 65, 185][index]);
    const last = sim.level.sections.at(-1);
    const backWall = last.left + last.spans.reduce((sum, width) => sum + width, 0);
    const target = last.base - last.storey;
    let miss = Infinity;
    for (let angle = 20; angle <= 70; angle += 2)
      for (let power = 45; power <= 100; power++) {
        miss = Math.min(miss, Math.abs(target - sim.heightAt('small-stone', angle, power, backWall)));
      }
    assert.ok(miss < 9, 'Even in a headwind the far gallery is within ballistic reach');
    // Remove the shot before it touches a pier. Run the full two minutes with
    // no rolling projectile that could invalidate the stability measurement.
    sim.fire('small-stone', 75, 25);
    const shot = sim.bodies.find((e) => e.kind === 'projectile');
    sim.remove(shot);
    advance(sim, 7200);
    assert.equal(sim.stats.destruction, 0, size.name);
    assert.equal(sim.stats.orcsRemaining, sim.stats.orcsTotal);
    assert.equal(sim.torches.filter((t) => t.lit).length, lit);
    assert.ok(sim.bodies.every((e) => !e.burning && e.damage === 0));
    for (const [body, x, y] of initial) {
      assert.ok(Math.hypot(body.x - x, body.y - y) < 2, size.name + ' stands on its original supports');
    }

    sim.loadLevel(size.id);
    assert.deepEqual(sim.level, generated);
    assert.equal(sim.seed, seed);
    let cost = 0;
    const events = [];
    for (const shot of replays[run][index]) {
      assert.ok(
        sim.fire(...shot),
        size.name + ' seed ' + seed + ' ' + JSON.stringify(shot) + ' ' + JSON.stringify(sim.stats),
      );
      cost += AMMO.find((a) => a.id === shot[0]).cost;
      assert.equal(sim.fire(...shot), false, 'Reload does not charge a second time');
      advance(sim, 240);
      events.push(...sim.drainEvents());
    }
    advance(sim, 48);
    events.push(...sim.drainEvents());
    assert.equal(sim.stats.spent, cost);
    assert.ok(cost <= sim.level.par, size.name + ' clears within par');
    assert.equal(sim.stats.orcsRemaining, 0);
    assert.equal(sim.stats.cleared, true, size.name);
    assert.equal(sim.bodies.filter((e) => e.kind === 'orc').length, 0);
    assert.equal(events.filter((e) => e.type === 'faint').length, sim.stats.orcsTotal);
    assert.equal(events.filter((e) => e.type === 'clear').length, 1);
    assert.ok(events.some((e) => e.type === 'impact'));
    assert.equal(sim.seed, seed, 'Debris randomness preserves replay identity');
  }
}
assert.deepEqual(phases, new Set(['day', 'dusk', 'night', 'dawn']));

// A sustained salvo loads the busiest physics path: fragment creation, many
// colliding bodies, powder chains, fire and sleeping/waking separate wards.
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
  if (frame === 119) assert.ok(barrage.orcsRemaining > 0, 'Separate outer wards survive one bomb');
}
assert.ok(peak > intact + 60, 'Benchmark must exercise actual fragmentation');
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

const miss = new FortressSimulation('small', 1);
miss.fire('small-stone', 20, 25);
const shortShot = miss.bodies.find((e) => e.kind === 'projectile');
advance(miss, 7200);
assert.ok(shortShot.x < miss.level.walls[0].left - 12, 'An approach shot loses its rolling energy on turf');
assert.equal(miss.stats.destruction, 0);

for (const seed of [1, 4, 12, 75, 12345, 54123]) {
  const sim = new FortressSimulation('small', seed);
  sim.fire('small-stone', sim.level.aim.angle, sim.level.aim.power);
  advance(sim, 160);
  assert.ok(
    sim.events.some(
      (e) => e.type === 'impact' && ['stone', 'wood', 'steel', 'glass', 'orc', 'barrel'].includes(e.material),
    ),
  );
}

// The aim preview agrees with the launched body at different display refresh rates.
for (const fps of [30, 120]) {
  for (const ammo of AMMO)
    for (const seed of [1, 2]) {
      const sim = new FortressSimulation('small', seed);
      const prediction = sim.trajectory(ammo.id, 42, 78)[10];
      assert.ok(sim.fire(ammo.id, 42, 78));
      for (let i = 0; i < fps / 2; i++) sim.update(1 / fps);
      const shot = sim.bodies.find((b) => b.kind === 'projectile');
      assert.ok(Math.hypot(shot.x - prediction.x, shot.y - prediction.y) < 0.01);
      assert.ok(Math.abs(sim.heightAt(ammo.id, 42, 78, shot.x) - shot.y) < 0.01);
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
for (const orc of finish.bodies.filter((b) => b.kind === 'orc')) finish.faint(orc);
assert.equal(finish.stats.destruction, 0);
assert.equal(finish.stats.ready, false, 'Last guard immediately locks launching');
assert.equal(finish.bodies.filter((b) => b.kind === 'orc').length, 0);
advance(finish, 48);
assert.equal(finish.stats.cleared, true, 'Only the garrison is required for victory');

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

const moved = torchLab();
Matter.Body.translate(moved.host.body, { x: 7, y: 0 });
advance(moved.sim, 5);
assert.equal(moved.torch.lit, false);
assert.equal(moved.torch.body.isStatic, false);
assert.equal(moved.sim.events.filter((e) => e.type === 'extinguish').length, 1);

// A real shot sends wood against a sconce inside the generated medium fort.
const liveFire = new FortressSimulation('medium', 8);
liveFire.fire('small-stone', 45, 83);
advance(liveFire, 240);
const ember = liveFire.bodies.find((e) => e.material === 'wood' && e.burning);
const sconce = liveFire.torches
  .filter((t) => t.lit)
  .sort((a, b) => Math.hypot(a.x - ember.x, a.y - ember.y) - Math.hypot(b.x - ember.x, b.y - ember.y))[0];
assert.ok(ember && sconce);
const initialBurn = ember.burn;
advance(liveFire, 120);
assert.ok(
  !sconce.lit && (ember.burn > initialBurn || liveFire.bodies.some((e) => e.material === 'wood' && e.burning)),
);
assert.ok(liveFire.events.some((e) => e.type === 'ignite' && e.material === 'barrel'));

const powder = torchLab();
powder.sim.add('barrel', 'barrel', 357, 374, 22, 30, 'powder');
advance(powder.sim, 110);
assert.ok(powder.sim.events.some((e) => e.type === 'explosion' && e.material === 'barrel'));
console.log(
  'Fortress passed seeded generation, six par replays, two-minute stability, smooth terrain, windy ballistics, reload, fracture and fire checks.',
);
