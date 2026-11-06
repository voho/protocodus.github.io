// Prague's actual architecture, authored combat routes, historical framing
// and six-phase mission sequence. Unlike broad A* checks, a direct walk
// catches a façade/cornice/prop quietly closing the intended passage.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.HEDGEROW_LEVEL !== 'prague') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, HEDGEROW_LEVEL: 'prague' }, stdio: 'inherit' });
  assert.equal(r.status, 0, 'Prague route and objective checks failed'); process.exit(0);
}
const { L, models, world, height, missing } = await import('./level-world.mjs');
const { createNav } = await import('../js/nav.js');
const { createMission } = await import('../js/mission.js');
const { pragueModels } = await import('../js/prague-models.js');
const { pragueHeight, pragueSplat } = await import('../js/levels/prague-ground.js');
assert.deepEqual([...missing], [], 'every mission prop has a registered model');
assert.deepEqual(L.loadout, ['kar98k', 'mp40']);
assert.equal(L.playerIdentity, 'czech-resistance');
assert.equal(L.playerGrenade, 'grenade_de');
assert.match(L.briefing.join(' '), /fictional action/);
assert.ok(!L.props.some((p) => /^(house_|barn|haystack|hedge|church)/.test(p.m)), 'the urban mission does not borrow Norman house/farm architecture');
assert.equal(L.craters.length, 0);
assert.equal(L.water, null);
assert.ok(L.props.filter((p) => /prague_(pavement|tram_rails|tram_span|contact_wire)/.test(p.m)).every((p) => p.contact === false), 'flat or overhead infrastructure adds no broad contact blob');
assert.ok(L.props.filter((p) => p.m.startsWith('prague_')).length > 45, 'the street has continuous authored urban frontage');
for (const p of L.props.filter((p) => p.m === 'prague_passage')) assert.ok(p.id, 'all passages are named for debugging and map reading');

const nav = createNav(world, L.playBounds);
const routeMetrics = [];
for (const e of L.enemies) {
  for (const [x, z] of e.patrol || []) assert.ok(nav.nearest(x, z, 1), `${e.group}: patrol point has usable footing`);
  if (/reserve$/.test(e.group)) assert.ok(nav.findPath(e.at[0], e.at[1], -44, 88), `${e.group}: counterattack can reach the annex`);
}
function walk(name, line) {
  let y = world.groundAt(line[0][0], line[0][1], 1e4, 0.5);
  let distance = 0, maxStep = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i], segment = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(segment / 0.16); distance += segment;
    for (let k = 1; k <= steps; k++) {
      const x = ax + (bx - ax) * k / steps, z = az + (bz - az) * k / steps, p = { x, z };
      world.pushOut(p, 0.34, y, 1.7, 0.45);
      assert.ok(Math.hypot(p.x - x, p.z - z) < 0.05, `${name}: blocked at ${x.toFixed(2)}, ${z.toFixed(2)}`);
      const nextY = world.groundAt(x, z, y, 0.45); maxStep = Math.max(maxStep, Math.abs(nextY - y));
      assert.ok(Math.abs(nextY - y) < 0.45, `${name}: unwalkable step at ${x.toFixed(2)},${z.toFixed(2)}`);
      assert.equal(world.tooDeep(x, z, 0.9, nextY), false); y = nextY;
    }
  }
  routeMetrics.push({ name, metres: +distance.toFixed(1), maxStep: +maxStep.toFixed(3) });
}
walk('tram barricade bypass', [[5, -43], [12.8, -31], [12.8, -13], [-2, -6]]);
walk('courtyard approach', L.lines.COURT_ROUTE);
walk('street approach', L.lines.STREET_ROUTE);
walk('withdrawal', L.lines.WITHDRAWAL);

// Every passage remains open below its vault while solid wings stop a
// shot. This uses the placed actual-world colliders, not just nav cells.
for (const p of L.props.filter((p) => p.m === 'prague_passage')) {
  const yaw = p.yaw * Math.PI / 180, dx = Math.sin(yaw), dz = Math.cos(yaw), y = streetHeight(p) + 1.1;
  const opening = world.raycast(p.x - dx * 5.6, y, p.z - dz * 5.6, dx, 0, dz, 11.2);
  assert.ok(!opening || opening.collider === 'terrain', `${p.id}: passage centre is open`);
  const sx = Math.cos(yaw) * 3.2, sz = -Math.sin(yaw) * 3.2;
  const wall = world.raycast(p.x + sx - dx * 5.6, y, p.z + sz - dz * 5.6, dx, 0, dz, 11.2);
  assert.ok(wall && wall.collider !== 'terrain' && wall.t < 1, `${p.id}: stone wing stops bullets`);
}
function streetHeight(p) { return typeof p.y === 'number' ? p.y : height(p.x, p.z); }
// Command demolition can be approached on foot; the relay radio is a
// separate object and is outside the demolition's immediate blast radius.
const demo = L.objectives.find((o) => o.kind === 'destroy');
assert.ok(nav.walkable(demo.x, demo.z), 'charge prompt is on usable pavement');
const relayRadio = L.props.find((p) => p.id === 'relay-radio');
assert.ok(Math.hypot(relayRadio.x - demo.x, relayRadio.z - demo.z) > 35);
for (const x of [-12, -9, 0, 9, 12]) for (let z = -50; z <= 130; z += 10) {
  const weights = pragueSplat(x, z); assert.ok(weights[3] > 0.8, 'street stays visibly paved');
  assert.ok(Math.abs(pragueHeight(x, z + 1) - pragueHeight(x, z)) < 0.08, 'street grade has no random walking bumps');
}

// The real controller must not finish at the early rally point, report
// before the annex is clear, or permit demolition during the hold.
const events = [], actions = [], charges = [], sent = [], display = {};
const placed = new Map(L.props.filter((p) => p.id).map((p) => [p.id, {
  x: p.x, z: p.z, y: height(p.x, p.z), yaw: (p.yaw || 0) * Math.PI / 180,
  model: { anchors: models.get(p.m).anchors }, object: null,
}]));
const G = {
  player: { alive: true, health: 100, pos: { x: 0, z: 0 }, inventory: () => ({ rounds: 5 }) },
  models: new Map(), enemies: L.enemies.map((e) => ({ group: e.group, dead: false, pos: { x: e.at[0], z: e.at[1] } })),
  stats: { objectives: 0 }, rig: { yaw: 0 }, time: 0,
  scene: { add() {}, remove() {} }, events: { on() {}, emit(name, payload) { events.push(name); if (name === 'missionAction') actions.push(payload); } },
  hud: { objective(text) { display.text = text; }, notice() {}, prompt(text) { display.prompt = text; }, objectiveMarker() {} },
  audio: { ui() {} }, effects: { addFire() {}, explosion() {} }, lights: { addStatic() {} },
  explosives: { placeCharge(pos, fuse, detonate) { const c = { pos, fuse, detonate }; charges.push(c); return c; } },
  enemyCtl: { send(...args) { sent.push(args); } },
};
const M = createMission(G, { ...L, pickups: [], hints: [] }, { placed }); M.start();
function update(x, z, dt = 1 / 60, use = false) { G.player.pos.x = x; G.player.pos.z = z; G.time += dt; M.update(dt, { pressed: (key) => use && key === 'KeyF', held: (key) => use && key === 'KeyF' }); }
update(35.5, 38); assert.equal(M.index, 0, 'early visit to rally does not skip the raid');
update(-2, -6); assert.equal(M.isActive('relay'), true);
update(-44, 88, 90, true); assert.equal(M.index, 1); assert.equal(charges.length, 0);
G.enemies.filter((e) => e.group === 'relay').forEach((e) => { e.dead = true; });
update(-44, 88); assert.equal(M.isActive('transmit'), true, 'clearing the annex unlocks the radio action');
update(-44, 88, 60); assert.equal(sent.length, 0, 'the counterattack waits until the player operates the relay');
assert.equal(M.held, 0, 'standing in the annex cannot auto-start the defence timer');
const action = L.objectives.find((o) => o.kind === 'interact');
const operator = [action.x + 1.6, action.z];
assert.ok(nav.walkable(...operator), 'the radio can be operated from usable ground beside the table');
walk('relay operator approach', [[-44, 88], operator]);
update(...operator, 0.75, true); assert.equal(M.isComplete('transmit'), false); assert.ok(M.interaction.progress > 0.49 && M.interaction.progress < 0.51);
update(...operator); assert.equal(M.interaction, null, 'release cancels partial radio tuning');
update(...operator, 1.5, true); assert.equal(M.isComplete('transmit'), true); assert.equal(M.isActive('report'), true);
assert.equal(M.held, 0); assert.equal(sent.length, 0, 'starting the report does not secretly accrue defence time');
assert.equal(actions.length, 1); assert.equal(actions[0].action, 'transmit'); assert.equal(actions[0].target, 'relay-radio');
update(-44, 88, 20); assert.equal(sent.length, 2, 'both counter-attack routes activate');
assert.equal(M.isComplete('report'), false);
const held = M.held; update(4.2, 98.2, 60, true); assert.equal(M.held, held, 'report cannot accrue while away from the post'); assert.equal(charges.length, 0);
update(-44, 88, 25); assert.equal(M.isComplete('report'), true); assert.equal(M.isActive('command'), true);
update(demo.x, demo.z, 1 / 60, true); assert.equal(charges.length, 1); assert.equal(charges[0].fuse, 6);
assert.equal(M.isActive('rally'), false); charges[0].detonate(); assert.equal(M.isActive('rally'), true);
assert.equal(M.isComplete('command'), true); assert.ok(M.wrecked.has('command-radio'));
const saved = M.restoreCheckpoint(); assert.ok(saved.spawn); assert.equal(M.isComplete('report'), true, 'retry keeps completed report');
update(35.5, 38); update(35.5, 38); assert.equal(M.done, true); assert.deepEqual(events, ['missionAction', 'missionComplete']);
assert.equal(G.stats.objectives, L.objectives.length);

// Geometry is bounded and complete before the runtime admits it.
const architecture = pragueModels(); let tris = 0; const counted = new Set();
for (const [name, model] of architecture) {
  assert.ok(!model.box.isEmpty(), `${name}: finite bounds`);
  for (const prim of model.prims) {
    const p = prim.geometry.attributes.position;
    if (!counted.has(prim.geometry)) { tris += p.count / 3; counted.add(prim.geometry); }
    for (const key of ['position', 'normal', 'uv', 'color']) assert.ok(prim.geometry.attributes[key], `${name}: missing ${key}`);
    assert.ok(p.array.every(Number.isFinite), `${name}: nonfinite geometry`);
  }
}
const intact = architecture.get('prague_ochre'), damaged = architecture.get('prague_damaged');
assert.deepEqual(damaged.colliders, intact.colliders, 'surface damage never changes route or cover collision');
assert.ok(intact.prims.every((p) => damaged.prims.includes(p)), 'damaged frontage shares its base geometry');
assert.equal(L.props.filter((p) => p.m === 'prague_damaged').length, 2, 'damage is authored at the two street rubble addresses');
assert.equal(L.props.filter((p) => p.m === 'prague_contact_wire').length, 13, 'the trolley line has one deliberate broken module beside the wreck');
// Three genuine 3/4/6-storey frontage types add <11k triangles to the
// original catalogue. Their placed meshes are smaller than old fronts.
assert.ok(tris < 45000, `architecture is excessive: ${tris} triangles`);
console.log(`prague-check: ${L.enemies.length} enemies, ${L.objectives.length} gated phases, real open arcades, ${Math.round(tris)} architecture triangles; routes ${JSON.stringify(routeMetrics)}`);
