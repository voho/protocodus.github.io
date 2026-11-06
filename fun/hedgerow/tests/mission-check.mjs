// Run with: node fun/hedgerow/tests/mission-check.mjs
// Every mission's level against its own collision world: all its models
// exist, the soldier can find a way from the start through each objective in
// turn, and every enemy, pickup and checkpoint stands on walkable ground.
// Each level is checked in a child process (level-world.mjs builds one level).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.HEDGEROW_LEVEL) {
  const { MISSIONS } = await import('../js/missions.js');
  let failed = 0;
  for (const m of MISSIONS) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, HEDGEROW_LEVEL: m.id }, stdio: 'inherit' });
    if (r.status !== 0) failed++;
  }
  assert.equal(failed, 0, `${failed} mission(s) failed`);
  console.log('mission-check: all missions pass');
  process.exit(0);
}

const { L, missing, world, placed } = await import('./level-world.mjs');
const { createNav } = await import('../js/nav.js');
const nav = createNav(world, L.playBounds);
const problems = [];

if (missing.size) problems.push(`models missing: ${[...missing].join(', ')}`);

/* where each objective sends the player: over the line for a crossing, else to its marker or place
   (a 'clear' has neither: its enemies are checked below) */
const goal = (o) => o.kind === 'cross' ? [o.marker[0], o.z + 3] : o.marker || (o.x !== undefined ? [o.x, o.z] : null);
let at = [L.start[0], L.start[1]];
for (const o of L.objectives) {
  const g = goal(o);
  if (!g) continue;
  // a gun or a dump is a solid thing: the player only has to get next to it
  const to = nav.nearest(g[0], g[1], 4);
  if (!to) { problems.push(`objective ${o.id}: nothing walkable near (${g})`); continue; }
  const path = nav.findPath(at[0], at[1], to.x, to.z);
  if (!path) problems.push(`objective ${o.id}: no way from (${at.map((v) => v.toFixed(0))}) to (${g})`);
  at = [to.x, to.z];
}

const spot = (what, x, z) => { if (!nav.walkable(x, z)) problems.push(`${what} at (${x}, ${z}) is not on walkable ground`); };
spot('start', L.start[0], L.start[1]);
// a gunner in a nest or a bunker stands where the nav keeps others out; anyone else must be a step from walkable ground
for (const e of L.enemies) {
  if (e.nest || e.bunker) continue;
  const [x, z] = e.at;
  if (!nav.walkable(x, z) && !nav.nearest(x, z, 1)) problems.push(`enemy ${e.type} (${e.group}) at (${x}, ${z}) is boxed in`);
}
for (const p of L.pickups) spot(`${p.type} pickup`, p.x, p.z);
for (const c of L.checkpoints) spot('checkpoint spawn', c.spawn[0], c.spawn[1]);

// A marker can be navigable while the actual equipment sits behind a wall.
// Check an interaction's real transformed anchor can be reached and seen
// from at least one walkable spot inside its operating radius.
for (const o of L.objectives.filter((o) => o.kind === 'interact')) {
  const p = placed.get(o.target), a = p?.model.anchors[o.anchor || 'interact'];
  if (!p || !a) { problems.push(`interaction ${o.id}: target or anchor missing`); continue; }
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const x = p.x + (a[0] * c + a[2] * s) * p.scale, z = p.z + (-a[0] * s + a[2] * c) * p.scale;
  const y = p.y + (a[1] + (o.anchorHeight || 0)) * p.scale;
  let accessible = false;
  for (const r of [0.65, 1.2, 1.9]) for (let i = 0; i < 20; i++) {
    if (r >= (o.r || 2.5)) continue;
    const px = x + Math.sin(i * Math.PI / 10) * r, pz = z + Math.cos(i * Math.PI / 10) * r;
    if (!nav.walkable(px, pz)) continue;
    const py = world.groundAt(px, pz, 1e4, 0.4);
    if (Math.abs(py + 1.2 - y) < 2 && world.clear(px, py + 1.5, pz, x, y, z)) accessible = true;
  }
  if (!accessible) problems.push(`interaction ${o.id}: equipment cannot be operated from walkable ground`);
}

for (const p of problems) console.log('  ' + p);
console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${L.id}: ${L.objectives.length} objectives, ${L.enemies.length} enemies, ${L.pickups.length} pickups`);
process.exit(problems.length ? 1 : 0);
