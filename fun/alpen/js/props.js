/* Everything standing on the mountain: trees, shrubs, rocks, slalom gates
   and the kickers.

   The hill is filled a band at a time — forty metres of it — and every band
   is generated from its own index, so the same stretch of mountain always
   grows the same forest. Bands behind the rider are dropped and their
   instances handed to bands ahead. Nothing is stored between visits because
   nothing needs to be: the seed is the coordinate.

   Kickers are the exception, and they are the reason `liftAt` exists. A
   kicker is a shape added to the height function rather than a mesh placed
   on top of one, so the rider rides it for the same reason it rides the
   hill — it is simply what the ground does there. Its mesh is built by
   sampling the same sum, which is why the two can never disagree. */

import { heightAt, pisteCenter } from './terrain.js';
import { stream } from './noise.js';
import { PROPS, TERRAIN } from './config.js';

const { band, ahead, behind, ramp: RAMP } = PROPS;

const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/* Kinds, as the collision list reports them */
export const HARD = 0;   // puts a rider down
export const SOFT = 1;   // costs speed and throws powder
export const JUMPABLE = 2; // hard, but low enough to clear

/* ==========================================================================
   Instanced pools
   ========================================================================== */

class Pool {
  constructor(THREE, geometry, material, capacity, tinted = false) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.capacity = capacity;
    this.n = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.tinted = tinted;
    if (tinted) this.mesh.setColorAt(0, new THREE.Color(0xffffff));
  }

  begin() {
    this.n = 0;
  }

  add(x, y, z, rotY, sx, sy, sz, color) {
    if (this.n >= this.capacity) return;
    this.e.set(0, rotY, 0);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    if (this.tinted && color) this.mesh.setColorAt(this.n, color);
    this.n += 1;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.tinted && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/* ==========================================================================
   The field
   ========================================================================== */

export function createProps(THREE) {
  const group = new THREE.Group();
  const bands = ahead + behind + 1;

  const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

  // --- geometry, all of it translated so the origin sits at ground level ---
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.24, 1.7, 6, 1, true);
  trunkGeo.translate(0, 0.85, 0);
  const coneGeo = new THREE.ConeGeometry(1.3, 3.6, 7);
  coneGeo.translate(0, 3.1, 0);
  const capGeo = new THREE.ConeGeometry(0.95, 1.9, 7);
  capGeo.translate(0, 4.3, 0);
  const shrubGeo = new THREE.IcosahedronGeometry(0.62, 0);
  shrubGeo.scale(1, 0.72, 1);
  shrubGeo.translate(0, 0.32, 0);
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5);
  poleGeo.translate(0, 1.15, 0);
  const flagGeo = new THREE.PlaneGeometry(0.72, 0.46);
  flagGeo.translate(0.36, 1.95, 0);

  const trees = new Pool(THREE, trunkGeo, flat('#5d4936'), bands * PROPS.treesPerBand + 40);
  const foliage = new Pool(THREE, coneGeo, flat('#376f52'), trees.capacity, true);
  const caps = new Pool(THREE, capGeo, flat('#e9f1fb'), trees.capacity);
  const shrubs = new Pool(THREE, shrubGeo, flat('#ffffff'), bands * PROPS.shrubsPerBand + 30, true);
  const rocks = new Pool(THREE, rockGeo, flat('#828892'), bands * PROPS.rocksPerBand + 20);
  const poles = new Pool(THREE, poleGeo, flat('#2a2f38'), bands * 2 + 8);
  const flags = new Pool(THREE, flagGeo,
    new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide }), poles.capacity, true);

  const pools = [trees, foliage, caps, shrubs, rocks, poles, flags];
  pools.forEach((p) => group.add(p.mesh));

  // --- kickers -------------------------------------------------------------
  // A kicker's mesh is a small grid sampled from `heightAt + liftAt`, so it
  // is a picture of the physics rather than a second opinion about it.
  const RC = 10; // columns across the ramp
  const RR = 14; // rows down it, the last of which is the drop behind the lip
  const rampSnow = new THREE.Color('#f6faff');
  const rampLip = new THREE.Color('#ffc400');

  const ramps = [];
  const rampMeshes = [];
  for (let i = 0; i < PROPS.maxRamps; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RC + 1) * (RR + 1) * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array((RC + 1) * (RR + 1) * 3), 3));
    const idx = new Uint16Array(RC * RR * 6);
    let t = 0;
    for (let r = 0; r < RR; r++) {
      for (let c = 0; c < RC; c++) {
        const a = r * (RC + 1) + c;
        idx[t++] = a; idx[t++] = a + 1; idx[t++] = a + RC + 1;
        idx[t++] = a + 1; idx[t++] = a + RC + 2; idx[t++] = a + RC + 1;
      }
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    rampMeshes.push(mesh);
  }

  /* How much a kicker adds to the ground at a point. Zero almost everywhere,
     which is what makes it cheap enough to call from inside the physics step
     five times over (once for the height, four for the normal). */
  function liftAt(x, z) {
    let lift = 0;
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      const t = (r.z + RAMP.length / 2 - z) / RAMP.length;
      if (t <= 0 || t >= 1) continue;
      const dx = Math.abs(x - r.x) / RAMP.halfWidth;
      if (dx >= 1) continue;
      // Flat across the middle and steep at the edges, so the takeoff is a
      // straight lip you can read from a hundred metres. A quadratic taper —
      // which is what this was — makes a dome with a curved edge, and a
      // curved edge is not a jump, it is a hill.
      const across = 1 - smoothstep(0.55, 1, dx);
      // t² rather than t: the kicker is flat where it is entered and steep
      // where it is left, which is what makes the lip throw rather than ramp
      lift += RAMP.height * t * t * across;
    }
    return lift;
  }

  function buildRampMesh(mesh, r) {
    const pos = mesh.geometry.attributes.position.array;
    const col = mesh.geometry.attributes.color.array;
    const baseY = heightAt(r.x, r.z);
    mesh.position.set(r.x, baseY, r.z);

    const w = RAMP.halfWidth + 0.9;
    const zTop = r.z + RAMP.length / 2;
    // One row past the lip, where the lift is gone: that row is the drop
    const zEnd = r.z - RAMP.length / 2 - 0.55;
    let p = 0;
    for (let row = 0; row <= RR; row++) {
      const wz = zTop + (zEnd - zTop) * (row / RR);
      for (let c = 0; c <= RC; c++) {
        const wx = r.x - w + (2 * w * c) / RC;
        pos[p] = wx - r.x;
        pos[p + 1] = heightAt(wx, wz) + liftAt(wx, wz) - baseY;
        pos[p + 2] = wz - r.z;
        // The lip gets the company yellow. At 240 pixels tall a kicker has
        // to announce itself from further away than its silhouette can.
        const lip = row >= RR - 2 && row <= RR - 1 ? 1 : 0;
        const c3 = lip ? rampLip : rampSnow;
        col[p] = c3.r; col[p + 1] = c3.g; col[p + 2] = c3.b;
        p += 3;
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.visible = true;
  }

  // --- collision -----------------------------------------------------------
  // Flat array of {x, z, r, kind, top}, rebuilt whenever the bands change.
  // A few hundred entries, scanned by z-window in the rider's step.
  const solids = [];

  // --- band generation -----------------------------------------------------
  const tint = new THREE.Color();
  const gateA = new THREE.Color('#00ffc3');
  const gateB = new THREE.Color('#ffc400');
  // Light enough to still be green on the shaded side of a bank. A pine at
  // #204a35 under a fill light is a black triangle, which is a fine
  // silhouette and a poor tree.
  const foliageTints = ['#376f52', '#2c6244', '#417c5c', '#4a8765'].map((c) => new THREE.Color(c));
  const shrubTints = ['#ffffff', '#eef4fb', '#dfeadd', '#e8f0f6'].map((c) => new THREE.Color(c));

  let currentBand = NaN;

  function place(b) {
    const rnd = stream(b * 2654435761);
    const z0 = b * band;
    const travelled = Math.max(0, -z0);
    const { corridorHalf } = TERRAIN;

    // Every offset below is measured from the middle of the piste at that
    // point, never from the world's x = 0. The route wanders by thirty
    // metres, so an absolute placement plants a forest across the run.

    // --- forest, either side of the corridor -------------------------------
    for (let i = 0; i < PROPS.treesPerBand; i++) {
      const z = z0 + rnd() * band;
      const side = rnd() < 0.5 ? -1 : 1;
      // pow biases the crowd towards the treeline rather than the far edge,
      // and the spread reaches the top of the bank so the ridges are wooded
      const off = corridorHalf - 2.5 + Math.pow(rnd(), 0.6) * 88;
      const x = pisteCenter(z) + side * off;
      const y = heightAt(x, z);
      const s = 0.7 + rnd() * 0.75;
      const rot = rnd() * Math.PI * 2;
      trees.add(x, y, z, rot, s, s, s);
      foliage.add(x, y, z, rot, s, s * (0.85 + rnd() * 0.4), s,
        foliageTints[(rnd() * foliageTints.length) | 0]);
      caps.add(x, y, z, rot, s * 0.95, s * (0.7 + rnd() * 0.5), s * 0.95);
      solids.push({ x, z, r: 0.55 + s * 0.4, kind: HARD, top: 99 });
    }

    // --- trees on the piste, once the run has warmed up --------------------
    const innerCount = Math.min(
      PROPS.innerTreesMax,
      Math.floor((travelled - PROPS.innerTreesAt) / 700) + 1,
    );
    for (let i = 0; i < innerCount; i++) {
      if (rnd() > 0.72) continue;
      const z = z0 + rnd() * band;
      const side = rnd() < 0.5 ? -1 : 1;
      const off = PROPS.clearLane + rnd() * (corridorHalf - PROPS.clearLane - 2);
      const x = pisteCenter(z) + side * off;
      const y = heightAt(x, z);
      const s = 0.8 + rnd() * 0.5;
      const rot = rnd() * Math.PI * 2;
      trees.add(x, y, z, rot, s, s, s);
      foliage.add(x, y, z, rot, s, s, s, foliageTints[(rnd() * foliageTints.length) | 0]);
      caps.add(x, y, z, rot, s * 0.95, s, s * 0.95);
      solids.push({ x, z, r: 0.55 + s * 0.4, kind: HARD, top: 99 });
    }

    // --- shrubs: scenery that costs speed ----------------------------------
    for (let i = 0; i < PROPS.shrubsPerBand; i++) {
      const z = z0 + rnd() * band;
      const off = (rnd() * 2 - 1) * 62;
      if (Math.abs(off) < PROPS.clearLane * 0.5) continue;
      const x = pisteCenter(z) + off;
      const y = heightAt(x, z);
      const s = 0.7 + rnd() * 0.9;
      shrubs.add(x, y - 0.12, z, rnd() * Math.PI * 2, s, s * (0.7 + rnd() * 0.5), s,
        shrubTints[(rnd() * shrubTints.length) | 0]);
      solids.push({ x, z, r: 0.55 * s, kind: SOFT, top: 99 });
    }

    // --- rocks: low enough to clear if you see them coming -----------------
    for (let i = 0; i < PROPS.rocksPerBand; i++) {
      const z = z0 + rnd() * band;
      const off = (rnd() * 2 - 1) * (corridorHalf + 10);
      if (Math.abs(off) < PROPS.clearLane * 0.6) continue;
      const x = pisteCenter(z) + off;
      const y = heightAt(x, z);
      const s = 0.5 + rnd() * 0.55;
      rocks.add(x, y - s * 0.45, z, rnd() * Math.PI * 2, s, s * 0.8, s);
      solids.push({ x, z, r: s * 0.9, kind: JUMPABLE, top: y + s * 0.7 });
    }

    // --- slalom gates: no collision, just a line to take -------------------
    if (rnd() < PROPS.gateChance) {
      const z = z0 + rnd() * band;
      const cx = pisteCenter(z) + (rnd() * 2 - 1) * 12;
      const colour = rnd() < 0.5 ? gateA : gateB;
      for (const side of [-1, 1]) {
        const x = cx + side * 2.6;
        const y = heightAt(x, z);
        poles.add(x, y, z, 0, 1, 1, 1);
        flags.add(x, y, z, side < 0 ? 0 : Math.PI, 1, 1, 1, tint.copy(colour));
      }
    }

    // --- kickers -----------------------------------------------------------
    if (rnd() < PROPS.rampChance) {
      const z = z0 + 6 + rnd() * (band - 12);
      const x = pisteCenter(z) + (rnd() * 2 - 1) * 12;
      ramps.push({ x, z, key: b });
    }
  }

  function rebuild(riderZ) {
    pools.forEach((p) => p.begin());
    solids.length = 0;
    ramps.length = 0;

    const bi = Math.floor(riderZ / band);
    for (let b = bi + behind; b >= bi - ahead; b--) place(b);

    pools.forEach((p) => p.end());

    // Keep only the kickers nearest the rider — the rest are too far into
    // the fog to be worth a mesh
    ramps.sort((a, b) => Math.abs(a.z - riderZ) - Math.abs(b.z - riderZ));
    ramps.length = Math.min(ramps.length, PROPS.maxRamps);
    rampMeshes.forEach((m, i) => {
      if (i < ramps.length) buildRampMesh(m, ramps[i]);
      else m.visible = false;
    });
  }

  function update(riderZ) {
    const bi = Math.floor(riderZ / band);
    if (bi === currentBand) return;
    currentBand = bi;
    rebuild(riderZ);
  }

  return { group, update, liftAt, solids, ramps };
}
