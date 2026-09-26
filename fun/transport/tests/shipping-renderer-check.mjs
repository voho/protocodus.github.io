import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-shipping-renderer';
await mkdir(output, { recursive: true });
const errors = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/');
    await page.waitForFunction(() => window.transport?.renderer);
    await page.evaluate(async () => {
      transport.setSpeed(0);
      const { createGame } = await import('../transport/model.js');
      const game = createGame({ size: 'regional', seed: 1847 });
      for (const tile of game.tiles) Object.assign(tile, { terrain: 'grass', detail: '', building: null, zone: null, road: false, rail: false, bridge: false, tunnel: false });
      for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) if ((x >= 35 && x <= 57 && y >= 37 && y <= 51) || (x >= 48 && x <= 50)) Object.assign(game.tiles[y * game.width + x], { terrain: 'water', detail: 'river' });
      for (let y = 34; y <= 55; y++) Object.assign(game.tiles[y * game.width + 47], { road: true, bridge: y >= 37 && y <= 51 });
      for (let x = 32; x <= 61; x++) Object.assign(game.tiles[48 * game.width + x], { rail: true, bridge: x >= 35 && x <= 57 });
      game.cities = []; game.industries = []; game.zones = [];
      game.stations = [{ id: 'port-a', mode: 'water', x: 35, y: 43, name: 'West quay' }, { id: 'port-b', mode: 'water', x: 42, y: 37, name: 'North quay' }, { id: 'port-c', mode: 'water', x: 57, y: 43, name: 'East quay' }, { id: 'port-d', mode: 'water', x: 42, y: 51, name: 'South quay' }];
      const examples = [[40, 40, 0, 'coal', 0], [43, 40, Math.PI / 2, 'coal', 140], [46, 40, Math.PI, 'timber', 70], [50, 40, -Math.PI / 2, 'fuel', 140], [53, 43, 0, 'passengers', 60], [47, 44, 0, 'goods', 140], [50, 48, Math.PI / 2, 'goods', 140]];
      game.routes = examples.map(([, , , cargo], index) => ({ id: `ship-route-${index}`, mode: 'water', cargo, color: '#ac7855', stops: [], path: [] }));
      game.vehicles = examples.map(([x, y, angle, , load], index) => ({ id: `ship-${index}`, routeId: `ship-route-${index}`, x, y, angle, load, capacity: 140, dwellRemaining: 0 }));
      game.revision++; window.shippingFixture = game;
      transport.renderer.setGame(game); transport.renderer.setLayers({ vehicles: true, vehicleLoads: true, stations: true, routes: false, names: false, industryIcons: false, grid: false }); transport.renderer.focus(46, 44);
      document.querySelector('#objective-card').hidden = true;
    });
    for (const zoom of [.5, 1, 2]) {
      await page.evaluate(zoom => { transport.renderer.setZoom(zoom); transport.renderer.render(1200); }, zoom);
      await page.screenshot({ path: `${output}/ships-dpr${dpr}-zoom${zoom}.png` });
      const result = await page.evaluate(async ({ zoom, dpr }) => {
        const { createMarineSprites, MARINE_SIZE } = await import('../transport/marine-sprites.js');
        const sprites = createMarineSprites({ pixelScale: zoom * dpr, detailLevel: zoom === .5 ? 'region' : zoom === 2 ? 'detail' : 'town' });
        const hash = image => { let value = 2166136261; for (const byte of image.getContext('2d').getImageData(0, 0, image.width, image.height).data) value = Math.imul(value ^ byte, 16777619); return value; };
        const ship = { angle: 0, load: 0, capacity: 140 }, route = { cargo: 'coal', color: '#ac7855' };
        const empty = sprites.ship(ship, route), emptyHash = hash(empty), loadedHash = hash(sprites.ship({ ...ship, load: 140 }, route));
        const headings = new Set([0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(angle => hash(sprites.ship({ ...ship, angle, load: 140 }, route))));
        const ports = new Set([0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(angle => hash(sprites.port(angle))));
        const renderer = transport.renderer, canvas = document.querySelector('#world'), context = canvas.getContext('2d'), camera = renderer.getCamera(), rect = canvas.getBoundingClientRect();
        const sample = (x, y, offsetX = 0) => { const sx = ((x + .5) * 32 - camera.x + offsetX) * zoom + rect.width / 2, sy = ((y + .5) * 32 - camera.y) * zoom + rect.height / 2; return [...context.getImageData(Math.round(sx * dpr), Math.round(sy * dpr), Math.max(1, Math.round(zoom * dpr)), Math.max(1, Math.round(zoom * dpr))).data]; };
        renderer.setLayers({ vehicles: false, vehicleLoads: false }); renderer.render(1200); const bridgeWithoutShip = sample(47, 44), outsideWithoutShip = sample(47, 44, 13);
        renderer.setLayers({ vehicles: true }); renderer.render(1200); const bridgeWithShip = sample(47, 44), outsideWithShip = sample(47, 44, 13);
        renderer.setLayers({ vehicleLoads: true }); renderer.render(1200);
        return { raster: empty.width, expectedRaster: Math.ceil(MARINE_SIZE * zoom * dpr), emptyHash, loadedHash, headings: headings.size, ports: ports.size, bridgeWithoutShip, bridgeWithShip, outsideWithoutShip, outsideWithShip, indicators: renderer.getStats().vehicleIndicators };
      }, { zoom, dpr });
      assert.equal(result.raster, result.expectedRaster, 'marine sprites are rasterized at the current physical-pixel scale');
      assert.notEqual(result.emptyHash, result.loadedHash, 'loaded bulk visibly fills the previously empty hold');
      assert.equal(result.headings, 4, 'ship bows distinguish all four travel directions');
      assert.equal(result.ports, 4, 'quays orient toward each shoreline');
      assert.deepEqual(result.bridgeWithShip, result.bridgeWithoutShip, 'bridge deck occludes the ship hull');
      assert.notDeepEqual(result.outsideWithShip, result.outsideWithoutShip, 'ship remains visible outside the bridge deck');
      assert.ok(result.indicators.empty > 0 && result.indicators.full > 0 && result.indicators.partial > 0, 'marine carriers retain readable cargo meters');
    }
    await page.evaluate(() => { shippingFixture.day = 30; transport.renderer.setLayers({ lighting: true }); transport.renderer.focus(39, 43); transport.renderer.render(1200); });
    await page.screenshot({ path: `${output}/harbor-night-dpr${dpr}.png` });
    await page.evaluate(() => { shippingFixture.day = 0; transport.renderer.render(1200); });
    await page.screenshot({ path: `${output}/harbor-day-dpr${dpr}.png` });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Shipping renderer: all three zooms at DPR1/2, directional/load artwork, ports, cargo meters, and bridge occlusion passed.');
} finally { await browser.close(); }
