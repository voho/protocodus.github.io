import assert from 'node:assert/strict';

export async function checkWater(page) {
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  try {
    for (const motion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion: motion });
      const result = await page.evaluate(async () => {
        const { THEMES, buildScenery, drawWater } = await import('./js/scenery.js');
        const mission = { seed: 'water-check', left: 0, right: 20, water: 0, bed: -5, ground: x => {
          if (x <= 0 || x >= 20) return 2;
          // A rock island rises above the surface.
          return Math.abs(x - 4) < 0.8 ? 1.2 : -5;
        } };
        const view = { width: 440, height: 220, scale: 20,
          sx: x => 20 + x * 20, sy: y => 80 - y * 20, wx: px => (px - 20) / 20 };
        const scenery = buildScenery(mission);
        const canvas = document.createElement('canvas');
        canvas.width = view.width; canvas.height = view.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const cx = view.sx(10), waterline = view.sy(0);
        let paints = 0;
        const drawPost = c => {
          paints++;
          c.fillStyle = '#ff0066';
          c.fillRect(cx - 2, waterline - 100, 4, 100);
        };
        const drawing = {};
        const frame = (time, at, post) => {
          ctx.clearRect(0, 0, view.width, view.height);
          drawWater(ctx, view, mission, scenery, THEMES.valley, time, post ? drawPost : null, drawing, at == null ? null :
            { time: at, waterEntry: { x: 10, time: 0, speed: 9 } });
          return ctx.getImageData(0, 0, view.width, view.height).data;
        };
        const base = frame(1, null, false);
        const post = frame(1, null, true);
        const later = frame(2, null, true);
        // The reflected post bends at different depths instead of retaining
        // a single rigid screen-space translation.
        const centers = [];
        for (let y = waterline + 5; y < waterline + 75; y++) {
          let mass = 0, moment = 0;
          for (let x = cx - 14; x <= cx + 14; x++) {
            const i = 4 * (y * view.width + x), w = Math.abs(post[i] - base[i]);
            mass += w; moment += w * x;
          }
          if (mass > 20) centers.push(moment / mass);
        }
        const impacted = (age) => {
          const broken = frame(1, age, false);
          let weight = 0, distance = 0;
          for (let x = 20; x < view.width - 20; x++) {
            for (let y = waterline - 12; y < waterline + 12; y++) {
              const i = 4 * (y * view.width + x) + 3, delta = Math.abs(base[i] - broken[i]);
              weight += delta; distance += delta * Math.abs(x - cx);
            }
          }
          return weight ? distance / weight : 0;
        };
        return {
          paints, warp: Math.max(...centers) - Math.min(...centers),
          timeChanged: post.some((v, i) => v !== later[i]),
          island: base[4 * ((waterline + 8) * view.width + view.sx(4)) + 3],
          early: impacted(0.22), late: impacted(0.78),
        };
      });
      assert.equal(result.paints, 1, 'A stationary bridge supplies its reflection once');
      assert.ok(result.warp > 1.7, 'Reflection bends across different depths');
      assert.equal(result.island, 0, 'Water leaves rock islands dry');
      assert.equal(result.timeChanged, motion === 'no-preference', 'Water motion follows the display preference');
      if (motion === 'reduce') {
        assert.equal(result.late, 0, 'Reduced motion holds the water surface steady after an impact');
      } else {
        assert.ok(result.early > 0 && result.late > result.early + 12, 'An impact sends waves away from the point of contact');
      }
    }
  } finally {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  }
}
