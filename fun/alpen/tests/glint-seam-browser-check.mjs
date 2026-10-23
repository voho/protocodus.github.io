// In a served Alpen page:
// await (await import('./tests/glint-seam-browser-check.mjs')).runGlintSeamCheck()
// Exercise the production crystal coordinates/coverage on real derivative quads.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createShading } from '../js/shading.js';
import { createWeather } from '../js/weather.js';

export async function runGlintSeamCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const SIZE = 128;
  const renderer = new THREE.WebGLRenderer({
    canvas: new OffscreenCanvas(SIZE, SIZE), antialias: false,
  });
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: false });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const shading = createShading(THREE);
  const snow = shading.apply(new THREE.MeshLambertMaterial(), { sheen: 1, shade: false, fog: false });
  const source = { ...THREE.ShaderLib.lambert, uniforms: {} };
  snow.onBeforeCompile(source);
  const start = source.fragmentShader.indexOf('    float n64GDist = ');
  const end = source.fragmentShader.indexOf('#include <clipping_planes_fragment>', start);
  const crystalStart = source.fragmentShader.indexOf('        float n64Crystal = ');
  const crystalEnd = source.fragmentShader.indexOf('        vec2 n64GCell = ', crystalStart);
  assert(start >= 0 && end > start && crystalStart >= 0 && crystalEnd > crystalStart,
    'extract the production glint coordinate and coverage blocks');
  const gradients = source.fragmentShader.slice(start, end);
  const coverage = source.fragmentShader.slice(crystalStart, crystalEnd);
  const makeMaterial = block => new THREE.ShaderMaterial({
    uniforms: { uCamWrap: shading.uniforms.uCamWrap, uSpan: { value: 0.5 } },
    vertexShader: `
      uniform float uSpan;
      varying highp vec3 vN64View;
      void main() {
        vN64View = vec3(position.x * uSpan, -4.0, position.y * uSpan);
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: `
      precision highp float;
      uniform vec2 uCamWrap;
      varying highp vec3 vN64View;
      void main() {
        ${block}
        ${coverage}
        gl_FragColor = vec4(n64Footprint, 1.0 - smoothstep(0.35, 1.0, n64Footprint), n64Crystal, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const production = makeMaterial(gradients);
  // Reproduce the former footprint while preserving the production address.
  const reference = makeMaterial(gradients.replaceAll('dFdx(n64CrystalLinear)', 'dFdx(n64CrystalUV)')
    .replaceAll('dFdy(n64CrystalLinear)', 'dFdy(n64CrystalUV)'));
  const scene = new THREE.Scene(), mesh = new THREE.Mesh(geometry, production);
  scene.add(mesh);
  const camera = new THREE.Camera();
  const riderView = new THREE.PerspectiveCamera();
  const weather = createWeather(THREE);
  weather.pin(0.45); weather.update(0);
  const draw = (material, at, span) => {
    riderView.position.set(at, 12, at);
    shading.update(weather.state, riderView, 0);
    material.uniforms.uSpan.value = span;
    mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    return pixels;
  };
  try {
    let reproduced = 0, cases = 0, largest = 0;
    const fades = [];
    for (const span of [0.5, 0.75, 1.25, 1.75]) {
      let spanFade = 0;
      for (const base of [0, -26048, -1000000]) {
        for (const step of [-3, -2, -1, 0, 1, 2, 3]) {
          // The seam sweeps through the interior of derivative quads, rather
          // than accidentally landing only between adjacent 2x2 groups.
          const at = base + step / 128;
          const seam = draw(production, at, span);
          const interior = draw(production, at + 32, span);
          const broken = draw(reference, at, span);
          for (let i = 0; i < seam.length; i += 4) {
            for (let c = 0; c < 3; c++) {
              largest = Math.max(largest, Math.abs(seam[i + c] - interior[i + c]));
            }
            if (broken[i + 1] + 10 < seam[i + 1]) reproduced++;
            spanFade += seam[i + 1];
          }
          cases++;
        }
      }
      fades.push(spanFade / (21 * SIZE * SIZE * 255));
    }
    assert(reproduced > 1000, 'reference reproduces glint suppression along wrapping seams');
    assert(largest <= 1, 'seam and interior crystal coverage agree at every tested run distance');
    assert(fades[0] > 0.99 && fades.at(-1) < 0.15,
      'resolved crystals remain and undersampled crystals still fade');
    assert(fades.every((fade, i) => i === 0 || fade < fades[i - 1]),
      'coverage falls continuously as the actual pixel footprint grows');
    assert(renderer.getContext().getError() === renderer.getContext().NO_ERROR, 'no WebGL errors');
    return { cases, largest, suppressedReferencePixels: reproduced, fades };
  } finally {
    geometry.dispose(); target.dispose(); production.dispose(); reference.dispose(); snow.dispose();
    const textures = new Set(Object.values(shading.uniforms).map(u => u.value).filter(v => v?.isTexture));
    for (const texture of textures) texture.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}
