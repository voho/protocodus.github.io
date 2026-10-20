// In a page served from /fun/alpen/:
// await (await import('./tests/backdrop-detail-browser-check.mjs')).runBackdropDetailCheck()
// Uses the production backdrop shader and shared sky noise in an isolated
// WebGL context. No game loop, terrain, trees or post-processing is rendered.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSky } from '../js/sky.js';
import { getWorldSeed, setWorldSeed } from '../js/noise.js';

const SIZE = 512;
const LAG = SIZE / 8;
const TIERS = [
  { distance: 2400, tile: 47, rotation: [0.8, 0.6] },
  { distance: 8000, tile: 160, rotation: [1, 0] },
  { distance: 12000, tile: 160, rotation: [1, 0] },
];
const VERTEX = `
  uniform vec2 uOrigin, uRotation;
  uniform float uSpan, uDistance;
  varying float vAO, vSunHorizon;
  varying highp vec3 vReal, vDir;
  varying highp float vDist;
  void main() {
    vec2 q = (position.xy * 0.5 + 0.5) * uSpan;
    // Align the image with the original field's two repeat directions.
    vec2 p = uOrigin
      + mat2(uRotation.x, uRotation.y, -uRotation.y, uRotation.x) * q;
    vReal = vec3(p.x, 0.0, p.y);
    vDir = vec3(p.x, 100.0, p.y);
    vDist = uDistance;
    vAO = 1.0;
    vSunHorizon = -1.0;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// A fixed reproduction of the old visible forest pattern, retained as the
// failing reference. The checked image below comes from the real shader.
const LEGACY = `
  precision highp float;
  uniform sampler2D uNoise;
  varying highp vec3 vReal;
  varying highp float vDist;
  void main() {
    vec3 fast = texture2D(uNoise, vReal.xz / 160.0 + vec2(0.37, 0.11)).rgb;
    float fine = texture2D(uNoise,
      mat2(0.8, -0.6, 0.6, 0.8) * vReal.xz / 47.0 + vec2(0.71, 0.23)).g;
    float near = 1.0 - smoothstep(2600.0, 7000.0, vDist);
    float mid = 1.0 - smoothstep(5000.0, 16000.0, vDist);
    fast = mix(vec3(0.5), fast, mid);
    fine = mix(0.5, fine, near);
    float crowns = smoothstep(0.3, 0.7, fine + (fast.g - 0.5) * 0.5);
    gl_FragColor = vec4(vec3(crowns), 1.0);
  }
`;

function correlation(bytes, dx, dy) {
  let a = 0, b = 0, aa = 0, bb = 0, ab = 0, count = 0;
  for (let y = 0; y < SIZE - dy; y++) for (let x = 0; x < SIZE - dx; x++) {
    const u = bytes[(y * SIZE + x) * 4] / 255;
    const v = bytes[((y + dy) * SIZE + x + dx) * 4] / 255;
    a += u; b += v; aa += u * u; bb += v * v; ab += u * v; count++;
  }
  return (ab - a * b / count)
    / Math.sqrt((aa - a * a / count) * (bb - b * b / count));
}

function distribution(bytes) {
  let sum = 0, squares = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const value = bytes[i] / 255;
    sum += value;
    squares += value * value;
  }
  const count = bytes.length / 4;
  const mean = sum / count;
  return { mean, deviation: Math.sqrt(Math.max(0, squares / count - mean * mean)) };
}

// Local gradient alignment catches stretched, flowing bands that can pass
// the repeat check while visibly changing compact crowns into streaks.
function coherence(bytes) {
  let total = 0, count = 0;
  for (let by = 1; by + 32 < SIZE - 1; by += 16) {
    for (let bx = 1; bx + 32 < SIZE - 1; bx += 16) {
      let xx = 0, yy = 0, xy = 0;
      for (let y = by; y < by + 32; y++) for (let x = bx; x < bx + 32; x++) {
        const dx = bytes[(y * SIZE + x + 1) * 4] - bytes[(y * SIZE + x - 1) * 4];
        const dy = bytes[((y + 1) * SIZE + x) * 4] - bytes[((y - 1) * SIZE + x) * 4];
        xx += dx * dx; yy += dy * dy; xy += dx * dy;
      }
      if (xx + yy > 0) {
        total += Math.sqrt((xx - yy) ** 2 + 4 * xy * xy) / (xx + yy);
        count++;
      }
    }
  }
  return total / count;
}

export async function runBackdropDetailCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  // Noise textures are built synchronously. Restore the active run's seed
  // before yielding so running this check cannot change the live terrain.
  const runSeed = getWorldSeed();
  let sky;
  try {
    setWorldSeed(0);
    sky = createSky(THREE);
  } finally {
    setWorldSeed(runSeed);
  }
  const renderer = new THREE.WebGLRenderer({
    canvas: new OffscreenCanvas(SIZE, SIZE), antialias: false,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
  const materials = new Set(), geometries = new Set(), textures = new Set();
  let production, legacy;
  try {
    assert(await sky.backdropReady, 'the real backdrop and its maps must load');
    const source = sky.group.getObjectByName('backdrop-range').material;
    const output = 'gl_FragColor = vec4(c, 1.0);';
    assert(source.fragmentShader.includes(output), 'find the production output');
    const uniforms = {
      ...source.uniforms,
      uOrigin: { value: new THREE.Vector2() },
      uRotation: { value: new THREE.Vector2() },
      uSpan: { value: 0 },
      uDistance: { value: 0 },
    };
    production = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX,
      fragmentShader: source.fragmentShader.replace(output,
        'gl_FragColor = vec4(vec3(crowns), 1.0);'),
      depthTest: false, depthWrite: false,
    });
    legacy = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader: LEGACY,
      depthTest: false, depthWrite: false,
    });
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(geometry, production);
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const draw = (material, x, z) => {
      quad.material = material;
      uniforms.uOrigin.value.set(x, z);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(SIZE * SIZE * 4);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
      return pixels;
    };
    const records = [];
    let largest = 0;
    for (const { distance, tile, rotation } of TIERS) {
      const span = tile * 8;
      uniforms.uDistance.value = distance;
      uniforms.uSpan.value = span;
      uniforms.uRotation.value.set(...rotation);
      for (const [x, z] of [[0, -3400], [1300, -4000], [-1900, -2800]]) {
        const before = draw(legacy, x, z);
        const after = draw(production, x, z);
        const oldCorrelation = [correlation(before, LAG, 0), correlation(before, 0, LAG)];
        const newCorrelation = [correlation(after, LAG, 0), correlation(after, 0, LAG)];
        const oldMean = (oldCorrelation[0] + oldCorrelation[1]) / 2;
        const newMean = (newCorrelation[0] + newCorrelation[1]) / 2;
        const beforeDistribution = distribution(before);
        const afterDistribution = distribution(after);
        const beforeCoherence = coherence(before);
        const afterCoherence = coherence(after);
        assert(oldMean > 0.65, 'fixture must reproduce the old repeating forest');
        assert(newMean < oldMean - 0.25 && newMean < 0.5,
          `the ${tile} m repeat at ${distance} m must disappear: `
          + `${oldMean.toFixed(3)} → ${newMean.toFixed(3)}`);
        assert(Math.abs(afterDistribution.mean - beforeDistribution.mean) < 0.1
          && afterDistribution.deviation > beforeDistribution.deviation * 0.7,
        'removing the repeat preserves forest tone and visible crown detail');
        assert(afterCoherence < beforeCoherence + 0.08,
          `crowns must remain compact at ${distance} m, not stretch into bands: `
          + `${beforeCoherence.toFixed(3)} → ${afterCoherence.toFixed(3)}`);
        const again = draw(production, x, z);
        assert(after.every((value, i) => value === again[i]),
          'the variation is stable between identical frames');
        records.push({
          distance, tile, origin: [x, z], oldCorrelation, newCorrelation,
          beforeDistribution, afterDistribution, beforeCoherence, afterCoherence,
        });
      }
      // Moving the sample window cannot move the pattern itself.
      const at = [1300, -4000], shift = 16, metres = shift * span / SIZE;
      const left = draw(production, ...at);
      const right = draw(production,
        at[0] + rotation[0] * metres, at[1] + rotation[1] * metres);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE - shift; x++) {
        const delta = Math.abs(left[(y * SIZE + x + shift) * 4] - right[(y * SIZE + x) * 4]);
        largest = Math.max(largest, delta);
      }
    }
    assert(largest <= 2, `the field must stay attached to the ground (${largest}/255)`);
    const faded = [];
    for (const distance of [16000, 20000]) {
      uniforms.uDistance.value = distance;
      const pixels = draw(production, 1300, -distance);
      const expected = draw(legacy, 1300, -distance);
      const tone = distribution(pixels);
      assert(pixels.every((value, i) => value === expected[i])
        && Math.abs(tone.mean - 0.5) <= 1 / 255 && tone.deviation < 1 / 255,
      `unresolved detail must fade completely to its mean at ${distance} m`);
      faded.push({ distance, ...tone });
    }
    assert(renderer.getContext().getError() === renderer.getContext().NO_ERROR,
      'shader compilation and readback produce no WebGL error');
    return { cases: records, faded, stationaryMaxDifference: largest, size: SIZE };
  } finally {
    production?.dispose(); legacy?.dispose(); geometry.dispose(); target.dispose();
    sky.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) {
        materials.add(material);
        for (const value of Object.values(material.uniforms || {})) {
          if (value.value?.isTexture) textures.add(value.value);
        }
      }
    });
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    sky.probe.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
