// Real pointer and keyboard input in isolated browser contexts.
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

async function start(viewport) {
  const page = await browser.newPage({ viewport });
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
  // Speed, F and the Shift panel keys follow the printed character on every layout.
  const typed = (key, code, shiftKey = false) => page.evaluate(([key, code, shiftKey]) => document.querySelector('#world').dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey, bubbles: true, cancelable: true })), [key, code, shiftKey]);
  await page.locator('#cancel-tool-button').click();
  await page.evaluate(() => transport.setSpeed(1));
  await typed('.', 'Comma', true);
  assert.equal(await speed(), 3, 'AZERTY: Shift+; types a full stop, which speeds up');
  await typed(',', 'KeyM');
  assert.equal(await speed(), 1, 'AZERTY: the comma on the M key slows down');
  await typed('?', 'Comma', true);
  await page.locator('#modal .shortcuts-dialog').waitFor();
  assert.equal(await speed(), 0, 'Czech QWERTZ: ? on the comma key opens the shortcuts sheet (a dialog pauses)');
  await page.keyboard.press('Escape'); await page.locator('#modal').waitFor({ state: 'hidden' });
  await typed('t', 'KeyF');
  assert.match(await toolName(), /^Rail/, 'Colemak: t on the F key picks Rail');
  await page.locator('#cancel-tool-button').click();
  await typed('G', 'KeyT', true);
  await page.locator('#modal').waitFor();
  assert.match(await page.locator('#modal h2').first().innerText(), /Company goals/, 'Colemak: Shift+G on the T key opens Company goals');
  await page.keyboard.press('Escape'); await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.evaluate(() => transport.setSpeed(0));
  await keyTool(page, 'KeyE', /Level land/);
  await page.locator('.main-nav [data-build-area="terrain"]').click();
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
  await page.locator('.engineering-tools').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop-engineering-keys.png` });
  await page.close();
}

// The tip, the highlights and the release agree: refused strokes cost nothing and name their problem tiles.
async function truthfulQuotes() {
  const page = await start({ width: 1440, height: 1000 });
  // The quote's own line: a zone forecast may follow it as a second line (city-investment-feedback).
  const tip = () => page.evaluate(() => { const t = document.querySelector('#placement-tip'); return { text: t.firstChild?.textContent ?? '', visible: !t.hidden, invalid: t.classList.contains('invalid'), partial: t.classList.contains('partial'), warning: t.classList.contains('warning') }; });
  const money = () => page.evaluate(() => transport.game.money), lastToast = () => page.evaluate(() => document.querySelector('#toast-region .toast:last-child')?.className);
  const hold = async (from, to) => { const [a, b] = await points(page, [from, to]); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); return tip(); };
  const hover = async tile => { const [p] = await points(page, [tile]); await page.mouse.move(p.x - 3, p.y); await page.mouse.move(p.x, p.y); return tip(); };
  await page.evaluate(() => transport.renderer.setZoom(1));
  await keyTool(page, 'r', /Road/);
  // Seed 1847: a straight drag at x=218 crosses two houses south of Alderbrook. No gentle route
  // leads around them either; Shift keeps the plain line, which names the houses.
  let before = await money(), held = await hold({ x: 218, y: 254 }, { x: 218, y: 245 });
  assert.equal(held.invalid, true, 'a road through houses is refused before release');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.keyboard.down('Shift');
  held = await hold({ x: 218, y: 254 }, { x: 218, y: 245 });
  assert.equal(held.text, '2 tiles are blocked by buildings or zones. Drag around them, or bulldoze first.');
  await page.screenshot({ path: `${output}/quote-blocked-road.png` });
  await page.mouse.up(); await page.keyboard.up('Shift');
  assert.equal(await money(), before, 'the refused stroke spends nothing');
  assert.match(await lastToast(), /\berror\b/, 'a stroke that built nothing never shows a success toast');
  assert.doesNotMatch((await tip()).text, /blocked/, 'the tip re-quotes the tile under the pointer after release');
  const protectedGround=()=>page.evaluate(()=>{const g=transport.game;return JSON.stringify({money:g.money,revision:g.revision,tiles:[242,243,244].map(y=>g.tiles[y*g.width+218])});}),protectedBefore=await protectedGround();
  held = await hold({ x: 218, y: 242 }, { x: 218, y: 244 });
  assert.equal(held.invalid,true);
  assert.equal(held.text,'A building or zone is in the way. Clear it first, then build here.','automatic leveling still refuses the protected site beside the ramp');
  await page.mouse.up();
  assert.equal(await protectedGround(),protectedBefore,'a refused stroke changes neither funds nor protected ground');
  const site = await fixture(page);
  await page.evaluate(({ x, y }) => { const g = transport.game; g.tiles[(y + 18) * g.width + x + 10].elevation = .2 + 1 / 7; g.money = 1000; g.revision++; }, site);
  await keyTool(page, 'Digit1', /Residential/);
  const zones = await page.evaluate(() => transport.game.zones.length);
  held = await hold(site.open, { x: site.open.x + 8, y: site.open.y });
  assert.equal(held.partial, true); assert.match(held.text, /Builds 2 of 9\. Funds cover 2\.$/, 'a zone drag says how much the balance covers');
  await page.screenshot({ path: `${output}/quote-partial-zones.png` });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => transport.game.zones.length), zones + 2, 'the balance buys exactly the two quoted zones');
  assert.match(await lastToast(), /\bwarning\b/, 'a partial build is a warning');
  await page.evaluate(() => { transport.game.money = 1_000_000; });
  await keyTool(page, 's', /Stop/);
  const grassStop = { x: site.open.x, y: site.open.y + 2 }, included = await hover(grassStop);
  assert.deepEqual({ ...included, text: '' }, { text: '', visible: true, invalid: false, partial: false, warning: true }, 'a stop on grass includes its missing road');
  assert.match(included.text, /^Road stop · \$[\d,]+ · road included · No customers within 4 tiles$/);
  before = await money();
  await clickTile(page, grassStop);
  assert.deepEqual(await page.evaluate(p => ({ road: transport.game.tiles[p.y * transport.game.width + p.x].road, stop: transport.game.stations.find(s => s.x === p.x && s.y === p.y)?.mode }), grassStop), { road: true, stop: 'road' }, 'release places both the road and its stop');
  assert.equal(before - await money(), Number(included.text.match(/\$([\d,]+)/)[1].replaceAll(',', '')), 'the road and stop cost matches the displayed quote');
  await keyTool(page, 's', /Stop/);
  const lonely = await hover(site.stop);
  assert.equal(lonely.warning, true); assert.match(lonely.text, /No customers within 4 tiles$/);
  await page.evaluate(async () => { const { build } = await import('./model.js'); build(transport.game, 'road', 216, 254); });
  assert.match((await hover({ x: 216, y: 254 })).text, /^Road stop · \$[\d,]+ · Loads stone/, 'the stop tip names what the quarry stop will load');
  await page.screenshot({ path: `${output}/quote-stop-coverage.png` });
  await keyTool(page, 'x', /Bulldozer/);
  const served = await page.evaluate(() => { const g = transport.game, route = g.routes[0], stop = g.stations.find(s => s.id === route.stops[0]); return { stop: { x: stop.x, y: stop.y }, middle: route.path[Math.floor(route.path.length / 2)], name: route.name }; });
  assert.deepEqual(await hover(served.stop), { text: `${served.name} uses this stop. Retire the route first, then remove the stop.`, visible: true, invalid: true, partial: false, warning: false }, 'the refusal names the route that holds the stop');
  const cut = await hover(served.middle);
  assert.equal(cut.warning, true); assert.ok(cut.text.endsWith(`breaks the ${served.name} route`), cut.text);
  await page.screenshot({ path: `${output}/quote-bulldoze-route.png` });
  // Only the protected last tile of this L turns red; the rest of the refused stroke is muted.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const stroke = [...Array.from({ length: 6 }, (_, i) => ({ x: site.x + 5 + i, y: site.y + 19 })), { x: site.x + 10, y: site.y + 18 }];
  const redness = await page.evaluate(async stroke => {
    const { quoteBuildPlan } = await import('./construction-plan.js'), r = transport.renderer, ctx = document.querySelector('#world').getContext('2d'), d = devicePixelRatio || 1;
    const last=stroke.at(-1),game=transport.game;game.tiles[last.y*game.width+last.x].zone='residential';game.revision++;
    r.setZoom(2); r.focus(stroke[3].x, stroke[3].y);
    const states = quoteBuildPlan(transport.game, 'road', stroke).placements.map(p => p.state);
    const sample = () => stroke.map(p => { const s = r.worldToScreen(p.x, p.y), data = ctx.getImageData(Math.round(s.x * d) - 4, Math.round(s.y * d) - 4, 8, 8).data; let red = 0, green = 0; for (let i = 0; i < data.length; i += 4) { red += data[i]; green += data[i + 1]; } return (red - green) / (data.length / 4); });
    for (let i = 0; i < 4; i++) r.render(0, { tool: 'road', preview: [] });
    const base = sample();
    r.render(0, { tool: 'road', preview: stroke, hover: stroke.at(-1) }); const held = sample();
    r.render(0, { tool: 'road', preview: [] });
    return { states, steady: sample().every((value, i) => Math.abs(value - base[i]) < 1), shift: held.map((value, i) => value - base[i]) };
  }, stroke);
  assert.deepEqual(redness.states, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'blocked']);
  assert.equal(redness.steady, true, 'the map repaints identically without the preview');
  assert.ok(redness.shift.at(-1) > 12, `the protected tile is drawn in the error colour: ${redness.shift}`);
  // The muted wash shifts with the ground's own colour, so it is measured against the error tile.
  assert.ok(redness.shift.slice(0, -1).every(value => value < redness.shift.at(-1) / 3), `the rest of the refused stroke is muted, not red: ${redness.shift}`);
  await page.close();
}

// A diagonal zone drag fills the rectangle on both sides of a street in one stroke and leaves the road alone.
async function areaZoning() {
  const page = await start({ width: 1440, height: 1000 }), site = await fixture(page), { x, y } = site;
  // The quote's own line: a zone forecast may follow it as a second line (city-investment-feedback).
  const tip = () => page.evaluate(() => { const t = document.querySelector('#placement-tip'); return { text: t.firstChild?.textContent ?? '', warning: t.classList.contains('warning') }; });
  const hold = async (from, to) => { const [a, b] = await points(page, [from, to]); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); return tip(); };
  const street = await page.evaluate(async ({ x, y }) => { const { build } = await import('./model.js'), g = transport.game; for (let dx = 2; dx <= 14; dx++) build(g, 'road', x + dx, y + 14); return JSON.stringify(Array.from({ length: 13 }, (_, i) => g.tiles[(y + 14) * g.width + x + 2 + i])); }, site);
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('#toast-region .toast')].map(t => t.textContent));
  await keyTool(page, 'Digit1', /Residential/);
  const before = await toasts(), zones = await page.evaluate(() => transport.game.zones.length);
  let held = await hold({ x: x + 4, y: y + 12 }, { x: x + 9, y: y + 16 });
  assert.match(held.text, /^Residential · 6 × 5 · 24 tiles · 12 need a road · \$[\d,]+$/, 'the tip names the rectangle, its tiles and those no road reaches');
  assert.equal(held.warning, true);
  await page.screenshot({ path: `${output}/area-zoning-held.png` });
  await page.mouse.up();
  const after = await toasts(), zoned = await page.evaluate(({ x, y }) => { const g = transport.game, row = dy => Array.from({ length: 6 }, (_, i) => g.tiles[(y + dy) * g.width + x + 4 + i].zone); return { count: g.zones.length, rows: [12, 13, 14, 15, 16].map(row), street: JSON.stringify(Array.from({ length: 13 }, (_, i) => g.tiles[(y + 14) * g.width + x + 2 + i])) }; }, site);
  assert.equal(zoned.count, zones + 24, 'one drag zones both sides of the street');
  assert.deepEqual(zoned.rows.map(row => row.every(zone => zone === 'residential')), [true, true, false, true, true]);
  assert.equal(zoned.street, street, 'the street is unchanged');
  assert.equal(after.length, before.length + 1, 'the rectangle reports once'); assert.match(after.at(-1), /^Built 24 tiles\. \$[\d,]+ spent\./);
  await page.screenshot({ path: `${output}/area-zoning-built.png` });
  await page.keyboard.down('Shift');
  held = await hold({ x: x + 4, y: y + 19 }, { x: x + 9, y: y + 20 });
  assert.match(held.text, /^Residential · 7 tiles · 7 need a road · \$[\d,]+$/, 'Shift keeps the line');
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Shift');
  held = await hold({ x, y: y + 2 }, { x: x + 21, y: y + 21 });
  assert.match(held.text, /^Residential · 16 × 16 · .* · max 16 × 16$/, 'the rectangle stops at 16 tiles a side');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await keyTool(page, 'x', /Bulldozer/);
  await page.keyboard.down('Shift');
  held = await hold({ x: x + 3, y: y + 12 }, { x: x + 10, y: y + 16 });
  assert.match(held.text, /^Bulldozer · 8 × 5 · \$[\d,]+ · 32 sites$/, 'Shift turns the Bulldozer into a rectangle that counts sites, not empty ground');
  await page.screenshot({ path: `${output}/area-bulldoze-held.png` });
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => transport.game.zones.length), zones + 24, 'cancelled rectangles change nothing');
  await page.close();
}

// A Road drag the plain L would refuse follows the terrain around a house and a crown; Shift keeps the red L.
async function terrainRoutes() {
  const page = await start({ width: 1440, height: 1000 }), site = await fixture(page);
  const { a, b } = await page.evaluate(async ({ x, y }) => {
    const g = transport.game, { placeBuildingSite } = await import('./building-sites.js');
    placeBuildingSite(g, 'house-expensive-1', x + 8, y + 19);
    g.tiles[(y + 20) * g.width + x + 13].elevation = .2 + 1 / 7; g.revision++;
    return { a: { x: x + 3, y: y + 20 }, b: { x: x + 17, y: y + 20 } };
  }, site);
  await page.evaluate(() => { const r = transport.renderer, render = r.render; r.render = (now, state) => { window.previewPath = state.preview.map(p => `${p.x},${p.y}`); return render(now, state); }; });
  const preview = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(window.previewPath)))));
  const tip = () => page.evaluate(() => { const t = document.querySelector('#placement-tip'); return { text: t.textContent, invalid: t.classList.contains('invalid'), partial: t.classList.contains('partial') }; });
  const money = () => page.evaluate(() => transport.game.money), before = await money();
  await keyTool(page, 'r', /Road/);
  const [from, to] = await points(page, [a, b]);
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 });
  let held = await tip();
  assert.equal(held.invalid, true, 'Shift keeps the refused straight line');
  assert.match(held.text, /^2 tiles are blocked by buildings or zones\. Drag around them, or bulldoze first\./);
  assert.deepEqual(await preview(), Array.from({ length: 15 }, (_, i) => `${a.x + i},${a.y}`), 'Shift previews the plain line');
  await page.screenshot({ path: `${output}/terrain-route-shift.png` });
  await page.mouse.up(); await page.keyboard.up('Shift');
  assert.equal(await money(), before, 'the refused Shift stroke builds nothing');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 });
  held = await tip();
  assert.equal(held.invalid, false, held.text); assert.equal(held.partial, false);
  assert.match(held.text, /^Road · \$[\d,]+ · \d+ tiles · follows\sterrain · Shift:\sstraight$/, 'the tip says the drag follows the terrain');
  const path = await preview(), blocked = ['8,19', '9,19', '8,20', '9,20', '12,19', '13,19', '12,20', '13,20'].map(p => p.split(',').map(Number)).map(([dx, dy]) => `${site.x + dx},${site.y + dy}`);
  assert.equal(path[0], `${a.x},${a.y}`); assert.equal(path.at(-1), `${b.x},${b.y}`);
  assert.ok(path.length > 15 && !path.some(p => blocked.includes(p)), `the preview steps around the house and the crown: ${path}`);
  await page.screenshot({ path: `${output}/terrain-route.png` });
  await page.mouse.up();
  assert.equal(before - await money(), Number(held.text.match(/\$([\d,]+)/)[1].replaceAll(',', '')), 'the release spends exactly the quoted amount');
  assert.ok(await page.evaluate(async ({ a, b }) => { const { findPath } = await import('./model.js'); return Boolean(findPath(transport.game, a, b, 'road')); }, { a, b }), 'the routed road connects both ends');
  await page.close();
}

async function clickTile(page, tile) {
  const [p] = await points(page, [tile]);
  await page.mouse.click(p.x, p.y);
}

// Ctrl/Cmd+Z and the result toast's Undo reverse the latest build; the route planner follows the network.
async function constructionUndo() {
  const page = await start({ width: 1440, height: 1000 });
  const site = await fixture(page), { x, y } = site.open, gap = [{ x: x + 2, y }, { x: x + 4, y }];
  await page.evaluate(async ({ x, y }) => {
    const g = transport.game, { build } = await import('./model.js');
    for (const dx of [0, 1, 5, 6]) g.tiles[y * g.width + x + dx].road = true;
    g.networkRevision++; g.revision++;
    build(g, 'bus-stop', x, y); build(g, 'bus-stop', x + 6, y);
  }, site.open);
  const state = () => page.evaluate(({ x, y }) => { const g = transport.game; return JSON.stringify({ tiles: g.tiles.slice(y * g.width + x - 3, y * g.width + x + 10), money: g.money, expenses: g.totalExpenses, stations: g.stations.length }); }, site.open);
  const connection = () => page.locator('#route-connection').getAttribute('data-state');
  const stops = await page.evaluate(() => transport.game.stations.slice(-2).map(stop => stop.id));
  await page.evaluate(() => transport.setView('routes'));
  if (!await page.locator('#route-form').isVisible()) await page.locator('#new-route-button').click();
  await page.locator('#route-form [name=from]').selectOption(stops[0]);
  await page.locator('#route-form [name=to]').selectOption(stops[1]);
  assert.equal(await connection(), 'disconnected', 'the planner sees the gap');
  const before = await state();
  await keyTool(page, 'r', /Road/);
  await drag(page, ...gap);
  assert.notEqual(await state(), before, 'the road fills the gap');
  const undo = page.locator('#toast-region .toast-action', { hasText: 'Undo' });
  await undo.waitFor(); await undo.evaluate(el => Promise.all(el.closest('.toast').getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: `${output}/desktop-undo-toast.png` });
  await page.evaluate(() => transport.setView('routes'));
  await page.locator('#new-route-button').click();
  // New route starts an empty draft; select the same stops to check the changed network.
  await page.locator('#route-form [name=from]').selectOption(stops[0]);
  await page.locator('#route-form [name=to]').selectOption(stops[1]);
  assert.equal(await connection(), 'connected');
  await page.locator('#world').focus(); await page.keyboard.press('Control+z');
  assert.equal(await state(), before, 'Ctrl+Z restores the tiles, the balance and the expenses');
  assert.equal(await connection(), 'disconnected', 'the open route planner updates after the undo');
  assert.match(await page.locator('#toast-region').innerText(), /Road removed\. \$[\d,]+ refunded\./);
  assert.equal(await undo.count(), 0, "the undone build's toast closes with its Undo");
  await page.keyboard.press('Meta+z');
  assert.match(await page.locator('#toast-region').innerText(), /Nothing to undo/, 'Cmd+Z answers when nothing is left');
  await keyTool(page, 'r', /Road/);
  await drag(page, ...gap);
  await undo.last().click();
  assert.equal(await state(), before, "the toast's Undo restores the build too");
  const placed = () => page.evaluate(p => transport.game.stations.some(stop => stop.x === p.x && stop.y === p.y), site.stop);
  await keyTool(page, 's', /Stop/); await clickTile(page, site.stop);
  assert.equal(await placed(), true);
  await page.locator('#world').focus(); await page.keyboard.press('Control+z');
  assert.equal(await placed(), false, 'a single stop undoes');
  await page.close();
}

// Keyboard play: Enter shows a tile cursor in the middle of the view, arrows step it along the grid,
// Enter builds, picks or inspects under it, and Escape steps back one stage at a time.
async function keyboardCursor() {
  const page = await start({ width: 1440, height: 1000 }), site = await fixture(page), { x, y } = site.open;
  await page.evaluate(() => { const r = transport.renderer, render = r.render; r.render = (now, state) => { window.cursorState = { hover: state.hover && { ...state.hover }, preview: state.preview.length }; return render(now, state); }; });
  const drawn = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(window.cursorState)))));
  const cursor = (x, y, preview = 0) => ({ hover: { x, y, keyboard: true }, preview });
  const spoken = pattern => page.waitForFunction(source => new RegExp(source).test(document.querySelector('#map-cursor-status').textContent), pattern.source).then(() => page.locator('#map-cursor-status').textContent());
  const active = () => page.evaluate(() => document.activeElement?.id);
  const toolBar = () => page.locator('#active-tool-bar').isVisible();
  const stopAt = p => page.evaluate(p => transport.game.stations.find(s => s.x === p.x && s.y === p.y), p);
  await page.evaluate(p => transport.renderer.focus(p.x, p.y), site.open);
  for (let tabs = 0; await active() !== 'world' && tabs < 30; tabs++) await page.keyboard.press('Tab');
  assert.equal(await active(), 'world', 'Tab reaches the map');
  assert.match(await page.locator('#world').getAttribute('aria-label'), /Enter/, 'the map names its keyboard controls');

  await page.keyboard.press('r'); await page.keyboard.press('Enter');
  assert.deepEqual(await drawn(), cursor(x, y, 1), 'Enter shows the cursor in the middle of the view and starts the road there');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  assert.deepEqual(await drawn(), cursor(x + 3, y, 4), 'each arrow steps one tile along the grid');
  const tip = await page.locator('#placement-tip').innerText(), quote = Number(tip.match(/\$([\d,]+)/)[1].replaceAll(',', '')), money = await page.evaluate(() => transport.game.money);
  assert.match(tip, /^Road · \$[\d,]+ · 4 tiles/, 'the tip quotes the keyboard stroke');
  assert.match(await spoken(/4 tiles/), new RegExp(`^${x + 3}, ${y} · Open countryside · Road · \\$[\\d,]+ · 4 tiles`), 'the live region reads the tile, place, tool and cost');
  await page.screenshot({ path: `${output}/desktop-keyboard-road.png` });
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(({ x, y }) => Array.from({ length: 4 }, (_, dx) => transport.game.tiles[y * transport.game.width + x + dx].road), site.open), [true, true, true, true], 'the second Enter builds four road tiles');
  assert.equal(money - await page.evaluate(() => transport.game.money), quote, 'the keyboard build spends exactly the quote');
  assert.deepEqual(await drawn(), cursor(x + 3, y), 'the cursor stays at the end of the new road');

  await page.keyboard.press('s'); await page.keyboard.press('Enter');
  assert.equal((await stopAt({ x: x + 3, y }))?.mode, 'road', 'S and Enter place a stop on the road under the cursor');
  assert.equal(await toolBar(), false, 'finishing a stop returns to Explore');
  assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false', 'finishing a stop opens Build for the next action');
  await page.keyboard.press('s');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  const stops = [String((await stopAt({ x, y })).id), String((await stopAt({ x: x + 3, y })).id)];
  await page.screenshot({ path: `${output}/desktop-keyboard-stop.png` });
  await page.evaluate(({ x, y }) => {
    // Give this empty countryside fixture a real source so finishing the map pick can focus a cargo choice.
    transport.game.industries.push({ id:'keyboard-quarry',kind:'quarry',x:x-2,y:y+2,footprint:1,inventory:{stone:100},capacity:1,activity:0 });
    transport.game.revision++;
  }, site.open);

  await page.evaluate(() => transport.setView('routes'));
  if (!await page.locator('#route-form').isVisible()) await page.locator('#new-route-button').click();
  await page.locator('[data-pick-route="from"]').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'world' && document.querySelector('#route-pick-banner'));
  assert.deepEqual(await drawn(), cursor(x, y), 'the cursor waits on the last stop while picking');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  assert.match(await spoken(/Enter picks/), /· Enter picks it as the end stop$/);
  await page.keyboard.press('Enter');
  await page.locator('#route-form').waitFor();
  assert.deepEqual([await page.locator('#route-form [name=from]').inputValue(), await page.locator('#route-form [name=to]').inputValue()], stops, 'Enter picks the start and end stops under the cursor');
  await page.waitForFunction(() => document.activeElement?.matches('[data-cargo-choice]'), undefined, { timeout: 2000 });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.cargoChoice), 'stone', 'the finished pick moves focus to the supplied cargo');
  assert.equal(await page.locator('[data-cargo-choice][aria-pressed="true"]').count(), 0, 'picking stops leaves cargo for the player to choose');
  assert.equal(await page.locator('#route-launch').isHidden(), true, 'picking stops does not skip to launching');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-cargo-choice="stone"]').getAttribute('aria-pressed'), 'true', 'Enter explicitly chooses the focused cargo');

  await page.locator('#world').focus(); await page.keyboard.press('r');
  assert.deepEqual(await drawn(), cursor(x + 3, y), 'a tool key keeps the cursor');
  await page.keyboard.press('Enter');
  assert.deepEqual(await drawn(), cursor(x + 3, y, 1));
  await page.keyboard.press('Escape');
  assert.deepEqual(await drawn(), cursor(x + 3, y), 'the first Escape drops the line start');
  await page.keyboard.press('Escape');
  assert.deepEqual(await drawn(), { hover: null, preview: 0 }, 'the next Escape hides the cursor');
  assert.equal(await toolBar(), true, 'and keeps the tool');
  await page.keyboard.press('Escape');
  assert.equal(await toolBar(), false, 'the last Escape finishes the tool');

  const town = await page.evaluate(() => { const g = transport.game, c = g.cities.find(c => !g.stations.some(s => s.x === c.x && s.y === c.y)); transport.renderer.focus(c.x, c.y); return { x: c.x, y: c.y, name: c.name }; });
  await page.keyboard.press('Enter');
  assert.deepEqual(await drawn(), cursor(town.x, town.y), 'in Explore the first Enter only shows the cursor');
  assert.equal(await page.locator('#inspector').isVisible(), false);
  assert.equal(await spoken(/Explore$/), `${town.x}, ${town.y} · ${town.name} · Explore`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'inspector-title');
  assert.match(await page.locator('#inspector').ariaSnapshot(), new RegExp(`^- region "${town.name}"`), 'Enter on a town inspects it and lands on the labelled heading');
  await page.screenshot({ path: `${output}/desktop-keyboard-town.png` });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inspector').isVisible(), false);
  assert.equal(await active(), 'world', 'Escape in the inspector returns to the map');
  assert.deepEqual(await drawn(), cursor(town.x, town.y), 'with the cursor where it was');

  const camera = await page.evaluate(() => transport.renderer.getCamera());
  await page.keyboard.press('Shift+ArrowRight');
  assert.notEqual(await page.evaluate(() => transport.renderer.getCamera().x), camera.x, 'Shift and an arrow pan the map');
  assert.deepEqual(await drawn(), cursor(town.x, town.y), 'without moving the cursor');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await drawn(), cursor(town.x, town.y + 1));
  const [free] = await points(page, [site.open]);
  await page.mouse.move(free.x, free.y); await page.mouse.move(free.x + 6, free.y + 3);
  assert.equal((await drawn()).hover?.keyboard, undefined, 'moving the mouse over the map hands control back to the pointer');
  assert.equal(await page.locator('#map-cursor-status').evaluate(el => el.getAttribute('aria-live')), 'polite');
  await page.close();
}

// Long strokes scroll the map at its edge and follow keyboard pans.
async function longStrokes() {
  const watch = async page => {
    await page.evaluate(() => { const r = transport.renderer, render = r.render; r.render = (now, state) => { const end = state.preview.at(-1); window.stroke = { hover: state.hover && { x: state.hover.x, y: state.hover.y }, selected: state.selected && { x: state.selected.x, y: state.selected.y }, preview: state.preview.length, end: end && `${end.x},${end.y}`, tip: document.querySelector('#placement-tip').textContent }; return render(now, state); }; });
    return () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(window.stroke)))));
  };
  const camera = page => page.evaluate(() => transport.renderer.getCamera());
  const page = await start({ width: 1280, height: 800 }), site = await fixture(page), drawn = await watch(page);
  await keyTool(page, 'r', /Road/);
  const [a] = await points(page, [site.open]), world = await page.locator('#world').boundingBox();
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(world.x + world.width - 10, a.y, { steps: 8 });
  const held = await drawn(), from = await camera(page);
  await page.waitForTimeout(600);
  const later = await drawn();
  assert.notEqual((await camera(page)).x, from.x, 'a road held at the right edge scrolls the map');
  assert.ok(later.preview > held.preview, `the held stroke grows while the map scrolls: ${held.preview} → ${later.preview}`);
  assert.match(later.tip, new RegExp(`· ${later.preview} tiles`), 'the tip quotes the grown stroke');
  await page.screenshot({ path: `${output}/desktop-edge-scroll.png` });
  await page.keyboard.press('Escape'); await page.mouse.up();
  const [b, c] = await points(page, [site.open, { x: site.open.x + 4, y: site.open.y }]);
  await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 4 });
  const still = { tip: await page.locator('#placement-tip').textContent(), end: (await drawn()).end };
  await page.keyboard.press('ArrowUp');
  const panned = { tip: await page.locator('#placement-tip').textContent(), end: (await drawn()).end };
  assert.ok(panned.end !== still.end || panned.tip !== still.tip, `ArrowUp mid-drag moves the stroke's end with the map: ${JSON.stringify([still, panned])}`);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.close();

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
    // Wait for the drawer's slide-in transition before measuring.
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


try {
  await strokeInput();
  await truthfulQuotes();
  await terrainRoutes();
  await constructionUndo();
  await keyboardCursor();
  await longStrokes();
  await areaZoning();
  const page = await start({ width: 1440, height: 1000 });
  await page.locator('.main-nav [data-build-area="network"]').click(); await page.locator('.sidebar').waitFor({ state: 'visible' });
  assert.deepEqual(await page.locator('#panel-content > .tool-grid [data-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.tool)), ['road', 'rail', 'stop', 'port', 'airport'], 'Transport contains five network tools; terrain has its own area');
  assert.equal(await page.locator('#panel-content [data-tool="inspect"]').count(), 0, 'no Explore box: Done and Esc end a tool (DESIGN.md 11.2)');
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
  for (const [point, mode] of [[site.road, 'road'], [site.rail, 'rail']]) {
    await keyTool(page, 's', /Stop/);
    await clickTile(page, point);
    assert.equal(await page.evaluate(p => transport.game.stations.find(s => s.x === p.x && s.y === p.y)?.mode, point), mode, 'Stop detects the network beneath it');
    assert.equal(await page.locator('#active-tool-bar').isVisible(), false, 'a completed stop finishes the tool');
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false', 'a completed stop opens Build');
  }
  await keyTool(page, 's', /Stop/);
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
  await page.locator('.main-nav [data-build-area="network"]').click(); await page.locator('[data-tool="road"]').click();
  await layout(page, ['#active-tool-bar', '#cancel-tool-button', '.view-controls', '#game-menu-button']);
  await page.screenshot({ path: `${output}/desktop-simple-controls.png` });
  await page.locator('#cancel-tool-button').click(); await page.locator('#zoom-level').click();
  await page.screenshot({ path: `${output}/desktop-zoom-menu.png` });
  await page.close();

  assert.deepEqual(errors, [], 'all controls run without uncaught browser errors');
  console.log(`Controls browser checks passed; screenshots: ${output}`);
} finally {
  await browser.close();
}
