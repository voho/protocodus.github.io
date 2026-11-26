import assert from 'node:assert/strict';

// The painted skyline, traced at ten evenly spaced intervals in each source
// image. Ignore isolated leaves and spires and follow the main landscape.
const ridges = {
  valley: [0.55, 0.51, 0.46, 0.62, 0.61, 0.56, 0.50, 0.56, 0.51, 0.58, 0.56],
  mesa: [0.63, 0.63, 0.68, 0.74, 0.77, 0.81, 0.84, 0.84, 0.84, 0.74, 0.78],
  snow: [0.53, 0.48, 0.60, 0.64, 0.66, 0.68, 0.65, 0.61, 0.59, 0.50, 0.46],
  night: [0.40, 0.47, 0.61, 0.72, 0.76, 0.80, 0.73, 0.62, 0.58, 0.65, 0.60],
  forest: [0.36, 0.38, 0.55, 0.59, 0.65, 0.68, 0.64, 0.60, 0.59, 0.55, 0.34],
  sandstone: [0.38, 0.41, 0.62, 0.67, 0.68, 0.72, 0.69, 0.64, 0.56, 0.33, 0.22],
  dunes: [0.75, 0.72, 0.74, 0.80, 0.83, 0.80, 0.85, 0.82, 0.77, 0.83, 0.80],
  city: [0.68, 0.53, 0.71, 0.74, 0.78, 0.81, 0.77, 0.64, 0.70, 0.58, 0.67],
  desert: [0.65, 0.53, 0.60, 0.65, 0.70, 0.69, 0.68, 0.64, 0.60, 0.54, 0.62],
  meadow: [0.58, 0.52, 0.65, 0.66, 0.67, 0.67, 0.63, 0.61, 0.60, 0.57, 0.61],
  'tropical-island': [0.80, 0.78, 0.74, 0.65, 0.70, 0.64, 0.55, 0.69, 0.72, 0.66, 0.48],
  jungle: [0.40, 0.40, 0.50, 0.63, 0.65, 0.64, 0.65, 0.57, 0.59, 0.50, 0.26],
  'canadian-forest': [0.40, 0.47, 0.63, 0.60, 0.60, 0.64, 0.62, 0.62, 0.58, 0.37, 0.39],
};

export async function checkSkies(page) {
  const original = { size: page.viewportSize(), hash: await page.evaluate(() => location.hash) };
  try {
    for (const [width, height, hash] of [[1523, 986, '#medium-u7k7es'], [390, 880, '#medium-u7k7es'], [1600, 800, '#easy-browsercheck']]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((value) => { location.hash = value; }, hash);
      await page.waitForFunction(([w, h, seed]) => bridger.view.width === w && bridger.view.height === h && bridger.mission.seed === seed, [width, height, hash.split('-')[1]]);
      const results = await page.evaluate(async (ridges) => {
        const { backdropBounds, buildScenery, drawBackdrop, drawGround, THEMES } = await import('./js/scenery.js');
        const { mission, view } = bridger, scenery = buildScenery(mission);
        const canvas = document.createElement('canvas');
        canvas.width = view.width; canvas.height = view.height;
        const ctx = canvas.getContext('2d');
        const sample = document.createElement('canvas');
        sample.width = 64; sample.height = 64;
        const probe = sample.getContext('2d', { willReadFrequently: true });
        const deck = view.sy(0);
        const sampleAboveRoad = () => {
          probe.drawImage(canvas, 0, 0, view.width, deck, 0, 0, 64, 64);
          return probe.getImageData(0, 0, 64, 64).data;
        };
        // The far wall and raised banks can cover scenery even when the
        // painting itself has a good crop. Count its surviving pixels.
        const landmarks = { city: [0.91, 0.59], 'canadian-forest': [0.85, 0.82], jungle: [0.10, 0.43],
          'tropical-island': [0.92, 0.49], sandstone: [0.12, 0.59] };
        const results = [];
        for (const [id, theme] of Object.entries(THEMES)) {
          drawBackdrop(ctx, view, scenery, theme);
          const img = new Image();
          img.src = `assets/${theme.sky}.webp`;
          await img.decode();
          const aspect = img.naturalWidth / img.naturalHeight;
          const paint = backdropBounds(view, scenery, theme, aspect);
          drawBackdrop(ctx, view, scenery, theme);
          const back = sampleAboveRoad();
          // Compare the composited backdrop with the original painting at
          // the expected camera position, including after a resize.
          ctx.drawImage(img, paint.x, paint.y, paint.w, paint.h);
          const direct = sampleAboveRoad();
          const error = direct.reduce((sum, v, i) => sum + Math.abs(v - back[i]), 0) / direct.length;
          drawBackdrop(ctx, view, scenery, theme);
          drawGround(ctx, view, mission, scenery, theme, 0);
          const scene = sampleAboveRoad(), ridge = ridges[id];
          let visible = 0, variation = 0;
          for (let x = 0; x < 64; x++) {
            const sx = (view.width * (x + 0.5) / 64 - paint.x) / paint.w * 10;
            const i = Math.min(9, Math.floor(sx));
            const line = paint.y + paint.h * (ridge[i] + (ridge[i + 1] - ridge[i]) * (sx - i));
            for (let y = 0; y < 64; y++) {
              const p = (y * 64 + x) * 4;
              if ((y + 0.5) * deck / 64 >= line && [0, 1, 2].every((c) => Math.abs(scene[p + c] - back[p + c]) < 3)) visible++;
              if (y < 4) variation = Math.max(variation, ...[0, 1, 2].map((c) => Math.abs(back[p + c] - back[c])));
            }
          }
          const mark = landmarks[id];
          const inFrame = !mark || (paint.x + mark[0] * paint.w >= 0 && paint.x + mark[0] * paint.w <= view.width
            && paint.y + mark[1] * paint.h >= 0 && paint.y + mark[1] * paint.h < deck);
          results.push({ id, ...paint, aspect, error, inFrame, variation, visible: visible / 4096, bottom: view.sy(scenery.backdropFloor) });
        }
        return results;
      }, ridges);
      for (const { id, x, y, w, h, aspect, bottom, error, inFrame, variation, visible } of results) {
        const label = `${id} ${hash} at ${width}×${height}`;
        assert.ok(x <= 1 && y <= 1 && x + w >= width - 1 && y + h >= bottom - 1, `${label}: the painting covers the sky to the far bank`);
        assert.ok(Math.abs(w / h - aspect) < 0.001, `${label}: sky and landmarks retain their proportions`);
        assert.ok(error < 1, `${label}: cached sky matches the freshly painted frame`);
        assert.ok(variation > 2, `${label}: the upper sky contains visible brushwork`);
        assert.ok(inFrame, `${label}: the landmark remains above the road and in frame`);
        assert.ok(visible >= 0.34 && visible <= 0.55, `${label}: landscape takes ${Math.round(visible * 100)}% of the space above the road`);
      }
    }
  } finally {
    await page.evaluate((value) => { location.hash = value; }, original.hash);
    await page.setViewportSize(original.size);
  }
}
