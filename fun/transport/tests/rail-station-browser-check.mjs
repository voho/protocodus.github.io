// Rail stations retain their physical scale and native pixels in map and UI.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-rail-station-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const results = [], errors = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/rail-station-qa', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#91a77a;color:#20372a;font:16px sans-serif}h2{margin:12px}#world{width:1000px;height:570px}#portraits{display:flex;gap:32px;padding:12px}#portraits canvas{width:112px;height:112px}</style><h2>One-tile road shelter and rail station, houses and truck</h2><canvas id="world"></canvas><div id="portraits"><canvas width="112" height="112" data-infrastructure-sprite="bus-stop"></canvas><canvas width="112" height="112" data-infrastructure-sprite="train-stop"></canvas></div>' }));
    await page.goto(new URL('rail-station-qa', base).href);
    const preparation = await page.evaluate(async () => {
      const [infra, art, houses, { createRenderer }, { createGame }, { drawUIArtwork }] = await Promise.all([import('./isometric-infrastructure.js'), import('./atlas-runtime.js'), import('./raster-houses.js'), import('./renderer.js'), import('./model.js'), import('./ui-art.js')]);
      const fallback = document.createElement('canvas'); fallback.width = fallback.height = 96;
      const fallbackPainted = infra.drawIsometricStop(fallback.getContext('2d'), 'rail', 48, 48);
      const ink = image => image.getContext('2d').getImageData(0, 0, image.width, image.height).data.filter((_, i) => i % 4 === 3 && _ > 16).length;
      const fallbackInk = ink(fallback);
      await Promise.all([art.preloadWorldArt({ biome: 'taiga', waitMs: 20000 }), houses.preloadHouses({ biome: 'taiga', waitMs: 20000 })]);
      const profiles = [];
      for (const zoom of [.5, 1, 2]) {
        const scale = zoom * devicePixelRatio, factory = infra.createIsometricInfrastructureSprites({ pixelScale: scale });
        for (const mode of ['road', 'rail']) for (const axis of ['x', 'y']) {
          const bounds = infra.isometricStationBounds(mode), direct = document.createElement('canvas'), cached = document.createElement('canvas');
          direct.width = direct.height = cached.width = cached.height = 160 * scale;
          for (const [index, c] of [direct.getContext('2d'), cached.getContext('2d')].entries()) {
            // The map is opaque ground. Compare the complete displayed pixels,
            // including the alpha blend of each station's antialiased edge.
            c.fillStyle = '#91a77a'; c.fillRect(0, 0, direct.width, direct.height);
            // Chromium's high-quality atlas filter can round edge samples
            // differently after a screen translation. Rasterize the reference
            // at the preparation origin, then compare it with the cached image
            // copied elsewhere; this still detects resampling during that copy.
            const offset = index ? 40 : 0;
            c.scale(scale, scale); c.translate(offset - bounds.left, offset - bounds.top);
          }
          const authored = infra.drawIsometricStop(direct.getContext('2d'), mode, 0, 0, scale, axis), prepared = factory.stop(cached.getContext('2d'), mode, 0, 0, axis);
          const frame = bounds.size * scale, offset = 40 * scale;
          const a = direct.getContext('2d').getImageData(0, 0, frame, frame).data, b = cached.getContext('2d').getImageData(offset, offset, frame, frame).data;
          // Compare the pixels visible on grass. Raw RGB in near-transparent
          // antialiased edges can differ after unpremultiplication while their
          // displayed colours agree; this matches prepared-sprites QA.
          let max = 0, sum = 0, rawMax = 0, rawWorst = null, visibleWorst = null;
          for (let i = 0; i < a.length; i++) {
            const channel = i % 4, alpha = i - channel + 3, ground = [145, 167, 122][channel] || 0;
            const pa = channel === 3 ? a[i] : a[i] * a[alpha] / 255 + ground * (1 - a[alpha] / 255);
            const pb = channel === 3 ? b[i] : b[i] * b[alpha] / 255 + ground * (1 - b[alpha] / 255);
            const delta = Math.abs(pa - pb); if(delta > max){max = delta;visibleWorst={channel, direct:[...a.slice(alpha-3,alpha+1)],cached:[...b.slice(alpha-3,alpha+1)],x:(alpha-3)/4%frame,y:Math.floor((alpha-3)/4/frame)};} sum += delta;
            if (Math.abs(a[i] - b[i]) > rawMax) { rawMax = Math.abs(a[i] - b[i]); rawWorst = { direct: [...a.slice(alpha - 3, alpha + 1)], cached: [...b.slice(alpha - 3, alpha + 1)] }; }
          }
          const before = factory.getStats().created; factory.stop(cached.getContext('2d'), mode, 0, 0, axis);
          let stationInk = 0; for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-145)+Math.abs(a[i+1]-167)+Math.abs(a[i+2]-122)>16)stationInk++;
          profiles.push({ mode, axis, zoom, authored, prepared, max, sum, mean: sum / a.length, rawMax, rawWorst, visibleWorst, ink: stationInk, reused: before === factory.getStats().created, envelope: bounds.size });
        }
      }
      const source = createGame({ biome: 'taiga', size: 'square512', seed: 1847, generationVersion: 10, townCount: 2, industryDistricts: 1 });
      const game = { ...source, width: 64, height: 64, tiles: Array.from({ length: 4096 }, (_, variant) => ({ terrain: 'grass', elevation: .25, detail: '', variant })), cities: [], industries: [], terrainObjects: [], stations: [{ id: 'road', mode: 'road', name: 'Road shelter', x: 25, y: 22 }, { id: 'rail', mode: 'rail', name: 'Rail station', x: 25, y: 26 }], zones: [], routes: [{ id: 'truck', mode: 'road', cargo: 'stone', path: Array.from({ length: 10 }, (_, n) => ({ x: 20 + n, y: 22 })), color: '#739477' }], vehicles: [{ id: 'truck', routeId: 'truck', x: 23.4, y: 22, angle: 0, direction: 1, progress: 3.4, capacity: 40, load: 0, level: 1 }], revision: 1, networkRevision: 1 };
      for (let x = 20; x <= 29; x++) { game.tiles[22 * 64 + x].road = true; game.tiles[26 * 64 + x].rail = true; }
      for (const [x, kind] of [[22, 'house-cheap-1'], [24, 'house-normal-1']]) game.tiles[19 * 64 + x].building = { kind, footprint: 1, level: 1 };
      const renderer = createRenderer(document.querySelector('#world'), game, { sceneryBatching: false, layers: { weather: false, names: false, routes: false, industryIcons: false, trees: false } });
      drawUIArtwork(document.querySelector('#portraits'), game);
      window.stationQA = { renderer, game, art, infra };
      return { dpr: devicePixelRatio, fallbackPainted, fallbackInk, profiles, art: art.worldArtStats() };
    });
    for (const row of preparation.profiles) { assert.ok(row.authored && row.prepared && row.ink > 0); assert.ok(row.max <= 3 && row.mean <= .04, `native station pixels: ${JSON.stringify(row)}`); assert.equal(row.reused, true); assert.equal(row.envelope, 72); }
    assert.ok(preparation.fallbackPainted && preparation.fallbackInk > 80, 'unavailable rail artwork retains a visible station');
    assert.deepEqual(preparation.art.errors, []);
    const worlds = [];
    for (const zoom of [.5, 1, 2, 1]) {
      const result = await page.evaluate(zoom => { const q = stationQA; q.renderer.setZoom(zoom); q.renderer.focus(24, 23); q.renderer.render(1000); const stats = q.renderer.getStats(); return { zoom, infrastructure: stats.infrastructureSprites, keys: stats.worldArtwork.rasterizedEntries, revision: q.game.revision, day: q.game.day }; }, zoom);
      worlds.push(result); await page.screenshot({ path: `${output}/world-zoom${zoom}-dpr${dpr}.png` });
      assert.ok(result.infrastructure.created >= 2, 'world uses road and rail station artwork');
      assert.ok(result.keys['isometric:train-stop'] > 0, 'world and UI share the new railway artwork key');
      assert.equal(result.revision, 1); assert.equal(result.day, 0);
    }
    assert.equal(worlds[3].infrastructure.created, worlds[1].infrastructure.created, 'return to Town reuses native station pixels');
    results.push({ ...preparation, worlds }); await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ nativeProfiles: results.flatMap(row => row.profiles).length, worldProfiles: results.flatMap(row => row.worlds).length, unavailableArtworkProfiles: results.length, errors }));
} finally { await browser.close(); }
