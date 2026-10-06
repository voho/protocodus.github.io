#!/usr/bin/env node
// Export native fallback drawings for QA. Active town features are generated
// with image_gen; this utility never overwrites their runtime atlases.
//   TRANSPORT_URL=http://localhost:8765/fun/transport/ node fun/transport/tools/render-town-features.mjs
// Needs the game served (TRANSPORT_URL) and Playwright (TRANSPORT_PLAYWRIGHT).
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const out = pathToFileURL(`${process.env.TRANSPORT_NATIVE_FEATURE_OUTPUT || '/tmp/transport-native-town-features'}/`);
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const harness = new URL('town-feature-art-harness', url).href;
  await page.route(harness, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8">' }));
  await page.goto(harness);
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const sheets = await page.evaluate(async biome => {
      const { drawTownFeature } = await import('./town-feature-sprites.js');
      const { RASTER_BUILDING_FAMILIES } = await import('./raster-buildings.js');
      const order = RASTER_BUILDING_FAMILIES['buildings-town-features'], sheets = {};
      for (const cell of [16, 32, 64, 128, 256]) {
        const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
        canvas.width = cell * 4; canvas.height = cell * 3;
        // The shared drawing contract fixes human features in metres while parcels grow.
        // Region cells keep identifying shapes and omit small planted/furniture overlays.
        order.forEach((kind, i) => { if (!kind) return; c.save(); c.translate(i % 4 * cell, Math.floor(i / 4) * cell); c.scale(cell / 32, cell / 32); drawTownFeature(c, kind, biome, cell <= 32 ? 'region' : 'detail'); c.restore(); });
        sheets[cell] = canvas.toDataURL('image/png').split(',')[1];
      }
      return sheets;
    }, biome);
    const folder = new URL(`${biome}/`, out);
    await mkdir(folder, { recursive: true });
    for (const [cell, data] of Object.entries(sheets)) await writeFile(new URL(`atlas-${cell}.png`, folder), Buffer.from(data, 'base64'));
  }
  console.log(`Town feature atlases written to ${out.pathname}`);
} finally { await browser.close(); }
