// Run with: node fun/hedgerow/tests/fp-check.mjs
// First person, on the real rig and rifles. While he walks and runs, the
// rifle must sit steady in front of the eyes: the gait's bob and twist are
// steadied out of the upper body (character.js `steady`), so the muzzle
// barely moves in a view that keeps its direction (the mouse's) with the eye
// smoothed as player.js smooths it. Aiming must line the sights up with the
// view: turning the body and bending the spine as player.js does brings the
// front sight onto the middle of the screen. And what the eye sees must make
// sense: the fresh clip or magazine seats in the picture (reload.js
// startFirstPersonReload), the rifle is carried in the picture at a sprint
// and goes out of it while changing weapons. His shadow keeps its head: the
// head folded away from the eyes has a stand-in that casts it.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const THREE = await import('three');
const { GLTFLoader } = await import('../assets/vendor/GLTFLoader.js');
const { createCharacter } = await import('../js/character.js');
const { readSet } = await import('../js/assets.js');
const { WEAPONS } = await import('../js/config.js');
const { startFirstPersonReload } = await import('../js/reload.js');
const { createViewMotion } = await import('../js/viewmotion.js');
const { createCameraRig } = await import('../js/camera.js');

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

/* Seen from the eye (hip, as player.js places it), in degrees: down and right of the
   middle; in the picture within 34° up/down and 42° aside (68° view, 4:3). */
function eyeOf(ch) { return ch.headWorld(new THREE.Vector3()).add(new THREE.Vector3(0.055, 0.125, 0.05)); }
function seen(eye, p) {
  const d = p.clone().sub(eye);
  return { down: deg(Math.atan2(-d.y, d.z)), right: deg(Math.atan2(-d.x, d.z)) };
}
const inPicture = (a) => Math.abs(a.down) < 34 && Math.abs(a.right) < 42;
function posed(id, arms = null) {
  const w = WEAPONS[id];
  const ch = createCharacter(soldier, matlib, { outfit: 'allied', weaponModel: models.get(w.model), scene: new THREE.Scene() });
  ch.steady = true; ch.hideHead(true); ch.animate('idle', 'aim', 1);
  if (arms) { ch.armsPitch = arms.pitch; ch.armsYaw = arms.yaw; ch.armsRoll = arms.roll; }
  for (let i = 0; i < 30; i++) ch.update(1 / 60, 0);
  return ch;
}
for (const id of ['garand', 'thompson']) {
  const w = WEAPONS[id];
  const ch = posed(id);
  const G = { models, matlib, debris: { drop(o) { o.parent?.remove(o); } } };   // the empty falls away
  const run = startFirstPersonReload(G, ch, w);
  const before = new Set(ch.weapon.children);
  run.update(0.2);
  const t = 0.3, pose = run.pose(t);
  ch.armsPitch = pose.pitch; ch.armsYaw = pose.yaw; ch.armsRoll = pose.roll;
  run.update(t);
  ch.update(1 / 60, 0);
  const fresh = ch.weapon.children.find((c) => !before.has(c));
  assert.ok(fresh, `${id}: a fresh ${w.prop} should be on the gun while it seats`);
  const at = seen(eyeOf(ch), fresh.getWorldPosition(new THREE.Vector3()));
  console.log(`${id} reload: the fresh ${w.prop} seats ${at.down.toFixed(0)}° down, ${at.right.toFixed(0)}° right`);
  assert.ok(inPicture(at), `${id}: the reload should happen in the picture`);
  run.update(0.5);
  assert.ok(!fresh.parent, `${id}: the fresh ${w.prop} is seated (gone into the gun) by half way`);
  run.end();
}
{
  const ch = posed('garand', { pitch: -0.15, yaw: -0.1, roll: -0.45 });   // player.js: at a sprint
  const eye = eyeOf(ch), m = seen(eye, ch.muzzleWorld()), mid = seen(eye, ch.weapon.localToWorld(new THREE.Vector3(0, 0.05, 0.2)));
  console.log(`sprint: muzzle ${m.down.toFixed(0)}° down ${m.right.toFixed(0)}° right, receiver ${mid.down.toFixed(0)}° down ${mid.right.toFixed(0)}° right`);
  assert.ok(inPicture(m) && inPicture(mid), 'the rifle should be carried in the picture at a sprint');
  const away = posed('garand', { pitch: -0.8, yaw: 0, roll: 0 });          // changing weapons
  const a = seen(eyeOf(away), away.muzzleWorld()), b = seen(eyeOf(away), away.weapon.localToWorld(new THREE.Vector3(0, 0.05, 0.2)));
  assert.ok(!inPicture(a) && !inPicture(b), 'changing weapons, the rifle should go down out of the picture');
}

/* The springs on top (viewmotion.js): the rifle lags a quick turn and swings
   back, a fifth as much down the sights; a shot kicks it up and it settles
   with a slight overshoot; a landing dips the eye and it comes back. */
{
  const turn = (aimT) => {
    const m = createViewMotion();
    let yaw = 0, most = 0, out;
    m.update(1 / 60, yaw, 0, aimT);
    for (let i = 0; i < 18; i++) { yaw -= 3 / 60; out = m.update(1 / 60, yaw, 0, aimT); most = Math.max(most, out.yaw); }  // turning right
    for (let i = 0; i < 36; i++) out = m.update(1 / 60, yaw, 0, aimT);
    return { most: deg(most), after: deg(Math.abs(out.yaw)) };
  };
  const hip = turn(0), ads = turn(1);
  console.log(`sway: a quick turn lags the rifle ${hip.most.toFixed(2)}° (${ads.most.toFixed(2)}° down the sights), ${hip.after.toFixed(3)}° left 0.6 s after`);
  assert.ok(hip.most > 1 && hip.most < 3.2, 'the rifle should lag a quick turn by a degree or two (to its left, turning right)');
  assert.ok(hip.after < 0.1, 'and swing back once the turn stops');
  assert.ok(ads.most < hip.most * 0.3, 'down the sights it lags much less');

  const m = createViewMotion();
  m.update(1 / 60, 0, 0, 0);
  m.kick(WEAPONS.garand.kick);
  let peak = 0, peakAt = 0, under = 0, out;
  for (let i = 1; i <= 30; i++) {
    out = m.update(1 / 60, 0, 0, 0);
    if (out.pitch > peak) { peak = out.pitch; peakAt = i / 60; }
    under = Math.min(under, out.pitch);
  }
  console.log(`kick: a Garand shot throws the muzzle up ${deg(peak).toFixed(2)}° (at ${(peakAt * 1000).toFixed(0)} ms), overshoots ${deg(-under).toFixed(2)}°, ${deg(Math.abs(out.pitch)).toFixed(3)}° left after 0.5 s`);
  assert.ok(deg(peak) > 2 && deg(peak) < 4 && peakAt < 0.12, 'a rifle shot should kick the muzzle up 2-4 degrees, quickly');
  assert.ok(deg(-under) < 0.6 && deg(Math.abs(out.pitch)) < 0.2, 'and settle with a slight overshoot');

  const l = createViewMotion();
  l.update(1 / 60, 0, 0, 0);
  l.land(8);
  let low = 0;
  for (let i = 1; i <= 30; i++) { out = l.update(1 / 60, 0, 0, 0); low = Math.min(low, out.drop); }
  console.log(`landing: the eye dips ${(-low * 100).toFixed(1)} cm, ${(-out.drop * 100).toFixed(2)} cm left after 0.5 s`);
  assert.ok(-low > 0.02 && -low < 0.045 && -out.drop < 0.003, 'a hard landing dips the eye a few centimetres and it comes back');
}

/* A hit flinches the head (camera only): away from the side it came from, a
   couple of degrees, back within a quarter of a second; the aim is left alone. */
{
  const camera = new THREE.PerspectiveCamera(68, 4 / 3, 0.05, 1000);
  const rig = createCameraRig(camera, { raycast: () => null, terrain: null, water: null });
  const eye = new THREE.Vector3(0, 1.6, 0);
  rig.updateFirstPerson(1 / 60, eye, null, false);
  const aim = rig.forward(new THREE.Vector3()).clone();
  rig.flinch(1, 1);                       // a bullet from his left
  let peak = 0, peakPitch = 0, at = 0;
  for (let i = 1; i <= 30; i++) {
    rig.updateFirstPerson(1 / 60, eye, null, false);
    if (Math.abs(rig.flinchRoll) > Math.abs(peak)) { peak = rig.flinchRoll; at = i / 60; }
    peakPitch = Math.max(peakPitch, rig.flinchPitch);
  }
  console.log(`flinch: a hit from the left rolls the view ${deg(peak).toFixed(2)}° (at ${(at * 1000).toFixed(0)} ms) and lifts it ${deg(peakPitch).toFixed(2)}°, ${deg(Math.abs(rig.flinchRoll)).toFixed(3)}° left after 0.5 s`);
  assert.ok(peak < 0 && deg(-peak) > 1.5 && deg(-peak) < 4 && at < 0.15, 'the head should snap a couple of degrees away from the hit');
  assert.ok(deg(Math.abs(rig.flinchRoll)) < 0.1 && deg(Math.abs(rig.flinchPitch)) < 0.1, 'and come back');
  assert.ok(rig.forward(new THREE.Vector3()).angleTo(aim) < 1e-6, 'the aim is not moved');
}

/* The head bob keeps time with the feet: lowest as each foot comes down
   (whole steps, when the footstep sounds), highest between, swaying to
   alternate sides on alternate steps. */
{
  const camera = new THREE.PerspectiveCamera(68, 4 / 3, 0.05, 1000);
  const rig = createCameraRig(camera, { raycast: () => null, terrain: null, water: null });
  const eye = new THREE.Vector3(0, 1.6, 0);
  const at = (steps) => { rig.updateFirstPerson(1 / 60, eye, null, false, { moveSpeed: 2.7, steps }); return camera.position.clone(); };
  const foot = [0, 1, 2].map(at), mid = [0.5, 1.5].map(at);
  const lowest = Math.max(...foot.map((p) => p.y)), highest = Math.min(...mid.map((p) => p.y));
  console.log(`bob: the eye is ${((highest - lowest) * 1000).toFixed(1)} mm lower at each footfall than between, swaying ${(mid[0].x * 1000).toFixed(1)} and ${(mid[1].x * 1000).toFixed(1)} mm`);
  assert.ok(lowest < highest - 0.005, 'the head is lowest as each foot comes down');
  assert.ok(Math.sign(mid[0].x) === -Math.sign(mid[1].x) && Math.abs(mid[0].x) > 0.001, 'and sways to alternate sides');
}

/* Dying in first person: for a moment the eyes go down with the body,
   moving and turning as the head does, then the camera leaves for the man
   who did it. */
{
  const camera = new THREE.PerspectiveCamera(68, 4 / 3, 0.05, 1000);
  const rig = createCameraRig(camera, { raycast: () => null, terrain: null, water: null });
  rig.updateFirstPerson(1 / 60, new THREE.Vector3(0, 1.6, 0), null, false);
  const head = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const killer = new THREE.Vector3(0, 1.6, 30);
  const body = new THREE.Vector3();
  rig.resetDeathCam();
  let off = 0, drift = 0, q0 = null, turned = 0, tip0 = 0;
  for (let i = 1; i <= 60; i++) {              // a second: he falls back and the head tips over
    const t = i / 60, tip = -1.2 * Math.min(1, t * 1.5);
    head.pos.set(0, 1.5 - 1.3 * Math.min(1, t * t * 2), -0.05 - 0.4 * t);
    head.quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tip);
    rig.deathCam(1 / 60, body, killer, head);
    if (i === 1) { off = camera.position.distanceTo(head.pos); q0 = camera.quaternion.clone(); tip0 = tip; }
    drift = Math.max(drift, Math.abs(camera.position.distanceTo(head.pos) - off));
    turned = camera.quaternion.angleTo(q0);
  }
  console.log(`death: the eyes ride the falling head (${(drift * 1000).toFixed(3)} mm off), turning ${deg(turned).toFixed(1)}° with it`);
  assert.ok(drift < 1e-4, 'the camera should keep its place on the falling head');
  assert.ok(Math.abs(turned - Math.abs(-1.2 - tip0)) < 0.01, 'and turn as the head turns');
  const before = camera.position.distanceTo(killer);
  for (let i = 0; i < 150; i++) rig.deathCam(1 / 60, body, killer, head);
  console.log(`death: then the camera leaves for the killer (${before.toFixed(1)} m off, then ${camera.position.distanceTo(killer).toFixed(1)} m)`);
  assert.ok(camera.position.distanceTo(killer) < before - 5, 'then it should go to the man who did it');
}

/* His shadow keeps its head: in first person the head is folded away from
   the eyes (its bone shrunk to nothing), and a stand-in of the head and
   helmet, drawing nothing in the view, sits where the full-size head would
   be and casts with the body. */
{
  const make = (hide) => {
    const ch = createCharacter(soldier, matlib, { outfit: 'allied', weaponModel: models.get('m1_garand'), scene: new THREE.Scene() });
    ch.steady = true; ch.hideHead(hide); ch.animate('walk', 'aim', 1);
    for (let i = 0; i < 40; i++) { ch.root.position.z += 1.31 / 60; ch.update(1 / 60, 0); }
    ch.root.updateMatrixWorld(true);
    return ch;
  };
  const fp = make(true), shown = make(false);
  const stand = fp.meshes.find((m) => m.name === 'head_shadow');
  assert.ok(stand && stand.visible, 'first person: the folded head should have a stand-in for its shadow');
  assert.ok(!stand.material.colorWrite && !stand.material.depthWrite, 'that draws nothing in the view');
  assert.ok(!shown.meshes.some((m) => m.name === 'head_shadow'), 'a soldier whose head shows needs none');
  // the head and helmet's vertices, skinned, on each soldier
  const headBox = (ch) => {
    const skin = ch.meshes.find((m) => m.isSkinnedMesh && !/_lod$/.test(m.name));
    const hi = skin.skeleton.bones.indexOf(ch.bones.head);
    const { skinIndex: si, skinWeight: sw, position } = skin.geometry.attributes;
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k);
      if (w > 0.5) box.expandByPoint(skin.getVertexPosition(i, v).applyMatrix4(skin.matrixWorld));
    }
    return box;
  };
  const real = headBox(shown), folded = headBox(fp);
  const standBox = new THREE.Box3(), v = new THREE.Vector3(), sp = stand.geometry.attributes.position;
  for (let i = 0; i < sp.count; i++) standBox.expandByPoint(v.fromBufferAttribute(sp, i).applyMatrix4(stand.matrixWorld));
  const size = real.getSize(new THREE.Vector3()), at = real.getCenter(new THREE.Vector3());
  const off = at.distanceTo(standBox.getCenter(new THREE.Vector3())), grown = size.distanceTo(standBox.getSize(new THREE.Vector3()));
  const fsize = folded.getSize(new THREE.Vector3());
  console.log(`head shadow: the stand-in for the ${(size.x * 100).toFixed(0)} × ${(size.y * 100).toFixed(0)} × ${(size.z * 100).toFixed(0)} cm head and helmet sits ${(off * 1000).toFixed(1)} mm from it, its size within ${(grown * 1000).toFixed(1)} mm; folded away, the head is ${(fsize.x * 100).toFixed(1)} × ${(fsize.y * 100).toFixed(1)} × ${(fsize.z * 100).toFixed(1)} cm`);
  assert.ok(size.y > 0.15 && off < 0.01 && grown < 0.01, 'the stand-in should sit where the full-size head is, as big as it');
  assert.ok(Math.max(fsize.x, fsize.y, fsize.z) < Math.max(size.x, size.y, size.z) * 0.5, 'while the head itself is folded out of the way of the eyes');
  fp.hideHead(false);
  assert.ok(!stand.visible, 'with the head shown again (the death camera), the stand-in goes');
}

console.log('fp-check: the rifle sits steady on the march, the sights line up when aiming, reloads and the sprint are in the picture, sway, kick, landing, a flinch, the head bob and the fall feel right, and his shadow keeps its head');
