/* Conservative row-by-row culling of the procedural clutter grid. A cell
   can contain a piece anywhere within its root jitter and terrain height
   bounds; the expanded frustum keeps the whole piece and TAA jitter. */
import * as THREE from 'three';

export function createClutterCells(n, spacing, minHeight, maxHeight, radius = 0.35) {
  const cells = new Float32Array(n * n);
  for (let i = 0; i < cells.length; i++) cells[i] = i;
  const projection = new THREE.Matrix4(), viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum();
  const rows = new Float64Array(18);
  const bounded = Number.isFinite(minHeight) && Number.isFinite(maxHeight);
  const jitter = spacing * 0.45;
  let count = cells.length, changed = false;

  function update(camera, originX, originZ, width, height) {
    changed = false;
    const cull = bounded && width > 0 && height > 0;
    if (cull) {
      projection.copy(camera.projectionMatrix);
      const p = projection.elements, sx = 1 + 2 / width, sy = 1 + 2 / height;
      for (let i = 0; i < 16; i += 4) { p[i] /= sx; p[i + 1] /= sy; }
      viewProjection.multiplyMatrices(projection, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      for (let i = 0; i < 6; i++) {
        const plane = frustum.planes[i], v = plane.normal;
        rows[i * 3] = v.x;
        rows[i * 3 + 1] = v.z;
        rows[i * 3 + 2] = plane.constant + v.y * (v.y < 0 ? minHeight : maxHeight)
          + (Math.abs(v.x) + Math.abs(v.z)) * jitter + radius + 0.001;
      }
    }
    let next = 0;
    for (let row = 0; row < n; row++) {
      const z = (originZ + row + 0.5) * spacing;
      let lo = -Infinity, hi = Infinity;
      if (cull) for (let j = 0; j < rows.length; j += 3) {
        const a = rows[j], d = rows[j + 1] * z + rows[j + 2];
        if (Math.abs(a) < 1e-12) {
          if (d < 0) { hi = -Infinity; break; }
        } else if (a > 0) lo = Math.max(lo, -d / a);
        else hi = Math.min(hi, -d / a);
      }
      const first = Math.max(0, Math.ceil(lo / spacing - originX - 0.5 - 1e-5));
      const last = Math.min(n - 1, Math.floor(hi / spacing - originX - 0.5 + 1e-5));
      for (let col = first; col <= last; col++) {
        const id = row * n + col;
        if (cells[next] !== id) { cells[next] = id; changed = true; }
        next++;
      }
    }
    if (next !== count) changed = true;
    count = next;
    return count;
  }
  return { cells, update, get changed() { return changed; } };
}
