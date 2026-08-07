/* Imported open-source models, folded into the instanced prop pipeline.

   The models are Quaternius' CC0 low-poly nature set (quaternius.com, via
   the flo-bit/tiny-planets mirror), stored under assets/models/nature. They
   arrive as ordinary glTF scenes; what the game's pools need is one merged
   BufferGeometry per variant carrying the exact attribute contract the
   procedural growers emit — position, normal, per-vertex COLOUR-AS-VALUE,
   and the `surfaceOwn` mask — so this module's whole job is translation:

   - Owned surfaces (needles, bark) are stored as grey *values*, because the
     per-instance cast is the colour: that is how a stand of imported pines
     picks up the same lit/deep greens, the same rust and ghost odds, and
     the same time-of-day response as everything else on the hill.
   - Snow keeps its own near-white colour and `surfaceOwn = 0`, which is
     what routes it into the scene's snow tint and sparkle instead.
   - Rocks bake straight into the terrain's slate or iron palette by
     luminance, since boulders are not instance-tinted at all.

   Everything loads asynchronously after the pools already exist, and the
   upgrade is a geometry hot-swap on the InstancedMesh: transforms, casts,
   shadows and sway all carry over, and if a file never arrives the grown
   procedural variant simply remains. */

import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';

const V_LO = 0.55;   // the darkest value an owned surface is allowed
const V_SPAN = 0.50; // ...and how far towards white the lightest climbs

function valueOf(lum) {
  const t = Math.min(1, Math.max(0, (lum - 0.08) / 0.32));
  return V_LO + V_SPAN * t;
}

/* One merged, non-indexed geometry from a glTF scene. `mode` decides the
   colour translation: 'tree' emits values + ownership, 'rock' emits palette
   colours from `palette` = [loHex, hiHex]. */
export function bakePoolGeometry(THREE, root, mode, palette) {
  const positions = [];
  const normals = [];
  const colors = [];
  const own = [];

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const lo = palette ? new THREE.Color(palette[0]) : null;
  const hi = palette ? new THREE.Color(palette[1]) : null;

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geo = node.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const index = geo.index;
    const count = index ? index.count : pos.count;
    nm.getNormalMatrix(node.matrixWorld);

    const c = node.material?.color ?? { r: 0.5, g: 0.5, b: 0.5 };
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const isSnow = Math.min(c.r, c.g, c.b) > 0.55;
    const isFoliage = !isSnow && c.g > c.r * 1.1 && c.g > c.b * 1.1;

    let cr;
    let cg;
    let cb;
    let ownership;
    if (isSnow) {
      // Snow answers to the scene, not to the file it came from.
      cr = 0.93; cg = 0.955; cb = 1.0;
      ownership = 0;
    } else if (mode === 'rock') {
      const t = Math.min(1, Math.max(0, (lum - 0.06) / 0.42));
      cr = lo.r + (hi.r - lo.r) * t;
      cg = lo.g + (hi.g - lo.g) * t;
      cb = lo.b + (hi.b - lo.b) * t;
      ownership = 1;
    } else {
      const value = valueOf(lum);
      cr = value; cg = value; cb = value;
      // A needled trunk takes a share of the cast; needles take all of it.
      ownership = isFoliage ? 1 : 0.6;
    }

    for (let i = 0; i < count; i++) {
      const idx = index ? index.getX(i) : i;
      v.fromBufferAttribute(pos, idx).applyMatrix4(node.matrixWorld);
      positions.push(v.x, v.y, v.z);
      n.fromBufferAttribute(nor, idx).applyMatrix3(nm).normalize();
      normals.push(n.x, n.y, n.z);
      colors.push(cr, cg, cb);
      own.push(ownership);
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  g.setAttribute('surfaceOwn', new THREE.BufferAttribute(new Float32Array(own), 1));
  return g;
}

/* Ground the geometry (base at y = 0, centred in x/z) and scale it
   uniformly to the height the pool's material was compiled for. */
function normalise(THREE, g, targetHeight, sink = 0) {
  g.computeBoundingBox();
  const box = g.boundingBox;
  const height = Math.max(0.001, box.max.y - box.min.y);
  const s = targetHeight / height;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  g.translate(-cx, -box.min.y, -cz);
  g.scale(s, s, s);
  // A little of the base below grade: a prop planted on a slope must bury
  // its lowest edge, or the downhill side stands on air.
  if (sink > 0) g.translate(0, -targetHeight * sink, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function createModelUpgrader(THREE) {
  const loader = new GLTFLoader();
  const url = (name) => new URL(
    `../assets/models/nature/${name}.gltf`, import.meta.url,
  ).href;

  /* Swap the instanced mesh's geometry in place. Existing instance
     matrices, colours and shadow bookkeeping all refer to the mesh, not
     the geometry, so nothing else has to know this ever happened. */
  function swap(pool, geometry) {
    const old = pool.mesh.geometry;
    pool.mesh.geometry = geometry;
    old.dispose();
  }

  function upgrade(pool, name, mode, targetHeight, palette, sink = 0) {
    loader.load(url(name), (gltf) => {
      const g = bakePoolGeometry(THREE, gltf.scene, mode, palette);
      swap(pool, normalise(THREE, g, targetHeight, sink));
    }, undefined, () => { /* the grown variant simply remains */ });
  }

  return { upgrade };
}
