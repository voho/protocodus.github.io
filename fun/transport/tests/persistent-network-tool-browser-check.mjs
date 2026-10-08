import { openBuildArea } from './browser-build.mjs';
// A completed network stroke leaves the next gesture ready, without opening a
// panel. Real pointer input verifies this for every network tool and both layouts.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-persistent-network-tool';
await mkdir(output, { recursive: true });
const errors = [], results = [];

async function prepare(page, tool) {
  return page.evaluate(async tool => {
    const g = transport.game;
    const { releaseTerrainObjects } = await import('./terrain-objects.js');
    let site = window.networkToolQA?.site;
    if (!site) {
      outer: for (let y = 40; y < g.height - 64; y += 40) for (let x = 40; x < g.width - 64; x += 40) {
        if ([...g.cities, ...g.industries, ...g.stations].some(p => p.x >= x - 16 && p.x <= x + 40 && p.y >= y - 16 && p.y <= y + 40)) continue;
        for (let dy = -10; dy <= 32; dy++) for (let dx = -10; dx <= 30; dx++) {
          const tile = g.tiles[(y + dy) * g.width + x + dx];
          if (tile.road || tile.rail || tile.bridge || tile.tunnel || tile.building || tile.zone) continue outer;
        }
        site = { x, y }; break outer;
      }
      if (!site) throw new Error('No vacant network tool fixture site.');
      const renderer = transport.renderer, render = renderer.render;
      window.networkToolQA = { site, preview: [], marks: [] };
      renderer.render = (now, view = {}) => {
        networkToolQA.tool = view.tool;
        networkToolQA.preview = (view.preview || []).map(({ x, y }) => ({ x, y }));
        if (view.constructionFeedback?.length) networkToolQA.marks.push(...view.constructionFeedback.map(e => e.kind));
        return render(now, view);
      };
    }
    const points = [];
    for (let dy = -9; dy <= 31; dy++) for (let dx = -9; dx <= 29; dx++) points.push({ x: site.x + dx, y: site.y + dy });
    releaseTerrainObjects(g, points);
    const span = tool.includes('bridge') || tool.includes('tunnel'), tunnel = tool.includes('tunnel');
    for (const { x, y } of points) {
      const middle = x >= site.x + 2 && x <= site.x + 10;
      const level = span && middle ? tunnel ? 4 : 1 : 2;
      const tile = g.tiles[y * g.width + x];
      Object.assign(tile, { terrain: 'grass', elevation: level / 7, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
      delete tile.publicRoad; delete tile.structureAxis; delete tile.structureLevel;
    }
    g.money = 1_000_000; g.revision++; g.networkRevision++;
    transport.renderer.setZoom(1);
    return [0, 14].map(dy => ({ a: { x: site.x, y: site.y + dy }, b: { x: site.x + (span ? 12 : 5), y: site.y + dy } }));
  }, tool);
}
async function choose(page, tool) {
  if (tool === 'road' || tool === 'rail') return page.locator(`[data-toolbar-tool="${tool}"]`).click();
  await openBuildArea(page, 'terrain');
  await page.locator(`[data-crossing-mode="${tool.startsWith('rail') ? 'rail' : 'road'}"]`).click();
  if (!await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open'))) await openBuildArea(page, 'terrain');
  await page.locator(`[data-tool="${tool}"]`).click();
}
async function snapshot(page) {
  return page.evaluate(() => {
    const g = transport.game, { site } = networkToolQA, tiles = [];
    for (let dy = -9; dy <= 31; dy++) for (let dx = -9; dx <= 29; dx++) tiles.push(g.tiles[(site.y + dy) * g.width + site.x + dx]);
    return { money: g.money, monthlyExpenses: g.monthlyExpenses, totalExpenses: g.totalExpenses, tiles: JSON.stringify(tiles) };
  });
}
async function begin(page, { a, b }) {
  const screen = await page.evaluate(({ a, b }) => {
    transport.renderer.focus((a.x + b.x) / 2, a.y);
    networkToolQA.marks = [];
    const rect = document.querySelector('#world').getBoundingClientRect();
    return [a, b].map(p => { const q = transport.renderer.worldToScreen(p.x, p.y); return { x: rect.left + q.x, y: rect.top + q.y }; });
  }, { a, b });
  for (const p of screen) assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, p), 'world');
  await page.mouse.move(screen[0].x, screen[0].y); await page.mouse.down();
  await page.mouse.move(screen[1].x, screen[1].y, { steps: 5 });
  await page.waitForFunction(({ a, b }) => {
    const path = networkToolQA.preview;
    return path[0]?.x === a.x && path[0]?.y === a.y && path.at(-1)?.x === b.x && path.at(-1)?.y === b.y;
  }, { a, b });
  const quote = await page.evaluate(async () => (await import('./construction-plan.js')).quoteBuildPlan(transport.game, networkToolQA.tool, networkToolQA.preview));
  return { quote, screen };
}
async function active(page, tool) {
  await page.waitForFunction(tool => networkToolQA.tool === tool, tool);
  assert.equal(await page.locator('#active-tool-bar').isVisible(), true, `${tool} stays selected`);
  assert.equal(await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open')), false, 'successful strokes never force open Build');
}

try {
  for (const profile of [{ name: 'desktop-retina', width: 1440, height: 900, dpr: 2 }, { name: 'laptop', width: 1024, height: 768, dpr: 1 }]) {
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await createWorldFromMenu(page, { generationVersion: 11 });
    await page.locator('#dismiss-objective').click();
    for (const [index, tool] of ['road', 'rail', 'bridge', 'railbridge', 'tunnel', 'railtunnel'].entries()) {
      const strokes = await prepare(page, tool);
      await choose(page, tool);
      const before = await snapshot(page), first = await begin(page, strokes[0]);
      assert.equal(first.quote.ok, true, `${tool}: ${first.quote.message}`);
      await page.mouse.up(); await active(page, tool);
      const afterFirst = await snapshot(page);
      assert.equal(before.money - afterFirst.money, first.quote.cost, 'first gesture charges its preview price');

      // No tool selection between the gestures is the regression under test.
      const second = await begin(page, strokes[1]);
      assert.equal(second.quote.ok, true, `${tool}: ${second.quote.message}`);
      await page.mouse.up(); await active(page, tool);
      await page.waitForFunction(() => networkToolQA.marks.includes('build'));
      const afterSecond = await snapshot(page);
      assert.equal(afterFirst.money - afterSecond.money, second.quote.cost, 'the next gesture builds, rather than panning');
      const connected = await page.evaluate(async ({ strokes, tool }) => {
        const { findPath } = await import('./model.js');
        return strokes.every(({ a, b }) => findPath(transport.game, a, b, tool.startsWith('rail') ? 'rail' : 'road'));
      }, { strokes, tool });
      assert.equal(connected, true, 'both complete strokes make usable infrastructure');
      if (['road', 'rail', 'bridge'].includes(tool)) await page.screenshot({ path: `${output}/${profile.name}-${tool}.png` });

      await page.locator('#world').focus(); await page.keyboard.press('Control+z');
      assert.deepEqual(await snapshot(page), afterFirst, 'Undo restores only the most recent stroke and its complete charge');
      await active(page, tool);

      if (tool === 'road') {
        await begin(page, strokes[1]); await page.keyboard.press('Escape'); await page.mouse.up();
        assert.deepEqual(await snapshot(page), afterFirst, 'Escape first cancels only the current uncommitted drag');
        await active(page, tool);
        await page.evaluate(() => { transport.game.money = 0; });
        const poor = await snapshot(page), refused = await begin(page, strokes[1]);
        assert.equal(refused.quote.ok, false); assert.match(refused.quote.message, /Need \$/);
        await page.mouse.up(); await active(page, tool);
        assert.deepEqual(await snapshot(page), poor, 'a refused next stroke preserves the world and selected tool');
      }
      const cancel = ['Done', 'Escape', 'right-click'][index % 3];
      if (cancel === 'Done') await page.locator('#cancel-tool-button').click();
      else if (cancel === 'Escape') await page.keyboard.press('Escape');
      else await page.mouse.click(second.screen[1].x, second.screen[1].y, { button: 'right' });
      await page.waitForFunction(() => networkToolQA.tool === 'inspect');
      assert.equal(await page.locator('#active-tool-bar').isVisible(), false, `${cancel} ends construction`);
      assert.equal(await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open')), cancel === 'Done');
      if (cancel === 'Done') await page.locator('#close-management').click();
      results.push({ profile: profile.name, tool, consecutiveStrokes: 2, cancel, undo: true });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cases: results.length, errors, output }, null, 2));
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
}
