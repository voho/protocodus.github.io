// Rain and dust retain their motion while submitting one stroke per weather pass.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(new URL('worlds.js', process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/').href);
  await page.setContent('');
  const result = await page.evaluate(async () => {
    const { WorldRenderer, PARALLAX_LAYERS } = await import('./worlds.js');
    const world = new WorldRenderer(); await world.ready;
    world.warmEpoch++; world.warmJobs = []; world.queueWarm = () => {};
    const H = 900, DISTRICT = 1200, samples = [];
    const originalWeather = (c, height, scroll, time, quality, motion) => {
      c.save();
      if (quality !== 'low') c.globalAlpha = 1;
      const count = quality === 'low' ? 13 : world.index === 7 ? 70 : 38;
      for (let group = 0; group < Math.ceil(world.viewportWidth / DISTRICT); group++) for (let i = 0; i < count; i++) {
        const depth = .3 + (i % 7) * .13, layer = PARALLAX_LAYERS[i % 3 === 0 ? 2 : 1];
        const x = group * DISTRICT + ((i * 191.7 + world.parallaxX * (motion ? layer.x : 1) + Math.sin(time * .2 + i) * 18 + (world.index === 2 || world.index === 5 ? time * 55 : 0)) % DISTRICT + DISTRICT) % DISTRICT;
        const y = ((i * 149.31 + scroll * (motion ? layer.speed : 1) + time * 4) % (height + 40) + height + 40) % (height + 40) - 20;
        c.beginPath(); c.moveTo(x, y); c.lineTo(world.index === 7 ? x - 4 : x + 6 + depth * 8, world.index === 7 ? y + 17 : y + 1);
        c.strokeStyle = world.index === 7 ? 'rgba(162,189,220,.17)' : 'rgba(238,194,145,.2)'; c.lineWidth = world.index === 7 ? .8 : .7; c.stroke();
      }
      c.globalAlpha = 1; c.restore();
    };
    const state = c => JSON.stringify([c.globalAlpha, c.strokeStyle, c.lineWidth, c.fillStyle, c.globalCompositeOperation, ...['a', 'b', 'c', 'd', 'e', 'f'].map(key => c.getTransform()[key])]);
    for (const index of [7, 2, 5]) {
      world.setWorld(index, 'weather-batch-qa');
      for (const [width, scale] of [[390, 1], [1600, .75], [3651.3, .6]]) {
        world.setViewport(width); world.parallaxX = -7.25;
        for (const time of [0, 3.7, 27.125]) for (const quality of ['high', 'low']) for (const motion of [true, false]) {
          const frames = [], scroll = 137.25 + time * 83, renderTime = motion ? time : 0;
          for (const old of [false, true]) {
            const canvas = new OffscreenCanvas(Math.ceil(width * scale), Math.ceil(H * scale)), c = canvas.getContext('2d');
            c.fillStyle = '#172b20'; c.fillRect(0, 0, canvas.width, canvas.height);
            c.scale(scale, scale); c.translate(-5.25, 7.75); c.globalAlpha = .67; c.strokeStyle = '#ee77dd'; c.lineWidth = 3; c.fillStyle = '#9836bb';
            const before = state(c), calls = { beginPath: 0, moveTo: 0, lineTo: 0, stroke: 0, strokeStyle: 0, lineWidth: 0 }, points = [];
            // Isolate weather geometry: atmosphere images keep their production
            // placement/alpha work but submit no clouds to this pixel fixture.
            c.drawImage = () => {};
            for (const key of ['beginPath', 'moveTo', 'lineTo', 'stroke']) {
              const original = c[key].bind(c);
              c[key] = (...args) => { calls[key]++; if (key === 'moveTo' || key === 'lineTo') points.push([key, ...args]); return original(...args); };
            }
            for (const key of ['strokeStyle', 'lineWidth']) {
              const property = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), key);
              Object.defineProperty(c, key, { get: () => property.get.call(c), set: value => { calls[key]++; property.set.call(c, value); } });
            }
            if (old) originalWeather(c, H, scroll, renderTime, quality, motion);
            else world.drawAtmosphere(c, H, scroll, renderTime, quality, motion);
            frames.push({ canvas, pixels: c.getImageData(0, 0, canvas.width, canvas.height).data, calls, points, statePreserved: state(c) === before });
          }
          const [actual, expected] = frames;
          // A multi-segment path can use a different thin-line AA rasterizer.
          // Bound allowed differences to each original line's physical footprint.
          const support = new Uint8Array(actual.canvas.width * actual.canvas.height), radius = (index === 7 ? .8 : .7) * scale / 2 + 1.25;
          for (let i = 0; i < expected.points.length; i += 2) {
            const a = expected.points[i], b = expected.points[i + 1];
            const x1 = (a[1] - 5.25) * scale, y1 = (a[2] + 7.75) * scale, x2 = (b[1] - 5.25) * scale, y2 = (b[2] + 7.75) * scale;
            const dx = x2 - x1, dy = y2 - y1, length = dx * dx + dy * dy;
            const left = Math.max(0, Math.floor(Math.min(x1, x2) - radius)), right = Math.min(actual.canvas.width - 1, Math.ceil(Math.max(x1, x2) + radius));
            const top = Math.max(0, Math.floor(Math.min(y1, y2) - radius)), bottom = Math.min(actual.canvas.height - 1, Math.ceil(Math.max(y1, y2) + radius));
            for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
              const t = Math.max(0, Math.min(1, ((x + .5 - x1) * dx + (y + .5 - y1) * dy) / length));
              if ((x + .5 - x1 - t * dx) ** 2 + (y + .5 - y1 - t * dy) ** 2 <= radius ** 2) support[y * actual.canvas.width + x] = 1;
            }
          }
          let max = 0, total = 0, changedPixels = 0, changedOutsideStroke = 0;
          for (let p = 0; p < actual.pixels.length; p += 4) {
            let changed = false;
            for (let channel = 0; channel < 4; channel++) {
              const difference = Math.abs(actual.pixels[p + channel] - expected.pixels[p + channel]);
              max = Math.max(max, difference); total += difference; changed ||= difference > 0;
            }
            if (changed) { changedPixels++; if (!support[p / 4]) changedOutsideStroke++; }
          }
          samples.push({ index, width, scale, time, quality, motion, max, mean: total / actual.pixels.length,
            changedPixels, changedOutsideStroke, changedFraction: changedPixels / (actual.pixels.length / 4), positionsEqual: JSON.stringify(actual.points) === JSON.stringify(expected.points),
            statePreserved: actual.statePreserved && expected.statePreserved, before: expected.calls, after: actual.calls });
        }
      }
    }
    return samples;
  });
  for (const sample of result) {
    assert(sample.positionsEqual, `weather positions and timing stay exact: ${JSON.stringify(sample)}`);
    assert(sample.statePreserved, 'weather preserves caller alpha, styles and transform');
    assert.equal(sample.after.stroke, 1); assert.equal(sample.after.beginPath, 1);
    assert.equal(sample.after.strokeStyle, 1); assert.equal(sample.after.lineWidth, 1);
    assert.equal(sample.after.moveTo, sample.before.moveTo); assert.equal(sample.after.lineTo, sample.before.lineTo);
    assert.equal(sample.changedOutsideStroke, 0, 'batching changes no pixels beyond the original stroke AA bounds');
    assert(sample.max <= 20 && sample.mean <= .011 && sample.changedFraction <= .004, `only bounded stroke-edge pixels may differ: ${JSON.stringify(sample)}`);
  }
  assert.deepEqual(errors, [], 'no browser errors');
  const calls = sample => Object.values(sample).reduce((a, b) => a + b, 0);
  const wide = result.find(sample => sample.index === 7 && sample.width > 3000 && sample.quality === 'high');
  console.log(JSON.stringify({ cases: result.length, maxDifference: Math.max(...result.map(sample => sample.max)),
    maxMean: Math.max(...result.map(sample => sample.mean)), maxChangedFraction: Math.max(...result.map(sample => sample.changedFraction)),
    wideNeon: { segments: wide.after.lineTo, nativeCallsBefore: calls(wide.before), nativeCallsAfter: calls(wide.after), strokesBefore: wide.before.stroke, strokesAfter: wide.after.stroke },
    changedOutsideStroke: Math.max(...result.map(sample => sample.changedOutsideStroke)),
    worst: result.toSorted((a, b) => b.changedFraction - a.changedFraction).slice(0, 3).map(({ index, width, time, quality, motion, max, changedPixels, changedFraction }) => ({ index, width, time, quality, motion, max, changedPixels, changedFraction })) }));
  console.log('PASS batched weather retains positions, timing, palette, caller state and pixels across quality/motion settings.');
} finally { await browser.close(); }
