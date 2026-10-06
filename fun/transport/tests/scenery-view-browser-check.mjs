// Paired current renderers isolate viewport replay from terrain/art changes.
// All worlds, late artwork and canvases belong to this page; no saves are read.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { installBusyScenes } from './busy-scenes-fixture.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const out = process.env.TRANSPORT_OUTPUT || '/tmp/transport-scenery-view';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const rows = [], errors = [];

try {
  for (const dpr of (process.env.TRANSPORT_DPRS || '1,1.25,2').split(',').map(Number)) {
    // Even physical centers at every tested DPR keep centered zoom origins exact.
    const page = await browser.newPage({ viewport: { width: 1280, height: 896 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/scenery-view-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas.world{width:1280px;height:896px;position:absolute;left:0;top:0}</style><canvas id="cached" class="world"></canvas><canvas id="uncached" class="world"></canvas>' }));
    await page.goto(new URL('scenery-view-qa', base).href);
    await page.evaluate(installBusyScenes);
    await page.evaluate(async () => {
      const [{ createRenderer }, geometry, journal, art] = await Promise.all([import('./renderer.js'), import('./terrain-geometry.js'), import('./change-journal.js'), import('./atlas-runtime.js')]);
      const fixture = busyQA.select('forest', 1, 'day'), cached = busyQA.renderer;
      const canvases = [document.querySelector('#cached'), document.querySelector('#uncached')];
      const uncached = createRenderer(canvases[1], busyQA.game, { sceneryViewCaching: false, layers: cached.getLayers() });
      const renderers = [cached, uncached], readbacks = canvases.map(() => document.createElement('canvas'));
      const readers = readbacks.map(canvas => canvas.getContext('2d', { willReadFrequently: true }));
      let game = busyQA.game, point = fixture.point;
      const stages = [], transitions = [];
      const must = (condition, message) => { if (!condition) throw new Error(message); };
      const stats = () => renderers.map(renderer => renderer.getStats().sceneryBatches);
      const pair = () => { for (const renderer of renderers) renderer.render(1000, { settle: true }); };
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const bounded = () => {
        const [a, b] = stats();
        must(a.viewLimit === 32 * 1024 * 1024, 'viewport budget is 32 MiB');
        must(a.viewBytes <= a.viewLimit && a.bytes <= a.limit, 'cached surfaces stay inside both budgets');
        must(b.viewBytes === 0 && b.viewBuilds === 0 && b.viewDraws === 0, 'disabled renderer never creates or replays a viewport');
      };
      async function settle(expectView = true) {
        for (let frame = 0; frame < 240; frame++) {
          pair(); bounded();
          const current = stats();
          if (current.every(s => !s.pending && !s.waitingForCamera)) {
            pair(); pair(); bounded();
            if (!expectView || stats()[0].viewBytes > 0) return frame + 3;
          }
          await new Promise(requestAnimationFrame);
        }
        throw new Error('scenery did not settle in 240 frames');
      }
      function pixels(index) {
        const source = canvases[index], copy = readbacks[index], context = readers[index];
        if (copy.width !== source.width) copy.width = source.width;
        if (copy.height !== source.height) copy.height = source.height;
        context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, copy.width, copy.height);
        context.drawImage(source, 0, 0);
        return context.getImageData(0, 0, copy.width, copy.height).data;
      }
      function pickPair(x, y, tag, mismatches) {
        for (const method of ['screenToTile', 'screenToInspectTile']) {
          const picked = renderers.map((renderer, i) => { const rect = canvases[i].getBoundingClientRect(); return renderer[method](rect.left + x, rect.top + y); });
          if (picked[0].x !== picked[1].x || picked[0].y !== picked[1].y) mismatches.push({ tag, method, x, y, cached: picked[0], uncached: picked[1] });
        }
      }
      function compare(stage) {
        bounded();
        must(canvases[0].width === canvases[1].width && canvases[0].height === canvases[1].height, `${stage}: backing sizes differ`);
        const aa = pixels(0), bb = pixels(1), mismatches = [], worst = [];
        let max = 0, total = 0, changed = 0;
        for (let i = 0; i < aa.length; i++) {
          const delta = Math.abs(aa[i] - bb[i]); max = Math.max(max, delta); total += delta;
          if (delta) changed++;
          if (delta > 4 && worst.length < 6) worst.push({ x: Math.floor(i / 4) % canvases[0].width, y: Math.floor(i / (4 * canvases[0].width)), channel: i % 4, cached: aa[i], uncached: bb[i] });
        }
        const rect = canvases[0].getBoundingClientRect();
        for (let y = 33; y < rect.height; y += 113) for (let x = 29; x < rect.width; x += 137) pickPair(x, y, 'screen-grid', mismatches);
        for (let dy = -9; dy <= 9; dy += 3) for (let dx = -9; dx <= 9; dx += 3) {
          const p = cached.worldToScreen(point.x + dx, point.y + dy);
          for (const lift of [0, 12, 28]) if (p.x >= 0 && p.x < rect.width && p.y - lift >= 0 && p.y - lift < rect.height) pickPair(p.x, p.y - lift, 'parcel-and-upright', mismatches);
        }
        const row = { stage, max, mean: total / aa.length, changed, pixels: aa.length / 4, picks: mismatches, worst, stats: stats() };
        must(max <= 4, `${stage}: viewport pixels differ ${JSON.stringify(row)}`);
        must(row.mean <= .1, `${stage}: mean channel difference is ${row.mean}`);
        must(!mismatches.length, `${stage}: picking differs ${JSON.stringify(mismatches.slice(0, 8))}`);
        stages.push(row); return row;
      }
      async function warm(stage, expectCached = true) {
        const entered = stats()[0];
        await settle(expectCached);
        const before = stats()[0], elapsed = [[], []];
        for (let n = 0; n < 8; n++) {
          await new Promise(requestAnimationFrame);
          for (let i = 0; i < renderers.length; i++) { const start = performance.now(); renderers[i].render(1000, { settle: true }); elapsed[i].push(performance.now() - start); }
        }
        const after = stats()[0];
        must(after.viewBuilds === before.viewBuilds, `${stage}: unchanged frames rebuild the viewport`);
        if (expectCached) {
          must(after.viewBytes > 0 && after.viewDraws >= before.viewDraws + 8, `${stage}: unchanged dense frames must replay the viewport`);
          must(after.viewSourceDraws >= after.viewMinimumDraws, `${stage}: cached source meets its draw threshold`);
        } else {
          must(after.viewBytes === 0 && after.viewBuilds === entered.viewBuilds && after.viewDraws === entered.viewDraws, `${stage}: sparse scenery must never build or replay a viewport`);
          const reference = stats()[1];
          must(reference.draws + reference.directDraws < reference.viewMinimumDraws, `${stage}: uncached sparse fixture stays below its draw threshold`);
        }
        const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
        const row = compare(stage); row.expectCached = expectCached; row.timing = { cachedMedianMs: median(elapsed[0]), uncachedMedianMs: median(elapsed[1]) };
      }
      function setWorld(next, at = point) {
        game = next; point = at;
        for (const renderer of renderers) { renderer.setGame(game); renderer.setZoom(1); renderer.focus(point.x, point.y); }
        must(stats()[0].viewBytes === 0, 'setGame releases the viewport immediately');
      }
      function layers(partial) { for (const renderer of renderers) renderer.setLayers(partial); }
      for (const renderer of renderers) { renderer.setZoom(1); renderer.focus(point.x, point.y); }
      window.sceneryViewQA = { renderers, canvases, geometry, journal, art, stages, transitions, pair, pause, stats, bounded, settle, compare, warm, setWorld, layers, must, pixels, get game() { return game; }, get point() { return point; } };
    });

    await page.evaluate(async () => {
      const q = sceneryViewQA, [cached] = q.renderers;
      await q.warm('forest-warm');
      // A camera movement uses direct scenery immediately and only bakes again after settling.
      let before = q.stats()[0];
      for (const renderer of q.renderers) renderer.pan(-8, 4);
      q.pair();
      q.must(q.stats()[0].viewBuilds === before.viewBuilds && q.stats()[0].viewDraws === before.viewDraws, 'panning bypasses viewport replay');
      q.compare('pan-first'); await q.warm('pan-settled');
      q.must(q.stats()[0].viewBuilds > before.viewBuilds, 'a changed camera rebuilds its viewport');
      for (const renderer of q.renderers) renderer.pan(8, -4);
      await q.warm('pan-return');
      // Centered zoom leaves the projected origin unchanged; scene keys still must invalidate.
      const camera = cached.getCamera(); before = q.stats()[0];
      for (const renderer of q.renderers) renderer.setZoom(2);
      q.must(cached.getCamera().x === camera.x && cached.getCamera().y === camera.y, 'zoom fixture preserves the camera origin');
      q.pair();
      q.must(q.stats()[0].viewBuilds === before.viewBuilds && q.stats()[0].viewDraws === before.viewDraws, 'new zoom cannot capture the previous scene readiness');
      await q.warm('centered-zoom');
      q.must(q.stats()[0].viewBuilds > before.viewBuilds, 'zoom key rebuilds the viewport');
      for (const renderer of q.renderers) renderer.setZoom(1);
      await q.warm('zoom-return');
      before = q.stats()[0];
      for (let i = 0; i < q.canvases.length; i++) { q.canvases[i].style.width = '1152px'; q.canvases[i].style.height = '800px'; q.renderers[i].resize(); }
      q.pair();
      q.must(q.stats()[0].viewBuilds === before.viewBuilds && q.stats()[0].viewDraws === before.viewDraws, 'resize cannot capture the previous scene readiness');
      await q.warm('resize');
      q.must(q.stats()[0].viewBuilds > before.viewBuilds, 'resized viewport rebuilds');
      q.layers({ trees: false });
      q.must(q.stats()[0].viewBytes === 0, 'baked layer change releases viewport');
      await q.warm('trees-hidden', false); q.layers({ trees: true }); await q.warm('trees-restored');
      // Surface journals patch the same scene instead of replacing it.
      before = q.stats()[0]; const sceneBuilds = cached.getStats().sceneBuilds, scenePatches = cached.getStats().scenePatches;
      const index = 128 * q.game.width + 128, from = q.game.revision;
      q.game.tiles[index] = { ...q.game.tiles[index], terrain: 'grass', detail: '', cleared: true };
      q.game.revision++; q.journal.noteSurfaceChanges(q.game, from, q.game.revision, [index]);
      q.pair();
      q.must(q.stats()[0].viewDraws === before.viewDraws, 'journaled patch bypasses cached replay');
      q.must(cached.getStats().sceneBuilds === sceneBuilds && cached.getStats().scenePatches > scenePatches, 'journal fixture uses scene patching');
      await q.warm('journaled-edit');
      q.must(q.stats()[0].viewBuilds > before.viewBuilds, 'journaled edit rebuilds the viewport');
      // Ground traffic can enter without a simulation revision and must still clear the static replay.
      before = q.stats()[0];
      q.game.routes = [{ id: 'boundary-bus', mode: 'road', cargo: 'passengers', color: '#be955e', active: true, path: [{ x: 126, y: 128 }, { x: 129, y: 128 }], stops: [] }];
      q.game.vehicles = [{ id: 'boundary-bus-1', routeId: 'boundary-bus', x: 128, y: 128, angle: 0, load: 20, capacity: 40, vehicleKind: 'bus', level: 1 }];
      q.pair();
      q.must(q.stats()[0].viewBytes === 0 && q.stats()[0].viewBuilds === before.viewBuilds && q.stats()[0].viewDraws === before.viewDraws, 'ground traffic releases and bypasses viewport');
      await q.settle(false); q.compare('ground-traffic-entry');
      q.game.vehicles[0].x += .2; q.pair(); q.compare('ground-traffic-motion');
      q.must(q.stats()[0].viewBuilds === before.viewBuilds && q.stats()[0].viewDraws === before.viewDraws, 'moving bus never enters static viewport');
      q.game.vehicles = []; q.game.routes = [];
      await q.warm('ground-traffic-exit');
      q.must(q.stats()[0].viewBuilds > before.viewBuilds, 'viewport caching resumes after traffic leaves');
      const city = busyQA.select('city', 1, 'day');
      q.setWorld(busyQA.game, city.point); await q.warm('new-city-world');
      before = q.stats()[0]; q.layers({ names: false }); await q.warm('names-hidden');
      q.must(q.stats()[0].viewBuilds > before.viewBuilds, 'non-baked layer identity invalidates viewport');
      q.layers({ names: true }); await q.warm('names-restored');
    });

    await page.evaluate(async () => {
      const q = sceneryViewQA;
      await Promise.all([q.art.preloadWorldArt({ biome: 'tundra', waitMs: 20000 }), import('./raster-houses.js').then(({ preloadHouses }) => preloadHouses({ biome: 'tundra', waitMs: 20000 }))]);
      const original = q.game;
      const next = { ...original, biome: 'tundra', seed: 919, width: 256, height: 256, tiles: Array.from({ length: 256 * 256 }, (_, i) => ({ terrain: 'forest', detail: 'pine', elevation: 4 / 7, variant: i % 64 })), cities: [], industries: [], stations: [], routes: [], vehicles: [], zones: [], revision: 1, networkRevision: 1 };
      q.setWorld(next, { x: 128, y: 128 }); await q.warm('new-biome-world');
      // The viewport stores bridge picking records even though bridge decks remain direct scenery entries.
      const bridge = { ...next, tiles: next.tiles.map(() => ({ terrain: 'grass', elevation: 0, detail: '', variant: 0 })), revision: 2 };
      // Twenty-five direct decks stay below the 32-draw floor at the resized viewport.
      for (let x = 116; x <= 140; x++) Object.assign(bridge.tiles[128 * 256 + x], { road: true, bridge: true, structureAxis: 'x', structureLevel: 13 });
      q.setWorld(bridge); await q.warm('sparse-bridge', false);
      q.layers({ roads: false }); await q.warm('sparse-bridge-hidden', false);
      q.layers({ roads: true }); await q.warm('sparse-bridge-restored', false);
      // Forest around the same decks exercises picking records through actual cached replay.
      const denseBridge = { ...bridge, tiles: bridge.tiles.map((tile, i) => tile.bridge ? { ...tile } : { ...tile, terrain: 'forest', detail: 'pine', variant: i % 64 }), revision: 3 };
      q.setWorld(denseBridge); await q.warm('dense-bridge-cached');
      const samples = [];
      for (const offset of [-.3, 0, .3]) {
        const x = 128 + offset, y = 128, height = q.geometry.bridgeDeckHeight(denseBridge, x, y, 'road'), screen = q.renderers[0].worldToScreen(x, y);
        screen.y += (q.geometry.surfaceHeight(denseBridge, x + .5, y + .5) - height) * q.geometry.HEIGHT_STEP;
        const shown = q.renderers.map((renderer, i) => { const rect = q.canvases[i].getBoundingClientRect(); return renderer.screenToTile(rect.left + screen.x, rect.top + screen.y); });
        q.must(shown.every(p => p.x === 128 && p.y === 128), 'cached and direct bridge deck picking agree');
        samples.push({ screen, shown });
      }
      q.layers({ roads: false }); await q.warm('dense-bridge-hidden');
      for (const sample of samples) {
        const hidden = q.renderers.map((renderer, i) => { const rect = q.canvases[i].getBoundingClientRect(); return renderer.screenToTile(rect.left + sample.screen.x, rect.top + sample.screen.y); });
        q.must(hidden[0].x === hidden[1].x && hidden[0].y === hidden[1].y, 'hidden bridge picks agree');
        q.must(hidden[0].x !== 128 || hidden[0].y !== 128, 'hiding the bridge releases its elevated picking record'); sample.hidden = hidden;
      }
      q.layers({ roads: true }); await q.warm('dense-bridge-restored'); q.transitions.push({ bridgeSamples: samples });
    });

    // Hold one real atlas request while the absent stop is captured. Arrival
    // publishes the normal world-art revision and introduces visible new ink.
    const atlasPng = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const c = canvas.getContext('2d'); c.fillStyle = '#fa23bd'; c.fillRect(1, 1, 14, 14); c.fillStyle = '#203b40'; c.fillRect(6, 2, 4, 12); return canvas.toDataURL().split(',')[1]; });
    let atlasRequests = 0, releaseAtlas;
    const arrival = new Promise(resolve => { releaseAtlas = resolve; });
    await page.route('**/scenery-view-late-16.png', async route => { atlasRequests++; await arrival; await route.fulfill({ contentType: 'image/png', body: Buffer.from(atlasPng, 'base64') }); });
    await page.evaluate(async () => {
      const q = sceneryViewQA;
      q.art.registerAtlas({ id: 'scenery-view-late', path: './scenery-view-late', columns: 1, rows: 1, maxCell: 16, entries: ['isometric:bus-stop'] });
      const forest = { ...q.game, tiles: q.game.tiles.map((t, i) => ({ terrain: 'forest', elevation: 4 / 7, detail: 'pine', variant: i % 64 })), stations: [{ id: 'late-stop', x: 130, y: 128, mode: 'road', name: 'Late stop' }], revision: q.game.revision + 1 };
      q.setWorld(forest); await q.warm('atlas-awaiting');
      q.arrivalBefore = { revision: q.art.worldArtRevision(), stats: q.stats()[0], pixels: new Uint8ClampedArray(q.pixels(0)) };
    });
    assert.equal(atlasRequests, 1, 'absent visible atlas is requested once');
    releaseAtlas();
    await page.waitForFunction(() => sceneryViewQA.art.worldArtRevision() > sceneryViewQA.arrivalBefore.revision, null, { timeout: 20000 });
    await page.evaluate(async () => {
      const q = sceneryViewQA, before = q.arrivalBefore;
      q.pair(); q.must(q.stats()[0].viewBytes === 0 && q.stats()[0].viewDraws === before.stats.viewDraws, 'atlas publication releases cached fallback art');
      await q.warm('atlas-arrived');
      q.must(q.stats()[0].viewBuilds > before.stats.viewBuilds, 'arriving artwork rebuilds the viewport');
      const after = q.pixels(0); let changed = 0;
      for (let i = 0; i < after.length; i += 4) if (Math.abs(after[i] - before.pixels[i]) + Math.abs(after[i + 1] - before.pixels[i + 1]) + Math.abs(after[i + 2] - before.pixels[i + 2]) > 12) changed++;
      q.must(changed > 20, 'arriving stop art must introduce visible pixels');
      q.transitions.push({ atlasArrival: { beforeRevision: before.revision, afterRevision: q.art.worldArtRevision(), changedPixels: changed } });
      delete q.arrivalBefore;
    });

    await page.evaluate(async () => {
      const q = sceneryViewQA;
      const dense = { ...q.game, stations: [] };
      const tiny = { ...q.game, width: 32, height: 32, tiles: Array.from({ length: 32 * 32 }, () => ({ terrain: 'grass', elevation: 0, detail: '', variant: 0 })), cities: [], industries: [], stations: [], routes: [], vehicles: [], zones: [], revision: q.game.revision + 1, networkRevision: q.game.networkRevision + 1 };
      q.setWorld(tiny, { x: 16, y: 16 }); await q.warm('empty-grass', false);
      // A dense scene exceeds the draw minimum, so the memory cap is the sole reason to skip replay.
      q.setWorld({ ...dense, revision: tiny.revision + 1 }, { x: 128, y: 128 });
      for (let i = 0; i < q.canvases.length; i++) {
        q.canvases[i].style.width = `${3000 / devicePixelRatio}px`;
        q.canvases[i].style.height = `${3000 / devicePixelRatio}px`;
        q.renderers[i].resize();
        q.renderers[i].setZoom(2);
      }
      q.must(q.canvases.every(canvas => canvas.width === 3000 && canvas.height === 3000), 'oversized fixture has 3000×3000 physical pixels at every DPR');
      const before = q.stats()[0];
      q.must(q.canvases[0].width * q.canvases[0].height * 4 > before.viewLimit, 'oversized viewport exceeds the replay budget');
      await q.settle(false); q.pair(); q.pair(); q.bounded();
      const after = q.stats()[0], reference = q.stats()[1], picks = [];
      q.must(reference.draws + reference.directDraws >= reference.viewMinimumDraws, 'oversized dense reference qualifies for replay by draw cost');
      q.must(after.viewBytes === 0 && after.viewBuilds === before.viewBuilds && after.viewDraws === before.viewDraws, 'oversized viewport cannot build or replay a surface');
      const rect = q.canvases[0].getBoundingClientRect();
      for (const method of ['screenToTile', 'screenToInspectTile']) for (const [dx, dy] of [[-200, -200], [0, 0], [200, 200], [-100, 80], [80, -100]]) {
        const x = rect.width / 2 + dx, y = rect.height / 2 + dy;
        const result = q.renderers.map((renderer, i) => { const bounds = q.canvases[i].getBoundingClientRect(); return renderer[method](bounds.left + x, bounds.top + y); });
        q.must(result[0].x === result[1].x && result[0].y === result[1].y, 'oversized direct fallback preserves picking');
        picks.push({ method, x, y, picked: result[0] });
      }
      q.transitions.push({ overBudget: { width: 3000, height: 3000, stats: q.stats(), picks } });
      // Avoid two more 36 MiB readback canvases; the oversized branch is the ordinary paired painter.
      for (let i = 0; i < q.canvases.length; i++) { q.canvases[i].style.width = '1152px'; q.canvases[i].style.height = '800px'; q.renderers[i].resize(); }
      q.setWorld(tiny, { x: 16, y: 16 });
      await q.warm('empty-grass-below-budget', false);
      q.setWorld({ ...dense, revision: tiny.revision + 2 }, { x: 128, y: 128 });
      await q.warm('below-budget-resumed');
      q.must(q.stats()[0].viewBuilds > before.viewBuilds && q.stats()[0].viewBytes > 0, 'cache resumes after returning below its cap');
    });

    const result = await page.evaluate(() => ({ dpr: devicePixelRatio, stages: sceneryViewQA.stages, transitions: sceneryViewQA.transitions }));
    rows.push(result);
    console.log(JSON.stringify({ dpr, stages: result.stages.length, max: Math.max(...result.stages.map(stage => stage.max)), mean: Math.max(...result.stages.map(stage => stage.mean)), timing: result.stages.filter(stage => stage.timing).map(stage => ({ stage: stage.stage, ...stage.timing })) }));
    await page.close();
  }
  assert.deepEqual(errors, [], 'no browser errors');
  await writeFile(`${out}/results.json`, JSON.stringify({ rows, errors }, null, 2));
} finally { await browser.close(); }
