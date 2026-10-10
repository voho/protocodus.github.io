/* The riders, as modelled.

   The player and the people sharing the piste are built in Blender by
   `tools/blender/riders.py` and arrive as two files, `rider.glb` (one node
   per rigid segment of the rig) and `npcs.glb` (each figure's deck and body
   halves, plus the headgear and pack they are dressed in). See MODELS.md.

   THIS IS NOT A GLTF LOADER, and it is deliberately not one. The files are
   ours and their shape is fixed by the script that writes them: float
   positions and normals, integer indices, one material per primitive and
   nothing else — no textures, no skins, no compression. Reading exactly that
   is fifty lines, and it means the same code runs in the browser and in the
   node checks (`tests/models-check.mjs`), which cannot resolve the bare
   `three` import the vendored GLTFLoader needs.

   COLOUR IS A ROLE, NOT A PIXEL. Every primitive's material is named for
   what it is — `shell`, `trim`, `npcJacket` — and carries nothing else. The
   rig and the figures decide what each role looks like (`riderModel.js`,
   `mountainLife.js`), so the palette, the cloth masks and the per-figure
   dress stay written down where the rest of the art direction is, and a
   rebuild in Blender can never quietly change a colour. */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPED = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export const RIDER_GLB = new URL('../assets/models/riders/rider.glb', import.meta.url).href;
export const NPC_GLB = new URL('../assets/models/riders/npcs.glb', import.meta.url).href;

/* name → { prims: [{ role, position, normal, index }], extras } for every
   node that carries a mesh. A node with a transform of its own is refused
   rather than half-honoured: every node is authored at the origin of its own
   segment's frame, and one that is not means the build has gone wrong. */
export function parseRiderGlb(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('rider model: not a GLB');
  let json = null;
  let bin = null;
  for (let at = 12; at + 8 <= view.byteLength;) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at + 8, length)));
    } else if (type === CHUNK_BIN) {
      // Copied out so every view below starts on an aligned offset.
      bin = buffer.slice(at + 8, at + 8 + length);
    }
    at += 8 + length;
  }
  if (!json || !bin) throw new Error('rider model: missing chunk');

  const read = (i) => {
    const acc = json.accessors[i];
    const bv = json.bufferViews[acc.bufferView];
    const Typed = TYPED[acc.componentType];
    const size = COMPONENTS[acc.type];
    if (!Typed || !size) throw new Error('rider model: unexpected accessor');
    if (bv.byteStride && bv.byteStride !== size * Typed.BYTES_PER_ELEMENT) {
      throw new Error('rider model: interleaved buffers');
    }
    return new Typed(bin, (bv.byteOffset || 0) + (acc.byteOffset || 0), acc.count * size);
  };

  const nodes = {};
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    if (node.matrix || node.translation || node.rotation || node.scale) {
      throw new Error(`rider model: node ${node.name} is not at its segment's origin`);
    }
    const prims = json.meshes[node.mesh].primitives.map((p) => ({
      role: json.materials[p.material].name,
      position: read(p.attributes.POSITION),
      normal: read(p.attributes.NORMAL),
      index: read(p.indices),
    }));
    nodes[node.name] = { prims, extras: node.extras || {} };
  }
  return nodes;
}

/* The nodes' primitives welded into one indexed geometry. `look(role)` is
   asked once per primitive and answers with what that role is drawn as:
   `color` (anything THREE.Color takes, so palettes stay in sRGB hex like
   the rest of the game's), and any number of named per-vertex attributes
   as plain arrays — `{ aCloth: [1, 0], aSheen: [0.3] }`. Every primitive
   must answer with the same set of names. */
export function riderGeometry(THREE, nodes, look) {
  const prims = nodes.flatMap((n) => n.prims);
  let verts = 0;
  let indices = 0;
  for (const p of prims) {
    verts += p.position.length / 3;
    indices += p.index.length;
  }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(indices);
  const extra = {};
  const c = new THREE.Color();
  let v = 0;
  let k = 0;
  for (const p of prims) {
    const n = p.position.length / 3;
    const said = look(p.role);
    if (!said) throw new Error(`rider model: no look for role ${p.role}`);
    position.set(p.position, v * 3);
    normal.set(p.normal, v * 3);
    c.set(said.color);
    for (let i = 0; i < n; i++) {
      color[(v + i) * 3] = c.r;
      color[(v + i) * 3 + 1] = c.g;
      color[(v + i) * 3 + 2] = c.b;
    }
    for (const [name, value] of Object.entries(said)) {
      if (name === 'color') continue;
      if (!extra[name]) extra[name] = { size: value.length, array: new Float32Array(verts * value.length) };
      const { size, array } = extra[name];
      for (let i = 0; i < n; i++) array.set(value, (v + i) * size);
    }
    for (let i = 0; i < p.index.length; i++) index[k + i] = p.index[i] + v;
    v += n;
    k += p.index.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  for (const [name, { size, array }] of Object.entries(extra)) {
    g.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/* Both files, parsed. Rejects if either is missing or malformed; the
   caller keeps the procedural riders in that case. */
export async function loadRiderModels(fetcher = globalThis.fetch) {
  const get = async (url) => {
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`rider model: ${url} ${res.status}`);
    return parseRiderGlb(await res.arrayBuffer());
  };
  const [rider, npcs] = await Promise.all([get(RIDER_GLB), get(NPC_GLB)]);
  return { rider, npcs };
}
