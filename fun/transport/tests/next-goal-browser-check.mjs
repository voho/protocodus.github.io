// Next goal card: the seed-1847 first route checklist, alternatives, the folded preference and its layer.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-next-goal';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); };
const steps = page => page.locator('#objective-steps .objective-step').evaluateAll(items => items.map(item => ({ label: item.children[1].firstChild.textContent, done: item.classList.contains('done'), current: item.classList.contains('current'), button: item.querySelector('button')?.title || '' })));
const box = (page, selector) => page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page, { biome: 'taiga', seed: 1847 });
  await page.locator('#objective-card').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#objective-card .eyebrow').count(), 0, 'the title names the goal, with no eyebrow above it');
  assert.equal(await page.locator('#objective-title').textContent(), 'Your first cargo route');
  assert.match(await page.locator('#objective-detail').textContent(), /stone from Stone quarry to Alderbrook/);
  assert.equal(await page.locator('#objective-detail').isVisible(), false, 'during onboarding the checklist speaks; the sentence is the title tooltip');
  assert.match(await page.locator('#objective-title').getAttribute('title'), /stone from Stone quarry to Alderbrook/);
  let list = await steps(page);
  assert.deepEqual(list.map(step => step.label), ['Stop near Stone quarry', 'Stop near Alderbrook', 'Connect them', 'Launch a stone route', 'First delivery']);
  assert.deepEqual(list.map(step => step.current), [true, false, false, false, false], 'step 1 is the open step');
  assert.equal(list.filter(step => step.button).length, 1, 'only the open step offers an action');
  // One step, one action: while the game can plan the line, Plan road is the card's only button.
  assert.deepEqual(await page.locator('.objective-actions > button:not([hidden])').evaluateAll(els => els.map(el => el.id)), ['objective-plan', 'objective-another']);
  assert.equal(list[1].done, true, 'the starter stop already covers Alderbrook');
  const quarry = await page.evaluate(() => { const site = transport.game.industries.find(site => site.name === 'Stone quarry' && site.x === 217 && site.y === 255); return site && { id: site.id, x: site.x, y: site.y }; });
  assert.ok(quarry, 'seed 1847 suggests the quarry at 217, 255');
  await page.screenshot({ path: `${output}/desktop-fresh.png` });

  // Another idea names a different producer, and the choice cycles back.
  const detail = await page.locator('#objective-detail').textContent();
  await page.locator('#objective-another').click();
  const other = await page.locator('#objective-detail').textContent();
  assert.notEqual(other, detail);assert.doesNotMatch(other, /Stone quarry/);
  await page.evaluate(() => transport.setView('build'));
  assert.equal(await page.locator('.project-card').isVisible(), false, 'wide screens leave the goal to its map card');
  await page.locator('#close-management').click();
  while (!(await page.locator('#objective-detail').textContent()).includes('Stone quarry')) await page.locator('#objective-another').click();
  await page.evaluate(({ x, y }) => transport.inspect(x, y), quarry);
  assert.equal(await page.locator('#inspector h3').first().textContent(), 'Stone quarry');
  assert.equal(await page.locator('#objective-card').isVisible(), true, 'wide screens keep the card beside the inspector');
  await page.locator('#inspector .tiny-button').click();

  // The open step frames the quarry and its buyer and chooses the right tool.
  await page.locator('[data-goal-step="0"]').click();
  assert.equal(await page.locator('#active-tool-bar').isVisible(), true);
  assert.equal(await page.locator('#active-tool-name').textContent(), 'Road', 'no road reaches the quarry yet');
  await page.waitForFunction(() => !transport.renderer.getStats().gliding); // the camera glides to the pair (DESIGN.md 10.2)
  const framed =await page.evaluate(({ x, y }) => { const p = transport.renderer.worldToScreen(x + .5, y + .5), c = document.querySelector('#world'); return p.x > 0 && p.y > 0 && p.x < c.clientWidth && p.y < c.clientHeight; }, quarry);
  assert.equal(framed, true, 'the quarry is on screen');
  await page.keyboard.press('Escape');

  // Build the known connection, then the checklist ticks the first three steps.
  await page.evaluate(async () => {
    const { buildPlan } = await import('./construction-plan.js'), { build } = await import('./model.js');
    const points = []; for (let y = 251; y >= 245; y--) points.push({ x: 219, y });
    if (!buildPlan(transport.game, 'road', points, { preferredMode: 'road' }).ok) throw new Error('road failed');
    if (!build(transport.game, 'bus-stop', 219, 251).ok) throw new Error('stop failed');
  });
  await page.waitForFunction(() => document.querySelectorAll('#objective-steps .objective-step.done').length === 3);
  list = await steps(page);
  assert.deepEqual(list.map(step => step.done), [true, true, true, false, false]);
  assert.equal(list[3].current, true);assert.equal(list[3].button, 'Set up route');
  assert.equal(await page.locator('#objective-plan').isVisible(), false, 'a joined pair needs no plan');
  assert.equal(await page.locator('#objective-action').textContent(), 'Set up route', 'the one button is the open step');
  await page.screenshot({ path: `${output}/desktop-connected.png` });
  await page.locator('[data-goal-step="3"]').click();
  const stop = await page.evaluate(() => transport.game.stations.find(stop => stop.x === 219 && stop.y === 251).id);
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), stop);
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), 'station-1');
  assert.equal(await page.locator('#route-form [name="cargo"]').inputValue(), 'stone');
  assert.equal(await page.locator('#route-form button[type="submit"]').isEnabled(), true);
  await page.screenshot({ path: `${output}/desktop-launch.png` });
  await page.locator('#close-management').click();

  // Folding is a preference: it survives a reload, and a new goal only updates the chip.
  await page.locator('#dismiss-objective').click();
  assert.equal(await page.locator('#objective-chip').isVisible(), true);
  assert.equal(await page.locator('#objective-body').isVisible(), false);
  assert.equal((await page.locator('#objective-chip').innerText()).trim(), 'Your first cargo route');
  assert.equal(await page.evaluate(() => localStorage.getItem('transport-next-goal-v2')), 'folded');
  assert.equal(await page.evaluate(() => transport.persist()), true);
  await page.reload();
  await loadAutosaveFromMenu(page);
  await page.locator('#objective-card').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#objective-chip').isVisible(), true, 'a collapsed goal stays collapsed after reload');
  await page.evaluate(async () => {
    const { addRoute, tick } = await import('./model.js'), stop = transport.game.stations.find(stop => stop.x === 219 && stop.y === 251);
    if (!addRoute(transport.game, { mode: 'road', stops: [stop.id, 'station-1'], cargo: 'stone' }).ok) throw new Error('route failed');
    const route = transport.game.routes.at(-1);
    for (let day = 0; day < 60 && !route.delivered; day++) for (let n = 0; n < 4; n++) tick(transport.game, .25);
  });
  await page.waitForFunction(() => document.querySelector('#objective-chip-title').textContent === 'First 100 cargo deliveries');
  assert.equal(await page.locator('#objective-body').isVisible(), false, 'a new goal keeps the card folded');
  assert.equal(await page.locator('#objective-card').evaluate(card => card.classList.contains('changed')), true, 'the chip marks the new goal');
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${output}/desktop-changed.png` });
  await page.locator('#objective-chip').click();
  assert.equal(await page.locator('#objective-body').isVisible(), true);
  assert.equal(await page.locator('#objective-card').evaluate(card => card.classList.contains('changed')), false, 'opening clears the mark');
  assert.equal(await page.locator('#objective-progress').isVisible(), true);
  await page.screenshot({ path: `${output}/desktop-progress.png` });

  // Menus and layers take the corner; a folded card opens again from its chip.
  await page.locator('#dismiss-objective').click();
  await page.locator('#objective-chip').click();
  assert.equal(await page.locator('#objective-body').isVisible(), true);
  // The Next goal layer removes the card entirely; Show on map turns it back on.
  await page.locator('#game-menu-button').click();await page.locator('#layers-button').click();
  await page.locator('[data-layer="goal"]').setChecked(false);
  assert.equal(await page.locator('#objective-card').isVisible(), false, 'the layer hides the card');
  await page.locator('[data-layers-close]').click();
  await page.evaluate(() => transport.setView('build'));
  await page.locator('.project-card summary').click();
  await page.locator('[data-goal-show]').click();
  assert.equal(await page.locator('#objective-body').isVisible(), true, 'Show on map turns the layer back on');
  assert.equal(await page.evaluate(() => transport.renderer.getLayers().goal), true);
  await page.locator('#game-menu-button').click();
  assert.equal(await page.locator('#objective-card').isVisible(), false, 'the game menu hides the card');
  await page.keyboard.press('Escape');
  await page.close();

  // A card folded under the old title-based key stays folded.
  const migrated = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(migrated);
  await migrated.addInitScript(() => { if (!localStorage.getItem('transport-next-goal-v2')) localStorage.setItem('transport-next-goal-v1', 'Your first cargo route'); });
  await migrated.goto(url);
  await createWorldFromMenu(migrated, { biome: 'taiga', seed: 1847 });
  await migrated.locator('#objective-chip').waitFor({ state: 'visible' });
  assert.equal(await migrated.locator('#objective-body').isVisible(), false);
  await migrated.close();
  assert.deepEqual(errors, []);
  console.log(`Next goal checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
