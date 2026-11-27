import assert from 'node:assert/strict';
import { createShotCamera } from '../camera-follow.js';
import { FortressSimulation, generateLevel, WORLD } from '../simulation.js';

const dt = 1 / 60;
const roomyScreen = { width: 1200, height: 675, top: 90, bottom: 590, fitScale: 1 };
const overview = { x: 0, y: -60, width: 1200, height: 675 };

// The whole low arc and its landing fit comfortably between the HUD edges.
// Even a volley and repeated impacts should leave the player's framing alone.
{
  const sim = new FortressSimulation('large', 6);
  const camera = createShotCamera();
  let sawImpact = false;
  for (let frame = 0; frame < 360; frame++) {
    if (frame === 0 || frame === 24) assert.ok(sim.fire('small-stone', 35, 35));
    sim.update(dt);
    const events = sim.drainEvents();
    sawImpact ||= events.some((event) => event.type === 'impact');
    const view = camera.update(overview, roomyScreen, sim, events, dt, false);
    assert.deepEqual(view, overview, 'A fully visible volley and its impacts leave the camera still');
  }
  assert.ok(sawImpact);
}

function velocity(previous, view) {
  return [
    (view.x + view.width / 2 - previous.x - previous.width / 2) / (overview.width * dt),
    (view.y + view.height / 2 - previous.y - previous.height / 2) / (overview.height * dt),
    Math.log(previous.width / view.width) / dt,
  ];
}

// A high arc needs more sky. Once the camera builds speed, interrupt the
// flight with an early hit and check that the movement decelerates smoothly.
{
  const sim = new FortressSimulation('large', 6);
  const camera = createShotCamera();
  assert.ok(sim.fire('small-stone', 70, 100));
  const [shot] = sim.projectiles;
  let view = overview;
  let firstMovingFrame;
  let firstSpeed;
  let checkedCoast = false;
  for (let frame = 0; frame < 120; frame++) {
    sim.update(dt);
    const next = camera.update(overview, roomyScreen, sim, sim.drainEvents(), dt, false);
    const motion = velocity(view, next);
    const speed = Math.hypot(...motion);
    view = next;
    if (firstMovingFrame === undefined && speed > 1e-5) {
      firstMovingFrame = frame;
      firstSpeed = speed;
      assert.ok(speed < 0.035, 'A necessary reframing starts gently from rest');
    }
    if (firstMovingFrame === undefined || frame - firstMovingFrame !== 15) continue;
    assert.ok(speed > firstSpeed * 1.75, 'The tracking movement gains momentum over several frames');
    const hit = { type: 'impact', x: shot.x, y: shot.y };
    sim.remove(shot);
    sim.update(dt);
    const after = camera.update(overview, roomyScreen, sim, [hit], dt, false);
    const coast = velocity(view, after);
    const retained = coast.reduce((dot, value, i) => dot + value * motion[i], 0) / speed ** 2;
    assert.ok(retained > 0.4, 'An early impact allows the camera to coast before it settles');
    checkedCoast = true;
    break;
  }
  assert.ok(checkedCoast, 'The high arc exercised camera acceleration and settling');
}

for (const [width, height, top, bottom] of [
  [1440, 900, 145, 695],
  [390, 844, 155, 560],
  [812, 375, 90, 215],
]) {
  const wards = generateLevel('large', 6).sections;
  const crestRise = Math.max(...wards.map((ward) =>
    WORLD.ground - ward.base + Math.max(...ward.heights) * ward.storey + 45));
  const fitScale = Math.min(width / WORLD.width, (bottom - top) / crestRise);
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
      sawImpact = false;
    let view = base,
      maxPanRate = 0,
      maxZoomRate = 0;
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
      // The two high arcs use the extended draw. The middle shot lands on the
      // approach and gives the camera a visible impact while the others fly.
      if (frame === 0 || frame === 20) assert.ok(sim.fire('small-stone', 70, 100));
      if (frame === 10) assert.ok(sim.fire('small-stone', 25, 55));
      sim.update(dt);
      const events = sim.drainEvents();
      const previous = view;
      view = camera.update(base, screen, sim, events, dt, reduced);
      assert.ok(view.width >= base.width - 0.001, 'Automatic tracking respects the chosen overview zoom');
      const dx = (view.x + view.width / 2 - previous.x - previous.width / 2) / view.width;
      const dy = (view.y + view.height / 2 - previous.y - previous.height / 2) / view.height;
      maxPanRate = Math.max(maxPanRate, Math.hypot(dx, dy) / dt);
      maxZoomRate = Math.max(maxZoomRate, Math.log(previous.width / view.width) / dt);
      const shots = sim.bodies.filter((e) => e.kind === 'projectile' && e.lastImpact < 0 && !e.body.isSleeping);
      for (const e of shots) visible(e.x, e.y, e.radius);
      for (const impact of events.filter((e) => e.type === 'impact' || e.type === 'explosion')) {
        visible(impact.x, impact.y);
        sawImpact = true;
      }
      concurrent = Math.max(concurrent, shots.length);
    }
    assert.ok(concurrent >= 2 && sawImpact);
    if (!reduced) {
      assert.ok(maxPanRate < 0.48, 'Tracking a volley should never whip across the viewport');
      assert.ok(maxZoomRate < 0.24, 'Return from a wider framing builds gradually');
    }
    assert.equal(view, base, 'The camera eases back to the original view after the volley');
  }
}
console.log(
  'Fortress camera passed stationary volleys, smooth acceleration and coasting, projectile and impact visibility, return framing and reduced motion on three viewport sizes.',
);
