import { openBuildArea } from './browser-build.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-lifecycle-ui';
await mkdir(output, { recursive: true });
const errors = [], results = [];

async function point(page, site) {
  return page.evaluate(site => {
    transport.renderer.focus(site.x, site.y);
    const p = transport.renderer.worldToScreen(site.x, site.y), box = document.querySelector('#world').getBoundingClientRect();
    return { x: p.x + box.left, y: p.y + box.top };
  }, site);
}
async function advance(page, day) {
  await page.evaluate(async day => {
    const { tick, validateGame } = await import('./model.js');
    while (transport.game.day < day) tick(transport.game, Math.min(1, day - transport.game.day));
    if (!validateGame(transport.game)) throw new Error('Lifecycle progression must remain saveable.');
  }, day);
}

try {
  for (const profile of [{ name: 'desktop', width: 1440, height: 900, dpr: 1 }, { name: 'laptop', width: 1024, height: 768, dpr: 2 }]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await createWorldFromMenu(page, { generationVersion: 12 });
    const sites = await page.evaluate(async () => {
      const g = transport.game, { releaseTerrainObjects } = await import('./terrain-objects.js');
      if (g.industries.some(site => site.construction) || g.tiles.some(tile => tile.building?.construction)) throw new Error('Generated places must already be complete.');
      let site;
      outer: for (let y = 48; y < g.height - 64; y += 32) for (let x = 48; x < g.width - 64; x += 32) {
        if ([...g.cities, ...g.industries, ...g.stations].some(p => p.x >= x - 24 && p.x <= x + 48 && p.y >= y - 24 && p.y <= y + 48)) continue;
        for (let dy = -6; dy <= 30; dy++) for (let dx = -6; dx <= 30; dx++) {
          const t = g.tiles[(y + dy) * g.width + x + dx];
          if (t.road || t.rail || t.building || t.zone) continue outer;
        }
        site = { x, y }; break outer;
      }
      if (!site) throw new Error('No isolated lifecycle test parcel.');
      const cells = [], collar = [];
      for (let dy = -6; dy <= 30; dy++) for (let dx = -6; dx <= 30; dx++) cells.push({ x: site.x + dx, y: site.y + dy });
      // Flattening also changes the graded surroundings of neighboring natural objects.
      for (let dy = -10; dy <= 34; dy++) for (let dx = -10; dx <= 34; dx++) collar.push({ x: site.x + dx, y: site.y + dy });
      releaseTerrainObjects(g, collar);
      for (const p of cells) Object.assign(g.tiles[p.y * g.width + p.x], { terrain: 'grass', elevation: 2 / 7, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
      g.money = 2_000_000; g.revision++; g.networkRevision++;
      const house = { x: site.x + 18, y: site.y + 18 }, factory = { x: site.x + 2, y: site.y + 2 }, tree = { x: site.x + 18, y: site.y + 10 };
      Object.assign(g.tiles[tree.y * g.width + tree.x], { terrain: 'forest', detail: 'birch', treeBornDay: Math.floor(g.day) });
      const { validateGame } = await import('./model.js');
      if (!validateGame(g)) throw new Error('Lifecycle test parcel must preserve a valid world.');
      transport.renderer.setZoom(1);
      return { house, factory, tree };
    });

    await openBuildArea(page, 'towns');
    const houseCard = page.locator('.building-card[data-tool="house-cheap-1"]');
    assert.match(await houseCard.innerText(), /2 months to build/);
    await houseCard.click();
    let p = await point(page, sites.house); await page.mouse.move(p.x, p.y);
    await page.waitForFunction(() => document.querySelector('#placement-tip').textContent.includes('2 months to build'));
    await page.mouse.click(p.x, p.y);
    const house = await page.evaluate(p => transport.game.tiles[p.y * transport.game.width + p.x].building, sites.house);
    assert.equal(house.construction.completeDay - house.construction.startedDay, 60);
    await page.keyboard.press('Escape');
    await page.evaluate(p => transport.inspect(p.x, p.y), sites.house);
    await page.locator('.building-project[data-construction-stage="excavation"]').waitFor();
    assert.match(await page.locator('#inspector').innerText(), /Rent begins when construction finishes/);
    assert.equal(await page.locator('#sell-property').count(), 0);
    const paused = await page.locator('.building-project [role="progressbar"]').getAttribute('aria-valuenow');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.building-project [role="progressbar"]').getAttribute('aria-valuenow'), paused);
    await page.screenshot({ path: `${output}/${profile.name}-excavation.png` });

    await openBuildArea(page, 'industry');
    const factoryCard = page.locator('[data-tool="sawmill"]');
    assert.match(await factoryCard.innerText(), /10 months to build/);
    await factoryCard.click(); p = await point(page, sites.factory);
    await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
    const factory = await page.evaluate(p => transport.game.industries.find(site => site.x === p.x && site.y === p.y), sites.factory);
    assert.equal(factory.construction.completeDay - factory.construction.startedDay, 300);
    await page.keyboard.press('Escape');
    await page.evaluate(p => transport.inspect(p.x, p.y, 'industry'), sites.factory);
    assert.match(await page.locator('.building-project').innerText(), /Under construction.*Opens/s);
    assert.doesNotMatch(await page.locator('#inspector').innerText(), /Producing|Opened in/);
    assert.equal(await page.evaluate(() => transport.persist()), true);
    await page.reload(); await loadAutosaveFromMenu(page);
    assert.deepEqual(await page.evaluate(id => transport.game.industries.find(site => site.id === id).construction, factory.id), factory.construction);

    await advance(page, house.construction.completeDay);
    assert.equal(await page.evaluate(p => Boolean(transport.game.tiles[p.y * transport.game.width + p.x].building.construction), sites.house), false);
    await advance(page, factory.construction.startedDay + 150);
    await point(page, sites.factory); await page.evaluate(p => transport.inspect(p.x, p.y, 'industry'), sites.factory);
    await page.locator('.building-project[data-construction-stage="frame"]').waitFor();
    assert.equal(await page.evaluate(id => transport.game.industries.find(site => site.id === id).totalProduced, factory.id), 0);
    await page.screenshot({ path: `${output}/${profile.name}-frame.png` });
    await advance(page, factory.construction.startedDay + 270);
    await page.evaluate(p => transport.inspect(p.x, p.y, 'industry'), sites.factory);
    await page.locator('.building-project[data-construction-stage="finishing"]').waitFor();
    await advance(page, factory.construction.completeDay);
    await page.evaluate(p => transport.inspect(p.x, p.y, 'industry'), sites.factory);
    await page.waitForFunction(() => !document.querySelector('.building-project'));
    assert.equal(await page.evaluate(id => Boolean(transport.game.industries.find(site => site.id === id).construction), factory.id), false);
    await page.screenshot({ path: `${output}/${profile.name}-complete.png` });
    await point(page, sites.tree); await page.evaluate(p => transport.inspect(p.x, p.y), sites.tree);
    assert.match(await page.locator('.tree-lifecycle').innerText(), /Young trees/);
    results.push({ profile: profile.name, houseDays: 60, factoryDays: 300, saveRestored: true, phases: ['excavation', 'frame', 'finishing', 'complete'] });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(`Lifecycle UI checks passed for ${results.length} computer profiles. ${output}`);
} finally { await browser.close(); }
