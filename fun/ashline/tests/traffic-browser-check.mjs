// Browser movement QA: set ASHLINE_PLAYWRIGHT and ASHLINE_URL as in browser-check.mjs.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-traffic-qa';
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}), errors = [];
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
  assert.deepEqual(errors, []);
  console.log(`Traffic browser check passed: paused state, narrow-lane passage, guarding ally and solid walls. Screenshots: ${output}`);
} finally { await browser.close(); }
