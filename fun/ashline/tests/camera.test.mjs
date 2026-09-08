import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomLevels, nearestZoom, steppedZoom, cameraDirection } from '../camera.js';

test('five fixed zoom levels stop at native resolution and snap older saves', () => {
  for (const native of [28, 51.7, 64]) {
    const levels = zoomLevels(native); assert.equal(new Set(levels).size, 5);
    assert.equal(levels.at(-1), native); assert.equal(levels[0], native / 2);
    let zoom = levels[0]; const seen = new Set([zoom]);
    for (let i = 0; i < 20; i++) { zoom = steppedZoom(zoom, 1, levels); seen.add(zoom); }
    assert.equal(seen.size, 5); assert.equal(zoom, native);
    for (let i = 0; i < 20; i++) zoom = steppedZoom(zoom, -1, levels);
    assert.equal(zoom, levels[0]); assert(levels.includes(nearestZoom(38, levels)));
  }
});

test('WASD, arrows and all eight edges pan at bounded equal diagonal speed', () => {
  const direction = (keys, p) => cameraDirection(new Set(keys), p, 1000, 700);
  assert.deepEqual(direction(['w','d']), direction(['arrowup','arrowright']));
  assert.deepEqual(direction(['w','s','a','d']), {x:0,y:0});
  for (const [x,y,sx,sy] of [[0,350,-1,0],[1000,350,1,0],[500,0,0,-1],[500,700,0,1],[0,0,-1,-1],[1000,0,1,-1],[0,700,-1,1],[1000,700,1,1]]) {
    const d = direction([], {x,y}); assert.equal(Math.sign(d.x),sx); assert.equal(Math.sign(d.y),sy);
    assert(Math.abs(Math.hypot(d.x,d.y)-1)<1e-9);
  }
  assert.deepEqual(direction([], {x:500,y:350}), {x:0,y:0});
  assert(Math.hypot(...Object.values(direction(['d'], {x:999,y:350}))) <= 1);
});
