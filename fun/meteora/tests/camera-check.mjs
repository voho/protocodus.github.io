// Run with: node tests/camera-check.mjs
// The camera may shake, but the guns may not: the aim is read through the
// camera, so it must see it steady. And the death view must keep the wreck
// in front of it, wherever the wreck is drifting.
import { registerHooks } from 'node:module';
import { test, run, assert, near } from './harness.mjs';

const three = new URL('../../../assets/vendor/three/three.module.min.js', import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (s === 'three' ? { url: three, shortCircuit: true } : next(s, c)) });
const THREE = await import('three');
const { createChaseCamera } = await import('../js/camera.js');

const setup = () => {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 1e5);
  return { camera, chase: createChaseCamera(camera, [0, 1, -3]) };
};
const ship = { pos: new THREE.Vector3(10, 20, 30), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.5, 0.1)) };
const fly = (chase, shake) => chase.update(ship.pos, ship.q, [0, 0, 0], false, 1 / 60, shake, false);

test('steady takes the shake off again, so the aim never shakes', () => {
  const calm = setup(), shaken = setup();
  for (let k = 0; k < 30; k++) { fly(calm.chase, null); fly(shaken.chase, { rot: [0.04, -0.03, 0.02], pos: [0.5, -0.4, 0.3] }); }
  assert.ok(shaken.camera.position.distanceTo(calm.camera.position) > 0.1, 'the view does shake');
  shaken.chase.steady();
  near(shaken.camera.position.distanceTo(calm.camera.position), 0, 1e-9, 'position');
  near(shaken.camera.quaternion.angleTo(calm.camera.quaternion), 0, 1e-6, 'orientation');
  shaken.chase.steady();   // a second call changes nothing
  near(shaken.camera.position.distanceTo(calm.camera.position), 0, 1e-9);
});

test('the death view keeps the wreck ahead, whichever way it drifts', () => {
  for (const vel of [[0, 0, -200], [0, 0, 60], [120, 0, 0], [0, 0, 300]]) {
    const { camera, chase } = setup();
    fly(chase, null);   // riding behind the ship, as at the moment it dies
    const origin = [ship.pos.x, ship.pos.y, ship.pos.z], f = new THREE.Vector3(), to = new THREE.Vector3();
    for (let t = 1 / 60; t < 10; t += 1 / 60) {
      chase.watch(origin, vel, t, 1 / 60, null);
      to.set(origin[0] + vel[0] * t, origin[1] + vel[1] * t, origin[2] + vel[2] * t).sub(camera.position);
      assert.ok(to.length() > 20, `${vel}: the wreck stays clear of the camera at ${t.toFixed(2)} s (${to.length().toFixed(1)} m)`);
      if (t > 1) assert.ok(camera.getWorldDirection(f).dot(to.normalize()) > 0.95, `${vel}: still facing the wreck at ${t.toFixed(2)} s`);
    }
  }
});

test('the opening shot hands over to the chase view without a cut', () => {
  const plain = setup(), shot = setup();
  shot.chase.intro(2);
  fly(plain.chase, null); fly(shot.chase, null);
  assert.ok(shot.chase.inIntro && shot.chase.cinematic === 1);
  assert.ok(shot.camera.position.distanceTo(plain.camera.position) > 30, 'it starts well away from the chase position');
  let jump = 0, last = shot.camera.position.clone();
  for (let k = 0; k < 150; k++) {
    fly(plain.chase, null); fly(shot.chase, null);
    jump = Math.max(jump, shot.camera.position.distanceTo(last)); last.copy(shot.camera.position);
  }
  assert.ok(jump < 3, `no step jumps (largest ${jump.toFixed(2)} m)`);
  assert.equal(shot.chase.inIntro, false);
  assert.equal(shot.chase.cinematic, 0);
  near(shot.camera.position.distanceTo(plain.camera.position), 0, 1e-6, 'position');
  near(shot.camera.quaternion.angleTo(plain.camera.quaternion), 0, 1e-6, 'orientation');
});
test('reaching for the controls ends the shot within half a second; other views end it at once', () => {
  const { chase } = setup();
  chase.intro(5);
  for (let k = 0; k < 30; k++) fly(chase, null);
  chase.skipIntro();
  for (let k = 0; k < 31; k++) fly(chase, null);
  assert.equal(chase.inIntro, false);
  chase.intro(5); chase.toggle(); fly(chase, null);
  assert.equal(chase.inIntro, false, 'the cockpit view');
  chase.toggle(); chase.intro(5);
  chase.watch([0, 0, 0], [0, 0, 0], 0, 1 / 60, null);
  assert.equal(chase.inIntro, false, 'the death view');
});
test('the closing shot starts from the chase view and drifts back, the fighter in the middle', () => {
  const { camera, chase } = setup();
  for (let k = 0; k < 30; k++) fly(chase, null);
  const before = camera.position.clone(), facing = camera.quaternion.clone();
  chase.outro();
  fly(chase, null);
  assert.ok(camera.position.distanceTo(before) < 0.5 && camera.quaternion.angleTo(facing) < 0.05, 'no cut');
  for (let k = 0; k < 300; k++) fly(chase, null);
  assert.ok(camera.position.distanceTo(ship.pos) > 55, 'well back');
  const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const toShip = ship.pos.clone().sub(camera.position).normalize();
  assert.ok(ahead.dot(toShip) > 0.999, 'looking at the fighter');
  assert.equal(chase.cinematic, 1);
  chase.reset();
  assert.equal(chase.inOutro, false);
});
test('a rock in the way pulls the camera in at once; it eases back out', () => {
  const { camera, chase } = setup();
  for (let k = 0; k < 30; k++) fly(chase, null);
  const free = camera.position.distanceTo(ship.pos);
  let clear = 0.5;
  chase.setObstruction(() => clear);
  fly(chase, null);
  near(camera.position.distanceTo(ship.pos), free * 0.5, 0.3, 'in front of the rock at once');
  clear = 0.05;
  fly(chase, null);
  assert.ok(camera.position.distanceTo(ship.pos) >= 8.9, 'never inside the fighter');
  clear = 1;
  fly(chase, null);
  assert.ok(camera.position.distanceTo(ship.pos) < free * 0.6, 'no jump back out');
  for (let k = 0; k < 240; k++) fly(chase, null);
  near(camera.position.distanceTo(ship.pos), free, 0.05, 'back out in a few seconds');
});
test('a cutaway frames its shot under letterbox, then cuts straight back to the chase view', () => {
  const plain = setup(), cut = setup();
  for (let k = 0; k < 30; k++) { fly(plain.chase, null); fly(cut.chase, null); }
  const target = new THREE.Vector3(500, 40, -900);
  cut.chase.cutaway((k, eye, look) => { look.copy(target); eye.set(500 + 300 * (1 - k), 140, -900 + 400); }, 2);
  fly(plain.chase, null); fly(cut.chase, null);
  assert.ok(cut.chase.inCutaway && cut.chase.cinematic === 1);
  const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(cut.camera.quaternion);
  assert.ok(ahead.dot(target.clone().sub(cut.camera.position).normalize()) > 0.999, 'looking at the shot');
  for (let k = 0; k < 130; k++) { fly(plain.chase, null); fly(cut.chase, null); }
  assert.equal(cut.chase.inCutaway, false);
  assert.equal(cut.chase.cinematic, 0);
  near(cut.camera.position.distanceTo(plain.camera.position), 0, 1e-6, 'back at the chase position');
  near(cut.camera.quaternion.angleTo(plain.camera.quaternion), 0, 1e-6, 'and its orientation');
});
test('a cutaway can be cut short, straight back to the chase view', () => {
  const plain = setup(), cut = setup();
  for (let k = 0; k < 30; k++) { fly(plain.chase, null); fly(cut.chase, null); }
  cut.chase.cutaway((k, eye, look) => { eye.set(0, 300, 0); look.set(0, 0, 0); }, 4);
  for (let k = 0; k < 40; k++) { fly(plain.chase, null); fly(cut.chase, null); }
  assert.ok(cut.chase.cutawayAge > 0.6);
  cut.chase.skipCutaway();
  fly(plain.chase, null); fly(cut.chase, null);
  assert.equal(cut.chase.inCutaway, false);
  near(cut.camera.position.distanceTo(plain.camera.position), 0, 1e-6);
});
test('the closing shot or a death ends a cutaway', () => {
  const { chase } = setup();
  chase.cutaway((k, eye, look) => { eye.set(0, 0, 100); look.set(0, 0, 0); }, 5);
  fly(chase, null);
  chase.outro();
  assert.equal(chase.inCutaway, false);
  chase.reset();
  chase.cutaway((k, eye, look) => { eye.set(0, 0, 100); look.set(0, 0, 0); }, 5);
  chase.watch([0, 0, 0], [0, 0, 0], 0, 1 / 60, null);
  assert.equal(chase.inCutaway, false);
  assert.equal(chase.cinematic, 0);
});
await run();
