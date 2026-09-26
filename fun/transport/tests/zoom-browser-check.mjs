// Serve the repository root first. Override TRANSPORT_URL / TRANSPORT_PLAYWRIGHT if needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-zoom-qa';
const views = [[.5, 'region'], [1, 'town'], [2, 'detail']];
await mkdir(output, { recursive: true });
const errors = [];
const summaries = [];
const cameraZoom = page => page.evaluate(() => transport.renderer.getCamera().zoom);
const chooseView = (page, zoom) => page.locator(`[data-zoom-level="${zoom}"]`).click();
try {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.waitForFunction(() => window.transport?.renderer?.setZoom);
    await page.locator('[data-speed="0"]').click();
    assert.equal(await page.locator('[data-zoom-level]').count(), 3, 'the interface exposes exactly three view presets');
    for (const [zoom, name] of views) {
      await chooseView(page, zoom);
      assert.equal(await cameraZoom(page), zoom);
      assert.equal(await page.locator(`[data-zoom-level="${zoom}"]`).getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: `${output}/desktop-dpr${deviceScaleFactor}-${name}.png` });
    }

    if (deviceScaleFactor === 1) {
      // Each user input follows the same bounded three-view ladder.
      await chooseView(page, .5);
      assert.equal(await page.locator('#zoom-out').isDisabled(), true);
      await page.locator('#zoom-in').click();
      assert.equal(await cameraZoom(page), 1);
      await page.locator('#zoom-in').click();
      assert.equal(await cameraZoom(page), 2);
      assert.equal(await page.locator('#zoom-in').isDisabled(), true);
      await page.keyboard.press('-');
      assert.equal(await cameraZoom(page), 1);
      await page.keyboard.press('-');
      assert.equal(await cameraZoom(page), .5);
      await page.keyboard.press('-');
      assert.equal(await cameraZoom(page), .5);
      await page.keyboard.press('+');
      assert.equal(await cameraZoom(page), 1);
      await page.keyboard.press('=');
      assert.equal(await cameraZoom(page), 2);
      await page.keyboard.press('=');
      assert.equal(await cameraZoom(page), 2);
      await page.locator('#zoom-out').click();
      assert.equal(await cameraZoom(page), 1);

      const rect = await page.locator('#world').boundingBox();
      const pointer = { x: rect.x + rect.width * .62, y: rect.y + rect.height * .57 };
      await page.mouse.move(pointer.x, pointer.y);
      await chooseView(page, .5);
      await page.mouse.move(pointer.x, pointer.y);
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
      assert.equal(await cameraZoom(page), 1, 'a mouse-wheel notch moves one level');
      await page.waitForTimeout(400);
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
      assert.equal(await cameraZoom(page), 2, 'a separate wheel gesture reaches Detail');
      await page.waitForTimeout(400);
      await chooseView(page, .5);
      const burst = await page.evaluate(({ x, y }) => {
        const canvas = document.querySelector('#world'), trail = [];
        for (let n = 0; n < 20; n++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: x, clientY: y, bubbles: true, cancelable: true }));
          trail.push(transport.renderer.getCamera().zoom);
        }
        return trail;
      }, pointer);
      assert.ok(burst.every(zoom => zoom === 1), 'a burst of wheel events advances only one view');
      await page.waitForTimeout(400);
      await chooseView(page, .5);
      const smooth = await page.evaluate(async ({ x, y }) => {
        const canvas = document.querySelector('#world'), trail = [];
        for (let n = 0; n < 24; n++) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -2, clientX: x, clientY: y, bubbles: true, cancelable: true }));
          trail.push(transport.renderer.getCamera().zoom);
          await new Promise(resolve => setTimeout(resolve, 15));
        }
        return trail;
      }, pointer);
      assert.equal(smooth.at(-1), 1, 'a smooth trackpad gesture advances a view');
      assert.ok(smooth.every(zoom => zoom === .5 || zoom === 1), 'trackpad inertia never skips straight to Detail');
      await page.waitForTimeout(400);
      await page.mouse.wheel(0, 0);
      assert.equal(await cameraZoom(page), 1, 'zero vertical wheel movement does not zoom');
    }

    const rendererChecks = await page.evaluate(async () => {
      const { createGame, build } = await import('./model.js');
      const { createRenderer } = await import('./renderer.js');
      const { createSprites } = await import('./sprites.js');
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:480px';
      document.body.append(canvas);
      const game = createGame({ biome: 'taiga', seed: 1847 });
      const renderer = createRenderer(canvas, game, { zoom: 1.23 });
      const initialZoom = renderer.getCamera().zoom;
      const levels = [.5, 1, 2], profiles = [];
      const rect = canvas.getBoundingClientRect(), anchor = { x: rect.left + 412.25, y: rect.top + 179.25 };
      const worldAt = () => {
        const camera = renderer.getCamera();
        return { x: camera.x + (anchor.x - rect.left - rect.width / 2) / camera.zoom,
          y: camera.y + (anchor.y - rect.top - rect.height / 2) / camera.zoom };
      };
      const anchors = [];
      renderer.focus(200, 150);
      for (const zoom of [2, .5, 1]) {
        const before = worldAt();
        renderer.setZoom(zoom, anchor.x, anchor.y);
        const after = worldAt(), camera = renderer.getCamera();
        anchors.push({ errorX: Math.abs(after.x - before.x) * camera.zoom * devicePixelRatio,
          errorY: Math.abs(after.y - before.y) * camera.zoom * devicePixelRatio,
          picked: renderer.screenToTile(anchor.x, anchor.y), expected: { x: Math.floor(after.x / 32), y: Math.floor(after.y / 32) } });
      }
      const target = { x: 200, y: 150 };
      Object.assign(game.tiles[target.y * game.width + target.x], { terrain: 'grass', detail: '', publicRoad: false,
        road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
      game.revision++;
      renderer.focus(target.x, target.y);
      const images = () => levels.map(zoom => {
        renderer.setZoom(zoom);
        renderer.render(0, { showRoutes: false });
        return canvas.toDataURL();
      });
      const before = images();
      const constructed = build(game, 'road', target.x, target.y).ok;
      const afterBuild = images();
      const removed = build(game, 'bulldoze', target.x, target.y).ok;
      const afterRemoval = images();
      const revisionBefore = renderer.getStats().composedChunks;
      game.revision++;
      renderer.render(0, { showRoutes: false });
      const unchangedRevisionReused = renderer.getStats().composedChunks === revisionBefore;
      for (const [width, height] of [[640, 480], [767, 511]]) {
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        renderer.resize();
        for (const zoom of levels) {
          renderer.setZoom(zoom);
          renderer.focus(target.x, target.y);
          renderer.render(0, { showRoutes: false });
          const bounds = canvas.getBoundingClientRect(), camera = renderer.getCamera();
          const originX = (bounds.width / 2 - camera.x * zoom) * devicePixelRatio;
          const originY = (bounds.height / 2 - camera.y * zoom) * devicePixelRatio;
          profiles.push({ zoom, width, height, canvasWidth: canvas.width, canvasHeight: canvas.height,
            picked: renderer.screenToTile(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
            aligned: Math.abs(originX - Math.round(originX)) < .00001 && Math.abs(originY - Math.round(originY)) < .00001,
            stats: renderer.getStats() });
        }
      }
      const tour = [];
      for (const zoom of levels) for (const [x, y] of [[96, 80], [184, 130], [256, 160], [344, 240], [410, 290]]) {
        renderer.setZoom(zoom);
        renderer.focus(x, y);
        renderer.render(0, { showRoutes: false });
        tour.push(renderer.getStats());
      }
      const region = createSprites('taiga', { pixelScale: .5, detailLevel: 'region' })('school', 0, 1);
      const town = createSprites('taiga', { pixelScale: 1, detailLevel: 'town' })('school', 0, 1);
      const detail = createSprites('taiga', { pixelScale: 4, detailLevel: 'detail' })('school', 0, 1);
      const enlarged = document.createElement('canvas');
      enlarged.width = detail.width; enlarged.height = detail.height;
      const enlargedContext = enlarged.getContext('2d');
      enlargedContext.imageSmoothingEnabled = false;
      enlargedContext.drawImage(town, 0, 0, detail.width, detail.height);
      const nativeDetail = detail.toDataURL() !== enlarged.toDataURL();
      const spriteSizes = [region, town, detail].map(sprite => [sprite.width, sprite.height]);
      canvas.remove();
      return { initialZoom, anchors, constructed, removed, changed: before.map((image, index) => image !== afterBuild[index]),
        restored: before.map((image, index) => image === afterRemoval[index]), unchangedRevisionReused, profiles, tour, nativeDetail, spriteSizes };
    });
    assert.equal(rendererChecks.initialZoom, 1, 'a legacy initial zoom snaps to Town');
    for (const anchor of rendererChecks.anchors) {
      assert.ok(anchor.errorX <= .50001 && anchor.errorY <= .50001, 'pointer anchor stays within half a physical pixel');
      assert.deepEqual(anchor.picked, anchor.expected, 'tile picking uses the same anchored camera transform');
    }
    assert.equal(rendererChecks.constructed && rendererChecks.removed, true);
    assert.deepEqual(rendererChecks.changed, [true, true, true], 'construction updates every view cache');
    assert.deepEqual(rendererChecks.restored, [true, true, true], 'demolition restores every view cache');
    assert.equal(rendererChecks.unchangedRevisionReused, true, 'unrelated revisions reuse unchanged chunks');
    for (const profile of rendererChecks.profiles) {
      assert.equal(profile.canvasWidth, profile.width * deviceScaleFactor);
      assert.equal(profile.canvasHeight, profile.height * deviceScaleFactor);
      assert.deepEqual(profile.picked, { x: 200, y: 150 }, 'focus and center picking survive resize at every view');
      assert.equal(profile.aligned, true, 'the camera origin aligns to physical screen pixels');
      assert.equal(profile.stats.rasterScale, profile.zoom * deviceScaleFactor, 'chunk artwork matches display resolution');
      assert.equal(profile.stats.detailLevel, views.find(([zoom]) => zoom === profile.zoom)[1]);
    }
    for (const stats of rendererChecks.tour) {
      assert.ok(stats.cacheBytes <= stats.cacheLimit, 'travel across a huge map keeps the raster cache bounded');
      assert.ok(stats.cacheLimit <= 256 * 1024 * 1024);
      assert.ok(stats.maxSurfaceWidth <= 2048 && stats.maxSurfaceHeight <= 2048, 'no world-size raster is allocated');
    }
    assert.deepEqual(rendererChecks.spriteSizes, [[16, 20], [32, 40], [128, 160]], 'sprites draw at their native profile resolutions');
    assert.equal(rendererChecks.nativeDetail, true, 'Detail regenerates artwork instead of magnifying the Town bitmap');
    summaries.push({ dpr: deviceScaleFactor, profiles: rendererChecks.profiles.length,
      maxCacheMiB: Math.round(Math.max(...rendererChecks.tour.map(stats => stats.cacheBytes)) / 1024 / 1024) });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile zoom controls do not overflow');
    for (const [zoom, name] of views) {
      await chooseView(page, zoom);
      assert.equal(await cameraZoom(page), zoom, 'each view remains selectable on mobile');
      await page.screenshot({ path: `${output}/mobile-dpr${deviceScaleFactor}-${name}.png` });
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await page.waitForTimeout(100);
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the narrowest layout does not overflow');
    for (const [zoom] of views) {
      await chooseView(page, zoom);
      assert.equal(await cameraZoom(page), zoom, 'presets remain reachable at 320 pixels');
    }
    const narrowBounds = await page.evaluate(() => {
      const controls = document.querySelector('.view-controls').getBoundingClientRect();
      const minimap = document.querySelector('#minimap').getBoundingClientRect();
      return { left: controls.left, right: controls.right, mapLeft: minimap.left };
    });
    assert.ok(narrowBounds.left >= 0 && narrowBounds.right <= 320, 'zoom controls fit on a 320-pixel screen');
    assert.ok(narrowBounds.right <= narrowBounds.mapLeft, 'zoom controls do not cover the minimap');
    await page.screenshot({ path: `${output}/narrow-dpr${deviceScaleFactor}-detail.png` });
    await context.close();
  }
  assert.deepEqual(errors, [], 'no browser errors at either pixel density');
  console.log(`Transport three-view browser checks passed: ${JSON.stringify(summaries)}. Screenshots: ${output}`);
} finally {
  await browser.close();
}
