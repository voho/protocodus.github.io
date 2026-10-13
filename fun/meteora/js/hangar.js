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

   The camera shows the ship off: a tour of shots — three-quarter from the
   front, the profile, the engines, from above, close on the nose, low
   under it — each held a while and drifting, eased from one to the next.
   Drag to look round it yourself and scroll to come closer; left alone,
   the tour picks up from wherever you left it. The ship sits in the middle
   column of the screen, between the panels: `update` is told where that
   is and shifts the view to centre it there. Where the bay's walls keep
   the camera closer than a shot wants, a wider lens frames it the same. */

import * as THREE from 'three';
import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';

const URL_GLB = new URL('../assets/models/hangar.glb', import.meta.url).href;
const PAD_TOP = 0.28, HOVER = 1.4, FOV = 30;
// The shots: bearing round the ship (0 behind it, π before its nose), height
// (radians), distance (1: the whole ship fills the column) and where to look
// along the ship (−1 the nose, 1 the tail).
const SHOTS = [
  { az: 2.35, el: 0.2, k: 0.95, look: 0, hold: 6 },
  { az: 1.57, el: 0.05, k: 1.05, look: 0, hold: 5 },
  { az: 0.55, el: 0.12, k: 0.72, look: 0.45, hold: 5 },
  { az: -0.7, el: 0.9, k: 1.0, look: 0, hold: 5 },
  { az: 3.6, el: 0.1, k: 0.5, look: -0.55, hold: 5 },
  { az: 4.2, el: -0.03, k: 0.78, look: -0.1, hold: 5 },
];
const MOVE = 2.6, HANDS_OFF = 5;
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const toward = (a, b) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function createHangar(renderer, library) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0e15, 0.0042);
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.3, 600);
  const target = new THREE.Vector3();
  const holder = new THREE.Group();
  scene.add(holder);
  let ship = null, shown = null, wanted = null, ready = false;
  let radius = 9, centreY = 3, half = 7;
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
    ship.position.set(-centre.x, PAD_TOP + HOVER - box.min.y, -centre.z);
    radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    centreY = PAD_TOP + HOVER + (box.max.y - box.min.y) / 2;
    half = (box.max.z - box.min.z) / 2;
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
      for (const k of ['el', 'k', 'look']) view[k] = from[k] + (to[k] - from[k]) * e;
      if (clock >= MOVE) { moving = false; clock = 0; }
    } else {
      view.az += dt * 0.035;
      if (clock > SHOTS[shot].hold) {
        from = { ...view };
        shot = (shot + 1) % SHOTS.length;
        moving = true; clock = 0;
      }
    }
  }
  // The player takes the camera; the tour resumes from there.
  const takeOver = () => { idle = 0; moving = false; clock = Infinity; };

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
      if (wanted && wanted !== shown) place(wanted);
      tour(dt);
      // At k = 1 the ship, turned any way, just fills the middle column.
      camera.aspect = w / h;
      const colW = Math.max(240, stage?.width || w * 0.5);
      const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const fit = Math.min(tanV * 1.05, tanV * camera.aspect * (colW / w));
      const d = Math.max(4, radius / fit * view.k);
      const lookZ = view.look * half;
      const ce = Math.cos(view.el);
      camera.position.set(Math.sin(view.az) * ce * d, centreY + Math.sin(view.el) * d, lookZ + Math.cos(view.az) * ce * d);
      // Inside the bay, above the deck.
      camera.position.x = Math.max(-37, Math.min(37, camera.position.x));
      camera.position.y = Math.max(0.6, Math.min(21, camera.position.y));
      camera.position.z = Math.max(-47, Math.min(63, camera.position.z));
      target.set(0, centreY, lookZ);
      camera.lookAt(target);
      // Held closer by a wall or the roof: widen the lens to match.
      const held = camera.position.distanceTo(target);
      camera.fov = Math.min(55, THREE.MathUtils.radToDeg(2 * Math.atan(tanV * d / held)));
      const cx = stage ? stage.x + stage.width / 2 : w / 2, cy = stage ? stage.y + stage.height / 2 : h / 2;
      camera.setViewOffset(w, h, w / 2 - cx, (h / 2 - cy) * 0.6, w, h);
      camera.updateProjectionMatrix();
    },
  };
}
