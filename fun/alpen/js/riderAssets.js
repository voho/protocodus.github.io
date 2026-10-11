/* The riders, as modelled.

   The player and the people sharing the piste are built in Blender by
   `tools/blender/riders.py` and arrive as two files, `rider.glb` (one node
   per rigid segment of the rig) and `npcs.glb` (each figure's deck and body
   halves, plus the headgear and pack they are dressed in). See MODELS.md.

   The files are read by `glb.js`, not the glTF loader: they are ours and
   their shape is fixed by the script that writes them, so the same small
   reader runs in the browser and in the node checks.

   COLOUR IS A ROLE, NOT A PIXEL. Every primitive's material is named for
   what it is — `shell`, `trim`, `npcJacket` — and carries nothing else. The
   rig and the figures decide what each role looks like (`riderModel.js`,
   `mountainLife.js`), so the palette, the cloth masks and the per-figure
   dress stay written down where the rest of the art direction is, and a
   rebuild in Blender can never quietly change a colour. */

import { parseGlb } from './glb.js';

export const RIDER_GLB = new URL('../assets/models/riders/rider.glb', import.meta.url).href;
export const NPC_GLB = new URL('../assets/models/riders/npcs.glb', import.meta.url).href;

/* name → { prims: [{ role, position, normal, index }], extras } for every
   node that carries a mesh (see glb.js, which refuses any node not at its
   segment's origin). */
export function parseRiderGlb(buffer) {
  const nodes = parseGlb(buffer);
  for (const node of Object.values(nodes)) {
    node.prims = node.prims.map((p) => ({
      role: p.role,
      position: p.attributes.POSITION,
      normal: p.attributes.NORMAL,
      index: p.index,
    }));
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
