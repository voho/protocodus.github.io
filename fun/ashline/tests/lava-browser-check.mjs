// Optional browser QA. Uses ASHLINE_PLAYWRIGHT, ASHLINE_URL, and ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-lava-qa';
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  const checks = await page.evaluate(async () => {
    const {UNITS, createGame, issueOrder, updateGame} = await import('./sim.js');
    const {Renderer} = await import('./render.js');
    const preview = document.createElement('div'); preview.id = 'lava-preview';
    preview.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px;z-index:99999;background:#111b20';
    const world = document.createElement('canvas'), minimap = document.createElement('canvas');
    world.style.cssText = 'width:100%;height:100%;display:block';
    minimap.style.cssText = 'position:absolute;left:12px;bottom:12px;width:180px;height:140px;border:1px solid #8bb0b34d';
    preview.append(world, minimap); document.body.append(preview);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const renderer = new Renderer(world, minimap), s = createGame('lava-visual');
    s.terrain.fill(0); s.minerals.fill(0); s.entities = []; s.effects = [];
    const view = {x: 30.5, y: 30.5, zoom: 38, selected: new Set()};
    const pool = []; for (let y = 29; y <= 31; y++) for (let x = 29; x <= 32; x++) pool.push(y * s.width + x);
    const difference = (a, b) => { let count = 0; for (let i = 0; i < a.length; i += 4) if ([0, 1, 2, 3].some(channel => a[i + channel] !== b[i + channel])) count++; return count; };
    let hasLava;
    const frame = (time, visibility = 'visible', lava = true) => {
      if (hasLava !== lava) { pool.forEach(i => { s.terrain[i] = lava ? 3 : 0; }); renderer.createTerrain(s); hasLava = lava; }
      s.time = time; s.visible[0].fill(visibility === 'visible' ? 1 : 0); s.explored[0].fill(visibility === 'unexplored' ? 0 : 1);
      renderer.draw(s, view); renderer.drawMinimap(s, view, () => false);
      const surface = renderer.lavaPools[0]?.surface;
      return {world: renderer.ctx.getImageData(0, 0, world.width, world.height).data, map: minimap.getContext('2d').getImageData(0, 0, minimap.width, minimap.height).data,
        surface: surface?.getContext('2d').getImageData(0, 0, surface.width, surface.height).data};
    };
    const lit = frame(1.2); await new Promise(resolve => setTimeout(resolve, 50));
    const paused = frame(1.2), moving = frame(3.7);
    let shoreChanges = 0;
    for (let i = 3; i < lit.surface.length; i += 4) shoreChanges += lit.surface[i] !== moving.surface[i];
    // Correlate actual rendered colors: translating folds should line up after a small offset,
    // whereas an opacity pulse cannot make a displaced image match substantially better.
    const a = renderer.worldToScreen(30, 30, view), b = renderer.worldToScreen(32, 31, view), dpr = renderer.dpr;
    const motionError = (dx, dy) => {
      let error = 0, count = 0;
      for (let y = Math.ceil(a.y * dpr); y < b.y * dpr; y += 2) for (let x = Math.ceil(a.x * dpr); x < b.x * dpr; x += 2) {
        const i = (y * world.width + x) * 4, j = ((y + dy) * world.width + x + dx) * 4;
        for (let c = 0; c < 3; c++) { error += Math.abs(lit.world[i + c] - moving.world[j + c]); count++; }
      }
      return error / count;
    };
    const unshiftedError = motionError(0, 0); let advectedError = unshiftedError, flowOffset = {x: 0, y: 0};
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const error = motionError(dx, dy); if (error < advectedError) { advectedError = error; flowOffset = {x: dx, y: dy}; }
    }
    const corner = renderer.worldToScreen(29, 29, view), end = renderer.worldToScreen(33, 32, view);
    let area = 0, molten = 0, yellow = 0;
    for (let y = Math.ceil(corner.y * dpr); y < end.y * dpr; y++) for (let x = Math.ceil(corner.x * dpr); x < end.x * dpr; x++) {
      const i = (y * world.width + x) * 4, [r, g, b] = lit.world.slice(i, i + 3); area++;
      if (r > 170 && g > 40 && r > g * .9 && g > b * 1.8) molten++;
      if (r > 210 && g > 150 && b < 135) yellow++;
    }
    const remembered = frame(1.2, 'remembered'), rememberedLater = frame(3.7, 'remembered');
    const hidden = frame(1.2, 'unexplored'), hiddenLater = frame(3.7, 'unexplored');
    const plainHidden = frame(1.2, 'unexplored', false), plainRemembered = frame(1.2, 'remembered', false);
    const plain = frame(1.2, 'visible', false), plainLater = frame(3.7, 'visible', false);

    // Traverse a real generated pool: visible molten cells and navigation share terrain value 3.
    const real = createGame('ASH-001'); real.ai.nextThink = 1e12;
    const mover = real.entities.find(e => e.team === 0 && e.type === 'scout');
    const template = structuredClone(real.entities.find(e => e.team === 0 && e.type === 'rifle'));
    const haulerTemplate = structuredClone(real.entities.find(e => e.team === 0 && e.type === 'harvester'));
    real.entities = real.entities.filter(e => e.kind === 'building' || e === mover);
    let crossing;
    for (let y = 4; y < real.height - 4 && !crossing; y++) for (let x = 4; x < real.width - 12; x++) {
      if (real.terrain[y * real.width + x] !== 3 || real.terrain[y * real.width + x - 1] === 3) continue;
      let right = x; while (real.terrain[y * real.width + right + 1] === 3) right++;
      const from = y * real.width + x - 2, to = y * real.width + right + 3;
      if (right - x < 3 || right - x > 10 || right + 4 >= real.width || real.blocked[from] || real.blocked[to] || real.regions[from] !== real.regions[to]) continue;
      crossing = {x: x - 1.5, y: y + .5, tx: right + 3.5, left: x, right}; break;
    }
    if (!crossing) throw new Error('No generated lava pool with connected dry banks');
    mover.x = crossing.x; mover.y = crossing.y; issueOrder(real, [mover.id], {type: 'move', x: crossing.tx, y: crossing.y});
    let lavaEntries = 0, traveled = 0;
    for (let tick = 0; tick < 700; tick++) {
      const before = {x: mover.x, y: mover.y}; updateGame(real, .05);
      const distance = Math.hypot(mover.x - before.x, mover.y - before.y), samples = Math.max(1, Math.ceil(distance / .08)); traveled += distance;
      for (let j = 1; j <= samples; j++) for (const dx of [-.189, .189]) for (const dy of [-.189, .189]) {
        const x = before.x + (mover.x - before.x) * j / samples + dx, y = before.y + (mover.y - before.y) * j / samples + dy;
        if (real.terrain[Math.floor(y) * real.width + Math.floor(x)] === 3) lavaEntries++;
      }
    }
    const remaining = Math.hypot(mover.x - crossing.tx, mover.y - crossing.y), generatedPool = real.terrain[Math.floor(crossing.y) * real.width + crossing.left] === 3;
    for (const [type, dx, dy] of [['tank', 0, -1], ['rifle', 1, -2], ['harvester', -1, 1]]) {
      const x = crossing.x + dx, y = crossing.y + dy;
      const d = UNITS[type], unit = {...structuredClone(type === 'harvester' ? haulerTemplate : template), id: real.nextId++, type, x, y, size: d.size, hp: d.hp, maxHp: d.hp, order: {type: 'idle'}, path: []};
      if (type === 'harvester') { unit.cargo = 120; unit.unload = 0; unit.unloadDepotId = null; }
      real.entities.push(unit);
    }
    real.visible[0].fill(1); real.explored[0].fill(1); real.effects = []; real.time = 2.4;
    preview.style.width = '100vw'; preview.style.height = '100vh';
    window.lavaPreview = (zoom, time = 2.4) => {
      real.time = time;
      renderer.resize();
      const clamp = (center, pixels, tiles) => pixels / zoom >= tiles ? tiles / 2 : Math.max(pixels / zoom / 2, Math.min(tiles - pixels / zoom / 2, center));
      Object.assign(view, {x: clamp((crossing.left + crossing.right) / 2, renderer.width, real.width), y: clamp(crossing.y + 2, renderer.height, real.height), zoom});
      renderer.draw(real, view); renderer.drawMinimap(real, view, () => true);
    };
    lavaPreview(38);
    return {
      animation: difference(lit.world, moving.world), ambient: difference(plain.world, plainLater.world), paused: difference(lit.world, paused.world),
      moltenCoverage: molten / area, yellowCoverage: yellow / area, shoreChanges, flowOffset, unshiftedError, advectedError,
      rememberedAnimation: difference(remembered.world, rememberedLater.world), rememberedSurface: difference(remembered.world, plainRemembered.world),
      hiddenSurface: difference(hidden.world, plainHidden.world), hiddenAnimation: difference(hidden.world, hiddenLater.world),
      hiddenMap: difference(hidden.map, plainHidden.map), rememberedMap: difference(remembered.map, plainRemembered.map),
      generatedPool, lavaEntries, traveled, remaining,
    };
  });
  assert(checks.animation > checks.ambient + 50, 'Visible lava animates with simulation time');
  assert(checks.moltenCoverage > .5 && checks.yellowCoverage > .1, 'Most of each pool is visibly molten orange/red, with broad yellow heat folds');
  assert(Math.hypot(checks.flowOffset.x, checks.flowOffset.y) > 1 && checks.advectedError < checks.unshiftedError * .4, 'Surface detail slowly translates rather than only pulsing');
  assert.equal(checks.shoreChanges, 0, 'Surface advection never moves the shoreline mask');
  assert.equal(checks.paused, 0, 'Paused lava ignores wall-clock time');
  assert.equal(checks.rememberedAnimation, 0, 'Explored, unseen lava has no live surface animation or glow');
  assert(checks.rememberedSurface > 50 && checks.rememberedMap > 0, 'Previously explored pools retain a static surface and minimap marker');
  assert.equal(checks.hiddenSurface, 0); assert.equal(checks.hiddenAnimation, 0); assert.equal(checks.hiddenMap, 0, 'Unexplored pools do not reveal themselves on the minimap');
  assert(checks.generatedPool && checks.traveled > 8 && checks.remaining < 1.1, 'A real generated pool forces a successful detour');
  assert.equal(checks.lavaEntries, 0, 'The unit footprint never crosses visible lava cells');
  for (const [name, viewport] of [['desktop', {width: 1440, height: 900}], ['mobile', {width: 390, height: 844}]]) {
    await page.setViewportSize(viewport);
    for (const zoom of [38, 16]) {
      await page.evaluate(zoom => lavaPreview(zoom), zoom);
      await page.locator('#lava-preview').screenshot({path: `${output}/lava-${name}-${zoom}.png`});
    }
  }
  await page.setViewportSize({width: 1440, height: 900});
  await page.evaluate(() => lavaPreview(38, 8));
  await page.locator('#lava-preview').screenshot({path: `${output}/lava-desktop-flow-later.png`});
  assert.deepEqual(errors, []);
  console.log(`Lava browser checks passed: molten coverage ${(checks.moltenCoverage * 100).toFixed(1)}%, yellow coverage ${(checks.yellowCoverage * 100).toFixed(1)}%, flow offset ${JSON.stringify(checks.flowOffset)}, correlation error ${checks.advectedError.toFixed(2)}/${checks.unshiftedError.toFixed(2)}; fixed shores, pause, fog, minimap, collision and desktop/mobile screenshots. Review: ${output}`);
} finally { await browser.close(); }
