// Start the static server: python3 -m http.server 8000
// Install Playwright and its browsers outside this repository, then run:
// PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright node fun/shared/tests/browser-check.mjs
// Optional: BASE_URL, BROWSERS=chromium,firefox,webkit, QA_SCREENSHOT_DIR.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { generate as zipper } from '../../zipper/js/puzzle.js';
import { generate as patcher } from '../../patcher/js/puzzle.js';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
const engines = (process.env.BROWSERS || 'chromium,firefox,webkit').split(',');
const screenshotDirectory = process.env.QA_SCREENSHOT_DIR;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const surfaces = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false, solve: true },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true, solve: true },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, touch: true, solve: false },
  { name: 'landscape', viewport: { width: 844, height: 390 }, touch: true, solve: false },
];
const report = [];
const failures = [];

async function progress(page) {
  return page.locator('[data-progress]').evaluate((node) => ({ value: node.value, max: node.max }));
}
async function expectProgress(page, expected) {
  await page.waitForFunction((value) => document.querySelector('[data-progress]').value === value, expected);
}
async function cellPoint(page, cell) {
  return page.locator('#stage').evaluate((canvas, index) => canvas.puzzleTest.cellPoint(index), cell);
}
async function tapCell(page, cell) {
  const point = await cellPoint(page, cell);
  await page.touchscreen.tap(point.x, point.y);
}
async function checkBounds(page, size) {
  // Wait for the camera to settle after changing the board size.
  await page.waitForTimeout(900);
  const bounds = await page.evaluate((n) => {
    const canvas = document.getElementById('stage');
    const cells = Array.from({ length: n * n }, (_, i) => canvas.puzzleTest.cellPoint(i));
    const top = document.querySelector('.hud-top').getBoundingClientRect();
    const bottom = document.querySelector('.hud-bottom').getBoundingClientRect();
    const controls = [...document.querySelectorAll('.hud button, .segmented')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { label: node.getAttribute('aria-label') || node.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return { cells, top: top.bottom, bottom: bottom.top, controls, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
  }, size);
  assert.ok(bounds.scrollWidth <= bounds.width + 1, 'the page must not overflow horizontally');
  for (const cell of bounds.cells) {
    assert.ok(Number.isFinite(cell.x) && Number.isFinite(cell.y), 'projected cells must stay finite');
    assert.ok(cell.x >= 0 && cell.x <= bounds.width, 'every cell remains horizontally visible');
    assert.ok(cell.y > bounds.top && cell.y < bounds.bottom, `cells stay between the controls (${cell.y}, ${bounds.top}–${bounds.bottom})`);
  }
  for (const control of bounds.controls) {
    assert.ok(control.left >= -1 && control.right <= bounds.width + 1 && control.top >= -1 && control.bottom <= bounds.height + 1,
      `${control.label} stays within the viewport`);
  }
}

async function playZipper(page, puzzle, touch) {
  const canvas = page.locator('#stage');
  await canvas.focus();
  await page.keyboard.press('Backspace');
  assert.equal((await progress(page)).value, 1, 'Backspace cannot remove the starting cell');
  const direction = (a, b) => b === a + 1 ? 'ArrowRight' : b === a - 1 ? 'ArrowLeft' : b > a ? 'ArrowDown' : 'ArrowUp';
  await page.keyboard.press(direction(puzzle.solution[0], puzzle.solution[1]));
  await expectProgress(page, 2);
  await page.locator('[data-action="undo"]').click();
  await expectProgress(page, 1);
  for (let i = 1; i < puzzle.solution.length; i++) {
    if (touch) await tapCell(page, puzzle.solution[i]);
    else await page.keyboard.press(direction(puzzle.solution[i - 1], puzzle.solution[i]));
  }
  await expectProgress(page, puzzle.size * puzzle.size);
}

async function playPatcher(page, puzzle, touch) {
  await page.locator('#stage').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal((await progress(page)).value, 0, 'cancelling the keyboard preview does not place a patch');
  let covered = 0;
  for (const patch of puzzle.solution) {
    const from = patch.y * puzzle.size + patch.x;
    const to = (patch.y + patch.h - 1) * puzzle.size + patch.x + patch.w - 1;
    if (touch) {
      await tapCell(page, from);
      if (from !== to) await tapCell(page, to);
    } else {
      const start = await cellPoint(page, from), end = await cellPoint(page, to);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      // Overshooting then shrinking must retain the final rectangle.
      const overshoot = await cellPoint(page, puzzle.size * puzzle.size - 1);
      await page.mouse.move(overshoot.x, overshoot.y, { steps: 2 });
      await page.mouse.move(end.x, end.y, { steps: 2 });
      await page.mouse.up();
    }
    covered += patch.w * patch.h;
    await expectProgress(page, covered);
  }
}

for (const name of engines) {
  const browserType = playwright[name];
  assert.ok(browserType, `unknown browser engine: ${name}`);
  let browser;
  try { browser = await browserType.launch({ headless: true }); }
  catch (error) { failures.push(`${name}: could not launch: ${error.message}`); console.error(failures.at(-1)); continue; }
  try {
    for (const surface of surfaces) {
      const context = await browser.newContext({
        viewport: surface.viewport, deviceScaleFactor: surface.touch ? 2 : 1,
        hasTouch: surface.touch,
        // Firefox supports touch and viewport emulation, but not isMobile.
        ...(name === 'firefox' ? {} : { isMobile: surface.touch }),
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      for (const game of ['zipper', 'patcher']) {
        const errors = [];
        const onError = (error) => errors.push(error.stack || error.message);
        const onConsole = (message) => { if (message.type() === 'error') errors.push(message.text()); };
        page.on('pageerror', onError); page.on('console', onConsole);
        try {
          const started = performance.now();
          await page.goto(`${base}/fun/${game}/#easy-alpha`, { waitUntil: 'networkidle' });
          await page.waitForFunction(() => document.body.classList.contains('ready'));
          const help = page.locator('[data-dialog="help"]');
          if (await help.evaluate((node) => node.open)) await help.locator('button[type="submit"]').click();
          await page.waitForFunction(() => !document.querySelector('[data-dialog="help"]').open);
          const coarse = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
          if (surface.touch) assert.ok(coarse, 'touch emulation must exercise the coarse-pointer renderer');
          assert.doesNotMatch(await page.locator('[data-world-name]').textContent(), /Loading|^$/i, 'the world name loads');
          assert.equal((await progress(page)).max, 25);
          const bootMs = Math.round(performance.now() - started);
          await checkBounds(page, 5);
          if (surface.solve) {
            const puzzle = (game === 'zipper' ? zipper : patcher)('easy', 'alpha');
            if (game === 'zipper') await playZipper(page, puzzle, surface.touch);
            else await playPatcher(page, puzzle, surface.touch);
            await page.locator('[data-dialog="win"][open]').waitFor();
            assert.equal(await page.locator('[data-status]').textContent(), 'Solved.');
            await page.locator('[data-action="stay"]').click();
            await page.locator('[data-action="reset"]').click();
            await expectProgress(page, game === 'zipper' ? 1 : 0);
          }
          await page.evaluate(() => { location.hash = '#hard-alpha'; });
          const hardSize = game === 'zipper' ? 7 : 9;
          await page.waitForFunction((total) => document.querySelector('[data-progress]').max === total, hardSize * hardSize);
          await checkBounds(page, hardSize);
          if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, `${name}-${game}-${surface.name}.png`) });
          assert.deepEqual(errors, [], `${game}: browser errors`);
          const result = `${name} · ${surface.name} · ${game}: ready in ${bootMs} ms, ${surface.solve ? 'solved and reset' : 'responsive bounds'}, hard ${hardSize}×${hardSize}, coarse=${coarse}`;
          report.push(result); console.log(result);
        } catch (error) {
          failures.push(`${name}/${surface.name}/${game}: ${error.stack || error.message}${errors.length ? `\nBrowser errors: ${errors.join('\n')}` : ''}`);
          console.error(failures.at(-1));
        } finally {
          page.off('pageerror', onError); page.off('console', onConsole);
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
}
console.log(`Browser checks: ${report.length} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
