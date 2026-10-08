// Player gestures, quoted earthworks, one atomic build, and one complete Undo.
// Only isolated browser storage and a vacant patch of a real generated world are used.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-auto-level-construction';
await mkdir(output, { recursive: true });
const errors = [], results = [];

async function prepare(page, kind) {
  return page.evaluate(async kind => {
    const g = transport.game;
    const { releaseTerrainObjects } = await import('./terrain-objects.js');
    const { validateGame } = await import('./model.js');
    let site = window.autoLevelQA?.site;
    if (!site) {
      outer: for (let y = 40; y < g.height - 48; y += 32) for (let x = 40; x < g.width - 48; x += 32) {
        if ([...g.cities, ...g.industries, ...g.stations].some(p => p.x >= x - 16 && p.x <= x + 38 && p.y >= y - 16 && p.y <= y + 32)) continue;
        for (let dy = -10; dy <= 24; dy++) for (let dx = -10; dx <= 30; dx++) {
          const t = g.tiles[(y + dy) * g.width + x + dx];
          if (t.road || t.rail || t.bridge || t.tunnel || t.building || t.zone) continue outer;
        }
        site = { x, y }; break outer;
      }
      if (!site) throw new Error('No vacant automatic-earthworks test site.');
      const renderer = transport.renderer, render = renderer.render;
      window.autoLevelQA = { site, path: [] };
      renderer.render = (now, view = {}) => {
        autoLevelQA.path = (view.preview || []).map(({ x, y }) => ({ x, y }));
        return render(now, view);
      };
    }
    const cleared = [];
    for (let dy = -9; dy <= 23; dy++) for (let dx = -9; dx <= 29; dx++) cleared.push({ x: site.x + dx, y: site.y + dy });
    releaseTerrainObjects(g, cleared);
    for (const { x, y } of cleared) {
      const t = g.tiles[y * g.width + x];
      Object.assign(t, { terrain: 'grass', elevation: 2 / 7, detail: '', variant: 0, road: false, rail: false, bridge: false, tunnel: false, building: null, zone: null });
      delete t.publicRoad; delete t.structureAxis; delete t.structureLevel;
    }
    const a = { x: site.x, y: site.y }, b = { x: site.x + (kind === 'slope' ? 6 : 12), y: site.y }, water = [];
    if (kind === 'slope') {
      // The first tile has a compound corner, so even a freely routed drag
      // must repair it; choosing another path cannot bypass the endpoint.
      g.tiles[a.y * g.width + a.x].elevation = 3 / 7;
    } else {
      const tunnel = kind === 'tunnel';
      const levels = tunnel ? [2, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3] : [2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3];
      for (let dx = 0; dx < levels.length; dx++) for (let across = -3; across <= 3; across++) {
        const x = site.x + dx, y = site.y + across, tile = g.tiles[y * g.width + x];
        tile.elevation = levels[dx] / 7;
        if (kind === 'water' && dx >= 4 && dx <= 8) {
          tile.terrain = 'water'; tile.elevation = 0; water.push({ x, y });
        }
      }
    }
    g.money = 1_000_000; g.revision++; g.networkRevision++;
    transport.renderer.setZoom(1); autoLevelQA.path = [];
    if (!validateGame(g)) throw new Error('Earthworks browser fixture must preserve a loadable generated world.');
    return { site, a, b, water };
  }, kind);
}

async function state(page, site) {
  return page.evaluate(site => {
    const g = transport.game, tiles = [];
    for (let dy = -10; dy <= 24; dy++) for (let dx = -10; dx <= 30; dx++) tiles.push(g.tiles[(site.y + dy) * g.width + site.x + dx]);
    return { money: g.money, monthlyExpenses: g.monthlyExpenses, totalExpenses: g.totalExpenses, day: g.day, tiles: JSON.stringify(tiles) };
  }, site);
}

async function drawer(page) {
  if (!await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open'))) await page.locator('.main-nav [data-view="build"]').click();
}

async function choose(page, tool) {
  if (tool === 'road' || tool === 'rail') { await page.locator(`[data-toolbar-tool="${tool}"]`).click(); return; }
  await drawer(page);
  if (!await page.locator('.engineering-tools').evaluate(el => el.open)) await page.locator('.engineering-tools summary').click();
  await page.locator(`[data-crossing-mode="${tool.startsWith('rail') ? 'rail' : 'road'}"]`).click();
  await drawer(page); await page.locator(`[data-tool="${tool}"]`).click();
}

async function begin(page, fixture, { shift = false } = {}) {
  const screen = await page.evaluate(({ a, b }) => {
    transport.renderer.focus((a.x + b.x) / 2, (a.y + b.y) / 2);
    const rect = document.querySelector('#world').getBoundingClientRect();
    return [a, b].map(p => { const q = transport.renderer.worldToScreen(p.x, p.y); return { x: rect.left + q.x, y: rect.top + q.y }; });
  }, fixture);
  for (const point of screen) assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, point), 'world', 'the actual map receives each pointer endpoint');
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(screen[0].x, screen[0].y); await page.mouse.down();
  await page.mouse.move(screen[1].x, screen[1].y, { steps: 6 });
  await page.waitForFunction(({ a, b }) => {
    const p = autoLevelQA.path;
    return p.length > 1 && p[0].x === a.x && p[0].y === a.y && p.at(-1).x === b.x && p.at(-1).y === b.y;
  }, fixture);
  return page.locator('#placement-tip').innerText();
}

async function end(page) { await page.mouse.up(); await page.keyboard.up('Shift'); }
async function quote(page, tool) {
  return page.evaluate(async tool => {
    const { quoteBuildPlan } = await import('./construction-plan.js');
    const { networkTerrainPlanIssues, planStructureSpan } = await import('./terrain-engineering.js');
    const path = autoLevelQA.path, plan = quoteBuildPlan(transport.game, tool, path);
    const originalProblem = tool === 'road' || tool === 'rail'
      ? networkTerrainPlanIssues(transport.game, path.map(p => ({ ...p, tool })))
      : planStructureSpan(transport.game, tool, path);
    return { ...plan, path, originalProblem };
  }, tool);
}

function checkPrice(tip, plan, label) {
  assert.equal(plan.ok, true, `${label}: ${plan.message}`);
  assert.ok(plan.terrain.length > 0 && plan.terrainCost > 0, `${label} needs real terrain work`);
  assert.equal(plan.cost, plan.networkCost + plan.terrainCost);
  assert.equal(Number(tip.match(/\$([\d,]+)/)?.[1].replaceAll(',', '')), plan.cost, 'the player sees the complete price before release');
  assert.match(tip, new RegExp(`includes \\$${plan.terrainCost.toLocaleString('en-US')} leveling`), 'the price explains its included earthworks');
}

async function checkBuilt(page, fixture, tool, plan, before) {
  const after = await state(page, fixture.site);
  assert.equal(before.money - after.money, plan.cost, 'release spends the exact terrain-inclusive quote');
  assert.equal(after.monthlyExpenses - before.monthlyExpenses, plan.cost);
  assert.equal(after.totalExpenses - before.totalExpenses, plan.cost);
  assert.notEqual(after.tiles, before.tiles);
  const built = await page.evaluate(async ({ tool, plan, a, b, water }) => {
    const g = transport.game, mode = tool.startsWith('rail') ? 'rail' : 'road';
    const { findPath, validateGame } = await import('./model.js');
    return {
      connected: Boolean(findPath(g, a, b, mode)), valid: validateGame(g),
      terrain: plan.terrain.map(p => g.tiles[p.y * g.width + p.x].elevation),
      cells: plan.path.map(p => g.tiles[p.y * g.width + p.x]),
      water: water.map(p => ({ terrain: g.tiles[p.y * g.width + p.x].terrain, elevation: g.tiles[p.y * g.width + p.x].elevation })),
    };
  }, { ...fixture, tool, plan });
  assert.equal(built.connected, true, 'the complete gesture produces a usable connection');
  assert.equal(built.valid, true);
  assert.deepEqual(built.terrain, plan.terrain.map(p => p.level / 7), 'quoted terrain edits are the terrain actually committed');
  assert.deepEqual(built.water, fixture.water.map(() => ({ terrain: 'water', elevation: 0 })), 'engineering the banks never fills or raises the river');
  assert.ok(plan.terrain.every(p => !fixture.water.some(w => p.x === w.x && p.y === w.y)), 'water vertices never become charged earthworks');
  if (tool.includes('bridge') || tool.includes('tunnel')) {
    const structure = tool.includes('bridge') ? 'bridge' : 'tunnel';
    assert.ok(built.cells.slice(1, -1).every(t => t[structure] && t.structureAxis === 'x'), 'every interior tile belongs to the explicit span');
  }
  return after;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.goto(url); await createWorldFromMenu(page);
  await page.locator('#dismiss-objective').click();
  let lastFixture;
  for (const [tool, kind, shift] of [
    ['road', 'slope', false], ['road', 'slope', true], ['rail', 'slope', true],
    ['bridge', 'bridge', false], ['railbridge', 'bridge', false],
    ['bridge', 'water', false], ['railbridge', 'water', false],
    ['tunnel', 'tunnel', false], ['railtunnel', 'tunnel', false],
  ]) {
    const label = `${tool}${kind === 'water' ? '-water' : ''}${shift ? '-straight' : ''}`, fixture = await prepare(page, kind);
    lastFixture = fixture;
    await choose(page, tool);
    const before = await state(page, fixture.site), tip = await begin(page, fixture, { shift }), plan = await quote(page, tool);
    checkPrice(tip, plan, label);
    if (kind === 'slope') assert.ok(plan.originalProblem.length > 0, 'the same actual path previously required manual leveling');
    else assert.equal(plan.originalProblem.ok, false, 'the same banks or portals previously rejected this span');
    assert.deepEqual(await state(page, fixture.site), before, 'hovering and dragging a priced preview never edits or charges');
    await page.screenshot({ path: `${output}/${label}-preview.png` });

    if (label === 'road') {
      await page.keyboard.press('Escape'); await end(page);
      assert.deepEqual(await state(page, fixture.site), before, 'Escape cancels network and terrain work together');
      await choose(page, tool); checkPrice(await begin(page, fixture), await quote(page, tool), label);
    }
    await end(page); await checkBuilt(page, fixture, tool, plan, before);
    await page.locator('#world').focus(); await page.keyboard.press('Control+z');
    assert.deepEqual(await state(page, fixture.site), before, 'one Undo restores terrain, networks and the entire charge');

    if (label === 'road-straight') {
      assert.ok(plan.cost - 1 >= plan.networkCost, 'the test company can afford the network alone');
      await page.evaluate(balance => { transport.game.money = balance; }, plan.cost - 1);
      await choose(page, tool); const poorBefore = await state(page, fixture.site);
      const refusedTip = await begin(page, fixture, { shift }), refused = await quote(page, tool);
      assert.equal(refused.ok, false); assert.equal(refused.cost, plan.cost);
      assert.match(refusedTip, /Need \$/);
      assert.equal(await page.locator('#placement-tip').evaluate(el => el.classList.contains('invalid')), true);
      await page.screenshot({ path: `${output}/unaffordable-preview.png` });
      await end(page); assert.deepEqual(await state(page, fixture.site), poorBefore, 'a budget covering track but not earthworks commits nothing');
      await page.evaluate(() => { transport.game.money = 1_000_000; });
    }

    // Keep one successful version for the subsequent real save/load check.
    await choose(page, tool); const rebuildBefore = await state(page, fixture.site);
    const rebuildTip = await begin(page, fixture, { shift }), rebuild = await quote(page, tool);
    checkPrice(rebuildTip, rebuild, label); await end(page);
    await checkBuilt(page, fixture, tool, rebuild, rebuildBefore);
    results.push({ tool, kind, shift, tiles: plan.path.length, terrainPoints: plan.terrain.length, terrainCost: plan.terrainCost, networkCost: plan.networkCost, total: plan.cost });
  }
  const saved = await state(page, lastFixture.site);
  assert.equal(await page.evaluate(() => transport.persist()), true);
  const savedAccounting = await page.evaluate(() => {
    const { money, monthlyExpenses, totalExpenses, day } = JSON.parse(localStorage.getItem('transport-save-v1')).state;
    return { money, monthlyExpenses, totalExpenses, day };
  });
  const { tiles: savedTiles, ...accounting } = saved;
  assert.deepEqual(savedAccounting, accounting, 'the actual autosave records the complete construction charge');
  await page.reload(); await loadAutosaveFromMenu(page);
  // A restored world runs at speed 1 until the real Pause click lands. Its
  // upkeep and decorative undergrowth can advance, but engineering cannot.
  const loaded = await state(page, lastFixture.site);
  const construction = serialized => JSON.parse(serialized).map(({ detail, ...tile }) => tile);
  assert.deepEqual(construction(loaded.tiles), construction(savedTiles), 'the combined terrain and network construction survives the real autosave round trip');
  const activeMs = await page.evaluate(() => transport.simulation.getStats().activeMs);
  assert.ok(Math.abs(loaded.day - saved.day - activeMs / 1000) < 1e-6, 'reload advances only its fresh active clock');
  assert.equal(await page.evaluate(async () => (await import('./model.js')).validateGame(transport.game)), true);
  await page.evaluate(({ a, b }) => { transport.renderer.setZoom(1); transport.renderer.focus((a.x + b.x) / 2, a.y); }, lastFixture);
  await page.screenshot({ path: `${output}/loaded-earthworks.png` });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, results, screenshots: output }, null, 2));
  await page.close();
} finally { await browser.close(); }
