/* Hedgerow — the occupiers' direction posts.

   Where the roads met, the Germans planted posts crowded with painted
   boards: the towns down each road and how far, the way to their own — the
   town major's office, the field police, the main dressing station, a
   command post, the fuel, the vehicle park — and the warnings of a road the
   enemy can see: "Achtung! Feindeinsicht", "Staub bringt Tod!" (a dust
   cloud brings the fighter-bombers). Each of the level's signposts is built
   here: a square post leaning a little, and on it five to eight boards,
   most of them arrows pointing down a road, each at its own height and
   length, a little askew; painted yellow, white or black, lettered in the
   condensed capitals of the road signs, with a painted edge; chipped down
   to the grey wood, streaked by the rain, dirtier towards the bottom, and
   now and then splintered through by a bullet. The boards are cut with
   their thickness and read the right way from either side; one mesh for
   all the posts, made wet like everything else by the material library. */

import * as THREE from 'three';
import { rng } from './util.js';

const CW = 512, CH = 96, COLS = 2, ROWS = 10;      // a board's cell in the texture (px), and how many
const WOOD = ROWS * CH;                            // the post's wood, in the strip under the boards
const POST = 0.1, POST_H = 2.85, THICK = 0.022;    // m

const PAINT = {
  yellow: ['#c49a2a', '#16130f'],
  white: ['#d9d4c6', '#16130f'],
  black: ['#1d1c1a', '#d8d2c2'],
  warn: ['#d6d0c0', '#962a1d'],
};

/* what each post says, top board first: [text, paint, which way it points (N up the street towards
   the bridge, S back down it, E, W), arrow or plain]; found by where the post stands */
const POSTS = [
  // by the lane, short of the village
  { at: [3.4, 70], boards: [['ST. CLAIR', 'white', 'N', 1], ['CARENTAN 11 km', 'white', 'S', 1], ['Kfz.-Park', 'yellow', 'W', 1],
    ['Nur für Wehrmacht', 'black', 'N', 0], ['Staub bringt Tod!', 'warn', 'S', 0]] },
  // in the square, under the lamp by the church
  { at: [-11.2, 151.8], boards: [['ST. LÔ 22 km', 'white', 'N', 1], ['Kradmelder', 'yellow', 'N', 1], ['Feldpost', 'yellow', 'W', 1],
    ['CARENTAN 8 km', 'white', 'S', 1], ['Verpfl.-Lager', 'yellow', 'E', 1], ['Umleitung', 'black', 'E', 1],
    ['Langsam fahren!', 'warn', 'S', 0]] },
  // at the north end of the street, towards the bridge
  { at: [-4.2, 247], boards: [['ST. LÔ 21 km', 'white', 'N', 1], ['PÉRIERS 14 km', 'white', 'N', 1], ['Div. Gef. Std.', 'yellow', 'N', 1],
    ['CARENTAN 9 km', 'white', 'S', 1], ['Ortskommandantur', 'yellow', 'S', 1], ['Feldgendarmerie', 'yellow', 'W', 1],
    ['H.V.P.', 'yellow', 'E', 1], ['Achtung! Feindeinsicht', 'warn', 'N', 0]] },
  // at the camp in the clearing
  { at: [3, 540], boards: [['ST. CLAIR 3 km', 'white', 'S', 1], ['Btl. Gef. Std.', 'yellow', 'W', 1], ['Munitionslager', 'yellow', 'E', 1],
    ['Tankstelle', 'yellow', 'N', 1], ['Minengefahr!', 'warn', 'S', 0]] },
];
// the compass as turns about the vertical (a turn a carries +x to (cos a, 0, -sin a))
const HEADING = { E: 0, N: -Math.PI / 2, W: Math.PI, S: Math.PI / 2 };

const FONT = (px) => `bold ${px | 0}px "DIN Condensed", "DIN Alternate", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif`;

/* A board's face in its cell: the paint over the wood, its edge, the lettering, then the weather.
   The cell is stretched over the board, so it is drawn in the board's own proportions (k across). */
function paintBoard(g, x0, y0, b, R) {
  const [paint, ink] = PAINT[b.paint], k = (CW / CH) / (b.L / b.h);
  g.save();
  g.beginPath(); g.rect(x0, y0, CW, CH); g.clip();
  g.fillStyle = '#6d6252'; g.fillRect(x0, y0, CW, CH);
  g.fillStyle = paint; g.fillRect(x0 + 1, y0 + 1, CW - 2, CH - 2);
  // the paint uneven: brushed, faded in patches
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${R() < 0.5 ? '255,250,235' : '60,50,35'},${(0.02 + R() * 0.05).toFixed(3)})`;
    g.fillRect(x0 + R() * CW, y0, 2 + R() * 30, CH);
  }
  // a painted edge, clear of the arrow's point at either end (the back face is the cell mirrored)
  const pad = b.pad * CW;
  g.strokeStyle = ink; g.globalAlpha = 0.85; g.lineWidth = 3;
  g.strokeRect(x0 + pad, y0 + 6, CW - 2 * pad, CH - 12);
  g.globalAlpha = 1;
  // the lettering, condensed to fit inside it
  g.save();
  g.translate(x0 + CW / 2, y0 + CH / 2 + 2);
  g.scale(k, 1);
  g.font = FONT(CH * 0.74);
  const room = (CW - 2 * pad - 16) / k, w = g.measureText(b.text).width;
  if (w > room) g.scale(room / w, 1);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  // brushed: the letters' edges a little ragged
  g.globalAlpha = 0.35; g.fillText(b.text, 0.8, 0.6);
  g.globalAlpha = 1; g.fillText(b.text, 0, 0);
  g.restore();
  // chipped down to the grey wood, most along the edges and the bottom
  for (let i = 0; i < 26; i++) {
    const edge = R() < 0.6, x = x0 + R() * CW, y = edge ? y0 + (R() < 0.5 ? R() * 8 : CH - R() * 14) : y0 + R() * CH;
    const s = 2 + R() * (edge ? 9 : 5);
    g.fillStyle = R() < 0.5 ? '#6d6252' : '#837766';
    g.beginPath();
    for (let j = 0; j < 6; j++) { const a = j / 6 * 6.283, r = s * (0.5 + R() * 0.7); g.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r); }
    g.fill();
  }
  // rain run down from the top, dirt towards the bottom
  for (let i = 0; i < 18; i++) {
    const x = x0 + R() * CW, len = CH * (0.3 + R() * 0.7);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(55,48,38,${(0.08 + R() * 0.14).toFixed(3)})`); gr.addColorStop(1, 'rgba(55,48,38,0)');
    g.fillStyle = gr; g.fillRect(x, y0, 1 + R() * 3, len);
  }
  const dirt = g.createLinearGradient(0, y0 + CH * 0.55, 0, y0 + CH);
  dirt.addColorStop(0, 'rgba(70,58,42,0)'); dirt.addColorStop(1, 'rgba(70,58,42,0.35)');
  g.fillStyle = dirt; g.fillRect(x0, y0, CW, CH);
  // shot through: a dark hole in a ring of splintered wood
  for (let i = R() < 0.35 ? 1 + (R() * 3 | 0) : 0; i > 0; i--) {
    const x = x0 + pad + R() * (CW - 2 * pad), y = y0 + 12 + R() * (CH - 24), r = 3 + R() * 2;
    g.fillStyle = '#9a8b74';
    g.beginPath(); g.ellipse(x, y, r * 2.2 * k, r * 2.2, 0, 0, 6.283); g.fill();
    g.fillStyle = '#0b0a09';
    g.beginPath(); g.ellipse(x, y, r * k, r, 0, 0, 6.283); g.fill();
  }
  g.restore();
}

/* the post's wood: grey, weathered, its grain along the strip */
function paintWood(g, R) {
  g.fillStyle = '#5f574b'; g.fillRect(0, WOOD, CW * COLS, CH / 2);
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(${R() < 0.5 ? '200,190,170' : '30,26,20'},${(0.05 + R() * 0.12).toFixed(3)})`;
    g.fillRect(R() * CW * COLS, WOOD + R() * CH / 2, 20 + R() * 300, 1 + R() * 2);
  }
}

/* one solid piece added to `out`: placed by matrix m, its uvs from its own (unplaced) points and
   facing, its colour a shade of grey */
function add(out, geo, m, uvOf, shade) {
  const src = geo.index ? geo.toNonIndexed() : geo, at = src.clone().applyMatrix4(m);
  const L = src.attributes.position, LN = src.attributes.normal, P = at.attributes.position, N = at.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    out.pos.push(P.getX(i), P.getY(i), P.getZ(i));
    out.nor.push(N.getX(i), N.getY(i), N.getZ(i));
    out.uv.push(...uvOf(L.getX(i), L.getY(i), L.getZ(i), LN.getZ(i)));
    out.col.push(shade, shade, shade);
  }
}

/* signposts: where the level's posts stand ({x, y, z, yaw} in radians, as levelBuild placed them);
   matlib: to make the paint wet. One mesh, or null. */
export function createWaysigns(signposts, matlib, { seed = 1944 } = {}) {
  if (!signposts.length) return null;
  const R = rng(seed);
  const c = document.createElement('canvas');
  c.width = CW * COLS; c.height = WOOD + CH / 2;
  const g = c.getContext('2d');
  paintWood(g, R);
  const out = { pos: [], nor: [], uv: [], col: [] };
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1);
  const U = (px) => px / c.width, V = (py) => py / c.height;
  const away = (p, sp) => Math.hypot(p.at[0] - sp.x, p.at[1] - sp.z);
  let cell = 0;
  signposts.forEach((sp, k) => {
    // its own boards, or (a post the list doesn't know) another's
    const near = POSTS.reduce((a, p) => (away(p, sp) < away(a, sp) ? p : a));
    const boards = away(near, sp) < 3 ? near.boards : POSTS[k % POSTS.length].boards;
    // leaning a little
    e.set((R() - 0.5) * 0.04, sp.yaw, (R() - 0.5) * 0.04, 'YXZ');
    const base = new THREE.Matrix4().compose(new THREE.Vector3(sp.x, sp.y, sp.z), q.setFromEuler(e), s);
    // the post: its four sides round the wood strip, its height along it
    const post = new THREE.BoxGeometry(POST, POST_H, POST);
    add(out, post, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, POST_H / 2, 0)), (x, y, z, nz) => {
      const around = Math.abs(nz) > 0.5 ? x : z;
      return [U((y / POST_H + 0.5) * CW * COLS * 0.95), V(WOOD + (around / POST + 0.5) * CH / 2 * 0.9 + 2)];
    }, 0.9);
    // the boards, from the top down
    let y = POST_H - 0.12;
    for (const [text, paint, way, arrow] of boards) {
      if (cell >= COLS * ROWS) break;
      const h = paint === 'white' ? 0.19 : 0.165, L = Math.min(1.3, Math.max(0.62, 0.3 + text.length * 0.052));
      // an arrow reaches out from the post along +x, its far end over it; a plain board is nailed on
      // square across it
      const tip = arrow ? h * 0.55 : 0, a = arrow ? -POST * 0.6 : -L / 2, z = arrow ? L : L / 2, span = z - a;
      const b = { text, paint, L: span, h, pad: Math.max(tip / span, 0.04) + 0.02 };
      const x0 = (cell % COLS) * CW, y0 = Math.floor(cell / COLS) * CH;
      paintBoard(g, x0, y0, b, R);
      cell++;
      const sh = new THREE.Shape();
      sh.moveTo(a, 0); sh.lineTo(z - tip, 0);
      if (arrow) sh.lineTo(z, h / 2);
      sh.lineTo(z - tip, h); sh.lineTo(a, h); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: THICK, bevelEnabled: false });
      geo.translate(0, -h / 2, -THICK / 2);
      // which way it points (the nearest of the post's faces to its road's heading), which face of the
      // post it is nailed to; a little askew
      const quarter = Math.round((HEADING[way] - sp.yaw) / (Math.PI / 2));
      const side = R() < 0.5 ? 1 : -1, yaw = quarter * Math.PI / 2 + (R() - 0.5) * 0.08, tilt = (R() - 0.5) * 0.06;
      e.set(0, yaw, tilt, 'YXZ');
      const bm = new THREE.Matrix4().compose(new THREE.Vector3(0, y - h / 2, 0), q.setFromEuler(e), s)
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, side * (POST / 2 + THICK / 2)));
      add(out, geo, base.clone().multiply(bm), (bx, by, bz, nz) => {
        // the faces carry the cell, the back one mirrored so it reads from behind; the edges the paint
        if (Math.abs(nz) < 0.5) return [U(x0 + 3), V(y0 + CH / 2)];
        let u = (bx - a) / span;
        if (nz < 0) u = 1 - u;
        return [U(x0 + u * CW), V(y0 + (0.5 - by / h) * CH)];
      }, 0.85 + R() * 0.15);
      y -= h + 0.03 + R() * 0.03;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  geo.computeBoundingSphere();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 });
  mat.name = 'waysign';
  const mesh = new THREE.Mesh(geo, matlib.resolve(mat));
  mesh.name = 'waysigns';
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
