// Load-time skirts must close every possible neighbouring LOD edge without
// adding triangles or changing the terrain surface/collision master grid.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { createTerrain } = await import('../js/terrain.js');
const previousScheduler = globalThis.scheduler;
globalThis.scheduler = { yield: async () => {} };
const shared = { wet: { value: 0 }, rain: { value: 0 }, time: { value: 0 } };

function grid(mesh, geometry) {
  const p = geometry.attributes.position;
  let cols = 0;
  while (cols < p.count && p.getZ(cols) === p.getZ(0)) cols++;
  const spacing = p.getX(1) - p.getX(0);
  const rows = Math.round((mesh.userData.box[3] - mesh.userData.box[1]) / spacing) + 1;
  assert.equal(p.count, cols * rows + 2 * (cols + rows), 'vertex count remains the original grid plus four skirts');
  assert.equal(geometry.index.count, 6 * (cols - 1) * (rows - 1) + 24 * (cols + rows - 2), 'triangle count is unchanged');
  return { p, cols, rows };
}
function edge(mesh, geometry, side) {
  const { p, cols, rows } = grid(mesh, geometry), surface = cols * rows;
  const alongX = side === 'north' || side === 'south';
  const count = alongX ? cols : rows;
  const start = side === 'north' ? surface : side === 'south' ? surface + cols
    : side === 'west' ? surface + 2 * cols : surface + 2 * cols + rows;
  return Array.from({ length: count }, (_, i) => {
    const top = side === 'north' ? i : side === 'south' ? (rows - 1) * cols + i
      : side === 'west' ? i * cols : i * cols + cols - 1;
    return { q: alongX ? p.getX(top) : p.getZ(top), top: p.getY(top), bottom: p.getY(start + i) };
  });
}
function at(points, q, key) {
  let i = 0;
  while (i < points.length - 2 && points[i + 1].q < q) i++;
  const a = points[i], b = points[i + 1], t = (q - a.q) / (b.q - a.q);
  return a[key] + (b[key] - a[key]) * t;
}
function assertClosed(a, b) {
  let maximumGap = 0;
  for (const q of new Set([...a, ...b].map(point => point.q))) {
    const ay = at(a, q, 'top'), by = at(b, q, 'top');
    maximumGap = Math.max(maximumGap, Math.abs(ay - by));
    if (ay >= by) assert.ok(at(a, q, 'bottom') <= by + 1e-5, `A skirt covers the lower neighbour at ${q}`);
    else assert.ok(at(b, q, 'bottom') <= ay + 1e-5, `B skirt covers the lower neighbour at ${q}`);
  }
  return maximumGap;
}
let comparisons = 0, reproducedLargeGap = false;
try {
  for (const alongX of [false, true]) for (const sign of [-1, 1]) {
    const terrain = await createTerrain({
      bounds: { minX: 0, maxX: alongX ? 32 : 64, minZ: 0, maxZ: alongX ? 64 : 32 },
      // A sub-metre crest/trench straddles an edge that a coarser neighbour
      // bridges. Test both signs and both edge orientations.
      height: (x, z) => 4 + sign * 4 * Math.exp(-Math.pow(((alongX ? x : z) - 19.5) / .18, 2)),
      fine: [alongX ? [-1, -1, 33, 31] : [-1, -1, 31, 33]],
      splat: () => [1, 0, 0, 0],
    }, {}, shared);
    const [a, b] = terrain.group.children;
    for (const first of ['fine', 'coarse']) for (const second of ['fine', 'coarse']) {
      const A = a.userData[first], B = b.userData[second];
      assert.ok(A && B);
      const gap = assertClosed(edge(a, A, alongX ? 'south' : 'east'), edge(b, B, alongX ? 'north' : 'west'));
      reproducedLargeGap ||= gap > 3.9;
      comparisons++;
    }
    const before = terrain.height(19.5, 19.5);
    terrain.updateLod({ x: -400, z: -400 });
    assert.equal(terrain.height(19.5, 19.5), before, 'LOD selection does not change physical footing');
    for (const mesh of terrain.group.children) { mesh.userData.fine.dispose(); mesh.userData.coarse.dispose(); }
    terrain.material.dispose();
  }
  assert.ok(reproducedLargeGap, 'fixture actually reproduces a gap larger than the old fixed skirt');
  const flat = await createTerrain({ bounds: { minX: 0, maxX: 79, minZ: 0, maxZ: 32 },
    height: () => 4, splat: () => [0, 1, 0, 0] }, {}, shared);
  assert.equal(flat.group.children.at(-1).userData.coarse, null, 'partial edge keeps its existing LOD availability');
  for (const mesh of flat.group.children) for (const mode of ['fine', 'coarse']) {
    const geometry = mesh.userData[mode]; if (!geometry) continue;
    for (const side of ['north', 'south', 'west', 'east']) for (const point of edge(mesh, geometry, side)) {
      assert.equal(point.top - point.bottom, 1.5, 'flat ground retains the original skirt depth');
    }
    geometry.dispose();
  }
  flat.material.dispose();
} finally {
  if (previousScheduler === undefined) delete globalThis.scheduler;
  else globalThis.scheduler = previousScheduler;
}
console.log(`Terrain skirts: ${comparisons} mixed-detail edge pairs closed; surfaces, geometry counts and flat/partial chunks preserved`);
