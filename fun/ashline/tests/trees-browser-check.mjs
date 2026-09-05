// Browser QA: set ASHLINE_PLAYWRIGHT, ASHLINE_URL, and optionally ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-trees-qa';
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, hasTouch: true}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8131/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  const graphics = await page.evaluate(async () => {
    const {drawProp, drawPropShadow, spriteStats} = await import('./assets.js');
    document.querySelector('#briefing').close();
    const sheet = document.createElement('canvas'); sheet.id = 'tree-atlas-preview'; sheet.width = 900; sheet.height = 220;
    sheet.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;width:900px;height:220px'; document.body.append(sheet);
    const ctx = sheet.getContext('2d'); ctx.fillStyle = '#242b2a'; ctx.fillRect(0, 0, 900, 220);
    ctx.font = '14px sans-serif'; ctx.fillStyle = '#dbe4de'; ctx.fillText('ASHLINE — six desolate tree varieties',16,24);
    const fingerprints = [];
    for (let variant = 0; variant < 6; variant++) {
      drawPropShadow(ctx, 'tree', 75 + variant * 150, 105, 110, variant);
      if (!drawProp(ctx, 'tree', 75 + variant * 150, 105, 110, variant)) throw new Error('Tree atlas unavailable');
      ctx.fillStyle = '#dbe4de'; ctx.fillText(`Variant ${variant + 1}`, 40 + variant * 150, 200);
      const data = ctx.getImageData(variant * 150, 35, 150, 145).data;
      fingerprints.push(data.reduce((hash, value) => (Math.imul(hash, 31) + value) | 0, 17));
    }
    return {stats: spriteStats(), unique: new Set(fingerprints).size};
  });
  assert.equal(graphics.stats.loaded, 7); assert.equal(graphics.stats.props.tree, 6); assert.equal(graphics.unique, 6, 'Six visually distinct tree sprites');
  await page.locator('#tree-atlas-preview').screenshot({path: `${output}/tree-varieties.png`});
  await page.evaluate(() => { document.querySelector('#tree-atlas-preview').remove(); document.querySelector('#briefing').showModal(); });
  await page.locator('#seed').fill('TREES-BROWSER'); await page.locator('#deploy').click();
  await page.waitForFunction(() => !ashline.paused);
  if (await page.locator('#command-console').isVisible()) await page.locator('#command-toggle').click();
  await page.evaluate(() => { window.treesFixture = {raf: requestAnimationFrame}; requestAnimationFrame = frame => { treesFixture.frame = frame; return 0; }; });
  await page.waitForFunction(() => Boolean(treesFixture.frame));

  const placement = await page.evaluate(async () => {
    const {createGame} = await import('./sim.js'), {encodeGame, decodeGame} = await import('./save.js'), r = ashline.renderer;
    const trees = () => r.rockProps.filter(p => p.kind === 'tree');
    const rows = [];
    for (const dimensions of [undefined, {width: 72, height: 56}]) {
      const s = createGame('TREES-DETERMINISM', 'normal', dimensions);
      const before = ['terrain', 'minerals', 'blocked', 'regions'].map(key => [key, s[key].slice()]);
      r.createTerrain(s); const first = JSON.stringify(trees()), count = trees().length;
      const invalid = trees().filter(p => {
        const x = Math.floor(p.x), y = Math.floor(p.y), i = y * s.width + x;
        return s.terrain[i] !== 4 || s.minerals[i] > 0 || !s.blocked[i] || s.entities.some(e => e.kind === 'building' && x >= e.x && x < e.x + e.size && y >= e.y && y < e.y + e.size);
      }).length;
      const variants = new Set(trees().map(p => p.variant)).size, rocks = r.rockProps.filter(p => p.kind === 'rock').length;
      const sectors = new Set(trees().map(p => `${Math.floor(p.x / s.width * 4)},${Math.floor(p.y / s.height * 4)}`)).size;
      const treeTiles = s.terrain.reduce((n, tile) => n + (tile === 4), 0);
      r.createTerrain(s); const repeated = JSON.stringify(trees()) === first;
      r.createTerrain(decodeGame(encodeGame(s)).game); const restored = JSON.stringify(trees()) === first;
      r.createTerrain(createGame('TREES-OTHER-SEED', 'normal', dimensions));
      rows.push({width: s.width, count, invalid, variants, rocks, sectors, treeTiles, repeated, restored, varied: JSON.stringify(trees()) !== first, unchanged: before.every(([key, values]) => s[key].every((value, i) => value === values[i]))});
    }
    r.createTerrain(ashline.state); return rows;
  });
  for (const row of placement) {
    assert(row.count > 6 && row.rocks > 6 && row.variants === 6, `Tree variety retains basalt formations on width ${row.width}`);
    assert.equal(row.invalid, 0, 'Scattered trees match their own root obstacles outside ore, lava and building footprints');
    assert.equal(row.count, row.treeTiles, 'Every generated tree is rendered once');
    assert(row.sectors >= 10, 'Trees appear across the map rather than only in a few mountain groves');
    assert(row.repeated && row.restored && row.varied && row.unchanged, 'Placement is seeded, save-stable and leaves simulation topology unchanged');
  }

  const legacyTrees = await page.evaluate(async () => {
    const {createGame} = await import('./sim.js'), {encodeGame, decodeGame} = await import('./save.js'), r = ashline.renderer;
    const s = createGame('TREES-LEGACY', 'normal', {width: 72, height: 56});
    s.terrain = s.terrain.map(tile => tile === 4 ? 0 : tile); s.navVersion++;
    const snapshot = () => JSON.stringify(r.rockProps.filter(p => p.kind === 'tree'));
    r.createTerrain(s); const first = snapshot(), count = r.rockProps.filter(p => p.kind === 'tree').length;
    r.createTerrain(decodeGame(encodeGame(s)).game); const same = snapshot() === first;
    r.createTerrain(ashline.state); return {count, same};
  });
  assert(legacyTrees.count > 6 && legacyTrees.same, 'Older saves retain their existing deterministic rocky groves');

  const fog = await page.evaluate(async () => {
    const {UNITS} = await import('./sim.js'), {state: s, renderer: r, view: v} = ashline;
    const original = {entities: s.entities, visible: s.visible[0].slice(), explored: s.explored[0].slice(), props: r.rockProps, time: s.time};
    const prop = r.rockProps.find(p => p.kind === 'tree' && p.variant < 4 && p.x > 20 && p.x < s.width - 20 && p.y > 18 && p.y < s.height - 18);
    if (!prop) throw new Error('No interior tree for fog check');
    s.entities = []; s.effects = []; r.rememberedBuildings.clear(); r.rockProps = [prop];
    Object.assign(v, {x: prop.x, y: prop.y, zoom: 38}); v.selected.clear();
    const pixels = () => { r.draw(s, v); return r.ctx.getImageData(0, 0, r.canvas.width, r.canvas.height).data; };
    const difference = (a, b) => a.reduce((n, byte, i) => n + (byte !== b[i] ? 1 : 0), 0);
    const sample = visibility => {
      s.visible[0].fill(visibility === 'visible' ? 1 : 0); s.explored[0].fill(visibility === 'unknown' ? 0 : 1);
      r.rockProps = [prop]; const tree = pixels(); r.rockProps = []; const absent = pixels(); return difference(tree, absent);
    };
    const visible = sample('visible'), remembered = sample('remembered'), unknown = sample('unknown');
    r.rockProps = [prop]; s.visible[0].fill(0); s.explored[0].fill(1);
    const x = Math.floor(prop.x), y = Math.floor(prop.y); s.visible[0][y * s.width + x] = 1;
    const beforeEnemy = pixels(), template = original.entities.find(e => e.type === 'rifle');
    // Adjacent hidden infantry lies under the branch edge but may not fade the canopy.
    const hiddenX = x + (prop.x - x < .5 ? -.02 : 1.02);
    s.entities = [{...structuredClone(template), id: s.nextId + 1, team: 1, x: hiddenX, y: prop.y - .15, hp: UNITS.rifle.hp, order: {type: 'idle'}, path: []}];
    const concealedEnemy = difference(beforeEnemy, pixels());
    s.entities = original.entities; s.visible[0].set(original.visible); s.explored[0].set(original.explored); r.rockProps = original.props; s.time = original.time;
    return {visible, remembered, unknown, concealedEnemy};
  });
  assert(fog.visible > 100 && fog.remembered > 30, 'Visible and remembered trees remain part of the landscape');
  assert.equal(fog.unknown, 0, 'Unexplored trees cannot show through fog');
  assert.equal(fog.concealedEnemy, 0, 'Hidden enemies cannot reveal themselves by changing tree opacity');

  const scene = await page.evaluate(async () => {
    const {UNITS} = await import('./sim.js'), {state: s, renderer: r, view: v} = ashline;
    const trees = r.rockProps.filter(p => p.kind === 'tree' && p.x > 14 && p.x < s.width - 14 && p.y > 16 && p.y < s.height - 16);
    const score = p => trees.filter(q => Math.hypot(p.x - q.x, p.y - q.y) < 6).length * 3 + s.minerals.reduce((n, amount, i) => n + (amount > 0 && Math.hypot(i % s.width - p.x, Math.floor(i / s.width) - p.y) < 7 ? 1 : 0), 0);
    const scores = new Map(trees.map(p => [p, score(p)])), candidates = trees.sort((a, b) => scores.get(b) - scores.get(a));
    let anchor, ground;
    for (const tree of candidates) {
      const tiles = [];
      for (let y = Math.floor(tree.y) - 3; y <= Math.floor(tree.y) + 4; y++) for (let x = Math.floor(tree.x) - 4; x <= Math.floor(tree.x) + 4; x++) {
        if (!s.blocked[y * s.width + x] && !s.minerals[y * s.width + x]) tiles.push({x: x + .5, y: y + .5});
      }
      ground = [];
      for (const p of tiles.sort((a, b) => Math.hypot(a.x - tree.x, a.y - tree.y) - Math.hypot(b.x - tree.x, b.y - tree.y))) if (ground.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= 1.1)) ground.push(p);
      if (ground.length >= 6) { anchor = tree; break; }
    }
    if (!anchor) throw new Error('No tree grove with adjacent staging ground');
    const template = s.entities.find(e => e.team === 0 && e.type === 'rifle');
    s.entities = s.entities.filter(e => e.kind === 'building');
    const units = ['rifle', 'rocket', 'scout', 'tank', 'artillery', 'harvester'].map((type, i) => {
      const d = UNITS[type], e = {...structuredClone(template), id: s.nextId++, type, ...ground[i], hp: d.hp, maxHp: d.hp, size: d.size, angle: i * Math.PI / 3, order: {type: 'idle'}, path: [], targetId: null, cargo: 150};
      s.entities.push(e); return {id: e.id, type, x: e.x, y: e.y};
    });
    s.effects = []; s.visible[0].fill(1); s.explored[0].fill(1); s.time = 2.5;
    window.treeScene = zoom => {
      r.resize();
      const clamp = (value, pixels, extent) => Math.max(Math.min(extent / 2, pixels / zoom / 2), Math.min(extent - Math.min(extent / 2, pixels / zoom / 2), value));
      Object.assign(v, {x: clamp(anchor.x, r.width, s.width), y: clamp(anchor.y + 1, r.height, s.height), zoom}); r.lastMinimap = -Infinity; r.draw(s, v);
    };
    treeScene(38); return {units, anchor};
  });
  for (const [name, viewport, normalZoom] of [['desktop', {width: 1440, height: 900}, 38], ['mobile', {width: 390, height: 844}, 24]]) {
    await page.setViewportSize(viewport);
    for (const zoom of [normalZoom, 16]) {
      await page.evaluate(zoom => treeScene(zoom), zoom);
      const unit = scene.units.find(e => e.type === 'rocket');
      const point = await page.evaluate(unit => { const p = ashline.renderer.worldToScreen(unit.x, unit.y, ashline.view), r = document.querySelector('#world').getBoundingClientRect(); return {x: p.x + r.x, y: p.y + r.y}; }, unit);
      if (name === 'mobile') await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
      assert(await page.evaluate(id => ashline.view.selected.has(id), unit.id), 'Military units beside trees remain selectable');
      await page.evaluate(zoom => treeScene(zoom), zoom);
      await page.screenshot({path: `${output}/trees-${name}-${zoom}.png`});
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({placement, fog}, null, 2));
  console.log(`Tree browser checks passed: six varieties, scattered root obstacles across sectors, seeded/save-stable placement, legacy groves, mineral/lava/building exclusion, fog and concealed-enemy opacity, desktop/mobile unit selection and zoom previews. Review: ${output}`);
} finally { await browser.close(); }
