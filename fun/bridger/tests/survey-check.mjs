import assert from 'node:assert/strict';

export async function checkSurvey(browser, origin) {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    const surveys = [];
    page.on('worker', worker => { if (worker.url().endsWith('/survey-worker.js')) surveys.push(worker); });
    await page.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('bridger-seen-help', '1');
      localStorage.setItem('bridger-sound', 'off');
      const fill = CanvasRenderingContext2D.prototype.drawImage;
      window.stageDraws = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (this.canvas.id === 'stage') window.stageDraws++;
        return fill.apply(this, args);
      };
    });
    await page.goto(origin + '/fun/bridger/#medium-v2-6g77gh');
    await page.waitForFunction(() => window.bridger?.view && window.stageDraws);
    assert.equal(surveys.length, 1, 'The procedural shared link is surveyed during startup');
    await page.focus('[data-action="help"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-dialog="help"]').evaluate((dialog) => dialog.open), true);
    assert.equal(await page.evaluate(() => bridger.sim), null);
    await page.keyboard.press('Escape');
    async function assertTool(tool) {
      const group = await page.locator('[data-tool]').evaluateAll((buttons) => ({
        checked: buttons.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.tool),
        tabStops: buttons.filter((b) => b.tabIndex === 0).map((b) => b.dataset.tool),
      }));
      assert.deepEqual(group, { checked: [tool], tabStops: [tool] });
    }
    await assertTool('wood');
    await page.focus('[data-tool="wood"]');
    await page.keyboard.press('ArrowLeft');
    await assertTool('erase');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tool), 'erase');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await assertTool('wood');
    assert.equal(await page.evaluate(() => bridger.sim), null, 'Space on a material selects it');
    for (const focus of ['#stage', '[data-action="test"]']) {
      await page.focus(focus);
      await page.keyboard.down('Enter');
      await page.keyboard.down('Enter');
      await page.keyboard.up('Enter');
      assert.equal(await page.evaluate(() => !!bridger.sim), true, 'Holding Enter starts one test');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => bridger.sim), null);
    }
    // Opening another procedural link starts that river with its own hints.
    await page.evaluate(() => {
      document.querySelector('[data-action="solution"]').click();
      location.hash = '#easy-v2-check4';
    });
    await page.waitForFunction(() => window.bridger?.mission?.seed === 'v2-check4');
    const fields = () => page.evaluate(() => {
      const { ground, ...survey } = bridger.mission;
      return { survey, bank: ground(survey.left + 1), roadOnly: bridger.members.every((m) => m.mat === 'road') };
    });
    const fromWorker = await fields();
    const preparedWorkers = surveys.length;
    assert.ok(fromWorker.roadOnly, 'leaving after a hint keeps the new road intact');
    await page.click('[data-action="solution"]');
    await page.waitForFunction(() => bridger.members.some((m) => m.mat !== 'road'));
    const savedBridge = () => page.evaluate(() => JSON.stringify(bridger.members));
    const saved = await savedBridge();
    await page.evaluate(() => { location.hash = '#medium-v2-check4'; });
    await page.waitForFunction(() => bridger.mission.difficulty === 'medium');
    assert.equal(await savedBridge(), saved);
    assert.ok(await page.locator('[data-action="undo"]').isEnabled(), 'Changing difficulty in the URL preserves undo history');
    await page.click('[data-action="new"]');
    await page.click('[data-confirm-ok]');
    await page.waitForFunction(() => window.bridger?.mission?.seed?.startsWith('v3-'));
    const next = await page.evaluate(() => bridger.mission.seed);
    await page.goBack();
    await page.waitForFunction(() => window.bridger?.mission?.seed === 'v2-check4');
    assert.equal(surveys.length, preparedWorkers, 'Hints, difficulty changes, fresh rivers and history require no further worker');
    assert.equal(await savedBridge(), saved, 'Back restores the bridge you left');
    await page.goForward();
    await page.waitForFunction((seed) => window.bridger?.mission?.seed === seed, next);
    assert.ok((await fields()).roadOnly, 'Forward restores the next river');
    await page.goBack();
    await page.waitForFunction(() => window.bridger?.mission?.seed === 'v2-check4');
    await page.click('[data-action="clear"]');
    assert.equal(await page.locator('[data-dialog="confirm"]').evaluate((dialog) => dialog.open), true);
    await page.evaluate(() => { location.hash = '#medium-u7k7es'; });
    await page.waitForFunction(() => window.bridger?.mission?.seed === 'u7k7es');
    assert.equal(await page.locator('[data-dialog="confirm"]').evaluate((dialog) => dialog.open), false,
      'a pending confirmation belongs to its original river');

    // Let the new river's initial paint finish before counting idle frames.
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const idle = await page.evaluate(() => window.stageDraws);
    await page.waitForTimeout(140);
    assert.equal(await page.evaluate(() => window.stageDraws), idle, 'reduced-motion editor sleeps between changes');
    await page.setViewportSize({ width: 810, height: 690 });
    await page.waitForFunction((count) => window.stageDraws > count && bridger.view.width === 810, idle);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const animated = await page.evaluate(() => window.stageDraws);
    await page.waitForFunction((count) => window.stageDraws > count, animated);

    await page.addInitScript(() => { window.Worker = class { constructor() { throw new Error('Worker blocked'); } }; });
    // Compare fresh saves so each solver starts with the original deck.
    await page.evaluate(() => localStorage.removeItem('bridger-bridge-v2-check4'));
    await page.goto(origin + '/fun/bridger/?fallback#easy-v2-check4');
    await page.waitForFunction(() => window.bridger?.mission?.seed === 'v2-check4');
    assert.deepEqual(await fields(), fromWorker, 'the local solver reproduces the worker survey');
    await page.click('[data-action="solution"]');
    await page.waitForFunction(() => bridger.members.some((m) => m.mat !== 'road'));
  } finally {
    await page.close();
  }
}
