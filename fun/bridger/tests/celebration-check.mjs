import assert from 'node:assert/strict';

export async function checkCelebration(page) {
  const { crossings, duration } = await page.evaluate(async () => {
    const { createMission } = await import('./js/mission.js');
    const { createSim } = await import('./js/physics.js');
    const { createView } = await import('./js/render.js');
    const { BURST_AT, CELEBRATION_LENGTH, createCelebration, drawConfetti, drawVictoryGlow } = await import('./js/celebration.js');
    const crossings = [];
    for (const seed of ['check0', 'check3', 'check2']) {
      const mission = createMission('easy', seed);
      const sim = createSim(mission, mission.reference);
      if (!sim.run()) throw new Error(`Proof failed to cross river ${seed}`);
      const effect = createCelebration(mission, sim, false);
      const still = createCelebration(mission, sim, true);
      const surviving = sim.beams.filter((b) => !b.broken && !b.piece);
      const roads = new Set(), supports = new Set();
      function touches(p, beam) {
        const a = sim.nodes[beam.a], b = sim.nodes[beam.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
        return u >= -1e-6 && u <= 1 + 1e-6 && Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy) < 1e-6;
      }
      let offBridge = 0;
      for (const p of effect.confetti) {
        const on = surviving.filter((b) => touches(p, b));
        if (!on.length) offBridge++;
        const third = Math.min(2, Math.floor(3 * (p.x - mission.left) / (mission.right - mission.left)));
        if (on.some((b) => b.road)) roads.add(third);
        else if (on.length) supports.add(third);
      }

      const view = createView(mission, 760, 580, 10, 20);
      const canvas = document.createElement('canvas');
      canvas.width = view.width; canvas.height = view.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      function paint(celebration, elapsed, reduced) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawVictoryGlow(ctx, view, mission, sim, { ...celebration, elapsed }, reduced);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const burst = paint(effect, BURST_AT + 0.1, false);
      const first = paint(still, 0.05, true), last = paint(still, 0.3, true);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawConfetti(ctx, view, { ...effect, elapsed: BURST_AT + 0.35 });
      const flyingPaper = [0, 1, 2].every((third) => {
        const width = (view.sx(mission.right) - view.sx(mission.left)) / 3;
        const x = Math.floor(view.sx(mission.left) + third * width);
        return ctx.getImageData(x, 0, Math.floor(width), canvas.height).data.some((v, i) => i % 4 === 3 && v > 35);
      });
      // Read every surviving segment, including both end panels and truss sides.
      const allLit = (pixels) => surviving.every((beam) => {
        const a = sim.nodes[beam.a], b = sim.nodes[beam.b];
        const x = Math.round(view.sx((a.x + b.x) / 2)), y = Math.round(view.sy((a.y + b.y) / 2));
        return pixels[(y * canvas.width + x) * 4 + 3] > 35;
      });
      crossings.push({
        vehicle: mission.vehicle, span: mission.span, offBridge,
        roads: [...roads].sort(), supports: [...supports].sort(),
        glow: allLit(burst), flyingPaper, stillGlow: allLit(first), stillPaper: still.confetti.length,
        frozen: first.every((value, i) => value === last[i]),
      });
    }
    return { crossings, duration: CELEBRATION_LENGTH };
  });
  assert.equal(new Set(crossings.map((c) => c.vehicle)).size, 3);
  assert.equal(new Set(crossings.map((c) => c.span)).size, 3);
  for (const c of crossings) {
    assert.equal(c.offBridge, 0, `${c.vehicle}: every launch sits on a surviving member`);
    assert.deepEqual(c.roads, [0, 1, 2], `${c.vehicle}: the deck launches paper across the span`);
    assert.deepEqual(c.supports, [0, 1, 2], `${c.vehicle}: the trusses launch paper across the span`);
    assert.ok(c.flyingPaper, `${c.vehicle}: the flying paper is visible across the span`);
    assert.ok(c.glow && c.stillGlow, `${c.vehicle}: the glow follows the whole bridge`);
    assert.equal(c.stillPaper, 0, `${c.vehicle}: reduced motion creates no confetti`);
    assert.ok(c.frozen, `${c.vehicle}: the reduced-motion highlight stays still`);
  }

  const game = await page.context().browser().newPage({ viewport: { width: 960, height: 600 }, reducedMotion: 'no-preference' });
  try {
    const river = new URL('./#easy-check2', page.url());
    await game.route('**/*', (route) => route.request().url().startsWith(river.origin) ? route.continue() : route.abort());
    await game.addInitScript(() => {
      localStorage.setItem('bridger-seen-help', '1');
      localStorage.setItem('bridger-sound', 'off');
    });
    await game.goto(river.href);
    await game.waitForFunction(() => window.bridger?.mission);
    await game.click('[data-action="solution"]');
    await game.waitForFunction(() => bridger.members.some((m) => m.mat !== 'road'));
    const go = game.locator('[data-action="test"]');
    await go.click();
    await game.waitForFunction(() => bridger.sim.time > 0);
    await game.click('[data-action="help"]');
    const paused = await game.evaluate(() => bridger.sim.time);
    await game.waitForTimeout(220);
    assert.equal(await game.evaluate(() => bridger.sim.time), paused, 'Help pauses a crossing');
    await game.click('[data-dialog="help"] button');
    await game.waitForFunction((time) => bridger.sim.time > time, paused);
    const axlesAtWin = await game.evaluate(() => {
      if (!bridger.sim.run()) throw new Error('The train failed to cross');
      return bridger.sim.car.axles.map(({ x, angle }) => ({ x, angle }));
    });
    await game.waitForFunction(() => document.querySelector('[data-win-note]').textContent);
    await game.waitForFunction((axles) => bridger.sim.car.axles.every((axle, i) =>
      axle.x > axles[i].x + 0.25 && axle.angle > axles[i].angle + 0.1), axlesAtWin, { timeout: 5000 });
    const card = game.locator('[data-dialog="win"]');
    assert.equal(await card.evaluate((dialog) => dialog.open), false, 'The animation plays before the win card');
    await go.click();
    await game.waitForTimeout((duration + 0.3) * 1000);
    assert.equal(await card.evaluate((dialog) => dialog.open), false, 'Stop cancels the pending win card');
    await game.emulateMedia({ reducedMotion: 'reduce' });
    await go.click();
    await game.evaluate(() => {
      // Open Help on the winning frame, before the brief still highlight ends.
      const observer = new MutationObserver(() => {
        observer.disconnect();
        document.querySelector('[data-action="help"]').click();
      });
      observer.observe(document.querySelector('[data-win-note]'), { childList: true });
      if (!bridger.sim.run()) throw new Error('The same solution failed on replay');
    });
    await game.locator('[data-dialog="help"]').waitFor({ state: 'visible' });
    await game.waitForTimeout(650);
    assert.equal(await card.evaluate((dialog) => dialog.open), false, 'Help also pauses the win card countdown');
    const oldEdge = await game.evaluate(() => bridger.view.wx(bridger.view.width));
    await game.setViewportSize({ width: 1440, height: 600 });
    await game.waitForFunction((edge) => bridger.view.wx(bridger.view.width) > edge + 4, oldEdge);
    const departure = await game.evaluateHandle(async () => {
      const { drawVehicle } = await import('./js/render.js');
      const { image } = await import('./js/art.js');
      await Promise.all(['loco', 'wagon', 'wheel-rail'].map((name) => image(name).decode()));
      const dialog = document.querySelector('[data-dialog="win"]');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      function paint(compareWithStage = false) {
        const { sim, view } = bridger;
        canvas.width = view.width; canvas.height = view.height;
        ctx.imageSmoothingQuality = 'high';
        const { id, def, axles } = sim.car;
        drawVehicle(ctx, view, { id, def, axles });
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const stage = compareWithStage && document.querySelector('#stage').getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0, opaque = 0, matching = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i + 3] > 5) visible++;
          if (!stage || rgba[i + 3] < 250) continue;
          opaque++;
          if ([0, 1, 2].every((c) => Math.abs(stage[i + c] - rgba[i + c]) <= 6)) matching++;
        }
        return { visible, opaque, matching };
      }
      // Sample the game's exact pose when the card opens, before the next frame can advance.
      const pixelsAtOpen = new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (!dialog.open) return;
          observer.disconnect();
          resolve(paint().visible);
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
      });
      return { paint, pixelsAtOpen, angles: bridger.sim.car.axles.map((axle) => axle.angle) };
    });
    await game.click('[data-dialog="help"] button');
    await game.waitForFunction((edge) => document.querySelector('[data-dialog="win"]').open ||
      bridger.sim.car.axles.at(-1).x > edge + 2, oldEdge, { timeout: 15000 });
    assert.equal(await card.evaluate((dialog) => dialog.open), false, 'the widened view keeps the win card waiting');
    const { opaque, matching } = await departure.evaluate((d) => d.paint(true));
    assert.ok(opaque > 20 && matching > opaque / 2, 'the last wagon remains painted on the game canvas in the wider viewport');
    assert.ok(await departure.evaluate((d) => bridger.sim.car.axles.every((axle, i) => axle.angle > d.angles[i] + 1)),
      'all train wheels keep rolling under reduced motion');
    await card.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await departure.evaluate((d) => d.pixelsAtOpen), 0, 'even the last painted wagon buffer has left before the card opens');
    await departure.dispose();
    await game.click('[data-action="improve"]');
    assert.equal(await game.evaluate(() => bridger.sim), null, 'A replay victory returns to the builder');
  } finally {
    await game.close();
  }
}
