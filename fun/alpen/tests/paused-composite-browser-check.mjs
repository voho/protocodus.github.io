// Compare the actual production cached composite against full rendering.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createRetro } from '../js/retro.js';
import { RENDER } from '../js/config.js';

export async function runPausedCompositeCheck() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const oldBuffer = { ...RENDER.buffer };
  const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(128, 96), antialias: false });
  const gl = renderer.getContext(), targets = new Set(), materials = new Set(), geometries = new Set();
  const nativeRender = renderer.render.bind(renderer), nativeTarget = renderer.setRenderTarget.bind(renderer);
  const hasExtension = renderer.extensions.has.bind(renderer.extensions);
  // Deterministic quality walk; this fixture is not a speed measurement.
  renderer.extensions.has = name => name !== 'EXT_disjoint_timer_query_webgl2' && hasExtension(name);
  let calls = 0, target = null;
  renderer.setRenderTarget = value => { target = value; if (value) targets.add(value); nativeTarget(value); };
  renderer.render = (scene, camera) => {
    calls++;
    scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    nativeRender(scene, camera);
  };
  try {
    renderer.setClearColor(0x17304f, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    const retro = createRetro(THREE, renderer); retro.setSize(128, 96);
    const scene = new THREE.Scene();
    const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.4, .25) });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), hot);
    front.rotation.z = .37; front.position.set(-.12, .03, .3);
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x52b4ef }));
    rear.renderOrder = 1; rear.rotation.z = -.23; scene.add(front, rear);
    const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1, -1, .1, 10); camera.position.z = 2;
    const read = () => {
      const bytes = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
      gl.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    const cases = [];
    const compare = label => {
      calls = 0; const policy = renderer.autoClear;
      assert(retro.renderComposite(), label + ': cache reusable');
      assert(calls === 1, label + ': only final composite');
      assert(renderer.autoClear === policy && target === null, label + ': renderer state restored');
      const cached = read(); calls = 0; retro.render(scene, camera);
      const reference = read(), fullCalls = calls;
      let largest = 0;
      for (let i = 0; i < cached.length; i++) largest = Math.max(largest, Math.abs(cached[i] - reference[i]));
      assert(fullCalls > 1, label + ': full reference draws world/lighting');
      assert(largest <= 1, label + ': production pixels match');
      cases.push({ label, largest, cachedCalls: 1, fullCalls });
    };
    calls = 0; assert(!retro.renderComposite() && calls === 0, 'no cache before full render');
    retro.setSun(.55, .7, .7); retro.render(scene, camera);
    const initial = read(), colors = new Set();
    let low = 255, high = 0;
    for (let i = 0; i < initial.length; i += 4) {
      colors.add(initial[i] * 65536 + initial[i + 1] * 256 + initial[i + 2]);
      const luma = initial[i] * .2126 + initial[i + 1] * .7152 + initial[i + 2] * .0722;
      low = Math.min(low, luma); high = Math.max(high, luma);
    }
    assert(colors.size > 20 && high - low > 30, 'fixture renders real HDR colors and depth edges');
    retro.fade(.42); retro.crash(.75);
    for (const dt of [.08, .2, .4]) { retro.updateEffects(dt, false); compare('fade-fall-' + dt); }
    renderer.autoClear = false; compare('caller-autoClear-false'); renderer.autoClear = true;
    const drive = (done, dt) => {
      for (let i = 0; i < 20000 && !done(); i++) retro.updatePerformance(typeof dt === 'function' ? dt() : dt);
      assert(done(), 'governor reaches fixture scale');
    };
    drive(() => retro.scale <= .7, () => .012 + .03 * retro.scale * retro.scale);
    retro.render(scene, camera);
    for (const dt of [.1, .3, 1]) { retro.updateEffects(dt, false); compare('halo-fade-' + dt); }
    retro.updateEffects(2, false); retro.render(scene, camera);
    drive(() => retro.scale > .75, 1 / 90);
    hot.color.setRGB(.2, 1.7, 4); retro.render(scene, camera);
    retro.updateEffects(.05, false); calls = 0;
    assert(!retro.renderComposite() && calls === 0, 'newly visible halo needs current wide image');
    retro.render(scene, camera); compare('halo-rearmed-after-fallback');
    retro.setSize(129, 96); calls = 0;
    assert(!retro.renderComposite() && calls === 0, 'resize invalidates');
    retro.render(scene, camera); compare('after-resize');
    retro.setSun(.3, .6, .5); calls = 0;
    assert(!retro.renderComposite() && calls === 0, 'changed rays invalidate');
    retro.render(scene, camera); compare('changed-rays');
    assert(gl.getError() === gl.NO_ERROR, 'no WebGL errors');
    return { cases, haloRearmFallback: true, resizeInvalidation: true, rayInvalidation: true };
  } finally {
    for (const item of targets) item.dispose();
    for (const item of materials) item.dispose();
    for (const item of geometries) item.dispose();
    renderer.dispose(); renderer.forceContextLoss(); Object.assign(RENDER.buffer, oldBuffer);
  }
}
