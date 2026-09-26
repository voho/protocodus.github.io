// Real pointer, keyboard and touch input in isolated browser contexts.
// Serve the repository root before running; the player's browser saves are untouched.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-controls-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function start(viewport, touch = false) {
  const page = await browser.newPage({ viewport, hasTouch: touch, isMobile: touch });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.transport?.game && window.transport?.renderer);
  await page.locator('[data-speed="0"]').click();
  return page;
}

async function fixture(page) {
  return page.evaluate(() => {
    const g = transport.game;
    let origin;
    for (let y = 32; y < g.height - 40 && !origin; y += 24) {
      for (let x = 32; x < g.width - 40; x += 28) {
        if (![...g.cities, ...g.industries, ...g.stations].some(p => p.x >= x - 8 && p.x <= x + 28 && p.y >= y - 8 && p.y <= y + 28)) {
          origin = { x, y }; break;
        }
      }
    }
    if (!origin) throw new Error('No empty input-test site.');
    const { x, y } = origin;
    for (let dy = -2; dy <= 22; dy++) for (let dx = -2; dx <= 22; dx++) {
      Object.assign(g.tiles[(y + dy) * g.width + x + dx], {
        terrain: 'grass', detail: '', elevation: .2, variant: 0,
        road: false, rail: false, bridge: false, tunnel: false, publicRoad: false, building: null, zone: null,
      });
    }
    for (const dy of [0, 4]) for (const dx of [2, 3, 4, 5]) {
      g.tiles[(y + dy) * g.width + x + dx].terrain = dx < 4 ? 'water' : 'mountain';
    }
    for (let dy = 10; dy <= 12; dy++) for (let dx = 12; dx <= 15; dx++) g.tiles[(y + dy) * g.width + x + dx].terrain = 'water';
    // A second empty road is deliberately reserved for the stop-swipe test.
    for (let dx = 0; dx <= 6; dx++) g.tiles[(y + 8) * g.width + x + dx].road = true;
    g.money = 1_000_000; g.revision++; g.networkRevision++;
    transport.renderer.setZoom(1);
    return { ...origin, road: { x, y }, rail: { x, y: y + 4 }, stop: { x: x + 2, y: y + 8 }, port: { x: x + 12, y: y + 10 }, open: { x: x + 4, y: y + 16 } };
  });
}

async function points(page, tiles) {
  const screen = await page.evaluate(tiles => {
    const center = tiles.reduce((a, p) => ({ x: a.x + p.x / tiles.length, y: a.y + p.y / tiles.length }), { x: 0, y: 0 });
    transport.renderer.focus(center.x, center.y);
    const box = document.querySelector('#world').getBoundingClientRect(), camera = transport.renderer.getCamera();
    return tiles.map(p => ({ x: box.left + box.width / 2 + ((p.x + .5) * 32 - camera.x) * camera.zoom,
      y: box.top + box.height / 2 + ((p.y + .5) * 32 - camera.y) * camera.zoom }));
  }, tiles);
  for (const p of screen) await page.waitForFunction(p => document.elementFromPoint(p.x, p.y)?.id === 'world', p);
  return screen;
}

async function drag(page, from, to, options = {}) {
  const [a, b] = await points(page, [from, to]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down(options);
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up(options);
}

async function snapshot(page, site) {
  return page.evaluate(({ x, y }) => {
    const g = transport.game, tiles = [];
    for (let dy = -2; dy <= 22; dy++) for (let dx = -2; dx <= 22; dx++) tiles.push(g.tiles[(y + dy) * g.width + x + dx]);
    return JSON.stringify({ tiles, money: g.money, stations: g.stations, industries: g.industries, cities: g.cities,
      revision: g.revision, networkRevision: g.networkRevision });
  }, site);
}

async function keyTool(page, key, name) {
  await page.locator('#world').focus();
  await page.keyboard.press(key);
  await page.locator('#active-tool-bar').waitFor({ state: 'visible' });
  assert.match(await page.locator('#active-tool-name').innerText(), name);
  assert.ok((await page.locator('#active-tool-hint').innerText()).length > 4, 'active tool explains its map gesture');
}

async function clickTile(page, tile) {
  const [p] = await points(page, [tile]);
  await page.mouse.click(p.x, p.y);
}

async function menus(page) {
  assert.equal(await page.locator('#zoom-menu').isVisible(), false);
  assert.equal(await page.locator('#map-options').isVisible(), false);
  await page.locator('#zoom-level').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#zoom-menu').isVisible(), true, 'native Space activates the focused zoom button');
  assert.equal(await page.evaluate(() => transport.speed), 0, 'button Space does not change simulation speed');
  assert.equal(await page.locator('#zoom-menu [data-zoom-level]').count(), 3);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#zoom-menu').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'zoom-level', 'Escape returns focus to the zoom trigger');
  for (const zoom of [.5, 2, 1]) {
    await page.locator('#zoom-level').click();
    await page.locator(`[data-zoom-level="${zoom}"]`).click();
    assert.equal(await page.evaluate(() => transport.renderer.getCamera().zoom), zoom);
    assert.equal(await page.locator(`[data-zoom-level="${zoom}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#zoom-menu').isVisible(), false, 'a zoom choice returns to the map');
  }
  await page.locator('#zoom-level').click();
  await page.locator('#date').click();
  assert.equal(await page.locator('#zoom-menu').isVisible(), false, 'outside clicks dismiss zoom choices');
  await page.locator('#map-options-button').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#map-options').isVisible(), true, 'native Space opens Map options');
  assert.equal(await page.evaluate(() => transport.speed), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#map-options').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'map-options-button');
  await page.locator('#map-options-button').click();
  await page.locator('#grid-button').click();
  assert.equal(await page.evaluate(() => transport.renderer.getLayers().grid), true, 'Grid remains functional inside Map options');
  if (!(await page.locator('#map-options').isVisible())) await page.locator('#map-options-button').click();
  await page.locator('#grid-button').click();
  if (!(await page.locator('#map-options').isVisible())) await page.locator('#map-options-button').click();
  await page.locator('#routes-toggle').click();
  assert.equal(await page.evaluate(() => transport.renderer.getLayers().routes), false);
  if (!(await page.locator('#map-options').isVisible())) await page.locator('#map-options-button').click();
  await page.locator('#routes-toggle').click();
  if (!(await page.locator('#map-options').isVisible())) await page.locator('#map-options-button').click();
  await page.locator('#date').click();
  assert.equal(await page.locator('#map-options').isVisible(), false, 'outside clicks dismiss Map options');
}

async function layout(page, selectors) {
  const size = page.viewportSize();
  for (const selector of selectors) {
    // Wait for the mobile sidebar's real slide-in transition before measuring.
    await page.waitForFunction(selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return box.x >= -1 && box.y >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    }, selector, { timeout: 2000 }).catch(() => {});
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, `${selector} fits ${size.width}px: ${JSON.stringify(box)}`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || window.scrollY !== 0), false, 'controls do not scroll or widen the document');
}

async function home(page) {
  await page.locator('#world').focus(); await page.keyboard.press('Escape');
  await page.locator('#map-options-button').click(); await page.locator('#home-view').click();
  await page.locator('#world').focus(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#toast-region .toast'));
}

try {
  const page = await start({ width: 1440, height: 1000 });
  assert.deepEqual(await page.locator('#panel-content > .tool-grid [data-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.tool)), ['road', 'rail', 'stop', 'port', 'bulldoze'], 'five primary network tools stay visible; engineering choices are expandable');
  assert.match(await page.locator('.build-bottom-tools [data-tool="inspect"]').innerText(), /Explore/);
  await menus(page);
  const site = await fixture(page);
  for (const [mode, key, label, start] of [['road', 'r', /Road/, site.road], ['rail', 't', /Rail/, site.rail]]) {
    await keyTool(page, key, label);
    await drag(page, start, { x: start.x + 8, y: start.y });
    const built = await page.evaluate(({ start, mode }) => Array.from({ length: 9 }, (_, dx) => {
      const t = transport.game.tiles[start.y * transport.game.width + start.x + dx];
      return { connected: !!t[mode], bridge: !!t.bridge, tunnel: !!t.tunnel, terrain: t.terrain };
    }), { start, mode });
    assert.ok(built.every(t => t.connected), `${mode} drag connects land, water, and mountains`);
    assert.ok(built.slice(2, 4).every(t => t.bridge && t.terrain === 'water'), `${mode} automatically bridges water without filling it`);
    assert.ok(built.slice(4, 6).every(t => t.tunnel && t.terrain === 'mountain'), `${mode} automatically tunnels through mountains`);
  }
  await keyTool(page, 's', /Stop/);
  for (const [point, mode] of [[site.road, 'road'], [site.rail, 'rail']]) {
    await clickTile(page, point);
    assert.equal(await page.evaluate(p => transport.game.stations.find(s => s.x === p.x && s.y === p.y)?.mode, point), mode, 'Stop detects the network beneath it');
  }
  await page.locator('#cancel-tool-button').focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#active-tool-bar').isVisible(), false, 'Done works with native keyboard activation');
  assert.equal(await page.evaluate(() => transport.speed), 0);

  for (const cancel of ['switch', 'escape', 'view']) {
    await keyTool(page, 'r', /Road/);
    const before = await snapshot(page, site), [a, b] = await points(page, [site.open, { x: site.open.x + 4, y: site.open.y }]);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 });
    if (cancel === 'switch') await page.keyboard.press('x');
    else if (cancel === 'escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => transport.setView('routes'));
    await page.mouse.up();
    assert.equal(await snapshot(page, site), before, `${cancel} cancels the captured construction gesture before release`);
    await page.evaluate(() => transport.setView('build'));
  }
  await keyTool(page, 'r', /Road/);
  let before = await snapshot(page, site);
  const [center] = await points(page, [site.open]);
  await page.mouse.click(center.x, center.y, { button: 'right' });
  assert.equal(await page.locator('#active-tool-bar').isVisible(), false, 'right click finishes the active tool');
  assert.equal(await snapshot(page, site), before);
  await keyTool(page, 'r', /Road/);
  const camera = await page.evaluate(() => transport.renderer.getCamera());
  await page.mouse.move(center.x, center.y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(center.x + 85, center.y + 40, { steps: 4 }); await page.mouse.up({ button: 'right' });
  assert.notEqual(await page.evaluate(() => transport.renderer.getCamera().x), camera.x, 'right dragging pans while building');
  assert.equal(await snapshot(page, site), before, 'right dragging never builds');
  await keyTool(page, 'r', /Road/);
  const [panAt] = await points(page, [site.open]);
  const panCamera = await page.evaluate(() => transport.renderer.getCamera());
  await page.keyboard.down('Space');
  await page.mouse.move(panAt.x, panAt.y); await page.mouse.down();
  await page.mouse.move(panAt.x + 65, panAt.y + 15); await page.mouse.up();
  await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => transport.speed), 0, 'a quick Space-pan does not also unpause');
  assert.notEqual(await page.evaluate(() => transport.renderer.getCamera().x), panCamera.x);
  assert.equal(await snapshot(page, site), before, 'Space-pan never paints the active road tool');
  await keyTool(page, 's', /Stop/);
  before = await snapshot(page, site);
  await drag(page, site.stop, { x: site.stop.x + 3, y: site.stop.y });
  assert.equal(await snapshot(page, site), before, 'swiping a single-object tool does not place at the initial tile');
  await keyTool(page, 'r', /Road/);
  const [outside] = await points(page, [site.open]);
  await page.locator('#map-options-button').click();
  await page.mouse.click(outside.x, outside.y);
  assert.equal(await page.locator('#map-options').isVisible(), false, 'a map click dismisses Map options');
  assert.equal(await snapshot(page, site), before, 'dismissing a menu over the map cannot also build a road');
  await keyTool(page, 'p', /Port/); await clickTile(page, site.port);
  assert.equal(await page.evaluate(p => transport.game.stations.find(s => s.x === p.x && s.y === p.y)?.mode, site.port), 'water');
  await keyTool(page, 'x', /Bulldozer/); await clickTile(page, { x: site.road.x + 8, y: site.road.y });
  assert.equal(await page.evaluate(p => transport.game.tiles[p.y * transport.game.width + p.x].road, { x: site.road.x + 8, y: site.road.y }), false);
  await home(page);
  await page.locator('[data-tool="road"]').click();
  await layout(page, ['#active-tool-bar', '#cancel-tool-button', '.view-controls', '#map-options-button']);
  await page.screenshot({ path: `${output}/desktop-simple-controls.png` });
  await page.locator('#cancel-tool-button').click(); await page.locator('#zoom-level').click();
  await page.screenshot({ path: `${output}/desktop-zoom-menu.png` });
  await page.close();

  for (const width of [390, 320]) {
    const mobile = await start({ width, height: 844 }, true);
    await menus(mobile);
    await mobile.locator('.mobile-panel-toggle').click();
    assert.equal(await mobile.locator('#panel-content > .tool-grid [data-tool]').count(), 5);
    await layout(mobile, ['.sidebar', '.mobile-panel-toggle']);
    await mobile.screenshot({ path: `${output}/mobile-${width}-network.png` });
    await mobile.locator('[data-tool="road"]').click();
    assert.equal(await mobile.locator('.sidebar').evaluate(el => el.classList.contains('mobile-open')), false, 'choosing a mobile tool reveals the map');
    await mobile.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
    await layout(mobile, ['#active-tool-bar', '#cancel-tool-button', '.view-controls', '#map-options-button']);
    await mobile.screenshot({ path: `${output}/mobile-${width}-build.png` });
    const mobileSite = await fixture(mobile);
    const cdp = await mobile.context().newCDPSession(mobile);
    const touch = (id, x, y) => ({ id, x, y, radiusX: 6, radiusY: 6, force: 1 });
    const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const [p] = await points(mobile, [mobileSite.open]);
    const untouched = await snapshot(mobile, mobileSite), cameraBefore = await mobile.evaluate(() => transport.renderer.getCamera());
    await send('touchStart', [touch(1, p.x - 35, p.y)]);
    await send('touchStart', [touch(1, p.x - 35, p.y), touch(2, p.x + 35, p.y)]);
    await send('touchMove', [touch(1, p.x + 15, p.y + 35), touch(2, p.x + 85, p.y + 35)]);
    await send('touchEnd', [touch(2, p.x + 85, p.y + 35)]);
    await send('touchMove', [touch(2, p.x + 95, p.y + 45)]);
    await send('touchEnd', []);
    assert.notEqual(await mobile.evaluate(() => transport.renderer.getCamera().x), cameraBefore.x, 'two-finger touch pans the map');
    assert.equal(await snapshot(mobile, mobileSite), untouched, 'lifting one then both fingers cannot commit a road');
    const [pinch] = await points(mobile, [mobileSite.open]);
    await send('touchStart', [touch(1, pinch.x - 30, pinch.y), touch(2, pinch.x + 30, pinch.y)]);
    await send('touchMove', [touch(1, pinch.x - 90, pinch.y), touch(2, pinch.x + 90, pinch.y)]);
    await send('touchEnd', []);
    assert.equal(await mobile.evaluate(() => transport.renderer.getCamera().zoom), 2, 'pinch snaps to the next of three crisp zoom levels');
    assert.equal(await snapshot(mobile, mobileSite), untouched, 'pinching cannot paint construction');
    await mobile.evaluate(() => transport.renderer.setZoom(1));
    await keyTool(mobile, 's', /Stop/);
    const [stop] = await points(mobile, [mobileSite.stop]);
    await send('touchStart', [touch(1, stop.x, stop.y)]);
    await send('touchMove', [touch(1, stop.x + 75, stop.y + 15)]);
    await send('touchEnd', []);
    assert.equal(await snapshot(mobile, mobileSite), untouched, 'a finger swipe cannot accidentally place a stop');
    const [tap] = await points(mobile, [mobileSite.stop]);
    await mobile.touchscreen.tap(tap.x, tap.y);
    assert.equal(await mobile.evaluate(p => transport.game.stations.find(s => s.x === p.x && s.y === p.y)?.mode, mobileSite.stop), 'road', 'a deliberate touch tap still places a contextual stop');
    await home(mobile);
    await mobile.locator('#zoom-level').click();
    await layout(mobile, ['#zoom-menu', '.view-controls']);
    await mobile.screenshot({ path: `${output}/mobile-${width}-zoom.png` });
    await mobile.keyboard.press('Escape');
    await mobile.locator('#map-options-button').click();
    await layout(mobile, ['#map-options', '#map-options-button']);
    await mobile.screenshot({ path: `${output}/mobile-${width}-map-options.png` });
    await mobile.close();
  }
  assert.deepEqual(errors, [], 'all controls run without uncaught browser errors');
  console.log(`Controls browser checks passed; screenshots: ${output}`);
} finally {
  await browser.close();
}
