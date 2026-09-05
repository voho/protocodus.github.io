// Optional browser QA. Uses the same ASHLINE_PLAYWRIGHT / ASHLINE_URL settings as browser-check.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-qa';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  const checks = await page.evaluate(async () => {
    const { BUILDINGS, createGame, setRallyPoint } = await import('./sim.js');
    const { drawSprite, terrainImages } = await import('./assets.js');
    const renderer = ashline.renderer;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = (e, time, power = 1) => {
      ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 104);
      renderer.drawEntityActivity(ctx, e, time, power); ctx.restore();
      return [...ctx.getImageData(0, 0, 192, 192).data];
    };
    const results = [];
    const producedUnit = { factory: 'tank', barracks: 'rifle', refinery: 'harvester' };
    for (const team of [0, 1]) for (const [type, d] of Object.entries(BUILDINGS)) {
      const e = { id: 3, kind: 'building', type, team, size: d.size, hp: d.hp, maxHp: d.hp, progress: 1, angle: .7, queue: producedUnit[type] ? [{ type: producedUnit[type], progress: .9 }] : [], processingAmount: type === 'refinery' ? 120 : 0, processingTotal: type === 'refinery' ? 200 : 0, lastShot: 1.1 };
      const first = pixels(e, 1.2), later = pixels(e, 3.7), repeated = pixels(e, 1.2), lowPower = pixels(e, 1.2, .3);
      results.push({ type, team, nonempty: first.some((v, i) => i % 4 === 3 && v > 0), changed: first.some((v, i) => v !== later[i]), frozen: first.every((v, i) => v === repeated[i]),
        powerResponds: ['core', 'reactor'].includes(type) || first.some((v, i) => v !== lowPower[i]),
        idleActivity: pixels({ ...e, queue: [], processingAmount: 0, processingTotal: 0 }, 1.2).some(Boolean),
        queueOnlyProcessingActivity: type === 'refinery' && pixels({ ...e, processingAmount: 0, processingTotal: 0 }, 1.2).some((v, i) => i % 4 === 3 && Math.floor(i / 4 / 192) < 105 && v > 0),
        unfinished: pixels({ ...e, progress: .8 }, 1.2).some(Boolean), dead: pixels({ ...e, hp: 0 }, 1.2).some(Boolean) });
    }
    const s = createGame('animation-visibility'); s.time = 4;
    const refinery = s.entities.find(e => e.team === 0 && e.type === 'refinery');
    setRallyPoint(s, 0, [refinery.id], { x: 22, y: 35 });
    const view = { ...ashline.view, x: 16, y: 36, zoom: 32, selected: new Set([refinery.id]), placement: null, drag: null, commandMarker: null };
    const activityIds = [], original = renderer.drawEntityActivity;
    renderer.drawEntityActivity = function (ctx, e, ...args) { activityIds.push(e.id); return original.call(this, ctx, e, ...args); };
    renderer.draw(s, view); renderer.drawEntityActivity = original;
    const noHiddenAnimations = activityIds.every(id => s.entities.find(e => e.id === id).team === 0);
    const rally = renderer.worldToScreen(22, 35, view), world = renderer.ctx;
    const sample = () => [...world.getImageData((rally.x - 12) * renderer.dpr, (rally.y - 18) * renderer.dpr, 28 * renderer.dpr, 26 * renderer.dpr).data];
    const marked = sample(); delete refinery.rally; renderer.draw(s, view); const unmarked = sample();
    const rallyVisible = marked.some((v, i) => v !== unmarked[i]);
    const enemy = s.entities.find(e => e.team === 1 && e.type === 'refinery'); view.selected = new Set([enemy.id]);
    renderer.draw(s, view); const beforeEnemy = sample(); enemy.rally = { x: 22, y: 35 }; renderer.draw(s, view);
    const afterEnemy = sample(), enemyRallyHidden = beforeEnemy.every((v, i) => v === afterEnemy[i]);

    // Contact sheet shows machinery at gameplay scale over the real ground texture.
    const sheet = document.createElement('canvas'); sheet.id = 'building-sheet'; sheet.width = 1440; sheet.height = 720;
    sheet.style.cssText = 'position:fixed;inset:0;z-index:99999;width:1440px;height:720px'; document.body.append(sheet);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const c = sheet.getContext('2d'); c.fillStyle = '#142027'; c.fillRect(0, 0, 1440, 720);
    for (const team of [0, 1]) Object.entries(BUILDINGS).forEach(([type, d], i) => {
      const column = 1440 / Object.keys(BUILDINGS).length, x = i * column, y = team * 360;
      c.save(); c.beginPath(); c.rect(x + 10, y + 36, column - 20, 285); c.clip();
      c.drawImage(terrainImages.ground, x + 10, y + 36, column - 20, 285);
      c.fillStyle = '#1b242940'; c.fillRect(x + 10, y + 36, column - 20, 285);
      const e = { id: i + 1, kind: 'building', type, team, size: d.size, hp: d.hp, maxHp: d.hp, progress: 1, angle: .7, queue: producedUnit[type] ? [{ type: producedUnit[type], progress: .9 }] : [], processingAmount: type === 'refinery' ? 120 : 0, processingTotal: type === 'refinery' ? 200 : 0, lastShot: 1.1 };
      for (const [row, scale] of [[0, 1], [1, .56]]) {
        c.save(); c.translate(x + column / 2, y + 125 + row * 123); c.scale(scale, scale);
        drawSprite(c, e, 1.2); renderer.drawEntityActivity(c, e, 1.2); c.restore();
      }
      c.restore(); c.fillStyle = '#dbe4de'; c.font = '16px monospace'; c.textAlign = 'center';
      c.fillText(`${team ? 'HOSTILE' : 'FRIENDLY'} · ${type}`, x + column / 2, y + 25, column - 12);
      c.fillStyle = '#97acb1'; c.font = '12px monospace'; c.fillText('32px / 18px tile scale', x + column / 2, y + 343);
    });
    return { results, noHiddenAnimations, rallyVisible, enemyRallyHidden };
  });
  for (const result of checks.results) {
    assert(result.nonempty && result.changed && result.frozen, `${result.type}, faction ${result.team}: visible animation follows simulation time`);
    assert(result.powerResponds, `${result.type}: activity dims or slows with insufficient power`);
    assert.equal(result.idleActivity, ['core', 'reactor', 'turret', 'rocketTower'].includes(result.type), `${result.type}: only appropriate machinery runs while idle`);
    assert.equal(result.queueOnlyProcessingActivity, false, 'A queued hauler does not start the mineral belt or exhaust');
    assert.equal(result.unfinished, false); assert.equal(result.dead, false);
  }
  assert(checks.noHiddenAnimations, 'Concealed enemies cannot expose live machinery activity');
  assert(checks.rallyVisible, 'Friendly selected producer has a visible ground rally flag');
  assert(checks.enemyRallyHidden, 'Enemy rally plans are never rendered');
  await page.locator('#building-sheet').screenshot({ path: `${output}/building-activities.png` });
  assert.deepEqual(errors, []);
  console.log(`Building animation checks passed: all structures and both factions, pause, construction, destruction, fog, and rally visibility. Contact sheet: ${output}/building-activities.png`);
} finally { await browser.close(); }
