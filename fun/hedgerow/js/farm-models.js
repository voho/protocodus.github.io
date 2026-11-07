/* Hedgerow — farm and village cover modelled in three.js for Saint-Clair.

   Each is waist to chest high with one box collider, so it stops shots,
   can be vaulted (under 1.35 m) and is found as cover by the AI
   (ai.js coverBy) like the GLB props. Front = +z, metres, deterministic.

   * `woodpile`: split logs stacked between posts under a few old boards.
   * `hay_bales`: small square bales, two layers and a part third, tied.
   * `drystone_wall`, `drystone_wall_tumbled`: four metres of field-stone
     wall, the second fallen in to knee height with stones at its foot.
   * `river_boat`: a flat-bottomed river boat pulled up the bank, heeled
     over on its bilge.
   * `street_barricade`: a barricade of house furniture, a door and casks.
   * `timber_stack`: felled pine trunks stacked at a woodcutters' landing. */

import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';
import { rng } from './util.js';

const DEG = Math.PI / 180;
const CUT = 0xd9c09a;               // fresh-cut end grain, paler than the bark

/* a log along z: bark round it, cut faces at both ends */
function log(b, bark, r, len, at, yawDeg = 0, tint = 0xffffff) {
  b.add(bark, new THREE.CylinderGeometry(r, r * 1.04, len, 7).rotateX(Math.PI / 2), at, [0, yawDeg, 0], [1, 1, 1], tint);
  const end = new THREE.CircleGeometry(r * 0.94, 7);
  const c = Math.cos(yawDeg * DEG), s = Math.sin(yawDeg * DEG);
  for (const side of [1, -1]) {
    const o = side * (len / 2 + 0.004);
    b.add('wood', end, [at[0] + o * s, at[1], at[2] + o * c], [0, yawDeg + (side > 0 ? 0 : 180), 0], [1, 1, 1], CUT);
  }
  end.dispose();
}

export function woodpile() {
  const b = createBuilder('woodpile'), R = rng(4401);
  const L = 2.7, D = 0.86;
  for (let row = 0, y = 0.1; row < 7; row++) {
    const r = 0.085;
    const n = Math.floor(L / (2 * r)) - (row % 2);
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + r + (row % 2) * r + i * 2 * r + R.range(-0.01, 0.01);
      log(b, R() < 0.3 ? 'deadwood' : 'bark_oak', r * R.range(0.82, 1.05), D * R.range(0.93, 1.03), [x, y + R.range(-0.01, 0.01), R.range(-0.03, 0.03)], R.range(-4, 4));
    }
    y += r * 1.72;
  }
  for (const x of [-L / 2 - 0.07, L / 2 + 0.07]) for (const z of [-0.33, 0.33]) b.box('wood_old', [0.09, 1.38, 0.09], [x, 0.66, z], [0, 0, x > 0 ? -2 : 2]);
  // old boards over the top against the rain, one slipped
  for (let k = 0; k < 4; k++) b.box('wood_old', [3.05, 0.03, 0.27], [0, 1.33 + k * 0.004, -0.42 + k * 0.28], [k === 3 ? 6 : 0, k === 3 ? 4 : 0, 0]);
  b.collider([0, 0.62, 0], [1.46, 0.62, 0.46], 0, null, 'wood');
  return b.done(0);
}

export function hayBales() {
  const b = createBuilder('hay_bales'), R = rng(4402);
  const bale = (x, y, z, yaw) => {
    const t = [0xffffff, 0xe8dfc8, 0xd6cdb4][R.int(0, 2)];
    b.box('hay', [0.98, 0.42, 0.48], [x, y, z], [R.range(-1.5, 1.5), yaw, R.range(-1.5, 1.5)], t);
    const c = Math.cos(yaw * DEG), s = Math.sin(yaw * DEG);
    // two strings round the bale's length
    for (const u of [-0.24, 0.24]) b.box('canvas_gray', [0.018, 0.426, 0.486], [x + u * c, y, z - u * s], [0, yaw, 0], 0x8a8270);
  };
  for (let layer = 0; layer < 2; layer++) for (const x of [-0.5, 0.5]) for (const z of [-0.25, 0.25]) bale(x + R.range(-0.03, 0.03), 0.21 + layer * 0.43, z, R.range(-3, 3));
  bale(-0.48, 1.07, 0.02, 84); bale(0.08, 1.07, 0.04, 92);
  // one fallen off at the foot
  bale(1.42, 0.21, 0.35, 63);
  b.collider([0, 0.43, 0], [1.0, 0.43, 0.5], 0, null, 'foliage');
  b.collider([-0.2, 1.07, 0], [0.55, 0.22, 0.5], 0, null, 'foliage');
  b.collider([1.42, 0.21, 0.35], [0.4, 0.21, 0.4], 63, null, 'foliage');
  return b.done(0);
}

/* rounded field stones laid in courses round a hidden rubble core */
function drystone(name, seed, top) {
  const b = createBuilder(name), R = rng(seed);
  const L = 4, stone = new THREE.IcosahedronGeometry(1, 0);
  const tints = [0xffffff, 0xe6e0d4, 0xd3cfc4, 0xc8c2b4, 0xf1ebdf];
  for (let x = -L / 2 + 0.1; x < L / 2; x += 0.2) {
    const h = top(x), w = 0.58 - 0.16 * (h / 1);
    b.box('stone_dark', [0.21, h * 0.92, w * 0.62], [x, h * 0.46, 0]);
  }
  for (const face of [1, -1]) {
    let y = 0.1;
    for (let course = 0; y < 1.1; course++) {
      const ch = R.range(0.14, 0.22);
      for (let x = -L / 2 + (course % 2) * 0.2; x < L / 2;) {
        const len = R.range(0.22, 0.46), cx = Math.min(x + len / 2, L / 2 - len / 2);
        x += len * 0.9;
        if (y + ch * 0.4 > top(cx)) continue;
        const w = 0.58 - 0.16 * (y / 1);
        b.add('stone', stone, [cx, y, face * (w / 2 - 0.07)], [R.range(0, 360), R.range(-25, 25), R.range(-12, 12)], [len * 0.56, ch * 0.62, 0.16], R.pick(tints));
      }
      y += ch * 0.86;
    }
  }
  // coping of edge-set stones along what still stands to full height
  for (let x = -L / 2 + 0.12; x < L / 2; x += R.range(0.17, 0.24)) {
    const h = top(x);
    if (h < 0.8) continue;
    b.add('stone_dark', stone, [x, h + 0.05, R.range(-0.03, 0.03)], [R.range(-10, 10), R.range(80, 100), R.range(-14, 14)], [0.12, 0.17, 0.2], R.pick(tints));
    if (R() < 0.3) b.box('moss', [0.16, 0.025, 0.24], [x, h + 0.17, 0], [0, R.range(-30, 30), 0]);
  }
  return { b, R, stone, tints };
}

export function drystoneWall() {
  const top = (x) => 0.92 + 0.06 * Math.sin(x * 1.7 + 0.4);
  const { b, stone } = drystone('drystone_wall', 4403, top);
  b.collider([0, 0.53, 0], [2, 0.53, 0.32], 0, null, 'stone');
  stone.dispose();
  return b.done(0);
}

export function drystoneWallTumbled() {
  // full height at the ends, fallen in to knee height over the middle
  const top = (x) => 0.96 - 0.5 * Math.exp(-(((x - 0.3) / 0.9) ** 2));
  const { b, R, stone, tints } = drystone('drystone_wall_tumbled', 4404, top);
  for (let k = 0; k < 16; k++) {
    const x = R.range(-0.9, 1.5), side = R.sign();
    b.add('stone', stone, [x, 0.08, side * R.range(0.35, 1.1)], [R.range(0, 360), R.range(0, 360), 0], [R.range(0.12, 0.24), R.range(0.08, 0.13), R.range(0.12, 0.2)], R.pick(tints));
  }
  b.collider([-1.45, 0.48, 0], [0.55, 0.48, 0.32], 0, null, 'stone');
  b.collider([1.55, 0.46, 0], [0.45, 0.46, 0.32], 0, null, 'stone');
  b.collider([0.1, 0.26, 0], [1.0, 0.26, 0.32], 0, null, 'stone');
  stone.dispose();
  return b.done(0);
}

/* the hull of a flat-bottomed boat, upright, gunwale at y = 0 and the keel `depth` below,
   as a surface u (bow to stern, along x) by v (round the bilge); `inward` faces it inwards */
function hullGeometry(L, beam, depth, shrink, inward) {
  const nu = 18, nv = 8, pos = [], col = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu, x = (u - 0.5) * L * shrink;
    const width = beam / 2 * shrink * Math.pow(Math.sin(Math.PI * Math.min(0.97, Math.max(0.03, u))), 0.55);
    const sheer = 0.12 * (2 * u - 1) ** 2;        // gunwale rises to bow and stern
    for (let j = 0; j <= nv; j++) {
      const v = j / nv * Math.PI;
      // flat-ish bottom, flared sides
      const z = width * Math.cos(v), y = sheer - depth * shrink * Math.pow(Math.sin(v), 0.45);
      pos.push(x, y, z);
      const strake = 0.84 + 0.16 * ((j % 2) ^ (i % 9 === 0 ? 1 : 0));
      col.push(strake, strake, strake);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, c = a + nv + 1;
    if (inward) idx.push(a, a + 1, c, a + 1, c + 1, c); else idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function riverBoat() {
  const b = createBuilder('river_boat');
  const L = 4.3, BEAM = 1.35, DEPTH = 0.55, heel = 24;
  // heeled over on the bank: rolled about its length, the low bilge in the mud
  const lift = DEPTH * Math.cos(heel * DEG) + 0.02;
  const outer = hullGeometry(L, BEAM, DEPTH, 1, false), inner = hullGeometry(L, BEAM, DEPTH, 0.94, true);
  b.add('paint_green', outer, [0, lift, 0], [heel, 0, 0]);
  b.add('wood_old', inner, [0, lift, 0], [heel, 0, 0]);
  outer.dispose(); inner.dispose();
  const tilt = (y, z) => [y * Math.cos(heel * DEG) - z * Math.sin(heel * DEG), y * Math.sin(heel * DEG) + z * Math.cos(heel * DEG)];
  // thwarts and gunwale rails, turned with the hull
  for (const x of [-1.0, 0.25, 1.3]) { const [y, z] = tilt(-0.17, 0); b.box('wood_old', [0.22, 0.04, BEAM * 0.86], [x, lift + y, z], [heel, 0, 0]); }
  for (const side of [1, -1]) { const [y, z] = tilt(0.02, side * BEAM / 2 * 0.98); b.box('wood_dark', [L * 0.8, 0.05, 0.06], [0, lift + y, z], [heel, 0, 0]); }
  // an oar left across it, the painter rope trailing to a stake
  b.rod('wood_old', [-1.6, 0.15, -0.9], [1.1, lift + 0.32, 0.55], 0.025);
  b.box('wood_old', [0.03, 0.4, 0.14], [1.15, lift + 0.35, 0.58], [0, 30, 60]);
  b.rod('wood_dark', [2.6, 0, 0.3], [2.6, 0.55, 0.3], 0.04);
  b.rod('canvas_gray', [2.15, lift - 0.05, 0.05], [2.6, 0.45, 0.3], 0.012);
  b.collider([0, 0.44, 0], [L * 0.44, 0.44, BEAM * 0.48], 0, null, 'wood');
  return b.done(0);
}

export function streetBarricade() {
  const b = createBuilder('street_barricade'), R = rng(4405);
  // a wardrobe on its back, a kitchen table on its side, a door, casks, a cart wheel, a mattress
  b.box('wood_dark', [1.9, 0.58, 0.95], [-1.25, 0.32, 0.05], [0, 4, 6]);
  b.box('wood', [0.88, 0.02, 0.86], [-1.7, 0.62, 0.05], [0, 4, 6], 0xb8a890);
  b.box('wood', [1.5, 0.05, 0.85], [0.35, 0.47, -0.12], [90, 8, 0]);
  for (const x of [-0.35, 1.05]) for (const y of [0.12, 0.82]) b.box('wood', [0.06, 0.06, 0.72], [x, y, 0.25], [0, 8, 0]);
  b.box('paint_green', [0.85, 1.95, 0.05], [1.65, 0.62, -0.05], [-28, -14, 74], 0xc8d0c0);
  b.box('iron', [0.03, 0.12, 0.08], [1.72, 0.85, 0.17], [-28, -14, 74]);
  for (const [x, z] of [[2.3, 0.15], [-2.15, -0.25]]) b.cylinder('wood', 0.3, 0.86, [x, 0.43, z], [0, 0, 0], 10, 0xc0b4a0).cylinder('iron', 0.307, 0.05, [x, 0.2, z], [0, 0, 0], 10).cylinder('iron', 0.307, 0.05, [x, 0.66, z], [0, 0, 0], 10);
  b.add('wood_dark', new THREE.TorusGeometry(0.55, 0.045, 5, 16), [-0.5, 0.95, -0.42], [72, 10, 0]);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; b.box('wood_dark', [0.035, 1.05, 0.035], [-0.5, 0.95, -0.42], [72, 10, a / DEG]); }
  b.box('canvas', [1.8, 0.16, 0.9], [-0.35, 1.02, 0.22], [-58, 6, 3], 0xa8a088);
  // planks wedged across the top, and chairs
  for (let k = 0; k < 3; k++) b.box('wood_old', [2.6 + k * 0.3, 0.04, 0.2], [R.range(-0.4, 0.4), 1.08 + k * 0.06, -0.25 + k * 0.17], [R.range(-8, 8), R.range(-8, 8), R.range(-6, 6)]);
  for (const [x, z, yaw] of [[1.15, 0.65, 30], [-2.0, 0.55, -50]]) {
    b.box('wood', [0.42, 0.04, 0.42], [x, 0.45, z], [0, yaw, 0]);
    for (const dx of [-0.18, 0.18]) for (const dz of [-0.18, 0.18]) b.box('wood', [0.035, 0.45, 0.035], [x + dx, 0.22, z + dz], [0, yaw, 0]);
    b.box('wood', [0.42, 0.5, 0.03], [x, 0.72, z - 0.2], [0, yaw, 0]);
  }
  b.collider([0, 0.62, 0], [2.4, 0.62, 0.48], 0, null, 'wood');
  return b.done(0);
}

export function timberStack() {
  const b = createBuilder('timber_stack'), R = rng(4406);
  const L = 6.2, r = 0.25;
  // the bottom row spaced a little apart, so the rows above nest lower and the stack stays vaultable
  const rows = [[-0.9, -0.3, 0.3, 0.9], [-0.6, 0, 0.6], [-0.3, 0.3]];
  rows.forEach((row, k) => {
    for (const z of row) log(b, 'bark_pine', r * R.range(0.9, 1.04), L * R.range(0.94, 1.04), [R.range(-0.2, 0.2), r + k * r * 1.6, z], 90 + R.range(-2, 2));
  });
  // chocks and stakes that hold the bottom row
  for (const x of [-2.4, 2.4]) {
    b.box('wood_old', [0.16, 0.12, 2.5], [x, 0.06, 0]);
    for (const z of [-1.2, 1.2]) b.box('wood_old', [0.09, 1.1, 0.09], [x, 0.5, z], [0, 0, 0], 0xcfc4b0);
  }
  b.collider([0, 0.65, 0], [3.1, 0.65, 1.15], 0, null, 'wood');
  return b.done(0);
}

export function farmModels() {
  return [woodpile(), hayBales(), drystoneWall(), drystoneWallTumbled(), riverBoat(), streetBarricade(), timberStack()];
}
