// Articulated defenses: real combat aiming, fixed foundations, frozen fog memory,
// directional muzzle positions and fixed-light shadows for both races and ownerships.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-turret-qa';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/turret-fixture.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#142027"></body>' }));
  await page.goto(new URL('turret-fixture.html', process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/').href);
  const report = await page.evaluate(async () => {
    const { BUILDINGS, createGame, updateGame, powerStats } = await import('./sim.js');
    const { drawSprite, drawSpriteShadow, drawSpriteOverlay, startAssets, terrainImages } = await import('./assets.js');
    const { defenseSprite, defenseSpriteStats, defenseMuzzle } = await import('./defense-sprites.js');
    const { encodeGame, decodeGame } = await import('./save.js');
    const { Renderer } = await import('./render.js');
    await startAssets();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sprite = (type, team, angle) => ({ id: 800, type, team, kind: 'building', angle, hp: BUILDINGS[type].hp,
      maxHp: BUILDINGS[type].hp, size: BUILDINGS[type].size, progress: 1, queue: [], path: [], order: { type: 'idle' }, repath: 0, x: 30, y: 30 });
    const sample = (e, draw = drawSprite) => {
      ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 96); ctx.scale(2, 2); draw(ctx, e, 3); ctx.restore();
      const data = ctx.getImageData(0, 0, 192, 192).data; let mass = 0, x = 0, y = 0, clipped = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255, px = i / 4 % 192, py = Math.floor(i / 4 / 192);
        mass += a; x += a * px; y += a * py;
        if (a > .1 && (px < 2 || px > 189 || py < 2 || py > 189)) clipped++;
      }
      return { data, mass, x: x / mass, y: y / mass, clipped };
    };
    const rows = [];
    const sheet = document.createElement('canvas'); sheet.id = 'defenses'; sheet.width = 1280; sheet.height = 864; document.body.append(sheet);
    const sheetCtx = sheet.getContext('2d'); sheetCtx.fillStyle = '#142027'; sheetCtx.fillRect(0, 0, 1280, 864);
    const types = ['turret', 'rocketTower', 'unityTurret', 'unityRocketTower'];
    for (const [ti, type] of types.entries()) for (const team of [0, 1]) {
      const row = ti * 2 + team, frames = [];
      for (let n = 0; n < 16; n++) {
        const angle = n * Math.PI / 8, entity = sprite(type, team, angle), body = sample(entity), shadow = sample(entity, drawSpriteShadow);
        frames.push(body);
        const overlay = sample(entity, (c, e) => drawSpriteOverlay(c, e, 3, '#ffffff'));
        rows.push({ type, team, heading: n, clipped: body.clipped, shadowDownRight: shadow.x > body.x + 2 && shadow.y > body.y + 3,
          overlayMatches: body.data.every((v, i) => i % 4 !== 3 || v === overlay.data[i]) });
        const x = n * 80 + 40, y = row * 108 + 62;
        sheetCtx.drawImage(terrainImages.ground, x - 39, y - 40, 78, 82);
        sheetCtx.save(); sheetCtx.translate(x, y); sheetCtx.scale(n < 8 ? 1 : .56, n < 8 ? 1 : .56);
        drawSpriteShadow(sheetCtx, entity, 3); drawSprite(sheetCtx, entity, 3); sheetCtx.restore();
        sheetCtx.fillStyle = '#a9bcc0'; sheetCtx.font = '9px monospace'; sheetCtx.textAlign = 'center';
        sheetCtx.fillText(`${Math.round(n * 22.5)}°`, x, row * 108 + 106);
      }
      // A strip of the fixed front foundation remains identical during a complete turn.
      const first = frames[0];
      const fixedBase = frames.every(frame => {
        const big = type.toLowerCase().includes('rockettower');
        for (let y = big ? 132 : 126; y < (big ? 140 : 128); y++)
          for (let x = 47; x < 145; x++) for (let c = 0; c < 4; c++)
            if (frame.data[(y * 192 + x) * 4 + c] !== first.data[(y * 192 + x) * 4 + c]) return false;
        return true;
      });
      const changed = frames.slice(1).every(frame => frame.data.some((v, i) => v !== first.data[i]));
      rows.push({ type, team, changed, fixedBase });
      sheetCtx.fillStyle = '#dbe4de'; sheetCtx.textAlign = 'left'; sheetCtx.font = '11px monospace';
      sheetCtx.fillText(`${type} · ${team ? 'HOSTILE' : 'FRIENDLY'} · normal / minimum zoom`, 9, row * 108 + 13);
    }
    const combats = [];
    for (const type of types) {
      const s = createGame(`aim-${type}`, 'normal', { width: 72, height: 56, aiTeams: [], races: [type.startsWith('unity') ? 'aiUnity' : 'organics', 'organics'] });
      s.terrain.fill(0); s.minerals.fill(0); s.visible.forEach(v => v.fill(1)); s.explored.forEach(v => v.fill(1)); s.fogClock = .9;
      const target = s.entities.find(e => e.team === 1 && e.type === 'scout');
      s.entities = s.entities.filter(e => e.kind === 'building' || e === target); target.x = 34; target.y = 30; target.cooldown = 99;
      const gun = { ...sprite(type, 0, 0), id: s.nextId++, cooldown: 99 }; s.entities.push(gun); s.navVersion++;
      const at = () => Math.atan2(target.y - (gun.y + gun.size / 2), target.x - (gun.x + gun.size / 2));
      updateGame(s, .05); const firstAim = Math.abs(gun.angle - at()) < 1e-9, didNotShoot = gun.lastShot === undefined;
      target.x = 29; target.y = 33;
      updateGame(s, .05); const tracks = Math.abs(gun.angle - at()) < 1e-9;
      gun.cooldown = 0; updateGame(s, .05);
      const effect = s.effects.find(fx => fx.weapon === (type.toLowerCase().includes('rockettower') ? 'rocketTower' : 'turret'));
      const firesAlongAim = !!effect && Math.abs(Math.atan2(effect.ty - effect.y, effect.tx - effect.x) - gun.angle) < 1e-9;
      const restored = decodeGame(encodeGame(s)).game.entities.find(e => e.id === gun.id);
      const saved = restored.angle === gun.angle && restored.aimAngle === gun.aimAngle;
      const beforePowerLoss = gun.angle; target.x = 34; target.y = 31;
      for (const e of s.entities) if (e.team === 0 && e.kind === 'building' && BUILDINGS[e.type].power > 0) e.hp = 0;
      updateGame(s, .05);
      combats.push({ type, firstAim, tracks, didNotShoot, firesAlongAim, saved, unpowered: powerStats(s, 0).ratio < 1 && gun.angle === beforePowerLoss });
    }
    // Remembered enemy guns retain their last observed heading after live aim changes.
    const world = document.createElement('canvas'); world.style.cssText = 'width:400px;height:320px;position:fixed;left:0;top:0'; document.body.append(world);
    const renderer = new Renderer(world, null), state = createGame('turret-fog', 'normal', { width: 72, height: 56, aiTeams: [] });
    state.terrain.fill(0); state.minerals.fill(0); state.visible[0].fill(1); state.explored[0].fill(1);
    const enemy = { ...sprite('unityRocketTower', 1, .7), id: state.nextId++ }; state.entities.push(enemy);
    const view = { x: 31, y: 31, zoom: 32, selected: new Set() }; renderer.draw(state, view);
    const remembered = renderer.rememberedBuildings.get(enemy.id).angle;
    state.visible[0].fill(0); enemy.angle = 2.4; state.time += 1; renderer.draw(state, view);
    const fogFrozen = remembered === .7 && renderer.rememberedBuildings.get(enemy.id).angle === .7;
    world.remove();
    const east = defenseMuzzle(sprite('rocketTower', 0, 0)), west = defenseMuzzle(sprite('rocketTower', 0, Math.PI));
    // More towers than the former LRU capacity must reuse every prepared image on
    // subsequent shadow/body passes, rather than continually rebuilding the whole base.
    const battery = Array.from({ length: 48 }, (_, i) => sprite(i % 2 ? 'rocketTower' : 'unityRocketTower', i % 3 ? 0 : 1, i * Math.PI / 24));
    const prepared = battery.map(e => defenseSprite(e));
    const staticCacheStable = battery.every((e, i) => defenseSprite(e) === prepared[i]);
    return { rows, combats, fogFrozen, staticCacheStable, muzzleTurns: east.x > 0 && west.x < 0, cache: defenseSpriteStats() };
  });
  for (const row of report.rows) {
    if ('heading' in row) { assert.equal(row.clipped, 0, `${row.type} clips`); assert(row.shadowDownRight, `${row.type} shadow follows light`); assert(row.overlayMatches, `${row.type} overlay matches rotated weapon`); }
    else { assert(row.changed, `${row.type} visibly turns`); assert(row.fixedBase, `${row.type} foundation stays still`); }
  }
  for (const combat of report.combats) for (const [key, value] of Object.entries(combat)) if (key !== 'type') assert(value, `${combat.type}: ${key}`);
  assert(report.fogFrozen); assert(report.muzzleTurns); assert(report.staticCacheStable); assert(report.cache.bytes <= report.cache.limitBytes); assert.deepEqual(errors, []);
  await page.locator('#defenses').screenshot({ path: `${output}/defense-headings.png` });
  console.log(JSON.stringify({ passed: true, headings: 128, combats: report.combats, fogFrozen: report.fogFrozen, cache: report.cache }, null, 2));
} finally { await browser.close(); }
