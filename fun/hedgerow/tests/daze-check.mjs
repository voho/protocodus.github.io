// Run with: node fun/hedgerow/tests/daze-check.mjs
// A blast close by dazes him (combat.js → player.js, daze.js), by how close
// it went off: all of it at a grenade's feet, half at about 7 m, none past
// 11 m, a charge nearly twice as far; less with a wall between. It is at its
// worst for a moment, then wears off over three to nine seconds, the harder
// it hit the longer; a weaker blast meanwhile changes nothing, a harder one
// starts it over. Dazed, the view swims a few degrees round the aim (camera
// only: the aim is not moved) and is back on it once it has worn off.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createExplosives } = await import('../js/combat.js');
const { createDaze } = await import('../js/daze.js');
const { createCameraRig } = await import('../js/camera.js');

const deg = (r) => (r * 180) / Math.PI;
const noop = () => {};

/* How hard a blast `ahead` metres in front of him (on the ground; his eyes at
   1.6 m) dazes him: a grenade or a charge, a wall between or not. */
function blast(ahead, { kind = 'grenade', wall = false } = {}) {
  let got = 0;
  const G = {
    models: { get: () => null }, matlib: { resolve: (m) => m },
    scene: { add: noop, remove: noop },
    world: { water: null, clear: () => !wall, raycast: () => null },
    terrain: { height: () => 0, surfaceAt: () => 'mud' },
    effects: { explosion: noop, splash: noop },
    audio: { explosion: noop, grenadeBounce: noop },
    lights: { flash: noop }, events: { emit: noop },
    rig: { addShake: noop }, spatter: noop,
    camera: { position: new THREE.Vector3(0, 1.6, 0) },
    player: { alive: true, pos: new THREE.Vector3(), damage: noop, concuss: (a) => { got = Math.max(got, a); } },
    enemies: [], hud: { grenadeWarning: noop }, diff: { damage: 1 },
  };
  const ex = createExplosives(G);
  const at = new THREE.Vector3(0, 0.05, ahead);
  if (kind === 'charge') ex.placeCharge(at, 0.01, null);
  else Object.assign(ex.throwGrenade('enemy', at, new THREE.Vector3(), 0), { fuse: 0.01, rest: true });
  ex.update(1 / 60);
  assert.equal(ex.list.length, 0, 'it should have gone off');
  return got;
}
{
  const at = [1, 3, 5, 7, 9, 12].map((d) => [d, blast(d)]);
  console.log(`grenade: ${at.map(([d, k]) => `${d} m ${k.toFixed(2)}`).join(', ')}`);
  const k = Object.fromEntries(at);
  assert.ok(k[1] > 0.99 && k[3] > 0.85, 'a grenade at his feet should daze him fully');
  assert.ok(k[7] > 0.3 && k[7] < 0.7, 'about half at 7 m');
  assert.ok(k[1] >= k[3] && k[3] > k[5] && k[5] > k[7] && k[7] > k[9], 'less the further off it went off');
  assert.equal(k[12], 0, 'not at all past 11 m');
  const walled = blast(5, { wall: true });
  console.log(`grenade 5 m behind a wall: ${walled.toFixed(2)}; a charge at 10 m ${blast(10, { kind: 'charge' }).toFixed(2)}, 18 m ${blast(18, { kind: 'charge' }).toFixed(2)}`);
  assert.ok(walled < k[5] * 0.7 && walled > 0, 'a wall between takes some of it');
  assert.ok(blast(10, { kind: 'charge' }) > 0.5 && blast(18, { kind: 'charge' }) > 0, 'a charge reaches nearly twice as far');
}

/* how it wears off: the level at each of `times` (seconds) after a blast of `amount` */
function wearing(amount, times) {
  const d = createDaze();
  d.hit(amount);
  const out = [];
  let t = 0;
  for (const want of times) {
    while (t < want - 1e-9) { d.update(1 / 60); t += 1 / 60; }
    out.push(d.level);
  }
  return out;
}
{
  const [a, b, c, e] = wearing(1, [1.5, 5, 8.5, 9.2]);
  console.log(`worn off: at its worst ${a.toFixed(2)} 1.5 s after a blast at his feet, ${b.toFixed(2)} at 5 s, ${c.toFixed(3)} at 8.5 s, ${e} at 9.2 s`);
  assert.ok(a > 0.99, 'at its worst for the first moments');
  assert.ok(b > 0.3 && b < 0.8 && c < 0.05, 'then wearing off');
  assert.equal(e, 0, 'and gone after nine seconds');
  const [f, g] = wearing(0.1, [2, 3.7]);
  console.log(`a blast that only just reached him: ${f.toFixed(3)} at 2 s, ${g} at 3.7 s`);
  assert.ok(f < 0.1 && g === 0, 'a light one is over in under four seconds');
  const d = createDaze();
  d.hit(0.8);
  for (let i = 0; i < 60; i++) d.update(1 / 60);
  d.hit(0.5);
  assert.ok(Math.abs(d.t - 1) < 1e-6 && d.level === 0.8, 'a weaker blast meanwhile changes nothing');
  d.hit(0.9);
  assert.ok(d.t === 0 && d.level === 0.9, 'a harder one starts it over');
}

/* the view swims round the aim, camera only, and is back on it once it has worn off */
{
  const camera = new THREE.PerspectiveCamera(68, 4 / 3, 0.05, 1000);
  const rig = createCameraRig(camera, { raycast: () => null, terrain: null, water: null });
  const eye = new THREE.Vector3(0, 1.6, 0);
  rig.updateFirstPerson(1 / 60, eye, null, false);
  const aim = rig.forward(new THREE.Vector3()).clone();
  const look = () => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const tilt = () => deg(Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).y));
  assert.ok(look().angleTo(aim) < 1e-6, 'clear-headed, the view is the aim');
  rig.daze = 1;
  let off = 0, roll = 0, moved = 0, rolled = 0, last = look(), lastTilt = tilt();
  for (let i = 0; i < 480; i++) {                 // eight seconds of it, from the blast
    rig.updateFirstPerson(1 / 60, eye, null, false);
    off = Math.max(off, deg(look().angleTo(aim)));
    roll = Math.max(roll, Math.abs(tilt()));
    moved = Math.max(moved, deg(look().angleTo(last)) * 60);
    rolled = Math.max(rolled, Math.abs(tilt() - lastTilt) * 60);
    last = look(); lastTilt = tilt();
  }
  console.log(`dazed: the view wanders up to ${off.toFixed(2)}° off the aim and tilts up to ${roll.toFixed(2)}°, slowly (at most ${moved.toFixed(1)}°/s, tilting ${rolled.toFixed(1)}°/s)`);
  assert.ok(off > 0.5 && off < 3, 'the view should wander a degree or two off the aim');
  assert.ok(roll > 1 && roll < 5, 'and the head loll a few degrees');
  assert.ok(moved < 6 && rolled < 8, 'slowly, from the first moment: a swim, not a jolt');
  assert.ok(rig.forward(new THREE.Vector3()).angleTo(aim) < 1e-6, 'the aim is not moved');
  rig.daze = 0;
  rig.updateFirstPerson(1 / 60, eye, null, false);
  assert.ok(look().angleTo(aim) < 1e-6 && Math.abs(tilt()) < 1e-4, 'worn off, the view is back on the aim');
}

console.log('daze-check: a blast close by dazes him by how close it was, it wears off, and the view swims round the aim while it lasts');
