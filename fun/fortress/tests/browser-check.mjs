// Exercise the public controls, including exact shot charges, seeded retries and the full-window projection.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
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
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  assert.ok(await player.evaluate((p) => p.paused));
  assert.deepEqual(await battlefield.boundingBox(), { x: 0, y: 0, width: 1440, height: 900 });

  // The rest of this siege, its soundtrack and fresh forts in other realms must
  // work from the prepared session even with the network completely disconnected.
  const requests = [];
  page.on('request', (r) => {
    if (r.url().startsWith(origin + '/fun/fortress/')) requests.push(r.url());
  });
  await page.context().setOffline(true);
  await sound.click();
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
  assert.deepEqual(requests, [], 'No game asset requests during play, soundtrack changes, or fortress generation');
  await page.context().setOffline(false);
  await page.evaluate(() => {
    location.hash = 'small/1';
  });
  await page.waitForFunction(() => document.querySelector('#wind-label').textContent.includes('Strong headwind'));
  const shots = [
    [50, 86],
    [25, 59],
  ];
  for (const [angle, power] of shots) {
    await page.locator('#angle').fill(String(angle));
    await page.locator('#power').fill(String(power));
    await page.locator('#fire-button').click();
    if (angle === 50) {
      await page.waitForFunction(() => +document.querySelector('#destruction').textContent.replace('%', '') > 0);
      // Let the first tower collapse before sending the shot beneath it.
      await page.waitForTimeout(4000);
    }
  }
  await page.getByRole('heading', { name: /has fallen/i }).waitFor({ timeout: 16000 });
  const winningCost = +(await spent.textContent());
  assert.equal(winningCost, 20);
  assert.equal(await page.locator('.result-score').textContent(), winningCost + ' gold');
  assert.match(await page.locator('#orcs').textContent(), /^0 \/ /);
  await page.locator('[data-replay]').click();
  assert.match(await page.locator('#objective').textContent(), new RegExp('Best siege.*' + winningCost));
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
    [390, 844],
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
    const button = await page.locator('#fire-button').boundingBox();
    assert.ok(button.x >= 0 && button.x + button.width <= width + 1 && button.y + button.height <= height);
    if (width === 3840) {
      await page.waitForFunction(() => document.getElementById('scenery').naturalWidth === 3840);
      assert.equal(await page.locator('#panorama').evaluate((c) => c.height), 2160);
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Fortress browser checks passed: quiet playlist, offline play and track changes, volleys, victory, seed-specific bests, size selection, mobile and native 4K.',
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
