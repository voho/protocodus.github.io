// Notices in a real browser: nothing is dropped, bursts are grouped and toasts act.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-notices-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: viewport.width <= 700, hasTouch: viewport.width <= 700 });
  page.on('pageerror', error => errors.push(error.message));
  // Record every toast as it is shown, including ones that later scroll out of the region.
  await page.addInitScript(() => {
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push({ text: node.querySelector(':scope > span')?.textContent, type: node.className, action: node.querySelector('.toast-action')?.textContent || '' });
    }).observe(document.querySelector('#toast-region'), { childList: true }));
  });
  await page.goto(url);
  return page;
}
const shown = page => page.evaluate(() => window.__toasts.length);
const toastsSince = (page, from) => page.evaluate(from => window.__toasts.slice(from), from);
const waitForToast = (page, pattern, from = 0) => page.waitForFunction(({ source, from }) => window.__toasts.slice(from).some(toast => new RegExp(source).test(toast.text)), { source: pattern.source, from }, { timeout: 20000 })
  .catch(async error => { throw new Error(`No toast matching ${pattern}; shown: ${JSON.stringify(await toastsSince(page, from))}`, { cause: error }); });
const clearToasts = page => page.evaluate(() => document.querySelector('#toast-region').replaceChildren());

// A new industry opens near a served town: one quiet toast whose Show inspects it, a News entry, and a date that survives a reload.
async function industryOpening(viewport, name) {
  const page = await open(viewport);
  await createWorldFromMenu(page);
  await waitForToast(page, /^Welcome to /);
  await clearToasts(page);
  const from = await shown(page);
  const site = await page.evaluate(async () => {
    const { openIndustry } = await import('./model.js');
    for (let month = 24; month <= 120; month++) { const site = openIndustry(transport.game, month, { force: true }); if (site) { transport.game.money += 1; return { id: site.id, name: site.name, x: site.x, y: site.y, message: transport.game.notifications[0].message }; } }
    return null;
  });
  assert.ok(site, 'a forced opening finds a plot near the starting towns');
  await waitForToast(page, /^New .+ opens near .+\.$/, from);
  const toast = (await toastsSince(page, from)).find(item => /opens near/.test(item.text));
  assert.equal(toast.text, site.message);
  assert.equal(toast.type, 'toast', 'an opening toasts quietly: no warning, milestone or beep');
  assert.equal(toast.action, 'Show');
  const fits = await page.evaluate(() => { const box = document.querySelector('#toast-region .toast').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  assert.equal(fits, true, `the opening toast fits ${viewport.width}px`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/opening-toast-${name}.png` });
  await page.locator('#toast-region .toast-action', { hasText: 'Show' }).click();
  await page.locator('#inspector').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  const inspected = await page.evaluate(site => {
    const p = transport.renderer.worldToScreen(site.x + .5, site.y + .5), canvas = document.querySelector('#world');
    return { title: document.querySelector('#inspector-title').textContent, text: document.querySelector('#inspector').innerText, onMap: p.x >= 0 && p.y >= 0 && p.x <= canvas.clientWidth && p.y <= canvas.clientHeight };
  }, site);
  assert.equal(inspected.title, site.name, 'Show inspects the new industry');
  assert.match(inspected.text, /Opened in 1950/);
  assert.equal(inspected.onMap, true, 'Show brings the new industry into view');
  await page.screenshot({ path: `${output}/opening-inspector-${name}.png` });
  await page.locator('#inspector .tiny-button').click();
  await openGameAction(page, 'news-button');
  await page.locator('.news-list').waitFor();
  const first = page.locator('.news-item').first();
  assert.match(await first.innerText(), new RegExp(site.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(await first.locator('[data-news-target]').innerText(), 'Show');
  await page.screenshot({ path: `${output}/opening-news-${name}.png` });
  await page.locator('#modal .close-modal').click();
  // A world saved before its first day replays its welcome, so play two days first, as a real 1952 opening would be.
  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 2); await transport.persist(); });
  await page.reload();
  await loadAutosaveFromMenu(page);
  await page.evaluate(site => transport.inspect(site.x, site.y, 'industry'), site);
  await page.locator('#inspector').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#inspector-title').innerText(), site.name);
  assert.match(await page.locator('#inspector').innerText(), /Opened in 1950/, 'the opening date is saved');
  await page.waitForTimeout(1500);
  assert.deepEqual((await toastsSince(page, 0)).filter(item => /opens near/.test(item.text)), [], 'loading a save replays no opening');
  await page.close();
}

try {
  await industryOpening({ width: 1440, height: 960 }, 'desktop');
  await industryOpening({ width: 390, height: 844 }, '390');
  const page = await open({ width: 1440, height: 960 });
  await createWorldFromMenu(page);
  await waitForToast(page, /^Welcome to /);
  assert.equal((await toastsSince(page, 0)).filter(toast => /^Welcome/.test(toast.text)).length, 1, 'a fresh world shows its welcome once');
  await page.waitForTimeout(900);
  assert.equal((await toastsSince(page, 0)).filter(toast => /^Welcome/.test(toast.text)).length, 1, 'the welcome is not repeated');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/welcome-desktop.png` });

  // Three unrelated notices in one HUD interval: all three appear (formerly only the newest).
  await clearToasts(page);
  let from = await shown(page);
  await page.evaluate(() => {
    const g = transport.game;
    for (const n of [1, 2, 3]) g.notifications.unshift({ id: `notice-test-${n}`, day: g.day, message: `Test notice ${n}`, text: `Test notice ${n}`, type: 'info' });
    g.money += 1;
  });
  await page.waitForFunction(from => window.__toasts.slice(from).filter(toast => /^Test notice/.test(toast.text)).length === 3, from);
  assert.deepEqual((await toastsSince(page, from)).map(toast => toast.text), ['Test notice 1', 'Test notice 2', 'Test notice 3'], 'queued notices are shown oldest first');
  assert.equal(await page.locator('#toast-region .toast').count(), 3);

  // Repeating the same rejected action merges into one toast with a count.
  await clearToasts(page);
  await page.evaluate(() => { const c = transport.game.cities[0]; transport.renderer.focus(c.x, c.y); transport.setTool('bulldoze'); });
  const center = await page.evaluate(() => { const c = transport.game.cities[0], p = transport.renderer.worldToScreen(c.x, c.y), box = document.querySelector('#world').getBoundingClientRect(); return { x: box.left + p.x, y: box.top + p.y }; });
  for (let n = 0; n < 3; n++) { await page.mouse.click(center.x, center.y); await page.waitForTimeout(80); }
  assert.equal(await page.locator('#toast-region .toast.error').count(), 1, 'identical errors share one toast');
  assert.equal(await page.locator('#toast-region .toast.error .toast-count').innerText(), '×3');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/repeated-error-desktop.png` });
  await page.evaluate(() => transport.setTool('inspect'));

  // A served town announces its next resident milestone once.
  from = await shown(page);
  const town = await page.evaluate(() => {
    const g = transport.game, city = g.cities[0], next = [1000, 2500, 5000, 10000].find(n => n > city.population);
    city.population = next + 5; g.day += 1; g.money += 1; return { name: city.name, next };
  });
  await waitForToast(page, new RegExp(`^${town.name} reached ${town.next.toLocaleString('en-US')} residents$`), from);
  await page.evaluate(() => { const g = transport.game; g.cities[0].population += 50; g.day += 1; g.money += 1; });
  await page.waitForTimeout(900);
  const moments = (await toastsSince(page, from)).filter(toast => /reached/.test(toast.text));
  assert.equal(moments.length, 1, 'a milestone is announced once');
  assert.match(moments[0].type, /milestone/);
  assert.equal(moments[0].action, 'Show');

  // One bulldozed road tile shared by three services: one grouped warning.
  await clearToasts(page);
  const cut = await page.evaluate(async () => {
    const { addRoute } = await import('./model.js');
    const g = transport.game, first = g.routes[0];
    for (const n of [2, 3]) { const result = addRoute(g, { name: `Relief line ${n}`, mode: 'road', stops: [...first.stops], cargo: 'passengers' }); if (!result.ok) throw new Error(result.message); }
    const station = new Set(g.stations.map(s => `${s.x},${s.y}`)), city = g.cities.slice(0, 2);
    return first.path.slice(4, -4).find(p => !station.has(`${p.x},${p.y}`) && city.every(c => Math.hypot(c.x - p.x, c.y - p.y) > 6));
  });
  assert.ok(cut, 'the starter route has an open middle tile');
  from = await shown(page);
  const cutResult = await page.evaluate(async cut => {
    const { build, refreshRouteConnections } = await import('./model.js');
    const g = transport.game, before = g.notifications[0].id;
    window.__cutTile = { ...g.tiles[cut.y * g.width + cut.x] };
    const result = build(g, 'bulldoze', cut.x, cut.y);
    refreshRouteConnections(g);
    return { ok: result.ok, message: result.message, fresh: g.notifications.slice(0, g.notifications.findIndex(n => n.id === before)).map(n => n.topic) };
  }, cut);
  assert.equal(cutResult.ok, true, cutResult.message);
  assert.deepEqual(cutResult.fresh, ['route-connection', 'route-connection', 'route-connection']);
  await waitForToast(page, /^3 routes are no longer connected: /, from);
  await page.waitForTimeout(900);
  const disconnect = (await toastsSince(page, from)).filter(toast => /no longer connected/.test(toast.text));
  assert.equal(disconnect.length, 1, 'three disconnects become one toast');
  assert.match(disconnect[0].type, /warning/);
  assert.equal(disconnect[0].action, 'Show');
  await page.locator('#offline-routes').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#offline-routes').getAttribute('aria-label'), '3 routes need attention', 'the top bar counts every cut service');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/grouped-warning-desktop.png` });
  await page.locator('#toast-region .toast.warning .toast-action').click();
  await page.waitForFunction(() => document.activeElement?.matches('[data-focus-route]'));
  assert.equal(await page.evaluate(() => transport.game.routes.some(r => r.id === document.activeElement.dataset.focusRoute)), true, 'Show opens Routes at the broken service');
  await page.screenshot({ path: `${output}/show-route-desktop.png` });
  // Put the sloped road tile back as it was; the chip clears once the services run again.
  assert.deepEqual(await page.evaluate(async cut => {
    const { invalidateNetworkPoints, refreshRouteConnections } = await import('./model.js'), g = transport.game;
    Object.assign(g.tiles[cut.y * g.width + cut.x], window.__cutTile); invalidateNetworkPoints(g, [cut]); refreshRouteConnections(g);
    return g.routes.map(route => route.active);
  }, cut), [true, true, true]);
  await page.locator('#offline-routes').waitFor({ state: 'hidden' });

  // News lists the stored notices newest first, and Show locates an industry.
  await page.evaluate(() => {
    const g = transport.game, site = g.industries[3];
    g.notifications.unshift({ id: 'notice-test-industry', day: g.day, message: `${site.name} expanded to 150% capacity.`, text: `${site.name} expanded to 150% capacity.`, type: 'success', topic: 'industry-growth', target: { kind: 'industry', id: site.id } });
  });
  await openGameAction(page, 'news-button');
  await page.locator('.news-list').waitFor();
  assert.equal(await page.locator('.news-item:not([data-type="milestone"])').count(), await page.evaluate(() => transport.game.notifications.length), 'News lists every stored notice');
  assert.match(await page.locator('.news-item').first().innerText(), /expanded to 150% capacity/);
  assert.match(await page.locator('.news-item').last().innerText(), /Welcome/);
  assert.equal(await page.evaluate(() => document.querySelector('#modal h2').textContent), 'News');
  await page.screenshot({ path: `${output}/news-desktop.png` });
  await page.locator('.news-item').first().locator('[data-news-target]').click();
  await page.locator('#inspector').waitFor({ state: 'visible' });
  const inspected = await page.evaluate(() => ({ open: document.querySelector('#modal').open, title: document.querySelector('#inspector h3').textContent, name: transport.game.industries[3].name }));
  assert.equal(inspected.open, false);
  assert.equal(inspected.title, inspected.name, 'Show in News focuses the industry');
  await page.locator('#inspector .tiny-button').click();

  // January 1: a year toast whose action reviews upgrades without spending.
  await clearToasts(page);
  from = await shown(page);
  await page.evaluate(() => { transport.game.day = 364.5; });
  await page.locator('[data-speed="8"]').click();
  // It names one of the year's models; company-report-credit's review may follow.
  await waitForToast(page, /^New for 1951: vehicles such as the [A-Z][a-z]+ Mk 2 [a-z]+ carry 20% more and run 10% faster\. Prices rise \d\.\d% this year\./, from);
  await page.locator('[data-speed="0"]').click();
  const year = (await toastsSince(page, from)).find(toast => /^New for 1951/.test(toast.text));
  const named = await page.evaluate(async () => (await import('./vehicle-models.js')).newYearModel(transport.game.routes, transport.game.vehicles, 1).name);
  assert.ok(year.text.includes(`such as the ${named} `), `the January toast names ${named}: ${year.text}`);
  assert.match(year.type, /milestone/);
  assert.equal(year.action, 'Review upgrades');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/new-year-desktop.png` });
  const money = await page.evaluate(() => transport.game.money);
  await page.locator('#toast-region .toast-action', { hasText: 'Review upgrades' }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'upgrade-fleet');
  assert.equal(await page.evaluate(() => transport.game.money), money, 'reviewing upgrades never spends money');
  assert.equal(await page.locator('.nav-button[data-view="routes"]').getAttribute('aria-expanded'), 'true');
  assert.equal((await toastsSince(page, from)).filter(toast => /^New for 1951/.test(toast.text)).length, 1, 'one year toast per January');
  // The review followed a mouse click, so Space still pauses and resumes instead of pressing Upgrade all.
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => transport.speed), 8, 'Space after a clicked review resumes play');
  assert.match(await page.locator('#fleet-upgrade-note').innerText(), /vehicles ready/, 'Space after a clicked review never upgrades the fleet');
  await page.keyboard.press('Space');

  // The Towns search keeps focus and text across a January repricing.
  await page.locator('.nav-button[data-view="towns"]').click();
  await page.locator('#entity-search').fill('a');
  await page.locator('#entity-search').focus();
  from = await shown(page);
  const price = await page.locator('[data-tool="city"]').innerText();
  await page.evaluate(() => { transport.game.day = 729.8; });
  await page.locator('[data-speed="8"]').evaluate(button => button.click());
  await waitForToast(page, /^New for 1952: vehicles such as the [A-Z][a-z]+ Mk 3 /, from);
  await page.evaluate(() => transport.setSpeed(0));
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'entity-search', 'typing continues across January');
  assert.equal(await page.locator('#entity-search').inputValue(), 'a');
  assert.equal(await page.locator('[data-tool="city"]').innerText(), price, 'repricing waits while the search has focus');
  await page.locator('#world').focus();
  await page.waitForFunction(price => document.querySelector('[data-tool="city"]')?.innerText !== price, price);
  assert.equal(await page.locator('#entity-search').inputValue(), 'a', 'the deferred repricing keeps the query');

  // A mail route is town service: it delivers with no first-delivery toast, no milestone and no News entry.
  from = await shown(page);
  const mailRoute = await page.evaluate(async () => {
    const { addRoute } = await import('./model.js'), g = transport.game, result = addRoute(g, { mode: 'road', stops: g.routes[0].stops, cargo: 'mail' });
    return { ok: result.ok, message: result.message, id: result.route?.id, notices: g.notifications.length };
  });
  assert.equal(mailRoute.ok, true, mailRoute.message);
  await page.waitForTimeout(600);
  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 30); });
  await page.waitForTimeout(900);
  assert.ok(await page.evaluate(id => transport.game.routes.find(route => route.id === id).delivered > 0, mailRoute.id), 'the mail route delivers');
  assert.deepEqual((await toastsSince(page, from)).filter(toast => /mail|^First/i.test(toast.text)), [], 'mail delivers without a first-delivery toast');
  assert.equal(await page.evaluate(() => transport.game.notifications.filter(notice => /mail/i.test(notice.message)).length), 0, 'and without a News entry');
  assert.equal(await page.evaluate(() => transport.game.milestones?.['first-freight']), undefined, 'mail is not freight');

  // A new freight route announces its first delivery once, with a way to the route.
  from = await shown(page);
  const freight = await page.evaluate(async () => {
    const { build, addRoute } = await import('./model.js'), { buildPlan } = await import('./construction-plan.js');
    const g = transport.game, path = [[219, 255], [220, 255], ...Array.from({ length: 11 }, (_, i) => [221, 255 - i])].map(([x, y]) => ({ x, y }));
    const road = buildPlan(g, 'road', path), stops = [build(g, 'bus-stop', 220, 255), build(g, 'bus-stop', 221, 245)];
    const result = addRoute(g, { name: 'Quarry line', mode: 'road', stops: stops.map(stop => stop.station?.id), cargo: 'stone' });
    return { ok: road.ok && stops.every(stop => stop.ok) && result.ok, message: [road.message, ...stops.map(stop => stop.message), result.message].join(' / ') };
  });
  assert.equal(freight.ok, true, freight.message);
  await page.waitForTimeout(600);
  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 30); });
  await waitForToast(page, /^First stone delivered on Quarry line · \+\$[\d,]+ · Milestone$/, from);
  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 20); });
  await page.waitForTimeout(900);
  const firsts = (await toastsSince(page, from)).filter(toast => /^First stone/.test(toast.text));
  assert.equal(firsts.length, 1, 'the first delivery is announced once');
  assert.match(firsts[0].type, /milestone/);
  assert.equal(firsts[0].action, 'Show');

  // Demolishing the quarry the line loads from warns once, and the top bar chip lists the route.
  await clearToasts(page);
  from = await shown(page);
  const lost = await page.evaluate(async () => {
    const { build } = await import('./model.js'), { industryDistance } = await import('./industry-sites.js');
    const g = transport.game, route = g.routes.find(r => r.name === 'Quarry line'), stop = g.stations.find(s => s.id === route.stops[0]);
    const results = g.industries.filter(i => i.kind === 'quarry' && industryDistance(i, stop) <= 5).map(site => build(g, 'bulldoze', site.x, site.y));
    return { ok: results.length > 0 && results.every(result => result.ok), message: results.map(result => result.message).join(' / '), stop: stop.name };
  });
  assert.equal(lost.ok, true, lost.message);
  await waitForToast(page, new RegExp(`^Quarry line lost its stone supplier\\. Add one within 5 tiles of ${lost.stop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, or retire the route\\.$`), from);
  await page.waitForTimeout(900);
  const supply = (await toastsSince(page, from)).filter(toast => /lost its/.test(toast.text));
  assert.equal(supply.length, 1, 'one warning for the one route');
  assert.match(supply[0].type, /warning/);
  assert.equal(supply[0].action, 'Show');
  await page.locator('#offline-routes').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#offline-routes').getAttribute('aria-label'), '1 route needs attention', 'a route without a producer needs attention');
  await page.screenshot({ path: `${output}/lost-producer-desktop.png` });
  await page.locator('#offline-routes').click();
  assert.equal(await page.locator('#route-filter-status').inputValue(), 'attention');
  assert.deepEqual(await page.locator('#route-list .route-header strong').allInnerTexts(), ['Quarry line'], 'Needs attention lists exactly what the chip counts');
  assert.equal(await page.locator('#route-list [data-route-status]').innerText(), 'No supplier');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/needs-attention-desktop.png` });

  // A loaded mid-year save replays nothing: no welcome and no year toast.
  await page.evaluate(async () => { transport.game.day = 900.4; await transport.persist(); });
  await page.reload();
  await loadAutosaveFromMenu(page);
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(2500);
  const replay = (await toastsSince(page, 0)).filter(toast => /^Welcome|^New for|^Prices rise|^Test notice/.test(toast.text));
  assert.deepEqual(replay, [], 'loading a save shows no old notices');
  // Switching in play to a save from a later year starts that year quietly too.
  from = await shown(page);
  await openGameAction(page, 'main-menu-button');
  await page.locator('#start-load').waitFor();
  await page.evaluate(async () => {
    const { encodeGame } = await import('./save-codec.js'), later = { ...transport.game, day: 1200.3 };
    localStorage.setItem('transport-save-v1', JSON.stringify(encodeGame(later)));
  });
  await loadAutosaveFromMenu(page);
  assert.equal(await page.evaluate(() => new Date(Date.UTC(1950, 0, 1 + Math.floor(transport.game.day))).getUTCFullYear()), 1953);
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(2500);
  assert.deepEqual((await toastsSince(page, from)).filter(toast => /^Welcome|^New for|^Prices rise/.test(toast.text)), [], 'activating a later-year save shows no year toast');
  await page.close();

  // Phone layout: a toast with an action fits beside the map controls.
  const phone = await open({ width: 390, height: 844 });
  await createWorldFromMenu(phone);
  await waitForToast(phone, /^Welcome to /);
  await clearToasts(phone);
  await phone.evaluate(() => { const g = transport.game, site = g.industries[0]; g.notifications.unshift({ id: 'notice-test-phone', day: g.day, message: `${site.name} expanded to 150% capacity.`, text: '', type: 'success', topic: 'industry-growth', target: { kind: 'industry', id: site.id } }, { id: 'notice-test-phone-2', day: g.day, message: 'Test line has lost its connection. Repair the network to resume.', text: '', type: 'warning' }); g.money += 1; });
  await phone.waitForFunction(() => document.querySelectorAll('#toast-region .toast').length === 2);
  const layout = await phone.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, toasts: [...document.querySelectorAll('#toast-region .toast')].map(el => { const box = el.getBoundingClientRect(); return { left: box.left, right: box.right }; }) }));
  assert.equal(layout.overflow, false);
  assert.ok(layout.toasts.every(box => box.left >= 0 && box.right <= 390), 'toasts stay on screen at 390px');
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: `${output}/toasts-390.png` });
  await openGameAction(phone, 'news-button');
  await phone.locator('.news-list').waitFor();
  assert.equal(await phone.evaluate(() => document.querySelector('#modal').scrollWidth <= document.querySelector('#modal').clientWidth + 1), true, 'News fits a phone');
  await phone.screenshot({ path: `${output}/news-390.png` });
  await phone.close();

  assert.deepEqual(errors, []);
  console.log('Notices browser check passed: a quiet industry opening with Show, News and its saved date at 1440 and 390px, welcome, three-notice burst, grouped disconnects with Show and the attention chip, a lost producer listed under Needs attention, News with Show, January toast and upgrade review, Towns search focus, a quiet mail route, first delivery, town milestones, quiet save loading, 390px layout.');
} finally {
  await browser.close();
}
