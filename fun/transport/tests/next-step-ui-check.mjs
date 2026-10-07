// Tests the new Next Step UI/UX improvements:
// 1) Industry inspection shows prominent Next Step card to connect to nearest buyer.
// 2) 1-click Connect plans and previews road/stops, then Build constructs them and opens route launcher.
// 3) Town inspection shows Next Step card to connect bus to nearest town.
// 4) Targets in industry destinations list offer direct Connect buttons.
import assert from 'node:assert/strict';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';

const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page, { biome: 'taiga', seed: 1847 });

  // 1. Verify Simplified HUD:
  assert.equal(await page.locator('.map-topline .map-title').isVisible(), false, 'redundant map title/weather is hidden');
  assert.equal(await page.locator('.map-hint').isVisible(), false, 'map hint is hidden');

  // 2. Inspect an unserved industry (e.g. Stone quarry):
  const quarry = await page.evaluate(() => {
    const q = transport.game.industries.find(i => i.kind === 'quarry');
    return { x: q.x, y: q.y, id: q.id, name: q.name };
  });

  await page.evaluate(({ x, y }) => transport.inspect(x, y), quarry);
  await page.locator('#inspector').waitFor({ state: 'visible' });

  // Check Next Step card is present in industry inspector:
  const nextStep = page.locator('#inspector .inspector-next-step');
  assert.equal(await nextStep.isVisible(), true, 'Industry inspector displays Next step card');
  const nextStepText = await nextStep.locator('strong').textContent();
  assert.match(nextStepText, /Connect to Alderbrook/);

  // Check target list buttons:
  const targetButtons = page.locator('#inspector .industry-target-list .target-connect');
  assert.ok(await targetButtons.count() > 0, 'targets have Connect buttons');

  // Click the Next Step connect button:
  await nextStep.locator('button').click();

  // Verify connection plan banner appears on map:
  const planBanner = page.locator('#connection-plan-banner');
  await planBanner.waitFor({ state: 'visible' });
  assert.match(await planBanner.textContent(), /Road .* tile.* \+ \d+ stop/);
  assert.equal(await page.locator('#build-connection-plan').isVisible(), true);

  // Click Build on connection plan:
  const beforeMoney = await page.evaluate(() => transport.game.money);
  await page.locator('#build-connection-plan').click();

  // Verify route form opened automatically with stops and cargo ready:
  await page.locator('#route-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#route-form [name="from"]').inputValue() !== '', true, 'Start stop selected');
  assert.equal(await page.locator('#route-form [name="to"]').inputValue() !== '', true, 'End stop selected');
  assert.equal(await page.locator('#route-launch button[type="submit"]').isVisible(), true, 'Buy & launch button ready');

  const afterMoney = await page.evaluate(() => transport.game.money);
  assert.ok(afterMoney < beforeMoney, 'Money was deducted for construction');

  // 3. Inspect an unserved Town:
  const unservedCity = await page.evaluate(() => {
    // Find city with no routes serving it
    const activeStops = new Set(transport.game.routes.filter(r => r.active).flatMap(r => r.stops));
    const city = transport.game.cities.find(c => {
      const near = transport.game.stations.filter(s => Math.hypot(s.x - c.x, s.y - c.y) <= 5);
      return !near.some(s => activeStops.has(s.id));
    });
    return city ? { x: city.x, y: city.y, id: city.id, name: city.name } : null;
  });

  if (unservedCity) {
    await page.evaluate(({ x, y }) => transport.inspect(x, y, 'city'), unservedCity);
    await page.locator('#inspector').waitFor({ state: 'visible' });
    const townNextStep = page.locator('#inspector .inspector-next-step');
    assert.equal(await townNextStep.isVisible(), true, 'Unserved town has Next step card');
    assert.match(await townNextStep.locator('strong').textContent(), /Connect bus to/);
  }

  assert.deepEqual(errors, []);
  console.log('Next step UI/UX checks passed successfully!');
} finally {
  await browser.close();
}
