// Shared real UI entry points. Menu navigation never imports or creates a game
// behind the application, so startup/storage regressions remain visible.
export async function waitForGameReady(page, { paused = true } = {}) {
  await page.waitForFunction(() => window.transport?.game && !document.querySelector('#start-menu')?.open && !document.querySelector('#loading-screen').open,
    undefined, { timeout:60000 });
  if (paused) await page.locator('[data-speed="0"]').click();
}

export async function openGameAction(page, id) {
  if (await page.locator('#game-menu-button').getAttribute('aria-expanded') !== 'true') await page.locator('#game-menu-button').click();
  await page.locator('#' + id).click();
}

export async function createWorldFromMenu(page, { biome = 'taiga', size = 'square512', seed = 1847, townCount, industryDistricts, paused = true } = {}) {
  await page.waitForFunction(() => document.querySelector('#start-menu')?.open || window.transport?.game);
  if (!await page.locator('#start-menu').isVisible()) await openGameAction(page, 'world-button');
  await page.locator('#start-new').click();
  await page.locator(`#start-world-form [name="biome"][value="${biome}"]`).check();
  await page.locator('#start-world-form [name="size"]').selectOption(size);
  if (townCount !== undefined) await page.locator('#start-world-form [name="townCount"]').fill(String(townCount));
  if (industryDistricts !== undefined) await page.locator('#start-world-form [name="industryDistricts"]').fill(String(industryDistricts));
  if (!await page.locator('.start-advanced').evaluate(el => el.open)) await page.locator('.start-advanced summary').click();
  await page.locator('#start-world-form [name="seed"]').fill(String(seed));
  await page.locator('#start-create').click();
  await waitForGameReady(page, { paused });
}

export async function loadAutosaveFromMenu(page, { paused = true } = {}) {
  await page.locator('#start-load').click();
  await page.locator('.start-save').filter({ has:page.locator('strong', { hasText:/^Autosave$/ }) }).click();
  await waitForGameReady(page, { paused });
}
