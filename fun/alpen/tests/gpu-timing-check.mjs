// Real post stack and main frame boundary; the asynchronous GPU clock is
// controlled so unavailable, disjoint and lost-context results are repeatable.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createRetro } from '../js/retro.js';
import { RENDER } from '../js/config.js';

globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('  if (running || !pausedRendered || retro.animating) {');
const end = source.indexOf('  cpuFrameMs =', start);
assert(start > 0 && end > start, 'locate the production frame submission');
const submitFrame = new vm.Script(source.slice(start, end));

function fixture({ extension = true, shadowMs = 4, probeMs = 8 } = {}) {
  const gpu = { clock: 0, current: null, begins: 0, ends: 0, reads: 0,
    available: false, disjoint: false, lost: false, generation: 0, result: null,
    work: [], fail: '', target: null };
  const timer = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const valid = query => {
    assert(!gpu.lost, 'never touch queries in a lost context');
    assert.equal(query.generation, gpu.generation, 'query belongs to the current context');
  };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, CURRENT_QUERY: 5,
    getInternalformatParameter: () => [4, 2],
    isContextLost: () => gpu.lost,
    createQuery: () => ({ generation: gpu.generation }),
    deleteQuery: valid,
    getQuery: () => { assert(!gpu.lost); return gpu.current; },
    beginQuery(type, query) {
      valid(query); assert.equal(gpu.current, null, 'queries never overlap');
      gpu.current = query; query.start = gpu.clock; gpu.begins++;
    },
    endQuery() {
      assert(gpu.current); valid(gpu.current);
      gpu.current.elapsed = gpu.clock - gpu.current.start;
      gpu.current = null; gpu.ends++;
    },
    getParameter: field => field === timer.GPU_DISJOINT_EXT ? gpu.disjoint : null,
    getQueryParameter(query, field) {
      valid(query);
      if (field === gl.QUERY_RESULT_AVAILABLE) return gpu.available;
      assert.equal(field, gl.QUERY_RESULT);
      assert(gpu.available, 'never block on an unfinished result');
      assert(!gpu.disjoint, 'never publish a disjoint result');
      gpu.reads++;
      return gpu.result === null ? query.elapsed * 1e6 : gpu.result;
    },
  };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const work = (kind, ms) => {
    gpu.work.push({ kind, timed: !!gpu.current });
    gpu.clock += ms;
    if (gpu.fail === kind) throw new Error('failed ' + kind);
  };
  const renderer = {
    autoClear: true, info: { reset() {} },
    capabilities: { isWebGL2: true },
    extensions: { has: name => extension && name === 'EXT_disjoint_timer_query_webgl2', get: () => timer },
    domElement: new EventTarget(), getContext: () => gl,
    setPixelRatio() {}, setSize() {}, clear() {},
    setRenderTarget: value => { gpu.target = value; },
    render: object => work(object === scene ? 'world' : 'post', object === scene ? 7 : 0.25),
  };
  const retro = createRetro(THREE, renderer);
  const light = { shadow: { needsUpdate: false } };
  const context = vm.createContext({
    renderer, retro, scene, camera, model: { root: {} },
    riderShadow: { update: () => work('rider', shadowMs) },
    sky: { shadowLevel: 1, renderProbe: () => work('probe', probeMs) },
    keyLight: () => light, running: true, pausedRendered: false, pausedWorldReady: false,
  });
  return { gpu, gl, retro, renderer, context, light,
    frame: () => submitFrame.runInContext(context),
    frames(n) { for (let i = 0; i < n; i++) this.frame(); },
    lose() {
      gpu.lost = true; gpu.current = null;
      renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    },
    restore() {
      gpu.lost = false; gpu.generation++;
      renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}

{
  const f = fixture();
  f.frames(12);
  assert.equal(f.gpu.begins, 0, 'no query before the sampling cadence');
  f.gpu.work.length = 0;
  f.frame();
  assert.equal(f.gpu.begins, 1); assert.equal(f.gpu.ends, 1);
  assert.deepEqual(f.gpu.work.map(item => item.kind), ['rider', 'probe', 'world', ...Array(7).fill('post')]);
  assert(f.gpu.work.every(item => item.timed), 'one sample includes every production GPU pass');
  f.frames(26);
  assert.equal(f.gpu.begins, 1, 'one unavailable query bounds outstanding work');
  assert.equal(f.gpu.reads, 0); assert.equal(f.retro.gpuMs, null);
  f.gpu.available = true; f.light.shadow.needsUpdate = true;
  f.frames(13);
  assert.equal(f.retro.gpuMs, 20.75, 'rider/probe cost joins the world and post cost');
  assert.equal(f.retro.gpuReusedShadowMs, 20.75, 'bucket belongs to the sampled frame');
  f.frames(13);
  assert.equal(f.retro.gpuFreshShadowMs, 20.75);
  f.context.running = false;
  f.frame(); // Refresh the paused world's cached targets once.
  f.retro.fade(0.6);
  const queries = f.gpu.begins, reads = f.gpu.reads;
  for (let i = 0; i < 30; i++) {
    f.retro.updateEffects(1 / 60, false); f.frame();
    f.retro.render(f.context.scene, f.context.camera); // Debug/boot-style draw.
    f.retro.renderComposite();
  }
  assert.equal(f.gpu.begins, queries, 'paused, cached and direct draws never start a sample');
  assert.equal(f.gpu.reads, reads, 'direct draws do not consume a pending sample either');
  assert.equal(f.retro.gpuMs, 20.75);
}

// The corrected cost matters to the governor: the old world/post-only value
// would label this 30 fps scene CPU-bound and veto a useful resolution step.
{
  const full = fixture(), cheap = fixture({ shadowMs: 0, probeMs: 0 });
  for (const f of [full, cheap]) {
    f.gpu.available = true; f.frames(26);
    for (let i = 0; i < 95; i++) f.retro.updatePerformance(1 / 30);
  }
  assert(full.retro.scale < RENDER.maxScale, 'complete GPU cost permits a quality response');
  assert.equal(cheap.retro.scale, RENDER.maxScale, 'genuinely idle GPU still vetoes needless degradation');
}

// A failure in any early or late pass ends its query but discards the partial
// timing. Renderer state still belongs to the normal post-stack cleanup.
for (const pass of ['rider', 'probe', 'world', 'post']) {
  const f = fixture(); f.frames(12); f.gpu.fail = pass;
  assert.throws(f.frame, new RegExp('failed ' + pass));
  assert.equal(f.gpu.current, null); assert.equal(f.gpu.ends, 1);
  assert.equal(f.renderer.autoClear, true); assert.equal(f.gpu.target, null);
  f.gpu.fail = ''; f.gpu.available = true; f.frames(13);
  assert.equal(f.gpu.reads, 0, 'failed submissions are never read as completed samples');
  assert.equal(f.retro.gpuMs, null);
  f.frames(13); assert.equal(f.retro.gpuMs, 20.75);
}

{
  const f = fixture(); f.frames(12);
  const token = f.retro.beginGpuFrame();
  assert(token > 0);
  assert.equal(f.retro.beginGpuFrame(), 0, 'a nested scope cannot begin another query');
  f.retro.endGpuFrame(0); f.retro.endGpuFrame(token + 1);
  assert(f.gpu.current, 'unowned tokens cannot close the active sample');
  f.retro.endGpuFrame(token, false);
  f.retro.endGpuFrame(token);
  assert.equal(f.gpu.ends, 1, 'each token ends at most once');
  const external = { generation: f.gpu.generation };
  f.gpu.current = external; f.frames(13);
  assert.equal(f.gpu.current, external, 'an external timer is neither nested nor ended');
  f.gpu.current = null; f.frames(12);
  const next = f.retro.beginGpuFrame();
  assert(next > token);
  // If an external tool takes over after ending ours, leave its query alone.
  f.gpu.current = external; f.retro.endGpuFrame(next);
  assert.equal(f.gpu.current, external); assert.equal(f.gpu.ends, 1);
}

{
  const f = fixture(); f.gpu.available = true; f.frames(26);
  assert.equal(f.retro.gpuMs, 20.75);
  f.gpu.available = false; f.gpu.disjoint = true; f.frames(13);
  assert.equal(f.retro.gpuMs, null, 'disjoint clears stale headroom before the result is available');
  assert.equal(f.retro.gpuReusedShadowMs, null); assert.equal(f.gpu.begins, 2);
  f.gpu.disjoint = false; f.frames(13);
  f.gpu.available = true; f.frames(13); assert.equal(f.retro.gpuMs, 20.75);
  for (const bad of [NaN, Infinity, -1000000]) {
    f.gpu.result = bad; f.frames(13);
    assert.equal(f.retro.gpuMs, null, 'invalid duration never reaches the governor');
    assert.equal(f.retro.gpuFreshShadowMs, null); assert.equal(f.retro.gpuReusedShadowMs, null);
  }
}

{
  const f = fixture(); f.gpu.available = true; f.frames(26);
  f.frames(12);
  const token = f.retro.beginGpuFrame();
  f.gpu.disjoint = true;
  f.retro.endGpuFrame(token);
  assert.equal(f.gpu.current, null, 'a disjoint active query is still closed');
  assert.equal(f.retro.gpuMs, null, 'disjoint at submission end clears the previous estimate');
  f.gpu.disjoint = false;
  const reads = f.gpu.reads;
  f.frames(13);
  assert.equal(f.gpu.reads, reads, 'a disjoint submission never becomes pending data');
}

{
  const f = fixture(); f.gpu.available = true; f.frames(26);
  f.lose(); assert.equal(f.retro.gpuMs, null);
  assert.equal(f.retro.beginGpuFrame(), 0);
  f.restore(); f.frames(12);
  const old = f.retro.beginGpuFrame();
  f.lose(); f.retro.endGpuFrame(old); f.restore(); f.frames(12);
  const current = f.retro.beginGpuFrame();
  assert(current > old, 'restoration cannot reuse an earlier frame token');
  f.retro.endGpuFrame(old); assert(f.gpu.current, 'old finally cannot end restored context work');
  f.retro.endGpuFrame(current, false);
  f.frames(26); assert.equal(f.retro.gpuMs, 20.75, 'sampling recovers with new context queries');
}

{
  const f = fixture({ extension: false }); f.frames(40);
  assert.equal(f.gpu.begins, 0); assert.equal(f.retro.gpuMs, null);
  assert(f.gpu.work.some(item => item.kind === 'world'), 'optional timers never gate rendering');
}
console.log('GPU timing passed: complete frame cost, cadence, governor, pause/direct isolation, ownership, failures, disjoint and restoration.');
