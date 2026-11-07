// Run with: node fun/hedgerow/tests/varenne-routes-check.mjs
// La Varenne's approaches walked against the real collision world: the
// sunken lane past the fallen tree and the cart, the drain to the wire gap
// at its head, the knoll and the old hedge line, the orchard rows to the
// eastern gap, then from the guns down to the farm. A soldier steps 0.45 m
// and vaults 1.35 m (as route-check.mjs); a stuck point fails the check.
import assert from 'node:assert/strict';

process.env.HEDGEROW_LEVEL = 'la-varenne';
const { L, world } = await import('./level-world.mjs');
assert.equal(L.id, 'la-varenne');

function walk(name, pts) {
  const pos = { x: pts[0][0], y: 0, z: pts[0][1] };
  pos.y = world.groundAt(pos.x, pos.z, 1e4, 0.5);
  const dt = 1 / 30, speed = 4.5, B = L.playBounds, stuck = [];
  for (const [tx, tz] of pts.slice(1)) {
    let best = Infinity, since = 0, t = 0;
    for (;;) {
      const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
      if (d < 1.2) break;
      if (d < best - 0.05) { best = d; since = 0; } else since += dt;
      t += dt;
      const nx = dx / d, nz = dz / d;
      const p = { x: pos.x + nx * speed * dt, z: pos.z + nz * speed * dt };
      world.pushOut(p, 0.34, pos.y, 1.78, 0.45);
      pos.x = Math.min(B.maxX, Math.max(B.minX, p.x));
      pos.z = Math.min(B.maxZ, Math.max(B.minZ, p.z));
      pos.y = world.groundAt(pos.x, pos.z, pos.y, 0.45);
      if (since > 0.5) {
        const ob = world.obstacleAhead(pos.x, pos.z, nx, nz, pos.y, 0.7);
        if (ob && ob.top - pos.y <= 1.35) {
          for (let k = 1.0; k <= 2.6; k += 0.3) {
            const lx = pos.x + nx * k, lz = pos.z + nz * k, gy = world.groundAt(lx, lz, ob.top + 0.05, 0.1, 0.3);
            if (!world.pushOut({ x: lx, z: lz }, 0.34, gy, 1.78, 0.45)) { pos.x = lx; pos.z = lz; pos.y = gy; since = 0; break; }
          }
        }
      }
      if (since > 3 || t > 120) {
        stuck.push(`${name}: stuck at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) heading for (${tx}, ${tz})`);
        pos.x = tx; pos.z = tz; pos.y = world.groundAt(tx, tz, 1e4, 0.5);
        break;
      }
    }
  }
  return stuck;
}

const { LANE, DRAIN } = L.lines;
const ROUTES = {
  'sunken lane': [[20, -12], [24, 34], ...LANE.filter(([, z]) => z > 36 && z < 146)],
  'drain to the wire gap': [[20, -12], [1.6, 50], [1.6, 66], [12, 68], ...DRAIN.filter(([, z]) => z > 72), [25, 134], [24, 140]],
  'knoll and the old hedge': [[1.6, 66], [0, 84], [-4, 104], [-5, 112], [4, 124], [4, 134]],
  'orchard to the east gap': [[20, -12], [-20, 52], [-20, 66], [-30, 80], [-38, 100], [-30, 112], [-21, 122], [-21, 132]],
  'guns to the road': [[-2, 154], [-6, 166], [8, 175], [16, 188], [10, 200], [6, 210], [-8, 230], [-12, 252]],
};
// the wire belt between the gaps is real wire: it stops a walk (he must climb it) but not a bullet
const wire = L.props.filter((p) => p.m === 'barbed_wire');
assert.ok(wire.length >= 10, 'a wire belt runs along the trench');
const probe = wire.find((p) => p.x > 10 && p.x < 20);
const hit = world.query(probe.x - 0.1, probe.z - 0.1, probe.x + 0.1, probe.z + 0.1).some((c) => c.kind === 'wire');
assert.ok(hit, 'the wire belt has wire colliders');
// each gun stands in a revetment that leaves its barrel and the crew's way in open
for (const [i, gun] of L.props.filter((p) => p.m === 'pak40').entries()) {
  assert.ok(L.props.some((p) => p.m === 'gun_revetment' && Math.hypot(p.x - gun.x, p.z - gun.z) < 0.1), `gun ${i + 1} has its revetment`);
  const blocked = (x, z) => !!world.pushOut({ x, z }, 0.34, gun.y + 0.05, 1.7, 0.45);   // from the pit floor
  assert.ok(blocked(gun.x + 4.85, gun.z), `gun ${i + 1}: the revetment's side is solid`);
  assert.ok(!blocked(gun.x + 1.5, gun.z - 4.85), `gun ${i + 1}: the way in at the back is open`);
}

const failures = [];
for (const [name, pts] of Object.entries(ROUTES)) {
  const s = walk(name, pts);
  failures.push(...s);
  console.log(`${s.length ? 'STUCK' : 'ok   '} ${name}`);
}
for (const f of failures) console.log('  ' + f);
assert.equal(failures.length, 0, `${failures.length} stuck point(s)`);

// the bomb craters hold rainwater: they are listed for ponds.js, and are bowls
const bombs = L.craters.filter((c) => c.r > 3.1);
assert.ok(bombs.length >= 5, 'the bomb craters are listed with the shell holes');
for (const c of bombs) assert.ok(L.baseHeight(c.x, c.z) < L.baseHeight(c.x + c.r * 1.1, c.z) - 0.5, `the crater at (${c.x}, ${c.z}) is a bowl`);
console.log('varenne-routes-check: all approaches walkable');
