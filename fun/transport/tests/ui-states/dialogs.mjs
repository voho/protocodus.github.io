// Dialog states: the start menu, the loading screen and every dialog the game menu opens.
import { freshWorld, openGameAction, settle, stoneRoute } from './setup.mjs';

const dialog = async page => { await page.locator('#modal[open]').waitFor(); await settle(page); };

export const states = [
  { name: 'dialogs-start-new', async setup(page) {
    await page.locator('#start-new').click();
    await page.locator('#start-world-form').waitFor({ state: 'visible' });
    await page.locator('#start-landscape').evaluate(img => img.decode());
    await settle(page);
  } },
  ...['tundra', 'desert'].map(biome => ({ name: `dialogs-start-${biome}`, async setup(page) {
    await page.locator(`#start-world-form [name=biome][value=${biome}]`).check();
    await page.locator('#start-landscape').evaluate(img => img.decode());
    await settle(page);
  } })),
  { name: 'dialogs-start-options', async setup(page) {
    await page.locator('.start-advanced summary').click();
    await page.locator('#start-landscape').evaluate(img => img.decode());
    await settle(page);
  } },
  { name: 'dialogs-start-load', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => transport.persist());
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#start-menu')?.open);
    await page.locator('#start-load').click();
    await page.locator('.start-save').first().waitFor();
    await page.evaluate(() => { for (const el of document.querySelectorAll('#start-menu time, .start-save small')) if (/ago|now/i.test(el.textContent)) el.textContent = 'Saved just now'; });
    await settle(page);
  } },
  { name: 'dialogs-loading', async setup(page) {
    await page.evaluate(async () => { const { showLoading } = await import('./loading-screen.js'); showLoading({ status: 'Shaping terrain, rivers and towns…', stage: 1 }); });
    await page.locator('#loading-screen').waitFor({ state: 'visible' });
    await settle(page);
  } },
  { name: 'dialogs-chains', async setup(page) {
    await freshWorld(page);
    await page.locator('#game-menu-button').click();
    await page.locator('#game-menu [data-open-chains]').click();
    await dialog(page);
  } },
  { name: 'dialogs-saves', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => transport.persist());
    await openGameAction(page, 'save-button');
    await page.locator('.save-card').first().waitFor();
    await dialog(page);
  } },
  { name: 'dialogs-guide', async setup(page) { await freshWorld(page); await openGameAction(page, 'help-button'); await dialog(page); } },
  { name: 'dialogs-company', async setup(page) {
    await freshWorld(page);
    await stoneRoute(page);
    await openGameAction(page, 'company-button');
    await dialog(page);
  } },
  { name: 'dialogs-goals', async setup(page) { await freshWorld(page); await openGameAction(page, 'goals-button'); await dialog(page); } },
  { name: 'dialogs-overview', async setup(page) {
    await freshWorld(page);
    await page.locator('#world').focus();
    await page.keyboard.press('m');
    await dialog(page);
  } },
  { name: 'dialogs-confirm', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => transport.persist());
    await openGameAction(page, 'save-button');
    await page.locator('[data-save-slot="autosave"] [data-save-action="load"]').click();
    await page.locator('.save-confirmation').waitFor();
    await dialog(page);
  } },
  // A company a few records in: two bronze records earned, a hidden gold one revealed and deliveries on the way to a million.
  { name: 'dialogs-achievements', async setup(page) {
    await freshWorld(page);
    await page.evaluate(() => { const a = transport.game.achievements; transport.game.totalDelivered = 412300; Object.assign(a.unlocked, { 'delivered-100k': 3, 'fleet-10': 5, 'billion-nominal': 9 }); a.cargo = 7; });
    await openGameAction(page, 'achievements-button');
    await dialog(page);
  } },
];
