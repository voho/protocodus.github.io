// Browser QA: set ASHLINE_PLAYWRIGHT, ASHLINE_URL, and optionally ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-map-qa';
await mkdir(output, {recursive: true});
const errors = [], measurements = [];
const click = (page, p, touch, button = 'left') => touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y, {button});
const worldPoint = (page, x, y) => page.evaluate(({x, y}) => {
  const p = ashline.renderer.worldToScreen(x, y, ashline.view), r = document.querySelector('#world').getBoundingClientRect();
  return {x: p.x + r.x, y: p.y + r.y};
}, {x, y});
const mapPoint = (page, x, y) => page.locator('#minimap').evaluate((map, {x, y}) => {
  const r = map.getBoundingClientRect(), s = ashline.state, scale = Math.min(r.width / s.width, r.height / s.height);
  return {x: r.x + (r.width - s.width * scale) / 2 + x * scale, y: r.y + (r.height - s.height * scale) / 2 + y * scale};
}, {x, y});
try {
  for (const touch of [false, true]) {
    const name = touch ? 'mobile' : 'desktop';
    const page = await browser.newPage({viewport: touch ? {width: 390, height: 844} : {width: 1440, height: 900}, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1});
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${name}: ${message.text()}`); });
    await page.goto(url); await page.waitForFunction(() => window.ashline?.assets.ready);
    await page.locator('#seed').fill('LARGE-MAP-BROWSER');
    await page.locator('#deploy')[touch ? 'tap' : 'click']();
    await page.waitForFunction(() => !ashline.paused);
    assert.deepEqual(await page.evaluate(() => [ashline.state.width, ashline.state.height, ashline.state.terrain.length]), [144, 112, 16128]);
    assert(await page.evaluate(() => {
      const e = ashline.state.entities.find(e => e.team === 0 && e.type === 'core'), p = ashline.renderer.worldToScreen(e.x + 1.5, e.y + 1.5, ashline.view);
      return p.x > 30 && p.x < innerWidth - 30 && p.y > 130 && p.y < innerHeight - 140;
    }), `${name}: deployment centers the actual relocated base`);
    if (await page.locator('#command-console').isVisible()) await page.locator('#command-toggle')[touch ? 'tap' : 'click']();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Keep real input active while advancing simulation deterministically in this fixture.
    await page.evaluate(() => { window.mapFixture = {raf: requestAnimationFrame}; requestAnimationFrame = frame => { mapFixture.frame = frame; return 0; }; });
    await page.waitForFunction(() => Boolean(mapFixture.frame));
    await page.screenshot({path: `${output}/map-${name}-normal.png`});
    const zoom = await page.evaluate(() => ashline.view.zoom);
    // Two tiles inset stays inside the canvas after touch coordinates round to pixels.
    for (const [x, y] of [[2, 2], [142, 2], [142, 110], [2, 110]]) {
      await click(page, await mapPoint(page, x, y), touch);
      assert(await page.evaluate(({x, y}) => {
        const {state: s, renderer: r, view: v} = ashline;
        const clamp = (value, pixels, extent) => Math.max(Math.min(extent / 2, pixels / v.zoom / 2), Math.min(extent - Math.min(extent / 2, pixels / v.zoom / 2), value));
        return Math.abs(v.x - clamp(x, r.width, s.width)) < 1.1 && Math.abs(v.y - clamp(y, r.height, s.height)) < 1.1;
      }, {x, y}), `${name}: minimap reaches corner ${x},${y}`);
    }
    await page.locator('#home')[touch ? 'tap' : 'click']();
    const performance = await page.evaluate(async () => {
      const {createGame} = await import('./sim.js'), {state: s, renderer: r, view: v} = ashline;
      const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const generation = []; for (let i = 0; i < 3; i++) { const start = performance.now(); createGame(`large-map-timing-${i}`); generation.push(performance.now() - start); }
      const start = performance.now(); r.createTerrain(s); const bakeMs = performance.now() - start;
      const draw = () => { const values = []; for (let i = 0; i < 12; i++) { const start = performance.now(); r.draw(s, v); values.push(performance.now() - start); } return median(values.slice(2)); };
      const initialDrawMs = draw(), original = {visible: s.visible[0].slice(), explored: s.explored[0].slice(), x: v.x, y: v.y, zoom: v.zoom, knownOre: r.knownOre.slice(), remembered: new Map(r.rememberedBuildings)};
      s.visible[0].fill(1); s.explored[0].fill(1); v.x = 94; v.y = 72; v.zoom = 16;
      const revealedDrawMs = draw();
      const caches = ['terrain', 'decals', 'fog', 'fogLow'].map(key => ({key, width: r[key].width, height: r[key].height}));
      s.visible[0].set(original.visible); s.explored[0].set(original.explored); r.knownOre = original.knownOre; r.rememberedBuildings = original.remembered;
      Object.assign(v, {x: original.x, y: original.y, zoom: original.zoom}); r.draw(s, v);
      return {generationMs: median(generation), bakeMs, initialDrawMs, revealedDrawMs, caches, cacheMiB: caches.reduce((n, c) => n + c.width * c.height * 4, 0) / 1048576};
    });
    measurements.push({device: name, ...performance});
    while (await page.evaluate(() => ashline.view.zoom > 16)) await page.locator('#zoom-out')[touch ? 'tap' : 'click']();
    await page.evaluate(() => { ashline.renderer.draw(ashline.state, ashline.view); });
    await page.screenshot({path: `${output}/map-${name}-minimum.png`});
    await page.evaluate(zoom => { ashline.view.zoom = zoom; }, zoom);

    const far = await page.evaluate(async () => {
      const {updateGame} = await import('./sim.js'), {state: s, renderer: r, view: v} = ashline;
      const mover = s.entities.find(e => e.team === 0 && e.type === 'scout');
      let point;
      for (let y = 62; y < s.height - 12 && !point; y++) for (let x = 80; x < s.width - 28; x++) {
        if (Array.from({length: 25}, (_, dx) => x + dx).every(xx => !s.blocked[y * s.width + xx] && !s.explored[0][y * s.width + xx])) { point = {x: x + .5, y: y + .5}; break; }
      }
      if (!point) throw new Error('No unexplored clear row in the expanded map');
      s.ai.nextThink = 1e12; Object.assign(mover, point, {order: {type: 'idle'}, path: [], targetId: null});
      const target = {x: point.x + 12, y: point.y}, farTile = Math.floor(point.y) * s.width + Math.floor(point.x + 23);
      s.fogClock = 0; updateGame(s, .05);
      Object.assign(v, {x: point.x + 6, y: point.y}); v.selected.clear(); r.draw(s, v);
      const enemy = s.entities.find(e => e.team === 1 && e.type === 'rifle'); Object.assign(enemy, {x: point.x + 23, y: point.y, order: {type: 'idle'}, path: []});
      const map = () => { r.drawMinimap(s, v, e => Boolean(s.visible[0][Math.floor(e.y) * s.width + Math.floor(e.x)])); return r.minimap.getContext('2d').getImageData(0, 0, r.minimap.width, r.minimap.height).data; };
      const compareEnemy = () => { const all = s.entities, before = map(); s.entities = all.filter(e => e !== enemy); const without = map(); s.entities = all; return before.reduce((n, byte, i) => n + (byte !== without[i] ? 1 : 0), 0); };
      window.mapFixture.compareEnemy = compareEnemy;
      return {id: mover.id, ...point, target, farTile, hidden: !s.explored[0][farTile], hiddenEnemyPixels: compareEnemy()};
    });
    assert(far.x > 72 && far.y > 56 && far.hidden); assert.equal(far.hiddenEnemyPixels, 0, 'Unseen enemy beyond the old edge is concealed on the minimap');
    await click(page, await worldPoint(page, far.x, far.y), touch);
    assert.deepEqual(await page.evaluate(() => [...ashline.view.selected]), [far.id]);
    if (touch) await page.locator('#move-order').tap();
    await click(page, await worldPoint(page, far.target.x, far.target.y), touch, 'right');
    assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, far.id), 'move');
    const moved = await page.evaluate(async ({id, target, farTile}) => {
      const {updateGame} = await import('./sim.js'), s = ashline.state;
      for (let i = 0; i < 120; i++) updateGame(s, .05);
      const unit = s.entities.find(e => e.id === id); ashline.renderer.draw(s, ashline.view);
      return {remaining: Math.hypot(unit.x - target.x, unit.y - target.y), revealed: s.explored[0][farTile], visible: s.visible[0][farTile], enemyPixels: mapFixture.compareEnemy()};
    }, far);
    assert(moved.remaining < 1 && moved.revealed && moved.visible && moved.enemyPixels > 0, `${name}: expanded terrain supports movement, discovery and minimap vision`);
    await page.screenshot({path: `${output}/map-${name}-expanded-orders.png`});

    await page.locator('#pause')[touch ? 'tap' : 'click']();
    await page.locator('#save-game')[touch ? 'tap' : 'click']();
    const saved = await page.evaluate(async () => { const {SAVE_KEY} = await import('./save.js'); return {key: SAVE_KEY, raw: localStorage.getItem(SAVE_KEY)}; });
    const record = JSON.parse(saved.raw); assert.deepEqual([record.game.width, record.game.height], [144, 112]); assert(record.view.x > 72 && record.view.y > 56);
    await page.evaluate(() => { ashline.view.x = 20; ashline.view.y = 20; });
    await page.locator('#load-game')[touch ? 'tap' : 'click']();
    assert.deepEqual(await page.evaluate(() => ({x: ashline.view.x, y: ashline.view.y, zoom: ashline.view.zoom})), record.view);
    assert(await page.evaluate(({id, farTile}) => ashline.paused && ashline.state.explored[0][farTile] && ashline.state.entities.find(e => e.id === id).x > 72, far));

    // Loading old dimensions after a large match must resize caches and camera limits.
    await page.evaluate(async () => {
      const {createGame} = await import('./sim.js'), {saveGame} = await import('./save.js');
      const legacy = createGame('LEGACY-BROWSER', 'normal', {width: 72, height: 56});
      const result = saveGame(legacy, {x: 36, y: 28, zoom: 30}); if (!result.ok) throw new Error(result.reason);
    });
    await page.locator('#load-game')[touch ? 'tap' : 'click']();
    assert.deepEqual(await page.evaluate(() => [ashline.state.width, ashline.state.height, ashline.view.x, ashline.view.y]), [72, 56, 36, 28]);
    await page.evaluate(({key, raw}) => localStorage.setItem(key, raw), saved);
    await page.locator('#load-game')[touch ? 'tap' : 'click']();
    assert.deepEqual(await page.evaluate(() => [ashline.state.width, ashline.state.height]), [144, 112]);
    assert.deepEqual(await page.evaluate(() => ({x: ashline.view.x, y: ashline.view.y, zoom: ashline.view.zoom})), record.view);
    await page.locator('#resume')[touch ? 'tap' : 'click']();
    await page.evaluate(() => { requestAnimationFrame = mapFixture.raf; requestAnimationFrame(mapFixture.frame); });
    await page.waitForFunction(time => ashline.state.time > time, record.game.time);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(measurements, null, 2));
  console.log(`Expanded map browser checks passed: 144×112 deployment, four corners, far-side selection/movement/fog, large/legacy save transitions, desktop/mobile screenshots. Review: ${output}`);
} finally { await browser.close(); }
