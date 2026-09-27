// Uniform screen geometry and additional world coverage, including native 32:9.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/';
const output = process.env.TYRAN_WIDESCREEN_OUTPUT || '/tmp/tyran-widescreen-qa';
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir(output, { recursive: true });
await page.addInitScript(() => {
  localStorage.setItem('tyran-muted', 'true');
  window.shapeAudit = {};
  const cssScale = ctx => {
    const transform = ctx.getTransform(), box = ctx.canvas.getBoundingClientRect();
    const x = box.width / ctx.canvas.width, y = box.height / ctx.canvas.height;
    return [Math.hypot(transform.a * x, transform.b * y), Math.hypot(transform.c * x, transform.d * y)];
  };
  window.installShapeAudit = (proto, backend) => { for (const name of ['drawImage', 'ellipse', 'arc']) {
    const original = proto[name];
    proto[name] = function (...args) {
      if (this.canvas.id === 'game-canvas' || this.canvas.id === 'game-gpu-canvas') {
        const [sx, sy] = cssScale(this);
        if (name === 'drawImage' && (args.length === 5 || args.length === 9) && this.globalCompositeOperation === 'source-over') {
          // Hulls trim transparent borders with the nine-argument overload.
          // Recover their full source footprint without assuming a crop size.
          const source = args[0], cropped = args.length === 9;
          const scaleX = cropped ? args[7] / args[3] : args[3] / source.width;
          const scaleY = cropped ? args[8] / args[4] : args[4] / source.height;
          const x = cropped ? args[5] - args[1] * scaleX : args[1];
          const y = cropped ? args[6] - args[2] * scaleY : args[2];
          const width = source.width * scaleX, height = source.height * scaleY;
          if (Math.abs(x + 140) < 1e-7 && Math.abs(y + 140) < 1e-7
            && Math.abs(width - 280) < 1e-7 && Math.abs(height - 280) < 1e-7) {
            shapeAudit.ship = { width: width * sx, height: height * sy, backend };
          }
        }
        if (name === 'ellipse' && args[0] === 0 && args[1] === 0 && args[2] === 37 && args[3] === 46) {
          shapeAudit.shield = { width: 74 * sx, height: 92 * sy, backend };
        }
        if (name === 'arc' && args[2] >= 42 && args[2] <= 46 && args[3] === 0 && args[4] === Math.PI * 2) {
          shapeAudit.guard = { width: args[2] * 2 * sx, height: args[2] * 2 * sy, backend };
        }
      }
      return original.apply(this, args);
    };
  } };
  installShapeAudit(CanvasRenderingContext2D.prototype, 'canvas2d');
});
const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await page.goto(url); await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  await page.evaluate(async () => {
    const { GPUCanvas2D } = await import('./gpu-canvas.js');
    installShapeAudit(GPUCanvas2D.prototype, 'webgl2');
  });
  for (const viewport of [{ width: 1200, height: 900 }, { width: 1600, height: 900 }, { width: 2100, height: 900 }, { width: 3200, height: 900 }, { width: 5120, height: 1440 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      tyran.launch(7, null, false); tyran.state.director.hold = true;
      tyran.state.players[0].guard = 10000; shapeAudit = {};
    });
    await settled();
    const result = await page.evaluate(async () => {
      const state = tyran.state, world = tyran.world, surface = document.querySelector('#game-canvas'), box = surface.getBoundingClientRect();
      const { createCampaign, missionScrollSpeed, update } = await import('./sim.js');
      const { serializeRun, restoreRun } = await import('./save-game.js');
      const isolated = createCampaign(7); isolated.width = state.width; isolated.height = state.height; isolated.director.hold = true;
      for (let i = 0; i < 60; i++) update(isolated, 1 / 60);
      const saved = restoreRun(serializeRun(isolated)).state;
      const tile = world.getTile(0), sample = tile.getContext('2d').getImageData(tile.width - 120 * world.detailScale, 300 * world.detailScale, 20, 20).data;
      const props = [...world.bands.values()].flat();
      return {
        css: { width: box.width, height: box.height }, logical: { width: state.width, height: state.height }, backing: { width: surface.width, height: surface.height },
        scale: { x: box.width / state.width, y: box.height / state.height }, shapes: structuredClone(shapeAudit), renderer: tyran.renderer.backend,
        terrain: { scale: world.scale, mapWidth: world.mapWidth, viewportWidth: world.viewportWidth, tileWidth: tile.width, detailScale: world.detailScale,
          rightCoverage: Array.from(sample).filter((_, index) => index % 4 === 3).every(alpha => alpha > 0),
          rightProps: props.filter(prop => prop.x > state.width * .75 && prop.x < state.width).length,
          maxPropX: Math.max(...props.map(prop => prop.x)) },
        simulation: { scroll: isolated.scroll, speed: missionScrollSpeed(isolated), saveWidth: saved.width, saveHeight: saved.height },
      };
    });
    assert(Math.abs(result.scale.x - result.scale.y) < 1e-9, 'CSS scales both game axes equally');
    assert.equal(result.logical.width, 900 * result.css.width / result.css.height);
    assert.equal(result.logical.height, 900);
    assert(result.shapes.ship && result.shapes.shield && result.shapes.guard, 'actual flight draws a hull, shield and circular guard');
    assert.equal(result.renderer, new URL(url).searchParams.get('renderer') === 'native' ? 'canvas2d' : 'webgl2', 'the requested renderer is active throughout geometry verification');
    assert(Object.values(result.shapes).every(shape => shape.backend === result.renderer), 'every geometry sample comes from the active visible renderer');
    assert(Math.abs(result.shapes.ship.width / result.shapes.ship.height - 1) < 1e-9, 'ship sprite keeps its source proportions');
    assert(Math.abs(result.shapes.shield.width / result.shapes.shield.height - 74 / 92) < 1e-9, 'shield retains its authored ellipse');
    assert(Math.abs(result.shapes.guard.width / result.shapes.guard.height - 1) < 1e-9, 'circular guard stays round');
    assert(Math.abs(result.shapes.ship.width / result.css.height - 280 * 30 / 82 / 900) < 1e-7, `same arena height gives the same ship size: ${JSON.stringify(result.shapes.ship)}`);
    assert.equal(result.terrain.scale, 1, 'terrain uses the same world units as ships and projectiles');
    assert.equal(result.terrain.viewportWidth, result.logical.width);
    assert.equal(result.terrain.mapWidth, Math.ceil(result.logical.width / 100) * 100);
    assert.equal(result.terrain.tileWidth, (result.terrain.mapWidth + 200) * result.terrain.detailScale, 'wider arenas generate extra terrain columns');
    assert(result.terrain.rightCoverage && result.terrain.rightProps > 0, 'the expanded right side contains terrain and scenery');
    assert.equal(result.simulation.saveWidth, result.logical.width); assert.equal(result.simulation.saveHeight, result.logical.height);
    if (results.length) {
      assert.equal(result.simulation.scroll, results[0].simulation.scroll, 'arena width does not speed up mission scrolling');
      assert.equal(result.simulation.speed, results[0].simulation.speed);
    }
    results.push(result);
    if ([1200, 3200, 5120].includes(viewport.width)) await page.screenshot({ path: `${output}/after-${viewport.width}x${viewport.height}.png` });
  }

  // A building in newly exposed columns must be hittable and keep its identity
  // and damage when those columns disappear and return after a viewport change.
  const damage = await page.evaluate(async () => {
    const { createCampaign, update } = await import('./sim.js');
    const { serializeRun, restoreRun } = await import('./save-game.js');
    const world = tyran.world, buildings = new Set(['temple', 'ruin', 'bunker', 'station', 'radar', 'dome', 'solar', 'refinery', 'building', 'tower', 'pylon', 'fortress', 'hut', 'satellite']);
    world.prepareGround(tyran.state.width, tyran.state.height, 0, tyran.state.width / 2);
    let target;
    for (let row = 0; row > -15 && !target; row--) target = world.getBand(row).find(prop => prop.x > 2000 && prop.x < 3000 && buildings.has(prop.type));
    if (!target) throw new Error('Missing expanded-column building');
    const before = target.hp, at = { x: target.x, y: target.y, size: target.size };
    world.hit(target.x + world.parallaxX, target.y + world.scroll, 0, 3);
    if (target.hp !== before - 3) throw new Error('Right-side building hit is misaligned');
    const record = serializeRun(tyran.state, { seed: world.seed, damage: world.damage, destroyed: world.destroyed });
    const restored = restoreRun(record);
    const probe = createCampaign(7); probe.width = tyran.state.width; probe.director.hold = true;
    const pilot = probe.players[0]; pilot.x = 2850; pilot.y = 600; pilot.lastHit = probe.time;
    const shot = (x, y) => ({ x, y, px: x, py: y, vx: 0, vy: 0, team: -1, radius: 3, damage: 7, life: 1, age: 0 });
    probe.bullets.push(shot(pilot.x + 60, pilot.y)); const shield = pilot.shield; update(probe, 1 / 60);
    if (pilot.shield !== shield) throw new Error('Right-side collision near miss incorrectly hit');
    probe.bullets.push(shot(pilot.x, pilot.y)); update(probe, 1 / 60);
    if (pilot.shield !== shield - 7) throw new Error('Right-side hostile collision missed');
    window.wideBuilding = { id: target.id, row: target.row, hp: target.hp, before, ...at };
    return { ...wideBuilding, savedHp: restored.damage.get(target.id), collision: true };
  });
  assert.equal(damage.savedHp, damage.hp, 'expanded-column damage survives save serialization');
  await page.evaluate(() => tyran.pause());
  await page.setViewportSize({ width: 1200, height: 900 }); await settled();
  await page.setViewportSize({ width: 5120, height: 1440 }); await settled();
  const returned = await page.evaluate(() => {
    const old = wideBuilding, prop = tyran.world.getBand(old.row).find(candidate => candidate.id === old.id);
    return prop && { id: prop.id, x: prop.x, y: prop.y, size: prop.size, hp: prop.hp };
  });
  assert.deepEqual(returned, { id: damage.id, x: damage.x, y: damage.y, size: damage.size, hp: damage.hp }, 'resize preserves expanded building identity, geometry and damage');
  const burst = await page.evaluate(() => {
    tyran.pause();
    const world = tyran.world, state = tyran.state, target = world.getBand(wideBuilding.row).find(prop => prop.id === wideBuilding.id);
    world.prepareGround(state.width, state.height, state.scroll, state.players[0].x);
    const x = target.x + world.parallaxX, y = target.y + state.scroll, size = 20;
    // A normal ship burst still damages the building without leaving wreckage.
    world.hit(x, y, 0, target.hp - 20, state.scroll);
    if (target.hp !== 20) throw new Error('Burst fixture must be a damaged building');
    tyran.fx.reset(); state.events.push({ type: 'explosion', x, y, size });
    tyran.step(1 / 60); tyran.pause();
    const ground = tyran.fx.rings.find(ring => ring.ground);
    if (!world.destroyed.has(target.id)) throw new Error('Air burst missed its right-side ground target');
    if (!ground) throw new Error('Missing burst ground shockwave');
    window.burstAudit = { ground, before: { x: ground.x, y: ground.y, radius: ground.radius } };
    return { x: ground.x, expectedX: x, target: target.id, destroyed: world.destroyed.has(target.id), wrecks: 'wrecks' in tyran.fx };
  });
  assert(Math.abs(burst.x - burst.expectedX) < 1e-9, 'collateral shockwave aligns with the unscaled building');
  assert.equal(burst.wrecks, false, 'ship bursts have no persistent wreck storage');
  await page.setViewportSize({ width: 1600, height: 900 }); await settled();
  const anchored = await page.evaluate(() => ({
    before: burstAudit.before, after: { x: burstAudit.ground.x, y: burstAudit.ground.y, radius: burstAudit.ground.radius },
  }));
  assert.deepEqual(anchored.after, anchored.before, 'ground bursts retain their unscaled position and radius across resize');
  assert.deepEqual(errors, [], 'widescreen changes have no runtime errors');
  await writeFile(`${output}/results.json`, JSON.stringify({ results, damage, returned, burst, anchored, errors }, null, 2));
  console.log('PASS widescreen rendering: 4:3,16:9,21:9,32:9, native5120×1440, uniform ship/shield geometry, extra terrain, fixed scroll speed, right-side hits, and resize/save damage preservation.');
  console.log(JSON.stringify({ viewports: results.map(({ css, logical, terrain }) => ({ css, logical, terrain })), damage }, null, 2));
} finally { await browser.close(); }
