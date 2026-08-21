/* Photo-textured card conifers.

   The grown trees and the low-poly imports both model a conifer as solid
   lumps — geometry standing in for a million needles. This builder goes the
   way real-time forests actually go: a modest trunk mesh and a few dozen
   double-quad "branch cards", each mapped onto a photoscanned fir sprig from
   Poly Haven's fir_tree_01 (CC0). The needle detail lives in the texture,
   where it is genuinely photographic, and the silhouette stays light enough
   to instance a whole treeline.

   The atlas (assets/textures/tree/spruce-card-atlas.webp, built offline —
   see assets/models/MODELS.md) is laid out for exactly this builder:

     x[0..128]              tiling fir bark, opaque — the trunk samples this
     x[128..576]  top half  sprig A, needle luminance VALUES + cutout alpha
     x[576..1024] top half  sprig B, same
     bottom half            frost variants of A and B — bluish white, alpha
                            only where snow would sit on the needle tops

   The sprigs are stored as VALUES (grey) rather than colours for the same
   reason the imported models are: the per-instance cast IS the colour, so a
   stand of card spruces scatters along the same lit/deep green axis, with
   the same rust and ghost odds, as everything else on the hill. The frost
   cards carry their own near-white and surfaceOwn = 0, which routes them
   into the scene's snow tint and sparkle instead.

   Species stay species: the card layout is driven by the same SPECIES table
   the growers use — whorl counts, reach, droop, lift, bare trunk fraction,
   snow load, storm flagging — so a weeping spruce still weeps and a storm
   pine still leans out of the wind, just wearing real needles now. */

// UV rectangles matching the atlas build (three.js flipY space: v=0 is the
// image's bottom row). Root of a sprig (its stem) sits at LOW v.
const CELLS = [
  { u0: 0.142, u1: 0.547, v0: 0.514, v1: 0.966 }, // sprig A
  { u0: 0.589, u1: 0.974, v0: 0.514, v1: 0.984 }, // sprig B
];
const FROST_DROP = 0.5; // frost variant of a cell lives half an atlas below
const BARK = { u0: 0.006, u1: 0.116, v0: 0.02, v1: 0.98 };

const SNOW_COL = [0.839, 0.890, 0.957]; // '#d6e3f4', the prop snow everywhere
const TRUNK_OWN = 0.35;                 // a trunk takes this share of the cast

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function growCardSpruce(THREE, seed, spec, height) {
  const rnd = mulberry(seed);
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  const own = [];

  /* Two triangles a-b-c, a-c-d, with each corner's uv fixed by its role:
     a=(u0,v0), b=(u1,v0), c=(u1,v1), d=(u0,v1). `flip` reverses the
     triangle winding while keeping those assignments — for a quad whose
     corners are the mirror of another's, so both come out facing the same
     way. Winding matters even on the double-sided foliage material: three
     flips a Lambert normal on back faces, and the shadow pass's depth
     material is front-side only. */
  const quad = (a, b, c, d, n, rect, mirror, vshift, colour, ownership, flip = false) => {
    const u0 = mirror ? rect.u1 : rect.u0;
    const u1 = mirror ? rect.u0 : rect.u1;
    const v0 = rect.v0 - vshift;
    const v1 = rect.v1 - vshift;
    const P = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    const U = flip
      ? [[u0, v0], [u1, v1], [u1, v0], [u0, v0], [u0, v1], [u1, v1]]
      : [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 6; i++) {
      pos.push(P[i].x, P[i].y, P[i].z);
      nrm.push(n.x, n.y, n.z);
      uv.push(U[i][0], U[i][1]);
      col.push(colour[0], colour[1], colour[2]);
      own.push(ownership);
    }
  };

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const n = new THREE.Vector3();
  const o = new THREE.Vector3();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  /* ---- trunk: two stacked open frustums, seven sides, bark-mapped ---- */
  const r0 = Math.min(0.62, height * 0.020 + 0.10);
  const r1 = r0 * 0.55;
  const rings = [[0, r0], [height * 0.55, r1], [height * 0.985, 0.035]];
  const SIDES = 7;
  const white = [1, 1, 1];
  for (let s = 0; s < 2; s++) {
    const [yA, rA] = rings[s];
    const [yB, rB] = rings[s + 1];
    for (let k = 0; k < SIDES; k++) {
      const a0 = (k / SIDES) * Math.PI * 2;
      const a1 = ((k + 1) / SIDES) * Math.PI * 2;
      const u0 = BARK.u0 + (BARK.u1 - BARK.u0) * (k / SIDES);
      const u1 = BARK.u0 + (BARK.u1 - BARK.u0) * ((k + 1) / SIDES);
      const vA = BARK.v0 + (BARK.v1 - BARK.v0) * (yA / height);
      const vB = BARK.v0 + (BARK.v1 - BARK.v0) * (yB / height);
      p[0].set(Math.cos(a0) * rA, yA, Math.sin(a0) * rA);
      p[1].set(Math.cos(a1) * rA, yA, Math.sin(a1) * rA);
      p[2].set(Math.cos(a1) * rB, yB, Math.sin(a1) * rB);
      p[3].set(Math.cos(a0) * rB, yB, Math.sin(a0) * rB);
      n.set(Math.cos((a0 + a1) / 2), (rA - rB) / Math.max(0.001, yB - yA) * 0.3, Math.sin((a0 + a1) / 2)).normalize();
      // trunk quad, hand-rolled uvs (u wraps the girth, v climbs the stem)
      const P = [p[0], p[1], p[2], p[0], p[2], p[3]];
      const U = [[u0, vA], [u1, vA], [u1, vB], [u0, vA], [u1, vB], [u0, vB]];
      for (let i = 0; i < 6; i++) {
        pos.push(P[i].x, P[i].y, P[i].z);
        nrm.push(n.x, n.y, n.z);
        uv.push(U[i][0], U[i][1]);
        col.push(1, 1, 1);
        own.push(TRUNK_OWN);
      }
    }
  }

  /* ---- branch cards, whorl by whorl ---- */
  const whorls = Math.round(spec.whorls[0] + (spec.whorls[1] - spec.whorls[0]) * rnd());
  const yFrom = height * Math.max(0.10, spec.bareTo * 0.8);
  const yTo = height * 0.93;
  const flagYaw = rnd() * Math.PI * 2; // the wind this one grew in, if flagged
  const maxR = spec.reach * height * 0.9;

  for (let w = 0; w < whorls; w++) {
    const t = whorls > 1 ? w / (whorls - 1) : 0;
    const y = yFrom + (yTo - yFrom) * Math.pow(t, 0.9);
    const R = Math.max(0.5, maxR * (1 - t * 0.85) * (0.88 + 0.24 * rnd()));
    const perW = 1 + Math.max(3, Math.round(
      spec.perWhorl[0] + (spec.perWhorl[1] - spec.perWhorl[0]) * rnd(),
    ));
    for (let b = 0; b < perW; b++) {
      const yaw = (b / perW) * Math.PI * 2 + rnd() * 1.1;
      if (spec.flag && Math.cos(yaw - flagYaw) > 0.15 && rnd() < spec.flag) continue;
      const liftT = spec.liftLow + (spec.liftHigh - spec.liftLow) * t;
      const tilt = liftT * 0.55 - spec.droop * 0.22 + (rnd() - 0.5) * 0.12;
      const L = R * (1.30 + 0.40 * rnd());
      const W = L * (0.74 + 0.20 * rnd());
      const bend = L * (0.10 + spec.droop * 0.30); // tips settle under their snow

      dir.set(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
      side.crossVectors(up, dir).normalize();
      lift.crossVectors(dir, side).normalize();

      const cell = CELLS[(rnd() * CELLS.length) | 0];
      const mirror = rnd() < 0.5;
      const fold = W * 0.16;

      o.set(Math.cos(yaw) * r1 * 0.4, y, Math.sin(yaw) * r1 * 0.4);
      n.copy(lift).multiplyScalar(0.8).addScaledVector(up, 0.55)
        .addScaledVector(dir, 0.18).normalize();

      for (const s of [-1, 1]) {
        // root edge is narrow (the stem), tip edge full width; outer long
        // edge folded down so the pair reads as a shallow drooping V
        p[0].copy(o).addScaledVector(side, s * W * 0.06);
        p[1].copy(o).addScaledVector(side, s * W * 0.5)
          .addScaledVector(lift, -fold).addScaledVector(dir, L * 0.12);
        p[2].copy(o).addScaledVector(dir, L).addScaledVector(side, s * W * 0.30)
          .addScaledVector(lift, -bend - fold * 0.5);
        p[3].copy(o).addScaledVector(dir, L).addScaledVector(lift, -bend);
        // map: u across the sprig, v root->tip. Halve u for the half-card.
        const halfU = mirror !== (s < 0)
          ? { u0: (cell.u0 + cell.u1) / 2, u1: cell.u1, v0: cell.v0, v1: cell.v1 }
          : { u0: (cell.u0 + cell.u1) / 2, u1: cell.u0, v0: cell.v0, v1: cell.v1 };
        // corners: root-centre, root-outer, tip-outer, tip-centre
        const P = [p[0], p[1], p[2], p[0], p[2], p[3]];
        const U = [
          [halfU.u0, halfU.v0], [halfU.u1, halfU.v0], [halfU.u1, halfU.v1],
          [halfU.u0, halfU.v0], [halfU.u1, halfU.v1], [halfU.u0, halfU.v1],
        ];
        for (let i = 0; i < 6; i++) {
          pos.push(P[i].x, P[i].y, P[i].z);
          nrm.push(n.x, n.y, n.z);
          uv.push(U[i][0], U[i][1]);
          col.push(1, 1, 1);
          own.push(1);
        }
      }

      /* frost overlay: the same card, a hand above, wearing the snow cell.
         More likely near the crown, where the fresh loads sit. */
      if (rnd() < spec.snow * (0.45 + 0.45 * t)) {
        p[0].copy(o).addScaledVector(lift, 0.10).addScaledVector(up, 0.05);
        p[1].copy(o).addScaledVector(side, -W * 0.5).addScaledVector(dir, L * 0.12)
          .addScaledVector(lift, 0.10 - fold).addScaledVector(up, 0.05);
        p[2].copy(o).addScaledVector(dir, L).addScaledVector(side, -W * 0.3)
          .addScaledVector(lift, 0.10 - bend - fold * 0.5).addScaledVector(up, 0.05);
        p[3].copy(o).addScaledVector(dir, L).addScaledVector(lift, 0.10 - bend)
          .addScaledVector(up, 0.05);
        quad(p[0], p[1], p[2], p[3], n, cell, mirror, FROST_DROP, SNOW_COL, 0);
        p[1].addScaledVector(side, W);
        p[2].addScaledVector(side, W * 0.6);
        /* Same corner ROLES as the first half — root-centre, root-outer,
           tip-outer, tip-centre — so u stays across the sprig and v stays
           root→tip. The old (p0, p3, p2, p1) order kept the winding right
           (these corners are the first half's mirror) but swapped which
           edges carried u and v, so the +side half wore its snow sprig
           rotated ninety degrees; passing the roles in order fixed the
           sprig and would have flipped the facing instead. `flip` keeps
           both: role-true uvs, winding matching the first half. */
        quad(p[0], p[1], p[2], p[3], n, cell, !mirror, FROST_DROP, SNOW_COL, 0, true);
      }
    }
  }

  /* ---- the spire: crossed upright cards at the crown ---- */
  if (spec.spire > 0) {
    const sh = Math.min(height * 0.22, spec.spire * 1.9);
    const sw = sh * 0.62;
    const yTop = height * 0.995;
    const cell = CELLS[0];
    for (let k = 0; k < 2; k++) {
      const a = k * Math.PI * 0.5 + rnd() * 0.4;
      side.set(Math.cos(a), 0, Math.sin(a));
      n.set(-Math.sin(a), 0.35, Math.cos(a)).normalize();
      p[0].copy(side).multiplyScalar(-sw * 0.15); p[0].y = yTop - sh;
      p[1].copy(side).multiplyScalar(sw * 0.15); p[1].y = yTop - sh;
      p[2].copy(side).multiplyScalar(sw * 0.5); p[2].y = yTop;
      p[3].copy(side).multiplyScalar(-sw * 0.5); p[3].y = yTop;
      quad(p[0], p[1], p[2], p[3], n, cell, k === 1, 0, white, 1);
      if (rnd() < spec.snow) {
        for (const q of p) q.y += 0.08;
        quad(p[0], p[1], p[2], p[3], n, cell, k === 1, FROST_DROP, SNOW_COL, 0);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('surfaceOwn', new THREE.BufferAttribute(new Float32Array(own), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
