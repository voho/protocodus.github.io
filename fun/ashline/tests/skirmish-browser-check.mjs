// Real setup launches: Random defaults, deterministic resolution, explicit choices and save restoration.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-skirmish-qa';
await mkdir(output, { recursive: true });
const errors = [];
const ready = page => page.waitForFunction(() => window.ashline?.booted);
const running = page => page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
const selectors = ['player-race', 'enemy-race', 'difficulty', 'map-profile', 'environment', 'map-size', 'rival-doctrine', 'skirmish-mode'];
const stateSettings = page => page.evaluate(() => {
  const s = ashline.state;
  return { seed: s.seed, difficulty: s.difficulty, width: s.width, height: s.height, profile: s.mapProfile,
    environment: s.environment, races: s.teams.map(team => team.race), doctrine: s.ai.doctrine, mission: s.mission?.id ?? null };
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await ready(page);
  for (const id of selectors) assert.equal(await page.locator(`#${id}`).inputValue(), 'random', `${id} defaults to Random`);
  assert.equal(await page.locator('#seed').inputValue(), '');
  assert.equal(await page.locator('#seed').getAttribute('placeholder'), 'Random');
  assert(!(await page.locator('#launch-form').textContent()).includes('undefined'));
  await page.screenshot({ path: `${output}/random-setup-desktop.png` });
  const seed = 'ALL-RANDOM';
  const expected = await page.evaluate(async seed => {
    const { resolveSkirmish } = await import('./skirmish-setup.js'), { SKIRMISH_MODES } = await import('./campaign.js');
    const choice = resolveSkirmish(seed), options = choice.options;
    return { seed, difficulty: choice.difficulty, width: options.width, height: options.height, profile: options.profile,
      environment: options.environment, races: options.races, doctrine: options.aiProfiles[1].doctrine,
      mission: SKIRMISH_MODES.find(mode => mode.id === choice.mode).mission ?? null };
  }, seed);
  await page.locator('#seed').fill(seed); await page.locator('#deploy').click(); await running(page);
  assert.deepEqual(await stateSettings(page), expected, 'Every Random choice reaches the simulation once');
  for (const id of selectors) assert.equal(await page.locator(`#${id}`).inputValue(), 'random', 'Resolved choices do not replace the Random setup');
  await page.reload(); await ready(page); await page.locator('#seed').fill(seed);
  await page.locator('#deploy').click(); await running(page);
  assert.deepEqual(await stateSettings(page), expected, 'Replaying a seed draws the same setup');

  await page.locator('#pause').click(); await page.locator('#new-game').click();
  assert.equal(await page.locator('#seed').inputValue(), '', 'New skirmish returns to a fresh random seed');
  const explicit = { 'player-race': 'aiUnity', 'enemy-race': 'organics', difficulty: 'easy', 'map-profile': 'basin',
    environment: 'desert', 'map-size': 'standard', 'rival-doctrine': 'swarm', 'skirmish-mode': 'annihilation' };
  for (const [id, value] of Object.entries(explicit)) await page.locator(`#${id}`).selectOption(value);
  await page.locator('#seed').fill('EXPLICIT-SETUP'); await page.locator('#deploy').click(); await running(page);
  const explicitState = { seed: 'EXPLICIT-SETUP', difficulty: 'easy', width: 144, height: 112, profile: 'basin',
    environment: 'desert', races: ['aiUnity', 'organics'], doctrine: 'swarm', mission: null };
  assert.deepEqual(await stateSettings(page), explicitState, 'Manual overrides remain exact');
  await page.locator('#pause').click(); await page.locator('#save-game').click(); await page.locator('#new-game').click();
  for (const id of selectors) await page.locator(`#${id}`).selectOption('random');
  await page.locator('#load-saved').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && ashline.paused && document.querySelector('#menu').open, null, { timeout: 120000 });
  assert.deepEqual(await stateSettings(page), explicitState, 'A save restores its actual biome and setup');
  for (const [id, value] of Object.entries(explicit)) {
    if (id !== 'rival-doctrine') assert.equal(await page.locator(`#${id}`).inputValue(), value, `${id} reflects the loaded operation`);
  }

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(url); await ready(phone);
  for (const id of selectors) assert.equal(await phone.locator(`#${id}`).inputValue(), 'random');
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The extra biome choice fits the phone layout');
  await phone.locator('#environment').scrollIntoViewIfNeeded();
  await phone.screenshot({ path: `${output}/random-setup-phone.png` });
  assert.deepEqual(errors, []);
  console.log('Random skirmish defaults, reproducible launches, explicit overrides, saved environments and phone setup passed.');
} finally { await browser.close(); }
