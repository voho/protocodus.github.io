// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/browser-check.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-qa';
await mkdir(output, { recursive: true });
const errors = [];
const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); watch(page);
  await page.goto(url); await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
  assert.equal(await page.locator('button[data-world]').count(), 10);
  assert.equal(await page.evaluate(() => tyran.enemyTypes.length), 10);
  await page.screenshot({ path: `${output}/menu.png` });
  // Every world really switches the live renderer and gives a different image.
  const samples = new Set();
  for (let i = 0; i < 10; i++) {
    await page.locator(`button[data-world="${i}"]`).click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => tyran.world.index), i);
    assert.equal(await page.locator('#world-list button[aria-pressed="true"]').count(), 1, 'Exactly one world preview is selected');
    assert.equal(await page.locator('#world-list button[aria-pressed="true"]').getAttribute('data-world'), String(i), 'The selected card matches its renderer');
    // Read the visible renderer within RAF, before WebGL discards its drawing
    // buffer after presentation. The native input canvas can be hidden.
    samples.add(await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      const gpu = document.querySelector('#game-gpu-canvas');
      const surface = gpu && !gpu.hidden ? gpu : document.querySelector('#game-canvas');
      resolve(surface.toDataURL().slice(-1200));
    }))));
  }
  assert.equal(samples.size, 10, 'Ten visually different live environments');
  assert.equal(await page.locator('.hero-art').evaluate(el => getComputedStyle(el).opacity), '0', 'World previews reveal the live arena');
  // The manual is a real keyboard modal: background Launch must be unreachable.
  await page.locator('#help-button').click();
  assert.equal(await page.locator('#help-screen').getAttribute('role'), 'dialog');
  assert.equal(await page.locator('#help-screen').getAttribute('aria-modal'), 'true');
  for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'help-close', 'Manual focus stays inside its single-control dialog');
  }
  await page.keyboard.press('Escape');
  assert(await page.locator('#help-screen').isHidden());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'help-button', 'Closing the manual restores its trigger focus');
  assert.equal(await page.evaluate(() => tyran.scene), 'menu');
  // Launch uses the sector selected in the campaign strip, then the prominent
  // return control brings the pilot back to the command menu.
  await page.locator('#sector-flight-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 9, 'Launching a preview starts the selected sector');
  await page.keyboard.press('Escape');
  await page.locator('#menu-button').click();
  assert.equal(await page.evaluate(() => tyran.scene), 'menu');
  await page.locator('button[data-world="0"]').click();
  await page.locator('#launch-button').click();
  assert.equal(await page.evaluate(() => tyran.state.mode), 1);
  assert.equal(await page.evaluate(() => tyran.state.level), 0, 'Selecting the first sector starts the first sector');
  assert.equal(await page.locator('#p2-panel, [data-mode]').count(), 0);
  const before = await page.evaluate(() => tyran.state.players.map(p => ({ x:p.x,y:p.y })));
  await page.keyboard.down('KeyD');
  await page.keyboard.down('Space');
  await page.waitForTimeout(400);
  const moved = await page.evaluate(() => ({ players:tyran.state.players.map(p=>({x:p.x,y:p.y})), teams:[...new Set(tyran.state.bullets.map(b=>b.team))] }));
  assert(moved.players.length === 1 && moved.players[0].x > before[0].x, 'WASD moves the single player');
  assert(moved.teams.includes(0) && !moved.teams.includes(1), 'Space fires the only player');
  for (const key of ['KeyD','Space']) await page.keyboard.up(key);
  await page.evaluate(() => {
    tyran.state.events.push({ type:'explosion', x:tyran.state.width / 2, y:250, size:250, boss:true });
    tyran.step(.02);
  });
  await page.waitForFunction(() => document.querySelector('#game-canvas').style.filter.startsWith('blur('));
  await page.keyboard.press('Escape');
  assert(await page.locator('#pause-screen').isVisible());
  await page.waitForFunction(() => document.querySelector('#game-canvas').style.filter === '');
  const paused = await page.evaluate(() => tyran.state.time);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => tyran.state.time), paused, 'Pause freezes simulation');
  assert.equal(await page.locator('#game-canvas').evaluate(el => el.style.filter), '', 'Pausing an explosion stops its impact blur');
  // An orientation change must not strand visible salvage outside the new arena.
  await page.evaluate(() => tyran.state.pickups.push({ x:tyran.state.width * .8, y:300, age:0, kind:'credit', value:1, qaResize:true }));
  await page.setViewportSize({ width:390, height:844 });
  await page.waitForFunction(() => {
    const rect = document.querySelector('#game-canvas').getBoundingClientRect();
    return Math.abs(tyran.state.width - 900 * rect.width / rect.height) < 1e-7;
  });
  const resizedPickup = await page.evaluate(() => ({ width:tyran.state.width, x:tyran.state.pickups.find(p => p.qaResize).x }));
  assert(Math.abs(resizedPickup.x / resizedPickup.width - .8) < .001, 'Salvage preserves its position within the resized arena');
  await page.setViewportSize({ width:1440, height:960 });
  await page.waitForFunction(() => {
    const rect = document.querySelector('#game-canvas').getBoundingClientRect();
    return Math.abs(tyran.state.width - 900 * rect.width / rect.height) < 1e-7;
  });
  await page.evaluate(() => { tyran.state.pickups = tyran.state.pickups.filter(p => !p.qaResize); });
  await page.locator('#pause-quality-toggle').click();
  assert.equal(await page.locator('#pause-quality-toggle').getAttribute('aria-pressed'), 'false');
  await page.locator('#resume-button').click();
  // Destruction is real, persistent, and rewards salvage.
  const destruction = await page.evaluate(() => {
    const w = tyran.world, scale = w.scale;
    const buildings = new Set(['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite']);
    const p = w.visibleProps.find(prop => buildings.has(prop.type));
    const nature = w.visibleProps.find(prop => !buildings.has(prop.type));
    const destroyed = w.hit((p.screenX ?? p.x) * scale, p.screenY * scale, 3, 100000, tyran.state.scroll);
    const twice = w.hit((p.screenX ?? p.x) * scale, p.screenY * scale, 3, 100000, tyran.state.scroll);
    const natureHp = nature.hp;
    const natureEvents = w.hit((nature.screenX ?? nature.x) * scale, nature.screenY * scale, 0, 100000, tyran.state.scroll);
    const natureUnchanged = nature.hp === natureHp && !w.damage.has(nature.id) && !w.destroyed.has(nature.id) && !natureEvents.some(event => event.id === nature.id);
    return { count:destroyed.length, twice:twice.length, size:destroyed[0]?.size, natureUnchanged };
  });
  assert(destruction.natureUnchanged, 'Nature remains intact and never rewards salvage after a direct hit');
  assert(destruction.count > 0 && destruction.size > 0); assert.equal(destruction.twice, 0, 'Destroyed props cannot pay out twice');
  // Drive actual boss-death transition into the service bay.
  await page.evaluate(async () => {
    const {spawnEnemy,killEnemy}=await import('./sim.js');
    killEnemy(tyran.state,spawnEnemy(tyran.state,9,tyran.state.width/2,180));
    tyran.step(3.4);
    // Sector one continues into its challenging stage; let the formation pass.
    if (tyran.state.challenge) { for (const enemy of tyran.state.enemies) if (enemy.challenge) enemy.gone = true; tyran.step(5); }
  });
  assert(await page.locator('#hangar-screen').isVisible());
  assert.equal(await page.evaluate(() => tyran.state.status), 'hangar');
  await page.screenshot({ path:`${output}/hangar.png` });
  const oldCredits = await page.evaluate(() => tyran.state.credits);
  await page.locator('[data-upgrade="weapon"]').click();
  assert.equal(await page.evaluate(() => tyran.state.upgrades.weapon), 1);
  assert((await page.evaluate(() => tyran.state.credits)) < oldCredits);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tyran-campaign')));
  assert.equal(saved.state.upgrades.weapon, 1); assert.equal(saved.state.level, 0); assert.equal(saved.scene, 'hangar');
  await page.locator('#next-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 1);
  assert(await page.evaluate(() => tyran.state.players.every(p=>p.alive && p.hull === p.maxHull && p.shield === p.maxShield)));
  await page.reload(); await page.waitForFunction(()=>window.tyran);
  await page.locator('#continue-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 1);
  assert.equal(await page.evaluate(() => tyran.state.upgrades.weapon), 1);
  assert.equal(await page.evaluate(() => tyran.state.mode), 1);
  await page.screenshot({ path:`${output}/flight.png` });
  // All ten guardians can lead through the genuine completion flow.
  await page.evaluate(async () => {
    const {spawnEnemy,killEnemy}=await import('./sim.js');
    tyran.launch(9,{ upgrades:{weapon:6,shield:6,hull:6,recharge:6} });
    killEnemy(tyran.state,spawnEnemy(tyran.state,9,tyran.state.width/2,180)); tyran.step(3.4);
  });
  assert(await page.locator('#hangar-screen').isVisible());
  assert.equal(await page.evaluate(() => tyran.state.status), 'hangar');
  assert.match(await page.locator('#hangar-subtitle').textContent(), /new cycle awaits/i);
  await page.locator('#next-button').click();
  assert.equal(await page.evaluate(() => tyran.state.level), 10, 'The tenth guardian leads into a new campaign cycle');
  assert.equal(await page.evaluate(() => tyran.world.index), 0);
  assert.match(await page.locator('#level-number').textContent(), /11.*Cycle 2/);
  // Storage denial must not prevent boot or play.
  const restricted = await browser.newPage(); watch(restricted);
  await restricted.addInitScript(() => { Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage disabled');}}); });
  await restricted.goto(url); await restricted.waitForFunction(()=>window.tyran);
  await restricted.locator('#launch-button').click();
  assert.equal(await restricted.evaluate(()=>tyran.scene),'playing');
  // Mobile layout, actual touch movement/fire, and no horizontal overflow.
  const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}); watch(mobile);
  await mobile.goto(url); await mobile.waitForFunction(()=>window.tyran);
  assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await mobile.screenshot({path:`${output}/mobile-menu.png`});
  await mobile.locator('#launch-button').click();
  assert(await mobile.locator('#touch-stick').isVisible());
  const startX = await mobile.evaluate(()=>tyran.state.players[0].x);
  const cdp = await mobile.context().newCDPSession(mobile);
  const stick = await mobile.locator('#touch-stick').boundingBox(), fire = await mobile.locator('#touch-fire').boundingBox();
  const steer = {x:stick.x+stick.width/2,y:stick.y+stick.height/2,id:9};
  const trigger = {x:fire.x+fire.width/2,y:fire.y+fire.height/2,id:10};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[steer]});
  steer.x+=30;steer.y-=30;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[steer]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[steer,trigger]});
  await mobile.waitForTimeout(250);
  assert(await mobile.evaluate(x=>tyran.state.players[0].x>x,startX));
  assert(await mobile.evaluate(()=>tyran.state.bullets.some(b=>b.team===0)));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await mobile.screenshot({path:`${output}/mobile-flight.png`});
  assert.deepEqual(errors,[],'No browser errors');
  console.log('Tyran browser QA passed: ten worlds, single-player controls, pause, scenery destruction, upgrade economy, saved continuation, endless cycle transition, blocked storage, and mobile touch.');
} finally { await browser.close(); }
