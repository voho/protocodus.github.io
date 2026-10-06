// Water and real-bank motion stays local, simulation-driven and inexpensive.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-water-shore-motion';
await mkdir(output, { recursive: true });
const errors = [], profiles = [], geometryProfiles = [], reliefProfiles = [], restoreProfiles = [];

try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/water-shore-motion-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1000px;height:720px}</style><canvas></canvas>' }));
    await page.goto(new URL('water-shore-motion-qa', base).href);
    await page.evaluate(async () => {
      const [{ createRenderer }, { shorelineContours, appendShoreline }, { bridgeDeckHeight }, art] = await Promise.all([import('./renderer.js'), import('./shoreline.js'), import('./terrain-geometry.js'), import('./atlas-runtime.js')]);
      await art.preloadWorldArt({ waitMs: 12000 });
      const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
      const layers = { trees: false, buildings: false, stations: false, names: false, industryIcons: false, zones: false, roads: true, rails: true, vehicles: false, vehicleLoads: false, routes: false, weather: false, grid: false };
      const gameFor = (biome, shape = 'lake', seed = 1847, raised = false) => {
        const water = (x, y) => {
          if (shape === 'open') return true;
          if (shape === 'lake') return ((x - 32) / 15) ** 2 + ((y - 32) / 11) ** 2 < 1;
          if (shape === 'stream') return Math.abs(x - (31 + Math.floor(Math.sin(y / 7) * 3))) <= 1;
          if (shape === 'coast') return x >= 29 + Math.floor(Math.sin(y / 8) * 3);
          if (shape === 'pond') return x === 32 && y === 32;
          if (shape === 'island') return !(x >= 30 && x <= 34 && y >= 30 && y <= 34);
          if (shape === 'diagonal') return (x === 32 && y === 32) || (x === 33 && y === 33);
          throw new Error('Unknown water fixture: ' + shape);
        };
        const game = { width: 64, height: 64, day: 2.25, revision: 1, networkRevision: 1, biome, seed, cities: [], industries: [], stations: [], routes: [], vehicles: [], zones: [] };
        game.tiles = Array.from({ length: 4096 }, (_, id) => {
          const x = id % 64, y = Math.floor(id / 64), wet = water(x, y);
          return { terrain: wet ? 'water' : biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass', elevation: wet ? 0 : raised ? Math.min(4, 1 + (x + y) % 4) / 7 : 0, detail: wet && shape === 'stream' ? 'river' : '', variant: id % 16, building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false, publicRoad: false };
        });
        // A genuine raised crossing checks opaque deck paint independently of
        // the transparent edges through which moving water should remain visible.
        if (shape === 'stream') for (let x = 21; x <= 43; x++) {
          const t = game.tiles[34 * 64 + x]; t.road = true;
          if (t.terrain === 'water') Object.assign(t, { bridge: true, structureAxis: 'x', structureLevel: raised ? 3 : 1 });
        }
        return game;
      };
      const renderer = createRenderer(canvas, gameFor('taiga'), { layers });
      const capture = () => context.getImageData(0, 0, canvas.width, canvas.height).data;
      const difference = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      const compare = (a, b) => { let changed = 0, max = 0, overFour = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) changed++; if (d > 4) overFour++; max = Math.max(max, d); } return { changed, max, overFour }; };
      const maskFor = game => {
        const image = document.createElement('canvas'); image.width = canvas.width; image.height = canvas.height;
        const c = image.getContext('2d'), smooth = new Path2D(), cells = new Path2D(), contours = shorelineContours(game, { x0: 0, y0: 0, x1: game.width, y1: game.height });
        appendShoreline(smooth, contours);
        let anchor = null;
        for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) if (game.tiles[y * game.width + x].terrain === 'water') { cells.rect(x * 32, y * 32, 32, 32); anchor ||= { x, y }; }
        const zoom = renderer.getCamera().zoom, d = devicePixelRatio, p = renderer.gridPointToScreen(anchor.x, anchor.y);
        const transform = { a: zoom * d, b: zoom * d / 2, c: -zoom * d, d: zoom * d / 2, e: (p.x - (anchor.x - anchor.y) * 32 * zoom) * d, f: (p.y - (anchor.x + anchor.y) * 16 * zoom) * d };
        c.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f); c.clip(smooth, 'evenodd'); c.clip(cells); c.fillStyle = '#fff'; c.fillRect(0, 0, game.width * 32, game.height * 32);
        const pixels = c.getImageData(0, 0, image.width, image.height).data;
        // Distance to actual quadratic banks, rather than nominal square tile
        // edges, classifies changed pixels as shore or open water.
        const banks = [];
        for (const points of contours) for (let i = 0; i < points.length; i++) {
          const p = points[i], prev = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length], a = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2], b = [(next[0] + p[0]) / 2, (next[1] + p[1]) / 2];
          for (let k = 0; k <= 4; k++) { const t = k / 4, u = 1 - t; banks.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]); }
        }
        return { pixels, transform, banks };
      };
      const measure = (game, first, after) => {
        const { pixels: mask, transform: m, banks } = maskFor(game), determinant = m.a * m.d - m.b * m.c;
        let changedPixels = 0, waterPixels = 0, outsidePixels = 0, nominalLandPixels = 0, shorePixels = 0, openPixels = 0, strongest = 0, strongestChannel = 0, contrastTotal = 0;
        const samples = [];
        for (let i = 0; i < first.length; i += 4) {
          if (mask[i + 3] > 0) waterPixels++;
          const contrast = difference(first, after, i); if (contrast <= 4) continue;
          changedPixels++; contrastTotal += contrast; strongest = Math.max(strongest, contrast);
          strongestChannel = Math.max(strongestChannel, Math.abs(first[i] - after[i]), Math.abs(first[i + 1] - after[i + 1]), Math.abs(first[i + 2] - after[i + 2]));
          const index = i / 4, sx = index % canvas.width + .5 - m.e, sy = Math.floor(index / canvas.width) + .5 - m.f, wx = (m.d * sx - m.c * sy) / determinant, wy = (-m.b * sx + m.a * sy) / determinant;
          let near = Infinity; for (const p of banks) { const distance = Math.hypot(wx - p[0], wy - p[1]); if (distance < near) near = distance; if (near < 2) break; }
          if (near <= 9) shorePixels++; else openPixels++;
          if (game.tiles[Math.floor(wy / 32) * game.width + Math.floor(wx / 32)]?.terrain !== 'water') nominalLandPixels++;
          // Dry pixels are exact: a renderer-side bank guard must prevent
          // antialiasing from moving ink onto the land side of either clip.
          if (mask[i + 3] === 0) {
            outsidePixels++; if (samples.length < 4) samples.push({ x: wx / 32, y: wy / 32, contrast });
          }
        }
        return { changedPixels, waterPixels, outsidePixels, nominalLandPixels, shorePixels, openPixels, strongest, strongestChannel, meanContrast: contrastTotal / Math.max(1, changedPixels), fraction: changedPixels / Math.max(1, waterPixels), samples };
      };
      const setup = (biome, shape, zoom, step = 24, raised = false, seed = 1847) => {
        const game = gameFor(biome, shape, seed, raised); renderer.setGame(game); renderer.setZoom(zoom); renderer.setTerrainHeight(step); renderer.focus(shape === 'lake' ? 40 : 32, shape === 'lake' ? 33 : 32); renderer.setPresentation(null, 2.25);
        renderer.render(0, { settle: true }); renderer.render(100, { settle: true }); return game;
      };
      window.waterMotionQA = { renderer, canvas, gameFor, capture, compare, measure, setup, bridgeDeckHeight };
    });

    for (const biome of ['taiga', 'tundra', 'desert']) for (const zoom of [.5, 1, 2]) {
      const result = await page.evaluate(({ biome, zoom, dpr }) => {
        const q = waterMotionQA, game = q.setup(biome, 'lake', zoom), immutable = JSON.stringify(game), first = q.capture(), warm = q.renderer.getStats();
        q.renderer.render(40000, { settle: true }); const paused = q.compare(first, q.capture());
        q.renderer.setPresentation(null, 3.25); q.renderer.render(40100, { settle: true }); const measured = q.measure(game, first, q.capture()), after = q.renderer.getStats();
        return { biome, zoom, dpr, paused, ...measured, chunkRebuilds: after.composedChunks - warm.composedChunks, motionRebuilds: after.waterMotion.builds - warm.waterMotion.builds, sceneRebuilds: after.sceneBuilds - warm.sceneBuilds, geometry: after.waterMotion, unchanged: JSON.stringify(game) === immutable };
      }, { biome, zoom, dpr });
      profiles.push(result);
      assert.equal(result.paused.changed, 0, 'wall-clock time cannot move a paused surface');
      assert.equal(result.chunkRebuilds, 0); assert.equal(result.motionRebuilds, 0); assert.equal(result.sceneRebuilds, 0);
      assert.ok(result.changedPixels > 15 && result.shorePixels > 0 && result.openPixels > 0, JSON.stringify(result));
      assert.equal(result.outsidePixels, 0, 'animated marks remain inside the actual water clip');
      assert.equal(result.nominalLandPixels, 0, 'antialiased motion leaves every nominal land pixel still');
      assert.ok(result.strongestChannel < 65 && result.meanContrast < 65 && result.fraction < .12, 'motion stays quiet and local');
      assert.equal(result.unchanged, true);
      if (dpr === 1) await page.locator('canvas').screenshot({ path: `${output}/${biome}-${zoom}.png` });
    }

    for (const shape of ['open', 'stream', 'coast', 'pond', 'island', 'diagonal']) for (const zoom of [.5, 1, 2]) {
      const result = await page.evaluate(({ shape, zoom, dpr }) => {
        const q = waterMotionQA, game = q.setup('taiga', shape, zoom), first = q.capture();
        q.renderer.setPresentation(null, 4.25); q.renderer.render(500, { settle: true }); const measured = q.measure(game, first, q.capture());
        return { shape, zoom, dpr, ...measured, geometry: q.renderer.getStats().waterMotion };
      }, { shape, zoom, dpr });
      geometryProfiles.push(result); assert.equal(result.outsidePixels, 0, JSON.stringify(result));
      assert.equal(result.nominalLandPixels, 0, JSON.stringify(result));
      assert.ok(result.changedPixels > 0, `${shape}, ${zoom} zoom and ${dpr} DPR has gentle visible motion`);
      if (shape === 'open') assert.equal(result.geometry.shoreSegments, 0, 'open sea creates no artificial bank at a cached chunk boundary');
      else assert.ok(result.shorePixels > 0, JSON.stringify(result));
      if (dpr === 1 && zoom === 1) await page.locator('canvas').screenshot({ path: `${output}/${shape}.png` });
    }

    for (const step of [0, 12, 24, 28]) for (const zoom of [.5, 1, 2]) {
      const result = await page.evaluate(({ step, zoom, dpr }) => {
        const q = waterMotionQA, game = q.setup('desert', 'stream', zoom, step, true), immutable = JSON.stringify(game), first = q.capture(), warm = q.renderer.getStats();
        q.renderer.setPresentation(null, 4.25); q.renderer.render(500, { settle: true }); const after = q.capture(), measured = q.measure(game, first, after), deck = [];
        for (let x = 21; x <= 43; x++) if (game.tiles[34 * 64 + x].terrain === 'water') {
          const p = q.renderer.worldToScreen(x, 34); p.y -= q.bridgeDeckHeight(game, x, 34) * step * zoom;
          let strongest = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const px = Math.round(p.x * dpr) + dx, py = Math.round(p.y * dpr) + dy; if (px >= 0 && px < q.canvas.width && py >= 0 && py < q.canvas.height) { const i = (py * q.canvas.width + px) * 4; strongest = Math.max(strongest, Math.abs(first[i] - after[i]), Math.abs(first[i + 1] - after[i + 1]), Math.abs(first[i + 2] - after[i + 2])); } }
          deck.push({ x, max: strongest });
        }
        const final = q.renderer.getStats(); return { step, zoom, dpr, ...measured, deck, chunkRebuilds: final.composedChunks - warm.composedChunks, motionRebuilds: final.waterMotion.builds - warm.waterMotion.builds, unchanged: JSON.stringify(game) === immutable };
      }, { step, zoom, dpr });
      reliefProfiles.push(result); assert.equal(result.outsidePixels, 0, JSON.stringify(result));
      assert.equal(result.nominalLandPixels, 0, JSON.stringify(result));
      assert.ok(result.changedPixels > 0); assert.ok(result.deck.length > 0 && result.deck.every(sample => sample.max === 0), 'water animation never repaints opaque bridge decks: ' + JSON.stringify(result));
      assert.equal(result.chunkRebuilds, 0); assert.equal(result.motionRebuilds, 0); assert.equal(result.unchanged, true);
    }

    const restore = await page.evaluate(dpr => {
      const q = waterMotionQA, game = q.setup('tundra', 'lake', 1), immutable = JSON.stringify(game), baseline = q.capture(), initial = q.renderer.getStats();
      q.renderer.pan(80, -32); q.renderer.render(300, { settle: true }); const shifted = q.capture();
      let panMax = 0, panChanges = 0;
      for (let y = 32 * dpr; y < q.canvas.height - 32 * dpr; y++) for (let x = 80 * dpr; x < q.canvas.width - 80 * dpr; x++) {
        const a = (y * q.canvas.width + x) * 4, b = ((y - 32 * dpr) * q.canvas.width + x + 80 * dpr) * 4;
        for (let channel = 0; channel < 3; channel++) { const delta = Math.abs(baseline[a + channel] - shifted[b + channel]); panMax = Math.max(panMax, delta); if (delta > 4) panChanges++; }
      }
      q.renderer.pan(-80, 32); q.renderer.render(600, { settle: true }); const panRestore = q.compare(baseline, q.capture());
      q.renderer.setZoom(2); q.renderer.render(700, { settle: true }); q.renderer.setZoom(.5); q.renderer.render(800, { settle: true }); q.renderer.setZoom(1); q.renderer.focus(40, 33); q.renderer.render(900, { settle: true }); const zoomRestore = q.compare(baseline, q.capture());
      q.renderer.setLayers({ trees: true, buildings: true }); q.renderer.render(1000, { settle: true }); q.renderer.setLayers({ trees: false, buildings: false }); q.renderer.render(1100, { settle: true }); const layerRestore = q.compare(baseline, q.capture());
      q.renderer.render(1200, { settle: true }); const warm = q.renderer.getStats(); q.renderer.setPresentation(null, 3.5); q.renderer.render(1300, { settle: true }); const advanced = q.renderer.getStats();
      return { dpr, panMax, panChanges, panRestore, zoomRestore, layerRestore, initialMotion: initial.waterMotion, warmChunks: advanced.composedChunks - warm.composedChunks, warmMotion: advanced.waterMotion.builds - warm.waterMotion.builds, unchanged: JSON.stringify(game) === immutable };
    }, dpr);
    restoreProfiles.push(restore); assert.equal(restore.panChanges, 0, 'camera overlap preserves the world-anchored animation phase');
    for (const result of [restore.panRestore, restore.zoomRestore, restore.layerRestore]) assert.equal(result.overFour, 0, 'restoring view and layers restores the same simulation frame');
    assert.equal(restore.warmChunks, 0); assert.equal(restore.warmMotion, 0); assert.equal(restore.unchanged, true);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.evaluate(dpr => { const q = waterMotionQA, game = q.setup('taiga', 'coast', 1), immutable = JSON.stringify(game), first = q.capture(); q.renderer.setPresentation(null, 17.75); q.renderer.render(10000, { settle: true }); return { dpr, ...q.compare(first, q.capture()), stats: q.renderer.getStats().waterMotion, unchanged: JSON.stringify(game) === immutable }; }, dpr);
    assert.equal(reduced.changed, 0, 'reduced motion keeps ambient water and foam still'); assert.equal(reduced.stats.reducedMotion, true); assert.equal(reduced.unchanged, true);
    restoreProfiles.push({ reducedMotion: reduced });
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    if (dpr === 1) {
      const frames = await page.evaluate(() => { const q = waterMotionQA; q.setup('taiga', 'coast', 1); return Array.from({ length: 12 }, (_, i) => { q.renderer.setPresentation(null, 2.25 + i * .4); q.renderer.render(i * 400, { settle: true }); return q.canvas.toDataURL('image/png').split(',')[1]; }); });
      for (let i = 0; i < frames.length; i++) await writeFile(`${output}/motion-${String(i).padStart(2, '0')}.png`, Buffer.from(frames[i], 'base64'));
      await writeFile(`${output}/preview.html`, `<!doctype html><meta charset="utf-8"><title>Gentle water and shore motion</title><style>body{margin:0;background:#202d2f;color:#e6eadc;font:16px system-ui;display:grid;place-items:center}img{max-width:100%;height:auto}p{margin:12px}</style><p>Recorded game frames: slow glints and broken foam along the waterline. Click to pause.</p><img id="frame" src="motion-00.png" alt="Animated isometric shore"><script>const image=document.querySelector('img');let frame=0,paused=false;image.onclick=()=>paused=!paused;setInterval(()=>{if(!paused)image.src='motion-'+String(frame=(frame+1)%12).padStart(2,'0')+'.png'},400)</script>`);
      const strip = await page.evaluate(async () => { const q = waterMotionQA, image = document.createElement('canvas'); image.width = 1500; image.height = 360; const c = image.getContext('2d'); for (let i = 0; i < 3; i++) { q.renderer.setPresentation(null, 2.25 + i * 2.2); q.renderer.render(i * 1000, { settle: true }); c.drawImage(q.canvas, i * 500, 0, 500, 360); } return image.toDataURL('image/png').split(',')[1]; });
      await writeFile(`${output}/filmstrip.png`, Buffer.from(strip, 'base64'));
    }
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  page.on('pageerror', error => errors.push(error.message)); await page.goto(base);
  await createWorldFromMenu(page, { biome: 'taiga', size: 'square512', seed: 1847, generationVersion: 7 });
  await page.evaluate(() => { transport.renderer.setLayers({ weather: false, names: false, industryIcons: false, buildings: false, trees: false, stations: false, routes: false, vehicles: false, grid: false }); transport.renderer.focus(480, 78); const original = transport.renderer.render; window.waterAppFrames = []; transport.renderer.render = function (...args) { const result = original.apply(this, args); waterAppFrames.push({ now: args[0], day: transport.game.day, presentationDay: this.getStats().presentationDay, commits: transport.simulation.getStats().commits, strokes: this.getStats().waterMotion.strokes }); return result; }; });
  await page.locator('[data-speed="1"]').click(); await page.waitForTimeout(3300);
  await page.locator('[data-speed="0"]').click(); await page.mouse.move(1180, 10); await page.waitForTimeout(300);
  const appBefore = await page.evaluate(() => { const c = document.querySelector('#world') || document.querySelector('canvas'); window.waterPausedImage = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; window.waterPausedDay = transport.renderer.getStats().presentationDay; return { frames: waterAppFrames, stats: transport.simulation.getStats() }; });
  await page.waitForTimeout(900);
  const appPaused = await page.evaluate(() => { const c = document.querySelector('#world') || document.querySelector('canvas'), after = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let changed = 0; for (let i = 0; i < after.length; i++) if (waterPausedImage[i] !== after[i]) changed++; return { changed, day: transport.renderer.getStats().presentationDay, before: waterPausedDay }; });
  assert.equal(appPaused.changed, 0, 'Pause freezes actual application water despite elapsed wall time'); assert.equal(appPaused.day, appPaused.before);
  const plateaus = new Map(); for (const frame of appBefore.frames) { const list = plateaus.get(frame.day) || []; list.push(frame); plateaus.set(frame.day, list); }
  assert.ok(appBefore.stats.commits >= 2 && appBefore.stats.commits <= 6, 'application world commits approximately once each second');
  assert.ok([...plateaus.values()].some(frames => frames.length > 5 && frames.at(-1).presentationDay > frames[0].presentationDay), 'water draws smooth presentation frames between world commits');
  assert.ok(appBefore.frames.some(frame => frame.strokes > 0));
  await page.locator('[data-speed="1"]').click(); await page.waitForTimeout(700);
  assert.ok(await page.evaluate(() => transport.renderer.getStats().presentationDay > waterPausedDay), 'Resume advances the same motion timeline');
  await page.locator('[data-speed="0"]').click(); await page.screenshot({ path: `${output}/application.png` }); await page.close();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ profiles, geometryProfiles, reliefProfiles, restoreProfiles, appBefore, appPaused, errors }, null, 2));
  console.log(`Water and shore motion: ${profiles.length} biome/zoom/density views, ${geometryProfiles.length} geometry views, ${reliefProfiles.length} sloped-bank and bridge views, camera/cache recovery, Pause/Resume and reduced motion passed. Preview: ${output}/preview.html`);
} finally { await browser.close(); }
