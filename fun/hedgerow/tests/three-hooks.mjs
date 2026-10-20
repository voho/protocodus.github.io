// Module hooks for the checks that import game code using three.js: the bare
// specifier 'three' resolves to the site's vendored copy (as the import map
// does in the browser). Import this file first.
import { registerHooks } from 'node:module';

const THREE_URL = new URL('../../../assets/vendor/three/three.module.min.js', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: THREE_URL, shortCircuit: true, format: 'module' };
    return next(specifier, context);
  },
});

// the bits of the DOM the game touches while building characters
globalThis.document ??= {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
      putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    }),
  }),
};
