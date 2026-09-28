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

  assert.deepEqual(errors, []);
  console.log('Inspector browser check passed');
} finally {
  await browser.close();
}
