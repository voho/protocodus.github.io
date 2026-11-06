import assert from 'node:assert/strict';
import { gameDeviceSupport } from '../js/device-support.js';
const pc = { width: 960, height: 600, screenWidth: 1920, screenHeight: 1080, userAgent: 'Desktop Chrome', touchPoints: 0 };
assert.equal(gameDeviceSupport(pc).supported, true);
assert.equal(gameDeviceSupport({ ...pc, width: 767 }).reason, 'window');
assert.equal(gameDeviceSupport({ ...pc, height: 539 }).reason, 'window');
for (const [width, height] of [[768, 1024], [1024, 768], [1280, 800]]) {
  assert.equal(gameDeviceSupport({ width, height, screenWidth: width, screenHeight: height,
    coarsePointer: true, touchPoints: 5, userAgent: 'Android Tablet' }).supported, true, 'tablets retain desktop controls');
}
for (const [width, height] of [[390, 844], [844, 390]]) {
  assert.equal(gameDeviceSupport({ width, height, coarsePointer: true, touchPoints: 5 }).reason, 'phone');
}
assert.equal(gameDeviceSupport({ ...pc, mobileHint: true }).reason, 'phone', 'phone desktop-mode viewports are rejected');
assert.equal(gameDeviceSupport({ ...pc, userAgent: 'iPhone', coarsePointer: false }).reason, 'phone', 'attaching a mouse does not enable a phone');
assert.equal(gameDeviceSupport({ ...pc, userAgent: 'Android Mobile', coarsePointer: false }).reason, 'phone');
assert.equal(gameDeviceSupport({ ...pc, width: 400, screenWidth: 1920 }).reason, 'window', 'a narrow PC window can be enlarged');
assert.equal(gameDeviceSupport().reason, 'window');
console.log('device-support-check: PCs/tablets accepted, phones rejected in either orientation, small PC windows can retry');
