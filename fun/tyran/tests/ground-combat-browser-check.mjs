// Serve the repo root; run with TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs.
// Frozen animation frames keep real scenery, combat callbacks and UI deterministic.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-ground-combat-qa';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await mkdir(output, { recursive: true });
await page.addInitScript(() => {
  const queued = new Map(); let sequence = 0, time = 1000;
  window.requestAnimationFrame = callback => { const id = ++sequence; queued.set(id, callback); return id; };
  window.cancelAnimationFrame = id => queued.delete(id);
  window.__frame = (elapsed = 0) => {
    time += elapsed;
    const callbacks = [...queued.values()]; queued.clear();
    for (const callback of callbacks) callback(time);
  };
  localStorage.setItem('tyran-muted', 'true');
});
const ready = () => page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
const click = selector => page.evaluate(selector => document.querySelector(selector).click(), selector);
const near = (a, b, label) => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} versus ${b}`);

try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/'); await ready();
  await page.evaluate(() => {
    window.groundQA = {
      quiet() {
        const s = tyran.state;
        Object.assign(s, { spawnTimer: 10000, formationTimer: 10000, showcase: 9, duration: 10000, enemies: [], bullets: [], events: [] });
      },
      site(role, bonus) {
        for (let row = -1; row >= -30; row--) {
          const found = tyran.world.getBand(row).find(p => p.groundRole === role && (!bonus || p.bonus === bonus) && p.x > 180 && p.x < 1020);
          if (found) return found;
        }
        throw new Error(`Missing ${role}/${bonus || 'any'} fixture`);
      },
      focus(prop, y = 220) {
        const s = tyran.state, w = tyran.world, scale = s.width / 1200;
        s.scroll = y / scale - prop.y;
        const focus = s.players.reduce((sum, p) => sum + p.x, 0) / s.players.length;
        w.getGroundTargets(s.width, s.height, s.scroll, focus);
        return { x: (prop.x + w.parallaxX) * scale, y: (prop.y + s.scroll) * scale };
      },
      projectile(point, damage = 10000) {
        tyran.state.bullets.push({ x: point.x, y: point.y, px: point.x, py: point.y, vx: 0, vy: 0,
          radius: 2, damage, team: 0, life: 1, age: 0, kind: 'pulse', color: '#9cfff0' });
      },
    };
  });
  await click('#launch-button');
  const warning = await page.evaluate(() => {
    groundQA.quiet();
    const s = tyran.state, prop = groundQA.site('turret');
    groundQA.turretId = prop.id;
    groundQA.focus(prop, 170);
    for (let frame = 0; frame < 360; frame++) {
      tyran.step(1 / 60);
      const activity = s.turrets.find(t => t.id === prop.id);
      if (activity?.charge > .55) {
        document.querySelector('#announcement').hidden = true; __frame();
        return { charged: true, fired: activity.flash > 0 };
      }
    }
    return { charged: false };
  });
  assert(warning.charged && !warning.fired, 'A turret telegraphs its aim before firing');
  await page.screenshot({ path: `${output}/ground-turret-warning.png` });
  const turret = await page.evaluate(() => {
    const s = tyran.state, id = groundQA.turretId;
    let fired = false;
    for (let frame = 0; frame < 180; frame++) {
      tyran.step(1 / 60);
      const activity = s.turrets.find(t => t.id === id);
      if (activity?.flash > 0 && s.bullets.some(b => b.team < 0 && b.color === '#ffc76c')) { fired = true; break; }
    }
    const activity = s.turrets.find(t => t.id === id);
    const point = { x: activity?.x, y: activity?.y };
    s.bullets = []; groundQA.projectile(point); tyran.step(1 / 60);
    const destroyed = tyran.world.destroyed.has(id);
    s.bullets = []; tyran.step(1 / 60);
    const removed = !s.turrets.some(t => t.id === id);
    return { fired, destroyed, removed };
  });
  assert(turret.fired, 'The telegraphed turret fires a hostile projectile');
  assert(turret.destroyed && turret.removed, 'Destroying its scenery removes the active turret');
  console.log('PASS real turret telegraph, hostile fire and destruction shutdown');

  const rewards = await page.evaluate(() => {
    const results = [];
    for (const trigger of ['projectile', 'airborne explosion']) {
      tyran.launch(0); groundQA.quiet();
      const s = tyran.state, w = tyran.world, prop = groundQA.site('cache', trigger === 'projectile' ? 'rapid' : 'invulnerable');
      const point = groundQA.focus(prop, 240);
      // The reward still travels through real world.hit and the game callback;
      // low remaining armor makes an ordinary ship explosion sufficient.
      prop.hp = 2; w.damage.set(prop.id, prop.hp);
      if (trigger === 'projectile') groundQA.projectile(point);
      else s.events.push({ type: 'explosion', ...point, size: 30 });
      tyran.step(1 / 60);
      const first = s.pickups.filter(p => p.kind === prop.bonus).length;
      const destroyed = w.destroyed.has(prop.id);
      s.bullets = []; const nextPoint = { x: (prop.x + w.parallaxX) * w.scale, y: (prop.y + s.scroll) * w.scale };
      if (trigger === 'projectile') groundQA.projectile(nextPoint);
      else s.events.push({ type: 'explosion', ...nextPoint, size: 30 });
      tyran.step(1 / 60);
      results.push({ trigger, destroyed, bonus: prop.bonus, first, after: s.pickups.filter(p => p.kind === prop.bonus).length });
    }
    return results;
  });
  for (const reward of rewards) {
    assert(reward.destroyed, `${reward.trigger} destroys the actual supply structure`);
    assert.equal(reward.first, 1, `${reward.trigger} drops its marked bonus once`);
    assert.equal(reward.after, 1, 'Repeated damage to the crater does not mint another pickup');
  }
  console.log('PASS direct and collateral supply destruction each release one collectible');

  // Collect through the collision loop, so timers, pickup collection and HUD are
  // tested together instead of assigning active bonus fields directly.
  await page.evaluate(() => {
    tyran.launch(0); groundQA.quiet();
    const s = tyran.state;
    for (const [pilot, kinds] of [[s.players[0], ['rapid', 'invulnerable']]]) {
      for (const kind of kinds) s.pickups.push({ x: pilot.x, y: pilot.y, kind, age: 0, value: 0 });
    }
    tyran.step(1 / 60); __frame();
  });
  let bonuses = await page.evaluate(() => tyran.state.players.map(p => ({ rapid: p.rapidFireTime, invulnerable: p.invulnerableTime })));
  near(bonuses[0].rapid, 10, 'Rapid bonus begins at ten seconds'); near(bonuses[0].invulnerable, 10, 'Immortality begins at ten seconds');
  assert(await page.locator('#p1-rapid').isVisible()); assert(await page.locator('#p1-invulnerable').isVisible());
  assert.match(await page.locator('#p1-rapid-time').textContent(), /10\s*s/);
  await page.evaluate(() => { document.querySelector('#announcement').hidden = true; __frame(); });
  await page.screenshot({ path: `${output}/collected-ground-bonuses.png` });

  await page.evaluate(() => { tyran.step(2.25); tyran.pause(); });
  const checkpoint = await page.evaluate(() => ({ timers: tyran.state.players.map(p => [p.rapidFireTime, p.invulnerableTime]), turrets: tyran.state.turrets, time: tyran.state.time }));
  await page.evaluate(() => { __frame(6000); tyran.step(6); });
  assert.deepEqual(await page.evaluate(() => tyran.state.players.map(p => [p.rapidFireTime, p.invulnerableTime])), checkpoint.timers, 'Pause freezes bonus durations');
  await page.reload(); await ready(); await click('#continue-button');
  assert.equal(await page.evaluate(() => tyran.scene), 'pause');
  assert.deepEqual(await page.evaluate(() => tyran.state.players.map(p => [p.rapidFireTime, p.invulnerableTime])), checkpoint.timers, 'Autosave/reload keeps each pilot’s exact remaining bonus time');
  assert.deepEqual(await page.evaluate(() => tyran.state.turrets), checkpoint.turrets, 'Autosave/reload keeps active turret firing state');
  await click('#resume-button');
  const refreshed = await page.evaluate(() => {
    const s = tyran.state, p = s.players[0];
    s.pickups.push({ x: p.x, y: p.y, kind: 'rapid', value: 0, age: 0 });
    tyran.step(1 / 60);
    return s.players.map(p => [p.rapidFireTime, p.invulnerableTime]);
  });
  near(refreshed[0][0], 10, 'Another rapid pickup refreshes to ten seconds without stacking');
  await page.evaluate(() => tyran.step(10.1));
  bonuses = await page.evaluate(() => tyran.state.players.map(p => [p.rapidFireTime, p.invulnerableTime]));
  assert.deepEqual(bonuses, [[0, 0]], 'Both temporary bonuses expire during active flight');
  for (const id of ['p1-rapid', 'p1-invulnerable']) assert(await page.locator(`#${id}`).isHidden(), 'Expired bonus badges disappear');
  console.log('PASS collectible ownership, HUD countdowns, refresh, expiry and exact paused autosave restoration');
  for (const [name, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
    const mobile = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.addInitScript(() => localStorage.setItem('tyran-muted', 'true'));
    await mobile.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
    await mobile.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true');
    await mobile.evaluate(() => {
      document.querySelector('#launch-button').click();
      const s = tyran.state, pilot = s.players[0];
      s.spawnTimer = s.formationTimer = 100; s.showcase = 9;
      for (const kind of ['rapid', 'invulnerable']) s.pickups.push({ x: pilot.x, y: pilot.y, kind, age: 0, value: 0 });
      tyran.step(1 / 60); document.querySelector('#announcement').hidden = true;
    });
    assert(await mobile.locator('#p1-rapid').isVisible() && await mobile.locator('#p1-invulnerable').isVisible());
    const panel = await mobile.locator('#p1-panel').boundingBox();
    const stick = await mobile.locator('#touch-stick').boundingBox(), fire = await mobile.locator('#touch-fire').boundingBox(), secondary = await mobile.locator('#touch-secondary').boundingBox();
    assert(stick.y + stick.height + 8 <= panel.y, `${name}: touch steering clears the expanded pilot HUD`);
    assert(secondary && secondary.y + secondary.height + 8 <= panel.y, `${name}: secondary touch fire clears the expanded pilot HUD`);
    const cdp = await mobile.context().newCDPSession(mobile);
    const steer = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 9 };
    const trigger = { x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 10 };
    const startX = await mobile.evaluate(() => tyran.state.players[0].x);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [steer] });
    steer.x += 30; steer.y -= 20;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [steer] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [steer, trigger] });
    await mobile.waitForFunction(x => tyran.state.players[0].x > x + 5 && tyran.state.bullets.some(b => b.team === 0 && b.kind === 'pulse'), startX);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const plasma = { x: secondary.x + secondary.width / 2, y: secondary.y + secondary.height / 2, id: 11 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [plasma] });
    await mobile.waitForFunction(() => tyran.state.bullets.some(b => b.team === 0 && b.kind === 'plasma') && tyran.state.players[0].fireEnergy < 100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // A captured finger from before pause must not steer again on resume.
    await mobile.evaluate(() => {
      const s = tyran.state, p = s.players[0]; s.bullets.length = 0;
      Object.assign(p, { x: s.width * .45, px: s.width * .45, y: 650, py: 650, vx: 0, vy: 0, blastVx: 0, blastVy: 0, hurt: 100 });
    });
    const heldStick = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 12 };
    const heldFire = { x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 13 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [heldStick, heldFire] });
    heldStick.x += 25; heldStick.y -= 15;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [heldStick, heldFire] });
    await mobile.waitForFunction(() => tyran.state.players[0].vx > 5);
    await mobile.evaluate(() => tyran.pause());
    const pausedX = await mobile.evaluate(() => tyran.state.players[0].x);
    heldStick.x += 8; heldStick.y -= 5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [heldStick, heldFire] });
    await mobile.waitForTimeout(100);
    assert.equal(await mobile.evaluate(() => tyran.state.players[0].x), pausedX, `${name}: dragging a previously captured finger cannot advance paused flight`);
    const knob = () => mobile.evaluate(() => {
      const style = document.querySelector('#touch-stick').style;
      return [style.getPropertyValue('--stick-x'), style.getPropertyValue('--stick-y')];
    });
    assert.deepEqual(await knob(), ['0px', '0px'], `${name}: pausing resets the touch knob`);
    const resumed = await mobile.evaluate(() => {
      tyran.pause(); const p = tyran.state.players[0];
      p.vx = p.vy = p.blastVx = p.blastVy = p.fire = 0; tyran.state.bullets.length = 0;
      return { x: p.x, y: p.y };
    });
    heldStick.x += 3;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [heldStick, heldFire] });
    await mobile.waitForTimeout(250);
    assert.deepEqual(await mobile.evaluate(() => ({ x: tyran.state.players[0].x, y: tyran.state.players[0].y })), resumed, `${name}: resume does not reapply the old finger’s steering`);
    assert.deepEqual(await knob(), ['0px', '0px'], `${name}: the old finger cannot move the reset knob`);
    assert.equal(await mobile.evaluate(() => tyran.state.bullets.some(b => b.team === 0)), false, `${name}: resume does not restore the held touch trigger`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.screenshot({ path: `${output}/mobile-bonuses-${name}.png` });
    await mobile.close();
  }
  console.log('PASS portrait and landscape bonus HUD clears touch controls, with both fire channels and paused-touch capture cleanup');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`Ground combat screenshots: ${output}`);
} finally { await browser.close(); }
