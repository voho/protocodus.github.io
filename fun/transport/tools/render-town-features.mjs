#!/usr/bin/env node
// Renders the town features' simple placeholder images (parks, play and sport, the town hall and the newer shops) from
// their code drawings in town-feature-sprites.js into the 4 × 3 atlases raster-buildings.js loads, one per climate,
// at every display density. Painted art can replace the PNGs cell for cell; see assets/world/buildings-town-features.
//   TRANSPORT_URL=http://localhost:8765/fun/transport/ node fun/transport/tools/render-town-features.mjs
// Needs the game served (TRANSPORT_URL) and Playwright (TRANSPORT_PLAYWRIGHT).
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const out = new URL('../assets/world/buildings-town-features/', import.meta.url);
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url);
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const sheets = await page.evaluate(async biome => {
      const { drawTownFeature } = await import('./town-feature-sprites.js');
      const { RASTER_BUILDING_FAMILIES } = await import('./raster-buildings.js');
      const order = RASTER_BUILDING_FAMILIES['buildings-town-features'], sheets = {};
      for (const cell of [16, 32, 64, 128, 256]) {
        const canvas = document.createElement('canvas'), c = canvas.getContext('2d');
        canvas.width = cell * 4; canvas.height = cell * 3;
        // Each cell is the sprite's 32-unit box; the smallest cells leave out details too fine to read.
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
