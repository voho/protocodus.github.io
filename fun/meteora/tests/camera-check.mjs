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

await run();
