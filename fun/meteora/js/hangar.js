/* Meteora — the hangar bay.

   Behind the hangar screen: the Perpetua's flight deck (hangar.glb, built
   by tools/blender/build_hangar.py) with the ship you are fitting out
   hovering over its pad.

   A scene of its own, lit like a deck: a key spot over the pad that casts
   the ship's shadow, cool light off the catwalk strips, a warm wash from
   the guide lamps down the launch lane, a blue glow from the open door and
   a faint sky fill; the bay's own light panels and strips glow through the
   bloom. Its reflections are the bay's, captured once when it loads.
   Through the launch door, the sky of wherever the Perpetua is.

   The camera shows the ship off: a tour round it from above — three-
   quarter from the front, the profile, the engines, high over the back,
   the other side — each shot the whole ship, held a while and drifting,
   eased from one to the next. Drag to look round it yourself and scroll to
   come closer; left alone, the tour picks up from wherever you left it.
   The ship sits in the middle of the screen, between the panels: `update`
   is told where that is, and the lens is set for the ship's outline to
   fill it, centred. Where the bay's walls or roof are nearer than a shot
   wants, the camera comes in along the same line and a wider lens frames
   the ship the same. */

import * as THREE from 'three';
import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';

const URL_GLB = new URL('../assets/models/hangar.glb', import.meta.url).href;
const PAD_TOP = 0.28, HOVER = 1.4;
// The lens: FOV where the bay leaves room; where it does not, the camera
// comes in along its line until the lens is WIDE, and never past WIDEST.
const FOV = 30, WIDE = 50, WIDEST = 58;
// How much of the space between the panels the ship fills, at most.
const FILL = 0.86;
// Where the camera may go: inside the bay, above the deck, under the roof.
const BAY = new THREE.Box3(new THREE.Vector3(-37, 0.6, -47), new THREE.Vector3(37, 21, 63));
// The shots, the whole ship in each: bearing round it (0 behind it, π
// before its nose), height (radians) and distance (1: it just fits).
const SHOTS = [
  { az: 2.4, el: 0.45, k: 1, hold: 6 },
  { az: 1.65, el: 0.38, k: 1, hold: 5 },
  { az: 0.7, el: 0.5, k: 1, hold: 5 },
  { az: -0.6, el: 0.75, k: 1, hold: 5 },
  { az: -1.9, el: 0.42, k: 1, hold: 5 },
  { az: -2.75, el: 0.55, k: 1, hold: 5 },
];
const MOVE = 2.6, HANDS_OFF = 5;
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const toward = (a, b) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Directions to find a ship's outline in, spread evenly round a sphere.
const AROUND = 96, AX = new Float64Array(AROUND), AY = new Float64Array(AROUND), AZ = new Float64Array(AROUND);
for (let i = 0; i < AROUND; i++) {
  const y = 1 - (2 * i + 1) / AROUND, r = Math.sqrt(1 - y * y), a = i * 2.39996;
  AX[i] = Math.cos(a) * r; AY[i] = y; AZ[i] = Math.sin(a) * r;
}
// A ship's outline: its furthest points out in each of those directions,
// from its centre. Keep these in view and the whole ship is.
function outlineOf(root, centre) {
  const far = new Float64Array(AROUND).fill(-Infinity), at = new Float64Array(3 * AROUND);
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const { x, y, z } = v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(centre);
      for (let k = 0; k < AROUND; k++) {
        const s = x * AX[k] + y * AY[k] + z * AZ[k];
        if (s > far[k]) { far[k] = s; at[3 * k] = x; at[3 * k + 1] = y; at[3 * k + 2] = z; }
      }
    }
  });
  const points = new Map();
  for (let k = 0; k < AROUND; k++) points.set(`${at[3 * k]},${at[3 * k + 1]},${at[3 * k + 2]}`, new THREE.Vector3().fromArray(at, 3 * k));
  return [...points.values()];
}

export function createHangar(renderer, library) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0e15, 0.0042);
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.3, 600);
  // The line from the ship out to the camera, where it leaves the bay and
  // where on it the shot wants the camera.
  const line = new THREE.Ray(), target = line.origin, exit = new THREE.Vector3(), wish = new THREE.Vector3();
  // The camera's sideways and upward axes, and its way back to the ship.
  const UP = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(), up = new THREE.Vector3(), back = new THREE.Vector3();
  const outlines = new Map();
  const holder = new THREE.Group();
  scene.add(holder);
  let ship = null, shown = null, wanted = null, ready = false;
  let outline = [], centreY = 3;
  // The camera: where it is now, and the tour it is on.
  const view = { ...SHOTS[0] };
  let shot = 0, moving = false, clock = 0, from = null, idle = HANDS_OFF;

  // The lamps.
  scene.add(new THREE.HemisphereLight(0xaab8d8, 0x2b2620, 0.55));
  const key = new THREE.SpotLight(0xfff0dc, 1700, 0, 0.62, 0.65, 2);
  key.position.set(5, 17, 7);
  key.target.position.set(0, 1.5, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 6; key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  for (const s of [-1, 1]) {
    const strip = new THREE.PointLight(0x9cc6ff, 520, 0, 2);
    strip.position.set(s * 17, 8, -4);
    scene.add(strip);
  }
  const lane = new THREE.PointLight(0xffa15a, 260, 0, 2);
  lane.position.set(0, 2.5, -18);
  const door = new THREE.PointLight(0x7fb8ff, 900, 0, 2);
  door.position.set(0, 9, -46);
  const front = new THREE.DirectionalLight(0xc8d8ff, 0.5);
  front.position.set(-6, 8, 30);
  scene.add(lane, door, front);

  const loaded = new GLTFLoader().loadAsync(URL_GLB).then(gltf => {
    const bay = gltf.scene;
    bay.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = false; } });
    scene.add(bay);
    // The bay's own reflections, before any ship is in it.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(scene, 0.02, 0.5, 300, { size: 256, position: new THREE.Vector3(0, 3, 0) });
    pmrem.dispose();
    scene.environment = env.texture;
    scene.environmentIntensity = 0.7;
    ready = true;
  }).catch(error => console.warn('meteora: the hangar could not be loaded', error));

  function place(model) {
    if (shown === model && ship) return;
    const inst = library.instantiate(model);
    if (!inst) return;
    if (ship) holder.remove(ship);
    ship = inst.root;
    shown = model;
    // Hovering over the pad, centred on it, nose to the launch door.
    ship.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ship);
    const centre = box.getCenter(new THREE.Vector3());
    if (!outlines.has(model)) outlines.set(model, outlineOf(ship, centre));
    outline = outlines.get(model);
    ship.position.set(-centre.x, PAD_TOP + HOVER - box.min.y, -centre.z);
    centreY = PAD_TOP + HOVER + (box.max.y - box.min.y) / 2;
    ship.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    holder.add(ship);
  }

  // The tour: hold a shot, drifting, then ease to the next — unless the
  // player has had the camera in the last few seconds.
  function tour(dt) {
    idle += dt;
    if (idle < HANDS_OFF) return;
    clock += dt;
    if (moving) {
      const to = SHOTS[shot], e = ease(Math.min(1, clock / MOVE));
      view.az = from.az + (toward(from.az, to.az) - from.az) * e;
      for (const k of ['el', 'k']) view[k] = from[k] + (to[k] - from[k]) * e;
      if (clock >= MOVE) { moving = false; clock = 0; }
    } else {
      view.az -= dt * 0.035;
      if (clock > SHOTS[shot].hold) {
        from = { ...view };
        shot = (shot + 1) % SHOTS.length;
        moving = true; clock = 0;
      }
    }
  }
  // The player takes the camera; the tour resumes from there.
  const takeOver = () => { idle = 0; moving = false; clock = Infinity; };

  // The camera's axes when it looks back along `dir` (unit, ship to camera).
  function axes(dir) { right.crossVectors(UP, dir).normalize(); up.crossVectors(dir, right); }
  // How the ship's outline lies across the view from `eye`, looking at the
  // ship's centre: left to right and bottom to top, in tangents.
  const span = { x0: 0, x1: 0, y0: 0, y1: 0 };
  function spread(eye) {
    const dist = back.subVectors(eye, target).length();
    axes(back.divideScalar(dist));
    span.x0 = span.y0 = Infinity; span.x1 = span.y1 = -Infinity;
    for (const p of outline) {
      const depth = dist - p.dot(back);
      if (depth < 0.5) continue;
      const x = p.dot(right) / depth, y = p.dot(up) / depth;
      span.x0 = Math.min(span.x0, x); span.x1 = Math.max(span.x1, x);
      span.y0 = Math.min(span.y0, y); span.y1 = Math.max(span.y1, y);
    }
    return span;
  }
  // The lens (the tangent of half its height) that just takes the whole
  // ship in from `eye`, in a share `sx` × `sy` of the view.
  function lensFrom(eye, sx, sy) {
    const s = spread(eye);
    return Math.max(1e-3, (s.x1 - s.x0) / 2 / sx, (s.y1 - s.y0) / 2 / sy);
  }

  return {
    scene, camera, loaded,
    get ready() { return ready; },
    /* The hull on the pad (a model name); one still loading is put there
       when it arrives. */
    show(model) { if (model) { wanted = model; place(model); } },
    /* Ships to get the renderer ready on, one of each hull. */
    samples(models) { return models.map(m => library.instantiate(m)?.root).filter(Boolean); },
    /* The sky outside the launch door. */
    setSky(texture) { scene.background = texture ?? null; },
    /* Drag to look round (CSS pixels), scroll to come closer. */
    turn(dx, dy = 0) {
      takeOver();
      view.az -= dx * 0.007;
      view.el = Math.max(-0.12, Math.min(1.25, view.el + dy * 0.005));
    },
    zoom(dy) {
      takeOver();
      view.k = Math.max(0.38, Math.min(1.5, view.k * Math.exp(dy * 0.0012)));
    },
    grab() { takeOver(); },
    /* Once a frame while the hangar is up; `stage` is the middle column's
       rectangle and `w`, `h` the canvas's size, in CSS pixels. */
    update(dt, stage, w, h) {
      if (!stage?.width) stage = null; // no room between panels: the whole screen
      if (wanted && wanted !== shown) place(wanted);
      tour(dt);
      // The space between the panels, as a share of the view's width and
      // height: at k = 1 the ship's outline just fills it.
      camera.aspect = w / h;
      const sx = FILL * camera.aspect * (stage ? Math.max(240, stage.width) / w : 1);
      const sy = FILL * (stage ? Math.max(240, stage.height) / h : 1);
      const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      // Out from the ship along the shot's line, just far enough for the
      // lens to take all of it in...
      const ce = Math.cos(view.el);
      target.set(0, centreY, 0);
      const u = line.direction.set(Math.sin(view.az) * ce, Math.sin(view.el), Math.cos(view.az) * ce);
      axes(u);
      let reach = 4;
      for (const p of outline) reach = Math.max(reach, p.dot(u) + Math.max(Math.abs(p.dot(right)) / sx, Math.abs(p.dot(up)) / sy) / tanV);
      const d = reach * view.k;
      // ...as far as the bay allows; nearer than the widest lens can make
      // up for, keep to the walls.
      const room = line.intersectBox(BAY, exit) ? exit.distanceTo(target) : d;
      const along = Math.min(d, Math.max(room, d * tanV / Math.tan(THREE.MathUtils.degToRad(WIDE / 2))));
      BAY.clampPoint(line.at(along, camera.position), camera.position);
      camera.lookAt(target);
      // The lens that just takes the ship in from out there; coming closer
      // to look (k < 1) keeps it, and held nearer by the bay it widens to
      // frame the ship as the shot wants it.
      let lens = lensFrom(line.at(reach, wish), sx, sy);
      lens /= lensFrom(line.at(d, wish), sx, sy);
      lens *= lensFrom(camera.position, sx, sy);
      camera.fov = Math.min(WIDEST, THREE.MathUtils.radToDeg(2 * Math.atan(lens)));
      // The ship's outline centred on the space between the panels.
      const s = spread(camera.position), t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const mx = Number.isFinite(s.x0) ? (s.x0 + s.x1) / 2 : 0, my = Number.isFinite(s.y0) ? (s.y0 + s.y1) / 2 : 0;
      const cx = stage ? stage.x + stage.width / 2 : w / 2, cy = stage ? stage.y + stage.height / 2 : h / 2;
      camera.setViewOffset(w, h, w / 2 * (1 + mx / (t * camera.aspect)) - cx, h / 2 * (1 - my / t) - cy, w, h);
      camera.updateProjectionMatrix();
    },
  };
}
