// Optional browser QA: ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/browser-check.mjs
// Serve the repository root first. ASHLINE_URL can override the local URL.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
const state = (page, fn) => page.evaluate(fn);
const pageIsCompact = page => page.evaluate(() => document.querySelector('#command-console').hidden && ashline.renderer.width === innerWidth);
const advance = (page, seconds) => page.evaluate(async seconds => {
  const { updateGame } = await import('./sim.js');
  for (let i = 0; i < seconds * 10; i++) updateGame(ashline.state, .1);
}, seconds);
const point = (page, x, y) => page.evaluate(({ x, y }) => {
  const p = ashline.renderer.worldToScreen(x, y, ashline.view), rect = document.querySelector('#world').getBoundingClientRect();
  return { x: p.x + rect.x, y: p.y + rect.y };
}, { x, y });
const clickWorld = async (page, x, y, button = 'left') => { const p = await point(page, x, y); await page.mouse.click(p.x, p.y, { button }); };
const baseWorld = (page, x, y) => page.evaluate(({x, y}) => {
  const core = ashline.state.entities.find(e => e.team === 0 && e.type === 'core');
  return {x: core.x + x - 10, y: core.y + y - 35};
}, {x, y});
const clickBase = async (page, x, y, button = 'left') => { const p = await baseWorld(page, x, y); await clickWorld(page, p.x, p.y, button); };
async function construct(page, type) {
  if (await page.locator('#command-console').isHidden()) await page.locator('#command-toggle').click();
  await page.locator('#build-tab').click();
  const spot = await page.evaluate(async type => {
    const { canPlace } = await import('./sim.js'), s = ashline.state;
    const spots = [], core = s.entities.find(e => e.team === 0 && e.type === 'core');
    for (let y = core.y - 10; y < core.y + 9; y++) for (let x = core.x - 5; x < core.x + 15; x++) {
      const p = ashline.renderer.worldToScreen(x, y, ashline.view);
      if (p.x > 30 && p.y > 100 && p.x < ashline.renderer.width - 120 && p.y < ashline.renderer.height - 100 && canPlace(s, 0, type, x, y).ok) spots.push({ x, y });
    }
    return spots.sort((a, b) => Math.hypot(a.x - core.x - 2, a.y - core.y + 5) - Math.hypot(b.x - core.x - 2, b.y - core.y + 5))[0];
  }, type);
  assert(spot, `Valid ${type} build location`);
  await page.locator(`[data-type="${type}"]`).click();
  await clickWorld(page, spot.x + .2, spot.y + .2);
  assert(await page.evaluate(type => ashline.state.entities.some(e => e.team === 0 && e.type === type && e.progress < 1), type), `${type} construction starts`);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); watch(page);
  await page.goto(url); await page.waitForFunction(() => window.ashline?.assets.ready);
  assert.deepEqual(await state(page, () => ashline.assets.errors), []);
  assert.equal(await state(page, () => ashline.assets.loaded), 7, 'All seven generated sprite and terrain assets load');
  const graphics = await page.evaluate(async () => {
    const { drawSprite, spriteStats } = await import('./assets.js');
    const { UNITS } = await import('./sim.js');
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    let cases = 0, empty = 0, matte = 0;
    for (const type of Object.keys(UNITS)) for (let team = 0; team < 2; team++) for (let direction = 0; direction < 8; direction++) for (const moving of [false, true]) {
      ctx.clearRect(0, 0, 128, 128); ctx.save(); ctx.translate(64, 64);
      drawSprite(ctx, { type, team, angle: direction * Math.PI / 4, moving, id: 1 }, .4); ctx.restore();
      const rgba = ctx.getImageData(0, 0, 128, 128).data;
      let occupied = 0;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 64) {
        occupied++;
        if (rgba[i] > 100 && rgba[i + 2] > 100 && Math.min(rgba[i], rgba[i + 2]) - rgba[i + 1] > 65) matte++;
      }
      if (occupied < 20) empty++;
      cases++;
    }
    return { ...spriteStats(), unitTypes: Object.keys(UNITS).length, cases, empty, matte };
  });
  assert.equal(graphics.frames.rifle, 2);
  assert.equal(graphics.props.rock, 3); assert.equal(graphics.props.ore, 3);
  assert.equal(graphics.cases, graphics.unitTypes * 32); assert.equal(graphics.empty, 0); assert.equal(graphics.matte, 0, 'Generated sprites have clean transparent silhouettes');
  assert(await page.locator('#briefing').evaluate(e => e.open));
  assert(await state(page, () => ashline.paused && ashline.state.time === 0));
  await page.screenshot({ path: `${output}/briefing.png` });
  await page.locator('#seed').fill('BROWSER-CHECK'); await page.locator('#deploy').click();
  await page.waitForFunction(() => !ashline.paused && ashline.state.time > 0);
  assert(await state(page, () => ashline.renderer.width === innerWidth && ashline.renderer.height === innerHeight), 'Battlefield fills the viewport');
  assert(await page.locator('#selection-panel').isHidden(), 'No empty selection panel obscures the battlefield');
  await page.keyboard.press('b');
  assert(await page.locator('#command-console').isHidden());
  const hudFraction = await state(page, () => [...document.querySelectorAll('.topbar,.tactical-map,#command-console,#selection-panel')].reduce((area, el) => { const r = el.getBoundingClientRect(); return area + r.width * r.height; }, 0) / (innerWidth * innerHeight));
  assert(hudFraction < .12, 'Collapsed HUD leaves at least 88% of the battlefield unobscured');
  await page.keyboard.press('b');
  assert.equal(await state(page, () => ashline.state.seed), 'BROWSER-CHECK');
  assert(await page.locator('[data-type="factory"]').isDisabled(), 'Technology prerequisite disables foundry');

  // Freeze only the animation loop so real selection input can inspect a stable viewport.
  await page.evaluate(() => {
    window.selectionFixture = {raf: requestAnimationFrame};
    requestAnimationFrame = frame => { selectionFixture.frame = frame; return 0; };
  });
  await page.waitForFunction(() => !!selectionFixture.frame);
  await page.evaluate(() => Object.assign(selectionFixture, {game: structuredClone(ashline.state), view: structuredClone(ashline.view)}));
  try {
    for (const camera of [{x: 36, y: 28, zoom: 38}, {x: 43, y: 25, zoom: 58}]) {
      const expected = await page.evaluate(async camera => {
        const {UNITS} = await import('./sim.js'), s = ashline.state, r = ashline.renderer, v = ashline.view;
        const template = type => selectionFixture.game.entities.find(e => e.team === 0 && e.type === type);
        Object.assign(v, camera); v.selected.clear(); s.entities = [];
        const a = r.screenToWorld(0, 0, v), b = r.screenToWorld(r.width, r.height, v);
        const add = (x, y, type = 'rifle', team = 0, hp = UNITS[type].hp) => {
          const e = {...structuredClone(template(type)), id: s.nextId++, x, y, type, team, hp, maxHp: UNITS[type].hp, size: UNITS[type].size};
          s.entities.push(e); return e.id;
        };
        const visible = [[v.x, v.y], [a.x + .25, v.y], [b.x - .25, v.y], [v.x, a.y + .25], [v.x, b.y - .25]].map(([x, y]) => add(x, y));
        for (const [x, y] of [[a.x - .25, v.y], [b.x + .25, v.y], [v.x, a.y - .25], [v.x, b.y + .25]]) add(x, y);
        add(v.x + 2, v.y + 2, 'scout'); add(v.x - 2, v.y - 2, 'rifle', 1); add(v.x + 3, v.y - 3, 'rifle', 0, 0);
        add(v.x + 3, v.y + 3, 'harvester'); add(v.x + 5, v.y + 3, 'harvester');
        r.draw(s, v); return visible;
      }, camera);
      const p = await point(page, camera.x, camera.y); await page.mouse.dblclick(p.x, p.y);
      assert.deepEqual(await state(page, () => [...ashline.view.selected].sort((a, b) => a - b)), expected.sort((a, b) => a - b), 'Double-click selects only living friendly units of the same type inside all four viewport edges after pan/zoom');
    }
    const fixture = await state(page, () => ({
      rifle: ashline.state.entities.find(e => e.x === ashline.view.x && e.y === ashline.view.y),
      scout: ashline.state.entities.find(e => e.type === 'scout'), haulers: ashline.state.entities.filter(e => e.type === 'harvester'),
    }));
    const selected = () => state(page, () => [...ashline.view.selected].sort((a, b) => a - b));
    const shiftAdd = async unit => { await page.keyboard.down('Shift'); await clickWorld(page, unit.x, unit.y); await page.keyboard.up('Shift'); };
    const dragFrom = await point(page, fixture.rifle.x - .7, fixture.rifle.y - .7), dragTo = await point(page, fixture.haulers[1].x + .7, fixture.haulers[1].y + .7);
    await page.mouse.move(dragFrom.x, dragFrom.y); await page.mouse.down(); await page.mouse.move(dragTo.x, dragTo.y, {steps: 6}); await page.mouse.up();
    assert.deepEqual(await selected(), [fixture.rifle.id, fixture.scout.id], 'Mixed box selection keeps combat units and excludes haulers');
    await page.keyboard.press('a'); await clickWorld(page, fixture.rifle.x - 3, fixture.rifle.y + 3);
    assert.deepEqual(await state(page, () => ashline.state.entities.filter(e => e.type === 'harvester').map(e => e.order)), fixture.haulers.map(e => e.order), 'Excluded haulers do not receive a combat move');
    for (const [first, added] of [[fixture.rifle, fixture.haulers[0]], [fixture.haulers[0], fixture.rifle]]) {
      await clickWorld(page, first.x, first.y); await shiftAdd(added);
      assert.deepEqual(await selected(), [fixture.rifle.id], 'Shift selection excludes haulers regardless of selection order');
    }
    await clickWorld(page, fixture.haulers[0].x, fixture.haulers[0].y); await shiftAdd(fixture.haulers[1]);
    const haulerIds = fixture.haulers.map(e => e.id);
    assert.deepEqual(await selected(), haulerIds, 'Hauler-only Shift selection remains available');
    const haulerPoint = await point(page, fixture.haulers[0].x, fixture.haulers[0].y); await page.mouse.dblclick(haulerPoint.x, haulerPoint.y);
    assert.deepEqual(await selected(), haulerIds, 'Double-click retains a hauler-only group');
    await page.keyboard.press('Control+5'); await clickWorld(page, fixture.rifle.x, fixture.rifle.y); await page.keyboard.press('5');
    assert.deepEqual(await selected(), haulerIds, 'Control group recall preserves a hauler-only group');
  } finally {
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+5');
    await page.evaluate(() => {
      Object.assign(ashline.state, selectionFixture.game); Object.assign(ashline.view, selectionFixture.view);
      requestAnimationFrame = selectionFixture.raf; requestAnimationFrame(selectionFixture.frame); delete window.selectionFixture;
    });
  }

  // Real selection, box selection, control groups and context orders.
  const rifle = await state(page, () => ashline.state.entities.find(e => e.team === 0 && e.type === 'rifle'));
  await clickWorld(page, rifle.x, rifle.y);
  assert.equal(await state(page, () => ashline.view.selected.size), 1);
  await page.waitForFunction(() => document.querySelector('#selection-detail').textContent.includes('Guarding'));
  await page.keyboard.press('Control+1');
  await page.keyboard.press('x');
  assert.equal(await page.locator('#explore-order').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, rifle.id), 'explore');
  await page.locator('#explore-order').click();
  assert.equal(await page.locator('#explore-order').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('x');
  const moveDestination = await baseWorld(page, 14.5, 31.5);
  await clickWorld(page, moveDestination.x, moveDestination.y, 'right');
  assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, rifle.id), 'move');
  assert.equal(await page.locator('#explore-order').getAttribute('aria-pressed'), 'false', 'Manual movement overrides exploration');
  await advance(page, 3);
  assert(await page.evaluate(({id, y}) => ashline.state.entities.find(e => e.id === id).y < y + 1.5, {id: rifle.id, y: moveDestination.y}), 'Move command changes position');
  await page.keyboard.press('Escape'); await page.keyboard.press('1');
  assert.equal(await state(page, () => ashline.view.selected.size), 1);
  const dragA = await baseWorld(page, 9, 29), dragB = await baseWorld(page, 18, 36);
  const a = await point(page, dragA.x, dragA.y), b = await point(page, dragB.x, dragB.y);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  assert(await state(page, () => ashline.view.selected.size >= 3), 'Drag selects multiple units');
  await page.keyboard.press('a'); await clickBase(page, 23, 29);
  assert(await state(page, () => ashline.state.entities.filter(e => ashline.view.selected.has(e.id)).some(e => e.order.type === 'attackMove')));
  await page.keyboard.press('s');
  assert(await state(page, () => ashline.state.entities.filter(e => ashline.view.selected.has(e.id)).every(e => e.order.type === 'idle')));

  await page.keyboard.press('1'); await page.keyboard.press('x'); await page.keyboard.press('e');
  assert.equal(await page.locator('#explore-order').getAttribute('aria-pressed'), 'mixed');
  await page.locator('#explore-order').click();
  assert.equal(await page.locator('#explore-order').getAttribute('aria-pressed'), 'true');
  assert(await state(page, () => ashline.state.entities.filter(e => ashline.view.selected.has(e.id)).every(e => e.order.type === 'explore')), 'Group toggle enables every selected explorer');
  await page.screenshot({ path: `${output}/auto-explore.png` });
  await page.keyboard.press('s');

  const hauler = await state(page, () => ashline.state.entities.find(e => e.team === 0 && e.type === 'harvester'));
  const escort = await state(page, () => ashline.state.entities.find(e => e.team === 0 && e.type === 'rifle'));
  await clickWorld(page, hauler.x, hauler.y);
  await page.keyboard.press('s');
  assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, hauler.id), 'harvest', 'Stopping a hauler restores automatic harvesting');
  await page.waitForFunction(() => /Auto-harvesting|Returning cargo/.test(document.querySelector('#selection-detail').textContent));
  await clickBase(page, 16.5, 39.5, 'right');
  await advance(page, 5);
  assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, hauler.id), 'harvest', 'Clicking the refinery lets a hauler resume work at its perimeter');
  await page.waitForFunction(() => /Auto-harvesting|Returning cargo/.test(document.querySelector('#selection-detail').textContent));
  await page.screenshot({ path: `${output}/automatic-hauler.png` });
  await page.keyboard.down('Shift');
  await clickWorld(page, escort.x, escort.y); await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(id => ashline.view.selected.has(id), hauler.id), false, 'Adding a combat escort deselects the hauler');
  await clickBase(page, 20.5, 38.5, 'right');
  assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, hauler.id), 'harvest');
  assert.equal(await page.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, escort.id), 'move', 'Combat escorts move while excluded haulers keep harvesting');

  // Occupied construction does not charge; a valid build unlocks real production.
  await page.locator('[data-type="barracks"]').click();
  const credits = await state(page, () => ashline.state.teams[0].credits);
  await clickBase(page, 10.2, 35.2);
  assert.equal(await state(page, () => ashline.state.teams[0].credits), credits);
  assert.equal(await state(page, () => ashline.view.placement), 'barracks');
  await page.keyboard.press('Escape');
  await construct(page, 'barracks'); await advance(page, 16);
  await page.waitForFunction(() => !document.querySelector('[data-type="factory"]').disabled);
  await page.locator('#train-tab').click(); await page.locator('[data-type="rifle"]').click();
  const riflesBefore = await state(page, () => ashline.state.entities.filter(e => e.team === 0 && e.type === 'rifle').length);
  await advance(page, 6);
  assert.equal(await state(page, () => ashline.state.entities.filter(e => e.team === 0 && e.type === 'rifle').length), riflesBefore + 1);
  await construct(page, 'factory'); await advance(page, 28);
  await page.locator('#train-tab').click(); await page.locator('[data-type="tank"]').click();
  await advance(page, 15);
  assert(await state(page, () => ashline.state.entities.some(e => e.team === 0 && e.type === 'tank')), 'Factory produces armor');
  await page.locator('#select-army').click();
  await page.screenshot({ path: `${output}/base-and-army.png` });

  // Minimap uses the same aspect-fit transform as its renderer; pause freezes simulation.
  const mapPoint = await page.locator('#minimap').evaluate(e => {
    const r = e.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  });
  await page.mouse.click(mapPoint.x, mapPoint.y);
  assert(await state(page, () => Math.abs(ashline.view.x - ashline.state.width / 2) < .5 && Math.abs(ashline.view.y - ashline.state.height / 2) < .5));
  await page.locator('#home').click(); await page.locator('#pause').click();
  const pausedTime = await state(page, () => ashline.state.time);
  await page.waitForTimeout(350); assert.equal(await state(page, () => ashline.state.time), pausedTime);
  await page.locator('#resume').click(); await page.waitForFunction(t => ashline.state.time > t, pausedTime);

  // Active queues and previous selections cannot leak into a fresh skirmish.
  await page.locator('[data-type="artillery"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.queue-item').length > 0);
  await page.locator('#pause').click(); await page.locator('#new-game').click();
  assert.equal(await page.locator('.queue-item').count(), 0);
  assert.equal(await state(page, () => ashline.view.selected.size), 0);
  assert.equal(await state(page, () => ashline.state.time), 0);

  // Stage the last combat exchange; the real animation loop must open either end screen.
  for (const outcome of ['victory', 'defeat']) {
    await page.locator('#deploy').click();
    await page.evaluate(async outcome => {
      const { issueOrder } = await import('./sim.js'), s = ashline.state;
      const loser = outcome === 'victory' ? 1 : 0;
      const core = s.entities.find(e => e.team === loser && e.type === 'core');
      const attacker = s.entities.find(e => e.team !== loser && e.type === 'rifle');
      core.hp = 1; attacker.x = core.x - .6; attacker.y = core.y + 1.5; attacker.cooldown = 0;
      s.fogClock = 0;
      issueOrder(s, [attacker.id], { type: 'attackMove', x: core.x + 1.5, y: core.y + 1.5 });
    }, outcome);
    await page.waitForFunction(outcome => ashline.state.status === outcome && document.querySelector('#menu').open, outcome);
    assert(await page.locator('#resume').isHidden());
    assert(await page.locator('#match-summary').isVisible());
    await page.screenshot({ path: `${output}/${outcome}.png` });
    await page.locator('#new-game').click();
  }
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); watch(mobile);
  await mobile.goto(url); await mobile.waitForFunction(() => window.ashline?.assets.ready);
  await mobile.locator('#deploy').tap();
  assert(await state(mobile, () => document.documentElement.scrollWidth <= innerWidth), 'Mobile has no horizontal overflow');
  assert(await pageIsCompact(mobile), 'Mobile starts with a compact, collapsed console');
  assert(await state(mobile, () => ashline.view.zoom >= 20), 'Full-width mobile battlefield keeps sprites legible');
  const mobileScout = await state(mobile, () => ashline.state.entities.find(e => e.team === 0 && e.type === 'scout'));
  const scoutPoint = await point(mobile, mobileScout.x, mobileScout.y); await mobile.touchscreen.tap(scoutPoint.x, scoutPoint.y);
  assert.equal(await state(mobile, () => ashline.view.selected.size), 1);
  await mobile.locator('#explore-order').tap();
  assert.equal(await mobile.locator('#explore-order').getAttribute('aria-pressed'), 'true');
  const exploredBefore = await state(mobile, () => ashline.state.explored[0].reduce((n, tile) => n + tile, 0));
  await advance(mobile, 4);
  assert(await mobile.evaluate(before => ashline.state.explored[0].reduce((n, tile) => n + tile, 0) > before, exploredBefore), 'Touch exploration reveals new terrain');
  await mobile.screenshot({ path: `${output}/auto-explore-mobile.png` });
  const groundDestination = await baseWorld(mobile, 18, 31);
  const destination = await point(mobile, groundDestination.x, groundDestination.y); await mobile.touchscreen.tap(destination.x, destination.y);
  assert.equal(await mobile.evaluate(id => ashline.state.entities.find(e => e.id === id).order.type, mobileScout.id), 'move');
  assert.equal(await mobile.locator('#explore-order').getAttribute('aria-pressed'), 'false');
  const beforePan = await state(mobile, () => ashline.view.x);
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 130, y: 250 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 250 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(await state(mobile, () => ashline.view.x) > beforePan + .9, 'Touch drag pans the camera');
  await mobile.screenshot({ path: `${output}/mobile.png` });
  await mobile.locator('#help').tap(); assert(await mobile.locator('#full-guide').evaluate(e => e.open));
  await mobile.locator('#resume').tap();
  assert.equal(await state(mobile, () => ashline.paused), false);
  await mobile.locator('#command-toggle').tap();
  await mobile.locator('[data-type="barracks"]').tap();
  assert(await mobile.locator('#command-console').isHidden(), 'Touch construction closes the tray to expose placement');
  const mobileSpot = await mobile.evaluate(async () => {
    const { canPlace } = await import('./sim.js'), core = ashline.state.entities.find(e => e.team === 0 && e.type === 'core');
    for (let y = core.y - 8; y < core.y + 4; y++) for (let x = core.x - 1; x < core.x + 14; x++) {
      const p = ashline.renderer.worldToScreen(x + .2, y + .2, ashline.view);
      if (p.x > 25 && p.x < innerWidth - 25 && p.y > 190 && p.y < innerHeight - 170 && canPlace(ashline.state, 0, 'barracks', x, y).ok) return p;
    }
  });
  assert(mobileSpot, 'Mobile has accessible buildable ground');
  await mobile.touchscreen.tap(mobileSpot.x, mobileSpot.y);
  assert(await state(mobile, () => ashline.state.entities.some(e => e.team === 0 && e.type === 'barracks' && e.progress < 1)), 'Touch placement starts construction');
  assert.deepEqual(errors, [], 'Browser has no runtime/console errors');
  console.log(`Ashline browser checks passed: deployment, viewport double-click selection/groups/orders, auto-explore toggle/shortcut/overrides, construction, infantry/armor production, minimap, pause/reset, victory/defeat, mobile touch/exploration/pan. Screenshots: ${output}`);
} finally { await browser.close(); }
