// Run with: node fun/bridger/tests/browser-check.mjs
// Plays Bridger in Chromium the way a child would: the road is already laid,
// a beam from a bolt, a failed test, Show solution and a crossing,
// on a desktop and a phone. Screenshots land in test-results/bridger/.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { checkAmbience } from './ambience-check.mjs';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = resolve(root, 'test-results/bridger');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + sep)) throw new Error('path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path);
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

async function checkWheelRendering(page) {
  const results = await page.evaluate(async () => {
    const { drawVehicle } = await import('./js/render.js');
    const { BODIES, VEHICLES, WHEEL } = await import('./js/physics.js');
    await Promise.all(['car', 'truck', 'loco', 'wagon', 'wheel-road', 'wheel-rail'].map(async (name) => {
      const img = new Image();
      img.src = `assets/${name}.webp`;
      await img.decode();
    }));

    const scale = 64, view = { scale, sx: (x) => (x + 2.5) * scale, sy: (y) => (4.5 - y) * scale };
    const results = [];
    for (const [id, def] of Object.entries(VEHICLES)) {
      const axles = def.axles.map(([offset]) => ({ offset, x: def.length - offset, y: 0, angle: 0 }));
      const width = Math.ceil((def.length + 5) * scale), height = 5 * scale;
      const frame = (layer) => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        // Reuse the actual placement transforms to isolate the two painted layers.
        if (layer) {
          const paint = ctx.drawImage.bind(ctx);
          ctx.drawImage = (img, ...args) => {
            const wheel = /\/wheel-(road|rail)\.webp$/.test(img.src);
            if (wheel === (layer === 'wheels')) paint(img, ...args);
          };
        }
        drawVehicle(ctx, view, { id, def, axles });
        return ctx.getImageData(0, 0, width, height).data;
      };
      const rest = frame(), body = id === 'train' ? null : frame('body'), wheels = body ? frame('wheels') : null;
      for (let axle = 0; axle < axles.length; axle++) {
        axles[axle].angle = 0.39;
        const turned = frame();
        axles[axle].angle = 0;
        const kind = BODIES[id].find(([first, last]) => axle >= first && axle <= last)[2];
        const radius = WHEEL[kind] * scale, cx = view.sx(axles[axle].x), cy = view.sy(WHEEL[kind]);
        let spinning = 0, outside = 0, overlap = 0, covered = 0;
        for (let i = 0; i < rest.length; i += 4) {
          const changed = rest[i] !== turned[i] || rest[i + 1] !== turned[i + 1] ||
            rest[i + 2] !== turned[i + 2] || rest[i + 3] !== turned[i + 3];
          const inFender = body && body[i + 3] >= 250 && wheels[i + 3] > 200;
          if (!changed && !inFender) continue;
          const pixel = i / 4, x = pixel % width + 0.5, y = Math.floor(pixel / width) + 0.5;
          if (Math.hypot(x - cx, y - cy) > radius + 2) {
            if (changed) outside++;
            continue;
          }
          if (changed) spinning++;
          if (inFender) {
            overlap++;
            // A near-opaque fender admits at most its remaining alpha in each
            // colour channel, plus two levels for canvas rounding.
            const tolerance = 255 - body[i + 3] + 2;
            if ([0, 1, 2].every((c) => Math.abs(turned[i + c] - body[i + c]) <= tolerance)) covered++;
          }
        }
        results.push({ id, axle, spinning, outside, overlap, covered });
      }
    }
    return results;
  });
  for (const { id, axle, spinning, outside, overlap, covered } of results) {
    assert.ok(spinning > 12, `${id} axle ${axle} shows its own rotation`);
    assert.equal(outside, 0, `${id} axle ${axle} leaves the chassis and other wheels stationary`);
    if (id !== 'train') {
      assert.equal(covered, overlap, `${id} axle ${axle} rotates behind the fender`);
    }
  }
  for (const id of ['car', 'truck']) {
    assert.ok(results.some((r) => r.id === id && r.overlap > 0), `${id} has painted bodywork in front of its tyres`);
  }
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const device of [{ name: 'desktop', viewport: { width: 1280, height: 760 } }, { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]) {
    const context = await browser.newContext({ viewport: device.viewport, hasTouch: device.hasTouch, isMobile: device.isMobile });
    await context.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/fun/bridger/#easy-browsercheck`);
    await page.waitForFunction(() => document.body.classList.contains('ready') && !document.body.classList.contains('busy'));
    // The first visit opens How to play.
    assert.ok(await page.locator('[data-dialog="help"]').evaluate((d) => d.open), `${device.name}: help opens on the first visit`);
    await page.screenshot({ path: `${output}/${device.name}-help.png` });
    await page.click('[data-dialog="help"] button');

    const at = (gx, gy) => page.evaluate(([x, y]) => [bridger.view.sx(x * 2), bridger.view.sy(y * 2)], [gx, gy]);
    const drag = async (from, to) => {
      const [x1, y1] = await at(...from), [x2, y2] = await at(...to);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 8 });
      await page.mouse.up();
    };
    const count = () => page.evaluate(() => bridger.members.length);
    const span = await page.evaluate(() => bridger.mission.span);

    assert.equal(await count(), span, `${device.name}: the road is laid across in 2 m pieces`);
    const doubleTap = async (point) => {
      const [x, y] = await at(...point);
      if (device.hasTouch) {
        await page.touchscreen.tap(x, y);
        await page.touchscreen.tap(x, y);
      } else await page.mouse.dblclick(x, y);
    };
    const reload = async () => {
      await page.reload();
      await page.waitForFunction(() => document.body.classList.contains('ready'));
    };

    await doubleTap([2.5, 0]);
    assert.equal(await count(), span - 1, `${device.name}: double-click or double-tap removes a road piece`);
    await page.click('[data-action="clear"]');
    await page.click('[data-dialog="confirm"] button[value="ok"]');
    await page.waitForFunction(() => bridger.members.length === bridger.mission.span);
    await page.click('[data-action="undo"]');
    await reload();
    assert.equal(await count(), span - 1, `${device.name}: the road gap survives reload`);
    await drag([2, 0], [3, 0]);
    assert.equal(await page.evaluate(() => bridger.members.filter((m) => m.mat === 'road').length), span,
      `${device.name}: dragging across the gap restores drivable road`);

    await drag([0, 0], [1, 1]);
    assert.equal(await count(), span + 1, `${device.name}: a drag from a bolt adds one beam`);
    if (!device.hasTouch) {
      // The original save format held a plain array of road and support members.
      await page.evaluate(() => localStorage.setItem(`bridger-bridge-${bridger.mission.seed}`, JSON.stringify(bridger.members)));
      await reload();
      assert.equal(await count(), span + 1, 'Existing saves retain the road and supports');
    }
    await page.click('[data-tool="steel"]');
    await drag([1, 0], [3, 1]);
    assert.equal(await count(), span + 2, `${device.name}: a sloping girder is built`);

    // This slope has no interior point on the drawing grid. Check for the gold
    // connection marker on the canvas, then join there through actual pointer input.
    const [startX, startY] = await at(2, 0);
    const [socketX, socketY] = await at(2, 0.5);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForFunction(([x, y]) => {
      const canvas = document.querySelector('#stage');
      const ratio = canvas.width / canvas.clientWidth;
      const [r, g, b] = canvas.getContext('2d').getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
      return r === 255 && g === 212 && b === 105;
    }, [socketX, socketY]);
    await page.mouse.move(socketX, socketY, { steps: 6 });
    await page.mouse.up();
    assert.equal(await count(), span + 4, `${device.name}: snapping splits the girder in two`);
    const attached = () => page.evaluate(() => bridger.members.filter((m) =>
      [m.a, m.b].some(([x, y]) => x === 2 && y === 0.5)).length);
    assert.equal(await attached(), 3, `${device.name}: all three pieces meet at the off-grid joint`);
    await reload();
    assert.equal(await attached(), 3, `${device.name}: the off-grid joint survives reload`);
    await drag([1.5, 0.25], [1, 1]);
    assert.equal(await count(), span + 6, `${device.name}: a drag can also start partway along the girder`);
    await page.click('[data-action="undo"]');
    await doubleTap([2, 0.5]);
    assert.equal(await count(), span + 1, `${device.name}: erasing the joint removes its three pieces`);
    await page.click('[data-action="undo"]');
    await page.click('[data-tool="cable"]');
    await doubleTap([0.5, 0.5]);
    assert.equal(await count(), span + 3, `${device.name}: a double tap erases with any material tool`);
    await page.click('[data-action="undo"]');
    assert.ok(await page.evaluate(() => bridger.members.some((m) => m.mat === 'wood')), `${device.name}: one Undo restores the original material`);
    await page.click('[data-tool="erase"]');
    await doubleTap([0.5, 0.5]);
    assert.equal(await count(), span + 3, `${device.name}: Erase removes the tapped piece once`);
    await page.screenshot({ path: `${output}/${device.name}-build.png` });

    // A bare road fails; the peak stress stays on the drawing afterwards.
    await page.click('[data-action="test"]');
    await page.waitForFunction(() => bridger.sim?.result, null, { timeout: 30000 });
    const failed = await page.evaluate(() => bridger.sim.result);
    await page.screenshot({ path: `${output}/${device.name}-test.png` });
    await page.click('[data-action="test"]');
    assert.notEqual(failed, 'win', `${device.name}: road alone does not carry the vehicle`);

    // Replacing what the player built asks first.
    await page.click('[data-action="solution"]');
    assert.ok(await page.locator('[data-dialog="confirm"]').evaluate((d) => d.open), `${device.name}: Solution asks before replacing the bridge`);
    await page.click('[data-dialog="confirm"] button[value="cancel"]');
    assert.equal(await count(), span + 3, `${device.name}: cancelling keeps the bridge`);
    await page.click('[data-action="solution"]');
    await page.click('[data-dialog="confirm"] button[value="ok"]');
    await page.waitForFunction(() => !document.body.classList.contains('busy') &&
      document.querySelector('[data-toast]').textContent.startsWith('Here is '));
    const cost = await page.evaluate(() => Number(document.querySelector('[data-cost]').textContent.replace(/\D/g, '')));
    const budget = await page.evaluate(() => bridger.mission.budget);
    assert.ok(cost > 0 && cost <= budget, `${device.name}: Show solution builds within budget`);
    await page.click('[data-action="test"]');
    await page.waitForFunction(() => bridger.sim?.result, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => bridger.sim.result), 'win', `${device.name}: the solution carries the vehicle across`);
    await page.waitForFunction(() => document.querySelector('[data-dialog="win"]').open, null, { timeout: 5000 });
    await page.screenshot({ path: `${output}/${device.name}-win.png` });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `${device.name}: no sideways scrolling`);
    assert.deepEqual(errors, [], `${device.name}: no page errors`);
    await context.close();
  }
  const preview = await browser.newPage({ viewport: { width: 640, height: 480 }, reducedMotion: 'reduce' });
  await preview.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  for (const theme of ['valley', 'mesa', 'snow', 'night', 'forest', 'sandstone', 'dunes', 'city', 'desert', 'meadow', 'tropical-island', 'jungle', 'canadian-forest']) {
    await preview.goto(`${origin}/fun/bridger/?theme=${theme}#easy-browsercheck`);
    await preview.waitForFunction(() => document.body.classList.contains('ready'));
    assert.equal(await preview.evaluate(() => document.body.dataset.theme), theme);
    await preview.evaluate(async (id) => {
      const { THEMES } = await import('./js/scenery.js');
      await Promise.all([THEMES[id].sky, THEMES[id].rock].map((name) => {
        const img = new Image();
        img.src = `assets/${name}.webp`;
        return img.decode();
      }));
    }, theme);
  }
  // Reduced motion freezes both the ambience and the water. With motion
  // enabled, the same two timestamps must produce visibly different frames.
  const framesDiffer = () => preview.evaluate(async () => {
    const { THEMES, buildScenery, drawAmbient, drawWater } = await import('./js/scenery.js');
    const { mission, view } = bridger, scenery = buildScenery(mission);
    const theme = THEMES[document.body.dataset.theme];
    const canvas = document.createElement('canvas');
    canvas.width = view.width; canvas.height = view.height;
    const ctx = canvas.getContext('2d');
    const frame = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawAmbient(ctx, view, scenery, theme, t);
      drawWater(ctx, view, mission, scenery, theme, t);
      return canvas.toDataURL();
    };
    return frame(1) !== frame(3);
  });
  assert.equal(await framesDiffer(), false, 'reduced motion leaves scenery still');
  await preview.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await framesDiffer(), true, 'background and water animate during building');
  await checkWheelRendering(preview);
  await preview.close();
  await checkAmbience(browser, origin);
  console.log(`Bridger browser checks passed: drawing, simulation, wheel rendering, world previews, reduced motion and ambience, desktop and phone. Screenshots in ${output}.`);
} finally {
  await browser.close();
  server.close();
}
