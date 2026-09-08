// Actual renderer scenes at the supported physical-pixel ceiling and minimum zoom.
// Review PNGs together with camera-check.mjs's continuous-heading pixel invariants.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-race-art-qa';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:4173/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  await page.locator('#deploy').click();
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Review must show the battlefield');
  const checks = await page.evaluate(async () => {
    const { spriteNativeZoom, drawSprite, spriteStats } = await import('./assets.js');
    const { createGame, UNITS, BUILDINGS, unitRole, buildingRole } = await import('./sim.js');
    const { Renderer } = await import('./render.js');
    const world = document.createElement('canvas');
    world.style.cssText = 'position:fixed;inset:0;z-index:20000;width:100vw;height:100vh;display:block';
    document.body.append(world);
    const renderer = new Renderer(world, null), nativeZoom = spriteNativeZoom(devicePixelRatio);
    const s = createGame('race-art-qa', 'normal', { width: 144, height: 112 });
    s.time = 15; s.entities = []; s.effects = []; s.terrain.fill(0); s.minerals.fill(0); s.mineralTypes.fill(0);
    s.visible[0].fill(1); s.explored[0].fill(1);
    const view = { x: 64, y: 41, zoom: nativeZoom, selected: new Set() };
    const make = (type, team, x, y, extra = {}) => { const d = UNITS[type] || BUILDINGS[type]; return { id: s.nextId++, type, team,
      kind: UNITS[type] ? 'unit' : 'building', x, y, hp: d.hp, maxHp: d.hp, size: d.size, progress: 1, queue: [], path: [], order: { type: 'idle' }, ...extra }; };
    const setup = race => {
      s.entities = []; s.effects = []; view.selected.clear(); renderer.rememberedBuildings.clear();
      s.terrain.fill(0); s.minerals.fill(0); s.mineralTypes.fill(0); s.teams.forEach(t => { t.race = race; });
      const units = Object.keys(UNITS).filter(t => UNITS[t].race === race);
      const buildings = Object.keys(BUILDINGS).filter(t => BUILDINGS[t].race === race);
      for (const team of [0, 1]) {
        const base = 49 + team * 18;
        buildings.forEach((type, i) => {
          const role = buildingRole(type), extra = {};
          if (role === 'refinery') Object.assign(extra, { processingAmount: 145, processingType: team ? 3 : 2 });
          if (role === 'lab') extra.research = { id: 'vehicleWeapons', progress: .55 };
          if (role === 'capacitor') extra.reserve = 820;
          if (role === 'factory' || role === 'barracks') extra.queue = [{ type: units.find(t => unitRole(t) === (role === 'factory' ? 'tank' : 'rocket')), progress: .63 }];
          s.entities.push(make(type, team, base + i % 3 * 4, 29 + Math.floor(i / 3) * 4, extra));
        });
        units.forEach((type, i) => {
          const e = make(type, team, base + .8 + i % 4 * 2.6, 43 + Math.floor(i / 4) * 3.2, {
            angle: i * .47 + team * .23, moving: i % 2 === 0, cargo: 200, cargoType: team ? 3 : 2 });
          if (i === 3 && team === 0) { e.order = { type: 'move', x: e.x + .7, y: 49.5 }; view.selected.add(e.id); }
          s.entities.push(e);
        });
        for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [2, 2], [1, 2]]) s.entities.push(make('wall', team, base + dx + 4, 50 + dy));
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]]) s.terrain[(41 + dy) * s.width + base + 10 + dx] = 1;
        for (let type = 1; type <= 3; type++) for (const [dx, dy] of [[0, 0], [1, 1], [0, 2]]) {
          const i = (40 + dy) * s.width + base - 3 + (type - 1) * 3 + dx;
          s.minerals[i] = type === 3 ? 2400 : 1200; s.mineralTypes[i] = type;
        }
      }
      // One deliberately irregular crater bowl, beside traversing units and raised rock.
      for (let y = 36; y < 45; y++) for (let x = 62; x < 68; x++) if ((x - 64.8) ** 2 / 7 + (y - 40) ** 2 / 12 < 1 + Math.sin(x * 2 + y) * .12) s.terrain[y * s.width + x] = 5;
      s.entities.push(make(units.find(t => unitRole(t) === 'scout'), 0, 64.4, 40.1, { angle: .42, moving: true }));
      renderer.terrainSource = null; renderer.unitPositions?.clear(); renderer.draw(s, view);
    };
    setup('aiUnity');
    const sample = e => {
      const c = document.createElement('canvas'); c.width = c.height = 160;
      const ctx = c.getContext('2d'); ctx.translate(80, 80); drawSprite(ctx, e, s.time);
      return ctx.getImageData(0, 0, 160, 160).data;
    };
    const pixelDiff = (a, b) => a.reduce((n, value, i) => n + (value !== b[i]), 0);
    const locomotion = {};
    for (const type of ['unityRifle', 'unityRocket', 'unityTank', 'unityArtillery', 'unityEngineer', 'unityStriker']) {
      s.time = 20.01; const e = make(type, 0, 0, 0, { moving: true }); const before = sample(e); s.time += .18; const after = sample(e);
      e.moving = false; const idle = sample(e); s.time += .4; const idleLater = sample(e);
      locomotion[type] = { movingDifference: pixelDiff(before, after), idleDifference: pixelDiff(idle, idleLater) };
    }
    const wall = s.entities.find(e => e.type === 'wall' && e.team === 1);
    renderer.draw(s, view); s.visible[0].fill(0); renderer.draw(s, view);
    const frozen = renderer.ctx.getImageData(0, 0, world.width, world.height).data;
    s.entities.push(make('wall', 1, wall.x - 1, wall.y)); s.entities.find(e => e.type === 'unityLab' && e.team === 1).research.progress = .99;
    renderer.draw(s, view); const hidden = renderer.ctx.getImageData(0, 0, world.width, world.height).data;
    s.visible[0].fill(1);
    window.raceVisualQA = { s, renderer, view, setup, nativeZoom, world };
    return { stats: spriteStats(), nativeZoom, locomotion, concealedChanges: pixelDiff(frozen, hidden) };
  });
  assert.deepEqual(checks.stats.errors, []);
  for (const [type, row] of Object.entries(checks.locomotion)) {
    assert(row.movingDifference > 0, `${type}: moving changes pose or step height`);
    assert.equal(row.idleDifference, 0, `${type}: idle does not animate locomotion`);
  }
  assert.equal(checks.concealedChanges, 0, 'Hidden wall neighbors and live research cannot change remembered silhouettes');
  for (const race of ['organics', 'aiUnity']) {
    await page.evaluate(race => raceVisualQA.setup(race), race);
    for (const [width, height] of [[1440, 960], [390, 844]]) for (const factor of [1, .5]) for (const team of width < 500 ? [0, 1] : [0]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(({ width, factor, team }) => {
        const { s, renderer, view, nativeZoom } = raceVisualQA; renderer.resize();
        Object.assign(view, { x: width < 500 ? 53.7 + team * 18 : 63.6, y: 40.5, zoom: nativeZoom * factor }); renderer.draw(s, view);
      }, { width, factor, team });
      await page.screenshot({ path: `${output}/${race}-${width}-${factor}-team${team}.png` });
      if (width === 1440) {
        const grayscale = await page.evaluate(() => {
          const world = raceVisualQA.world, c = document.createElement('canvas'); c.width = world.width; c.height = world.height;
          const ctx = c.getContext('2d'); ctx.filter = 'grayscale(1)'; ctx.drawImage(world, 0, 0);
          return c.toDataURL('image/png').split(',')[1];
        });
        await writeFile(`${output}/${race}-${width}-${factor}-grayscale.png`, Buffer.from(grayscale, 'base64'));
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    const film = await page.evaluate(async () => {
      const { s, renderer, view, nativeZoom } = raceVisualQA;
      const c = document.createElement('canvas'); c.width = 1440; c.height = 960;
      const ctx = c.getContext('2d'); renderer.resize(); Object.assign(view, { x: 54, y: 44.5, zoom: nativeZoom });
      // Twelve actual battlefield headings, including angles between compass directions.
      for (let turn = 0; turn < 12; turn++) {
        s.time += .17; for (const e of s.entities) if (e.kind === 'unit') { e.angle = turn * Math.PI / 6 + .17; e.moving = turn % 2 === 1; }
        renderer.draw(s, view);
        const sx = (renderer.width / 2 - 145) * devicePixelRatio, sy = (renderer.height / 2 - 70) * devicePixelRatio;
        ctx.drawImage(renderer.canvas, sx, sy, 360 * devicePixelRatio, 220 * devicePixelRatio, turn % 4 * 360, Math.floor(turn / 4) * 320, 360, 220);
        ctx.fillStyle = '#dbe4de'; ctx.font = '12px monospace'; ctx.fillText(`${Math.round(turn * 30 + 9.74)}° ${turn % 2 ? 'moving' : 'idle'}`, turn % 4 * 360 + 8, Math.floor(turn / 4) * 320 + 238);
      }
      return c.toDataURL('image/png').split(',')[1];
    });
    await writeFile(`${output}/${race}-battlefield-turns.png`, Buffer.from(film, 'base64'));
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/measurements.json`, JSON.stringify(checks, null, 2));
  console.log(`Race art checks passed: both complete rosters/factions, native/minimum desktop/mobile, continuous-heading battlefield film, idle locomotion, fog-safe walls/research. Review ${output}`);
} finally { await browser.close(); }
