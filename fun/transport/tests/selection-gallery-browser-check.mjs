// Real map selection stays concise; complete reference information opens in Gallery on demand.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const base = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-selection-gallery';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const errors = [], results = []; let activePage = null;

async function prepare(page, biome) {
  await page.goto(base);
  await createWorldFromMenu(page, { biome, generationVersion: 10 });
  return page.evaluate(async () => {
    const [{ preloadWorldArt }, { preloadHouses }, { initializeIndustry }, { landscapeScenery }, { natureVariant }, { rasterCactusIdentity, rasterForestComposition, rasterTreeIdentity }] = await Promise.all([
      import('./atlas-runtime.js'), import('./raster-houses.js'), import('./industry-simulation.js'), import('./landscape-scenery.js'), import('./nature-placement.js'), import('./raster-nature.js'),
    ]);
    const game = transport.game, biome = game.biome, tile = (x, y) => game.tiles[y * game.width + x];
    // A small deterministic test neighborhood in a real menu-created company.
    // Keep the rest of the model intact, including economy, calendar and save state.
    for (let y = 8; y <= 110; y++) for (let x = 8; x <= 110; x++) game.tiles[y * game.width + x] = { terrain: biome === 'desert' ? 'sand' : 'grass', elevation: .25, variant: 0, detail: '', building: null, zone: null, road: false, rail: false, publicRoad: false, bridge: false, tunnel: false };
    const outside = item => item.x < 8 || item.y < 8 || item.x > 110 || item.y > 110;
    game.industries = game.industries.filter(outside); game.stations = game.stations.filter(outside); game.zones = game.zones.filter(outside);
    const town = game.cities[0]; town.x = 20; town.y = 20;
    const house = { x: 25, y: 25, w: 2, entry: 'building:house-expensive-3' };
    tile(house.x, house.y).building = { kind: 'house-expensive-3', footprint: 2, level: 2, owner: 'player' }; tile(house.x, house.y).variant = 7;
    const legacy = { x: 34, y: 25, w: 1 }; tile(legacy.x, legacy.y).building = { kind: 'house', level: 1 }; tile(legacy.x, legacy.y).variant = 13;
    const farm = { id: 'selection-farm', name: 'Selection dairy farm', kind: 'dairy-farm', x: 45, y: 45, footprint: 5, capacity: 1, inventory: { milk: 123 }, activity: 0 };
    const plant = { id: 'selection-plant', name: 'Selection dairy plant', kind: 'dairy-plant', x: 60, y: 45, footprint: 5, capacity: 1, inventory: { milk: 23, food: 17 }, activity: 0 };
    for (const item of [farm, plant]) { initializeIndustry(game, item); game.industries.push(item); }
    const airport = { id: 'selection-airport', name: 'North–south airport', mode: 'air', axis: 'y', x: 80, y: 45 }; game.stations.push(airport);
    const stop = { id: 'selection-stop', name: 'Selection road stop', mode: 'road', x: 45, y: 60 }; game.stations.push(stop); tile(stop.x, stop.y).road = true;
    const to = { id: 'selection-stop-to', name: 'Selection destination', mode: 'road', x: 58, y: 60 }; game.stations.push(to);
    for (let x = 45; x <= 58; x++) tile(x, 60).road = true;
    const original = game.routes.find(route => route.mode === 'road') || game.routes[0];
    const route = { ...original, id: 'selection-route', name: 'Selection truck line', mode: 'road', cargo: 'grain', active: true, paused: false, stops: [stop.id, to.id], path: Array.from({ length: 14 }, (_, n) => ({ x: 45 + n, y: 60 })) };
    game.routes.push(route);
    const vehicle = { ...(game.vehicles[0] || {}), id: 'selection-truck', routeId: route.id, x: 51, y: 60, progress: 6, angle: 0, direction: 1, level: 1, load: 6, capacity: 20 }; game.vehicles.push(vehicle);
    const grove = { x: 25, y: 80, w: 3 };
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) tile(grove.x + dx, grove.y + dy).terrain = 'forest';
    tile(grove.x, grove.y).terrainObject = { kind: 'forest', detail: biome === 'desert' ? 'acacia' : 'conifer', footprint: 3, variant: 0 };
    grove.related = [...new Set(rasterForestComposition(biome, tile(grove.x, grove.y).terrainObject.detail, 0, { footprint: 3 }).map(tree => rasterTreeIdentity(tree, biome)))].map(id => `nature:trees:${id.split(':')[1]}`);
    let cactus = null;
    if (biome === 'desert') for (let y = 80; y <= 100 && !cactus; y++) for (let x = 60; x <= 90 && !cactus; x++) {
      const test = { ...tile(x, y), detail: 'cactus' }, scenery = landscapeScenery(biome, game.seed, x, y, test);
      if (!scenery || scenery.detail !== 'cactus') continue;
      const variant = natureVariant(game, x, y, test), identity = rasterCactusIdentity(scenery.detail, variant);
      if (!identity || /:(cactus|prickly-pear)$/.test(identity)) continue;
      tile(x, y).detail = 'cactus'; cactus = { x, y, w: 1, entry: `nature:plants:${identity.split(':')[1]}` };
    }
    game.revision++; game.networkRevision++; transport.renderer.setGame(game); transport.renderer.setPresentation(null, game.day); transport.setTool('inspect');
    await Promise.all([preloadWorldArt({ biome, waitMs: 12000 }), preloadHouses({ biome, waitMs: 12000 })]);
    window.selectionGalleryQA = { house, legacy, farm, plant, airport, stop, vehicle, grove, cactus, before: JSON.stringify(game) };
    return { house, farm, plant, airport, stop, grove, cactus };
  });
}

async function clickMap(page, site, { vehicle = false } = {}) {
  if (await page.locator('#inspector').isVisible()) await page.locator('#inspector > .inspector-top .tiny-button').click();
  await page.evaluate(site => { transport.setTool('inspect'); transport.renderer.setZoom(1); transport.renderer.focus(site.x + (site.w || 1) / 2 - .5, site.y + (site.w || 1) / 2 - .5); }, site);
  await page.waitForTimeout(300);
  const p = await page.evaluate(({ site, vehicle }) => {
    const renderer = transport.renderer, box = document.querySelector('#world').getBoundingClientRect();
    const point = renderer.worldToScreen(site.x + (site.w || 1) / 2 - .5, site.y + (site.w || 1) / 2 - .5);
    if (vehicle) {
      for (let dy = -9; dy <= 9; dy += 3) for (let dx = -14; dx <= 14; dx += 3) if (renderer.vehicleAt(box.left + point.x + dx, box.top + point.y + dy)?.id === site.id) return { x: box.left + point.x + dx, y: box.top + point.y + dy };
      throw new Error('The actual rendered truck must be pickable');
    }
    return { x: box.left + point.x, y: box.top + point.y };
  }, { site, vehicle });
  await page.mouse.click(p.x, p.y);
  await page.locator('#inspector [data-gallery-browse]').waitFor();
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), false, 'a map click preserves the map and opens only the inspector');
}

async function closeReference(page) {
  // dialog.open changes before the close event restores inspector focus.
  // Wait for the actual event before sending the next keyboard command.
  await page.evaluate(() => {
    window.selectionGalleryClosed = false;
    document.querySelector('#modal').addEventListener('close', () => { window.selectionGalleryClosed = true; }, { once: true });
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => selectionGalleryClosed && !document.querySelector('#modal').open);
}

async function fullInfo(page, entryId) {
  const link = page.locator('#inspector [data-gallery-browse]');
  assert.equal(await link.count(), 1, 'one reference link per inspected object');
  assert.equal(await link.getAttribute('data-gallery-entry-id'), entryId, 'the link targets the inspected identity');
  assert.equal(await page.locator('#inspector .gallery-detail, #inspector .gallery-facts, #inspector .gallery-recipe').count(), 0, 'reference details do not duplicate live inspection');
  await link.focus(); await page.keyboard.press('Enter');
  await page.locator('#modal .gallery-explorer').waitFor();
  const row = await page.evaluate(async id => {
    const { galleryCatalog, galleryDetails } = await import('./catalog-data.js'), { money } = await import('./copy.js');
    const entry = galleryCatalog().find(entry => entry.id === id), root = document.querySelector('#modal .gallery-detail'), detail = galleryDetails(transport.game, entry, entry.biomes.includes(transport.game.biome) ? transport.game.biome : entry.biomes[0]);
    const priceLabels = new Set(['Build price today', 'Current purchase price', 'Base upkeep for 30 days', 'Base stop upkeep for 30 days', 'Base cargo fare']);
    const format = (label, value) => typeof value !== 'number' ? String(value) : priceLabels.has(label) ? money(value) : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    const facts = [...root.querySelectorAll('.gallery-facts > div')].map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]);
    return { id, name: entry.name, actualName: root.querySelector('h3').textContent, facts, expectedFacts: detail.stats.map(([label, value]) => [label, format(label, value)]), recipes: root.querySelectorAll('.gallery-recipe > .cargo-recipe').length, expectedRecipes: detail.recipes.length, text: root.textContent, description: entry.description, notes: detail.notes, targets: [...root.querySelectorAll('[data-gallery-related]')].map(button => button.dataset.galleryRelated), expectedTargets: detail.consumers.flatMap(group => group.entries.map(entry => entry.id)) };
  }, entryId);
  assert.equal(row.actualName, row.name, `selected ${entryId} has its own Gallery identity`);
  assert.deepEqual(row.facts, row.expectedFacts, `${entryId} includes every canonical Gallery fact`);
  assert.equal(row.recipes, row.expectedRecipes, `${entryId} includes every recipe`);
  for (const text of [row.description, ...row.notes]) assert.ok(row.text.includes(text), `${entryId} includes description and all notes`);
  for (const target of row.expectedTargets) assert.ok(row.targets.includes(target), `${entryId} includes all continuation links`);
  await closeReference(page);
  assert.equal(await page.locator('#inspector').isVisible(), true, 'closing Gallery keeps the selected object');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-gallery-browse')), true, 'closing Gallery restores its launching control');
  console.log(`On-demand selected entry passed: ${entryId}`);
  return row;
}

try {
  for (const profile of [{ width: 1280, height: 900, dpr: 1, biome: 'taiga' }, { width: 720, height: 800, dpr: 2, biome: 'taiga' }, { width: 720, height: 800, dpr: 2, biome: 'desert' }]) {
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr });
    activePage = page; page.setDefaultTimeout(15000);
    console.log(`Selection Gallery profile: ${profile.biome}, ${profile.width}px, DPR ${profile.dpr}`);
    page.on('pageerror', error => errors.push(error.message));
    const sites = await prepare(page, profile.biome);
    await clickMap(page, sites.house); await fullInfo(page, sites.house.entry);
    assert.equal(await page.locator('#inspector .inspector-building canvas').getAttribute('data-building-variant'), '7', 'the live portrait uses the placed house design and rotation');
    assert.equal(await page.locator('#inspector canvas').count(), 1, 'the house is pictured once');
    assert.ok(!(await page.locator('#inspector').innerText()).includes('Collection'), 'catalog metadata is kept in Gallery');
    await page.locator('#inspector').screenshot({ path: `${output}/house-${profile.biome}-${profile.width}-dpr${profile.dpr}.png` });
    assert.ok(await page.locator('#inspector #sell-property').count(), 'live owned-house actions stay available');
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'inspector-title', 'the reference link retains keyboard focus');
    await page.evaluate(() => { const box = document.querySelector('#inspector'); box.scrollTop = 200; window.selectionNode = box.querySelector('[data-gallery-browse]'); window.selectionScroll = box.scrollTop; transport.inspect(25, 25); });
    assert.equal(await page.evaluate(() => selectionNode === document.querySelector('#inspector [data-gallery-browse]')), true, 'unchanged inspection reuses its Gallery nodes');
    assert.equal(await page.locator('#inspector').evaluate(box => box.scrollTop), await page.evaluate(() => selectionScroll), 'unchanged inspection keeps the scroll position');
    await page.locator('#inspector [data-gallery-browse]').focus(); await page.keyboard.press('Enter');
    await page.locator('#modal .gallery-explorer').waitFor();
    assert.equal(await page.locator('#modal #gallery-object-heading').innerText(), 'Courtyard villa');
    await closeReference(page);
    assert.equal(await page.locator('#inspector').isVisible(), true, 'closing the full Gallery returns to the selected object');
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-gallery-browse')), true, 'Gallery close restores the launching control');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#inspector').isVisible(), false, 'Escape then closes map inspection');

    await clickMap(page, { ...sites.farm, w: 5 }); await fullInfo(page, 'industry:dairy-farm');
    assert.ok(await page.locator('#inspector [data-place-stop],#inspector [data-plan-cargo]').count(), 'live industry transport actions remain alongside the guide');
    await page.locator('#inspector .industry-target[data-target-id="selection-plant"]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#inspector-title')?.textContent === 'Selection dairy plant');
    await fullInfo(page, 'industry:dairy-plant');
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-gallery-browse')), true, 'Gallery returns focus within the linked target inspector');
    await page.locator('#inspector [data-inspector-back]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#inspector-title')?.textContent === 'Selection dairy farm');
    await fullInfo(page, 'industry:dairy-farm');
    await page.locator('#inspector #industry-chain').click(); await page.locator('#modal .chains-explorer').waitFor();
    await closeReference(page);

    await clickMap(page, sites.stop); await fullInfo(page, 'transport:bus-stop'); assert.ok(await page.locator('#inspector #station-route').count());
    await clickMap(page, { ...sites.airport, w: 2 }); await fullInfo(page, 'transport:airport-x');
    assert.equal(await page.locator('#inspector .inspector-station-art').getAttribute('data-infrastructure-axis'), 'y', 'the live airport portrait preserves runway orientation');
    assert.ok((await page.locator('#inspector').innerText()).includes('North–south'));

    await clickMap(page, sites.grove); await fullInfo(page, 'nature:forest');
    if (sites.cactus) { await clickMap(page, sites.cactus); await fullInfo(page, sites.cactus.entry); assert.equal(await page.locator('#inspector .gallery-recipe').count(), 0, 'cacti have no freight recipe'); }

    const vehicle = await page.evaluate(() => selectionGalleryQA.vehicle); await clickMap(page, vehicle, { vehicle: true }); await fullInfo(page, 'vehicle:truck');
    assert.equal(await page.locator('#inspector .vehicle-trip canvas').getAttribute('data-level'), '1', 'live inspection uses the actual carrier model');
    assert.equal(await page.locator('#inspector .vehicle-trip canvas').getAttribute('data-cargo'), 'grain');
    assert.ok(await page.locator('#inspector [data-vehicle-action="follow"]').count(), 'the live carrier keeps Follow and route actions');
    assert.equal(await page.locator('#inspector [data-vehicle-live="load"]').innerText(), '6 / 20');
    await page.locator('#inspector').screenshot({ path: `${output}/vehicle-${profile.biome}-${profile.width}-dpr${profile.dpr}.png` });
    await page.locator('#inspector [data-vehicle-action="follow"]').click(); assert.equal(await page.locator('#inspector [data-vehicle-action="follow"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#inspector > .inspector-top .tiny-button').click(); assert.equal(await page.locator('#inspector').isVisible(), false);

    await page.evaluate(() => transport.inspect(25, 25)); await page.locator('#inspector [data-gallery-browse]').click(); await page.locator('#modal [data-gallery-build]').click();
    assert.equal(await page.locator('#active-tool-name').innerText(), 'Courtyard villa'); assert.equal(await page.locator('#inspector').isVisible(), false, 'Build continues directly to placement');
    await page.evaluate(() => transport.setTool('inspect'));
    assert.equal(await page.evaluate(() => JSON.stringify(transport.game) === selectionGalleryQA.before), true, 'all selection, Gallery navigation and build choice are read-only');

    await page.evaluate(() => transport.inspect(60, 45, 'industry', 'keyboard'));
    const layout = await page.locator('#inspector').evaluate(box => { const r = box.getBoundingClientRect(), canvas = box.querySelector('.inspector-industry-art canvas'); return { left: r.left, right: r.right, top: r.top, width: r.width, overflow: box.scrollWidth - box.clientWidth, canvasWidth: canvas.width }; });
    assert.ok(layout.left >= 0 && layout.right <= profile.width + 1, 'the inspector fits a laptop window'); assert.ok(layout.top < 150, 'the inspector stays at the upper left'); assert.ok(layout.overflow <= 1, 'complete details have no horizontal overflow');
    await page.locator('#inspector [data-gallery-browse]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/concise-inspector-${profile.biome}-${profile.width}-dpr${profile.dpr}.png` });
    // The real one-second world cadence refreshes the live controls without
    // duplicating the reference link or swallowing a held press.
    // Empty input keeps this in-capacity output sentinel stable during production.
    await page.evaluate(() => { document.activeElement?.blur?.(); selectionGalleryQA.plant.inventory.food = 875; selectionGalleryQA.plant.inventory.milk = 0; transport.setSpeed(1); });
    await page.waitForFunction(() => document.querySelector('#inspector .ledger')?.textContent.includes('875'), undefined, { timeout: 5000 });
    await fullInfo(page, 'industry:dairy-plant');
    await page.evaluate(() => transport.setSpeed(8));
    const noticeLayout = await page.evaluate(() => {
      const notice = document.createElement('div'); notice.className = 'toast'; notice.dataset.inspectorQa = '';
      notice.innerHTML = '<span>First rent from your property: +$101.</span><button type="button" class="toast-action">Open report</button>';
      document.querySelector('#toast-region').append(notice);
      const toast = notice.getBoundingClientRect(), panel = document.querySelector('#inspector').getBoundingClientRect(), zoom = document.querySelector('.view-controls').getBoundingClientRect();
      return { left: toast.left, right: toast.right, bottom: toast.bottom, panelRight: panel.right, zoomTop: zoom.top, overflow: notice.scrollWidth - notice.clientWidth };
    });
    assert.ok(noticeLayout.left >= noticeLayout.panelRight + 8, 'unrelated notifications stay clear of inspector controls');
    assert.ok(noticeLayout.right <= profile.width && noticeLayout.overflow <= 1, 'the notice and its action remain within the available map space');
    assert.ok(noticeLayout.bottom <= noticeLayout.zoomTop, 'notifications keep map zoom controls available');
    const press = await page.locator('#inspector [data-gallery-browse]').evaluate(button => { button.scrollIntoView({ block: 'nearest' }); const r = button.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(press.x, press.y); await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
    await page.locator('#modal .gallery-explorer').waitFor();
    await closeReference(page);
    await page.evaluate(() => transport.setSpeed(0));
    assert.equal(await page.locator('#inspector').isVisible(), true, 'return from a held live Gallery press keeps map inspection');
    results.push({ ...profile, cactus: sites.cactus?.entry, layout, noticeLayout });
    await page.close(); activePage = null;
  }
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log('Selection Gallery: concise real object inspection, complete on-demand reference, live artwork/actions, keyboard/back/close/Build and narrow Retina layouts passed.');
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png` }).catch(() => {});
    await writeFile(`${output}/failure.json`, JSON.stringify({ message: error.message, errors, inspector: await activePage.locator('#inspector').textContent().catch(() => '') }, null, 2));
  }
  throw error;
} finally { await browser.close(); }
