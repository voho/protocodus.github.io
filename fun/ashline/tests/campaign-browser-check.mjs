// Run with ASHLINE_PLAYWRIGHT=/path/to/playwright/index.mjs and ASHLINE_URL.
// Plays Landfall and Hold the Line from the briefing with real commands through window.ashline and the
// game's own modules: campaign tab, loading line, pre-start pause, objective tracker, transmissions,
// victory debrief with medals, Next operation, persistence across a reload, the Field archive, queued
// transmissions and the pause-menu Retry in Signal in the Ash, a skirmish mode that starts unpaused, and the
// phone and landscape-phone layouts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); };
const ready = page => page.waitForFunction(() => window.ashline?.booted);
const prestart = page => page.waitForFunction(() => ashline.state && !ashline.loading && document.querySelector('#menu').open, null, { timeout: 120000 });
const objective = (page, id) => page.evaluate(id => ashline.state.mission.objectives.find(o => o.id === id).state, id);
const until = (page, predicate, arg, timeout = 120000) => page.waitForFunction(predicate, arg, { timeout, polling: 100 });
// Commands run inside the page through the same simulation module the game loop uses.
const command = (page, body, arg) => page.evaluate(async ([source, value]) => {
  const sim = await import('./sim.js'), s = ashline.state;
  const own = (team, role) => s.entities.filter(e => e.team === team && e.hp > 0 && sim.entityRole(e) === role);
  const core = own(0, 'core')[0], center = core ? { x: core.x + 1.5, y: core.y + 1.5 } : null;
  const site = (type, min = 3, max = 13) => { for (let r = min; r < max; r++) for (let y = Math.floor(center.y) - r; y <= center.y + r; y++) for (let x = Math.floor(center.x) - r; x <= center.x + r; x++) if (Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) >= r - 1 && sim.canPlace(s, 0, type, x, y).ok) return { x, y }; return null; };
  return new Function('sim', 's', 'own', 'center', 'site', 'value', source)(sim, s, own, center, site, value);
}, [body, arg]);
const setSpeed = page => page.evaluate(() => { const slider = document.querySelector('#game-speed'); slider.value = '200'; slider.dispatchEvent(new Event('input')); slider.blur(); });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); watch(page);
  await page.goto(url); await ready(page);
  await page.evaluate(() => { localStorage.removeItem('ashline.campaign.v1'); localStorage.removeItem('ashline.career.v1'); });
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => ashline.state), null, 'The briefing creates no game');
  assert(await page.locator('#skirmish-panel').isVisible(), 'A first visit opens on the skirmish setup');

  // Campaign tab: only Landfall is open; its briefing lists objectives, unlocks and par.
  await page.locator('#campaign-tab').click();
  assert(await page.locator('#campaign-panel').isVisible() && await page.locator('#skirmish-panel').isHidden());
  const list = await page.evaluate(() => [...document.querySelectorAll('.campaign-entry')].map(b => ({ id: b.dataset.mission, disabled: b.disabled })));
  assert.equal(list.length, 8); assert.deepEqual(list.map(e => e.disabled), [false, true, true, true, true, true, true, true]);
  assert.equal(await page.locator('#campaign-name').textContent(), 'Landfall');
  assert.match(await page.locator('#campaign-unlocks').textContent(), /Field barracks/);
  assert.equal(await page.locator('#campaign-par').textContent(), '09:00');
  await page.screenshot({ path: `${output}/campaign-briefing.png` });

  // The Field archive opens from the briefing with lore for every section.
  await page.locator('#archive-open').click();
  assert(await page.locator('#archive').evaluate(dialog => dialog.open));
  for (const section of ['factions', 'people', 'organics', 'unity']) { await page.locator(`#archive-tab-${section}`).click(); assert(await page.locator('.archive-entry').count() > 3); }
  assert.equal(await page.locator('.archive-entry').count(), 19, 'Nine units and ten structures for AI Unity');
  await page.locator('#archive-close').click();

  // Landfall: loading line, then a paused pre-start briefing that waits for Begin operation.
  await page.evaluate(() => { window.loadingLines = []; window.lineTimer = setInterval(() => { const line = document.querySelector('#loading-briefing'); if (document.querySelector('#loading').open && !line.hidden) loadingLines.push(line.textContent); }, 30); });
  await page.locator('#campaign-start').click();
  await prestart(page);
  const start = await page.evaluate(() => { clearInterval(lineTimer); return { lines: loadingLines, paused: ashline.paused, time: ashline.state.time, mission: ashline.state.mission.id, seed: ashline.state.seed, title: document.querySelector('#menu-title').textContent, resume: document.querySelector('#resume').textContent.trim() }; });
  assert(start.lines.some(line => /Expedition 07 makes landfall/.test(line)), 'The loading screen carries the operation briefing');
  assert.deepEqual({ ...start, lines: undefined }, { lines: undefined, paused: true, time: 0, mission: 'landfall', seed: 'LANDFALL-07', title: 'Landfall', resume: 'Begin operation ↗' });
  assert.match(await page.locator('#objective').textContent(), /Move two units to the survey marker/);
  await page.waitForTimeout(300); assert.equal(await page.evaluate(() => ashline.state.time), 0, 'The operation waits for the commander');
  await page.screenshot({ path: `${output}/campaign-prestart.png` });
  await page.locator('#resume').click(); await setSpeed(page);
  await until(page, () => ashline.state.time > 1.5 && !document.querySelector('#objectives').hidden);
  assert.equal(await page.locator('#objectives-title').textContent(), 'Landfall');
  assert.match(await page.locator('#objectives-list').textContent(), /Move two units to the survey marker/);
  await until(page, () => !document.querySelector('#transmission').hidden);
  assert.equal(await page.locator('#transmission-speaker').textContent(), 'Cmdr. Vale');
  // A zone objective's locate button centres the camera on its static marker.
  await page.locator('#objectives-list .objective-locate').first().click();
  assert(await page.evaluate(() => { const marker = ashline.state.mission.zones.find(z => z.id === 'marker'); return Math.hypot(ashline.view.x - marker.x, ashline.view.y - marker.y) < 4; }), 'Locate centres the survey marker');
  // Construction lists only what Landfall clears.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#catalog .build-card')].map(card => card.dataset.type)), ['reactor', 'refinery', 'barracks']);

  // Walk the ground, raise a barracks, train three squads, then clear the picket.
  await command(page, `const marker=s.mission.zones.find(z=>z.id==='marker');const squad=own(0,'rifle').slice(0,2);sim.issueOrder(s,squad.map(e=>e.id),{type:'move',x:marker.x,y:marker.y});`);
  await until(page, () => ashline.state.mission.objectives.find(o => o.id === 'marker').state === 'done');
  await until(page, () => document.querySelector('#objectives-list li[data-state=done]'));
  const barracks = await command(page, `const p=site('barracks');return sim.placeBuilding(s,0,'barracks',p.x,p.y).id;`);
  assert(barracks, 'The barracks is placed with a real construction order');
  await until(page, () => ashline.state.mission.objectives.find(o => o.id === 'barracks').state === 'done');
  await command(page, `for(let i=0;i<3;i++)if(!sim.trainUnit(s,0,'rifle',value).ok)throw new Error('Training refused');`, barracks);
  await until(page, () => ashline.state.mission.objectives.find(o => o.id === 'rifles').state === 'done');
  await until(page, () => ashline.state.mission.objectives.find(o => o.id === 'shards').state === 'done');
  await page.screenshot({ path: `${output}/campaign-landfall-tracker.png` });
  // The picket includes units, so the tracker never totals it (that would count forces under fog).
  await until(page, () => [...document.querySelectorAll('#objectives-list li')].some(li => /Clear the Unity picket/.test(li.textContent)));
  assert.doesNotMatch(await page.evaluate(() => [...document.querySelectorAll('#objectives-list li')].find(li => /Clear the Unity picket/.test(li.textContent)).textContent), /\d+ \/ \d+/);
  await command(page, `const picket=s.mission.zones.find(z=>z.id==='picket');const army=s.entities.filter(e=>e.team===0&&e.kind==='unit'&&e.hp>0&&sim.UNITS[e.type].damage>0);sim.issueOrder(s,army.map(e=>e.id),{type:'attackMove',x:picket.x,y:picket.y});`);
  await until(page, () => ashline.state.status !== 'playing' && document.querySelector('#menu').open, null, 240000);
  assert.equal(await page.evaluate(() => ashline.state.status), 'victory', 'Landfall is won with real orders');
  assert.equal(await objective(page, 'picket'), 'done');

  // The debrief replaces the one-line summary: grade, score, record table, medal criteria and career.
  assert(await page.locator('#match-summary').isVisible());
  const debrief = await page.evaluate(() => ({ title: document.querySelector('#menu-title').textContent, grade: document.querySelector('#match-summary .grade').textContent,
    medal: document.querySelector('#match-summary .debrief-head .medal').dataset.medal, rows: document.querySelectorAll('.debrief-table tbody tr').length,
    rival: document.querySelector('.debrief-table thead th:last-child').textContent, criteria: document.querySelectorAll('.debrief-medals li').length,
    next: !document.querySelector('#next-operation').hidden, retry: !document.querySelector('#retry-operation').hidden, remix: !document.querySelector('#remix-operation').hidden,
    stored: JSON.parse(localStorage.getItem('ashline.campaign.v1')), career: JSON.parse(localStorage.getItem('ashline.career.v1')) }));
  assert.equal(debrief.title, 'Operation complete.'); assert.match(debrief.grade, /^[SABCD]$/); assert(['bronze', 'silver', 'gold'].includes(debrief.medal));
  assert.equal(debrief.rows, 10); assert.equal(debrief.rival, 'AI Unity'); assert.equal(debrief.criteria, 3);
  assert(debrief.next && debrief.retry && debrief.remix, 'Next operation, Retry and Remix are offered');
  assert.equal(debrief.stored.missions.landfall.wins, 1); assert.equal(debrief.stored.missions.landfall.medal, debrief.medal); assert.equal(debrief.stored.selected, 'hold-the-line');
  assert.equal(debrief.career.operations, 1); assert.equal(debrief.career.victories, 1);
  await page.screenshot({ path: `${output}/campaign-debrief.png` });

  // Next operation: Hold the Line, played by a small commander that builds, trains and engages.
  await page.locator('#next-operation').click();
  await prestart(page);
  assert.equal(await page.evaluate(() => [ashline.state.mission.id, document.querySelector('#menu-title').textContent].join()), 'hold-the-line,Hold the Line');
  await page.locator('#resume').click(); await setSpeed(page);
  const commander = `
    const done=role=>own(0,role).filter(e=>e.progress>=1).length,all=role=>own(0,role).length;
    if(!all('barracks')){const p=site('barracks');if(p)sim.placeBuilding(s,0,'barracks',p.x,p.y);}
    else if(all('reactor')<2&&s.teams[0].credits>=240){const p=site('reactor');if(p)sim.placeBuilding(s,0,'reactor',p.x,p.y);}
    else if(done('barracks')&&all('turret')<6&&s.teams[0].credits>=300){const p=site('turret');if(p)sim.placeBuilding(s,0,'turret',p.x,p.y);}
    const barracks=own(0,'barracks').find(e=>e.progress>=1);
    if(barracks&&barracks.queue.length<2&&s.teams[0].credits>=200)sim.trainUnit(s,0,all('rocket')<4||s.time%20>=10?'rocket':'rifle',barracks.id);
    const foes=s.entities.filter(e=>e.team===1&&e.hp>0&&s.visible[0][Math.floor(e.y)*s.width+Math.floor(e.x)]&&Math.hypot(e.x-center.x,e.y-center.y)<22);
    const idle=s.entities.filter(e=>e.team===0&&e.kind==='unit'&&e.hp>0&&sim.UNITS[e.type].damage>0&&e.order.type==='idle');
    if(foes.length&&idle.length)sim.issueOrder(s,idle.map(e=>e.id),{type:'attackMove',x:foes[0].x,y:foes[0].y});
    // Fast-forward three seconds of the same simulation between frames, short of the final seconds.
    for(let i=0;i<value&&s.status==='playing'&&s.time-s.mission.startedAt<470;i++)sim.updateGame(s,1);
    return {time:s.time,status:s.status};`;
  for (let step = 0; step < 400; step++) {
    const state = await command(page, commander, 3);
    assert.equal(state.status, 'playing', 'The line holds');
    if (state.time >= 470) break;
    if (step % 20 === 0) await page.waitForTimeout(60);
  }
  await page.screenshot({ path: `${output}/campaign-hold-the-line.png` });
  await until(page, () => ashline.state.status !== 'playing' && document.querySelector('#menu').open, null, 120000);
  assert.equal(await page.evaluate(() => ashline.state.status), 'victory', 'Hold the Line is won');
  const hold = await page.evaluate(() => ({ waves: ashline.state.events.filter(e => e.kind === 'wave').length, raids: ashline.state.mission.counters['repeat:raids'], sentries: ashline.state.mission.objectives.find(o => o.id === 'sentries').state }));
  assert.deepEqual(hold, { waves: 10, raids: 9, sentries: 'done' });

  // Remix replays the operation on a newly generated sector; Operations returns to the campaign list.
  assert(await page.locator('#remix-operation').isVisible());
  await page.locator('#remix-operation').click(); await prestart(page);
  assert.deepEqual(await page.evaluate(() => [ashline.state.mission.id, /^REMIX-/.test(ashline.state.seed), document.querySelector('#resume').textContent.trim()]), ['hold-the-line', true, 'Begin operation ↗']);
  assert.equal(await page.locator('#new-game').textContent(), 'Operations');
  await page.locator('#new-game').click();
  assert(await page.locator('#campaign-panel').isVisible() && await page.evaluate(() => ashline.state === null));

  // Progress survives a reload: the campaign tab returns with medals and the third operation open.
  await page.reload(); await ready(page);
  assert(await page.locator('#campaign-panel').isVisible(), 'The briefing reopens on the campaign');
  const after = await page.evaluate(() => ({ entries: [...document.querySelectorAll('.campaign-entry')].map(b => ({ disabled: b.disabled, medal: b.querySelector('.medal').dataset.medal, pressed: b.getAttribute('aria-pressed') })),
    name: document.querySelector('#campaign-name').textContent, progress: document.querySelector('#campaign-progress').textContent, career: document.querySelector('#career-line').textContent }));
  assert.deepEqual(after.entries.map(e => e.disabled), [false, false, false, true, true, true, true, true]);
  // The remix launched last keeps Hold the Line selected; the unfinished remix records nothing.
  assert(after.entries.slice(0, 2).every(e => e.medal !== 'none')); assert.equal(after.entries[1].pressed, 'true'); assert.equal(after.name, 'Hold the Line');
  assert.equal(after.progress, '2 / 8'); assert.match(after.career, /2 operations · 2 victories/);
  await page.screenshot({ path: `${output}/campaign-progress.png` });

  // Signal in the Ash: two speakers answer the same intrusion, and the tracker plays both lines in order.
  await page.locator('.campaign-entry[data-mission="signal-in-the-ash"]').click();
  await page.locator('#campaign-start').click(); await prestart(page);
  await page.locator('#resume').click(); await setSpeed(page);
  await until(page, () => ashline.state.time > 30);
  const lines = await page.evaluate(async () => {
    const seen = [], text = document.querySelector('#transmission-text'), box = document.querySelector('#transmission');
    const note = () => { if (!box.hidden && seen.at(-1) !== text.textContent) seen.push(text.textContent); };
    const watcher = new MutationObserver(note); watcher.observe(box, { subtree: true, childList: true, characterData: true, attributes: true });
    const s = ashline.state, outpost = s.mission.zones.find(z => z.id === 'outpost'), scout = s.entities.find(e => e.team === 0 && e.type === 'scout');
    scout.x = outpost.x; scout.y = outpost.y;
    for (let wait = 0; wait < 120 && !seen.some(line => /^Those two Lance nodes/.test(line)); wait++) await new Promise(resolve => setTimeout(resolve, 250));
    watcher.disconnect();
    return seen;
  });
  const unity = lines.findIndex(line => /^Archive integrity is priority one/.test(line)), tesk = lines.findIndex(line => /^Those two Lance nodes/.test(line));
  assert(unity >= 0 && tesk > unity, `Both intrusion lines play in order: ${JSON.stringify(lines)}`);
  // A running operation can be restarted from the pause menu.
  await page.locator('#pause').click();
  assert(await page.locator('#retry-operation').isVisible(), 'Retry is offered while paused');
  await page.locator('#retry-operation').click(); await prestart(page);
  assert.deepEqual(await page.evaluate(() => [ashline.state.mission.id, ashline.state.time, ashline.state.seed]), ['signal-in-the-ash', 0, 'SIGNAL-ASH']);
  await page.locator('#new-game').click();

  // A skirmish mode starts unpaused, with its own tracker; annihilation keeps the commander's goals.
  await page.locator('#skirmish-tab').click();
  await page.locator('#map-size').selectOption('standard'); await page.locator('#skirmish-mode').selectOption('lastLight');
  assert.match(await page.locator('#mode-description').textContent(), /Score is seconds survived × kills ÷ 10/);
  await page.locator('#deploy').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
  await until(page, () => !document.querySelector('#objectives').hidden);
  assert.equal(await page.evaluate(() => [ashline.state.mission.id, document.querySelector('#objectives-title').textContent].join()), 'last-light,Last Light');
  // One setup path: Relay control keeps the chosen rival commander, and a restored relay skirmish shows its mode.
  await page.locator('#pause').click(); await page.locator('#new-game').click();
  // RELAY-CHECK draws Balanced, so a restored Swarm commander is named in setup.
  await page.locator('#seed').fill('RELAY-CHECK'); await page.locator('#skirmish-mode').selectOption('relay'); await page.locator('#rival-doctrine').selectOption('swarm'); await page.locator('#deploy').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
  assert.deepEqual(await page.evaluate(() => [ashline.state.mission.id, ashline.state.ai.doctrine]), ['relay-control', 'swarm']);
  await page.locator('#pause').click(); await page.locator('#save-game').click(); await page.locator('#new-game').click();
  await page.locator('#skirmish-mode').selectOption('annihilation'); await page.locator('#rival-doctrine').selectOption('random'); await page.locator('#load-saved').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && document.querySelector('#menu').open, null, { timeout: 120000 });
  assert.deepEqual(await page.evaluate(() => [ashline.state.mission.id, document.querySelector('#skirmish-mode').value, document.querySelector('#rival-doctrine').value]), ['relay-control', 'relay', 'swarm']);
  assert.match(await page.locator('#mode-description').textContent(), /lit relay/);
  await page.locator('#new-game').click();
  await page.locator('#skirmish-mode').selectOption('annihilation'); await page.locator('#rival-doctrine').selectOption('random'); await page.locator('#deploy').click();
  await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
  await until(page, () => !document.querySelector('#objectives').hidden);
  assert.equal(await page.locator('#objectives-title').textContent(), "Commander's goals");
  assert.equal(await page.evaluate(() => ashline.state.mission), undefined, 'Annihilation carries no mission state');
  await page.close();

  // Phone: the tracker starts collapsed beside the command toggle and never covers the action panel.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); watch(phone);
  await phone.goto(url); await ready(phone);
  await phone.locator('#campaign-tab').tap();
  assert(await phone.locator('#campaign-panel').isVisible());
  await phone.locator('.campaign-entry[data-mission="landfall"]').tap();
  await phone.locator('#campaign-start').tap(); await prestart(phone);
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await phone.screenshot({ path: `${output}/campaign-prestart-phone.png` });
  await phone.locator('#resume').tap();
  await until(phone, () => !document.querySelector('#objectives').hidden && ashline.state.time > 1);
  const layout = await phone.evaluate(() => { const box = id => document.querySelector(id).getBoundingClientRect(); const a = box('#objectives'), b = box('#command-toggle'); return { collapsed: document.querySelector('#objectives').dataset.collapsed, overlap: a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom, right: a.right, width: innerWidth }; });
  assert.equal(layout.collapsed, 'true'); assert.equal(layout.overlap, false); assert(layout.right <= layout.width);
  await phone.locator('#objectives-toggle').tap();
  assert(await phone.locator('#objectives-list').isVisible());
  await phone.screenshot({ path: `${output}/campaign-tracker-phone.png` });
  await phone.close();

  // Landscape phone: the tracker starts folded and, open or folded, stays above the tactical map.
  const landscape = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); watch(landscape);
  await landscape.goto(url); await ready(landscape);
  await landscape.locator('#campaign-tab').tap(); await landscape.locator('#campaign-start').tap(); await prestart(landscape);
  await landscape.locator('#resume').tap();
  await until(landscape, () => !document.querySelector('#objectives').hidden && !document.querySelector('#transmission').hidden);
  const clear = () => landscape.evaluate(() => { const a = document.querySelector('#objectives').getBoundingClientRect(), b = document.querySelector('.tactical-map').getBoundingClientRect(), t = document.querySelector('#transmission').getBoundingClientRect(); return { collapsed: document.querySelector('#objectives').dataset.collapsed, gap: b.top - a.bottom, transmission: t.height > 0 && t.bottom <= a.bottom + 1 }; });
  const folded = await clear();
  assert.equal(folded.collapsed, 'true'); assert(folded.gap >= 0 && folded.transmission, `Folded tracker clears the map: ${JSON.stringify(folded)}`);
  await landscape.screenshot({ path: `${output}/campaign-landscape-phone.png` });
  await landscape.locator('#objectives-toggle').tap();
  const opened = await clear();
  assert.equal(opened.collapsed, 'false'); assert(opened.gap >= 0, `Open tracker clears the map: ${JSON.stringify(opened)}`);
  await landscape.screenshot({ path: `${output}/campaign-landscape-phone-open.png` });
  await landscape.close();

  // Without browser storage the campaign still opens and launches; progress simply is not kept.
  const blocked = await browser.newPage({ viewport: { width: 1280, height: 800 } }); watch(blocked);
  await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage is blocked', 'SecurityError'); } }); });
  await blocked.goto(url); await ready(blocked);
  await blocked.locator('#campaign-tab').click();
  assert.deepEqual(await blocked.evaluate(() => [...document.querySelectorAll('.campaign-entry')].map(b => b.disabled)), [false, true, true, true, true, true, true, true]);
  await blocked.locator('#campaign-start').click(); await prestart(blocked);
  assert.equal(await blocked.evaluate(() => ashline.state.mission.id), 'landfall');
  await blocked.close();
  assert.deepEqual(errors, []);
  console.log(`Ashline campaign browser checks passed: campaign tab and locks, archive, loading line, pre-start pause, tracker and transmissions, Landfall and Hold the Line won with real orders, debrief and medals, Next operation and Remix, progress after reload, queued transmissions and pause-menu Retry, skirmish modes, phone and landscape layouts and blocked storage. Screenshots: ${output}`);
} finally { await browser.close(); }
