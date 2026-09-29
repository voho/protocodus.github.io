import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_SCREENSHOTS || '/tmp/transport-compact-play';
await mkdir(output, { recursive: true });
const errors = [];
async function menu(page) { await page.locator('#game-menu-button').click(); await page.locator('#game-menu').waitFor({ state: 'visible' }); }
// Phones switch tools from the active-tool bar's recent-tools dock without reopening the drawer.
async function dock(page, name) {
  const width = page.viewportSize().width;
  assert.equal(await page.locator('#active-tool-name').innerText(), 'Road');
  assert.equal(await page.locator('#active-tool-hint').innerText(), 'Go straight up slopes and turn on flat ground.', 'touch players read the network rule');
  const buttons = await page.locator('#active-tool-dock button').evaluateAll(els => els.map(el => { const b = el.getBoundingClientRect(); return { tool:el.dataset.dockTool, label:el.getAttribute('aria-label'), width:b.width, height:b.height, svg:!!el.querySelector('svg') }; }));
  assert.equal(await page.locator('#active-tool-dock').getAttribute('role'), 'toolbar');
  assert.ok(buttons.length >= 2 && buttons.length <= (width < 360 ? 2 : 3), `dock holds ${buttons.length} recent tools at ${width}px`);
  assert.ok(buttons.every(b => b.tool !== 'road' && b.label && b.svg && b.width >= 44 && b.height >= 44), 'dock buttons are 44 px glyphs, never the current tool');
  assert.ok(await page.locator('#active-tool-bar').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth), 'the tool bar fits the phone');
  await page.evaluate(() => { const sidebar = document.querySelector('.sidebar'); window.drawerOpened = false; window.drawerWatch?.disconnect(); window.drawerWatch = new MutationObserver(() => { if (sidebar.classList.contains('mobile-open')) window.drawerOpened = true; }); window.drawerWatch.observe(sidebar, { attributes:true, attributeFilter:['class'] }); });
  await page.screenshot({ path:`${output}/${name}-dock.png`, animations:'disabled' });
  await page.locator('#active-tool-dock [data-dock-tool="stop"]').tap();
  assert.equal(await page.locator('#active-tool-name').innerText(), 'Stop', 'a dock tap switches the tool');
  assert.match(await page.locator('#active-tool-hint').innerText(), /Tap a road near customers/);
  assert.equal(await page.evaluate(() => window.drawerOpened || document.querySelector('.sidebar').classList.contains('mobile-open')), false, 'the dock never opens the drawer');
  assert.ok(await page.locator('#active-tool-dock [data-dock-tool="road"]').isVisible(), 'the previous tool moves into the dock');
  assert.equal(await page.locator('#active-tool-dock [data-dock-tool="stop"]').count(), 0);
  await page.screenshot({ path:`${output}/${name}-dock-stop.png`, animations:'disabled' });
}
try {
  for (const profile of [{ name:'desktop', width:1440, height:1000 }, { name:'mobile', width:390, height:844 }]) {
    const page = await browser.newPage({ viewport:profile, deviceScaleFactor:1, isMobile:profile.name==='mobile', hasTouch:profile.name==='mobile' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.locator('#start-create').waitFor();
    assert.equal(await page.evaluate(() => !!window.transport), false, 'Menu precedes game construction');
    await page.locator('#start-create').click();
    await page.waitForFunction(() => window.transport && !document.querySelector('#loading-screen').open);
    await page.evaluate(() => transport.setSpeed(0));
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('.sidebar').evaluate(el => el.inert), true);
    assert.equal(await page.locator('.minimap-wrap').isVisible(), false);
    assert.equal(await page.locator('.statusbar').isVisible(), false);
    const layout = await page.evaluate(() => ({
      header:document.querySelector('.topbar').getBoundingClientRect().height,
      map:document.querySelector('#world').getBoundingClientRect().width,
      width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(layout.header, 52); assert.equal(layout.map, layout.width); assert.equal(layout.overflow, false);
    await page.screenshot({ path:`${output}/${profile.name}-play.png`, animations:'disabled' });

    if (profile.name === 'desktop') {
      await page.locator('.main-nav [data-view="build"]').click();
      assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false');
      await page.locator('.main-nav [data-view="build"]').click();
      assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true');
      await page.locator('.main-nav [data-view="build"]').click();
    } else {
      await page.locator('.mobile-panel-toggle').click();
      assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'false');
    }
    await page.screenshot({ path:`${output}/${profile.name}-build.png`, animations:'disabled' });
    await page.locator('#panel-content [data-tool="road"]').click();
    assert.equal(await page.locator('.sidebar').getAttribute('aria-hidden'), 'true', 'Choosing construction frees the map');
    assert.equal(await page.locator('#active-tool-bar').isVisible(), true);
    if (profile.name === 'desktop') {
      assert.equal(await page.locator('#active-tool-hint').innerText(), 'Drag to build. Go straight up slopes and turn on flat ground.');
      assert.equal(await page.locator('#active-tool-dock').isVisible(), false, 'a mouse at desktop width keeps the plain bar');
      await page.keyboard.press('s');
      assert.match(await page.locator('#active-tool-hint').innerText(), /5 tiles/, 'the stop hint names the catchment');
    } else await dock(page, 'mobile-390');
    await page.locator('#cancel-tool-button').click();
    assert.equal(await page.locator('#active-tool-bar').isVisible(), false);

    await menu(page); await page.locator('#overview-button').click();
    assert.equal(await page.locator('.minimap-wrap').isVisible(), true);
    assert.equal(await page.locator('#game-menu').isVisible(), false);
    assert.ok(await page.locator('#minimap').evaluate(el => el.width > 10 && el.height > 10));
    await page.locator('#close-minimap').click();
    assert.equal(await page.locator('.minimap-wrap').isVisible(), false);

    await menu(page); await page.locator('#layers-button').click();
    assert.equal(await page.locator('#layers-panel').isVisible(), true);
    assert.equal(await page.locator('#game-menu').isVisible(), false);
    await page.locator('[data-layers-close]').click();
    await page.waitForFunction(() => document.activeElement.id === 'game-menu-button');
    await page.locator('#world').focus(); await page.keyboard.press('l');
    assert.equal(await page.locator('#layers-panel').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement.id === 'game-menu-button');

    await menu(page); await page.locator('#map-options-button').click();
    assert.equal(await page.locator('#map-options').isVisible(), true);
    await page.locator('#grid-button').click();
    assert.equal(await page.locator('#map-options').isVisible(), false);
    await page.waitForFunction(() => document.activeElement.id === 'game-menu-button');
    await menu(page); await page.screenshot({ path:`${output}/${profile.name}-menu.png`, animations:'disabled' });
    await page.locator('#help-button').click();
    assert.equal(await page.locator('#modal').isVisible(), true);
    await page.locator('#modal .close-modal').click();
    await menu(page); await page.locator('#main-menu-button').click();
    await page.locator('#start-resume').waitFor();
    await page.locator('#start-resume').click();
    await page.waitForFunction(() => !document.querySelector('#start-menu')?.open);
    if (profile.name === 'mobile') {
      await page.setViewportSize({ width:320, height:640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const boxes = await page.locator('.mobile-panel-toggle,.hud-finance-wrap,.date-block,.compact-menu-wrap').evaluateAll(els => els.map(el => { const b=el.getBoundingClientRect(); return {left:b.left,right:b.right}; }));
      for (let i=1;i<boxes.length;i++) assert.ok(boxes[i].left >= boxes[i-1].right-1, 'Header controls do not overlap');
      await page.screenshot({ path:`${output}/small-mobile-play.png`, animations:'disabled' });
      await page.evaluate(() => transport.setView('build'));
      await page.locator('#panel-content [data-tool="road"]').click();
      await dock(page, 'mobile-320');
    }
    console.log(`${profile.name}: collapsed playfield, tool drawer, map layers, mini map, focus restoration, menus and resume passed`);
    await page.close();
  }

  // A notched phone in landscape: chrome clears the safe areas, the short layout fits, and touch targets and muted text hold up on every phone size.
  const { waitForGameReady, openGameAction } = await import('./browser-start.mjs');
  const phone = await browser.newPage({ viewport:{ width:844, height:390 }, deviceScaleFactor:1, isMobile:true, hasTouch:true });
  phone.on('pageerror', error => errors.push(error.message));
  const cdp = await phone.context().newCDPSession(phone);
  const insets = value => cdp.send('Emulation.setSafeAreaInsetsOverride', { insets:value });
  const box = selector => phone.locator(selector).first().evaluate(el => { const b=el.getBoundingClientRect(); return { left:b.left, top:b.top, right:innerWidth-b.right, bottom:innerHeight-b.bottom }; });
  const hitHeight = selector => phone.locator(selector).first().evaluate(el => { const b=el.getBoundingClientRect(), x=b.left+b.width/2; let height=0; for (let y=Math.floor(b.top)-30;y<=b.bottom+30;y++) if (el.contains(document.elementFromPoint(x,y))) height++; return height; });
  const contrast = selector => phone.locator(selector).first().evaluate(el => {
    const rgba = color => { const [r,g,b,a=1] = color.match(/[\d.]+/g).map(Number); return [r,g,b,a]; }, over = (top, under) => under.map((v,i) => top[i]*top[3]+v*(1-top[3]));
    const layers = []; for (let node=el;node;node=node.parentElement) { const color=rgba(getComputedStyle(node).backgroundColor); if (color[3]) layers.unshift(color); if (color[3]===1) break; }
    const background = layers.reduce((under, top) => over(top, under), [255,255,255]), text = over(rgba(getComputedStyle(el).color), background);
    const luminance = rgb => rgb.reduce((sum,v,i) => { v/=255; return sum+[.2126,.7152,.0722][i]*(v<=.03928?v/12.92:((v+.055)/1.055)**2.4); }, 0);
    const [light, dark] = [luminance(text), luminance(background)].sort((a,b) => b-a); return (light+.05)/(dark+.05);
  });
  const touchTargets = async size => {
    for (const selector of ['[data-speed="0"]','[data-speed="1"]','[data-speed="3"]','[data-speed="8"]']) assert.ok(await hitHeight(selector) >= 44, `${size}: ${selector} takes taps across 44 px`);
    await phone.locator(await phone.locator('.mobile-panel-toggle').isVisible() ? '.mobile-panel-toggle' : '.main-nav [data-view="build"]').click();
    await phone.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
    assert.ok(await hitHeight('#close-management') >= 44, `${size}: the drawer close button takes taps across 44 px`);
    await phone.locator('#close-management').click();
    await phone.evaluate(() => { const town=transport.game.cities[0]; transport.inspect(town.x, town.y); });
    assert.ok(await hitHeight('#inspector .tiny-button') >= 44, `${size}: the inspector close button takes taps across 44 px`);
    await phone.locator('#inspector .tiny-button').click();
    await openGameAction(phone, 'overview-button');
    assert.ok(await hitHeight('#close-minimap') >= 44, `${size}: the mini map close button takes taps across 44 px`);
    await phone.locator('#close-minimap').click();
  };
  await insets({ left:47, right:47, bottom:21 });
  await phone.goto(url); await phone.locator('#start-create').waitFor();
  const create = await box('#start-create');
  assert.ok(create.top >= 0 && create.bottom >= 21, 'Create world shows above the home indicator without scrolling');
  await phone.locator('#start-create').click();
  await waitForGameReady(phone);
  assert.ok((await box('.brand-symbol')).left >= 47, 'the logo clears the left notch');
  assert.ok((await box('#game-menu-button')).right >= 47, 'the menu button clears the right notch');
  const zoom = await box('.view-controls');
  assert.ok(zoom.right >= 47 && zoom.bottom >= 21, 'zoom controls clear the notch and the home indicator');
  await phone.locator('.main-nav [data-view="build"]').click();
  await phone.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 47);
  const drawer = await box('.sidebar');
  assert.ok(drawer.left >= 47 && drawer.bottom >= 21, 'the drawer clears the notch and the home indicator');
  assert.ok(await phone.locator('#panel-content .tool-grid .tool-card').evaluateAll(cards => { const panel=cards[0].closest('#panel-content').getBoundingClientRect(); return cards.filter(card => { const b=card.getBoundingClientRect(); return b.top >= panel.top-1 && b.bottom <= panel.bottom+1; }).length; }) >= 4, 'at least four Build tools show without scrolling');
  assert.equal(await phone.locator('#panel-content [data-tool="road"] .shortcut').isVisible(), false, 'touch hides keyboard letters');
  assert.equal(await phone.locator('.build-bottom-tools .compact-tool>span').first().isVisible(), false, 'touch hides the Esc hint');
  assert.equal(await phone.locator('#panel-content [data-tool="road"]').getAttribute('aria-keyshortcuts'), 'R');
  assert.ok(await contrast('.tool-grid .tool-card .tool-cost') >= 4.5, 'tool costs read at 4.5:1');
  await phone.screenshot({ path:`${output}/landscape-build.png`, animations:'disabled' });
  await phone.locator('.main-nav [data-view="routes"]').click();
  for (const selector of ['.route-actions .small-button.danger','.route-vehicle-spec','.vehicle-model','.route-rate','.fleet-upgrade-heading small']) assert.ok(await contrast(selector) >= 4.5, `${selector} reads at 4.5:1`);
  assert.ok(await phone.locator('.route-actions .small-button').first().evaluate(el => el.getBoundingClientRect().height) >= 40, 'route actions are 40 px on touch');
  await phone.locator('#close-management').click();
  await phone.evaluate(() => { const town=transport.game.cities[0]; transport.inspect(town.x, town.y); });
  assert.ok(await contrast('#inspector .tiny-button') >= 4.5, 'the inspector close button reads at 4.5:1');
  const inspector = await box('#inspector');
  assert.ok(inspector.left >= 47 && inspector.bottom >= 21 && inspector.top >= 52, 'the inspector clears the safe areas and the header');
  await phone.screenshot({ path:`${output}/landscape-inspector.png`, animations:'disabled' });
  await phone.locator('#inspector .tiny-button').click();
  await touchTargets('844');
  await insets({ left:0, right:0, bottom:0 });
  for (const [width, height] of [[390, 844], [320, 640]]) {
    await phone.setViewportSize({ width, height });
    await touchTargets(String(width));
  }
  await phone.locator('.mobile-panel-toggle').click();
  assert.ok(await contrast('.management-drawer-heading') >= 4.5, 'the drawer heading reads at 4.5:1');
  await phone.close();
  console.log('landscape phone: safe areas, short layout, touch targets and contrast passed');
  assert.deepEqual(errors, []);
  console.log(`Compact gameplay checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
