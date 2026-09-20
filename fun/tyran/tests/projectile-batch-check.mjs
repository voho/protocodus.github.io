// Real raster equality plus Canvas state-call counts for the volley renderer.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/');
  await page.waitForFunction(() => window.tyran);
  const result = await page.evaluate(async () => {
    const { drawProjectiles, projectileTexture, projectileLayout } = await import('./projectile-sprites.js');
    const { WEAPONS, BULLET_SPECTRUM } = await import('./sim.js');
    const canvas = () => new OffscreenCanvas(640, 600);
    const legacy = (ctx, bullets, alpha) => {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const bullet of bullets) {
        const sprite = projectileTexture(bullet), layout = projectileLayout(bullet);
        ctx.save();
        ctx.translate((bullet.px ?? bullet.x) + (bullet.x - (bullet.px ?? bullet.x)) * alpha,
          (bullet.py ?? bullet.y) + (bullet.y - (bullet.py ?? bullet.y)) * alpha);
        ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(sprite, -layout.width / 2, -layout.height / 2 + layout.offsetY, layout.width, layout.height);
        ctx.restore();
      }
      ctx.restore();
    };
    const bullets = [...WEAPONS.map(weapon => ({ team: 0, kind: weapon.kind, weaponColor: weapon.color, radius: weapon.radius })),
      ...BULLET_SPECTRUM.map((color, type) => ({ team: -1, variant: type === 9 ? 5 : type % 5, color, radius: 2 + type * .65 }))]
      .map((bullet, i) => ({ ...bullet, x: 80 + i % 4 * 115, y: 90 + Math.floor(i / 4) * 100,
        px: 77 + i % 4 * 115, py: 97 + Math.floor(i / 4) * 100, vx: Math.sin(i) * 110, vy: Math.cos(i) * 180 }));
    bullets[0].vx = bullets[0].vy = 0;
    let maxDifference = 0, differences = 0, restored = true;
    for (const matrix of [[1, 0, 0, 1, 0, 0], [.95, .04, -.03, 1.02, 22, 4], [1.17, 0, 0, 1.17, -8, 6]]) {
      for (const alpha of [0, .5, 1]) {
        const old = canvas(), current = canvas();
        for (const [image, draw] of [[old, legacy], [current, drawProjectiles]]) {
          const ctx = image.getContext('2d');
          ctx.fillStyle = '#132324'; ctx.fillRect(0, 0, 640, 600);
          ctx.beginPath(); ctx.rect(8, 8, 620, 580); ctx.clip();
          ctx.setTransform(...matrix); ctx.globalAlpha = .72; ctx.globalCompositeOperation = 'screen';
          draw(ctx, bullets, alpha);
          const actual = ctx.getTransform();
          restored &&= ['a', 'b', 'c', 'd', 'e', 'f'].every((key, i) => Math.abs(actual[key] - matrix[i]) < 1e-6)
            && ctx.globalAlpha > .719 && ctx.globalAlpha < .721 && ctx.globalCompositeOperation === 'screen';
        }
        const a = old.getContext('2d').getImageData(0, 0, 640, 600).data;
        const b = current.getContext('2d').getImageData(0, 0, 640, 600).data;
        for (let i = 0; i < a.length; i++) { const delta = Math.abs(a[i] - b[i]); maxDifference = Math.max(maxDifference, delta); if (delta) differences++; }
      }
    }
    const ctx = canvas().getContext('2d'), calls = { save: 0, restore: 0, setTransform: 0, drawImage: 0 };
    for (const method of Object.keys(calls)) {
      const original = ctx[method].bind(ctx); ctx[method] = (...args) => { calls[method]++; return original(...args); };
    }
    drawProjectiles(ctx, [...bullets, { ...bullets[0], x: -1000, px: -1000 }], .5, 640, 600);
    return { maxDifference, differences, restored, calls, bullets: bullets.length };
  });
  assert(result.maxDifference <= 1, 'batch transforms preserve projectile pixels within rounding precision');
  assert(result.restored, 'camera matrix, opacity, clipping and blend mode remain scoped to the batch');
  assert.equal(result.calls.save, 1); assert.equal(result.calls.restore, 1);
  assert.equal(result.calls.drawImage, result.bullets, 'offscreen shots are skipped without dropping visible shots');
  assert.equal(result.calls.setTransform, result.bullets);
  assert.deepEqual(errors, []);
  console.log('PASS projectile batch pixels, interpolation, scoped Canvas state and offscreen culling');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
