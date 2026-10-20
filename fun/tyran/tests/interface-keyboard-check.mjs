// Real keyboard events cover both navigation schemes without relying on mouse clicks.
// Serve the repository root and set TYRAN_PLAYWRIGHT when Playwright is not on Node's path.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/?renderer=native';
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
  const frames = new Map(); let sequence = 0, time = 1000;
  window.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.__keyboardFrame = (milliseconds = 1000 / 60) => {
    time += milliseconds;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(time);
  };
  window.__keyboardAdvance = count => { for (let i = 0; i < count; i++) __keyboardFrame(); };
  window.__focusKey = el => el?.id || ['primary', 'supply', 'upgrade'].map(key => el?.dataset?.[key] ? `${key}:${el.dataset[key]}` : '').find(Boolean) || '';
});
const active = () => page.evaluate(() => __focusKey(document.activeElement));
const scene = () => page.evaluate(() => tyran.scene);
const advance = count => page.evaluate(count => __keyboardAdvance(count), count);
const currentRow = () => page.locator('#menu-list .active').getAttribute('data-row');
const repeat = async key => { for (let i = 0; i < 4; i++) await page.keyboard.down(key); };
const controls = () => page.evaluate(() => [...document.querySelectorAll('#hangar-screen button:not(:disabled)')]
  .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(__focusKey));

async function moveTo(target, key = 'ArrowRight') {
  const limit = (await controls()).length + 1;
  for (let i = 0; i < limit; i++) {
    if (await active() === target) return;
    await page.keyboard.press(key);
  }
  assert.fail(`${target} must be reachable with ${key}`);
}
async function auditShopNavigation(key) {
  const expected = await controls(), seen = new Set();
  for (let i = 0; i <= expected.length; i++) {
    await page.keyboard.press(key);
    const focused = await active();
    assert(expected.includes(focused), `shop focus remains on an enabled action: ${focused}`);
    seen.add(focused);
    const visibility = await page.evaluate(() => {
      const el = document.activeElement, rect = el.getBoundingClientRect();
      return { visible: rect.bottom > 0 && rect.top < innerHeight && rect.left >= 0 && rect.right <= innerWidth + 1,
        keyboard: el.matches(':focus-visible') };
    });
    assert(visibility.visible, `${focused} scrolls into view`);
    assert(visibility.keyboard, `${focused} retains a visible keyboard focus indicator`);
  }
  assert.deepEqual([...seen].sort(), expected.sort(), `${key} reaches every enabled shop action`);
}
async function isolateFlight() {
  await page.evaluate(() => {
    const s = tyran.state;
    s.director.hold = true; s.enemies.length = 0; s.formations.length = 0; s.bullets.length = 0;
    Object.assign(s.players[0], { hurt: 1000, guard: 1000, fire: 0, vx: 0, vy: 0 });
    tyran.world.hit = () => []; tyran.world.getGroundTargets = () => [];
    __keyboardFrame(0);
  });
}
async function holdConfirmIntoFlight(key) {
  await page.keyboard.down(key);
  assert.equal(await scene(), 'playing');
  await isolateFlight(); await repeat(key); await advance(12);
  assert.equal(await page.evaluate(() => tyran.state.bullets.filter(bullet => bullet.team >= 0).length), 0,
    'confirm remains consumed through the scene transition until released');
  await page.keyboard.up(key);
}
async function openHangar() {
  await page.keyboard.down('Space');
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    tyran.launch(1); const s = tyran.state;
    s.credits = 100000; s.director.hold = true;
    killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4); __keyboardFrame(0);
  });
  assert.equal(await scene(), 'hangar');
  assert((await active()).startsWith('primary:'), 'entering the hangar selects a weapon instead of launch');
  const credits = await page.evaluate(() => tyran.state.credits);
  await page.keyboard.press('ArrowRight');
  assert.equal(await active(), 'primary:scatter');
  await repeat('Space');
  assert(await page.evaluate(credits => tyran.state.credits === credits && tyran.state.primary === 'pulse', credits),
    'a fire key held through the sector clear cannot buy the newly selected weapon');
  await page.keyboard.up('Space'); await page.keyboard.press('ArrowLeft');
}

try {
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20, timeout: 120000 });

  // Enter starts the selected campaign but must not become a held fire command.
  await holdConfirmIntoFlight('Enter');
  const before = await page.evaluate(() => ({ x: tyran.state.players[0].x, y: tyran.state.players[0].y }));
  for (const key of ['ArrowRight', 'ArrowUp', 'Enter']) await page.keyboard.down(key);
  await advance(15);
  const after = await page.evaluate(() => ({ x: tyran.state.players[0].x, y: tyran.state.players[0].y,
    shots: tyran.state.bullets.filter(bullet => bullet.team >= 0).length }));
  assert(after.x > before.x && after.y < before.y && after.shots > 0, 'arrows and a fresh Enter steer and shoot');
  for (const key of ['ArrowRight', 'ArrowUp', 'Enter']) await page.keyboard.up(key);
  await page.keyboard.press('Escape');
  assert.equal(await active(), 'resume-button');
  await page.keyboard.press('ArrowDown'); assert.equal(await active(), 'restart-button');
  await page.keyboard.press('KeyW'); assert.equal(await active(), 'resume-button');
  await holdConfirmIntoFlight('Space');
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyS'); await page.keyboard.press('KeyS');
  assert.equal(await active(), 'menu-button');
  await page.keyboard.press('Space'); assert.equal(await scene(), 'menu');
  console.log('PASS arrow/Enter flight, pause navigation, and held-confirm isolation across launch/resume');

  // The other layout selects sector and difficulty and launches practice without a mouse.
  assert.equal(await currentRow(), 'continue');
  await page.keyboard.press('KeyS'); assert.equal(await currentRow(), 'sector');
  await page.keyboard.press('KeyD');
  assert.equal(await page.evaluate(() => Number(document.body.dataset.world)), 1);
  await page.keyboard.press('KeyS'); assert.equal(await currentRow(), 'difficulty');
  await page.keyboard.press('KeyD');
  assert.equal(await page.locator('input[name="difficulty"]:checked').inputValue(), 'medium');
  await page.keyboard.press('KeyS'); assert.equal(await currentRow(), 'practice');
  await holdConfirmIntoFlight('Space');
  assert.equal(await page.evaluate(() => tyran.state.level), 1);
  const wasdBefore = await page.evaluate(() => tyran.state.players[0].x);
  await page.keyboard.down('KeyA'); await page.keyboard.down('Space'); await advance(15);
  assert(await page.evaluate(x => tyran.state.players[0].x < x && tyran.state.bullets.some(bullet => bullet.team >= 0), wasdBefore), 'WASD/Space remains playable');
  await page.keyboard.up('KeyA'); await page.keyboard.up('Space');
  console.log('PASS WASD/Space sector, difficulty, practice and flight controls');

  await openHangar();
  await page.keyboard.press('ArrowRight'); assert.equal(await active(), 'primary:scatter');
  await page.keyboard.press('KeyA'); assert.equal(await active(), 'primary:pulse');
  await page.keyboard.press('ArrowDown'); assert.equal(await active(), 'primary:lance', 'Down moves to the next weapon row, preserving the column');
  await page.keyboard.press('KeyS'); assert.equal(await active(), 'supply:drone', 'S reaches the supply row');
  await page.keyboard.press('KeyS'); assert.equal(await active(), 'upgrade:weapon', 'S reaches the upgrade row');
  await page.keyboard.press('KeyW'); assert.equal(await active(), 'supply:drone');
  await page.keyboard.press('ArrowUp'); assert.equal(await active(), 'primary:lance');
  await page.keyboard.press('KeyW'); assert.equal(await active(), 'primary:pulse');
  await auditShopNavigation('ArrowRight');
  await moveTo('upgrade:hull');
  const hullBefore = await page.evaluate(async () => {
    const { upgradeCost } = await import('./sim.js');
    return { rank: tyran.state.upgrades.hull, credits: tyran.state.credits, cost: upgradeCost(tyran.state, 'hull') };
  });
  await page.keyboard.down('Enter'); await repeat('Enter');
  assert.deepEqual(await page.evaluate(() => ({ rank: tyran.state.upgrades.hull, credits: tyran.state.credits })),
    { rank: hullBefore.rank + 1, credits: hullBefore.credits - hullBefore.cost }, 'holding Enter buys exactly one upgrade');
  assert.equal(await active(), 'upgrade:hull', 'purchasing retains focus on the recreated upgrade card');
  await page.keyboard.up('Enter');
  await moveTo('primary:scatter');
  await page.keyboard.down('Space'); await repeat('Space'); await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => tyran.state.primary), 'scatter');
  assert.equal(await active(), 'primary:scatter', 'buying/equipping preserves weapon focus');
  await moveTo('primary:pulse'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => tyran.state.primary), 'pulse', 'an owned weapon is equipped using Enter');
  await moveTo('supply:bomb');
  const bombsBefore = await page.evaluate(() => tyran.state.players[0].bombs);
  await page.keyboard.down('Space'); await repeat('Space'); await page.keyboard.up('Space');
  assert.equal(await page.evaluate(() => tyran.state.players[0].bombs), bombsBefore + 1, 'holding Space buys exactly one supply');
  assert.equal(await active(), 'supply:bomb');
  await page.keyboard.press('Space');
  assert(await page.locator('[data-supply="bomb"]').isDisabled(), 'full supplies are no longer actionable');
  assert((await controls()).includes(await active()), 'focus moves to an enabled neighbor when the old card becomes disabled');
  assert.notEqual(await active(), 'next-button', 'a completed purchase does not jump to launch');
  await auditShopNavigation('ArrowRight');
  console.log('PASS keyboard shop traversal, upgrade/equip/supply purchases, one action per press and stable focus');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => __keyboardFrame(0));
  await auditShopNavigation('KeyD');
  await moveTo('upgrade:fireRate', 'KeyD');
  const rateBefore = await page.evaluate(() => tyran.state.upgrades.fireRate);
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => tyran.state.upgrades.fireRate), rateBefore + 1);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
    && document.querySelector('#hangar-screen').scrollWidth <= innerWidth), 'the narrow shop has no horizontal overflow');
  await page.screenshot({ path: process.env.TYRAN_KEYBOARD_SCREENSHOT || '/tmp/tyran-keyboard-mobile.png', animations: 'disabled' });
  await moveTo('next-button', 'KeyD');
  await holdConfirmIntoFlight('Space');
  assert.equal(await page.evaluate(() => tyran.state.level), 2, 'keyboard launch advances exactly one sector');
  console.log('PASS narrow stacked shop navigation, purchase and next-sector launch');

  // Defeat exposes only its own actions; the manual keeps document scrolling and a keyboard Back action.
  await page.evaluate(async () => {
    const { hurtPlayer } = await import('./sim.js');
    const s = tyran.state; s.lives = 0; s.checkpoint = null;
    Object.assign(s.players[0], { hull: 1, shield: 0, hurt: 0, guard: 0, invulnerableTime: 0 });
    hurtPlayer(s, s.players[0], 1000); tyran.step(1 / 60); __keyboardFrame(0); __keyboardAdvance(120);
  });
  assert.equal(await scene(), 'end'); assert.equal(await active(), 'retry-button');
  await page.keyboard.press('KeyS'); assert.equal(await active(), 'end-menu-button');
  await page.keyboard.press('Space'); assert.equal(await scene(), 'menu');
  await page.keyboard.press('KeyH'); assert(await page.locator('#help-screen').isVisible());
  await page.keyboard.press('KeyS');
  assert(await page.locator('#help-screen').evaluate(el => el.scrollTop) > 0, 'S scrolls the manual');
  await page.keyboard.press('Enter'); assert(await page.locator('#help-screen').isHidden(), 'Enter activates Back');
  await page.keyboard.press('KeyH'); await page.keyboard.press('Space');
  assert(await page.locator('#help-screen').isHidden(), 'Space activates Back');
  assert.deepEqual(errors, [], 'keyboard navigation produces no runtime errors');
  console.log('PASS end-screen navigation and keyboard-only manual scrolling/Back');
} finally { await browser.close(); }
