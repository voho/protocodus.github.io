// Title-screen keyboard control: arrows pick the sector and difficulty, Enter
// launches, F practices, C resumes, H opens the manual; focused controls keep
// their native keys; the effects switch is gone; scrolling arena scenes never
// wait for a queued strip. Run with: node fun/tyran/tests/menu-keys-check.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { localStorage.setItem('tyran-muted', 'true'); localStorage.removeItem('tyran-campaign'); localStorage.removeItem('tyran-difficulty'); });
const ready = async () => { await page.goto(url); await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { timeout: 120000 }); };
const scene = () => page.evaluate(() => tyran.scene);
const menuState = () => page.evaluate(() => ({ selected: Number(document.body.dataset.world), difficulty: document.querySelector('input[name="difficulty"]:checked').value, active: document.activeElement?.id || document.activeElement?.tagName }));
try {
  await ready();
  assert.equal(await page.locator('#quality-toggle').count(), 0, 'the effects switch is gone from the top bar');
  assert.equal(await page.locator('#pause-quality-toggle').count(), 0, 'the effects switch is gone from the pause menu');
  const copy = await page.evaluate(() => document.querySelector('.briefing-copy').textContent);
  assert(!/sky is not the limit/i.test(copy) && !/fresh terrain/i.test(copy) && !/Ten worlds\./.test(copy), 'the hero copy is trimmed');
  assert.match(await page.locator('#difficulty-picker legend').textContent(), /^\s*New flights difficulty\s*$/);
  assert.equal(await page.locator('.menu-keys').count(), 1, 'the menu keys are listed');

  // Arrows pick the sector and difficulty from the page body.
  await page.mouse.click(1300, 940); await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal((await menuState()).selected, 2, 'ArrowRight advances the selected sector');
  await page.keyboard.press('KeyA');
  assert.equal((await menuState()).selected, 1, 'A steps back one sector');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  assert.equal((await menuState()).difficulty, 'hard', 'ArrowDown raises the difficulty');
  await page.keyboard.press('KeyW');
  assert.equal((await menuState()).difficulty, 'medium', 'W lowers the difficulty');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  assert.equal((await menuState()).difficulty, 'easy', 'difficulty clamps at Easy');
  assert.equal(await page.evaluate(() => localStorage.getItem('tyran-difficulty')), 'easy', 'the keyboard choice is remembered');
  // A focused radio keeps native arrow handling: Left moves the radio, not the sector.
  await page.focus('input[name="difficulty"][value="medium"]');
  await page.keyboard.press('ArrowRight');
  const radio = await menuState();
  assert.equal(radio.selected, 1, 'arrows on a focused radio never change the sector');
  assert.equal(radio.difficulty, 'hard', 'arrows on a focused radio move the radio');
  await page.evaluate(() => document.activeElement.blur());
  // H opens the manual; Escape closes it.
  await page.keyboard.press('KeyH');
  assert.equal(await page.locator('#help-screen').isVisible(), true, 'H opens the flight manual');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#help-screen').isVisible(), false, 'Escape closes the manual');
  // C does nothing without a saved campaign; F practices the selected sector.
  await page.keyboard.press('KeyC');
  assert.equal(await scene(), 'menu', 'C waits for a saved campaign');
  await page.keyboard.press('KeyF');
  assert.equal(await scene(), 'playing', 'F starts a practice flight');
  assert.equal(await page.evaluate(() => tyran.state.level), 1, 'practice uses the selected sector');
  await page.keyboard.press('Escape'); await page.locator('#menu-button').click();
  assert.equal(await scene(), 'menu');
  // Enter from the page body launches a new campaign; Enter on a focused button keeps its native action.
  await page.focus('#help-button'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#help-screen').isVisible(), true, 'Enter on a focused button activates that button');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  assert.equal(await scene(), 'playing', 'Enter launches a new campaign');
  assert.equal(await page.evaluate(() => tyran.state.level), 0);
  assert.equal(await page.evaluate(() => tyran.world.deferStrips), false, 'flight builds any late strip immediately');
  // A saved campaign resumes with C.
  await page.keyboard.press('Escape'); await page.locator('#menu-button').click();
  assert.equal(await page.locator('#continue-button').isDisabled(), false);
  await page.keyboard.press('KeyC');
  assert.equal(await scene(), 'pause', 'C resumes the saved campaign');
  // The end screen keeps drawing the live arena without deferring strips.
  const endState = await page.evaluate(async () => {
    tyran.pause();
    const { hurtPlayer } = await import('./sim.js');
    const s = tyran.state; s.lives = 0; const pilot = s.players[0]; pilot.hull = 1; pilot.shield = 0; pilot.hurt = 0; pilot.guard = 0; pilot.invulnerableTime = 0;
    hurtPlayer(s, pilot, 1000);
    for (let i = 0; i < 400 && tyran.scene !== 'end'; i++) tyran.step(1 / 60);
    return { scene: tyran.scene, defer: tyran.world.deferStrips, sync: tyran.world.syncStrips };
  });
  assert.equal(endState.scene, 'end'); assert.equal(endState.defer, false, 'the end screen never leaves a bare row at the top');
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('PASS title-screen keys, trimmed copy, removed effects switch and live-arena scenes');
} finally { await browser.close(); }
