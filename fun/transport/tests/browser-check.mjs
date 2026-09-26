// Serve the repository root first. Override TRANSPORT_URL / TRANSPORT_PLAYWRIGHT if needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const waitForGame = page => page.waitForFunction(() => window.transport?.game && window.transport?.renderer);
async function clickMapOption(page, selector) {
  if (!(await page.locator(selector).isVisible())) await page.locator('#map-options-button').click();
  await page.locator(selector).click();
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  watch(page);
  await page.goto(url);
  await waitForGame(page);
  assert.equal(await page.evaluate(() => transport.game.routes.length), 1);
  assert.equal(await page.evaluate(() => transport.game.biome), 'taiga');
  assert.deepEqual(await page.evaluate(() => [transport.game.width,transport.game.height]),[768,576], 'new games default to a vast world');
  await page.locator('[data-speed="0"]').click();
  const pausedDay = await page.evaluate(() => transport.game.day);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => transport.game.day), pausedDay, 'pause freezes the simulation');
  await page.locator('#help-button').click();
  assert.equal(await page.locator('#modal').evaluate(el => el.open), true);
  await page.locator('[data-help-tab="chains"]').click();
  assert.ok(await page.locator('.chain-node').count() >= 3);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').evaluate(el => el.open), false);
  assert.equal(await page.evaluate(() => transport.speed), 0, 'closing a modal preserves a paused game');
  await clickMapOption(page, '#grid-button');
  assert.equal(await page.locator('#grid-button').getAttribute('aria-pressed'), 'true');
  const initialZoom = await page.evaluate(() => transport.renderer.getCamera().zoom);
  await page.locator('#zoom-in').click();
  assert.ok(await page.evaluate(() => transport.renderer.getCamera().zoom) > initialZoom);
  await page.locator('#zoom-out').click();
  await page.screenshot({ path: `${output}/taiga-desktop.png` });

  const rendererChecks = await page.evaluate(async () => {
    const { createGame, build } = await import('./model.js');
    const { createRenderer } = await import('./renderer.js');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:480px';
    document.body.append(canvas);
    const game = createGame({ biome: 'taiga', seed: 1847 }), renderer = createRenderer(canvas, game);
    renderer.focus(50, 38);
    const bounds = canvas.getBoundingClientRect();
    const picked = renderer.screenToTile(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    renderer.zoomAt(1e6);
    const maximum = renderer.getCamera().zoom;
    renderer.zoomAt(1e-12);
    const steppedBack = renderer.getCamera().zoom;
    renderer.setZoom(.5);
    const minimum = renderer.getCamera().zoom;
    renderer.setZoom(1);
    renderer.focus(50, 38);
    Object.assign(game.tiles[38 * game.width + 50], { terrain: 'grass', detail: '', publicRoad: false, road: false, rail: false, building: null, zone: null });
    game.revision++;
    renderer.render(0, { showRoutes: false });
    const before = canvas.toDataURL();
    const constructed = build(game, 'road', 50, 38).ok;
    renderer.render(0, { showRoutes: false });
    const afterBuild = canvas.toDataURL();
    build(game, 'bulldoze', 50, 38);
    renderer.render(0, { showRoutes: false });
    const afterRemoval = canvas.toDataURL();
    const minimap = document.createElement('canvas');
    minimap.width = 200;
    minimap.height = 144;
    renderer.drawMinimap(minimap);
    const minimapDrawn = minimap.getContext('2d').getImageData(100, 72, 1, 1).data[3] > 0;
    const start = performance.now();
    for (let n = 0; n < 60; n++) renderer.render(n * 16, { showRoutes: false });
    const cachedFrameMs = (performance.now() - start) / 60;
    canvas.remove();
    return { picked, maximum, minimum, steppedBack, constructed, changed: before !== afterBuild,
      restored: before === afterRemoval, minimapDrawn, cachedFrameMs };
  });
  assert.deepEqual(rendererChecks.picked, { x: 50, y: 38 }, 'camera focus and pointer picking agree');
  assert.deepEqual([rendererChecks.minimum, rendererChecks.steppedBack, rendererChecks.maximum], [.5, 1, 2], 'zoom input moves one of exactly three levels even with a large factor');
  assert.equal(rendererChecks.constructed && rendererChecks.changed && rendererChecks.restored, true, 'the terrain cache tracks construction and demolition');
  assert.equal(rendererChecks.minimapDrawn, true);

  // Find an actual empty strip in the generated world and construct it with a real drag.
  const strip = await page.evaluate(() => {
    const game = transport.game;
    const home=game.cities[0];
    for (let y = home.y+4; y < home.y+20; y++) for (let x = home.x-14; x < home.x+30; x++) {
      const tiles = [0, 1, 2, 3].map(dx => game.tiles[y * game.width + x + dx]);
      if (tiles.every(t => ['grass', 'snow', 'sand', 'forest'].includes(t.terrain) && !t.building && !t.road && !t.rail && !t.zone)
          && !game.industries.some(i => i.y === y && i.x >= x && i.x <= x + 3)) {
        transport.renderer.focus(x + 1.5, y);
        return { x, y, cost:tiles.reduce((sum,t)=>sum+180+(t.terrain==='forest'?80:0),0) };
      }
    }
    return null;
  });
  assert.ok(strip, 'seed has a buildable test strip');
  await page.locator('[data-tool="road"]').click();
  const points = await page.evaluate(({ x, y }) => {
    const rect = document.querySelector('#world').getBoundingClientRect(), camera = transport.renderer.getCamera();
    return [x, x + 3].map(tx => ({ x: rect.left + rect.width / 2 + ((tx + .5) * 32 - camera.x) * camera.zoom,
      y: rect.top + rect.height / 2 + ((y + .5) * 32 - camera.y) * camera.zoom }));
  }, strip);
  const cashBeforeRoad = await page.evaluate(() => transport.game.money);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.evaluate(({ x, y }) => [0, 1, 2, 3].every(dx => transport.game.tiles[y * transport.game.width + x + dx].road), strip), true);
  assert.equal(await page.evaluate(() => transport.game.money), cashBeforeRoad - strip.cost);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#world').evaluate(el => el.classList.contains('build-mode')), false);

  // Inspect all26 architectural choices, build a civic landmark, and navigate a huge map.
  await page.locator('[data-category="towns"]').click();
  const expectedGroups={homes:9,community:7,shops:5,services:5};
  for(const [group,count] of Object.entries(expectedGroups)){
    await page.locator('#building-group').selectOption(group);
    assert.equal(await page.locator('[data-building-sprite]').count(),count,group+' has distinct buildable designs');
  }
  await page.locator('#building-group').selectOption('community');
  await page.locator('[data-tool="school"]').click();
  const plot=await page.evaluate(()=>{
    const game=transport.game,home=game.cities[0];
    for(let y=home.y-8;y<=home.y+8;y++)for(let x=home.x-8;x<=home.x+8;x++){
      const t=game.tiles[y*game.width+x];
      if(['grass','sand','snow','forest'].includes(t.terrain)&&!t.road&&!t.rail&&!t.building&&!t.zone&&!game.industries.some(i=>i.x===x&&i.y===y)&&!game.cities.some(c=>c.x===x&&c.y===y)){
        transport.renderer.focus(x,y);return{x,y};
      }
    }
  });
  assert.ok(plot,'a civic site is available');
  const schoolPoint=await page.locator('#world').boundingBox();
  await page.mouse.click(schoolPoint.x+schoolPoint.width/2,schoolPoint.y+schoolPoint.height/2);
  assert.equal(await page.evaluate(({x,y})=>transport.game.tiles[y*transport.game.width+x].building?.kind,plot),'school');
  await page.keyboard.press('Escape');
  await page.locator('#atlas-button').click();
  assert.equal(await page.locator('#atlas-map').count(),1);
  const atlasBounds=await page.locator('#atlas-map').boundingBox();
  await page.mouse.click(atlasBounds.x+atlasBounds.width*.75,atlasBounds.y+atlasBounds.height*.65);
  assert.equal(await page.locator('#modal').evaluate(el=>el.open),false);
  const explored=await page.evaluate(()=>transport.renderer.getCamera());
  assert.ok(explored.x>100*32,'the atlas travels beyond the old map boundary');
  await clickMapOption(page, '#home-view');
  const cache=await page.evaluate(()=>transport.renderer.getStats());
  assert.ok(cache.maxSurfaceWidth<=2048&&cache.maxSurfaceHeight<=2048,'huge maps never allocate a world-size texture');
  assert.ok(cache.cacheBytes<=cache.cacheLimit,'chunk memory remains bounded');
  await page.locator('[data-category="network"]').click();

  // Fill the visible route form, purchase its vehicle, then exercise retirement confirmation.
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#route-form [name="name"]').fill('QA city shuttle');
  await page.locator('#route-form [name="from"]').selectOption('station-1');
  await page.locator('#route-form [name="to"]').selectOption('station-2');
  const beforeRoute = await page.evaluate(() => transport.game.money);
  await page.locator('#route-form button[type="submit"]').click();
  assert.equal(await page.evaluate(() => transport.game.routes.length), 2);
  assert.equal(await page.evaluate(() => transport.game.vehicles.length), 2);
  assert.equal(await page.evaluate(() => transport.game.money), beforeRoute - 18000);
  const routeId = await page.evaluate(() => transport.game.routes.find(route => route.name === 'QA city shuttle').id);
  await page.locator(`[data-remove-route="${routeId}"]`).click();
  await page.locator('[data-close]').click();
  assert.equal(await page.evaluate(() => transport.game.routes.length), 2, 'cancel keeps service running');
  await page.locator(`[data-remove-route="${routeId}"]`).click();
  await page.locator('#confirm-retire').click();
  assert.equal(await page.evaluate(() => transport.game.routes.length), 1);
  assert.equal(await page.evaluate(() => transport.game.vehicles.length), 1);

  await page.locator('#save-button').click();
  await page.locator('.saves-explorer').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => localStorage.getItem('transport-save-v1')));
  await page.reload();
  await waitForGame(page);
  await page.locator('[data-speed="0"]').click();
  assert.equal(await page.evaluate(({ x, y }) => [0, 1, 2, 3].every(dx => transport.game.tiles[y * transport.game.width + x + dx].road), strip), true, 'reload restores constructed roads');
  assert.equal(await page.evaluate(() => transport.game.routes.length), 1);

  const biomeImages = new Set();
  for (const biome of ['desert', 'tundra', 'taiga']) {
    await page.locator('#world-button').click();
    assert.equal(await page.evaluate(() => transport.speed), 0, 'new-world dialog pauses the current world');
    await page.locator(`[data-biome="${biome}"]`).click();
    await page.locator('#world-seed').fill('95573');
    await page.locator('[data-world-size="huge"]').click();
    await page.locator('#generate-world').click();
    await page.locator('[data-speed="0"]').click();
    assert.equal(await page.evaluate(() => transport.game.biome), biome);
    assert.equal(await page.evaluate(() => transport.game.seed), 95573);
    assert.equal(await page.evaluate(() => transport.game.routes.length), 1);
    await page.waitForTimeout(80);
    biomeImages.add(await page.locator('#world').evaluate(canvas => canvas.toDataURL()));
    await page.screenshot({ path: `${output}/${biome}-world.png` });
  }
  assert.equal(biomeImages.size, 3, 'each environment draws a distinct world');

  await page.evaluate(async () => {
    const { tick } = await import('./model.js');
    // Weather, loading waits and traffic change the delivery date. Advance to
    // the actual milestone while retaining a bound that catches stalled routes.
    for (let days = 0; days < 120 && transport.game.totalDelivered < 100; days += 5) tick(transport.game, 5);
  });
  assert.ok(await page.evaluate(() => transport.game.totalDelivered) >= 100, 'the starter service reaches its delivery milestone');
  await page.waitForFunction(() => document.querySelector('#objective-progress').textContent.includes('Milestone reached'));
  await page.waitForTimeout(900);
  assert.ok(await page.evaluate(() => transport.game.totalDelivered) >= 100, 'the delivery milestone survives repeated HUD refreshes');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile has no horizontal overflow');
  await page.locator('.mobile-panel-toggle').click();
  assert.equal(await page.locator('.mobile-panel-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('[data-mobile-view="industry"]').click();
  assert.ok(await page.locator('[data-industry]').count() >= 3, 'mobile exposes industry management');
  await page.locator('[data-mobile-view="towns"]').click();
  assert.ok(await page.locator('[data-city]').count() >= 3, 'mobile exposes town management');
  await page.locator('#panel-help').click();
  assert.equal(await page.locator('#modal').evaluate(el => el.open), true);
  await page.keyboard.press('Escape');
  await page.locator('#panel-save').click();
  await page.locator('.saves-explorer').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.locator('.mobile-panel-toggle').click();
  await page.locator('[data-mobile-view="build"]').click();
  await page.locator('[data-category="towns"]').click();
  await page.locator('[data-tool="residential"]').click();
  assert.equal(await page.locator('.mobile-panel-toggle').getAttribute('aria-expanded'), 'false', 'choosing a mobile tool reveals the map');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
  const mobileCanvas = await page.locator('#world').boundingBox();
  const panBefore = await page.evaluate(() => transport.renderer.getCamera());
  await page.mouse.move(mobileCanvas.x + 160, mobileCanvas.y + 220);
  await page.mouse.down();
  await page.mouse.move(mobileCanvas.x + 230, mobileCanvas.y + 260, { steps: 5 });
  await page.mouse.up();
  assert.notDeepEqual(await page.evaluate(() => transport.renderer.getCamera()), panBefore, 'map panning works in narrow layout');
  await page.screenshot({ path: `${output}/mobile.png` });
  assert.deepEqual(errors, [], 'no browser console or runtime errors');
  console.log(`Transport browser smoke passed. Cached renderer: ${rendererChecks.cachedFrameMs.toFixed(2)} ms/frame in this local sample. Screenshots: ${output}`);
} finally {
  await browser.close();
}
