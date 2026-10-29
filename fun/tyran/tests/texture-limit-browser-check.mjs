// Constrain reported hardware capabilities before the game creates its renderer.
import assert from 'node:assert/strict';
import { chromiumOptions } from './browser-options.mjs';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch(chromiumOptions());
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('tyran-muted', 'true');
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      return parameter === this.MAX_TEXTURE_SIZE ? 4096 : original.call(this, parameter);
    };
  });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  const sample = () => page.evaluate(() => {
    const w = tyran.world;
    return { backend: tyran.renderer.backend, usable: w.gpu?.usable, limit: w.gpu?.maxTextureSize,
      preferred: w.preferredDetailScale, detail: w.detailScale,
      strips: [...w.tiles.values(), ...w.sceneryLayers[0].values()].map(canvas => [canvas.width, canvas.height]) };
  });
  const check = (result, density) => {
    assert.equal(result.limit, 4096); assert.equal(result.backend, 'webgl2'); assert.equal(result.usable, true);
    assert.equal(result.preferred, 2); assert.equal(result.detail, density); assert(result.strips.length);
    assert(result.strips.every(([width, height]) => width <= 4096 && height <= 4096), 'resident strips fit the device texture limit');
  };
  check(await sample(), 1);
  await page.evaluate(() => { tyran.adaptiveResolution = false; tyran.launch(0, null, false); tyran.state.director.hold = true; tyran.state.players[0].guard = 10000; });
  check(await sample(), 1);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForFunction(() => tyran.world.detailScale === 2 && tyran.world.tiles.size > 0 && tyran.world.sceneryLayers[0].size > 0);
  check(await sample(), 2);
  await page.setViewportSize({ width: 1000, height: 400 });
  await page.waitForFunction(() => tyran.world.detailScale === 1 && tyran.world.tiles.size > 0 && tyran.world.sceneryLayers[0].size > 0);
  check(await sample(), 1);
  assert.deepEqual(errors, []);
  console.log('Texture limit: startup, flight and resize preserve WebGL2 at 4096 pixels.');
} finally { await browser.close(); }
