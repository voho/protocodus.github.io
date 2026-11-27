import assert from 'node:assert/strict';
import { createShotCamera } from '../camera-follow.js';
import { FortressSimulation } from '../simulation.js';

for (const [width, height, top, bottom] of [
  [1440, 900, 145, 695],
  [390, 844, 155, 560],
  [812, 375, 90, 215],
]) {
  const fitScale = Math.min(width / 1200, (bottom - top) / 335);
  const screen = { width, height, top, bottom, fitScale };
  const base = {
    x: (1200 - width / fitScale) / 2,
    y: 389 - bottom / fitScale,
    width: width / fitScale,
    height: height / fitScale,
  };
  for (const reduced of [false, true]) {
    const sim = new FortressSimulation('large', 6);
    const camera = createShotCamera();
    let concurrent = 0,
      followed = false,
      sawImpact = false;
    let view = base;
    const dt = 1 / 60;
    function visible(x, y, radius = 0) {
      const sx = ((x - view.x) / view.width) * width;
      const sy = ((y - view.y) / view.height) * height;
      const r = (radius * width) / view.width;
      assert.ok(
        sx - r >= -0.01 && sx + r <= width + 0.01 && sy - r >= top - 0.01 && sy + r <= bottom + 0.01,
        'The complete projectile/impact must fit between the visible HUD edges',
      );
    }
    for (let frame = 0; frame < 900; frame++) {
      if ([0, 24, 48].includes(frame)) assert.ok(sim.fire('small-stone', frame === 24 ? 25 : 70, 100));
      sim.update(dt);
      const events = sim.drainEvents();
      view = camera.update(base, screen, sim, events, dt, reduced);
      const shots = sim.bodies.filter((e) => e.kind === 'projectile' && e.lastImpact < 0 && !e.body.isSleeping);
      for (const e of shots) visible(e.x, e.y, e.radius);
      for (const impact of events.filter((e) => e.type === 'impact' || e.type === 'explosion')) {
        visible(impact.x, impact.y);
        sawImpact = true;
      }
      concurrent = Math.max(concurrent, shots.length);
      if (view.width < base.width * 0.92) followed = true;
    }
    assert.ok(concurrent >= 2 && sawImpact);
    if (!reduced) assert.ok(followed, 'A single impact gets a closer view');
    assert.equal(view, base, 'The camera eases back to the original view after the volley');
  }
}
console.log(
  'Fortress camera passed high and low overlapping shots, impacts, return framing, reduced motion and three viewport sizes.',
);
