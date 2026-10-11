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
   No allocation per frame — the visible lists are preallocated. */

export function createCuller(belt, cfg, { lodDistance = 2000, margin = 1.15 } = {}) {
  const types = cfg.types.length;
  const draw = cfg.types.map(t => t.draw);
  const reach = new Float32Array(belt.count);
  for (let i = 0; i < belt.count; i++) reach[i] = belt.radius[i] * margin;

  // Cells: member lists and a bounding sphere around their rocks.
  const byKey = new Map();
  for (let i = 0; i < belt.count; i++) {
    const key = [0, 1, 2].map(a => Math.floor(belt.pos[3 * i + a] / cfg.cell)).join(',');
    let list = byKey.get(key);
    if (!list) byKey.set(key, list = []);
    list.push(i);
  }
  const cells = [...byKey.values()].map(list => {
    let cx = 0, cy = 0, cz = 0;
    for (const i of list) { cx += belt.pos[3 * i]; cy += belt.pos[3 * i + 1]; cz += belt.pos[3 * i + 2]; }
    cx /= list.length; cy /= list.length; cz /= list.length;
    let radius = 0, maxDraw = 0;
    for (const i of list) {
      const d = Math.sqrt((belt.pos[3 * i] - cx) ** 2 + (belt.pos[3 * i + 1] - cy) ** 2 + (belt.pos[3 * i + 2] - cz) ** 2);
      radius = Math.max(radius, d + reach[i]);
      maxDraw = Math.max(maxDraw, draw[belt.type[i]]);
    }
    return { members: Int32Array.from(list), cx, cy, cz, radius, maxDraw };
  });

  const counts = new Array(types).fill(0);
  for (let i = 0; i < belt.count; i++) counts[belt.type[i]]++;
  const out = counts.map(n => ({
    near: { index: new Int32Array(n), count: 0 },
    far: { index: new Int32Array(n), count: 0 },
  }));

  return {
    cells: cells.length,
    // planes: 6 × [nx, ny, nz, d], inside when n·p + d ≥ −r. eye: [x, y, z].
    cull(planes, eye, alive) {
      for (const o of out) { o.near.count = 0; o.far.count = 0; }
      const ex = eye[0], ey = eye[1], ez = eye[2];
      for (const cell of cells) {
        const dx = cell.cx - ex, dy = cell.cy - ey, dz = cell.cz - ez;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) - cell.radius > cell.maxDraw) continue;
        let outside = false, inside = true;
        for (let k = 0; k < 6; k++) {
          const s = planes[4 * k] * cell.cx + planes[4 * k + 1] * cell.cy + planes[4 * k + 2] * cell.cz + planes[4 * k + 3];
          if (s < -cell.radius) { outside = true; break; }
          if (s < cell.radius) inside = false;
        }
        if (outside) continue;
        const members = cell.members;
        for (let m = 0; m < members.length; m++) {
          const i = members[m];
          if (!alive[i]) continue;
          const px = belt.pos[3 * i], py = belt.pos[3 * i + 1], pz = belt.pos[3 * i + 2];
          const r = reach[i], type = belt.type[i];
          const d = Math.sqrt((px - ex) ** 2 + (py - ey) ** 2 + (pz - ez) ** 2);
          if (d - r > draw[type]) continue;
          if (!inside) {
            let visible = true;
            for (let k = 0; k < 6; k++) {
              if (planes[4 * k] * px + planes[4 * k + 1] * py + planes[4 * k + 2] * pz + planes[4 * k + 3] < -r) { visible = false; break; }
            }
            if (!visible) continue;
          }
          const list = d > lodDistance ? out[type].far : out[type].near;
          list.index[list.count++] = i;
        }
      }
      return out;
    },
  };
}
