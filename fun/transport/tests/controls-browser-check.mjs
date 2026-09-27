// Real pointer, keyboard and touch input in isolated browser contexts.
// Serve the repository root before running; the player's browser saves are untouched.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
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
  await createWorldFromMenu(page);
  return page;
}

async function fixture(page) {
  return page.evaluate(async () => {
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
    const { releaseTerrainObjects } = await import('./terrain-objects.js'), cleared = [];
    for (let dy = -3; dy <= 23; dy++) for (let dx = -3; dx <= 23; dx++) cleared.push({ x: x + dx, y: y + dy });
    releaseTerrainObjects(g, cleared);
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
    const box = document.querySelector('#world').getBoundingClientRect();
    return tiles.map(p => { const s = transport.renderer.worldToScreen(p.x, p.y); return { x: box.left + s.x, y: box.top + s.y }; });
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

// Stroke cancelling, edge clamping, Space after clicks and engineering keys, on a menu-created world.
async function strokeInput() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);
  const site = await fixture(page), open = site.open, row = { x: open.x + 5, y: open.y };
  // Read the live construction preview from what the renderer is asked to draw.
  await page.evaluate(() => { const r = transport.renderer, render = r.render; r.render = (now, state) => { window.previewTiles = state.preview.length; return render(now, state); }; });
  const previewTiles = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(window.previewTiles)))));
  const screen = tiles => page.evaluate(tiles => {
    const box = document.querySelector('#world').getBoundingClientRect();
    return tiles.map(p => { const s = transport.renderer.worldToScreen(p.x, p.y); return { x: box.left + s.x, y: box.top + s.y }; });
  }, tiles);
  const toolName = () => page.locator('#active-tool-name').innerText(), speed = () => page.evaluate(() => transport.speed);
  const press = async () => {
    const [a, b] = await screen([open, row]);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 });
    assert.equal(await previewTiles(), 6, 'a road drag previews its stroke');
    return b;
  };
  await page.evaluate(p => transport.renderer.focus(p.x + 2, p.y), open);

  for (const [first, last] of [['right', 'left'], ['left', 'right']]) {
    await keyTool(page, 'r', /Road/);
    const before = await snapshot(page, site), b = await press();
    await page.mouse.down({ button: 'right' });
    assert.equal(await previewTiles(), 0, 'a right press during a drag clears the stroke');
    assert.equal(await page.locator('#placement-tip').isVisible(), false);
    await page.mouse.move(b.x + 30, b.y + 15, { steps: 2 });
    await page.mouse.up({ button: first }); await page.mouse.up({ button: last });
    assert.equal(await snapshot(page, site), before, `releasing ${first} first never builds a right-cancelled stroke`);
    assert.equal(await toolName(), 'Road', 'right-click during a drag keeps the tool');
    assert.equal(await previewTiles(), 0);
  }
  let before = await snapshot(page, site);
  await press(); await page.keyboard.press('Escape');
  assert.equal(await previewTiles(), 0, 'Escape clears the stroke');
  await page.mouse.up();
  assert.equal(await snapshot(page, site), before, 'Escape cancels the stroke before release');
  assert.equal(await toolName(), 'Road', 'the first Escape keeps the tool');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#active-tool-bar').isVisible(), false, 'a second Escape finishes the tool');

  const edgeY = await page.evaluate(async () => {
    const g = transport.game, { releaseTerrainObjects } = await import('./terrain-objects.js'), cleared = [];
    let y = 120; while ([...g.cities, ...g.industries, ...g.stations].some(p => p.x < 16 && Math.abs(p.y - y) < 8)) y += 16;
    for (let dy = -3; dy <= 3; dy++) for (let x = 0; x <= 10; x++) cleared.push({ x, y: y + dy });
    releaseTerrainObjects(g, cleared);
    for (const p of cleared) Object.assign(g.tiles[p.y * g.width + p.x], { terrain: 'grass', detail: '', elevation: .2, variant: 0,
      road: false, rail: false, bridge: false, tunnel: false, publicRoad: false, building: null, zone: null });
    g.revision++; g.networkRevision++;
    return y;
  });
  await keyTool(page, 'r', /Road/);
  await page.evaluate(y => transport.renderer.focus(2, y), edgeY);
  const [inside] = await screen([{ x: 6, y: edgeY }]);
  await page.mouse.move(inside.x, inside.y); await page.mouse.down();
  await page.mouse.move(inside.x - 260, inside.y - 130, { steps: 8 });
  assert.equal(await previewTiles(), 7, 'a stroke dragged beyond the west edge ends at x=0');
  assert.equal(await page.locator('#placement-tip').isVisible(), true, 'the quote stays visible beyond the edge');
  assert.match(await page.locator('#placement-tip').innerText(), /7 tiles/);
  assert.match(await page.locator('#tile-coordinates').textContent(), new RegExp(`^0, ${edgeY} `));
  await page.screenshot({ path: `${output}/desktop-edge-stroke.png` });
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(y => Array.from({ length: 7 }, (_, x) => transport.game.tiles[y * transport.game.width + x].road), edgeY), Array(7).fill(true), 'the clamped stroke builds up to the edge');
  assert.doesNotMatch(await page.locator('#toast-region').innerText(), /boundary/);
  await page.keyboard.press('Escape');

  await page.locator('[data-speed="3"]').click();
  await page.keyboard.press('Space');
  assert.equal(await speed(), 0, 'Space pauses after clicking a speed button');
  await page.keyboard.press('Space');
  assert.equal(await speed(), 3, 'Space resumes after clicking a speed button');
  const routes = page.locator('.main-nav [data-view="routes"]'), drawer = () => page.locator('.sidebar').getAttribute('aria-hidden');
  await routes.click();
  const drawerState = await drawer();
  await page.keyboard.press('Space');
  assert.equal(await drawer(), drawerState, 'Space does not click the Routes button again');
  assert.equal(await speed(), 0, 'Space pauses after clicking a nav button');
  await page.locator('#route-search').click(); await page.keyboard.type('e');
  assert.equal(await page.locator('#route-search').inputValue(), 'e');
  assert.equal(await page.locator('#active-tool-bar').isVisible(), false, 'typing in route search never picks a tool');
  await routes.click();
  await page.locator('[data-speed="8"]').focus(); await page.keyboard.press('Space');
  assert.equal(await speed(), 8, 'a keyboard-focused speed button keeps native Space');
  await page.evaluate(() => transport.setSpeed(0));

  for (const [key, name] of [['KeyE', /Level land/], ['BracketLeft', /Lower land/], ['BracketRight', /Raise land/], ['KeyN', /Road tunnel/], ['b', /Road bridge/], ['t', /Rail/], ['b', /Rail bridge/], ['KeyN', /Rail tunnel/]]) await keyTool(page, key, name);
  assert.deepEqual(await page.locator('.engineering-tools .shortcut').allTextContents(), [']', '[', 'E', 'B', 'N'], 'engineering tools show their keys');
  // Physical positions on QWERTZ layouts: Czech + sits on Digit1, German + keeps zooming from BracketRight.
  const layoutKey = (key, code) => page.evaluate(([key, code]) => document.querySelector('#world').dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })), [key, code]);
  await layoutKey('+', 'Digit1');
  assert.match(await toolName(), /Residential/);
  const zoom = await page.evaluate(() => transport.renderer.getCamera().zoom);
  await layoutKey('+', 'BracketRight');
  assert.match(await toolName(), /Residential/);
  assert.equal(await page.evaluate(() => transport.renderer.getCamera().zoom), zoom * 2, 'a printed + still zooms in');
  await keyTool(page, 'KeyE', /Level land/);
  await page.locator('.main-nav [data-view="build"]').click();
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
  await page.locator('.engineering-tools').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop-engineering-keys.png` });
  await page.close();
}

// The tip, the highlights and the release agree: refused strokes cost nothing and name their problem tiles.
async function truthfulQuotes() {
  const page = await start({ width: 1440, height: 1000 });
  const tip = () => page.evaluate(() => { const t = document.querySelector('#placement-tip'); return { text: t.textContent, visible: !t.hidden, invalid: t.classList.contains('invalid'), partial: t.classList.contains('partial'), warning: t.classList.contains('warning') }; });
  const money = () => page.evaluate(() => transport.game.money), lastToast = () => page.evaluate(() => document.querySelector('#toast-region .toast:last-child')?.className);
  const hold = async (from, to) => { const [a, b] = await points(page, [from, to]); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); return tip(); };
  const hover = async tile => { const [p] = await points(page, [tile]); await page.mouse.move(p.x - 3, p.y); await page.mouse.move(p.x, p.y); return tip(); };
  await page.evaluate(() => transport.renderer.setZoom(1));
  await keyTool(page, 'r', /Road/);
  // Seed 1847: a straight drag at x=218 crosses two houses south of Alderbrook.
  let before = await money(), held = await hold({ x: 218, y: 254 }, { x: 218, y: 245 });
  assert.equal(held.invalid, true, 'a road through houses is refused before release');
  assert.equal(held.text, '2 tiles are blocked by buildings or zones — drag around them or bulldoze first');
  await page.screenshot({ path: `${output}/quote-blocked-road.png` });
  await page.mouse.up();
  assert.equal(await money(), before, 'the refused stroke spends nothing');
  assert.match(await lastToast(), /\berror\b/, 'a stroke that built nothing never shows a success toast');
  assert.doesNotMatch((await tip()).text, /blocked/, 'the tip re-quotes the tile under the pointer after release');
  held = await hold({ x: 218, y: 242 }, { x: 218, y: 244 });
  assert.match(held.text, /^Joins the ramp at 218, 245 from the side/, 'the tip names the old ramp the stroke would join sideways');
  await page.keyboard.press('Escape'); await page.mouse.up();
  const site = await fixture(page);
  await page.evaluate(({ x, y }) => { const g = transport.game; g.tiles[(y + 18) * g.width + x + 10].elevation = .2 + 1 / 7; g.money = 1000; g.revision++; }, site);
  await keyTool(page, 'Digit1', /Residential/);
  const zones = await page.evaluate(() => transport.game.zones.length);
  held = await hold(site.open, { x: site.open.x + 8, y: site.open.y });
  assert.equal(held.partial, true); assert.match(held.text, /Builds 2 of 9 · funds for 2$/, 'a zone drag says how much the balance covers');
  await page.screenshot({ path: `${output}/quote-partial-zones.png` });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => transport.game.zones.length), zones + 2, 'the balance buys exactly the two quoted zones');
  assert.match(await lastToast(), /\bwarning\b/, 'a partial build is a warning');
  await page.evaluate(() => { transport.game.money = 1_000_000; });
  await keyTool(page, 's', /Stop/);
  assert.deepEqual(await hover({ x: site.open.x, y: site.open.y + 2 }), { text: 'Build a road here first.', visible: true, invalid: true, partial: false, warning: false }, 'a stop on grass is refused in the tip');
  const lonely = await hover(site.stop);
  assert.equal(lonely.warning, true); assert.match(lonely.text, /No customers within 5 tiles$/);
  await page.evaluate(async () => { const { build } = await import('./model.js'); build(transport.game, 'road', 216, 254); });
  assert.match((await hover({ x: 216, y: 254 })).text, /^Road stop · \$[\d,]+ · Loads stone/, 'the stop tip names what the quarry stop will load');
  await page.screenshot({ path: `${output}/quote-stop-coverage.png` });
  await keyTool(page, 'x', /Bulldozer/);
  const served = await page.evaluate(() => { const g = transport.game, route = g.routes[0], stop = g.stations.find(s => s.id === route.stops[0]); return { stop: { x: stop.x, y: stop.y }, middle: route.path[Math.floor(route.path.length / 2)], name: route.name }; });
  assert.deepEqual(await hover(served.stop), { text: 'Retire routes using this station before removing it.', visible: true, invalid: true, partial: false, warning: false });
  const cut = await hover(served.middle);
  assert.equal(cut.warning, true); assert.ok(cut.text.endsWith(`breaks the ${served.name} route`), cut.text);
  await page.screenshot({ path: `${output}/quote-bulldoze-route.png` });
  // Only the one uneven tile of this L turns red; the rest of the refused stroke is muted.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const stroke = [...Array.from({ length: 6 }, (_, i) => ({ x: site.x + 5 + i, y: site.y + 19 })), { x: site.x + 10, y: site.y + 18 }];
  const redness = await page.evaluate(async stroke => {
    const { quoteBuildPlan } = await import('./construction-plan.js'), r = transport.renderer, ctx = document.querySelector('#world').getContext('2d'), d = devicePixelRatio || 1;
    r.setZoom(2); r.focus(stroke[3].x, stroke[3].y);
    const states = quoteBuildPlan(transport.game, 'road', stroke).placements.map(p => p.state);
    const sample = () => stroke.map(p => { const s = r.worldToScreen(p.x, p.y), data = ctx.getImageData(Math.round(s.x * d) - 4, Math.round(s.y * d) - 4, 8, 8).data; let red = 0, green = 0; for (let i = 0; i < data.length; i += 4) { red += data[i]; green += data[i + 1]; } return (red - green) / (data.length / 4); });
    for (let i = 0; i < 4; i++) r.render(0, { tool: 'road', preview: [] });
    const base = sample();
    r.render(0, { tool: 'road', preview: stroke, hover: stroke.at(-1) }); const held = sample();
    r.render(0, { tool: 'road', preview: [] });
    return { states, steady: sample().every((value, i) => Math.abs(value - base[i]) < 1), shift: held.map((value, i) => value - base[i]) };
  }, stroke);
  assert.deepEqual(redness.states, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'slope']);
  assert.equal(redness.steady, true, 'the map repaints identically without the preview');
  assert.ok(redness.shift.at(-1) > 12, `the uneven tile is drawn in the error colour: ${redness.shift}`);
  assert.ok(redness.shift.slice(0, -1).every(value => value < 7), `the rest of the refused stroke is muted, not red: ${redness.shift}`);
  await page.close();
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
  await page.locator('#game-menu-button').click(); await page.locator('#map-options-button').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#map-options').isVisible(), true, 'native Space opens Map options');
  assert.equal(await page.evaluate(() => transport.speed), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#map-options').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'game-menu-button');
  await openGameAction(page, 'map-options-button');
  await page.locator('#grid-button').click();
  assert.equal(await page.evaluate(() => transport.renderer.getLayers().grid), false, 'Grid remains functional inside Map options');
  if (!(await page.locator('#map-options').isVisible())) await openGameAction(page, 'map-options-button');
  await page.locator('#grid-button').click();
  if (!(await page.locator('#map-options').isVisible())) await openGameAction(page, 'map-options-button');
  await page.locator('#routes-toggle').click();
  assert.equal(await page.evaluate(() => transport.renderer.getLayers().routes), false);
  if (!(await page.locator('#map-options').isVisible())) await openGameAction(page, 'map-options-button');
  await page.locator('#routes-toggle').click();
  if (!(await page.locator('#map-options').isVisible())) await openGameAction(page, 'map-options-button');
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
  await openGameAction(page, 'map-options-button'); await page.locator('#home-view').click();
  await page.locator('#world').focus(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#toast-region .toast'));
}

// Only dialogs pinch-zoom the page; the game chrome never does, and a zoomed page can always pinch back out.
async function gestures(page, send, touch) {
  const size = page.viewportSize(), middle = { x: size.width / 2, y: size.height / 2 }, scale = () => page.evaluate(() => visualViewport.scale);
  const center = async selector => {
    const box = await page.locator(selector).boundingBox(), p = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 80) };
    assert.ok(await page.evaluate(({ p, selector }) => [p.x - 12, p.x + 12].every(x => document.elementFromPoint(x, p.y)?.closest(selector)), { p, selector }), `both fingers start on ${selector}`);
    return p;
  };
  const pinch = async ({ x, y }, from, to) => {
    const at = (id, dx) => touch(id, Math.max(4, Math.min(size.width - 4, x + dx)), y);
    await send('touchStart', [at(1, -from), at(2, from)]);
    for (let i = 1; i <= 8; i++) await send('touchMove', [at(1, -from - (to - from) * i / 8), at(2, from + (to - from) * i / 8)]);
    await send('touchEnd', []); await page.waitForTimeout(250);
  };
  await page.keyboard.press('Escape');
  for (const selector of ['.topbar', '.view-controls']) {
    await pinch(await center(selector), 12, 140);
    assert.equal(await scale(), 1, `a spread on ${selector} never zooms the page`);
  }
  await page.locator('.mobile-panel-toggle').click();
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
  await pinch(await center('.sidebar'), 12, 140);
  assert.equal(await scale(), 1, 'a spread on the drawer never zooms the page');
  const panel = await page.locator('#panel-content').boundingBox(), swipeX = panel.x + panel.width / 2, swipeY = panel.y + panel.height - 30;
  await page.locator('#panel-content').evaluate(el => { el.scrollTop = 0; });
  await send('touchStart', [touch(1, swipeX, swipeY)]);
  for (let i = 1; i <= 8; i++) await send('touchMove', [touch(1, swipeX, swipeY - i * 30)]);
  await send('touchEnd', []);
  assert.ok(await page.locator('#panel-content').evaluate(el => el.scrollTop) > 0, 'one finger still scrolls the drawer');
  await page.locator('#panel-content [data-tool="road"]').click(); await page.locator('#active-tool-bar').waitFor();
  await pinch(await center('#active-tool-bar'), 12, 140);
  assert.equal(await scale(), 1, 'a spread on the active tool bar never zooms the page');
  await page.locator('#cancel-tool-button').click();
  await page.evaluate(() => { const city = transport.game.cities[0]; transport.inspect(city.x, city.y); });
  await page.locator('#inspector').waitFor();
  await pinch(await center('#inspector'), 12, 140);
  assert.equal(await scale(), 1, 'a spread on the inspector never zooms the page');
  await page.locator('#world').focus(); await page.keyboard.press('Escape'); await page.locator('#inspector').waitFor({ state: 'hidden' });
  await openGameAction(page, 'help-button'); await page.locator('#modal').waitFor();
  await pinch(middle, 12, 140);
  assert.ok(await scale() > 1, 'the Field guide stays pinch-zoomable');
  await page.waitForFunction(() => document.querySelector('#app').classList.contains('page-zoomed'));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#modal').open);
  for (let i = 0; i < 3; i++) await pinch(middle, 90, 10);
  assert.ok(await scale() <= 1.01, 'pinching in over the map undoes a page zoom');
  await page.waitForFunction(() => !document.querySelector('#app').classList.contains('page-zoomed'), undefined, { timeout: 2000 }).catch(() => {});
  assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('page-zoomed')), false, 'the map takes pinches back once the page is at its normal size');
  await page.evaluate(() => transport.renderer.setZoom(1));
  assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, middle), 'world');
  await pinch(middle, 30, 90);
  assert.equal(await page.evaluate(() => transport.renderer.getCamera().zoom), 2, 'after recovery a map pinch steps the map zoom again');
  assert.equal(await scale(), 1);
}

try {
  await strokeInput();
  await truthfulQuotes();
  const page = await start({ width: 1440, height: 1000 });
  await page.locator('.main-nav [data-view="build"]').click(); await page.locator('.sidebar').waitFor({ state: 'visible' });
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
  await openGameAction(page, 'map-options-button');
  await page.mouse.click(outside.x, outside.y);
  assert.equal(await page.locator('#map-options').isVisible(), false, 'a map click dismisses Map options');
  assert.equal(await snapshot(page, site), before, 'dismissing a menu over the map cannot also build a road');
  await keyTool(page, 'p', /Port/); await clickTile(page, site.port);
  assert.equal(await page.evaluate(p => transport.game.stations.find(s => s.x === p.x && s.y === p.y)?.mode, site.port), 'water');
  await keyTool(page, 'x', /Bulldozer/); await clickTile(page, { x: site.road.x + 8, y: site.road.y });
  assert.equal(await page.evaluate(p => transport.game.tiles[p.y * transport.game.width + p.x].road, { x: site.road.x + 8, y: site.road.y }), false);
  await home(page);
  await page.locator('.main-nav [data-view="build"]').click(); await page.locator('[data-tool="road"]').click();
  await layout(page, ['#active-tool-bar', '#cancel-tool-button', '.view-controls', '#game-menu-button']);
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
    await layout(mobile, ['#active-tool-bar', '#cancel-tool-button', '.view-controls', '#game-menu-button']);
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
    await openGameAction(mobile, 'map-options-button');
    await layout(mobile, ['#map-options', '#game-menu-button']);
    await mobile.screenshot({ path: `${output}/mobile-${width}-map-options.png` });
    await gestures(mobile, send, touch);
    await mobile.screenshot({ path: `${output}/mobile-${width}-after-pinches.png` });
    await mobile.close();
  }
  assert.deepEqual(errors, [], 'all controls run without uncaught browser errors');
  console.log(`Controls browser checks passed; screenshots: ${output}`);
} finally {
  await browser.close();
}
