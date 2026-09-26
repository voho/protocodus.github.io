// Fixed hulls and shadows must stay identical through steering and animation.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const output = process.env.TYRAN_SCREENSHOTS || '/tmp/tyran-qa';
await mkdir(output, { recursive: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const bankRequests = [];
  page.on('request', request => { if (/fleet-(left|right)\./.test(request.url())) bankRequests.push(request.url()); });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  const result = await page.evaluate(async () => {
    const { spritesReady, spriteStatus } = await import('./sprite-assets.js');
    await spritesReady;
    const { drawShip, warmShipSprites, SHIP_PALETTES } = await import('./ships.js?fixed-heading-qa');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
    const ctx = canvas.getContext('2d');
    let captures;
    const drawImage = ctx.drawImage.bind(ctx);
    ctx.drawImage = (...args) => {
      if (captures) {
        const [image,sx,sy,sw,sh,dx,dy,dw,dh]=args;
        const full=args.length===9?[image,dx-sx*dw/sw,dy-sy*dh/sh,image.width*dw/sw,image.height*dh/sh]:args;
        const type = Math.abs(full[1]+140)<1e-8 && Math.abs(full[3]-280)<1e-8 ? 'hull' : Math.abs(full[1]+160)<1e-8 && Math.abs(full[3]-320)<1e-8 && !captures.shadow ? 'shadow' : null;
        if (type) {
          const m = ctx.getTransform();
          captures[type] = { source: image, geometry: [m.a, m.b, m.c, m.d, m.e, m.f, ...full.slice(1)] };
        }
      }
      return drawImage(...args);
    };
    let allocations = 0;
    const NativeCanvas = window.OffscreenCanvas;
    window.OffscreenCanvas = new Proxy(NativeCanvas, {
      construct(target, args) { allocations++; return new target(...args); },
    });
    const warmMisses = [];
    let fixedShips = 0;
    for (let world = 0; world < 10; world++) {
      warmShipSprites(SHIP_PALETTES[world], world);
      warmShipSprites('#71ecff', world, true);
      warmShipSprites('#ffc777', world, true);
      const before = allocations;
      for (let kind = -2; kind < 10; kind++) {
        const player = kind < 0, color = kind === -2 ? '#ffc777' : '#71ecff';
        let reference;
        for (let frame = 0; frame < 4; frame++) for (const bank of [-.3, 0, .3]) {
          captures = {};
          drawShip(ctx, 192, 192, 45, player ? 'player' : kind, color, frame,
            { world, bank, hit: .2, shield: .4, quality: frame % 2 ? 'low' : 'high' });
          if (!reference) reference = captures;
          for (const type of ['hull', 'shadow']) {
            if (captures[type]?.source !== reference[type]?.source) throw new Error(`${world}:${kind} changed ${type} sprite while steering`);
            if (JSON.stringify(captures[type].geometry) !== JSON.stringify(reference[type].geometry)) throw new Error(`${world}:${kind} moved or transformed ${type} while steering`);
          }
        }
        fixedShips++;
      }
      warmMisses.push(allocations - before);
    }
    window.OffscreenCanvas = NativeCanvas;
    captures = null;
    const snapshot = (time, motion) => {
      ctx.clearRect(0, 0, 384, 384);
      drawShip(ctx, 192, 192, 55, 'player', '#71ecff', time, { world: 9, motion, shield: .6 });
      return canvas.toDataURL();
    };
    const reducedMotionStable = snapshot(0, false) === snapshot(7, false);
    const effectsAnimate = snapshot(0, true) !== snapshot(7, true);

    document.body.innerHTML = '<canvas id="fixed-ship-qa" width="1440" height="900" style="position:fixed;inset:0;width:1440px;height:900px"></canvas>';
    const board = document.querySelector('#fixed-ship-qa').getContext('2d');
    board.fillStyle = '#121b23'; board.fillRect(0, 0, 1440, 900);
    board.font = '14px monospace';
    const ground = ['#274537', '#b6c6ce', '#b18a53', '#178b98', '#343335', '#8a4434', '#392d2a', '#33283e', '#574469', '#252330'];
    for (let world = 0; world < 10; world++) {
      const x = (world % 5) * 288, y = Math.floor(world / 5) * 450;
      board.fillStyle = ground[world]; board.fillRect(x + 2, y + 2, 284, 446);
      board.fillStyle = '#091016'; board.fillRect(x + 2, y + 2, 284, 32);
      board.fillStyle = '#edf5fc'; board.fillText(SHIP_PALETTES[world].id, x + 12, y + 23);
      for (let i = 0; i < 3; i++) {
        const time = i * .7;
        drawShip(board, x + 52 + i * 92, y + 104, 29, 'player', '#71ecff', time, { world });
        drawShip(board, x + 52 + i * 92, y + 221, 33, 7, null, time, { world });
        drawShip(board, x + 52 + i * 92, y + 355, 37, 9, null, time, { world });
      }
    }
    return { warmMisses, fixedShips, reducedMotionStable, effectsAnimate, assets: spriteStatus() };
  });
  assert.equal(result.assets.fleetLeft, undefined, 'Left bank atlas is absent from the loader');
  assert.equal(result.assets.fleetRight, undefined, 'Right bank atlas is absent from the loader');
  assert.deepEqual(bankRequests, [], 'No obsolete bank assets are downloaded');
  assert.deepEqual(result.warmMisses, Array(10).fill(0), 'Every warmed fleet renders without new sprite canvases');
  assert.equal(result.fixedShips, 120, 'All ten fleets and both pilots reuse the exact hull, shadow, and geometry');
  assert.equal(result.reducedMotionStable, true, 'Reduced motion freezes all decorative ship effects');
  assert.equal(result.effectsAnimate, true, 'Exhaust and lighting bring the fixed sprites to life');
  await page.screenshot({ path: `${output}/ships-fixed.png` });
  console.log('Fixed ship QA passed: one hull per ship, stable geometry, no bank downloads, reduced motion and zero warm allocations.');
} finally {
  await browser.close();
}
