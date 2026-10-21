/* Hedgerow — what a blast throws.

   A grenade or a charge going off throws up the ground it lay on: clods of
   mud and turf in the fields, broken stones on the cobbles. Each piece is a
   lump (one lumpy, faceted shape, stretched and turned its own way) that
   flies out and up, black against the fireball, tumbling, knocks off a wall,
   bounces once or twice and lies where it falls; the last CAP of them stay.
   One instanced mesh in the ground's wet material, a colour per piece. */

import * as THREE from 'three';

const CAP = 120;

// per surface (terrain.surfaceAt): mud and turf, or stone
const COLOURS = {
  mud: ['#2f251b', '#3b2d20', '#261e16'], grass: ['#2f2a1c', '#363a23', '#2b2419'],
  forest: ['#2c2318', '#342a1d'], cobble: ['#5e5b56', '#4b4844', '#6c675f'],
};

/* a lump: an icosphere pushed in and out by a noise of where each corner is (so shared corners
   move together), facets left sharp */
function lumpGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = g.attributes.position, v = new THREE.Vector3();
  const h = (x, y, z) => { const s = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 997) * 78.233 + Math.round(z * 997) * 37.719) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 0.72 + 0.4 * h(v.x, v.y, v.z) + 0.12 * Math.sin(v.x * 9 + v.z * 5);
    pos.setXYZ(i, v.x * k, v.y * k * 0.8, v.z * k);
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
  return g;
}

export function createChunks(G) {
  const mesh = new THREE.InstancedMesh(lumpGeometry(), G.matlib.get('dirt'), CAP);
  mesh.name = 'chunks';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  const list = [];
  let cursor = 0;
  const axis = new THREE.Vector3(), dq = new THREE.Quaternion(), m = new THREE.Matrix4(), tmp = new THREE.Vector3(), col = new THREE.Color();

  /* a blast at (x, y, z) on the ground (y its height there), `scale` (a charge 1.8), on `surface` */
  function burst(x, y, z, scale = 1, surface = 'mud') {
    const colours = COLOURS[surface] || COLOURS.mud, stone = surface === 'cobble';
    const n = Math.round((stone ? 20 : 26) * scale);
    for (let k = 0; k < n; k++) {
      let c;
      if (list.length < CAP) {
        c = { slot: list.length, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3(), rest: false };
        list.push(c);
        mesh.count = list.length;
      } else {
        c = list[cursor];
        cursor = (cursor + 1) % CAP;
      }
      const a = Math.random() * Math.PI * 2, out = (1.5 + Math.random() * 5.5) * scale;
      c.p.set(x + Math.cos(a) * 0.3 * Math.random(), y + 0.15, z + Math.sin(a) * 0.3 * Math.random());
      c.v.set(Math.cos(a) * out, (4 + Math.random() * 8) * scale, Math.sin(a) * out);
      // mostly small, now and then a big one
      const size = (0.04 + Math.pow(Math.random(), 2.0) * 0.14) * (stone ? 0.85 : 1);
      c.s.set(size * (0.7 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.5), size * (0.7 + Math.random() * 0.6));
      c.q.setFromAxisAngle(axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * 6.28);
      c.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30);
      c.rest = false;
      mesh.setColorAt(c.slot, col.set(colours[Math.floor(Math.random() * colours.length)]).multiplyScalar(0.85 + Math.random() * 0.3));
    }
    mesh.instanceColor.needsUpdate = true;
  }

  function update(dt) {
    let moved = false;
    for (const c of list) {
      if (c.rest) continue;
      moved = true;
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      const w = c.w.length();
      if (w > 1e-3) c.q.premultiply(dq.setFromAxisAngle(axis.copy(c.w).divideScalar(w), w * dt));
      // off a wall
      tmp.copy(c.p);
      const r = c.s.x * 0.5;
      if (G.world.pushOut(tmp, r, c.p.y - r, r * 2, 0.02)) {
        c.v.x = ((tmp.x - c.p.x) / Math.max(dt, 1e-3)) * 0.25; c.v.z = ((tmp.z - c.p.z) / Math.max(dt, 1e-3)) * 0.25;
        c.p.x = tmp.x; c.p.z = tmp.z;
      }
      const g = G.world.groundAt(c.p.x, c.p.z, c.p.y + 0.2, 0.25, 0.05) + c.s.y * 0.3;
      if (c.p.y < g) {
        c.p.y = g;
        if (c.v.y < -2.0) {
          // a bounce (mud gives little back), and a new tumble
          c.v.y *= -0.22; c.v.x *= 0.45; c.v.z *= 0.45;
          c.w.multiplyScalar(0.5);
        } else c.rest = true;
      }
      mesh.setMatrixAt(c.slot, m.compose(c.p, c.q, c.s));
    }
    if (moved) mesh.instanceMatrix.needsUpdate = true;
  }

  function clear() { list.length = 0; cursor = 0; mesh.count = 0; }

  return { mesh, burst, update, clear };
}
