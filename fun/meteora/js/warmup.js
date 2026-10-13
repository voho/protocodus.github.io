/* Meteora — ready before the fold opens.

   three.js does its heavy work the first time something is drawn: it
   compiles a shader the first time a material is drawn in a given light
   and buffer, uploads a texture the first time one is sampled (a
   2048-pixel map takes some fifteen milliseconds) and a mesh's buffers the
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
   will ask for. */

import * as THREE from 'three';

const behind = new THREE.Vector3();

/* `hdr`: whether the flight renders into a half-float buffer. `pause()`
   gives the browser a frame; uploads stop for one every `slice` ms. */
export function createWarmup(renderer, { hdr = false, pause = () => Promise.resolve(), slice = 24 } = {}) {
  const stand = hdr ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null;

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
        renderer.initTexture(map);
        if (performance.now() - t > slice) { await pause(); t = performance.now(); }
      }

      // One frame with all of them in the scene: their buffers go up and
      // each shader is used once.
      const group = new THREE.Group();
      for (const root of [...samples.children]) group.add(root);
      camera.updateMatrixWorld();
      group.position.copy(camera.getWorldDirection(behind)).multiplyScalar(-5000).add(camera.position);
      scene.add(group);
      try {
        renderer.render(scene, camera);
      } finally {
        scene.remove(group);
      }
    },
  };
}
