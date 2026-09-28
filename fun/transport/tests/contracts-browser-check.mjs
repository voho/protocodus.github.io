// Transport contracts in a real browser: offers arrive silently after the first freight delivery and
// stay folded below Fleet upgrades at 1440px and 390px, Show frames both sites, a served pair wins with
// one toast and a card badge, a reload replays nothing, and the finished contract says what it earned.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu, loadAutosaveFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-contracts-qa';
await mkdir(output, { recursive: true });
const errors = [];

async function open(viewport) {
  const phone = viewport.width <= 700, page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('toast')) window.__toasts.push({ text: node.querySelector(':scope > span')?.textContent, type: node.className });
    }).observe(document.querySelector('#toast-region'), { childList: true }));
  });
  await page.goto(url);
  await createWorldFromMenu(page, { biome: 'taiga', seed: 1847 });
  return page;
}
const toasts = (page, pattern) => page.evaluate(source => window.__toasts.filter(toast => new RegExp(source).test(toast.text)), pattern.source);
const settle = page => page.waitForTimeout(1200);
async function routesView(page) {
  if (await page.locator('.main-nav').isVisible()) { await page.locator('.main-nav [data-view="routes"]').click(); return; }
  if (!(await page.locator('.sidebar').evaluate(element => element.classList.contains('mobile-open')))) await page.locator('.mobile-panel-toggle').click();
  await page.locator('[data-mobile-view="routes"]').click();
}
// Seed 1847: stone from the quarry beside Alderbrook is the first freight; the next month brings offers.
async function firstFreight(page) {
  await page.evaluate(async () => {
    const { buildPlan } = await import('./construction-plan.js'), { build, addRoute, tick } = await import('./model.js'), g = transport.game, points = [];
    for (let y = 251; y >= 245; y--) points.push({ x: 219, y });
    if (!buildPlan(g, 'road', points, { preferredMode: 'road' }).ok || !build(g, 'bus-stop', 219, 251).ok) throw new Error('quarry stop failed');
    const result = addRoute(g, { name: 'Alderbrook stone', mode: 'road', stops: [g.stations.at(-1).id, 'station-1'], cargo: 'stone' });
    if (!result.ok) throw new Error(result.message);
    for (let d = 0; d < 80 && !result.route.delivered; d++) tick(g, 1);
    if (!result.route.delivered) throw new Error('no delivery');
  });
  await settle(page);
  assert.equal(await page.evaluate(() => transport.game.contracts), undefined, 'no offers before the next month');
  await page.evaluate(async () => { const { tick } = await import('./model.js'), g = transport.game, month = g.lastMonth; while (g.lastMonth === month) tick(g, 1); });
  await settle(page);
}
// Stone for Pinehaven, 30 tiles from the quarry: the starter road already reaches it.
async function serveContract(page) {
  return page.evaluate(async () => {
    const { addRoute, tick } = await import('./model.js'), { contractMultiplier } = await import('./contracts.js'), g = transport.game, quarry = g.industries.find(site => site.kind === 'quarry' && site.x === 217 && site.y === 255), day = Math.floor(g.day);
    const distance = Math.round(Math.hypot(244 - 217.5, 241 - 255.5)), offer = { id: 'contract-qa', cargo: 'stone', sourceId: quarry.id, target: { kind: 'city', id: 'city-2' }, distance, multiplier: Math.round(contractMultiplier(distance) * 100) / 100, offeredDay: day, expiresDay: day + 365 };
    g.contracts = [offer, ...g.contracts.filter(contract => contract.routeId === undefined).slice(0, 2)];
    const result = addRoute(g, { name: 'Pinehaven stone', mode: 'road', stops: [g.stations.find(stop => stop.x === 219 && stop.y === 251).id, 'station-2'], cargo: 'stone' });
    if (!result.ok) throw new Error(result.message);
    for (let d = 0; d < 120 && !result.route.delivered; d++) tick(g, 1);
    return { route: result.route.id, offer: g.contracts[0] };
  });
}
const onScreen = (page, id) => page.evaluate(id => {
  const g = transport.game, contract = g.contracts.find(c => c.id === id), canvas = document.querySelector('#world').getBoundingClientRect(), panel = document.querySelector('#inspector');
  const source = g.industries.find(site => site.id === contract.sourceId), target = (contract.target.kind === 'city' ? g.cities : g.industries).find(site => site.id === contract.target.id);
  // On the map and clear of the inspector card.
  const card = panel.hidden ? null : panel.getBoundingClientRect(), inside = site => { const p = transport.renderer.worldToScreen(site.x, site.y), x = canvas.left + p.x, y = canvas.top + p.y; return x >= canvas.left && y >= canvas.top && x <= canvas.right && y <= canvas.bottom && !(card && x >= card.left && x <= card.right && y >= card.top && y <= card.bottom); };
  return { source: inside(source), target: inside(target), title: document.querySelector('#inspector-title')?.textContent, sourceName: source.name, inspector: !panel.hidden };
}, id);

try {
  // Desktop: offers appear quietly, folded, and name the producer, the buyer and the reward.
  const page = await open({ width: 1440, height: 900 });
  await routesView(page);
  assert.equal(await page.locator('#contract-offers').isHidden(), true, 'no block before any offer');
  await firstFreight(page);
  const offers = await page.evaluate(() => transport.game.contracts.map(c => c.id));
  assert.ok(offers.length >= 1 && offers.length <= 3, `${offers.length} offers`);
  assert.deepEqual(await toasts(page, /contract/i), [], 'offers arrive silently');
  await page.waitForFunction(() => !document.querySelector('#contract-offers')?.hidden);
  assert.equal(await page.locator('#contract-offers').evaluate(details => details.open), false, 'collapsed by default');
  assert.equal((await page.locator('#contract-offers > summary strong').textContent()).trim(), `Contract offers · ${offers.length}`);
  await page.locator('#contract-offers > summary').click();
  assert.equal(await page.locator('.contract-row[data-state="offer"]').count(), offers.length);
  assert.match(await page.locator('.contract-row small').first().textContent(), /^\d+ tiles · \d\.\d× fares for 12 months · open until \w{3} \d{4}$/);
  await page.locator('#contract-offers').screenshot({ path: `${output}/offers-1440.png` });
  await page.screenshot({ path: `${output}/routes-1440.png` });
  // Show frames the producer and the buyer, and selects the producer.
  await page.locator('[data-show-contract]').first().click();
  await page.waitForTimeout(400);
  const shown = await onScreen(page, offers[0]);
  assert.ok(shown.source && shown.target, 'both sites on screen');assert.ok(shown.inspector);assert.equal(shown.title, shown.sourceName);
  await page.screenshot({ path: `${output}/show-1440.png` });

  // Serving the exact pair wins it: one toast, a badge on the card and an active row.
  const { route, offer } = await serveContract(page);
  assert.equal(offer.routeId, route);assert.ok(offer.earned > 0);
  await settle(page);
  const won = await toasts(page, /^Contract won/);
  assert.equal(won.length, 1);assert.match(won[0].text, /^Contract won · \d\.\d× fares on Pinehaven stone until \w{3} \d{4}$/);
  await routesView(page);
  const rate = page.locator(`[data-route-rate="${route}"]`);
  await page.waitForFunction(id => document.querySelector(`[data-route-rate="${id}"]`)?.hasAttribute('data-contract'), route);
  assert.match(await rate.textContent(), /^(≈ −?\$[\d.,]+k? \+ |\+)\$[\d.,]+k? bonus$/);
  assert.match(await rate.getAttribute('title'), /Contract bonus ≈ \$[\d.,]+k? \/ month until \w{3} \d{4} · \d\.\d× fares from Stone quarry near \w+ to Pinehaven/);
  assert.equal(await page.locator('.contract-row[data-state="active"]').count(), 1);
  assert.match((await page.locator('#contract-offers > summary').textContent()), /1 active/);
  await page.locator(`.route-card[data-route-id="${route}"]`).scrollIntoViewIfNeeded();
  await page.locator(`.route-card[data-route-id="${route}"]`).screenshot({ path: `${output}/card-1440.png` });
  await page.locator('#contract-offers').screenshot({ path: `${output}/active-1440.png` });

  // A reload keeps the contract and replays no toast.
  assert.equal(await page.evaluate(() => transport.persist()), true);
  await page.reload();await loadAutosaveFromMenu(page);await settle(page);
  assert.deepEqual(await toasts(page, /contract/i), [], 'nothing replayed after loading');
  assert.equal(await page.evaluate(id => transport.game.contracts.find(c => c.id === 'contract-qa').routeId === id, route), true);

  // Twelve months later normal fares continue, with one closing toast.
  await page.evaluate(async () => { const { tick } = await import('./model.js'), g = transport.game, contract = g.contracts.find(c => c.id === 'contract-qa'); while (g.day < contract.until + 1) tick(g, 1); });
  await settle(page);
  const done = await toasts(page, /^Contract on/);
  assert.equal(done.length, 1);assert.match(done[0].text, /^Contract on Pinehaven stone completed · earned \+\$[\d,]+ extra\. Normal fares continue\.$/);
  await routesView(page);
  await page.waitForFunction(id => !document.querySelector(`[data-route-rate="${id}"]`)?.hasAttribute('data-contract'), route);
  await page.close();

  // Phone: the folded block, a compact awarded card and Show above the sheet.
  const phone = await open({ width: 390, height: 844 });
  await firstFreight(phone);
  const phoneOffer = await phone.evaluate(() => transport.game.contracts[0].id);
  const served = await serveContract(phone);
  await routesView(phone);
  await phone.waitForFunction(() => !document.querySelector('#contract-offers')?.hidden);
  assert.equal(await phone.locator('#contract-offers').evaluate(details => details.open), false, 'collapsed on phones too');
  await phone.locator('#contract-offers > summary').click();
  assert.ok(await phone.locator('#panel-content').evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1), 'no sideways scroll');
  await phone.locator('#contract-offers').screenshot({ path: `${output}/offers-390.png` });
  const card = phone.locator(`.route-card[data-route-id="${served.route}"]`);
  await phone.waitForFunction(id => document.querySelector(`[data-route-rate="${id}"]`)?.hasAttribute('data-contract'), served.route);
  await card.scrollIntoViewIfNeeded();
  await phone.locator('#toast-region').evaluate(region => { region.style.visibility = 'hidden'; });
  await card.screenshot({ path: `${output}/card-390.png` });
  // The badge takes the rate's place beside Net earned: the card gains no row.
  const rows = await card.evaluate(element => {
    const rate = element.querySelector('.route-rate'), net = element.querySelector('.route-earnings strong'), awarded = { height: element.getBoundingClientRect().height, top: rate.getBoundingClientRect().top, net: net.getBoundingClientRect().top };
    const text = rate.textContent;rate.removeAttribute('data-contract');rate.textContent = '≈ $4.1k / month';
    const plain = element.getBoundingClientRect().height;rate.textContent = text;rate.setAttribute('data-contract', '');
    return { ...awarded, plain };
  });
  assert.ok(Math.abs(rows.top - rows.net) < 8, 'the contract rate stays on the Net earned line');
  assert.ok(rows.height <= rows.plain + .5, `390px awarded card stays as compact as without a contract: ${rows.height}px vs ${rows.plain}px`);
  await phone.locator('#toast-region').evaluate(region => { region.style.visibility = ''; });
  await phone.locator(`[data-show-contract="${phoneOffer}"]`).click();
  await phone.waitForTimeout(500);
  const phoneShown = await onScreen(phone, phoneOffer);
  assert.ok(phoneShown.source && phoneShown.target, 'both sites on a phone screen');assert.equal(phoneShown.inspector, false, 'no inspector over the map on a phone');
  await phone.screenshot({ path: `${output}/show-390.png` });
  await phone.close();

  assert.deepEqual(errors, []);
  console.log(`Contracts browser check passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
