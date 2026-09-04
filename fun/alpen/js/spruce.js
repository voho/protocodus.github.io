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
/* Solid snow — the well the tree stands in. Below zero on purpose: the card
   material reads any negative ownership as "opaque, and the vertex colour is
   the whole answer", so the well needs no opaque texel in an atlas that has
   none. The shared OWN_MIX clamps it, so every other material sees 0. */
const SOLID_SNOW_OWN = -1;

export const SPRUCE_LAYOUT = {
  cells: CELLS, frostDrop: FROST_DROP, bark: BARK, bare: false,
};

/* Ambient occlusion, baked into the card colour at build time. A canopy is
   dark inside and bright at its tips, and nothing at run time has to work
   that out: the root corners of every card sit in the crown's interior and
   the tip corners in the open. Lower whorls sit under more tree. */
const aoRoot = (t) => 0.56 + 0.22 * t;
const aoTip = (t) => 0.90 + 0.10 * t;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function growCardSpruce(THREE, seed, spec, height, layout = SPRUCE_LAYOUT) {
  const rnd = mulberry(seed);
  const CELLS = layout.cells;
  const FROST_DROP = layout.frostDrop;
  const BARK = layout.bark;
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
  /* `n` is one normal for the whole card or an array of four, one per
     corner in a-b-c-d order; `colour` likewise one triple or four. */
  const quad = (a, b, c, d, n, rect, mirror, vshift, colour, ownership, flip = false) => {
    const u0 = mirror ? rect.u1 : rect.u0;
    const u1 = mirror ? rect.u0 : rect.u1;
    const v0 = rect.v0 - vshift;
    const v1 = rect.v1 - vshift;
    const P = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    const U = flip
      ? [[u0, v0], [u1, v1], [u1, v0], [u0, v0], [u0, v1], [u1, v1]]
      : [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
    const K = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    const N = Array.isArray(n) ? n : [n, n, n, n];
    const C = Array.isArray(colour[0]) ? colour : [colour, colour, colour, colour];
    for (let i = 0; i < 6; i++) {
      const k = K[i];
      pos.push(P[i].x, P[i].y, P[i].z);
      nrm.push(N[k].x, N[k].y, N[k].z);
      uv.push(U[i][0], U[i][1]);
      col.push(C[k][0], C[k][1], C[k][2]);
      own.push(ownership);
    }
  };

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nRoot = new THREE.Vector3();
  const nTip = new THREE.Vector3();
  const o = new THREE.Vector3();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  // The trunk and every branch share one curved centreline. Variation is
  // baked once per species, so wind never pulls foliage off its timber.
  const leanYaw = rnd() * Math.PI * 2;
  const lean = height * (0.012 + rnd() * 0.030 + (spec.flag || 0) * 0.028);
  const stemX = (y) => Math.cos(leanYaw) * lean * (y / height) ** 2;
  const stemZ = (y) => Math.sin(leanYaw) * lean * (y / height) ** 2;

  /* ---- trunk: gently curved open frustums, bark-mapped ---- */
  const r0 = Math.min(0.62, height * 0.020 + 0.10);
  const r1 = r0 * 0.55;
  const rings = [[0, r0], [height * 0.30, r0 * 0.78],
    [height * 0.62, r1], [height * 0.985, 0.035]];
  const SIDES = 9;
  const white = [1, 1, 1];
  for (let s = 0; s < rings.length - 1; s++) {
    const [yA, rA] = rings[s];
    const [yB, rB] = rings[s + 1];
    for (let k = 0; k < SIDES; k++) {
      const a0 = (k / SIDES) * Math.PI * 2;
      const a1 = ((k + 1) / SIDES) * Math.PI * 2;
      const u0 = BARK.u0 + (BARK.u1 - BARK.u0) * (k / SIDES);
      const u1 = BARK.u0 + (BARK.u1 - BARK.u0) * ((k + 1) / SIDES);
      const vA = BARK.v0 + (BARK.v1 - BARK.v0) * (yA / height);
      const vB = BARK.v0 + (BARK.v1 - BARK.v0) * (yB / height);
      p[0].set(stemX(yA) + Math.cos(a0) * rA, yA, stemZ(yA) + Math.sin(a0) * rA);
      p[1].set(stemX(yA) + Math.cos(a1) * rA, yA, stemZ(yA) + Math.sin(a1) * rA);
      p[2].set(stemX(yB) + Math.cos(a1) * rB, yB, stemZ(yB) + Math.sin(a1) * rB);
      p[3].set(stemX(yB) + Math.cos(a0) * rB, yB, stemZ(yB) + Math.sin(a0) * rB);
      // Smooth corner normals keep the modest trunk round in low sunlight.
      const taper = (rA - rB) / Math.max(0.001, yB - yA) * 0.3;
      nRoot.set(Math.cos(a0), taper, Math.sin(a0)).normalize();
      nTip.set(Math.cos(a1), taper, Math.sin(a1)).normalize();
      // trunk quad, hand-rolled uvs (u wraps the girth, v climbs the stem)
      const P = [p[0], p[1], p[2], p[0], p[2], p[3]];
      const N = [nRoot, nTip, nTip, nRoot, nTip, nRoot];
      const U = [[u0, vA], [u1, vA], [u1, vB], [u0, vA], [u1, vB], [u0, vB]];
      for (let i = 0; i < 6; i++) {
        pos.push(P[i].x, P[i].y, P[i].z);
        nrm.push(N[i].x, N[i].y, N[i].z);
        uv.push(U[i][0], U[i][1]);
        col.push(1, 1, 1);
        own.push(TRUNK_OWN);
      }
    }
  }

  /* ---- the foot: a root flare, and the well of snow the tree stands in.
     The grown trees had both and the cards lost them in the swap; a bark
     cylinder meeting the snow along a clean circle is the one place a tree
     still admits to being furniture. The flare is one more ring of bark
     under the first; the well is a low cone of solid snow, rim sunk so a
     tree on a 22° bank still has a mound on its uphill side, in the prop
     snow colour and owned by nothing so no cast can tint it. Forty-odd
     triangles on a tree of four hundred. ---- */
  {
    const yFlare = -r0 * 0.45;
    const rFlare = r0 * 2.0;
    const yTop = r0 * 1.7;
    const rTop = r0 * 1.04;
    const vF = BARK.v0;
    const vT = BARK.v0 + (BARK.v1 - BARK.v0) * (yTop / height);
    for (let k = 0; k < SIDES; k++) {
      const a0 = (k / SIDES) * Math.PI * 2;
      const a1 = ((k + 1) / SIDES) * Math.PI * 2;
      const u0 = BARK.u0 + (BARK.u1 - BARK.u0) * (k / SIDES);
      const u1 = BARK.u0 + (BARK.u1 - BARK.u0) * ((k + 1) / SIDES);
      p[0].set(Math.cos(a0) * rFlare, yFlare, Math.sin(a0) * rFlare);
      p[1].set(Math.cos(a1) * rFlare, yFlare, Math.sin(a1) * rFlare);
      p[2].set(Math.cos(a1) * rTop, yTop, Math.sin(a1) * rTop);
      p[3].set(Math.cos(a0) * rTop, yTop, Math.sin(a0) * rTop);
      nRoot.set(Math.cos(a0), 0.45, Math.sin(a0)).normalize();
      nTip.set(Math.cos(a1), 0.45, Math.sin(a1)).normalize();
      const P = [p[0], p[1], p[2], p[0], p[2], p[3]];
      const N = [nRoot, nTip, nTip, nRoot, nTip, nRoot];
      const U = [[u0, vF], [u1, vF], [u1, vT], [u0, vF], [u1, vT], [u0, vT]];
      for (let i = 0; i < 6; i++) {
        pos.push(P[i].x, P[i].y, P[i].z);
        nrm.push(N[i].x, N[i].y, N[i].z);
        uv.push(U[i][0], U[i][1]);
        col.push(1, 1, 1);
        own.push(TRUNK_OWN);
      }
    }
    const WELL = 12;
    const rWell = r0 * 5.0;
    const yRim = -r0 * 1.6;
    const yApex = r0 * 1.0;
    const wellYaw = rnd() * Math.PI * 2;
    const slope = Math.atan2(rWell, yApex - yRim);
    for (let k = 0; k < WELL; k++) {
      const a0 = wellYaw + (k / WELL) * Math.PI * 2;
      const a1 = wellYaw + ((k + 1) / WELL) * Math.PI * 2;
      // a little scallop, so the rim is a drift and not a lampshade
      const s0 = 1 + 0.10 * Math.sin(a0 * 3 + 1.3);
      const s1 = 1 + 0.10 * Math.sin(a1 * 3 + 1.3);
      p[0].set(Math.cos(a0) * rWell * s0, yRim, Math.sin(a0) * rWell * s0);
      p[1].set(Math.cos(a1) * rWell * s1, yRim, Math.sin(a1) * rWell * s1);
      p[2].set(0, yApex, 0);
      nRoot.set(Math.cos(a0) * Math.cos(slope), Math.sin(slope), Math.sin(a0) * Math.cos(slope)).normalize();
      nTip.set(Math.cos(a1) * Math.cos(slope), Math.sin(slope), Math.sin(a1) * Math.cos(slope)).normalize();
      const P = [p[0], p[1], p[2]];
      const N = [nRoot, nTip, up];
      for (let i = 0; i < 3; i++) {
        pos.push(P[i].x, P[i].y, P[i].z);
        nrm.push(N[i].x, N[i].y, N[i].z);
        uv.push(BARK.u0, BARK.v0);
        col.push(SNOW_COL[0], SNOW_COL[1], SNOW_COL[2]);
        own.push(SOLID_SNOW_OWN);
      }
    }
  }

  /* ---- branch cards, whorl by whorl ---- */
  const whorls = Math.round(spec.whorls[0] + (spec.whorls[1] - spec.whorls[0]) * rnd());
  const yFrom = height * Math.max(0.10, spec.bareTo * 0.8);
  const yTo = height * 0.93;
  const flagYaw = rnd() * Math.PI * 2; // the wind this one grew in, if flagged
  const maxR = spec.reach * height * 0.9;
  const crownYaw = rnd() * Math.PI * 2;
  const crownBias = 0.10 + rnd() * 0.14;

  for (let w = 0; w < whorls; w++) {
    const t = whorls > 1 ? w / (whorls - 1) : 0;
    const y = yFrom + (yTo - yFrom) * Math.pow(t, 0.9);
    const R = Math.max(0.5, maxR * (1 - t * 0.85) * (0.88 + 0.24 * rnd()));
    const perW = 1 + Math.max(3, Math.round(
      spec.perWhorl[0] + (spec.perWhorl[1] - spec.perWhorl[0]) * rnd(),
    ));
    for (let b = 0; b < perW; b++) {
      const yaw = (b / perW) * Math.PI * 2 + w * 2.39996 + rnd() * 0.65;
      if (spec.flag && Math.cos(yaw - flagYaw) > 0.15 && rnd() < spec.flag) continue;
      const liftT = spec.liftLow + (spec.liftHigh - spec.liftLow) * t;
      const tilt = liftT * 0.55 - spec.droop * 0.22 + (rnd() - 0.5) * 0.12;
      const L = R * (1.30 + 0.40 * rnd()) * (1 + crownBias * Math.cos(yaw - crownYaw));
      const W = L * (0.74 + 0.20 * rnd());
      const bend = L * (0.10 + spec.droop * 0.30); // tips settle under their snow

      dir.set(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
      side.crossVectors(up, dir).normalize();
      lift.crossVectors(dir, side).normalize();

      const cell = CELLS[(rnd() * CELLS.length) | 0];
      const mirror = rnd() < 0.5;
      const fold = W * 0.16;

      const branchY = y + (rnd() - 0.5) * height / whorls * 0.28;
      o.set(stemX(branchY) + Math.cos(yaw) * r1 * 0.4, branchY,
        stemZ(branchY) + Math.sin(yaw) * r1 * 0.4);
      /* THE NORMALS ARE THE CANOPY'S, NOT THE CARD'S. A card lit by its own
         face normal is a flat lozenge, and a tree of them is a stack of
         lozenges that go dark one at a time as the sun moves. What a real
         conifer does is shade as one volume: bright on the sunward flank,
         dark on the far one, top-lit along the crown. So each corner takes
         a normal pointing out of the tree — radially away from the trunk,
         tilted up — and the root corners, which sit inside the canopy, lean
         further towards the sky than the tips do. Baked, so it costs
         nothing per frame; the same trick every real-time forest uses. */
      radial.set(Math.cos(yaw), 0, Math.sin(yaw));
      nRoot.copy(radial).multiplyScalar(0.50).addScaledVector(up, 0.62)
        .addScaledVector(lift, 0.30).normalize();
      nTip.copy(radial).multiplyScalar(0.85).addScaledVector(up, 0.42)
        .addScaledVector(lift, 0.22).normalize();
      n.copy(nRoot).add(nTip).normalize();
      const aoR = aoRoot(t);
      const aoT = aoTip(t);

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
        const N = [nRoot, nRoot, nTip, nRoot, nTip, nTip];
        const A = [aoR, aoR, aoT, aoR, aoT, aoT];
        const U = [
          [halfU.u0, halfU.v0], [halfU.u1, halfU.v0], [halfU.u1, halfU.v1],
          [halfU.u0, halfU.v0], [halfU.u1, halfU.v1], [halfU.u0, halfU.v1],
        ];
        for (let i = 0; i < 6; i++) {
          pos.push(P[i].x, P[i].y, P[i].z);
          nrm.push(N[i].x, N[i].y, N[i].z);
          uv.push(U[i][0], U[i][1]);
          // Needle cards own their whole colour, so the attribute is free
          // to carry the occlusion; the card material multiplies it in.
          col.push(A[i], A[i], A[i]);
          own.push(1);
        }
      }

      /* frost overlay: the same card, a hand above, wearing the snow cell.
         More likely near the crown, where the fresh loads sit. */
      if (!layout.bare && rnd() < spec.snow * (0.45 + 0.45 * t)) {
        p[0].copy(o).addScaledVector(lift, 0.10).addScaledVector(up, 0.05);
        p[1].copy(o).addScaledVector(side, -W * 0.5).addScaledVector(dir, L * 0.12)
          .addScaledVector(lift, 0.10 - fold).addScaledVector(up, 0.05);
        p[2].copy(o).addScaledVector(dir, L).addScaledVector(side, -W * 0.3)
          .addScaledVector(lift, 0.10 - bend - fold * 0.5).addScaledVector(up, 0.05);
        p[3].copy(o).addScaledVector(dir, L).addScaledVector(lift, 0.10 - bend)
          .addScaledVector(up, 0.05);
        quad(p[0], p[1], p[2], p[3], [nRoot, nRoot, nTip, nTip], cell, mirror,
          FROST_DROP, SNOW_COL, 0);
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
        quad(p[0], p[1], p[2], p[3], [nRoot, nRoot, nTip, nTip], cell, !mirror,
          FROST_DROP, SNOW_COL, 0, true);
      }
    }
  }

  /* ---- the spire: crossed upright cards at the crown ---- */
  if (spec.spire > 0 && !layout.bare) {
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
      for (const q of p) { q.x += stemX(q.y); q.z += stemZ(q.y); }
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

/* THE BARE TREES, AS CARDS TOO.

   The larch pools wore the low-poly dead hardwoods, and a dead hardwood at
   forty polygons is the loudest object on the hill: flat-shaded antlers in
   pure white, standing next to photographed fir sprigs. A bare tree is
   *only* silhouette, which is exactly what a card does well, so the same
   builder grows it — trunk, flare, well and drooping V cards — off an atlas
   drawn here rather than photographed: two fractal twig sprigs and a bark
   strip on one canvas, once, at boot. The twigs are luminance values like
   the fir sprigs, so the instance cast colours the timber; their snow is
   drawn a shade bluer than grey, which is the one channel the atlas has
   spare, and the card material turns that excess blue back into the prop
   snow colour per texel. */
export function createTwigAtlas(THREE) {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rnd = mulberry(0x7a1c3d);

  // bark strip: vertical streaks of grey with a little warmth
  ctx.fillStyle = 'rgb(96, 88, 78)';
  ctx.fillRect(0, 0, 96, H);
  for (let i = 0; i < 900; i++) {
    const g = 58 + Math.floor(rnd() * 80);
    ctx.strokeStyle = `rgb(${g + 6}, ${g}, ${g - 8})`;
    ctx.lineWidth = 1 + rnd() * 2.5;
    const x = rnd() * 96;
    const y0 = rnd() * H;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + (rnd() - 0.5) * 6, y0 + 20 + rnd() * 120);
    ctx.stroke();
  }

  /* Nothing thinner than this, in texels. A bare tree is mostly holes, so
     what reaches the screen is decided by whether a twig survives the mip
     chain: a one-texel line is a quarter of a pixel by twenty metres, its
     alpha falls under the cutout, and the branch arrives as a row of
     speckles. Wide strokes and a shallow recursion give the same silhouette
     out of fewer, fatter marks, which is what a card can actually carry. */
  const MIN_TWIG = 2.4;
  const branch = (x, y, ang, len, wid, depth) => {
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    const g = 118 + Math.floor((3 - depth) * 16 + rnd() * 20);
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgb(${g}, ${g}, ${g})`;
    ctx.lineWidth = Math.max(MIN_TWIG, wid);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Snow lies along the upper edge of wood that is flat enough to hold it.
    if (Math.abs(Math.cos(ang)) > 0.30 && wid > 3.0) {
      ctx.strokeStyle = 'rgb(200, 222, 255)';
      ctx.lineWidth = Math.max(2.0, wid * 0.55);
      const oy = -wid * 0.42;
      ctx.beginPath();
      ctx.moveTo(x, y + oy);
      ctx.lineTo(ex, ey + oy);
      ctx.stroke();
    }
    if (depth <= 0) return;
    const kids = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const at = 0.3 + 0.6 * rnd();
      const sideSign = rnd() < 0.5 ? -1 : 1;
      branch(x + Math.cos(ang) * len * at, y + Math.sin(ang) * len * at,
        ang + sideSign * (0.45 + 0.55 * rnd()), len * (0.48 + 0.28 * rnd()),
        wid * 0.70, depth - 1);
    }
    branch(ex, ey, ang + (rnd() - 0.5) * 0.5, len * 0.70, wid * 0.78, depth - 1);
  };
  const cell = (x0, w) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, w, H);
    ctx.clip();
    branch(x0 + w * 0.5, H * 0.985, -Math.PI / 2 + (rnd() - 0.5) * 0.25, H * 0.30, 16, 3);
    ctx.restore();
  };
  cell(112, 448);
  cell(576, 448);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  const layout = {
    cells: [
      { u0: 112 / W, u1: 560 / W, v0: 0.02, v1: 0.985 },
      { u0: 576 / W, u1: 1.0, v0: 0.02, v1: 0.985 },
    ],
    frostDrop: 0,
    bark: { u0: 0.004, u1: 0.090, v0: 0.02, v1: 0.98 },
    bare: true,
  };
  return { texture, layout };
}
