// Investment forecasts and returns in a real browser (city-investment-feedback), on seed 1847. A residential rectangle dragged
// beside Alderbrook forecasts residents, rent and payback on the tip's second line, under the quote's own line; a drag far from
// every town warns that it is too far to develop; the cottage tool forecasts rent and a school forecasts nothing. A cottage, a
// workshop and a lumber route to it, run for 13 months, give Alderbrook's Town economy a year of returns with a small line, a
// Your property row in the Towns list and its sort, and a Past 12 months column in the Company report. The map outlines the
// property only while building in towns from the Town view in; the outlines cost under 0.3 ms a frame. Desktop controls.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-city-qa';
await mkdir(output, { recursive: true });
const errors = [];
const screen = (page, point) => page.evaluate(point => { const p = transport.renderer.worldToScreen(point.x, point.y), rect = document.querySelector('#world').getBoundingClientRect(); return { x: p.x + rect.left, y: p.y + rect.top }; }, point);
const tip = page => page.evaluate(() => { const t = document.querySelector('#placement-tip'); return { visible: !t.hidden, quote: t.firstChild?.textContent ?? '', forecast: t.querySelector('.tip-forecast')?.textContent ?? null, warning: t.classList.contains('warning'), fits: t.scrollWidth <= t.clientWidth + 1 }; });
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const outlines = async page => { await frames(page); return page.evaluate(() => transport.renderer.getStats().propertyOutlines); };
// A zone drag held between two tiles; Escape then cancels it, so nothing is built.
async function hold(page, from, to) {
  await page.evaluate(({ from, to }) => { transport.renderer.setZoom(1); transport.renderer.focus((from.x + to.x) / 2, (from.y + to.y) / 2); }, { from, to });
  await frames(page);
  const [a, b] = [await screen(page, from), await screen(page, to)];
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForFunction(() => !document.querySelector('#placement-tip').hidden);
  return tip(page);
}
async function release(page) { await page.keyboard.press('Escape'); await page.mouse.up(); }
async function hover(page, point) { const at = await screen(page, point); await page.mouse.move(at.x - 3, at.y); await page.mouse.move(at.x, at.y); await page.waitForFunction(() => !document.querySelector('#placement-tip').hidden); return tip(page); }

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await createWorldFromMenu(page, { seed: 1847 });
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
  const town = await page.evaluate(() => { const { id, name, x, y } = transport.game.cities[0]; return { id, name, x, y }; });
  assert.equal(town.name, 'Alderbrook');
  assert.equal(await outlines(page), 0, 'nothing is outlined on the default screen');

  // Alderbrook's bus arrives, so its zones would develop. The widest rectangle beside it that the forecast counts in full.
  const sites = await page.evaluate(async () => {
    const model = await import('./model.js'), { quoteBuildPlan } = await import('./construction-plan.js'), { zoneForecast } = await import('./town-forecast.js'), { buildProblem } = model, { townOf } = await import('./town-market.js');
    const g = transport.game, home = g.cities[0];
    while (!Number.isFinite(home.lastServiceDay)) model.tick(g, 1);
    const rectangles = [];
    for (const [w, h] of [[3, 3], [3, 2], [2, 3], [2, 2]]) for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      const points = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) points.push({ x: home.x + dx + i, y: home.y + dy + j });
      const quote = quoteBuildPlan(g, 'residential', points);
      if (quote.ok === false || quote.placements.filter(p => p.state === 'ok').length < 3) continue;
      const f = zoneForecast(g, 'residential', quote.placements);
      if (f.towns.length === 1 && f.towns[0].city === home && !f.far && f.rent !== null) rectangles.push({ from: points[0], to: points.at(-1), tiles: f.towns[0].tiles, roadless: f.roadless, d: Math.hypot(dx, dy) });
    }
    rectangles.sort((a, b) => b.tiles - a.tiles || a.roadless - b.roadless || a.d - b.d);
    // A 3 × 3 twelve or more tiles from every town centre.
    let far = null;
    for (let r = 12; r < 24 && !far; r++) for (let a = 0; a < 32 && !far; a++) {
      const x = Math.round(home.x + r * Math.cos(a * Math.PI / 16)), y = Math.round(home.y + r * Math.sin(a * Math.PI / 16)), points = [];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) points.push({ x: x + i, y: y + j });
      if (points.some(p => g.cities.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 12))) continue;
      const quote = quoteBuildPlan(g, 'residential', points);
      if (quote.ok !== false && quote.placements.every(p => p.state === 'ok')) far = { from: points[0], to: points.at(-1) };
    }
    const clear = kind => { const spots = []; for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) if (Math.hypot(dx, dy) >= 3 && !buildProblem(g, kind, home.x + dx, home.y + dy) && townOf(g, home.x + dx, home.y + dy) === home) spots.push({ x: home.x + dx, y: home.y + dy, d: Math.hypot(dx, dy) }); return spots.sort((a, b) => a.d - b.d)[0]; };
    return { zone: rectangles[0], far, cottage: clear('house-cheap-1'), workshop: clear('workshop') };
  });
  assert.ok(sites.zone && sites.far && sites.cottage && sites.workshop, JSON.stringify(sites));

  // Dragging residential beside Alderbrook: the quote's line is area-zoning's, and the forecast is the second line.
  const zones = await page.evaluate(() => transport.game.zones.length);
  await page.evaluate(() => transport.setTool('residential'));
  let held = await hold(page, sites.zone.from, sites.zone.to);
  assert.match(held.quote, /^Residential · \d × \d · (\d+ tiles · )?(\d+ needs? a road · )?\$[\d,]+/, held.quote);
  assert.match(held.forecast, /^Alderbrook, about \+\d+ residents and \$\d+ a month in rent, pays back in about \d+ (months|years)$/, held.forecast);
  assert.equal(held.fits, true);
  await page.screenshot({ path: `${output}/tip-residential-1440.png`, clip: await page.locator('#placement-tip').boundingBox().then(b => ({ x: Math.max(0, b.x - 160), y: Math.max(0, b.y - 160), width: b.width + 320, height: b.height + 240 })) });
  await release(page);
  // Far from every town: a warning, and nothing promised.
  held = await hold(page, sites.far.from, sites.far.to);
  assert.equal(held.warning, true);
  assert.equal(held.forecast, 'Too far from a town to develop');
  await page.screenshot({ path: `${output}/tip-far-1440.png` });
  await release(page);
  assert.equal(await page.evaluate(() => transport.game.zones.length), zones, 'the cancelled drags zoned nothing');

  // Hovering the cottage near Alderbrook forecasts its rent; a school forecasts nothing.
  await page.evaluate(site => { transport.setTool('house-cheap-1'); transport.renderer.focus(site.x, site.y); }, sites.cottage);
  await frames(page);
  const cottageTip = await hover(page, sites.cottage);
  assert.match(cottageTip.forecast, /^Alderbrook, about \$\d+ a month in rent, pays back in about \d+ years$/, cottageTip.forecast);
  await page.screenshot({ path: `${output}/tip-cottage-1440.png` });
  await page.evaluate(() => transport.setTool('school'));
  const schoolTip = await hover(page, sites.cottage);
  assert.equal(schoolTip.forecast, null, 'a school is the town’s, so it forecasts nothing');
  await page.evaluate(() => transport.setTool('inspect'));

  // Via the hatch: a cottage, a workshop and a lumber route into Alderbrook, then 13 month closes, the last days at 8×.
  await page.evaluate(async sites => {
    const model = await import('./model.js'), { planConnection } = await import('./network-router.js'), { buildPlan } = await import('./construction-plan.js'), { calendarMonth } = await import('./economy-pricing.js'), g = transport.game, home = g.cities[0];
    g.money += 1e6;
    for (const [kind, site] of [['house-cheap-1', sites.cottage], ['workshop', sites.workshop]]) { const placed = model.build(g, kind, site.x, site.y); if (!placed.ok) throw new Error(`${kind}: ${placed.message}`); }
    let mill = null;
    for (let r = 10; r < 30 && !mill; r++) for (let a = 0; a < 32 && !mill; a++) { const x = Math.round(home.x + r * Math.cos(a * Math.PI / 16)), y = Math.round(home.y + r * Math.sin(a * Math.PI / 16)); if (model.buildProblem(g, 'sawmill', x, y)) continue; const site = model.build(g, 'sawmill', x, y).industry, plan = planConnection(g, site, home, 'road'); if (plan.ok) mill = { site, plan }; else model.build(g, 'bulldoze', x, y); }
    if (!mill) throw new Error('no sawmill site with a road to Alderbrook');
    // Built as Plan road builds it: bridges and tunnels where the path needs them, then the new stops.
    const { site, plan } = mill, road = buildPlan(g, 'road', plan.path);
    if (!road.ok) throw new Error(road.message);
    const stop = end => plan.ends[end]?.id ?? buildPlan(g, 'bus-stop', [plan.stops.find(s => s.end === end)]).station.id;
    const route = model.addRoute(g, { mode: 'road', stops: [stop(0), stop(1)], cargo: 'lumber' });
    if (!route.ok) throw new Error(route.message);
    site.inventory.lumber = 900;
    // Twelve closes, then the thirteenth month to two days before its end.
    const target = g.lastMonth + 12;
    while (g.lastMonth < target || calendarMonth(g, g.day + 2) === g.lastMonth) model.tick(g, 1);
  }, sites);
  const month = await page.evaluate(() => transport.game.lastMonth);
  await page.locator('[data-speed="8"]').click();
  await page.waitForFunction(month => transport.game.lastMonth > month, month, { timeout: 30000 });
  await page.evaluate(() => transport.setSpeed(0));
  const ledger = await page.evaluate(() => transport.game.cities[0].market.returns);
  assert.equal(ledger.length, 12, JSON.stringify(ledger));
  assert.ok(ledger.every(entry => entry[0] > 0) && ledger.some(entry => entry[2] > 0), `rent every month and workshop freight: ${JSON.stringify(ledger)}`);

  // Town economy: the past year's returns and a small line of its months.
  await page.evaluate(town => { transport.renderer.focus(town.x, town.y); transport.inspect(town.x, town.y, 'city'); }, town);
  await page.locator('.town-economy summary').click();
  const returns = page.locator('.town-economy .town-returns');
  await returns.waitFor();
  assert.match(await returns.locator('.economy-foot').innerText(), /^Past 12 months here: \$[\d.]+k? rent and \$[\d.]+k? workshop freight\.$/);
  assert.equal(await returns.locator('svg.town-returns-line polyline').count(), 1, 'a line of the months');
  assert.match(await returns.locator('.town-returns-spark').getAttribute('title'), /^Monthly returns, [A-Z][a-z]{2} \d{4} – [A-Z][a-z]{2} \d{4}$/);
  assert.equal(await returns.locator('svg').getAttribute('aria-hidden'), 'true');
  assert.ok(await page.locator('#inspector').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'the inspector never scrolls sideways');
  await returns.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  await page.locator('#inspector').screenshot({ path: `${output}/town-economy-1440.png` });
  // The inspector shows a town, so its property is outlined.
  assert.ok(await outlines(page) > 0, 'a town’s inspector outlines the property there');

  // Towns list: a Your property row, and the sort that puts Alderbrook first.
  await page.evaluate(() => { document.querySelector('#inspector .tiny-button')?.click(); transport.setView('towns'); });
  const card = page.locator(`#entity-list [data-city="${town.id}"]`);
  // The drawer slides in; its text reads once it has arrived.
  await page.waitForFunction(id => /Your property/.test(document.querySelector(`#entity-list [data-city="${id}"]`)?.innerText || ''), town.id);
  assert.match(await card.innerText(), /Your property\s+\$\d+ a month/);
  assert.ok(await page.locator('#entity-sort option[value="property"]').count() === 1, 'the sort offers Your property once a town pays rent');
  await page.locator('#entity-sort').selectOption('property');
  assert.equal(await page.locator('#entity-list .entity-card').first().getAttribute('data-city'), town.id);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/towns-list-1440.png` });

  // The Company report's towns table adds the past twelve months, with its split in the title.
  await openGameAction(page, 'company-button');
  const row = page.locator('#modal .property-towns tbody tr').first();
  await row.waitFor();
  const cells = await row.evaluate(tr => [...tr.cells].map(cell => cell.innerText.trim()));
  assert.equal(cells[0], 'Alderbrook'); assert.match(cells[4], /^\$[\d,]+$/);
  assert.equal(await page.locator('#modal .property-towns thead th').nth(4).innerText(), 'Past 12 months');
  assert.match(await row.locator('td').nth(3).getAttribute('title'), /^\$[\d,]+ rent, \$[\d,]+ market bonus and \$[\d,]+ workshop freight$/);
  await page.locator('#modal .company-property').scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}/company-property-1440.png` });
  await page.locator('#modal .close-modal').click();
  await page.waitForFunction(() => !document.querySelector('#modal').open);

  // Outlines: while Build › Town is open at the Town view, in the ok colour on the cottage; none in Explore or at Region.
  await page.evaluate(() => { document.querySelector('#inspector .tiny-button')?.click(); transport.setView('build'); });
  await page.locator('#panel-content [data-category="towns"]').click();
  await page.evaluate(site => { transport.renderer.setZoom(1); transport.renderer.focus(site.x, site.y); }, sites.cottage);
  const drawn = await outlines(page);
  assert.ok(drawn > 0, `Build › Town outlines the property (${drawn})`);
  // The same frame with and without outlines: around the cottage, the core of the outline turns pixels greener whatever the
  // hour's light, and its paper casing lightens the rest.
  const sample = await page.evaluate(site => {
    const canvas = document.querySelector('#world'), r = transport.renderer, density = devicePixelRatio || 1, p = r.worldToScreen(site.x + .5, site.y + .5), now = performance.now();
    const box = { x: Math.round((p.x - 48) * density), y: Math.round((p.y - 36) * density), w: Math.round(96 * density), h: Math.round(72 * density) };
    const read = on => { r.render(now, { propertyOutlines: on }); return { data: canvas.getContext('2d').getImageData(box.x, box.y, box.w, box.h).data, drawn: r.getStats().propertyOutlines }; };
    const shown = read(true), plain = read(false), again = read(true);
    let changed = 0, green = 0;
    for (let i = 0; i < shown.data.length; i += 4) if (shown.data[i] !== plain.data[i] || shown.data[i + 1] !== plain.data[i + 1] || shown.data[i + 2] !== plain.data[i + 2]) { changed++; if (shown.data[i + 1] - shown.data[i] >= plain.data[i + 1] - plain.data[i] + 6) green++; }
    return { changed, green, drawn: shown.drawn, stable: shown.data.every((v, i) => v === again.data[i]) };
  }, sites.cottage);
  assert.ok(sample.stable && sample.drawn > 0 && sample.changed >= 40 && sample.green >= 30 && sample.green >= .3 * sample.changed, `the cottage's footprint is outlined in green over its paper casing ${JSON.stringify(sample)}`);
  await frames(page);
  await page.screenshot({ path: `${output}/outlines-town-1440.png` });
  await page.evaluate(() => transport.renderer.setZoom(.5));
  assert.equal(await outlines(page), 0, 'the Region view would draw a lattice, so it draws none');
  await page.evaluate(site => { transport.renderer.setZoom(1); transport.renderer.focus(site.x, site.y); document.querySelector('#close-management')?.click(); transport.setTool('inspect'); }, sites.cottage);
  await page.keyboard.press('Escape');
  assert.equal(await outlines(page), 0, 'Explore with nothing selected outlines nothing');

  // The outlines' cost at the Town view, with every free lot around Alderbrook zoned and built on at once: batches of renders
  // with and without them, in alternation, so the timer's grain and machine load weigh on both alike.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const cost = await page.evaluate(async () => {
    const model = await import('./model.js'), { placeBuildingSite } = await import('./building-sites.js'), g = transport.game, home = g.cities[0], r = transport.renderer;
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) { const x = home.x + dx, y = home.y + dy; if (model.build(g, 'residential', x, y).ok) placeBuildingSite(g, 'house-cheap-1', x, y, { size: 1, building: { kind: 'house-cheap-1', level: 1 }, allowZone: true }); }
    g.revision++;
    r.setZoom(1); r.focus(home.x, home.y);
    const batch = on => { const start = performance.now(); for (let n = 0; n < 20; n++) r.render(performance.now(), { propertyOutlines: on }); return (performance.now() - start) / 20; };
    const times = { with: [], without: [] };
    batch(true); batch(false);
    for (let n = 0; n < 15; n++) { times.with.push(batch(true)); times.without.push(batch(false)); }
    const median = list => list.sort((a, b) => a - b)[list.length >> 1];
    r.render(performance.now(), { propertyOutlines: true });
    return { with: median(times.with), without: median(times.without), drawn: r.getStats().propertyOutlines };
  });
  assert.ok(cost.drawn >= 20 && cost.with - cost.without <= .3, `outlines add ${(cost.with - cost.without).toFixed(3)} ms a frame (${JSON.stringify(cost)})`);
  await frames(page);
  await page.screenshot({ path: `${output}/outlines-many-1440.png` });
  await context.close();

  assert.deepEqual(errors, []);
  console.log(`City browser check passed (outlines add ${(cost.with - cost.without).toFixed(3)} ms to a ${cost.without.toFixed(2)} ms frame, ${cost.drawn} drawn). Screenshots: ${output}`);
} finally {
  await browser.close();
}
