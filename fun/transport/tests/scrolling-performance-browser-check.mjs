// Continuous camera movement across several scenery-cache boundaries. Measure
// without pixel readbacks; snapshots follow timing so Canvas keeps its normal
// rendering path. The optional baseline module supports repeatable comparisons.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { installBusyScenes } from './busy-scenes-fixture.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const out = process.env.TRANSPORT_OUTPUT || '/tmp/transport-scrolling-performance';
const source = process.env.TRANSPORT_RENDERER_SOURCE ? await readFile(process.env.TRANSPORT_RENDERER_SOURCE, 'utf8') : null;
const scenerySource = process.env.TRANSPORT_SCENERY_SOURCE ? await readFile(process.env.TRANSPORT_SCENERY_SOURCE, 'utf8') : null;
const dprs = (process.env.TRANSPORT_DPRS || '1,2').split(',').map(Number);
const scenes = (process.env.TRANSPORT_SCENES || 'forest,city,mixed').split(',');
const frames = Number(process.env.TRANSPORT_FRAMES || 120);
assert.ok(Number.isInteger(frames) && frames >= 60, 'exercise multiple scenery-cache boundaries');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const rows = [], errors = [];
try {
  for (const dpr of dprs) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 896 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    if (source) await page.route('**/renderer.js', route => route.fulfill({ contentType: 'application/javascript', body: source }));
    if (scenerySource) await page.route('**/scenery-batches.js', route => route.fulfill({ contentType: 'application/javascript', body: scenerySource }));
    await page.route('**/scrolling-performance-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{width:1280px;height:896px}</style><canvas></canvas>' }));
    await page.goto(new URL('scrolling-performance-qa', base).href);
    await page.evaluate(installBusyScenes);
    for (const scene of scenes) {
      const row = await page.evaluate(async ({ scene, frames }) => {
        const q = busyQA, metadata = q.select(scene, 1, 'day'), renderer = q.renderer;
        const nextFrame = () => new Promise(requestAnimationFrame);
        let settled = false;
        for (let frame = 0; frame < 300; frame++) {
          renderer.render(1000, { settle: true });
          await nextFrame();
          const stats = renderer.getStats();
          if (frame > 10 && !stats.sceneryBatches.pending && !stats.worldArtwork.loading && stats.houseArtwork.status !== 'loading') { settled = true; break; }
        }
        if (!settled) throw new Error(`${scene}: scenery or artwork did not settle`);
        await new Promise(resolve => setTimeout(resolve, 120));
        renderer.render(1000, { settle: true }); renderer.render(1000, { settle: true });
        const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
        const summarize = values => ({ medianMs: quantile(values, .5), p95Ms: quantile(values, .95), maxMs: Math.max(...values) });
        const counters = stats => ({ sceneBuilds: stats.sceneBuilds, composedChunks: stats.composedChunks, cacheBytes: stats.cacheBytes, cacheLimit: stats.cacheLimit, scenery: stats.sceneryBatches, visibleVehicles: stats.visibleVehicleCandidates });
        async function sample(pan, count) {
          const elapsed = [], intervals = [], borders = [], before = renderer.getStats();
          let previous = performance.now(), builds = before.sceneBuilds, maxSceneryBytes = 0, maxViewBytes = 0, settledAfterBoundary = 0;
          for (let frame = 0; frame < count; frame++) {
            await nextFrame();
            if (pan) renderer.pan(-4, 2);
            q.advance(frame);
            const start = performance.now();
            renderer.render(1000);
            const ms = performance.now() - start;
            elapsed.push(ms); intervals.push(start - previous); previous = start;
            const stats = renderer.getStats();
            maxSceneryBytes = Math.max(maxSceneryBytes, stats.sceneryBatches.bytes);
            maxViewBytes = Math.max(maxViewBytes, stats.sceneryBatches.viewBytes);
            if (stats.sceneBuilds !== builds) { borders.push({ frame, ms, builds: stats.sceneBuilds }); builds = stats.sceneBuilds; }
            if (stats.sceneBuilds > before.sceneBuilds && !stats.sceneryBatches.pending) settledAfterBoundary++;
          }
          const after = renderer.getStats();
          return { ...summarize(elapsed), intervals: summarize(intervals), over16Ms: elapsed.filter(ms => ms > 16.67).length, over33Ms: elapsed.filter(ms => ms > 33.33).length, sceneBuilds: after.sceneBuilds - before.sceneBuilds, composedChunks: after.composedChunks - before.composedChunks, maxSceneryBytes, maxViewBytes, settledAfterBoundary, reuses: (after.sceneryBatches.reuses || 0) - (before.sceneryBatches.reuses || 0), viewPanDraws: (after.sceneryBatches.viewPanDraws || 0) - (before.sceneryBatches.viewPanDraws || 0), borders, times: elapsed, before: counters(before), after: counters(after) };
        }
        const idle = await sample(false, 40), pan = await sample(true, frames), releasedAt = performance.now();
        let releaseFrames = 0, released;
        for (; releaseFrames < 300; releaseFrames++) {
          renderer.render(1000, { settle: true });
          released = renderer.getStats();
          if (!released.sceneryBatches.pending && !released.worldArtwork.loading && released.houseArtwork.status !== 'loading') break;
          await nextFrame();
        }
        if (releaseFrames === 300) throw new Error(`${scene}: scenery did not finish preparing after the camera stopped`);
        return { ...metadata, dpr: devicePixelRatio, idle, pan, release: { frames: releaseFrames + 1, elapsedMs: performance.now() - releasedAt, after: counters(released) } };
      }, { scene, frames });
      assert.equal(row.idle.composedChunks, 0, `${scene}: stationary terrain stays resident`);
      assert.ok(row.pan.maxSceneryBytes <= row.pan.after.scenery.limit, `${scene}: scenery memory stays bounded during panning`);
      assert.ok(row.pan.maxViewBytes <= row.pan.after.scenery.viewLimit, `${scene}: viewport memory stays bounded during panning`);
      assert.ok(row.pan.after.cacheBytes <= row.pan.after.cacheLimit, `${scene}: terrain memory stays bounded`);
      assert.equal(row.release.after.scenery.pending, 0, `${scene}: scenery finishes preparing after camera release`);
      assert.ok(row.release.after.scenery.bytes <= row.release.after.scenery.limit, `${scene}: released scenery stays bounded`);
      if (!source || process.env.TRANSPORT_EXPECT_SCROLL_REUSE === '1') {
        assert.ok(row.pan.reuses > 0, `${scene}: camera boundaries retain prepared scenery`);
        if (scene === 'forest' || scene === 'city') {
          assert.ok(row.pan.settledAfterBoundary > 0, `${scene}: preparation catches up while the camera keeps moving`);
          assert.ok(row.pan.viewPanDraws > 0, `${scene}: static viewport replays during a pan`);
        } else if (scene === 'mixed') {
          assert.equal(row.pan.after.scenery.draws, 0, 'traffic pan draws scenery in the original depth order');
          assert.equal(row.pan.after.scenery.preparationMs, 0, 'traffic pan does not add preparation work');
          assert.equal(row.pan.viewPanDraws, 0, 'ground traffic bypasses static viewport replay');
        }
      }
      rows.push(row);
      console.log(JSON.stringify({ scene, dpr, idleMedianMs: row.idle.medianMs, panMedianMs: row.pan.medianMs, panP95Ms: row.pan.p95Ms, intervalMedianMs: row.pan.intervals.medianMs, sceneBuilds: row.pan.sceneBuilds, draws: row.pan.after.scenery.draws, directDraws: row.pan.after.scenery.directDraws, pending: row.pan.after.scenery.pending, reuses: row.pan.reuses, viewPanDraws: row.pan.viewPanDraws, settledAfterBoundary: row.pan.settledAfterBoundary, releaseFrames: row.release.frames, releaseMs: row.release.elapsedMs, maxSceneryMiB: row.pan.maxSceneryBytes / 2 ** 20 }));
      await writeFile(`${out}/results.json`, JSON.stringify({ base, source: process.env.TRANSPORT_RENDERER_SOURCE || 'current', scenerySource: process.env.TRANSPORT_SCENERY_SOURCE || 'current', frames, rows, errors }, null, 2));
      await page.locator('canvas').screenshot({ path: `${out}/${scene}-dpr${dpr}.png` });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
