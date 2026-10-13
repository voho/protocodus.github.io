/* Meteora — the target, up close.

   A window in the HUD's target panel shows the ship you have targeted as
   you see it from where you are — which side it turns to you, which way it
   rolls — whatever its range, framed to fill the window by the outline it
   shows from there (easing as it turns), the way a fighter pilot's sensors
   would picture it.

   It has a small renderer of its own on its own canvas, laid over the
   scene and under the HUD, so it is drawn after the scene's bloom and tone
   mapping without touching them; and lights of its own: a key light from
   over the viewer's shoulder and a cool rim light from behind the target,
   so the silhouette reads whatever the sky. A torpedo in flight shows as a
   torpedo. Without WebGL to spare, the window simply stays empty.

   A second renderer is a second set of everything: its own shaders, its
   own copy of every map. So the hulls it shows wear copies of their maps
   no bigger than the window can use (a few hundred pixels across, it would
   draw a 2048-pixel map from its 512-pixel level anyway). Shrinking one
   takes the main thread a few milliseconds, so they are made one a frame,
   starting while the briefing is read (`prefetch`), and the loading screen
   gets the window ready for every model a flight may show (`warm`): maps
   uploaded, shaders compiled, each model measured once and kept — the
   first look at a new kind of ship costs the flight nothing. */

import * as THREE from 'three';
import { cloneMaterial, tint } from './models.js';

const MAP = 512;

/* A smaller copy of an image, filtered as a mipmap would be. */
async function scaled(image, w, h) {
  try {
    const bitmap = await createImageBitmap(image, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    if (bitmap.width === w && bitmap.height === h) return bitmap;
    bitmap.close?.();
  } catch { /* on a canvas, then */ }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'medium';
  g.drawImage(image, 0, 0, w, h);
  return canvas;
}

/* `pause()` gives the browser a frame between two shrinkings. */
export function createTargetView(canvas, library, { exposure = 1.05, pause = () => new Promise(resolve => setTimeout(resolve, 16)) } = {}) {
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return { update() {}, prefetch() {}, async warm() {} };
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Hulls are metal: without something to reflect they would show black.
  // A soft studio sky — cool above, warm at the horizon, dark below.
  const W = 64, H = 32, sky = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const up = 1 - j / (H - 1) * 2;   // +1 at the top row, −1 at the bottom
    const c = up > 0 ? [70 + 90 * up, 90 + 100 * up, 120 + 110 * up] : [60 + 30 * (1 + up), 52 + 20 * (1 + up), 48 + 10 * (1 + up)];
    for (let i = 0; i < W; i++) sky.set([...c, 255], (j * W + i) * 4);
  }
  const environment = new THREE.DataTexture(sky, W, H, THREE.RGBAFormat);
  environment.mapping = THREE.EquirectangularReflectionMapping;
  environment.colorSpace = THREE.SRGBColorSpace;
  environment.flipY = true;
  environment.needsUpdate = true;
  scene.environment = environment;
  scene.environmentIntensity = 1.2;
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.5, 20000);
  const key = new THREE.DirectionalLight(0xfff1e0, 5), rim = new THREE.DirectionalLight(0x9fc8ff, 3.2);
  scene.add(new THREE.HemisphereLight(0x8ea6d8, 0x4a3a30, 0.9), key, key.target, rim, rim.target);

  let shown = null, current = null, fit = 1;
  const bounds = new THREE.Box3();
  const corner = new THREE.Vector3(), right = new THREE.Vector3(), turnQ = new THREE.Quaternion();
  const toViewer = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
  const size = { w: 0, h: 0, x: -1, y: -1, dpr: 0 };

  // A full-size map → the promise of its window copy, made one a frame.
  const shrunk = new Map(), queue = [];
  let working = false;
  function shrink(map) {
    let copy = shrunk.get(map);
    if (copy) return copy;
    const w = map.image?.width ?? 0, h = map.image?.height ?? 0;
    if (Math.max(w, h) <= MAP || map.isDataTexture || map.isRenderTargetTexture) copy = Promise.resolve(map);
    else {
      copy = new Promise(resolve => queue.push({ map, w, h, resolve }));
      if (!working) work();
    }
    shrunk.set(map, copy);
    return copy;
  }
  async function work() {
    working = true;
    while (queue.length) {
      const { map, w, h, resolve } = queue.shift();
      const k = MAP / Math.max(w, h);
      resolve(await scaled(map.image, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).then(image => {
        const small = map.clone();
        small.source = new THREE.Source(image);   // the full-size map keeps its own
        small.needsUpdate = true;
        return small;
      }, () => map));
      await pause();
    }
    working = false;
  }
  // A model's material → the window's copy of it, or the promise of one.
  const coats = new Map();
  function coat(material) {
    let c = coats.get(material);
    if (c === undefined) {
      const keys = Object.keys(material).filter(k => material[k]?.isTexture);
      c = Promise.all(keys.map(k => shrink(material[k]))).then(small => {
        const copy = cloneMaterial(material);
        keys.forEach((k, i) => { copy[k] = small[i]; });
        coats.set(material, copy);
        return copy;
      });
      coats.set(material, c);
    }
    return c.isMaterial ? c : null;
  }

  /* The window's own copy of a model in a paint at a scale, kept: in its
     window materials, measured once — the sphere round it as it was built
     (the window is filled by that, so it does not breathe as it turns),
     and a sample of its own points, turned each frame to measure the
     outline it shows the camera. Null until its maps are ready. */
  const kept = new Map();
  function entryFor(model, paint, scale) {
    const key = `${model}|${paint ?? ''}|${scale}`;
    let entry = kept.get(key);
    if (entry?.ready) return entry;
    if (!entry) {
      const inst = library.instantiate(model);
      if (!inst) return null;
      entry = { root: inst.root, meshes: [], ready: false, centre: new THREE.Vector3(), radius: 1, points: null };
      inst.root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; entry.meshes.push([o, o.material]); } });
      kept.set(key, entry);
    }
    const coated = entry.meshes.map(([, m]) => (Array.isArray(m) ? m.map(coat) : coat(m)));
    if (coated.some(c => (Array.isArray(c) ? c.some(x => !x) : !c))) return null;
    entry.meshes.forEach(([o], i) => { o.material = coated[i]; });
    const root = entry.root;
    if (paint) tint(root, paint);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const sphere = bounds.setFromObject(root).getBoundingSphere(new THREE.Sphere());
    bounds.getCenter(entry.centre);
    entry.radius = sphere.radius;
    const all = [];
    root.traverse(o => { if (o.isMesh && o.geometry.attributes.position) all.push(o); });
    const total = all.reduce((n, o) => n + o.geometry.attributes.position.count, 0);
    const every = Math.max(1, Math.ceil(total / 900));
    const list = [];
    for (const o of all) {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += every) {
        corner.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(entry.centre);
        list.push(corner.x, corner.y, corner.z);
      }
    }
    entry.points = new Float32Array(list);
    entry.ready = true;
    return entry;
  }

  return {
    /* Every frame: what is targeted (or null), the player's camera, and the
       window's place on the screen in CSS pixels ({ x, y, w, h }). */
    update(target, viewer, rect) {
      if (!target || !rect || rect.w < 8 || rect.h < 8) {
        if (canvas.style.display !== 'none') canvas.style.display = 'none';
        return;
      }
      if (canvas.style.display !== 'block') canvas.style.display = 'block';
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (rect.w !== size.w || rect.h !== size.h || dpr !== size.dpr) {
        Object.assign(size, { w: rect.w, h: rect.h, dpr });
        renderer.setPixelRatio(dpr);
        renderer.setSize(Math.round(rect.w), Math.round(rect.h), false);
        canvas.style.width = `${rect.w}px`; canvas.style.height = `${rect.h}px`;
        camera.aspect = rect.w / rect.h;
        camera.updateProjectionMatrix();
      }
      if (rect.x !== size.x || rect.y !== size.y) {
        size.x = rect.x; size.y = rect.y;
        canvas.style.left = `${rect.x}px`; canvas.style.top = `${rect.y}px`;
      }

      if (target !== shown) {
        if (current) scene.remove(current.root);
        current = null; shown = target; fit = 0;
      }
      if (!current) {
        current = entryFor(target.proxy ? 'torpedo' : target.model, target.tint, target.scale ?? 1);
        if (current) scene.add(current.root);
      }
      if (!current) { renderer.clear(); return; }
      const { root, centre, points } = current;
      // As you see it: its own attitude, the camera on your side of it, up
      // as your view's up.
      const q = target.ship.q;
      root.quaternion.set(q[0], q[1], q[2], q[3]);
      root.position.copy(centre).applyQuaternion(root.quaternion).negate();
      const p = target.ship.pos;
      toViewer.set(viewer.position.x - p[0], viewer.position.y - p[1], viewer.position.z - p[2]);
      if (toViewer.lengthSq() < 1e-6) toViewer.set(0, 0, 1);
      toViewer.normalize();
      up.set(0, 1, 0).applyQuaternion(viewer.quaternion);
      // The distance at which every point of the hull is inside the window,
      // in true perspective, with a little room.
      right.crossVectors(up, toViewer).normalize();
      up.crossVectors(toViewer, right).normalize();
      turnQ.set(q[0], q[1], q[2], q[3]);
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / 1.08, tanH = tanV * camera.aspect;
      let want = 1;
      for (let i = 0; i < points.length; i += 3) {
        corner.set(points[i], points[i + 1], points[i + 2]).applyQuaternion(turnQ);
        want = Math.max(want, corner.dot(toViewer) + Math.max(Math.abs(corner.dot(right)) / tanH, Math.abs(corner.dot(up)) / tanV));
      }
      fit = fit > 0 ? fit + (want - fit) * 0.12 : want;
      camera.position.copy(toViewer).multiplyScalar(fit);
      camera.up.copy(up);
      camera.lookAt(0, 0, 0);
      side.crossVectors(toViewer, up).normalize();
      key.position.copy(toViewer).addScaledVector(up, 0.8).addScaledVector(side, -0.6).multiplyScalar(fit);
      rim.position.copy(toViewer).multiplyScalar(-1).addScaledVector(up, 0.4).multiplyScalar(fit);
      renderer.render(scene, camera);
    },
    /* Start making the window's maps for these models (pairs of model and
       paint), in the background. */
    prefetch(looks) {
      for (const [model, paint] of looks) entryFor(model, paint, 1);
    },
    /* Under the loading screen: every model a flight may show, its maps
       shrunk and uploaded and its shaders compiled, in this renderer. */
    async warm(looks) {
      const ask = () => looks.map(([model, paint]) => entryFor(model, paint, 1));
      ask();
      await Promise.all(coats.values());
      const entries = ask().filter(Boolean);
      const group = new THREE.Group();
      for (const entry of entries) group.add(entry.root);
      scene.add(group);
      try {
        await renderer.compileAsync(group, camera, scene);
        group.traverse(o => {
          if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const v of Object.values(m)) if (v?.isTexture) renderer.initTexture(v);
        });
        renderer.render(scene, camera);
        renderer.clear();
      } finally {
        scene.remove(group);
        for (const entry of entries) group.remove(entry.root);
        if (current) scene.add(current.root);
      }
    },
    // For the console: how the current target is framed.
    get framing() { return { fit, radius: current?.radius, centre: current?.centre.toArray(), camera: camera.position.toArray(), fov: camera.fov, aspect: camera.aspect }; },
  };
}
