// Sustained single-player flight through new terrain. Frame timings are measurements,
// not machine-dependent pass/fail thresholds; coverage and errors are asserted.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const out = process.env.TYRAN_PERF_OUTPUT || '/tmp/tyran-performance';
const seconds = Math.max(25, Number(process.env.TYRAN_PERF_SECONDS) || 25);
const dpr = Number(process.env.TYRAN_DPR || 1);
const viewport = { width: Number(process.env.TYRAN_VIEWPORT_WIDTH) || 1440, height: Number(process.env.TYRAN_VIEWPORT_HEIGHT) || 960 };
const coldLaunch = process.env.TYRAN_PERF_COLD === '1';
const stress = process.env.TYRAN_PERF_STRESS === '1';
const profiling = process.env.TYRAN_PERF_PROFILE !== '0';
const worldIndex = Math.max(0, Math.min(9, Math.floor(Number(process.env.TYRAN_PERF_WORLD ?? 6))));
const sampleHardwareGpu = process.env.TYRAN_PERF_GPU_SAMPLE === '1' && process.platform === 'darwin';
const runFile = promisify(execFile), hardwareGpuSamples = [];
let hardwareGpuTimer, hardwareGpuPending;
const sampleGpu = () => {
  if (hardwareGpuPending) return;
  hardwareGpuPending = runFile('ioreg', ['-r', '-c', 'AGXAccelerator', '-d', '1'], { maxBuffer: 1024 * 1024 }).then(({ stdout }) => {
    const stats = stdout.split('\n').find(line => line.includes('"PerformanceStatistics"')) || '';
    const value = name => Number(stats.match(new RegExp(`"${name} Utilization %"=(\\d+)`))?.[1]);
    const device = value('Device'), renderer = value('Renderer'), tiler = value('Tiler');
    if ([device, renderer, tiler].every(Number.isFinite)) hardwareGpuSamples.push({ device, renderer, tiler });
  }).catch(() => {}).finally(() => { hardwareGpuPending = null; });
};
const cpuRate = Math.max(1, Number(process.env.TYRAN_CPU_RATE) || 1);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
const errors = [];
const browserCdp = await browser.newBrowserCDPSession();
const system = await browserCdp.send('SystemInfo.getInfo');
const processTimes = async () => (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
const gpu = { devices: system.gpu.devices.map(({ vendorString, deviceString }) => ({ vendorString, deviceString })), features: system.gpu.featureStatus };
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  let seed = 7481;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  localStorage.setItem('tyran-muted', 'true');
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
const distribution = values => {
  const sorted = values.toSorted((a, b) => a - b), percentile = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
  return { samples: sorted.length, medianMs: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: percentile(1) };
};
try {
  await page.goto(url); await page.waitForFunction(() => window.tyran);
  await page.evaluate(async () => { await tyran.world.ready; });
  const idleBefore = await metrics(); await page.waitForTimeout(1500); const idleAfter = await metrics();
  if (!coldLaunch) {
    await page.locator(`[data-world="${worldIndex}"]`).click();
    await page.waitForTimeout(1200);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  if (profiling) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
  }
  const processesBefore = await processTimes(), before = await metrics();
  if (sampleHardwareGpu) hardwareGpuTimer = setInterval(sampleGpu, 1000);
  const flight = await page.evaluate(async ({ seconds, stress, worldIndex }) => {
    const { spawnEnemy, hurtPlayer } = await import('./sim.js'), world = tyran.world;
    const started = performance.now(), trace = { draws: [], terrainBuilds: [], terrainRows: [], sceneryBuilds: [], longTasks: [], frames: [] };
    let chunkHeight = 0, inFlight = false;
    const draw = world.draw, getTile = world.getTile, getSceneryLayer = world.getSceneryLayer, paintTerrainRow = world.paintTerrainRow;
    world.draw = function (...args) {
      const time = performance.now();
      const result = draw.apply(this, args);
      trace.draws.push({ at: time - started, ms: performance.now() - time, scroll: args[3] });
      return result;
    };
    world.getTile = function (row) {
      if (this.tiles.has(row)) {
        const result = getTile.call(this, row);
        chunkHeight = result.height / (world.detailScale || 1);
        return result;
      }
      const time = performance.now(), result = getTile.call(this, row);
      chunkHeight = result.height / (world.detailScale || 1);
      trace.terrainBuilds.push({ row, inFlight, at: time - started, ms: performance.now() - time });
      return result;
    };
    if (paintTerrainRow) world.paintTerrainRow = function (out, row, y) {
      const time = performance.now(), result = paintTerrainRow.call(this, out, row, y);
      trace.terrainRows.push({ row, y, inFlight, at: time - started, ms: performance.now() - time });
      return result;
    };
    world.getSceneryLayer = function (row, band, depth = 0) {
      const partial = this.sceneryLayers[depth].has(row);
      if (partial && !this.sceneryDirty?.has(row)) return getSceneryLayer.call(this, row, band, depth);
      const time = performance.now(), result = getSceneryLayer.call(this, row, band, depth);
      trace.sceneryBuilds.push({ row, depth, partial, inFlight, at: time - started, ms: performance.now() - time });
      return result;
    };
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) trace.longTasks.push({ at: entry.startTime - started, ms: entry.duration });
    });
    observer.observe({ type: 'longtask' });
    const launchStarted = performance.now();
    tyran.launch(worldIndex, { upgrades: { weapon: 6, shield: 4, hull: 4, recharge: 4 } });
    const launchMs = performance.now() - launchStarted;
    await world.ready;
    const state = tyran.state;
    // Keep normal scrolling and moving opponents: a guardian would slow the
    // ground to 42px/s and hide chunk-streaming work from a short benchmark.
    state.time = stress ? state.duration * .7 : 25; state.scroll = 440; state.showcase = 3;
    for (const pilot of state.players) { pilot.hurt = 1e8; if (stress) pilot.rapidFireTime = 10; }
    for (let i = 0; i < 18; i++) spawnEnemy(state, i % 9, 80 + (i % 9) * (state.width - 160) / 8, 80 + Math.floor(i / 9) * 200);
    const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
    key('Space', true); key('KeyQ', true);
    const startScroll = state.scroll, startTime = state.time, flightStarted = performance.now();
    inFlight = true;
    let previous = null, steering = -1, lastImpact = -1;
    await new Promise(resolve => {
      function sample(timestamp) {
        const at = performance.now() - started;
        const impact = Math.floor((state.time - startTime) / 2);
        if (stress && impact !== lastImpact) {
          lastImpact = impact;
          const pilot = state.players[0]; pilot.hurt = 0;
          hurtPlayer(state, pilot, 1); pilot.hurt = 1e8;
          for (let i = 0; i < 6; i++) state.events.push({ type: 'explosion', ground: true,
            x: state.width * (.18 + i * .13), y: 200 + i % 3 * 145, size: 60 });
        }
        if (previous !== null) trace.frames.push({ at, ms: timestamp - previous, scroll: state.scroll, enemies: state.enemies.length, bullets: state.bullets.length, renderAverageMs: tyran.performance.renderMs });
        previous = timestamp;
        // Brief alternating strafes exercise interpolation/parallax and keep
        // both firing lanes moving without an AI modifying simulation state.
        const phase = Math.floor((state.time - startTime) / 3) % 4;
        if (phase !== steering) {
          for (const code of ['KeyA', 'KeyD']) key(code, false);
          if (phase === 0) { key('KeyD', true); }
          if (phase === 2) { key('KeyA', true); }
          steering = phase;
        }
        if (performance.now() - flightStarted < seconds * 1000) requestAnimationFrame(sample); else resolve();
      }
      requestAnimationFrame(sample);
    });
    for (const code of ['Space', 'KeyQ', 'KeyA', 'KeyD']) key(code, false);
    observer.disconnect(); world.draw = draw; world.getTile = getTile; world.getSceneryLayer = getSceneryLayer;
    if (paintTerrainRow) world.paintTerrainRow = paintTerrainRow;
    return { ...trace, launchMs, startScroll, endScroll: state.scroll, simulationSeconds: state.time - startTime, elapsedMs: performance.now() - started, flightMs: performance.now() - flightStarted,
      chunkHeight, chunkBoundaries: Math.floor(state.scroll / chunkHeight) - Math.floor(startScroll / chunkHeight), performance: tyran.performance,
      assetRequests: performance.getEntriesByType('resource').filter(entry => entry.startTime >= flightStarted && entry.name.startsWith('http') && entry.name.includes('/assets/')).map(entry => entry.name) };
  }, { seconds, stress, worldIndex });
  const after = await metrics(), processesAfter = await processTimes();
  clearInterval(hardwareGpuTimer); await hardwareGpuPending;
  const { profile } = profiling ? await cdp.send('Profiler.stop') : { profile: { nodes: [], samples: [] } };
  // OS CPU seconds for each Chrome process, including raster/compositor work
  // outside the main JS thread. GPU-process CPU is not GPU hardware time.
  const processCpuSeconds = {};
  for (const process of processesAfter) {
    const previous = processesBefore.find(item => item.id === process.id);
    if (previous) processCpuSeconds[process.type] = (processCpuSeconds[process.type] || 0) + process.cpuTime - previous.cpuTime;
  }
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  const hot = profile.nodes.map(node => ({ name: node.callFrame.functionName, url: node.callFrame.url.split('/').at(-1), samples: counts.get(node.id) || 0 }))
    .filter(node => node.url?.endsWith('.js')).sort((a, b) => b.samples - a.samples).slice(0, 14);
  const builds = [...flight.terrainBuilds.map(build => ({ ...build, kind: 'terrain' })), ...flight.sceneryBuilds.map(build => ({ ...build, kind: 'scenery' }))];
  const frameCount = flight.frames.length, warmDraws = flight.draws.filter(draw => draw.at >= 1500);
  const result = {
    url, viewport, dpr, stress, worldIndex, profiling, cpuRate, gpu, launchMode: coldLaunch ? 'cold' : 'after-preview', launchMs: flight.launchMs,
    requestedSeconds: seconds, elapsedSeconds: flight.elapsedMs / 1000, flightSeconds: flight.flightMs / 1000, simulationSeconds: flight.simulationSeconds,
    streaming: { startScroll: flight.startScroll, endScroll: flight.endScroll, chunkHeight: flight.chunkHeight, chunkBoundaries: flight.chunkBoundaries,
      terrainBuilds: flight.terrainBuilds.length, sceneryBuilds: flight.sceneryBuilds.length, partialSceneryBuilds: flight.sceneryBuilds.filter(build => build.partial).length },
    preflight: { terrainRows: flight.terrainRows.filter(row => !row.inFlight).length, sceneryBuilds: flight.sceneryBuilds.filter(build => !build.inFlight).length },
    inFlightPreparation: { synchronousTerrainBuilds: flight.terrainBuilds.filter(build => build.inFlight).length,
      incrementalTerrainRows: flight.terrainRows.filter(row => row.inFlight).length,
      terrainRowWork: distribution(flight.terrainRows.filter(row => row.inFlight).map(row => row.ms)), assetRequests: flight.assetRequests },
    frames: distribution(flight.frames.map(frame => frame.ms)), over25ms: flight.frames.filter(frame => frame.ms > 25).length,
    over50ms: flight.frames.filter(frame => frame.ms > 50).length, terrainDraw: distribution(flight.draws.map(draw => draw.ms)), warmTerrainDraw: distribution(warmDraws.map(draw => draw.ms)),
    gameRenderMovingAverage: distribution(flight.frames.map(frame => frame.renderAverageMs)),
    terrainBuild: distribution(flight.terrainBuilds.map(build => build.ms)), sceneryBuild: distribution(flight.sceneryBuilds.map(build => build.ms)),
    longestFrames: flight.frames.toSorted((a, b) => b.ms - a.ms).slice(0, 8).map(frame => ({ ...frame,
      nearbyBuilds: builds.filter(build => build.at + build.ms >= frame.at - frame.ms - 20 && build.at <= frame.at).map(build => ({ kind: build.kind, row: build.row, depth: build.depth, ms: build.ms })) })),
    longestBuilds: builds.toSorted((a, b) => b.ms - a.ms).slice(0, 8), longTasks: flight.longTasks,
    enemyRange: [Math.min(...flight.frames.map(frame => frame.enemies)), Math.max(...flight.frames.map(frame => frame.enemies))],
    bulletRange: [Math.min(...flight.frames.map(frame => frame.bullets)), Math.max(...flight.frames.map(frame => frame.bullets))],
    scriptMsPerFrame: (after.ScriptDuration - before.ScriptDuration) * 1000 / frameCount,
    taskMsPerFrame: (after.TaskDuration - before.TaskDuration) * 1000 / frameCount,
    layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, idleScriptMs: (idleAfter.ScriptDuration - idleBefore.ScriptDuration) * 1000,
    processCpuSeconds, totalProcessCpuSeconds: Object.values(processCpuSeconds).reduce((sum, value) => sum + value, 0),
    hardwareGpu: sampleHardwareGpu ? { source: 'macOS AGXAccelerator PerformanceStatistics', scope: 'Whole device, including other apps',
      samplePeriodMs: 1000, samples: hardwareGpuSamples,
      meanPercent: Object.fromEntries(['device', 'renderer', 'tiler'].map(key => [key, hardwareGpuSamples.length
        ? hardwareGpuSamples.reduce((sum, sample) => sum + sample[key], 0) / hardwareGpuSamples.length : null])) } : null,
    performance: flight.performance, hot, errors,
  };
  await page.screenshot({ path: `${out}/busy-flight.png` });
  await writeFile(`${out}/profile.json`, JSON.stringify(profile));
  await writeFile(`${out}/trace.json`, JSON.stringify(flight));
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.ok(flight.chunkBoundaries >= 3, 'flight must cross at least three actual terrain chunk boundaries');
  assert.deepEqual(flight.assetRequests, [], 'sustained flight must use preloaded assets without network requests');
  assert.deepEqual(errors, [], 'sustained flight must run without browser errors');
} finally { clearInterval(hardwareGpuTimer); await hardwareGpuPending; await browser.close(); }
