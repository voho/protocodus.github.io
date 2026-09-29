// Routes states over the audit's stone route: the list, room for more, a route being edited, a filled New route form,
// picking a stop on the map and the retire confirmation. Route cards have no collapsed form yet, so the
// edit form stands in for the expanded route until the routes drawer gets rows.
import { freshWorld, openView, rest, settle, stoneRoute } from './setup.mjs';
import { clearToasts } from './setup.mjs';

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
    // Edit scrolls the drawer to the form smoothly, reduced motion or not: capture once it has held still for 8 frames.
    await page.evaluate(() => new Promise(resolve => { const el = document.querySelector('#panel-content'); let last = NaN, still = 0; const frame = () => { still = el.scrollTop === last ? still + 1 : 0; last = el.scrollTop; if (still < 8) requestAnimationFrame(frame); else resolve(); }; requestAnimationFrame(frame); setTimeout(resolve, 3000); }));
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
  // A quarter on, the starter bus and the stone truck have room for more: a quiet ink-2 line under each card's vehicles.
  { name: 'routes-room', async setup(page) {
    await routes(page);
    await page.evaluate(async () => { const { tick } = await import('./model.js'); for (let day = 0; day < 90; day++) tick(transport.game, 1); });
    if (await page.locator('#route-planner').evaluate(el => el.open)) await page.locator('#route-planner > summary').click();
    const room = page.locator('[data-route-room]:not([hidden])').first();
    await room.waitFor();
    await room.evaluate(el => el.closest('.route-card').scrollIntoView({ block: 'center' }));
    await clearToasts(page);
    await rest(page);
    await settle(page);
  } },
  { name: 'routes-retire-confirm', async setup(page) {
    const id = await routes(page);
    await page.locator(`[data-remove-route="${id}"]`).click();
    await page.locator('#modal[open]').waitFor();
    await settle(page);
  } },
];
