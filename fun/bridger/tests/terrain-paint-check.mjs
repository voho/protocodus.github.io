import assert from 'node:assert/strict';

export async function checkTerrainPaint(page) {
  const results = await page.evaluate(async () => {
    const { THEMES, buildScenery, drawBackdrop, drawGround, drawWater } = await import('./js/scenery.js');
    const mission = bridger.mission;
    const frame = (height, theme) => {
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scale = 14, view = { width: canvas.width, height, scale,
        sx: x => 110 + x * scale, wx: x => (x - 110) / scale, sy: y => 65 - y * scale };
      const scenery = buildScenery(mission);
      drawBackdrop(ctx, view, scenery, theme);
      drawGround(ctx, view, mission, scenery, theme, 0);
      const banks = scenery.raster.banks;
      drawWater(ctx, view, mission, scenery, theme, 0);
      const sample = (x, y, size = 1) => {
        const data = ctx.getImageData(Math.round(view.sx(x)), Math.round(view.sy(y)), size, size).data;
        return [0, 1, 2].map(c => {
          let sum = 0;
          for (let i = c; i < data.length; i += 4) sum += data[i];
          return Math.round(sum / (size * size));
        });
      };
      // Sample actual open water between the cliffs, clear of any island.
      let river = mission.left;
      while (river < mission.right && mission.ground(river) > mission.water - 1.5) river += 0.25;
      const colors = {
        soil: sample(-5, mission.bed * 0.26, 7), bedrock: sample(-5, mission.bed - 1, 7),
        road: sample(-3, mission.ground(-3)), sky: sample(1, 3, 4), water: sample(river, mission.water - 0.6),
      };
      drawGround(ctx, view, mission, scenery, theme, 4);
      return { colors, cached: banks === scenery.raster.banks };
    };
    const results = [];
    for (const [id, theme] of Object.entries(THEMES)) {
      const normal = frame(300, theme), tall = frame(390, theme);
      const altered = frame(300, { ...theme, subsoil: '#0aff93', bedrock: '#fd25b6' });
      results.push({ id, ...normal, tall: tall.colors, altered: altered.colors });
    }
    return results;
  });
  const difference = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0);
  for (const { id, colors, tall, altered, cached } of results) {
    assert.ok(cached, `${id}: moving scenery reuses the painted rock layers`);
    assert.ok(difference(colors.soil, colors.bedrock) > 40, `${id}: subsoil and deep bedrock are visibly distinct`);
    for (const zone of ['soil', 'bedrock']) {
      assert.deepEqual(colors[zone], tall[zone], `${id}: ${zone} stays at the same depth when the screen grows`);
      assert.ok(difference(colors[zone], altered[zone]) > 40, `${id}: the geology uses the biome palette`);
    }
    for (const zone of ['road', 'sky', 'water']) {
      assert.deepEqual(colors[zone], altered[zone], `${id}: tinting the rocks leaves the ${zone} intact`);
    }
  }
}
