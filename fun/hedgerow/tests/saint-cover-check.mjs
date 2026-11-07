// Run with: node fun/hedgerow/tests/saint-cover-check.mjs
// Saint-Clair's ways through, measured for cover: along each route, how far a
// soldier has to go with nothing within reach that would hide him crouching
// and stop a bullet (a solid box at least 0.55 m above its ground, or a trunk).
// A long open stretch under the guns is what the layout pass removed; this
// keeps it from coming back as props move.
import assert from 'node:assert/strict';
import { L, world, height } from './level-world.mjs';
import { MOVE, SHOT } from '../js/world.js';
import { ROUTES } from './saint-routes.mjs';

const REACH = 4.5;          // a dash and a dive
// The ford is sixteen metres of open water by nature: the bank cover either side has to do.
const MAX_OPEN = { default: 22, ford: 26 };
// The main road is the sunken lane and the street, whose cover is mostly the
// hedgebanks and house fronts (terrain and walls this probe does not count),
// and the bridge under the gun is meant to be the hard way.
const SKIP = ['main road'];

function covered(x, z) {
  for (const c of world.query(x - REACH, z - REACH, x + REACH, z + REACH)) {
    if ((c.flags & (MOVE | SHOT)) !== (MOVE | SHOT)) continue;
    if (c.type === 'cyl' ? c.r < 0.2 : c.top - height(c.x, c.z) < 0.55) continue;
    const d = c.type === 'cyl' ? Math.hypot(x - c.x, z - c.z) - c.r
      : (() => { const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const lx = Math.abs(dx * cs - dz * sn) - c.hx, lz = Math.abs(dx * sn + dz * cs) - c.hz;
        return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)); })();
    if (d < REACH) return true;
  }
  return false;
}

function longestOpen(points) {
  let run = 0, worst = 0, at = null;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let k = 0; k < n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
      if (covered(x, z)) run = 0; else if (++run > worst) { worst = run; at = [x, z]; }
    }
  }
  return { worst, at };
}

const failures = [];
for (const [name, pts] of Object.entries(ROUTES)) {
  if (SKIP.includes(name)) continue;
  let route = L.introRemap && pts.some(([, z]) => z < 84) ? L.introRemap.line(pts, 2) : pts;
  if (L.forestRemap) route = L.forestRemap.line(route, 3);
  const { worst, at } = longestOpen(route), limit = MAX_OPEN[name] ?? MAX_OPEN.default;
  const ok = worst <= limit;
  console.log(`${ok ? 'ok   ' : 'OPEN '} ${name}: longest open stretch ${worst} m${at ? ` ending near (${at[0].toFixed(0)}, ${at[1].toFixed(0)})` : ''}`);
  if (!ok) failures.push(name);
}
assert.equal(failures.length, 0, `routes with open stretches longer than allowed: ${failures.join(', ')}`);
console.log('saint-cover-check: every flank has cover within reach');
