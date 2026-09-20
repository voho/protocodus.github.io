// Serve repo root, then TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Real browser keyboard input drives fixed simulation ticks. Synthetic events below
// verify DOM cancellation only; they do not claim interception of OS shortcuts.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
await page.addInitScript(() => {
  const callbacks = new Map(); let next = 0;
  window.__frameTime = 1000;
  window.requestAnimationFrame = callback => { const id = ++next; callbacks.set(id, callback); return id; };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  window.__pumpFrame = timestamp => {
    __frameTime = timestamp;
    const queued = [...callbacks.values()]; callbacks.clear();
    for (const callback of queued) callback(timestamp);
  };
  localStorage.setItem('tyran-muted', 'true');
});
const ready = () => page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
const advance = seconds => page.evaluate(seconds => {
  const start = __frameTime;
  for (let i = 1; i <= Math.ceil(seconds * 60); i++) __pumpFrame(start + Math.min(seconds, i / 60) * 1000);
}, seconds);
const weapons = () => page.evaluate(() => ({ pilots: tyran.state.players.map(p => p.weapon), mirror: tyran.state.weapon }));
const focus = id => page.evaluate(id => document.getElementById(id).focus(), id);
const isolateCombat = () => page.evaluate(() => {
  const s = tyran.state;
  s.spawnTimer = 100; s.formationTimer = 100; s.showcase = 9; s.enemies.length = 0; s.formations.length = 0; s.bullets.length = 0;
  for (const p of s.players) { p.hurt = 100; p.fire = 0; }
});
const friendlyKinds = () => page.evaluate(() => [0, 1].map(team => [...new Set(tyran.state.bullets.filter(b => b.team === team).map(b => b.kind))]));

try {
  await page.goto(url); await ready();
  await page.evaluate(async () => {
    await tyran.world.ready;
    document.querySelector('[data-mode="2"]').click(); document.querySelector('#launch-button').click();
    __pumpFrame(__frameTime);
  });
  await isolateCombat();
  assert.deepEqual(await page.evaluate(() => tyran.weapons.map(w => w.id)), ['pulse', 'plasma'], 'exactly two selectable weapon profiles remain');
  assert.deepEqual(await weapons(), { pilots: ['pulse', 'pulse'], mirror: 'pulse' });

  await page.keyboard.down('AltLeft');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'pulse'], mirror: 'plasma' }, 'left Alt changes only pilot one');
  await page.keyboard.down('AltLeft');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'pulse'], mirror: 'plasma' }, 'repeated left Alt keydown cannot cycle twice');
  await page.keyboard.up('AltLeft');
  await page.keyboard.down('AltRight');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'plasma'], mirror: 'plasma' }, 'right Alt changes only pilot two');
  await page.keyboard.down('AltRight');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'plasma'], mirror: 'plasma' }, 'repeated right Alt keydown cannot cycle twice');
  await page.keyboard.up('AltRight');
  await page.keyboard.press('AltLeft');
  assert.deepEqual(await weapons(), { pilots: ['pulse', 'plasma'], mirror: 'pulse' });

  const beforeMove = await page.evaluate(() => tyran.state.players.map(p => ({ x: p.x, y: p.y })));
  for (const code of ['ControlLeft', 'ControlRight', 'KeyD', 'KeyW', 'ArrowRight', 'ArrowUp']) await page.keyboard.down(code);
  await advance(.25);
  assert.deepEqual(await friendlyKinds(), [['pulse'], ['plasma']], 'each pilot fires the selected projectile profile');
  const moved = await page.evaluate(() => tyran.state.players.map(p => ({ x: p.x, y: p.y })));
  moved.forEach((p, i) => assert.ok(p.x > beforeMove[i].x && p.y < beforeMove[i].y, `pilot ${i + 1} moves diagonally while holding fire`));
  await page.keyboard.press('AltLeft');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'plasma'], mirror: 'plasma' }, 'left Alt works while both Ctrl keys and movement are held');
  await page.keyboard.press('AltRight');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'pulse'], mirror: 'plasma' }, 'right Alt remains independent with modifiers held');
  await isolateCombat(); await advance(.12);
  assert.deepEqual(await friendlyKinds(), [['plasma'], ['pulse']], 'held fire immediately uses each changed loadout');
  for (const code of ['KeyD', 'KeyW', 'ArrowRight', 'ArrowUp', 'ControlLeft', 'ControlRight']) await page.keyboard.up(code);
  console.log('PASS actual left/right Alt, repeat suppression and independent co-op movement/fire profiles');

  const cancellation = await page.evaluate(() => {
    window.__downstreamKeys = [];
    for (const type of ['keydown', 'keyup', 'keypress']) {
      for (const [target, capture] of [[window, true], [document, true], [document, false]]) target.addEventListener(type, e => {
        __downstreamKeys.push({ code: e.code, type: e.type, prevented: e.defaultPrevented });
      }, { capture });
    }
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Space', 'Enter', 'KeyP', 'KeyM', 'Escape'];
    const cases = codes.map(code => ({ code }));
    cases.push({ code: 'KeyR', ctrlKey: true }, { code: 'KeyL', metaKey: true }, { code: 'KeyI', ctrlKey: true, shiftKey: true });
    const results = [];
    for (const fields of cases) for (const type of ['keydown', 'keypress', 'keyup']) {
      const before = __downstreamKeys.length;
      const event = new KeyboardEvent(type, { key: fields.code.replace(/^Key/, '').toLowerCase(), ...fields, bubbles: true, cancelable: true, repeat: true });
      const accepted = document.querySelector('#game-canvas').dispatchEvent(event);
      results.push({ code: fields.code, type, accepted, prevented: event.defaultPrevented, downstream: __downstreamKeys.length - before });
    }
    return results;
  });
  for (const event of cancellation) {
    assert.equal(event.accepted, false, `${event.type} ${event.code} is canceled when delivered during flight`);
    assert.equal(event.prevented, true, `${event.type} ${event.code} has defaultPrevented`);
    assert.equal(event.downstream, 0, `${event.type} ${event.code} cannot reach later capture/bubble listeners`);
  }
  assert.equal(await page.evaluate(() => tyran.scene), 'playing', 'repeated control events do not pause the flight');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'pulse'], mirror: 'plasma' }, 'synthetic repeat events do not cycle loadouts');
  console.log('PASS delivered gameplay events are canceled in capture phase without downstream listeners');

  for (const openingKey of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(openingKey);
    assert.equal(await page.evaluate(() => tyran.scene), 'pause', `${openingKey} opens accessible pause controls from flight`);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'resume-button', `${openingKey} retains initial focus on Resume`);
    for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab', 'Tab']) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.querySelector('#pause-screen').contains(document.activeElement)), true, `${key} stays inside the pause dialog after ${openingKey}`);
    }
    await focus('resume-button'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => tyran.scene), 'playing');
  }
  console.log('PASS flight Tab/Shift+Tab retain Resume focus and subsequent navigation stays within pause');

  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  await focus('resume-button'); await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'resume-button', 'Tab navigates the pause dialog');
  await focus('resume-button'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => tyran.scene), 'playing', 'Enter activates the focused pause button');
  await page.keyboard.press('Escape'); await focus('menu-button'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => tyran.scene), 'menu', 'normal keyboard button activation returns to the menu');
  await focus('launch-button'); await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'launch-button', 'Tab navigates the main menu');
  const qualityBefore = await page.locator('#quality-toggle').getAttribute('aria-pressed');
  await focus('quality-toggle'); await page.keyboard.press('Space');
  assert.notEqual(await page.locator('#quality-toggle').getAttribute('aria-pressed'), qualityBefore, 'Space activates a focused menu button');
  const menuEvent = await page.evaluate(() => {
    const before = __downstreamKeys.length;
    const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true, cancelable: true });
    const accepted = document.activeElement.dispatchEvent(event);
    return { accepted, prevented: event.defaultPrevented, downstream: __downstreamKeys.length - before };
  });
  assert.deepEqual(menuEvent, { accepted: true, prevented: false, downstream: 3 }, 'gameplay keyboard isolation is released in the menu');
  console.log('PASS pause/menu Tab, Enter and Space retain native button behavior');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tyran-campaign')));
  assert.deepEqual(saved.state.players.map(p => p.weapon), ['plasma', 'pulse'], 'autosave stores each pilot weapon');
  assert.equal(saved.state.weapon, 'plasma', 'legacy state weapon mirrors pilot one');
  await page.reload(); await ready(); await focus('continue-button'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => tyran.scene), 'pause', 'campaign resumes paused');
  assert.deepEqual(await weapons(), { pilots: ['plasma', 'pulse'], mirror: 'plasma' }, 'reload/resume restores both independent choices');
  await focus('resume-button'); await page.keyboard.press('Enter'); await page.evaluate(() => __pumpFrame(__frameTime));
  await isolateCombat();
  for (const code of ['ControlLeft', 'ControlRight', 'KeyD', 'ArrowRight']) await page.keyboard.down(code);
  await advance(.12);
  assert.deepEqual(await friendlyKinds(), [['plasma'], ['pulse']], 'resumed pilots retain their projectile profiles');
  // Deliver the browser focus-loss notification with keys physically still down.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(() => tyran.scene), 'pause', 'focus loss pauses the active flight');
  await page.evaluate(() => {
    document.querySelector('#resume-button').click();
    for (const p of tyran.state.players) { p.vx = 0; p.vy = 0; p.fire = 0; }
    tyran.state.bullets.length = 0; __pumpFrame(__frameTime);
  });
  const released = await page.evaluate(() => tyran.state.players.map(p => ({ x: p.x, y: p.y })));
  await advance(.25);
  assert.deepEqual(await friendlyKinds(), [[], []], 'focus loss clears held fire before keyup is received');
  assert.deepEqual(await page.evaluate(() => tyran.state.players.map(p => ({ x: p.x, y: p.y }))), released, 'focus loss clears held movement before keyup is received');
  for (const code of ['ControlLeft', 'ControlRight', 'KeyD', 'ArrowRight']) await page.keyboard.up(code);
  console.log('PASS independent loadouts autosave/resume and focus loss clears held movement/fire');
  assert.deepEqual(await page.locator('#p1-weapon-name, #p2-weapon-name').allTextContents(), ['Plasma Mortar', 'Pulse Array'], 'HUD names show independent pilot loadouts');
  await page.evaluate(() => {
    window.__shopKeyups = [];
    window.addEventListener('keyup', event => __shopKeyups.push(event.code), { capture: true });
  });
  await page.keyboard.down('AltLeft');
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    killEnemy(tyran.state, spawnEnemy(tyran.state, 9, tyran.state.width / 2, 180)); tyran.step(3.4);
  });
  assert.equal(await page.evaluate(() => tyran.scene), 'hangar', 'boss completion enters the shop with Alt still held');
  await page.keyboard.up('AltLeft');
  assert.deepEqual(await page.evaluate(() => __shopKeyups), [], 'Alt keyup remains swallowed after the scene changes to hangar');
  await page.keyboard.press('AltRight');
  assert.deepEqual(await weapons(), { pilots: ['pulse', 'plasma'], mirror: 'pulse' }, 'shop right Alt changes only pilot two');
  const arsenal = () => page.evaluate(() => ({
    pilot: document.querySelector('[data-arsenal-pilot][aria-pressed="true"]').dataset.arsenalPilot,
    weapon: document.querySelector('[data-weapon][aria-pressed="true"]').dataset.weapon,
    names: [...document.querySelectorAll('#p1-weapon-name, #p2-weapon-name')].map(el => el.textContent),
  }));
  assert.deepEqual(await arsenal(), { pilot: '1', weapon: 'plasma', names: ['Pulse Array', 'Plasma Mortar'] }, 'shop card, selected pilot and both HUD names match the changed loadout');
  await page.evaluate(() => document.querySelector('[data-arsenal-pilot="0"]').click());
  assert.deepEqual(await arsenal(), { pilot: '0', weapon: 'pulse', names: ['Pulse Array', 'Plasma Mortar'] }, 'switching shop pilot shows that pilot’s active card');
  await page.evaluate(() => {
    document.querySelector('#hangar-menu-button').click(); document.querySelector('[data-mode="1"]').click(); document.querySelector('#launch-button').click();
  });
  await page.keyboard.press('AltRight');
  assert.deepEqual(await weapons(), { pilots: ['pulse'], mirror: 'pulse' }, 'right Alt does not alter the solo pilot');
  console.log('PASS held Alt release across hangar entry, per-pilot shop cards/HUD names and solo isolation');

  // Mock the optional browser API and fullscreen state; this verifies lifecycle,
  // not whether a particular browser or operating system delivers reserved keys.
  await page.evaluate(() => {
    window.__keyboardLock = { requests: [], unlocks: 0, pending: [], mode: 'resolve', fullscreen: false };
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: {
      lock(keys) {
        __keyboardLock.requests.push([...keys]);
        if (__keyboardLock.mode === 'reject') return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
        if (__keyboardLock.mode === 'defer') return new Promise(resolve => __keyboardLock.pending.push(resolve));
        return Promise.resolve();
      },
      unlock() { __keyboardLock.unlocks++; },
    } });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => __keyboardLock.fullscreen ? document.documentElement : null });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  const lock = () => page.evaluate(() => ({ requests: __keyboardLock.requests.length, unlocks: __keyboardLock.unlocks, scene: tyran.scene }));
  assert.equal((await lock()).requests, 0, 'windowed flight does not request Keyboard Lock');
  await page.evaluate(() => { tyran.pause(); __keyboardLock.fullscreen = true; document.dispatchEvent(new Event('fullscreenchange')); });
  assert.equal((await lock()).requests, 0, 'fullscreen pause does not request Keyboard Lock');
  await page.evaluate(() => document.querySelector('#resume-button').click());
  assert.equal((await lock()).requests, 1, 'fullscreen flight requests Keyboard Lock');
  const requestedKeys = await page.evaluate(() => __keyboardLock.requests[0]);
  for (const code of ['KeyW', 'ArrowUp', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'F11', 'KeyF']) assert.ok(requestedKeys.includes(code), `${code} is included in the scoped lock request`);
  assert.ok(!requestedKeys.includes('Tab') && requestedKeys.length < 30, 'the lock request is scoped and leaves Tab available');
  const locked = await lock(); await page.evaluate(() => tyran.pause());
  assert.ok((await lock()).unlocks > locked.unlocks, 'pausing releases Keyboard Lock');
  await page.evaluate(() => { __keyboardLock.mode = 'defer'; document.querySelector('#resume-button').click(); tyran.pause(); });
  const pausedRequest = await lock();
  assert.equal(pausedRequest.requests, 2);
  await page.evaluate(async () => { __keyboardLock.pending.shift()(); await Promise.resolve(); });
  assert.equal((await lock()).unlocks, pausedRequest.unlocks + 1, 'a lock resolving after pause is immediately released');
  await page.evaluate(async () => { __keyboardLock.mode = 'reject'; document.querySelector('#resume-button').click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal((await lock()).scene, 'playing', 'lock rejection leaves the flight playable');
  await page.keyboard.press('AltLeft');
  assert.deepEqual(await weapons(), { pilots: ['plasma'], mirror: 'plasma' }, 'ordinary captured controls still work after lock rejection');
  const rejected = await lock();
  await page.evaluate(() => { __keyboardLock.fullscreen = false; document.dispatchEvent(new Event('fullscreenchange')); });
  const exited = await lock();
  assert.equal(exited.requests, rejected.requests, 'leaving fullscreen makes no new lock request');
  assert.ok(exited.unlocks > rejected.unlocks, 'leaving fullscreen releases Keyboard Lock');
  console.log('PASS mocked fullscreen Keyboard Lock scope, rejection, pause/exit release and late resolution cleanup');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('All keyboard/weapon browser checks passed.');
} finally { await browser.close(); }
