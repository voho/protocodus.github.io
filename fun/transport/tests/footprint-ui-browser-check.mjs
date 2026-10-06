// Real placement and demolition gestures; every browser context has isolated saves.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-footprint-ui';
await mkdir(output, { recursive: true });
const errors = [];

async function screen(page, point) {
  return page.evaluate(point => {
    const p = transport.renderer.worldToScreen(point.x, point.y), rect = document.querySelector('#world').getBoundingClientRect();
    return { x: p.x + rect.left, y: p.y + rect.top };
  }, point);
}
async function siteState(page, point) {
  return page.evaluate(async point => {
    const { buildingAt } = await import('./building-sites.js'), site = buildingAt(transport.game, point.x, point.y);
    return { money: transport.game.money, site, road: transport.game.tiles[point.y * transport.game.width + point.x].road };
  }, point);
}

try {
  for (const profile of [{ name: 'desktop', width: 1440, height: 960, dpr: 1 }]) {
    if (process.env.TRANSPORT_PROFILE && process.env.TRANSPORT_PROFILE !== profile.name) continue;
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await createWorldFromMenu(page);
    const site = await page.evaluate(async () => {
      transport.setSpeed(0); const g = transport.game; let site;
      for (let y = 30; y < g.height - 30 && !site; y += 20) for (let x = 30; x < g.width - 30 && !site; x += 20) {
        if (![...g.cities, ...g.industries, ...g.stations].some(p => Math.abs(p.x - x) < 20 && Math.abs(p.y - y) < 20)) site = { x, y };
      }
      if (!site) throw new Error('No clear footprint test area.');
      const { releaseTerrainObjects } = await import('./terrain-objects.js'), cleared = [];
      for (let dy = -9; dy <= 11; dy++) for (let dx = -9; dx <= 11; dx++) cleared.push({ x: site.x + dx, y: site.y + dy });
      releaseTerrainObjects(g, cleared);
      for (let dy = -8; dy <= 10; dy++) for (let dx = -8; dx <= 10; dx++) {
        const t = g.tiles[(site.y + dy) * g.width + site.x + dx];
        Object.assign(t, { terrain: 'grass', elevation: 6 / 16, detail: '', road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
        delete t.publicRoad; delete t.structureAxis; delete t.structureLevel;
      }
      g.money = 1000000; g.revision++; g.networkRevision++;
      transport.renderer.setZoom(1); transport.renderer.focus(site.x + 1, site.y + 1); transport.setView('build');
      return site;
    });
    if (!await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open'))) await page.locator('.main-nav [data-view="build"]').click();
    await page.locator('[data-category="towns"]').click();
    await page.locator('#building-group').selectOption('community');
    assert.match(await page.locator('[data-tool="hospital"] .building-price').innerText(), /2 × 2/);
    assert.match(await page.locator('[data-tool="stadium"] .building-price').innerText(), /3 × 3/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await page.locator('[data-tool="stadium"]').click();
    assert.match(await page.locator('#active-tool-hint').innerText(), /3 × 3/);
    const anchor = await screen(page, site);
    await page.waitForFunction(p => document.elementFromPoint(p.x, p.y)?.id === 'world', anchor);
    await page.mouse.move(anchor.x, anchor.y);
    assert.match(await page.locator('#placement-tip').innerText(), /3 × 3/);
    await page.mouse.click(anchor.x, anchor.y);
    const corner = { x: site.x + 2, y: site.y + 2 };
    await page.waitForFunction(({ x, y }) => transport.game.tiles[y * transport.game.width + x].building?.kind === 'stadium', site);
    const built = await siteState(page, corner);
    assert.equal(built.site.building.footprint, 3); assert.equal(built.site.x, site.x); assert.equal(built.site.y, site.y);
    await page.evaluate(point => { transport.setTool('inspect'); transport.inspect(point.x, point.y); }, corner);
    assert.equal(await page.locator('#inspector h3').innerText(), 'Stadium');
    assert.match(await page.locator('#inspector .eyebrow').innerText(), /3 × 3/);
    await page.locator('#inspector [aria-label="Close inspector"]').click();

    // A visually empty yard cell is still part of the building's site.
    await page.evaluate(() => transport.setTool('road'));
    const yard = await screen(page, corner); await page.mouse.click(yard.x, yard.y);
    const rejected = await siteState(page, corner);
    assert.equal(rejected.road, false); assert.equal(rejected.money, built.money);
    await page.evaluate(() => { transport.setTool('inspect'); return transport.persist(); });
    assert.equal(await page.evaluate(() => Boolean(localStorage.getItem('transport-save-v1'))), true);
    await page.reload(); await loadAutosaveFromMenu(page);
    await page.evaluate(site => { transport.setSpeed(0); transport.renderer.setZoom(1); transport.renderer.focus(site.x + 1, site.y + 1); }, site);
    assert.equal((await siteState(page, corner)).site.building.footprint, 3, 'saved sites retain every reserved cell');
    await page.screenshot({ path: `${output}/${profile.name}-stadium.png` });

    // Drag across three cells of this single site and pay for one demolition.
    const before = await siteState(page, site);
    await page.evaluate(() => transport.setTool('bulldoze'));
    const a = await screen(page, corner), b = await screen(page, { x: site.x, y: site.y + 2 });
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    const after = await siteState(page, corner);
    assert.equal(after.site, null);
    const demolitionCost = await page.evaluate(async site => (await import('./model.js')).constructionCost(transport.game, 'bulldoze', site.x, site.y), site);
    assert.equal(before.money - after.money, demolitionCost);
    console.log(`${profile.name}: size labels, 3×3 placement, far-corner inspection, network blocking, saved occupancy and one-charge whole-site demolition passed`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
