// Real mission collisions: continuous patrol movement and cover approaches.
// The child processes also keep the deterministic AI random stream local to
// each mission, so adding another mission cannot change the earlier checks.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { aiFixture, advance, forceCombat, soldier } from './ai-fixture.mjs';

function assertBodyRoute(world, from, path, label, height = 1.7) {
  assert.ok(path?.length, `${label}: no route`);
  let previous = { ...from, y: world.groundAt(from.x, from.z, world.terrain?.height(from.x, from.z) ?? 0, .45) };
  for (const point of path) {
    const count = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z) / .1));
    let y = previous.y;
    for (let i = 1; i <= count; i++) {
      const x = previous.x + (point.x - previous.x) * i / count, z = previous.z + (point.z - previous.z) * i / count;
      const ground = world.groundAt(x, z, y, .45), body = { x, z };
      assert.ok(Math.abs(ground - y) < .451, `${label}: route requires a step of ${ground - y}m at ${x},${z}`);
      world.pushOut(body, .35, ground, height, .45);
      assert.ok(Math.hypot(body.x - x, body.z - z) < .03, `${label}: standing body hits an obstacle at ${x},${z}`);
      y = ground;
    }
    previous = { ...point, y };
  }
}

if (!process.env.HEDGEROW_LEVEL) {
  const { createWorld, MOVE } = await import('../js/world.js');
  const { createNav } = await import('../js/nav.js');
  const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };
  const world = createWorld({ minX: -8, maxX: 8, minZ: -8, maxZ: 8, terrain });
  // The wall falls between grid centres: both adjacent cells are clear.
  world.add({ type: 'box', x: 0, y: 1, z: 0, hx: .1, hy: 1, hz: 3.2, yaw: 0 });
  const nav = createNav(world, world.bounds);
  assert.ok(nav.walkable(-1, 0) && nav.walkable(1, 0), 'the wall leaves both cell centres walkable');
  const path = nav.findPath(-3, 1, 3, 1);
  assert.ok(path, 'a route exists around the end of the wall');
  let previous = { x: -3, z: 1 };
  for (const point of path) {
    assert.ok(nav.lineClear(previous.x, previous.z, point.x, point.z), `adjacent cells may not cross a thin wall: ${JSON.stringify({ previous, point })}`);
    previous = point;
  }
  console.log('ok    a thin wall between clear grid cells is routed around');
  const beamWorld = createWorld({ minX: -8, maxX: 8, minZ: -8, maxZ: 8, terrain });
  beamWorld.add({ type: 'box', x: 0, y: 1.5, z: 0, hx: .1, hy: .2, hz: 3.2, yaw: 0 });
  const beamNav = createNav(beamWorld, beamWorld.bounds), beamPath = beamNav.findPath(-3, 1, 3, 1);
  assert.ok(beamPath, 'a standing man can go around a low cross-beam');
  previous = { x: -3, z: 1 };
  for (const point of beamPath) {
    assert.ok(beamWorld.clear(previous.x, 1.4, previous.z, point.x, 1.4, point.z, MOVE), 'a clear knee-height ray cannot route a standing body through a cross-beam');
    previous = point;
  }
  console.log('ok    standing routes also clear chest-height beams');
  for (const height of [1, 1.68]) {
    const barWorld = createWorld({ minX: -8, maxX: 8, minZ: -8, maxZ: 8, terrain });
    barWorld.add({ type: 'box', x: 0, y: height, z: 0, hx: .1, hy: .025, hz: 3.2, yaw: 0 });
    const barNav = createNav(barWorld, barWorld.bounds);
    assertBodyRoute(barWorld, { x: -3, z: 1 }, barNav.findPath(-3, 1, 3, 1), `thin beam at ${height}m`);
  }
  console.log('ok    thin obstacles between knee and chest rays, and at head height, clear the entire body');

  const cornerWorld = createWorld({ minX: -8, maxX: 8, minZ: -8, maxZ: 8, terrain });
  cornerWorld.add({ type: 'box', x: -1, y: 1, z: 1, hx: .45, hy: 1, hz: .45, yaw: 0 });
  const cornerNav = createNav(cornerWorld, cornerWorld.bounds), cornerStart = { x: -1.9, z: .55 };
  assert.equal(cornerNav.walkable(cornerStart.x, cornerStart.z), false, 'the clear starting point shares a cell with an obstructed centre');
  const cornerPath = cornerNav.findPath(cornerStart.x, cornerStart.z, 7, 7);
  assertBodyRoute(cornerWorld, cornerStart, cornerPath, 'initial connector beside a blocked centre');
  assert.ok(Math.hypot(cornerPath.at(-1).x - 7, cornerPath.at(-1).z - 7) < .1);
  console.log('ok    a clear point beside a blocked grid centre joins from its own side of the obstacle');

  const bendWorld = createWorld({ minX: -8, maxX: 8, minZ: -8, maxZ: 8, terrain });
  for (const b of [
    { x: -.8, z: .6, hx: 3.2, hz: .1 }, { x: -.2, z: -.6, hx: 3.8, hz: .1 },
    { x: -4, z: 0, hx: .1, hz: .6 }, { x: 3.6, z: 1.6, hx: .1, hz: 2.2 },
    { x: 2.4, z: 2.2, hx: .1, hz: 1.6 },
  ]) bendWorld.add({ type: 'box', yaw: 0, y: 1, hy: 1, ...b });
  const bendNav = createNav(bendWorld, bendWorld.bounds), bendPath = bendNav.findPath(0, 0, 3, 7);
  assertBodyRoute(bendWorld, { x: 0, z: 0 }, bendPath, 'a narrow bent corridor');
  assert.ok(Math.hypot(bendPath.at(-1).x - 3, bendPath.at(-1).z - 7) < .1, 'a body-sized corridor can join the coarse walk grid around its actual bend');
  const closeStart = { x: 0, z: .16 }, closePath = bendNav.findPath(closeStart.x, closeStart.z, 3, 7);
  assertBodyRoute(bendWorld, closeStart, closePath, 'a valid body just inside the nav safety inflation', 1.78);
  assert.ok(Math.hypot(closePath.at(-1).x - 3, closePath.at(-1).z - 7) < .1, 'a centimetre of safety inflation cannot strand a valid body beside a wall');
  const { G: bendGame, enemies: bendEnemies } = aiFixture({ world: bendWorld, terrain, nav: bendNav, player: [0, 100], definitions: [soldier(0, 0, { patrol: [[3, 7]] })] });
  bendGame.player.visible = 0;
  let walkedBend = false;
  advance(bendGame, bendEnemies, 12, () => {
    const e = bendEnemies.list[0], p = { x: e.pos.x, z: e.pos.z };
    bendWorld.pushOut(p, .34, e.pos.y, 1.7, .45);
    assert.ok(Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < .03, 'the actual patrol body stays outside the corridor walls');
    if (Math.hypot(e.pos.x - 3, e.pos.z - 7) < .6) { walkedBend = true; return false; }
  });
  assert.ok(walkedBend, 'the soldier actually walks the narrow bend and leaves the corridor');
  bendWorld.add({ type: 'box', yaw: 0, x: 3, y: 1, z: 3.8, hx: .6, hy: 1, hz: .1 });
  const sealedNav = createNav(bendWorld, bendWorld.bounds), sealedPath = sealedNav.findPath(0, 0, 3, 7);
  if (sealedPath) {
    assertBodyRoute(bendWorld, { x: 0, z: 0 }, sealedPath, 'a closed narrow corridor');
    assert.ok(Math.hypot(sealedPath.at(-1).x - 3, sealedPath.at(-1).z - 7) > 1, 'the finer connector cannot cross a closed end wall');
  }
  console.log('ok    a bounded local route walks a narrow bend, while a closed end still blocks it');
  const trenchTerrain = { height: (x, z) => Math.abs(z) < .45 && Math.abs(x) < 3.2 ? -1.2 : 0, raycast: () => Infinity };
  const trenchWorld = createWorld({ minX: -8, maxX: 8, minZ: -8, maxZ: 8, terrain: trenchTerrain });
  const trenchNav = createNav(trenchWorld, trenchWorld.bounds), trenchPath = trenchNav.findPath(-1, -3, -1, 3);
  assert.ok(trenchPath, 'the route can go around the end of a narrow trench');
  previous = { x: -1, y: 0, z: -3 };
  for (const point of trenchPath) {
    const count = Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z) / .2);
    let y = previous.y;
    for (let i = 1; i <= count; i++) {
      const x = previous.x + (point.x - previous.x) * i / count, z = previous.z + (point.z - previous.z) * i / count;
      const ground = trenchWorld.groundAt(x, z, y, .45);
      assert.ok(Math.abs(ground - y) <= .45, 'a route cannot sail across a trench between two level cell centres');
      y = ground;
    }
    previous = { ...point, y };
  }
  console.log('ok    a trench between level grid centres is walked around on continuous footing');
  if (process.env.HEDGEROW_COLLIDER_FLAT_ONLY !== '1') {
    const { MISSIONS } = await import('../js/missions.js');
    for (const mission of MISSIONS) process.stdout.write(execFileSync(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, HEDGEROW_LEVEL: mission.id, NODE_NO_WARNINGS: '1' }, encoding: 'utf8' }));
  }
} else {
  const { L, world, terrain } = await import('./level-world.mjs');
  const { createNav } = await import('../js/nav.js');
  const { SHOT } = await import('../js/world.js');
  const nav = createNav(world, L.playBounds);

  for (const d of L.enemies.filter(e => e.patrol)) {
    const { G, enemies } = aiFixture({ world, terrain, level: L, nav, player: d.at, definitions: [d] });
    G.player.visible = 0;
    const reached = d.patrol.map(() => false), e = enemies.list[0];
    advance(G, enemies, 240, () => {
      for (const [j, p] of d.patrol.entries()) if (Math.hypot(e.pos.x - p[0], e.pos.z - p[1]) < 1.5) reached[j] = true;
      const p = { x: e.pos.x, z: e.pos.z };
      world.pushOut(p, .34, e.pos.y, 1.7, .45);
      assert.ok(Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < .08, `${L.id} ${d.group}: patrol body intersected a collider at ${e.pos.toArray()}`);
      return !reached.every(Boolean);
    });
    assert.ok(reached.every(Boolean), `${L.id} ${d.group}: patrol did not reach all waypoints (${reached})`);
  }
  console.log(`ok    ${L.id}: every authored patrol physically reaches every waypoint`);

  const scenarios = {
    'saint-clair': { at: [-3.5, 125], target: [-5, 101] },
    'la-varenne': { at: [10, 170], target: [11, 147] },
    'pont-tournant': { at: [-30, 78], target: [-5, 79] },
  };
  const scenario = scenarios[L.id];
  if (scenario) {
    const { G, enemies } = aiFixture({ world, terrain, level: L, nav, player: scenario.target, definitions: [soldier(...scenario.at, { yaw: 180, leash: 18 })] });
    G.player.visible = 0;
    const e = enemies.list[0];
    forceCombat(e, G, { phase: 'move' }); e.patience = 100; e.perceiveTimer = 1e6;
    let reached = false;
    advance(G, enemies, 8, () => {
      const p = { x: e.pos.x, z: e.pos.z };
      world.pushOut(p, .34, e.pos.y, 1.7, .45);
      assert.ok(Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < .08, `${L.id}: cover movement left a body inside an obstacle`);
      if (e.cover && e.phase === 'hide' && Math.hypot(e.pos.x - e.cover.x, e.pos.z - e.cover.z) < .25) {
        assert.equal(world.clear(e.pos.x, e.pos.y + .95, e.pos.z, G.player.pos.x, G.player.pos.y + 1.2, G.player.pos.z, SHOT), false, `${L.id}: the actual arrival point must protect the crouched body`);
        reached = true;
        return false;
      }
    });
    assert.ok(reached, `${L.id}: failed to physically reach usable cover in eight seconds (at ${e.pos.toArray()}, ${e.phase})`);
    console.log(`ok    ${L.id}: known obstructed cover encounter reaches real shelter without body overlap`);
  }

  if (L.id === 'saint-clair') {
    const from = { x: -3.5, z: 125 }, goal = { x: -3.52600310323351, z: 127.28172729054539 };
    assert.deepEqual(nav.nearest(from.x, from.z), nav.nearest(goal.x, goal.z), 'the regression really does share a snapped grid cell');
    assert.equal(nav.lineClear(from.x, from.z, goal.x, goal.z), false, 'the crate physically blocks that direct line');
    const path = nav.findPath(from.x, from.z, goal.x, goal.z);
    assert.ok(!path || path.length > 1 || Math.hypot(path[0].x - goal.x, path[0].z - goal.z) > .1, 'sharing a snapped cell cannot manufacture a path through the crate');
    console.log('ok    a blocked same-cell goal cannot manufacture a route through a crate');

    const streetStart = { x: -3.927101083899897, z: 224.36222306116582 }, streetGoal = { x: 0, z: 200 };
    const route = nav.findPath(streetStart.x, streetStart.z, streetGoal.x, streetGoal.z);
    assert.ok(route, 'the village street has a route around its sandbag bank');
    let previous = streetStart;
    for (const point of route) {
      assert.ok(nav.lineClear(previous.x, previous.z, point.x, point.z), `exact goal adjustment cut a segment through a sandbag bank: ${JSON.stringify({ previous, point })}`);
      previous = point;
    }
    console.log('ok    adjusting a grid route to its exact goal preserves every clear segment');
  }
  if (L.id === 'pont-tournant') {
    const start = { x: 5.6, z: 15.8 }, goal = { x: 3, z: 79 };
    for (const height of [1.7, 1.78]) {
      const bodyNav = height === 1.7 ? nav : createNav(world, L.playBounds, { bodyHeight: height });
      const path = bodyNav.findPath(start.x, start.z, goal.x, goal.z);
      assertBodyRoute(world, start, path, `starting glider wing (${height}m)`, height);
      assert.ok(Math.hypot(path.at(-1).x - goal.x, path.at(-1).z - goal.z) < .2, 'the body-sized route reaches the actual wire approach');
    }
    console.log('ok    the starting route clears the glider for both NPC and full standing-player heights');
  }
  if (L.id === 'la-varenne') {
    const start = { x: 27.5059, z: 140.8225 }, path = nav.findPath(start.x, start.z, 24, 149.881);
    // The narrow curved floor contains isolated coarse cells. Its real
    // walking exit is at the trench end, not through the revetment above.
    assertBodyRoute(world, start, path, 'battery trench floor', 1.78);
    assert.ok(Math.hypot(path.at(-1).x - 24, path.at(-1).z - 149.881) < .2, 'the trench-floor route reaches the real gun interaction point');
    console.log('ok    a narrow trench-floor start follows its physical exit and reaches the gun');
  }
}
