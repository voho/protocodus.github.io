// Inspector in a real browser: live refreshes never swallow a press, identical refreshes leave
// the DOM alone, and a keyboard inspect lands on a labelled region.
// Serve the repository root first; every page uses fresh, isolated browser storage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://localhost:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-inspector-qa';
await mkdir(output, { recursive: true });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await createWorldFromMenu(page);
  assert.equal(await page.locator('#inspector').getAttribute('role'), 'region', 'the inspector is a landmark region');
  assert.equal(await page.locator('#inspector').getAttribute('aria-labelledby'), 'inspector-title');

  // Safari and iPad never focus a clicked button, so focus cannot shield the inspector from a live refresh.
  await page.evaluate(() => document.addEventListener('mousedown', event => { if (event.target.closest('#inspector button')) event.preventDefault(); }, true));
  for (const speed of [1, 8]) {
    let opened = 0;
    for (let trial = 0; trial < 20; trial++) {
      await page.evaluate(speed => { document.activeElement?.blur?.(); const site = transport.game.industries[3]; transport.inspect(site.x, site.y, 'industry'); transport.setSpeed(speed); }, speed);
      await page.waitForTimeout(100 + Math.floor(Math.random() * 400));
      // One task: a locator resolves its element before evaluating, and a live refresh in between detaches it.
      const point = await page.evaluate(() => { const el = document.querySelector('#industry-chain'); el.scrollIntoView({ block: 'nearest' }); const box = el.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
      await page.mouse.move(point.x, point.y);
      await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
      if (await page.waitForFunction(() => document.querySelector('#modal').open, undefined, { timeout: 1000 }).then(() => true, () => false)) {
        opened++;
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#modal').open);
      }
    }
    assert.equal(opened, 20, `every Full chain press opens the chain at ${speed}×`);
  }

  // An unchanged station keeps the very same nodes, so tooltips and a screen reader's place survive.
  await page.evaluate(() => {
    transport.setSpeed(0); document.activeElement?.blur?.();
    const stop = transport.game.stations[0]; transport.inspect(stop.x, stop.y);
    window.__inspectorMutations = 0;
    new MutationObserver(records => { window.__inspectorMutations += records.length; }).observe(document.querySelector('#inspector'), { childList: true });
    transport.setSpeed(1);
  });
  const day = await page.evaluate(() => transport.game.day);
  await page.waitForTimeout(5000);
  assert.ok(await page.evaluate(() => transport.game.day) > day + .5, 'the game ran while the station was selected');
  assert.equal(await page.evaluate(() => window.__inspectorMutations), 0, 'identical refreshes leave the station inspector untouched');

  // Values that do change still reach the open inspector.
  await page.evaluate(() => { const site = transport.game.industries[3]; transport.inspect(site.x, site.y, 'industry'); site.inventory = { ...site.inventory, [Object.keys(site.inventory || {})[0] || 'iron-ore']: 98765 }; });
  await page.waitForFunction(() => document.querySelector('#inspector .ledger').textContent.includes('98,765'), undefined, { timeout: 5000 });
  await page.evaluate(() => transport.setSpeed(0));

  // A pointer inspect leaves focus where it was.
  const stopPoint = await page.evaluate(() => { const stop = transport.game.stations[0]; transport.renderer.focus(stop.x, stop.y); const p = transport.renderer.worldToScreen(stop.x, stop.y), box = document.querySelector('#world').getBoundingClientRect(); return { x: box.left + p.x, y: box.top + p.y }; });
  await page.waitForTimeout(200);
  await page.mouse.click(stopPoint.x, stopPoint.y);
  await page.waitForFunction(() => !document.querySelector('#inspector').hidden);
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'inspector-title', 'pointer inspects never move focus');

  // Keyboard: Enter on a target row inspects it and lands on the labelled title.
  await page.evaluate(() => { const site = transport.game.industries[3]; transport.inspect(site.x, site.y, 'industry'); });
  const target = page.locator('#inspector .industry-target').first();
  const name = await target.locator('strong').innerText();
  await target.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'inspector-title');
  assert.equal(await page.locator('#inspector-title').innerText(), name, 'the target is now inspected');
  assert.match(await page.locator('#inspector').ariaSnapshot(), new RegExp(`^- region "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), 'the region is named after its title');
  await page.screenshot({ path: `${output}/keyboard-target.png` });
  await page.locator('#inspector').screenshot({ path: `${output}/keyboard-target-inspector.png` });
  assert.equal(await page.locator('#inspector .sheet-grabber').isVisible(), false, 'a wide screen keeps the floating card without a grabber');
  await page.close();

  // Phones: the inspector is a bottom sheet. A tap slides the site above it without pressing what opens under the finger,
  // live refreshes never move the map, toasts rise clear of it, its grabber raises it and a second tap puts it away.
  for (const [width, height] of [[390, 844], [320, 640]]) {
    const phone = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(url);
    await createWorldFromMenu(phone);
    await phone.evaluate(() => { document.querySelector('#toast-region').replaceChildren(); transport.setTool('inspect'); window.__sheetClicks = 0; document.addEventListener('click', event => { if (event.target.closest('#inspector')) window.__sheetClicks++; }, true); });
    // The mine starts low on the map, where the sheet opens under the finger.
    const mine = await phone.evaluate(() => { const site = transport.game.industries.find(industry => industry.kind === 'iron-mine'); transport.renderer.setZoom(1); transport.renderer.focus(site.x + .5, site.y + .5); transport.renderer.pan(0, innerHeight / 4); return { x: site.x + .5, y: site.y + .5 }; });
    const at = () => phone.evaluate(({ x, y }) => { const map = document.querySelector('#world').getBoundingClientRect(), p = transport.renderer.worldToScreen(x, y); return { x: map.left + p.x, y: map.top + p.y }; }, mine);
    const sheet = () => phone.evaluate(() => { const map = document.querySelector('#world').getBoundingClientRect(), box = document.querySelector('#inspector').getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, mapTop: map.top, mapHeight: map.height }; });
    const tap = async point => { await phone.touchscreen.tap(point.x, point.y); await phone.waitForTimeout(250); };
    const before = await at();
    assert.ok(before.y > height * .6, `${width}: the mine starts where the sheet will open`);
    await tap(before);
    assert.equal(await phone.locator('#inspector h3').textContent(), 'Iron mine', `${width}: a tap inspects the mine`);
    assert.equal(await phone.evaluate(() => window.__sheetClicks), 0, `${width}: the tap never presses the sheet that opens under it`);
    assert.equal(await phone.locator('#active-tool-bar').isVisible(), false, `${width}: the map stays in Explore`);
    let box = await sheet();
    assert.ok(box.top - box.mapTop >= box.mapHeight * .5, `${width}: the sheet leaves the upper half of the map open (${Math.round(box.top - box.mapTop)} of ${box.mapHeight})`);
    assert.ok(box.left === 0 && box.right === width && Math.abs(box.bottom - height) < 1, `${width}: the sheet spans the bottom edge`);
    const shown = await at();
    assert.ok(shown.y > box.mapTop + 24 && shown.y < box.top - 24, `${width}: the mine slides above the sheet (${Math.round(shown.y)} above ${Math.round(box.top)})`);
    const close = await phone.locator('#inspector .tiny-button').boundingBox();
    assert.ok(close.width >= 44 && close.height >= 44, `${width}: the close button is 44 px`);
    await phone.screenshot({ path: `${output}/phone-${width}-sheet.png` });

    // Live refreshes at 8× leave the camera alone.
    const camera = await phone.evaluate(() => { transport.setSpeed(8); return transport.renderer.getCamera(); });
    await phone.waitForTimeout(3000);
    assert.deepEqual(await phone.evaluate(() => { transport.setSpeed(0); return transport.renderer.getCamera(); }), camera, `${width}: 3 s at 8× never moves the map`);
    assert.equal(await phone.locator('#inspector h3').textContent(), 'Iron mine');

    // A toast rises above the sheet instead of covering it.
    await phone.evaluate(() => { const g = transport.game; g.notifications.unshift({ id: 'notice-sheet', day: g.day, message: 'A long notice about the network that wraps across two lines', text: 'A long notice about the network that wraps across two lines', type: 'info' }); g.money += 1; });
    await phone.locator('#toast-region .toast').first().waitFor();
    const toast = await phone.locator('#toast-region .toast').first().boundingBox();
    box = await sheet();
    assert.ok(toast.y + toast.height <= box.top, `${width}: the toast clears the sheet`);
    await phone.screenshot({ path: `${output}/phone-${width}-toast.png` });
    await phone.evaluate(() => document.querySelector('#toast-region').replaceChildren());

    // The grabber raises the sheet over the map and it stays up through refreshes until tapped again.
    const grabber = phone.locator('#inspector .sheet-grabber');
    assert.equal(await grabber.isVisible(), true, `${width}: a sheet with more to show has a grabber`);
    await grabber.tap();
    await phone.waitForTimeout(300);
    box = await sheet();
    assert.equal(await grabber.getAttribute('aria-expanded'), 'true');
    assert.ok(box.top - box.mapTop < box.mapHeight * .25, `${width}: the grabber raises the sheet`);
    await phone.evaluate(() => { transport.game.industries.find(industry => industry.kind === 'iron-mine').inventory = { iron: 4321 }; transport.game.money += 1; });
    await phone.waitForFunction(() => document.querySelector('#inspector').textContent.includes('4,321'), undefined, { timeout: 5000 });
    assert.equal(await phone.locator('#inspector').evaluate(el => el.classList.contains('expanded')), true, `${width}: a refresh keeps the sheet raised`);
    await phone.screenshot({ path: `${output}/phone-${width}-expanded.png` });
    await grabber.tap();
    assert.equal(await grabber.getAttribute('aria-expanded'), 'false');
    assert.equal(await phone.locator('#inspector').evaluate(el => el.classList.contains('expanded')), false);

    // A second tap on the mine puts the sheet away.
    await tap(await at());
    assert.equal(await phone.locator('#inspector').isHidden(), true, `${width}: re-tapping the mine closes the sheet`);
    await tap(await at());
    assert.equal(await phone.locator('#inspector').isVisible(), true, `${width}: the next tap opens it again`);

    // A town opened from the Towns list lands above the sheet.
    await phone.locator('.mobile-panel-toggle').tap();
    await phone.locator('[data-mobile-view="towns"]').tap();
    const town = await phone.locator('#entity-list [data-city]').first().getAttribute('data-city');
    await phone.locator('#entity-list [data-city]').first().tap();
    await phone.locator('#inspector').waitFor();
    box = await sheet();
    const place = await phone.evaluate(id => { const city = transport.game.cities.find(c => String(c.id) === id), map = document.querySelector('#world').getBoundingClientRect(), p = transport.renderer.worldToScreen(city.x, city.y); return { name: city.name, y: map.top + p.y }; }, town);
    assert.equal(await phone.locator('#inspector h3').textContent(), place.name);
    assert.ok(place.y > box.mapTop + 24 && place.y < box.top - 24, `${width}: a town from the list sits above the sheet (${Math.round(place.y)} above ${Math.round(box.top)})`);
    await phone.waitForTimeout(300);
    await phone.screenshot({ path: `${output}/phone-${width}-town.png` });
    await phone.close();
  }

  assert.deepEqual(errors, []);
  console.log('Inspector browser check passed');
} finally {
  await browser.close();
}
