// Pick the displayed station artwork, including roofs outside its ground tile.
// Source alpha and draw order come from actual canvas submissions, so a marker
// or ground-tile hit cannot accidentally satisfy the roof/canopy regression.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-station-sprite-picking';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const results = [], errors = [];
try {
  for (const dpr of (process.env.TRANSPORT_DPRS || '1,2').split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width: 800, height: 576 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/station-sprite-picking-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}canvas{position:absolute;left:0;top:0;width:800px;height:576px}</style><canvas id="cached"></canvas><canvas id="direct"></canvas>' }));
    await page.goto(new URL('station-sprite-picking-qa', base).href);
    await page.evaluate(async () => {
      const [{ createRenderer }, { preloadWorldArt }, { preloadHouses }] = await Promise.all([import('./renderer.js'), import('./atlas-runtime.js'), import('./raster-houses.js')]);
      await Promise.all([preloadWorldArt({ biome: 'taiga', waitMs: 20000 }), preloadHouses({ biome: 'taiga', waitMs: 20000 })]);
      const stations = [{ id: 'road', mode: 'road', name: 'Road shelter', x: 40, y: 45 }, { id: 'rail', mode: 'rail', name: 'Rail station', x: 48, y: 45 }, { id: 'water', mode: 'water', name: 'Harbor', x: 44, y: 53 }];
      const tiles = Array.from({ length: 96 * 96 }, (_, variant) => ({ terrain: 'grass', elevation: .25, detail: '', variant, cleared: true }));
      // Dense scenery exercises the real full-view replay threshold at retina
      // density; station surroundings start empty to isolate their silhouettes.
      for (let y = 22; y <= 72; y++) for (let x = 22; x <= 72; x++) {
        if (stations.every(st => Math.max(Math.abs(x - st.x), Math.abs(y - st.y)) > 3)) tiles[y * 96 + x].building = { kind: 'house-cheap-1', level: 1, footprint: 1 };
      }
      tiles[45 * 96 + 40].road = true; tiles[45 * 96 + 48].rail = true;
      tiles[53 * 96 + 44].terrain = 'water';
      const game = { biome: 'taiga', seed: 1, width: 96, height: 96, tiles, revision: 1, networkRevision: 1, day: 0, cities: [], industries: [], stations, routes: [], vehicles: [], zones: [], terrainObjects: [] };
      const canvases = [document.querySelector('#direct'), document.querySelector('#cached')], calls = [];
      const context = canvases[0].getContext('2d'), draw = context.drawImage.bind(context);
      context.drawImage = (image, ...args) => {
        if (args.length === 4) {
          const m = context.getTransform(), [x, y, w, h] = args;
          calls.push({ image, id: image.infrastructureFrame?.id, left: (m.a * x + m.e) / devicePixelRatio, top: (m.d * y + m.f) / devicePixelRatio, width: m.a * w / devicePixelRatio, height: m.d * h / devicePixelRatio, house: !image.infrastructureFrame && Math.abs(w - 48) < .6 && Math.abs(h - 60) < .6 });
        }
        return draw(image, ...args);
      };
      const layers = { weather: false, names: false, routes: false, industryIcons: false, trees: false, vehicles: false, vehicleLoads: false };
      const renderers = [createRenderer(canvases[0], game, { sceneryBatching: false, layers }), createRenderer(canvases[1], game, { layers })];
      const alpha = new WeakMap(), must = (condition, message) => { if (!condition) throw new Error(message); };
      const same = (a, b) => a.x === b.x && a.y === b.y;
      const data = image => { let bytes = alpha.get(image); if (!bytes) { bytes = image.getContext('2d').getImageData(0, 0, image.width, image.height).data; alpha.set(image, bytes); } return bytes; };
      const at = (call, point) => {
        const x = Math.floor((point.x - call.left) / call.width * call.image.width), y = Math.floor((point.y - call.top) / call.height * call.image.height);
        return x >= 0 && y >= 0 && x < call.image.width && y < call.image.height ? data(call.image)[(y * call.image.width + x) * 4 + 3] : 0;
      };
      const client = (index, p) => { const r = canvases[index].getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; };
      const pick = (index, p) => { const c = client(index, p); return renderers[index].screenToInspectTile(c.x, c.y); };
      const ground = p => { const c = client(0, p); return renderers[0].screenToTile(c.x, c.y); };
      const noMarker = p => { const c = client(0, p); return !renderers[0].stationAtMarker(c.x, c.y); };
      const frame = st => calls.find(call => call.id === (st.mode === 'road' ? 'isometric:bus-stop' : st.mode === 'rail' ? 'isometric:train-stop' : calls.find(c => c.id?.startsWith('isometric:port-'))?.id));
      const points = (call, opaque = true) => {
        const out = [], bytes = data(call.image);
        for (let y = 0; y < call.image.height; y++) for (let x = 0; x < call.image.width; x++) {
          const a = bytes[(y * call.image.width + x) * 4 + 3]; if (opaque ? a < 220 : a !== 0) continue;
          const p = { x: call.left + (x + .5) / call.image.width * call.width, y: call.top + (y + .5) / call.image.height * call.height };
          if (p.x > 0 && p.y > 0 && p.x < 800 && p.y < 576 && noMarker(p)) out.push(p);
        }
        return out;
      };
      const render = () => { calls.length = 0; renderers[0].render(1000, { settle: true }); };
      const reset = () => { for (const r of renderers) { r.setGame(game); r.setZoom(1); r.focus(44, 47); } render(); };
      const place = (x, y) => { const tile = tiles[y * 96 + x]; tile.building = { kind: 'house-cheap-1', level: 1, footprint: 1 }; };
      reset();
      window.stationPickQA = { game, stations, canvases, renderers, calls, must, same, at, pick, ground, frame, points, render, reset, place, noMarker };
    });
    const direct = await page.evaluate(() => {
      const q = stationPickQA, rows = [];
      for (const st of q.stations) {
        const f = q.frame(st); q.must(f, `${st.mode}: native artwork was drawn`);
        const candidates = q.points(f).filter(p => !q.same(q.ground(p), st));
        q.must(candidates.length > 0, `${st.mode}: an opaque roof/canopy extends outside its ground tile`);
        const p = candidates.find(p => q.same(q.pick(0, p), st));
        q.must(p, `${st.mode}: displayed roof/canopy can be picked without its marker`);
        const clear = q.points(f, false).find(p => !q.same(q.ground(p), st) && !q.same(q.pick(0, p), st));
        q.must(clear, `${st.mode}: transparent padding does not select the station`);
        rows.push({ mode: st.mode, point: p, ground: q.ground(p), clear, candidates: candidates.length });
      }
      return rows;
    });
    const reserved = await page.evaluate(() => {
      const q = stationPickQA, rows = [];
      for (const st of q.stations) {
        const p = q.points(q.frame(st)).find(p => { const g = q.ground(p); return g.x + g.y < st.x + st.y && !q.same(g, st) && q.same(q.pick(0, p), st); });
        q.must(p, `${st.mode}: roof crosses a neighboring parcel behind the station`);
        const g = q.ground(p); q.place(g.x, g.y); rows.push({ mode: st.mode, point: p, ground: g });
      }
      q.game.revision++; q.reset();
      for (const row of rows) { const st = q.stations.find(st => st.mode === row.mode); q.must(q.game.tiles[row.ground.y * 96 + row.ground.x].building, `${row.mode}: neighboring ground is reserved by a house`); q.must(q.same(q.pick(0, row.point), st), `${row.mode}: visible station wins over reserved neighboring house parcel`); }
      window.stationPickQA.reserved = rows;
      return rows;
    });
    await page.screenshot({ path: `${output}/reserved-neighbors-dpr${dpr}.png` });
    const cache = await page.evaluate(async () => {
      const q = stationPickQA, r = q.renderers[1];
      for (let frame = 0; frame < 240; frame++) {
        r.render(1000, { settle: true });
        const s = r.getStats().sceneryBatches;
        if (!s.pending && s.viewDraws) break;
        await new Promise(requestAnimationFrame);
      }
      const before = r.getStats().sceneryBatches;
      q.must(before.viewBuilds > 0 && before.viewDraws > 0, `dense scene exercises full-view cached drawing: ${JSON.stringify(before)}`);
      for (const row of q.reserved) { const st = q.stations.find(st => st.mode === row.mode); q.must(q.same(q.pick(1, row.point), st), `${row.mode}: cached roof preserves reserved-neighbor selection`); }
      const a = r.worldToScreen(44, 47); r.pan(-8, 4); r.render(1000, { settle: true }); const b = r.worldToScreen(44, 47);
      const after = r.getStats().sceneryBatches;
      q.must(after.viewBuilds === before.viewBuilds && after.viewPanDraws > before.viewPanDraws, 'small pan reuses the same padded full-view scene');
      for (const row of q.reserved) { const st = q.stations.find(st => st.mode === row.mode), p = { x: row.point.x + b.x - a.x, y: row.point.y + b.y - a.y }; q.must(q.same(q.pick(1, p), st), `${row.mode}: panned cached roof retains exact picking coordinates`); }
      return { before, after, pan: { x: b.x - a.x, y: b.y - a.y } };
    });
    const foreground = await page.evaluate(() => {
      const q = stationPickQA;
      for (const st of q.stations) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) q.place(st.x + dx, st.y + dy);
      q.game.revision++; q.reset();
      const rows = [];
      for (const st of q.stations) {
        const f = q.frame(st), laterHouses = q.calls.slice(q.calls.indexOf(f) + 1).filter(call => call.house);
        const p = q.points(f).find(p => laterHouses.some(house => q.at(house, p) > 220));
        q.must(p, `${st.mode}: foreground house covers an opaque station pixel`);
        q.must(!q.same(q.pick(0, p), st), `${st.mode}: opaque foreground house blocks the station beneath it`);
        rows.push({ mode: st.mode, point: p, ground: q.ground(p), picked: q.pick(0, p) });
      }
      q.foreground = rows;
      return rows;
    });
    const cachedForeground = await page.evaluate(async () => {
      const q = stationPickQA, r = q.renderers[1];
      for (let frame = 0; frame < 240; frame++) {
        r.render(1000, { settle: true });
        const s = r.getStats().sceneryBatches;
        if (!s.pending && s.viewDraws && s.viewBytes) break;
        await new Promise(requestAnimationFrame);
      }
      const stats = r.getStats().sceneryBatches;
      q.must(stats.viewBytes > 0, 'foreground scene uses full-view cached drawing');
      for (const row of q.foreground) { const st = q.stations.find(st => st.mode === row.mode); q.must(!q.same(q.pick(1, row.point), st), `${row.mode}: cached opaque foreground blocks the station beneath it`); }
      return { stats, picks: q.foreground.map(row => ({ mode: row.mode, picked: q.pick(1, row.point) })) };
    });
    const hidden = await page.evaluate(() => {
      const q = stationPickQA, rows = [];
      q.renderers[0].setLayers({ stations: false }); q.render();
      for (const row of q.reserved) { const st = q.stations.find(st => st.mode === row.mode), picked = q.pick(0, row.point); q.must(!q.same(picked, st), `${row.mode}: hidden station artwork cannot be selected by its previous roof`); rows.push({ mode: st.mode, picked }); }
      return rows;
    });
    results.push({ dpr, direct, reserved, cache, foreground, cachedForeground, hidden }); await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ densityProfiles: results.length, stationModes: results[0].direct.map(row => row.mode), reservedNeighborProfiles: results.flatMap(row => row.reserved).length, foregroundProfiles: results.flatMap(row => row.foreground).length, cachedForegroundProfiles: results.flatMap(row => row.cachedForeground.picks).length, fullViewCacheProfiles: results.length, errors }));
} finally { await browser.close(); }
