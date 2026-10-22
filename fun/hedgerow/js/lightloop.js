/* Hedgerow — the point lights only where they reach.

   Every lit material loops over all nine point lights (the pool of eight and
   the shadow-casting one, lights.js) for every pixel, and three.js shades each
   one - the full BRDF, the skin's and the leaves' extras, the shadow lookup -
   even where its range has already cut its light to nothing, as it has for
   most of them on most of the screen. Patched once, before any material is
   compiled: a point light that does not reach a pixel is skipped there (a
   branch the GPU takes together across a block of pixels the light is far
   from). What it adds where it does reach is unchanged. */

import * as THREE from 'three';

const AT = 'getPointLightInfo( pointLight, geometryPosition, directLight );';

export function cullPointLights() {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const a = src.indexOf(AT);
  if (a < 0 || src.includes('/* hedgerow: reach */')) return false;
  const b = src.indexOf('RE_Direct( directLight', a);
  const e = b < 0 ? -1 : src.indexOf(');', b);
  if (e < 0) return false;
  THREE.ShaderChunk.lights_fragment_begin = src.slice(0, a + AT.length) + '\n\t\tif ( directLight.visible ) { /* hedgerow: reach */'
    + src.slice(a + AT.length, e + 2) + '\n\t\t}' + src.slice(e + 2);
  return true;
}
