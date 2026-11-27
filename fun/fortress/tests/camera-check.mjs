import assert from 'node:assert/strict';
import { createShotCamera } from '../camera-follow.js';
import { FortressSimulation, generateLevel, WORLD } from '../simulation.js';

const dt = 1 / 60;
const roomyScreen = { width: 1200, height: 675, top: 90, bottom: 590, fitScale: 1 };
const overview = { x: 0, y: -60, width: 1200, height: 675 };

function assertVisible(view, screen, x, y, radius = 0) {
  const sx = (x - view.x) * screen.width / view.width;
  const sy = (y - view.y) * screen.height / view.height;
  const r = radius * screen.width / view.width;
  assert.ok(
    sx - r >= -0.01 && sx + r <= screen.width + 0.01 && sy - r >= screen.top - 0.01 && sy + r <= screen.bottom + 0.01,
    'The complete projectile or impact must fit between the visible HUD edges',
  );
}

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

// The two low, full-power shots hit opposite walls well before the endpoints
// of their terrain-only trajectory previews. The wider framing already fits
// both flights. A closer manual zoom needs to widen just once to admit them.
{
  const screen = { ...roomyScreen, top: 40, bottom: 605 };
  const centerX = (WORLD.release.x + WORLD.rightRelease.x) / 2;
  const fullWidth = WORLD.rightRelease.x - WORLD.release.x + 92;
  for (const width of [fullWidth, fullWidth / 2]) {
    const base = {
      x: centerX - width / 2, y: 158 - width * screen.height / screen.width / 2,
      width, height: width * screen.height / screen.width,
    };
    const sim = new FortressSimulation('large', 6);
    const camera = createShotCamera(), fixedCrew = createShotCamera();
    for (const side of ['right', 'left', 'right']) {
      sim.selectSide(side);
      assert.deepEqual(camera.update(base, screen, sim, [], dt, false), base, 'Choosing a crew preserves the manual view');
    }
    const impacts = [], struckFlanks = new Set();
    const secondLaunch = width === fullWidth ? 6 : 0;
    let peakWidth = 0, overlap = false;
    for (let frame = 0; frame < 175; frame++) {
      if (frame === 0) {
        sim.selectSide('left');
        assert.ok(sim.fire('small-stone', 29, 100));
      }
      if (frame === secondLaunch) {
        sim.selectSide('right');
        assert.ok(sim.fire('small-stone', 29, 100));
      }
      sim.update(dt);
      const events = sim.drainEvents();
      sim.selectSide('left');
      const unchangedSelection = fixedCrew.update(base, screen, sim, events, dt, false);
      sim.selectSide(frame % 2 ? 'left' : 'right');
      const view = camera.update(base, screen, sim, events, dt, false);
      assert.deepEqual(view, unchangedSelection, 'Switching crews during the volley must not move the camera');
      peakWidth = Math.max(peakWidth, view.width);
      if (width === fullWidth) assert.deepEqual(view, base, 'A visible crossfire should leave the camera completely steady');
      const shots = [...sim.projectiles].filter((shot) => !shot.body.isSleeping);
      overlap ||= shots.filter((shot) => shot.lastImpact < 0).length >= 2;
      for (const shot of shots) assertVisible(view, screen, shot.x, shot.y, shot.radius);
      for (const event of events) {
        if (event.type !== 'impact') continue;
        impacts.push({ x: event.x, y: event.y, frame });
        struckFlanks.add(event.x < centerX ? 'left' : 'right');
      }
      for (const hit of impacts) {
        if (frame - hit.frame <= 30) assertVisible(view, screen, hit.x, hit.y, 5);
      }
    }
    assert.ok(overlap && struckFlanks.size === 2, 'Both crews fire concurrently and land separate hits');
    assert.ok(peakWidth <= fullWidth + 0.01, 'A clear view of both shots and their impacts needs no extra zoom out');
    if (width < fullWidth) assert.ok(peakWidth > width, 'The close-up widens to fit projectiles on opposite flanks');
  }
}

function velocity(previous, view) {
  return [
    (view.x + view.width / 2 - previous.x - previous.width / 2) / (overview.width * dt),
    (view.y + view.height / 2 - previous.y - previous.height / 2) / (overview.height * dt),
    Math.log(previous.width / view.width) / dt,
  ];
}

// A shot that overshoots either flank or rises far above the battlements
// shares the frame with the battlefield, even after only its impact remains.
{
  const screen = { width: 800, height: 400, top: 30, bottom: 375,
    playBounds: { left: 0, right: 1100, top: 130, bottom: 320 } };
  const base = { x: 150, y: -30, width: 800, height: 400 };
  for (const reduced of [false, true]) {
    const views = [];
    for (const direction of [-1, 1]) {
      const camera = createShotCamera();
      const shot = { x: 550, y: 230, radius: 12, born: 0, contacts: new Set(), lastImpact: -1,
        body: { speed: 4 } };
      const sim = { time: 0, projectiles: new Set([shot]) };
      let view;
      for (let frame = 0; frame <= 900; frame++) {
        sim.time = frame * dt;
        let events = [];
        if (frame <= 100) {
          shot.x = 550 + frame * 10 * direction;
          shot.y = 230 - 580 * Math.sin(Math.PI * frame / 110);
        }
        if (frame === 101) {
          sim.projectiles.clear();
          events = [{ type: 'explosion', x: shot.x, y: shot.y, radius: 36 }];
        }
        view = camera.update(base, screen, sim, events, dt, reduced);
        if (frame === 0) assert.deepEqual(view, base, 'A visible shot leaves an already useful field view still');
        if (frame <= 175) {
          assertVisible(view, screen, shot.x, shot.y, 11);
          assertVisible(view, screen, 550, 310);
        }
        if (frame === 61 || frame === 100) {
          assert.ok(view.width > base.width, 'Tracking widens for the shot and lower keep together');
          if (direction === -1) views.push(view);
          else {
            const mirror = views.shift();
            assert.ok(Math.abs(mirror.width - view.width) < .01 &&
              Math.abs(1100 - mirror.x - mirror.width - view.x) < .01);
          }
        }
      }
      assert.equal(view, base, 'The original field framing returns after the miss');
    }
  }
}

// The returning lob was in flight when the other crew hit. Keep the first
// landing visible even after the usual impact linger would have expired.
{
  const screen = { width: 600, height: 380, top: 30, bottom: 350 };
  const base = { x: 550, y: -80, width: 600, height: 380 };
  const lob = { x: 850, y: 90, born: 0, radius: 12, lastImpact: -1, contacts: new Set(), body: { speed: 4 } };
  const sim = { time: 0, projectiles: new Set([lob]) };
  const camera = createShotCamera();
  const first = { type: 'impact', x: 20, y: 220, size: 22 };
  const second = { type: 'explosion', x: 1030, y: 180, radius: 120 };
  for (let frame = 0; frame < 230; frame++) {
    sim.time = frame * dt;
    lob.x = 850 + Math.min(frame, 200) * 0.9;
    if (frame === 200) sim.projectiles.clear();
    const events = frame === 12 ? [first] : frame === 200 ? [second] : [];
    const view = camera.update(base, screen, sim, events, dt, true);
    if (frame >= 12) assertVisible(view, screen, first.x, first.y, first.size / 2);
    if (frame < 200) assertVisible(view, screen, lob.x, lob.y, lob.radius);
    else assertVisible(view, screen, second.x, second.y, second.radius * 0.3);
  }
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
  const fieldWidth = WORLD.maxX - WORLD.minX;
  const fitScale = Math.min(width / fieldWidth, (bottom - top) / crestRise);
  const screen = { width, height, top, bottom, fitScale, playBounds: {
    left: WORLD.minX, right: WORLD.maxX, top: WORLD.ground - crestRise, bottom: WORLD.ground,
  } };
  const base = {
    x: (WORLD.minX + WORLD.maxX - width / fitScale) / 2,
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
    for (let frame = 0; frame < 900; frame++) {
      // The two high arcs use the extended draw. The middle shot lands on the
      // approach and gives the camera a visible impact while the others fly.
      if (frame === 0 || frame === 20) assert.ok(sim.fire('small-stone', 70, 100));
      if (frame === 10) {
        sim.selectSide('right');
        assert.ok(sim.fire('small-stone', 25, 55));
        sim.selectSide('left');
      }
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
      for (const e of shots) assertVisible(view, screen, e.x, e.y, e.radius);
      for (const impact of events.filter((e) => e.type === 'impact' || e.type === 'explosion')) {
        assertVisible(view, screen, impact.x, impact.y);
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
  'Fortress camera passed stationary crossfire, minimum volley zoom, smooth acceleration and coasting, projectile and impact visibility, return framing and reduced motion on three viewport sizes.',
);
