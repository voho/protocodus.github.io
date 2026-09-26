// Cached sparks retain continuous size, fading, palette, and additive overlap.
// TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file (serve the repo).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const result = await page.evaluate(async () => {
    const { Effects, EFFECT_LIMITS, warmEffectsTextures, effectTextureStats } = await import('./effects.js');
    const { WORLDS } = await import('./worlds.js');
    const { WEAPONS } = await import('./sim.js');
    const colors = ['#ffbb6b', '#ffc985', '#ddffed', '#ffe88d', '#ffe38a', '#8affd7', '#ff7a8a', ...WORLDS.map(world => world.color), ...WEAPONS.map(weapon => weapon.color)];
    // The same preflight entry point covers normal bursts, every district,
    // legacy arcs, rescues, Nova, and the shared first-80ms white spark.
    warmEffectsTextures(colors);
    const before = effectTextureStats(), fx = new Effects();
    const source = document.createElement('canvas'), candidate = document.createElement('canvas');
    source.width = candidate.width = source.height = candidate.height = 128;
    const reference = source.getContext('2d', { willReadFrequently: true });
    const context = candidate.getContext('2d', { willReadFrequently: true });
    const contact = document.createElement('canvas'); contact.width = contact.height = 1024;
    const contactContext = contact.getContext('2d');
    contactContext.fillStyle = '#07101b'; contactContext.fillRect(0, 0, contact.width, contact.height);
    let cases = 0, maxDifference = 0, absoluteDifference = 0, referenceEnergy = 0, changed = 0, samples = 0;
    const byScale = {}, byRadius = {};
    for (const scale of [.75, 1, 1.7, 2.4]) for (const radius of [.3, .5, .8, 1.25, 2, 4, 8, 20]) for (const age of [.03, .18, .62]) for (const color of colors) {
      const offset = cases % 3 * .31, x = (64 + offset) / scale, y = (64 + offset * .7) / scale;
      fx.reset(); fx.particle(x, y, 0, 0, 1, radius, color); fx.particles[0].age = age;
      for (const c of [reference, context]) {
        c.resetTransform(); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
        c.fillStyle = '#07101b'; c.fillRect(0, 0, 128, 128); c.setTransform(scale, 0, 0, scale, 0, 0);
      }
      reference.save(); reference.getTransform(); reference.restore();
      reference.save(); reference.globalCompositeOperation = 'lighter'; reference.globalAlpha = 1 - age;
      reference.fillStyle = age < .08 ? '#fffbea' : color;
      reference.beginPath(); reference.arc(x, y, Math.max(.3, radius * (1 - age)), 0, Math.PI * 2); reference.fill();
      reference.restore();
      fx.draw(context, 128 / scale, 128 / scale);
      const a = reference.getImageData(0, 0, 128, 128).data, b = context.getImageData(0, 0, 128, 128).data;
      const stats = byScale[scale] ||= { difference: 0, energy: 0 };
      const radiusStats = byRadius[radius] ||= { difference: 0, energy: 0 };
      for (let i = 0; i < a.length; i += 4) for (let channel = 0; channel < 3; channel++) {
        const difference = Math.abs(a[i + channel] - b[i + channel]);
        const energy = a[i + channel] - [7, 16, 27][channel];
        maxDifference = Math.max(maxDifference, difference); absoluteDifference += difference;
        referenceEnergy += energy; changed += Number(difference > 0); samples++;
        stats.difference += difference; stats.energy += energy;
        radiusStats.difference += difference; radiusStats.energy += energy;
      }
      // Reference/cached pairs include subpixel sparks and larger young bursts.
      if (color === '#ffbb6b' && age === .18) {
        const row = [.75, 1, 1.7, 2.4].indexOf(scale) * 2, column = [.3, .5, .8, 1.25, 2, 4, 8, 20].indexOf(radius);
        contactContext.drawImage(source, column * 128, row * 128);
        contactContext.drawImage(candidate, column * 128, (row + 1) * 128);
      }
      cases++;
    }
    let arcs = 0, images = 0;
    const originalArc = context.arc.bind(context), originalImage = context.drawImage.bind(context);
    context.arc = (...args) => { arcs++; return originalArc(...args); };
    context.drawImage = (...args) => { images++; return originalImage(...args); };
    fx.reset();
    for (const color of colors) { fx.particle(64, 64, 0, 0, 1, 3, color); fx.particles.at(-1).age = .2; }
    fx.particle(64, 64, 0, 0, 1, 3, colors[0]);
    context.resetTransform(); fx.draw(context, 128, 128);
    const known = { arcs, images }, after = effectTextureStats();
    fx.reset(); fx.particle(64, 64, 0, 0, 1, 3, '#123456'); fx.particles[0].age = .2;
    arcs = images = 0; fx.draw(context, 128, 128);
    const fallback = { arcs, images, textures: effectTextureStats() };
    warmEffectsTextures(Array.from({ length: 100 }, (_, i) => `#${(i * 65537).toString(16).padStart(6, '0')}`));
    return { cases, maxDifference, meanDifference: absoluteDifference / samples, relativeDifference: absoluteDifference / referenceEnergy,
      changed, byScale, byRadius, known, fallback, before, after, bounded: effectTextureStats(), limits: EFFECT_LIMITS,
      contact: contact.toDataURL('image/png') };
  });
  const artifact = process.env.TYRAN_ARTIFACT_DIR || '/tmp/tyran-particle-discs-qa';
  await mkdir(artifact, { recursive: true });
  await writeFile(`${artifact}/contact.png`, Buffer.from(result.contact.split(',')[1], 'base64'));
  delete result.contact;
  await writeFile(`${artifact}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.equal(result.known.arcs, 0, 'all gameplay palettes draw prewarmed sparks without vector paths');
  assert(result.relativeDifference < .025, 'cached circles retain their shape, color and fading within 2.5% accumulated edge coverage');
  assert(result.meanDifference < .1, 'circle edge resampling remains visually localized');
  assert.deepEqual(result.before, result.after, 'drawing cannot allocate or evict artwork');
  assert.equal(result.fallback.arcs, 1, 'an unknown saved color uses the original accurate path');
  assert.equal(result.fallback.images, 0);
  assert.deepEqual(result.fallback.textures, result.after, 'unknown colors never grow runtime storage');
  assert(result.bounded.sparks.count <= result.limits.sparkTextures, 'arbitrary preflight colors have a fixed cache limit');
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS preflight spark palettes, unknown-color fallback, bounded artwork, and continuous circle comparison');
} finally { await browser.close(); }
