// Run against the local server; TYRAN_PLAYWRIGHT can point at the bundled Playwright.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-qa';
await mkdir(output, { recursive: true });

try {
  const page = await browser.newPage({ viewport: { width: 1560, height: 1040 } });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran);
  const result = await page.evaluate(async () => {
    const { spritesReady } = await import('./sprite-assets.js');
    await spritesReady;
    const { drawShip, ENEMY_TYPES } = await import('./ships.js');
    const { WorldRenderer, WORLDS } = await import('./worlds.js');
    const test = document.createElement('canvas'); test.width = test.height = 192;
    const ctx = test.getContext('2d', { willReadFrequently: true });
    const state = () => {
      const m = ctx.getTransform();
      return [m.a, m.b, m.c, m.d, m.e, m.f, ctx.globalAlpha, ctx.globalCompositeOperation,
        ctx.lineWidth, ctx.strokeStyle, ctx.fillStyle, ctx.filter, ctx.shadowBlur];
    };
    ctx.setTransform(.9, .1, -.1, .9, 7, 13); ctx.globalAlpha = .43;
    ctx.globalCompositeOperation = 'multiply'; ctx.lineWidth = 4; ctx.filter = 'contrast(1.1)';
    const before = state();
    drawShip(ctx, 96, 96, 30, 'player', '#79ecff', 2, { bank: .3, hit: .4, shield: .5, opacity: .6 });
    const after = state();
    ctx.resetTransform(); ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    let transparent = true;
    for (const quality of ['high', 'low']) for (const inherited of [true, false]) {
      ctx.clearRect(0, 0, 192, 192); ctx.globalAlpha = inherited ? 0 : 1;
      drawShip(ctx, 96, 96, 45, 9, '#ff9866', 2, { quality, opacity: inherited ? 1 : 0, hit: 1, shield: 1 });
      const data = ctx.getImageData(0, 0, 192, 192).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) transparent = false;
    }

    // Static contact sheets make tiny fighters and capitals reviewable over bright/busy ground.
    document.body.innerHTML = '<canvas id="ship-qa" width="1560" height="1040" style="position:fixed;inset:0;width:1560px;height:1040px"></canvas>';
    const canvas = document.querySelector('#ship-qa'), board = canvas.getContext('2d');
    const worlds = [0,1,6,4].map(index => {
      const renderer = new WorldRenderer(); renderer.setWorld(index);
      const ground = document.createElement('canvas'); ground.width = 1560; ground.height = 520;
      renderer.draw(ground.getContext('2d'), 1560, 520, 300, 2, 'high');
      renderer.warmEpoch++; renderer.warmJobs.length = 0;
      return { index, ground };
    });
    window.drawShipQA = quality => {
      for (let row = 0; row < worlds.length; row++) {
        const { index, ground } = worlds[row];
        board.drawImage(ground, 0, 130, 1560, 260, 0, row * 260, 1560, 260);
        board.fillStyle = 'rgba(3,10,18,.8)'; board.fillRect(0, row * 260, 1560, 40);
        board.font = '16px monospace'; board.fillStyle = '#dffaff';
        board.fillText(`${quality} / ${WORLDS[index].name} / Player + 10 enemy classes`, 20, row * 260 + 26);
        for (let type = -1; type < 10; type++) {
          const x = 74 + (type + 1) * 132, y = row * 260 + 148;
          const size = type < 0 ? 30 : type === 9 ? 69 : ENEMY_TYPES[type].radius * (type < 2 ? 1.35 : 1);
          drawShip(board, x, y, size, type, type < 0 ? '#7cecfa' : '#b98263', 12,
            { quality, bank: type < 0 ? .18 : 0, thrust: type < 0 ? 1.55 : 1, world: index });
        }
      }
    };
    window.drawShipQA('high');
    return { before, after, transparent };
  });
  assert.deepEqual(result.after, result.before, 'Ship rendering restores the caller’s canvas state');
  assert.equal(result.transparent, true, 'Exhaust, bloom, damage flashes, and shadows respect zero opacity');
  await page.screenshot({ path: `${output}/ships-high.png` });
  await page.evaluate(() => window.drawShipQA('low'));
  await page.screenshot({ path: `${output}/ships-low.png` });
  console.log('Ship QA passed: caller state and inherited opacity preserved; high/low contact sheets generated.');
} finally {
  await browser.close();
}
