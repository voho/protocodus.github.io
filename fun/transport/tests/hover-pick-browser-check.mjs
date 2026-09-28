// Explore hover picking in a real browser: a first sweep over the start town at every zoom reads each sprite back once
// at most and keeps every pick under 3 ms; 500 random points per zoom pick the same tile as the original one-pixel
// readback; a paused jiggle inside one tile repaints the map at most twice.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
// GPU-backed canvases make every getImageData a synchronous readback, as in ordinary play.
const args = [...process.platform === 'darwin' ? ['--use-angle=metal'] : [], '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-hover-pick-qa';
await mkdir(output, { recursive: true });
const errors = [], VIEWS = [{ zoom: .5, name: 'Region' }, { zoom: 1, name: 'Town' }, { zoom: 2, name: 'Detail' }];

async function open(deviceScaleFactor, warnings = []) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); else if (/willReadFrequently/.test(message.text())) warnings.push(message.text()); });
  await page.goto(url);
  await createWorldFromMenu(page);
  await page.evaluate(() => document.querySelector('#dismiss-objective')?.click());
  await page.evaluate(() => {
    // Counts sprite readbacks; `strict` refuses whole-sprite reads, so picking falls back to the original one-pixel test.
    const read = CanvasRenderingContext2D.prototype.getImageData, renderer = transport.renderer, pick = renderer.screenToInspectTile, render = renderer.render;
    window.pickQA = { strict: false, full: 0, pixels: 0, canvases: new Set(), times: [], renders: 0, pick, render };
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h, ...rest) {
      if (w * h > 1) { if (pickQA.strict) throw new Error('One-pixel picking only'); pickQA.full++; pickQA.canvases.add(this.canvas); } else pickQA.pixels++;
      return read.call(this, x, y, w, h, ...rest);
    };
    renderer.screenToInspectTile = (...args) => { const start = performance.now(), tile = pick(...args); pickQA.times.push(performance.now() - start); return tile; };
    renderer.render = (...args) => { pickQA.renders++; return render(...args); };
    pickQA.reset = () => Object.assign(pickQA, { full: 0, pixels: 0, canvases: new Set(), times: [], renders: 0 });
    // Centres the start town, lets the camera settle and finishes scenery batches, so the pick list is final.
    pickQA.view = async zoom => {
      const home = transport.game.cities[0];renderer.setZoom(zoom);renderer.focus(home.x, home.y);render(performance.now(), {});
      await new Promise(resolve => setTimeout(resolve, 150));
      for (let i = 0; i < 600 && (i < 2 || renderer.getStats().sceneryBatches.pending); i++)render(performance.now(), {});
      if (renderer.getStats().sceneryBatches.pending) throw new Error('Scenery batches did not finish');
      return renderer.worldToScreen(home.x, home.y);
    };
    // Canvas points around the town, clear of the drawer and other chrome.
    pickQA.points = (centre, step, seed = 0, count = 0) => {
      const canvas = document.querySelector('#world'), rect = canvas.getBoundingClientRect(), halfW = Math.min(rect.width / 2, 400), halfH = Math.min(rect.height / 2, 260), points = [];
      const onMap = (x, y) => x >= rect.left && y >= rect.top && x < rect.right && y < rect.bottom && document.elementFromPoint(x, y) === canvas;
      const cx = Math.max(rect.left + halfW, Math.min(rect.right - halfW, rect.left + centre.x)), cy = Math.max(rect.top + halfH, Math.min(rect.bottom - halfH, rect.top + centre.y));
      if (!count) { for (let y = cy - halfH; y < cy + halfH; y += step)for (let x = cx - halfW; x < cx + halfW; x += step)if (onMap(x, y))points.push({ x, y }); return points; }
      let s = seed >>> 0;const random = () => (s = Math.imul(s ^ s >>> 15, 2246822507) + 0x6d2b79f5 >>> 0) / 4294967296;
      while (points.length < count) { const x = cx - halfW + random() * halfW * 2, y = cy - halfH + random() * halfH * 2; if (onMap(x, y))points.push({ x, y }); }
      return points;
    };
  });
  return page;
}

try {
  // A first hover sweep, as a player's mouse crosses the town: few readbacks, no slow picks.
  const warnings = [], page = await open(2, warnings), sweep = [];
  for (const view of VIEWS) {
    const centre = await page.evaluate(zoom => pickQA.view(zoom), view.zoom);
    const points = await page.evaluate(centre => pickQA.points(centre, 16), centre);
    await page.evaluate(() => pickQA.reset());
    for (const point of points) await page.mouse.move(point.x, point.y);
    const stats = await page.evaluate(() => ({ picks: pickQA.times.length, max: Math.max(...pickQA.times), full: pickQA.full, pixels: pickQA.pixels, canvases: pickQA.canvases.size }));
    sweep.push({ view: view.name, moves: points.length, ...stats });
    assert.ok(stats.picks >= points.length * .9, `${view.name}: the sweep hovers the map (${stats.picks} picks for ${points.length} moves)`);
    assert.ok(stats.full > 0, `${view.name}: the sweep crosses sprite artwork`);
    assert.equal(stats.pixels, 0, `${view.name}: sprites are masked whole instead of read pixel by pixel`);
    assert.equal(stats.full, stats.canvases, `${view.name}: each sprite is read back once`);
    assert.ok(stats.max < 3, `${view.name}: the slowest first-pass pick takes ${stats.max.toFixed(2)} ms`);
    console.log(`${view.name} sweep: ${points.length} moves, ${stats.canvases} sprites read once, slowest pick ${stats.max.toFixed(1)} ms`);
    if (view.name === 'Detail') await page.screenshot({ path: `${output}/hover-detail.png` });
  }
  await page.evaluate(() => pickQA.reset());
  for (const point of await page.evaluate(() => pickQA.points(transport.renderer.worldToScreen(transport.game.cities[0].x, transport.game.cities[0].y), 32))) await page.mouse.move(point.x, point.y);
  assert.deepEqual(await page.evaluate(() => [pickQA.full, pickQA.pixels]), [0, 0], 'a second sweep reads nothing back');
  const readbacks = sweep.reduce((sum, row) => sum + row.canvases, 0);
  assert.ok(warnings.length <= readbacks, `at most one readback warning per sprite (${warnings.length} for ${readbacks} sprites)`);

  // A paused jiggle inside one tile keeps the hover and repaints nothing new.
  await page.evaluate(zoom => pickQA.view(zoom), 1);
  const still = await page.evaluate(() => {
    const canvas = document.querySelector('#world'), home = transport.renderer.worldToScreen(transport.game.cities[0].x, transport.game.cities[0].y);
    const same = (a, b) => a.x === b.x && a.y === b.y;
    for (const point of pickQA.points(home, 7)) {
      const offsets = [-4, -2, 0, 2, 4].flatMap(dx => [-4, -2, 0, 2, 4].map(dy => ({ x: point.x + dx, y: point.y + dy }))), tile = pickQA.pick(point.x, point.y);
      if (offsets.every(p => document.elementFromPoint(p.x, p.y) === canvas && same(pickQA.pick(p.x, p.y), tile)))return { point, offsets, tile };
    }
    return null;
  });
  assert.ok(still, 'a tile wide enough to jiggle inside is on screen');
  await page.mouse.move(still.point.x, still.point.y);
  await page.waitForTimeout(250);
  await page.evaluate(() => pickQA.reset());
  for (let i = 0; i < 60; i++) { const p = still.offsets[i * 7 % still.offsets.length]; await page.mouse.move(p.x, p.y); await page.waitForTimeout(8); }
  await page.waitForTimeout(200);
  const jiggle = await page.evaluate(() => ({ renders: pickQA.renders, picks: pickQA.times.length, coordinates: document.querySelector('#tile-coordinates').textContent }));
  assert.ok(jiggle.picks >= 60, 'every jiggle move picks a tile');
  assert.ok(jiggle.coordinates.startsWith(`${still.tile.x}, ${still.tile.y}`), `the coordinate label follows the hover (${jiggle.coordinates})`);
  assert.ok(jiggle.renders <= 2, `60 moves inside one paused tile repaint ${jiggle.renders} times`);
  await page.screenshot({ path: `${output}/hover-town.png` });
  await page.close();

  // Parity: at 500 seeded points per zoom, whole-sprite masks pick exactly what one-pixel readbacks picked.
  for (const density of [1, 2]) {
    const page = await open(density);
    for (const view of VIEWS) {
      const centre = await page.evaluate(zoom => pickQA.view(zoom), view.zoom);
      const row = await page.evaluate(({ centre, seed }) => {
        const points = pickQA.points(centre, 0, seed, 500), renderer = transport.renderer, ground = points.map(p => renderer.screenToTile(p.x, p.y));
        pickQA.reset();pickQA.strict = true;const before = points.map(p => pickQA.pick(p.x, p.y)), strict = pickQA.pixels;pickQA.strict = false;
        pickQA.reset();const after = points.map(p => pickQA.pick(p.x, p.y)), masked = { full: pickQA.full, pixels: pickQA.pixels, canvases: pickQA.canvases.size };
        pickQA.reset();points.forEach(p => pickQA.pick(p.x, p.y));
        return { points: points.length, strict, ...masked, again: pickQA.full + pickQA.pixels, raised: after.filter((tile, i) => tile.x !== ground[i].x || tile.y !== ground[i].y).length,
          mismatches: points.flatMap((p, i) => before[i].x === after[i].x && before[i].y === after[i].y ? [] : [{ ...p, before: before[i], after: after[i] }]) };
      }, { centre, seed: 1847 + view.zoom * 100 + density });
      assert.equal(row.points, 500);
      assert.ok(row.strict > 50, `${view.name} at ${density}×: the one-pixel picker tests sprite pixels (${row.strict})`);
      assert.ok(row.raised > 20, `${view.name} at ${density}×: many points pick artwork above the ground tile (${row.raised})`);
      assert.deepEqual(row.mismatches, [], `${view.name} at ${density}×: masks pick the same tiles as one-pixel readbacks`);
      assert.equal(row.pixels, 0, `${view.name} at ${density}×: masks replace one-pixel reads`);
      assert.equal(row.full, row.canvases, `${view.name} at ${density}×: one readback per sprite`);
      assert.equal(row.again, 0, `${view.name} at ${density}×: repeated picks read nothing back`);
      console.log(`${view.name} at ${density}×: 500 points agree, ${row.raised} above the ground, ${row.canvases} sprites masked`);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Hover picking check passed: ${warnings.length} readback warnings, ${jiggle.renders} repaints for 60 moves inside a paused tile. Screenshot: ${output}`);
} finally {
  await browser.close();
}
