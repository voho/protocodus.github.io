// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node this file.
// Guards against in-flight hitches and visual snaps: scenery artwork must never
// force a GPU readback, and a hitstop freeze must hold the rendered frame still.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
await page.addInitScript(() => {
  const queued = new Map(); let next = 0;
  window.__frameTime = 1000;
  window.requestAnimationFrame = callback => { const id = ++next; queued.set(id, callback); return id; };
  window.cancelAnimationFrame = id => queued.delete(id);
  window.__pumpFrame = timestamp => { __frameTime = timestamp; const callbacks = [...queued.values()]; queued.clear(); for (const callback of callbacks) callback(timestamp); };
  localStorage.setItem('tyran-muted', 'true');
});

try {
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });

  // Scenery tinting reads pixels back. Its source cells must already live in CPU
  // memory, or every first hit on a structure stalls the frame on the GPU.
  const residency = await page.evaluate(async () => {
    const { spriteCell } = await import('./sprite-assets.js');
    const report = {};
    const fleets = ['fleet', 'fleetJungle', 'fleetSnow', 'fleetDesert', 'fleetParadise', 'fleetAsteroid', 'fleetMars', 'fleetVolcanic', 'fleetNeon', 'fleetAlien', 'fleetVoid'].map(name => [name, 12]);
    for (const [atlas, count] of [['nature', 16], ['structures', 16], ['structureLight', 16], ['structureHeavy', 16], ['structureCrater', 16], ['materials', 40], ['projectiles', 12], ...fleets]) {
      const cells = Array.from({ length: count }, (_, index) => spriteCell(atlas, index)).filter(Boolean);
      report[atlas] = { cells: cells.length, cpu: cells.filter(cell => cell.getContext('2d').getContextAttributes().willReadFrequently).length };
    }
    return report;
  });
  for (const [atlas, { cells, cpu }] of Object.entries(residency)) {
    assert.ok(cells > 0, `${atlas} has cells`);
    assert.equal(cpu, cells, `${atlas} cells are CPU-resident for pixel reads`);
  }
  const effects = await page.evaluate(async () => (await import('./sprite-assets.js')).spriteCell('effects', 0).getContext('2d').getContextAttributes().willReadFrequently);
  assert.equal(effects, false, 'per-frame explosion artwork stays on the GPU');
  console.log('PASS recolored atlases stay CPU-resident, so preparing artwork never reads back from the GPU');

  // A heavy kill freezes the simulation briefly. The rendered frame must hold
  // still (no snap back by one physics step) and resume without a burst.
  const freeze = await page.evaluate(() => {
    document.querySelector('#launch-button').click();
    const s = tyran.state; s.director.hold = true; s.players[0].hurt = 1e6;
    const world = tyran.world, draw = world.draw, scrolls = [];
    world.draw = function (ctx, W, H, scroll, ...rest) { scrolls.push(scroll); return draw.call(this, ctx, W, H, scroll, ...rest); };
    let time = __frameTime;
    // Uneven frame pacing leaves a partial step pending before the freeze.
    for (let i = 0; i < 90; i++) { time += i % 3 ? 16.7 : 9.1; __pumpFrame(time); }
    s.players[0].bombs = 3;
    const start = scrolls.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true, cancelable: true }));
    for (let i = 0; i < 40; i++) { time += i % 3 ? 16.7 : 9.1; __pumpFrame(time); }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true, cancelable: true }));
    world.draw = draw;
    const steps = scrolls.slice(start - 1).map((value, index, list) => index ? value - list[index - 1] : 0).slice(1);
    return { novas: 3 - s.players[0].bombs, backward: steps.filter(step => step < -1e-6).length, largest: Math.max(...steps), typical: steps.toSorted((a, b) => a - b)[Math.floor(steps.length / 2)] };
  });
  assert.equal(freeze.novas, 1, 'the nova detonated and triggered a hitstop');
  assert.equal(freeze.backward, 0, 'the rendered terrain never moves backward during a hitstop');
  assert.ok(freeze.largest < freeze.typical * 3.5, `resuming after a hitstop does not jump ahead (${freeze.largest.toFixed(2)} vs ${freeze.typical.toFixed(2)})`);
  console.log('PASS hitstop holds the rendered frame and resumes smoothly');

  // The shop prepares the next world during idle time; launching builds nothing.
  await page.evaluate(async () => {
    const { spawnEnemy, killEnemy } = await import('./sim.js');
    const s = tyran.state; s.level = 1; s.director.hold = false;
    killEnemy(s, spawnEnemy(s, 9, s.width / 2, 180)); tyran.step(3.4);
  });
  assert.equal(await page.evaluate(() => tyran.scene), 'hangar');
  await page.waitForFunction(() => tyran.world.index === 2 && !tyran.world.warmJobs.length, null, { timeout: 15000, polling: 50 });
  const launch = await page.evaluate(() => {
    const world = tyran.world, proto = Object.getPrototypeOf(world), builds = [];
    const getTile = proto.getTile, getSceneryLayer = proto.getSceneryLayer;
    proto.getTile = function (row) { if (!this.tiles.has(row)) builds.push('terrain:' + row); return getTile.call(this, row); };
    proto.getSceneryLayer = function (row, band, depth = 0) { if (!this.sceneryLayers[depth].has(row)) builds.push('scenery:' + row); return getSceneryLayer.call(this, row, band, depth); };
    const started = performance.now();
    document.querySelector('#next-button').click();
    for (let i = 1; i <= 3; i++) __pumpFrame(__frameTime + 16.7);
    const ms = performance.now() - started;
    proto.getTile = getTile; proto.getSceneryLayer = getSceneryLayer;
    return { builds, level: tyran.state.level, scene: tyran.scene, ms };
  });
  assert.deepEqual([launch.level, launch.scene], [2, 'playing']);
  assert.deepEqual(launch.builds, [], 'the opening terrain was prepared in the shop');
  console.log(`PASS the next sector launches from prepared artwork (${launch.ms.toFixed(1)} ms for the click and first frames)`);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
