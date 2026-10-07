// Focused artwork QA through the real map renderer and mounted Gallery.
// No simulation ticks, application save injection or approved pixel goldens.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-airport-quality-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const profiles = [], fallbacks = [], errors = [], failures = [];
const airportURL = url => url.includes('/assets/world/airport-buildings-v2/');
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./tokens.css"><link rel="stylesheet" href="./components.css"><link rel="stylesheet" href="./dialogs.css"><link rel="stylesheet" href="./gallery.css"><style>body{margin:0;background:#ece7d8}#world{display:block;width:1400px;height:900px}#gallery{width:870px}#label{padding:8px;font:16px sans-serif}</style><div id="label"></div><canvas id="world"></canvas><div id="gallery"></div>`;
async function fixture(context, blocked = false) {
  let intercepted = 0;
  if (blocked) await context.route('**/assets/world/airport-buildings-v2/*.png', route => { intercepted++; return route.abort('blockedbyclient'); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !(blocked && airportURL(message.location().url || message.text()))) errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !(blocked && airportURL(response.url()))) failures.push(`${response.status()} ${response.url()}`); });
  await page.route('**/airport-quality-qa', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(new URL('airport-quality-qa', base).href);
  await page.evaluate(async () => {
    const [model, { createRenderer }, art, authored, atlas, houses, { createSpriteCache }, { mountGallery }, { drawUIArtwork }, sites] = await Promise.all([
      import('./model.js'), import('./renderer.js'), import('./airport-art.js'), import('./airport-building-art.js'), import('./atlas-runtime.js'),
      import('./raster-houses.js'), import('./sprite-cache.js'), import('./gallery-view.js'), import('./ui-art.js'), import('./station-sites.js'),
    ]);
    // Importing the production renderer registers every family before preload.
    await atlas.preloadWorldArt({ waitMs: 30000, cells: [16, 32, 64, 128, 256, 512] });
    const canvas = document.querySelector('#world'), context = canvas.getContext('2d'), calls = [];
    const draw = context.drawImage.bind(context);
    context.drawImage = (image, ...args) => {
      if (args.length === 4) { const t = context.getTransform(); calls.push({ image, x: args[0] * t.a + t.e, y: args[1] * t.d + t.f, w: args[2] * t.a, h: args[3] * t.d, smoothing: context.imageSmoothingEnabled }); }
      return draw(image, ...args);
    };
    const pixelStats = image => {
      const data = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
      let ink = 0, edge = 0, clear = 0, left = image.width, top = image.height, right = -1, bottom = -1;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const a = data[(y * image.width + x) * 4 + 3];
        if (!a) clear++;
        if (a > 16) { ink++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); if (!x || !y || x === image.width - 1 || y === image.height - 1) edge++; }
      }
      return { ink, edge, clear, bounds: [left, top, right + 1, bottom + 1] };
    };
    window.airportQuality = { model, createRenderer, art, authored, atlas, houses, createSpriteCache, mountGallery, drawUIArtwork, sites, canvas, context, calls, pixelStats };
  });
  return { page, intercepted: () => intercepted };
}
async function world(page, biome) {
  return page.evaluate(async biome => {
    const q = airportQuality;
    await q.houses.preloadHouses({ biome, waitMs: 30000 });
    // Regional is the smallest current public createGame size (128 × 96).
    const game = q.model.createGame({ biome, seed: 1847, size: 'regional' });
    game.day = 800; game.revision++; game.networkRevision++;
    game.cities = []; game.industries = []; game.routes = []; game.vehicles = []; game.zones = [];
    game.tiles = game.tiles.map(() => ({ terrain: biome === 'desert' ? 'sand' : biome === 'tundra' ? 'snow' : 'grass', elevation: 0, detail: '', variant: 0, building: null, road: false, rail: false, publicRoad: false }));
    game.stations = ['x', 'y'].map((axis, n) => ({ id: `airport-${axis}`, name: `Airport ${axis}`, mode: 'air', axis, x: 28 + n * 10, y: 28 }));
    game.tiles[33 * game.width + 27].building = { kind: 'house-cheap-1', footprint: 1, level: 1, variant: 0 };
    game.tiles[34 * game.width + 37].building = { kind: 'house-cheap-1', footprint: 1, level: 1, variant: 0 };
    for (let x = 26; x <= 42; x++) game.tiles[35 * game.width + x].road = true;
    q.gallery?.dispose(); q.game = game; q.before = JSON.stringify(game);
    q.renderer = q.createRenderer(q.canvas, game, { sceneryBatching: false, sceneryViewCaching: false, layers: { weather: false, names: false, industryIcons: false, vehicleLoads: false, routes: false, grid: false, vehicles: false } });
    return { width: game.width, height: game.height, stations: game.stations, flat: game.tiles.every(tile => tile.elevation === 0), assets: q.atlas.worldArtStats() };
  }, biome);
}
async function profile(page, biome, axis, zoom, dpr) {
  return page.evaluate(({ biome, axis, zoom, dpr }) => {
    const q = airportQuality, r = q.renderer, site = q.game.stations.find(s => s.axis === axis), effectiveDpr = Math.min(devicePixelRatio || 1, 2), scale = zoom * effectiveDpr;
    r.setZoom(zoom); const centre = q.art.localToWorld(axis, 3, 1); r.focus(site.x + centre.x - .5, site.y + centre.y - .5); r.pan(.23, .37);
    q.calls.length = 0; r.render(0, { settle: true, showRoutes: false });
    const origin = r.gridPointToScreen(site.x, site.y), rect = q.canvas.getBoundingClientRect();
    const submittedImages = new Map(), submissions = Object.entries(q.art.PART_BOXES[axis]).map(([kind, box]) => {
      const expected = { x: Math.round((origin.x + (box.left - 2) * zoom) * effectiveDpr), y: Math.round((origin.y + (box.top - 2) * zoom) * effectiveDpr), w: Math.ceil((box.width + 4) * scale), h: Math.ceil((box.height + 4) * scale) };
      const actual = q.calls.find(c => ['x', 'y', 'w', 'h'].every(key => Math.abs(c[key] - expected[key]) < .01));
      if (actual) submittedImages.set(kind, actual.image);
      return { kind, expected, submitted: Boolean(actual), smoothing: actual?.smoothing, visible: expected.x >= 0 && expected.y >= 0 && expected.x + expected.w <= q.canvas.width && expected.y + expected.h <= q.canvas.height };
    });
    const stats = r.getStats(), marker = r.stationMarker(site), picked = r.stationAtMarker(rect.left + marker.x + marker.size / 2, rect.top + marker.y + marker.size / 2);
    const tiles = q.sites.stationTiles(site).map(tile => { const p = r.worldToScreen(tile.x, tile.y), ground = r.screenToTile(rect.left + p.x, rect.top + p.y); return { expected: tile, actual: ground, contains: q.sites.stationContains(site, ground.x, ground.y) }; });
    const cache = q.createSpriteCache(), bank = q.art.createAirportSprites({ pixelScale: scale, detailLevel: stats.detailLevel, biome, cache });
    const target = document.createElement('canvas'); target.width = target.height = 1600; const c = target.getContext('2d'); c.setTransform(scale, 0, 0, scale, .37, .61);
    const parts = Object.keys(q.art.PART_FRONTS).map(kind => {
      const first = bank.part(c, kind, axis, 320.23, 240.17), before = bank.getStats().created, second = bank.part(c, kind, axis, 320.23, 240.17);
      const device = { x: first.x * scale + .37, y: first.y * scale + .61, w: first.w * scale, h: first.h * scale };
      const submitted = submittedImages.get(kind);
      let mapPixelsMatch = false;
      if (submitted?.width === first.image.width && submitted?.height === first.image.height && submitted.getContext) {
        const expected = first.image.getContext('2d').getImageData(0, 0, first.image.width, first.image.height).data, actual = submitted.getContext('2d').getImageData(0, 0, submitted.width, submitted.height).data;
        mapPixelsMatch = expected.every((value, index) => value === actual[index]);
      }
      return { kind, ...q.pixelStats(first.image), mapPixelsMatch, reused: first.image === second.image && bank.getStats().created === before, device, source: { w: first.image.width, h: first.image.height } };
    });
    q.gallery?.dispose(); const container = document.querySelector('#gallery');
    q.gallery = q.mountGallery(container, q.game, {}, { entryId: 'transport:airport-x', category: 'transport', query: 'airport', climate: biome });
    const portrait = container.querySelector('.gallery-portrait canvas');
    // The catalog has one Airport entry. Its art fixture previews both placed
    // station axes through the same production UI painter and unchanged CSS.
    portrait.dataset.infrastructureAxis = axis; delete portrait.dataset.artDrawn;
    const beforePortrait = q.atlas.worldArtStats().rasterizedEntries;
    q.drawUIArtwork({ querySelectorAll: () => [portrait] }, q.game);
    const afterPortrait = q.atlas.worldArtStats().rasterizedEntries;
    const expectedPortrait = document.createElement('canvas'); expectedPortrait.width = expectedPortrait.height = Math.round(152 * effectiveDpr);
    const ec = expectedPortrait.getContext('2d'); ec.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0); ec.imageSmoothingEnabled = true; ec.imageSmoothingQuality = 'high'; q.art.drawAirportPortrait(ec, 152, 152, { biome, axis });
    const actual = portrait.getContext('2d').getImageData(0, 0, portrait.width, portrait.height).data, expected = ec.getImageData(0, 0, expectedPortrait.width, expectedPortrait.height).data;
    let differentPixels = actual.length === expected.length ? 0 : -1;
    if (!differentPixels) for (let k = 0; k < actual.length; k += 4) if ([0, 1, 2, 3].some(channel => actual[k + channel] !== expected[k + channel])) differentPixels++;
    const boxes = Object.values(q.art.PART_BOXES[axis]), corners = [[0, 0], [6, 0], [6, 2], [0, 2]].map(([u, v]) => q.art.localToProjected(axis, u, v));
    const left = Math.min(...corners.map(p => p.x), ...boxes.map(b => b.left - 2)), top = Math.min(...corners.map(p => p.y), ...boxes.map(b => b.top - 2));
    const right = Math.max(...corners.map(p => p.x), ...boxes.map(b => b.left + b.width + 2)), bottom = Math.max(...corners.map(p => p.y), ...boxes.map(b => b.top + b.height + 2));
    const fit = Math.min(140 / (right - left), 140 / (bottom - top));
    const runwayEndAlpha = [.36, 5.64].map(u => {
      const p = q.art.localToProjected(axis, u, 1.5), x = Math.round(((152 - (right - left) * fit) / 2 + (p.x - left) * fit) * effectiveDpr), y = Math.round(((152 - (bottom - top) * fit) / 2 + (p.y - top) * fit) * effectiveDpr);
      return portrait.getContext('2d').getImageData(x, y, 1, 1).data[3];
    });
    const authored = ['tower', 'terminal', 'hangar', 'depot'].map(kind => { const id = `airport-building:${kind}:axis-${axis}`; return { id, ready: q.atlas.atlasAvailable(id), mapDraws: stats.worldArtwork.rasterizedEntries[id] || 0, portraitDraws: (afterPortrait[id] || 0) - (beforePortrait[id] || 0) }; });
    const ground = document.createElement('canvas'); ground.width = (axis === 'x' ? 6 : 2) * 32; ground.height = (axis === 'x' ? 2 : 6) * 32; const gc = ground.getContext('2d'); q.art.paintAirportGround(gc, { axis, biome, detail: stats.detailLevel, seed: 5 });
    const runwayPoint = q.art.localToWorld(axis, 3, 1.5);
    const alpha = (x, y) => gc.getImageData(x, y, 1, 1).data[3];
    const galleryRect = portrait.getBoundingClientRect(); document.querySelector('#label').textContent = `${biome} · ${axis} runway · ${stats.view} · DPR ${dpr}`;
    const warmCreated = stats.airportSprites.created; r.render(0, { settle: true, showRoutes: false });
    return { biome, axis, zoom, dpr, effectiveDpr, size: [q.canvas.width, q.canvas.height], view: stats.view, density: stats.rasterScale, submissions, parts, authored, picked: picked?.id, tiles, ground: { bareCornerAlpha: alpha(1, 1), runwayAlpha: alpha(Math.round(runwayPoint.x * 32), Math.round(runwayPoint.y * 32)) }, portrait: { css: [galleryRect.width, galleryRect.height], backing: [portrait.width, portrait.height], ...q.pixelStats(portrait), differentPixels, runwayEndAlpha }, warmCreated, afterWarmCreated: r.getStats().airportSprites.created, immutable: q.before === JSON.stringify(q.game), artErrors: q.atlas.worldArtStats().errors };
  }, { biome, axis, zoom, dpr });
}
function check(row, blocked = false) {
  const label = `${row.biome}/${row.axis}/zoom${row.zoom}/DPR${row.dpr}`;
  assert.ok(Math.abs(row.effectiveDpr - row.dpr) < 1e-6, `${label}: browser uses the requested display density`);
  assert.equal(row.density, row.zoom * row.effectiveDpr, `${label}: actual map pixel density`);
  assert.equal(row.picked, `airport-${row.axis}`, `${label}: airport marker picking survives artwork replacement`);
  assert.ok(row.tiles.every(t => t.contains && t.actual.x === t.expected.x && t.actual.y === t.expected.y), `${label}: every runway/apron tile remains ground-pickable`);
  assert.equal(row.submissions.length, 7); assert.ok(row.submissions.every(p => p.submitted && p.visible && p.smoothing === false), `${label}: all seven complete static parts submit native prepared pixels`);
  for (const p of row.parts) {
    assert.ok(p.ink > 0 && p.clear > 0 && p.edge === 0, `${label}/${p.kind}: visible isolated complete RGBA part`);
    assert.equal(p.reused, true, `${label}/${p.kind}: repeated prepare reuses its canvas`);
    assert.equal(p.mapPixelsMatch, true, `${label}/${p.kind}: actual submitted pixels match the correct climate/axis/zoom preparation`);
    assert.ok(Math.abs(p.device.x - Math.round(p.device.x)) < 1e-7 && Math.abs(p.device.y - Math.round(p.device.y)) < 1e-7, `${label}/${p.kind}: fractional translation lands static artwork on device pixels`);
    assert.ok(Math.abs(p.device.w - p.source.w) < 1e-7 && Math.abs(p.device.h - p.source.h) < 1e-7, `${label}/${p.kind}: no second resize at static submission`);
  }
  assert.equal(row.afterWarmCreated, row.warmCreated, `${label}: warm map rendering reuses prepared parts`);
  assert.deepEqual(row.portrait.css, [152, 152]); assert.deepEqual(row.portrait.backing, [Math.round(152 * row.dpr), Math.round(152 * row.dpr)]);
  assert.ok(row.portrait.ink > 80 && row.portrait.clear > 0 && row.portrait.edge === 0, `${label}: full portrait has genuine transparent gutters`);
  assert.equal(row.portrait.differentPixels, 0, `${label}: selected Gallery shows the complete production airport portrait`);
  assert.ok(row.portrait.runwayEndAlpha.every(alpha => alpha > 16), `${label}: both ends of the full runway remain inside the Gallery portrait`);
  assert.equal(row.ground.bareCornerAlpha, 0, `${label}: unbuilt airfield reveals native terrain`); assert.equal(row.ground.runwayAlpha, 255, `${label}: constructed runway remains opaque`);
  assert.equal(row.immutable, true, `${label}: rendering and browsing leave the model unchanged`);
  for (const art of row.authored) {
    assert.equal(art.ready, !blocked, `${label}/${art.id}: expected authored availability`);
    if (blocked) assert.equal(art.portraitDraws, 0); else assert.ok(art.mapDraws > 0 && art.portraitDraws > 0, `${label}/${art.id}: map and Gallery use the authored identity`);
  }
  if (!blocked) assert.deepEqual(row.artErrors, []);
  else assert.ok(row.artErrors.every(error => error.id === 'airport-buildings-v2'), 'only deliberately blocked airport art may fail');
}
try {
  for (const dpr of [1, 1.3, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: dpr });
    const { page } = await fixture(context);
    for (const biome of ['taiga', 'tundra', 'desert']) {
      const state = await world(page, biome); assert.equal(state.flat, true);
      assert.equal(state.assets.loading, 0, 'all requested authored densities finished decoding before the matrix');
      for (const zoom of [.5, 1, 2]) for (const axis of ['x', 'y']) {
        const row = await profile(page, biome, axis, zoom, dpr); profiles.push(row); check(row);
        await page.screenshot({ path: `${output}/${biome}-${axis}-zoom${zoom}-dpr${dpr}.png`, fullPage: true });
      }
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1.3 });
  const blocked = await fixture(context, true); await world(blocked.page, 'taiga');
  for (const axis of ['x', 'y']) { const row = await profile(blocked.page, 'taiga', axis, 1, 1.3); fallbacks.push(row); check(row, true); await blocked.page.screenshot({ path: `${output}/fallback-${axis}-dpr1.3.png`, fullPage: true }); }
  assert.ok(blocked.intercepted() >= 6, 'all authored airport densities were deliberately blocked'); await context.close();
  assert.equal(profiles.length, 54); assert.equal(fallbacks.length, 2); assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  console.log(JSON.stringify({ profiles: profiles.length, fallbacks: fallbacks.length, output, errors, failures }, null, 2));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ profiles, fallbacks, errors, failures }, null, 2));
  await browser.close();
}
