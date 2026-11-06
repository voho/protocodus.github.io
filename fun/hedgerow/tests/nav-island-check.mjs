// A valid coarse-grid centre can still need a local walking exit.
import assert from 'node:assert/strict';
import { aiFixture, soldier, advance } from './ai-fixture.mjs';
const { createWorld } = await import('../js/world.js');
const { createNav } = await import('../js/nav.js');
const terrain = { height: () => 0, surfaceAt: () => 'mud', raycast: () => Infinity };

function fixture(yaw, sealed = false, isolated = false) {
  const world = createWorld({ minX: -12, maxX: 12, minZ: -12, maxZ: 12, terrain });
  const point = (x, z) => ({ x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) });
  for (const box of [
    { x: 2.5, z: .4, hx: 2.2, hz: .1 }, { x: 1.9, z: 1.6, hx: 1.6, hz: .1 },
    { x: .4, z: 1, hx: .1, hz: .6 }, { x: 4.7, z: 3, hx: .1, hz: 2.6 }, { x: 3.3, z: 3.5, hx: .1, hz: 1.9 },
    ...(sealed ? [{ x: 4, z: 5.6, hx: .7, hz: .1 }] : []),
    ...(isolated ? [{ x: 1.6, z: 1, hx: .1, hz: .6 }] : []),
  ]) world.add({ ...box, ...point(box.x, box.z), type: 'box', y: 1, hy: 1, yaw });
  const nav = createNav(world, world.bounds), start = point(1, 1), goal = point(7, 7);
  return { world, nav, start, goal, point };
}

function bodyClear(world, points, radius = .35) {
  for (let leg = 1; leg < points.length; leg++) {
    const a = points[leg - 1], b = points[leg], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .01);
    for (let i = 0; i <= n; i++) {
      const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n, body = { x, z };
      world.pushOut(body, radius, 0, 1.7, .45);
      assert.ok(Math.hypot(body.x - x, body.z - z) < .02001, 'every route segment clears the real standing body');
    }
  }
}

for (const yaw of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
  const { world, nav, start, goal, point } = fixture(yaw);
  assert.ok(nav.walkable(start.x, start.z), 'the valid starting point is already a walkable grid centre');
  assert.equal(nav.lineClear(start.x, start.z, goal.x, goal.z), false, 'a solid corner blocks the direct route');
  bodyClear(world, [start, point(4, 1), point(4, 6.1), goal]);
  const route = nav.findPath(start.x, start.z, goal.x, goal.z);
  assert.ok(route?.length, 'a grid island can join through its actual narrow walking exit');
  assert.ok(Math.hypot(route.at(-1).x - goal.x, route.at(-1).z - goal.z) < .05, 'the route reaches the actual requested goal');
  bodyClear(world, [start, ...route]);
  const f = aiFixture({ world, terrain, nav, player: [-11, -11], definitions: [soldier(start.x, start.z, { patrol: [[goal.x, goal.z]], leash: 30 })] });
  f.G.player.visible = 0; let reached = false;
  advance(f.G, f.enemies, 20, () => {
    const e = f.enemies.list[0], body = { x: e.pos.x, z: e.pos.z };
    world.pushOut(body, .34, e.pos.y, 1.7, .45);
    assert.ok(Math.hypot(body.x - e.pos.x, body.z - e.pos.z) < .03, 'the walking patrol stays outside every wall');
    if (Math.hypot(e.pos.x - goal.x, e.pos.z - goal.z) < .5) { reached = true; return false; }
  });
  assert.ok(reached, 'the actual patrol leaves the isolated grid centre and completes its walking route');

  const blocked = fixture(yaw, true), blockedRoute = blocked.nav.findPath(blocked.start.x, blocked.start.z, blocked.goal.x, blocked.goal.z);
  assert.ok(!blockedRoute || Math.hypot(blockedRoute.at(-1).x - blocked.goal.x, blockedRoute.at(-1).z - blocked.goal.z) > 1, 'a physically sealed exit cannot become a complete route');
  if (blockedRoute) bodyClear(blocked.world, [blocked.start, ...blockedRoute]);
  console.log(`ok    rotated grid island ${yaw}: a body-clear narrow exit is walked, while a sealed passage stays blocked`);
}

for (const maxNodes of [1, 2]) {
  const { world, nav, start, goal } = fixture(0);
  let probes = 0; const pushOut = world.pushOut; world.pushOut = (...args) => { probes++; return pushOut(...args); };
  const route = nav.findPath(start.x, start.z, goal.x, goal.z, maxNodes);
  assert.ok(!route || Math.hypot(route.at(-1).x - goal.x, route.at(-1).z - goal.z) > 1);
  assert.ok(probes < 64, 'a deliberately exhausted budget, including exact component size, cannot trigger the larger local search');
}
console.log('ok    explicit exhausted budgets and exact component equality cannot trigger a fine-grid retry');

{
  const { world, nav, start, goal } = fixture(0, false, true);
  assert.ok(nav.walkable(start.x, start.z));
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2]]) {
    assert.ok(!nav.walkable(start.x + dx, start.z + dz) || !nav.lineClear(start.x, start.z, start.x + dx, start.z + dz), 'the start genuinely forms a one-cell coarse component');
  }
  let probes = 0; const pushOut = world.pushOut; world.pushOut = (...args) => { probes++; return pushOut(...args); };
  assert.equal(nav.findPath(start.x, start.z, goal.x, goal.z, 1), null);
  assert.ok(probes < 64, 'a one-cell component with an exactly exhausted one-node budget cannot spend fine-search probes');
}
console.log('ok    a genuinely isolated one-cell start respects its exact one-node budget');
