import assert from 'node:assert/strict';
import { FortressSimulation, generateLevel } from '../simulation.js';

const seeds = new Map();
let windySeed;
for (let seed = 1; seed <= 160; seed++) {
  const level = generateLevel('small', seed);
  const replay = generateLevel('small', seed);
  assert.equal(replay.weather, level.weather);
  assert.equal(replay.wind, level.wind);
  assert.deepEqual(replay.gust, level.gust);
  if (!seeds.has(level.weather)) seeds.set(level.weather, seed);
  if (level.weather === 'clear' && level.gust) windySeed ??= seed;
}
for (const weather of ['clear', 'rain', 'snow', 'storm']) {
  assert.ok(seeds.has(weather), 'Generated sieges include ' + weather);
}
assert.ok(windySeed, 'Fair skies can also produce strong wind');

function advance(sim, seconds) {
  for (let i = 0; i < Math.round(seconds * 120); i++) sim.update(1 / 120);
}

function openField(seed) {
  const sim = new FortressSimulation('small', seed);
  for (const body of sim.bodies) sim.remove(body);
  // Start the clock through a normal shot, then clear it from the shooting lane.
  assert.ok(sim.fire('small-stone', 45, 40));
  sim.remove([...sim.projectiles][0]);
  return sim;
}

// Aiming happens at the instant of release. A gust can change during the
// flight, and an identical shot released later can land in a different place.
const stormSeed = seeds.get('storm');
const waiting = new FortressSimulation('small', stormSeed);
const winds = [];
for (let second = 0; second < 9; second++) {
  winds.push(waiting.wind);
  advance(waiting, 1);
}
assert.ok(Math.max(...winds) - Math.min(...winds) > 10, 'Gusts change while the player lines up the first shot');
assert.equal(waiting.stats.spent, 0);
assert.equal(waiting.stats.destruction, 0, 'The untouched storm fortress remains standing');

for (const side of ['left', 'right']) {
  for (const angle of [24, 52, 72]) {
    const downrange = [];
    for (const delay of [0.75, 3, 6.5]) {
      const sim = openField(stormSeed);
      sim.selectSide(side);
      advance(sim, delay);
      const predicted = sim.trajectory('big-stone', angle, 77);
      const samples = [4, 8, 12].map((index) => ({
        point: predicted[index],
        height: sim.heightAt('big-stone', angle, 77, predicted[index].x),
      }));
      downrange.push(samples.at(-1).point.x);
      assert.ok(sim.fire('big-stone', angle, 77));
      const [shot] = sim.projectiles;
      for (const { point, height } of samples) {
        advance(sim, 0.2);
        assert.ok(Math.hypot(shot.x - point.x, shot.y - point.y) < 0.03, 'The guide tracks the shot through a gust');
        assert.ok(Math.abs(shot.y - height) < 0.03, 'The chosen range predicts the same height');
      }
    }
    assert.ok(Math.max(...downrange) - Math.min(...downrange) > 0.1, 'Launch time affects wind drift');
  }
}

function lightShelter(sim, x, covered) {
  const y = sim.terrainHeight(x);
  const post = sim.add('block', 'stone', x, y - 20, 20, 40, 'masonry', { isStatic: true });
  const torch = sim.attachTorch(post, 14);
  const timber = sim.add('block', 'wood', x - 28, y - 5, 30, 10, 'beam');
  const roof = covered ? sim.add('block', 'stone', x, y - 62, 124, 10, 'masonry', { isStatic: true }) : null;
  sim.ignite(timber);
  return { post, torch, timber, roof };
}

for (const weather of ['rain', 'storm']) {
  const sim = openField(seeds.get(weather));
  const wet = lightShelter(sim, 245, false);
  const dry = lightShelter(sim, 445, true);
  advance(sim, 4);
  assert.ok(!wet.timber.burning && wet.timber.burn > 0, 'Rain quenches open timber and leaves its char');
  assert.ok(dry.timber.burning && dry.timber.burn > wet.timber.burn, 'The roof shelters the fire');
  assert.ok(!wet.torch.lit && dry.torch.lit, 'Only the exposed torch goes dark');
  assert.ok(wet.torch.body.isStatic, 'A doused fixture remains on its bracket');
  sim.remove(wet.post);
  sim.remove(dry.roof);
  advance(sim, 4);
  assert.ok(!wet.torch.body.isStatic, 'The doused sconce falls when its bracket is removed');
  assert.ok(!dry.torch.lit && !dry.timber.burning, 'The surviving shelter loses protection with its roof');
}

function timberOnPier(seed, damage) {
  const sim = openField(seed);
  if (sim.level.gust) {
    for (let frame = 0; frame < 3600 && Math.abs(sim.wind) < 36; frame++) sim.update(1 / 120);
    assert.ok(Math.abs(sim.wind) >= 36, 'The sampled wind reaches a strong gust');
  }
  sim.add('block', 'stone', 330, 340, 12, 10, 'masonry', { isStatic: true });
  const beam = sim.add('block', 'wood', 330, 300, 10, 70, 'beam');
  if (damage) sim.damageBlock(beam, damage, beam.body.position);
  advance(sim, 0.8);
  return beam;
}
const intactBeam = timberOnPier(windySeed, 0);
const crackedBeam = timberOnPier(windySeed, 0.65);
const calmBeam = timberOnPier(seeds.get('clear'), 0.65);
assert.ok(Math.abs(calmBeam.x - 330) < 0.001, 'A damaged beam on the same support stays put in fair weather');
assert.ok(Math.abs(intactBeam.x - 330) < 0.001, 'An intact structural member keeps its lateral position');
assert.ok(Math.abs(crackedBeam.x - intactBeam.x) > 0.05, 'The same gust catches the weakened member');

console.log('Fortress weather passed seeded skies, gust-driven trajectories, structural wind loads and sheltered fire.');
