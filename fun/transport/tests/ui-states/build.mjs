// Build states: the drawer's categories, a road stroke with its price tip and the bulldoze warning.
import { freshWorld, openView, rest, settle, tilePoint } from './setup.mjs';

async function category(page, key) {
  await freshWorld(page);
  await openView(page, 'build');
  await page.locator(`#panel-content [data-category="${key}"]`).click();
  await rest(page);
  await settle(page);
}

export const states = [
  { name: 'build-network', setup: page => category(page, 'network') },
  { name: 'build-terrain', async setup(page) {
    await category(page, 'network');
    if (!await page.locator('.engineering-tools').evaluate(el => el.open)) await page.locator('.engineering-tools > summary').click();
    await page.locator('.engineering-tools').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await rest(page);
    await settle(page);
  } },
  { name: 'build-town', setup: page => category(page, 'towns') },
  { name: 'build-industry', setup: page => category(page, 'industry') },
  { name: 'build-road-drag', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => transport.setTool('road'));
    // A short stroke around the centre of the view: a stroke near the edge would scroll the map.
    const [x, y] = await page.evaluate(() => { const town = transport.game.cities[0]; return [town.x + 6, town.y + 5]; });
    await tilePoint(page, x, y);
    const from = await tilePoint(page, x - 2, y, { focus: false }), to = await tilePoint(page, x + 2, y, { focus: false });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step++) await page.mouse.move(from.x + (to.x - from.x) * step / 5, from.y + (to.y - from.y) * step / 5);
    await page.locator('#placement-tip').waitFor({ state: 'visible' });
    await settle(page);
  } },
  { name: 'build-bulldoze-warning', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => transport.setTool('bulldoze'));
    const tile = await page.evaluate(() => { const route = transport.game.routes[0], point = route.path[Math.floor(route.path.length / 2)]; return Array.isArray(point) ? { x: point[0], y: point[1] } : point; });
    const point = await tilePoint(page, tile.x, tile.y);
    await page.mouse.move(point.x - 3, point.y);
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(() => document.querySelector('#placement-tip.warning:not([hidden])'));
    await settle(page);
  } },
];
