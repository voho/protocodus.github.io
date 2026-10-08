// Shared real UI entry points. Menu navigation never imports or creates a game
// behind the application, so startup/storage regressions remain visible.
export async function waitForGameReady(page, { paused = true } = {}) {
  await page.waitForFunction(() => window.transport?.game && !document.querySelector('#start-menu')?.open && !document.querySelector('#loading-screen').open,
    undefined, { timeout:60000 });
  if (paused) await page.locator('[data-speed="0"]').click();
}

// Reveal the requested action through the same section buttons a player uses.
// Returning the locator also lets keyboard checks focus and activate it natively.
export async function openGameMenu(page, selector) {
  if (await page.locator('#game-menu-button').getAttribute('aria-expanded') !== 'true') await page.locator('#game-menu-button').click();
  await page.locator('#game-menu').waitFor({ state: 'visible' });
  if (!selector) return;
  const action = page.locator(selector);
  const group = await action.evaluate(element => element.closest('[data-menu-panel]')?.dataset.menuPanel);
  if (group && !await action.isVisible()) await page.locator(`[data-menu-group="${group}"]`).click();
  return action;
}

export async function openGameAction(page, id) {
  // Map controls and other shortcuts stay directly available beside the game.
  const direct = page.locator('#' + id);
  if (await direct.isVisible()) { await direct.click(); return; }
  const action = await openGameMenu(page, '#' + id);
  await action.click();
}

// Checks name fixed places (Alderbrook, the quarry at 217,255) in recipe-7 worlds, so the menu
// keeps that recipe through its ?generation=N; a check of the current default passes its number.
export async function createWorldFromMenu(page, { biome = 'taiga', size = 'square512', seed = 1847, townCount, industryDistricts, generationVersion = 7, paused = true } = {}) {
  await page.waitForFunction(() => document.querySelector('#start-menu')?.open || window.transport?.game);
  await page.evaluate(version => { const url = new URL(location.href); url.searchParams.set('generation', String(version)); history.replaceState(history.state, '', url); }, generationVersion);
  if (!await page.locator('#start-menu').isVisible()) await openGameAction(page, 'world-button');
  await page.locator('#start-new').click();
  await page.locator(`#start-world-form [name="biome"][value="${biome}"]`).check();
  await page.locator('#start-world-form [name="size"]').selectOption(size);
  if (!await page.locator('.start-advanced').evaluate(el => el.open)) await page.locator('.start-advanced summary').click();
  if (townCount !== undefined) await page.locator('#start-world-form [name="townCount"]').fill(String(townCount));
  if (industryDistricts !== undefined) await page.locator('#start-world-form [name="industryDistricts"]').fill(String(industryDistricts));
  await page.locator('#start-world-form [name="seed"]').fill(String(seed));
  await page.locator('#start-create').click();
  await waitForGameReady(page, { paused });
}

export async function loadAutosaveFromMenu(page, { paused = true } = {}) {
  await page.locator('#start-load').click();
  await page.locator('.start-save').filter({ has:page.locator('strong', { hasText:/^Autosave$/ }) }).click();
  await waitForGameReady(page, { paused });
}
