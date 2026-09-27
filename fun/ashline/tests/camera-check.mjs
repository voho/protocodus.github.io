// Run alongside browser-check.mjs with the same ASHLINE_URL / ASHLINE_PLAYWRIGHT overrides.
// Pixel invariants catch heading-dependent scale, clipping and incorrect facing selection;
// the contact sheets and battlefield captures require visual review of the art itself.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-camera-qa';
await mkdir(output, { recursive: true });
const url = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForFunction(() => window.ashline?.booted); await page.evaluate(async () => (await import('./assets.js')).startAssets());
  // Cropping can conceal a barrel crossing into the next atlas cell. Check the source too.
  const clearCellBorders = await page.evaluate(async () => {
    const { removeMatte } = await import('./assets.js');
    for (const [name, columns, rows] of [['units-hires', 3, 2], ['organics-alien-rocket', 2, 1], ['organics-buildings', 3, 3], ['organics-vehicles', 3, 2], ['constructors', 2, 1], ['unity-light', 3, 2], ['unity-heavy', 2, 2], ['unity-buildings', 3, 3]]) {
      const image = new Image(); image.src = `./assets/generated/${name}.webp`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const cellWidth = image.width / columns, cellHeight = image.height / rows;
      for (let cell = 0; cell < columns * rows; cell++) {
        // Use the real per-cell decoder; a single global key misses local matte gradients.
        const pixels = ctx.getImageData(cell % columns * cellWidth, Math.floor(cell / columns) * cellHeight, cellWidth, cellHeight);
        removeMatte(pixels);
        for (let y = 0; y < cellHeight; y++) for (let x = 0; x < cellWidth; x++) {
          if (x >= 16 && x < cellWidth - 16 && y >= 16 && y < cellHeight - 16) continue;
          if (pixels.data[(y * cellWidth + x) * 4 + 3] > 32) throw Error(`${name} cell ${cell}: sprite crosses source safety border`);
        }
      }
    }
    return true;
  });
  assert(clearCellBorders, 'Every source sprite has clear cell borders, without clipping or neighbouring fragments');
  const report = await page.evaluate(async () => {
    const { drawSprite, drawSpriteShadow, UNIT_DIRECTIONS, unitSpriteAngle, spriteStats } = await import('./assets.js');
    const { UNITS, BUILDINGS, unitRole } = await import('./sim.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Test actual prepared images and draw state, including portraits/production callers.
    const nativeDraw = ctx.drawImage;
    const unitPixels = { rifle: 64, rocket: 80, scout: 96, tank: 112, artillery: 128, harvester: 112, engineer: 112, striker: 128, constructor: 128 };
    const step = Math.PI * 2 / UNIT_DIRECTIONS;
    if (UNIT_DIRECTIONS < 8) throw Error('Every unit needs at least eight prepared facings');
    for (const type of Object.keys(UNITS)) if (spriteStats().directions[type] !== UNIT_DIRECTIONS) throw Error(`${type}: missing prepared directions`);
    const pixels = Object.fromEntries([...Object.keys(UNITS).map(type => [type, unitPixels[unitRole(type)]]), ...Object.entries(BUILDINGS).map(([type, d]) => [type, d.size * 64 + 16])]);
    for (const [type, size] of Object.entries(pixels)) for (const team of [0, 1]) for (const moving of [false, true]) {
      let draws = 0;
      ctx.drawImage = function (source, ...args) {
        draws++;
        if (BUILDINGS[type] && (source.width !== size || source.height !== size)) throw Error(`${type}: expected ${size}px prepared sprite, got ${source.width}×${source.height}`);
        // Directional frames may crop transparent margins but must remain small prepared art.
        if (UNITS[type] && (!(source.width > 0 && source.height > 0) || source.width > size * 2 || source.height > size * 2)) throw Error(`${type}: invalid prepared directional size ${source.width}×${source.height}`);
        if (!this.imageSmoothingEnabled || this.imageSmoothingQuality !== 'high') throw Error(`${type}: high-resolution art needs smooth high-quality sampling`);
        return nativeDraw.call(this, source, ...args);
      };
      ctx.imageSmoothingEnabled = false; ctx.imageSmoothingQuality = 'low'; ctx.filter = 'brightness(2)';
      drawSprite(ctx, {type, team, moving, id: 0}, .2);
      if (draws !== 1 || ctx.imageSmoothingEnabled || ctx.imageSmoothingQuality !== 'low' || ctx.filter !== 'brightness(2)') throw Error(`${type}: drawing must preserve the caller's sampling and highlight state`);
      ctx.filter = 'none';
    }
    ctx.drawImage = nativeDraw;
    // Capture renderer inputs rather than cache internals. Repeated headings must reuse
    // one image, and ground shadows must follow the same closest facing as the body.
    const checkedBorders = new Set();
    function drawnSource(entity, shadow = false) {
      const sources = [], nativeRotate = ctx.rotate;
      ctx.drawImage = function (source) { sources.push(source); };
      ctx.rotate = () => { throw Error(`${entity.type}: prepared directions must not rotate at draw time`); };
      const rendered = { hp: 100, ...entity };
      try { (shadow ? drawSpriteShadow : drawSprite)(ctx, rendered, .25); }
      finally { ctx.drawImage = nativeDraw; ctx.rotate = nativeRotate; }
      if (rendered.angle !== entity.angle) throw Error(`${entity.type}: rendering must preserve continuous simulation headings`);
      if (sources.length !== 1) throw Error(`${entity.type}: expected one prepared ${shadow ? 'shadow' : 'body'} draw`);
      const source = sources[0];
      if (!checkedBorders.has(source)) {
        const pixels = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
        for (let x = 0; x < source.width; x++) if (pixels[x * 4 + 3] || pixels[((source.height - 1) * source.width + x) * 4 + 3]) throw Error(`${entity.type}: clipped directional top/bottom border`);
        for (let y = 0; y < source.height; y++) if (pixels[y * source.width * 4 + 3] || pixels[(y * source.width + source.width - 1) * 4 + 3]) throw Error(`${entity.type}: clipped directional side border`);
        checkedBorders.add(source);
      }
      return source;
    }
    for (const type of Object.keys(UNITS)) for (const team of [0, 1]) for (const moving of [false, true]) for (const shadow of [false, true]) {
      const entity = { type, team, moving, id: 0 }, sources = [];
      for (let direction = 0; direction < UNIT_DIRECTIONS; direction++) {
        const angle = direction * step, source = drawnSource({ ...entity, angle }, shadow);
        sources.push(source);
        for (const offset of [-.49, 0, .49]) for (const turns of [-2, 0, 2]) {
          const requested = angle + offset * step + turns * Math.PI * 2;
          if (drawnSource({ ...entity, angle: requested }, shadow) !== source) throw Error(`${type}: closest facing or cache reuse failed at ${requested}`);
          if (Math.abs(unitSpriteAngle(requested) - angle) > 1e-9) throw Error(`${type}: facing selection failed at ${requested}`);
        }
        const next = drawnSource({ ...entity, angle: angle + step * .51 }, shadow);
        if (next === source) throw Error(`${type}: crossing a half-step boundary must change facing`);
      }
      if (new Set(sources).size !== UNIT_DIRECTIONS) throw Error(`${type}: every direction needs a distinct prepared image`);
      for (let direction = 0; direction < UNIT_DIRECTIONS; direction++) {
        if (drawnSource({ ...entity, angle: direction * step }, shadow) !== sources[direction]) throw Error(`${type}: revisiting a direction must reuse its cached image`);
      }
    }
    function sample(type, team, moving, angle) {
      ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 96); ctx.scale(2, 2);
      drawSprite(ctx, { type, team, moving, angle, id: 0 }, .25); ctx.restore();
      const data = ctx.getImageData(0, 0, 192, 192).data;
      let area = 0, edge = 0, matte = 0, mx = 0, my = 0;
      const alpha = new Float32Array(192 * 192);
      for (let p = 0; p < alpha.length; p++) {
        const i = p * 4, a = data[i + 3] / 255; alpha[p] = a; area += a;
        mx += (p % 192) * a; my += Math.floor(p / 192) * a;
        if (a > .1 && (p % 192 < 2 || p % 192 > 189 || p < 384 || p >= 192 * 190)) edge++;
        if (a > .25 && data[i] > 100 && data[i + 2] > 100 && Math.min(data[i], data[i + 2]) - data[i + 1] > 65) matte++;
      }
      return { area, alpha, edge, matte, x: mx / area / 2, y: my / area / 2 };
    }
    const difference = (a, b) => a.alpha.reduce((sum, value, i) => sum + Math.abs(value - b.alpha[i]), 0) / a.area;
    const rows = [];
    for (const type of Object.keys(UNITS)) for (const team of [0, 1]) for (const moving of [false, true]) {
      const samples = Array.from({ length: 32 }, (_, n) => sample(type, team, moving, n * Math.PI / 16));
      let sameBin = 0, poseDrift = 0, boundaryChange = Infinity;
      for (let n = 0; n < UNIT_DIRECTIONS; n++) {
        const angle = n * step;
        sameBin = Math.max(sameBin, difference(sample(type, team, moving, angle - .49 * step), sample(type, team, moving, angle + .49 * step)));
        boundaryChange = Math.min(boundaryChange, difference(sample(type, team, moving, angle + .49 * step), sample(type, team, moving, angle + .51 * step)));
        const idle = sample(type, team, false, angle), walk = sample(type, team, true, angle);
        poseDrift = Math.max(poseDrift, Math.hypot(idle.x - walk.x, idle.y - walk.y));
      }
      rows.push({ type, team, moving, minArea: Math.min(...samples.map(s => s.area)),
        areaRatio: Math.max(...samples.map(s => s.area)) / Math.min(...samples.map(s => s.area)),
        edge: samples.reduce((n, s) => n + s.edge, 0), matte: samples.reduce((n, s) => n + s.matte, 0),
        sameBin, boundaryChange, poseDrift, fullTurn: difference(samples[0], sample(type, team, moving, Math.PI * 2)) });
    }
    return rows;
  });
  for (const row of report) {
    const label = `${row.type}, faction ${row.team}, ${row.moving ? 'moving' : 'idle'}`;
    assert(row.minArea > 60, `${label}: nonempty silhouette`);
    assert(row.areaRatio < 1.3, `${label}: physical scale remains stable through a full turn (${row.areaRatio.toFixed(3)})`);
    assert.equal(row.sameBin, 0, `${label}: headings within one direction bin share identical pixels`);
    assert(row.boundaryChange > .001, `${label}: crossing a direction boundary changes the visible facing`);
    assert(row.poseDrift < 3, `${label}: walking keeps the body anchored (${row.poseDrift.toFixed(3)}px)`);
    assert.equal(row.edge, 0, `${label}: no clipped sprite extremities`);
    assert.equal(row.matte, 0, `${label}: no chroma-key fringe`);
    assert(row.fullTurn < .005, `${label}: full turn returns to the original view`);
  }
  for (const team of [0, 1]) for (const moving of [false, true]) {
    const area = type => report.find(row => row.type === type && row.team === team && row.moving === moving).minArea;
    assert(area('tank') > area('scout'), 'Heavy tanks retain a larger silhouette than recon rovers');
    assert(area('harvester') > area('scout'), 'Industrial haulers retain a larger silhouette than recon rovers');
  }
  await writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));

  // Show real gameplay pixel sizes at sixteen headings, both factions and animation poses.
  for (const team of [0, 1]) for (const zoom of [38, 16]) {
    const data = await page.evaluate(async ({ team, zoom }) => {
      const { drawSprite, drawProp, terrainImages } = await import('./assets.js');
      const { UNITS } = await import('./sim.js'), types = Object.keys(UNITS);
      const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = types.length * 160 + 60;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111b20'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#dbe4de'; ctx.font = '16px monospace'; ctx.fillText(`Fixed high camera · faction ${team} · zoom ${zoom} · idle / moving pairs`, 16, 24);
      for (let row = 0; row < types.length * 2; row++) for (let heading = 0; heading < 16; heading++) {
        const x = heading * 88 + 16, y = row * 80 + 40;
        if (terrainImages.ground) ctx.drawImage(terrainImages.ground, heading * 31, row * 37, 88, 76, x, y, 84, 76);
        ctx.fillStyle = '#111b2066'; ctx.fillRect(x, y, 84, 76);
        ctx.save(); ctx.translate(x + 42, y + 37); ctx.scale(zoom / 32, zoom / 32);
        if (heading === 3 || heading === 11) drawProp(ctx, heading === 3 ? 'rock' : 'ore', 28, 7, 24, row % 3);
        drawSprite(ctx, { type: types[Math.floor(row / 2)], team, angle: heading * Math.PI / 8, moving: row % 2 === 1, id: 0 }, .25);
        ctx.restore(); ctx.fillStyle = '#dbe4de'; ctx.font = '9px monospace';
        ctx.fillText(`${types[Math.floor(row / 2)]} ${heading * 22.5}°`, x + 3, y + 71);
      }
      const color = canvas.toDataURL('image/png').split(',')[1];
      ctx.filter = 'grayscale(1)'; ctx.drawImage(canvas, 0, 0);
      return { color, grayscale: canvas.toDataURL('image/png').split(',')[1] };
    }, { team, zoom });
    await writeFile(`${output}/headings-team${team}-zoom${zoom}.png`, Buffer.from(data.color, 'base64'));
    await writeFile(`${output}/headings-team${team}-zoom${zoom}-grayscale.png`, Buffer.from(data.grayscale, 'base64'));
  }
  await page.locator('#deploy').click(); await page.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, {timeout: 120000});
  await page.evaluate(async () => {
    const { UNITS } = await import('./sim.js'), s = ashline.state;
    s.entities = s.entities.filter(e => e.kind === 'building');
    for (const team of [0, 1]) for (const [index, type] of Object.keys(UNITS).entries()) {
      const d = UNITS[type];
      s.entities.push({ id: s.nextId++, kind: 'unit', type, team, x: 8 + index * 3.2, y: 29 + team * 3,
        angle: index * .71 + team * Math.PI, hp: d.hp, maxHp: d.hp, size: d.size, progress: 1, order: { type: 'idle' }, path: [] });
    }
    s.visible[0].fill(1); s.explored[0].fill(1); s.status = 'camera-preview';
    ashline.view.x = 15; ashline.view.y = 33; ashline.view.selected.clear();
    document.querySelector('#command-console').hidden = true;
  });
  for (const width of [1440, 390]) for (const zoom of [38, 16]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(async ({ width, zoom }) => {
      const { UNITS } = await import('./sim.js');
      if (width === 390) for (const entity of ashline.state.entities.filter(e => e.kind === 'unit')) {
        entity.x = 13 + entity.team * 4;
        entity.y = 26 + Object.keys(UNITS).indexOf(entity.type) * 2;
      }
      ashline.view.zoom = zoom; ashline.renderer.draw(ashline.state, ashline.view);
    }, { width, zoom });
    await page.screenshot({ path: `${output}/battlefield-${width}-zoom${zoom}.png` });
  }
  assert.deepEqual(errors, [], 'No browser errors');
  console.log(`Camera checks passed: ${report.length * 32} full-turn sprite cases, nearest cached directions, both factions and poses. Review screenshots in ${output}`);
} finally { await browser.close(); }
