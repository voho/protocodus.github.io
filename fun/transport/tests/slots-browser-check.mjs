// Serve the repository root first. Every mutation uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-slots-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => page.on('pageerror', error => errors.push(error.message));
const card = (page, id) => page.locator(`[data-save-slot="${id}"]`);
const action = (page, id, name) => card(page, id).locator(`[data-save-action="${name}"]`);
const confirm = (page, id, name) => card(page, id).locator(`[data-save-confirm="${name}"]`);
const slotRaw = (page, id) => page.evaluate(id => localStorage.getItem(`transport-slot-v1:${id}`), id);
const fits = (page, selector) => page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1);
async function openSaves(page) {
  if (await page.locator('#save-button').isVisible()) await page.locator('#save-button').click();
  else {
    if (!(await page.locator('.sidebar').evaluate(element => element.classList.contains('mobile-open')))) await page.locator('.mobile-panel-toggle').click();
    await page.locator('#panel-save').click();
  }
  await page.locator('.saves-explorer').waitFor({ state: 'visible' });
}
async function closeSaves(page) {
  await page.locator('.saves-explorer .close-modal').click();
  await page.locator('.saves-explorer').waitFor({ state: 'hidden' });
}
async function fingerprint(page, source = 'game') {
  return page.evaluate(async source => {
    const { encodeGame, decodeGame } = await import('./save-codec.js');
    const game = source === 'autosave' ? decodeGame(JSON.parse(localStorage.getItem('transport-save-v1'))) : transport.game;
    const encoded = encodeGame(game);
    delete encoded.state.maintenanceRevision;
    encoded.state.routes = game.routes.map(({ pathRevision, ...route }) => route);
    const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sorted(encoded))));
    return { hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
      biome: game.biome, size: game.size, seed: game.seed, width: game.width, height: game.height,
      day: game.day, money: game.money, routes: game.routes.map(route => route.name) };
  }, source);
}
async function createSlot(page, name) {
  const before = await page.locator('[data-save-slot]').evaluateAll(nodes => nodes.map(node => node.dataset.saveSlot));
  await page.locator('#save-new-name').fill(name);
  await page.locator('#save-new-button').click();
  await page.waitForFunction(before => [...document.querySelectorAll('[data-save-slot]')].some(node => !before.includes(node.dataset.saveSlot)), before);
  const id = await page.locator('[data-save-slot]').evaluateAll((nodes, before) => nodes.find(node => !before.includes(node.dataset.saveSlot)).dataset.saveSlot, before);
  assert.match(await card(page, id).innerText(), new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return id;
}
async function loadSlot(page, id) {
  await action(page, id, 'load').click();
  await confirm(page, id, 'load').click();
  await page.locator('.saves-explorer').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => transport.speed), 0, 'loading preserves the paused simulation');
}
async function prepareCompany(page, { label, kind, days, money }) {
  return page.evaluate(async ({ label, kind, days, money }) => {
    const { build, addRoute, tick, validateGame } = await import('./model.js');
    const game = transport.game, home = game.cities[0];
    game.money = 1_000_000;
    let plot;
    for (let y = home.y + 6; y < home.y + 18 && !plot; y++) for (let x = home.x - 8; x < home.x + 16 && !plot; x++) {
      const tile = game.tiles[y * game.width + x];
      if (tile && ['grass', 'sand', 'snow', 'forest', 'rock'].includes(tile.terrain) && !tile.road && !tile.rail && !tile.zone && !tile.building
          && !game.industries.some(industry => industry.x === x && industry.y === y)) plot = { x, y };
    }
    if (!plot) throw new Error('No suitable QA building plot.');
    const built = build(game, kind, plot.x, plot.y);
    const route = addRoute(game, { name: `${label} shuttle`, mode: 'road', stops: game.stations.slice(0, 2).map(station => station.id), cargo: 'passengers' });
    if (!built.ok || !route.ok) throw new Error(`${built.message}; ${route.message}`);
    tick(game, days); game.money = money;
    if (!validateGame(game)) throw new Error('QA snapshot must remain a valid playable company.');
    return { ...plot, kind };
  }, { label, kind, days, money });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(page);
  await page.goto(url);
  await page.waitForFunction(() => window.transport?.game && localStorage.getItem('transport-save-v1'));
  await page.locator('[data-speed="0"]').click();
  const alphaBuilding = await prepareCompany(page, { label: 'Alpine', kind: 'school', days: 17.25, money: 111222.75 });
  const alpha = await fingerprint(page);
  await openSaves(page);
  const alphaId = await createSlot(page, 'Alpine reserve');
  assert.equal(await card(page, 'autosave').count(), 1, 'autosave appears alongside named slots');
  for (const name of ['rename', 'overwrite', 'delete']) assert.equal(await action(page, 'autosave', name).count(), 0, `autosave has no ${name} action`);
  const alphaRaw = await slotRaw(page, alphaId);
  await closeSaves(page);

  // A second world has different dimensions, biome, routes, buildings and cash.
  await page.locator('#world-button').click();
  await page.locator('[data-biome="desert"]').click();
  await page.locator('[data-world-size="regional"]').click();
  await page.locator('#world-seed').fill('9042');
  await page.locator('#generate-world').click();
  await page.locator('[data-speed="0"]').click();
  const betaBuilding = await prepareCompany(page, { label: 'Oasis', kind: 'house-expensive-3', days: 43.5, money: 222333.5 });
  const beta = await fingerprint(page);
  await openSaves(page);
  const betaId = await createSlot(page, 'Oasis company');
  assert.notEqual(alphaId, betaId);
  assert.equal(await slotRaw(page, alphaId), alphaRaw, 'saving a different world does not alter the first slot');
  await page.screenshot({ path: `${output}/desktop-two-companies.png` });
  await closeSaves(page);

  // Draft form values and inspector selection belong to the old world.
  await page.locator('.main-nav [data-view="routes"]').click();
  await page.locator('#route-form [name="name"]').fill('Stale desert draft');
  await page.locator('#route-search').fill('Oasis');
  await page.locator('#route-form [name="from"]').selectOption('station-1');
  await page.evaluate(() => { const industry = transport.game.industries[0]; transport.inspect(industry.x, industry.y, 'industry'); });
  await openSaves(page);
  await action(page, alphaId, 'load').click();
  await card(page, alphaId).locator('[data-save-cancel]').click();
  assert.deepEqual(await fingerprint(page), beta, 'cancelling Load leaves the current world intact');
  await loadSlot(page, alphaId);
  assert.deepEqual(await fingerprint(page), alpha, 'loading restores every simulation and tile value');
  assert.deepEqual(await fingerprint(page, 'autosave'), alpha, 'the loaded world immediately becomes the current autosave');
  assert.equal(await page.locator('#inspector').isVisible(), false, 'old industry selection is cleared');
  await page.waitForFunction(() => transport.renderer.getStats().minimapWidth === 768);
  assert.equal(await page.evaluate(point => transport.game.tiles[point.y * transport.game.width + point.x].building.kind, alphaBuilding), alphaBuilding.kind);
  await page.locator('.main-nav [data-view="routes"]').click();
  assert.equal(await page.locator('#route-form [name="name"]').inputValue(), '');
  assert.equal(await page.locator('#route-form [name="from"]').inputValue(), '');
  assert.equal(await page.locator('#route-form [name="to"]').inputValue(), '');
  assert.equal(await page.locator('#route-search').inputValue(), '', 'route filters reset with the world');
  await openSaves(page);
  await loadSlot(page, betaId);
  assert.deepEqual(await fingerprint(page), beta, 'the second company also restores without state leakage');
  assert.deepEqual(await fingerprint(page, 'autosave'), beta);
  await page.waitForFunction(() => transport.renderer.getStats().minimapWidth === 128);
  assert.equal(await page.evaluate(point => transport.game.tiles[point.y * transport.game.width + point.x].building.kind, betaBuilding), betaBuilding.kind);

  await openSaves(page);
  await action(page, alphaId, 'rename').click();
  await page.locator(`[data-save-rename-form="${alphaId}"] [name="slotName"]`).fill('Alpine reserve & depot');
  await page.locator(`[data-save-rename-form="${alphaId}"] button[type="submit"]`).click();
  await page.waitForFunction(id => JSON.parse(localStorage.getItem(`transport-slot-v1:${id}`)).name === 'Alpine reserve & depot', alphaId);
  assert.match(await card(page, alphaId).innerText(), /Alpine reserve & depot/);
  const renamedAlphaRaw = await slotRaw(page, alphaId);
  assert.equal(JSON.parse(renamedAlphaRaw).payload, JSON.parse(alphaRaw).payload, 'renaming changes only metadata');
  await closeSaves(page);

  await page.evaluate(async () => { const { tick } = await import('./model.js'); tick(transport.game, 5); transport.game.money = 333444.25; });
  const betaUpdated = await fingerprint(page), originalBetaRaw = await slotRaw(page, betaId);
  await openSaves(page);
  await action(page, betaId, 'overwrite').click();
  await card(page, betaId).locator('[data-save-cancel]').click();
  assert.equal(await slotRaw(page, betaId), originalBetaRaw, 'cancelling overwrite preserves the stored snapshot');
  await action(page, betaId, 'overwrite').click();
  await confirm(page, betaId, 'overwrite').click();
  await page.waitForFunction(({ id, before }) => localStorage.getItem(`transport-slot-v1:${id}`) !== before, { id: betaId, before: originalBetaRaw });
  const updatedBetaRaw = await slotRaw(page, betaId);
  assert.equal(JSON.parse(updatedBetaRaw).name, 'Oasis company', 'overwrite retains the slot name');
  await loadSlot(page, alphaId);
  await openSaves(page);
  await loadSlot(page, betaId);
  assert.deepEqual(await fingerprint(page), betaUpdated, 'overwrite creates a loadable complete new snapshot');
  await page.evaluate(() => { transport.game.money += 987; });
  await openSaves(page);
  await loadSlot(page, 'autosave');
  assert.deepEqual(await fingerprint(page), betaUpdated, 'opening Load / save preserves and can restore the previous automatic checkpoint');

  // Corruption is visible during listing; a slot changed after listing is still
  // revalidated on Load and cannot activate damaged data from a stale card.
  await page.evaluate(({ id, raw }) => { const slot = JSON.parse(raw); slot.payload = 'not a valid saved world'; localStorage.setItem(`transport-slot-v1:${id}`, JSON.stringify(slot)); }, { id: alphaId, raw: renamedAlphaRaw });
  await openSaves(page);
  assert.equal(await action(page, alphaId, 'load').isDisabled(), true, 'a damaged save is visibly unavailable');
  assert.match(await card(page, alphaId).locator('.save-card-error').innerText(), /damaged|unsupported|corrupt/i);
  assert.equal(await action(page, alphaId, 'delete').isEnabled(), true, 'a damaged entry remains removable');
  await page.evaluate(({ id, raw }) => localStorage.setItem(`transport-slot-v1:${id}`, raw), { id: alphaId, raw: renamedAlphaRaw });
  await closeSaves(page);
  await openSaves(page);
  await page.evaluate(({ id, raw }) => { const slot=JSON.parse(raw);slot.payload='damaged after listing';localStorage.setItem(`transport-slot-v1:${id}`,JSON.stringify(slot)); }, {id:alphaId,raw:renamedAlphaRaw});
  const autosaveBeforeDamage = await page.evaluate(() => localStorage.getItem('transport-save-v1'));
  await action(page, alphaId, 'load').click();
  await confirm(page, alphaId, 'load').click();
  await page.locator('#saves-message.is-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#saves-message').innerText(), /corrupt|invalid|damaged|read|load/i);
  assert.deepEqual(await fingerprint(page), betaUpdated, 'a damaged slot cannot replace the running company');
  assert.equal(await page.evaluate(() => localStorage.getItem('transport-save-v1')), autosaveBeforeDamage);
  assert.equal(await slotRaw(page, betaId), updatedBetaRaw, 'damaged data cannot affect another slot');
  await page.screenshot({ path: `${output}/desktop-corrupt-slot.png` });
  await page.evaluate(({ id, raw }) => localStorage.setItem(`transport-slot-v1:${id}`, raw), { id: alphaId, raw: renamedAlphaRaw });
  await closeSaves(page);

  // Simulated quota failures exercise the actual UI and native storage boundary.
  await openSaves(page);
  const quotaAutosave = await page.evaluate(() => localStorage.getItem('transport-save-v1'));
  await page.evaluate(() => {
    window.slotStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (String(key).startsWith('transport-slot-v1:')) throw new DOMException('No space for this save.', 'QuotaExceededError');
      return window.slotStorageWrite.call(this, key, value);
    };
  });
  await action(page, betaId, 'overwrite').click();
  await confirm(page, betaId, 'overwrite').click();
  await page.locator('#saves-message.is-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#saves-message').innerText(), /storage|space|full|save/i);
  assert.equal(await slotRaw(page, betaId), updatedBetaRaw, 'failed overwrite leaves the previous slot byte-for-byte intact');
  assert.equal(await slotRaw(page, alphaId), renamedAlphaRaw);
  assert.equal(await page.evaluate(() => localStorage.getItem('transport-save-v1')), quotaAutosave);
  await page.evaluate(() => { Storage.prototype.setItem = window.slotStorageWrite; delete window.slotStorageWrite; });
  await closeSaves(page);

  // The slot may read correctly while activating its autosave fails. Keep both
  // the current game and its previously working autosave in that case too.
  await openSaves(page);
  await page.evaluate(() => {
    window.slotStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'transport-save-v1') throw new DOMException('Autosave storage is full.', 'QuotaExceededError');
      return window.slotStorageWrite.call(this, key, value);
    };
  });
  await action(page, alphaId, 'load').click();
  await confirm(page, alphaId, 'load').click();
  await page.locator('#saves-message.is-error').waitFor({ state: 'visible' });
  assert.deepEqual(await fingerprint(page), betaUpdated, 'failed activation preserves the visible game');
  assert.equal(await page.evaluate(() => localStorage.getItem('transport-save-v1')), quotaAutosave, 'failed activation preserves the previous autosave');
  assert.equal(await page.locator('.saves-explorer').isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.slotStorageWrite; delete window.slotStorageWrite; });
  await closeSaves(page);

  await openSaves(page);
  await action(page, alphaId, 'delete').click();
  await card(page, alphaId).locator('[data-save-cancel]').click();
  assert.equal(await slotRaw(page, alphaId), renamedAlphaRaw, 'Delete cancel preserves the slot');
  await action(page, alphaId, 'delete').click();
  await confirm(page, alphaId, 'delete').click();
  await card(page, alphaId).waitFor({ state: 'detached' });
  assert.equal(await slotRaw(page, alphaId), null);
  assert.equal(await slotRaw(page, betaId), updatedBetaRaw, 'deleting one slot leaves another intact');
  await closeSaves(page);

  // Extra independent slots make mobile scrolling and the sticky close control meaningful.
  const extraIds = await page.evaluate(async () => {
    const { writeSaveSlot } = await import('./save-slots.js'), ids = [];
    for (let index = 1; index <= 4; index++) {
      const result = await writeSaveSlot(transport.game, { name: `Regional branch ${index}` });
      if (!result.ok) throw new Error(result.message);
      ids.push(result.id);
    }
    return ids;
  });
  await page.reload();
  await page.waitForFunction(() => window.transport?.game);
  await page.locator('[data-speed="0"]').click();
  assert.equal(await page.evaluate(() => transport.game.seed), betaUpdated.seed, 'reload continues the active autosave');
  assert.equal(await page.evaluate(() => transport.game.biome), 'desert');
  assert.ok(await page.evaluate(day => transport.game.day >= day && transport.game.day < day + 2, betaUpdated.day));
  assert.equal(await slotRaw(page, betaId), updatedBetaRaw, 'autosave restoration does not overwrite the manual snapshot');
  await page.keyboard.press('Control+s');
  await page.locator('.saves-explorer').waitFor({ state: 'visible' });
  for (const id of [betaId, ...extraIds]) assert.equal(await card(page, id).count(), 1, 'named slots survive a page reload');
  await closeSaves(page);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openSaves(page);
    assert.equal(await fits(page, '#modal'), true, `${width}px save dialog fits`);
    assert.equal(await fits(page, '.saves-explorer'), true, `${width}px save content fits`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await card(page, betaId).scrollIntoViewIfNeeded();
    const close = await page.locator('.saves-explorer .close-modal').boundingBox();
    assert.ok(close && close.y >= 0 && close.y + close.height <= 844 && close.x >= 0 && close.x + close.width <= width, `${width}px Close remains on screen after scrolling`);
    assert.equal(await page.evaluate(() => scrollY), 0, 'dialog scrolling leaves the game header fixed');
    await page.screenshot({ path: `${output}/mobile-${width}-slots.png` });
    await closeSaves(page);
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(`Transport save-slot browser checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
