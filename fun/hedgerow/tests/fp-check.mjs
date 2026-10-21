// Run with: node fun/hedgerow/tests/fp-check.mjs
// First person, on the real rig and rifles. While he walks and runs, the
// rifle must sit steady in front of the eyes: the gait's bob and twist are
// steadied out of the upper body (character.js `steady`), so the muzzle
// barely moves in a view that keeps its direction (the mouse's) with the eye
// smoothed as player.js smooths it. And aiming must line the sights up with
// the view: turning the body and bending the spine as player.js does brings
// the front sight onto the middle of the screen.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const THREE = await import('three');
const { GLTFLoader } = await import('../assets/vendor/GLTFLoader.js');
const { createCharacter } = await import('../js/character.js');
const { readSet } = await import('../js/assets.js');
const { WEAPONS } = await import('../js/config.js');

const here = new URL('..', import.meta.url).pathname;

/* a GLB without its pictures (nothing here decodes WebP) */
function parse(name) {
  const b = readFileSync(`${here}assets/models/${name}.glb`);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials || []) {
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    j[k] = (j[k] || []).filter((e) => e !== 'EXT_texture_webp');
    if (!j[k].length) delete j[k];
  }
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = b.subarray(20 + jl);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([head, json, bin]);
  return new Promise((res, rej) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '', res, rej));
}

const soldier = await parse('soldier');
const models = new Map();
readSet(await parse('weapons'), 'weapons', models);
const matlib = { get: () => new THREE.MeshBasicMaterial(), resolve: (m) => m || new THREE.MeshBasicMaterial() };
const deg = (r) => (r * 180) / Math.PI;

/* The muzzle's place in the view (degrees off the middle) through a gait,
   the eye smoothed from the head bone, the view straight ahead. */
function sway(move, upper, speed, steady) {
  const ch = createCharacter(soldier, matlib, { outfit: 'allied', weaponModel: models.get('m1_garand'), scene: new THREE.Scene() });
  ch.steady = steady;
  ch.hideHead(true);
  ch.animate(move, upper, 1);
  const dt = 1 / 60, eye = new THREE.Vector3(), off = new THREE.Vector3(), m = new THREE.Vector3();
  let first = true;
  const xs = [], ys = [];
  for (let i = 0; i < 240; i++) {
    ch.root.position.z += speed * dt;
    ch.update(dt, 0);
    ch.headWorld(eye).add(new THREE.Vector3(0, 0.125, 0.05)).sub(ch.root.position);
    if (first) { off.copy(eye); first = false; } else off.lerp(eye, 1 - Math.exp(-22 * dt));
    eye.copy(ch.root.position).add(off);
    ch.muzzleWorld(m).sub(eye);
    if (i >= 60) { xs.push(deg(Math.atan2(m.x, m.z))); ys.push(deg(Math.atan2(m.y, m.z))); }
  }
  const span = (a) => Math.max(...a) - Math.min(...a);
  return { x: span(xs), y: span(ys) };
}

// walking with the rifle shouldered, sprinting with it lowered (as player.js has it);
// standing still the rifle only breathes with him (each upper clip's own sway)
for (const [move, upper, speed, stand] of [['walk', 'aim', 1.31, 'idle'], ['run', 'idle', 3.6, 'idle'], ['crouch_walk', 'crouch_aim', 0.83, 'crouch_idle']]) {
  const still = sway(stand, upper, 0, true);
  console.log(`standing (${upper}): muzzle moves ${still.x.toFixed(2)}° × ${still.y.toFixed(2)}°`);
  const loose = sway(move, upper, speed, false), steady = sway(move, upper, speed, true);
  console.log(`${move}: muzzle moves ${loose.x.toFixed(2)}° × ${loose.y.toFixed(2)}° loose, ${steady.x.toFixed(2)}° × ${steady.y.toFixed(2)}° steadied`);
  assert.ok(steady.x < still.x + 0.8 && steady.y < still.y + 0.8, `${move}: the rifle should sit nearly as steady as standing (moves ${steady.x.toFixed(2)}° × ${steady.y.toFixed(2)}°)`);
  assert.ok(steady.x + steady.y < (loose.x + loose.y) * 0.4, `${move}: steadying should take out most of the sway`);
}

/* Down the sights: turn the body and bend the spine until the sight line
   runs along the view, then look from behind the rear sight. */
for (const id of ['garand', 'thompson']) {
  const w = WEAPONS[id];
  const ch = createCharacter(soldier, matlib, { outfit: 'allied', weaponModel: models.get(w.model), scene: new THREE.Scene() });
  ch.steady = true;
  ch.animate('idle', 'aim', 1);
  const view = { yaw: 0.3, pitch: -0.1 };
  const vDir = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch));
  let yawFix = 0, pitchFix = 0;
  const rear = new THREE.Vector3(), front = new THREE.Vector3(), sDir = new THREE.Vector3();
  for (let i = 0; i < 90; i++) {
    ch.root.rotation.y = view.yaw + yawFix;
    ch.aimPitch = view.pitch + pitchFix;
    ch.update(1 / 60, 0);
    ch.weapon.localToWorld(rear.fromArray(w.sight.rear));
    ch.weapon.localToWorld(front.fromArray(w.sight.front));
    sDir.subVectors(front, rear).normalize();
    const g = 1 - Math.exp(-14 / 60);
    yawFix += Math.atan2(Math.sin(Math.atan2(vDir.x, vDir.z) - Math.atan2(sDir.x, sDir.z)), Math.cos(Math.atan2(vDir.x, vDir.z) - Math.atan2(sDir.x, sDir.z))) * g;
    pitchFix += (Math.asin(vDir.y) - Math.asin(sDir.y)) * g;
  }
  const eye = rear.clone().addScaledVector(sDir, -w.sight.relief);
  const toFront = front.clone().sub(eye).normalize();
  const off = deg(toFront.angleTo(vDir));
  console.log(`${id}: front sight ${off.toFixed(3)}° off the middle (body turned ${deg(yawFix).toFixed(1)}°, spine ${deg(pitchFix).toFixed(1)}°)`);
  assert.ok(off < 0.25, `${id}: the front sight should sit in the middle of the view (${off.toFixed(3)}° off)`);
  assert.ok(Math.abs(yawFix) < 0.6 && Math.abs(pitchFix) < 0.6, `${id}: the correction should stay small`);
}

console.log('fp-check: the rifle sits steady on the march, and the sights line up when aiming');
