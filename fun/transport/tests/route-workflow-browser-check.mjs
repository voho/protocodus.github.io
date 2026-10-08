// Real menu, pointer and keyboard flows keep browsing, drafting and one-route
// management separate. Each profile has isolated storage and a paused company.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu, openGameAction } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-route-workflow';
await mkdir(output, { recursive: true });
const results = [], errors = [];
let currentPage;

async function company(page) {
  return page.evaluate(() => {
    const g = transport.game;
    return { money: g.money, day: g.day, monthlyExpenses: g.monthlyExpenses, totalExpenses: g.totalExpenses,
      routes: structuredClone(g.routes), vehicles: structuredClone(g.vehicles) };
  });
}
async function noDraft(page) {
  await page.waitForFunction(() => !transport.renderer.getStats().routePreview.active);
  assert.equal(await page.locator('#route-form').count(), 0, 'browsing has no hidden draft form');
}
async function detail(page, id, label) {
  await page.locator(`#route-list[data-route-detail="${id}"]`).waitFor();
  await noDraft(page);
  assert.equal(await page.locator('#route-list .route-card').count(), 1, `${label}: only the chosen route is in the DOM`);
  assert.equal(await page.locator('#route-list .route-card').getAttribute('data-route-id'), id);
  assert.equal(await page.locator('#route-list .route-card-details').evaluate(el => el.open), true, `${label}: fleet and earnings are already open`);
  assert.equal(await page.locator('.route-filters,.route-filter-details,.fleet-upgrades,#new-route-button').count(), 0, `${label}: detail has no company-wide controls`);
  assert.equal(await page.locator('#route-list [data-open-route]').count(), 0);
  assert.equal(await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open')), true);
}
async function list(page, count) {
  await page.locator('#new-route-button').waitFor();
  await noDraft(page);
  assert.equal(await page.locator('#route-list').getAttribute('data-route-detail'), null);
  assert.equal(await page.locator('#route-list .route-card').count(), count);
  assert.equal(await page.locator('.route-filters,.route-filter-details,.fleet-upgrades').count(), 3);
  assert.equal(await page.locator('#route-list [data-open-route]').count(), count);
}
async function freshDraft(page) {
  await page.locator('#new-route-button').click();
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), '', 'New route always forgets the old start');
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), '', 'New route always forgets the old end');
  assert.equal(await page.locator('#route-form').getAttribute('data-cargo-chosen'), 'false');
  assert.equal(await page.locator('#route-form [name="vehicleCount"]').inputValue(), '1');
  assert.equal(await page.locator('#route-list').count(), 0, 'drafting does not show a route list');
  await page.waitForFunction(() => !transport.renderer.getStats().routePreview.active);
}
async function chooseMail(page, stops) {
  await page.locator('#route-form [name="from"]').selectOption(stops[0]);
  await page.locator('#route-form [name="to"]').selectOption(stops[1]);
  await page.locator('[data-cargo-choice="mail"]').click();
  await page.waitForFunction(() => transport.renderer.getStats().routePreview.active);
}
async function photo(page, name) {
  await page.waitForFunction(() => !transport.renderer.getStats().gliding);
  await page.screenshot({ path: `${output}/${name}.png` });
}

try {
  for (const profile of [{ name: 'desktop', width: 1440, height: 900, dpr: 1 }, { name: 'laptop-retina', width: 1024, height: 768, dpr: 2 }]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, reducedMotion: 'reduce' });
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await createWorldFromMenu(page, { generationVersion: 11 });
    const opening = await company(page), starter = opening.routes[0], stops = starter.stops;
    await page.locator('.main-nav [data-view="routes"]').click(); await list(page, 1);
    await page.locator(`[data-open-route="${starter.id}"]`).click(); await detail(page, starter.id, 'Details button');
    await page.locator('#route-back').click(); await list(page, 1);
    await page.locator('.route-filter-details > summary').click();
    await page.locator('#route-filter-cargo').selectOption('passengers');
    await page.locator(`[data-open-route="${starter.id}"]`).focus(); await page.keyboard.press('Enter');
    await detail(page, starter.id, 'keyboard Details');
    assert.equal(await page.locator('#route-detail-title').evaluate(el => el === document.activeElement), true, `keyboard route detail focus: ${await page.evaluate(() => document.activeElement.outerHTML.slice(0, 240))}`);
    await page.locator('#route-back').click();
    assert.equal(await page.locator('#route-filter-cargo').inputValue(), 'passengers', 'Back restores the list filters');
    await freshDraft(page); await chooseMail(page, stops);
    await page.locator('#route-form [name="name"]').fill('Valley Mail');
    await page.locator('#route-form [name="vehicleCount"]').fill('2');
    await page.locator('#route-back').click(); await list(page, 1);
    await freshDraft(page);
    assert.deepEqual(await company(page), opening, 'browsing and abandoning a filled draft change no finances, fleet or service');
    await chooseMail(page, stops);
    await page.locator('#route-form [name="name"]').fill('Valley Mail');
    const beforeLaunch = await company(page);
    await page.locator('#route-launch [type="submit"]').click();
    const launched = await company(page), mail = launched.routes.find(route => !beforeLaunch.routes.some(old => old.id === route.id));
    assert.ok(mail); assert.equal(mail.cargo, 'mail'); assert.equal(launched.vehicles.length, beforeLaunch.vehicles.length + 1);
    assert.ok(launched.money < beforeLaunch.money);
    await detail(page, mail.id, 'new launch despite passenger list filter');
    await photo(page, `${profile.name}-launched-detail`);

    const initialFleet = launched.vehicles.filter(vehicle => vehicle.routeId === mail.id).length;
    await page.locator(`[data-add-vehicle="${mail.id}"]`).click();
    await detail(page, mail.id, 'buy from detail');
    assert.equal((await company(page)).vehicles.filter(vehicle => vehicle.routeId === mail.id).length, initialFleet + 1);
    assert.match(await page.locator(`[data-vehicle-spec="${mail.id}"]`).innerText(), /2 mail trucks/);
    await page.locator('#route-back').click(); await list(page, 1);
    assert.equal(await page.locator('#route-filter-cargo').inputValue(), 'passengers');
    await freshDraft(page); await chooseMail(page, stops);
    const beforeMatch = await company(page);
    await page.locator('#add-route-vehicle').click(); await detail(page, mail.id, 'matching route purchase');
    const matched = await company(page);
    assert.equal(matched.routes.length, beforeMatch.routes.length, 'matching service receives the vehicle without duplicating the route');
    assert.equal(matched.vehicles.filter(vehicle => vehicle.routeId === mail.id).length, initialFleet + 2);
    assert.match(await page.locator(`[data-vehicle-spec="${mail.id}"]`).innerText(), /3 mail trucks/);

    const beforeBrowse = await company(page);
    await page.locator(`[data-edit-route="${mail.id}"]`).click();
    await page.waitForFunction(() => transport.renderer.getStats().routePreview.active);
    await page.locator('#cancel-route-edit').click(); await detail(page, mail.id, 'edit cancel');
    await page.locator(`[data-edit-route="${mail.id}"]`).click();
    await page.locator('#route-back').click(); await detail(page, mail.id, 'edit Back');
    await page.locator(`[data-edit-route="${mail.id}"]`).click();
    await page.locator('.main-nav [data-view="towns"]').click();
    await page.locator('.main-nav [data-view="routes"]').click(); await list(page, 1);
    await freshDraft(page); await page.locator('#route-back').click(); await list(page, 1);
    await page.locator('#clear-route-filters').click(); await list(page, 2);
    await page.locator(`[data-open-route="${mail.id}"]`).click();
    await page.locator(`#route-list [data-ref="stop:${stops[0]}"]`).click();
    await page.locator(`#inspector [data-ref="route:${starter.id}"]`).click();
    await detail(page, starter.id, 'station route reference');

    // A route-targeted notice is fixture data; opening it uses the actual News
    // controls. This avoids running months of simulation merely to emit news.
    await page.evaluate(id => transport.game.notifications.unshift({ id: 'workflow-notice', day: transport.game.day, type: 'info', message: 'Workflow route notice', text: 'Workflow route notice', target: { kind: 'route', id } }), mail.id);
    await openGameAction(page, 'news-button');
    await page.locator('.news-item').filter({ hasText: 'Workflow route notice' }).locator('[data-news-target]').click();
    await detail(page, mail.id, 'News route target');
    await page.locator(`[data-focus-route="${mail.id}"]`).click();
    assert.equal(await page.locator('.sidebar').evaluate(el => el.classList.contains('drawer-open')), false, 'Show on map still dismisses management');
    await page.waitForFunction(() => !transport.renderer.getStats().routePreview.active);
    assert.deepEqual(await company(page), beforeBrowse, 'edit cancellation, references, News and map browsing are financially read-only');

    if (!await page.locator('#objective-plan').isVisible()) await page.locator('#objective-chip').click();
    await page.locator('#objective-plan').click(); await page.locator('#build-connection-plan').click();
    await page.locator('#route-launch [type="submit"]').waitFor();
    const beforeFreight = await company(page);
    await page.locator('#route-launch [type="submit"]').click();
    const freight = (await company(page)).routes.find(route => !beforeFreight.routes.some(old => old.id === route.id));
    assert.ok(freight && !['mail', 'passengers'].includes(freight.cargo));
    await detail(page, freight.id, 'freight launch');
    const beforeEdit = await company(page);
    await page.locator(`[data-edit-route="${freight.id}"]`).click();
    if (!await page.locator('.route-options').evaluate(el => el.open)) await page.locator('.route-options > summary').click();
    await page.locator('[data-route-option="full-load"]').setChecked(!Boolean(freight.fullLoad));
    await page.locator('#route-launch [type="submit"]').click();
    await detail(page, freight.id, 'edit commit');
    const edited = await company(page);
    assert.equal(edited.routes.find(route => route.id === freight.id).fullLoad === true, !Boolean(freight.fullLoad));
    assert.equal(edited.money, beforeEdit.money, 'a service-order edit buys nothing');
    assert.equal(edited.vehicles.length, beforeEdit.vehicles.length);
    await photo(page, `${profile.name}-edited-freight-detail`);
    await page.locator(`[data-remove-route="${freight.id}"]`).click();
    await page.locator('#confirm-retire').click(); await list(page, 2);
    const retired = await company(page);
    assert.equal(retired.routes.some(route => route.id === freight.id), false);
    assert.equal(retired.vehicles.some(vehicle => vehicle.routeId === freight.id), false);
    assert.ok(retired.money > edited.money);
    await photo(page, `${profile.name}-routes-after-retirement`);
    await freshDraft(page); await page.locator('#route-back').click(); await list(page, 2);
    results.push({ profile: profile.name, generation: 11, routes: retired.routes.map(route => ({ id: route.id, cargo: route.cargo })), mailFleet: retired.vehicles.filter(vehicle => vehicle.routeId === mail.id).length });
    await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Route workflow: ${results.length} desktop/laptop profiles passed: launch, matching fleet purchase, detail, edit/cancel, references, News, map-only Show, retirement and fresh draft reset. Evidence: ${output}`);
} catch (error) {
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
