/* Everything standing on the mountain: trees, shrubs, rocks, slalom gates,
   the kickers and the park.

   The hill is filled a band at a time — forty metres of it — and every band
   is generated from its own index, so the same stretch of mountain always
   grows the same forest. Bands behind the rider are dropped and their
   instances handed to bands ahead. Nothing is stored between visits because
   nothing needs to be: the seed is the coordinate.

   Kickers are the exception, and they are the reason `liftAt` exists. A
   kicker is a shape added to the height function rather than a mesh placed
   on top of one, so the rider rides it for the same reason it rides the
   hill — it is simply what the ground does there. Its mesh is built by
   sampling the same sum, which is why the two can never disagree.

   The forest used to be one tree. A cylinder, a cone and a smaller cone,
   scaled to three sizes and tinted four greens — and a hillside of that
   reads as wallpaper, because every silhouette is the same silhouette and
   the eye finds the repeat immediately. These are grown instead: a trunk,
   whorls of branches that shorten as they climb it, needles hung on the
   whorls, and snow on top of the needles. Twelve of them are grown once at
   load from fixed seeds and then instanced, so a forest of three hundred
   trees costs twelve draw calls and no two neighbours are the same tree. */

import { heightAt, nearestCenter, corridorHalfAt, centersAt, gradeAt } from './terrain.js';
import { stream, hash2 } from './noise.js';
import { compose } from './geom.js';
import { PROPS } from './config.js';

const { band, ahead, behind, park: PARK, rail: RAIL, ramp: RAMP } = PROPS;

/* A kicker, specified by the angle it should throw at.

   The lift is height·t³ over the ramp's length, so the slope at the lip is
   3·height/length — and the hill underneath is falling away at `grade` at
   the same time, so what the rider actually leaves with is the difference.
   Solving that for the length is the whole of this function, and it is what
   makes every kicker on the mountain throw at the same angle above the slope
   it happens to be built on, whatever size it is. */
function makeRamp(x, z, height, key) {
  const slope = gradeAt(z) + RAMP.kick;
  return {
    x, z, key, height,
    length: (RAMP.power * height) / slope,
    halfWidth: RAMP.halfWidth + height * RAMP.widthPerHeight,
  };
}
const TAU = Math.PI * 2;

const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const lerp = (a, b, t) => a + (b - a) * t;

/* Kinds, as the collision list reports them */
export const HARD = 0;   // puts a rider down
export const SOFT = 1;   // costs speed and throws powder
export const JUMPABLE = 2; // hard, but low enough to clear

/* ==========================================================================
   Growing a tree

   The recursion is the oldest one in graphics and it is still the cheapest
   way to get a hundred trees that are recognisably one species and none of
   them the same tree. A conifer is not really a fractal, though — it is a
   leader with whorls of laterals hung off it, each whorl shorter than the
   one below — so that is what this builds, and the branching recursion is
   kept for the one species that genuinely wants it, the dead larch with no
   needles left to hide its structure.

   Everything is emitted in `compose`'s part format and baked into a single
   geometry per variant, so a tree is one draw call however many branches it
   turned out to have.
   ========================================================================== */

const SPECIES = [
  {
    name: 'spruce',            // tall, narrow, holds a spire
    bark: '#4a3a2b',
    needles: ['#2f6b4c', '#276144', '#356f52'],
    height: [8, 15], whorls: [7, 10], reach: 0.30, droop: 0.34,
    spire: 1.5, snow: 0.55, lean: 0.05,
  },
  {
    name: 'fir',               // broader, layered, the classic christmas card
    bark: '#54402e',
    needles: ['#376f52', '#417c5c', '#2c6244'],
    height: [6, 11], whorls: [6, 8], reach: 0.42, droop: 0.26,
    spire: 1.1, snow: 0.7, lean: 0.07,
  },
  {
    name: 'pine',              // leggy, bare below, tufted at the top
    bark: '#6b5138',
    needles: ['#4a8765', '#3d7a58'],
    height: [9, 16], whorls: [3, 5], reach: 0.34, droop: 0.05,
    spire: 0.7, snow: 0.3, lean: 0.10, bareTo: 0.55,
  },
  {
    name: 'larch',             // dead, bare, all structure and no needles
    bark: '#8c8579',
    needles: null,
    height: [5, 9], whorls: [4, 6], reach: 0.40, droop: 0.12,
    spire: 0.5, snow: 0.15, lean: 0.16, branchy: true,
  },
];

/* Turning a direction into the euler `compose` will accept. A unit cylinder
   stands on +Y, so this is the pair of angles that take (0,1,0) to `d`:
   pitch away from vertical, then yaw around it. The order matters and it is
   not the default one, which is why the array carries it. */
function aim(dx, dy, dz) {
  const pitch = Math.acos(Math.max(-1, Math.min(1, dy)));
  const yaw = Math.atan2(dx, dz);
  return [pitch, yaw, 0, 'YXZ'];
}

function growTree(THREE, seed, spec, geos) {
  const rnd = stream(seed);
  const parts = [];
  const pick = (a) => a[(rnd() * a.length) | 0];

  const height = lerp(spec.height[0], spec.height[1], rnd());
  const whorls = Math.round(lerp(spec.whorls[0], spec.whorls[1], rnd()));
  const trunkR = height * 0.021 + 0.04;
  const needle = spec.needles ? pick(spec.needles) : null;
  const bareTo = spec.bareTo || 0.16;

  // The leader. One cylinder, tapered by scaling its top — a tree that is
  // the same thickness at the tip as at the root reads as a telegraph pole.
  parts.push({
    geo: geos.trunk, color: spec.bark,
    pos: [0, 0, 0], rot: [spec.lean * (rnd() - 0.5) * 2, rnd() * TAU, 0],
    scale: [trunkR * 2, height, trunkR * 2],
  });

  /* A branch, and — for the species that has no needles to hide behind —
     the branches that come off it. `depth` is spent on the way out; below
     `minLength` there is nothing left worth a cylinder. */
  function branch(x, y, z, dx, dy, dz, len, rad, depth) {
    if (len < PROPS.trees.minLength) return;
    parts.push({
      geo: geos.trunk, color: spec.bark,
      pos: [x, y, z], rot: aim(dx, dy, dz), scale: [rad * 2, len, rad * 2],
    });
    const ex = x + dx * len;
    const ey = y + dy * len;
    const ez = z + dz * len;
    if (depth <= 0) return;
    for (let i = 0; i < 2; i++) {
      const a = rnd() * TAU;
      const spread = 0.45 + rnd() * 0.5;
      // Push the child off its parent's direction by `spread`, around a
      // random azimuth. Cheap, and at twenty metres indistinguishable from
      // doing it properly with a frame.
      const nx = dx + Math.cos(a) * spread;
      const ny = dy + 0.25 + rnd() * 0.3;
      const nz = dz + Math.sin(a) * spread;
      const l = Math.hypot(nx, ny, nz) || 1;
      branch(ex, ey, ez, nx / l, ny / l, nz / l,
        len * (0.62 + rnd() * 0.16), rad * 0.68, depth - 1);
    }
  }

  for (let w = 0; w < whorls; w++) {
    const t = bareTo + (0.97 - bareTo) * (whorls === 1 ? 0.5 : w / (whorls - 1));
    const y = height * t;
    // Laterals shorten as they climb, which is the whole silhouette
    const len = height * spec.reach * Math.pow(1 - t, 0.7) + 0.3;
    const count = 4 + ((rnd() * 3) | 0);
    const base = rnd() * TAU;
    // Low branches hang, high ones lift a little
    const pitch = -spec.droop * (1 - t) + 0.12 * t;
    const dy = Math.sin(pitch);
    const flat = Math.cos(pitch);

    for (let i = 0; i < count; i++) {
      const a = base + (i / count) * TAU + (rnd() - 0.5) * 0.4;
      const l = len * (0.75 + rnd() * 0.5);
      branch(0, y, 0, Math.cos(a) * flat, dy, Math.sin(a) * flat,
        l, trunkR * 0.34 * (1 - t * 0.5) + 0.02,
        spec.branchy ? PROPS.trees.depth - 2 : 0);
    }

    // Needles, as one flattened cone per whorl rather than a clump per
    // branch. Twenty vertices instead of two hundred, and at any distance
    // the game is played at, the same picture.
    if (needle) {
      const r = len * 1.02;
      const hgt = (height / whorls) * 1.5;
      parts.push({
        geo: geos.cone, color: needle,
        pos: [0, y - hgt * 0.18, 0], rot: [0, rnd() * TAU, 0],
        scale: [r, hgt, r],
      });
      /* and the snow that sits on them, a shade smaller and a little higher.

         Painted in the same glacier as the ground rather than the near-white
         it used to be. Snow on a branch is snow that fell out of the same sky
         as the snow underneath it, and a tree wearing a whiter one than the
         hill is a tree that has been cut out and pasted on. */
      if (rnd() < spec.snow) {
        parts.push({
          geo: geos.cone, color: '#d6e3f4',
          pos: [0, y + hgt * 0.10, 0], rot: [0, rnd() * TAU, 0],
          scale: [r * 0.82, hgt * 0.62, r * 0.82],
        });
      }
    }
  }

  // The spire. A conifer without one reads as a bush that got tall.
  if (needle && spec.spire > 0.2) {
    parts.push({
      geo: geos.cone, color: needle,
      pos: [0, height * 0.94, 0], scale: [height * 0.09, height * 0.16 * spec.spire, height * 0.09],
    });
  }

  return { geometry: compose(THREE, parts), height };
}

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

export function createProps(THREE, shading) {
  const group = new THREE.Group();
  const bands = ahead + behind + 1;

  // Every material the field makes goes through the shared shading, which is
  // the only reason a tree and the snow it is standing in are lit by the same
  // five bands and dissolve into the same sky. There is no unpatched path out
  // of these two functions on purpose — a prop that forgot is a prop that
  // stops belonging to the mountain the moment the light moves.
  const flat = (color) => shading.apply(
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  const vcol = () => shading.apply(
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );

  // --- the trees ------------------------------------------------------------
  // Unit stock the growth uses: a cylinder standing on the origin and a cone
  // doing the same, both open-ended because nothing ever sees inside one.
  const sides = PROPS.trees.sides;
  const trunkGeo = new THREE.CylinderGeometry(0.34, 0.5, 1, sides, 1, true);
  trunkGeo.translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, sides + 1, 1, true);
  coneGeo.translate(0, 0.5, 0);
  const geos = { trunk: trunkGeo, cone: coneGeo };

  const treePools = [];
  const treeHeights = [];
  for (let i = 0; i < PROPS.trees.variants; i++) {
    const spec = SPECIES[i % SPECIES.length];
    const grown = growTree(THREE, 0x51ed27 + i * 7919, spec, geos);
    treeHeights.push(grown.height);
    // Capacity is generous: variants are chosen per tree by hash and the
    // draw is short-circuited by `count`, so an unused pool costs nothing
    const pool = new Pool(THREE, grown.geometry, vcol(),
      Math.ceil((bands * PROPS.treesPerBand + 60) / PROPS.trees.variants) * 3, true);
    treePools.push(pool);
    group.add(pool.mesh);
  }

  // --- everything else ------------------------------------------------------
  const shrubGeo = new THREE.IcosahedronGeometry(0.62, 0);
  shrubGeo.scale(1, 0.72, 1);
  shrubGeo.translate(0, 0.32, 0);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5);
  poleGeo.translate(0, 1.15, 0);
  const flagGeo = new THREE.PlaneGeometry(0.72, 0.46);
  flagGeo.translate(0.36, 1.95, 0);
  // Laid down the fall line at construction rather than rotated per instance,
  // so a rail is placed with the same plain scale-and-translate every other
  // pool uses and its length is simply its z scale
  const railGeo = new THREE.CylinderGeometry(RAIL.radius, RAIL.radius, 1, 6);
  railGeo.rotateX(Math.PI / 2);
  const railPostGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
  railPostGeo.translate(0, 0.5, 0);

  // The shrub's own colour stays white because it is not a colour, it is the
  // identity the per-instance tints below are multiplied through
  const shrubs = new Pool(THREE, shrubGeo, flat('#ffffff'), bands * PROPS.shrubsPerBand + 30, true);
  const rocks = new Pool(THREE, rockGeo, flat('#5f6a7c'), bands * PROPS.rocksPerBand + 20);
  const poles = new Pool(THREE, poleGeo, flat('#2a2f38'), bands * 2 + 16);
  const flags = new Pool(THREE, flagGeo,
    shading.apply(new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide })),
    poles.capacity, true);
  const railBars = new Pool(THREE, railGeo, flat('#aab6c8'), 8);
  const railPosts = new Pool(THREE, railPostGeo, flat('#2a2f38'), 32);

  const pools = [shrubs, rocks, poles, flags, railBars, railPosts];
  pools.forEach((p) => group.add(p.mesh));
  const allPools = pools.concat(treePools);

  // --- kickers -------------------------------------------------------------
  // A kicker's mesh is a small grid sampled from `heightAt + liftAt`, so it
  // is a picture of the physics rather than a second opinion about it. They
  // now come in sizes: the park lays out a graded line of them, and a found
  // one out on the piste is the modest end of the range.
  const RC = 10; // columns across the ramp
  const RR = 14; // rows down it, the last of which is the drop behind the lip
  // Built snow, packed harder and a shade brighter than the piste it stands
  // on — but the same glacier, because a kicker made of a whiter snow than
  // the mountain reads as a prop dropped onto it. The lip is the one amber
  // the palette allows, and it is spent here because a lip you cannot find
  // is a lip you take at the wrong speed.
  const rampSnow = new THREE.Color('#e3eefb');
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
    const mesh = new THREE.Mesh(g, vcol());
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
      const t = (r.z + r.length / 2 - z) / r.length;
      if (t <= 0 || t >= 1) continue;
      const dx = Math.abs(x - r.x) / r.halfWidth;
      if (dx >= 1) continue;
      // Flat across the middle and steep at the edges, so the takeoff is a
      // straight lip you can read from a hundred metres. A quadratic taper
      // makes a dome with a curved edge, and a curved edge is not a jump.
      const across = 1 - smoothstep(0.55, 1, dx);
      // t³ rather than t: the kicker is nearly flat where it is entered and
      // steepest exactly where it is left, which is what makes the lip throw
      // rather than ramp. The exponent and the length are chosen together —
      // see `makeRamp` — so that the slope at t = 1 beats the hill's own.
      lift += r.height * t * t * t * across;
    }
    return lift;
  }

  function buildRampMesh(mesh, r) {
    const pos = mesh.geometry.attributes.position.array;
    const col = mesh.geometry.attributes.color.array;
    const baseY = heightAt(r.x, r.z);
    mesh.position.set(r.x, baseY, r.z);

    const w = r.halfWidth + 0.9;
    const zTop = r.z + r.length / 2;
    // One row past the lip, where the lift is gone: that row is the drop
    const zEnd = r.z - r.length / 2 - 0.55;
    let p = 0;
    for (let row = 0; row <= RR; row++) {
      const wz = zTop + (zEnd - zTop) * (row / RR);
      for (let c = 0; c <= RC; c++) {
        const wx = r.x - w + (2 * w * c) / RC;
        pos[p] = wx - r.x;
        pos[p + 1] = heightAt(wx, wz) + liftAt(wx, wz) - baseY;
        pos[p + 2] = wz - r.z;
        // The lip gets the company yellow. A kicker has to announce itself
        // from further away than its silhouette can manage.
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

  // --- rails ---------------------------------------------------------------
  // A rail is not part of the height field — it is a metre-wide line in the
  // air, and putting it in `heightAt` would mean the whole mountain paid for
  // it on every sample. So it is its own short list, and the rider asks
  // about it separately, only while falling towards one.
  const rails = [];

  /* The rail the rider is close enough to catch, or null. `y` is where the
     board is: a rider passing under a rail is not grinding it. */
  function railAt(x, z, y) {
    for (let i = 0; i < rails.length; i++) {
      const r = rails[i];
      if (z > r.z0 + 0.6 || z < r.z1 - 0.6) continue;
      const t = (r.z0 - z) / (r.z0 - r.z1);
      const lineX = r.x0 + (r.x1 - r.x0) * t;
      if (Math.abs(x - lineX) > RAIL.catchWidth) continue;
      const top = r.y0 + (r.y1 - r.y0) * t + RAIL.height;
      if (Math.abs(y - top) > RAIL.catchHeight) continue;
      return r;
    }
    return null;
  }

  /* Where a rail's line sits at a point down it, for the rider to be held
     against while it is riding one. */
  function railPoint(r, z, out) {
    const t = Math.max(0, Math.min(1, (r.z0 - z) / (r.z0 - r.z1)));
    out.x = r.x0 + (r.x1 - r.x0) * t;
    out.y = r.y0 + (r.y1 - r.y0) * t + RAIL.height;
    out.z = z;
    out.t = t;
    return out;
  }

  // --- collision -----------------------------------------------------------
  // Flat array of {x, z, r, kind, top}, rebuilt whenever the bands change.
  // A few hundred entries, scanned by z-window in the rider's step.
  const solids = [];

  // --- band generation -----------------------------------------------------
  const tint = new THREE.Color();
  const gateA = new THREE.Color('#00ffc3');
  const gateB = new THREE.Color('#ffc400');
  /* A shrub is a bush with a winter's snow sitting on it, so it is painted in
     the same glacier the ground is — one stop darker, because a lump of snow
     that is exactly the colour of the snow behind it is a lump nobody sees
     until they hit it. These used to run from #ffffff down to #dfeadd, which
     was a white shrub and a faintly green one on a white hill.

     The tree tints are multipliers over vertex colours that are already
     bark and needle, so they stay near one; what has gone out of them is the
     warm stop. A cream tree in an ink-blue picture is the one thing on the
     mountain that looks lit from somewhere else. */
  const shrubTints = ['#cddcee', '#bdd0e8', '#d6e2f0', '#c4d6ea'].map((c) => new THREE.Color(c));
  const treeTints = ['#ffffff', '#eaf1ff', '#dfe9ea', '#eef0f4'].map((c) => new THREE.Color(c));
  const centres = [0, 0];

  /* Is this stretch of hill a built park, and how far into it are we? The
     park sits inside its own period so that it is a place you arrive at
     rather than something that happens continuously. */
  function parkAt(z) {
    const b = Math.floor(-z / PARK.period);
    if (b < 1) return null;
    if (hash2(b, 3313, 71) > PARK.chance) return null;
    const top = -(b * PARK.period) - (PARK.period - PARK.length) * hash2(b, 617, 72);
    const t = (top - z) / PARK.length;
    if (t <= 0 || t >= 1) return null;
    return { b, top, t };
  }

  function place(b) {
    const rnd = stream(b * 2654435761);
    const z0 = b * band;
    const travelled = Math.max(0, -z0);

    // Every offset below is measured from the middle of the piste at that
    // point, never from the world's x = 0. The route wanders, and it forks,
    // so an absolute placement plants a forest across the run.

    // --- forest, either side of the corridor -------------------------------
    for (let i = 0; i < PROPS.treesPerBand; i++) {
      const z = z0 + rnd() * band;
      const half = corridorHalfAt(z);
      centersAt(z, centres);
      // Outside whichever branch is on that side, and — when the run has
      // forked — sometimes on the island between the two, which is what
      // makes an island read as a place rather than a gap
      const side = rnd() < 0.5 ? -1 : 1;
      const island = centres[0] !== centres[1] && rnd() < 0.35;
      let x;
      if (island) {
        const gap = (centres[1] - centres[0]) / 2 - half;
        if (gap < 3) continue;
        x = (centres[0] + centres[1]) / 2 + (rnd() * 2 - 1) * (gap - 1.5);
      } else {
        const c = side < 0 ? centres[0] : centres[1];
        // pow biases the crowd towards the treeline rather than the far edge
        x = c + side * (half - 2.5 + Math.pow(rnd(), 0.6) * 78);
      }
      const y = heightAt(x, z);
      const s = 0.55 + rnd() * 0.55;
      const v = (rnd() * treePools.length) | 0;
      treePools[v].add(x, y, z, rnd() * TAU, s, s * (0.85 + rnd() * 0.35), s,
        treeTints[(rnd() * treeTints.length) | 0]);
      solids.push({ x, z, r: 0.5 + s * 0.45, kind: HARD, top: 99 });
    }

    // --- trees on the piste, once the run has warmed up --------------------
    const innerCount = Math.min(
      PROPS.innerTreesMax,
      Math.floor((travelled - PROPS.innerTreesAt) / 700) + 1,
    );
    for (let i = 0; i < innerCount; i++) {
      if (rnd() > 0.72) continue;
      const z = z0 + rnd() * band;
      const half = corridorHalfAt(z);
      const side = rnd() < 0.5 ? -1 : 1;
      const off = PROPS.clearLane + rnd() * Math.max(1, half - PROPS.clearLane - 2);
      const x = nearestCenter(0, z) + side * off;
      const y = heightAt(x, z);
      const s = 0.6 + rnd() * 0.4;
      const v = (rnd() * treePools.length) | 0;
      treePools[v].add(x, y, z, rnd() * TAU, s, s, s,
        treeTints[(rnd() * treeTints.length) | 0]);
      solids.push({ x, z, r: 0.5 + s * 0.45, kind: HARD, top: 99 });
    }

    // --- shrubs: scenery that costs speed ----------------------------------
    for (let i = 0; i < PROPS.shrubsPerBand; i++) {
      const z = z0 + rnd() * band;
      const off = (rnd() * 2 - 1) * 62;
      if (Math.abs(off) < PROPS.clearLane * 0.5) continue;
      const x = nearestCenter(0, z) + off;
      const y = heightAt(x, z);
      const s = 0.7 + rnd() * 0.9;
      shrubs.add(x, y - 0.12, z, rnd() * TAU, s, s * (0.7 + rnd() * 0.5), s,
        shrubTints[(rnd() * shrubTints.length) | 0]);
      // A shrub is knee-high, so it can be jumped like a rock can
      solids.push({ x, z, r: 0.55 * s, kind: SOFT, top: y + 0.9 * s });
    }

    // --- rocks: low enough to clear if you see them coming -----------------
    for (let i = 0; i < PROPS.rocksPerBand; i++) {
      const z = z0 + rnd() * band;
      const half = corridorHalfAt(z);
      const off = (rnd() * 2 - 1) * (half + 10);
      if (Math.abs(off) < PROPS.clearLane * 0.6) continue;
      const x = nearestCenter(0, z) + off;
      const y = heightAt(x, z);
      const s = 0.5 + rnd() * 0.6;
      rocks.add(x, y - s * 0.45, z, rnd() * TAU, s, s * 0.8, s);
      solids.push({ x, z, r: s * 0.9, kind: JUMPABLE, top: y + s * 0.7 });
    }

    // A band runs from z0 up to z0 + band, so this is what "inside it" means
    // for anything the park lays out at a fixed point down the mountain
    const inBand = (z) => z >= z0 && z < z0 + band;
    const parked = parkAt(z0 + band / 2);

    // --- slalom gates ------------------------------------------------------
    // Out on the piste they are a line to take; at the head of a park they
    // are the sign that says one is coming, which is the difference between
    // a park and an ambush.
    if (parked) {
      const z = parked.top - 6;
      if (inBand(z)) {
        const cx = nearestCenter(0, z);
        for (const side of [-1, 1]) {
          const x = cx + side * 5.5;
          const y = heightAt(x, z);
          poles.add(x, y, z, 0, 1, 1, 1);
          flags.add(x, y, z, side < 0 ? 0 : Math.PI, 1, 1, 1, tint.copy(gateA));
        }
      }
    } else if (rnd() < PROPS.gateChance) {
      const z = z0 + rnd() * band;
      const cx = nearestCenter(0, z) + (rnd() * 2 - 1) * 12;
      const colour = rnd() < 0.5 ? gateA : gateB;
      for (const side of [-1, 1]) {
        const x = cx + side * 2.6;
        const y = heightAt(x, z);
        poles.add(x, y, z, 0, 1, 1, 1);
        flags.add(x, y, z, side < 0 ? 0 : Math.PI, 1, 1, 1, tint.copy(colour));
      }
    }

    // --- kickers -----------------------------------------------------------
    if (parked) {
      /* A park lays its kickers out in a graded line rather than scattering
         them, so the run through it is a sentence: something small to get
         the timing, something bigger, then the one worth the trouble. */
      const step = PARK.length / (PARK.kickers.length + 1);
      for (let i = 0; i < PARK.kickers.length; i++) {
        const z = parked.top - step * (i + 1);
        if (!inBand(z)) continue;
        ramps.push(makeRamp(nearestCenter(0, z), z, PARK.kickers[i], `${parked.b}:${i}`));
      }
      // and a rail, off to one side of the line the kickers make
      if (hash2(parked.b, 887, 73) < PARK.railChance) {
        const z = parked.top - PARK.length * 0.5;
        if (inBand(z)) {
          const cx = nearestCenter(0, z) + (hash2(parked.b, 41, 74) < 0.5 ? -7 : 7);
          rails.push({
            x0: cx, z0: z + RAIL.length / 2,
            x1: cx, z1: z - RAIL.length / 2,
            y0: heightAt(cx, z + RAIL.length / 2),
            y1: heightAt(cx, z - RAIL.length / 2),
            key: parked.b,
          });
        }
      }
    } else if (rnd() < PROPS.rampChance) {
      const z = z0 + 6 + rnd() * (band - 12);
      const h = RAMP.height[0] + rnd() * (RAMP.height[1] - RAMP.height[0]);
      ramps.push(makeRamp(nearestCenter(0, z) + (rnd() * 2 - 1) * 12, z, h, b));
    }
  }

  function rebuild(riderZ) {
    allPools.forEach((p) => p.begin());
    solids.length = 0;
    ramps.length = 0;
    rails.length = 0;

    const bi = Math.floor(riderZ / band);
    for (let b = bi + behind; b >= bi - ahead; b--) place(b);

    // Keep only the kickers nearest the rider — the rest are too far into
    // the fog to be worth a mesh
    ramps.sort((a, b) => Math.abs(a.z - riderZ) - Math.abs(b.z - riderZ));
    ramps.length = Math.min(ramps.length, PROPS.maxRamps);
    rails.length = Math.min(rails.length, railBars.capacity);

    for (let i = 0; i < rails.length; i++) {
      const r = rails[i];
      const mz = (r.z0 + r.z1) / 2;
      const mx = (r.x0 + r.x1) / 2;
      const my = (r.y0 + r.y1) / 2 + RAIL.height;
      railBars.add(mx, my, mz, 0, 1, 1, RAIL.length);
      for (const e of [-1, 1]) {
        const pz = mz + (e * RAIL.length) / 2.4;
        const py = heightAt(mx, pz);
        railPosts.add(mx, py, pz, 0, 1, Math.max(0.2, my - py), 1);
      }
    }

    allPools.forEach((p) => p.end());

    rampMeshes.forEach((m, i) => {
      if (i < ramps.length) buildRampMesh(m, ramps[i]);
      else m.visible = false;
    });
  }

  let currentBand = NaN;

  function update(riderZ) {
    const bi = Math.floor(riderZ / band);
    if (bi === currentBand) return;
    currentBand = bi;
    rebuild(riderZ);
  }

  return { group, update, liftAt, railAt, railPoint, solids, ramps, rails };
}
