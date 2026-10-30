// Run in the game console, independently of its renderer:
// await (await import('./tests/gpu-timing-browser-check.mjs')).runGpuTimingCheck()
// Timing values prove the optional API works; this is not a GPU benchmark.
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { createRetro } from '../js/retro.js';
import { RENDER } from '../js/config.js';

export async function runGpuTimingCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const oldBuffer = { ...RENDER.buffer };
  // A detached canvas isolates loss/restoration from the running game and
  // exposes the same WebGL context lifecycle events as its visible canvas.
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const gl = renderer.getContext();
  const targets = new Set(), materials = new Set(), geometries = new Set();
  const nativeRender = renderer.render.bind(renderer);
  const nativeTarget = renderer.setRenderTarget.bind(renderer);
  const nativeBegin = gl.beginQuery?.bind(gl), nativeEnd = gl.endQuery?.bind(gl);
  const nativeResult = gl.getQueryParameter?.bind(gl);
  let timer = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_disjoint_timer_query_webgl2')
    ? renderer.extensions.get('EXT_disjoint_timer_query_webgl2') : null;
  let begun = 0, ended = 0, availabilityChecks = 0, resultsRead = 0;
  let stage = '', sampled = false, prepDraws = 0, postDraws = 0;
  let availableQuery = null;
  const assertNoError = label => assert(gl.getError() === gl.NO_ERROR, label + ': no WebGL error');
  const yieldTask = () => new Promise(resolve => setTimeout(resolve, 16));
  const event = name => new Promise((resolve, reject) => {
    const onEvent = e => { clearTimeout(timeout); e.preventDefault(); resolve(); };
    const timeout = setTimeout(() => {
      canvas.removeEventListener(name, onEvent);
      reject(new Error(name + ' did not arrive within five seconds'));
    }, 5000);
    canvas.addEventListener(name, onEvent, { once: true });
  });
  renderer.setRenderTarget = target => {
    if (target) targets.add(target);
    nativeTarget(target);
  };
  renderer.render = (scene, camera) => {
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    if (sampled) {
      assert(gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY), stage + ': the actual GPU query covers this draw');
      if (stage === 'prepare') prepDraws++;
      else if (stage === 'post') postDraws++;
    }
    nativeRender(scene, camera);
  };
  gl.beginQuery = (type, query) => { begun++; nativeBegin(type, query); };
  gl.endQuery = type => { ended++; nativeEnd(type); };
  gl.getQueryParameter = (query, parameter) => {
    if (parameter === gl.QUERY_RESULT_AVAILABLE) {
      availabilityChecks++;
      const available = nativeResult(query, parameter);
      availableQuery = available ? query : null;
      return available;
    }
    if (parameter === gl.QUERY_RESULT) {
      assert(availableQuery === query, 'elapsed time is read only after real availability');
      resultsRead++;
      availableQuery = null;
    }
    return nativeResult(query, parameter);
  };

  try {
    if (!timer) return { skipped: true, reason: 'EXT_disjoint_timer_query_webgl2 unavailable' };
    renderer.setClearColor(0x15314a, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const retro = createRetro(THREE, renderer);
    retro.setSize(192, 128);
    // The production particle systems read this shared value. Our uniforms
    // already hold the fixture dimensions, so restore it before any yield
    // allows a live game to draw with this test's much smaller buffer size.
    Object.assign(RENDER.buffer, oldBuffer);
    const scene = new THREE.Scene();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.2) }));
    plane.rotation.z = 0.3;
    scene.add(plane);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const prepare = new THREE.WebGLRenderTarget(192, 128);
    targets.add(prepare);

    // More than two sample intervals: even repeated boot/debug renders and
    // paused composites must not start a query or publish a headroom estimate.
    for (let i = 0; i < 27; i++) {
      retro.render(scene, camera);
      assert(retro.renderComposite(), 'warm pause composite can reuse its image');
    }
    assert(begun === 0 && resultsRead === 0 && retro.gpuMs === null, 'untimed renders do not sample');
    assertNoError('untimed render');

    const scope = (fresh, complete = true) => {
      const token = retro.beginGpuFrame(fresh);
      sampled = !!token;
      try {
        stage = 'prepare';
        renderer.setRenderTarget(prepare);
        renderer.clear();
        // Representative shadow/probe work must sit inside the same query
        // as the world and final composite, not before its start.
        renderer.render(scene, camera);
        stage = 'post';
        retro.render(scene, camera);
      } finally {
        retro.endGpuFrame(token, complete);
        sampled = false;
        stage = '';
      }
      assert(gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) === null, 'scope closes the real query');
      assertNoError('complete render');
      gl.flush(); // Submit without waiting; availability is polled in later tasks.
      return token;
    };
    const collect = async label => {
      const deadline = performance.now() + 15000;
      for (let frame = 0; frame < 260 && performance.now() < deadline; frame++) {
        // Query completion may take an even number of sample intervals on a
        // busy GPU. Hold each phase until observed, rather than depending on
        // alternating frame parity to eventually reach both buckets.
        scope(!(retro.gpuFreshShadowMs > 0));
        if (retro.gpuFreshShadowMs > 0 && retro.gpuReusedShadowMs > 0) return;
        await yieldTask();
      }
      throw new Error(label + ': no positive deferred results within the bounded wait: '
        + JSON.stringify({ begun, resultsRead, fresh: retro.gpuFreshShadowMs, reused: retro.gpuReusedShadowMs }));
    };
    await collect('initial context');
    assert(resultsRead >= 2 && availabilityChecks >= resultsRead, 'real deferred results reach both diagnostic buckets');
    assert(prepDraws > 0 && postDraws > prepDraws, 'samples cover preparation and all world/post submissions');
    const first = { freshShadowMs: retro.gpuFreshShadowMs, reusedShadowMs: retro.gpuReusedShadowMs };
    const before = { begun, ended, availabilityChecks, resultsRead, ms: retro.gpuMs };
    for (let i = 0; i < 27; i++) {
      retro.render(scene, camera);
      assert(retro.renderComposite(), 'settled pause composite remains usable');
    }
    assert(begun === before.begun && ended === before.ended
      && availabilityChecks === before.availabilityChecks && resultsRead === before.resultsRead
      && retro.gpuMs === before.ms, 'untimed work neither samples nor consumes pending results');
    assertNoError('untimed work after sampling');

    let restored = false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) {
      // Lose this fixture's context with a query actually open. An obsolete
      // scope must not end or publish into the recreated query generation.
      let token = 0;
      const deadline = performance.now() + 5000;
      gl.flush();
      for (let i = 0; i < 260 && !token && performance.now() < deadline; i++) {
        token = retro.beginGpuFrame(true);
        if (!token) await yieldTask();
      }
      assert(token > 0, 'context loss fixture has an active query');
      const lost = event('webglcontextlost');
      lose.loseContext();
      await lost;
      retro.endGpuFrame(token);
      assert(retro.gpuMs === null && retro.gpuFreshShadowMs === null && retro.gpuReusedShadowMs === null,
        'context loss clears all stale diagnostics');
      // Let the cancelable loss event finish dispatching before requesting
      // restoration; a promise resumed inside that event is still too early
      // for implementations that commit preventDefault after dispatch.
      await yieldTask();
      const recovered = event('webglcontextrestored');
      lose.restoreContext();
      await recovered;
      timer = renderer.extensions.get('EXT_disjoint_timer_query_webgl2');
      assert(timer, 'restored context retains timer support');
      retro.endGpuFrame(token);
      assert(retro.gpuMs === null, 'a stale scope cannot publish after restoration');
      // CONTEXT_LOST_WEBGL is the expected notification of the simulated
      // loss; it is not a query error. Drain it before checking new draws.
      const lossError = gl.getError();
      assert(lossError === gl.NO_ERROR || lossError === gl.CONTEXT_LOST_WEBGL, 'only the deliberate context-loss notification is allowed');
      await collect('restored context');
      assertNoError('restored timing');
      restored = true;
    }
    return {
      skipped: false, sampledFrames: begun, completedQueries: ended,
      deferredResults: resultsRead, preparationDraws: prepDraws, postDraws,
      first, restored, final: { freshShadowMs: retro.gpuFreshShadowMs, reusedShadowMs: retro.gpuReusedShadowMs },
    };
  } finally {
    sampled = false;
    if (timer && !gl.isContextLost() && gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) nativeEnd(timer.TIME_ELAPSED_EXT);
    gl.beginQuery = nativeBegin;
    gl.endQuery = nativeEnd;
    gl.getQueryParameter = nativeResult;
    for (const item of targets) item.dispose();
    for (const item of materials) item.dispose();
    for (const item of geometries) item.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    Object.assign(RENDER.buffer, oldBuffer);
  }
}
