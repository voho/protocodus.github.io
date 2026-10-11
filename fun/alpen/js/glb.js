/* A reader for the GLBs the Blender build scripts write — and only those.

   `tools/blender/riders.py` and `tools/blender/trees.py` export plain glTF:
   float and integer accessors, no interleaving, no compression, no textures,
   every node at its own origin (`backdrop.py` writes its file itself, to
   the same rules, with its attributes as normalised bytes). Reading exactly
   that takes fifty lines, so it is done here rather than through the
   vendored GLTFLoader, which needs a bare `three` import node cannot resolve
   — and so the checks in `tests/` read the same files through the same code
   the game does. */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPED = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array,
  5125: Uint32Array, 5126: Float32Array,
};

/* name → { prims: [{ role, attributes, index }], extras } for every node
   that carries a mesh. `role` is the primitive's material name; `attributes`
   holds every accessor by its glTF name (POSITION, NORMAL, TEXCOORD_0, and
   custom ones such as _AO), as typed arrays. A node with a transform of its
   own is refused rather than half-honoured. */
export function parseGlb(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('glb: not a GLB');
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
  if (!json || !bin) throw new Error('glb: missing chunk');

  const read = (i) => {
    const acc = json.accessors[i];
    const bv = json.bufferViews[acc.bufferView];
    const Typed = TYPED[acc.componentType];
    const size = COMPONENTS[acc.type];
    if (!Typed || !size) throw new Error('glb: unexpected accessor');
    if (bv.byteStride && bv.byteStride !== size * Typed.BYTES_PER_ELEMENT) {
      throw new Error('glb: interleaved buffers');
    }
    return new Typed(bin, (bv.byteOffset || 0) + (acc.byteOffset || 0), acc.count * size);
  };

  const nodes = {};
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    if (node.matrix || node.translation || node.rotation || node.scale) {
      throw new Error(`glb: node ${node.name} is not at its own origin`);
    }
    const prims = json.meshes[node.mesh].primitives.map((p) => ({
      role: p.material === undefined ? '' : json.materials[p.material].name,
      attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, i]) => [k, read(i)])),
      index: read(p.indices),
    }));
    nodes[node.name] = { prims, extras: node.extras || {} };
  }
  return nodes;
}
