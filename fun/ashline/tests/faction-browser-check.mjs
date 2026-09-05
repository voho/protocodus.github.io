// Browser QA: ASHLINE_PLAYWRIGHT, ASHLINE_URL, and optional ASHLINE_SCREENSHOTS.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-faction-qa';
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, hasTouch: true}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:8131/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  const sprites = await page.evaluate(async () => {
    const {UNITS, BUILDINGS} = await import('./sim.js'), {drawSprite, drawSpriteShadow} = await import('./assets.js');
    const profiles = {
      units: [...Object.keys(UNITS).map(type => ({type})), ...['rifle', 'rocket'].map(type => ({type, label: 'walking', moving: true})), ...[100, 200].map(cargo => ({type: 'harvester', label: `${cargo} cargo`, cargo})), {type: 'harvester', label: 'unloading', cargo: 200, unload: .6, unloadDepotId: 1}],
      buildings: [...Object.keys(BUILDINGS).map(type => ({type})), ...[['barracks', 'rocket'], ['factory', 'tank'], ['refinery', 'harvester']].map(([type, job]) => ({type, label: 'training', queue: [{type: job, progress: .5}]})), ...[100, 200].map(processingAmount => ({type: 'refinery', label: `${processingAmount} ore`, processingAmount}))],
    };
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192; const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const sample = (e, shadow = false) => { ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 102); ctx.scale(UNITS[e.type] ? 2 : 1, UNITS[e.type] ? 2 : 1); (shadow ? drawSpriteShadow : drawSprite)(ctx, e, .2); ctx.restore(); return ctx.getImageData(0, 0, 192, 192).data; };
    const sourcePixels = e => {
      let source; drawSprite({save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage(image) {source = image;}}, e, .2);
      return source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    };
    const sheets = {}, rows = [];
    for (const [name, list] of Object.entries(profiles)) {
      const sheet = document.createElement('canvas'); sheet.width = 760; sheet.height = list.length * 116 + 55; const c = sheet.getContext('2d');
      c.fillStyle = '#252d2d'; c.fillRect(0, 0, sheet.width, sheet.height); c.font = '14px sans-serif'; c.fillStyle = '#dbe4de'; c.fillText('EXPEDITION / IVORY + COBALT', 150, 25); c.fillText('RED FOUNDRY / CRIMSON', 367, 25); c.fillText('MINIMUM ZOOM', 581, 25);
      list.forEach((profile, index) => {
        const d = UNITS[profile.type] || BUILDINGS[profile.type], e = {id: 0, kind: UNITS[profile.type] ? 'unit' : 'building', hp: d.hp, maxHp: d.hp, size: d.size, progress: 1, angle: .35, cargo: 0, queue: [], processingAmount: 0, ...profile};
        const a = sample({...e, team: 0}), b = sample({...e, team: 1}), sa = sample({...e, team: 0}, true), sb = sample({...e, team: 1}, true);
        let opaque = 0, changed = 0, gap = 0, alpha = 0, mint = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i + 3] !== b[i + 3]) alpha++;
          if (a[i + 3] < 220) continue; opaque++;
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 45) changed++;
          gap += .2126 * (a[i] - b[i]) + .7152 * (a[i + 1] - b[i + 1]) + .0722 * (a[i + 2] - b[i + 2]);
        }
        // Inspect prepared cargo pixels before rotation/downsampling blends armor into edges.
        if (e.type === 'harvester' && e.cargo > 0 || e.type === 'refinery' && e.processingAmount > 0) {
          const sourceA = sourcePixels({...e, team: 0}), sourceB = sourcePixels({...e, team: 1});
          for (let i = 0; i < sourceA.length; i += 4) if (sourceA[i + 3] > 220 && sourceA[i + 1] - sourceA[i] > 18 && sourceA[i + 1] >= sourceA[i + 2] * .98 && [0, 1, 2].some(channel => Math.abs(sourceA[i + channel] - sourceB[i + channel]) > 1)) mint++;
        }
        rows.push({type: e.type, state: profile.label || 'idle', coverage: changed / opaque, luminanceGap: gap / opaque, alpha, shadow: sa.some((value, i) => value !== sb[i]), mint});
        const y = 100 + index * 116; c.fillStyle = '#dbe4de'; c.font = '13px sans-serif'; c.fillText(e.type, 12, y - 10); c.fillStyle = '#97acb1'; c.fillText(profile.label || 'idle', 12, y + 9);
        for (const [team, x, scale] of [[0, 235, UNITS[e.type] ? 2 : .95], [1, 445, UNITS[e.type] ? 2 : .95], [0, 617, .5], [1, 695, .5]]) {
          c.save(); c.translate(x, y); c.scale(scale, scale); drawSpriteShadow(c, {...e, team}, .2); drawSprite(c, {...e, team}, .2); c.restore();
        }
      });
      sheets[name] = sheet.toDataURL('image/png').split(',')[1];
      const gray = document.createElement('canvas'); gray.width = sheet.width; gray.height = sheet.height;
      const g = gray.getContext('2d'); g.filter = 'grayscale(1)'; g.drawImage(sheet, 0, 0); sheets[`${name}-grayscale`] = gray.toDataURL('image/png').split(',')[1];
    }
    return {rows, sheets};
  });
  for (const [name, bytes] of Object.entries(sprites.sheets)) await writeFile(`${output}/${name}.png`, Buffer.from(bytes, 'base64'));
  console.table(sprites.rows.map(({type, state, coverage, luminanceGap, mint}) => ({type, state, changed: `${Math.round(coverage * 100)}%`, valueGap: luminanceGap.toFixed(1), mint})));
  for (const row of sprites.rows) {
    assert(row.coverage > .15 && row.luminanceGap > 6, `${row.type}/${row.state}: broad faction paint and grayscale value separation`);
    assert.equal(row.alpha, 0); assert.equal(row.shadow, false, 'Faction colors preserve silhouette, anchor and shadow');
    assert.equal(row.mint, 0, 'Minerals retain their shared mint color');
  }

  await page.locator('#seed').fill('FACTIONS-BROWSER'); await page.locator('#deploy').click();
  if (await page.locator('#command-console').isVisible()) await page.locator('#command-toggle').click();
  await page.evaluate(() => { window.factionFixture = {raf: requestAnimationFrame}; requestAnimationFrame = frame => { factionFixture.frame = frame; return 0; }; });
  await page.waitForFunction(() => Boolean(factionFixture.frame));
  const scene = await page.evaluate(async () => {
    const {UNITS, unitStats} = await import('./sim.js'), {state: s, renderer: r, view: v} = ashline;
    const rifle = s.entities.find(e => e.type === 'rifle'), hauler = s.entities.find(e => e.type === 'harvester'), refinery = s.entities.find(e => e.type === 'refinery');
    s.entities = s.entities.filter(e => e.kind === 'building' && ['core', 'reactor'].includes(e.type)); s.effects = []; s.time = 3;
    for (let y = 66; y < 85; y++) for (let x = 84; x < 109; x++) { s.terrain[y * s.width + x] = 0; s.minerals[y * s.width + x] = 0; }
    for (let y = 73; y < 77; y++) for (let x = 104; x < 107; x++) s.minerals[y * s.width + x] = 1400;
    for (const team of [0, 1]) {
      s.entities.push({...structuredClone(refinery), id: s.nextId++, team, x: 88 + team * 9, y: 68, queue: [{type: 'harvester', progress: .55}], processingAmount: 100, processingTotal: 200});
      Object.keys(UNITS).forEach((type, i) => {
        const e = {...structuredClone(type === 'harvester' ? hauler : rifle), id: s.nextId++, team, type, x: 89 + i % 3 * 4 + team * 1.4, y: 75 + Math.floor(i / 3) * 4, size: UNITS[type].size, kills: (i % 4) * 5, angle: i * .4, order: {type: 'idle'}, path: [], targetId: null, cargo: 150};
        e.hp = e.maxHp = unitStats(e).hp; s.entities.push(e);
      });
    }
    s.visible[0].fill(1); s.explored[0].fill(1); r.createTerrain(s); v.selected.clear();
    window.factionScene = zoom => { r.resize(); Object.assign(v, {x: 94, y: 75.5, zoom}); r.lastMinimap = -Infinity; r.draw(s, v); };
    factionScene(38);
    const frame = () => { r.draw(s, v); r.drawMinimap(s, v, () => false); return {world: r.ctx.getImageData(0, 0, r.canvas.width, r.canvas.height).data, map: r.minimap.getContext('2d').getImageData(0, 0, r.minimap.width, r.minimap.height).data}; };
    const all = s.entities; s.visible[0].fill(0); s.explored[0].fill(0); r.rememberedBuildings.clear();
    const hidden = frame(); s.entities = all.filter(e => e.team === 0); const absent = frame(); s.entities = all;
    const difference = (a, b) => a.reduce((n, value, i) => n + (value !== b[i] ? 1 : 0), 0);
    s.visible[0].fill(1); s.explored[0].fill(1);
    return {hiddenWorld: difference(hidden.world, absent.world), hiddenMap: difference(hidden.map, absent.map), tank: s.entities.find(e => e.team === 0 && e.type === 'tank').id};
  });
  assert.equal(scene.hiddenWorld, 0); assert.equal(scene.hiddenMap, 0, 'Faction paint and shape indicators cannot reveal concealed enemies');
  for (const [name, viewport, normal] of [['desktop', {width: 1440, height: 900}, 38], ['mobile', {width: 390, height: 844}, 24]]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(resolve => factionFixture.raf.call(window, () => factionFixture.raf.call(window, resolve))));
    for (const zoom of [normal, 16]) {
      await page.evaluate(zoom => factionScene(zoom), zoom);
      const p = await page.evaluate(id => { const e = ashline.state.entities.find(e => e.id === id); return ashline.renderer.worldToScreen(e.x, e.y, ashline.view); }, scene.tank);
      if (name === 'mobile') await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      assert(await page.evaluate(id => ashline.view.selected.has(id), scene.tank), 'Friendly units remain identifiable/selectable in a mixed army');
      await page.evaluate(zoom => factionScene(zoom), zoom); await page.screenshot({path: `${output}/mixed-${name}-${zoom}.png`});
      await page.locator('#world').evaluate(e => { e.style.filter = 'grayscale(1)'; });
      await page.screenshot({path: `${output}/mixed-${name}-${zoom}-grayscale.png`});
      await page.locator('#world').evaluate(e => { e.style.filter = ''; });
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Faction checks passed: all13types and operational variants, broad paint/value difference, unchanged alpha/shadows/mint, hidden-enemy fog, mixed-army mouse/touch and desktop/mobile grayscale previews. Review: ${output}`);
} finally { await browser.close(); }
