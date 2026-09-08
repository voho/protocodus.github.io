// New art/material/visibility contracts; run with the browser-check.mjs environment overrides.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-expansion-qa';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.ASHLINE_URL || 'http://127.0.0.1:4173/fun/ashline/');
  await page.waitForFunction(() => window.ashline?.assets.ready);
  await page.locator('#deploy').click();
  const result = await page.evaluate(async () => {
    const { drawSprite, drawProp, spriteStats, spriteNativeZoom } = await import('./assets.js');
    const { UNITS, BUILDINGS, createGame } = await import('./sim.js');
    const { Renderer } = await import('./render.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sample = (draw) => { ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 96); draw(ctx); ctx.restore(); return ctx.getImageData(0, 0, 192, 192).data; };
    const difference = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
    const sameAlpha = (a, b) => a.every((v, i) => i % 4 !== 3 || v === b[i]);
    const ore = [1, 2, 3].map(type => sample(ctx => drawProp(ctx, 'ore', 0, 0, 75, 2, type)));
    const colors = ore.map(data => {
      const sum = [0, 0, 0]; let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 220 && Math.max(data[i], data[i + 1], data[i + 2]) > 90) { n++; for (let c = 0; c < 3; c++) sum[c] += data[i + c]; }
      return sum.map(v => v / n);
    });
    const cargo = {};
    for (const type of ['harvester', 'refinery', 'unityHarvester', 'unityRefinery']) {
      const images = [1, 2, 3].map(mineralType => sample(ctx => drawSprite(ctx, { type, team: 0, cargo: 200, cargoType: mineralType,
        processingAmount: 200, processingType: mineralType, progress: 1, size: BUILDINGS[type]?.size }, 0)));
      cargo[type] = { blueChanges: difference(images[0], images[1]), redChanges: difference(images[0], images[2]), sameAlpha: sameAlpha(images[0], images[1]) && sameAlpha(images[0], images[2]) };
    }
    const lamps = Object.keys(BUILDINGS).filter(t => BUILDINGS[t].power < 0).map(type => {
      const render = powerRatio => sample(ctx => drawSprite(ctx, { type, team: 0, progress: 1, size: BUILDINGS[type].size, powerRatio, queue: [{ type: 'tank', progress: .5 }] }, 0));
      const powered = render(1), brownout = render(.35);
      return { type, changed: difference(powered, brownout), sameAlpha: sameAlpha(powered, brownout) };
    });
    let largestSampling = 0;
    const nativeZoom = spriteNativeZoom(2);
    for (const type of [...Object.keys(UNITS), ...Object.keys(BUILDINGS)]) {
      drawSprite({ save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage(source, x, y, w) {
        largestSampling = Math.max(largestSampling, w * nativeZoom / 32 * 2 / source.width);
      } }, { type, team: 0 }, 0);
    }
    const s = createGame('expansion-visual-qa', 'normal', { width: 224, height: 168 });
    s.entities = []; s.effects = []; s.terrain.fill(0); s.minerals.fill(0); s.mineralTypes.fill(0); s.time = 5;
    s.visible[0].fill(1); s.explored[0].fill(1);
    const world = document.createElement('canvas'); world.style.cssText = 'width:1200px;height:820px'; document.body.append(world);
    const renderer = new Renderer(world, null), view = { x: 41, y: 41, zoom: nativeZoom, selected: new Set() };
    renderer.createTerrain(s);
    const cacheBytes = (renderer.terrain.width * renderer.terrain.height + renderer.decals.width * renderer.decals.height) * 4;
    const make = (type, team, x, y, extra = {}) => { const d = UNITS[type] || BUILDINGS[type]; return { id: s.nextId++, type, team,
      kind: UNITS[type] ? 'unit' : 'building', x, y, hp: d.hp, maxHp: d.hp, size: d.size, progress: 1, queue: [], path: [], order: { type: 'idle' }, ...extra }; };
    const lab = make('lab', 1, 39, 38, { research: { id: 'fieldEngineering', progress: .45 } });
    const cap = make('capacitor', 1, 43, 38, { reserve: 600 });
    s.entities = [lab, cap]; renderer.draw(s, view);
    s.visible[0].fill(0); renderer.draw(s, view);
    const remembered = renderer.ctx.getImageData(0, 0, world.width, world.height).data;
    lab.research.progress = .99; cap.reserve = 0; renderer.draw(s, view);
    const hidden = renderer.ctx.getImageData(0, 0, world.width, world.height).data;
    const memorySafe = !difference(remembered, hidden);
    s.visible[0].fill(1); lab.research.progress = .45; cap.reserve = 600;
    s.entities = [];
    for (const team of [0, 1]) {
      const x = 34 + team * 9;
      s.entities.push(make('core', team, x - 4, 38), make('reactor', team, x - 4, 42));
      s.entities.push(make('lab', team, x, 37, { research: { id: 'fieldEngineering', progress: .6 } }), make('capacitor', team, x + 3, 37, { reserve: 900 }));
      const target = make('striker', team, x + 3, 43, { angle: .5 + team * 2, hp: 120 });
      const engineer = make('engineer', team, x, 42.5, { angle: -.18, repairActive: true, repairTargetId: target.id });
      s.entities.push(target, engineer, make('tank', team, x, 45.5, { angle: .63 }), make('harvester', team, x + 3, 46, { cargo: 200, cargoType: team ? 3 : 2, angle: .5 }));
      for (const u of s.entities.filter(u => u.team === team && u.type === 'tank')) { u.order = { type: 'move', x: u.x + 2, y: u.y + 3 }; view.selected.add(u.id); }
    }
    for (let type = 1; type <= 3; type++) for (let j = 0; j < 4; j++) { const i = (33 + j % 2) * s.width + 36 + type * 3 + Math.floor(j / 2); s.minerals[i] = type === 3 ? 2000 : 1000; s.mineralTypes[i] = type; }
    for (const team of [0, 1]) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) s.terrain[(40 + dy) * s.width + 36 + team * 9 + dx] = 1;
    renderer.terrainSource = null; renderer.draw(s, view);
    window.expansionVisualQA = { s, renderer, view, world };
    world.style.cssText = 'position:fixed;inset:0;z-index:20000;width:100vw;height:100vh;display:block';
    return { stats: spriteStats(), colors, mineralAlpha: sameAlpha(ore[0], ore[1]) && sameAlpha(ore[0], ore[2]), cargo, lamps, largestSampling, nativeZoom, cacheBytes, memorySafe };
  });
  assert.deepEqual(result.stats.errors, []);
  for (const type of ['engineer', 'striker', 'lab', 'capacitor']) assert(result.stats.frames[type] > 0);
  assert(result.mineralAlpha, 'Mineral color variants preserve their crystal silhouettes');
  assert(result.colors[0][1] > result.colors[0][0] && result.colors[1][2] > result.colors[1][0] + 30 && result.colors[2][0] > result.colors[2][1] + 30, 'Mint, blue and red crystals have distinct visible materials');
  for (const v of Object.values(result.cargo)) assert(v.blueChanges > 50 && v.redChanges > 50 && v.sameAlpha, 'Cargo colors change while the vehicle/building silhouette stays fixed');
  for (const row of result.lamps) assert(row.changed > 0 && row.sameAlpha, `${row.type}: brownout lamps dim without erasing faction armor`);
  assert(result.nativeZoom > 16 && result.largestSampling <= 1.00001, 'Maximum zoom never enlarges a prepared source texture');
  assert(result.cacheBytes < 65 * 1024 * 1024, 'The largest map keeps terrain/decal caches within the memory budget');
  assert(result.memorySafe, 'Hidden research and battery changes cannot update remembered silhouettes');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Battlefield QA must not be hidden by a dialog in the top layer');
  for (const [width, height] of [[1440, 960], [390, 844]]) for (const factor of [1, .5]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ zoom, width }) => { const { renderer, view, s } = expansionVisualQA; renderer.resize(); Object.assign(view, { zoom, x: width < 500 ? 38.8 : 39.5, y: 40 }); renderer.draw(s, view); }, { zoom: result.nativeZoom * factor, width });
    await page.screenshot({ path: `${output}/expansion-${width}-${factor}.png` });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/measurements.json`, JSON.stringify(result, null, 2));
  console.log(`Expansion visual checks passed: new sprites, mineral/cargo colors, brownout lamps, native zoom, large-map memory, frozen enemy research/charge. Review ${output}`);
} finally { await browser.close(); }
