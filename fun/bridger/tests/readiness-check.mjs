import assert from 'node:assert/strict';

// Hold back a painting from a different biome. Once the editor opens,
// disconnect the origin and exercise the controls that used to load data.
export async function checkReadiness(browser, origin) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  let offline = false, release;
  const held = new Promise(resolve => { release = resolve; });
  const late = [];
  try {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (offline) { late.push(url.pathname); return route.abort(); }
      if (url.pathname.endsWith('/sky-snow.webp')) await held;
      return route.continue();
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('bridger-seen-help', '1');
      localStorage.setItem('bridger-sound', 'off');
    });
    const pendingImage = page.waitForRequest(req => req.url().endsWith('/sky-snow.webp'));
    await page.goto(origin + '/fun/bridger/?theme=jungle#medium-u7k7es', { waitUntil: 'domcontentloaded' });
    await pendingImage;
    assert.equal(await page.locator('.hud').evaluate(el => el.inert), true);
    assert.equal(await page.locator('body.ready').count(), 0, 'The startup gate waits for other worlds, too');
    release();
    await page.waitForSelector('body.ready');
    offline = true;
    await context.setOffline(true);
    await page.click('[data-action="new"]');
    await page.waitForFunction(() => bridger.mission.seed.startsWith('v3-'));
    await page.check('input[value="hard"]');
    await page.waitForFunction(() => bridger.mission.difficulty === 'hard');
    await page.click('[data-action="solution"]');
    assert.ok(await page.evaluate(() => bridger.members.some(m => m.mat !== 'road')));
    await page.click('[data-action="sound"]');
    await page.click('[data-action="test"]');
    await page.waitForFunction(() => bridger.sim?.time > 0);
    assert.equal(await page.evaluate(() => bridger.sim.run()), true, 'The offline solution carries its vehicle across');
    await page.locator('[data-dialog="win"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-loading]').isVisible(), false);
    assert.deepEqual(late, [], 'New river, difficulty, hint, unmute and the crossing require no network requests');
  } finally {
    release();
    await context.close();
  }
}
