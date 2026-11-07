/* Hedgerow — models built in three.js rather than in Blender.

   Each is a model in the shape the GLB sets give (assets.js): primitives
   with a palette key (materials.js gives them the wet palette material, its
   detail texture laid on in metre UVs), colliders and anchors in the model's
   own frame (front = +z), a bounding box. main.js adds them to the library
   after the GLBs, so the levels place them like any other prop.

   * `glider`: a wooden assault glider that came down hard in a field: the
     nose stove in, the fuselage broken behind the wing, the tail slewed,
     one wing torn off at the strut and lying in the grass, black and white
     recognition stripes round the fuselage and across the wings.
   * `canal_bridge`: a steel girder bridge over the canal: a plank deck on
     cross girders, a riveted plate girder each side as the parapet, an
     operator's cabin at the north end.
   * `supply_canister`: an airborne supply container with its chute
     crumpled beside it, burst open.
   * `duckboard_walk`, `fence_field`, `stone_culvert`: field engineering
     and farm details, built in metres with the same wet material palette.
   * `gun_revetment` (battery-models.js): La Varenne's revetted gun pits.

   The civilian field_harrow/orchard_ladder and canal mooring_bollard/
   demolition_switch models remain available alongside these additions.

   UVs are in metres (box projected), vertex colours carry a little
   occlusion towards the ground, as the baked models' do. */

import * as THREE from 'three';
import { canalQuay, scuttledBarge, gliderStake } from './canal-models.js';
import { gunRevetment } from './battery-models.js';

const DEG = Math.PI / 180;

/* box-projected UVs in metres and an occlusion ramp up from `floor` */
function finish(geo, floor = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal, n = P.count;
  const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    if (ax >= ay && ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; } else if (ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; } else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
    const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, (y - floor) / 1.6));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function builder(name) {
  const parts = new Map();          // key -> [geometry]
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const model = { name, set: 'procedural', prims: [], colliders: [], anchors: {}, extras: {}, box: new THREE.Box3() };
  return {
    model,
    /* a geometry placed at (x, y, z), turned (rx, ry, rz in degrees, XYZ order), scaled */
    add(key, geo, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0], sc = [1, 1, 1]) {
      e.set(rx * DEG, ry * DEG, rz * DEG);
      m.compose(p.set(x, y, z), q.setFromEuler(e), s.set(...sc));
      const g = geo.clone().applyMatrix4(m);
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key).push(g);
      return g;
    },
    /* a box collider: centre, half extents, yaw in degrees */
    box(c, h, ry = 0, kind, surface) { model.colliders.push({ type: 'box', c, h, ry: ry * DEG, ...(kind ? { kind } : {}), ...(surface ? { surface } : {}) }); },
    done(floor = 0) {
      for (const [key, list] of parts) {
        const merged = mergeAll(list.map((g) => finish(g, floor)));
        merged.computeBoundingBox();
        model.box.union(merged.boundingBox);
        model.prims.push({ geometry: merged, key, material: { name: key }, node: null });
      }
      return model;
    },
  };
}

function mergeAll(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    const a = new Float32Array(n * size);
    let o = 0;
    for (const g of list) { a.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, size));
  }
  return out;
}

/* a fuselage section: a tube along z from z0 to z1, its radius from r0 to r1, flattened a little */
const tube = (r0, r1, len, seg = 14) => new THREE.CylinderGeometry(r1, r0, len, seg, 1, false).rotateX(Math.PI / 2);

/* ---------- the glider ---------- */

function glider() {
  const b = builder('glider');
  const R = 1.2;                         // fuselage radius
  const CAMO = 'canvas', DARK = 'metal_dark', WHITE = 'marking_white', PLY = 'wood_old';
  // it lies on its belly, the floor some 0.4 m into the soft ground at the nose
  // mid section (wing root): z -3 .. 4
  b.add(CAMO, tube(R, R, 7, 16), [0, 1.15, 0.5], [0, 0, 0], [1, 1.08, 1]);
  // forward section, broken and stove in towards the nose: z 4 .. 9.5, nose down
  b.add(CAMO, tube(R, R * 0.92, 4.2, 16), [0.1, 1.0, 6.2], [5, 2, 0], [1, 1.05, 1]);
  // the cockpit: the glazed, rounded nose, crushed and pushed up
  const nose = new THREE.SphereGeometry(R * 0.95, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  b.add('glass', nose, [0.15, 0.85, 8.25], [8, 4, 0], [1, 0.9, 1.15]);
  // frame bars over the glazing
  for (const a of [-50, -20, 20, 50]) b.add(PLY, new THREE.BoxGeometry(0.06, 0.06, 1.2), [0.15 + Math.sin(a * DEG) * 0.9, 0.95 + Math.cos(a * DEG) * 0.75, 8.4], [8, a * 0.3, 0]);
  // torn plywood where the nose broke from the section behind it
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    b.add(PLY, new THREE.BoxGeometry(0.5, 0.04, 0.7 + (k % 3) * 0.25), [Math.cos(a) * R, 1.1 + Math.sin(a) * R, 4.1], [a * 57 + 90, 0, 30 * ((k % 2) - 0.5)]);
  }
  // tail section: snapped behind the trailing edge, slewed round and dropped: z -3 .. -14
  const tailYaw = 11, tz = -3.3;
  const tailAt = (dz, dy = 0) => [Math.sin(tailYaw * DEG) * dz, 1.1 + dy, tz + Math.cos(tailYaw * DEG) * dz];
  b.add(CAMO, tube(R * 0.98, R * 0.42, 10.5, 14), tailAt(-5.3, 0.25), [-2, tailYaw, 0], [1, 1.05, 1]);
  // tail fin and rudder, tailplane
  b.add(CAMO, new THREE.BoxGeometry(0.16, 2.6, 2.4), tailAt(-9.6, 1.7), [0, tailYaw, -4]);
  b.add(CAMO, new THREE.BoxGeometry(7.2, 0.14, 1.9), tailAt(-9.9, 0.75), [0, tailYaw, 3]);
  // the wing on top of the fuselage (high wing), span 26.8 m, chord ~3 m; the left
  // panel torn off at 6 m and lying beside the fuselage, its tip in the ground
  const wingY = 2.45;
  b.add(CAMO, new THREE.BoxGeometry(19.4, 0.34, 3.1), [-3.7, wingY, 0.8], [0, 0, -1.5]);
  b.add(CAMO, new THREE.BoxGeometry(7.2, 0.3, 2.5), [10.9, 1.25, -1.6], [6, 28, 13]);       // the torn-off panel
  b.add(PLY, new THREE.BoxGeometry(0.4, 0.4, 2.6), [6.2, wingY - 0.1, 0.9], [0, 0, 20]);     // splintered spar stub
  // struts from the fuselage side to the wing
  for (const sx of [-1, 1]) b.add(DARK, new THREE.CylinderGeometry(0.06, 0.06, 3.2), [sx * 2.3, 1.4, 1.0], [0, 0, sx * 52]);
  // the skid and the broken main wheels
  b.add(PLY, new THREE.BoxGeometry(0.3, 0.25, 6), [0, 0.1, 4], [3, 0, 0]);
  b.add('rubber', new THREE.CylinderGeometry(0.42, 0.42, 0.28, 14).rotateZ(Math.PI / 2), [-1.7, 0.35, 0.6], [0, 0, 18]);
  b.add('rubber', new THREE.CylinderGeometry(0.42, 0.42, 0.28, 14).rotateZ(Math.PI / 2), [2.6, 0.3, -1.4], [70, 20, 0]);
  // recognition stripes: three white, two black round the rear fuselage and across the wing
  const stripe = 0.46;
  for (let k = 0; k < 5; k++) {
    const key = k % 2 ? DARK : WHITE;
    b.add(key, tube(R * 0.93 + 0.012, R * 0.89 + 0.012, stripe, 16), tailAt(-1.6 - k * stripe, 0.25), [-2, tailYaw, 0], [1, 1.05, 1]);
    b.add(key, new THREE.BoxGeometry(stripe, 0.36, 3.12), [-5 - k * stripe, wingY - 0.12, 0.8], [0, 0, -1.5]);
    b.add(key, new THREE.BoxGeometry(stripe, 0.32, 2.52), [10.9 - 1 + k * stripe * Math.cos(28 * DEG), 1.25, -1.6], [6, 28, 13]);
  }
  // the side door, open, the opening black
  b.add(DARK, new THREE.BoxGeometry(0.06, 1.3, 1.1), [-R - 0.02, 1.15, 2.4]);
  b.add(PLY, new THREE.BoxGeometry(0.05, 1.3, 1.1), [-R - 0.55, 1.1, 2.95], [0, 70, 0]);

  // colliders: the fuselage sections, the fallen wing; the high wing is above head height
  b.box([0, 1.15, 0.5], [R, R, 3.6]);
  b.box([0.2, 1.0, 6.4], [R, R, 2.6], 2);
  b.box(tailAt(-5.3, 0.25), [R * 0.75, R * 0.85, 5.3], tailYaw);
  b.box([10.9, 1.1, -1.6], [3.6, 0.6, 1.3], 28);
  b.box([-3.7, wingY, 0.8], [9.7, 0.2, 1.55]);
  b.model.anchors = { door: [-R - 0.8, 0, 2.4, -Math.PI / 2] };
  return b.done(0);
}

/* ---------- the canal bridge ---------- */

/* deck along z from -L/2 to L/2 at y = deck (the model's origin at the deck's middle, water below) */
export const CANAL_BRIDGE = { length: 34, width: 5.2, deck: 0 };

function canalBridge() {
  const b = builder('canal_bridge');
  const { length: L, width: W } = CANAL_BRIDGE;
  const STEEL = 'metal_gray', DARK = 'iron', RUST = 'rust', WOOD = 'wood_dark';
  // the plank deck on cross girders
  b.add(WOOD, new THREE.BoxGeometry(W - 0.4, 0.12, L), [0, -0.06, 0]);
  for (let z = -L / 2 + 0.5; z <= L / 2 - 0.5; z += 1.6) b.add(DARK, new THREE.BoxGeometry(W + 0.2, 0.32, 0.22), [0, -0.3, z]);
  // the main girders each side: a riveted plate web, deep at the middle, flanges top and bottom
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.05);
    b.add(STEEL, new THREE.BoxGeometry(0.1, 1.5, L), [x, 0.45, 0]);
    b.add(STEEL, new THREE.BoxGeometry(0.45, 0.08, L), [x, 1.22, 0]);
    b.add(STEEL, new THREE.BoxGeometry(0.45, 0.1, L), [x, -0.28, 0]);
    // stiffeners down the web, rust at their feet
    for (let z = -L / 2 + 0.8; z < L / 2; z += 1.6) {
      b.add(DARK, new THREE.BoxGeometry(0.22, 1.4, 0.08), [x - sx * 0.08, 0.45, z]);
      b.add(RUST, new THREE.BoxGeometry(0.24, 0.12, 0.3), [x - sx * 0.06, -0.18, z]);
    }
    // the abutments' steel shoes
    for (const sz of [-1, 1]) b.add(DARK, new THREE.BoxGeometry(0.7, 0.5, 0.8), [x, -0.55, sz * (L / 2 - 0.4)]);
  }
  // the lifting gear's counterweight frame over the north end, and the operator's cabin beside it
  for (const sx of [-1, 1]) b.add(STEEL, new THREE.BoxGeometry(0.35, 5.2, 0.35), [sx * (W / 2 + 0.4), 2.6, L / 2 - 1.2]);
  b.add(STEEL, new THREE.BoxGeometry(W + 1.2, 0.55, 0.5), [0, 5.1, L / 2 - 1.2]);
  b.add(DARK, new THREE.BoxGeometry(W - 0.6, 1.6, 1.4), [0, 4.0, L / 2 - 1.2]);
  b.add(STEEL, new THREE.CylinderGeometry(0.7, 0.7, 0.25, 18).rotateZ(Math.PI / 2), [W / 2 + 0.75, 4.8, L / 2 - 1.2]);
  b.add('plaster_dirty', new THREE.BoxGeometry(2.0, 2.3, 2.0), [W / 2 + 2.0, 1.15, L / 2 + 0.6]);
  b.add('roof_slate', new THREE.BoxGeometry(2.3, 0.15, 2.3), [W / 2 + 2.0, 2.38, L / 2 + 0.6]);
  b.add('window_lit', new THREE.BoxGeometry(0.03, 0.6, 0.8), [W / 2 + 0.98, 1.4, L / 2 + 0.6]);
  b.add('paint_green', new THREE.BoxGeometry(0.8, 1.8, 0.05), [W / 2 + 2.0, 0.9, L / 2 + 1.61]);

  // the deck (walkable), the girders as parapets, the counterweight posts and the cabin
  b.box([0, -0.2, 0], [W / 2, 0.2, L / 2], 0, null, 'wood');
  for (const sx of [-1, 1]) {
    b.box([sx * (W / 2 + 0.1), 0.45, 0], [0.22, 0.8, L / 2]);
    b.box([sx * (W / 2 + 0.4), 2.6, L / 2 - 1.2], [0.2, 2.6, 0.2]);
  }
  b.box([W / 2 + 2.0, 1.15, L / 2 + 0.6], [1.0, 1.2, 1.0]);
  b.model.anchors = { light: [W / 2 + 0.75, 3.2, L / 2 + 0.6] };
  return b.done(-0.8);
}

/* ---------- a supply canister ---------- */

function supplyCanister() {
  const b = builder('supply_canister');
  b.add('metal_olive', new THREE.CylinderGeometry(0.21, 0.21, 1.7, 14).rotateZ(Math.PI / 2), [0, 0.21, 0], [0, 12, 0]);
  b.add('metal_dark', new THREE.CylinderGeometry(0.23, 0.23, 0.08, 14).rotateZ(Math.PI / 2), [0.55, 0.21, -0.1], [0, 12, 0]);
  b.add('metal_dark', new THREE.CylinderGeometry(0.23, 0.23, 0.08, 14).rotateZ(Math.PI / 2), [-0.55, 0.21, 0.1], [0, 12, 0]);
  // its lid sprung and a crate of it spilled
  b.add('metal_olive', new THREE.CylinderGeometry(0.21, 0.21, 0.5, 14, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), [1.25, 0.12, 0.35], [0, 40, 160]);
  b.add('wood', new THREE.BoxGeometry(0.45, 0.25, 0.32), [1.0, 0.13, -0.45], [0, 25, 0]);
  // the chute, crumpled in a heap of folds
  for (let k = 0; k < 9; k++) {
    const a = k * 0.8, r = 0.5 + (k % 4) * 0.25;
    b.add('canvas_gray', new THREE.SphereGeometry(0.45 + (k % 3) * 0.12, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), [-1.6 + Math.cos(a) * r, 0, 0.9 + Math.sin(a) * r], [0, k * 40, 0], [1.3, 0.35 + (k % 2) * 0.15, 0.9]);
  }
  b.box([0, 0.21, 0], [0.9, 0.22, 0.25], 12);
  return b.done(0);
}

/* ---------- farm and field engineering ---------- */

/* Four metres of duckboards: the raised sleepers keep the boards out of the
   mud. A continuous, low collision deck avoids catching the soldier on every
   plank joint; the visual boards still have uneven ends and iron nail heads. */
function duckboardWalk() {
  const b = builder('duckboard_walk');
  for (const x of [-0.43, 0.43]) b.add('wood_dark', new THREE.BoxGeometry(0.13, 0.12, 4), [x, 0.06, 0]);
  for (let i = 0; i < 13; i++) {
    const z = -1.85 + i * 0.305, width = 1.22 + (i % 3) * 0.045;
    b.add(i % 4 === 0 ? 'wood_dark' : 'wood_old', new THREE.BoxGeometry(width, 0.08, 0.27), [(i % 2 ? 1 : -1) * 0.025, 0.14 + (i % 3) * 0.003, z], [0, (i % 3 - 1) * 1.1, 0]);
    for (const x of [-0.43, 0.43]) b.add('iron', new THREE.CylinderGeometry(0.013, 0.013, 0.006, 5), [x, 0.184 + (i % 3) * 0.003, z]);
  }
  b.box([0, 0.09, 0], [0.64, 0.09, 2], 0, null, 'wood');
  return b.done(0);
}

/* A traditional two-rail cattle fence. Sections have generous gaps between
   them in the levels; the rails are low enough to vault and stop a shot only
   where there is timber, rather than making an invisible solid wall. */
function fieldFence() {
  const b = builder('fence_field');
  for (const [i, x] of [-1.9, 0, 1.9].entries()) {
    b.add('wood_old', new THREE.CylinderGeometry(0.075, 0.11, 1.15, 5), [x, 0.51, 0], [0, i * 23, (i - 1) * 2]);
    b.box([x, 0.51, 0], [0.09, 0.56, 0.09], 0, null, 'wood');
  }
  for (const y of [0.43, 0.88]) {
    b.add('wood_old', new THREE.BoxGeometry(4.04, 0.12, 0.075), [0, y, 0.07], [0, 0, 0.8]);
    b.box([0, y, 0.07], [2.02, 0.07, 0.045], 0, null, 'wood');
    for (const x of [-1.9, 0, 1.9]) b.add('rust', new THREE.CylinderGeometry(0.018, 0.018, 0.01, 6).rotateX(Math.PI / 2), [x, y, 0.114]);
  }
  return b.done(-0.05);
}

/* A small stone culvert carrying a farm crossing over a drainage ditch. The
   barrel runs along +z. Separate arch stones leave real mortar joints, and
   the dark, recessed barrel is open at both ends rather than painted on. */
function stoneCulvert() {
  const b = builder('stone_culvert');
  for (const sx of [-1, 1]) {
    b.add('stone', new THREE.BoxGeometry(1.35, 1.05, 3.2), [sx * 1.65, 0.525, 0]);
    b.box([sx * 1.65, 0.525, 0], [0.675, 0.525, 1.6], 0, null, 'stone');
  }
  for (let i = 0; i < 11; i++) {
    const a = i * Math.PI / 11 + 0.012, end = (i + 1) * Math.PI / 11 - 0.012;
    const shape = new THREE.Shape();
    shape.moveTo(Math.cos(a) * 1.2, Math.sin(a) * 1.2 + 0.15);
    shape.absarc(0, 0.15, 1.2, a, end, false);
    shape.lineTo(Math.cos(end) * 0.95, Math.sin(end) * 0.95 + 0.15);
    shape.absarc(0, 0.15, 0.95, end, a, true);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: false, curveSegments: 2 });
    b.add(i % 3 ? 'stone' : 'stone_dark', g, [0, 0, -1.6]);
    // A short oriented box per voussoir follows the actual arch. A single
    // solid box here would seal the barrel's opening; omitting the stones
    // lets bullets pass through visible masonry.
    const mid = (a + end) * 0.5, radius = 1.075;
    // builder.box rotates about y only, so use conservative axis-aligned
    // cells through the arch's thickness, kept outside the open barrel.
    const cx = Math.cos(mid) * radius, cy = Math.sin(mid) * radius + 0.15;
    const hw = Math.abs(Math.sin(mid)) * 0.12 + Math.abs(Math.cos(mid)) * 0.125;
    const hh = Math.abs(Math.cos(mid)) * 0.12 + Math.abs(Math.sin(mid)) * 0.125;
    b.box([cx, cy, 0], [hw, hh, 1.6], 0, null, 'stone');
  }
  b.add('stone_dark', new THREE.BoxGeometry(4.7, 0.18, 3.4), [0, 1.43, 0]);
  b.box([0, 1.43, 0], [2.35, 0.09, 1.7], 0, null, 'stone');
  // Low edge stones at the mouths of the barrel, leaving the crossing open.
  for (const z of [-1.6, 1.6]) for (const x of [-1.8, 1.8]) b.add('stone', new THREE.BoxGeometry(0.9, 0.32, 0.28), [x, 1.66, z]);
  b.add('moss', new THREE.BoxGeometry(1.0, 0.025, 0.3), [-1.7, 1.835, -1.6]);
  return b.done(0);
}

/* ---------- civilian fieldwork and the canal's demolition circuit ---------- */

function fieldHarrow() {
  const b = builder('field_harrow');
  // A horse-drawn, three-section spike harrow left at a field's headland.
  // Narrow iron teeth sit in the earth; the drawbar and chain are still attached.
  for (let section = -1; section <= 1; section++) {
    const x = section * 0.78;
    for (const dx of [-0.32, 0.32]) b.add('rust', new THREE.BoxGeometry(0.065, 0.07, 1.25), [x + dx, 0.19, 0]);
    for (let row = 0; row < 4; row++) {
      const z = -0.5 + row * 0.34;
      b.add('iron', new THREE.BoxGeometry(0.72, 0.06, 0.06), [x, 0.2, z]);
      for (const dx of [-0.25, 0, 0.25]) b.add('rust', new THREE.BoxGeometry(0.035, 0.24, 0.035), [x + dx, 0.105, z], [-15, 0, 0]);
    }
    b.add('iron', new THREE.TorusGeometry(0.09, 0.015, 5, 10), [x, 0.19, 0.77], [90, 0, 0]);
  }
  b.add('wood_old', new THREE.BoxGeometry(2.5, 0.1, 0.12), [0, 0.22, 0.96]);
  // Align each rod along z before yawing it inwards; Euler XYZ yaw on an
  // untouched y-axis cylinder would leave two parallel, disconnected rods.
  for (const side of [-1, 1]) b.add('iron', new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6).rotateX(Math.PI / 2), [side * 0.36, 0.18, 1.4], [0, side * -35, 0]);
  b.add('iron', new THREE.TorusGeometry(0.1, 0.018, 5, 10), [0, 0.18, 1.97], [90, 0, 0]);
  b.box([0, 0.16, 0], [1.13, 0.16, 0.65], 0, null, 'metal');
  return b.done(0);
}

function orchardLadder() {
  const b = builder('orchard_ladder');
  // The splayed third leg makes this read as an orchard ladder rather than
  // a modern stepladder. All timber keeps the existing metre-scaled grain.
  for (const side of [-1, 1]) b.add('wood_old', new THREE.BoxGeometry(0.075, 2.5, 0.085), [side * 0.32, 1.2, 0], [12, 0, side * 4]);
  for (let i = 0; i < 7; i++) b.add('wood', new THREE.BoxGeometry(0.74 - i * 0.025, 0.065, 0.11), [0, 0.27 + i * 0.31, -0.2 + i * 0.065]);
  b.add('wood_dark', new THREE.CylinderGeometry(0.035, 0.055, 2.7, 6), [0, 1.17, 0.76], [-26, 0, 0]);
  b.box([0, 1.1, 0.22], [0.4, 1.1, 0.35], 0, null, 'wood');
  return b.done(0);
}

function mooringBollard() {
  const b = builder('mooring_bollard');
  b.add('stone_dark', new THREE.BoxGeometry(0.85, 0.18, 0.7), [0, 0.06, 0]);
  b.add('iron', new THREE.CylinderGeometry(0.19, 0.23, 0.65, 12), [0, 0.4, 0]);
  b.add('metal_dark', new THREE.SphereGeometry(0.23, 12, 6), [0, 0.71, 0], [0, 0, 0], [1, 0.35, 1]);
  b.add('iron', new THREE.CylinderGeometry(0.075, 0.075, 0.7, 8), [0, 0.52, 0], [0, 0, 90]);
  for (const x of [-0.28, 0.28]) for (const z of [-0.22, 0.22]) b.add('rust', new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6), [x, 0.18, z]);
  // A few links hang from the cross-piece, one small batched mesh.
  for (let k = 0; k < 6; k++) b.add('rust', new THREE.TorusGeometry(0.06, 0.015, 5, 9), [0.24 + k * 0.028, 0.48 - k * 0.055, 0.08], [0, k % 2 ? 90 : 0, -25]);
  b.box([0, 0.4, 0], [0.28, 0.4, 0.25], 0, null, 'metal');
  return b.done(0);
}

function demolitionSwitch() {
  const b = builder('demolition_switch');
  // A period wooden exploder box on a low trestle with an insulated cable
  // leading towards the girder. The interaction is at its exposed front.
  for (const x of [-0.3, 0.3]) for (const z of [-0.22, 0.22]) b.add('wood_dark', new THREE.BoxGeometry(0.07, 0.45, 0.07), [x, 0.2, z]);
  b.add('wood_old', new THREE.BoxGeometry(0.78, 0.07, 0.62), [0, 0.45, 0]);
  b.add('wood', new THREE.BoxGeometry(0.56, 0.36, 0.4), [0, 0.66, 0]);
  for (const x of [-0.245, 0.245]) b.add('iron', new THREE.BoxGeometry(0.045, 0.37, 0.42), [x, 0.66, 0]);
  b.add('metal_dark', new THREE.CylinderGeometry(0.035, 0.035, 0.31, 8), [0, 0.99, 0]);
  b.add('wood_dark', new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8), [0, 1.14, 0], [0, 0, 90]);
  b.add('metal_gray', new THREE.BoxGeometry(0.2, 0.09, 0.012), [0, 0.7, 0.207]);
  for (const x of [-0.12, 0.12]) {
    b.add('iron', new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8), [x, 0.84, -0.12]);
    const points = [[x, 0.87, -0.12], [x + 0.1, 0.4, -0.35], [x + 0.5, 0.03, -0.6], [x + 0.55, 0.025, 0.7], [x + 0.45, 0.025, 1.8]].map((p) => new THREE.Vector3(...p));
    b.add('rubber', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.012, 4, false));
  }
  b.box([0, 0.45, 0], [0.39, 0.45, 0.31], 0, null, 'wood');
  b.model.anchors = { interact: [0, 0.88, 0.5] };
  return b.done(0);
}

export function proceduralModels() {
  const out = new Map();
  for (const m of [glider(), canalBridge(), canalQuay(), scuttledBarge(), gliderStake(), supplyCanister(), fieldHarrow(), orchardLadder(), mooringBollard(), demolitionSwitch(), duckboardWalk(), fieldFence(), stoneCulvert(), gunRevetment(builder)]) out.set(m.name, m);
  return out;
}
