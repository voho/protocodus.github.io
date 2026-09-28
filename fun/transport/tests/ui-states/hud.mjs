// HUD states: the rails around the map, the ledger, the game menu, the zoom menu and the overview panel.
import { freshWorld, settle } from './setup.mjs';

async function menu(page) {
  await page.locator('#game-menu-button').click();
  await page.locator('#game-menu').waitFor({ state: 'visible' });
}

export const states = [
  { name: 'hud-default', async setup(page) {
    await freshWorld(page);
    // Running at 1×. The frame loop skips hidden documents, so the figures hold still for the capture.
    await page.evaluate(() => { transport.setSpeed(1); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
    await settle(page);
  } },
  { name: 'hud-paused', async setup(page) { await freshWorld(page); } },
  { name: 'hud-ledger', async setup(page) {
    await freshWorld(page);
    await page.locator('#company-stats').click();
    await page.locator('#company-tooltip').waitFor({ state: 'visible' });
  } },
  { name: 'hud-game-menu', async setup(page) {
    await freshWorld(page);
    await menu(page);
    await page.evaluate(() => { const status = document.querySelector('#save-status'); if (status) status.textContent = 'Autosave on'; });
  } },
  { name: 'hud-zoom-menu', async setup(page) {
    await freshWorld(page);
    await page.locator('#zoom-level').click();
    await page.locator('#zoom-menu').waitFor({ state: 'visible' });
  } },
  { name: 'hud-overview', async setup(page) {
    await freshWorld(page);
    await menu(page);
    await page.locator('#overview-button').click();
    await page.locator('#minimap').waitFor({ state: 'visible' });
  } },
];
