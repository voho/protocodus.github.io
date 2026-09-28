// Places states: an inspector for every kind of thing on the map, and the Industries and Towns lists.
import { freshWorld, openView, settle, stoneRoute, tilePoint } from './setup.mjs';

const inspected = page => page.locator('#inspector').waitFor({ state: 'visible' }).then(() => settle(page));

export const states = [
  { name: 'places-town', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => { const town = transport.game.cities[0]; transport.renderer.focus(town.x, town.y); transport.inspect(town.x, town.y, 'city'); });
    await inspected(page);
  } },
  { name: 'places-industry', async setup(page) {
    await freshWorld(page);
    await stoneRoute(page);
    await page.evaluate(() => { const site = transport.game.industries.find(industry => industry.kind === 'quarry' && Math.hypot(industry.x - 219, industry.y - 253) < 5); transport.renderer.focus(site.x, site.y); transport.inspect(site.x, site.y, 'industry'); });
    await inspected(page);
  } },
  { name: 'places-stop', async setup(page) {
    await freshWorld(page);
    await stoneRoute(page);
    await page.evaluate(() => { transport.renderer.focus(219, 251); transport.inspect(219, 251); });
    await inspected(page);
  } },
  { name: 'places-port', async setup(page) {
    await freshWorld(page);
    await page.evaluate(async () => {
      const { build } = await import('./model.js'), game = transport.game, town = game.cities[0];
      for (let r = 1; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = town.x + dx, y = town.y + dy;
        if (build(game, 'port', x, y).ok) { transport.renderer.focus(x, y); transport.inspect(x, y); return; }
      }
      throw new Error('no port site near the home town');
    });
    await inspected(page);
  } },
  { name: 'places-vehicle', async setup(page) {
    await freshWorld(page);
    const vehicle = await page.evaluate(async () => { const { tick } = await import('./model.js'); for (let n = 0; n < 40; n++) tick(transport.game, .05); const v = transport.game.vehicles[0]; return { x: v.x, y: v.y }; });
    await page.waitForTimeout(500);
    const point = await tilePoint(page, vehicle.x, vehicle.y);
    await page.mouse.click(point.x, point.y);
    await page.locator('[data-vehicle-live]').first().waitFor();
    await inspected(page);
  } },
  { name: 'places-terrain', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => {
      const game = transport.game, town = game.cities[0];
      for (let r = 6; r < 40; r++) for (let dx = -r; dx <= r; dx++) {
        const x = town.x + dx, y = town.y + r, tile = game.tiles?.[y * game.width + x];
        transport.inspect(x, y);
        if (document.querySelector('#inspector h3')?.textContent && !document.querySelector('#inspector [data-rename]') && /grass|meadow|forest|land|field|heath|moss|tundra|sand|terrain/i.test(document.querySelector('#inspector').textContent) && !/road|rail|stop|town|industry/i.test(document.querySelector('#inspector h3').textContent)) { transport.renderer.focus(x, y); return; }
      }
    });
    await inspected(page);
  } },
  { name: 'places-road', async setup(page) {
    await freshWorld(page);
    await stoneRoute(page);
    await page.evaluate(() => { transport.renderer.focus(219, 248); transport.inspect(219, 248); });
    await inspected(page);
  } },
  { name: 'places-industries-list', async setup(page) { await freshWorld(page); await openView(page, 'industry'); } },
  { name: 'places-towns-list', async setup(page) { await freshWorld(page); await openView(page, 'towns'); } },
];
