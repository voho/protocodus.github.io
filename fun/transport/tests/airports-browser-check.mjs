// Airports and flights in a real browser (seed 1847): the 1952 debut, placing and turning a 6 × 2 site, footprint
// lookups, an air route between two towns, planes on the ground and aloft, lights, layers, the art's weight beside
// the houses, saves and bulldozing. Serve the repository root first; storage is isolated.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-airports-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); };
// Fernford's site (pointer at the runway's middle) and Elmhaven's, 108 path tiles apart.
const FERN = { pointer: { x: 194, y: 200 }, anchor: { x: 192, y: 200 }, axis: 'x' }, ELM = { pointer: { x: 230, y: 272 }, anchor: { x: 230, y: 270 }, axis: 'y' };
const screenOf = (page, p) => page.evaluate(({ x, y }) => { const r = document.querySelector('#world').getBoundingClientRect(), s = transport.renderer.worldToScreen(x, y); return { x: r.left + s.x, y: r.top + s.y }; }, p);
async function hoverTile(page, p) {
  await page.evaluate(({ x, y }) => transport.renderer.focus(x, y), p);
  const at = await screenOf(page, p);
  await page.mouse.move(at.x - 3, at.y - 2); await page.mouse.move(at.x, at.y);
  assert.deepEqual(await page.evaluate(at => transport.renderer.screenToTile(at.x, at.y), at), p, 'the pointer rests on the intended tile');
  return at;
}
const toastText = page => page.locator('#toast-region .toast').allTextContents().then(list => list.join(' | '));
const money = page => page.evaluate(() => transport.game.money);
const canvasCrop = (page, rect) => page.evaluate(rect => { const c = document.querySelector('#world'), d = devicePixelRatio || 1; return Array.from(c.getContext('2d').getImageData(Math.round(rect.x * d), Math.round(rect.y * d), Math.max(1, Math.round(rect.w * d)), Math.max(1, Math.round(rect.h * d))).data); }, rect);
const differs = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n; };
async function chooseView(page, view) {
  const button = page.locator(`.main-nav [data-view="${view}"]`);
  const open = await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open'));
  if (!open || !(await button.evaluate(el => el.classList.contains('active')))) await button.click();
}
const networkCards = page => page.locator('#panel-content > .tool-grid').first().locator('.tool-card');

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page, { biome: 'taiga', size: 'square512', seed: 1847 });
  await page.addStyleTag({ content: '#objective-card{display:none!important}' });

  // 1. Before 1952 the Airport card waits with its year; A only says when.
  await chooseView(page, 'build');
  await page.locator('[data-category="network"]').click();
  assert.equal(await networkCards(page).count(), 6, 'Road, Rail, Stop, Port, Airport and Bulldozer');
  const card = page.locator('#panel-content [data-tool="airport"]');
  assert.equal(await card.getAttribute('aria-disabled'), 'true');
  assert.match(await card.textContent(), /From 1952/);
  await page.screenshot({ path: `${output}/build-1950.png` });
  await card.click({ force: true }); // aria-disabled keeps the card clickable: it explains the date
  assert.match(await toastText(page), /Air travel arrives on 1 January 1952\./);
  assert.equal(await page.evaluate(() => document.querySelector('#active-tool-bar').hidden), true, 'the tool stays Explore');
  await page.locator('#world').focus(); await page.keyboard.press('a');
  assert.equal(await page.locator('#active-tool-bar').isHidden(), true, 'A before 1952 keeps Explore');
  assert.equal(await page.evaluate(async () => (await import('./model.js')).build(transport.game, 'airport-x', 192, 200).message), 'Air travel arrives on 1 January 1952.');

  // 2. The date arrives during play: the card enables itself and the news comes once.
  await page.evaluate(() => { const g = transport.game; g.day = 729.8; g.lastDailyDay = 729; g.lastMonth = 23; });
  await page.locator('[data-speed="1"]').click();
  await page.waitForFunction(() => transport.game.day >= 730.1, undefined, { timeout: 30000 });
  await page.locator('[data-speed="0"]').click();
  await page.waitForFunction(() => !document.querySelector('#panel-content [data-tool="airport"]')?.hasAttribute('aria-disabled'), undefined, { timeout: 5000 });
  await page.waitForFunction(() => transport.headline === 'debut:air', undefined, { timeout: 20000 });
  assert.equal(await page.evaluate(() => transport.game.headlines.filter(entry => entry.key === 'debut:air').length), 1, 'News keeps one debut entry');
  assert.match(await page.locator('.headline-card').textContent(), /Air travel arrives/);
  assert.match(await page.locator('.headline-card .headline-action').textContent(), /Build an airport/);
  await page.screenshot({ path: `${output}/news-1952.png` });
  await page.locator('.headline-card .headline-close').click();

  // 3. Placing: A picks the tool, the tip names the town, the site and its reach are drawn, A turns the runway.
  await page.evaluate(() => { transport.game.money = 2_000_000; transport.renderer.setZoom(1); });
  await page.locator('#world').focus(); await page.keyboard.press('a');
  await page.locator('#active-tool-bar').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#active-tool-name').textContent(), 'Airport');
  assert.equal(await page.locator('#active-tool-turn').isVisible(), true, 'Turn shows for the Airport tool');
  const fernAt = await hoverTile(page, FERN.pointer);
  await page.waitForFunction(() => !document.querySelector('#placement-tip').hidden && /Serves/.test(document.querySelector('#placement-tip').textContent));
  assert.match(await page.locator('#placement-tip').textContent(), /Serves Fernford/);
  const quote = await page.evaluate(async p => { const { quoteBuildPlan } = await import('./construction-plan.js'); return quoteBuildPlan(transport.game, 'airport', [p], { airportAxis: 'x' }); }, FERN.pointer);
  assert.equal(quote.ok, true); assert.deepEqual({ x: quote.placements[0].x, y: quote.placements[0].y }, FERN.anchor);
  await page.waitForTimeout(300);
  const reachProbe = await page.evaluate(({ a }) => { const s = transport.renderer.worldToScreen(a.x + 3, a.y - 7 + .5); return { x: s.x - 20, y: s.y - 20, w: 40, h: 40 }; }, { a: FERN.anchor });
  const siteProbe = await page.evaluate(({ a }) => { const s = transport.renderer.worldToScreen(a.x + 4, a.y + 1); return { x: s.x - 10, y: s.y - 6, w: 20, h: 12 }; }, { a: FERN.anchor });
  const placingSite = await canvasCrop(page, siteProbe), placingReach = await canvasCrop(page, reachProbe);
  await page.screenshot({ path: `${output}/placing.png` });
  await page.locator('#world').focus(); await page.keyboard.press('a');
  assert.equal(await page.locator('#status-message').textContent(), 'Runway north–south');
  await page.keyboard.press('a');
  assert.equal(await page.locator('#status-message').textContent(), 'Runway east–west');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.ok(differs(placingSite, await canvasCrop(page, siteProbe)) > 20, 'the site highlight covers the footprint');
  assert.ok(differs(placingReach, await canvasCrop(page, reachProbe)) > 4, 'the dashed reach outline is drawn 7 tiles out');

  // 4. Building, and refusals that spend nothing.
  await page.locator('#world').focus(); await page.keyboard.press('a');
  const town = await page.evaluate(() => { const c = transport.game.cities.find(city => city.name === 'Fernford'); return { x: c.x, y: c.y }; });
  await hoverTile(page, town);
  await page.waitForFunction(() => document.querySelector('#placement-tip').classList.contains('invalid'));
  assert.match(await page.locator('#placement-tip').textContent(), /Clear all 12 tiles|level|dry/);
  let before = await money(page); const townAt = await screenOf(page, town); await page.mouse.click(townAt.x, townAt.y);
  assert.equal(await money(page), before, 'a refused site spends nothing');
  before = await money(page);
  const at = await hoverTile(page, FERN.pointer); await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => /Fernford Airport opened/.test([...document.querySelectorAll('#toast-region .toast')].map(el => el.textContent).join(' ')));
  const fern = await page.evaluate(() => transport.game.stations.find(s => s.name === 'Fernford Airport'));
  assert.deepEqual({ x: fern.x, y: fern.y, axis: fern.axis, mode: fern.mode }, { ...FERN.anchor, axis: 'x', mode: 'air' });
  assert.equal(before - await money(page), quote.cost, 'the airport costs its quote');
  await page.locator('[data-construction-next="stop"]').click();
  assert.equal(await page.locator('#active-tool-name').textContent(),'Airport','Add another stop continues the same airport mode');
  assert.equal(await page.locator('#active-tool-turn').isVisible(),true,'the continuation keeps the turnable runway tool');
  // A sloped site: raise one vertex beside Fernford's airport and the tip turns red with the model's reason.
  const slope = await page.evaluate(async () => {
    const { build, quoteBuildPlan } = await Promise.all([import('./model.js'), import('./construction-plan.js')]).then(([m, c]) => ({ build: m.build, quoteBuildPlan: c.quoteBuildPlan }));
    const g = transport.game;
    for (let y = 150; y < 250; y++) for (let x = 120; x < 260; x++) { const q = quoteBuildPlan(g, 'airport', [{ x, y }], { airportAxis: 'x' }); if (q.ok && build(g, 'raise', q.placements[0].x + 2, q.placements[0].y + 1).ok) return { x, y, message: quoteBuildPlan(g, 'airport', [{ x, y }], { airportAxis: 'x' }).message }; }
    return null;
  });
  assert.match(slope?.message || '', /level ground/, 'a raised vertex refuses the site');
  await hoverTile(page, { x: slope.x, y: slope.y });
  await page.waitForFunction(() => document.querySelector('#placement-tip').classList.contains('invalid'));
  assert.match(await page.locator('#placement-tip').textContent(), /level ground/);
  before = await money(page); const slopeAt = await screenOf(page, { x: slope.x, y: slope.y }); await page.mouse.click(slopeAt.x, slopeAt.y);
  assert.equal(await money(page), before, 'a sloped site spends nothing');

  // 5. The second airport, turned north–south with the Turn button.
  await page.locator('#active-tool-turn').click();
  assert.equal(await page.locator('#status-message').textContent(), 'Runway north–south');
  const elmAt = await hoverTile(page, ELM.pointer);
  await page.waitForFunction(() => /Serves Elmhaven/.test(document.querySelector('#placement-tip').textContent));
  await page.mouse.click(elmAt.x, elmAt.y);
  await page.waitForFunction(() => transport.game.stations.some(s => s.name === 'Elmhaven Airport'));
  const elm = await page.evaluate(() => transport.game.stations.find(s => s.name === 'Elmhaven Airport'));
  assert.deepEqual({ x: elm.x, y: elm.y, axis: elm.axis }, { ...ELM.anchor, axis: 'y' });
  await page.keyboard.press('Escape');

  // 6. Any airport tile opens or picks the airport; a road tile is refused by name.
  const runway = { x: fern.x + 4, y: fern.y + 1 };
  const runwayAt = await hoverTile(page, runway); await page.mouse.click(runwayAt.x, runwayAt.y);
  await page.locator('#inspector-title').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#inspector-title').textContent(), 'Fernford Airport');
  assert.match(await page.locator('#inspector').textContent(), /Airport, 6 × 2 site/);
  assert.match(await page.locator('#inspector').textContent(), /7 tiles/);
  await page.screenshot({ path: `${output}/inspector.png` });
  // 11. A selected airport draws its rounded 7-tile reach and pill, never a ground-stop ring.
  const pills = await page.evaluate(() => {
    const seen = [], fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) { seen.push(String(text)); return fill.call(this, text, ...rest); };
    try { transport.renderer.render(performance.now(), { tool: 'inspect', selected: { x: transport.game.stations.find(s => s.name === 'Fernford Airport').x, y: transport.game.stations.find(s => s.name === 'Fernford Airport').y, kind: '' } }); } finally { CanvasRenderingContext2D.prototype.fillText = fill; }
    return seen;
  });
  assert.ok(pills.includes('7-tile reach') && !pills.includes('4-tile reach') && !pills.includes('5-tile reach'), 'a selected airport shows its 7-tile reach');
  await page.locator('#inspector .tiny-button').click();

  // 7. Routes: picking the start airport chooses Air, the end stays an airport, then cargo and one plane.
  await chooseView(page, 'routes');
  await page.locator('#new-route-button').click();
  await page.locator('#route-form [name="from"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#route-form [name="mode"]').getAttribute('type'), 'hidden', 'the start stop determines transport');
  assert.equal(await page.locator('#route-cargo-step').isVisible(), false, 'choose stops before cargo');
  assert.equal(await page.locator('#route-vehicles-step').isVisible(), false, 'choose cargo before buying a plane');
  const startOptions = await page.locator('#route-form [name="from"] option').evaluateAll(options => options.map(option => option.value));
  assert.ok(startOptions.includes(fern.id) && startOptions.includes(elm.id), 'both airports are offered as start stops');
  await page.locator('[data-pick-route="from"]').click();
  const apron = { x: fern.x + 3, y: fern.y };
  const apronAt = await hoverTile(page, apron); await page.mouse.click(apronAt.x, apronAt.y);
  await page.waitForFunction(id => document.querySelector('#route-form [name="from"]')?.value === id, fern.id);
  assert.equal(await page.locator('#route-form [name="mode"]').inputValue(), 'air', 'an airport start selects Air automatically');
  assert.match(await page.locator('.route-mode-note').textContent(), /Air connection/);
  const endOptions = await page.locator('#route-form [name="to"] option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  assert.deepEqual(endOptions, [elm.id], 'end choices contain the other airport');
  // Picking the start moves straight on to the end.
  await page.waitForFunction(() => document.querySelector('[data-pick-route="to"]')?.getAttribute('aria-pressed') === 'true');
  const road = await page.evaluate(() => { const g = transport.game; for (let y = 190; y < 230; y++) for (let x = 180; x < 230; x++) if (g.tiles[y * g.width + x].road) return { x, y }; return null; });
  assert.ok(road, 'a road tile is available to check the airport-only end picker');
  const roadAt = await hoverTile(page, road); await page.mouse.click(roadAt.x, roadAt.y);
  assert.match(await toastText(page), /Choose an airport\./);
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), '', 'a road tile does not become a flight endpoint');
  await page.evaluate(id => { const st = transport.game.stations.find(s => s.id === id); transport.renderer.focus(st.x + 1, st.y + 2); }, elm.id);
  await page.waitForTimeout(200);
  const elmSign = await page.evaluate(id => { const st = transport.game.stations.find(s => s.id === id), m = transport.renderer.stationMarker(st), r = document.querySelector('#world').getBoundingClientRect(); return { x: r.left + m.x + m.size / 2, y: r.top + m.y + m.size / 2 }; }, elm.id);
  await page.mouse.click(elmSign.x, elmSign.y);
  await page.waitForFunction(id => document.querySelector('#route-form [name="to"]')?.value === id, elm.id);
  if (!(await page.locator('#route-connection').isVisible())) await chooseView(page, 'routes');
  await page.locator('#route-cargo-step').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#route-connection').getAttribute('data-awaiting-cargo'), 'true');
  assert.equal(await page.locator('#route-connection').getAttribute('data-valid'), 'false', 'a connected flight still asks what to carry');
  assert.equal(await page.locator('[data-cargo-choice][aria-pressed="true"]').count(), 0, 'cargo is an explicit choice');
  const cargoChoices = await page.locator('#route-cargo-step [data-cargo-choice]').evaluateAll(buttons => buttons.map(button => button.dataset.cargoChoice).sort());
  assert.deepEqual(cargoChoices, ['mail', 'passengers'], 'Air offers only the passengers and mail supplied by these towns');
  assert.equal(await page.locator('[data-cargo-choice="stone"]').count(), 0, 'unavailable freight does not clutter the plane cargo choices');
  await page.locator('[data-cargo-choice="passengers"]').click();
  await page.waitForFunction(() => document.querySelector('#route-connection')?.dataset.valid === 'true');
  assert.equal(await page.locator('#route-connection').getAttribute('data-message'), 'Flight, 108 tiles.');
  const automaticName = await page.locator('#route-form [name="name"]').inputValue();
  for (const word of ['Fernford', 'Elmhaven', 'Passengers']) assert.ok(automaticName.toLowerCase().includes(word.toLowerCase()), `the automatic flight name includes ${word}`);
  assert.equal(await page.locator('#route-form [name="vehicleCount"]').inputValue(), '1');
  assert.equal(await page.locator('[data-estimate-cost]').isVisible(), true);
  assert.equal(await page.locator('[data-estimate-revenue]').isVisible(), true);
  const portrait = await page.locator('.purchase-vehicle canvas').evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  assert.ok(portrait > 200, 'the plane portrait is drawn');
  await page.waitForTimeout(500); await page.screenshot({ path: `${output}/route-form.png` });
  const price = await page.evaluate(() => Number(document.querySelector('#vehicle-purchase-price').textContent.replace(/[^0-9]/g, '')));
  before = await money(page);
  await page.locator('#route-form button[type="submit"]').click();
  await page.waitForFunction(() => transport.game.routes.some(route => route.mode === 'air'));
  const flight = await page.evaluate(async () => { const { groundPhase } = await import('./air-flight.js'), g = transport.game, route = g.routes.find(r => r.mode === 'air'), v = g.vehicles.find(v => v.routeId === route.id); return { id: route.id, name: route.name, cargo: route.cargo, stops: route.stops, vehicles: g.vehicles.filter(v => v.routeId === route.id).length, path: route.path.length - 1, capacity: v.capacity, dwell: v.dwellRemaining, phase: groundPhase(v.dwellRemaining), progress: v.progress, vehicle: v.id }; });
  assert.equal(before - await money(page), price, 'the plane costs its quote');
  assert.equal(flight.name, automaticName); assert.equal(flight.cargo, 'passengers');
  assert.deepEqual(flight.stops, [fern.id, elm.id]); assert.equal(flight.vehicles, 1, 'launch buys exactly the requested plane');
  assert.equal(flight.path, 108); assert.equal(flight.capacity, 56); assert.equal(flight.progress, 0);
  assert.equal(flight.phase, 'taxiOut', 'the first plane starts at its stand, ready to taxi out');

  // 10. Running: the first floater rises over the terminal above the sign; the card names the plane; Follow keeps it.
  await page.evaluate(() => {
    const renderer = transport.renderer, original = renderer.render; window.airQA = { floaters: [] };
    renderer.render = function (now, view = {}) { for (const f of view.floaters || []) if (f.air && !airQA.floaters.includes(f)) airQA.floaters.push(f); return original.apply(this, arguments); };
  });
  await page.evaluate(id => { const st = transport.game.stations.find(s => s.id === id); transport.renderer.setZoom(1); transport.renderer.focus(st.x + 1, st.y + 2); }, elm.id);
  await page.locator('[data-speed="3"]').click();
  await page.waitForFunction(() => airQA.floaters.length > 0, undefined, { timeout: 120000 });
  await page.locator('[data-speed="0"]').click();
  const floater = await page.evaluate(() => {
    const f = airQA.floaters[0], g = transport.game, st = g.stations.find(s => s.mode === 'air' && Math.abs(f.x - s.x) < 3 && Math.abs(f.y - s.y) < 3), z = transport.renderer.getCamera().zoom;
    transport.renderer.focus(f.x, f.y + 1);
    const p = transport.renderer.worldToScreen(f.x, f.y), m = transport.renderer.stationMarker(st), bottom = p.y - 80 * Math.max(1, z) - 23 / 2 + 23;
    return { f: { x: f.x, y: f.y }, station: { x: st.x, y: st.y, axis: st.axis }, bottom, sign: m, p };
  });
  const hall = floater.station.axis === 'y' ? { x: floater.station.x + .46 - .5, y: floater.station.y + 1.1 - .5 } : { x: floater.station.x + 1.1 - .5, y: floater.station.y + .46 - .5 };
  assert.ok(Math.abs(floater.f.x - hall.x) < 1e-9 && Math.abs(floater.f.y - hall.y) < 1e-9, 'an airport floater rises over the terminal hall');
  assert.ok(floater.bottom <= floater.sign.y, 'the figure starts above the airport sign');
  assert.ok(Math.abs(floater.p.x - (floater.sign.x + floater.sign.size / 2)) < 40, 'the figure stands over the sign');
  await page.screenshot({ path: `${output}/floater.png` });
  await chooseView(page, 'routes');
  const routeCard = page.locator(`#route-list [data-route-id="${flight.id}"]`);
  await routeCard.waitFor({ state: 'visible' });
  assert.match(await routeCard.locator(`[data-route-status="${flight.id}"]`).textContent(), /Running/);
  const routeDetails = routeCard.locator('.route-card-details');
  if (!await routeDetails.evaluate(details => details.open)) await routeDetails.locator(':scope > summary').click();
  await routeCard.locator('canvas[data-vehicle-sprite]').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  // The plane's badge opens its card.
  const badge = await page.evaluate(id => {
    const g = transport.game, v = g.vehicles.find(v => v.id === id), w = transport.renderer.vehicleWorldPoint(v);
    transport.renderer.setZoom(1); transport.renderer.focus(w.x, w.y); transport.renderer.render(performance.now(), {});
    const r = document.querySelector('#world').getBoundingClientRect(), W = r.width, H = r.height;
    for (let y = H / 2 - 90; y < H / 2 + 40; y += 3) for (let x = W / 2 - 40; x < W / 2 + 40; x += 3) if (transport.renderer.vehicleAt(r.left + x, r.top + y)?.id === id) return { x: r.left + x, y: r.top + y };
    return null;
  }, flight.vehicle);
  assert.ok(badge, 'the plane is pickable where it is drawn');
  await page.mouse.click(badge.x, badge.y);
  await page.locator('#inspector [data-vehicle-action="follow"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('#inspector .eyebrow').textContent(), /plane/);
  assert.match(await page.locator('#inspector [data-vehicle-live="trip"]').textContent(), /^(Landing at|Taxiing at|Boarding at|Taking off from|Heading to) /);
  await page.waitForTimeout(500); await page.screenshot({ path: `${output}/plane-card.png` });
  await page.locator('#inspector [data-vehicle-action="follow"]').click();
  await page.locator('[data-speed="1"]').click();
  const drift = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); drift.push(await page.evaluate(id => { const v = transport.game.vehicles.find(v => v.id === id), w = transport.renderer.vehicleWorldPoint(v), c = transport.renderer.getCamera(); return Math.hypot(c.x / 32 - .5 - w.x, c.y / 32 - .5 - w.y); }, flight.vehicle)); }
  await page.locator('[data-speed="0"]').click();
  assert.ok(Math.max(...drift) < 1.5, `Follow keeps the drawn plane in the middle (${drift.map(d => d.toFixed(2)).join(', ')})`);
  await page.locator('#inspector .tiny-button').click();

  // 12. Save and reload: airports, route and plane persist; the debut never replays.
  await page.evaluate(() => transport.persist());
  await page.reload(); await loadAutosaveFromMenu(page);
  const reloaded = await page.evaluate(() => ({ airports: transport.game.stations.filter(s => s.mode === 'air').length, routes: transport.game.routes.filter(r => r.mode === 'air').length, planes: transport.game.vehicles.length, stats: transport.renderer.getStats().airports }));
  assert.deepEqual({ airports: reloaded.airports, routes: reloaded.routes, stats: reloaded.stats }, { airports: 2, routes: 1, stats: 2 });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => transport.headline), null, 'a load never replays the debut');
  assert.doesNotMatch(await toastText(page), /Air travel arrives/);

  // 13. Bulldozing: refused while the route runs; after Retire one click clears the whole site for one charge.
  await page.evaluate(() => transport.setTool('bulldoze'));
  const fernRunway = await hoverTile(page, { x: fern.x + 5, y: fern.y + 1 });
  const plan = await page.evaluate(async p => { const { quoteBuildPlan } = await import('./construction-plan.js'); return quoteBuildPlan(transport.game, 'bulldoze', [p], {}); }, { x: fern.x + 5, y: fern.y + 1 });
  assert.equal(plan.placements.length, 1, 'one airport, one placement');
  await page.mouse.click(fernRunway.x, fernRunway.y);
  await page.waitForFunction(() => /uses this stop\. Retire the route first, then remove the stop\./.test([...document.querySelectorAll('#toast-region .toast')].map(el => el.textContent).join(' ')));
  assert.equal(await page.evaluate(id => transport.game.stations.some(s => s.id === id), fern.id), true);
  await page.evaluate(async id => { const { removeRoute } = await import('./model.js'); removeRoute(transport.game, id); }, flight.id);
  before = await money(page);
  const clearAt = await hoverTile(page, { x: fern.x + 2, y: fern.y }); await page.mouse.click(clearAt.x, clearAt.y);
  await page.waitForFunction(() => /Cleared the airport/.test([...document.querySelectorAll('#toast-region .toast')].map(el => el.textContent).join(' ')));
  assert.equal(await page.evaluate(id => transport.game.stations.some(s => s.id === id), fern.id), false, 'the whole site is cleared');
  assert.ok(before - await money(page) > 0, 'bulldozing an airport has one charge');
  assert.equal(await page.evaluate(async () => (await import('./model.js')).validateGame(transport.game)), true);
  await page.keyboard.press('Escape');

  // 9. The art's weight beside the houses (Detail zoom, DPR 2, on #6e8a57).
  const art = await page.evaluate(async () => {
    // The map previously needed only its smaller density. Wait for the real
    // Detail/Retina source before measuring this larger standalone portrait.
    const { preloadWorldArt } = await import('./atlas-runtime.js');
    await preloadWorldArt({ cells: [512], waitMs: 12000 });
    const A = await import('./airport-art.js'), scale = 4, grass = [0x6e, 0x8a, 0x57];
    const measure = draw => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d');
      x.fillStyle = '#6e8a57'; x.fillRect(0, 0, c.width, c.height); x.save(); x.scale(scale, scale); x.translate(80, 75); draw(x); x.restore();
      const d = x.getImageData(0, 0, c.width, c.height).data, lum = [];
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - grass[0]) + Math.abs(d[i + 1] - grass[1]) + Math.abs(d[i + 2] - grass[2]) > 45) lum.push(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]);
      lum.sort((a, b) => a - b);
      return { dark: lum.filter(v => v < 60).length / lum.length, p5: lum[Math.floor(lum.length * .05)], n: lum.length, url: c.toDataURL() };
    };
    const buildings = measure(c => { A.drawTower(c, { axis: 'x', detail: 'detail' }); A.drawTerminal(c, { axis: 'x', detail: 'detail' }); });
    const plane = measure(c => { c.translate(40, 20); A.drawAircraft(c, { heading: Math.PI * .08, detail: 'detail', color: '#3F6FB5' }); });
    const scene = document.createElement('canvas'); scene.width = 1100; scene.height = 700; const s = scene.getContext('2d');
    s.fillStyle = '#6e8a57'; s.fillRect(0, 0, scene.width, scene.height); s.save(); s.scale(scale, scale); s.translate(70, 60);
    s.save(); s.transform(1, .5, -1, .5, 0, 0); A.paintAirportGround(s, { axis: 'x', biome: 'taiga', detail: 'detail', seed: 5 }); s.restore();
    A.drawTower(s, { axis: 'x', detail: 'detail' }); A.drawTerminal(s, { axis: 'x', detail: 'detail' });
    for (const stand of A.LAYOUT.stands) { const p = A.localToProjected('x', stand.u, stand.v); s.save(); s.translate(p.x, p.y); A.drawAircraft(s, { heading: 0, detail: 'detail', color: '#3F6FB5' }); s.restore(); }
    A.drawHangar(s, { axis: 'x', detail: 'detail' }); A.drawDepot(s, { axis: 'x', detail: 'detail' });
    s.restore();
    return { buildings: { dark: buildings.dark, p5: buildings.p5, n: buildings.n }, plane: { dark: plane.dark, p5: plane.p5, n: plane.n }, crops: [buildings.url, plane.url], scene: scene.toDataURL() };
  });
  console.log('art weight', JSON.stringify({ buildings: art.buildings, plane: art.plane }));
  for (const [i, name] of ['art-terminal-tower', 'art-plane'].entries()) await writeFile(`${output}/${name}.png`, Buffer.from(art.crops[i].split(',')[1], 'base64'));
  await writeFile(`${output}/art-check.png`, Buffer.from(art.scene.split(',')[1], 'base64'));
  assert.ok(art.buildings.dark >= .03 && art.buildings.p5 <= 70, `terminal and tower hold their weight (${JSON.stringify(art.buildings)})`);
  assert.ok(art.plane.dark >= .04 && art.plane.p5 <= 65, `the airliner holds its weight (${JSON.stringify(art.plane)})`);
  await page.close();

  // 8. Visuals in three biomes, three zooms and two densities; layers by pixels.
  for (const biome of ['taiga', 'tundra', 'desert']) for (const dpr of [1, 2]) {
    const view = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: dpr });
    watch(view);
    await view.goto(url);
    await createWorldFromMenu(view, { biome, size: 'square512', seed: biome === 'taiga' ? 1847 : biome === 'desert' ? 42 : 77 });
    await view.addStyleTag({ content: '#headline-slot,#objective-card,#toast-region{display:none!important}' });
    const scene = await view.evaluate(async () => {
      const model = await import('./model.js'), { quoteBuildPlan } = await import('./construction-plan.js'), g = transport.game;
      g.day = 730.02; g.lastDailyDay = 730; g.lastMonth = 24; g.money = 5e6;
      const sites = [];
      for (const city of g.cities) {
        let best = null;
        for (const axis of ['x', 'y']) for (let dy = -7; dy <= 7 && !best; dy++) for (let dx = -7; dx <= 7 && !best; dx++) { const q = quoteBuildPlan(g, 'airport', [{ x: city.x + dx, y: city.y + dy }], { airportAxis: axis }); if (q.ok && model.stationCoverage(g, { ...q.placements[0], mode: 'air', axis }).cities.some(c => c.id === city.id)) best = { ...q.placements[0], axis }; }
        if (best) sites.push(best);
      }
      let pair = null;
      for (const a of sites) for (const b of sites) { const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y); if (a !== b && d >= 40 && d <= 140 && (!pair || Math.abs(d - 90) < Math.abs(pair.d - 90))) pair = { a, b, d }; }
      const A = model.build(g, pair.a.tool, pair.a.x, pair.a.y).station, B = model.build(g, pair.b.tool, pair.b.x, pair.b.y).station;
      const r = model.addRoute(g, { mode: 'air', stops: [A.id, B.id], cargo: 'passengers' });
      if (!r.ok) throw new Error(r.message);
      model.addRouteVehicle(g, r.route.id); model.addRouteVehicle(g, r.route.id);
      g.revision++;
      return { A: { x: A.x, y: A.y, axis: A.axis, id: A.id }, route: r.route.id };
    });
    // Park a plane at A's stand: tick until one is boarding there.
    await view.evaluate(async () => { const model = await import('./model.js'), { groundPhase } = await import('./air-flight.js'), g = transport.game;
      for (let i = 0; i < 6000; i++) { model.tick(g, .01); if (g.vehicles.some(v => v.dwellRemaining > 0 && v.progress === 0 && groundPhase(v.dwellRemaining) === 'parked')) break; } g.revision++; });
    const centre = scene.A.axis === 'y' ? { x: scene.A.x + 1, y: scene.A.y + 3 } : { x: scene.A.x + 3, y: scene.A.y + 1 };
    const shot = async (name, { zoom, day, focus = centre }) => {
      await view.evaluate(({ zoom, day, focus }) => { const g = transport.game; g.day = day; transport.renderer.setZoom(zoom); transport.renderer.focus(focus.x, focus.y); g.revision++; }, { zoom, day, focus });
      await view.waitForTimeout(600);
      await view.screenshot({ path: `${output}/${biome}-z${zoom}-dpr${dpr}-${name}.png` });
    };
    for (const zoom of [.5, 1, 2]) await shot('day', { zoom, day: 780.3 });
    if (biome === 'taiga' && dpr === 1) {
      // Layers, compared in one task so the app's frames cannot repaint in between.
      const checks = await view.evaluate(({ A }) => {
        const r = transport.renderer, canvas = document.querySelector('#world'), g = transport.game, d = devicePixelRatio || 1, base = r.getLayers();
        r.setZoom(1); r.focus(A.axis === 'y' ? A.x + 1 : A.x + 3, A.axis === 'y' ? A.y + 3 : A.y + 1);
        const box = () => { const a = r.worldToScreen(A.x - 1, A.y - 2), b = r.worldToScreen(A.x + 7, A.y + 7); return { x: Math.max(0, Math.min(a.x, b.x) - 60), y: Math.max(0, Math.min(a.y, b.y) - 120) }; };
        const read = (layers, day, rect) => { r.setLayers({ ...base, ...layers }); g.day = day; r.render(performance.now(), {}); return canvas.getContext('2d').getImageData(Math.round(rect.x * d), Math.round(rect.y * d), Math.round(rect.w * d), Math.round(rect.h * d)).data; };
        const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
        const o = box(), rect = { x: o.x, y: o.y, w: 520, h: 360 };
        const all = read({}, 780.3, rect), again = read({}, 780.3, rect);
        const stations = read({ stations: false }, 780.3, rect), vehicles = read({ vehicles: false }, 780.3, rect), loads = read({ vehicleLoads: false }, 780.3, rect), planesOnly = read({ vehicleLoads: false, vehicles: false }, 780.3, rect);
        r.setLayers(base); g.day = 780.3; g.revision++;
        return { stable: diff(all, again), stations: diff(all, stations), vehicles: diff(all, vehicles), loads: diff(loads, planesOnly), loadsOnly: diff(all, loads) };
      }, { A: scene.A });
      console.log('layers', JSON.stringify(checks));
      assert.equal(checks.stable, 0, 'two renders of the paused scene agree');
      assert.ok(checks.stations > 500, 'Stops off hides the airport ground, buildings and sign');
      assert.ok(checks.vehicles > 50, 'Vehicles off hides planes and their shadows');
      assert.ok(checks.loadsOnly > 10 && checks.loads > 50, 'Loads off hides only the badges; the planes stay');
    }
    await view.close();
  }

  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(`airports browser check passed; screenshots in ${output}`);
} finally { await browser.close(); }
