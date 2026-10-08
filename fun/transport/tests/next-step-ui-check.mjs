// Tests the new Next Step UI/UX improvements:
// 1) Industry inspection shows prominent Next Step card to connect to nearest buyer.
// 2) 1-click Connect plans and previews road/stops, then Build constructs them and opens route launcher.
// 3) Town inspection shows Next Step card to connect bus to nearest town.
// 4) Targets in industry destinations list offer direct Connect buttons.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-next-step-qa';
await mkdir(output, { recursive: true });

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

  // A remembered railway tool must not turn a suggested road connection into an expensive train line.
  await page.locator('[data-toolbar-tool="rail"]').click();
  await page.keyboard.press('Escape');

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
  assert.equal(await page.locator('#route-form [name="mode"]').inputValue(), 'road', 'the suggested connection keeps its road promise after Railway was selected');
  const beforeLaunch = await page.evaluate(() => transport.game.routes.length);
  await page.locator('#route-launch button[type="submit"]').click();
  assert.equal(await page.evaluate(() => transport.game.routes.length), beforeLaunch + 1, 'the prepared route launches without extra decisions');
  assert.equal(await page.evaluate(() => transport.game.routes.at(-1).mode), 'road');

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
    await page.locator('[data-toolbar-tool="rail"]').click();
    await page.keyboard.press('Escape');
    await page.evaluate(({ x, y }) => transport.inspect(x, y, 'city'), unservedCity);
    await page.locator('#inspector').waitFor({ state: 'visible' });
    const townNextStep = page.locator('#inspector .inspector-next-step');
    assert.equal(await townNextStep.isVisible(), true, 'Unserved town has Next step card');
    assert.match(await townNextStep.locator('strong').textContent(), /Connect bus to/);
    await page.screenshot({ path: `${output}/town-next-step.png` });
    const beforePlan = await page.evaluate(() => transport.game.money);
    await townNextStep.locator('button').click();
    await page.locator('#connection-plan-banner').waitFor({ state: 'visible' });
    assert.match(await page.locator('#connection-plan-banner').textContent(), /then a bus/i);
    assert.doesNotMatch(await page.locator('#connection-plan-banner').textContent(), /Rail|train/);
    await page.locator('#cancel-connection-plan').click();
    assert.equal(await page.evaluate(() => transport.game.money), beforePlan, 'previewing and cancelling the bus connection spends nothing');
  }

  // A served town waiting for food gets a delivery draft ordered producer → town.
  // Use a real residential plot and nearby food plant to keep this regression independent of distant world sites.
  const supply = await page.evaluate(async () => {
    const { build } = await import('./model.js'), game = transport.game, town = game.cities[0];
    game.money = 5e6;
    town.lastSupply = {};
    let zone = null;
    for (let r = 2; r < 8 && !zone; r++) for (let dy = -r; dy <= r && !zone; dy++) for (let dx = -r; dx <= r && !zone; dx++) {
      const x = town.x + dx, y = town.y + dy, tile = game.tiles[y * game.width + x];
      if (!tile.building && !tile.road && !tile.zone && build(game, 'residential', x, y).ok) zone = game.zones.at(-1);
    }
    if (!zone) throw new Error('No residential plot for the town supply regression');
    zone.progress = 1.4;
    let producer = null;
    for (let r = 5; r < 15 && !producer; r++) for (let dy = -r; dy <= r && !producer; dy++) for (let dx = -r; dx <= r && !producer; dx++) {
      if (build(game, 'food-plant', town.x + dx, town.y + dy).ok) producer = game.industries.at(-1);
    }
    if (!producer) throw new Error('No nearby food plant for the town supply regression');
    producer.inventory.food = 60;
    transport.setTool('rail');
    transport.setTool('inspect');
    transport.inspect(town.x, town.y, 'city');
    return { townId: town.id, producerId: producer.id };
  });
  const supplyStep = page.locator('#inspector .inspector-next-step');
  assert.match(await supplyStep.locator('strong').textContent(), /Supply Food from/);
  await supplyStep.locator('button').click();
  if (await page.locator('#connection-plan-banner').isVisible()) {
    assert.match(await page.locator('#connection-plan-banner').textContent(), /then a truck/);
    await page.locator('#build-connection-plan').click();
  }
  await page.locator('#route-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#route-form [name="mode"]').inputValue(), 'road');
  const delivery = await page.evaluate(async ({ townId, producerId }) => {
    const { stationCoverage } = await import('./model.js'), game = transport.game;
    const stops = ['from', 'to'].map(name => game.stations.find(stop => stop.id === document.querySelector(`#route-form [name="${name}"]`).value));
    const coverage = stops.map(stop => stationCoverage(game, stop));
    return { startsAtProducer: coverage[0].industries.some(site => site.id === producerId), endsAtTown: coverage[1].cities.some(city => city.id === townId) };
  }, supply);
  assert.deepEqual(delivery, { startsAtProducer: true, endsAtTown: true });
  assert.doesNotMatch(await page.locator('#route-connection').textContent(), /Loads at the end stop/);
  await page.screenshot({ path: `${output}/supply-ready-to-launch.png` });
  await page.locator('#route-launch button[type="submit"]').click();
  assert.equal(await page.evaluate(() => transport.game.routes.at(-1).cargo), 'food', 'the town supply suggestion launches the promised food service');

  assert.deepEqual(errors, []);
  console.log('Next step UI/UX checks passed successfully!');
} finally {
  await browser.close();
}
