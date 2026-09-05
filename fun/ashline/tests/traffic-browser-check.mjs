// Browser movement QA: set ASHLINE_PLAYWRIGHT and ASHLINE_URL as in browser-check.mjs.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-traffic-qa';
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, hasTouch: true}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  await page.locator('#seed').fill('TRAFFIC-BROWSER'); await page.locator('#deploy').click();
  await page.locator('#pause').click();
  await page.evaluate(async () => {
    const {UNITS, issueOrder, updateGame} = await import('./sim.js'), s = ashline.state;
    s.ai.nextThink = 1e12; s.terrain.fill(0); s.minerals.fill(0); s.effects = []; s.navVersion++;
    const template = structuredClone(s.entities.find(e => e.type === 'rifle'));
    s.entities = s.entities.filter(e => e.kind === 'building');
    const add = x => {
      const d = UNITS.tank, unit = {...structuredClone(template), id: s.nextId++, type: 'tank', team: 0, x, y: 25.5, size: d.size, hp: d.hp, maxHp: d.hp, order: {type: 'idle'}, path: [], targetId: null};
      s.entities.push(unit); return unit;
    };
    const moving = add(22.5), parked = add(30.5);
    for (let x = 20; x <= 42; x++) for (const y of [24, 26]) s.terrain[y * s.width + x] = 1;
    issueOrder(s, [moving.id], {type: 'move', x: 40.5, y: 25.5});
    s.visible[0].fill(1); s.explored[0].fill(1);
    Object.assign(ashline.view, {x: 31.5, y: 25.5, zoom: 38}); ashline.view.selected.clear(); ashline.view.selected.add(moving.id);
    ashline.renderer.createTerrain(s); document.querySelector('#menu').close(); document.querySelector('#command-console').hidden = true;
    window.trafficSample = (seconds = 0) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        updateGame(s, .05);
        for (const unit of [moving, parked]) for (const dx of [-.189, .189]) for (const dy of [-.189, .189]) {
          if (s.blocked[Math.floor(unit.y + dy) * s.width + Math.floor(unit.x + dx)]) throw new Error('Traffic entered a solid corridor wall');
        }
      }
      ashline.renderer.draw(s, ashline.view);
      return {time: s.time, x: moving.x, y: moving.y, remaining: Math.hypot(moving.x - 40.5, moving.y - 25.5), parkedDisplacement: Math.hypot(parked.x - 30.5, parked.y - 25.5), parkedOrder: parked.order.type, passUntil: moving.passUntil ?? 0};
    };
    trafficSample();
  });
  await page.waitForTimeout(250); await page.screenshot({path: `${output}/traffic-start.png`});
  const initial = await page.evaluate(() => trafficSample());
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => trafficSample()), initial, 'The paused traffic fixture remains frozen');
  let middle;
  for (let i = 0; i < 100; i++) {
    middle = await page.evaluate(() => trafficSample(.1));
    if (middle.x >= 29.8 || middle.passUntil > middle.time) break;
  }
  await page.waitForTimeout(250); await page.screenshot({path: `${output}/traffic-passing.png`});
  const finished = await page.evaluate(() => trafficSample(25));
  await page.waitForTimeout(250); await page.screenshot({path: `${output}/traffic-finished.png`});
  assert(finished.remaining < 1.1, `The tank completes its route past a guarding ally (${finished.remaining.toFixed(2)} tiles remain)`);
  assert(finished.parkedDisplacement < 1.5, 'Yielding does not push the guarding tank along the route');
  assert.equal(finished.parkedOrder, 'idle');

  // Exercise the real selection/command path; only the simulation clock is advanced manually.
  await page.locator('#pause').click(); await page.waitForFunction(() => !ashline.paused);
  await page.evaluate(() => { window.formationFixture = {raf: requestAnimationFrame}; requestAnimationFrame = frame => { formationFixture.frame = frame; return 0; }; });
  await page.waitForFunction(() => Boolean(formationFixture.frame));
  await page.evaluate(async () => {
    const {UNITS, updateGame} = await import('./sim.js'), s = ashline.state, r = ashline.renderer, v = ashline.view;
    const template = structuredClone(s.entities.find(e => e.kind === 'unit'));
    s.entities = s.entities.filter(e => e.kind === 'building'); s.terrain.fill(0); s.minerals.fill(0); s.navVersion++;
    for (let y = 73; y <= 76; y++) s.terrain[y * s.width + 96] = 1;
    const units = Array.from({length: 12}, (_, i) => {
      const type = Object.keys(UNITS)[i % 6], d = UNITS[type];
      const u = {...structuredClone(template), id: s.nextId++, type, size: d.size, hp: d.hp, maxHp: d.hp, x: 88.5 + i % 6, y: 73.5 + Math.floor(i / 6) * 2, order: {type: 'idle'}, path: [], cargo: 0}; s.entities.push(u); return u;
    });
    Object.assign(v, {x: 94, y: 75.5, zoom: 38}); v.selected.clear(); r.createTerrain(s);
    window.formationAdvance = seconds => { for (let i = 0; i < seconds * 20; i++) updateGame(s, .05); r.resize(); r.draw(s, v); return units.filter(u => v.selected.has(u.id)).map(u => ({id: u.id, x: u.x, y: u.y, type: u.order.type})); };
    formationAdvance(0);
  });
  const point = (x, y) => page.evaluate(({x, y}) => ashline.renderer.worldToScreen(x, y, ashline.view), {x, y});
  const start = await point(88.1, 73.1), end = await point(94, 76);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, {steps: 8}); await page.mouse.up();
  assert.equal(await page.evaluate(() => ashline.view.selected.size), 10, 'Drag selects all military units and leaves automatic haulers working');
  const destination = await point(100.5, 75.5); await page.mouse.click(destination.x, destination.y, {button: 'right'});
  const goals = () => page.evaluate(() => ashline.state.entities.filter(u => ashline.view.selected.has(u.id)).map(u => ({id: u.id, x: u.order.x, y: u.order.y})));
  const checkArrival = (units, slots) => { assert.equal(units.length, 10); assert.equal(new Set(slots.map(p => `${p.x},${p.y}`)).size, 10); for (const u of units) { const p = slots.find(p => p.id === u.id); assert(Math.hypot(u.x - p.x, u.y - p.y) <= .081, 'Each selected unit reaches its own destination'); assert.equal(u.type, 'idle'); } };
  const desktopGoals = await goals(); await page.evaluate(() => formationAdvance(0)); await page.screenshot({path: `${output}/group-command.png`});
  checkArrival(await page.evaluate(() => formationAdvance(60)), desktopGoals); await page.screenshot({path: `${output}/group-arrived.png`});
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => new Promise(resolve => formationFixture.raf.call(window, () => formationFixture.raf.call(window, resolve))));
  await page.evaluate(() => { Object.assign(ashline.view, {x: 100.5, y: 75.5, zoom: 24}); formationAdvance(0); });
  await page.locator('#move-order').tap(); const touch = await point(103.5, 78.2); await page.touchscreen.tap(touch.x, touch.y);
  const mobileGoals = await goals(); checkArrival(await page.evaluate(() => formationAdvance(25)), mobileGoals);
  await page.screenshot({path: `${output}/group-arrived-mobile.png`});
  assert.deepEqual(errors, []);
  console.log(`Traffic browser check passed: paused state, narrow-lane passage, guarding ally, solid walls, and desktop/touch group commands with individual arrivals. Screenshots: ${output}`);
} finally { await browser.close(); }
