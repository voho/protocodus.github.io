// Frame-cost harness: the seeded 18-ship flight from performance-check.mjs, measured
// two ways so a renderer change can be compared on any machine, including one whose
// only GPU is a software renderer. Numbers are measurements, not pass/fail thresholds;
// coverage and page errors are asserted.
//   TYRAN_FRAME_MODE=js   replaces WebGL2 with a no-op context: main-thread JavaScript only.
//   TYRAN_FRAME_MODE=gpu  runs the real renderer and sums the analytic fill area of every triangle.
// Usage: TYRAN_BROWSER=chromium TYRAN_FRAME_MODE=js node fun/tyran/tests/frame-cost-check.mjs
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');

const mode = process.env.TYRAN_FRAME_MODE === 'js' ? 'js' : 'gpu';
const url = new URL(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
const seconds = Math.max(5, Number(process.env.TYRAN_PERF_SECONDS) || 20);
const worldIndex = Math.max(0, Math.min(9, Math.floor(Number(process.env.TYRAN_PERF_WORLD ?? 6))));
const stress = process.env.TYRAN_PERF_STRESS === '1';
const profiling = process.env.TYRAN_PERF_PROFILE !== '0';
const dpr = Number(process.env.TYRAN_DPR || 1);
const viewport = { width: Number(process.env.TYRAN_VIEWPORT_WIDTH) || 1440, height: Number(process.env.TYRAN_VIEWPORT_HEIGHT) || 960 };
const label = process.env.TYRAN_FRAME_LABEL || mode;
const out = process.env.TYRAN_FRAME_OUTPUT || join(tmpdir(), 'tyran-frame-cost');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
if (mode === 'js') await page.addInitScript(() => {
  // A WebGL2 context that accepts every call and returns success, so the batched
  // renderer runs its full command path with no GPU work behind it.
  const native = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type !== 'webgl2') return native.call(this, type, ...rest);
    const canvas = this, noop = () => {};
    let ids = 0;
    return new Proxy({}, { get(_, name) {
      if (name === 'NO_ERROR') return 0; if (name === 'TEXTURE0') return 33984;
      if (name === 'canvas') return canvas;
      if (name === 'getError') return () => 0; if (name === 'isContextLost') return () => false;
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
      if (name === 'getShaderInfoLog' || name === 'getProgramInfoLog') return () => '';
      if (name === 'getParameter') return key => key === 'MAX_TEXTURE_SIZE' ? 16384 : 8;
      if (name === 'getUniformLocation') return (program, key) => `${program.id}:${key}`;
      if (name === 'checkFramebufferStatus') return () => 'FRAMEBUFFER_COMPLETE';
      if (name === 'getContextAttributes') return () => ({ alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
      if (typeof name === 'string' && name.startsWith('create')) return () => ({ kind: name, id: ++ids });
      if (typeof name === 'string' && /^[A-Z_0-9]+$/.test(name)) return name;
      return noop;
    } });
  };
});
await page.addInitScript(() => {
  let seed = 7481;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  window.__frameResetRandom = () => { seed = 7481; };
  localStorage.setItem('tyran-muted', 'true');
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
const distribution = values => {
  const sorted = values.toSorted((a, b) => a - b), pct = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
  return { samples: sorted.length, meanMs: sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length), medianMs: pct(.5), p95Ms: pct(.95), p99Ms: pct(.99), maxMs: pct(1) };
};
try {
  const started = Date.now();
  await page.goto(url.href);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { timeout: 120000 });
  const startupMs = Date.now() - started;
  await page.evaluate(async () => { await tyran.world.ready; });
  const backend = await page.evaluate(() => tyran.renderer.backend);
  assert.equal(backend, 'webgl2', 'the batched renderer is active');
  await page.locator(`[data-world="${worldIndex}"]`).click();
  await page.evaluate(async () => { await tyran.world.ready; });
  await page.waitForTimeout(3000);
  await page.evaluate(async () => { await tyran.world.prepareReady(tyran.state?.width || 1200, 900); });
  if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); }
  let before, after, profile = { nodes: [], samples: [] };
  await page.exposeFunction('__frameStart', async () => { if (profiling) await cdp.send('Profiler.start'); before = await metrics(); });
  await page.exposeFunction('__frameStop', async () => {
    const [current, stopped] = await Promise.all([metrics(), profiling ? cdp.send('Profiler.stop') : Promise.resolve({ profile })]);
    after = current; profile = stopped.profile;
  });
  const flight = await page.evaluate(async ({ seconds, stress, worldIndex, mode }) => {
    const { spawnEnemy, hurtPlayer } = await import('./sim.js');
    const { GPUCanvas2D } = await import('./gpu-canvas.js');
    const world = tyran.world, fx = tyran.fx;
    tyran.adaptiveResolution = false;
    // Analytic fill area of every submitted triangle, by program family.
    const fill = { image: 0, geometry: 0, soft: 0, triangles: 0, flushes: 0, softLayers: 0 };
    const STRIDE = 11;
    const originalFlush = GPUCanvas2D.prototype.flush, originalSoft = GPUCanvas2D.prototype.drawSoftLayer, originalDrawImage = GPUCanvas2D.prototype.drawImage;
    let drawImageCalls = 0;
    GPUCanvas2D.prototype.drawImage = function (...a) { drawImageCalls++; return originalDrawImage.apply(this, a); };
    if (mode === 'gpu') {
      GPUCanvas2D.prototype.drawSoftLayer = function (...a) { fill.softLayers++; return originalSoft.apply(this, a); };
      GPUCanvas2D.prototype.flush = function () {
        const v = this._vertices, n = this._count;
        if (n) {
          fill.flushes++;
          const scale = this._softDrawing && this._softLayer ? (this._softLayer.width / this._softLayer.sourceWidth) ** 2 : 1;
          for (let i = 0; i + 3 * STRIDE <= n * STRIDE; i += 3 * STRIDE) {
            const ax = v[i], ay = v[i + 1], bx = v[i + STRIDE], by = v[i + STRIDE + 1], cx = v[i + 2 * STRIDE], cy = v[i + 2 * STRIDE + 1];
            const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * .5 * scale, kind = v[i + 8];
            fill.triangles++;
            if (kind === 0 || (kind >= 3 && kind <= 10)) fill.image += area; else fill.geometry += area;
            if (this._softDrawing) fill.soft += area;
          }
        }
        return originalFlush.call(this);
      };
    }
    window.__frameResetRandom();
    const launchStarted = performance.now();
    tyran.launch(worldIndex, { upgrades: { weapon: 6, shield: 4, hull: 4, recharge: 4 } });
    const launchMs = performance.now() - launchStarted;
    await world.ready;
    const state = tyran.state;
    state.time = stress ? state.duration * .7 : 25; state.scroll = 440; state.showcase = 3;
    for (const pilot of state.players) { pilot.hurt = 1e8; if (stress) pilot.rapidFireTime = 10; }
    for (let i = 0; i < 18; i++) spawnEnemy(state, i % 9, 80 + (i % 9) * (state.width - 160) / 8, 80 + Math.floor(i / 9) * 200);
    const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
    const timers = { worldDraw: 0, fxDraw: 0, frames: 0 };
    const worldDraw = world.draw, fxDraw = fx.draw;
    world.draw = function (...a) { const t = performance.now(); const r = worldDraw.apply(this, a); timers.worldDraw += performance.now() - t; timers.frames++; return r; };
    fx.draw = function (...a) { const t = performance.now(); const r = fxDraw.apply(this, a); timers.fxDraw += performance.now() - t; return r; };
    const longTasks = [];
    const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push({ at: entry.startTime, ms: entry.duration }); });
    observer.observe({ type: 'longtask' });
    const gpuBefore = { ...tyran.renderer }, perfBefore = { ...tyran.performance };
    await window.__frameStart();
    key('Space', true); key('KeyQ', true);
    const startTime = state.time, flightStarted = performance.now();
    const frames = []; let previous = null, steering = -1, lastImpact = -1;
    await new Promise(resolve => {
      function sample(timestamp) {
        const impact = Math.floor((state.time - startTime) / 2);
        if (stress && impact !== lastImpact) {
          lastImpact = impact;
          const pilot = state.players[0]; pilot.hurt = 0; hurtPlayer(state, pilot, 1); pilot.hurt = 1e8;
          for (let i = 0; i < 6; i++) state.events.push({ type: 'explosion', ground: true, x: state.width * (.18 + i * .13), y: 200 + i % 3 * 145, size: 60 });
        }
        if (previous !== null) frames.push(timestamp - previous);
        previous = timestamp;
        const phase = Math.floor((state.time - startTime) / 3) % 4;
        if (phase !== steering) {
          for (const code of ['KeyA', 'KeyD']) key(code, false);
          if (phase === 0) key('KeyD', true);
          if (phase === 2) key('KeyA', true);
          steering = phase;
        }
        if (performance.now() - flightStarted < seconds * 1000) requestAnimationFrame(sample); else resolve();
      }
      requestAnimationFrame(sample);
    });
    const flightMs = performance.now() - flightStarted;
    await window.__frameStop();
    for (const code of ['Space', 'KeyQ', 'KeyA', 'KeyD']) key(code, false);
    observer.disconnect(); world.draw = worldDraw; fx.draw = fxDraw;
    GPUCanvas2D.prototype.flush = originalFlush; GPUCanvas2D.prototype.drawSoftLayer = originalSoft; GPUCanvas2D.prototype.drawImage = originalDrawImage;
    const gpuAfter = { ...tyran.renderer }, perfAfter = { ...tyran.performance };
    const canvas = document.querySelector('#game-gpu-canvas');
    return { launchMs, flightMs, simulationSeconds: state.time - startTime, frames, longTasks, timers, drawImageCalls,
      renderedFrames: perfAfter.frames - perfBefore.frames, steps: perfAfter.steps - perfBefore.steps,
      renderMsEma: perfAfter.renderMs, updateMsEma: perfAfter.updateMs, renderScale: perfAfter.renderScale,
      gpu: { drawCalls: gpuAfter.drawCalls - gpuBefore.drawCalls, vertices: gpuAfter.vertices - gpuBefore.vertices,
        uploads: gpuAfter.uploads - gpuBefore.uploads, partialUploads: gpuAfter.partialUploads - gpuBefore.partialUploads,
        uploadedBytes: gpuAfter.uploadedBytes - gpuBefore.uploadedBytes, textureBytes: gpuAfter.textureBytes, textureCount: gpuAfter.textureCount,
        evictions: gpuAfter.evictions - gpuBefore.evictions, frames: gpuAfter.frames - gpuBefore.frames },
      workload: { enemies: state.enemies.length, bullets: state.bullets.length, kills: state.kills, shots: state.stats.shots },
      surface: { width: canvas?.width, height: canvas?.height, W: state.width, H: state.height }, fill };
  }, { seconds, stress, worldIndex, mode });
  const frameCount = flight.renderedFrames, gpuFrames = Math.max(1, flight.gpu.frames);
  assert(frameCount >= seconds * 5, `the flight rendered frames (${frameCount})`);
  assert(flight.steps >= seconds * 30, `the simulation advanced (${flight.steps} steps)`);
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  const totalSamples = (profile.samples || []).length;
  const skip = new Set(['(idle)', '(program)', '(garbage collector)', '(root)']);
  const hot = profile.nodes.map(node => ({ name: node.callFrame.functionName || '(anonymous)', file: node.callFrame.url.split('/').at(-1), line: node.callFrame.lineNumber, samples: counts.get(node.id) || 0 }))
    .filter(node => node.samples > 0 && !skip.has(node.name)).sort((a, b) => b.samples - a.samples).slice(0, 30)
    .map(node => ({ ...node, pct: +(100 * node.samples / Math.max(1, totalSamples)).toFixed(2) }));
  const byId = new Map(profile.nodes.map(node => [node.id, node])), parent = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
  const inclusiveTotals = new Map();
  for (const id of profile.samples || []) {
    const seen = new Set(); let current = id;
    while (current !== undefined) {
      const node = byId.get(current), key = `${node.callFrame.functionName || '(anonymous)'} @${node.callFrame.url.split('/').at(-1)}:${node.callFrame.lineNumber}`;
      if (!seen.has(key)) { seen.add(key); inclusiveTotals.set(key, (inclusiveTotals.get(key) || 0) + 1); }
      current = parent.get(current);
    }
  }
  const inclusive = [...inclusiveTotals].filter(([key]) => ![...skip].some(name => key.startsWith(name))).sort((a, b) => b[1] - a[1]).slice(0, 40)
    .map(([fn, samples]) => ({ fn, pct: +(100 * samples / Math.max(1, totalSamples)).toFixed(2) }));
  const gc = profile.nodes.filter(node => node.callFrame.functionName === '(garbage collector)').reduce((sum, node) => sum + (counts.get(node.id) || 0), 0);
  const pixels = Math.max(1, (flight.surface.width || 1) * (flight.surface.height || 1)), screens = value => +(value / pixels / Math.max(1, frameCount)).toFixed(3);
  const result = {
    label, mode, url: url.href, backend, worldIndex, viewport, dpr, seconds, stress, startupMs, launchMs: flight.launchMs, errors,
    fps: frameCount / (flight.flightMs / 1000), renderedFrames: frameCount, simulationSteps: flight.steps, simulationSeconds: flight.simulationSeconds,
    frameInterval: distribution(flight.frames), over25ms: flight.frames.filter(f => f > 25).length, over50ms: flight.frames.filter(f => f > 50).length,
    longTasks: flight.longTasks.length, longTaskMs: flight.longTasks.reduce((sum, task) => sum + task.ms, 0), longestTasks: flight.longTasks.toSorted((a, b) => b.ms - a.ms).slice(0, 5),
    perFrame: {
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000 / frameCount,
      taskMs: (after.TaskDuration - before.TaskDuration) * 1000 / frameCount,
      worldDrawMs: flight.timers.worldDraw / Math.max(1, flight.timers.frames), fxDrawMs: flight.timers.fxDraw / Math.max(1, flight.timers.frames),
      renderMsEma: flight.renderMsEma, updateMsEma: flight.updateMsEma,
      drawCalls: flight.gpu.drawCalls / gpuFrames, vertices: flight.gpu.vertices / gpuFrames, drawImageCalls: flight.drawImageCalls / gpuFrames,
      textureUploads: flight.gpu.uploads / gpuFrames, partialUploads: flight.gpu.partialUploads / gpuFrames, uploadedKB: flight.gpu.uploadedBytes / 1024 / gpuFrames,
    },
    fillPerFrame: mode === 'gpu' ? { imageScreens: screens(flight.fill.image), geometryScreens: screens(flight.fill.geometry), softScreens: screens(flight.fill.soft),
      totalScreens: screens(flight.fill.image + flight.fill.geometry), triangles: +(flight.fill.triangles / Math.max(1, frameCount)).toFixed(1),
      flushes: +(flight.fill.flushes / Math.max(1, frameCount)).toFixed(2), softLayers: +(flight.fill.softLayers / Math.max(1, frameCount)).toFixed(2) } : null,
    gpu: flight.gpu, renderScale: flight.renderScale, surface: flight.surface, workload: flight.workload,
    jsHeapMB: (after.JSHeapUsedSize || 0) / 1048576,
    profile: { totalSamples, gcPct: +(100 * gc / Math.max(1, totalSamples)).toFixed(2), hot, inclusive },
  };
  await writeFile(join(out, `${label}.json`), JSON.stringify(result, null, 2));
  if (profiling) await writeFile(join(out, `${label}-profile.json`), JSON.stringify(profile));
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, [], 'the browser reports no runtime errors');
  console.log(`Frame-cost ${mode} run complete: ${frameCount} frames, ${result.perFrame.scriptMs.toFixed(2)} ms script per frame. Output in ${out}`);
} finally { await browser.close(); }
