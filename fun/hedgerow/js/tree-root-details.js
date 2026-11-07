/* Close-range tree roots: one bounded subdivision pass on the eleven full
 * tree models. GLBs, distant LODs, trunk/foliage faces, borrowed maps/materials,
 * collider metadata, original base rings and buried tips stay unchanged.
 * Derived geometry belongs to the model library, never an individual tree. */
import * as THREE from 'three';
// Recover disconnected authored pieces after GLB UV/normal seam splitting.
// Position identity is exact: no proximity welding or atlas assumptions.
function components(geometry, { maxY = Infinity } = {}) {
  const p = geometry.attributes.position, ids = geometry.index;
  const welded = new Map(), vertex = new Uint32Array(p.count), points = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
    if (!welded.has(key)) { welded.set(key, points.length); points.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i))); }
    vertex[i] = welded.get(key);
  }
  const parent = points.map((_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const triangles = [];
  for (let i = 0; i < (ids?.count || p.count); i += 3) {
    const original = [0, 1, 2].map(k => ids ? ids.getX(i + k) : i + k);
    if (original.some(v => p.getY(v) > maxY)) continue;
    const corners = original.map(v => vertex[v]);
    join(corners[0], corners[1]); join(corners[1], corners[2]);
    triangles.push({ offset: i, original, corners });
  }
  const groups = new Map();
  for (const triangle of triangles) {
    const root = find(triangle.corners[0]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(triangle);
  }
  return [...groups.values()].map(tris => {
    const vertices = [...new Set(tris.flatMap(t => t.corners))], edges = new Map(), adjacency = new Map();
    const box = new THREE.Box3().setFromPoints(vertices.map(i => points[i]));
    for (const { corners } of tris) for (let k = 0; k < 3; k++) {
      const a = corners[k], b = corners[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      const edge = edges.get(key) || { a, b, count: 0 }; edge.count++; edges.set(key, edge);
      if (!adjacency.has(a)) adjacency.set(a, new Set()); if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b); adjacency.get(b).add(a);
    }
    const boundary = [...edges.values()].filter(e => e.count === 1);
    return { tris, vertices, box, edges, boundary, adjacency, points };
  });
}

function rootComponent(c) {
  // Authored roots: two open five-vertex rings, five triangular tip faces.
  // Their pointed end is buried exactly .12 m below the local ground.
  if (c.tris.length !== 15 || c.vertices.length !== 11 || c.boundary.length !== 5 || c.box.max.y > 1.5) return null;
  const base = [...new Set(c.boundary.flatMap(e => [e.a, e.b]))];
  if (base.length !== 5 || [...c.edges.values()].some(e => e.count > 2)) return null;
  const tip = c.vertices.filter(i => Math.abs(c.points[i].y + .12) < 1e-6 && c.adjacency.get(i).size === 5);
  if (tip.length !== 1) return null;
  const end = tip[0], middle = [...c.adjacency.get(end)];
  if (middle.length !== 5 || middle.some(i => base.includes(i)) || !c.vertices.every(i => i === end || base.includes(i) || middle.includes(i))) return null;
  if (base.some(i => c.points[i].y < .02) || c.points[end].length() < .3) return null;
  return { ...c, base, middle, tip: end };
}

function supportedGeometry(geometry) {
  const attributes = geometry?.attributes, index = geometry?.index;
  if (!attributes || Object.keys(attributes).length !== 4 || !index
    || !(index.array instanceof Uint16Array || index.array instanceof Uint32Array)
    || index.itemSize !== 1 || index.normalized || index.count !== index.array.length || index.count % 3 !== 0) return false;
  const count = attributes.position?.count;
  if (!Number.isInteger(count) || count <= 0) return false;
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    const attribute = attributes[name];
    if (!attribute || !(attribute.array instanceof Float32Array) || attribute.itemSize !== size
      || attribute.normalized || attribute.count !== count || attribute.array.length !== count * size) return false;
    for (const value of attribute.array) if (!Number.isFinite(value)) return false;
  }
  for (const value of index.array) if (!Number.isFinite(value) || value < 0 || value >= count) return false;
  return true;
}

const counts = Object.freeze({ pine_a: 6, pine_b: 6, pine_c: 5, oak_a: 6, oak_b: 6, birch_a: 5, tree_dead: 5, pine_big: 6, fir_big: 6, oak_big: 6, beech_big: 6 });
const edgeId = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
const prepared = new WeakMap(), owned = new WeakMap();

// One bounded Loop pass on independently recovered authored root pieces.
// Pin the buried tip and complete open base ring; every other position is
// a positive convex combination of original vertices. No expansion occurs.
function subdivide(root) {
  const pinned = new Set([...root.base, root.tip]), positions = new Map(), normals = new Map();
  const even = id => `v:${id}`, odd = (a, b) => `e:${edgeId(a, b)}`;
  for (const i of root.vertices) {
    const neighbors = [...root.adjacency.get(i)], beta = neighbors.length === 3 ? 3 / 16 : 3 / (8 * neighbors.length);
    const p = root.points[i].clone();
    if (!pinned.has(i)) {
      p.multiplyScalar(1 - neighbors.length * beta);
      for (const j of neighbors) p.addScaledVector(root.points[j], beta);
    }
    positions.set(even(i), p);
  }
  const opposite = new Map();
  for (const t of root.tris) for (let k = 0; k < 3; k++) {
    const a = t.corners[k], b = t.corners[(k + 1) % 3], c = t.corners[(k + 2) % 3], id = edgeId(a, b);
    if (!opposite.has(id)) opposite.set(id, []); opposite.get(id).push(c);
  }
  for (const e of root.edges.values()) {
    const ends = [root.points[e.a], root.points[e.b]], others = opposite.get(edgeId(e.a, e.b));
    const p = new THREE.Vector3();
    if (e.count === 1) p.addVectors(...ends).multiplyScalar(.5);
    else { p.addVectors(...ends).multiplyScalar(3 / 8); for (const id of others) p.addScaledVector(root.points[id], 1 / 8); }
    positions.set(odd(e.a, e.b), p);
  }
  const children = [], a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (const t of root.tris) {
    const [v0, v1, v2] = t.corners, [i0, i1, i2] = t.original;
    const corners = [[even(v0), i0], [even(v1), i1], [even(v2), i2]];
    const mids = [[odd(v0,v1), i0,i1], [odd(v1,v2),i1,i2], [odd(v2,v0),i2,i0]];
    children.push([corners[0],mids[0],mids[2]],[mids[0],corners[1],mids[1]],[mids[2],mids[1],corners[2]],[mids[0],mids[1],mids[2]]);
  }
  for (const t of children) {
    a.subVectors(positions.get(t[1][0]), positions.get(t[0][0])); b.subVectors(positions.get(t[2][0]), positions.get(t[0][0])); n.crossVectors(a,b);
    for (const [id] of t) { if (!normals.has(id)) normals.set(id, new THREE.Vector3()); normals.get(id).add(n); }
  }
  for (const normal of normals.values()) normal.normalize();
  return { children, positions, normals };
}

export function prepareTreeRootDetails(model) {
  if (!Object.hasOwn(counts, model?.name)) return model;
  if (owned.has(model) && !owned.get(model).released) return model;
  const cached = prepared.get(model);
  if (cached && !cached.released) return cached.model;
  const original = model.prims?.[0], source = original?.geometry;
  if (!supportedGeometry(source) || !original.material || original.material.alphaTest > 0) return model;
  const roots = components(source, { maxY: 1.5 }).map(rootComponent).filter(Boolean);
  // Fail closed on changed/ambiguous asset topology, rather than deforming it.
  if (roots.length !== counts[model.name]) return model;
  const attrs = Object.fromEntries(Object.entries(source.attributes).map(([key, a]) => [key, Array.from(a.array)]));
  const indices = [], skipped = new Set(roots.flatMap(r => r.tris.map(t => t.offset)));
  for (let i = 0; i < source.index.count; i += 3) if (!skipped.has(i)) indices.push(source.index.getX(i),source.index.getX(i+1),source.index.getX(i+2));
  for (const root of roots) {
    const refined = subdivide(root), shared = new Map();
    for (const t of refined.children) for (const [id, i0, i1] of t) {
      // Keep separate UV/colour seams: cache by original attribute endpoints,
      // while sharing positions and smooth normals by welded geometric edge.
      const key = i1 === undefined ? `v:${i0}` : `e:${edgeId(i0,i1)}`;
      if (!shared.has(key)) {
        const output = attrs.position.length / 3, p = refined.positions.get(id), normal = refined.normals.get(id);
        shared.set(key, output);
        attrs.position.push(p.x,p.y,p.z); attrs.normal.push(normal.x,normal.y,normal.z);
        for (const [name, attribute] of Object.entries(source.attributes)) if (name !== 'position' && name !== 'normal') {
          for (let k = 0; k < attribute.itemSize; k++) attrs[name].push(i1 === undefined ? attribute.array[i0*attribute.itemSize+k] : (attribute.array[i0*attribute.itemSize+k] + attribute.array[i1*attribute.itemSize+k]) * .5);
        }
      }
      indices.push(shared.get(key));
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, new THREE.BufferAttribute(new attribute.array.constructor(attrs[name]), attribute.itemSize, attribute.normalized));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const result = { ...model, prims: [{ ...original, geometry }, ...model.prims.slice(1)] };
  const record = { model: result, geometry, released: false };
  prepared.set(model, record); owned.set(result, record);
  return result;
}

/* Postprocess a newly loaded model library; repeated calls are idempotent. */
export function addTreeRootDetails(models) {
  for (const name of Object.keys(counts)) {
    const model = models.get(name);
    if (model) models.set(name, prepareTreeRootDetails(model));
  }
  return models;
}

/* Terminal library cleanup only, after ALL model users are gone. Graphics
 * context retirement may dispose/reupload the geometry without calling this:
 * its CPU arrays and the prepared model remain available across recovery. */
export function releaseTreeRootDetails(model) {
  const record = owned.get(model) || prepared.get(model);
  if (!record || record.released) return false;
  const geometry = record.geometry, result = record.model;
  record.released = true; record.model = null; record.geometry = null;
  prepared.delete(model); owned.delete(result);
  geometry.dispose();
  return true;
}
