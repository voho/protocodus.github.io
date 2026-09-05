// Isolated sprite QA; use ASHLINE_URL / ASHLINE_PLAYWRIGHT as in browser-check.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const base = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-cargo-qa';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  await page.route('**/cargo-check.html', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(new URL('cargo-check.html', base).href);
  const report = await page.evaluate(async () => {
    const { assetsReady, assetStatus, drawSprite, drawSpriteShadow } = await import('./assets.js');
    await assetsReady;
    if (!assetStatus.ready) throw new Error(assetStatus.errors.join('; '));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sample = (entity, shadow = false) => {
      ctx.clearRect(0, 0, 192, 192); ctx.save(); ctx.translate(96, 104);
      if (entity.type === 'harvester') ctx.scale(2.5, 2.5);
      (shadow ? drawSpriteShadow : drawSprite)(ctx, { ...entity, hp: 100, progress: 1 }, 0);
      ctx.restore(); return ctx.getImageData(0, 0, 192, 192).data;
    };
    const mint = data => {
      let total = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 160 && data[i + 1] > 65 && data[i + 1] - data[i] > 18 && data[i + 1] >= data[i + 2] * .98) total++;
      return total;
    };
    let cases = 0, alphaChanged = 0, shadowChanged = 0, otherUnitChanged = 0;
    const fillCounts = [];
    for (const type of ['harvester', 'refinery']) for (const team of [0, 1]) {
      const unit = { type, team, cargo: 0, processingAmount: 0, queue: [{ type: 'harvester', progress: .2 }] };
      for (let direction = 0; direction < (type === 'harvester' ? 32 : 1); direction++) {
        unit.angle = direction * Math.PI / 16;
        const empty = sample(unit), shadow = sample(unit, true), counts = [];
        for (const amount of [0, 50, 100, 150, 200]) {
          const e = { ...unit, cargo: amount, processingAmount: amount };
          const data = sample(e), cast = sample(e, true); counts.push(mint(data));
          for (let i = 0; i < data.length; i++) {
            if (i % 4 === 3 && data[i] !== empty[i]) alphaChanged++;
            if (cast[i] !== shadow[i]) shadowChanged++;
          }
          cases++;
        }
        if (!direction) fillCounts.push({ type, team, counts });
      }
    }
    const vehicle = { type: 'harvester', team: 0, angle: .4 };
    const half = sample({ ...vehicle, cargo: 100 }), draining = sample({ ...vehicle, cargo: 200, unloadDepotId: 1, unload: .6 });
    const full = sample({ ...vehicle, cargo: 200 }), staleUnload = sample({ ...vehicle, cargo: 200, unload: .6 });
    for (const type of ['rifle', 'scout', 'tank', 'artillery']) {
      const a = sample({ type, cargo: 0 }), b = sample({ type, cargo: 200, processingAmount: 200 });
      otherUnitChanged += a.filter((value, index) => value !== b[index]).length;
    }
    const activity = [];
    for (const type of ['core', 'reactor', 'refinery', 'barracks', 'factory', 'turret']) {
      const idle = sample({ type, queue: [], processingAmount: 0 }), active = sample({ type, queue: [{ type: 'rifle', progress: .3 }], processingAmount: 0 });
      activity.push({ type, changed: idle.some((value, index) => value !== active[index]), sameAlpha: idle.every((value, index) => index % 4 !== 3 || value === active[index]) });
    }
    let refinerySource;
    drawSprite({save() {}, restore() {}, translate() {}, drawImage(source) {refinerySource = source;}}, {type: 'refinery', processingAmount: 200});
    const refineryPixels = refinerySource.getContext('2d').getImageData(0, 0, refinerySource.width, refinerySource.height).data;
    let bakedPlumeAlpha = 0;
    // The high-resolution smokeless refinery's stack rim starts at y18 in its208px frame.
    for (let y = 0; y < 16; y++) for (let x = 155; x < refinerySource.width; x++) bakedPlumeAlpha += refineryPixels[(y * refinerySource.width + x) * 4 + 3];
    const stackAlpha = refineryPixels[(30 * refinerySource.width + 180) * 4 + 3];
    const sheet = document.createElement('canvas'); sheet.width = 1100; sheet.height = 1580;
    const c = sheet.getContext('2d'); c.fillStyle = '#172126'; c.fillRect(0, 0, sheet.width, sheet.height);
    c.font = '18px monospace'; c.textAlign = 'center'; c.fillStyle = '#dbe4de';
    ['EMPTY', '25%', '50%', '75%', 'FULL'].forEach((label, col) => c.fillText(label, col * 220 + 110, 28));
    const rows = [
      { type: 'harvester', team: 0, angle: 0 }, { type: 'harvester', team: 1, angle: 0 },
      { type: 'harvester', team: 0, angle: Math.PI / 2 }, { type: 'harvester', team: 1, angle: Math.PI / 2 },
      { type: 'refinery', team: 0 }, { type: 'refinery', team: 1 },
    ];
    for (const [row, entity] of rows.entries()) for (let level = 0; level < 5; level++) {
      const x = level * 220 + 110, y = row * 205 + 143;
      c.save(); c.translate(x, y); c.scale(entity.type === 'harvester' ? 3.5 : 1.7, entity.type === 'harvester' ? 3.5 : 1.7);
      drawSprite(c, { ...entity, cargo: level * 50, processingAmount: level * 50, queue: [{type: 'harvester', progress: .3}] }, 0); c.restore();
      c.fillText(`${entity.type} · team ${entity.team}`, x, y + 82);
    }
    for (const [i, type] of ['barracks', 'factory', 'refinery'].entries()) {
      const x = i * 365 + 100, y = 1430;
      for (const [j, active] of [false, true].entries()) {
        c.save(); c.translate(x + j * 170, y); c.scale(1.45, 1.45);
        drawSprite(c, { type, team: 0, queue: active ? [{type: 'rifle'}] : [], processingAmount: 0 }, 0); c.restore();
        c.fillText(`${type} ${active ? 'active' : 'idle'}`, x + j * 170, y + 95);
      }
    }
    return { cases, alphaChanged, shadowChanged, otherUnitChanged, fillCounts, activity, bakedPlumeAlpha, stackAlpha,
      drainMatchesHalf: half.every((value, i) => value === draining[i]),
      staleUnloadMatchesFull: full.every((value, i) => value === staleUnload[i]),
      sheet: sheet.toDataURL('image/png').split(',')[1] };
  });
  await writeFile(`${output}/cargo-states.png`, Buffer.from(report.sheet, 'base64')); delete report.sheet;
  console.log(JSON.stringify(report));
  assert.equal(report.alphaChanged, 0, 'Cargo does not alter silhouettes or body anchors');
  assert.equal(report.shadowChanged, 0, 'Cargo keeps exact existing cast shadows');
  assert.equal(report.otherUnitChanged, 0, 'Other unit sprites remain unchanged');
  assert.equal(report.bakedPlumeAlpha, 0, 'Refinery exhaust comes from runtime activity, not a baked plume');
  assert(report.stackAlpha > 240, 'Removing exhaust preserves the metal chimney');
  assert(report.drainMatchesHalf && report.staleUnloadMatchesFull, 'Cargo drains only during an active unload');
  for (const { type, counts } of report.fillCounts) {
    assert(counts[4] > counts[0] + 10, `${type} full hopper is visibly different from empty`);
    assert(counts.every((count, index) => !index || count > counts[index - 1]), `${type} mineral fill increases at every cached level`);
    if (type === 'harvester') assert(counts[0] < counts[4] * .03, 'Empty haulers remove the crystal load; only tiny hardware reflections remain');
  }
  for (const { type, changed, sameAlpha } of report.activity) {
    assert.equal(changed, ['barracks', 'factory', 'refinery'].includes(type), `${type} uses its intended idle/active variant`);
    assert(sameAlpha, 'Idle tint retains building silhouette');
  }
  console.log(`Cargo checks passed: ${report.cases} faction/heading/fill cases, stable silhouettes and shadows, unloading, and idle producers. Contact sheet: ${output}/cargo-states.png`);
} finally { await browser.close(); }
