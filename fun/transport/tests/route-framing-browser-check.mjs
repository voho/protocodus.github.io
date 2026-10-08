// Real route entry and suggested construction keep both endpoint markers clear
// of the management drawer, goal card and other visible map controls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-route-framing-qa';
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
await mkdir(output, { recursive: true });
const errors = [], results = [];
async function inspectEndpoints(page, label) {
  await page.waitForFunction(() => !transport.renderer.getStats().gliding);
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.target?.classList?.contains('sidebar')).map(a => a.finished.catch(() => {}))));
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const state = await page.evaluate(() => {
    const rect = document.querySelector('#world').getBoundingClientRect(), route = document.querySelector('#route-form');
    const ids = ['from', 'to'].map(key => route.querySelector(`[name="${key}"]`).value);
    const markers = ids.map(id => {
      const station = transport.game.stations.find(s => String(s.id) === id), marker = transport.renderer.stationMarker(station);
      const x = rect.left + marker.x + marker.size / 2, y = rect.top + marker.y + marker.size / 2, radius = Math.max(3, marker.size / 2 - 2);
      const hits = [[0, 0], [-radius, 0], [radius, 0], [0, -radius], [0, radius]].map(([dx, dy]) => {
        const hit = document.elementFromPoint(x + dx, y + dy);
        return { x: x + dx, y: y + dy, id: hit?.id, cover: hit?.closest('#management-panel,#objective-card,#inspector,[data-band]')?.id || null };
      });
      return { name: station.name, x, y, size: marker.size, hits };
    });
    return { camera: transport.renderer.getCamera(), width: innerWidth, height: innerHeight, generation: transport.game.generationVersion, markers, drawerOpen: document.querySelector('.sidebar').classList.contains('drawer-open') };
  });
  await page.screenshot({ path: `${output}/${label}.png` });
  results.push({ label, ...state });
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  assert.equal(state.drawerOpen, true, `${label}: the route controls remain open`);
  for (const marker of state.markers) for (const hit of marker.hits) {
    assert.ok(hit.x > 0 && hit.x < state.width && hit.y > 52 && hit.y < state.height, `${label}: ${marker.name} stays on screen`);
    assert.equal(hit.id, 'world', `${label}: ${marker.name} is unobstructed at ${hit.x},${hit.y}; cover=${hit.cover}`);
  }
}
try {
  for (const config of [{ label: 'desktop-retina', width: 1440, height: 900, dpr: 2, motion: 'no-preference' }, { label: 'laptop', width: 1024, height: 768, dpr: 1, motion: 'reduce' }]) {
    const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: config.dpr, reducedMotion: config.motion });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await createWorldFromMenu(page, { generationVersion: 11 });
    await page.locator('.main-nav [data-view="routes"]').click(); await page.locator('#new-route-button').click();
    const stops = await page.evaluate(() => transport.game.routes[0].stops);
    await page.locator('#route-form [name="from"]').selectOption(stops[0]);
    await page.locator('#route-form [name="to"]').selectOption(stops[1]);
    await page.locator('[data-cargo-choice="mail"]').click();
    await inspectEndpoints(page, `${config.label}-mail-draft`);
    await page.locator('#close-management').click();
    if (!await page.locator('#objective-plan').isVisible()) await page.locator('#objective-chip').click();
    await page.locator('#objective-plan').click();
    await page.locator('#build-connection-plan').click();
    await page.locator('#route-launch [type="submit"]').waitFor({ state: 'visible' });
    await inspectEndpoints(page, `${config.label}-connection-draft`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cases: results.length, markers: results.reduce((sum, r) => sum + r.markers.length, 0), errors, output }, null, 2));
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
}
