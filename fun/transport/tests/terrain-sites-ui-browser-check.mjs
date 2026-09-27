// Use isolated browser storage; never modify a player's open company.
import assert from 'node:assert/strict';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const errors = [];
const screen = (page, point) => page.evaluate(point => {
  const p = transport.renderer.worldToScreen(point.x, point.y), rect = document.querySelector('#world').getBoundingClientRect();
  return { x: p.x + rect.left, y: p.y + rect.top };
}, point);
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await createWorldFromMenu(page);
    const site = await page.evaluate(async () => {
      transport.setSpeed(0); const g = transport.game; let p;
      for (let y = 30; y < g.height - 30 && !p; y += 20) for (let x = 30; x < g.width - 30 && !p; x += 20) {
        if (![...g.cities, ...g.industries, ...g.stations].some(s => Math.abs(s.x - x) < 20 && Math.abs(s.y - y) < 20)) p = { x, y };
      }
      if (!p) throw new Error('No terrain test clearing.');
      const { releaseTerrainObjects } = await import('./terrain-objects.js');
      const points = [];
      for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) points.push({ x: p.x + dx, y: p.y + dy });
      const affected = [];
      for (let dy = -11; dy <= 11; dy++) for (let dx = -11; dx <= 11; dx++) affected.push({ x: p.x + dx, y: p.y + dy });
      releaseTerrainObjects(g, affected);
      for (const c of points) {
        const t = g.tiles[c.y * g.width + c.x];
        Object.assign(t, { terrain: 'grass', elevation: 6 / 16, detail: '', road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
        delete t.publicRoad; delete t.structureAxis; delete t.structureLevel;
      }
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) Object.assign(g.tiles[(p.y + dy) * g.width + p.x + dx], { terrain: 'forest', detail: 'pine' });
      g.tiles[p.y * g.width + p.x].terrainObject = { kind: 'forest', detail: 'pine', variant: 7, footprint: 3 };
      g.money = 1000000; g.revision++; g.networkRevision++;
      if (!(await import('./model.js')).validateGame(g)) throw new Error('Terrain fixture must be valid before persistence.');
      transport.renderer.setZoom(1); transport.renderer.focus(p.x + 1, p.y + 1); transport.persist();
      return p;
    });
    // Save/reload must preserve the actual parcel, not infer new neighbors.
    await page.reload(); await loadAutosaveFromMenu(page);
    await page.evaluate(p => { transport.setSpeed(0); transport.renderer.setZoom(1); transport.renderer.focus(p.x + 1, p.y + 1); }, site);
    const corner = { x: site.x + 2, y: site.y + 2 }, p = await screen(page, corner);
    await page.waitForFunction(p => document.elementFromPoint(p.x, p.y)?.id === 'world', p);
    if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => !document.querySelector('#inspector').hidden);
    assert.match(await page.locator('#inspector .eyebrow').innerText(), /3 × 3 site/);
    assert.match(await page.locator('#inspector').innerText(), /Bulldoze any part to clear the whole site/);
    await page.locator('#inspector [aria-label="Close inspector"]').click();
    const before = await page.evaluate(() => transport.game.money);
    await page.evaluate(() => transport.setTool('bulldoze'));
    const a = await screen(page, corner), b = await screen(page, { x: site.x, y: site.y + 2 });
    await page.mouse.move(a.x, a.y);
    if (!mobile) assert.match(await page.locator('#placement-tip').innerText(), /3 × 3/);
    await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    const after = await page.evaluate(async p => {
      const g = transport.game, { terrainObjectAt } = await import('./terrain-objects.js'), { constructionCost } = await import('./model.js');
      const tiles = [];
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) tiles.push(g.tiles[(p.y + dy) * g.width + p.x + dx]);
      return { money: g.money, cost: constructionCost(g, 'bulldoze', p.x, p.y), object: terrainObjectAt(g, p.x + 2, p.y + 2), tiles };
    }, site);
    assert.equal(after.object, null); assert.equal(before - after.money, after.cost);
    assert.ok(after.tiles.every(t => t.terrain === 'grass' && t.detail === '' && t.elevation === 6 / 16));
    console.log(`${mobile ? 'mobile' : 'desktop'}: saved 3×3 grove, far-corner click, inspector, quote and single-charge whole-parcel clearing passed`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
