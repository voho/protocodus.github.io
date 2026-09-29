// References and camera (DESIGN.md 7 and 10) on seed 1847 with the stone route: linked hover, the glide, a cut under reduced
// motion, the edge pointer and back chip, the inspector's Back line, Esc's focus return, map hover linking and a touch preview.
// Serve the repository root first (TRANSPORT_URL); screenshots go to TRANSPORT_OUTPUT.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createWorldFromMenu } from './browser-start.mjs';
import { stoneRoute } from './ui-states/setup.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-interconnection';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); };
const stats = page => page.evaluate(() => { const s = transport.renderer.getStats(); return { hoverRef: s.hoverRef, gliding: s.gliding }; });
const camera = page => page.evaluate(() => transport.renderer.getCamera());
const settled = page => page.waitForFunction(() => !transport.renderer.getStats().gliding, undefined, { timeout: 2000 });
// References built by ui-refs.js from the live game, in a paper panel above the map; `more` repeats the first to test linking.
const inject = (page, refs) => page.evaluate(async refs => {
  const { refFor } = await import('./ui-refs.js');
  let box = document.querySelector('#ref-check');
  if (!box) { box = document.createElement('div'); box.id = 'ref-check'; box.style.cssText = 'position:fixed;left:50%;top:84px;z-index:45;max-width:420px;padding:12px 16px;background:var(--paper);border-radius:var(--r-4);box-shadow:var(--e2);font-size:var(--fs-body);line-height:var(--lh-body)'; document.body.append(box); }
  box.innerHTML = refs.map(ref => `<p style="margin:4px 0">${refFor(transport.game, ref)}</p>`).join('');
}, refs);
const far = page => page.evaluate(() => { const g = transport.game, c = transport.renderer.getCamera(), x = c.x / 32 - .5, y = c.y / 32 - .5; return g.cities.slice().sort((a, b) => Math.hypot(b.x - x, b.y - y) - Math.hypot(a.x - x, a.y - y))[0].id; });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page);
  await page.goto(url);
  await createWorldFromMenu(page, { seed: 1847 });
  await stoneRoute(page);
  const quarry = await page.evaluate(() => { const site = transport.game.industries.find(site => site.name === 'Stone quarry' && site.x === 217 && site.y === 255); return { id: site.id, ref: `industry:${site.id}`, x: site.x, y: site.y }; });
  const town = await far(page);
  await inject(page, [quarry.ref, `town:${town}`, quarry.ref]);
  const refs = page.locator(`#ref-check [data-ref="${quarry.ref}"]`);
  assert.equal(await refs.count(), 2);
  assert.match(await refs.first().getAttribute('aria-label'), /^Stone quarry, industry$/);

  // 1. Hover: after 150 ms of intent the map is told, and every element naming the quarry is linked, within 300 ms.
  await refs.first().hover();
  const hovered = Date.now();
  await page.waitForFunction(ref => transport.renderer.getStats().hoverRef === ref && document.querySelectorAll(`[data-ref="${ref}"].is-linked`).length === 2, quarry.ref, { timeout: 1000 });
  assert.ok(Date.now() - hovered <= 300, `hover links within 300 ms (${Date.now() - hovered} ms)`);
  await page.screenshot({ path: `${output}/hover-quarry.png` });
  await page.mouse.move(40, 870);
  await page.waitForFunction(() => transport.renderer.getStats().hoverRef === null && !document.querySelector('#ref-check .is-linked'));

  // 2. Click glides: gliding turns true, then false within 600 ms; the quarry is selected, its inspector open and centred in the band.
  const before = await camera(page);
  const glide = await page.evaluate(async ref => {
    document.querySelector(`#ref-check [data-ref="${ref}"]`).click();
    const seen = [transport.renderer.getStats().gliding], start = performance.now();
    while (transport.renderer.getStats().gliding && performance.now() - start < 1500) await new Promise(requestAnimationFrame);
    seen.push(transport.renderer.getStats().gliding);
    return { seen, ms: performance.now() - start };
  }, quarry.ref);
  assert.deepEqual(glide.seen, [true, false], 'the camera glides and lands');
  assert.ok(glide.ms <= 600, `the glide lands within 600 ms (${Math.round(glide.ms)} ms)`);
  assert.notDeepEqual(await camera(page), before, 'the camera moved');
  assert.equal(await page.locator('#inspector-title').textContent(), 'Stone quarry', 'the quarry is inspected');
  const framed = await page.evaluate(q => {
    const p = transport.renderer.worldToScreen(q.x + .5, q.y + .5), s = getComputedStyle(document.querySelector('.map-section')), map = document.querySelector('.map-section'), band = side => parseFloat(s.getPropertyValue(`--band-${side}`));
    return { x: p.x, y: p.y, cx: (band('l') + map.clientWidth - band('r')) / 2, cy: (band('t') + map.clientHeight - band('b')) / 2, left: band('l'), inspector: document.querySelector('#inspector').getBoundingClientRect().right - map.getBoundingClientRect().left };
  }, quarry);
  assert.ok(framed.left >= framed.inspector - 1, `the band starts right of the inspector (${framed.left}, ${framed.inspector})`);
  assert.ok(Math.abs(framed.x - framed.cx) < 3 && Math.abs(framed.y - framed.cy) < 3, `the quarry sits in the middle of the band: ${JSON.stringify(framed)}`);
  await page.screenshot({ path: `${output}/glide-quarry.png` });

  // 3. Back line: a reference inside the inspector opens the next place with "Back to Stone quarry", which returns with its scroll.
  await page.evaluate(async ref => { const { refFor } = await import('./ui-refs.js'), box = document.querySelector('#inspector'); box.insertAdjacentHTML('beforeend', `<p id="ref-in-inspector">Near ${refFor(transport.game, ref)}</p>`); }, `town:${await page.evaluate(() => transport.game.cities[0].id)}`);
  await page.locator('#ref-in-inspector .ref').scrollIntoViewIfNeeded();
  const scroll = await page.locator('#inspector').evaluate(box => box.scrollTop);
  assert.ok(scroll > 0, 'the reference sits below the fold, so Back has a scroll to restore');
  await page.locator('#ref-in-inspector .ref').click();
  await page.locator('#inspector [data-inspector-back]').waitFor();
  assert.equal(await page.locator('#inspector [data-inspector-back]').textContent(), 'Back to Stone quarry');
  assert.equal(await page.locator('#inspector-title').textContent(), await page.evaluate(() => transport.game.cities[0].name));
  await settled(page);
  await page.screenshot({ path: `${output}/back-line.png` });
  await page.locator('#inspector [data-inspector-back]').click();
  assert.equal(await page.locator('#inspector-title').textContent(), 'Stone quarry', 'Back reopens the previous place');
  assert.equal(await page.locator('#inspector [data-inspector-back]').count(), 0, 'the first place has no Back line');
  // The check's own paragraph made the first view taller than its fresh markup, so the restored scroll may clamp to the new bottom.
  assert.equal(await page.locator('#inspector').evaluate(box => box.scrollTop), await page.locator('#inspector').evaluate((box, scroll) => Math.min(scroll, box.scrollHeight - box.clientHeight), scroll), 'and restores its scroll');

  // 4. Keyboard: Enter on a reference opens it and lands on its title; Esc closes the inspector and gives focus back to the reference.
  await page.locator('#inspector .tiny-button').click();
  await page.locator('#inspector').waitFor({ state: 'hidden' });
  await refs.last().focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'inspector-title');
  await page.keyboard.press('Escape');
  await page.locator('#inspector').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(ref => document.activeElement?.dataset.ref === ref && document.activeElement.closest('#ref-check') !== null, quarry.ref), true, 'Esc returns focus to the reference that opened the inspector');

  // 5. Map hover lights the panel references of the entity under the pointer; nothing scrolls. (The focused reference is linked
  // too, so focus goes to the map first.)
  await page.locator('#world').focus();
  await page.waitForFunction(() => !document.querySelector('#ref-check .is-linked'));
  await settled(page);
  const badge = await page.evaluate(q => { const site = transport.game.industries.find(site => site.x === q.x && site.y === q.y), m = transport.renderer.industryMarker(site), r = document.querySelector('#world').getBoundingClientRect(); return { x: r.left + m.x, y: r.top + m.y }; }, quarry);
  await page.mouse.move(badge.x, badge.y);
  await page.waitForFunction(ref => document.querySelectorAll(`#ref-check [data-ref="${ref}"].is-linked`).length === 2, quarry.ref);
  await page.mouse.move(40, 870);
  await page.waitForFunction(() => !document.querySelector('#ref-check .is-linked'));

  // 5b. A reference in the drawer: its inspector is never left under the drawer, and the place sits in the middle of the band.
  await page.locator('.main-nav [data-view="routes"]').click();
  const drawerTown = await page.evaluate(async () => { const { refFor } = await import('./ui-refs.js'), town = transport.game.cities[2]; document.querySelector('#panel-content').insertAdjacentHTML('afterbegin', `<p id="drawer-ref">${refFor(transport.game, `town:${town.id}`)}</p>`); return { id: town.id, x: town.x, y: town.y, name: town.name }; });
  await page.locator('#drawer-ref .ref').click();
  await settled(page);
  await page.waitForTimeout(250); // the drawer's slide
  const drawn = await page.evaluate(town => {
    const box = document.querySelector('#inspector').getBoundingClientRect(), drawer = document.querySelector('.sidebar'), d = drawer.getBoundingClientRect(), map = document.querySelector('.map-section'), s = getComputedStyle(map), band = side => parseFloat(s.getPropertyValue(`--band-${side}`)) || 0, p = transport.renderer.worldToScreen(town.x, town.y);
    return { covered: drawer.classList.contains('mobile-open') && box.left < d.right && box.right > d.left && box.top < d.bottom && box.bottom > d.top, title: document.querySelector('#inspector-title').textContent, dx: p.x - (band('l') + map.clientWidth - band('r')) / 2, dy: p.y - (band('t') + map.clientHeight - band('b')) / 2 };
  }, drawerTown);
  assert.equal(drawn.title, drawerTown.name);
  assert.equal(drawn.covered, false, 'the inspector is never left under the drawer');
  assert.ok(Math.abs(drawn.dx) < 3 && Math.abs(drawn.dy) < 3, `the town sits in the middle of the band: ${JSON.stringify(drawn)}`);
  await page.keyboard.press('Escape');
  await page.locator('#inspector').waitFor({ state: 'hidden' });
  await page.evaluate(() => document.querySelector('#drawer-ref')?.remove());

  // 6. A far town: an edge pointer at the band's edge with its distance in tiles; clicking it cuts there and offers Back.
  const townRef = page.locator(`#ref-check [data-ref="town:${town}"]`);
  await townRef.hover();
  await page.locator('#map-overlays .edge-pointer').waitFor();
  const pointer = await page.locator('#map-overlays .edge-pointer').evaluate(el => ({ text: el.textContent, ref: el.dataset.ref, action: el.dataset.refAction, box: el.getBoundingClientRect().toJSON(), map: document.querySelector('.map-section').getBoundingClientRect().toJSON() }));
  assert.equal(pointer.ref, `town:${town}`);
  assert.match(pointer.text, /[\d,]+ tiles$/, `the pointer names its distance: ${pointer.text}`);
  assert.ok(pointer.box.left >= pointer.map.left && pointer.box.right <= pointer.map.right && pointer.box.top >= pointer.map.top && pointer.box.bottom <= pointer.map.bottom, 'the pointer stays inside the map');
  assert.equal(await page.locator('#map-overlays .edge-pointer').count(), 1, 'one edge pointer');
  await page.screenshot({ path: `${output}/edge-pointer.png` });
  const home = await camera(page);
  await page.locator('#map-overlays .edge-pointer').click();
  await page.locator('#map-overlays .back-chip').waitFor();
  assert.equal(await page.locator('#map-overlays .back-chip').textContent(), 'Back to where you were');
  await settled(page);
  const there = await page.evaluate(id => { const city = transport.game.cities.find(c => c.id === id), p = transport.renderer.worldToScreen(city.x, city.y), r = document.querySelector('#world'); return p.x > 0 && p.y > 0 && p.x < r.clientWidth && p.y < r.clientHeight; }, town);
  assert.equal(there, true, 'the pointer took the map to the town');
  assert.equal(await page.locator('#inspector').isHidden(), true, 'the pointer shows the town without opening anything');
  await page.screenshot({ path: `${output}/back-chip.png` });
  await page.locator('#map-overlays .back-chip').click();
  await settled(page);
  const back = await camera(page);
  assert.ok(Math.abs(back.x - home.x) < 1 && Math.abs(back.y - home.y) < 1 && back.zoom === home.zoom, `Back to where you were returns the camera: ${JSON.stringify({ home, back })}`);
  assert.equal(await page.locator('#map-overlays .back-chip').count(), 0, 'and the chip goes');

  // 7. Reduced motion: a reference cuts in one frame and panels scroll without smoothing.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const cut = await page.evaluate(async ref => {
    const calls = [], native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) { calls.push(options?.behavior); return native.call(this, options); };
    const start = transport.renderer.getCamera();
    document.querySelector(`#ref-check [data-ref="${ref}"]`).click();
    const now = transport.renderer.getCamera(), gliding = transport.renderer.getStats().gliding;
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const later = transport.renderer.getCamera(), stop = transport.game.stations.find(station => station.x === 219 && station.y === 251);
    transport.inspect(stop.x, stop.y);
    document.querySelector('#station-route').click();
    Element.prototype.scrollIntoView = native;
    return { moved: now.x !== start.x || now.y !== start.y, gliding, same: now.x === later.x && now.y === later.y, calls };
  }, quarry.ref);
  assert.equal(cut.moved && !cut.gliding && cut.same, true, `the camera cuts in one frame: ${JSON.stringify(cut)}`);
  assert.deepEqual(cut.calls, ['auto'], 'no smooth scroll under reduced motion');
  await page.screenshot({ path: `${output}/reduced-motion.png` });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Escape');
  await page.close();

  // 8. Touch: a press held 450 ms previews the target without moving the camera or opening it; its click is swallowed.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  watch(phone);
  await phone.goto(url);
  await createWorldFromMenu(phone, { seed: 1847 });
  await inject(phone, [quarry.ref]);
  const touch = await phone.evaluate(async ref => {
    const el = document.querySelector(`#ref-check [data-ref="${ref}"]`), box = el.getBoundingClientRect(), at = { clientX: box.left + 8, clientY: box.top + 8, pointerType: 'touch', pointerId: 7, bubbles: true, isPrimary: true };
    const start = transport.renderer.getCamera(), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    await wait(560);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); el.dispatchEvent(menu);
    const during = { hoverRef: transport.renderer.getStats().hoverRef, camera: transport.renderer.getCamera(), menuBlocked: menu.defaultPrevented };
    el.dispatchEvent(new PointerEvent('pointerup', at)); el.click();
    await wait(50);
    return { during, start, after: transport.renderer.getStats().hoverRef, inspector: !document.querySelector('#inspector').hidden };
  }, quarry.ref);
  assert.equal(touch.during.hoverRef, quarry.ref, 'a long press previews the quarry');
  assert.deepEqual(touch.during.camera, touch.start, 'without moving the camera');
  assert.equal(touch.during.menuBlocked, true, 'its context menu is suppressed');
  assert.equal(touch.after, null, 'letting go ends the preview');
  assert.equal(touch.inspector, false, 'and the click after a preview opens nothing');
  await phone.close();

  assert.deepEqual(errors, []);
  console.log(`Interconnection checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
