/* One draw call for the board's tiles. Their colours, light and shallow
   relief vary independently without one physical material per cell. */
import * as THREE from 'three';

export function createTileBatch(stage, sourceGeometry, count, options) {
  // The slab cache belongs to every board; instance attributes belong only
  // to this board and must never be attached to the cached geometry.
  const geometry = sourceGeometry.clone();
  const emission = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  emission.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('tileEmission', emission);
  const material = stage.material({ ...options, color: '#ffffff', emissive: '#000000' });
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 tileEmission;\nvarying vec3 vTileEmission;\nvarying vec2 vTileSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTileEmission = tileEmission;\nvTileSurface = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTileEmission;\nvarying vec2 vTileSurface;')
      // A restrained satin finish gives the tile tops relief without a
      // texture fetch, animated shader or another rendering pass.
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.985 + 0.025 * clamp(vTileSurface.x - vTileSurface.y, -1.0, 1.0);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTileEmission;');
  };
  material.customProgramCacheKey = () => 'puzzle-instanced-tiles-v1';
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'tiles';
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tiles = Array.from({ length: count }, () => {
    // A tiny transform holder also carries any clue label. No tile has a
    // separate GPU material or draw call.
    const tile = new THREE.Object3D();
    tile.material = { color: new THREE.Color(), emissive: new THREE.Color(), emissiveIntensity: 0 };
    return tile;
  });
  const previous = new Float64Array(count * 9).fill(NaN);
  const matrix = new THREE.Matrix4();
  let first = true;
  function flush() {
    let moved = false, coloured = false, lit = false;
    for (let i = 0; i < count; i++) {
      const tile = tiles[i], p = tile.position, m = tile.material, offset = i * 9;
      if (p.x !== previous[offset] || p.y !== previous[offset + 1] || p.z !== previous[offset + 2]) {
        matrix.makeTranslation(p.x, p.y, p.z);
        mesh.setMatrixAt(i, matrix);
        previous[offset] = p.x; previous[offset + 1] = p.y; previous[offset + 2] = p.z;
        moved = true;
      }
      if (m.color.r !== previous[offset + 3] || m.color.g !== previous[offset + 4] || m.color.b !== previous[offset + 5]) {
        mesh.setColorAt(i, m.color);
        previous[offset + 3] = m.color.r; previous[offset + 4] = m.color.g; previous[offset + 5] = m.color.b;
        coloured = true;
      }
      const r = m.emissive.r * m.emissiveIntensity, g = m.emissive.g * m.emissiveIntensity, b = m.emissive.b * m.emissiveIntensity;
      if (r !== previous[offset + 6] || g !== previous[offset + 7] || b !== previous[offset + 8]) {
        emission.setXYZ(i, r, g, b);
        previous[offset + 6] = r; previous[offset + 7] = g; previous[offset + 8] = b;
        lit = true;
      }
    }
    if (moved) { mesh.instanceMatrix.needsUpdate = true; stage.invalidateShadows?.(); }
    if (coloured) mesh.instanceColor.needsUpdate = true;
    if (lit) emission.needsUpdate = true;
    if (first) { mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); first = false; }
  }
  return { mesh, tiles, flush, dispose() { mesh.dispose(); geometry.dispose(); material.dispose(); } };
}
