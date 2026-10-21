// Run with: node fun/hedgerow/tests/ai-check.mjs
// The enemy soldiers on the real level (the collision world of
// level-world.mjs, the walk grid of nav.js), with stand-in bodies and no
// rendering. Every patrol route can be walked; a patrol walks its route;
// a shot heard from a distance sends one man to look while the others take
// cover, and they all go back afterwards; when the player breaks contact
// some search where he was last seen and some wait for him in cover along
// his way, and an ambusher who sees him opens fire from his cover; the man
// who killed the player walks over to the body; and the death camera turns
// to the killer and follows him without going through anything.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { L, world, terrain } = await import('./level-world.mjs');
const { createEnemies, buildCoverPoints } = await import('../js/ai.js');
const { createNav } = await import('../js/nav.js');
const { createCameraRig } = await import('../js/camera.js');

const nav = createNav(world, L.playBounds);
const cover = buildCoverPoints(world, terrain);

/* ---------- every patrol route is walkable ---------- */
for (const d of L.enemies.filter((e) => e.patrol)) {
  const pts = d.patrol;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    assert.ok(nav.walkable(ax, az), `patrol point (${ax}, ${az}) of the ${d.group} group stands on nothing walkable`);
    const path = nav.findPath(ax, az, bx, bz);
    assert.ok(path, `no way from (${ax}, ${az}) to (${bx}, ${bz}) on the ${d.group} patrol`);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end.x - bx, end.z - bz) < 1.5, `the ${d.group} patrol cannot reach (${bx}, ${bz})`);
  }
}
console.log(`ok    ${L.enemies.filter((e) => e.patrol).length} patrol routes are walkable`);

/* ---------- a stand-in game ---------- */
const noop = new Proxy({}, { get: () => () => {} });
function game(playerAt) {
  const handlers = {};
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 2000);
  camera.position.set(playerAt[0], 3, playerAt[1] - 4);
  camera.lookAt(playerAt[0], 2, playerAt[1] + 10);
  camera.updateMatrixWorld();
  const G = {
    world, terrain, nav, cover, level: L, time: 0, lightning: 0,
    events: {
      on: (k, f) => (handlers[k] ||= []).push(f),
      emit: (k, a) => (handlers[k] || []).forEach((f) => f(a)),
    },
    soldier: null, models: new Map(), scene: new THREE.Scene(),
    matlib: { get: () => new THREE.MeshBasicMaterial(), resolve: (m) => m },
    player: {
      pos: new THREE.Vector3(playerAt[0], world.groundAt(playerAt[0], playerAt[1], 1e4, 0.5), playerAt[1]),
      vel: new THREE.Vector3(), alive: true, crouch: false, visible: 1, movingSpeed: 0, killer: null,
      damage() {},
    },
    diff: { aware: 1, accuracy: 0, damage: 1 },
    effects: noop, lights: noop, audio: noop, decals: null, debris: null,
    explosives: { list: [], throwGrenade() {} },
    rig: { yaw: 0, addShake() {} },
    hud: { awareness() {} },
    stats: { kills: 0, headshots: 0 },
    camera,
  };
  return G;
}
// off to the side, out of everyone's sight but near enough (< 170 m) for them to be active
const hide = (G) => { G.player.pos.set(40, world.groundAt(40, 120, 1e4, 0.5), 120); };
function run(G, en, seconds, each) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    G.time += dt;
    en.update(dt);
    if (each && each(t) === false) break;
  }
}
const D = (type, x, z, yaw, group, o = {}) => ({ type, at: [x, z], yaw, group, ...o });

/* ---------- a patrol walks its route ---------- */
{
  const G = game([0, 90]);
  const en = createEnemies(G, [D('rifle', 2.5, 205, 175, 'p', { patrol: [[2.5, 205], [2.5, 240]] })]);
  const e = en.list[0];
  let reachedFar = false, back = false;
  run(G, en, 90, () => {
    if (Math.hypot(e.pos.x - 2.5, e.pos.z - 240) < 1.5) reachedFar = true;
    if (reachedFar && Math.hypot(e.pos.x - 2.5, e.pos.z - 205) < 1.5) back = true;
    return !back;
  });
  assert.ok(reachedFar && back, `the patrol did not walk its route (at ${e.pos.x.toFixed(1)}, ${e.pos.z.toFixed(1)}, ${e.state})`);
  console.log('ok    a patrol walks its route and turns back');
}

/* ---------- a distant shot: one goes to look, the others take cover ---------- */
{
  const G = game([0, 90]);
  hide(G);
  const posts = [[2, 170], [-6, 176], [7.5, 175]];
  const en = createEnemies(G, posts.map(([x, z], i) => D('rifle', x, z, 180, 'sq', { leash: 18 })));
  run(G, en, 0.5);
  const shot = { x: -4, z: 208 };
  G.events.emit('noise', { x: shot.x, z: shot.z, radius: 75, kind: 'shot' });
  const states = en.list.map((e) => e.state);
  assert.equal(states.filter((s) => s === 'search').length, 1, `one man goes to look (states: ${states})`);
  assert.equal(states.filter((s) => s === 'alert').length, 2, `the other two stay and watch (states: ${states})`);
  const looker = en.list.find((e) => e.state === 'search');
  let near = Infinity;
  run(G, en, 40, () => { near = Math.min(near, Math.hypot(looker.pos.x - shot.x, looker.pos.z - shot.z)); });
  assert.ok(near < 6, `the man looking got within ${near.toFixed(1)} m of the shot, expected < 6`);
  const watchers = en.list.filter((e) => e !== looker);
  const home = (e) => e.state === 'idle' && Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z) < 1.5;
  run(G, en, 150, () => en.list.every(home) ? false : undefined);
  for (const e of en.list) {
    assert.equal(e.state, 'idle', `everyone back to his post after a while (one is ${e.state})`);
    const d = Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z);
    assert.ok(d < 1.5, `back at the post (${d.toFixed(1)} m off, at ${e.pos.x.toFixed(1)}, ${e.pos.z.toFixed(1)}, home ${e.home.x}, ${e.home.z})`);
  }
  assert.ok(watchers.length === 2);
  console.log(`ok    a distant shot: one goes to look (within ${near.toFixed(1)} m), two watch from cover, all go back`);
}

/* ---------- contact lost: search the last place, wait along his way ---------- */
{
  const G = game([0, 90]);
  const posts = [[-1.5, 206], [2.5, 214], [-3.5, 224]];
  const en = createEnemies(G, posts.map(([x, z]) => D('rifle', x, z, 180, 'ns', { leash: 18 })));
  run(G, en, 0.3);
  // he was seen at (0, 200) running north up the street, then vanished
  const seen = { x: 0, z: 200 };
  for (const e of en.list) { e.suppress(0.2, seen); e.lastKnown = { ...seen }; e.lastSeen = G.time; }
  en.intel.set('ns', { x: seen.x, z: seen.z, vx: 0, vz: 4.2, t: G.time });
  hide(G);
  const roles = new Set();
  let ambusher = null, searcher = null, searchNear = Infinity;
  run(G, en, 45, () => {
    for (const e of en.list) {
      roles.add(e.state);
      if (e.state === 'ambush' && e.amb?.phase === 'wait') ambusher ||= e;
      if (e.state === 'search' && e.srch?.reason === 'search') {
        searcher ||= e;
        if (e === searcher) searchNear = Math.min(searchNear, Math.hypot(e.pos.x - seen.x, e.pos.z - seen.z));
      }
    }
  });
  assert.ok(searcher, `someone searches where he was seen (states seen: ${[...roles]})`);
  assert.ok(searchNear < 3, `the searcher got within ${searchNear.toFixed(1)} m of where he was seen`);
  assert.ok(ambusher, `someone waits for him along his way (states seen: ${[...roles]})`);
  // the ambusher's cover hides him crouched from the place he is watching, and he faces it
  const a = ambusher.amb || { x: ambusher.lastKnown.x, z: ambusher.lastKnown.z };
  console.log(`ok    contact lost: one searches (within ${searchNear.toFixed(1)} m of the last sighting), one waits in ambush`);

  /* ---------- the ambush springs ---------- */
  {
    const G2 = game([0, 90]);
    const en2 = createEnemies(G2, posts.map(([x, z]) => D('rifle', x, z, 180, 'ns2', { leash: 18 })));
    run(G2, en2, 0.3);
    for (const e of en2.list) { e.suppress(0.2, seen); e.lastKnown = { ...seen }; e.lastSeen = G2.time; }
    en2.intel.set('ns2', { x: seen.x, z: seen.z, vx: 0, vz: 4.2, t: G2.time });
    hide(G2);
    let amb = null;
    run(G2, en2, 45, () => { amb = en2.list.find((e) => e.state === 'ambush' && e.amb?.phase === 'wait'); return amb ? false : undefined; });
    assert.ok(amb, 'an ambusher in place');
    run(G2, en2, 2.5);                       // he settles, turned to the spot
    assert.equal(amb.state, 'ambush', 'still waiting');
    const watch = { x: amb.amb.x, z: amb.amb.z };
    const c = amb.cover;
    const py = world.groundAt(watch.x, watch.z, 1e4, 0.5) + 1.2;
    assert.ok(!world.clear(c.x, c.y + 0.95, c.z, watch.x, py, watch.z, 2), 'the ambush cover hides a crouching man from the watched spot');
    const facing = Math.abs(((Math.atan2(watch.x - amb.pos.x, watch.z - amb.pos.z) - amb.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    assert.ok(facing < 0.35, `the ambusher faces the spot he watches (off by ${facing.toFixed(2)} rad)`);
    // he walks into it
    G2.player.pos.set(watch.x, world.groundAt(watch.x, watch.z, 1e4, 0.5), watch.z);
    G2.player.vel.set(0, 0, 3);
    let sprung = false;
    run(G2, en2, 8, () => { if (amb.state === 'combat') { sprung = amb.phase === 'peek'; return false; } });
    assert.ok(sprung, `the ambush springs: he fires from his cover (state ${amb.state}, phase ${amb.phase})`);
    console.log('ok    the ambush: hidden from the watched spot, facing it, and it springs from cover');
  }
}

/* ---------- the killer checks the body ---------- */
{
  const G = game([0, 120]);
  const en = createEnemies(G, [D('rifle', 3.2, 132, 170, 'k', { leash: 8 })]);
  run(G, en, 0.3);
  const k = en.list[0];
  G.player.killer = k;
  G.player.alive = false;
  G.events.emit('playerDied');
  assert.equal(k.state, 'search');
  let near = Infinity;
  run(G, en, 25, () => { near = Math.min(near, Math.hypot(k.pos.x - G.player.pos.x, k.pos.z - G.player.pos.z)); });
  assert.ok(near < 3.2, `the killer walked over to the body (closest ${near.toFixed(1)} m)`);
  console.log(`ok    the killer walks over to the body (to ${near.toFixed(1)} m)`);
}

/* ---------- the death camera ---------- */
{
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 2000);
  const rig = createCameraRig(camera, world);
  const body = new THREE.Vector3(0, world.groundAt(0, 112, 1e4, 0.5), 112);
  rig.yaw = 0;
  const killer = new THREE.Vector3(3.2, world.groundAt(3.2, 140, 1e4, 0.5) + 1.6, 140);
  const dt = 1 / 60;
  for (let t = 0; t < 5; t += dt) {
    killer.z -= dt * 1.2;          // he walks towards the body
    rig.deathCam(dt, body, killer);
    const g = world.terrain.height(camera.position.x, camera.position.z);
    assert.ok(camera.position.y > g + 0.2, 'the camera stays above the ground');
  }
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const to = killer.clone().sub(camera.position).normalize();
  const off = Math.acos(Math.min(1, fwd.dot(to)));
  const dist = camera.position.distanceTo(killer);
  assert.ok(off < 0.08, `the camera looks at the killer (off by ${(off * 57.3).toFixed(1)}°)`);
  assert.ok(dist > 3.5 && dist < 11, `and follows him from ${dist.toFixed(1)} m`);
  rig.resetDeathCam();
  console.log(`ok    the death camera turns to the killer and follows him from ${dist.toFixed(1)} m`);
}

console.log('ai-check: patrols walk, sounds get looked into, lost contact means a search and an ambush, the killer checks the body, the camera follows him');
