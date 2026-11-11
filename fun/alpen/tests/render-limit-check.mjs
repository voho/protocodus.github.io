import assert from 'node:assert/strict';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createRetro } from '../js/retro.js';
import { RENDER } from '../js/config.js';

globalThis.window = { devicePixelRatio: 2, matchMedia: () => ({ matches: false }) };
function sample(cssW, cssH, texture = 4096, renderbuffer = texture, viewport = [texture, texture]) {
  const capW = Math.min(texture, renderbuffer, viewport[0]);
  const capH = Math.min(texture, renderbuffer, viewport[1]);
  let submitted = 0;
  const gl = {
    MAX_RENDERBUFFER_SIZE: 'buffer', MAX_VIEWPORT_DIMS: 'viewport',
    getParameter: key => key === 'buffer' ? renderbuffer : key === 'viewport' ? viewport : null,
  };
  const renderer = {
    autoClear: true, info: {}, capabilities: { isWebGL2: false, maxTextureSize: texture },
    getContext: () => gl, setPixelRatio() {},
    setSize(w, h) { assert(w <= capW && h <= capH, 'drawing buffer fits device dimensions'); },
    setRenderTarget(target) {
      if (target) { submitted++; assert(target.width <= capW && target.height <= capH, 'all post targets fit device dimensions'); }
    },
    getRenderTarget: () => null, clear() {}, render() {},
  };
  const post = createRetro(THREE, renderer);
  const size = post.setSize(cssW, cssH);
  post.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert(submitted > 0);
  assert(Math.abs(size.displayWidth / cssW - size.displayHeight / cssH) <= 1 / Math.min(cssW, cssH), 'uniform aspect with rounding');
  assert(size.width <= size.displayWidth && size.height <= size.displayHeight);
  return size;
}
let size = sample(2560, 1080);
assert.deepEqual([size.displayWidth, size.displayHeight], [4096, 1728]);
size = sample(12000, 6000, 2048);
assert.deepEqual([size.displayWidth, size.displayHeight], [2048, 1024]);
assert(size.dpr < .5, 'device limits override the normal quality floor');
size = sample(1080, 2560, 2048);
assert.deepEqual([size.displayWidth, size.displayHeight], [864, 2048]);
size = sample(2560, 1080, 8192, 4096);
assert.deepEqual([size.displayWidth, size.displayHeight], [4096, 1728]);
size = sample(2560, 1080, 8192, 8192, [2048, 8192]);
assert.deepEqual([size.displayWidth, size.displayHeight], [2048, 864]);
size = sample(2560, 1080, 16384);
const dpr = Math.min(RENDER.maxPixelRatio, Math.sqrt(RENDER.maxPixels / (2560 * 1080)));
assert.deepEqual([size.displayWidth, size.displayHeight], [Math.round(2560 * dpr), Math.round(1080 * dpr)]);
console.log('Render limits passed: texture, renderbuffer, viewport, aspect and normal quality budgets.');

// Fast panels draw a whole fraction of their refreshes, never under 60 a
// second, and a panel up to about 116 Hz draws every one.
{
  const { createFramePacer } = await import('../js/frame-pacer.js');
  const drawn = (hz, jitter = 0, drop = 0) => {
    const skip = createFramePacer(RENDER.frameMs);
    let last = 0, count = 0, worst = 0;
    for (let i = 1; i <= hz * 6; i++) {
      if (drop && i % drop === 0) continue; // a refresh the browser never delivered
      const now = i * 1000 / hz + Math.sin(i * 12.9898) * jitter;
      if (skip(now, last)) continue;
      // the first second is the pacer learning the panel
      if (i > hz) { count++; worst = Math.max(worst, now - last); }
      last = now;
    }
    return { fps: count / 5, worst };
  };
  for (const [hz, want] of [[50, 50], [60, 60], [75, 75], [90, 90], [100, 100],
    [120, 60], [144, 72], [165, 82.5], [240, 60], [360, 60]]) {
    const { fps, worst } = drawn(hz);
    assert(Math.abs(fps - want) < 0.5, `${hz} Hz draws ${want} fps (${fps})`);
    assert(worst < 1000 / want + 0.01, `${hz} Hz is paced evenly (${worst.toFixed(2)} ms)`);
  }
  // Callback times that wobble by a millisecond do not change the rate.
  assert(Math.abs(drawn(120, 1).fps - 60) < 0.5);
  assert(Math.abs(drawn(60, 2).fps - 60) < 0.5);
  assert(Math.abs(drawn(168, 1).fps - 84) < 0.5);
  assert(Math.abs(drawn(165, 2).fps - 82.5) < 0.5);
  assert(Math.abs(drawn(240, 1).fps - 60) < 0.5);
  // A dropped refresh costs that refresh, not a second one on top of it.
  assert(drawn(144, 0, 7).worst < 3 * 1000 / 144 + 0.01);
  // A GPU that only manages every second refresh of a 144 Hz panel is left alone.
  assert(Math.abs(drawn(72).fps - 72) < 0.5);
}
