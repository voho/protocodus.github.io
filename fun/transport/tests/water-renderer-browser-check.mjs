// Isolated renderer QA: deterministic visible water at every zoom and DPR.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-water-renderer';
await mkdir(output, { recursive: true });
const profiles = [], shipProfiles = [], errors = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/water-renderer-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{display:block;width:1100px;height:780px}</style><canvas></canvas>' }));
    await page.goto(new URL('water-renderer-qa', base).href);
    await page.evaluate(async () => {
      const [{ createGame }, { createRenderer }, { preloadWorldArt }] = await Promise.all([import('./model.js'), import('./renderer.js'), import('./atlas-runtime.js')]);
      await preloadWorldArt({ waitMs: 12000 });
      // The views focus fixed recipe-7 water (480, 78), so every world here is a recipe-7 world.
      const canvas = document.querySelector('canvas'), game = createGame({ biome: 'tundra', size: 'square512', seed: 1847, generationVersion: 7 });
      const renderer = createRenderer(canvas, game, { layers: { trees: false, buildings: false, stations: false, names: false, industryIcons: false, zones: false, roads: false, rails: false, vehicles: false, vehicleLoads: false, routes: false, grid: false } });
      window.waterQA = { createGame, renderer, canvas };
    });
    for (const biome of ['taiga', 'tundra', 'desert']) {
      await page.evaluate(biome => { waterQA.game = waterQA.createGame({ biome, size: 'square512', seed: 1847, generationVersion: 7 }); waterQA.renderer.setGame(waterQA.game); }, biome);
      for (const zoom of [.5, 1, 2]) {
        const result = await page.evaluate(({ zoom, dpr, biome }) => {
          const { renderer: r, canvas, game: g } = waterQA, c = canvas.getContext('2d'), rect = canvas.getBoundingClientRect();
          r.setZoom(zoom); r.focus(480, 78); g.day = 2.25; r.render(0); r.render(0);
          const before = c.getImageData(0, 0, canvas.width, canvas.height).data, count = r.getStats().composedChunks;
          r.render(5000); const paused = c.getImageData(0, 0, canvas.width, canvas.height).data;
          g.day += 1; r.render(6000); const after = c.getImageData(0, 0, canvas.width, canvas.height).data;
          let pausedChanges = 0, movingPixels = 0, checked = 0, landChanges = 0, strongest = 0;
          for (let i = 0; i < before.length; i += 4) {
            if (before[i] !== paused[i] || before[i + 1] !== paused[i + 1] || before[i + 2] !== paused[i + 2]) pausedChanges++;
            const contrast = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
            if (contrast > 4) {
              movingPixels++; strongest = Math.max(strongest, contrast);
              if (movingPixels % 11 === 0) {
                const pixel = i / 4, point = r.screenToTile(rect.left + (pixel % canvas.width + .5) / dpr, rect.top + (Math.floor(pixel / canvas.width) + .5) / dpr);
                checked++; if (g.tiles[point.y * g.width + point.x]?.terrain !== 'water') landChanges++;
              }
            }
          }
          return { biome, zoom, dpr, pausedChanges, movingPixels, strongest, checked, landChanges, chunkRebuilds: r.getStats().composedChunks - count };
        }, { zoom, dpr, biome });
        profiles.push(result);
        if (dpr === 1) await page.locator('canvas').screenshot({ path: `${output}/${biome}-zoom${zoom}.png` });
      }
    }
    shipProfiles.push(...await page.evaluate(dpr => {
      const { renderer: r, canvas, createGame } = waterQA, g = createGame({ biome: 'tundra', size: 'square512', seed: 1847, generationVersion: 7 });
      const at = (x, y) => g.tiles[y * g.width + x];
      let berth = null, distance = Infinity;
      for (let y = 60; y <= 96; y++) for (let x = 468; x <= 506; x++) {
        const d = Math.hypot(x - 480, y - 78); if (d >= distance) continue;
        let open = true;
        for (let dy = -2; dy <= 2 && open; dy++) for (let dx = -2; dx <= 2; dx++) {
          const tile = at(x + dx, y + dy); if (tile?.terrain !== 'water' || tile.road || tile.rail) { open = false; break; }
        }
        if (open) { berth = { x, y }; distance = d; }
      }
      if (!berth) throw new Error('No visible open water for the stationary ship fixture');
      const ship = { id: 'qa-ship', routeId: 'qa-water-route', ...berth, angle: 0, load: 0, capacity: 80, level: 1, dwellRemaining: 0, waiting: false };
      // Hold position while time advances: only the active ship's wake and the
      // water may change. Waiting is used below solely to isolate the wake ink.
      g.routes = [{ id: ship.routeId, mode: 'water', cargo: 'goods', color: '#a66d4b', path: [berth, { x: berth.x + 1, y: berth.y }], stops: [] }];
      g.vehicles = [ship]; g.revision++; r.setGame(g); r.setLayers({ vehicles: true });
      const c = canvas.getContext('2d'), capture = () => c.getImageData(0, 0, canvas.width, canvas.height).data, rows = [];
      const difference = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      for (const zoom of [.5, 1, 2]) {
        r.setZoom(zoom); r.focus(berth.x, berth.y); g.day = 2.25; ship.waiting = true;
        r.setLayers({ vehicles: false }); r.render(0); const noShip = capture();
        r.setLayers({ vehicles: true }); r.render(0); const noWakeBefore = capture();
        ship.waiting = false; r.render(0); const before = capture(), chunks = r.getStats().composedChunks;
        r.render(5000); const paused = capture();
        g.day += 1; r.render(6000); const advanced = capture();
        ship.waiting = true; r.render(6000); const noWakeAfter = capture();
        let shipInk = 0, wakeInk = 0, pausedChanges = 0, wakeMovingPixels = 0, rippleMovingPixels = 0;
        for (let i = 0; i < before.length; i += 4) {
          if (difference(noShip, noWakeBefore, i) > 4) shipInk++;
          if (difference(before, noWakeBefore, i) > 4) wakeInk++;
          if (difference(before, paused, i)) pausedChanges++;
          const waterChange = difference(noWakeBefore, noWakeAfter, i);
          if (waterChange > 4) rippleMovingPixels++;
          // Ignore pixels where a water ripple moved underneath the wake; the
          // remaining changes prove that the wake itself follows game.day.
          if (!waterChange && difference(before, advanced, i) > 4) wakeMovingPixels++;
        }
        rows.push({ zoom, dpr, berth, shipInk, wakeInk, pausedChanges, wakeMovingPixels, rippleMovingPixels, stationary: ship.x === berth.x && ship.y === berth.y, chunkRebuilds: r.getStats().composedChunks - chunks });
      }
      return rows;
    }, dpr));
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ profiles, shipProfiles, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const profile of profiles) {
    assert.equal(profile.pausedChanges, 0, JSON.stringify(profile));
    assert.equal(profile.chunkRebuilds, 0, 'wave motion must not invalidate terrain caches');
    assert.ok(profile.movingPixels > 30 && profile.strongest > 10, JSON.stringify(profile));
    assert.ok(profile.checked > 0); assert.equal(profile.landChanges, 0, 'ripples must stay on water');
  }
  for (const profile of shipProfiles) {
    assert.ok(profile.shipInk > 10 && profile.wakeInk > 5, JSON.stringify(profile));
    assert.equal(profile.pausedChanges, 0, 'paused ship and wake must remain pixel-identical despite wall-clock time advancing');
    assert.ok(profile.wakeMovingPixels > 0 && profile.rippleMovingPixels > 30, JSON.stringify(profile));
    assert.ok(profile.stationary); assert.equal(profile.chunkRebuilds, 0);
  }
  console.log(JSON.stringify({ profiles, shipProfiles, output }, null, 2));
} finally { await browser.close(); }
