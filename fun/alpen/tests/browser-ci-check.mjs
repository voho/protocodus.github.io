// Run from fun/alpen with ALPEN_PLAYWRIGHT, ALPEN_URL and optional ALPEN_SOFTWARE_GPU=1.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.ALPEN_PLAYWRIGHT || 'playwright');
const url = new URL(process.env.ALPEN_URL || 'http://127.0.0.1:8773/fun/alpen/');
url.searchParams.set('seed', '1EE9566');
const software = process.env.ALPEN_SOFTWARE_GPU === '1';
const timerChecks = process.env.ALPEN_GPU_TIMERS === '1';
const compare = process.env.ALPEN_QA_PROFILE === 'detail';
const controlsOnly = process.env.ALPEN_QA_CONTROLS_ONLY === '1';
if (compare && controlsOnly) throw new Error('Controls-only QA requires a gameplay profile, not detail.');
if (software && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Software WebGL QA requires a loopback ALPEN_URL.');
}
const output = process.env.ALPEN_QA_OUTPUT || '/tmp/alpen-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.ALPEN_BROWSER || 'chrome', headless: true,
  args: [
    ...(software ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    ...(timerChecks ? ['--enable-webgl-developer-extensions'] : []),
  ],
});
const results = [], errors = [];
const frames = (page, count) => page.evaluate(count => new Promise(resolve => {
  let left = count;
  const tick = () => { if (--left <= 0) resolve(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), count);
async function checkInputDevice(page, device) {
  await page.waitForFunction(device => __alpen.input.state.device === device
    && document.body.dataset.inputDevice === device, device);
}
async function checkMenuHelp(page, device) {
  const shown = await page.locator('.curtain [data-input-help]').evaluateAll(nodes =>
    nodes.filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
      .map(node => node.dataset.inputHelp));
  assert(shown.length > 0, device + ': menu has visible help');
  assert.deepEqual([...new Set(shown)], [device], device + ': only matching help is displayed');
}
async function checkTouchControls(page) {
  assert(await page.evaluate(() => document.body.classList.contains('touch') && __alpen.input.state.touch),
    'touch capability survives another active input device');
  assert.equal(await page.locator('.ride-hint').isVisible(), false, 'riding hints stay out of the touch controls');
  const bounds = await page.locator('.pad-btn').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { label: button.dataset.key || button.dataset.action, x: rect.x, y: rect.y,
      width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom,
      visible: getComputedStyle(button).visibility !== 'hidden', viewport: [innerWidth, innerHeight] };
  }));
  for (const [index, button] of bounds.entries()) {
    assert(button.visible && button.width >= 44 && button.height >= 44, button.label + ': usable touch target');
    assert(button.x >= 0 && button.y >= 0 && button.right <= button.viewport[0] + .5
      && button.bottom <= button.viewport[1] + .5, button.label + ': target stays in the viewport');
    for (const other of bounds.slice(index + 1)) {
      assert(Math.min(button.right, other.right) <= Math.max(button.x, other.x)
        || Math.min(button.bottom, other.bottom) <= Math.max(button.y, other.y),
      button.label + ' and ' + other.label + ': touch targets do not overlap');
    }
  }
}
async function checkTouchHelpTap(page, mode) {
  await page.locator('.control-guide summary').tap();
  await checkInputDevice(page, 'touch');
  assert(await page.locator('.control-guide').evaluate(node => node.open),
    'a help tap still opens the target when its device changes the menu layout');
  assert.equal(await page.evaluate(() => __alpen.game.mode), mode, 'touch help does not start or resume a ride');
  await checkMenuHelp(page, 'touch');
  await page.locator('.control-guide summary').tap();
  assert.equal(await page.locator('.control-guide').evaluate(node => node.open), false, 'a second touch closes help');
}
async function checkControllerWithoutRaster(page, profile, check) {
  if (!software) return check();
  // Native RAF, input, physics and DOM keep running. Software rasterization
  // of the mountain is unrelated to these controller assertions;
  // retain the boot image while inspecting the real menu over it.
  const started = Date.now();
  const fixture = await page.evaluateHandle(() => {
    const a = __alpen;
    const saved = { render: a.renderer.render, begin: a.retro.beginGpuFrame,
      freeze: a.flicker.freezeResolution, skipped: 0 };
    a.flicker.freezeResolution = true;
    a.renderer.render = () => { saved.skipped++; };
    a.retro.beginGpuFrame = () => 0; // Skipped draws cannot report GPU headroom.
    return saved;
  });
  try {
    return await check();
  } finally {
    try {
      const restored = await fixture.evaluate(async saved => {
        const a = __alpen;
        a.renderer.render = saved.render;
        a.retro.beginGpuFrame = saved.begin;
        a.flicker.freezeResolution = saved.freeze;
        a.sky.refreshProbe();
        // Resize invalidates the main loop's private paused-world cache even
        // when dimensions stay unchanged. Observe a real full world draw.
        window.dispatchEvent(new Event('resize'));
        let worlds = 0;
        a.renderer.render = function(scene, camera) {
          const world = scene === a.scene && camera === a.camera;
          // Sky updates can change the shadow cadence earlier in this RAF.
          if (world) {
            this.shadowMap.needsUpdate = true;
            scene.traverse(node => { if (node.isLight && node.shadow) node.shadow.needsUpdate = true; });
          }
          const result = saved.render.call(this, scene, camera);
          if (world) worlds++;
          return result;
        };
        try {
          for (let frame = 0; frame < 120 && !worlds; frame++) await new Promise(requestAnimationFrame);
        } finally { a.renderer.render = saved.render; }
        return { skipped: saved.skipped, worlds, renderRestored: a.renderer.render === saved.render,
          timingRestored: a.retro.beginGpuFrame === saved.begin, freezeRestored: a.flicker.freezeResolution === saved.freeze };
      });
      assert(restored.worlds > 0 && restored.renderRestored && restored.timingRestored && restored.freezeRestored,
        'controller fixture restores native rendering, timing and resolution before subsequent checks');
      const report = { profile, ...restored, elapsedMs: Date.now() - started };
      results.push({ controllerRasterScope: report });
      console.log('Alpen controller raster scope: ' + JSON.stringify(report));
    } finally { await fixture.dispose(); }
  }
}
async function controllerFixture(page) {
  const handle = await page.evaluateHandle(() => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
    const makePad = index => ({ connected: true, index, mapping: 'standard', id: 'Alpen QA controller ' + index,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
    const pads = [makePad(0), makePad(1)];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    window.dispatchEvent(new Event('gamepadconnected'));
    return { descriptor, pads, makePad };
  });
  await frames(page, 2);
  const set = async (buttons = [], axes = [0, 0]) => {
    await handle.evaluate(({ pads }, { buttons, axes }) => {
      pads[0].buttons.forEach((button, index) => { button.pressed = buttons.includes(index); button.value = +button.pressed; });
      pads[0].axes[0] = axes[0]; pads[0].axes[1] = axes[1];
    }, { buttons, axes });
    await frames(page, 2);
  };
  return {
    handle, set,
    async press(button) { await set([button]); await set(); },
    async close() {
      // The fixture is not a controller-loss scenario. Hand off before teardown.
      await page.keyboard.press('KeyD');
      await handle.evaluate(({ descriptor }) => {
        if (descriptor) Object.defineProperty(navigator, 'getGamepads', descriptor);
        else delete navigator.getGamepads;
        window.dispatchEvent(new Event('gamepaddisconnected'));
      });
      await handle.dispose();
    },
  };
}
async function checkControllerFocus(page, selector) {
  await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), selector);
  assert(await page.locator(selector).evaluate(node => node.dataset.controllerFocus === 'true'
    && getComputedStyle(node).outlineStyle !== 'none' && parseFloat(getComputedStyle(node).outlineWidth) > 0),
  selector + ': focused controller target has a visible ring');
}
async function checkControllerHelp(page, pad, mode, profile) {
  await pad.press(13);
  await checkControllerFocus(page, '.drop-in');
  if (mode === 'paused') {
    await pad.press(13);
    await checkControllerFocus(page, '.restart-run');
  }
  // A fresh left-stick deflection and d-pad presses share native menu order.
  await pad.set([], [0, .8]); await pad.set();
  await checkControllerFocus(page, '.control-guide summary');
  await pad.set([0]);
  assert(await page.locator('.control-guide').evaluate(node => node.open), 'A opens native controller help');
  await frames(page, 3);
  assert(await page.locator('.control-guide').evaluate(node => node.open), 'holding A activates the summary only once');
  assert.equal(await page.evaluate(() => __alpen.game.mode), mode, 'controller help does not start or resume riding');
  await pad.set();
  await checkMenuHelp(page, 'gamepad');
  await page.screenshot({ path: output + '/' + profile + '-controller-help.png', animations: 'disabled' });
  const guideState = () => page.evaluate(() => {
    const scroller = document.querySelector('.curtain-inner'), bounds = scroller.getBoundingClientRect();
    const last = document.querySelector('.control-guide [data-input-help="gamepad"] > div:last-child dd').getBoundingClientRect();
    return { focused: document.activeElement === document.querySelector('.control-guide summary'),
      scroll: scroller.scrollTop, lastVisible: last.top >= bounds.top - 1 && last.bottom <= bounds.bottom + 1 };
  });
  let state = await guideState(), sawLast = state.lastVisible, scrolled = false;
  for (let press = 0; press < 16 && state.focused; press++) {
    const before = state.scroll;
    await pad.press(13);
    state = await guideState();
    sawLast ||= state.lastVisible;
    scrolled ||= state.scroll > before + 1;
  }
  assert(sawLast, profile + ': controller navigation reveals the final help row');
  if (profile === 'landscape') assert(scrolled, 'short landscape menu scrolls through controller help');
  await checkControllerFocus(page, '.exit-link');
  // Observe the native anchor click after its production handler, then prevent
  // just the browser navigation so the rest of this gameplay fixture can run.
  const exit = await page.evaluateHandle(() => {
    const node = document.querySelector('.exit-link');
    const result = { clicks: 0, allowed: false, href: '' };
    const listener = event => { result.clicks++; result.allowed = !event.defaultPrevented;
      result.href = node.getAttribute('href'); event.preventDefault(); };
    node.addEventListener('click', listener);
    return { node, listener, result };
  });
  try {
    await pad.press(0);
    assert.deepEqual(await exit.evaluate(({ result }) => result), { clicks: 1, allowed: true, href: '/fun/' },
      'A uses the native exit link and leaves its default navigation available');
    assert.equal(await page.evaluate(() => __alpen.game.mode), mode, 'exit click never also starts the ride');
  } finally {
    await exit.evaluate(({ node, listener }) => node.removeEventListener('click', listener));
    await exit.dispose();
  }
  await pad.press(1);
  assert.equal(await page.locator('.control-guide').evaluate(node => node.open), false, 'B closes controller help');
  await checkControllerFocus(page, '.control-guide summary');
  assert.equal(await page.evaluate(() => __alpen.game.mode), mode, 'closing controller help preserves the menu');
}
async function checkControllerPause(page, pad, profile, extended = false) {
  await pad.press(9);
  await page.waitForFunction(() => __alpen.game.mode === 'paused');
  await checkControllerHelp(page, pad, 'paused', profile);
  await pad.press(1);
  await page.waitForFunction(() => __alpen.game.mode === 'playing');
  assert.equal(await page.locator('[data-controller-focus="true"]').count(), 0, 'resuming clears the controller focus ring');
  await pad.press(9);
  await page.waitForFunction(() => __alpen.game.mode === 'paused');
  await pad.press(13);
  await checkControllerFocus(page, '.drop-in');
  await pad.set([0]);
  await page.waitForFunction(() => __alpen.game.mode === 'playing');
  await frames(page, 3);
  assert(await page.evaluate(() => !__alpen.input.state.jump && !__alpen.rider.charging && __alpen.rider.charge === 0),
    'holding A to resume never starts a jump charge');
  await pad.set();
  assert(await page.evaluate(() => !__alpen.input.state.jump && !__alpen.rider.charging && __alpen.rider._jumpBuffer === 0),
    'releasing the resume button cannot leave a buffered jump');
  if (!extended) return;
  await pad.set([0, 9]);
  await page.waitForFunction(() => __alpen.game.mode === 'paused');
  await frames(page, 2);
  assert.equal(await page.evaluate(() => __alpen.game.mode), 'paused', 'Start wins a simultaneous A press');
  await pad.set();
  await pad.press(13); await pad.press(13);
  await checkControllerFocus(page, '.restart-run');
  await page.evaluate(() => __alpen.game.discoveredGrabs.add(0));
  await pad.set([0]);
  await page.waitForFunction(() => __alpen.game.mode === 'playing');
  assert.equal(await page.evaluate(() => __alpen.game.discoveredGrabs.size), 0, 'A activates the focused native restart');
  await page.evaluate(() => __alpen.game.discoveredGrabs.add(0));
  await frames(page, 3);
  assert.equal(await page.evaluate(() => __alpen.game.discoveredGrabs.size), 1, 'holding A restarts only once');
  await pad.set();
  await pad.press(9);
  await page.waitForFunction(() => __alpen.game.mode === 'paused');
  await pad.press(8);
  await page.waitForFunction(() => __alpen.game.mode === 'playing');
  assert.equal(await page.evaluate(() => __alpen.game.discoveredGrabs.size), 0, 'Back retains its checkpoint restart shortcut');
}
async function checkControllerLoss(page, pad) {
  await pad.set([0], [.65, 0]);
  await page.waitForFunction(() => __alpen.input.state.jump && __alpen.rider.charging);
  await checkInputDevice(page, 'gamepad');
  await pad.handle.evaluate(({ pads }) => { pads[1] = null; window.dispatchEvent(new Event('gamepaddisconnected')); });
  await frames(page, 2);
  assert.equal(await page.evaluate(() => __alpen.game.mode), 'playing', 'disconnecting an idle pad does not pause the active rider');
  assert.equal(await page.locator('[data-controller-disconnected]').isVisible(), false, 'idle controller loss has no warning');
  await pad.handle.evaluate(({ pads, makePad }) => {
    pads[1] = makePad(1); window.dispatchEvent(new Event('gamepadconnected'));
  });
  await frames(page, 2);
  await pad.handle.evaluate(({ pads }) => { pads[0] = null; window.dispatchEvent(new Event('gamepaddisconnected')); });
  await page.waitForFunction(() => __alpen.game.mode === 'paused');
  assert(await page.evaluate(() => !__alpen.input.state.jump && !__alpen.rider.charging && __alpen.rider._jumpBuffer === 0),
    'active controller loss cancels charge without buffering a jump');
  assert(await page.locator('[data-controller-disconnected]').isVisible(), 'active controller loss explains the automatic pause');
  await pad.handle.evaluate(({ pads, makePad }) => {
    pads[0] = makePad(0); pads[0].buttons[0] = { pressed: true, value: 1 };
    pads[0].buttons[9] = { pressed: true, value: 1 }; window.dispatchEvent(new Event('gamepadconnected'));
  });
  await frames(page, 3);
  assert.equal(await page.evaluate(() => __alpen.game.mode), 'paused', 'held reconnect buttons cannot automatically resume');
  assert(await page.locator('[data-controller-disconnected]').isVisible(), 'reconnection keeps the pause explanation until resume');
  await pad.set();
  await pad.press(9);
  await page.waitForFunction(() => __alpen.game.mode === 'playing');
  assert.equal(await page.locator('[data-controller-disconnected]').isVisible(), false, 'deliberate resume clears the disconnect explanation');
  await page.keyboard.press('KeyD');
  await checkInputDevice(page, 'keyboard');
  await pad.handle.evaluate(({ pads }) => { pads[0] = null; window.dispatchEvent(new Event('gamepaddisconnected')); });
  await frames(page, 2);
  assert.equal(await page.evaluate(() => __alpen.game.mode), 'playing', 'controller loss after keyboard handoff does not interrupt riding');
}
async function checkControllerStart(page) {
  const pad = await controllerFixture(page);
  try {
    await pad.set([], [.65, 0]);
    await checkInputDevice(page, 'gamepad');
    assert.equal(await page.evaluate(() => __alpen.game.mode), 'attract', 'controller help appears before the first ride');
    await pad.set();
    await page.screenshot({ path: output + '/controller-title.png', animations: 'disabled' });
    await checkControllerHelp(page, pad, 'attract', 'desktop');
    await page.keyboard.press('Tab');
    await checkInputDevice(page, 'keyboard');
    assert(await page.locator('.exit-link').evaluate(node => node === document.activeElement),
      'Tab after controller use preserves menu navigation');
    assert.equal(await page.locator('[data-controller-focus="true"]').count(), 0, 'keyboard navigation removes the controller ring');
    assert.equal(await page.evaluate(() => __alpen.game.mode), 'attract', 'Tab does not start a ride');
    await checkMenuHelp(page, 'keyboard');
    await pad.press(9);
    await page.waitForFunction(() => __alpen.game.mode === 'playing');
    await checkInputDevice(page, 'gamepad');
    assert(await page.locator('.ride-hint [data-input-help="gamepad"]').isVisible(), 'controller riding hint is visible from the start');
    await pad.set([], [.65, 0]);
    await page.waitForFunction(() => __alpen.input.state.turnIntent > 0);
    await page.keyboard.down('KeyA');
    await checkInputDevice(page, 'keyboard');
    await frames(page, 3);
    assert.equal(await page.evaluate(() => __alpen.input.state.device), 'keyboard', 'a held stick cannot reclaim keyboard prompts');
    await page.keyboard.up('KeyA');
    await pad.set();
    assert.equal(await page.evaluate(() => __alpen.input.state.device), 'keyboard', 'releasing the stick does not change prompts');
    await pad.set([], [-.65, 0]);
    await checkInputDevice(page, 'gamepad');
    await pad.set();
    await checkControllerPause(page, pad, 'desktop', true);
    await checkControllerLoss(page, pad);
  } finally {
    await page.keyboard.up('KeyA');
    await pad.close();
  }
}
async function checkTouchControllerMenu(page, profile) {
  const pad = await controllerFixture(page);
  try {
    await checkControllerPause(page, pad, profile);
    await checkTouchControls(page);
  } finally { await pad.close(); }
}
async function checkPausedKeyboardCharge(page) {
  await page.keyboard.press('KeyR');
  const observer = await page.evaluateHandle(() => {
    const rider = __alpen.rider, result = { launches: 0 };
    const listener = () => result.launches++;
    rider.on('launch', listener);
    return { rider, listener, result };
  });
  try {
    await page.keyboard.down('Space');
    await page.waitForFunction(() => __alpen.rider.charging && __alpen.rider.charge > .6);
    assert.equal(await page.evaluate(() => __alpen.rider.state), 'ride', 'pause interrupts a grounded charge');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => __alpen.game.mode === 'paused');
    await page.keyboard.up('Space');
    await frames(page, 2);
    assert(await page.evaluate(() => !__alpen.input.state.jump && !__alpen.rider.charging
      && __alpen.rider.charge === 0 && __alpen.rider._jumpBuffer === 0),
    'releasing the physical Jump key while paused cancels the stored charge');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => __alpen.game.mode === 'playing');
    await frames(page, 6);
    assert.equal(await observer.evaluate(({ result }) => result.launches), 0,
      'physical pause/release/resume never launches the rider');
    console.log('Alpen paused keyboard charge passed');
  } finally {
    await page.keyboard.up('Space');
    await observer.evaluate(({ rider, listener }) => {
      const index = rider.events.launch.indexOf(listener);
      if (index >= 0) rider.events.launch.splice(index, 1);
    });
    await observer.dispose();
  }
}
async function checkPausedHelp(page, touch, profile) {
  await checkInputDevice(page, 'keyboard');
  // The key handler changes mode immediately; the next HUD update owns focus.
  await page.waitForFunction(() => document.activeElement === document.querySelector('.curtain'));
  assert(await page.locator('.curtain').evaluate(node => node === document.activeElement), 'pause moves focus into its menu');
  await page.locator('.control-guide summary').focus();
  await page.keyboard.press('Enter');
  assert(await page.locator('.control-guide').evaluate(node => node.open), 'keyboard opens help without resuming');
  await checkMenuHelp(page, 'keyboard');
  assert.equal(await page.evaluate(() => __alpen.game.mode), 'paused', 'reading help leaves the run paused');
  if (touch) assert(await page.evaluate(() => document.body.classList.contains('touch') && __alpen.input.state.touch),
    'hybrid menu selects keyboard help without removing touch capability');
  if (profile === 'portrait') {
    await page.locator('.control-guide-content').scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + '/portrait-keyboard-help.png', animations: 'disabled' });
  }
  await page.keyboard.press('Escape');
  assert(await page.locator('.control-guide summary').evaluate(node => node === document.activeElement),
    'closing help keeps focus on its summary');
  assert.equal(await page.evaluate(() => __alpen.game.mode), 'paused', 'closing help does not resume');
  if (touch) await checkTouchHelpTap(page, 'paused');
  await page.locator('.curtain').focus();
  await page.keyboard.press('Tab');
  assert(await page.locator('.drop-in').evaluate(node => node === document.activeElement), 'Tab reaches resume');
  await page.keyboard.press('Tab');
  assert(await page.locator('.restart-run').evaluate(node => node === document.activeElement), 'Tab reaches restart');
}
async function checkMotionPreference(page) {
  const sample = () => page.evaluate(() => {
    const a = __alpen;
    try {
      a.retro.setSpeed(250);
      return { blur: a.retro.blur, aberration: a.retro.aberration };
    } finally { a.retro.setSpeed(a.rider.speed); }
  });
  const before = await sample();
  assert(before.blur > 0 && before.aberration > 0, 'normal motion retains speed effects');
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    assert.deepEqual(await sample(), { blur: 0, aberration: 0 }, 'live reduced motion removes blur and chromatic split');
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  assert.deepEqual(await sample(), before, 'restoring the preference restores the original speed effects');
}
async function checkGrabAdvice(page) {
  // createHud wires its document's menu. A separate realm keeps this fixture
  // from leaving duplicate menu listeners on the production page.
  const frameNode = await page.evaluateHandle(() => {
    const node = document.createElement('iframe');
    node.hidden = true;
    document.body.appendChild(node);
    return node;
  });
  try {
    const fixture = await frameNode.asElement().contentFrame();
    const advice = await fixture.evaluate(async () => {
      const { createHud } = await import('/fun/alpen/js/hud.js');
      const root = document.body.appendChild(document.createElement('div'));
      const hud = createHud(root);
      const game = {
        mode: 'playing', score: 0, best: 0, bestAtStart: 0, combo: 1, flow: 0,
        gateRun: 0, pisteOffset: 0, liveTrick: 'BACKSIDE 180',
        weather: { phase: 'Day', conditions: 'Clear', storm: 0 },
        rider: { state: 'air', grounded: false, grabbing: true, airTime: .8,
          touchdownIn: .2, speed: 10, distance: 100, drop: 20,
          pos: { z: -100 }, charging: false, charge: 0 },
      };
      hud.update(game, .1);
      const held = {
        kicker: root.querySelector('.event-kicker').textContent,
        trick: root.querySelector('.event-name').textContent,
        grabbing: game.rider.grabbing,
      };
      game.rider.grabbing = false;
      hud.update(game, .1);
      return { held, released: root.querySelector('.event-kicker').textContent };
    });
    assert.equal(advice.held.kicker, 'Release grab to land · 0.8 s airtime', 'the real HUD gives timely release advice');
    assert.equal(advice.held.trick, 'BACKSIDE 180', 'release advice keeps the live trick readable');
    assert.equal(advice.held.grabbing, true, 'advice does not change the player grab');
    assert.equal(advice.released, '0.8 s airtime', 'release clears the advice');
  } finally {
    await frameNode.evaluate(node => node.remove());
    await frameNode.dispose();
  }
}
async function fixedWeather(page) {
  await page.route('**/fun/alpen/js/weather.js', async route => {
    const response = await route.fetch();
    let body = await response.text();
    const patch = (from, to) => {
      assert.equal(body.split(from).length, 2, 'weather fixture anchor: ' + from);
      body = body.replace(from, to);
    };
    patch('  let dayClock = 0;', '  let testStorm;\n  let dayClock = 0;');
    patch('  function update(dt) {', '  function update(dt) {\n    if (testStorm !== undefined) dt = 0;');
    patch('    const s = state.storm;', '    state.storm = testStorm ?? state.storm;\n    const s = state.storm;');
    patch('    return state;', '    if (testStorm !== undefined) state.flash = 0;\n    return state;');
    patch('return { state, update, pin, release, triggerStorm };',
      'return { state, update, pin, release, triggerStorm, check(tod, storm) { weatherClock = 0; stormCalled = -1; state.cloudX = state.cloudZ = state.cirrusX = state.cirrusZ = 0; testStorm = storm; frozen = tod; pinnedTod = tod; fogSettled = false; return update(0); } };');
    await route.fulfill({ response, body });
  });
}
async function capture(page, label, z, tod, storm, hit = null, view = null) {
  try {
    await page.evaluate(async ({ z, tod, storm, hit, view }) => {
      const a = __alpen;
      const { guideAt, heightAt } = await import('./js/terrain.js');
      a.game.mode = 'paused';
      a.rider.step = () => {}; // Capture only: actual production visual updates keep running.
      const x = hit?.x ?? guideAt(z);
      a.rider.reset(z, x); a.chase.reset(); a.trail.clear(); a.spray.clear();
      a.wildlife.reset(); a.huts.reset(); a.mountainLife.reset(z);
      a.model.reset(); a.shading.reset(); a.props.reset(z, 1);
      const w = a.weather.check(tod, storm);
      a.sky.update(a.rider.pos, w, 0);
      a.terrain.setSun(a.sky.sunDir.x, a.sky.sunDir.y, a.sky.sunDir.z, a.sky.shadowLevel);
      a.terrain.reset(x, z); a.terrain.snapSnowReady(); a.sky.snapBackdrop();
      a.retro.fade(1); a.flicker.freezeResolution = true; a.game.mode = 'attract';
      if (hit) {
        window.__alpenQAChase = a.chase.update;
        const y = heightAt(hit.x, hit.z);
        a.chase.update = () => {
          a.camera.position.set(hit.x - hit.side * (1.6 * hit.halfWidth + 5),
            y + Math.max(7, hit.face * .5), hit.z + Math.max(10, hit.face * .8));
          a.camera.up.set(0, 1, 0);
          a.camera.lookAt(hit.x, y - .3, hit.z - hit.lee * .25);
          a.camera.updateMatrixWorld();
        };
      }
      if (view) {
        window.__alpenQAChase = a.chase.update;
        window.__alpenQAFov = a.camera.fov;
        a.camera.fov = view.fov; a.camera.updateProjectionMatrix();
        a.chase.update = () => {
          a.camera.position.fromArray(view.eye); a.camera.up.set(0, 1, 0);
          a.camera.lookAt(...view.target); a.camera.updateMatrixWorld();
        };
      }
    }, { z, tod, storm, hit, view });
    // Settle the production visual update order without repeatedly rasterizing
    // an unchanged scene on a software GPU. One real frame below repairs every
    // cached GPU layer, including the rider's private depth shadow.
    await page.evaluate(() => {
      window.__alpenQARender = __alpen.renderer.render;
      __alpen.renderer.render = () => {};
    });
    try {
      await frames(page, 45);
    } finally {
      await page.evaluate(() => {
        __alpen.renderer.render = window.__alpenQARender;
        delete window.__alpenQARender;
        __alpen.sky.refreshProbe();
        __alpen.flicker.shadowEveryFrame = true;
        __alpen.renderer.shadowMap.needsUpdate = true;
      });
    }
    await frames(page, 1);
    await page.evaluate(() => { __alpen.game.mode = 'paused'; });
    await frames(page, 2);
    const visual = await page.evaluate(async (view) => {
      const a = __alpen;
      const { chapterNameAt } = await import('./js/terrain.js');
      const finite = [...a.rider.pos.toArray(), ...a.rider.normal.toArray(),
        ...a.camera.position.toArray(), ...a.camera.quaternion.toArray(), a.camera.fov,
        ...a.sky.sunDir.toArray(), a.weather.state.tod, a.weather.state.storm].every(Number.isFinite);
      a.renderer.info.reset();
      a.sky.refreshProbe(); a.sky.renderProbe(a.renderer);
      a.retro.render(a.scene, a.camera, true);
      const small = document.createElement('canvas');
      const factor = Math.min(512 / innerWidth, 320 / innerHeight);
      small.width = Math.round(innerWidth * factor); small.height = Math.round(innerHeight * factor);
      const context = small.getContext('2d');
      context.drawImage(a.renderer.domElement, 0, 0, small.width, small.height);
      const pixels = context.getImageData(0, 0, small.width, small.height).data;
      let low = 255, high = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const luma = pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
        low = Math.min(low, luma); high = Math.max(high, luma);
      }
      const crops = [];
      for (const rect of view?.crops || []) {
        const crop = document.createElement('canvas');
        crop.width = rect.width; crop.height = rect.height;
        const ctx = crop.getContext('2d');
        ctx.drawImage(a.renderer.domElement, rect.x * a.renderer.domElement.width / innerWidth,
          rect.y * a.renderer.domElement.height / innerHeight,
          rect.width * a.renderer.domElement.width / innerWidth,
          rect.height * a.renderer.domElement.height / innerHeight, 0, 0, crop.width, crop.height);
        crops.push({ name: rect.name, data_url: crop.toDataURL('image/jpeg', .85),
          png: crop.toDataURL('image/png').split(',')[1] });
      }
      const model = a.sky.group.getObjectByName('backdrop');
      let sectors = 0, fallback = 0, mapsReady = false;
      a.sky.group.traverse(o => {
        if (o.name === 'backdrop-range' && o.visible) {
          sectors++; mapsReady = !!o.material.uniforms.uShape.value?.image && !!o.material.uniforms.uCover.value?.image;
        }
        if ((o.name === 'mid-distance massifs' || o.name === 'far-range') && o.visible) fallback++;
      });
      const backdrop = { sectors, fallback, mapsReady, visible: model?.visible };
      const camera = { position: a.camera.position.toArray(), matrix: a.camera.matrixWorld.toArray(), fov: a.camera.fov };
      const debug = a.debug();
      delete debug.performance; // Capture-only settling is not a timing benchmark.
      return { finite, contrast: high - low, glError: a.renderer.getContext().getError(),
        chapter: chapterNameAt(a.rider.pos.z), weather: a.weather.state.conditions,
        phase: a.weather.state.phase, backdrop, camera, crops, debug,
        renderBudget: { calls: a.renderer.info.render.calls, triangles: a.renderer.info.render.triangles, geometries: a.renderer.info.memory.geometries, textures: a.renderer.info.memory.textures },
        data_url: small.toDataURL('image/jpeg', .6) };
    }, view);
    assert(visual.finite, label + ': scene values remain finite');
    assert.equal(visual.glError, 0, label + ': no WebGL error');
    assert.equal(visual.backdrop.sectors, 24, label + ': real mountain sectors loaded');
    assert(visual.backdrop.mapsReady && visual.backdrop.visible, label + ': real mountain maps visible');
    assert.equal(visual.backdrop.fallback, 0, label + ': fallback ranges hidden');
    assert(visual.contrast > 15, label + ': rendered image has real scene contrast');
    await page.locator('#stage').screenshot({ path: output + '/' + label + '.png' });
    if (process.env.ALPEN_QA_THUMBNAILS === '1') console.log('ALPEN_VISUAL ' + JSON.stringify({ label, chapter: visual.chapter, phase: visual.phase, data_url: visual.data_url }));
    for (const crop of visual.crops) {
      await writeFile(output + '/' + label + '-' + crop.name + '.png', Buffer.from(crop.png, 'base64'));
      if (process.env.ALPEN_QA_THUMBNAILS === '1') console.log('ALPEN_VISUAL ' + JSON.stringify({ label: label + '-' + crop.name, chapter: visual.chapter, phase: visual.phase, data_url: crop.data_url }));
    }
    delete visual.crops;
    delete visual.data_url;
    results.push({ label, ...(hit ? { sideHit: hit } : {}), ...visual });
  } finally {
    if (hit || view) await page.evaluate(() => {
      if (window.__alpenQAChase) __alpen.chase.update = window.__alpenQAChase;
      delete window.__alpenQAChase;
      if (window.__alpenQAFov !== undefined) { __alpen.camera.fov = window.__alpenQAFov; __alpen.camera.updateProjectionMatrix(); delete window.__alpenQAFov; }
    }).catch(() => {});
  }
}
try {
  const profiles = compare ? [
    { name: 'before', baseline: true, viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 },
    { name: 'after', baseline: false, viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 },
  ] : [
    { name: 'desktop', viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 },
    { name: 'portrait', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { name: 'landscape', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ].filter(profile => !process.env.ALPEN_QA_PROFILE || profile.name === process.env.ALPEN_QA_PROFILE);
  assert(profiles.length, 'valid ALPEN_QA_PROFILE');
  for (const profile of profiles) {
    const { name, baseline, ...options } = profile;
    const page = await browser.newPage(options);
    page.setDefaultTimeout(180000);
    let engineRequests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/assets/vendor/three/three.module.min.js') engineRequests++; });
    page.on('pageerror', error => { errors.push(error.message); console.error(profile.name + ': ' + error.message); });
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(profile.name + ': ' + message.text()); } });
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await fixedWeather(page);
      if (compare) {
        await page.route(/\/fun\/alpen\/js\/(config|terrain|backdrop)\.js$/, async route => {
          const file = new URL(route.request().url()).pathname.split('/').pop();
          let body = baseline ? await readFile(process.env.ALPEN_DETAIL_BASE + '/' + file, 'utf8') : await (await route.fetch()).text();
          if (file === 'config.js') {
            assert.equal(body.split('minScale: 0.55').length, 2, 'fixed art quality anchor');
            body = body.replace('minScale: 0.55', 'minScale: 1.0');
          }
          await route.fulfill({ status: 200, contentType: 'text/javascript', body });
        });
        await page.route('**/fun/alpen/js/sky.js', async route => {
          const response = await route.fetch(); let body = await response.text();
          assert.equal(body.split('    time += dt;').length, 2, 'sky clock anchor');
          body = body.replace('    time += dt;', '    time = 0;');
          for (const axis of ['x', 'y']) {
            const from = axis === 'x'
              ? '    mistDrift.x = (mistDrift.x - w.windX * MIST.drift * mistCell.x * dt) % 1;'
              : '    mistDrift.y = (mistDrift.y - w.windZ * MIST.drift * mistCell.y * dt) % 1;';
            assert.equal(body.split(from).length, 2, 'mist clock anchor ' + axis);
            body = body.replace(from, '    mistDrift.' + axis + ' = 0;');
          }
          await route.fulfill({ response, body });
        });
      }
      const started = Date.now();
      await page.goto(url.href);
      await page.waitForFunction(() => window.__alpen && document.body.classList.contains('ready'));
      const backdropReady = await page.evaluate(async () => { await __alpen.terrain.surfacesReady; return await __alpen.sky.backdropReady; });
      assert.equal(backdropReady, true, 'the real backdrop asset and maps load');
      const bootMs = Date.now() - started;
      assert.equal(await page.locator('link[rel="modulepreload"][href="/assets/vendor/three/three.module.min.js"]').count(), 1, 'the engine preload hint is present');
      assert.equal(engineRequests, 1, 'the engine preload is reused by the module graph');
      console.log('Alpen boot ready: ' + profile.name + ' in ' + bootMs + ' ms');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), profile.name + ': no horizontal overflow');
      const dropInArrow = page.locator('.drop-in svg.drop-in-arrow');
      assert.equal(await dropInArrow.count(), 1, 'the title action uses one font-independent arrow');
      assert(await dropInArrow.isVisible(), 'the title arrow is visible before starting');
      const arrowSize = await dropInArrow.boundingBox();
      assert(arrowSize && arrowSize.width > 0 && arrowSize.height > 0, 'the title arrow has visible geometry');
      await checkMotionPreference(page);
      await checkGrabAdvice(page);
      if (compare) {
        await page.addStyleTag({ content: '.hud,.curtain,.pad{visibility:hidden!important}' });
        const views = [
          { name: 'left-hill', z: -4000, eye: [52.07279175266581, -1311.6511189713717, -3988],
            target: [-273.44932540594704, -1226.8189892047455, -4140], fov: 50,
            crops: [{ name: 'face', x: 300, y: 130, width: 500, height: 320 }] },
          { name: 'right-hill', z: -4000, eye: [52.07279175266581, -1311.6511189713717, -3988],
            target: [246.55067459405296, -1270.6815900709014, -4140], fov: 50,
            crops: [{ name: 'face', x: 300, y: 130, width: 500, height: 320 }] },
          { name: 'far-range', z: -600, eye: [-47.435249363342265, -207.46813160112265, -588],
            target: [57.2366631225454, -137.6265926176272, -2585.2590695091477], fov: 35,
            crops: [{ name: 'horn', x: 0, y: 120, width: 400, height: 320 },
              { name: 'massif', x: 700, y: 120, width: 400, height: 320 }] },
        ];
        for (const view of views) await capture(page, name + '-' + view.name, view.z, .48, 0, null, view);
        if (!baseline) {
          const view = views.find(v => v.name === 'far-range');
          const modelDetail = await page.evaluate(async view =>
            (await import('./tests/backdrop-crags-browser-check.mjs')).inspectBackdropModel(__alpen, view), view);
          results.push({ modelDetail });
          console.log('ALPEN_MODEL_DETAIL ' + JSON.stringify(modelDetail));
          assert(modelDetail.every(r => r.pixels > 1000 && r.changedFraction > .1 && r.largest >= 3),
            'actual horn and massif faces show final-color detail');
        }
        assert.deepEqual(errors, [], 'paired art captures remain error-free');
        console.log('Alpen paired detail captures passed: ' + name);
        continue;
      }
      if (profile.name === 'desktop') {
        await checkControllerWithoutRaster(page, profile.name, async () => {
          await checkControllerStart(page);
          await checkPausedKeyboardCharge(page);
        });
      } else {
        await checkInputDevice(page, 'touch');
        await checkMenuHelp(page, 'touch');
        await page.keyboard.press('Tab');
        await checkInputDevice(page, 'keyboard');
        await checkMenuHelp(page, 'keyboard');
        await checkTouchHelpTap(page, 'attract');
        await page.locator('.drop-in').tap();
        await page.waitForFunction(() => __alpen.game.mode === 'playing');
        await checkControllerWithoutRaster(page, profile.name, () => checkTouchControllerMenu(page, profile.name));
      }
      await page.waitForFunction(() => __alpen.game.mode === 'playing');
      if (profile.hasTouch) await checkTouchControls(page);
      console.log('Alpen title input guidance passed: ' + profile.name);
      await page.keyboard.down('KeyD');
      await checkInputDevice(page, 'keyboard');
      await page.waitForFunction(() => __alpen.input.state.turnIntent > 0);
      await page.keyboard.up('KeyD');
      await page.waitForFunction(() => __alpen.input.state.turnIntent === 0);
      await page.keyboard.down('Space');
      await page.waitForFunction(() => __alpen.rider.charging && __alpen.input.state.jump);
      if (profile.hasTouch) {
        const session = await page.context().newCDPSession(page);
        const button = await page.locator('[data-key=jump]').boundingBox();
        assert(button && button.width >= 44 && button.height >= 44, 'usable Jump target');
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2, id: 7 }] });
        await checkInputDevice(page, 'touch');
        await page.keyboard.up('Space'); await frames(page, 3);
        assert(await page.evaluate(() => __alpen.input.state.jump), 'touch preserves a keyboard charge');
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => !__alpen.input.state.jump);
        await session.detach();
        await checkTouchControls(page);
      } else {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        assert.equal(await page.evaluate(() => __alpen.rider.charging), false, 'blur cancels stored charge');
        await page.keyboard.up('Space');
        await page.locator('.drop-in').click();
        // Observe a playing HUD frame between blur/resume/pause. Otherwise a
        // slow renderer can coalesce both transitions and retain button focus.
        await page.waitForFunction(() => __alpen.game.mode === 'playing');
        await frames(page, 1);
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => __alpen.game.mode === 'paused');
      await checkPausedHelp(page, !!profile.hasTouch, profile.name);
      if (profile.name === 'desktop') {
        const pausedFrames = await page.evaluate(async () => {
          const a = __alpen, original = a.renderer.render;
          let submissions = 0, worlds = 0;
          a.renderer.render = function(scene, camera) {
            submissions++; if (scene === a.scene) worlds++;
            return original.call(this, scene, camera);
          };
          a.retro.crash(.6);
          const samples = [];
          try {
            for (let frame = 0; frame < 5; frame++) {
              submissions = 0; worlds = 0;
              await new Promise(resolve => requestAnimationFrame(resolve));
              samples.push({ submissions, worlds });
            }
          } finally {
            a.renderer.render = original;
            a.retro.updateEffects(5, false);
            a.retro.updateEffects(5, false);
          }
          return samples;
        });
        assert(pausedFrames.slice(1).every(frame => frame.submissions === 1 && frame.worlds === 0),
          'continued paused fades draw only the final composite');
        results.push({ pausedFrames });
        console.log('Alpen paused frame submissions: ' + JSON.stringify(pausedFrames));
        await page.evaluate(() => { __alpen.game.discoveredGrabs.add(0); });
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => __alpen.game.mode === 'playing');
        assert.equal(await page.evaluate(() => __alpen.game.discoveredGrabs.size), 0,
          'Enter on the focused pause restart starts a fresh run');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => __alpen.game.mode === 'paused');
      }
      await page.locator('.drop-in').click();
      await page.waitForFunction(() => __alpen.game.mode === 'playing');
      if (profile.hasTouch) await checkTouchControls(page);
      if (profile.name === 'desktop') {
        const rewards = await page.evaluate(async () => {
          const a = __alpen;
          const { RIDER } = await import('./js/config.js');
          const { CLEAN } = await import('./js/rider.js');
          const { scoreTrick } = await import('./js/flow.js');
          a.game.discoveredGrabs.clear(); a.game.recentTricks.length = 0;
          const s = { judged: true, verdict: CLEAN, halfTurns: 1, flipTurns: 0,
            spin: 3, flips: 0, grabKind: 0, grabTime: RIDER.grabHold[0] + .2,
            airTime: 1, switchStance: false, takeoffSpeed: 18, lipPop: false, impact: 0 };
          const base = scoreTrick(s).points, payouts = [];
          for (let index = 0; index < 2; index++) {
            const before = a.game.score, combo = a.game.combo;
            a.rider.emit('land', s);
            payouts.push((a.game.score - before) / combo);
          }
          return { base, payouts, discovered: [...a.game.discoveredGrabs] };
        });
        assert(Math.abs(rewards.payouts[0] - rewards.base * 1.12) < 1e-7, 'first grab premium reaches real landing score');
        assert(Math.abs(rewards.payouts[1] - rewards.base) < 1e-7, 'repeated grab has no discovery premium');
        await page.keyboard.press('KeyR');
        assert.equal(await page.evaluate(() => __alpen.game.discoveredGrabs.size), 0, 'real restart clears grab discoveries');
      }
      results.push({ profile: profile.name, bootMs, engineRequests, gameplay: 'passed' });
      console.log('Alpen gameplay passed: ' + profile.name);
      if (controlsOnly) {
        assert.deepEqual(errors, [], 'controls-only run has no runtime, shader or resource errors');
        results.push({ profile: profile.name, controlsOnly: true, renderedScenes: 'skipped', gpuChecks: 'skipped' });
        console.log('Alpen controls-only profile passed: ' + profile.name);
        continue;
      }
      await page.addStyleTag({ content: '.hud,.curtain,.pad{visibility:hidden!important}' });
      const locations = await page.evaluate(async () => {
        const { chapterNameAt } = await import('./js/terrain.js');
        const found = [], names = new Set();
        for (let block = 0; block < 15 && found.length < 3; block++) {
          const z = -(block * 1700 + 600), name = chapterNameAt(z);
          if (!names.has(name)) { names.add(name); found.push({ z, name }); }
        }
        return found;
      });
      assert.equal(locations.length, 3, 'the fixed seed exposes three distinct terrain chapters');
      await capture(page, profile.name + '-clear', locations[0].z, .48, 0);
      if (profile.name === 'desktop') {
        for (let index = 1; index < locations.length; index++) await capture(page, 'chapter-' + index, locations[index].z, .48, 0);
        const bulges = await page.evaluate(async () => {
          const { sideHitsIn } = await import('./js/terrain.js');
          const hits = sideHitsIn(-8000, -100);
          return ['roller', 'drift', 'windlip'].map(shape => hits.find(hit => hit.shape === shape)).filter(Boolean);
        });
        assert.equal(bulges.length, 3, 'the preview seed exposes three distinct bulge shapes');
        for (const hit of bulges) await capture(page, 'bulge-' + hit.shape,
          hit.z + hit.face + 3, .48, 0, hit);
        await capture(page, 'dusk', locations[0].z, .79, 0);
        await capture(page, 'blizzard', locations[0].z, .48, 1);
        const checks = await page.evaluate(async () => ({
          depth: await (await import('./tests/post-depth-browser-check.mjs')).runPostDepthCheck(),
          hdr: await (await import('./tests/post-hdr-browser-check.mjs')).runPostHdrCheck(),
          smokeProjection: (await import('./tests/smoke-projection-browser-check.mjs')).runSmokeProjectionCheck(),
          audio: await (await import('./tests/audio-browser-check.mjs')).runAudioCheck(),
          timing: await (await import('./tests/gpu-timing-browser-check.mjs')).runGpuTimingCheck(),
          paused: await (await import('./tests/paused-composite-browser-check.mjs')).runPausedCompositeCheck(),
          crags: await (await import('./tests/backdrop-crags-browser-check.mjs')).runBackdropCragCheck(),
          backdropDetail: await (await import('./tests/backdrop-detail-browser-check.mjs')).runBackdropDetailCheck(),
          backdropFiltering: await (await import('./tests/backdrop-performance-browser-check.mjs')).runBackdropPerformanceCheck(),
        }));
        if (timerChecks) assert.equal(checks.timing.skipped, false, 'requested native GPU timing coverage is available');
        results.push({ gpuChecks: checks });
        console.log('Alpen GPU checks: ' + JSON.stringify(checks));
      }
      assert.deepEqual(errors, [], 'no runtime, shader or resource errors');
      console.log('Alpen profile passed: ' + profile.name);
    } catch (error) {
      await page.screenshot({ path: output + '/' + profile.name + '-failure.png', timeout: 10000 }).catch(() => {});
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(output + '/results.json', JSON.stringify(results, null, 2));
  console.log('Alpen browser QA passed: ' + profiles.map(profile => profile.name).join(', ')
    + (controlsOnly ? '; boot and controls; scene captures and GPU suites skipped.'
      : '; boot, controls and rendered scenes' + (profiles.some(profile => profile.name === 'desktop') ? ', grab rewards, chapters, weather and GPU postprocessing.' : '.')));
} finally { await browser.close(); }
