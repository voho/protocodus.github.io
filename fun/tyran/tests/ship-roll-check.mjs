// Cached roll frames must preserve heading and avoid raster work during flight.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-qa';
await mkdir(output, { recursive: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  const result = await page.evaluate(async () => {
    const { spritesReady } = await import('./sprite-assets.js');
    await spritesReady;
    const { drawShip, warmShipSprites, SHIP_PALETTES } = await import('./ships.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
    const ctx = canvas.getContext('2d');
    let captured;
    const drawImage = ctx.drawImage.bind(ctx);
    ctx.drawImage = (...args) => {
      if (args.length === 5 && args[1] === -140 && args[3] === 280) captured = args[0];
      return drawImage(...args);
    };
    let allocations = 0;
    const NativeCanvas = window.OffscreenCanvas;
    window.OffscreenCanvas = new Proxy(NativeCanvas, {
      construct(target, args) { allocations++; return new target(...args); },
    });
    const warmMisses = [];
    for (let world = 0; world < 10; world++) {
      warmShipSprites(SHIP_PALETTES[world], world);
      warmShipSprites('#71ecff', world, true);
      warmShipSprites('#ffc777', world, true);
      const before = allocations;
      for (let frame = 0; frame < 4; frame++) for (const bank of [-.3, 0, .3]) {
        for (let kind = -2; kind < 10; kind++) {
          const player = kind < 0, color = kind === -2 ? '#ffc777' : '#71ecff';
          drawShip(ctx, 192, 192, 45, player ? 'player' : kind, color, frame,
            { world, bank, hit: .2, shield: .4, quality: frame % 2 ? 'low' : 'high' });
        }
      }
      warmMisses.push(allocations - before);
    }
    window.OffscreenCanvas = NativeCanvas;

    const frames = [-.3, 0, .3].map(bank => {
      drawShip(ctx, 192, 192, 45, 'player', '#71ecff', 0, { world: 9, bank });
      return captured;
    });
    const bounds = frames.map(frame => {
      const pixels = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height).data;
      let left = frame.width, right = 0, top = frame.height, noseLeft = frame.width, noseRight = 0;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        if (pixels[(y * frame.width + x) * 4 + 3] < 180) continue;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y);
        if (y <= top + 2) { noseLeft = Math.min(noseLeft, x); noseRight = Math.max(noseRight, x); }
      }
      return { width: right - left, nose: (noseLeft + noseRight) / 2, top };
    });

    // All ten palettes and all three attitudes at useful inspection sizes.
    document.body.innerHTML = '<canvas id="roll-qa" width="1440" height="900" style="position:fixed;inset:0;width:1440px;height:900px"></canvas>';
    const board = document.querySelector('#roll-qa').getContext('2d');
    board.fillStyle = '#121b23'; board.fillRect(0, 0, 1440, 900);
    board.font = '14px monospace';
    const ground = ['#274537', '#b6c6ce', '#b18a53', '#178b98', '#343335', '#8a4434', '#392d2a', '#33283e', '#574469', '#252330'];
    for (let world = 0; world < 10; world++) {
      const x = (world % 5) * 288, y = Math.floor(world / 5) * 450;
      board.fillStyle = ground[world]; board.fillRect(x + 2, y + 2, 284, 446);
      board.fillStyle = '#091016'; board.fillRect(x + 2, y + 2, 284, 32);
      board.fillStyle = '#edf5fc'; board.fillText(SHIP_PALETTES[world].id, x + 12, y + 23);
      for (let i = 0; i < 3; i++) {
        const bank = (i - 1) * .3;
        drawShip(board, x + 52 + i * 92, y + 104, 29, 'player', '#71ecff', 0, { world, bank });
        drawShip(board, x + 52 + i * 92, y + 221, 33, 7, null, 0, { world, bank });
        drawShip(board, x + 52 + i * 92, y + 355, 37, 9, null, 0, { world, bank });
      }
    }
    return { warmMisses, bounds, distinct: new Set(frames).size };
  });
  assert.deepEqual(result.warmMisses, Array(10).fill(0), 'Every warmed fleet renders without new sprite canvases');
  assert.equal(result.distinct, 3, 'Left, level and right use distinct cached frames');
  const [left, level, right] = result.bounds;
  for (const frame of [left, right]) {
    assert.ok(frame.width < level.width * .9, 'Rolling foreshortens the wings');
    assert.ok(Math.abs(frame.nose - level.nose) <= 2, 'The nose stays on its centerline');
    assert.ok(Math.abs(frame.top - level.top) <= 2, 'The nose does not pitch when rolling');
  }
  await page.screenshot({ path: `${output}/ship-rolls.png` });
  console.log('Ship roll QA passed: stable heading, three cached attitudes and zero warm cache misses across ten fleets.');
} finally {
  await browser.close();
}
