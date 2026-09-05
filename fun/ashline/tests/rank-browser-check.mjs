// Browser QA: set ASHLINE_PLAYWRIGHT, ASHLINE_URL, and optionally ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-rank-qa';
await mkdir(output, {recursive: true});
const clickUnit = async (page, id, touch = false) => {
  const p = await page.evaluate(id => {
    const e = ashline.state.entities.find(e => e.id === id), p = ashline.renderer.worldToScreen(e.x, e.y, ashline.view), r = document.querySelector('#world').getBoundingClientRect();
    return {x: p.x + r.x, y: p.y + r.y};
  }, id);
  if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
};
const rankHUD = page => page.locator('#selection-rank').evaluate(e => ({hidden: e.hidden, rank: Number(e.dataset.rank), kills: Number(e.dataset.kills), text: e.textContent, description: e.getAttribute('aria-label')}));
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, hasTouch: true}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8131/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  await page.locator('#seed').fill('RANK-BROWSER'); await page.locator('#deploy').click();
  await page.waitForFunction(() => !ashline.paused);
  if (await page.locator('#command-console').isVisible()) await page.locator('#command-toggle').click();
  await page.evaluate(() => { window.rankFixture = {raf: requestAnimationFrame}; requestAnimationFrame = frame => { rankFixture.frame = frame; return 0; }; });
  await page.waitForFunction(() => Boolean(rankFixture.frame));

  const setup = await page.evaluate(async () => {
    const {UNITS} = await import('./sim.js'), {state: s, renderer: r, view: v} = ashline;
    rankFixture.templates = {rifle: structuredClone(s.entities.find(e => e.team === 0 && e.type === 'rifle')), harvester: structuredClone(s.entities.find(e => e.team === 0 && e.type === 'harvester'))};
    const killer = s.entities.find(e => e.team === 0 && e.type === 'rifle');
    s.entities = s.entities.filter(e => e.kind === 'building' || e === killer); s.ai.nextThink = 1e12;
    for (let y = 65; y < 85; y++) for (let x = 80; x < 108; x++) { s.terrain[y * s.width + x] = 0; s.minerals[y * s.width + x] = 0; }
    s.navVersion++; Object.assign(killer, {x: 90.5, y: 73.5, kills: 0, hp: UNITS.rifle.hp, maxHp: UNITS.rifle.hp, cooldown: 0, order: {type: 'idle'}, path: [], targetId: null});
    Object.assign(v, {x: killer.x, y: killer.y, zoom: 38}); v.selected.clear();
    s.visible[0].fill(1); s.explored[0].fill(1); r.createTerrain(s); r.draw(s, v);
    return {id: killer.id, hp: UNITS.rifle.hp};
  });
  await clickUnit(page, setup.id);
  let hud = await rankHUD(page);
  assert(!hud.hidden && hud.rank === 0 && hud.kills === 0 && /0\/5 kills/.test(hud.text));
  for (const before of [4, 9, 14]) {
    const result = await page.evaluate(async ({id, before}) => {
      const {UNITS, unitStats, issueOrder, updateGame} = await import('./sim.js'), s = ashline.state, unit = s.entities.find(e => e.id === id);
      unit.kills = before; const previous = unitStats(unit); unit.maxHp = previous.hp; unit.hp = previous.hp - 30;
      unit.cooldown = 0; unit.path = []; unit.targetId = null; s.teams[0].kills = before;
      const target = {...structuredClone(rankFixture.templates.rifle), id: s.nextId++, team: 1, x: unit.x + 3, y: unit.y, hp: 1, maxHp: UNITS.rifle.hp, kills: 0, cooldown: 1e6, order: {type: 'idle'}, path: []};
      s.entities.push(target); s.fogClock = 0;
      issueOrder(s, [id], {type: 'attack', targetId: target.id, x: target.x, y: target.y});
      for (let i = 0; i < 100 && unit.kills === before; i++) updateGame(s, .05);
      s.effects = []; ashline.renderer.draw(s, ashline.view);
      return {kills: unit.kills, hp: unit.hp, maxHp: unit.maxHp, stats: unitStats(unit)};
    }, {id: setup.id, before});
    const expectedRank = (before + 1) / 5;
    assert.equal(result.kills, before + 1); assert.equal(result.stats.rank, expectedRank);
    assert(Math.abs(result.maxHp - setup.hp * (1 + expectedRank * .2)) < 1e-6);
    assert(Math.abs(result.hp - (result.maxHp - 30)) < 1e-6, 'Promotion preserves missing HP');
    await clickUnit(page, setup.id); hud = await rankHUD(page);
    assert.equal(hud.rank, expectedRank); assert.equal(hud.kills, before + 1); assert(hud.text.includes(`+${expectedRank * 20}%`));
    assert(hud.description.includes(`Damage ${Number(result.stats.damage.toFixed(2))}, speed ${Number(result.stats.speed.toFixed(2))} tiles/second, maximum HP ${result.stats.hp}`), 'Selected HUD exposes the actual promoted damage, speed and max HP');
    assert((await page.locator('#selection-detail').textContent()).includes(`${Math.ceil(result.hp)} / ${result.maxHp}`));
    await page.screenshot({path: `${output}/promotion-${expectedRank}.png`});
  }

  await page.locator('#pause').click(); await page.locator('#save-game').click();
  const saved = await page.evaluate(async () => { const {SAVE_KEY} = await import('./save.js'); return JSON.parse(localStorage.getItem(SAVE_KEY)); });
  assert(saved.game.entities.some(e => e.id === setup.id && e.kills === 15 && e.maxHp === 168));
  await page.evaluate(id => { const e = ashline.state.entities.find(e => e.id === id); e.kills = 0; e.maxHp = e.hp = 105; }, setup.id);
  await page.locator('#load-game').click();
  assert(await page.evaluate(id => { const e = ashline.state.entities.find(e => e.id === id); return ashline.paused && e.kills === 15 && e.maxHp === 168 && e.hp === 138; }, setup.id));
  await page.locator('#resume').click(); await clickUnit(page, setup.id);
  hud = await rankHUD(page); assert.equal(hud.rank, 3); assert.equal(hud.kills, 15); assert(hud.description.includes('Maximum rank.'));

  const marks = await page.evaluate(async () => {
    const {UNITS, createGame, unitStats} = await import('./sim.js'), {Renderer} = await import('./render.js');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:absolute;width:192px;height:160px;opacity:0'; document.body.append(canvas);
    const r = new Renderer(canvas, null), s = createGame('rank-graphics', 'normal', {width: 72, height: 56});
    s.terrain.fill(0); s.minerals.fill(0); s.entities = []; s.effects = []; s.visible[0].fill(1); s.explored[0].fill(1); r.createTerrain(s);
    const v = {x: 30.5, y: 30.5, zoom: 38, selected: new Set()}, rows = [];
    const fills = [], nativeFill = r.ctx.fill;
    r.ctx.fill = function (...args) { fills.push(this.fillStyle); return nativeFill.apply(this, args); };
    for (const zoom of [16, 24, 38]) for (const type of Object.keys(UNITS)) for (let rank = 0; rank <= 3; rank++) {
      v.zoom = zoom; const e = {...structuredClone(rankFixture.templates[type === 'harvester' ? type : 'rifle']), type, x: v.x, y: v.y, kills: rank * 5, size: UNITS[type].size};
      Object.assign(e, {hp: unitStats(e).hp, maxHp: unitStats(e).hp}); r.ctx.clearRect(0, 0, canvas.width, canvas.height); fills.length = 0; r.drawUnitRank(e, v);
      const pixels = r.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      rows.push({type, zoom, rank, active: fills.filter(color => color === '#e4b975').length, empty: fills.filter(color => color === '#506167').length, pixels: pixels.filter((value, i) => i % 4 === 3 && value > 64).length});
    }
    r.ctx.fill = nativeFill;
    const enemy = {...structuredClone(rankFixture.templates.rifle), team: 1, x: v.x, y: v.y, kills: 0};
    const pixels = () => { r.draw(s, v); return r.ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
    const difference = (a, b) => a.reduce((n, value, i) => n + (value !== b[i] ? 1 : 0), 0);
    s.entities = [enemy]; s.visible[0].fill(0); const hiddenRookie = pixels(); enemy.kills = 15; enemy.hp = enemy.maxHp = unitStats(enemy).hp;
    const hiddenElite = pixels(); s.entities = []; const absent = pixels();
    s.entities = [enemy]; s.visible[0].fill(1); const visibleElite = pixels(); enemy.kills = 0; enemy.hp = enemy.maxHp = unitStats(enemy).hp; const visibleRookie = pixels();
    canvas.remove(); return {rows, hiddenRank: difference(hiddenRookie, hiddenElite), hiddenUnit: difference(hiddenElite, absent), visibleRank: difference(visibleElite, visibleRookie)};
  });
  for (const row of marks.rows) { assert.equal(row.active, row.rank); assert.equal(row.empty, 3 - row.rank); assert(row.pixels > 30, `${row.type}: rank slots remain visible at zoom ${row.zoom}`); }
  assert.equal(marks.hiddenRank, 0); assert.equal(marks.hiddenUnit, 0); assert(marks.visibleRank > 20, 'Visible enemy ranks change their markers; hidden units expose no rank pixels');

  const grid = await page.evaluate(async () => {
    const {UNITS, unitStats} = await import('./sim.js'), {state: s, renderer: r, view: v} = ashline;
    s.entities = s.entities.filter(e => e.kind === 'building'); s.effects = []; const units = [];
    Object.keys(UNITS).forEach((type, row) => {
      for (let rank = 0; rank <= 3; rank++) {
        const e = {...structuredClone(rankFixture.templates[type === 'harvester' ? type : 'rifle']), id: s.nextId++, type, size: UNITS[type].size, x: 86 + rank * 3.2, y: 67 + row * 2.5, kills: rank * 5, angle: row * .4, order: {type: 'idle'}, path: [], targetId: null, cooldown: 0};
        e.hp = e.maxHp = unitStats(e).hp; s.entities.push(e); units.push({id: e.id, type, rank});
      }
    });
    s.visible[0].fill(1); s.explored[0].fill(1); s.time = 3; r.rememberedBuildings.clear();
    window.rankGrid = zoom => { r.resize(); Object.assign(v, {x: 90.8, y: 73.25, zoom}); r.lastMinimap = -Infinity; r.draw(s, v); };
    rankGrid(38); return units;
  });
  const elite = grid.find(e => e.type === 'tank' && e.rank === 3), rookie = grid.find(e => e.type === 'tank' && e.rank === 0);
  await clickUnit(page, elite.id); await page.keyboard.down('Shift'); await clickUnit(page, rookie.id); await page.keyboard.up('Shift');
  assert(await page.locator('#selection-rank').isHidden()); assert(await page.locator('#selection-health').isHidden(), 'Mixed ranks have no misleading single-unit rank or health bar');
  assert.equal(await page.locator('#selection-name').textContent(), '2 units selected');
  for (const [name, viewport, normal] of [['desktop', {width: 1440, height: 900}, 38], ['mobile', {width: 390, height: 844}, 24]]) {
    await page.setViewportSize(viewport);
    for (const zoom of [normal, 16]) {
      await page.evaluate(zoom => rankGrid(zoom), zoom); await clickUnit(page, elite.id, name === 'mobile'); await page.evaluate(zoom => rankGrid(zoom), zoom);
      assert.equal((await rankHUD(page)).rank, 3);
      assert(await page.locator('#selection-rank').evaluate(e => e.scrollWidth <= e.clientWidth), 'Rank summary stays on one readable line');
      assert(await page.evaluate(() => {
        const panel = document.querySelector('#selection-panel').getBoundingClientRect(), army = document.querySelector('#select-army').getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth && panel.bottom <= innerHeight + 1 && (army.right <= panel.left || army.left >= panel.right || army.bottom <= panel.top || army.top >= panel.bottom);
      }), 'Rank HUD fits the viewport without covering the Army button');
      await page.screenshot({path: `${output}/ranks-${name}-${zoom}.png`});
    }
  }
  await page.setViewportSize({width: 1440, height: 900});
  // Let the real resize observer finish before drawing into the frozen game loop.
  await page.evaluate(() => new Promise(resolve => rankFixture.raf.call(window, () => rankFixture.raf.call(window, resolve))));
  await page.evaluate(() => { ashline.view.selected.clear(); for (const e of ashline.state.entities) if (e.kind === 'unit') e.team = 1; rankGrid(38); document.querySelector('#selection-panel').hidden = true; });
  await page.screenshot({path: `${output}/ranks-enemy-38.png`});
  assert.deepEqual(errors, []);
  console.log(`Rank browser checks passed: real 5/10/15-kill promotions, HP/selected statistics, save/load, ${marks.rows.length} unit/zoom/rank slot cases, fog, mixed selection and desktop/mobile HUD/screenshots. Review: ${output}`);
} finally { await browser.close(); }
