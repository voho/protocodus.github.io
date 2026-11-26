import assert from 'node:assert/strict';

export async function checkClearance(page, origin) {
  const original = page.viewportSize();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [seed, rule] of [['v2-check0', 'channel'], ['v2-check4', 'ceiling'], ['v2-check2', null], ['browsercheck', null]]) {
      await page.goto(`${origin}/fun/bridger/?theme=jungle#easy-${seed}`);
      await page.waitForFunction((id) => bridger.mission?.seed === id && document.body.classList.contains('ready'), seed);
      const note = page.locator('[data-clearance-note]');
      assert.equal(await note.isVisible(), Boolean(rule), `${seed}: show only applicable construction rules`);
      assert.ok(await page.evaluate(() => {
        const panel = document.querySelector('.wordmark').getBoundingClientRect();
        const controls = document.querySelector('.hud-tools').getBoundingClientRect();
        return panel.left >= 0 && panel.right <= innerWidth && controls.right <= innerWidth &&
          (panel.right <= controls.left || panel.bottom <= controls.top);
      }), `${seed}: the mobile mission panel fits beside the controls`);
      if (!rule) continue;

      const bands = await page.evaluate(async () => {
        const { draw } = await import('./js/render.js');
        const { createSim } = await import('./js/physics.js');
        const { buildScenery, THEMES } = await import('./js/scenery.js');
        const { view, mission, members } = bridger, zone = mission.clearance;
        const scenery = buildScenery(mission), sim = createSim(mission, members);
        // Sample a strip just inside the rule boundary, between drawing-grid rows.
        const x = Math.round(view.sx((zone.x0 + zone.x1) / 2)) - 6;
        const y = Math.round(view.sy(zone.kind === 'channel' ? zone.y1 - 0.14 : zone.y0 + 0.17));
        const strip = (mode, clearance) => {
          const canvas = document.createElement('canvas');
          canvas.width = view.width; canvas.height = view.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          draw(ctx, document.createElement('canvas').getContext('2d'), {
            mode, mission: { ...mission, clearance }, view, members, scenery, time: 0, particles: [],
            theme: THEMES.jungle, parked: sim.car, sim: mode === 'test' ? sim : null,
          });
          return ctx.getImageData(x, y, 12, 1).data.join();
        };
        return {
          kind: zone.kind, height: zone.y0 - mission.deck,
          marked: strip('build', zone) !== strip('build', null),
          testing: strip('test', zone) !== strip('test', null),
        };
      });
      assert.equal(bands.kind, rule);
      assert.match(await note.innerText(), rule === 'channel' ? /boats/ : new RegExp(`${bands.height} m`));
      assert.ok(bands.marked && !bands.testing, `${rule}: the boundary is marked in the editor only`);
      await page.click('[data-action="test"]');
      assert.equal(await note.isVisible(), false, `${rule}: the construction note hides during a crossing`);
    }
  } finally {
    await page.setViewportSize(original);
  }
}
