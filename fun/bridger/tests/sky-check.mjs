import assert from 'node:assert/strict';

// The painted skyline, traced at ten evenly spaced intervals in each source
// image. Follow the main landscape, accounting for gaps in the jungle canopy.
const ridges = {
  valley: [0.45, 0.41, 0.41, 0.45, 0.49, 0.43, 0.43, 0.48, 0.40, 0.47, 0.46],
  mesa: [0.42, 0.42, 0.45, 0.48, 0.52, 0.55, 0.57, 0.56, 0.56, 0.52, 0.55],
  snow: [0.33, 0.30, 0.40, 0.43, 0.45, 0.48, 0.46, 0.42, 0.38, 0.35, 0.33],
  night: [0.30, 0.30, 0.43, 0.47, 0.55, 0.57, 0.52, 0.47, 0.38, 0.45, 0.43],
  forest: [0.32, 0.25, 0.39, 0.46, 0.47, 0.51, 0.48, 0.48, 0.44, 0.44, 0.31],
  sandstone: [0.24, 0.26, 0.37, 0.43, 0.46, 0.47, 0.44, 0.45, 0.36, 0.17, 0.17],
  dunes: [0.48, 0.45, 0.47, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51],
  city: [0.53, 0.25, 0.50, 0.58, 0.58, 0.67, 0.62, 0.51, 0.48, 0.29, 0.55],
  desert: [0.39, 0.36, 0.42, 0.43, 0.45, 0.45, 0.43, 0.42, 0.42, 0.37, 0.40],
  meadow: [0.47, 0.38, 0.49, 0.49, 0.52, 0.51, 0.50, 0.50, 0.49, 0.45, 0.48],
  'tropical-island': [0.58, 0.55, 0.56, 0.52, 0.48, 0.50, 0.40, 0.46, 0.52, 0.29, 0.45],
  jungle: [0.08, 0.08, 0.24, 0.44, 0.51, 0.51, 0.51, 0.43, 0.44, 0.27, 0.18],
  'canadian-forest': [0.34, 0.35, 0.49, 0.48, 0.46, 0.49, 0.50, 0.48, 0.50, 0.28, 0.39],
};

async function checkCamera(page) {
  const frame = await page.evaluate(() => {
    const { mission, view } = bridger;
    let bed = Infinity;
    for (let i = Math.round(mission.left * 10); i <= Math.round(mission.right * 10); i++) {
      bed = Math.min(bed, mission.ground(i / 10));
    }
    const panels = [...document.querySelectorAll('.hud-top > *, .hud-bottom > *')]
      .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
    const upper = Math.max(...panels.filter(r => r.y < view.height / 2).map(r => r.bottom));
    const lower = Math.min(...panels.filter(r => r.y >= view.height / 2).map(r => r.top));
    return { width: view.width, height: view.height, bed: view.sy(bed), deck: view.sy(mission.deck), upper, lower,
      topJoint: view.sy(mission.bounds.maxY * 2), lowJoint: view.sy(mission.bounds.minY * 2),
      left: view.sx(mission.bounds.minX * 2), right: view.sx(mission.bounds.maxX * 2) };
  });
  const target = Math.min(frame.height - Math.min(76, frame.height * 0.20), frame.lower - 10);
  const name = `${frame.width}×${frame.height}`;
  assert.ok(Math.abs(frame.bed - target) <= 2, `${name}: the deepest painted bed has a visible margin above the bottom controls`);
  assert.ok(frame.deck >= frame.upper + 0.60 * (frame.bed - frame.upper), `${name}: the bridge sits in the lower part of the usable field`);
  assert.ok(frame.left > 0 && frame.right < frame.width && frame.topJoint > frame.upper && frame.lowJoint < frame.lower - 5,
    `${name}: the full build grid clears the controls`);
}

export async function checkSkies(page) {
  const original = { size: page.viewportSize(), hash: await page.evaluate(() => location.hash) };
  try {
    for (const [width, height, pixelRatio, hash] of [
      [1523, 986, 1, '#medium-u7k7es'], [390, 880, 2, '#medium-u7k7es'],
      [1600, 800, 1, '#easy-browsercheck'], [1920, 1080, 1, '#medium-u7k7es'],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((value) => { location.hash = value; }, hash);
      await page.waitForFunction(([w, h, seed]) => window.bridger?.view?.width === w && bridger.view.height === h && bridger.mission.seed === seed, [width, height, hash.slice(hash.indexOf('-') + 1)]);
      await checkCamera(page);
      const results = await page.evaluate(async ({ ridges, pixelRatio }) => {
        const { image } = await import('./js/art.js');
        const { backdropBounds, buildScenery, drawBackdrop, drawGround, THEMES } = await import('./js/scenery.js');
        const { mission, view } = bridger, scenery = buildScenery(mission);
        const canvas = document.createElement('canvas');
        canvas.width = view.width * pixelRatio; canvas.height = view.height * pixelRatio;
        const ctx = canvas.getContext('2d');
        ctx.scale(pixelRatio, pixelRatio);
        const sample = document.createElement('canvas');
        sample.width = 64; sample.height = 64;
        const probe = sample.getContext('2d', { willReadFrequently: true });
        const deck = view.sy(0);
        const sampleAboveRoad = () => {
          probe.drawImage(canvas, 0, 0, canvas.width, deck * pixelRatio, 0, 0, 64, 64);
          return probe.getImageData(0, 0, 64, 64).data;
        };
        // The far wall and raised banks can cover scenery even when the
        // painting itself has a good crop. Count its surviving pixels.
        const landmarks = { city: [0.90, 0.40], 'canadian-forest': [0.85, 0.63], jungle: [0.19, 0.43],
          'tropical-island': [0.94, 0.33], sandstone: [0.12, 0.39] };
        const results = [];
        for (const [id, theme] of Object.entries(THEMES)) {
          drawBackdrop(ctx, view, scenery, theme);
          const img = image(theme.sky);
          const aspect = img.width / img.height;
          const paint = backdropBounds(view, scenery, theme, img, pixelRatio);
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
          const enlargement = paint.w * pixelRatio / img.width;
          results.push({ id, ...paint, aspect, error, enlargement, inFrame, variation, visible: visible / 4096, bottom: view.sy(scenery.backdropFloor) });
        }
        return results;
      }, { ridges, pixelRatio });
      for (const { id, x, y, w, h, aspect, bottom, error, enlargement, inFrame, variation, visible } of results) {
        const label = `${id} ${hash} at ${width}×${height}`;
        assert.ok(x <= 1 && y <= 1 && x + w >= width - 1 && y + h >= bottom - 1, `${label}: the painting covers the sky to the far bank`);
        assert.ok(Math.abs(w / h - aspect) < 0.001, `${label}: sky and landmarks retain their proportions`);
        assert.ok(enlargement <= (pixelRatio === 1 ? 1.12 : 1.6), `${label}: the source is enlarged ${enlargement.toFixed(2)}×`);
        assert.ok(error < 1, `${label}: cached sky matches the freshly painted frame`);
        assert.ok(variation > 2, `${label}: the upper sky contains visible brushwork`);
        assert.ok(inFrame, `${label}: the landmark remains above the road and in frame`);
        // On tall phones the lower road reveals a taller slice of the same
        // painting. Retain at least 35% sky without enlarging the brushwork.
        assert.ok(visible >= 0.34 && visible <= (width < height ? 0.65 : 0.55), `${label}: landscape takes ${Math.round(visible * 100)}% of the space above the road`);
      }
    }
    for (const [width, height] of [[1000, 680], [667, 375]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(([w, h]) => bridger.view.width === w && bridger.view.height === h, [width, height]);
      await checkCamera(page);
    }
  } finally {
    await page.evaluate((value) => { location.hash = value; }, original.hash);
    await page.setViewportSize(original.size);
    await page.waitForFunction(hash => window.bridger?.mission?.seed === hash.slice(hash.indexOf('-') + 1), original.hash);
  }
}
