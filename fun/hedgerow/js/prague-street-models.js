/* Prague, May 1945 — street-built cover, modelled directly in Three.js.

   The tram follows the proportions of Prague's pre-war two-axle wooden
   motor cars: narrow cream window band, dark red lower body, clerestory-free
   arched roof, four large saloon windows, end vestibules and a roof bow.
   It is an original damaged vehicle, not a replica of an identified car.
   Open windows are real openings; the lower body, floor, seats and frame
   stop shots where the visible solid material lies. */

import * as THREE from 'three';
import { createBuilder } from './street-model-kit.js';
import { rng } from './util.js';

function triangles(points, faces) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(f => f.flatMap(i => points[i])), 3));
  g.computeVertexNormals(); return g;
}

function archedRoof(length = 7.85) {
  const points = [], faces = [], steps = 12;
  for (let end = 0; end < 2; end++) for (let i = 0; i <= steps; i++) {
    const a = Math.PI * i / steps;
    points.push([Math.cos(a) * 1.13, 2.73 + Math.sin(a) * 0.37, (end - 0.5) * length]);
  }
  for (let i = 0; i < steps; i++) {
    const a = i, b = i + 1, c = i + steps + 1, d = c + 1;
    faces.push([a, b, c], [b, d, c]);
  }
  for (let end = 0; end < 2; end++) {
    const mid = points.length; points.push([0, 2.73, (end - 0.5) * length]);
    for (let i = 0; i < steps; i++) {
      const a = end * (steps + 1) + i, c = a + 1;
      faces.push(end ? [mid, a, c] : [mid, c, a]);
    }
  }
  const g = triangles(points, faces); return g;
}

function glassShard(b, points) {
  const g = triangles(points, [[0, 1, 2], [2, 1, 0]]);
  b.add('glass', g); g.dispose();
}

function routePlateMaterial() {
  // Painted, removable route board. The small canvas is generated locally;
  // the model has no downloaded fonts, textures or image dependencies.
  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  const ctx = canvas?.getContext('2d');
  if (!ctx?.fillText) return { name: 'marking_white' };
  canvas.width = 192; canvas.height = 112;
  ctx.fillStyle = '#bcb49f'; ctx.fillRect(0, 0, 192, 112);
  ctx.strokeStyle = '#4c4b42'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, 182, 102);
  ctx.font = 'bold 94px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#252720'; ctx.fillText('12', 96, 61);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ name: 'tram_route_board', map: texture, roughness: 0.92, metalness: 0, vertexColors: true });
  return material;
}

function wornPanel(b, key, size, at, side, tint, buckle = false) {
  const g = new THREE.BoxGeometry(...size, 1, 3, buckle ? 5 : 2);
  const p = g.attributes.position, color = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + at[1], z = p.getZ(i) + at[2];
    // One scorched saloon bay and smoke carried towards its rear corner.
    // The other end keeps enough paint to read the original tram livery.
    const fire = Math.exp(-((z + 1.7) ** 2) / 1.7 - ((y - 2.05) ** 2) / 2.2) * (side < 0 ? 1 : 0.62);
    const soot = Math.exp(-((z + 3.45) ** 2) / 0.32 - ((y - 2.45) ** 2) / 1.8) * 0.22;
    const mud = Math.max(0, 1 - (y - 0.86) / 0.53) * 0.30;
    const grain = Math.sin(z * 13.1 + y * 5.7) * 0.025;
    const shade = Math.max(0.13, 0.94 - fire * 0.70 - soot - mud + grain);
    color[i * 3] = shade; color[i * 3 + 1] = shade * 0.98; color[i * 3 + 2] = shade * 0.94;
    if (buckle) {
      const u = (p.getZ(i) / size[2] + 0.5), v = p.getY(i) / size[1] + 0.5;
      const fold = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const damage = Math.exp(-((at[2] + 1.7) ** 2) / 1.8) * (side < 0 ? 1 : 0.65);
      p.setX(i, p.getX(i) + side * fold * (0.018 + damage * 0.065) * Math.sin(u * 7.2 + at[2]));
      p.setY(i, p.getY(i) - fold * damage * 0.018);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  if (buckle) g.computeVertexNormals();
  b.add(key, g, at, [0, 0, 0], [1, 1, 1], tint); g.dispose();
}

function tramBarricade() {
  const b = createBuilder('tram_barricade'), R = rng(19450508);
  const IRON = 'metal_dark', CREAM = 'marking_white', RED = 'paint_red';
  b.material('tram_route_board', routePlateMaterial());
  // Wheels remain the true lowest points. The body does not float on an
  // invisible box; there is room to see the axle and motor underneath it.
  for (const z of [-1.25, 1.25]) {
    b.cylinder(IRON, 0.065, 1.70, [0, 0.36, z], [0, 0, 90], 8);
    for (const s of [-1, 1]) {
      b.cylinder(IRON, 0.36, 0.105, [s * 0.745, 0.36, z], [0, 0, 90], 16);
      b.cylinder('iron', 0.315, 0.025, [s * 0.805, 0.36, z], [0, 0, 90], 16);
      b.cylinder(IRON, 0.10, 0.045, [s * 0.83, 0.36, z], [0, 0, 90], 8);
      // Three inscribed boxes follow each upright wheel's round silhouette
      // without an invisible square blocker at its four empty corners.
      for (const [hy, hz] of [[0.26, 0.25], [0.35, 0.06], [0.06, 0.35]])
        b.collider([s * 0.745, 0.36, z], [0.06, hy, hz], 0, undefined, 'metal');
      // A short laminated spring and an axlebox, visible below the skirt.
      for (let k = 0; k < 3; k++) b.box(IRON, [0.10, 0.026, 0.62 - k * 0.11], [s * 0.75, 0.58 + k * 0.035, z]);
      b.box(IRON, [0.20, 0.19, 0.24], [s * 0.75, 0.48, z]);
    }
  }
  b.box(IRON, [1.55, 0.21, 5.45], [0, 0.66, 0]);
  b.box(IRON, [0.55, 0.28, 1.0], [0, 0.40, 0]);
  // Weathered wooden floorboards with small real seams; broad underfloor
  // collider carries the player and prevents bullets through the chassis.
  for (let x = -0.95; x < 1.0; x += 0.19) b.box('wood_dark', [0.18, 0.075, 7.30], [x, 0.825, 0]);
  b.collider([0, 0.79, 0], [1.055, 0.085, 3.67], 0, undefined, 'wood');
  // Main saloon side panels: alternating slightly scorched red panels
  // rather than a single clean coloured slab.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const z = -1.875 + k * 1.25;
      wornPanel(b, RED, [0.085, 0.70, 1.23], [s * 1.02, 1.22, z], s, '#c4bcb0', true);
      // Recessed panel moulding and narrow metal waist rail.
      b.box(RED, [0.015, 0.025, 1.10], [s * 1.068, 0.96, z], [0, 0, 0], '#aaa29a');
      b.box(IRON, [0.035, 0.045, 1.24], [s * 1.07, 1.57, z]);
    }
    b.collider([s * 1.02, 1.22, 0], [0.052, 0.355, 2.50], 0, undefined, 'metal');
    // Four wide windows, with intact timber mullions and missing panes.
    for (let k = 0; k <= 4; k++) {
      const z = -2.5 + k * 1.25;
      wornPanel(b, CREAM, [0.10, 1.11, 0.075], [s * 1.02, 2.125, z], s, '#b7af98');
      b.collider([s * 1.02, 2.125, z], [0.055, 0.555, 0.041], 0, undefined, 'wood');
    }
    for (let k = 0; k < 3; k++) wornPanel(b, CREAM, [0.105, 0.17, 1.68], [s * 1.02, 2.655 - (s < 0 && k === 0 ? 0.018 : 0), (k - 1) * 1.68], s, '#b7af98', true);
    b.collider([s * 1.02, 2.655, 0], [0.055, 0.085, 2.525], 0, undefined, 'wood');
    wornPanel(b, CREAM, [0.11, 0.055, 5.04], [s * 1.02, 1.625, 0], s, '#b7af98');
    // Jagged glass retained at a few frame corners. The middle of every
    // window stays open to the dark saloon and its wooden benches.
    for (let k = 0; k < 4; k++) {
      const z = -2.46 + k * 1.25;
      if ((k + s) % 3 !== 0) glassShard(b, [[s * 1.025, 1.66, z], [s * 1.025, 1.66, z + 0.31], [s * 1.025, 1.86 + R() * 0.22, z + 0.06]]);
      if (k === 1 || k === 3) glassShard(b, [[s * 1.025, 2.56, z + 1.15], [s * 1.025, 2.56, z + 0.86], [s * 1.025, 2.30, z + 1.10]]);
    }
    // Longitudinal slatted seats and their backrests, seen through windows.
    for (let k = 0; k < 4; k++) b.box('wood_dark', [0.075, 0.055, 4.55], [s * (0.58 + k * 0.095), 1.23, 0]);
    for (const y of [1.51, 1.68]) b.box('wood_dark', [0.055, 0.12, 4.55], [s * 0.91, y, 0]);
    for (const z of [-2.05, 0, 2.05]) b.beam(IRON, [s * 0.76, 0.86, z], [s * 0.76, 1.21, z], 0.045);
    b.collider([s * 0.74, 1.22, 0], [0.19, 0.055, 2.275], 0, undefined, 'wood');
    for (const y of [1.51, 1.68]) b.collider([s * 0.91, y, 0], [0.028, 0.06, 2.275], 0, undefined, 'wood');
  }
  // End vestibules. Three-pane front/rear windscreens use structural posts
  // and a narrow headboard; the lost centre glass makes the interior clear.
  for (const end of [-1, 1]) {
    const z = end * 3.66;
    b.box(RED, [1.97, 0.70, 0.10], [0, 1.22, z], [0, end < 0 ? 3 : 0, 0], '#bdb7ad');
    b.box(CREAM, [2.04, 0.17, 0.10], [0, 2.655, z], [0, 0, 0], '#c4bca5');
    b.box(CREAM, [2.04, 0.065, 0.10], [0, 1.625, z], [0, 0, 0], '#c4bca5');
    b.box(IRON, [0.48, 0.29, 0.045], [0, 2.91, end * 3.94]);
    const routePlate = new THREE.PlaneGeometry(0.43, 0.25); routePlate.userData.keepUV = true;
    b.add('tram_route_board', routePlate, [0, 2.91, end * 3.966], [0, end > 0 ? 0 : 180, 0]); routePlate.dispose();
    b.collider([0, 1.22, z], [1.02, 0.355, 0.06], 0, undefined, 'metal');
    b.collider([0, 2.655, z], [1.02, 0.085, 0.06], 0, undefined, 'wood');
    for (const x of [-0.98, -0.33, 0.33, 0.98]) {
      b.box(CREAM, [0.055, 1.06, 0.095], [x, 2.13, z], [0, 0, 0], '#c4bca5');
      b.collider([x, 2.13, z], [0.032, 0.53, 0.055], 0, undefined, 'wood');
    }
    // Lower coupler and tow loop; no giant blocker across the empty apron.
    b.box(IRON, [0.15, 0.13, 0.32], [0, 0.69, end * 3.87]);
    b.cylinder(IRON, 0.12, 0.045, [0, 0.69, end * 4.035], [90, 0, 0], 10);
    // Round front lamp in a metal housing, unlit during the uprising.
    b.cylinder('iron', 0.16, 0.09, [0, 1.30, end * 3.75], [90, 0, 0], 12);
    b.cylinder('glass', 0.12, 0.01, [0, 1.30, end * 3.805], [90, 0, 0], 12);
    // Brake stand and controller inside each driving platform.
    b.cylinder(IRON, 0.045, 0.74, [-0.57, 1.22, end * 3.20], [0, 0, 0], 8);
    b.cylinder(IRON, 0.18, 0.035, [-0.57, 1.61, end * 3.20], [0, 0, 0], 10);
    b.box(IRON, [0.32, 0.38, 0.30], [0.38, 1.23, end * 3.27]);
    b.rod(IRON, [0.38, 1.45, end * 3.27], [0.64, 1.45, end * 3.27], 0.022);
    for (const side of [-1, 1]) {
      // Door jamb, a clear open boarding entrance, and two inset steps.
      b.box(CREAM, [0.09, 1.83, 0.09], [side * 1.02, 1.78, end * 3.62], [0, 0, 0], '#c4bca5');
      b.box(CREAM, [0.09, 0.17, 1.16], [side * 1.02, 2.655, end * 3.08], [0, 0, 0], '#c4bca5');
      for (let k = 0; k < 2; k++) {
        const x = side * (1.02 + k * 0.045), y = 0.57 - k * 0.19;
        b.box(IRON, [0.22, 0.045, 0.68], [x, y, end * 3.05]);
        b.collider([x, y, end * 3.05], [0.11, 0.0225, 0.34], 0, undefined, 'metal');
      }
      b.rod('iron', [side * 1.03, 0.91, end * 2.56], [side * 1.03, 2.40, end * 2.56], 0.018);
    }
  }
  // Setts prised out of the roadway chock the disabled wheels. These are
  // tied to the contact geometry, not scattered debris; their tops meet
  // the lower tyre arc and stay within the existing vehicle footprint.
  for (const s of [-1, 1]) for (const axle of [-1.25, 1.25]) for (const q of [-1, 1]) {
    b.box('cobble', [0.18, 0.13, 0.20], [s * 0.745, 0.070, axle + q * 0.29], [0, q * 9, 0], '#b5b0a3');
  }
  // One surviving sliding door, buckled open against the rear platform.
  b.box(RED, [0.065, 0.69, 0.62], [-1.01, 1.22, -2.96], [0, -18, 0], '#7f7974');
  b.collider([-1.01, 1.22, -2.96], [0.035, 0.345, 0.31], -18, undefined, 'metal');
  b.box(CREAM, [0.065, 0.07, 0.62], [-1.01, 2.49, -2.96], [0, -18, 0], '#b7af98');
  for (const z of [-3.25, -2.67]) b.box(CREAM, [0.065, 0.93, 0.05], [-1.01, 2.00, z], [0, -18, 0], '#b7af98');

  const roof = archedRoof(); b.add('burnt', roof, [0, 0, 0], [0, 0, 0], [1, 1, 1], '#bab6ad'); roof.dispose();
  b.box('wood_dark', [2.07, 0.055, 7.30], [0, 2.735, 0]);
  b.collider([0, 2.735, 0], [1.035, 0.028, 3.65], 0, undefined, 'wood');
  for (let k = 0; k < 18; k++) {
    const half = 1.13 / 18, x = -1.13 + half + k * half * 2;
    const edge = Math.min(1.13, Math.abs(x) + half);
    const top = 2.73 + Math.sqrt(Math.max(0, 1 - (edge / 1.13) ** 2)) * 0.37;
    // Inscribed steps stay inside the arch: a shot beside the curved roof
    // never hits a rectangular slab floating outside its silhouette.
    b.collider([x, (2.71 + top) * 0.5, 0], [half, (top - 2.71) * 0.5 + 0.005, 3.925], 0, undefined, 'metal');
  }
  // Rain cover strips on the arched roof and small roof-mounted insulators.
  for (const x of [-0.74, 0.74]) b.box('metal_gray', [0.045, 0.025, 6.9], [x, 3.017, 0], [0, 0, x < 0 ? -8 : 8], '#86847c');
  for (const z of [-0.42, 0.42]) for (const x of [-0.4, 0.4]) b.cylinder(CREAM, 0.055, 0.12, [x, 3.14, z], [0, 0, 0], 8, '#aea78f');
  // Damaged lyre/bow collector: two light side rails and a worn cross bar,
  // folded down to keep the wreck's silhouette within street-wire height.
  for (const x of [-0.43, 0.43]) {
    b.rod(IRON, [x, 3.18, -0.40], [x, 3.59, 0.25], 0.018);
    b.rod(IRON, [x, 3.59, 0.25], [x, 3.42, 1.10], 0.018);
  }
  b.rod('iron', [-0.52, 3.42, 1.10], [0.52, 3.42, 1.10], 0.023);
  b.rod(IRON, [-0.43, 3.59, 0.25], [0.43, 3.59, 0.25], 0.014);
  // Bent fender rails on each end are fine geometry, not a solid wall.
  for (const end of [-1, 1]) {
    b.rod(IRON, [-0.82, 0.34, end * 3.61], [0.82, 0.34, end * 3.61], 0.025);
    for (const x of [-0.78, 0.78]) b.rod(IRON, [x, 0.34, end * 3.61], [x, 0.66, end * 3.54], 0.022);
  }
  b.model.anchors = { front: [0, 0, 4.6, 0], rear: [0, 0, -4.6, Math.PI],
    boarding: [1.55, 0, 3.05, -Math.PI / 2], saloon: [0, 0.87, 0, 0], roof: [0, 3.10, 0, 0] };
  b.model.extras = { originalSceneAsset: true, period: 'Prague, May 1945', windowOpenings: true };
  return b.done();
}

function pragueBarricade() {
  const b = createBuilder('prague_barricade'), R = rng(19450505);
  // Pried-up granite setts form a low continuous mass. Individual blocks
  // are laid into compact heaps, with the highest courses under the beds
  // and sandbags; nothing hangs in an arbitrary sphere of debris.
  const stone = new THREE.BoxGeometry(1, 1, 1);
  const p = stone.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Shared-corner hash keeps adjoining triangle edges watertight.
    const h = Math.sin(x * 17 + y * 23 + z * 43) * 43758.5453;
    const q = (h - Math.floor(h) - 0.5) * 0.065;
    p.setXYZ(i, x + q, y + q * 0.7, z - q * 0.6);
  }
  stone.computeVertexNormals();
  for (let row = 0; row < 5; row++) {
    const z = -0.66 + row * 0.30;
    for (let col = 0; col < 24; col++) {
      const x = -2.62 + col * 0.225 + (row % 2) * 0.08;
      const side = Math.abs(x) / 2.8;
      const levels = Math.max(1, Math.round((1 - side * 0.45) * (row === 2 ? 4 : row === 1 || row === 3 ? 3 : 1)));
      for (let k = 0; k < levels; k++) {
        const sx = 0.18 + R() * 0.05, sy = 0.12 + R() * 0.025, sz = 0.23 + R() * 0.04;
        const edge = col === 0 || col === 23;
        const turn = [(R() - 0.5) * (edge ? 8 : 18), (R() - 0.5) * (edge ? 22 : 76), (R() - 0.5) * (edge ? 7 : 14)];
        // Base blocks bear on the road; upper courses overlap the settled
        // stones below. The loose upper orientations break the stair-step
        // outline of neat masonry without floating any isolated chunks.
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(...turn.map(a => a * Math.PI / 180))), new THREE.Vector3(sx, sy, sz));
        let floor = Infinity;
        const v = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) floor = Math.min(floor, v.fromBufferAttribute(p, i).applyMatrix4(matrix).y);
        const y = -floor - 0.014 + k * 0.125;
        b.add('cobble', stone, [x + (R() - 0.5) * (edge ? 0.065 : 0.13), y, z + (R() - 0.5) * 0.10],
          turn, [sx, sy, sz], R() < 0.25 ? '#c3bfb4' : '#f0ede5');
      }
    }
  }
  stone.dispose();
  b.collider([0, 0.22, 0], [2.67, 0.22, 0.66], 0, undefined, 'stone');
  b.collider([0, 0.40, 0], [1.75, 0.10, 0.30], 0, undefined, 'stone');
  // Two domestic iron bedheads, one upright and one twisted. Recognisable
  // scroll-free working furniture rather than military road barriers.
  function bedHead(x0, z0, turn) {
    const transform = ([x, y, z]) => {
      const a = turn * Math.PI / 180;
      return [x0 + x * Math.cos(a) + z * Math.sin(a), y, z0 - x * Math.sin(a) + z * Math.cos(a)];
    };
    const rod = (a, c, r = 0.018) => b.rod('iron', transform(a), transform(c), r, 6, '#94918b');
    rod([-0.59, 0.13, 0], [-0.59, 1.26, 0], 0.024); rod([0.59, 0.13, 0], [0.59, 1.26, 0], 0.024);
    rod([-0.59, 1.15, 0], [0, 1.30, 0], 0.022); rod([0, 1.30, 0], [0.59, 1.15, 0], 0.022);
    rod([-0.59, 0.55, 0], [0.59, 0.55, 0], 0.022);
    for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) rod([x, 0.55, 0], [x, 1.18 + 0.10 * (1 - Math.abs(x) / 0.6), 0], 0.012);
    for (const x of [-0.59, 0.59]) {
      const at = transform([x, 1.27, 0]); b.cylinder('iron', 0.037, 0.06, at, [0, 0, 0], 8, '#94918b');
      const c = transform([x, 0.70, 0]); b.collider(c, [0.035, 0.57, 0.035], turn, undefined, 'metal');
    }
    const centre = transform([0, 0.55, 0]); b.collider(centre, [0.59, 0.028, 0.028], turn, undefined, 'metal');
  }
  bedHead(-1.38, -0.08, -11); bedHead(0.84, 0.19, 16);
  // A length of stripped floor joist braces the street side of the heap.
  b.beam('wood_old', [-2.51, 0.30, -0.54], [1.92, 0.56, -0.33], 0.13, 0.16, '#a69c87');
  // Low, flattened hessian bags are arranged in overlapping courses on
  // the settled stones, with a deliberately lower right-hand end.
  const bag = new THREE.SphereGeometry(1, 10, 5);
  const bagP = bag.attributes.position;
  for (let i = 0; i < bagP.count; i++) {
    const x = bagP.getX(i), y = bagP.getY(i), z = bagP.getZ(i);
    // Filled hessian lies as a rounded rectangular sack, not a smooth
    // ellipsoid. The narrow ends pinch slightly where the cloth is tied.
    const round = v => Math.sign(v) * Math.abs(v) ** 0.63;
    bagP.setXYZ(i, round(x), y * (1 - Math.abs(x) * 0.09), round(z));
  }
  bag.computeVertexNormals();
  for (let row = 0; row < 3; row++) {
    const count = row === 2 ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const x = -2.08 + i * 0.66 + (row % 2 ? 0.27 : 0);
      const y = 0.53 + row * 0.22, z = row % 2 ? 0.13 : -0.10;
      b.add('sandbag', bag, [x, y, z], [0, row % 2 ? 82 + R() * 8 : R() * 8, (R() - 0.5) * 5],
        row % 2 ? [0.31, 0.135, 0.38] : [0.38, 0.135, 0.29], '#b9b2a0');
    }
  }
  bag.dispose();
  b.collider([-0.15, 0.61, 0], [2.16, 0.20, 0.39], 0, undefined, 'sandbag');
  b.collider([-0.99, 0.96, 0], [1.46, 0.20, 0.33], 0, undefined, 'sandbag');
  b.model.anchors = { cover: [-0.9, 0, -1.25, 0], low_end: [2.35, 0, -1.12, 0] };
  b.model.extras = { originalSceneAsset: true, period: 'Prague, May 1945', lowEnd: 'positive-x' };
  return b.done();
}

export function pragueStreetModels() {
  return new Map([['tram_barricade', tramBarricade()], ['prague_barricade', pragueBarricade()],
    ['prague_tram_span', tramSpan()], ['prague_contact_wire', contactWire()]]);
}

function tramSpan() {
  const b = createBuilder('prague_tram_span');
  // A wall-anchored transverse suspension span, slightly sagging. The
  // running contact wire is placed independently at the rails' cadence,
  // leaving only the authored broken section beside the disabled tram.
  for (let i = 0; i < 12; i++) {
    const x0 = -14 + i * 28 / 12, x1 = -14 + (i + 1) * 28 / 12;
    const y = x => 6.32 + 0.48 * (x / 14) ** 2;
    b.rod('wire', [x0, y(x0), 0], [x1, y(x1), 0], 0.008, 5);
  }
  b.rod('wire', [0.05, 6.06, 0], [0, 6.32, 0], 0.009, 5);
  for (const side of [-1, 1]) {
    b.rod('iron', [side * 13.86, 6.79, -0.08], [side * 13.86, 6.79, 0.08], 0.035, 6);
    for (let i = 0; i < 3; i++) b.cylinder('marking_white', 0.044, 0.04, [side * (12.85 + i * 0.055), 6.73 - i * 0.005, 0], [0, 0, 90], 8, '#b3ab92');
  }
  b.model.extras = { originalSceneAsset: true, overhead: true, noCollision: true };
  b.model.anchors = { wire: [0.05, 6.06, 0, 0] };
  return b.done(6);
}

function contactWire() {
  const b = createBuilder('prague_contact_wire');
  // As for the rails, the local rise follows the street's 0.019 grade.
  // Explicit streetDatum(0,z) placement joins neighbouring 14 m pieces
  // without height steps; a two-centimetre end overlap hides round caps.
  const h = z => 6.06 + z * 0.019;
  b.rod('wire', [0.05, h(-7.02), -7.02], [0.05, h(7.02), 7.02], 0.009, 6);
  b.model.extras = { originalSceneAsset: true, overhead: true, noCollision: true, grade: 0.019 };
  b.model.anchors = { south: [0.05, h(-7), -7, 0], north: [0.05, h(7), 7, 0] };
  return b.done(6);
}
