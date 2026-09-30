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
const menuState = () => page.evaluate(() => ({ selected: Number(document.body.dataset.world), difficulty: document.querySelector('input[name="difficulty"]:checked').value, row: document.querySelector('#menu-list .menu-row.active')?.dataset.row, active: document.activeElement?.id || document.activeElement?.tagName }));
try {
  await ready();
  assert.equal(await page.locator('#quality-toggle').count(), 0, 'the effects switch is gone from the top bar');
  assert.equal(await page.locator('#pause-quality-toggle').count(), 0, 'the effects switch is gone from the pause menu');
  const copy = await page.evaluate(() => document.querySelector('#menu-screen').textContent);
  assert(!/sky is not the limit/i.test(copy) && !/fresh terrain/i.test(copy) && !/Ten worlds\./.test(copy), 'the hero copy is trimmed');
  assert.match(await page.locator('#difficulty-picker legend').textContent(), /^\s*New flights difficulty\s*$/);
  for (const selector of ['.topbar', '.hero-stats', '.hero-description', '.campaign-hint', '.brand']) assert.equal(await page.locator(selector).count(), 0, `${selector} left the title screen`);
  assert.equal(await page.locator('.menu-keys').count(), 1, 'the menu keys are listed');

  // The console menu: Left/Right change the sector, Up/Down move the highlight.
  await page.evaluate(() => document.activeElement?.blur?.());
  assert.equal((await menuState()).row, 'launch', 'the new-campaign row starts highlighted');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal((await menuState()).selected, 2, 'ArrowRight advances the selected sector');
  await page.keyboard.press('KeyA');
  assert.equal((await menuState()).selected, 1, 'A steps back one sector');
  await page.keyboard.press('ArrowDown');
  assert.equal((await menuState()).row, 'sector', 'ArrowDown skips the disabled resume row');
  await page.keyboard.press('KeyS');
  const onDifficulty = await menuState();
  assert.equal(onDifficulty.row, 'difficulty', 'S moves on to the difficulty row');
  assert.equal(onDifficulty.active, 'INPUT', 'the highlighted difficulty focuses its radio');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal((await menuState()).difficulty, 'hard', 'Right on the difficulty row raises it');
  assert.equal((await menuState()).selected, 1, 'the sector stays put while difficulty changes');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await menuState()).difficulty, 'medium', 'Left lowers it');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  assert.equal((await menuState()).difficulty, 'easy', 'difficulty clamps at Easy');
  assert.equal(await page.evaluate(() => localStorage.getItem('tyran-difficulty')), 'easy', 'the keyboard choice is remembered');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  assert.equal((await menuState()).row, 'launch', 'the highlight wraps around');
  await page.locator('#sector-next').click(); await page.locator('#sector-next').click(); await page.locator('#sector-prev').click();
  assert.equal((await menuState()).selected, 2, 'the sector arrows step the selection');
  await page.hover('#help-button');
  assert.equal((await menuState()).row, 'manual', 'hovering a row highlights it');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.equal((await menuState()).row, 'difficulty');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('KeyA');
  assert.equal((await menuState()).selected, 1, 'Left on the sector row steps the sector');
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
  await page.evaluate(() => document.querySelector('#launch-button').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
  await page.keyboard.press('Enter');
  assert.equal(await scene(), 'playing', 'Enter confirms the highlighted new-campaign row');
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
