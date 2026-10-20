// Run with: node fun/hedgerow/tests/world-check.mjs
// The collision world: rays against boxes, cylinders and a heightfield,
// walking into walls, stepping onto low tops, the river.
import assert from 'node:assert/strict';
import { createWorld, MOVE, SHOT, SIGHT } from '../js/world.js';
import { polylineDistance, rectDistance } from '../js/util.js';

const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

// flat terrain at y = 0 with a simple ray march
const terrain = {
  height: () => 0,
  normal: () => [0, 1, 0],
  surfaceAt: () => 'mud',
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    if (dy >= 0) return Infinity;
    const t = -oy / dy;
    return t <= maxT ? t : Infinity;
  },
};
const water = { level: 0.5, contains: (x, z) => z > 40 && z < 50 };
const w = createWorld({ minX: -50, maxX: 50, minZ: -50, maxZ: 60, cell: 8, terrain, water });

// a 2 m wall across +z at z = 10, rotated 0
w.add({ type: 'box', x: 0, y: 1, z: 10, hx: 3, hy: 1, hz: 0.25, surface: 'stone' });
// a low crate (top 0.4) at x = 10
w.add({ type: 'box', x: 10, y: 0.2, z: 0, hx: 0.5, hy: 0.2, hz: 0.5, surface: 'wood' });
// a tree trunk
w.add({ type: 'cyl', x: -10, y: 0, z: 0, r: 0.5, h: 6, surface: 'wood' });
// barbed wire: stops walking only
w.add({ type: 'box', x: 20, y: 0.5, z: 0, hx: 2, hy: 0.5, hz: 0.5, kind: 'wire' });
// a rotated box (45°)
w.add({ type: 'box', x: 0, y: 1, z: -20, hx: 2, hy: 1, hz: 0.2, yaw: Math.PI / 4 });

// rays
let h = w.raycast(0, 1, 0, 0, 0, 1, 50, SHOT);
assert.ok(h && near(h.t, 9.75), `wall hit at 9.75, got ${h && h.t}`);
assert.ok(near(h.nz, -1), 'wall normal faces the shooter');
assert.equal(h.surface, 'stone');
h = w.raycast(-10, 1, -5, 0, 0, 1, 50, SHOT);
assert.ok(h && near(h.t, 4.5), `trunk hit at 4.5, got ${h && h.t}`);
h = w.raycast(20, 0.5, -5, 0, 0, 1, 50, SHOT);
assert.ok(h === null || h.collider === 'terrain' || h.t > 6, 'bullets pass the wire');
h = w.raycast(20, 0.5, -5, 0, 0, 1, 50, MOVE);
assert.ok(h && near(h.t, 4.5), 'the wire blocks movement rays');
h = w.raycast(0, 5, 0, 0, -1, 0, 50, SHOT);
assert.ok(h && h.collider === 'terrain' && near(h.t, 5), 'straight down hits the ground');
h = w.raycast(0, 2, 30, 0, -0.2, 1, 80, SHOT);
assert.ok(h, 'a ray going down hits something');
h = w.raycast(0, 1.5, 44, 0, -1, 0, 5, SHOT);
assert.ok(h && h.surface === 'water' && near(h.t, 1.0), 'the river surface takes the bullet');
// rotated box: a ray along +z at x = 0 meets its centre plane
h = w.raycast(0, 1, -30, 0, 0, 1, 50, SHOT);
assert.ok(h && h.t > 9 && h.t < 10, `rotated box hit near 9.7, got ${h && h.t}`);
assert.ok(w.clear(0, 1, 0, 0, 1, 9, SIGHT), 'clear in front of the wall');
assert.ok(!w.clear(0, 1, 0, 0, 1, 20, SIGHT), 'not clear through the wall');
assert.ok(w.clear(0, 3, 0, 0, 3, 20, SIGHT), 'clear over the wall top');

// walking into the wall
const p = { x: 0, z: 9.7 };
assert.ok(w.pushOut(p, 0.35, 0, 1.8, 0.45), 'pushed out of the wall');
assert.ok(p.z <= 9.75 - 0.35 + 1e-3, `stands in front of the wall, z = ${p.z}`);
// the crate is low enough to step on
const c = { x: 10, z: 0.2 };
assert.ok(!w.pushOut(c, 0.35, 0, 1.8, 0.45), 'a 0.4 m crate does not block');
assert.ok(near(w.groundAt(10, 0, 0, 0.45), 0.4), 'standing on the crate');
assert.ok(near(w.groundAt(0, 10, 0, 0.45), 0), 'a 2 m wall is not a floor');
// the trunk
const t = { x: -9.8, z: 0 };
w.pushOut(t, 0.35, 0, 1.8, 0.45);
assert.ok(Math.hypot(t.x + 10, t.z) >= 0.85 - 1e-3, 'pushed out of the trunk');
// vaulting probe sees the crate top
const ob = w.obstacleAhead(10, -1.2, 0, 1, 0, 0.75);
assert.ok(ob && near(ob.top, 0.4), 'obstacle ahead: the crate');

// the river: too deep to wade, except on a bridge deck
w.add({ type: 'box', x: 30, y: 0.9, z: 45, hx: 2, hy: 0.1, hz: 8 });
assert.ok(w.tooDeep(0, 45, 0.3), 'open water deeper than the limit blocks');
assert.ok(!w.tooDeep(30, 45, 0.3, 1.0), 'standing on the deck is fine');
assert.ok(!w.tooDeep(0, 30, 0.3), 'dry land is fine');

// helpers
const line = [[0, 0], [0, 10], [10, 10]];
const d = polylineDistance(line, 5, 12);
assert.ok(near(d.d, 2) && near(d.px, 5) && near(d.pz, 10), 'polyline distance');
assert.ok(near(rectDistance(3, 0, 0, 0, 1, 1, 0), 2), 'rect distance outside');
assert.ok(rectDistance(0, 0, 0, 0, 1, 1, 0.3) < 0, 'rect distance inside');
assert.ok(near(rectDistance(0, 3, 0, 0, 3, 1, Math.PI / 2), 0), 'rect distance rotated');

console.log('world-check: all good');
