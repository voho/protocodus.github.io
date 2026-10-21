/* Hedgerow — the night's fill lights cast no glints.

   The key light (the last of the sun behind the clouds, low over the
   horizon) and the rim light (the overcast) are there to model shapes:
   directional lights, so on anything glossy - wet mud, a puddle, a wet
   roof - they made a sharp, white-hot glint, a sun on water under a
   sky with no sun in it. The glow of the horizon is in the reflections
   already (the environment map, ssr.js). So on every material that takes
   it (dimFillSpecular, called last in a material's onBeforeCompile) the
   direct specular of a directional light coming from either fill light's
   direction is cut to a tenth; their diffuse light, and the glints of the
   lamps, the fires, a flare or a lightning stroke, stay as they were. */

import * as THREE from 'three';

/* the fill lights' directions (world space, towards the light), set each frame (setFill) */
export const FILL_UNIFORMS = { uFillDir: { value: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)] }, uFillSpec: { value: 0.1 } };

const TARGET = 'reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter(';
let patched = null;
function chunk() {
  if (patched !== null) return patched;
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  patched = src.includes(TARGET)
    ? `uniform vec3 uFillDir[2];
uniform float uFillSpec;
// a fill light's glint (its direction matches one of theirs) is cut down
float fillSpec(vec3 dir) {
  float f = max(step(0.9995, dot(dir, normalize((viewMatrix * vec4(uFillDir[0], 0.0)).xyz))),
                step(0.9995, dot(dir, normalize((viewMatrix * vec4(uFillDir[1], 0.0)).xyz))));
  return mix(1.0, uFillSpec, f);
}
` + src.replace(TARGET, 'reflectedLight.directSpecular += fillSpec(directLight.direction) * irradiance * BRDF_GGX_Multiscatter(')
    : '';
  return patched;
}

/* in a material's onBeforeCompile, after everything else */
export function dimFillSpecular(shader) {
  const c = chunk();
  if (!c || !shader.fragmentShader.includes('#include <lights_physical_pars_fragment>')) return;
  Object.assign(shader.uniforms, FILL_UNIFORMS);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', c);
}

/* this frame's fill lights (lights.js key and rim) */
export function setFill(key, rim) {
  const d = FILL_UNIFORMS.uFillDir.value;
  d[0].copy(key.position).sub(key.target.position).normalize();
  d[1].copy(rim.position).sub(rim.target.position).normalize();
}
