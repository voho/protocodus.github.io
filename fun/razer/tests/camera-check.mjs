import assert from 'node:assert/strict';
import { createChaseCamera } from '../js/camera.js';
const flat = { heightAt: () => 0 };
const car = { x: 0, y: 0, z: 0, yaw: 0, speed: 25 };
const dotBehind = (view, c) => (view.position.x - c.x) * Math.sin(c.yaw) + (view.position.z - c.z) * Math.cos(c.yaw);
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  const c = { ...car, yaw }, camera = createChaseCamera(flat), state = camera.reset(c);
  assert.ok(dotBehind(state, c) < -20, 'camera resets behind every heading');
  assert.ok(state.position.y > 10 && state.position.y < 20);
}
const camera = createChaseCamera(flat); camera.reset(car);
const turning = { ...car, yaw: .8 };
const initial = camera.step(1 / 60, turning);
assert.ok(Math.abs(initial.yaw) < .01, 'heading change has an actual delay');
for (let i = 0; i < 15; i++) camera.step(1 / 60, turning);
assert.ok(initial.yaw > .05 && initial.yaw < .65, 'camera follows without snapping');
for (let i = 0; i < 120; i++) camera.step(1 / 60, turning);
assert.ok(Math.abs(initial.yaw - .8) < .001 && dotBehind(initial, turning) < -20);
const frozen = JSON.stringify(initial); camera.step(0, { ...turning, yaw: 1 });
assert.equal(JSON.stringify(initial), frozen, 'pause freezes the camera');
camera.reset({ ...car, yaw: Math.PI - .02 });
for (let i = 0; i < 60; i++) camera.step(1 / 60, { ...car, yaw: -Math.PI + .02 });
assert.ok(Math.abs(Math.abs(initial.yaw) - Math.PI) < .04, 'wrap uses short turn');
const hill = createChaseCamera({ heightAt: (x, z) => z < -10 ? 30 : 0 });
assert.ok(hill.reset(car).position.y > 34, 'camera clears terrain behind car');
const teleported = camera.step(1 / 60, { ...car, x: 180, yaw: Math.PI / 2 });
assert.ok(teleported.position.x < 180 && teleported.position.x > 140, 'recovery resets beside new car location');
function rateCheck(fps) {
  const cam = createChaseCamera(flat); cam.reset(car);
  for (let i = 1; i <= fps * 2; i++) cam.step(1 / fps, { ...car, yaw: Math.min(i / fps, 1) });
  return cam.step(0, car).yaw;
}
assert.ok(Math.abs(rateCheck(30) - rateCheck(120)) < .025, 'camera response independent of display refresh');
console.log('Camera checks passed: trailing direction, delayed rotation, wrap, pause, terrain clearance, recovery, refresh-rate stability.');
