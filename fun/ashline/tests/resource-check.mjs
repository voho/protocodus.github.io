// Verify the shipped unit atlas budget and direct consumption of baked frames.
// Run with ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs and ASHLINE_URL.
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const base = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
try {
  const page = await browser.newPage(), requests = [], responseBytes = new Map(), errors = [];
  const responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (/\/assets\/prepared\/units\/[^/]+\.webp$/.test(path)) responses.push(response.body().then(body => responseBytes.set(path, body.length)));
  });
  await page.route('**/resource-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
  // Production must work even when large authoring images and build-only metadata are unavailable.
  await page.route('**/assets/generated/directions/**', route => route.abort());
  await page.route('**/assets/prepared/units/source-bounds.json', route => route.abort());
  await page.goto(new URL('resource-check.html', base).href);
  const report = await page.evaluate(async () => {
    const decoded = [], NativeImage = window.Image;
    window.Image = class extends NativeImage { constructor(...args) { super(...args); decoded.push(this); } };
    const assets = await import('./assets.js'), { UNIT_SHEETS } = await import('./assets/prepared/units/manifest.js');
    const { UNITS } = await import('./sim.js');
    await assets.startAssets();
    const stats = assets.spriteStats();
    if (!stats.ready || stats.errors.length) throw Error(stats.errors.join('; ') || 'Assets did not become ready');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    let frames = 0, decodedPixels = 0;
    const rows = [];
    for (const type of Object.keys(UNITS)) {
      const meta = UNIT_SHEETS[type], source = stats.directionSources[type];
      const image = decoded.find(image => new URL(image.src).pathname.endsWith(`/assets/prepared/units/${type}.webp`));
      if (!meta || !source || !image) throw Error(`${type}: missing prepared atlas`);
      if (image.width !== meta.pixels * 4 || image.height !== meta.pixels * meta.rows) throw Error(`${type}: atlas exceeds its prepared frame dimensions`);
      if (source.pixels !== meta.pixels || source.columns !== 4 || source.rows !== meta.rows || source.sourceBounds) throw Error(`${type}: runtime metadata must describe compact prepared frames only`);
      decodedPixels += image.width * image.height;
      canvas.width = image.width; canvas.height = image.height; ctx.drawImage(image, 0, 0);
      for (let pose = 0; pose < meta.rows / 2; pose++) for (let direction = 0; direction < 8; direction++) {
        const cell = pose * 8 + direction;
        const expected = ctx.getImageData(cell % 4 * meta.pixels, Math.floor(cell / 4) * meta.pixels, meta.pixels, meta.pixels).data;
        const capture = document.createElement('canvas').getContext('2d'); let sourceImage;
        capture.drawImage = source => { sourceImage = source; };
        assets.drawSprite(capture, { type, team: 0, angle: direction * Math.PI / 4, moving: pose === 1, id: 0 }, .25);
        if (!sourceImage || sourceImage.width !== meta.pixels || sourceImage.height !== meta.pixels) throw Error(`${type}: runtime must retain baked frame resolution`);
        const actual = sourceImage.getContext('2d').getImageData(0, 0, meta.pixels, meta.pixels).data;
        if (!expected.every((value, index) => value === actual[index])) throw Error(`${type} pose ${pose} direction ${direction}: runtime must not normalize or recolor baked friendly pixels`);
        frames++;
      }
      rows.push({ type, width: image.width, height: image.height, pixels: meta.pixels });
    }
    return { rows, frames, decodedPixels, nativeZoom: [assets.spriteNativeZoom(1), assets.spriteNativeZoom(2)], cache: stats.directionCache };
  });
  await Promise.all(responses);
  assert(!requests.some(path => path.includes('/assets/generated/directions/') || path.endsWith('/source-bounds.json')), 'Production never requests authoring atlases or build-only source metadata');
  assert.equal(responseBytes.size, report.rows.length, 'Each unit uses one compact atlas request');
  assert.equal(report.rows.length, 18);
  assert.equal(report.frames, 176, 'All eight directions and infantry walking poses use baked frames');
  assert(report.decodedPixels < 2_000_000, `Prepared unit atlases stay below two million decoded pixels (${report.decodedPixels})`);
  assert(Math.abs(report.nativeZoom[0] - 53.88757789327171) < 1e-9, 'Baking preserves the established maximum battlefield zoom');
  assert.equal(report.nativeZoom[1] * 2, report.nativeZoom[0], 'DPR 2 preserves the physical-pixel ceiling');
  const preparedBytes = [...responseBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const masterBytes = (await Promise.all(report.rows.map(({ type }) => stat(new URL(`../assets/generated/directions/${type}.webp`, import.meta.url))))).reduce((sum, file) => sum + file.size, 0);
  assert(preparedBytes < masterBytes * .2, `Shipped unit bytes stay below 20% of authoring sources (${preparedBytes}/${masterBytes})`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, unitAtlases: report.rows.length, frames: report.frames, preparedBytes, masterBytes,
    decodedPixels: report.decodedPixels, nativeZoom: report.nativeZoom, cache: report.cache }, null, 2));
} finally { await browser.close(); }
