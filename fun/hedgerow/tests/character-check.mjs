// Run with: node fun/hedgerow/tests/character-check.mjs
// The aim pitch on the spine must not accumulate. three's AnimationMixer
// only writes a bone when the animated value changed since the previous
// frame, so a held pose (aim) leaves last frame's bone rotation in place: a
// pitch applied on top of it every frame would turn the upper body round and
// round. The spine must hold the clip's pose plus exactly one aim pitch.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createCharacter } = await import('../js/character.js');

// a small rig: root > hips > spine > chest > neck > head, hand_r with the socket
function bone(name, parent, y) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.y = y;
  if (parent) parent.add(b);
  return b;
}
const scene = new THREE.Group();
scene.name = 'rig';
const root = bone('root', null, 0);
scene.add(root);
const hips = bone('hips', root, 1.0);
const spine = bone('spine', hips, 0.15);
const chest = bone('chest', spine, 0.2);
const neck = bone('neck', chest, 0.25);
bone('head', neck, 0.1);
const hand = bone('hand_r', chest, 0.1);
const socket = new THREE.Object3D();
socket.name = 'socket_weapon';
hand.add(socket);
const handL = bone('hand_l', chest, 0.1);
const socketL = new THREE.Object3D();
socketL.name = 'socket_weapon_l';
handL.add(socketL);

// held poses: the same key at the start and the end, as a steady aim is
const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, 0)).toArray();
const held = (name) => new THREE.AnimationClip(name, 1, ['root', 'hips', 'spine', 'chest'].map(
  (b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, [0, 1], [...q, ...q])));
const reloadClip = new THREE.AnimationClip('reload', 1.6, [new THREE.QuaternionKeyframeTrack('spine.quaternion', [0, 1.6], [...q, ...q])]);
const gltf = { scene, animations: [held('idle'), held('aim'), reloadClip] };
const matlib = { get: () => new THREE.MeshBasicMaterial(), resolve: (m) => m };

function spineAfter(frames, pitch) {
  const ch = createCharacter(gltf, matlib, { outfit: 'allied', scene: new THREE.Scene() });
  ch.animate('idle', 'aim', 1);
  ch.aimPitch = pitch;
  const out = [];
  for (let i = 0; i < frames; i++) {
    ch.update(1 / 60, 0);
    out.push(ch.bones.spine.quaternion.clone());
  }
  return out;
}

// angles between normalised quaternions (the mixer writes float32 values,
// so raw angleTo reads ~0.03° of rounding noise between identical poses)
const angle = (a, b) => a.clone().normalize().angleTo(b.clone().normalize());
const steady = spineAfter(120, 0.3);
const drift = angle(steady[20], steady[119]);
assert.ok(drift < 1e-4, `the spine keeps turning under a held pose: ${(drift * 180 / Math.PI).toFixed(2)}° between frames 20 and 119`);

// and the pitch is really there, once: the angle to the unpitched pose is the pitch
const plain = spineAfter(30, 0);
const applied = angle(steady[29], plain[29]);
assert.ok(Math.abs(applied - 0.3) < 1e-3, `aim pitch applied ${applied.toFixed(4)} rad, expected 0.3`);

// changing the pitch moves it to the new value, not by the new value again
const ch = createCharacter(gltf, matlib, { outfit: 'allied', scene: new THREE.Scene() });
ch.animate('idle', 'aim', 1);
ch.aimPitch = 0.3;
for (let i = 0; i < 30; i++) ch.update(1 / 60, 0);
ch.aimPitch = -0.2;
for (let i = 0; i < 30; i++) ch.update(1 / 60, 0);
const lowered = angle(ch.bones.spine.quaternion, plain[29]);
assert.ok(Math.abs(lowered - 0.2) < 1e-3, `after re-aiming the pitch is ${lowered.toFixed(4)} rad, expected 0.2`);

// reload: the clip plays its length scaled to the weapon's reload time, a
// magazine shows in the left hand while it runs and is gone when it ends
{
  const c = createCharacter(gltf, matlib, { outfit: 'allied', scene: new THREE.Scene() });
  c.animate('idle', 'aim', 1);
  assert.equal(c.clipLength('reload'), 1.6);
  assert.ok(c.hasClip('reload') && !c.hasClip('reload_smg'));
  const dur = c.oneShot('reload', 1.6 / 2.2);
  assert.ok(Math.abs(dur - 2.2) < 1e-6, `reload lasts ${dur} s, expected 2.2`);
  assert.equal(c.upper, 'reload');
  c.holdLeft(new THREE.Object3D());
  assert.equal(c.socketL.children.length, 1, 'the magazine is in the left hand');
  for (let i = 0; i < 140; i++) c.update(1 / 60, 0);
  assert.equal(c.socketL.children.length, 0, 'the hand is empty after the reload');
  assert.notEqual(c.upper, 'reload', 'back to the aim/idle pose after the reload');
}

// the reload sequencer: an SMG's seated magazine goes to the hand, drops,
// a fresh one comes and is seated (event frames from the rig)
{
  const { startReload } = await import('../js/reload.js');
  const c = createCharacter(gltf, matlib, { outfit: 'allied', scene: new THREE.Scene() });
  const gun = new THREE.Group();
  const seated = new THREE.Object3D(); seated.name = 'thompson_mag_seated'; gun.add(seated);
  socket.children.length = 0;
  c.socket?.add?.(gun);
  Object.defineProperty(c, 'weapon', { get: () => gun });
  const dropped = [];
  const G = {
    soldier: null, models: new Map(), matlib: { get: () => new THREE.MeshBasicMaterial() },
    debris: { drop: (o) => { o.parent?.remove(o); dropped.push(o); } }, audio: {},
  };
  const run = startReload(G, c, { prop: 'thompson_mag', drops: true, seated: 'thompson_mag_seated' }, 'reload_smg');
  run.update(0.13);
  assert.ok(!seated.visible && c.socketL.children.length === 1, 'grabbed: the seated magazine is in the hand');
  run.update(0.33);
  assert.equal(dropped.length, 1, 'the old magazine is dropped');
  assert.equal(c.socketL.children.length, 0, 'the hand is empty after the drop');
  run.update(0.5);
  assert.equal(c.socketL.children.length, 1, 'a fresh magazine in the hand');
  run.update(0.7);
  assert.ok(seated.visible && c.socketL.children.length === 0, 'seated: the gun has its magazine back, the hand is free');
  run.end();
}

// faces: the outfit mesh's shape keys are blended per soldier, each clone
// with its own weights; no face leaves the base head
{
  const { randomFace } = await import('../js/character.js');
  const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
  const keys = ['face_broad', 'face_gaunt', 'face_older'];
  geo.morphAttributes.position = keys.map(() => geo.attributes.position.clone());
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = 'allied';
  mesh.updateMorphTargets();
  keys.forEach((k, i) => { mesh.morphTargetDictionary[k] = i; });
  const rig = new THREE.Group();
  rig.add(scene.clone(), mesh);
  const skel = new THREE.Skeleton([]);
  mesh.bind(skel);
  const faced = { ...gltf, scene: rig };
  const a = createCharacter(faced, matlib, { outfit: 'allied', scene: new THREE.Scene(), face: { face_broad: 0.8, face_older: 0.3 } });
  const b = createCharacter(faced, matlib, { outfit: 'allied', scene: new THREE.Scene(), face: { face_gaunt: 0.6 } });
  const c = createCharacter(faced, matlib, { outfit: 'allied', scene: new THREE.Scene() });
  const w = (ch) => ch.meshes.find((m) => m.morphTargetInfluences).morphTargetInfluences.map((v) => +v.toFixed(3));
  assert.deepEqual(w(a), [0.8, 0, 0.3], 'the first soldier has his face');
  assert.deepEqual(w(b), [0, 0.6, 0], 'the second soldier has his own');
  assert.deepEqual(w(c), [0, 0, 0], 'no face: the base head');
  let r = 0.37;
  const R = () => (r = (r * 9301 + 49297) % 233280 / 233280);
  for (let i = 0; i < 200; i++) {
    const f = randomFace(R);
    assert.ok(f.face_broad * f.face_gaunt === 0 && f.face_broad <= 1 && f.face_gaunt <= 1 && f.face_older <= 0.9, 'a face is either broad or gaunt, within range');
  }
}

console.log('character-check: the aim pitch holds steady; reload plays, clears the hand, swaps the magazine; faces blend per soldier');
