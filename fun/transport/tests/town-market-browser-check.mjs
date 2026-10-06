// Town economy in a real browser: the fold stays closed and changes nothing until opened, shows three demand
// rows and the shops' wants, ticks a want once it is delivered, survives the live refresh without sideways scrolling.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-town-market-qa';
await mkdir(output, { recursive: true });
const errors = [];
const inspectHome = page => page.evaluate(() => { const town = transport.game.cities[0]; transport.renderer.focus(town.x, town.y); transport.inspect(town.x, town.y, 'city'); });
const saved = page => page.evaluate(async () => { const { encodeGame } = await import('./save-codec.js'); return JSON.stringify(encodeGame(transport.game)); });

try {
  for (const viewport of [{ width: 1440, height: 960 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await createWorldFromMenu(page, { seed: 1847 });
    assert.equal(await page.evaluate(() => transport.game.cities[0].name), 'Alderbrook');

    // Before the first month closes, inspecting the town previews its market without writing one.
    const before = await saved(page);
    await inspectHome(page);
    await page.locator('#inspector .town-economy').waitFor();
    assert.equal(await page.locator('#inspector .town-economy').evaluate(el => el.open), false, 'the fold starts closed');
    assert.equal(await saved(page), before, 'opening the inspector leaves the save unchanged');

    await page.locator('#inspector .town-economy summary').click();
    // Focus inside the inspector holds its refresh, as for keyboard users; let it go.
    await page.evaluate(() => document.activeElement.blur());
    assert.equal(await page.locator('#inspector .demand-row').count(), 3);
    assert.deepEqual(await page.locator('#inspector .demand-row > span:first-child').allTextContents(), ['Homes', 'Shops', 'Workshops']);
    const food = page.locator('#inspector .want', { has: page.locator('[data-cargo-icon="food"]') });
    assert.equal(await food.count(), 1, 'Alderbrook wants food');
    const wanted = await page.evaluate(async () => { const { marketView } = await import('./town-market.js'); return marketView(transport.game, transport.game.cities[0]).wants.food; });
    assert.ok(wanted >= 50 && wanted <= 100, `Alderbrook wants ${wanted} food`);
    assert.match(await food.textContent(), new RegExp(`Food\\s*0 of ${wanted}`));
    assert.equal(await page.locator('#inspector .town-economy summary .economy-lead').textContent(), 'Wants food');
    assert.equal(await saved(page), before, 'opening the fold changes nothing either');
    await page.locator('#inspector').screenshot({ path: `${output}/economy-${viewport.width}.png` });

    // A delivered want earns its tick through the live refresh.
    await page.evaluate(async () => { const { ensureMarket } = await import('./town-market.js'); const market = ensureMarket(transport.game, transport.game.cities[0]); market.supplied.food = market.wants.food; });
    await page.evaluate(() => transport.setSpeed(8));
    await page.waitForSelector('#inspector .want.met [data-cargo-icon="food"]', { timeout: 5000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => transport.setSpeed(0));
    assert.equal(await page.locator('#inspector .town-economy').evaluate(el => el.open), true, 'the fold stays open through the live refresh');
    assert.notEqual(await page.locator('#inspector .economy-lead').textContent(), 'Wants food');
    const fit = await page.locator('#inspector').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    assert.ok(fit.scroll <= fit.client, `no sideways scroll: ${fit.scroll} > ${fit.client}`);
    await page.screenshot({ path: `${output}/economy-met-${viewport.width}.png` });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Town market browser check passed');
} finally {
  await browser.close();
}
