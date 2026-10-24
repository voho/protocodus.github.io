// Meteora performance bench. Run from fun/meteora:  node tools/bench.mjs
//
// Measures, in Node, the CPU work a frame does that does not need a GPU:
//   sim      a 30 s, ten-interceptor fight at 120 Hz with cannon fire,
//            missiles and breaking rocks — time per step and garbage
//            collections
//   effects  per-frame CPU of the engine plumes, bolts and the glow batch
//            for eleven ships — time per frame and garbage collections
//   blasts   per-frame CPU of explosions under a heavy, steady load: a kill
//            every half second, a rock breaking every quarter, two bolt
//            hits a frame
//   cull     choosing which rocks to draw
// three.js is resolved to the vendored copy, so the render-side modules run
// unchanged; nothing is drawn.
import { registerHooks } from 'node:module';
import { PerformanceObserver } from 'node:perf_hooks';

const three = new URL('../../../assets/vendor/three/three.module.min.js', import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (s === 'three' ? { url: three, shortCircuit: true } : next(s, c)) });

const js = name => import(new URL(`../js/${name}`, import.meta.url).href);
const [{ createWorld, startRun, stepWorld }, { NEUTRAL_CONTROLS }, { STEP }, THREE, { createGlowBatch },
  { createPlumes }, { createProjectiles }, { createCuller }, { FIELD }, { createSmokeBatch }, { createExplosions }] = await Promise.all([
  js('world.js'), js('flight.js'), js('config.js'), import('three'), js('glow.js'), js('plumes.js'),
  js('projectiles.js'), js('cull.js'), js('config.js'), js('smoke.js'), js('explosions.js')]);
// The fight is Survival's waves, the world's default mission once its module
// is loaded (main.js loads it); without it the world is empty but for the player.
await js('missions/survival.js');

const gc = { count: 0, ms: 0 };
new PerformanceObserver(list => { for (const e of list.getEntries()) { gc.count++; gc.ms += e.duration; } }).observe({ entryTypes: ['gc'] });
const settle = () => new Promise(r => setTimeout(r, 50));
const stats = times => {
  const s = [...times].sort((a, b) => a - b), avg = s.reduce((a, t) => a + t, 0) / s.length;
  const at = q => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return `avg ${avg.toFixed(3)}  p50 ${at(0.5).toFixed(3)}  p95 ${at(0.95).toFixed(3)}  p99 ${at(0.99).toFixed(3)}  max ${s.at(-1).toFixed(2)} ms`;
};

// --- sim -------------------------------------------------------------------
const world = createWorld({ seed: 1234 });
startRun(world);
world.wave = 7;
const input = { ...NEUTRAL_CONTROLS, fire: true, missile: false, cycleTarget: true, throttleSet: 0.5, aimPoint: null };
stepWorld(world, input, STEP);
input.cycleTarget = false;
const warm = 120 * 3;
for (let i = 0; i < warm; i++) stepWorld(world, input, STEP);
await settle();
const steps = [];
gc.count = 0; gc.ms = 0;
for (let i = 0; i < 120 * 30; i++) {
  input.yaw = 0.3 * Math.sin(i / 200); input.pitch = 0.2 * Math.sin(i / 310);
  input.missile = i % 240 === 0;
  if (world.player.missiles === 0) world.player.missiles = 6;
  const t0 = performance.now();
  stepWorld(world, input, STEP);
  steps.push(performance.now() - t0);
  if (!world.player.alive) { Object.assign(world.player, { alive: true, hull: 100, shield: 100, reported: false }); world.state = 'flying'; }
}
await settle();
console.log(`sim      ${stats(steps)}  gc ${gc.count} (${gc.ms.toFixed(1)} ms) per 30 s`);

// --- effects ---------------------------------------------------------------
const scene = new THREE.Scene();
const glow = createGlowBatch(scene);
const plumes = createPlumes(glow), projectiles = createProjectiles(glow);
const ships = [world.player, ...world.entities.filter(e => e.team === 1 && e.alive)].slice(0, 11);
const objects = ships.map(e => {
  const o = new THREE.Object3D();
  o.position.set(...e.ship.pos); o.quaternion.set(...e.ship.q);
  return o;
});
for (const e of ships) { e.ship.thrust = 1; e.ship.vel = [0, 0, -200]; }
ships[0].ship.afterburner = true;
// The chase camera: 19 m behind and 4 m above the player, where its own plume reaches.
glow.setCamera(objects[0].position.x, objects[0].position.y + 4.2, objects[0].position.z + 19);
const frames = [];
for (let f = 0; f < 600; f++) {
  glow.begin();
  ships.forEach((e, k) => plumes.add(e, objects[k], f / 60, 1 / 60));
  projectiles.add(world.weapons, 0.5, 1 / 60);
  glow.end();
}
await settle();
gc.count = 0; gc.ms = 0;
for (let f = 0; f < 60 * 30; f++) {
  const t0 = performance.now();
  glow.begin();
  ships.forEach((e, k) => plumes.add(e, objects[k], f / 60, 1 / 60));
  projectiles.add(world.weapons, 0.5, 1 / 60);
  glow.end();
  frames.push(performance.now() - t0);
}
await settle();
console.log(`effects  ${stats(frames)}  gc ${gc.count} (${gc.ms.toFixed(1)} ms) per 30 s  [${ships.length} ships, ${world.weapons.bolts.length} bolts, ${glow.count} sprites]`);

// --- blasts ----------------------------------------------------------------
{
  const scene = new THREE.Scene(), glow = createGlowBatch(scene), smoke = createSmokeBatch(scene, new THREE.Vector3(0, 1, 0));
  const lod1 = new THREE.IcosahedronGeometry(1.5, 0);
  lod1.computeBoundingSphere();
  const fx = createExplosions(scene, glow, smoke, { lod1, material: new THREE.MeshStandardMaterial() });
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 1e5);
  camera.position.set(0, 50, 600); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const f = camera.getWorldDirection(new THREE.Vector3());
  const spot = k => [Math.sin(k * 1.7) * 300, Math.cos(k * 2.3) * 100, Math.sin(k * 0.9) * 300];
  const frame = k => {
    if (k % 30 === 0) fx.shipDeath(spot(k), [Math.sin(k) * 150, 0, Math.cos(k) * 150], 'interceptor');
    if (k % 15 === 0) fx.rockBreak(spot(k + 7), [0, 0, 0], 4 + (k / 15 % 3) * 4, false);
    fx.impact('hull', spot(k + 3), [0, 1, 0], [0, 0, 0]);
    fx.impact(k % 2 ? 'shield' : 'rock', spot(k + 5), [0, 0, 1], [0, 0, 0]);
    glow.begin(); smoke.begin();
    glow.setCamera(camera.position.x, camera.position.y, camera.position.z, f.x, f.y, f.z);
    smoke.setCamera(camera.position.x, camera.position.y, camera.position.z, f.x, f.y, f.z);
    fx.update(1 / 60, camera);
    glow.end(); smoke.end();
  };
  for (let k = 0; k < 600; k++) frame(k);
  await settle();
  gc.count = 0; gc.ms = 0;
  const times = [];
  for (let k = 600; k < 600 + 60 * 30; k++) {
    const t0 = performance.now();
    frame(k);
    times.push(performance.now() - t0);
  }
  await settle();
  const c = fx.counts;
  console.log(`blasts   ${stats(times)}  gc ${gc.count} (${gc.ms.toFixed(1)} ms) per 30 s  [${c.sparks} sparks, ${c.puffs} puffs, ${c.lobes} lobes, ${c.debris} pieces]`);
}

// --- cull ------------------------------------------------------------------
const culler = createCuller(world.field.belt, FIELD, {});
const SQ = Math.SQRT1_2, planes = [0, 0, -1, -0.5, 0, 0, 1, 1e5, SQ, 0, -SQ, 0, -SQ, 0, -SQ, 0, 0, -SQ, -SQ, 0, 0, SQ, -SQ, 0];
const culls = [];
for (let k = 0; k < 600; k++) { const t0 = performance.now(); culler.cull(planes, [0, 0, 0], world.field.alive); culls.push(performance.now() - t0); }
console.log(`cull     ${stats(culls)}`);

// --- glow fill ---------------------------------------------------------------
// The GPU's work for the additive glow pass is the screen area its quads
// cover. Each sprite's quad is built here exactly as glow.js's vertex shader
// builds it, projected for a 1920×1080 chase camera behind the player at
// full afterburner, clipped to the screen and summed. A quad wholly behind
// the camera covers nothing; one straddling the camera plane is counted as
// covering the whole screen (the GPU clips it, but what is left is huge).
// Reported in screens' worth of
// pixels per frame, without and with the near-camera fade.
const W = 1920, H = 1080;
function fill(batch, camera) {
  const geo = batch.mesh.geometry, C = geo.getAttribute('iCenter').array, A = geo.getAttribute('iAxis').array;
  const view = camera.matrixWorldInverse.elements, proj = camera.projectionMatrix.elements;
  const toView = (x, y, z, w) => [view[0] * x + view[4] * y + view[8] * z + view[12] * w, view[1] * x + view[5] * y + view[9] * z + view[13] * w, view[2] * x + view[6] * y + view[10] * z + view[14] * w];
  const clip = (poly, inside, cut) => {
    const out = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      if (inside(p)) out.push(p);
      if (inside(p) !== inside(q)) out.push(cut(p, q));
    });
    return out;
  };
  const edge = (axis, bound, keep) => poly => clip(poly, p => keep(p[axis], bound),
    (p, q) => { const t = (bound - p[axis]) / (q[axis] - p[axis]); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; });
  const toScreen = [edge(0, 0, (v, b) => v >= b), edge(0, W, (v, b) => v <= b), edge(1, 0, (v, b) => v >= b), edge(1, H, (v, b) => v <= b)];
  let area = 0;
  for (let n = 0; n < geo.instanceCount; n++) {
    const c = toView(C[4 * n], C[4 * n + 1], C[4 * n + 2], 1), s = C[4 * n + 3];
    const h = toView(A[4 * n], A[4 * n + 1], A[4 * n + 2], 0).map(v => v * A[4 * n + 3] * 0.5);
    const p0 = [c[0] - h[0], c[1] - h[1], c[2] - h[2]], p1 = [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
    const s0 = [p0[0] / Math.max(-p0[2], 1e-3), p0[1] / Math.max(-p0[2], 1e-3)], s1 = [p1[0] / Math.max(-p1[2], 1e-3), p1[1] / Math.max(-p1[2], 1e-3)];
    let dx = s1[0] - s0[0], dy = s1[1] - s0[1]; const l = Math.hypot(dx, dy);
    if (l > 1e-6) { dx /= l; dy /= l; } else { dx = 1; dy = 0; }
    let behind = 0;
    const poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const t = x * 0.5 + 0.5;
      const p = [p0[0] + (p1[0] - p0[0]) * t + (dx * x - dy * y) * s, p0[1] + (p1[1] - p0[1]) * t + (dy * x + dx * y) * s, p0[2] + (p1[2] - p0[2]) * t];
      if (-p[2] <= camera.near) behind++;
      const w = -p[2];
      return [((proj[0] * p[0] + proj[8] * p[2]) / w * 0.5 + 0.5) * W, (1 - ((proj[5] * p[1] + proj[9] * p[2]) / w * 0.5 + 0.5)) * H];
    });
    if (behind === 4) continue;
    if (behind) { area += W * H; continue; }
    let clipped = poly;
    for (const cut of toScreen) { clipped = cut(clipped); if (!clipped.length) break; }
    let a = 0;
    for (let i = 0; i < clipped.length; i++) { const p = clipped[i], q = clipped[(i + 1) % clipped.length]; a += p[0] * q[1] - q[0] * p[1]; }
    area += Math.abs(a) / 2;
  }
  return area / (W * H);
}
const player = ships[0], pose = objects[0];
const chase = new THREE.PerspectiveCamera(70, W / H, 0.5, 1e5);
chase.position.copy(pose.position).add(new THREE.Vector3(0, 4.2, 19).applyQuaternion(pose.quaternion));
chase.quaternion.copy(pose.quaternion);
chase.updateMatrixWorld(); chase.updateProjectionMatrix();
const fillFor = fade => {
  const batch = createGlowBatch(new THREE.Scene()), effects = createPlumes(batch);
  for (let f = 0; f < 120; f++) {         // let the plumes ease to full burn
    batch.begin();
    if (fade) {
      const f = chase.getWorldDirection(new THREE.Vector3());
      batch.setCamera(chase.position.x, chase.position.y, chase.position.z, f.x, f.y, f.z);
    }
    ships.forEach((e, k) => effects.add(e, objects[k], f / 60, 1 / 60));
    batch.end();
  }
  return { screens: fill(batch, chase), sprites: batch.count };
};
player.ship.afterburner = true; player.ship.thrust = 2.6; player.ship.vel = [0, 0, -320];
const off = fillFor(false), on = fillFor(true);
console.log(`glow     fill ${off.screens.toFixed(2)} → ${on.screens.toFixed(2)} screens of pixels per frame without → with the near-camera fade  [${off.sprites} → ${on.sprites} sprites, 1920×1080 chase camera, afterburner]`);
