// Routes states over the audit's stone route: the list, a route being edited, a filled New route form,
// picking a stop on the map and the retire confirmation. Route cards have no collapsed form yet, so the
// edit form stands in for the expanded route until the routes drawer gets rows.
import { freshWorld, openView, rest, settle, stoneRoute } from './setup.mjs';

async function routes(page) {
  await freshWorld(page);
  const id = await stoneRoute(page);
  await openView(page, 'routes');
  return id;
}

export const states = [
  { name: 'routes-list', async setup(page) {
    await routes(page);
    if (await page.locator('#route-planner').evaluate(el => el.open)) await page.locator('#route-planner > summary').click();
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-edit', async setup(page) {
    const id = await routes(page);
    await page.locator(`[data-edit-route="${id}"]`).click();
    await page.locator('#route-form').waitFor({ state: 'visible' });
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-new-form', async setup(page) {
    await routes(page);
    if (!await page.locator('#route-planner').evaluate(el => el.open)) await page.locator('#route-planner > summary').click();
    const stop = await page.evaluate(() => String(transport.game.stations.find(station => station.x === 219 && station.y === 251).id));
    await page.locator('#route-form select[name="from"]').selectOption(stop);
    await page.locator('#route-form select[name="to"]').selectOption('station-2');
    await page.locator('#route-form select[name="from"]').evaluate(el => el.blur());
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-picking', async setup(page) {
    await routes(page);
    if (!await page.locator('#route-planner').evaluate(el => el.open)) await page.locator('#route-planner > summary').click();
    await page.locator('[data-pick-route="from"]').click();
    await page.locator('#route-pick-banner').waitFor({ state: 'visible' });
    await settle(page);
  } },
  { name: 'routes-retire-confirm', async setup(page) {
    const id = await routes(page);
    await page.locator(`[data-remove-route="${id}"]`).click();
    await page.locator('#modal[open]').waitFor();
    await settle(page);
  } },
];
