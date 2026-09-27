// Floating income in a real browser: a paid delivery rises above its stop, the
// profit figure pulses, the Income layer hides it and Region sums nearby stops.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-floaters-qa';
await mkdir(output, { recursive: true });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);
  // Observe what the app hands the renderer and every class the profit figure receives.
  await page.evaluate(() => {
    const renderer = transport.renderer, original = renderer.render;
    window.floaterQA = { seen: [], pulses: 0, renders: 0 };
    renderer.render = function (now, view = {}) { floaterQA.renders++; for (const floater of view.floaters || []) if (!floaterQA.seen.includes(floater)) floaterQA.seen.push(floater); return original.apply(this, arguments); };
    new MutationObserver(() => { if (document.querySelector('#profit').classList.contains('income-pulse')) floaterQA.pulses++; }).observe(document.querySelector('#profit'), { attributes: true, attributeFilter: ['class'] });
    // Renders one moment with and without floaters and compares the band above the floaters' tiles.
    // Everything happens in one task, so the app's own frames cannot repaint in between.
    floaterQA.compare = (at, floaters, capture = false, half = 70) => {
      const canvas = document.querySelector('#world'), density = devicePixelRatio || 1, points = floaters.map(f => renderer.worldToScreen(f.x, f.y));
      const top = Math.min(...points.map(p => p.y)) - 150, bottom = Math.max(...points.map(p => p.y));
      const x = Math.round((points[0].x - half) * density), y = Math.round(top * density), w = Math.round(half * 2 * density), h = Math.round((bottom - top) * density);
      const read = list => { original.call(renderer, at, { floaters: list }); return canvas.getContext('2d').getImageData(x, y, w, h).data; };
      const plain = read(null), again = read(null), shown = read(floaters), rows = [];
      for (let row = 0; row < h; row++) { let differs = false; for (let i = row * w * 4; i < (row + 1) * w * 4 && !differs; i++) differs = shown[i] !== plain[i]; rows.push(differs); }
      const ranges = []; for (let row = 0; row < h; row++) if (rows[row] && !rows[row - 1]) ranges.push([row, row]); else if (rows[row]) ranges.at(-1)[1] = row;
      return { stable: plain.every((value, i) => value === again[i]), changed: rows.some(Boolean), top: rows.indexOf(true) / density, bands: ranges.length, ranges, image: capture ? canvas.toDataURL() : '' };
    };
  });
  const route = await page.evaluate(() => { const route = transport.game.routes[0]; return { id: route.id, revenue: route.revenue, cargo: route.cargo, stops: route.stops.map(id => transport.game.stations.find(stop => stop.id === id)).map(({ x, y }) => ({ x, y })) }; });
  await page.locator('[data-speed="3"]').click();
  await page.waitForFunction(revenue => transport.game.routes[0].revenue > revenue, route.revenue, { timeout: 90000 });
  await page.waitForFunction(() => floaterQA.seen.length > 0);
  const floater = await page.evaluate(() => { transport.setSpeed(0); const floater = floaterQA.seen[0]; transport.renderer.focus(floater.x, floater.y - 1); return { ...floater }; });
  await page.screenshot({ path: `${output}/delivery-floater.png` });
  assert.ok(route.stops.some(stop => stop.x === floater.x && stop.y === floater.y), 'income rises at a stop of the paying route');
  assert.equal(floater.cargo, route.cargo);
  assert.ok(floater.revenue > 0 && floater.revenue <= await page.evaluate(() => transport.game.routes[0].revenue) - route.revenue, 'the figure is the income just earned');
  await page.waitForFunction(() => floaterQA.pulses > 0, undefined, { timeout: 3000 });

  // Pixels above the stop at fixed moments; scenery may still be preparing, so
  // wait until two plain renders of the paused scene agree.
  const compare = (at, list, capture = false) => page.evaluate(({ at, list, capture }) => floaterQA.compare(at, list, capture), { at, list, capture });
  const live = [{ ...floater }], at = floater.born + 100;
  for (let attempt = 0; attempt < 30 && !(await compare(at, live)).stable; attempt++) await page.waitForTimeout(200);
  const shown = await compare(at, live);
  assert.equal(shown.stable, true, 'the paused scene renders identically');
  assert.equal(shown.changed, true, 'the floater changes the map above the stop');
  // Layers → Income off suppresses it.
  if (await page.locator('#layers-button').isVisible()) await page.locator('#layers-button').click(); else await openGameAction(page, 'layers-button');
  await page.locator('#layers-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-layer="deliveries"]').evaluate(input => input.labels[0].textContent.trim()), 'Income');
  await page.locator('[data-layer="deliveries"]').setChecked(false);
  await page.waitForFunction(() => transport.renderer.getLayers().deliveries === false);
  assert.equal((await compare(at, live)).changed, false, 'Income off leaves the map exactly as without floaters');
  await page.locator('[data-layer="deliveries"]').setChecked(true);
  await page.keyboard.press('Escape');
  // The pill rises with ease-out and fades by 1.6 s; reduced motion keeps it in place.
  const early = await compare(floater.born, live), later = await compare(floater.born + 800, live);
  assert.ok(early.changed && later.changed, 'the pill is drawn above the stop');
  assert.ok(early.top - later.top >= 17 && early.top - later.top <= 22, `the pill rises about 19 px by mid-life (${early.top - later.top})`);
  assert.equal((await compare(floater.born + 1600, live)).changed, false, 'the floater is gone after 1.6 s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal((await compare(floater.born + 800, live)).top, early.top, 'reduced motion keeps the pill in place');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Region sums nearby deliveries into one figure per 3×3-tile cell; Town keeps each stop's own.
  const cell = { x: Math.floor(floater.x / 3) * 3, y: Math.floor(floater.y / 3) * 3 };
  const pair = [{ ...floater, x: cell.x, y: cell.y, revenue: 12480 }, { ...floater, x: cell.x + 2, y: cell.y + 2, revenue: 900, born: floater.born - 50 }];
  const bandsAt = async zoom => { await page.evaluate(({ zoom, cell }) => { transport.renderer.setZoom(zoom); transport.renderer.focus(cell.x + 1, cell.y + 1); }, { zoom, cell }); for (let attempt = 0; attempt < 30 && !(await compare(at, pair)).stable; attempt++) await page.waitForTimeout(200); return compare(at, pair, true); };
  const town = await bandsAt(1), region = await bandsAt(.5);
  assert.equal(town.bands, 2, `Town shows each stop’s delivery ${JSON.stringify(town.ranges)}`);
  assert.equal(region.bands, 1, `two deliveries in one Region cell share a single pill ${JSON.stringify(region.ranges)}`);
  await writeFile(`${output}/town-pair.png`, Buffer.from(town.image.split(',')[1], 'base64'));
  await writeFile(`${output}/region-sum.png`, Buffer.from(region.image.split(',')[1], 'base64'));
  await page.evaluate(({ x, y }) => { transport.renderer.setZoom(1); transport.renderer.focus(x, y - 1); }, floater);

  // A just-paused game repaints only until the floaters fade, then stays still.
  await page.locator('[data-speed="3"]').click();
  const seen = await page.evaluate(() => floaterQA.seen.length);
  await page.waitForFunction(seen => floaterQA.seen.length > seen, seen, { timeout: 90000 });
  await page.evaluate(() => transport.setSpeed(0));
  const paused = await page.evaluate(() => floaterQA.renders);
  await page.waitForTimeout(2000);
  const fading = await page.evaluate(() => floaterQA.renders);
  assert.ok(fading > paused, 'the fade keeps painting while the game is paused');
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => floaterQA.renders), fading, 'no redraws once the floaters have faded');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(`Transport delivery floater checks passed (+$${floater.revenue} ${floater.cargo} at ${floater.x},${floater.y}). Screenshots: ${output}`);
} finally { await browser.close(); }
