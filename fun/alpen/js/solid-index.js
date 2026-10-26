/* Streamed colliders keep their source order: compound contacts and the
   rider's hold-out response depend on it. A bit per source entry in each
   forty-metre bucket lets a z query union buckets without sorting, allocating
   records, or returning a compound collider twice. The circle's full extent
   is indexed, including either side of a negative-coordinate boundary. */
export function createSolidIndex(solids, cellSize = 40) {
  let first = 0, count = 0, words = 0;
  let buckets = new Uint32Array(0);
  let selected = new Uint32Array(0);

  function rebuild() {
    words = Math.ceil(solids.length / 32);
    if (!words) { count = 0; return; }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      lo = Math.min(lo, Math.floor((s.z - s.r) / cellSize));
      hi = Math.max(hi, Math.floor((s.z + s.r) / cellSize));
    }
    first = lo;
    count = hi - lo + 1;
    const size = words * count;
    if (buckets.length < size) buckets = new Uint32Array(size);
    else buckets.fill(0, 0, size);
    if (selected.length < words) selected = new Uint32Array(words);
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const from = Math.floor((s.z - s.r) / cellSize) - first;
      const to = Math.floor((s.z + s.r) / cellSize) - first;
      for (let b = from; b <= to; b++) buckets[b * words + (i >>> 5)] |= 1 << (i & 31);
    }
  }

  // `out` belongs to the caller, so a camera query cannot overwrite an active
  // physics shortlist. Bounds are inclusive, as in the original full scan.
  function query(lo, hi, out) {
    out.length = 0;
    if (!count) return out;
    const from = Math.max(0, Math.floor(lo / cellSize) - first);
    const to = Math.min(count - 1, Math.floor(hi / cellSize) - first);
    if (from > to) return out;
    selected.fill(0, 0, words);
    for (let b = from; b <= to; b++) {
      const offset = b * words;
      for (let w = 0; w < words; w++) selected[w] |= buckets[offset + w];
    }
    for (let w = 0; w < words; w++) {
      let bits = selected[w];
      while (bits) {
        const bit = 31 - Math.clz32(bits & -bits);
        const s = solids[(w << 5) + bit];
        if (s.z + s.r >= lo && s.z - s.r <= hi) out.push(s);
        bits &= bits - 1;
      }
    }
    return out;
  }

  return { rebuild, query };
}
