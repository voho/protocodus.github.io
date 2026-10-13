/* Meteora — ready before the fold opens.

   three.js does its heavy work the first time something is drawn: it
   compiles a shader the first time a material is drawn in a given light
   and buffer, uploads a texture the first time one is sampled (a
   2048-pixel map takes several milliseconds) and a mesh's buffers the
   first time it is drawn. Left to the flight, that is a stutter every time
   a new kind of ship folds in or a turret dies.

   Under the loading screen this does all of it for whatever the flight may
   show. Handed one of every model the mission flies, in every paint, it
   compiles every shader those samples and the scene need — in parallel
   where the browser can, so the loading screen keeps moving — uploads the
   maps a few at a time between frames, and last draws the samples once in
   the scene, behind the camera where nothing of them can be seen.

   The flight draws into a half-float buffer and leaves tone mapping and
   the colour space to the last pass, and three.js builds a different
   shader for that than for the screen; the shaders are compiled with a
   1×1 target of the same kind bound, so they are the very ones the flight
   will ask for.

   A colour map is an sRGB texture, and three.js makes every texture with
   storage of a fixed size (texStorage2D) and then copies the picture in
   (texSubImage2D). Into an sRGB texture that copy costs ANGLE on Metal
   about 30 ms for a 2048-pixel map; made by the copy itself (texImage2D)
   the same texture, byte for byte, mipmaps and all, takes 4. So the maps
   uploaded here, and the target window's (`fastUpload`), are made that
   way: three.js's storage is held back, and the copy makes it. */

import * as THREE from 'three';

const behind = new THREE.Vector3();

/* `upload(map)` for this renderer: the map up to the GPU now, a colour map
   made by its copy (above) rather than copied into storage made first.
   Anything else — another shape of copy, or no copy at all — gets
   three.js's storage after all. One per renderer. */
const uploaders = new WeakMap();
export function fastUpload(renderer) {
  let upload = uploaders.get(renderer);
  if (upload) return upload;
  const gl = renderer.getContext(), state = renderer.state;
  const storage = state.texStorage2D, copy = state.texSubImage2D;
  let holding = false, held = null;
  state.texStorage2D = function (target, levels, format, width, height) {
    if (holding && !held && target === gl.TEXTURE_2D && format === gl.SRGB8_ALPHA8) { held = arguments; return; }
    return storage.apply(this, arguments);
  };
  state.texSubImage2D = function (target, level, x, y, format, type, image) {
    if (held) {
      const args = held;   // target, levels, internal format, width, height
      held = null;
      if (arguments.length === 7 && level === 0 && x === 0 && y === 0 && image?.width === args[3] && image?.height === args[4]) {
        gl.texImage2D(target, 0, args[2], format, type, image);
        return;
      }
      storage.apply(this, args);
    }
    return copy.apply(this, arguments);
  };
  upload = map => {
    holding = map.colorSpace === THREE.SRGBColorSpace && map.image?.width > 0 && !map.isRenderTargetTexture && !map.isDataTexture && !map.isCompressedTexture && !map.mipmaps?.length;
    try {
      renderer.initTexture(map);
    } finally {
      holding = false;
      if (held) {
        state.bindTexture(gl.TEXTURE_2D, renderer.properties.get(map).__webglTexture);
        storage.apply(state, held);
        held = null;
        state.unbindTexture();
      }
    }
  };
  uploaders.set(renderer, upload);
  return upload;
}

/* `hdr`: whether the flight renders into a half-float buffer. `pause()`
   gives the browser a frame; uploads stop for one every `slice` ms. */
export function createWarmup(renderer, { hdr = false, pause = () => Promise.resolve(), slice = 24 } = {}) {
  const stand = hdr ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null;
  const upload = fastUpload(renderer);

  return {
    async warm(scene, camera, roots) {
      // The samples wait in a scene of their own, which the game's frames
      // do not draw, lit by the real one.
      const samples = new THREE.Scene();
      for (const root of roots) {
        root.traverse(o => { o.frustumCulled = false; });
        samples.add(root);
      }
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(stand);
      const compiled = Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(samples, camera, scene)]);
      renderer.setRenderTarget(previous);
      await compiled;

      const maps = new Set();
      samples.traverse(o => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const value of Object.values(m)) if (value?.isTexture) maps.add(value);
        }
      });
      let t = performance.now();
      for (const map of maps) {
        upload(map);
        if (performance.now() - t > slice) { await pause(); t = performance.now(); }
      }

      // One frame with all of them in the scene: their buffers go up and
      // each shader is used once. It is drawn into the stand-in target,
      // where nobody sees it (without one, behind the camera).
      const group = new THREE.Group();
      for (const root of [...samples.children]) group.add(root);
      camera.updateMatrixWorld();
      group.position.copy(camera.getWorldDirection(behind)).multiplyScalar(-5000).add(camera.position);
      scene.add(group);
      const target = renderer.getRenderTarget();
      if (stand) renderer.setRenderTarget(stand);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(target);
        scene.remove(group);
      }
    },
  };
}
