/* Meteora — the hangar bay.

   Behind the hangar screen: the Perpetua's flight deck (hangar.glb, built
   by tools/blender/build_hangar.py) with the ship you are fitting out on
   its turntable, turning slowly; drag to turn it yourself.

   A scene of its own, lit like a deck: a key spot over the pad that casts
   the ship's shadow, cool light off the catwalk strips, a warm wash from
   the guide lamps down the launch lane, a blue glow from the open door and
   a faint sky fill; the bay's own light panels and strips glow through the
   bloom. Its reflections are the bay's, captured once when it loads.
   Through the launch door, the sky of wherever the Perpetua is.

   The ship sits in the middle column of the screen, between the panels:
   `update` is told where that is and shifts the view to centre it there. */

import * as THREE from 'three';
import { GLTFLoader } from '../assets/vendor/GLTFLoader.js';

const URL_GLB = new URL('../assets/models/hangar.glb', import.meta.url).href;
const PAD_TOP = 0.28, HOVER = 1.4;
const IDLE_SPIN = 0.16;     // rad/s while nobody is turning it

export function createHangar(renderer, library) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0e15, 0.0042);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 600);
  const holder = new THREE.Group();
  scene.add(holder);
  let turntable = null, ship = null, shown = null, wanted = null, ready = false, time = 0;
  let spin = -0.6, drag = null, still = 0, radius = 9, centreY = 3;

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
    turntable = bay.getObjectByName('turntable');
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
    // Hovering over the pad, centred on it.
    ship.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ship);
    const centre = box.getCenter(new THREE.Vector3());
    ship.position.set(-centre.x, PAD_TOP + HOVER - box.min.y, -centre.z);
    radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    centreY = PAD_TOP + HOVER + (box.max.y - box.min.y) / 2;
    ship.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    holder.add(ship);
  }

  return {
    scene, camera, loaded,
    get ready() { return ready; },
    /* The hull on the turntable (a model name); one still loading is put
       there when it arrives. */
    show(model) { if (model) { wanted = model; place(model); } },
    /* Ships to get the renderer ready on, one of each hull. */
    samples(models) { return models.map(m => library.instantiate(m)?.root).filter(Boolean); },
    /* The sky outside the launch door. */
    setSky(texture) { scene.background = texture ?? null; },
    /* Drag to turn: `dx` in CSS pixels. */
    turn(dx) { spin += dx * 0.008; still = 0; },
    grab(on) { drag = on; still = 0; },
    /* Once a frame while the hangar is up; `stage` is the middle column's
       rectangle and `w`, `h` the canvas's size, in CSS pixels. */
    update(dt, stage, w, h) {
      time += dt;
      if (wanted && wanted !== shown) place(wanted);
      still += dt;
      if (!drag && still > 1.5) spin += dt * IDLE_SPIN * Math.min(1, (still - 1.5) / 2);
      holder.rotation.y = spin;
      if (turntable) turntable.rotation.y = spin;
      // Framed to fit the middle column whichever way the ship is turned,
      // from a little above and to the side, drifting a touch.
      camera.aspect = w / h;
      const colW = Math.max(240, stage?.width || w * 0.5);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const tanH = tanV * camera.aspect * (colW / w);
      const fit = Math.min(tanV * 1.05, tanH);
      // Never back through the wall behind (the bay runs 66 m that way).
      const d = Math.min(58, Math.max(16, radius / fit * 1.2));
      const az = 0.42 + 0.05 * Math.sin(time * 0.11), el = 0.13 + 0.025 * Math.sin(time * 0.07);
      camera.position.set(Math.sin(az) * Math.cos(el) * d, centreY + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
      camera.lookAt(0, centreY, 0);
      const cx = stage ? stage.x + stage.width / 2 : w / 2, cy = stage ? stage.y + stage.height / 2 : h / 2;
      camera.setViewOffset(w, h, w / 2 - cx, (h / 2 - cy) * 0.6, w, h);
      camera.updateProjectionMatrix();
    },
  };
}
