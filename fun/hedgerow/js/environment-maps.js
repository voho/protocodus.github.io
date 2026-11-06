/* Sky reflections live only on the GPU. Keep their small authored scene so
   they can be baked again after a context reset; ordinary source textures
   can reupload their pixels, but these render targets cannot. */
import * as THREE from 'three';
import { createSky } from './sky.js';

export function createEnvironmentMaps(renderer, { fog, profile } = {}) {
  const scene = new THREE.Scene(), sky = createSky({ fog, profile });
  sky.mesh.material.depthTest = false; scene.add(sky.mesh);
  let generator = null, targets = null, disposed = false;
  function releaseTemporary() {
    generator?.dispose(); generator = null;
    // dispose releases GPU resources; geometry attributes and shader source
    // remain available for the next renderer generation.
    sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
  }
  function clear() {
    if (targets) { targets.night.dispose(); targets.day.dispose(); targets = null; }
    releaseTemporary();
  }
  function bake() {
    if (disposed) throw new Error('The sky reflection owner has been disposed');
    if (targets) clear();
    const previous = {
      target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(), xr: renderer.xr.enabled,
      autoClear: renderer.autoClear, toneMapping: renderer.toneMapping,
    };
    // PMREM's normal return restores renderer state, but a failed draw
    // skips that cleanup. Track only this bake's targets through its own
    // renderer facade so even an unreturned output can be released.
    const touched = new Set();
    const bakeRenderer = new Proxy(renderer, {
      get(object, key) {
        if (key === 'setRenderTarget') return (target, ...args) => {
          if (target && target !== previous.target) touched.add(target);
          return object.setRenderTarget(target, ...args);
        };
        const value = Reflect.get(object, key, object);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
    try {
      generator = new THREE.PMREMGenerator(bakeRenderer);
      sky.setDaylight(false);
      const night = generator.fromScene(scene, 0, .1, 1000);
      sky.setDaylight(true);
      const day = generator.fromScene(scene, 0, .1, 1000);
      targets = { night, day };
      return targets;
    } catch (error) {
      for (const target of touched) target.dispose();
      releaseTemporary(); throw error;
    } finally {
      renderer.setRenderTarget(previous.target, previous.face, previous.mip);
      renderer.xr.enabled = previous.xr;
      renderer.autoClear = previous.autoClear;
      renderer.toneMapping = previous.toneMapping;
    }
  }
  return {
    bake, clear, releaseTemporary,
    get targets() { return targets; },
    dispose() { if (!disposed) { clear(); disposed = true; } },
  };
}
