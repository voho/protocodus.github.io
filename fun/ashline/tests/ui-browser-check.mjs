// Interface QA: ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs node tests/ui-browser-check.mjs
// Serve the repository root first. ASHLINE_URL overrides the local URL; screenshots go to ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-ui-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = (page, label) => { page.on('pageerror', e => errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); }); };
const point = (page, x, y) => page.evaluate(({ x, y }) => {
  const p = ashline.renderer.worldToScreen(x, y, ashline.view), rect = document.querySelector('#world').getBoundingClientRect();
  return { x: p.x + rect.x, y: p.y + rect.y };
}, { x, y });
const mapPoint = (page, x, y) => page.locator('#minimap').evaluate((map, { x, y }) => {
  const rect = map.getBoundingClientRect(), s = ashline.state, scale = Math.min(rect.width / s.width, rect.height / s.height);
  return { x: rect.left + (rect.width - s.width * scale) / 2 + x * scale, y: rect.top + (rect.height - s.height * scale) / 2 + y * scale };
}, { x, y });
const entity = (page, id) => page.evaluate(id => { const e = ashline.state.entities.find(e => e.id === id); return e && JSON.parse(JSON.stringify(e)); }, id);
const tones = page => page.locator('#notifications .toast').evaluateAll(list => list.map(t => ({ tone: t.dataset.tone, text: t.textContent, jump: t.classList.contains('jump') })));

async function deploy(page, choices = {}) {
  await page.goto(url); await page.waitForFunction(() => window.ashline?.booted);
  for (const [id, value] of Object.entries(choices)) await page.locator(`#${id}`).selectOption(value);
  await page.locator('#deploy').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
}
// A quiet sector with a working base, no AI and every tile seen, so interface effects are deterministic.
const fixture = page => page.evaluate(async () => {
  const m = await import('./sim.js'), s = ashline.state;
  s.aiTeams = []; s.teams[0].credits = 40000; s.visible[0].fill(1); s.explored[0].fill(1); s.fogClock = 1e9;
  const core = s.entities.find(e => e.team === 0 && m.buildingRole(e) === 'core');
  const build = role => {
    const type = m.raceBuilding(s, 0, role);
    for (let y = core.y - 12; y < core.y + 13; y++) for (let x = core.x - 12; x < core.x + 14; x++) if (m.canPlace(s, 0, type, x, y).ok) {
      const e = m.getEntity(s, m.placeBuilding(s, 0, type, x, y).id); e.progress = 1; e.hp = e.maxHp; return e;
    }
    throw Error(`No site for ${type}`);
  };
  const barracks = build('barracks'), factory = build('factory'), lab = build('lab');
  const unit = (role, dx, dy, team = 0) => m.addEntity(s, team, 'unit', m.raceUnit(s, team, role), core.x + dx, core.y + dy);
  const engineer = unit('engineer', 5, -3), constructor = unit('constructor', 6, -4), artillery = unit('artillery', 4, -5);
  const rifles = s.entities.filter(e => e.team === 0 && m.unitRole(e) === 'rifle').map(e => e.id);
  const scout = s.entities.find(e => e.team === 0 && m.unitRole(e) === 'scout').id;
  const far = unit('tank', 40, -30);
  s.events.length = 0; ashline.view.selected.clear();
  return { core: { x: core.x + 1.5, y: core.y + 1.5 }, barracks: barracks.id, factory: factory.id, lab: lab.id, engineer: engineer.id, constructor: constructor.id, artillery: artillery.id, rifles, scout, far: far.id, rifleType: m.raceUnit(s, 0, 'rifle') };
});

try {
  // Setup: commanders and modes come from the AI and campaign tables; the static menu never shows an empty terrain list.
  const html = await (await fetch(url)).text();
  assert.match(html, /<select id="map-profile"[^>]*><option value="rift">Volcanic rift<\/option><\/select>/, 'The static briefing keeps a terrain option before scripts load');
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } }); watch(desktop, 'desktop');
  await desktop.addInitScript(() => { if (!sessionStorage.getItem('ui-check')) { localStorage.removeItem('ashline.settings.v1'); sessionStorage.setItem('ui-check', '1'); } });
  await desktop.goto(url); await desktop.waitForFunction(() => window.ashline?.booted);
  const setup = await desktop.evaluate(async () => {
    const { DOCTRINES } = await import('./ai.js'), { SKIRMISH_MODES } = await import('./campaign.js');
    return { doctrines: [...document.querySelectorAll('#rival-doctrine option')].map(o => o.value), expected: ['', ...Object.keys(DOCTRINES)], modes: [...document.querySelectorAll('#skirmish-mode option')].map(o => o.value), expectedModes: SKIRMISH_MODES.map(m => m.id), last: Object.keys(DOCTRINES).at(-1), commander: DOCTRINES[Object.keys(DOCTRINES).at(-1)].commander };
  });
  assert.deepEqual(setup.doctrines, setup.expected); assert.deepEqual(setup.modes, setup.expectedModes);
  assert.match(await desktop.locator('#doctrine-description').textContent(), /seed/);
  await desktop.locator('#rival-doctrine').selectOption(setup.last);
  assert((await desktop.locator('#doctrine-description').textContent()).startsWith(setup.commander), 'Choosing a doctrine names its commander');
  await desktop.screenshot({ path: `${output}/ui-briefing-desktop.png` });
  await deploy(desktop, { 'rival-doctrine': setup.last });
  assert.equal(await desktop.evaluate(() => ashline.state.ai.doctrine), setup.last, 'The chosen doctrine reaches the simulation');
  const ids = await fixture(desktop);
  if (await desktop.locator('#command-console').isHidden()) await desktop.locator('#command-toggle').click();

  // Message log: kinds pick tones, repeats collapse, the newest four stay, and alerts jump the camera.
  await desktop.evaluate(async ({ core }) => {
    const { event } = await import('./sim.js'), s = ashline.state;
    event(s, 'All hostile nexuses and construction vehicles destroyed. Sector secured.', 0, { kind: 'victory' });
    event(s, 'Field barracks under attack', 0, { kind: 'underAttack', x: core.x + 20, y: core.y - 20 });
    event(s, 'Field barracks under attack', 0, { kind: 'underAttack', x: core.x + 20, y: core.y - 20 });
    s.events.push({ text: 'Rifle squad lost', team: 0, time: s.time });
    event(s, 'Rival transmission.', 1, { kind: 'dialogue', speaker: 'Rival' });
  }, ids);
  await desktop.waitForFunction(() => document.querySelectorAll('#notifications .toast').length >= 3);
  let log = await tones(desktop);
  assert.equal(log.find(t => /Sector secured/.test(t.text)).tone, 'success', 'Victory is not styled as a warning');
  const attack = log.find(t => /under attack/.test(t.text));
  assert.equal(attack.tone, 'warning'); assert(attack.jump); assert.match(attack.text, /×2/, 'Repeated warnings collapse with a count');
  assert.equal(log.find(t => /Rifle squad lost/.test(t.text)).tone, 'loss', 'Text-only events from older saves keep their routing');
  assert(!log.some(t => /Rival transmission/.test(t.text)), 'Rival events never reach the log');
  assert.match(await desktop.locator('#announcer').textContent(), /under attack/, 'Screen readers hear the batch');
  await desktop.evaluate(async () => { const { event } = await import('./sim.js'); for (let i = 0; i < 6; i++) event(ashline.state, `Report ${i}`, 0, { kind: 'mission' }); });
  await desktop.waitForFunction(() => [...document.querySelectorAll('#notifications .toast')].some(t => t.textContent.includes('Report 5')));
  log = await tones(desktop);
  assert(log.length <= 4, 'The log keeps at most four lines'); assert(log.some(t => t.tone === 'warning'), 'Routine lines leave before warnings');
  await desktop.locator('#home').click();
  await desktop.locator('#notifications .toast-jump').first().click();
  let camera = await desktop.evaluate(() => ({ x: ashline.view.x, y: ashline.view.y }));
  assert(Math.hypot(camera.x - ids.core.x - 20, camera.y - ids.core.y + 20) < 1, 'Clicking a located message centers the camera');
  await desktop.locator('#home').click(); await desktop.locator('#world').focus(); await desktop.keyboard.press('Backspace');
  camera = await desktop.evaluate(() => ({ x: ashline.view.x, y: ashline.view.y }));
  assert(Math.hypot(camera.x - ids.core.x - 20, camera.y - ids.core.y + 20) < 1, 'Backspace jumps to the latest alert');
  // Screen readers get the same collapsed burst as the visible log, and the hidden log keeps its jump
  // marks out of the tab order (Backspace serves the keyboard).
  await desktop.evaluate(async () => {
    const { event } = await import('./sim.js');
    for (let i = 0; i < 40; i++) event(ashline.state, 'Rifle squad lost', 0, { kind: 'unitLost', rank: 0 });
    for (let i = 0; i < 9; i++) event(ashline.state, `Survey note ${i}`, 0, { kind: 'mission' });
  });
  await desktop.waitForFunction(() => /Rifle squad lost ×40/.test(document.querySelector('#announcer').textContent));
  const said = await desktop.locator('#announcer').textContent();
  assert.equal(said.match(/Rifle squad lost/g).length, 1, 'Repeats are announced once with a count');
  assert.match(said, /\d+ more messages\.$/, 'A long burst ends in a summary'); assert(said.length < 300);
  assert(await desktop.locator('#notifications .toast-jump').evaluateAll(list => list.length > 0 && list.every(b => b.tabIndex === -1)), 'Jump marks stay out of the tab order');

  // Army selection is armed units only; idle buttons cycle what waits.
  await desktop.keyboard.press('e');
  const army = await desktop.evaluate(() => [...ashline.view.selected]);
  for (const id of [ids.engineer, ids.constructor]) assert(!army.includes(id), 'E leaves engineers and construction vehicles out');
  assert(army.includes(ids.artillery) && ids.rifles.every(id => army.includes(id)));
  await desktop.waitForFunction(() => Number(document.querySelector('#idle-units .idle-count').textContent) >= 3);
  await desktop.keyboard.press('.');
  const idleUnit = await desktop.evaluate(() => [...ashline.view.selected]);
  assert.equal(idleUnit.length, 1); assert([ids.constructor, ids.engineer, ids.far].includes(idleUnit[0]));
  const cycled = new Set(idleUnit);
  for (let i = 0; i < 2; i++) { await desktop.keyboard.press('.'); cycled.add(await desktop.evaluate(() => [...ashline.view.selected][0])); }
  assert.deepEqual([...cycled].sort((a, b) => a - b), [ids.engineer, ids.constructor, ids.far].sort((a, b) => a - b), 'Period cycles every idle unit');
  await desktop.keyboard.press('Shift+Period');
  assert.deepEqual(await desktop.evaluate(() => [...ashline.view.selected]), [ids.far], 'Shift + period selects the idle armed units away from base');
  await desktop.evaluate(id => { const e = ashline.state.entities.find(e => e.id === id); e.order = { type: 'move', x: e.x + 1, y: e.y }; }, ids.far);
  await desktop.keyboard.press('Shift+Period');
  assert.deepEqual(await desktop.evaluate(() => [...ashline.view.selected]), [ids.far], 'Without idle armed units Shift + period leaves the selection alone');
  assert.match(await desktop.locator('#notifications').innerText(), /No idle armed units away from base/);
  await desktop.evaluate(id => { ashline.state.entities.find(e => e.id === id).order = { type: 'idle' }; }, ids.far);
  await desktop.keyboard.press(',');
  assert([ids.barracks, ids.factory, ids.lab].includes(await desktop.evaluate(() => [...ashline.view.selected][0])), 'Comma selects an idle production building');
  await desktop.keyboard.press('Escape');

  // Console keys and five-unit queueing, then click-to-cancel rows with full refunds.
  await desktop.locator('#train-tab').click();
  assert.equal(await desktop.locator(`[data-type="${ids.rifleType}"] .card-key`).textContent(), 'T');
  // Haulers keep delivering during the check; credits net of mined income isolate costs and refunds.
  const credits = () => desktop.evaluate(() => { const team = ashline.state.teams[0]; return team.credits - (team.stats?.mined ?? 0); });
  const queueOf = id => desktop.evaluate(id => ashline.state.entities.find(e => e.id === id).queue.map(q => q.type), id);
  const before = await credits();
  await desktop.locator('#world').focus(); await desktop.keyboard.press('t');
  assert.equal((await queueOf(ids.barracks)).length, 1, 'The card key recruits');
  await desktop.keyboard.press('Shift+T');
  assert.equal((await queueOf(ids.barracks)).length, 6, 'Shift + key queues five more');
  assert.equal(before - await credits(), 6 * 80);
  await desktop.waitForFunction(() => document.querySelector('.queue-chip'));
  assert.match(await desktop.locator('.queue-chip').first().textContent(), /×5/);
  await desktop.locator('.queue-chip').first().click();
  assert.equal((await queueOf(ids.barracks)).length, 5, 'A waiting chip cancels one queued unit');
  await desktop.locator(`.queue-item[data-key="t${ids.barracks}"] .queue-main`).click();
  assert.equal((await queueOf(ids.barracks)).length, 4, 'Clicking the row cancels the unit in training');
  assert.equal(before - await credits(), 4 * 80, 'Cancelled units are refunded in full');
  await desktop.locator(`[data-type="${ids.rifleType}"]`).click({ modifiers: ['Shift'] });
  assert.equal((await queueOf(ids.barracks)).length, 6, 'Shift-click queues until the bay is full');
  assert.match(await desktop.locator('#notifications').innerText(), /2 × .* added to production · Production queues? full/);

  // Card tooltips show combat figures from the armor table.
  await desktop.locator(`[data-type="${await desktop.evaluate(async () => (await import('./sim.js')).raceUnit(ashline.state, 0, 'rocket'))}"]`).hover();
  await desktop.waitForFunction(() => !document.querySelector('#card-tooltip').hidden);
  const tip = await desktop.locator('#card-tooltip').innerText();
  assert.match(tip, /25 DPS · range 7/); assert.match(tip, /Strong against heavy armor/); assert.match(tip, /Weak against infantry/); assert.match(tip, /Key Y/);
  await desktop.screenshot({ path: `${output}/ui-tooltip-desktop.png` });

  // Research cards cancel an active project.
  await desktop.locator('#research-tab').click();
  const researchCredits = await credits();
  await desktop.locator('[data-research="infantryWeapons"]').click();
  await desktop.waitForFunction(() => document.querySelector('[data-research="infantryWeapons"]').dataset.state === 'active');
  await desktop.locator('[data-research="infantryWeapons"]').click();
  await desktop.waitForFunction(id => !ashline.state.entities.find(e => e.id === id).research, ids.lab);
  assert.equal(await credits(), researchCredits, 'Cancelling research refunds it');

  // Abilities: self abilities fire at once; ground abilities take a target, including on the tactical map.
  await desktop.locator('#build-tab').click();
  await desktop.evaluate(rifles => { ashline.view.selected = new Set(rifles); }, ids.rifles);
  await desktop.waitForFunction(() => !document.querySelector('#ability-order').hidden);
  assert.match(await desktop.locator('#ability-label').textContent(), /Dig in|Brace protocol/);
  await desktop.locator('#world').focus(); await desktop.keyboard.press('f');
  assert((await entity(desktop, ids.rifles[0])).abilityUntil > 0, 'F digs the squads in');
  await desktop.waitForFunction(() => document.querySelector('#ability-order').classList.contains('recharging'));
  assert(Number(await desktop.locator('#ability-order').evaluate(e => getComputedStyle(e).getPropertyValue('--cooldown'))) > .9, 'The recharge sweep starts full');
  await desktop.evaluate(({ scout, rifles }) => { ashline.view.selected = new Set([scout, ...rifles]); }, ids);
  await desktop.waitForTimeout(200);
  assert.match(await desktop.locator('#ability-label').textContent(), /Dig in|Brace protocol/, 'A mixed selection uses its largest ability group');
  await desktop.evaluate(({ scout }) => { ashline.view.selected = new Set([scout]); }, ids);
  await desktop.waitForFunction(() => /Flare|Sensor probe/.test(document.querySelector('#ability-label').textContent));
  await desktop.keyboard.press('f');
  assert.match(await desktop.locator('#order-hint-text').textContent(), /within 14 tiles/);
  const scout = await entity(desktop, ids.scout);
  // Targeting belongs to the ability it began with: recalling a group with another ability leaves it,
  // and the next ground click selects instead of spending that ability.
  await desktop.evaluate(id => { ashline.view.selected = new Set([id]); }, ids.engineer);
  await desktop.keyboard.press('Shift+Digit4');
  await desktop.evaluate(id => { ashline.view.selected = new Set([id]); }, ids.scout);
  await desktop.waitForFunction(() => /Flare|Sensor probe/.test(document.querySelector('#ability-label').textContent));
  await desktop.keyboard.press('f');
  assert(await desktop.locator('#ability-order').evaluate(e => e.classList.contains('active')));
  await desktop.keyboard.press('Digit4');
  await desktop.waitForFunction(() => /Field patch|Nano-patch/.test(document.querySelector('#ability-label').textContent));
  assert(await desktop.locator('#order-hint').isHidden(), 'Changing the selection leaves ground targeting');
  assert(!(await desktop.locator('#ability-order').evaluate(e => e.classList.contains('active'))));
  const ground = await point(desktop, scout.x + 2.5, scout.y + 2.5);
  await desktop.mouse.click(ground.x, ground.y);
  const patched = await entity(desktop, ids.engineer);
  assert(!(patched.abilityReadyAt > 0), 'A ground click after the switch does not fire the new selection\'s ability');
  // A right click on the tactical map cancels pending targeting, as it does on the battlefield.
  await desktop.evaluate(id => { ashline.view.selected = new Set([id]); }, ids.scout);
  await desktop.waitForFunction(() => /Flare|Sensor probe/.test(document.querySelector('#ability-label').textContent));
  await desktop.keyboard.press('f');
  const away = await mapPoint(desktop, scout.x + 20, scout.y + 20);
  await desktop.mouse.click(away.x, away.y, { button: 'right' });
  assert(await desktop.locator('#order-hint').isHidden(), 'Right click on the tactical map cancels targeting');
  assert.notEqual((await entity(desktop, ids.scout)).order.type, 'move', 'The cancelling right click sends no move order');
  await desktop.keyboard.press('f');
  const flareAt = await mapPoint(desktop, scout.x + 6, scout.y - 4);
  await desktop.mouse.click(flareAt.x, flareAt.y);
  const reveal = await desktop.evaluate(() => ashline.state.reveals?.[0]);
  assert(reveal && reveal.team === 0 && Math.hypot(reveal.x - scout.x - 6, reveal.y - scout.y + 4) < 1, 'A tactical-map click aims the flare');
  assert(await desktop.locator('#order-hint').isHidden());

  // Tactical map orders: right click moves the selection; Q then a map click attack-moves.
  await desktop.evaluate(rifles => { ashline.view.selected = new Set(rifles); }, ids.rifles);
  const target = await mapPoint(desktop, ids.core.x + 12, ids.core.y - 10);
  await desktop.mouse.click(target.x, target.y, { button: 'right' });
  let order = (await entity(desktop, ids.rifles[0])).order;
  assert(order.type === 'move' && Math.hypot(order.x - ids.core.x - 12, order.y - ids.core.y + 10) < 4, 'Right click on the tactical map orders the selection');
  await desktop.keyboard.press('q'); await desktop.mouse.click(target.x, target.y);
  assert.equal((await entity(desktop, ids.rifles[0])).order.type, 'attackMove', 'Attack move accepts a tactical-map click');
  await desktop.keyboard.press('h');

  // A second press of a group number centers it.
  await desktop.keyboard.press('Shift+Digit3'); await desktop.locator('#home').click();
  await desktop.locator('#world').focus(); await desktop.keyboard.press('3'); await desktop.keyboard.press('3');
  camera = await desktop.evaluate(() => ({ x: ashline.view.x, y: ashline.view.y }));
  const rifle = await entity(desktop, ids.rifles[0]);
  assert(Math.hypot(camera.x - rifle.x, camera.y - rifle.y) < 4, 'Double-pressing a group centers the camera');

  // Hover readout names friendly callsigns and visible enemies only.
  const rp = await point(desktop, rifle.x, rifle.y);
  await desktop.mouse.move(rp.x, rp.y);
  await desktop.waitForFunction(() => /Rank \d\/3/.test(document.querySelector('#terrain-readout').textContent));
  const sign = await desktop.evaluate(async id => (await import('./character.js')).callsign(ashline.state, ashline.state.entities.find(e => e.id === id)), ids.rifles[0]);
  assert((await desktop.locator('#terrain-readout').textContent()).startsWith(sign));
  // Replies are throttled; let the group's reply settle before asking this unit directly.
  await desktop.waitForTimeout(1300);
  await desktop.mouse.click(rp.x, rp.y);
  await desktop.waitForFunction(() => !document.querySelector('#comms').hidden);
  assert.equal(await desktop.locator('#comms-callsign').textContent(), sign, 'Selecting a unit brings a reply in its own name');
  assert.equal(await desktop.locator('#selection-callsign').textContent(), sign);
  const enemy = await desktop.evaluate(async ({ x, y }) => {
    const m = await import('./sim.js'), e = m.addEntity(ashline.state, 1, 'unit', m.raceUnit(ashline.state, 1, 'tank'), x, y); return { id: e.id, x: e.x, y: e.y };
  }, { x: rifle.x + 4, y: rifle.y + 2 });
  const ep = await point(desktop, enemy.x, enemy.y);
  await desktop.mouse.move(ep.x, ep.y);
  await desktop.waitForFunction(() => /^Hostile/.test(document.querySelector('#terrain-readout').textContent));
  await desktop.evaluate(({ x, y }) => { const s = ashline.state; s.visible[0][Math.floor(y) * s.width + Math.floor(x)] = 0; }, enemy);
  await desktop.mouse.move(ep.x + 1, ep.y);
  await desktop.waitForFunction(() => !/Hostile/.test(document.querySelector('#terrain-readout').textContent));
  await desktop.evaluate(id => { ashline.state.entities = ashline.state.entities.filter(e => e.id !== id); }, enemy.id);

  // A crew only boasts about a promotion when the player saw the kill; the toast still names the veteran.
  const promotionLines = await desktop.evaluate(async type => { const { barkLine } = await import('./character.js'); return [...new Set(Array.from({ length: 8 }, (_, i) => barkLine(type, 'promotion', i)))]; }, ids.rifleType);
  const promote = visible => desktop.evaluate(async ({ id, visible }) => {
    const { event } = await import('./sim.js'), s = ashline.state, u = s.entities.find(e => e.id === id), x = u.x + 3, y = u.y;
    s.visible[0][Math.floor(y) * s.width + Math.floor(x)] = visible ? 1 : 0;
    event(s, 'Rifle squad promoted to rank 1', 0, { kind: 'promotion', rank: 1, entityId: u.id, role: 'rifle', x: u.x, y: u.y });
    event(s, 'Rifle squad lost', 1, { kind: 'unitLost', rank: 0, entityId: 1, role: 'rifle', x, y });
  }, { id: ids.rifles[1], visible });
  await desktop.waitForTimeout(1300); await promote(false);
  const named = await desktop.evaluate(async id => (await import('./character.js')).callsign(ashline.state, ashline.state.entities.find(e => e.id === id)), ids.rifles[1]);
  await desktop.waitForTimeout(600);
  assert(!/promoted to rank/.test(await desktop.locator('#notifications').textContent()), 'A promotion for a kill made out of sight is not announced as it happens');
  assert(!/promoted to rank/.test(await desktop.locator('#announcer').textContent()));
  assert(!promotionLines.includes(await desktop.locator('#comms-text').textContent()), 'No boast for a kill made out of sight');
  await desktop.evaluate(id => { ashline.view.selected = new Set([id]); }, ids.rifles[1]);
  await desktop.waitForFunction(() => /\(.+\) promoted to rank 1/.test(document.querySelector('#notifications').textContent));
  const held = (await tones(desktop)).find(t => /promoted to rank 1/.test(t.text));
  assert.match(held.text, new RegExp(`${named} \\(Rifle squad\\) promoted to rank 1`), 'Promotion messages name the veteran');
  assert(!held.jump, 'A promotion held back from an unseen kill carries no location');
  await desktop.evaluate(() => ashline.view.selected.clear());
  await desktop.waitForTimeout(1300); await promote(true);
  await desktop.waitForFunction(lines => lines.includes(document.querySelector('#comms-text').textContent), promotionLines);
  assert((await tones(desktop)).some(t => /promoted to rank 1/.test(t.text) && t.jump), 'A seen promotion is announced at once with a location');

  // Signals intercept: five or more visible armed rivals closing on a structure name their commander.
  const column = await desktop.evaluate(async core => {
    const m = await import('./sim.js'), s = ashline.state, ids = [];
    for (let i = 0; i < 6; i++) { const e = m.addEntity(s, 1, 'unit', m.raceUnit(s, 1, 'rifle'), core.x + 15 + i % 2, core.y - 2 + i); e.angle = Math.PI; e.cooldown = 1e6; e.hp = e.maxHp = 1e6; ids.push(e.id); }
    // The fixture silences the rival; a commander is named only while an AI leads that side. The
    // column outlasts the base's return fire for the few seconds the check needs.
    s.aiTeams = [1]; s.ai.nextThink = 1e9; return ids;
  }, ids.core);
  await desktop.waitForFunction(commander => document.querySelector('#notifications').textContent.includes(`Intercept: ${commander} column advancing · 6 contacts`), setup.commander, { timeout: 8000 });
  assert(await desktop.evaluate(() => document.querySelector('#notifications .toast[data-tone=warning] .toast-speaker')?.textContent === 'Signals'));
  await desktop.evaluate(column => { ashline.state.aiTeams = []; ashline.state.entities = ashline.state.entities.filter(e => !column.includes(e.id)); }, column);

  // Shift keeps a structure in hand for repeat placement.
  await desktop.locator('#home').click(); await desktop.locator('#build-tab').click();
  await desktop.locator(`[data-type="${await desktop.evaluate(async () => (await import('./sim.js')).raceBuilding(ashline.state, 0, 'reactor'))}"]`).click();
  const site = await desktop.evaluate(async () => {
    const m = await import('./sim.js'), s = ashline.state, type = m.raceBuilding(s, 0, 'reactor'), core = s.entities.find(e => e.team === 0 && m.buildingRole(e) === 'core');
    for (let y = core.y - 8; y < core.y + 9; y++) for (let x = core.x - 8; x < core.x + 10; x++) {
      const p = ashline.renderer.worldToScreen(x + .5, y + .5, ashline.view);
      if (p.x > 260 && p.y > 260 && p.x < ashline.renderer.width - 300 && p.y < ashline.renderer.height - 200 && m.canPlace(s, 0, type, x, y).ok) return { x: x + .5, y: y + .5 };
    }
  });
  const sp = await point(desktop, site.x, site.y);
  await desktop.keyboard.down('Shift'); await desktop.mouse.click(sp.x, sp.y); await desktop.keyboard.up('Shift');
  assert(await desktop.evaluate(() => Boolean(ashline.view.placement)), 'Shift-placing keeps the structure selected');
  await desktop.keyboard.press('Escape');
  await desktop.screenshot({ path: `${output}/ui-hud-desktop.png` });

  // The rank line steps down to shorter forms instead of cutting off what its bonus applies to.
  await desktop.evaluate(id => { ashline.view.selected = new Set([id]); }, ids.rifles[2]);
  for (const [width, height] of [[1190, 800], [1000, 760], [900, 700], [700, 900], [681, 900], [600, 900], [390, 844]]) {
    await desktop.setViewportSize({ width, height });
    for (const kills of [0, 7, 15]) {
      await desktop.evaluate(({ id, kills }) => { ashline.state.entities.find(e => e.id === id).kills = kills; }, { id: ids.rifles[2], kills });
      await desktop.waitForFunction(kills => { const e = document.querySelector('#selection-rank'); return !e.hidden && e.dataset.kills === String(kills) && e.dataset.layout?.endsWith(`:${e.clientWidth}`); }, kills);
      const rank = await desktop.locator('#selection-rank').evaluate(e => ({ over: e.scrollWidth > e.clientWidth, text: e.textContent, width: e.clientWidth }));
      assert(rank.width > 60, `Rank line is shown at ${width}px`); assert(!rank.over, `Rank line fits at ${width}px with ${kills} kills: ${rank.text}`);
      assert.match(rank.text, /\+\d+% dmg\/HP/, `Rank line keeps its bonus readable at ${width}px`);
    }
    if (width === 700) await desktop.screenshot({ path: `${output}/ui-rank-700.png` });
  }
  await desktop.evaluate(id => { ashline.state.entities.find(e => e.id === id).kills = 0; ashline.view.selected.clear(); }, ids.rifles[2]);
  await desktop.setViewportSize({ width: 1440, height: 900 });
  await desktop.waitForTimeout(300);

  // Settings persist; the speed slider gives the arrow keys back to the camera after a drag.
  await desktop.locator('#pause').click();
  await desktop.locator('#edge-scroll-toggle').click(); await desktop.locator('#tooltips-toggle').click();
  assert.equal(await desktop.locator('#edge-scroll-toggle').getAttribute('aria-pressed'), 'false');
  await desktop.locator('#resume').click();
  const slider = await desktop.locator('#game-speed').boundingBox();
  await desktop.mouse.click(slider.x + slider.width - 3, slider.y + slider.height / 2);
  assert.equal(await desktop.evaluate(() => document.activeElement.id), 'world', 'The slider releases focus after a pointer change');
  await desktop.reload(); await desktop.waitForFunction(() => window.ashline?.booted);
  assert.equal(await desktop.locator('#game-speed').inputValue(), '200', 'Game speed persists');
  assert.equal(await desktop.locator('#edge-scroll-toggle').getAttribute('aria-pressed'), 'false', 'Edge scrolling preference persists');
  assert.equal(await desktop.locator('#tooltips-toggle').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await desktop.evaluate(() => JSON.parse(localStorage.getItem('ashline.settings.v1'))), { speed: 200, edgeScroll: false, shake: true, tooltips: false });
  await desktop.close();

  // Phone: the log, idle chips and comms stay clear of the selection panel and the console.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); watch(phone, 'phone');
  await phone.addInitScript(() => localStorage.removeItem('ashline.settings.v1'));
  await deploy(phone);
  const phoneIds = await fixture(phone);
  await phone.evaluate(async rifles => {
    const { event } = await import('./sim.js'); ashline.view.selected = new Set(rifles);
    event(ashline.state, 'Field barracks under attack', 0, { kind: 'underAttack', x: 20, y: 20 });
    event(ashline.state, 'All hostile nexuses and construction vehicles destroyed. Sector secured.', 0, { kind: 'victory' });
  }, phoneIds.rifles);
  await phone.waitForFunction(() => document.querySelectorAll('#notifications .toast').length === 2 && !document.querySelector('#selection-panel').hidden);
  await phone.waitForTimeout(300);
  const layout = await phone.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const toasts = [...document.querySelectorAll('#notifications .toast')].map(t => t.getBoundingClientRect());
    return { toasts, panel: rect('#selection-panel'), idle: rect('.idle-group'), top: rect('.topbar'), width: innerWidth, scroll: document.documentElement.scrollWidth };
  });
  assert(layout.scroll <= layout.width, 'No horizontal overflow on a phone');
  for (const t of layout.toasts) { assert(t.bottom <= layout.panel.top + 1, 'Messages stay above the selection panel'); assert(t.left >= 0 && t.right <= layout.width); }
  assert(layout.idle.top >= layout.top.bottom, 'Idle chips sit below the topbar');
  await phone.screenshot({ path: `${output}/ui-hud-phone.png` });
  await phone.locator('#command-toggle').tap();
  // Fresh lines, so a slow screenshot under load cannot let the earlier ones expire first.
  await phone.evaluate(async () => {
    const { event } = await import('./sim.js');
    event(ashline.state, 'Field barracks under attack', 0, { kind: 'underAttack', x: 22, y: 22 });
    event(ashline.state, 'Report from the shard convoy', 0, { kind: 'mission' });
  });
  await phone.waitForFunction(() => [...document.querySelectorAll('#notifications .toast')].some(t => t.textContent.includes('shard convoy')) && document.querySelectorAll('#notifications .toast').length >= 2);
  await phone.waitForTimeout(250);
  const open = await phone.evaluate(() => ({ sidebar: document.querySelector('#command-console').getBoundingClientRect(), toasts: [...document.querySelectorAll('#notifications .toast')].filter(t => getComputedStyle(t).display !== 'none').map(t => t.getBoundingClientRect()) }));
  assert.equal(open.toasts.length, 1, 'With the console open only the newest message shows');
  assert(open.toasts[0].top >= open.sidebar.bottom - 1, 'The message sits below the open console');
  await phone.screenshot({ path: `${output}/ui-console-phone.png` });
  await phone.close();

  assert.deepEqual(errors, []);
  console.log(`Interface browser check passed: setup commanders and modes, routed message log with jumps and alerts, armed-only army, idle cycling, card keys and five-unit queues, queue and research cancellation, tooltips, abilities with ground and tactical-map targeting, tactical-map orders, group centering, hover readout and comms, fog-gated promotion boasts and held promotion news, ability targeting that follows the selection, rank line forms, commander intercepts, repeat placement, persisted settings, phone layout. Screenshots: ${output}`);
} finally { await browser.close(); }
