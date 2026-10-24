/* The grass shader still decides which blades grow and how they move. This
   only removes grid cells that cannot produce a visible blade, before their
   vertices reach the GPU. Intersect the view bounds a row at a time rather
   than testing every tuft. The surviving IDs retain their original cells. */
export function createGrassCells(max, spacing, minHeight, maxHeight) {
  const cells = new Float32Array(max * max);
  for (let i = 0; i < cells.length; i++) cells[i] = i;
  const planes = new Float64Array(20);
  const bounded = Number.isFinite(minHeight) && Number.isFinite(maxHeight);
  const jitter = spacing * 0.7;
  let count = max * max, changed = false;

  function update(camera, n, originX, originZ) {
    changed = false;
    if (bounded) {
      const v = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
      // The shader accepts |view.x/y| within 1.2 m of each side, and roots
      // up to 1.2 m behind the eye. The extra 1.2 covers that latter case,
      // where its side checks use max(-view.z, 0) rather than -view.z.
      const plane = (i, axis, scale, limit) => {
        const a = v[2] + v[axis] * scale;
        const b = v[6] + v[4 + axis] * scale;
        const c = v[10] + v[8 + axis] * scale;
        planes[i] = a;
        planes[i + 1] = c;
        planes[i + 2] = v[14] + v[12 + axis] * scale - limit
          + b * ((b < 0 ? maxHeight : minHeight) + 0.4)
          - (Math.abs(a) + Math.abs(c)) * jitter
          // Leave room for the GPU's single-precision matrix arithmetic.
          - (Math.abs(a) + Math.abs(b) + Math.abs(c) + 1) * 0.001;
      };
      plane(0, 0, p[0], p[0] * 1.2 + 1.2);
      plane(4, 0, -p[0], p[0] * 1.2 + 1.2);
      plane(8, 1, p[5], p[5] * 1.2 + 1.2);
      plane(12, 1, -p[5], p[5] * 1.2 + 1.2);
      plane(16, 0, 0, 1.2);
    }
    let next = 0;
    for (let row = 0; row < n; row++) {
      const z = (originZ + row + 0.5) * spacing;
      // Keep the radial fade in the shader: rounding can leave subpixel
      // fragments even when its blades are mathematically flat.
      let lo = -Infinity, hi = Infinity;
      if (bounded) for (let j = 0; j < planes.length; j += 4) {
        const a = planes[j], d = planes[j + 1] * z + planes[j + 2];
        if (Math.abs(a) < 1e-12) {
          if (d > 0) { hi = -Infinity; break; }
        } else if (a > 0) hi = Math.min(hi, -d / a);
        else lo = Math.max(lo, -d / a);
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
