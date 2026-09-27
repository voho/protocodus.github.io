// The first screen of a new game: town labels clear their stop signs, the signs still
// pick, and inspector and dialog copy reads in sentence case. Serve the repository root first.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-readability-qa';
await mkdir(output, { recursive: true });
const errors = [];
const nextFrame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const shouting = /\b[A-Z]{2,}\b/;

async function clickStopSign(page, station) {
  const sign = await page.evaluate(station => {
    transport.renderer.focus(station.x, station.y);
    const rect = document.querySelector('#world').getBoundingClientRect(), marker = transport.renderer.stationMarker(station);
    return { x: rect.left + marker.x + marker.size / 2, y: rect.top + marker.y + marker.size / 2 };
  }, station);
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'world', sign);
  await page.mouse.click(sign.x, sign.y);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page, { seed: 1847 });
  const town = await page.evaluate(() => {
    const city = transport.game.cities[0];
    return { city, stops: transport.game.stations.filter(station => Math.max(Math.abs(station.x - city.x), Math.abs(station.y - city.y)) <= 1) };
  });
  assert.ok(town.stops.some(stop => stop.x === town.city.x && stop.y === town.city.y), `${town.city.name} starts with its stop on the town centre`);

  // The label rises clear of the stop sign in every view; the sign itself never moves.
  for (const zoom of [.5, 1, 2]) {
    await page.evaluate(({ city, zoom }) => { transport.renderer.setZoom(zoom); transport.renderer.focus(city.x, city.y); }, { ...town, zoom });
    await nextFrame(page);
    const scene = await page.evaluate(({ city, stops }) => ({
      label: transport.renderer.cityLabels().find(rect => rect.id === city.id), top: document.querySelector('#world').getBoundingClientRect().top,
      signs: stops.map(stop => transport.renderer.stationMarker(stop)).map(sign => ({ x: sign.x, y: sign.y, w: sign.size, h: sign.size })),
    }), town);
    assert.ok(scene.label, `${zoom}x draws the ${town.city.name} label`);
    for (const sign of scene.signs) assert.equal(intersects(scene.label, sign), false, `${zoom}x ${town.city.name} label clears its stop sign`);
    await page.screenshot({ path: `${output}/town-label-${zoom}x.png`, clip: { x: scene.label.x - 70, y: scene.top + scene.label.y - 50, width: scene.label.w + 140, height: 160 } });
  }

  // Picking still resolves the unmoved sign beneath the raised label.
  const [from, to] = await page.evaluate(() => { transport.renderer.setZoom(.5); transport.setView('routes'); return transport.game.stations.filter(station => station.mode === 'road').slice(0, 2); });
  await page.waitForFunction(() => document.querySelector('.management-drawer-heading')?.innerText);
  assert.equal(await page.locator('.management-drawer-heading').innerText(), 'Management', 'the drawer heading uses sentence case');
  await page.locator('#route-form [name="mode"]').selectOption('road');
  await page.locator('[data-pick-route="from"]').click();
  await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
  await clickStopSign(page, from);
  await clickStopSign(page, to);
  await page.locator('#route-pick-banner').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), from.id, 'Region view picks the departure from its stop sign');
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), to.id, 'Region view picks the arrival from its stop sign');

  await page.locator('[data-remove-route]').first().click();
  assert.equal(await page.locator('#modal .eyebrow').innerText(), 'Network', 'the retire dialog uses sentence case');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#modal').open);
  await page.locator('#close-management').click();
  await page.evaluate(() => transport.renderer.setZoom(1));

  // The stop inspector keeps its network values apart from the coverage beneath them.
  await page.evaluate(stop => { transport.renderer.focus(stop.x, stop.y); transport.inspect(stop.x, stop.y); }, from);
  assert.equal(await page.locator('#inspector .eyebrow').innerText(), 'Road stop');
  const spacing = await page.locator('#inspector').evaluate(box => ({ value: box.querySelector('.inspector-grid strong').getBoundingClientRect().bottom, loads: box.querySelector('.coverage-note > strong').getBoundingClientRect().top }));
  assert.ok(spacing.value <= spacing.loads, `the Road value ends above the Loads label (${spacing.value} > ${spacing.loads})`);
  await page.locator('#inspector').screenshot({ path: `${output}/stop-inspector.png` });
  const tags = await page.evaluate(({ city }) => {
    const g = transport.game, tag = (x, y, kind) => { transport.inspect(x, y, kind); return document.querySelector('#inspector .eyebrow').textContent; };
    const industry = g.industries[0], home = g.tiles.findIndex((tile, index) => tile.building?.kind.startsWith('house') && Math.hypot(index % g.width - city.x, Math.floor(index / g.width) - city.y) < 10);
    return { town: tag(city.x, city.y, 'city'), industry: tag(industry.x, industry.y, 'industry'), home: tag(home % g.width, Math.floor(home / g.width)), land: tag(city.x + 30, city.y + 30) };
  }, town);
  assert.equal(tags.town, 'Town');
  assert.match(tags.industry, /^Industry · \d × \d site$/);
  assert.match(tags.home, /^\d × \d site · \w+ home$/);
  assert.match(tags.land, /^Level \d/);
  for (const [kind, text] of Object.entries(tags)) assert.doesNotMatch(text, shouting, `the ${kind} inspector tag uses sentence case`);
  await page.locator('#inspector .tiny-button').click();

  await openGameAction(page, 'help-button');
  await page.locator('[data-help-tab="chains"]').click();
  await page.locator('.chains-explorer').waitFor({ state: 'visible' });
  const stages = await page.locator('.chain-stage-label').evaluateAll(nodes => nodes.map(node => node.innerText));
  assert.ok(stages.length > 0 && stages.every(text => !shouting.test(text)), `chain stages use sentence case: ${stages.join(', ')}`);
  await page.locator('#modal').screenshot({ path: `${output}/chains.png` });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#modal').open);
  await openGameAction(page, 'save-button');
  await page.locator('#modal .eyebrow').waitFor();
  assert.doesNotMatch(await page.locator('#modal .eyebrow').innerText(), shouting, 'the saves dialog uses sentence case');
  await page.locator('#modal').screenshot({ path: `${output}/saves.png` });
  await page.keyboard.press('Escape');

  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(`Readability browser checks passed; screenshots: ${output}`);
} finally {
  await browser.close();
}
