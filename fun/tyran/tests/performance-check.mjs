import { nativeCpuReader } from './native-cpu-client.mjs';
import { createHash } from 'node:crypto';
// Sustained single-player flight through new terrain. Frame timings are measurements,
// not machine-dependent pass/fail thresholds; coverage and errors are asserted.
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const diagnosticRoot = process.env.TYRAN_SNAPSHOT_DIR ? resolve(process.env.TYRAN_SNAPSHOT_DIR) : null;
const diagnosticVariant = process.env.TYRAN_ABLATION || (diagnosticRoot ? 'native' : 'current');
const targetUrl = new URL(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
if (!diagnosticRoot && process.env.TYRAN_ABLATION) {
  assert.ok(['native', 'gpu'].includes(diagnosticVariant), 'Custom ablations require TYRAN_SNAPSHOT_DIR');
  targetUrl.searchParams.set('renderer', diagnosticVariant);
}
const url = targetUrl.href;
const out = process.env.TYRAN_PERF_OUTPUT || join(tmpdir(), 'tyran-performance');
const seconds = Math.max(25, Number(process.env.TYRAN_PERF_SECONDS) || 25);
const dpr = Number(process.env.TYRAN_DPR || 1);
const viewport = { width: Number(process.env.TYRAN_VIEWPORT_WIDTH) || 1440, height: Number(process.env.TYRAN_VIEWPORT_HEIGHT) || 960 };
const coldLaunch = process.env.TYRAN_PERF_COLD === '1';
const stress = process.env.TYRAN_PERF_STRESS === '1';
const profiling = process.env.TYRAN_PERF_PROFILE !== '0';
const worldIndex = Math.max(0, Math.min(9, Math.floor(Number(process.env.TYRAN_PERF_WORLD ?? 6))));
const sampleHardwareGpu = process.env.TYRAN_PERF_GPU_SAMPLE === '1' && process.platform === 'darwin';
const runFile = promisify(execFile), hardwareGpuSamples = [], idleHardwareGpuSamples = [];
let hardwareGpuTimer, hardwareGpuPending;
const sampleGpu = (samples = hardwareGpuSamples) => {
  if (hardwareGpuPending) return hardwareGpuPending;
  hardwareGpuPending = runFile('ioreg', ['-r', '-c', 'AGXAccelerator', '-d', '1'], { maxBuffer: 1024 * 1024 }).then(({ stdout }) => {
    const stats = stdout.split('\n').find(line => line.includes('"PerformanceStatistics"')) || '';
    const value = name => Number(stats.match(new RegExp(`"${name} Utilization %"=(\\d+)`))?.[1]);
    const device = value('Device'), renderer = value('Renderer'), tiler = value('Tiler');
    if ([device, renderer, tiler].every(Number.isFinite)) samples.push({ at: Date.now(), device, renderer, tiler });
  }).catch(() => {}).finally(() => { hardwareGpuPending = null; });
  return hardwareGpuPending;
};
const cpuRate = Math.max(1, Number(process.env.TYRAN_CPU_RATE) || 1);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
const errors = [];
const browserCdp = await browser.newBrowserCDPSession();
const system = await browserCdp.send('SystemInfo.getInfo');
const discoverProcesses = async () => (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
const useNativeCpu = process.platform === 'darwin' && process.env.TYRAN_PERF_NATIVE_CPU !== '0';
const nativeCpu = useNativeCpu ? nativeCpuReader() : null;
let trackedProcesses = [], checkedProcesses = [];
const processTimes = async () => nativeCpu ? (await nativeCpu.read(trackedProcesses)).processInfo : discoverProcesses();
// Diagnostic-only startup attribution. Fixed intervals are identical across A/B;
// no adaptive low-CPU start selection or subtraction from the headline total.
const previewSettleMs = Math.max(0, Number(process.env.TYRAN_PERF_SETTLE_MS ?? 60000));
const cpuBuckets = [], cpuBucketOrigin = performance.now();
let cpuBucketStage = 'startup', cpuBucketPrevious = null, cpuBucketPending;
const sampleCpuBucket = () => {
  if (cpuBucketPending) return cpuBucketPending;
  cpuBucketPending = processTimes().then(processes => {
    const now = performance.now(), next = { atMs: now - cpuBucketOrigin, stage: cpuBucketStage, processes };
    if (cpuBucketPrevious) {
      const seconds = {}, previous = new Map(cpuBucketPrevious.processes.map(p => [p.id, p]));
      for (const process of processes) {
        const prior = previous.get(process.id);
        if (prior) seconds[process.type] = (seconds[process.type] || 0) + process.cpuTime - prior.cpuTime;
      }
      cpuBuckets.push({ atMs: next.atMs, durationMs: next.atMs - cpuBucketPrevious.atMs,
        stageStart: cpuBucketPrevious.stage, stageEnd: next.stage, processCpuSeconds: seconds });
    }
    cpuBucketPrevious = next;
  }).finally(() => { cpuBucketPending = null; });
  return cpuBucketPending;
};
let cpuBucketTimer, cpuBucketFailure;
const pollCpuBucket = () => { sampleCpuBucket().catch(error => { cpuBucketFailure = error; clearInterval(cpuBucketTimer); }); };

const gpu = { devices: system.gpu.devices.map(({ vendorString, deviceString }) => ({ vendorString, deviceString })), features: system.gpu.featureStatus };
page.on('pageerror', error => errors.push(error.message));
// Gate callback DELIVERY, including the frame already scheduled by the game.
// The gate is used once, only across the asynchronous counter-start read. After
// release requestAnimationFrame is restored to the real browser implementation;
// the measured flight has normal RAF cadence, rendering, and simulation updates.
function installBoundaryRafGate() {
  const nativeRaf=window.requestAnimationFrame.bind(window);
  const nativeCancel=window.cancelAnimationFrame.bind(window);
  const held=new Map(), resumed=new Map();
  let frozen=false, started=0;
  const maybeRestoreCancel=()=>{if(!frozen&&!held.size&&!resumed.size)window.cancelAnimationFrame=nativeCancel;};
  window.requestAnimationFrame=callback=>{
    const id=nativeRaf(timestamp=>{if(frozen)held.set(id,callback);else callback(timestamp);});
    return id;
  };
  window.cancelAnimationFrame=id=>{
    held.delete(id);nativeCancel(resumed.get(id)??id);resumed.delete(id);
    if(window.requestAnimationFrame===nativeRaf)maybeRestoreCancel();
  };
  window.__tyranStartRafGate={
    freeze(){if(frozen)throw Error('RAF start gate already frozen');frozen=true;started=performance.now();},
    resume(){
      if(!frozen)throw Error('RAF start gate was not frozen');
      if(document.hidden)throw Error('Benchmark page must remain visible');
      // The existing visible-tab handler resets the game's private lastTime to
      // zero without pausing, changing state, clearing input, or rewriting source.
      // Thus the first normal RAF establishes a new clock baseline and cannot
      // turn time spent reading OS counters into a simulation catch-up step.
      document.dispatchEvent(new Event('visibilitychange'));
      frozen=false;window.requestAnimationFrame=nativeRaf;
      const summary={frozenMs:performance.now()-started,queuedCallbacks:held.size};
      for(const [id,callback]of held){
        const replacement=nativeRaf(timestamp=>{resumed.delete(id);maybeRestoreCancel();callback(timestamp);});
        resumed.set(id,replacement);
      }
      held.clear();maybeRestoreCancel();return summary;
    },
  };
}
await page.addInitScript(installBoundaryRafGate);
await page.addInitScript(() => {
  let seed=7481,visualSeed=7481;
  const next=value=>(Math.imul(value,1664525)+1013904223)>>>0;
  Math.random=()=>{seed=next(seed);return seed/4294967296;};
  window.__tyranVisualRandom=()=>{visualSeed=next(visualSeed);return visualSeed/4294967296;};
  window.__tyranResetRandom=()=>{seed=7481;visualSeed=7481;};
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
  const diagnosticManifest = diagnosticRoot ? JSON.parse(await readFile(join(diagnosticRoot, 'manifest.json'), 'utf8')) : null;
  const diagnosticMetadata = diagnosticManifest?.[diagnosticVariant] || {};
  const randomSubstitutions = {};
  if (diagnosticRoot) {
    assert.ok(diagnosticManifest[diagnosticVariant], 'Known diagnostic variant');
    assert.match(diagnosticVariant, /^[a-zA-Z0-9_-]+$/, 'Snapshot variant is one directory name');
    // Optional symmetric snapshot interception. Without a snapshot directory,
    // the harness measures the current served application without rewriting it.
    // sim.js/waves.js keep seeded Math.random and production algorithms.
    await page.route('**/fun/tyran/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1) || 'index.html';
      if (Object.hasOwn(diagnosticMetadata.overrides, name)) {
        let body = await readFile(join(diagnosticRoot, diagnosticVariant, name), 'utf8');
        assert.equal(createHash('sha256').update(body).digest('hex'), diagnosticMetadata.overrides[name], `Frozen source hash: ${name}`);
        if (name === 'game.js' || name === 'effects.js') {
          const matches = body.match(/Math\.random\(\)/g) || [];
          randomSubstitutions[name] = matches.length;
          body = body.replace(/Math\.random\(\)/g, 'window.__tyranVisualRandom()');
        }
        await route.fulfill({ status: 200, contentType: name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'text/javascript', body });
      } else await route.continue();
    });
  }
  await page.goto(url); await page.waitForFunction(() => window.tyran);
  await page.evaluate(async () => { await tyran.world.ready; });
  cpuBucketStage = 'idle-control';
  const idleBefore = await metrics();
  // An unchanged menu is the whole-device GPU control, not a per-process
  // subtraction. Keep its raw samples so unrelated activity remains visible.
  if (sampleHardwareGpu) {
    await sampleGpu(idleHardwareGpuSamples);
    hardwareGpuTimer = setInterval(() => sampleGpu(idleHardwareGpuSamples), 1000);
  }
  await page.waitForTimeout(sampleHardwareGpu ? 5200 : 1500);
  clearInterval(hardwareGpuTimer); await hardwareGpuPending;
  const idleAfter = await metrics();
  if (!coldLaunch) {
    await page.locator(`[data-world="${worldIndex}"]`).click();
    await page.evaluate(async () => { await tyran.world.ready; });
  }
  trackedProcesses = await discoverProcesses();
  assert.ok(trackedProcesses.some(process => process.type === 'browser'), 'Owned browser PID discovered');
  await sampleCpuBucket();
  cpuBucketTimer = setInterval(pollCpuBucket, 1000);
  cpuBucketStage = 'preview-settle';
  await page.waitForTimeout(previewSettleMs);
  cpuBucketStage = 'launch-preparation';
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  if (profiling) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  }
  let processesBefore, processesAfter, before, after, measurementStarted, measurementMs;
  let ownedGpuBefore=null, ownedGpuAfter=null;
  const sampleOwnedGpu = async () => {
    if(process.platform!=='darwin' || process.env.TYRAN_PERF_OWN_GPU==='0') return null;
    const {stdout}=await runFile(process.env.TYRAN_PYTHON || 'python3',[fileURLToPath(new URL('./owned-gpu-stats.py', import.meta.url)),...trackedProcesses.map(p=>String(p.id))]);
    return JSON.parse(stdout);
  };
  let profile = { nodes: [], samples: [] };
  // Capture the process counters at page-side flight boundaries. Launch,
  // preparation, and transferring the accumulated trace stay outside this window.
  await page.exposeFunction('__tyranPerfStart', async () => {
    await sampleCpuBucket(); cpuBucketStage = 'flight';
    // Owned driver counters surround the existing CPU window. The helper work
    // itself is outside that CPU window; report its wider raw interval explicitly.
    ownedGpuBefore = await sampleOwnedGpu();
    if (profiling) await cdp.send('Profiler.start');
    [processesBefore, before] = await Promise.all([processTimes(), metrics()]);
    measurementStarted = performance.now();
    if (sampleHardwareGpu) hardwareGpuTimer = setInterval(sampleGpu, 1000);
  });
  await page.exposeFunction('__tyranPerfStop', async () => {
    clearInterval(hardwareGpuTimer);
    const [finalMetrics, finalProcesses, profileResult] = await Promise.all([metrics(), processTimes(),
      profiling ? cdp.send('Profiler.stop') : Promise.resolve({ profile })]);
    after = finalMetrics; processesAfter = finalProcesses; profile = profileResult.profile;
    measurementMs = performance.now() - measurementStarted;
    ownedGpuAfter = await sampleOwnedGpu();
    await sampleCpuBucket(); cpuBucketStage = 'post-flight';
    await hardwareGpuPending;
  });
  const flight = await page.evaluate(async ({ seconds, stress, worldIndex }) => {
    const { spawnEnemy, hurtPlayer } = await import('./sim.js'), world = tyran.world;
    const started = performance.now(), trace = { draws: [], terrainBuilds: [], terrainRows: [], sceneryBuilds: [], longTasks: [], frames: [] };
    let chunkHeight = 0, inFlight = false;
    const draw = world.draw, getTile = world.getTile, getSceneryLayer = world.getSceneryLayer, paintTerrainRow = world.paintTerrainRow;
    world.draw = function (...args) {
      const time = performance.now();
      const result = draw.apply(this, args);
      trace.draws.push({ at: time - started, ms: performance.now() - time, scroll: args[3], inFlight });
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
    // Both streams restart immediately before the shared fixture, independent of
    // how many preview frames or warmed effects this browser happened to draw.
    window.__tyranResetRandom();
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
    const canvas=document.querySelector('#game-canvas'),gpuCanvas=document.querySelector('#game-gpu-canvas');
    // Direct WebGL keeps a hidden 2D canvas for fallback/input. Report the actual
    // visible drawing surface; retain both backing sizes to catch future drift.
    const activeCanvas=()=>gpuCanvas&&!gpuCanvas.hidden?gpuCanvas:canvas;
    const surface=()=>{
      const active=activeCanvas();
      return {id:active.id,width:active.width,height:active.height,
        fallbackWidth:canvas.width,fallbackHeight:canvas.height,
        gpuWidth:gpuCanvas?.width??null,gpuHeight:gpuCanvas?.height??null,
        detailScale:world.detailScale,renderScale:tyran.performance.renderScale};
    };
    const dimensions=()=>{
      const active=activeCanvas(),rect=active.getBoundingClientRect(),style=getComputedStyle(active);
      const context=active===gpuCanvas?active.getContext('webgl2'):active.getContext('2d');
      return {...surface(),cssWidth:rect.width,cssHeight:rect.height,
        worldWidth:state.width,worldHeight:state.height,quality:tyran.fx.quality,
        renderer:tyran.renderer||{backend:'canvas2d'},contextType:active===gpuCanvas?'webgl2':'2d',
        contextAttributes:context?.getContextAttributes(),visible:!active.hidden&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0,
        fallbackCss:{width:canvas.getBoundingClientRect().width,height:canvas.getBoundingClientRect().height}};
    };
    const workload = () => ({ ...state.stats, kills: state.kills, destroyed: state.destroyed,
      score: state.score, credits: state.credits, enemies: state.enemies.length, bullets: state.bullets.length });
    const boundaryState=()=>({time:state.time,scroll:state.scroll,steps:tyran.performance.steps});
    const beforeStartRead=boundaryState(),boundaryStarted=performance.now();
    window.__tyranStartRafGate.freeze();
    let startRafGate;
    try{await window.__tyranPerfStart();}
    finally{startRafGate={...window.__tyranStartRafGate.resume(),before:beforeStartRead,after:boundaryState()};}
    const startBoundaryMs=performance.now()-boundaryStarted;
    if(JSON.stringify(startRafGate.before)!==JSON.stringify(startRafGate.after))throw Error('Simulation advanced during the counter-start read');
    key('Space', true); key('KeyQ', true);
    const startScroll = state.scroll, startTime = state.time, flightStarted = performance.now();
    const initialPerformance = tyran.performance, initialDimensions = dimensions(), initialWorkload = workload();
    const surfaceChanges = [];
    let lastSurface = surface();
    inFlight = true;
    let previous = null, steering = -1, lastImpact = -1, injectedImpacts = 0;
    await new Promise(resolve => {
      function sample(timestamp) {
        const at = performance.now() - started;
        const impact = Math.floor((state.time - startTime) / 2);
        if (stress && impact !== lastImpact) {
          lastImpact = impact; injectedImpacts++;
          const pilot = state.players[0]; pilot.hurt = 0;
          hurtPlayer(state, pilot, 1); pilot.hurt = 1e8;
          for (let i = 0; i < 6; i++) state.events.push({ type: 'explosion', ground: true,
            x: state.width * (.18 + i * .13), y: 200 + i % 3 * 145, size: 60 });
        }
        const currentPerformance = tyran.performance;
        const nextSurface=surface();
        if(Object.keys(nextSurface).some(key=>nextSurface[key]!==lastSurface[key])){
          lastSurface=nextSurface;surfaceChanges.push({at:performance.now()-flightStarted,...lastSurface});
        }
        if (previous !== null) trace.frames.push({ at, ms: timestamp - previous, scroll: state.scroll, enemies: state.enemies.length, bullets: state.bullets.length, renderAverageMs: currentPerformance.renderMs });
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
    const flightMs = performance.now() - flightStarted, endScroll = state.scroll, simulationSeconds = state.time - startTime;
    const finalPerformance = tyran.performance, finalDimensions = dimensions(), finalWorkload = workload(), finalScene = tyran.scene;
    inFlight = false;
    const stopBoundaryStarted = performance.now();
    await window.__tyranPerfStop();
    const stopBoundaryMs = performance.now() - stopBoundaryStarted;
    for (const code of ['Space', 'KeyQ', 'KeyA', 'KeyD']) key(code, false);
    observer.disconnect(); world.draw = draw; world.getTile = getTile; world.getSceneryLayer = getSceneryLayer;
    if (paintTerrainRow) world.paintTerrainRow = paintTerrainRow;
    return { ...trace, launchMs, startScroll, endScroll, simulationSeconds, elapsedMs: performance.now() - started, flightMs,
      flightOffsetMs: flightStarted - started, startBoundaryMs, stopBoundaryMs, startRafGate, initialPerformance, initialDimensions, finalDimensions, surfaceChanges,
      initialWorkload, finalWorkload, injectedImpacts, finalScene,
      chunkHeight, chunkBoundaries: Math.floor(endScroll / chunkHeight) - Math.floor(startScroll / chunkHeight), performance: finalPerformance,
      assetRequests: performance.getEntriesByType('resource').filter(entry => entry.startTime >= flightStarted && entry.name.startsWith('http') && entry.name.includes('/assets/')).map(entry => entry.name) };
  }, { seconds, stress, worldIndex });
  clearInterval(cpuBucketTimer); await cpuBucketPending;
  if (cpuBucketFailure) throw cpuBucketFailure;
  // Discovery/checks are deliberately outside the measured flight.
  checkedProcesses = await discoverProcesses();
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
    .filter(node => node.samples > 0 && node.name !== '(idle)' && node.name !== '(program)')
    .sort((a, b) => b.samples - a.samples).slice(0, 14);
  const builds = [...flight.terrainBuilds.map(build => ({ ...build, kind: 'terrain' })), ...flight.sceneryBuilds.map(build => ({ ...build, kind: 'scenery' }))];
  const frameCount = flight.performance.frames - flight.initialPerformance.frames;
  const flightDraws = flight.draws.filter(draw => draw.inFlight);
  const warmDraws = flightDraws.filter(draw => draw.at >= flight.flightOffsetMs + 1500);
  const gpuMean = samples => Object.fromEntries(['device', 'renderer', 'tiler'].map(key => [key, samples.length
    ? samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length : null]));
  const processIdsBefore = new Set(processesBefore.map(process => process.id));
  const processIdsAfter = new Set(checkedProcesses.map(process => process.id));
  let ownedGpu=null;
  if(ownedGpuBefore && ownedGpuAfter){
    const first=new Map(ownedGpuBefore.clients.map(c=>[c.registryId,c]));
    const last=new Map(ownedGpuAfter.clients.map(c=>[c.registryId,c]));
    assert(first.size>0,'At least one owned driver GPU client must be identified');
    const clients=[];
    for(const [registryId,initial] of first){
      const final=last.get(registryId);
      assert(final,`Owned GPU client ${registryId} must remain alive`);
      assert.equal(final.pid,initial.pid,'GPU client PID identity');
      assert(final.gpuTime>=initial.gpuTime,'Owned GPU accumulated counter must not decrease');
      clients.push({registryId,pid:initial.pid,initial:initial.gpuTime,final:final.gpuTime,delta:final.gpuTime-initial.gpuTime,usageInitial:initial.usage,usageFinal:final.usage});
    }
    ownedGpu={source:'IORegistry AGXDeviceUserClient.AppUsage.accumulatedGPUTime',
      units:'Raw driver accumulated-GPU-time units; only relative comparisons are asserted',
      scope:'Explicit owned benchmark browser PIDs; same client registry IDs required throughout',
      gpuTimeDelta:clients.reduce((sum,c)=>sum+c.delta,0),clients,
      newClients:ownedGpuAfter.clients.filter(c=>!first.has(c.registryId)),
      boundarySeconds:ownedGpuAfter.at-ownedGpuBefore.at,readDurationMs:{before:ownedGpuBefore.readDurationMs,after:ownedGpuAfter.readDurationMs},
      cpuWindowSeconds:measurementMs/1000,initial:ownedGpuBefore,final:ownedGpuAfter};
  }
  const result = {
    ownedGpu,
    diagnostic:{variant:diagnosticVariant,snapshotDirectory:diagnosticRoot,previewSettleMs,...diagnosticMetadata,
      harnessChanges:{startBoundary:'RAF callback delivery held only during counter-start read; visible-tab clock reset, then native RAF restored',
        activeSurface:'Visible GPU canvas when present, otherwise native 2D; record both backing sizes',
        randomStreams:{simulationSeed:7481,visualSeed:diagnosticRoot?7481:null,separated:!!diagnosticRoot,resetImmediatelyBeforeLaunch:true,
          substitutions:randomSubstitutions,files:diagnosticRoot?['game.js','effects.js']:[],replacement:diagnosticRoot?'Math.random() -> window.__tyranVisualRandom()':null,
          limitation:diagnosticRoot?'Visual randomness is separated, but controls/injected impacts still run from real RAF; compare actual workload and cadence. Browser-process CPU variance remains.':'Current served code is not rewritten: visual randomness may consume the shared seeded stream. Compare actual workload and cadence, or use symmetric snapshots for separated streams.'}}},
    processCpuBuckets: cpuBuckets,
    url, viewport, dpr, stress, worldIndex, profiling, cpuRate, gpu, launchMode: coldLaunch ? 'cold' : 'after-preview', launchMs: flight.launchMs,
    measurement: { scope: 'Sustained flight only; excludes launch, preparation, and trace transfer',
      cpuSource: useNativeCpu ? 'macOS proc_pid_rusage; Mach ticks converted with mach_timebase_info' : 'Chrome DevTools Protocol SystemInfo.getProcessInfo',
      nativePidIdentityVerified: useNativeCpu, trackedProcesses: processesBefore.map(({id,type,startTime}) => ({id,type,startTime})),
      seconds: measurementMs / 1000, startBoundaryMs: flight.startBoundaryMs, stopBoundaryMs: flight.stopBoundaryMs, startRafGate:flight.startRafGate,
      processChurn: { started: checkedProcesses.filter(process => !processIdsBefore.has(process.id)).map(process => ({ id: process.id, type: process.type })),
        exited: processesBefore.filter(process => !processIdsAfter.has(process.id)).map(process => ({ id: process.id, type: process.type })) } },
    cadence: { renderedFrames: frameCount, simulationSteps: flight.performance.steps - flight.initialPerformance.steps,
      worldDraws: flightDraws.length, sampledFrameIntervals: flight.frames.length, finalScene: flight.finalScene,
      framesPerSecond: frameCount / (flight.flightMs / 1000) },
    surface: { initial: flight.initialDimensions, final: flight.finalDimensions, changes: flight.surfaceChanges },
    workload: { initial: flight.initialWorkload, final: flight.finalWorkload, injectedImpacts: flight.injectedImpacts,
      enemyFrameSamples: flight.frames.reduce((sum, frame) => sum + frame.enemies, 0),
      bulletFrameSamples: flight.frames.reduce((sum, frame) => sum + frame.bullets, 0) },
    requestedSeconds: seconds, elapsedSeconds: flight.elapsedMs / 1000, flightSeconds: flight.flightMs / 1000, simulationSeconds: flight.simulationSeconds,
    streaming: { startScroll: flight.startScroll, endScroll: flight.endScroll, chunkHeight: flight.chunkHeight, chunkBoundaries: flight.chunkBoundaries,
      terrainBuilds: flight.terrainBuilds.length, sceneryBuilds: flight.sceneryBuilds.length, partialSceneryBuilds: flight.sceneryBuilds.filter(build => build.partial).length },
    preflight: { terrainRows: flight.terrainRows.filter(row => !row.inFlight).length, sceneryBuilds: flight.sceneryBuilds.filter(build => !build.inFlight).length },
    inFlightPreparation: { synchronousTerrainBuilds: flight.terrainBuilds.filter(build => build.inFlight).length,
      incrementalTerrainRows: flight.terrainRows.filter(row => row.inFlight).length,
      terrainRowWork: distribution(flight.terrainRows.filter(row => row.inFlight).map(row => row.ms)), assetRequests: flight.assetRequests },
    frames: distribution(flight.frames.map(frame => frame.ms)), over25ms: flight.frames.filter(frame => frame.ms > 25).length,
    over50ms: flight.frames.filter(frame => frame.ms > 50).length, terrainDraw: distribution(flightDraws.map(draw => draw.ms)), warmTerrainDraw: distribution(warmDraws.map(draw => draw.ms)),
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
      samplePeriodMs: 1000, samples: hardwareGpuSamples, meanPercent: gpuMean(hardwareGpuSamples),
      idleControl: { scene: 'menu', samples: idleHardwareGpuSamples, meanPercent: gpuMean(idleHardwareGpuSamples) } } : null,
    performance: flight.performance, hot, errors,
  };
  await page.screenshot({ path: `${out}/busy-flight.png` });
  await writeFile(`${out}/profile.json`, JSON.stringify(profile));
  await writeFile(`${out}/trace.json`, JSON.stringify(flight));
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(flight.startRafGate.before,flight.startRafGate.after,'OS start reads cannot advance simulation');
  for(const dimensions of [flight.initialDimensions,flight.finalDimensions]){
    assert(dimensions.visible,'Measured drawing surface must be visible');
    assert(dimensions.contextAttributes,'Active rendering context attributes must be captured');
    assert.equal(dimensions.width,dimensions.fallbackWidth,'Visible/fallback backing widths agree');
    assert.equal(dimensions.height,dimensions.fallbackHeight,'Visible/fallback backing heights agree');
    if(dimensions.id==='game-gpu-canvas')assert.equal(dimensions.contextType,'webgl2');
  }
  assert.ok(frameCount > 0 && flight.frames.length > 0, 'flight must render and collect frame samples');
  assert.equal(flight.finalScene, 'playing', 'timed flight must remain in active gameplay');
  assert.equal(result.measurement.processChurn.started.length + result.measurement.processChurn.exited.length, 0, 'Chrome processes must remain stable for comparable CPU totals');
  if (sampleHardwareGpu) {
    assert.ok(idleHardwareGpuSamples.length >= 3 && hardwareGpuSamples.length >= 20, 'hardware GPU comparison needs both idle and flight samples');
  }
  assert.ok(flight.chunkBoundaries >= 3, 'flight must cross at least three actual terrain chunk boundaries');
  assert.deepEqual(flight.assetRequests, [], 'sustained flight must use preloaded assets without network requests');
  assert.deepEqual(errors, [], 'sustained flight must run without browser errors');
} finally { clearInterval(cpuBucketTimer); await cpuBucketPending; clearInterval(hardwareGpuTimer); await hardwareGpuPending; await browser.close(); await nativeCpu?.close(); }
