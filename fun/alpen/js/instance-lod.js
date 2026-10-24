/* Trim only the fully invisible tail of a nearest-first instance pool.
   The surviving prefix keeps its original matrices, colours and ordering.
   No sorting, buffer copies or uploads are needed as the camera moves. */
export function distancePrefix(matrices, count, model, cameraX, cameraZ, distance) {
  const limit = distance * distance;
  while (count > 0) {
    const p = (count - 1) * 16;
    const x = matrices[p + 12], y = matrices[p + 13], z = matrices[p + 14];
    const dx = model[0] * x + model[4] * y + model[8] * z + model[12] - cameraX;
    const dz = model[2] * x + model[6] * y + model[10] * z + model[14] - cameraZ;
    if (dx * dx + dz * dz < limit) break;
    count--;
  }
  return count;
}

/* Colour passes alone use the shorter prefix. The sun still sees every
   caster selected by onBeforeShadow, including trees outside the colour LOD.
   Restore the count after every draw so other cameras and streaming always
   see the complete pool. */
export function bindDistancePrefix(mesh, distance) {
  const before = mesh.onBeforeRender;
  const after = mesh.onAfterRender;
  let full = 0;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    before?.call(this, renderer, scene, camera, geometry, material, group);
    full = this.count;
    const eye = camera.matrixWorld.elements;
    // The shader measures in float32. Keep a small guard at its cutoff,
    // increasing with world-coordinate precision on very long descents.
    const guard = 0.02 + Math.max(Math.abs(eye[12]), Math.abs(eye[14])) * 2 ** -21;
    this.count = distancePrefix(this.instanceMatrix.array, full,
      this.matrixWorld.elements, eye[12], eye[14], distance + guard);
  };
  mesh.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
    this.count = full;
    after?.call(this, renderer, scene, camera, geometry, material, group);
  };
}
