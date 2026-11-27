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
  async function prepared() {
    await page.locator('#preflight').waitFor({ state: 'hidden' });
  }
  await prepared();
  assert.match(page.url(), /#small\/7$/);
  assert.deepEqual(await page.locator('#fort-size option').allTextContents(), ['Small', 'Medium', 'Large']);
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
  assert.ok(await player.evaluate((p) => p.paused));
  assert.deepEqual(await battlefield.boundingBox(), { x: 0, y: 0, width: 1440, height: 900 });

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
  assert.equal(await spent.textContent(), '0');
  await battlefield.dblclick({ position: { x: 850, y: 470 } });
  assert.equal(await spent.textContent(), '10', 'A double-click fires exactly one small stone');
  await page.locator('#fire-button').click();
  assert.equal(await spent.textContent(), '20');
  await page.locator('#restart-button').click();
  assert.match(page.url(), /#small\/7$/);
  assert.equal(await spent.textContent(), '0');

  await page.keyboard.press('6');
  await battlefield.dblclick({ position: { x: 800, y: 450 } });
  assert.equal(await spent.textContent(), '90', 'Double-click launches one siege bomb');
  await page.getByRole('button', { name: 'Detonate bomb' }).waitFor();
  await battlefield.click({ position: { x: 510, y: 360 } });
  await page.waitForFunction(() => !document.getElementById('state').textContent.includes('detonate'));
  assert.equal(await spent.textContent(), '90', 'Remote detonation costs no additional gold');
  await page.locator('#restart-button').click();
  const fireball = page.getByRole('button', { name: 'Fireball, 45 gold' });
  assert.equal(await page.locator('.ammo').count(), 6);
  await page.keyboard.press('5');
  assert.equal(await fireball.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Space');
  assert.equal(await spent.textContent(), '45');
  await page.locator('#restart-button').click();

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
    await page.locator('#new-button').click();
    assert.notEqual(page.url(), first);
    const second = page.url();
    await page.locator('#restart-button').click();
    assert.equal(page.url(), second);
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
  const shots = [
    [50, 86],
    [25, 59],
  ];
  for (const [angle, power] of shots) {
    await page.locator('#angle').fill(String(angle));
    await page.locator('#power').fill(String(power));
    await page.locator('#fire-button').click();
    if (angle === 50) {
      await page.waitForFunction(
        () => +document.querySelector('#destruction').textContent.replace('%', '') > 0,
      );
      // Let the first tower collapse before sending the shot beneath it.
      await page.waitForTimeout(4000);
    }
  }
  await page.getByRole('heading', { name: /has fallen/i }).waitFor({ timeout: 16000 });
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
  assert.equal(winningCost, 20);
  assert.equal(await page.locator('.result-score').textContent(), winningCost + ' gold');
  assert.match(await page.locator('#orcs').textContent(), /^0 \/ /);
  await page.locator('[data-replay]').click();
  assert.deepEqual(await player.evaluate((p) => [p.currentSrc, p.paused]), [nextTrack, false]);
  assert.match(await page.locator('#objective').textContent(), new RegExp('Best siege.*' + winningCost));
  await page.locator('#new-button').click();
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
  await page.locator('#new-button').click();
  assert.doesNotMatch(page.url(), /#small\/1$/);
  assert.doesNotMatch(await page.locator('#objective').textContent(), /Best siege/);

  await page.locator('#zoom-in').click();
  assert.equal(await page.locator('#zoom-fit').textContent(), '135%');
  await page.locator('#zoom-fit').click();
  await page.locator('#fold-controls').click();
  assert.equal(await page.locator('#siege-console').isVisible(), false);
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.ok(
      await page.locator('.ammo').evaluateAll((cards) =>
        cards.every((card) => {
          const rect = card.getBoundingClientRect(),
            name = card.querySelector('.ammo-name').getBoundingClientRect();
          return name.left >= rect.left && name.right <= rect.right;
        }),
      ),
      'All six ammunition names fit their controls',
    );
    const button = await page.locator('#fire-button').boundingBox();
    assert.ok(button.x >= 0 && button.x + button.width <= width + 1 && button.y + button.height <= height);
    if (width === 3840) {
      await page.waitForFunction(() => document.getElementById('scenery').naturalWidth === 3840);
      assert.equal(await page.locator('#panorama').evaluate((c) => c.height), 2160);
    }
  }
  assert.deepEqual(errors, []);
  await checkFortressAudio(page);
  await checkFallenTorch(page);
  await checkFireTransitions(page);
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await phone.goto(origin + '/fun/fortress/#large/6');
  await phone.locator('#preflight').waitFor({ state: 'hidden' });
  await phone.getByRole('button', { name: 'Siege bomb, 90 gold' }).tap();
  await phone.touchscreen.tap(240, 320);
  await phone.touchscreen.tap(240, 320);
  await phone.getByRole('button', { name: 'Detonate bomb' }).waitFor();
  assert.equal(await phone.locator('#spent').textContent(), '90');
  await phone.touchscreen.tap(220, 320);
  await phone.waitForFunction(() => !document.getElementById('state').textContent.includes('detonate'));
  assert.equal(await phone.locator('#spent').textContent(), '90', 'The third tap detonates the airborne bomb');
  await phone.close();
  console.log(
    'Fortress browser checks passed: material audio and stereo positioning, saved mute, offline play, playlist rotation through victory, volleys, seed-specific bests, mobile and native 4K.',
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
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
