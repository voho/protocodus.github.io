#!/usr/bin/env node
// Static menu art from the actual game. Serve the repository, then run with
// TRANSPORT_PLAYWRIGHT / TRANSPORT_URL as for tools/ui-snapshot.mjs.
// No game generation or renderer code runs in the start menu itself.
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from '../tests/browser-start.mjs';
import { LAUNCH } from './ui-snapshot.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch(LAUNCH);
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = new URL('../assets/ui/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 756 }, deviceScaleFactor: 1 });
    try {
      await page.goto(url);
      await createWorldFromMenu(page, { biome, seed: 1847, generationVersion: 11 });
      await page.evaluate(() => {
        const renderer = transport.renderer, town = transport.game.cities[0];
        renderer.setLayers({ grid: false, names: false, industryIcons: false, routes: false, stations: false, vehicleLoads: false, weather: false });
        renderer.setZoom(1);
        renderer.focus(town.x + 2, town.y);
      });
      // Allow art requests and progressive scenery preparation to settle.
      await page.waitForTimeout(5000);
      const encoded = await page.evaluate(() => {
        transport.renderer.render(performance.now(), { tool: 'inspect' });
        return document.querySelector('#world').toDataURL('image/webp', .86).split(',')[1];
      });
      await writeFile(new URL(`start-${biome}.webp`, output), Buffer.from(encoded, 'base64'));
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
