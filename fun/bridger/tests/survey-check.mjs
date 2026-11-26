import assert from 'node:assert/strict';

export async function checkSurvey(browser, origin) {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
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
    assert.ok(page.workers().some((worker) => worker.url().endsWith('/survey-worker.js')));
    // A hash change supersedes any hint in flight for the old river.
    await page.evaluate(() => {
      document.querySelector('[data-action="solution"]').click();
      location.hash = '#easy-v2-check4';
    });
    await page.waitForFunction(() => bridger.mission.seed === 'v2-check4');
    const fields = () => page.evaluate(() => {
      const { ground, ...survey } = bridger.mission;
      return { survey, bank: ground(survey.left + 1), roadOnly: bridger.members.every((m) => m.mat === 'road') };
    });
    const fromWorker = await fields();
    assert.ok(fromWorker.roadOnly, 'leaving during a hint keeps the new road intact');
    await page.click('[data-action="solution"]');
    await page.waitForFunction(() => bridger.members.some((m) => m.mat !== 'road'));
    await page.click('[data-action="clear"]');
    assert.equal(await page.locator('[data-dialog="confirm"]').evaluate((dialog) => dialog.open), true);
    await page.evaluate(() => { location.hash = '#medium-u7k7es'; });
    await page.waitForFunction(() => bridger.mission.seed === 'u7k7es');
    assert.equal(await page.locator('[data-dialog="confirm"]').evaluate((dialog) => dialog.open), false,
      'a pending confirmation belongs to its original river');

    // Wait for lazy artwork to arrive before counting steady-state repaints.
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
