// In a served Alpen page:
// await (await import('./tests/post-depth-browser-check.mjs')).runPostDepthCheck()
// Compare real multisampled world/post output with and without a depth resolve.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createRetro } from '../js/retro.js';
import { RENDER } from '../js/config.js';

export async function runPostDepthCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const oldBuffer = { ...RENDER.buffer };
  const renderer = new THREE.WebGLRenderer({
    canvas: new OffscreenCanvas(384, 256), antialias: false,
  });
  const gl = renderer.getContext();
  const targets = new Set(), materials = new Set(), geometries = new Set();
  const render = renderer.render.bind(renderer);
  const setTarget = renderer.setRenderTarget.bind(renderer);
  const blit = gl.blitFramebuffer.bind(gl);
  let currentTarget = null, worldTarget = null;
  let depthBlits = 0, colourBlits = 0;
  renderer.setRenderTarget = target => {
    if (target) targets.add(target);
    currentTarget = target;
    setTarget(target);
  };
  renderer.render = (scene, camera) => {
    if (currentTarget?.depthBuffer) worldTarget = currentTarget;
    scene.traverse(object => {
      if (object.material) materials.add(object.material);
      if (object.geometry) geometries.add(object.geometry);
    });
    render(scene, camera);
  };
  gl.blitFramebuffer = (...args) => {
    if (args[8] & gl.DEPTH_BUFFER_BIT) depthBlits++;
    if (args[8] & gl.COLOR_BUFFER_BIT) colourBlits++;
    return blit(...args);
  };
  try {
    renderer.setClearColor(0x17304f, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const retro = createRetro(THREE, renderer);
    retro.setSize(384, 256);
    const scene = new THREE.Scene();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.3),
      new THREE.MeshBasicMaterial({ color: 0xff5728 }));
    front.rotation.z = 0.37;
    front.position.set(-0.12, 0.03, 0.3);
    // Render the rear plane last, deliberately requiring depth occlusion.
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x52b4ef }));
    rear.renderOrder = 1;
    rear.rotation.z = -0.23;
    scene.add(front, rear);
    const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const draw = () => {
      depthBlits = colourBlits = 0;
      retro.render(scene, camera);
      const bytes = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
      gl.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height,
        gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return { bytes, depthBlits, colourBlits };
    };
    draw();
    assert(worldTarget?.depthBuffer && !worldTarget.resolveDepthBuffer,
      'the production world keeps depth testing without a depth resolve');
    const cases = [];
    for (const samples of [...new Set([0, retro.samples])]) {
      worldTarget.samples = samples;
      worldTarget.resolveDepthBuffer = true;
      worldTarget.dispose();
      const before = draw();
      worldTarget.resolveDepthBuffer = false;
      worldTarget.dispose();
      const after = draw();
      let largest = 0;
      const colours = new Set();
      for (let i = 0; i < before.bytes.length; i++) {
        largest = Math.max(largest, Math.abs(before.bytes[i] - after.bytes[i]));
        if (i % 4 === 0) colours.add(before.bytes.slice(i, i + 3).join(','));
      }
      assert(colours.size > 20, 'fixture includes resolved edges and visible overlapping surfaces');
      assert(largest === 0, 'omitting the depth resolve preserves every output pixel');
      assert(after.depthBlits === 0, 'production never blits the unused depth attachment');
      if (samples > 0 && before.colourBlits > 0) {
        assert(before.depthBlits > 0, 'reference reproduces the discarded depth resolve');
        assert(after.colourBlits === before.colourBlits, 'all colour resolves remain');
      }
      cases.push({ samples, largest, before: { depth: before.depthBlits, colour: before.colourBlits },
        after: { depth: after.depthBlits, colour: after.colourBlits } });
    }
    assert(gl.getError() === gl.NO_ERROR, 'no WebGL errors');
    return { size: [retro.width, retro.height], cases };
  } finally {
    gl.blitFramebuffer = blit;
    for (const target of targets) target.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    Object.assign(RENDER.buffer, oldBuffer);
  }
}
