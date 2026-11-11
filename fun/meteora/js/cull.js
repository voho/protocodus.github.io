/* Meteora — which rocks to draw this frame.

   The belt used to be 555 instanced meshes (one per 1 km cell and rock
   size) and a frame drew about 250 of them; at three.js's per-draw cost
   that was milliseconds of CPU before the GPU saw a triangle. Now each
   frame culls the rocks here and the renderer draws each size in two calls
   (near and far mesh), whatever the view.

   Two levels: a whole cell is rejected when its bounding sphere is outside
   the frustum or beyond the farthest draw distance of the sizes it holds;
   a cell entirely inside the frustum skips the per-rock plane tests. Only
   then are single rocks tested, against their own size's draw distance.
   A rock is drawn with one of three meshes, chosen so that its triangles
   stay about a pixel or two across: the near mesh, the far mesh, and beyond
   that a speck of a few dozen triangles. Each size switches at its own
   number of radii (config.js) — a boulder's near mesh has thirteen times a
   pebble's triangles, so it has to be thirteen times bigger on screen to be
   worth them — and the near mesh never reaches further than 2.5 km; the
   kilometre-wide landmarks always keep their detail. `detail` scales the
   switch distances with the picture: twice the pixels across a rock, twice
   as far. Measured at 1080p from the spawn, the densest clump and the
   belt's edge, that draws about half the triangles of one switch at 100
   radii for every size (a third fewer at 1620p). No allocation per frame: the lists are preallocated. */

export function createCuller(belt, cfg, { lod = cfg.types.map(t => t.lod), lodCap = cfg.lodCap, margin = 1.15 } = {}) {
  const types = cfg.types.length;
  const draw = cfg.types.map(t => t.draw);
  const reach = new Float32Array(belt.count), lodNear = new Float64Array(belt.count), lodFar = new Float64Array(belt.count);
  for (let i = 0; i < belt.count; i++) {
    reach[i] = belt.radius[i] * margin;
    const [near, far] = lod[belt.type[i]];
    lodNear[i] = belt.landmark[i] ? Infinity : Math.min(belt.radius[i] * near, lodCap);
    lodFar[i] = belt.landmark[i] ? Infinity : belt.radius[i] * far;
  }

  // Cells: member lists and a bounding sphere around their rocks.
  const byKey = new Map();
  for (let i = 0; i < belt.count; i++) {
    const key = [0, 1, 2].map(a => Math.floor(belt.pos[3 * i + a] / cfg.cell)).join(',');
    let list = byKey.get(key);
    if (!list) byKey.set(key, list = []);
    list.push(i);
  }
  const cellOf = new Int32Array(belt.count);
  const cells = [...byKey.values()].map((list, index) => {
    for (const i of list) cellOf[i] = index;
    let cx = 0, cy = 0, cz = 0;
    for (const i of list) { cx += belt.pos[3 * i]; cy += belt.pos[3 * i + 1]; cz += belt.pos[3 * i + 2]; }
    cx /= list.length; cy /= list.length; cz /= list.length;
    let radius = 0, maxDraw = 0;
    for (const i of list) {
      const d = Math.sqrt((belt.pos[3 * i] - cx) ** 2 + (belt.pos[3 * i + 1] - cy) ** 2 + (belt.pos[3 * i + 2] - cz) ** 2);
      radius = Math.max(radius, d + reach[i]);
      maxDraw = Math.max(maxDraw, draw[belt.type[i]]);
    }
    // The members by size, each size in index order, and how far from the
    // centre each size's rocks reach: a size whose rocks are all beyond its
    // draw distance is passed over without visiting them (the pebbles,
    // drawn to 1.5 km, are over half the belt).
    const members = new Int32Array(list.length), starts = new Int32Array(types + 1), extent = new Float64Array(types);
    let n = 0;
    for (let t = 0; t < types; t++) {
      starts[t] = n;
      for (const i of list) {
        if (belt.type[i] !== t) continue;
        members[n++] = i;
        const d = Math.sqrt((belt.pos[3 * i] - cx) ** 2 + (belt.pos[3 * i + 1] - cy) ** 2 + (belt.pos[3 * i + 2] - cz) ** 2);
        extent[t] = Math.max(extent[t], d + reach[i]);
      }
    }
    starts[types] = n;
    return { members, starts, extent, cx, cy, cz, radius, maxDraw, distance: 0 };
  });
  // Cells visited nearest first, so each size's list runs near to far and
  // the GPU's depth test can reject rocks hidden behind nearer ones before
  // shading them. 128 cells sort in microseconds.
  const order = cells.slice();
  const byDistance = (a, b) => a.distance - b.distance;

  const counts = new Array(types).fill(0);
  for (let i = 0; i < belt.count; i++) counts[belt.type[i]]++;
  const out = counts.map(n => ({
    near: { index: new Int32Array(n), count: 0 },
    far: { index: new Int32Array(n), count: 0 },
    speck: { index: new Int32Array(n), count: 0 },
  }));

  return {
    cells: cells.length,
    cellOf,
    cellCenter: k => [cells[k].cx, cells[k].cy, cells[k].cz],
    // planes: 6 × [nx, ny, nz, d], inside when n·p + d ≥ −r. eye: [x, y, z].
    cull(planes, eye, alive, detail = 1) {
      for (const o of out) { o.near.count = 0; o.far.count = 0; o.speck.count = 0; }
      const ex = eye[0], ey = eye[1], ez = eye[2];
      for (const cell of cells) {
        const dx = cell.cx - ex, dy = cell.cy - ey, dz = cell.cz - ez;
        cell.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      order.sort(byDistance);
      for (const cell of order) {
        if (cell.distance - cell.radius > cell.maxDraw) continue;
        let outside = false, inside = true;
        for (let k = 0; k < 6; k++) {
          const s = planes[4 * k] * cell.cx + planes[4 * k + 1] * cell.cy + planes[4 * k + 2] * cell.cz + planes[4 * k + 3];
          if (s < -cell.radius) { outside = true; break; }
          if (s < cell.radius) inside = false;
        }
        if (outside) continue;
        const { members, starts, extent } = cell;
        for (let type = 0; type < types; type++) {
          // Every rock of this size is at least distance − extent away, so
          // past its draw distance none would pass the test below; the metre
          // to spare is far more than the rounding in either.
          if (cell.distance - extent[type] > draw[type] + 1) continue;
          const lists = out[type];
          for (let m = starts[type], end = starts[type + 1]; m < end; m++) {
            const i = members[m];
            if (!alive[i]) continue;
            const px = belt.pos[3 * i], py = belt.pos[3 * i + 1], pz = belt.pos[3 * i + 2];
            const r = reach[i];
            const d = Math.sqrt((px - ex) ** 2 + (py - ey) ** 2 + (pz - ez) ** 2);
            if (d - r > draw[type]) continue;
            if (!inside) {
              let visible = true;
              for (let k = 0; k < 6; k++) {
                if (planes[4 * k] * px + planes[4 * k + 1] * py + planes[4 * k + 2] * pz + planes[4 * k + 3] < -r) { visible = false; break; }
              }
              if (!visible) continue;
            }
            const list = d > lodFar[i] * detail ? lists.speck : d > lodNear[i] * detail ? lists.far : lists.near;
            list.index[list.count++] = i;
          }
        }
      }
      return out;
    },
  };
}
