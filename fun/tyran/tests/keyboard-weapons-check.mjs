// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Real keyboard events drive both fire channels. Synthetic events and mocked
// Keyboard Lock verify browser contracts, not interception of OS shortcuts.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
await page.addInitScript(() => {
  const queued = new Map(); let next = 0;
  window.__frameTime = 1000; window.__shots = [{ pulse: 0, plasma: 0 }, { pulse: 0, plasma: 0 }];
  const seen = new WeakSet();
  window.requestAnimationFrame = callback => { const id = ++next; queued.set(id, callback); return id; };
  window.cancelAnimationFrame = id => queued.delete(id);
  window.__pumpFrame = timestamp => {
    __frameTime = timestamp; const callbacks = [...queued.values()]; queued.clear();
    for (const callback of callbacks) callback(timestamp);
    for (const bullet of window.tyran?.state?.bullets || []) if (bullet.team >= 0 && !seen.has(bullet)) {
      seen.add(bullet); __shots[bullet.team][bullet.kind]++;
    }
  };
  localStorage.setItem('tyran-muted', 'true');
});
const ready = () => page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
const advance = seconds => page.evaluate(seconds => {
  const start = __frameTime;
  for (let i = 1; i <= Math.ceil(seconds * 60); i++) __pumpFrame(start + Math.min(seconds, i / 60) * 1000);
}, seconds);
const focus = id => page.evaluate(id => document.getElementById(id).focus(), id);
const energy = () => page.evaluate(() => tyran.state.players.map(({ fireEnergy, fireEnergyDelay, fireEnergyLocked }) => ({ fireEnergy, fireEnergyDelay, fireEnergyLocked })));
const positions = () => page.evaluate(() => tyran.state.players.map(({ x, y, vx, vy }) => ({ x, y, vx, vy })));
const friendlyKinds = () => page.evaluate(() => tyran.state.players.map(p => [...new Set(tyran.state.bullets.filter(b => b.team === p.id).map(b => b.kind))].sort()));
const isolateCombat = () => page.evaluate(() => {
  const s = tyran.state;
  s.spawnTimer = 100; s.formationTimer = 100; s.showcase = 9; s.enemies.length = 0; s.formations.length = 0; s.bullets.length = 0;
  for (const p of s.players) { p.hurt = 100; p.fire = 0; }
  tyran.world.hit = () => []; tyran.world.getGroundTargets = () => [];
});
async function fixture(mode = 2) {
  await page.evaluate(mode => {
    document.querySelector(`[data-mode="${mode}"]`).click(); document.querySelector('#launch-button').click(); __pumpFrame(__frameTime);
  }, mode);
  await isolateCombat();
}

try {
  await page.goto(url); await ready(); await fixture();
  assert.deepEqual(await page.evaluate(() => tyran.weapons.map(w => w.id)), ['pulse', 'plasma'], 'both direct fire channels are available');
  assert.equal(await page.locator('#p1-weapon, #p2-weapon, #arsenal-pilots').count(), 0, 'old weapon toggles and shop pilot selectors are removed');
  const before = await positions(), muted = await page.locator('#sound-toggle').getAttribute('aria-pressed');
  for (const key of ['KeyD', 'KeyW', 'KeyY', 'KeyJ', 'KeyI', 'KeyM']) await page.keyboard.down(key);
  await advance(.25);
  assert.deepEqual(await friendlyKinds(), [['pulse'], ['plasma']], 'Y fires P1 primary and M fires P2 secondary');
  const moved = await positions(), spent = await energy();
  assert.ok(moved[0].x > before[0].x && moved[0].y < before[0].y, 'WASD moves pilot one');
  assert.ok(moved[1].x < before[1].x && moved[1].y < before[1].y, 'IJKL moves pilot two independently');
  assert.equal(spent[0].fireEnergy, 100, 'primary fire spends no secondary energy');
  assert.ok(spent[1].fireEnergy < 100, 'only the pilot firing secondary spends energy');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), muted, 'M firing never toggles sound');
  for (const key of ['KeyD', 'KeyW', 'KeyY', 'KeyJ', 'KeyI', 'KeyM']) await page.keyboard.up(key);
  await isolateCombat();
  for (const key of ['KeyX', 'KeyN']) await page.keyboard.down(key);
  await advance(.12);
  assert.deepEqual(await friendlyKinds(), [['plasma'], ['pulse']], 'X fires P1 secondary and N fires P2 primary without switching loadouts');
  for (const key of ['KeyX', 'KeyN']) await page.keyboard.up(key);
  console.log('PASS actual WASD/Y/X and IJKL/N/M independently move and fire both channels');

  await fixture();
  const legacyStart = await positions();
  const retired = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Space', 'Enter'];
  for (const key of retired) {
    await page.keyboard.down(key); await advance(.08); await page.keyboard.up(key);
  }
  assert.deepEqual(await positions(), legacyStart, 'retired movement keys cannot steer either pilot');
  assert.deepEqual(await friendlyKinds(), [[], []], 'retired fire/toggle keys cannot launch projectiles');
  assert.deepEqual((await energy()).map(p => p.fireEnergy), [100, 100], 'retired controls spend no energy');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'), muted, 'retired controls leave sound unchanged');
  await page.keyboard.press('KeyV');
  assert.notEqual(await page.locator('#sound-toggle').getAttribute('aria-pressed'), muted, 'V toggles sound');
  await page.keyboard.press('KeyV');
  console.log('PASS retired arrow/Ctrl/Alt/Space/Enter controls are inert and V owns sound');

  await fixture(); await page.keyboard.down('KeyX');
  for (let i = 0; i < 40 && !(await energy())[0].fireEnergyLocked; i++) await advance(.1);
  const depleted = (await energy())[0];
  assert.ok(depleted.fireEnergyLocked && depleted.fireEnergy < 20, 'holding plasma drains energy and locks at insufficient charge');
  const plasmaBefore = await page.evaluate(() => __shots[0].plasma);
  await advance(.35);
  assert.equal(await page.evaluate(() => __shots[0].plasma), plasmaBefore, 'held secondary cannot shoot while recharging');
  await page.keyboard.up('KeyX'); await page.keyboard.down('KeyY'); await advance(.25);
  assert.ok((await friendlyKinds())[0].includes('pulse'), 'primary remains available while secondary is depleted');
  assert.equal((await energy())[0].fireEnergyLocked, true, 'releasing secondary does not bypass its recharge lock');
  await page.keyboard.up('KeyY'); await page.keyboard.down('KeyX');
  let recharged = false;
  for (let i = 0; i < 70; i++) {
    await advance(.1);
    if (await page.evaluate(count => __shots[0].plasma > count, plasmaBefore)) { recharged = true; break; }
  }
  await page.keyboard.up('KeyX');
  assert.ok(recharged, 'held secondary resumes automatically after sufficient recharge');
  assert.equal((await energy())[1].fireEnergy, 100, 'one pilot’s drain never touches the other reserve');
  await fixture();
  for (const key of ['KeyY', 'KeyX']) await page.keyboard.down(key);
  await advance(.12); assert.deepEqual(await friendlyKinds(), [['plasma'], []], 'secondary has priority when both fire buttons are held and charged');
  for (let i = 0; i < 40 && !(await energy())[0].fireEnergyLocked; i++) await advance(.1);
  await page.evaluate(() => { tyran.state.bullets.length = 0; }); await advance(.5);
  assert.deepEqual(await friendlyKinds(), [['pulse'], []], 'both held buttons fall back to primary while secondary recharges');
  for (const key of ['KeyY', 'KeyX']) await page.keyboard.up(key);
  console.log('PASS secondary drains, locks, recharges and resumes, with primary fallback and separate reserves');

  const cancellation = await page.evaluate(() => {
    window.__downstreamKeys = [];
    for (const type of ['keydown', 'keyup', 'keypress']) for (const [target, capture] of [[window, true], [document, true], [document, false]]) {
      target.addEventListener(type, e => __downstreamKeys.push(e.code), { capture });
    }
    const cases = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyY', 'KeyX', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyN', 'KeyM', 'KeyV', 'Escape', 'ControlLeft', 'AltRight', 'Space', 'Enter'].map(code => ({ code }));
    cases.push({ code: 'KeyR', ctrlKey: true }, { code: 'KeyL', metaKey: true });
    return cases.flatMap(fields => ['keydown', 'keypress', 'keyup'].map(type => {
      const before = __downstreamKeys.length;
      const e = new KeyboardEvent(type, { ...fields, bubbles: true, cancelable: true, repeat: true });
      const accepted = document.querySelector('#game-canvas').dispatchEvent(e);
      return { code: e.code, type, accepted, prevented: e.defaultPrevented, downstream: __downstreamKeys.length - before };
    }));
  });
  for (const event of cancellation) {
    assert.deepEqual([event.accepted, event.prevented, event.downstream], [false, true, 0], `${event.type} ${event.code} is captured and canceled before downstream listeners`);
  }
  for (const openingKey of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(openingKey);
    assert.equal(await page.evaluate(() => tyran.scene), 'pause');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'resume-button', `${openingKey} initially focuses Resume`);
    for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab', 'Tab']) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.querySelector('#pause-screen').contains(document.activeElement)), true, 'pause focus remains in its dialog');
    }
    await focus('resume-button'); await page.keyboard.press('Enter');
  }
  await page.evaluate(() => {
    Object.assign(tyran.state.players[0], { fireEnergy: 17, fireEnergyDelay: .45, fireEnergyLocked: true });
    Object.assign(tyran.state.players[1], { fireEnergy: 73, fireEnergyDelay: .8, fireEnergyLocked: false });
  });
  const savedEnergy = await energy(); await page.keyboard.press('Escape');
  await advance(2); assert.deepEqual(await energy(), savedEnergy, 'pause freezes both energy reserves and delays');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tyran-campaign')).state.players.map(({ fireEnergy, fireEnergyDelay, fireEnergyLocked }) => ({ fireEnergy, fireEnergyDelay, fireEnergyLocked })));
  assert.deepEqual(saved, savedEnergy, 'autosave preserves per-pilot energy, delay and lock');
  await focus('menu-button'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => tyran.scene), 'menu');
  const qualityBefore = await page.locator('#quality-toggle').getAttribute('aria-pressed');
  await focus('quality-toggle'); await page.keyboard.press('Space');
  assert.notEqual(await page.locator('#quality-toggle').getAttribute('aria-pressed'), qualityBefore, 'Space activates native menu buttons');
  await page.reload(); await ready(); await focus('continue-button'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  assert.deepEqual(await energy(), savedEnergy, 'reload/resume restores exact independent energy states');
  await focus('resume-button'); await page.keyboard.press('Enter'); await page.evaluate(() => __pumpFrame(__frameTime));
  await isolateCombat();
  for (const key of ['KeyD', 'KeyL', 'KeyY', 'KeyX', 'KeyN', 'KeyM']) await page.keyboard.down(key);
  await advance(.12);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  await page.evaluate(() => {
    document.querySelector('#resume-button').click();
    for (const p of tyran.state.players) { p.vx = 0; p.vy = 0; p.fire = 0; }
    tyran.state.bullets.length = 0; __pumpFrame(__frameTime);
  });
  const released = await positions(); await advance(.25);
  assert.deepEqual(await positions(), released, 'focus loss clears both held movement layouts');
  assert.deepEqual(await friendlyKinds(), [[], []], 'focus loss clears both held fire channels');
  for (const key of ['KeyD', 'KeyL', 'KeyY', 'KeyX', 'KeyN', 'KeyM']) await page.keyboard.up(key);
  console.log('PASS event isolation, accessible pause/menu, exact energy autosave/resume and focus-loss cleanup');
  await fixture(1);
  const solo = await positions();
  for (const key of ['KeyI', 'KeyJ', 'KeyN', 'KeyM']) await page.keyboard.down(key);
  await advance(.2);
  for (const key of ['KeyI', 'KeyJ', 'KeyN', 'KeyM']) await page.keyboard.up(key);
  assert.deepEqual(await positions(), solo, 'P2 movement never controls the solo pilot');
  assert.deepEqual(await friendlyKinds(), [[]], 'P2 fire never controls the solo pilot');
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
  for (const code of ['KeyW', 'KeyI', 'KeyY', 'KeyX', 'KeyN', 'KeyM', 'KeyV', 'F11', 'KeyF']) assert.ok(requestedKeys.includes(code), `${code} is included in the scoped lock request`);
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
  await isolateCombat(); await page.keyboard.down('KeyY'); await advance(.12); await page.keyboard.up('KeyY');
  assert.deepEqual(await friendlyKinds(), [['pulse']], 'ordinary captured fire still works after lock rejection');
  const rejected = await lock();
  await page.evaluate(() => { __keyboardLock.fullscreen = false; document.dispatchEvent(new Event('fullscreenchange')); });
  const exited = await lock();
  assert.equal(exited.requests, rejected.requests, 'leaving fullscreen makes no new lock request');
  assert.ok(exited.unlocks > rejected.unlocks, 'leaving fullscreen releases Keyboard Lock');
  console.log('PASS mocked fullscreen Keyboard Lock scope, rejection, pause/exit release and late resolution cleanup');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('All direct-fire keyboard/weapon browser checks passed.');
} finally { await browser.close(); }
