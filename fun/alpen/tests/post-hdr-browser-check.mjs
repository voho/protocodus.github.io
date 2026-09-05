// In the running game page's console:
// await (await import('./tests/post-hdr-browser-check.mjs')).runPostHdrCheck()
// Uses a separate offscreen WebGL context and disposes it before returning.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createRetro } from '../js/retro.js';
import { RENDER, RIDER } from '../js/config.js';

export async function runPostHdrCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const oldBuffer = { ...RENDER.buffer };
  const renderer = new THREE.WebGLRenderer({
    canvas: new OffscreenCanvas(384, 256), antialias: false,
  });
  const gl = renderer.getContext();
  const targets = new Set(), materials = new Set(), geometries = new Set();
  const render = renderer.render.bind(renderer);
  const setTarget = renderer.setRenderTarget.bind(renderer);
  renderer.setRenderTarget = target => { if (target) targets.add(target); setTarget(target); };
  renderer.render = (scene, camera) => {
    scene.traverse(object => {
      if (object.material) materials.add(object.material);
      if (object.geometry) geometries.add(object.geometry);
    });
    render(scene, camera);
  };
  let texture;
  try {
    assert(renderer.extensions.has('EXT_color_buffer_float'), 'HDR float render targets required');
    renderer.setClearColor(0, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const retro = createRetro(THREE, renderer);
    retro.setSize(384, 256);
    retro.setSun(0.8, 0.7, 0.5);
    const W = retro.width, H = retro.height;
    const data = new Float32Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // A dark field plus valid radiance above one checks the full HDR range
      // used by the game rather than only an LDR colour ramp.
      const light = x > W * 0.72 && y > H * 0.6 ? 8 : 0.04;
      data.set([light, light * 1.1, light * 1.3, 1], i);
    }
    texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const world = new THREE.Scene();
    world.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { pattern: { value: texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D pattern; varying vec2 vUv; void main() { gl_FragColor = texture2D(pattern, vUv); }',
      depthTest: false, depthWrite: false,
    })));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pixels = () => {
      const bytes = new Uint8Array(renderer.domElement.width * renderer.domElement.height * 4);
      gl.readPixels(0, 0, renderer.domElement.width, renderer.domElement.height,
        gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    const invalidPostChannels = () => {
      let count = 0;
      for (const target of targets) {
        if (target.depthBuffer) continue; // the deliberate poisoned world is expected
        const half = new Uint16Array(target.width * target.height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, half);
        for (const word of half) if ((word & 0x7c00) === 0x7c00) count++;
      }
      return count;
    };
    const draw = () => { retro.render(world, camera); return pixels(); };
    draw();
    const guard = 'if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);';
    const guarded = [...materials].filter(material => material.fragmentShader.includes(guard));
    assert(guarded.length === 2, 'extraction and composite both sanitize scene samples');
    const sources = guarded.map(material => material.fragmentShader);
    const enable = value => guarded.forEach((material, i) => {
      material.fragmentShader = value ? sources[i] : sources[i].replace(guard, '');
      material.needsUpdate = true;
    });
    const differences = (a, b, threshold = 1) => {
      let max = 0, changedPixels = 0;
      for (let i = 0; i < a.length; i += 4) {
        let changed = false;
        for (let c = 0; c < 3; c++) {
          const delta = Math.abs(a[i + c] - b[i + c]);
          max = Math.max(max, delta); changed ||= delta > threshold;
        }
        changedPixels += changed;
      }
      return { max, changedPixels };
    };
    const records = [];
    const poison = (Math.floor(H * 0.45) * W + Math.floor(W * 0.38)) * 4;
    const original = data.slice(poison, poison + 3);
    for (const speed of [0, RIDER.maxSpeed]) {
      retro.setSpeed(speed);
      data.set(original, poison); texture.needsUpdate = true;
      enable(true); const clean = draw();
      enable(false); const legacyClean = draw();
      const finiteDifference = differences(clean, legacyClean);
      assert(finiteDifference.max <= 1, 'finite HDR radiance preserves the normal image');
      for (const value of [NaN, Infinity, -Infinity]) {
        data.fill(value, poison, poison + 3); texture.needsUpdate = true;
        enable(false); const broken = draw();
        const invalidBefore = invalidPostChannels();
        enable(true); const repaired = draw();
        const invalidAfter = invalidPostChannels();
        const before = differences(clean, broken, 12);
        const after = differences(clean, repaired, 12);
        assert(invalidBefore > 0, 'fixture reproduces invalid HDR spreading through bloom');
        assert(before.changedPixels > 100, 'one invalid texel reproduces a visible rectangular artifact');
        assert(invalidAfter === 0, 'all bloom and ray targets remain finite');
        assert(after.changedPixels < 80, 'the invalid texel remains local rather than spreading into a block');
        records.push({ speed, value: String(value), finiteDifference, invalidBefore, invalidAfter, before, after });
      }
    }
    assert(gl.getError() === gl.NO_ERROR, 'no WebGL errors');
    return { size: [W, H], msaa: retro.samples, cases: records };
  } finally {
    texture?.dispose();
    for (const target of targets) target.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    Object.assign(RENDER.buffer, oldBuffer);
  }
}
