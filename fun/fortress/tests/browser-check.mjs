// Exercise the public controls, including exact shot charges, seeded retries and the full-window projection.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { checkFortressAudio } from './audio-check.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(resolve(root) + sep)) throw new Error('path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) errors.push(response.url());
  });
  const oldLink = '/fun/fortress/#1/7/4/2/1/3';
  await page.goto(origin + oldLink);
  const spent = page.locator('#spent');
  const battlefield = page.locator('#battlefield');
  const sound = page.locator('#sound-button');
  const player = page.locator('#soundtrack');
  async function switchFortress(button) {
    await page.locator(button).click();
    await page.locator('main[aria-busy="true"]').waitFor({ state: 'detached' });
  }
  async function prepared() {
    await page.locator('#preflight').waitFor({ state: 'hidden' });
  }
  await prepared();
  assert.match(page.url(), /#small\/7$/);
  assert.deepEqual(await page.locator('#fort-size option').allTextContents(), ['Small', 'Medium', 'Large']);
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
  assert.ok(await player.evaluate((p) => p.paused));
  assert.deepEqual(await battlefield.boundingBox(), { x: 0, y: 0, width: 1440, height: 900 });

  function fieldProjection() {
    return battlefield.evaluate(async (canvas) => {
      await new Promise(requestAnimationFrame);
      const { a, d, e, f } = canvas.getContext('2d').getTransform();
      return [a, d, e, f];
    });
  }
  async function aimFromSling(angle, radius, expectedPower, side = 'left') {
    const point = await battlefield.evaluate(async (canvas, { angle, radius, side }) => {
      const { WORLD } = await import('./simulation.js');
      const origin = side === 'left' ? WORLD.release : WORLD.rightRelease;
      const direction = side === 'left' ? 1 : -1;
      const radians = angle * Math.PI / 180;
      const world = new DOMPoint(origin.x + direction * radius * Math.cos(radians), origin.y - radius * Math.sin(radians));
      const pixel = world.matrixTransform(canvas.getContext('2d').getTransform());
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x + pixel.x * rect.width / canvas.width, y: rect.y + pixel.y * rect.height / canvas.height };
    }, { angle, radius, side });
    await page.mouse.move(point.x, point.y);
    assert.equal(await battlefield.getAttribute('data-side'), side);
    assert.equal(await page.locator('#angle').inputValue(), String(angle));
    assert.equal(await page.locator('#power').inputValue(), String(expectedPower));
  }
  await aimFromSling(32, 160, 50);
  const startingView = await fieldProjection();
  await aimFromSling(32, 160, 50, 'right');
  await page.waitForFunction(() => document.querySelector('#aim-hint').dataset.side === 'right');
  assert.deepEqual(await fieldProjection(), startingView, 'Switching crews by mouse preserves the overview');
  assert.ok((await page.locator('#aim-hint').boundingBox()).x > 720, 'The mouse firing hint follows the right crew');
  await aimFromSling(32, 256, 80);
  await aimFromSling(52, 256, 80);
  const hint = page.locator('#aim-hint');
  await page.waitForFunction(() => document.querySelector('#aim-hint').dataset.side === 'left');
  assert.ok((await hint.boundingBox()).x < 320, 'The mouse firing hint returns to the left crew');
  assert.equal(await hint.textContent(), 'Click to fire');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual([await page.locator('#angle').inputValue(), await page.locator('#power').inputValue()], ['52', '79']);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual([await page.locator('#angle').inputValue(), await page.locator('#power').inputValue()], ['52', '80']);
  assert.match(await hint.textContent(), /← → Power.*↑ ↓ Angle.*Space to fire/);
  for (const physical of [true, false]) {
    for (const [i, key] of Array.from('+ěščřžý').entries()) {
      const code = physical ? 'Digit' + (i + 1) : 'Unidentified';
      await battlefield.dispatchEvent('keydown', { key, code, bubbles: true });
      assert.equal(await page.locator('.ammo').nth(i).getAttribute('aria-pressed'), 'true');
    }
  }
  await page.keyboard.press('Numpad2');
  assert.equal(await page.locator('.ammo').nth(1).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('1');
  assert.equal(await spent.textContent(), '0', 'Ammunition shortcuts select without firing');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.match(await hint.textContent(), /Space to fire/);
  await aimFromSling(47, 224, 70);
  assert.equal(await hint.textContent(), 'Click to fire');
  await page.locator('#zoom-in').click();
  await page.waitForFunction(() => document.getElementById('zoom-fit').textContent === '135%');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await aimFromSling(32, 160, 50);
  const manualView = await fieldProjection();
  await page.keyboard.press('d');
  assert.equal(await battlefield.getAttribute('data-side'), 'right');
  assert.deepEqual(await fieldProjection(), manualView, 'Keyboard crew selection retains a zoomed view');
  await page.mouse.move(350, 420);
  assert.equal(await battlefield.getAttribute('data-side'), 'left');
  assert.deepEqual(await fieldProjection(), manualView, 'Returning to the left crew preserves the zoom and pan');
  await page.locator('#zoom-fit').click();

  // The rest of this siege, its soundtrack and fresh forts in other realms must
  // work from the prepared session even with the network completely disconnected.
  const requests = [];
  page.on('request', (r) => {
    if (r.url().startsWith(origin + '/fun/fortress/')) requests.push(r.url());
  });
  await page.context().setOffline(true);
  await page.keyboard.press('1');
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 0.05);
  const trackURLs = new Set();
  for (let i = 0; i < 3; i++) {
    const src = await player.evaluate((p) => p.currentSrc);
    assert.match(src, /^blob:/);
    trackURLs.add(src);
    const duration = await player.evaluate((p) => p.duration);
    assert.ok(duration > 160 && duration < 190);
    await player.evaluate((p) => {
      p.currentTime = p.duration - 0.09;
    });
    await page.waitForFunction((old) => {
      const p = document.querySelector('audio');
      return p.currentSrc !== old && p.currentTime > 0.02;
    }, src);
  }
  assert.equal(trackURLs.size, 3);
  await page.locator('#help-button').click();
  assert.ok(await player.evaluate((p) => p.paused));
  await page.locator('#close-dialog').click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  assert.ok(await player.evaluate((p) => p.paused));
  await battlefield.click({ position: { x: 850, y: 470 } });
  assert.equal(await spent.textContent(), '10', 'One click fires one small stone');
  await page.locator('#fire-button').click();
  assert.equal(await spent.textContent(), '20');
  await switchFortress('#restart-button');
  assert.match(page.url(), /#small\/7$/);
  assert.equal(await spent.textContent(), '0');

  await page.keyboard.press('6');
  await battlefield.click({ position: { x: 800, y: 450 } });
  assert.equal(await spent.textContent(), '90', 'One click launches one siege bomb');
  await page.getByRole('button', { name: 'Detonate bomb' }).waitFor();
  assert.equal(await hint.textContent(), 'Click to detonate');
  await battlefield.click({ position: { x: 510, y: 360 } });
  assert.equal(await spent.textContent(), '180', 'The other crew can launch the same ammo while the first charge is armed');
  await page.keyboard.press('1');
  await page.getByRole('button', { name: 'Fire catapult' }).waitFor();
  await battlefield.click({ position: { x: 510, y: 360 } });
  assert.equal(await spent.textContent(), '190', 'An armed charge leaves normal shots available after reloading');
  await page.keyboard.press('6');
  await battlefield.click({ position: { x: 510, y: 360 } });
  await page.waitForFunction(() => !document.getElementById('state').textContent.includes('detonate'));
  await page.keyboard.press('KeyD');
  await page.getByRole('button', { name: 'Detonate bomb' }).waitFor();
  await page.keyboard.press('Space');
  assert.equal(await spent.textContent(), '190', 'Each crew activates its charge without additional gold');
  await switchFortress('#restart-button');
  await page.keyboard.press('7');
  await page.keyboard.press('KeyD');
  assert.equal(await battlefield.getAttribute('data-side'), 'right');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Activate implosion' }).waitFor();
  await page.keyboard.press('KeyA');
  await page.keyboard.press('6');
  assert.equal(await battlefield.getAttribute('data-side'), 'left');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Detonate bomb' }).waitFor();
  await page.keyboard.press('7');
  assert.equal(await page.getByRole('button', { name: 'Activate implosion' }).count(), 0);
  await page.keyboard.press('KeyD');
  await page.getByRole('button', { name: 'Activate implosion' }).waitFor();
  await battlefield.click({ position: { x: 920, y: 360 } });
  assert.equal(await page.getByRole('button', { name: 'Activate implosion' }).count(), 0);
  await page.keyboard.press('KeyA');
  await page.keyboard.press('6');
  await page.getByRole('button', { name: 'Detonate bomb' }).waitFor();
  await page.keyboard.press('Space');
  assert.equal(await spent.textContent(), '165', 'Both crews launched; each remote activated once for free');
  await switchFortress('#restart-button');
  const fireball = page.getByRole('button', { name: 'Fireball, 45 gold' });
  assert.equal(await page.locator('.ammo').count(), 7);
  await page.keyboard.press('5');
  assert.equal(await fireball.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Space');
  assert.equal(await spent.textContent(), '45');
  await switchFortress('#restart-button');

  const size = page.getByRole('combobox', { name: 'Fortress size' });
  for (const choice of ['medium', 'large', 'small']) {
    await size.selectOption(choice);
    await page.waitForFunction((choice) => location.hash.startsWith('#' + choice + '/'), choice);
    assert.equal(
      await page.locator('#size-label').textContent(),
      choice[0].toUpperCase() + choice.slice(1) + ' fortress',
    );
    assert.equal(await spent.textContent(), '0');
    const first = page.url();
    await switchFortress('#new-button');
    assert.notEqual(page.url(), first);
    const second = page.url();
    await switchFortress('#restart-button');
    assert.equal(page.url(), second);
  }
  // A late idle slice from a superseded size must never replace the requested seed.
  await size.selectOption('large');
  await page.evaluate(() => { location.hash = 'medium/6'; });
  await page.waitForFunction(() => location.hash === '#medium/6' &&
    document.querySelector('#size-label').textContent === 'Medium fortress' && !document.querySelector('main[aria-busy]'));
  for (const [seed, weather] of [['e', 'storm'], ['9', 'snow'], ['b', 'rain']]) {
    await page.evaluate((seed) => { location.hash = 'large/' + seed; }, seed);
    await page.waitForFunction((weather) =>
      document.body.dataset.weather === weather && document.querySelector('#weather-label').textContent === weather &&
      !document.querySelector('main[aria-busy]'), weather);
  }
  assert.deepEqual(
    requests,
    [],
    'No game asset requests during play, soundtrack changes, or fortress generation',
  );
  await page.context().setOffline(false);
  await page.reload();
  await prepared();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false', 'Mute survives a reload');
  await page.keyboard.press('1');
  assert.ok(await player.evaluate((p) => p.paused), 'A gameplay gesture respects stored mute');
  await sound.click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await page.evaluate(() => {
    location.hash = 'small/1';
  });
  await page.waitForFunction(() =>
    document.querySelector('#wind-label').textContent.includes('Strong headwind'),
  );
  // A low shot through the keep sets off its powder stores and clears the garrison.
  async function clearSmallKeep() {
    await page.keyboard.press('a');
    await page.keyboard.press('4');
    await page.locator('#angle').fill('30');
    await page.locator('#power').fill('94');
    await page.locator('#fire-button').click();
    await page.getByRole('heading', { name: /has fallen/i }).waitFor({ timeout: 16000 });
  }
  await clearSmallKeep();
  const victoryTrack = await player.evaluate((p) => {
    if (p.paused) throw new Error('The soundtrack stopped at victory');
    p.currentTime = p.duration - 0.09;
    return p.currentSrc;
  });
  await page.waitForFunction((previous) => {
    const p = document.querySelector('audio');
    return !p.paused && p.currentSrc !== previous && p.currentTime > 0.02;
  }, victoryTrack);
  const nextTrack = await player.evaluate((p) => p.currentSrc);
  const winningCost = +(await spent.textContent());
  assert.equal(winningCost, 60);
  const report = page.locator('#victory-report');
  assert.equal(await report.locator('#victory-cost').textContent(), winningCost + ' gold');
  assert.ok(await report.isVisible());
  assert.ok((await report.boundingBox()).y < 160);
  for (const name of ['New fortress', 'Try cheaper']) {
    const action = report.getByRole('button', { name });
    assert.ok(await action.isVisible());
    assert.ok(await action.evaluate((button) => {
      const r = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }), 'The victory actions accept clicks beside the report');
  }
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.keyboard.press('6');
  await page.keyboard.press('Space');
  assert.equal(+(await spent.textContent()), winningCost + 90);
  await page.getByRole('button', {name: 'Detonate bomb'}).waitFor();
  await battlefield.click({ position: { x: 620, y: 440 } });
  assert.equal(await report.locator('#victory-cost').textContent(), winningCost + ' gold');
  assert.ok(await report.isVisible(), 'Further demolition leaves the victory report visible');
  await page.getByRole('button', {name: 'Dismiss victory report'}).click();
  assert.ok(await report.isHidden());

  assert.match(await page.locator('#orcs').textContent(), /^0 \/ /);
  await switchFortress('#restart-button');
  assert.deepEqual(await player.evaluate((p) => [p.currentSrc, p.paused]), [nextTrack, false]);
  assert.match(await page.locator('#objective').textContent(), new RegExp('Best siege.*' + winningCost));
  await clearSmallKeep();
  await switchFortress('#victory-retry');
  assert.match(page.url(), /#small\/1$/);
  assert.equal(await spent.textContent(), '0');
  assert.match(await page.locator('#objective').textContent(), new RegExp('Best siege.*' + winningCost));
  await clearSmallKeep();
  await switchFortress('#victory-new');
  assert.doesNotMatch(page.url(), /#small\/1$/);
  assert.deepEqual(await player.evaluate((p) => [p.currentSrc, p.paused]), [nextTrack, false]);
  await page.evaluate(() => {
    location.hash = 'small/1';
  });
  await page.waitForFunction(
    () =>
      location.hash === '#small/1' && document.querySelector('#objective').textContent.includes('Best siege'),
  );
  await page.reload();
  await prepared();
  assert.match(await page.locator('#objective').textContent(), new RegExp('Best siege.*' + winningCost));
  await switchFortress('#new-button');
  assert.doesNotMatch(page.url(), /#small\/1$/);
  assert.doesNotMatch(await page.locator('#objective').textContent(), /Best siege/);

  await page.locator('#zoom-in').click();
  assert.equal(await page.locator('#zoom-fit').textContent(), '135%');
  await page.locator('#zoom-fit').click();
  await page.locator('#fold-controls').click();
  assert.equal(await page.locator('#siege-console').isVisible(), false);
  assert.equal(await hint.isVisible(), true);
  assert.equal(await hint.textContent(), 'Click to fire');
  await page.locator('#fold-controls').click();
  for (const [width, height] of [
    [320, 700],
    [390, 844],
    [620, 900],
    [812, 375],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(
      ([w, h]) => {
        const field = document.getElementById('battlefield');
        return field.width === w && field.height === h;
      },
      [width, height],
    );
    assert.deepEqual(await battlefield.boundingBox(), { x: 0, y: 0, width, height });
    assert.ok(await battlefield.evaluate(async (canvas) => {
      const { WORLD } = await import('./simulation.js');
      const transform = canvas.getContext('2d').getTransform();
      const left = new DOMPoint(WORLD.release.x - 136, WORLD.ground).matrixTransform(transform);
      const right = new DOMPoint(WORLD.rightRelease.x + 136, WORLD.ground).matrixTransform(transform);
      return left.x >= 0 && right.x <= canvas.width && left.y > 0 && left.y < canvas.height;
    }), 'The overview includes both catapult crews');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.ok(await page.locator('.tools').evaluate((nav) => {
      const score = document.querySelector('.briefing').getBoundingClientRect();
      const buttons = Array.from(nav.querySelectorAll('select, button')).filter((button) => !button.hidden);
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      return boxes.every((rect, i) => rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth &&
        rect.bottom <= score.top && boxes.every((other, j) => i === j || rect.right <= other.left ||
          rect.left >= other.right || rect.bottom <= other.top || rect.top >= other.bottom));
    }), 'Every top toolbar control fits above the score and has its own hit area');
    assert.ok(
      await page.locator('.ammo').evaluateAll((cards) =>
        cards.every((card) => {
          const rect = card.getBoundingClientRect(),
            name = card.querySelector('.ammo-name').getBoundingClientRect();
          return name.left >= rect.left && name.right <= rect.right;
        }),
      ),
      'All seven ammunition names fit their controls',
    );
    const button = await page.locator('#fire-button').boundingBox();
    assert.ok(button.x >= 0 && button.x + button.width <= width + 1 && button.y + button.height <= height);
    const state = await page.locator('#state').boundingBox();
    assert.ok(state.y + state.height <= button.y + 1 && Math.abs(state.x + state.width / 2 - button.x - button.width / 2) < 2,
      'Readiness is centered above the fire button');
    if (width === 3840) {
      await page.waitForFunction(() => document.getElementById('scenery').naturalWidth === 3840);
      assert.equal(await page.locator('#panorama').evaluate((c) => c.height), 2160);
    }
  }
  assert.deepEqual(errors, []);
  await checkFortressAudio(page);
  await checkAimGuide(page);
  await checkFallenTorch(page);
  await checkFlankTerrain(page);
  await checkFireTransitions(page);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.goto(origin + '/fun/fortress/#large/6');
  await phone.locator('#preflight').waitFor({ state: 'hidden' });
  assert.equal(await phone.locator('#aim-hint').textContent(), 'Tap to fire');
  await phone.getByRole('button', { name: 'Siege bomb, 90 gold' }).tap();
  await phone.touchscreen.tap(240, 320);
  await phone.getByRole('button', { name: 'Detonate bomb' }).waitFor();
  await phone.waitForFunction(() => document.querySelector('#aim-hint').dataset.side === 'right');
  assert.equal(await phone.locator('#aim-hint').textContent(), 'Tap to detonate');
  assert.equal(await phone.locator('#spent').textContent(), '90');
  await phone.touchscreen.tap(145, 320);
  assert.equal(await phone.locator('#spent').textContent(), '180', 'One tap fires the opposite loaded crew');
  await phone.touchscreen.tap(220, 320);
  await phone.waitForFunction(() => !document.getElementById('state').textContent.includes('detonate'));
  await phone.touchscreen.tap(145, 320);
  assert.ok(!(await phone.locator('#state').textContent()).includes('detonate'));
  assert.equal(await phone.locator('#spent').textContent(), '180', 'A tap on each side triggers only its crew’s airborne bomb');
  await phone.close();
  console.log(
    'Fortress browser checks passed: material audio and stereo positioning, saved mute, offline play, playlist rotation through victory, volleys, seed-specific bests, mobile and native 4K.',
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}

async function checkAimGuide(page) {
  const spans = await page.evaluate(async () => {
    const { createRenderer } = await import('./renderer.js');
    const { FortressSimulation, WORLD } = await import('./simulation.js');
    const sim = new FortressSimulation('small', 1);
    for (const piece of sim.bodies) sim.remove(piece);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const renderer = createRenderer(canvas);
    const view = { x: WORLD.minX, y: -230, width: WORLD.maxX - WORLD.minX, height: 696 };
    const frame = { angle: 38, power: 87, time: 0, reducedMotion: true, scenery: {}, view };
    const read = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return ['left', 'right'].map((side) => {
      sim.selectSide(side);
      renderer.draw(sim, { ...frame, aiming: false });
      const baseline = read();
      renderer.draw(sim, frame);
      const guide = read();
      let near = Infinity, far = -Infinity;
      for (let i = 0; i < guide.length; i += 4) {
        if (Math.abs(guide[i] - baseline[i]) < 45 && Math.abs(guide[i + 3] - baseline[i + 3]) < 45) continue;
        const x = view.x + (i / 4 % canvas.width) * view.width / canvas.width;
        const downrange = (x - sim.release.x) * (side === 'left' ? 1 : -1);
        near = Math.min(near, downrange);
        far = Math.max(far, downrange);
      }
      return { near, far };
    });
  });
  for (const { near, far } of spans) {
    assert.ok(Math.abs(near) < 12, 'The visible guide begins at the selected sling');
    assert.ok(far > 490 && far < 810, 'The extended guide projects inward from that crew alone');
  }
}

async function checkFallenTorch(page) {
  const bounds = await page.evaluate(async () => {
    const { createRenderer } = await import('./renderer.js');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const r = createRenderer(canvas);
    const terrain = [
      { x: 0, y: 389 },
      { x: 1200, y: 389 },
    ];
    const test = {
      bodies: [],
      level: { phase: 'day', terrain, sections: [] },
      themeIndex: 1,
      terrain,
      stats: { ready: false, reloadRemaining: 0 },
      terrainHeight: () => 389,
    };
    const frame = {
      time: 0,
      aiming: false,
      reducedMotion: true,
      scenery: {},
      view: { x: 0, y: 0, width: 1200, height: 480 },
    };
    r.draw(test, frame);
    const pixels = () => new Uint32Array(ctx.getImageData(580, 100, 185, 185).data.buffer);
    const before = pixels();
    // The extinguished wick last burned far above its fallen and rotated fixture.
    test.bodies.push({
      kind: 'torch',
      id: 1,
      x: 750,
      y: 265,
      angle: Math.PI / 2,
      width: 5,
      height: 12,
      lit: false,
      flameX: 600,
      flameY: 120,
    });
    r.draw(test, frame);
    const after = pixels();
    let left = 1200,
      right = 0,
      top = 480,
      bottom = 0;
    for (let i = 0; i < after.length; i++) {
      if (after[i] === before[i]) continue;
      const x = 580 + (i % 185),
        y = 100 + Math.floor(i / 185);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return { left, right, top, bottom };
  });
  assert.ok(
    bounds.left >= 741 && bounds.right <= 759 && bounds.right - bounds.left >= 9,
    'Fallen shaft retains its length around the body',
  );
  assert.ok(
    bounds.top >= 260 && bounds.bottom <= 270,
    'Fallen fixture rotates in place after losing its flame',
  );
}

async function checkFlankTerrain(page) {
  const samples = await page.evaluate(async () => {
    const { FortressSimulation, WORLD } = await import('./simulation.js');
    const { paintTerrain } = await import('./terrain.js');
    const sim = new FortressSimulation('small', 11);
    const image = document.getElementById('scenery');
    const probes = [-40, 1340, 1515];
    const original = paintTerrain(sim.terrain, image, sim.level.phase);
    function sample(paint, x, y) {
      const px = Math.round((x - paint.left) * paint.canvas.width / paint.width);
      const py = Math.round((y - paint.top) * paint.canvas.height / paint.height);
      return [...paint.canvas.getContext('2d').getImageData(px, py, 1, 1).data];
    }
    const turf = probes.map((x) => sample(original, x, WORLD.ground + 2));
    for (const x of probes) sim.excavate({ x, y: sim.terrainHeight(x) - 3 }, 120);
    const cut = paintTerrain(sim.terrain, image, sim.level.phase, original, sim.level.terrain);
    return probes.map((x, i) => ({
      turf: turf[i],
      lip: sample(cut, x, WORLD.ground + 4),
      bedrock: sample(cut, x, WORLD.ground + 21),
      depth: sim.terrainHeight(x) - WORLD.ground,
    }));
  });
  for (const { turf, lip, bedrock, depth } of samples) {
    assert.ok(turf[3] > 225 && depth > 25, 'Both flanks have solid turf that bombs can excavate');
    assert.ok(lip[3] > 235 && bedrock[3] > 235, 'Earth and rock textures cover the flank crater');
    assert.notDeepEqual(lip.slice(0, 3), bedrock.slice(0, 3));
  }
}

async function checkFireTransitions(page) {
  const brightness = await page.evaluate(async () => {
    const { createEffects } = await import('./effects.js');
    const effects = createEffects();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const timber = { id: 7, kind: 'block', burning: true, ignitedAt: 0, burn: 0, x: 48, y: 55, angle: 0, height: 12, width: 30 };
    const brightness = (age, burn) => {
      timber.burn = burn;
      ctx.clearRect(0, 0, 96, 96);
      effects.update([], [timber], 0, age, true, 1, 'night', [], 0, age);
      effects.drawFront(ctx);
      const data = ctx.getImageData(0, 0, 96, 96).data;
      let sum = 0;
      for (let i = 3; i < data.length; i += 4) sum += data[i];
      return sum;
    };
    return [brightness(0, 0), brightness(0.15, 0.02), brightness(1, 0.3), brightness(6, 0.85), brightness(7, 1)];
  });
  const [first, lighting, burning, dying, last] = brightness;
  assert.equal(first, 0);
  assert.ok(lighting > first && lighting < burning);
  assert.ok(dying > last && dying < burning);
  assert.equal(last, 0, 'Flame and cast light both fade out before the timber disappears');
}
