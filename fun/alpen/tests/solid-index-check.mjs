// Run from fun/alpen: node tests/solid-index-check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createSolidIndex } from '../js/solid-index.js';
import { setWorldSeed } from '../js/noise.js';
import { allTracked } from '../js/loading.js';

const scan = (solids, lo, hi) => solids.filter(s => s.z + s.r >= lo && s.z - s.r <= hi);
const same = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((s, i) => assert.equal(s, expected[i], 'keep source order and contact identity'));
};
const shared = { hit: false };
const solids = Array.from({ length: 1031 }, (_, i) => ({
  z: ((i * 709) % 2311) - 1200.125, r: 0.25 + i % 13,
  contact: i % 3 === 0 ? shared : undefined,
}));
// A large hull spanning many bins, signed bit 31, and exact boundaries.
solids[31] = { z: -40, r: 160, contact: shared };
solids[32] = { z: 40, r: 0, contact: shared };
solids.push({ z: -80, r: 0 }, { z: 0, r: 0 });
const index = createSolidIndex(solids);
const out = [], other = [];
index.rebuild();
for (const [lo, hi] of [[-40, -40], [40, 40], [0, 0], [-80, -80],
  [-10000, 10000], [5000, 5010], [-5000, -4990]]) {
  same(index.query(lo, hi, out), scan(solids, lo, hi));
}
for (let i = 0; i < 2000; i++) {
  const lo = ((i * 53.71) % 3000) - 1500;
  same(index.query(lo, lo + i % 99, out), scan(solids, lo, lo + i % 99));
}
index.query(-100, 100, out);
const saved = out.slice();
index.query(200, 300, other);
same(out, saved);
// A hot-swapped geometry can move and expand its existing collider.
solids[0].z = 2000;
solids[0].r = 60;
index.rebuild();
same(index.query(1940, 1940, out), scan(solids, 1940, 1940));
solids.splice(0, solids.length, { z: -40, r: 1 });
index.rebuild();
same(index.query(-41, -41, out), solids);
assert.equal(index.query(0, 0, out).length, 0, 'no stale bits after a shorter rebuild');
solids.length = 0;
index.rebuild();
assert.equal(index.query(-Infinity, Infinity, out).length, 0, 'empty stream clears the index');

// Instrument property visits rather than relying on machine-specific timing.
let visits = 0;
const measured = Array.from({ length: 2048 }, (_, i) => ({
  get z() { visits++; return -i; },
  get r() { visits++; return 1; },
}));
const measuredIndex = createSolidIndex(measured);
measuredIndex.rebuild();
visits = 0;
measuredIndex.query(-1001, -999, out);
const indexedVisits = visits;
visits = 0;
same(out, scan(measured, -1001, -999));
const scanVisits = visits;
assert.ok(indexedVisits < scanVisits / 10, 'short queries visit a small part of the stream');

// Build the real streamed props without image IO. The loader's browser-only
// bare `three` import is replaced with a no-op, as in models-check.mjs.
globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {},
}, { get: (target, key) => target[key] ?? (() => {}) }) }) };
globalThis.fetch = async () => ({ ok: false, status: 404 });
const TestTHREE = { ...THREE, TextureLoader: class {
  load(url, ready, progress, fail) { fail?.(); return new THREE.Texture(); }
} };
const stub = 'data:text/javascript;base64,' + Buffer.from(
  'export function createModelUpgrader() { const noop = () => {}; '
  + 'return { upgrade: noop, upgradeTextured: noop, upgradeTexturedSet: noop }; }',
).toString('base64');
const url = new URL('../js/props.js', import.meta.url);
const source = (await readFile(url, 'utf8'))
  .replace(/from\s+(['"])\.\/importedModels\.js\1/g, `from '${stub}'`)
  .replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (_, quote, path) => `from ${quote}${new URL(path, url).href}${quote}`)
  .replaceAll('import.meta.url', JSON.stringify(url.href)) + '\nexport { GUST_X, GUST_Z };';
const { createProps, GUST_X, GUST_Z } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { createShading } = await import('../js/shading.js');
// Asset failures are deliberate here; their data-URL stack traces otherwise
// dwarf the query results. Settle them before restoring the normal logger.
const warn = console.warn;
let props;
try {
  console.warn = () => {};
  props = createProps(TestTHREE, createShading(THREE));
  await allTracked();
} finally { console.warn = warn; }
let cases = 0, sourceEntries = 0, candidateEntries = 0;
for (const seed of ['solid-window', 'solid-forest', 77231]) {
  setWorldSeed(seed);
  props.reset(0);
  for (const z of [0, -42, -81, -80.5, -120, -122, -650, -610, 85]) {
    props.update(z);
    for (const span of [0.6, 8, 30]) {
      same(props.querySolids(z - span, z + span, out), scan(props.solids, z - span, z + span));
      sourceEntries += props.solids.length;
      candidateEntries += out.length;
      cases++;
    }
    const contact = props.solids.find(s => s.contact)?.contact;
    if (contact) contact.hit = true;
    props.rearm();
    same(props.querySolids(z - 2, z + 2, out), scan(props.solids, z - 2, z + 2));
  }
  props.reset(-650, 2);
  same(props.querySolids(-700, -600, out), scan(props.solids, -700, -600));
}
assert.ok(candidateEntries < sourceEntries / 10, 'real shortlists remove most physics and camera visits');

// Use the streamed field's actual material hook and cloth vertices. Evaluating
// its small scalar wave here catches motion discontinuities without replacing
// the shader with a second authored implementation; native QA covers the draw.
{
  const gate = props.group.getObjectByName('race-gates');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  gate.material.onBeforeCompile(shader);
  const air = shader.uniforms;
  const wave = shader.vertexShader.match(/float n64Ripple = ([\s\S]*?);/)[1];
  const strength = shader.vertexShader.match(/float n64Wind = ([^;]+);/)[1];
  const amplitude = shader.vertexShader.match(/transformed\.z \+= aFlutter \* n64Ripple \* ([^;]+);/)[1];
  const js = s => s.replaceAll('sin(', 'Math.sin(').replaceAll('min(', 'Math.min(')
    .replaceAll('length(uAirWind)', 'uAirWind.length()').replaceAll('transformed.x', 'x');
  const move = new Function('uAirTime', 'uFlagPhase', 'uAirWind', 'x', 'aFlutter', 'n64Ph',
    `const n64Wind = ${js(strength)}; const n64Ripple = ${js(wave)}; return aFlutter * n64Ripple * ${amplitude};`);
  const position = gate.geometry.attributes.position, flutter = gate.geometry.attributes.aFlutter;
  const cloth = () => {
    const result = [];
    for (const phase of [0, 1, 2, 3, 4, 5]) for (let i = 0; i < position.count; i++) {
      result.push(move(air.uAirTime.value, air.uFlagPhase?.value || 0, air.uAirWind.value,
        position.getX(i), flutter.getX(i), phase));
    }
    return result;
  };
  const change = (before, after) => Math.max(...before.map((v, i) => Math.abs(v - after[i])));
  // A natural ALPEN01 wind change at 602 s used to retime the entire elapsed
  // wave, moving cloth about 5 cm in one frame instead of its ordinary ripple.
  for (let i = 0; i < 36124; i++) props.setAir(1 / 60, 5.213815838301529, 0);
  const lateCloth = cloth();
  props.setAir(1 / 60, 5.204201556956906, 0);
  assert.ok(change(lateCloth, cloth()) < 0.01, 'a late tiny wind change cannot jump the flag by centimetres');
  assert.ok(shader.vertexShader.includes('uniform float uFlagPhase;'), 'the actual gate program declares its phase');

  const TAU = Math.PI * 2, period = 628.3185307;
  const resetClock = () => {
    air.uAirTime.value = air.uFlagPhase.value = 0;
    air.uAirDrift.value.set(0, 0);
  };
  // Preserve the authored constant-wind appearance before the old tree clock
  // wraps, including both cloth waves and their position/instance offsets.
  for (const magnitude of [0, 5, 18, 50]) {
    resetClock();
    let elapsed = 0;
    for (const dt of [0.016, 0.984, 99, 500]) {
      elapsed += dt;
      props.setAir(dt, magnitude * 0.6, magnitude * 0.8);
      const wind = Math.min(magnitude, 18), actual = cloth();
      let index = 0;
      for (const phase of [0, 1, 2, 3, 4, 5]) for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const expected = flutter.getX(i) * (0.022 + wind * 0.0045)
          * (Math.sin(elapsed * (4.6 + wind * 0.35) - x * 7.5 + phase) * 0.65
            + Math.sin(elapsed * 9.7 - x * 15 + phase * 1.7) * 0.35);
        assert.ok(Math.abs(actual[index++] - expected) < 1e-8, 'constant wind keeps both authored cloth waves');
      }
      assert.ok(air.uFlagPhase.value >= 0 && air.uFlagPhase.value < TAU, 'long-run phase remains bounded');
    }
  }

  resetClock();
  props.setAir(period - 1 / 120, 3, 4.5);
  const beforeWrap = cloth();
  props.setAir(1 / 60, 3, 4.5);
  assert.ok(air.uAirTime.value < 1 / 60, 'the existing forest clock crossed its wrap');
  assert.ok(change(beforeWrap, cloth()) < 0.01, 'the tree clock wrap cannot reset cloth phase');
  const phase = air.uFlagPhase.value, time = air.uAirTime.value, drift = air.uAirDrift.value.clone();
  props.setAir(0, -8, 12);
  assert.equal(air.uFlagPhase.value, phase, 'zero-time redraw changes wind without advancing phase');
  assert.equal(air.uAirTime.value, time);
  assert.deepEqual(air.uAirDrift.value, drift);
  props.setAir(0.05, -8, 12);
  assert.equal(air.uAirTime.value, (time + 0.05) % period, 'tree time keeps its established update');
  assert.equal(air.uAirDrift.value.x, (((drift.x - 8 * 0.05) % GUST_X) + GUST_X) % GUST_X);
  assert.equal(air.uAirDrift.value.y, (((drift.y + 12 * 0.05) % GUST_Z) + GUST_Z) % GUST_Z);
  const retained = air.uFlagPhase, beforeReset = cloth();
  props.reset(-1000);
  props.update(-1240);
  const rebuilt = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  gate.material.onBeforeCompile(rebuilt);
  assert.equal(rebuilt.uniforms.uFlagPhase, retained, 'rebuilt gates share the continuing phase record');
  assert.deepEqual(cloth(), beforeReset, 'checkpoint reset and stream rebuild preserve cloth phase');
}
console.log(`Solid index checks passed: ${cases} seeded stream queries, source order/contact identity, `
  + `boundary/refit/reset cases; ${sourceEntries} → ${candidateEntries} candidate visits, `
  + `instrumented z/r reads ${scanVisits} → ${indexedVisits}; continuous wind-driven gate cloth.`);
