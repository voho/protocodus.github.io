// Verify ship drawing has a fixed small Canvas state budget and preserves caller state.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  const result = await page.evaluate(async () => {
    const { spritesReady } = await import('./sprite-assets.js'); await spritesReady;
    const { drawShip, warmShipSprites, SHIP_PALETTES } = await import('./ships.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
    const ctx = canvas.getContext('2d'), calls = {};
    for (const method of ['save', 'restore', 'transform', 'translate', 'rotate', 'scale', 'drawImage']) {
      const original = ctx[method].bind(ctx);
      ctx[method] = (...args) => { calls[method] = (calls[method] || 0) + 1; return original(...args); };
    }
    const state = () => {
      const m = ctx.getTransform();
      return JSON.stringify({ matrix: [m.a, m.b, m.c, m.d, m.e, m.f], alpha: ctx.globalAlpha,
        composite: ctx.globalCompositeOperation, fill: ctx.fillStyle, stroke: ctx.strokeStyle,
        width: ctx.lineWidth, dash: ctx.getLineDash(), offset: ctx.lineDashOffset,
        shadow: [ctx.shadowColor, ctx.shadowBlur, ctx.shadowOffsetX, ctx.shadowOffsetY], filter: ctx.filter });
    };
    let samples = 0, maxStack = 0, maxTransforms = 0;
    for (let world = 0; world < 10; world++) {
      warmShipSprites(SHIP_PALETTES[world], world); warmShipSprites('#a4ffee', world, true);
      for (const kind of ['player', 0, 4, 9]) for (const quality of ['high', 'low']) {
        ctx.resetTransform(); ctx.clearRect(0, 0, 384, 384);
        ctx.setTransform(1.03, .13, -.11, .94, 9, 11);
        ctx.globalAlpha = .63; ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = '#477c5e'; ctx.strokeStyle = '#ff88a3'; ctx.lineWidth = 3;
        ctx.setLineDash([2, 3]); ctx.lineDashOffset = 1.5;
        ctx.shadowColor = '#815b507f'; ctx.shadowBlur = 2; ctx.shadowOffsetX = .3; ctx.shadowOffsetY = -.7;
        ctx.filter = 'blur(0.2px)';
        const before = state();
        for (const key of Object.keys(calls)) calls[key] = 0;
        drawShip(ctx, 192, 192, 44, kind, '#a4ffee', 3.2,
          { world, palette: kind === 'player' ? undefined : SHIP_PALETTES[world], opacity: .7, hit: .4, shield: .6, quality, motion: world % 2 === 0 });
        if (state() !== before) throw new Error(`${world}:${kind}:${quality} changed caller Canvas state`);
        if (calls.save !== calls.restore) throw new Error('Unbalanced Canvas state stack');
        maxStack = Math.max(maxStack, calls.save);
        maxTransforms = Math.max(maxTransforms, calls.transform || 0);
        if (calls.translate || calls.rotate || calls.scale) throw new Error('Ship transforms were split into extra Canvas commands');
        if (!(calls.drawImage >= 4)) throw new Error('Hull, shadow, exhaust and hit artwork must still draw');
        samples++;
      }
    }
    return { samples, maxStack, maxTransforms };
  });
  assert.equal(result.samples, 80);
  assert.equal(result.maxStack, 2, 'all optional ship effects use only two Canvas save/restore pairs');
  assert.equal(result.maxTransforms, 2, 'the fixed hull and its offset shadow use two combined transforms');
  assert.deepEqual(errors, []);
  console.log('PASS 80 ship variants preserve transformed caller state with two Canvas save/restore pairs and two combined transforms.');
} finally { await browser.close(); }
