import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSky } from '../js/sky.js';
import { getWorldSeed, setWorldSeed } from '../js/noise.js';
const SIZE = 128;
const VERTEX = [
  'uniform float uSpan, uDistance;',
  'varying float vAO, vSunHorizon;',
  'varying highp vec3 vReal, vDir;',
  'varying highp float vDist;',
  'void main() {',
  '  vReal = vec3(1700.0 + position.x * uSpan, 1300.0 + position.y * uSpan * 4.0, -uDistance);',
  '  vDir = vReal; vDist = uDistance; vAO = 0.8; vSunHorizon = -0.4;',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}',
].join('\n');
export async function runBackdropCragCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const seed = getWorldSeed();
  let sky;
  try { setWorldSeed(0); sky = createSky(THREE); } finally { setWorldSeed(seed); }
  const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(SIZE, SIZE), antialias: false });
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE), geometry = new THREE.PlaneGeometry(2, 2);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  let candidate, reference;
  try {
    assert(await sky.backdropReady, 'load the production backdrop and maps');
    const source = sky.group.getObjectByName('backdrop-range').material;
    const marker = '    float snowPocket = 0.0;', output = 'gl_FragColor = vec4(c, 1.0);';
    assert(source.fragmentShader.includes(marker), 'find the production face-detail mask');
    assert(source.fragmentShader.includes(output), 'find the production shader output');
    const encoded = source.fragmentShader.replace(output, 'gl_FragColor = vec4(n * 0.5 + 0.5, snow);');
    const uniforms = { ...source.uniforms, uSpan: { value: 1000 }, uDistance: { value: 20000 }, uWhiteout: { value: 0 } };
    candidate = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: encoded, depthTest: false, depthWrite: false });
    reference = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX,
      fragmentShader: encoded.replace(marker, '    faceMask = 0.0;\n' + marker), depthTest: false, depthWrite: false });
    const solid = rgba => {
      const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
      texture.needsUpdate = true; textures.add(texture); return texture;
    };
    const steep = solid([154, 218, 190, 255]), flat = solid([128, 128, 190, 255]);
    const snowRock = solid([166, 0, 0, 255]), forest = solid([0, 255, 0, 255]);
    const scene = new THREE.Scene(), quad = new THREE.Mesh(geometry, candidate);
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const draw = material => {
      quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Uint8Array(SIZE * SIZE * 4);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels); return pixels;
    };
    const cases = [
      { name: 'rock-snow-20km', distance: 20000, visible: true },
      { name: 'rock-snow-28km', distance: 28000, visible: true },
      { name: 'forest', distance: 20000, forest: true },
      { name: 'flat', distance: 20000, flat: true },
      { name: 'unresolved', distance: 20000, span: 12000 },
      { name: 'whiteout', distance: 20000, whiteout: 1 },
      { name: 'far-cutoff', distance: 45000 },
      { name: 'beyond-cutoff', distance: 48000 },
    ];
    const records = [];
    for (const test of cases) {
      uniforms.uDistance.value = test.distance; uniforms.uSpan.value = test.span ?? 1000;
      uniforms.uWhiteout.value = test.whiteout ?? 0;
      uniforms.uShape = { value: test.flat ? flat : steep };
      uniforms.uCover = { value: test.forest ? forest : snowRock };
      candidate.uniforms.uShape = reference.uniforms.uShape = uniforms.uShape;
      candidate.uniforms.uCover = reference.uniforms.uCover = uniforms.uCover;
      const before = draw(reference), after = draw(candidate);
      let largest = 0, changed = 0, minY = 255;
      for (let i = 0; i < before.length; i++) {
        const delta = Math.abs(before[i] - after[i]); largest = Math.max(largest, delta);
        if (delta > 0) changed++; if (i % 4 === 1) minY = Math.min(minY, after[i]);
      }
      assert(minY >= 127, test.name + ': normals remain upward');
      if (test.visible) assert(largest >= 2 && changed > SIZE * SIZE / 4, test.name + ': resolved detail affects the shader');
      else assert(largest === 0, test.name + ': suppressed detail matches the bypass exactly');
      records.push({ name: test.name, largest, changed, minY });
    }
    const gl = renderer.getContext();
    assert(gl.getError() === gl.NO_ERROR, 'compile and render without WebGL errors');
    return { cases: records.length, records };
  } finally {
    candidate?.dispose(); reference?.dispose(); geometry.dispose(); target.dispose();
    sky.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) {
        materials.add(material);
        for (const uniform of Object.values(material.uniforms || {})) if (uniform.value?.isTexture) textures.add(uniform.value);
      }
    });
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    sky.probe.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
}
