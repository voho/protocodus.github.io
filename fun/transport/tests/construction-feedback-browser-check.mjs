// Successful construction through the desktop UI: bounded, temporary map marks
// while paused, and no success mark for a rejected or already-complete edit.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-construction-feedback';
await mkdir(output, { recursive: true });
const errors = [], results = [];
const profiles = [
  { name: 'desktop-retina', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' },
  { name: 'laptop-reduced-motion', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, reducedMotion: 'reduce' },
];
const clearFrames = page => page.evaluate(() => { constructionQA.frames = []; constructionQA.capture = null; });
const frames = page => page.evaluate(() => constructionQA.frames);
const company = page => page.evaluate(() => ({ money: transport.game.money, day: transport.game.day, stations: transport.game.stations.length }));
const saveMark = async (page, name) => {
  const png = await page.evaluate(() => constructionQA.capture);
  assert.ok(png, 'capture the first real rendered confirmation before its short lifetime ends');
  await writeFile(`${output}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
};

async function waitForMark(page, kind) {
  await page.waitForFunction(kind => constructionQA.frames.some(frame => frame.stats.cells > 0 && frame.stats.kinds.includes(kind)), kind, { timeout: 3000 }).catch(async error => {
    console.error(JSON.stringify(await page.evaluate(() => ({ now: performance.now(), tool: document.querySelector('#active-tool-name').textContent, toasts: document.querySelector('#toast-region').innerText, industries: transport.game.industries, frames: constructionQA.frames.slice(-3) })), null, 2));
    throw error;
  });
  const shown = (await frames(page)).filter(frame => frame.stats.kinds.includes(kind));
  assert.ok(shown.every(frame => frame.stats.cells <= 96), 'one bounded footprint even for a large connection');
  return shown[0];
}

async function waitForClear(page) {
  await page.waitForFunction(() => !transport.renderer.getStats().constructionFeedback.cells, undefined, { timeout: 3000 }).catch(async error => {
    console.error(JSON.stringify(await page.evaluate(() => ({ now: performance.now(), stats: transport.renderer.getStats().constructionFeedback, frames: constructionQA.frames.slice(-3) })), null, 2));
    throw error;
  });
  const rendered = await frames(page), lastMark = rendered.findLastIndex(frame => frame.stats.cells > 0);
  assert.ok(lastMark >= 0 && rendered.slice(lastMark + 1).some(frame => frame.stats.cells === 0), 'a final frame erases the mark while paused');
  assert.equal(await page.evaluate(() => transport.speed), 0);
}

async function points(page, tiles) {
  const screen = await page.evaluate(tiles => {
    const middle = tiles.reduce((sum, p) => ({ x: sum.x + p.x / tiles.length, y: sum.y + p.y / tiles.length }), { x: 0, y: 0 });
    transport.renderer.focus(middle.x, middle.y);
    const rect = document.querySelector('#world').getBoundingClientRect();
    return tiles.map(p => { const point = transport.renderer.worldToScreen(p.x, p.y); return { x: rect.left + point.x, y: rect.top + point.y }; });
  }, tiles);
  for (const point of screen) await page.waitForFunction(point => document.elementFromPoint(point.x, point.y)?.id === 'world', point);
  return screen;
}

async function drag(page, from, to = from) {
  const [a, b] = await points(page, [from, to]);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  if (a.x !== b.x || a.y !== b.y) await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

try {
  for (const profile of profiles) {
    const { name, ...options } = profile, page = await browser.newPage(options);
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(url); await createWorldFromMenu(page, { generationVersion: name === 'desktop-retina' ? 7 : 11 });
    await page.evaluate(() => {
      const renderer = transport.renderer, render = renderer.render;
      window.constructionQA = { frames: [], capture: null };
      renderer.render = (now, view = {}) => {
        render(now, view);
        constructionQA.frames.push({ now, stats: renderer.getStats().constructionFeedback, effects: view.constructionFeedback || [] });
        if (!constructionQA.capture && renderer.getStats().constructionFeedback.cells > 0) constructionQA.capture = document.querySelector('#world').toDataURL('image/png');
        if (constructionQA.frames.length > 180) constructionQA.frames.shift();
      };
    });

    if (name === 'desktop-retina') {
      const before = await company(page);
      await page.locator('#objective-plan').click();
      await page.waitForFunction(() => !transport.renderer.getStats().gliding);
      await clearFrames(page); await page.locator('#build-connection-plan').click();
      const connection = await waitForMark(page, 'build');
      assert.ok((await company(page)).money < before.money, 'the planned connection commits before its mark');
      await waitForClear(page);
      await clearFrames(page); await page.locator('#world').focus(); await page.keyboard.press('Control+z');
      await waitForMark(page, 'undo'); await waitForClear(page);
      assert.deepEqual(await company(page), before, 'undo restores the complete planned connection');
      results.push({ profile: name, connectionCells: connection.stats.cells });
    }

    await page.evaluate(async () => {
      transport.setTool('inspect'); transport.setView('build');
      document.querySelector('#dismiss-objective')?.click();
      const g = transport.game, { releaseTerrainObjects } = await import('./terrain-objects.js'), cleared = [];
      for (let y = 85; y <= 125; y++) for (let x = 85; x <= 130; x++) cleared.push({ x, y });
      releaseTerrainObjects(g, cleared);
      for (const { x, y } of cleared) Object.assign(g.tiles[y * g.width + x], {
        terrain: 'grass', detail: '', elevation: 3 / 7, variant: 0, publicRoad: false,
        road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null,
      });
      for (const key of ['cities', 'industries', 'stations', 'routes', 'vehicles', 'zones']) g[key] = [];
      g.money = 1_000_000; g.revision++; g.networkRevision++;
      transport.renderer.setGame(g); transport.renderer.setZoom(1); transport.setTool('road');
    });

    const beforeRoad = await company(page), from = { x: 100, y: 100 }, to = { x: 105, y: 100 };
    await clearFrames(page); await drag(page, from, to);
    const road = await waitForMark(page, 'build');
    assert.equal(road.stats.cells, 6, 'every changed road cell is confirmed');
    assert.equal(road.effects.flatMap(effect => effect.points).length, 6);
    await saveMark(page, `${name}-road`);
    await waitForClear(page);
    const roadFrames = (await frames(page)).flatMap(frame => frame.effects);
    if (profile.reducedMotion === 'reduce') assert.ok(roadFrames.every(effect => effect.alpha === 1), 'reduced motion stays static until removal');
    else assert.ok(roadFrames.some(effect => effect.alpha < 1), 'normal motion fades the confirmation');
    assert.equal((await company(page)).day, beforeRoad.day, 'presentation never advances a paused world');

    await page.evaluate(() => transport.setTool('road'));
    await clearFrames(page); const beforeNoop = await company(page);
    await drag(page, from, to);
    await page.waitForFunction(() => constructionQA.frames.length > 0);
    assert.deepEqual(await company(page), beforeNoop, 'an already-built road costs nothing');
    assert.ok((await frames(page)).every(frame => frame.stats.cells === 0), 'a no-op shows no success mark');

    await clearFrames(page); await page.locator('#world').focus(); await page.keyboard.press('Control+z');
    const undo = await waitForMark(page, 'undo');
    assert.equal(undo.stats.cells, 6); assert.deepEqual(await company(page), beforeRoad);
    await waitForClear(page);

    await page.evaluate(() => { transport.game.money = 0; transport.setTool('road'); }); await clearFrames(page);
    await drag(page, { x: 108, y: 100 });
    await page.waitForFunction(() => constructionQA.frames.length > 0);
    assert.equal(await page.evaluate(() => transport.game.tiles[100 * transport.game.width + 108].road), false);
    assert.match(await page.locator('#toast-region').innerText(), /Need \$/);
    assert.ok((await frames(page)).every(frame => frame.stats.cells === 0), 'an unaffordable edit never confirms success');

    await page.evaluate(() => { transport.game.money = 1_000_000; transport.setTool('quarry'); });
    await clearFrames(page); await drag(page, { x: 104, y: 108 });
    const industry = await waitForMark(page, 'build');
    assert.equal(industry.stats.cells, 25, 'an industry confirms its complete 5 × 5 parcel');
    await saveMark(page, `${name}-industry`);
    await waitForClear(page);
    results.push({ profile: name, roadCells: road.stats.cells, undoCells: undo.stats.cells, industryCells: industry.stats.cells, reducedMotion: profile.reducedMotion });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, results, screenshots: output }, null, 2));
} finally { await browser.close(); }
