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
