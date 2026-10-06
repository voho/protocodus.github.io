// Plan road: the first-route card previews a routed line and its stops, builds them in one step and drafts the route.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-plan-connection';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); };
const box = (page, selector) => page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const company = page => page.evaluate(() => ({ money: transport.game.money, stations: transport.game.stations.length, routes: transport.game.routes.length, revision: transport.game.networkRevision }));
// Thirty days of simulation in quarter-day frames, as the running game would step them.
const month = page => page.evaluate(async () => { const { tick } = await import('./model.js'); for (let n = 0; n < 120; n++) tick(transport.game, .25); return transport.game.routes.at(-1).delivered; });
const cost = text => Number(text.match(/\$([\d,]+)$/)[1].replace(/,/g, ''));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page, { biome: 'taiga', seed: 1847 });
  await page.locator('#objective-card').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#objective-plan').textContent(), 'Plan road');
  assert.equal(await page.locator('#objective-plan').isVisible(), true, 'the first route card offers a plan');
  const actions = { count: 0 }, act = async locator => { actions.count++; await locator.click(); };
  const before = await company(page);

  // Plan road: a preview and a banner, nothing spent.
  await act(page.locator('#objective-plan'));
  await page.locator('#connection-plan-banner').waitFor({ state: 'visible' });
  const summary = await page.locator('#connection-plan-banner strong').textContent();
  assert.match(summary, /^Road \d+ tiles? \+ 1 stop · \$[\d,]+$/, summary);
  assert.match(await page.locator('#connection-plan-banner span').textContent(), /^Then a truck \$[\d,]+ · uses Alderbrook Central$/);
  assert.deepEqual(await company(page), before, 'nothing is spent or built before Build');
  assert.equal(await page.locator('#active-tool-bar').isVisible(), false, 'the map stays in Explore');
  assert.equal(overlaps(await box(page, '#connection-plan-banner'), await box(page, '#objective-card')), false, 'the banner clears the goal card');
  assert.equal(await page.locator('#date-note').textContent(), 'Paused', 'the paused cue stays in the top bar, clear of the banner');
  await page.waitForFunction(() => !transport.renderer.getStats().gliding); // the camera glides to the plan (DESIGN.md 10.2)
  const framed =await page.evaluate(() => { const quarry = transport.game.industries.find(site => site.x === 217 && site.y === 255), town = transport.game.cities[0], c = document.querySelector('#world'), card = document.querySelector('#objective-card').getBoundingClientRect();
    return [quarry, town].every(site => { const p = transport.renderer.worldToScreen(site.x + .5, site.y + .5); return p.x > 0 && p.y > 0 && p.x < card.left && p.y < c.clientHeight; }); });
  assert.equal(framed, true, 'the quarry and Alderbrook are both in view beside the card');
  await page.screenshot({ path: `${output}/desktop-plan.png` });

  // Cancel and Escape drop the plan; planning again gives the same line.
  await page.locator('#cancel-connection-plan').click();
  assert.equal(await page.locator('#connection-plan-banner').count(), 0);
  await page.locator('#objective-plan').click();
  assert.equal(await page.locator('#connection-plan-banner strong').textContent(), summary, 'the plan is deterministic');
  await page.locator('#world').click({ position: { x: 300, y: 500 } });
  assert.equal(await page.locator('#connection-plan-banner').isVisible(), true, 'exploring the map keeps the plan');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#connection-plan-banner').count(), 0, 'Escape drops the plan');
  await page.locator('#objective-plan').click();
  await page.locator('#objective-another').click();
  assert.equal(await page.locator('#connection-plan-banner').count(), 0, 'another idea drops the plan');
  while (!(await page.locator('#objective-detail').textContent()).includes('Stone quarry')) await page.locator('#objective-another').click();
  assert.deepEqual(await company(page), before);
  await page.locator('#objective-plan').click();

  // Build: the line and the stop in one step, then the route form waits with the stops and cargo filled in.
  await act(page.locator('#build-connection-plan'));
  await page.locator('#route-form').waitFor({ state: 'visible' });
  const built = await company(page);
  assert.equal(before.money - built.money, cost(summary), 'Build spends exactly the planned sum');
  assert.equal(built.stations, before.stations + 1);
  assert.match(await page.locator('.toast').last().textContent(), /^Road \d+ tiles? \+ 1 stop built · \$[\d,]+Undo$/);
  const stop = await page.evaluate(() => transport.game.stations.at(-1).id);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), stop);
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), 'station-1');
  assert.equal(await page.locator('#route-form [name="cargo"]').inputValue(), 'stone');
  assert.equal(await page.locator('#route-connection').getAttribute('data-valid'), 'true');
  assert.deepEqual(await page.locator('#objective-steps .objective-step').evaluateAll(items => items.map(item => item.classList.contains('done'))), [true, true, true, false, false]);
  assert.equal(await page.locator('#objective-plan').isVisible(), false, 'a joined pair is no longer offered a plan');
  await page.screenshot({ path: `${output}/desktop-built.png` });

  // Launch, then a month of service delivers stone.
  await act(page.locator('#route-form button[type="submit"]'));
  assert.equal((await company(page)).routes, before.routes + 1);
  assert.ok(actions.count <= 5, `${actions.count} actions from a new world to a running route`);
  assert.ok(await month(page) > 0, 'stone reaches Alderbrook within a month');
  await page.close();

  // A stop placed since the preview changes the plan: Build shows the new plan first. Undo then takes back the whole bundle.
  const undo = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(undo);
  await undo.goto(url);
  await createWorldFromMenu(undo, { biome: 'desert', seed: 7 });
  await undo.locator('#objective-plan').click();
  await undo.locator('#connection-plan-banner').waitFor({ state: 'visible' });
  assert.match(await undo.locator('#connection-plan-banner strong').textContent(), /^2 stops · \$[\d,]+$/);
  assert.match(await undo.locator('#connection-plan-banner span').textContent(), /^The road is already there · then a truck \$[\d,]+$/);
  assert.equal(await undo.evaluate(async () => {
    const { planConnection } = await import('./network-router.js'), { build } = await import('./model.js'), game = transport.game;
    const farm = game.industries.find(site => site.kind === 'farm' && site.x === 220 && site.y === 249), plant = game.industries.find(site => site.kind === 'food-plant' && site.x === 218 && site.y === 231), plan = planConnection(game, farm, plant);
    return build(game, 'bus-stop', plan.stops[0].x, plan.stops[0].y).ok;
  }), true);
  const start = await company(undo);
  await undo.locator('#build-connection-plan').click();
  assert.match(await undo.locator('.toast').last().textContent(), /The land has changed\. Check the new plan\./);
  assert.match(await undo.locator('#connection-plan-banner strong').textContent(), /^1 stop · \$[\d,]+$/, 'the banner shows the new plan');
  assert.deepEqual(await company(undo), start, 'nothing is spent on a changed plan');
  await undo.locator('#build-connection-plan').click();
  assert.ok((await company(undo)).money < start.money);
  await undo.locator('.toast .toast-action').last().click();
  const restored = await company(undo);
  assert.deepEqual([restored.money, restored.stations], [start.money, start.stations], 'Undo refunds the line and its stops');
  assert.match(await undo.locator('.toast').last().textContent(), /^Road and stops removed\. \$[\d,]+ refunded\./);
  await undo.close();

  // Other seeds and biomes: five actions or fewer, and deliveries within a month.
  for (const [biome, seed] of [['taiga', 7], ['desert', 1847]]) {
    const other = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    watch(other);
    await other.goto(url);
    await createWorldFromMenu(other, { biome, seed });
    const counted = { count: 0 }, click = async selector => { counted.count++; await other.locator(selector).click(); };
    await click('#objective-plan');
    if (await other.locator('#connection-plan-banner').count()) await click('#build-connection-plan');
    await other.locator('#route-form').waitFor({ state: 'visible' });
    assert.equal(await other.locator('#route-connection').getAttribute('data-valid'), 'true', `${biome} ${seed}: the drafted route is valid`);
    await click('#route-form button[type="submit"]');
    assert.ok(counted.count <= 5);
    assert.ok(await month(other) > 0, `${biome} ${seed}: the first route delivers within a month`);
    await other.screenshot({ path: `${output}/${biome}-${seed}-launched.png` });
    await other.close();
  }

  assert.deepEqual(errors, []);
  console.log(`Plan road checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
