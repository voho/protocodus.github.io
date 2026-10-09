// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/mission-browser-check.mjs
// Sector objectives on the pause screen, the shop debrief with rank and next
// goals, and a defeated flight that retries from its checkpoint.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-qa';
await mkdir(output, { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  await page.evaluate(() => tyran.launch(2, null, false));

  // Pausing lists both goals with live progress.
  await page.evaluate(() => tyran.pause());
  const listed = await page.locator('#pause-objectives li').allTextContents();
  assert.equal(listed.length, 2, 'two objectives on the pause screen');
  const titles = await page.evaluate(() => tyran.state.director.objectives.map(objective => objective.kind));
  assert.equal(new Set(titles).size, 2);
  await page.screenshot({ path: `${output}/mission-pause.png` });
  await page.evaluate(() => tyran.pause());

  // The checkpoint is announced, and a lost flight resumes from it.
  const middle = await page.evaluate(() => {
    const d = tyran.state.director, middle = Math.floor(d.plan.length / 2);
    Object.assign(d, { wave: middle - 1, state: 'rest', clock: 0, rest: 0 });
    tyran.state.time = 70; tyran.state.scroll = 5000;
    tyran.step(.05);
    return middle;
  });
  assert.equal(await page.evaluate(() => tyran.state.checkpoint?.wave), middle);
  assert.match(await page.locator('#announcement').textContent(), /Checkpoint/);
  await page.evaluate(() => { const s = tyran.state; s.lives = 0; s.players[0].guard = 0; s.players[0].hurt = 0; s.players[0].invulnerableTime = 0; s.players[0].hull = 1; s.players[0].shield = 0; });
  await page.evaluate(async () => { const { hurtPlayer } = await import('./sim.js'); hurtPlayer(tyran.state, tyran.state.players[0], 50); tyran.step(.1); });
  await page.waitForFunction(() => tyran.scene === 'end' && !document.getElementById('end-screen').hidden, null, { timeout: 15000 });
  assert(await page.locator('#checkpoint-button').isVisible(), 'a checkpoint retry is offered');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'checkpoint-button');
  await page.screenshot({ path: `${output}/mission-defeat.png` });
  await page.locator('#checkpoint-button').click();
  const resumed = await page.evaluate(() => ({ scene: tyran.scene, wave: tyran.state.director.wave, state: tyran.state.director.state, time: tyran.state.time, scroll: tyran.state.scroll, lives: tyran.state.lives }));
  assert.equal(resumed.scene, 'playing');
  assert.equal(resumed.wave, middle - 1); assert.equal(resumed.state, 'rest');
  assert(resumed.time >= 70 && resumed.scroll >= 5000, 'the sector clock and terrain resume at the checkpoint');
  assert(resumed.lives >= 2, 'the retry keeps the usual reserve');

  // The shop debrief grades the sector and lists the next goals.
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    killEnemy(tyran.state, spawnEnemy(tyran.state, 9, tyran.state.width / 2, 180)); tyran.step(3.4);
    // Sector three is followed by a challenging stage: let it time out at once.
    if (tyran.state.challenge) { tyran.state.challenge.clock = 40; tyran.step(3); }
  });
  await page.waitForFunction(() => tyran.scene === 'hangar' || tyran.scene === 'bonus-outro', null, { timeout: 15000 });
  if (await page.evaluate(() => tyran.scene === 'bonus-outro')) await page.waitForFunction(() => tyran.scene === 'hangar', null, { timeout: 20000 });
  const debrief = await page.locator('#hangar-debrief > div').allTextContents();
  assert.equal(debrief.length, 4, 'rank, two objectives and the next goals');
  assert.match(debrief[0], /Sector rank[SABCD]/);
  assert.match(debrief[3], /Next sector goals04/);
  await page.locator('#hangar-debrief').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/mission-hangar.png` });
  assert.deepEqual(errors, []);
  console.log('Mission browser checks passed.');
} finally { await browser.close(); }
