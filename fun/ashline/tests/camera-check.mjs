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
  // Inspect whole authored objects, including barrels that slightly cross nominal cells.
  const sourceIntegrity = await page.evaluate(async () => {
    const { removeMatte, spriteStats } = await import('./assets.js');
    const { UNITS, unitRole } = await import('./sim.js'), stats = spriteStats();
    const masterBounds = await (await fetch('./assets/prepared/units/source-bounds.json')).json();
    if (!stats.ready || stats.errors.length) throw Error(`Assets did not load: ${stats.errors.join('; ')}`);
    const sources = [['organics-buildings', 3, 3], ['unity-buildings', 3, 3]].map(([name, columns, rows]) => ({ path: `assets/generated/${name}.webp`, columns, rows }));
    for (const type of Object.keys(UNITS)) {
      const source = stats.directionSources[type], poses = ['rifle', 'rocket'].includes(unitRole(type)) ? 2 : 1;
      if (!source || source.path !== `assets/prepared/units/${type}.webp` || source.sourcePath !== `assets/generated/directions/${type}.webp` || source.columns !== 4 || source.rows !== poses * 2) throw Error(`${type}: missing authored directional atlas`);
      if (source.cells.length !== poses || source.cells.some((cells, pose) => cells.length !== 8 || cells.some((cell, direction) => cell !== pose * 8 + direction))) throw Error(`${type}: directions must use distinct source cells in E, SE, S, SW, W, NW, N, NE order`);
      const sourceBounds = masterBounds[type];
      if (!sourceBounds || sourceBounds.length !== poses || sourceBounds.some(cells => cells.length !== 8)) throw Error(`${type}: missing extracted source bounds`);
      sources.push({ ...source, path: source.sourcePath, sourceBounds });
    }
    function components(pixels) {
      const { data, width, height } = pixels, visited = new Uint8Array(width * height), queue = new Int32Array(width * height), found = [];
      for (let start = 0; start < visited.length; start++) {
        if (visited[start] || data[start * 4 + 3] <= 32) continue;
        let head = 0, count = 1, left = width, right = 0, top = height, bottom = 0, mx = 0, my = 0;
        queue[0] = start; visited[start] = 1;
        while (head < count) {
          const at = queue[head++], x = at % width, y = Math.floor(at / width);
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); mx += x; my += y;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy, next = ny * width + nx;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[next] || data[next * 4 + 3] <= 32) continue;
            queue[count++] = next; visited[next] = 1;
          }
        }
        if (count > 64) found.push({ left, right, top, bottom, count, x: mx / count, y: my / count });
      }
      return found;
    }
    for (const { path, columns, rows, sourceBounds } of sources) {
      const image = new Image(); image.src = `./${path}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const cellWidth = image.width / columns, cellHeight = image.height / rows;
      const border = 2;
      if (sourceBounds) {
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); removeMatte(pixels);
        const groups = Array.from({ length: columns * rows }, () => []);
        for (const part of components(pixels)) groups[Math.floor(part.y / cellHeight) * columns + Math.floor(part.x / cellWidth)].push(part);
        for (let cell = 0; cell < groups.length; cell++) {
          const parts = groups[cell].sort((a, b) => b.count - a.count), main = parts[0], box = sourceBounds[Math.floor(cell / 8)][cell % 8];
          if (!main || main.count < 200 || !box) throw Error(`${path} cell ${cell}: missing complete authored object`);
          if (main.left < border || main.top < border || main.right >= canvas.width - border || main.bottom >= canvas.height - border) throw Error(`${path} cell ${cell}: source object clipped at atlas edge`);
          if (parts[1]?.count > main.count * .08) throw Error(`${path} cell ${cell}: substantial detached object would be lost during extraction`);
          const edges = [box.x - main.left, box.y - main.top, box.x + box.width - main.right - 1, box.y + box.height - main.bottom - 1];
          if (edges.some(delta => Math.abs(delta) > 2)) throw Error(`${path} cell ${cell}: extraction clips the authored object or includes its neighbor (${edges.join(', ')})`);
          if (Math.abs(box.mainPixels - main.count) > main.count * .05) throw Error(`${path} cell ${cell}: extraction changes the authored silhouette mass`);
        }
        continue;
      }
      for (let cell = 0; cell < columns * rows; cell++) {
        // Use the real per-cell decoder; a single global key misses local matte gradients.
        const pixels = ctx.getImageData(cell % columns * cellWidth, Math.floor(cell / columns) * cellHeight, cellWidth, cellHeight);
        removeMatte(pixels);
        for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
          if (x >= border && x < pixels.width - border && y >= border && y < pixels.height - border) continue;
          if (pixels.data[(y * pixels.width + x) * 4 + 3] > 32) throw Error(`${path} cell ${cell}: sprite crosses source safety border`);
        }
      }
    }
    return true;
  });
  assert(sourceIntegrity, 'Every authored source object survives extraction, without clipping or neighbouring fragments');
  const report = await page.evaluate(async () => {
    const { drawSprite, drawSpriteShadow, UNIT_DIRECTIONS, unitSpriteAngle, spriteStats } = await import('./assets.js');
    const { UNITS, BUILDINGS, unitRole } = await import('./sim.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Test actual prepared images and draw state, including portraits/production callers.
    const nativeDraw = ctx.drawImage;
    const unitPixels = { rifle: 64, rocket: 80, scout: 96, tank: 112, artillery: 128, harvester: 112, engineer: 112, striker: 128, constructor: 128 };
    const step = Math.PI * 2 / UNIT_DIRECTIONS;
    if (UNIT_DIRECTIONS !== 8) throw Error('Every unit needs eight independently illustrated facings');
    const stats = spriteStats();
    for (const type of Object.keys(UNITS)) if (stats.directions[type] !== UNIT_DIRECTIONS) throw Error(`${type}: missing prepared directions`);
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
      let sameBin = 0, poseDrift = 0, boundaryChange = Infinity, factionDrift = 0;
      for (let n = 0; n < UNIT_DIRECTIONS; n++) {
        const angle = n * step;
        sameBin = Math.max(sameBin, difference(sample(type, team, moving, angle - .49 * step), sample(type, team, moving, angle + .49 * step)));
        boundaryChange = Math.min(boundaryChange, difference(sample(type, team, moving, angle + .49 * step), sample(type, team, moving, angle + .51 * step)));
        const idle = sample(type, team, false, angle), walk = sample(type, team, true, angle);
        poseDrift = Math.max(poseDrift, Math.hypot(idle.x - walk.x, idle.y - walk.y));
        factionDrift = Math.max(factionDrift, difference(sample(type, 0, moving, angle), sample(type, 1, moving, angle)));
      }
      rows.push({ type, team, moving, minArea: Math.min(...samples.map(s => s.area)),
        areaRatio: Math.max(...samples.map(s => s.area)) / Math.min(...samples.map(s => s.area)),
        edge: samples.reduce((n, s) => n + s.edge, 0), matte: samples.reduce((n, s) => n + s.matte, 0),
        sameBin, boundaryChange, poseDrift, factionDrift, fullTurn: difference(samples[0], sample(type, team, moving, Math.PI * 2)) });
    }
    return rows;
  });
  for (const row of report) {
    const label = `${row.type}, faction ${row.team}, ${row.moving ? 'moving' : 'idle'}`;
    assert(row.minArea > 60, `${label}: nonempty silhouette`);
    // Independently illustrated views show changing armor/limbs and foreshortening.
    // Catch major size discontinuities while leaving camera consistency to visual QA.
    assert(row.areaRatio < 2, `${label}: facing changes must not substantially change physical scale (${row.areaRatio.toFixed(3)})`);
    assert.equal(row.sameBin, 0, `${label}: headings within one direction bin share identical pixels`);
    assert(row.boundaryChange > .001, `${label}: crossing a direction boundary changes the visible facing`);
    assert.equal(row.factionDrift, 0, `${label}: faction paint must preserve the exact body silhouette and anchor`);
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

  // Use the same available zoom levels as the live camera, not historical fixed values.
  const zooms = await page.evaluate(async () => {
    const { spriteNativeZoom } = await import('./assets.js');
    const { zoomLevels } = await import('./camera.js'), levels = zoomLevels(spriteNativeZoom(ashline.renderer.dpr));
    return { normal: levels[2], mobileNormal: levels[1], minimum: levels[0] };
  });
  await writeFile(`${output}/zoom-levels.json`, JSON.stringify(zooms, null, 2));
  // Show each authored direction at real gameplay pixel sizes, both factions and poses.
  for (const team of [0, 1]) for (const [zoomName, zoom] of [['normal', zooms.normal], ['minimum', zooms.minimum]]) {
    const data = await page.evaluate(async ({ team, zoom }) => {
      const { drawSprite, drawProp, terrainImages, UNIT_DIRECTIONS } = await import('./assets.js');
      const { UNITS } = await import('./sim.js'), types = Object.keys(UNITS);
      const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = types.length * 160 + 60;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111b20'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#dbe4de'; ctx.font = '16px monospace'; ctx.fillText(`Fixed high camera · faction ${team} · zoom ${zoom.toFixed(2)} · idle / moving pairs`, 16, 24);
      const headings = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
      const pitch = (canvas.width - 32) / UNIT_DIRECTIONS;
      for (let row = 0; row < types.length * 2; row++) for (let heading = 0; heading < UNIT_DIRECTIONS; heading++) {
        const x = heading * pitch + 16, y = row * 80 + 40;
        if (terrainImages.ground) ctx.drawImage(terrainImages.ground, heading * 31, row * 37, pitch, 76, x, y, pitch - 4, 76);
        ctx.fillStyle = '#111b2066'; ctx.fillRect(x, y, pitch - 4, 76);
        ctx.save(); ctx.translate(x + pitch / 2 - 2, y + 37); ctx.scale(zoom / 32, zoom / 32);
        if (heading === 3 || heading === 7) drawProp(ctx, heading === 3 ? 'rock' : 'ore', 28, 7, 24, row % 3);
        drawSprite(ctx, { type: types[Math.floor(row / 2)], team, angle: heading * Math.PI * 2 / UNIT_DIRECTIONS, moving: row % 2 === 1, id: 0 }, .25);
        ctx.restore(); ctx.fillStyle = '#dbe4de'; ctx.font = '9px monospace';
        ctx.fillText(`${types[Math.floor(row / 2)]} ${headings[heading]} ${heading * 360 / UNIT_DIRECTIONS}°`, x + 3, y + 71);
      }
      const color = canvas.toDataURL('image/png').split(',')[1];
      ctx.filter = 'grayscale(1)'; ctx.drawImage(canvas, 0, 0);
      return { color, grayscale: canvas.toDataURL('image/png').split(',')[1] };
    }, { team, zoom });
    await writeFile(`${output}/headings-team${team}-${zoomName}.png`, Buffer.from(data.color, 'base64'));
    await writeFile(`${output}/headings-team${team}-${zoomName}-grayscale.png`, Buffer.from(data.grayscale, 'base64'));
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
    document.querySelector('#notifications').className = '';
  });
  for (const width of [1440, 390]) for (const zoomName of ['normal', 'minimum']) {
    const zoom = zoomName === 'minimum' ? zooms.minimum : width === 390 ? zooms.mobileNormal : zooms.normal;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(async ({ width, zoom }) => {
      const { UNITS } = await import('./sim.js');
      // Keep all eighteen types and both ownership colors visible on each viewport.
      for (const entity of ashline.state.entities.filter(e => e.kind === 'unit')) {
        const index = Object.keys(UNITS).indexOf(entity.type);
        entity.x = width === 390 ? 11.2 + entity.team * 5.1 + index % 3 * 1.65 : 8 + entity.team * 18 + index % 6 * 2.7;
        entity.y = width === 390 ? 24.5 + Math.floor(index / 3) * 2.25 : 29 + Math.floor(index / 6) * 3.1;
      }
      ashline.view.x = width === 390 ? 15.4 : 23.75; ashline.view.y = width === 390 ? 30.5 : 32;
      ashline.view.zoom = zoom; ashline.renderer.draw(ashline.state, ashline.view);
    }, { width, zoom });
    await page.screenshot({ path: `${output}/battlefield-${width}-${zoomName}.png` });
  }
  assert.deepEqual(errors, [], 'No browser errors');
  console.log(`Camera checks passed: ${report.length * 32} full-turn sprite cases, eight authored directions, closest-angle selection, both factions and poses. Review screenshots in ${output}`);
} finally { await browser.close(); }
