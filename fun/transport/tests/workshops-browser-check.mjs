import { openBuildArea } from './browser-build.mjs';
// Workshops in a real browser: Build › Town shows the Workshop with its factory art beside a full-width Found a town; a
// workshop placed near Alderbrook with real pointer events, its inspector with recipes, stock and Expand, the town's stop
// buying lumber, the Town economy's Workshops block, and the route form offering lumber from a sawmill stop. Desktop.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-workshops-qa';
await mkdir(output, { recursive: true });
const errors = [];
const screen = (page, point) => page.evaluate(point => { const p = transport.renderer.worldToScreen(point.x, point.y), rect = document.querySelector('#world').getBoundingClientRect(); return { x: p.x + rect.left, y: p.y + rect.top }; }, point);
const fits = (page, selector) => page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1);

try {
  for (const viewport of [{ width: 1440, height: 960 }]) {
    const name = 'desk';
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await createWorldFromMenu(page, { seed: 1847 });
    await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
    assert.equal(await page.evaluate(() => transport.game.cities[0].name), 'Alderbrook');
    // The nearest clear 2 × 2 that Alderbrook owns, west of its centre.
    const site = await page.evaluate(async () => {
      const { buildProblem } = await import('./model.js'), { townOf } = await import('./town-market.js'), g = transport.game, home = g.cities[0], spots = [];
      for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 0; dx++) if (!buildProblem(g, 'workshop', home.x + dx, home.y + dy) && townOf(g, home.x + dx, home.y + dy) === home) spots.push({ x: home.x + dx, y: home.y + dy, d: Math.hypot(dx, dy) });
      return spots.sort((a, b) => a.d - b.d)[0];
    });
    assert.ok(site, 'a clear workshop site near Alderbrook');

    // Build › Town: the Workshop card draws the factory, and Found a town takes the whole row.
    await page.evaluate(() => transport.setView('build'));
    await openBuildArea(page, 'towns');
    const card = page.locator('.tool-grid [data-tool="workshop"]');
    await card.waitFor();
    assert.equal(await card.locator('canvas[data-building-sprite="factory"]').count(), 1, 'the card draws the factory');
    assert.match(await card.innerText(), /Workshop\s*\$12/);
    const widths = await page.evaluate(() => { const grid = document.querySelector('.tool-grid'), size = key => grid.querySelector(`[data-tool="${key}"]`).getBoundingClientRect().width; return { grid: grid.getBoundingClientRect().width, city: size('city'), workshop: size('workshop') }; });
    assert.ok(widths.city >= widths.grid - 1 && widths.workshop < widths.grid * .6, JSON.stringify(widths));
    assert.ok(await fits(page, '#panel-content'), 'the build panel never scrolls sideways');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${name}-build-town.png` });

    // Real pointer placement: the tool bar teaches the 2 × 2, and the toast names the workshop.
    await page.evaluate(site => { transport.renderer.setZoom(1); transport.renderer.focus(site.x + 1, site.y + 1); }, site);
    await card.click();
    assert.match(await page.locator('#active-tool-hint').innerText(), /2 × 2 site/);
    await page.waitForTimeout(200);
    const at = await screen(page, site);
    await page.waitForFunction(p => document.elementFromPoint(p.x, p.y)?.id === 'world', at);
    await page.mouse.move(at.x, at.y); await page.locator('#placement-tip').waitFor(); assert.match(await page.locator('#placement-tip').innerText(), /^Workshop/); await page.mouse.click(at.x, at.y);
    await page.waitForFunction(site => transport.game.tiles[site.y * transport.game.width + site.x].building?.owner === 'player', site);
    await page.locator('#toast-region', { hasText: 'Workshop built' }).waitFor();
    await page.screenshot({ path: `${output}/${name}-placed.png` });

    // The inspector: recipes, the town's stock, and Expand with its price.
    await page.evaluate(site => { transport.setTool('inspect'); transport.inspect(site.x, site.y); }, site);
    const box = page.locator('#inspector');
    assert.equal(await box.locator('h3').innerText(), 'Workshop');
    assert.match(await box.locator('.eyebrow').innerText(), /2 × 2 site, level 1/);
    assert.equal(await box.locator('.workshop-recipes .cargo-recipe').count(), 2, 'lumber to furniture, steel to machinery');
    assert.deepEqual(await box.locator('.workshop-ledger .cargo-badge').evaluateAll(els => els.map(el => el.dataset.cargo)), ['lumber', 'furniture', 'steel', 'machinery']);
    assert.match(await box.locator('#expand-workshop').innerText(), /^Expand\s*\$12,000$/);
    assert.ok(await fits(page, '#inspector'), 'the inspector never scrolls sideways');
    await page.waitForTimeout(200);
    await box.screenshot({ path: `${output}/${name}-inspector.png` });
    await box.locator('#expand-workshop').click();
    await page.waitForFunction(() => /level 2/.test(document.querySelector('#inspector .eyebrow')?.textContent || ''));
    await page.locator('#toast-region', { hasText: 'Workshop expanded to level 2' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'inspector-title', 'focus returns to the inspector title');

    // Alderbrook Central now buys lumber.
    const stops = await page.evaluate(async site => {
      const { build } = await import('./model.js'), g = transport.game, center = g.stations[0];
      // A sawmill north of town, with a stop on the road that reaches the centre.
      const mill = [[215, 231, 216, 237], [219, 231, 219, 237]].find(([x, y]) => build(g, 'sawmill', x, y).ok);
      const stop = mill && build(g, 'bus-stop', mill[2], mill[3]).station;
      g.money = 1e6; transport.inspect(center.x, center.y);
      return { center: center.id, sawmill: stop?.id };
    }, site);
    assert.ok(stops.sawmill, 'a sawmill stop near Alderbrook');
    assert.equal(await box.locator('.coverage-note', { hasText: 'Accepts' }).locator('[data-cargo="lumber"]').count(), 1, 'the centre stop accepts lumber');

    // The Town economy lists the workshops.
    await page.evaluate(() => { const home = transport.game.cities[0]; transport.inspect(home.x, home.y, 'city'); });
    await box.locator('.town-economy summary').click();
    await page.evaluate(() => document.activeElement.blur());
    assert.equal(await box.locator('.town-economy h4').first().innerText(), 'Workshops, 2 levels');
    assert.equal(await box.locator('.town-economy .workshop-line').count(), 2);
    assert.match(await box.locator('.town-economy .workshop-lines + .economy-foot').innerText(), /^Nothing waiting yet\. Deliver lumber or steel/);
    assert.ok(await fits(page, '#inspector'));
    await page.waitForTimeout(200);
    await box.screenshot({ path: `${output}/${name}-economy.png` });

    // The route form offers lumber from the sawmill stop to Alderbrook.
    await page.evaluate(() => transport.setView('routes'));
    await page.locator('#route-form [name="from"]').selectOption(stops.sawmill);
    await page.locator('#route-form [name="to"]').selectOption(stops.center);
    await page.locator('[data-cargo-choice="lumber"][data-fits="true"]').waitFor();
    assert.ok(await fits(page, '#panel-content'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${output}/${name}-route-form.png` });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Workshops browser check passed');
} finally {
  await browser.close();
}
