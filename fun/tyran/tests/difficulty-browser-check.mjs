// Serve the repo root; set TYRAN_PLAYWRIGHT and TYRAN_URL when needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-difficulty-qa';
await mkdir(output, { recursive: true });
const errors = [];
const ready = page => page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
const choice = (page, id) => page.locator(`#difficulty-picker input[name="difficulty"][value="${id}"]`);
const selected = page => page.locator('#difficulty-picker input:checked').inputValue();
const saved = page => page.evaluate(() => localStorage.getItem('tyran-campaign'));
const newPage = async options => {
  const page = await browser.newPage(options);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`); });
  await page.addInitScript(() => localStorage.setItem('tyran-muted', 'true'));
  await page.goto(url); await ready(page);
  return page;
};
const pause = page => page.evaluate(() => { if (tyran.scene === 'playing') tyran.pause(); });
const assertDifficulty = async (page, difficulty, label) => {
  assert.equal(await page.evaluate(() => tyran.state.difficulty), difficulty);
  assert.equal(await page.locator('#difficulty-value').textContent(), label);
};
const assertPickerFits = async page => {
  await page.locator('#difficulty-picker').scrollIntoViewIfNeeded();
  const layout = await page.locator('#difficulty-picker').evaluate(picker => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    labels: [...picker.querySelectorAll('label')].map(label => {
      const bounds = label.getBoundingClientRect(), text = label.querySelector('span');
      return { left: bounds.left, right: bounds.right, width: bounds.width, textFits: text.scrollWidth <= text.clientWidth, viewport: innerWidth };
    }),
  }));
  assert.equal(layout.overflow, false, 'The menu has no horizontal overflow');
  for (const [index, item] of layout.labels.entries()) {
    assert(item.left >= 0 && item.right <= item.viewport && item.width > 0, 'Every difficulty target is inside the viewport');
    assert(item.textFits, 'Every difficulty label fits its target');
    if (index) assert(item.left >= layout.labels[index - 1].right, 'Difficulty targets do not overlap');
  }
};

try {
  const page = await newPage({ viewport: { width: 1440, height: 960 } });
  assert.equal(await page.locator('#difficulty-picker input[type="radio"][name="difficulty"]').count(), 4);
  assert.deepEqual(await page.locator('#difficulty-picker label > span').allTextContents(), ['Easy', 'Medium', 'Hard', 'Real']);
  assert.equal(await selected(page), 'easy');
  await assertPickerFits(page);

  // Native radio arrow navigation changes both the checked control and setting.
  await choice(page, 'easy').focus();
  for (const difficulty of ['medium', 'hard', 'real']) {
    await page.keyboard.press('ArrowRight');
    assert.equal(await selected(page), difficulty);
    assert.equal(await page.evaluate(() => localStorage.getItem('tyran-difficulty')), difficulty);
  }
  await page.keyboard.press('ArrowLeft'); assert.equal(await selected(page), 'hard');

  let previousHp = 0;
  for (const [difficulty, label] of [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['real', 'Real']]) {
    await choice(page, difficulty).check();
    await page.locator('#launch-button').click();
    const actor = await page.evaluate(async () => {
      const { spawnEnemy } = await import('./sim.js');
      const { difficultyProfile } = await import('./difficulty.js');
      const enemy = spawnEnemy(tyran.state, 0, tyran.state.width / 2, 180);
      tyran.pause();
      return { hp: enemy.maxHp, expected: tyran.enemyTypes[0].hp * difficultyProfile(tyran.state.difficulty).health };
    });
    await assertDifficulty(page, difficulty, label);
    assert.equal(actor.hp, actor.expected, `${label} changes actual spawned enemy health`);
    assert(actor.hp > previousHp, 'Each step raises enemy health monotonically'); previousHp = actor.hp;
    assert.equal(JSON.parse(await saved(page)).state.difficulty, difficulty);
    await page.locator('#menu-button').click();
    assert.match(await page.locator('#save-summary').textContent(), new RegExp(` · ${label} · `));
  }
  await page.screenshot({ path: `${output}/desktop-real-menu.png` });
  await page.reload(); await ready(page);
  assert.equal(await selected(page), 'real', 'The chosen menu difficulty survives reload');
  assert.match(await page.locator('#save-summary').textContent(), / · Real · /);

  await choice(page, 'easy').check();
  await page.locator('#continue-button').click();
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  await assertDifficulty(page, 'real', 'Real');
  await page.locator('#restart-button').click(); await pause(page);
  await assertDifficulty(page, 'real', 'Real');
  assert.equal(JSON.parse(await saved(page)).state.difficulty, 'real', 'Restart preserves the saved challenge despite a different menu choice');

  await page.locator('#resume-button').click();
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    const s = tyran.state; s.director.hold = true; s.players[0].hurt = 1e6;
    killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4);
    if (s.challenge) { for (const enemy of s.enemies) if (enemy.challenge) enemy.gone = true; tyran.step(5); }
  });
  assert.equal(await page.evaluate(() => tyran.scene), 'hangar');
  await page.locator('#next-button').click(); await pause(page);
  assert.equal(await page.evaluate(() => tyran.state.level), 1); await assertDifficulty(page, 'real', 'Real');
  await page.locator('#resume-button').click();
  await page.screenshot({ path: `${output}/saved-real-hud.png` });
  await pause(page); await page.locator('#menu-button').click();
  const campaignReal = await saved(page);

  await choice(page, 'medium').check();
  await page.locator('[data-world="5"]').click();
  await page.locator('#sector-flight-button').click();
  await assertDifficulty(page, 'medium', 'Medium');
  await page.evaluate(() => { tyran.state.credits = 1234; tyran.state.players[0].hurt = 1e6; tyran.step(5.2); tyran.pause(); });
  await page.locator('#menu-button').click();
  assert.equal(await saved(page), campaignReal, 'A practice flight never overwrites the Real campaign');
  assert.match(await page.locator('#save-summary').textContent(), / · Real · /);
  await page.locator('#continue-button').click(); await assertDifficulty(page, 'real', 'Real');
  await page.locator('#menu-button').click();

  // An old save means original Easy tuning regardless of the newly selected menu setting.
  await choice(page, 'real').check();
  await page.evaluate(raw => {
    const record = JSON.parse(raw); delete record.state.difficulty;
    localStorage.setItem('tyran-campaign', JSON.stringify(record));
  }, campaignReal);
  await page.reload(); await ready(page);
  assert.equal(await selected(page), 'real');
  assert.match(await page.locator('#save-summary').textContent(), / · Easy · /);
  await page.locator('#continue-button').click(); await assertDifficulty(page, 'easy', 'Easy');
  await page.close();

  const mobile = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const width of [390, 320]) {
    await mobile.setViewportSize({ width, height: 844 });
    await assertPickerFits(mobile);
    await choice(mobile, 'easy').check(); await choice(mobile, 'easy').focus();
    await mobile.keyboard.press('ArrowRight'); assert.equal(await selected(mobile), 'medium');
    await mobile.screenshot({ path: `${output}/mobile-${width}-menu.png`, fullPage: true });
  }
  await choice(mobile, 'hard').check(); await mobile.locator('#launch-button').click();
  await assertDifficulty(mobile, 'hard', 'Hard');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: `${output}/mobile-320-hard-hud.png`, fullPage: true }); await pause(mobile);
  assert.deepEqual(errors, [], 'Difficulty selection, launches and migrations have no runtime errors');
  console.log('PASS difficulty browser UI: four native radios, keyboard/mobile layout, monotonic enemy HP, selection persistence, saved difficulty through resume/retry/cycle, practice isolation and Easy legacy migration.');
} finally { await browser.close(); }
