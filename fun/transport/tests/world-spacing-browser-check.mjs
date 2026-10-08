// Current-recipe onboarding exercises the real plan, launch and save/load flow.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-world-spacing';
await mkdir(output, { recursive: true });
const results = [], errors = [];
// Loading resumes the clock before the pause click, so compare saved service
// geometry rather than the cash changed by that brief simulation interval.
const snapshot = page => page.evaluate(() => ({ generation: transport.game.generationVersion,
  reachVersion: transport.game.stationReachVersion, routes: transport.game.routes.map(r => ({id:r.id,stops:r.stops,cargo:r.cargo})),
  stops: transport.game.stations.map(s => ({id:s.id,x:s.x,y:s.y,mode:s.mode,reach:s.catchmentRadius || 4})) }));
try {
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const context = await browser.newContext({ viewport: { width:1280, height:800 } }), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await createWorldFromMenu(page, { biome, generationVersion:12 });
    const before = await snapshot(page); assert.equal(before.generation,12); assert.equal(before.reachVersion,1);
    await page.locator('#objective-plan').click(); await page.locator('#build-connection-plan').click();
    await page.locator('#route-launch [type="submit"]').click();
    await page.locator('#route-list[data-route-detail]').waitFor();
    const launched = await snapshot(page);
    assert.equal(launched.routes.length, before.routes.length+1);
    assert.equal(await page.locator('#route-list .route-card').count(),1);
    assert.ok(launched.stops.every(stop => stop.reach===4));
    assert.equal(await page.evaluate(() => transport.persist()),true,'the new world and built route save');
    await page.screenshot({path:`${output}/${biome}-first-freight.png`});
    await page.reload(); await loadAutosaveFromMenu(page);
    assert.deepEqual(await snapshot(page),launched,'restoring preserves new reach and the built service');
    results.push({biome,routes:launched.routes.length,stops:launched.stops.length,saveRestored:true});
    await context.close();
  }
  assert.deepEqual(errors,[]); await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors}));
} finally { await browser.close(); }
