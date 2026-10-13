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
   torpedo. Without WebGL to spare, the window simply stays empty. */

import * as THREE from 'three';
import { tint } from './models.js';

export function createTargetView(canvas, library, { exposure = 1.05 } = {}) {
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return { update() {} };
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

  let shown = null, inst = null, fit = 1, ready = false;
  const centre = new THREE.Vector3(), bounds = new THREE.Box3(), sphere = new THREE.Sphere();
  // A sample of the hull's own points, turned each frame to measure the
  // outline it shows the camera.
  let points = new Float32Array(0);
  const corner = new THREE.Vector3(), right = new THREE.Vector3(), turnQ = new THREE.Quaternion();
  const toViewer = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
  const size = { w: 0, h: 0, x: -1, y: -1, dpr: 0 };

  const drop = () => {
    if (inst) scene.remove(inst.root);
    inst = null; shown = null; ready = false;
  };

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

      if (target !== shown) { drop(); shown = target; }
      if (!inst) {
        inst = library.instantiate(target.proxy ? 'torpedo' : target.model);
        if (inst) {
          inst.root.scale.setScalar(target.scale ?? 1);
          if (target.tint) tint(inst.root, target.tint);
          scene.add(inst.root);
        }
      }
      if (!inst) { renderer.clear(); return; }
      if (!ready) {
        // How big it is, turned as it was built: the window is filled by
        // the sphere around it, so it does not breathe as it turns.
        inst.root.quaternion.identity();
        inst.root.updateMatrixWorld(true);
        bounds.setFromObject(inst.root).getBoundingSphere(sphere);
        bounds.getCenter(centre);
        const all = [];
        inst.root.traverse(o => { if (o.isMesh && o.geometry.attributes.position) all.push(o); });
        const total = all.reduce((n, o) => n + o.geometry.attributes.position.count, 0);
        const every = Math.max(1, Math.ceil(total / 900));
        const list = [];
        for (const o of all) {
          const pos = o.geometry.attributes.position;
          for (let i = 0; i < pos.count; i += every) {
            corner.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(centre);
            list.push(corner.x, corner.y, corner.z);
          }
        }
        points = new Float32Array(list);
        fit = 0;
        ready = true;
      }
      // As you see it: its own attitude, the camera on your side of it, up
      // as your view's up.
      const q = target.ship.q;
      inst.root.quaternion.set(q[0], q[1], q[2], q[3]);
      inst.root.position.copy(centre).applyQuaternion(inst.root.quaternion).negate();
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
    // For the console: how the current target is framed.
    get framing() { return { fit, radius: sphere.radius, centre: centre.toArray(), camera: camera.position.toArray(), fov: camera.fov, aspect: camera.aspect }; },
  };
}
