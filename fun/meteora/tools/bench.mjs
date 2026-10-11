// Meteora performance bench. Run from fun/meteora:  node tools/bench.mjs
//
// Measures, in Node, the CPU work a frame does that does not need a GPU:
//   sim      a 30 s, ten-interceptor fight at 120 Hz with cannon fire,
//            missiles and breaking rocks — time per step and garbage
//            collections
//   effects  per-frame CPU of the engine plumes, bolts and the glow batch
//            for eleven ships — time per frame and garbage collections
//   cull     choosing which rocks to draw
// three.js is resolved to the vendored copy, so the render-side modules run
// unchanged; nothing is drawn.
import { registerHooks } from 'node:module';
import { PerformanceObserver } from 'node:perf_hooks';

const three = new URL('../../../assets/vendor/three/three.module.min.js', import.meta.url).href;
registerHooks({ resolve: (s, c, next) => (s === 'three' ? { url: three, shortCircuit: true } : next(s, c)) });

const js = name => import(new URL(`../js/${name}`, import.meta.url).href);
const [{ createWorld, startRun, stepWorld }, { NEUTRAL_CONTROLS }, { STEP }, THREE, { createGlowBatch },
  { createPlumes }, { createProjectiles }, { createCuller }, { FIELD }] = await Promise.all([
  js('world.js'), js('flight.js'), js('config.js'), import('three'), js('glow.js'), js('plumes.js'),
  js('projectiles.js'), js('cull.js'), js('config.js')]);

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
const ships = [world.player, ...world.enemies.filter(e => e.alive)].slice(0, 11);
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

// --- cull ------------------------------------------------------------------
const culler = createCuller(world.field.belt, FIELD, {});
const SQ = Math.SQRT1_2, planes = [0, 0, -1, -0.5, 0, 0, 1, 1e5, SQ, 0, -SQ, 0, -SQ, 0, -SQ, 0, 0, -SQ, -SQ, 0, 0, SQ, -SQ, 0];
const culls = [];
for (let k = 0; k < 600; k++) { const t0 = performance.now(); culler.cull(planes, [0, 0, 0], world.field.alive); culls.push(performance.now() - t0); }
console.log(`cull     ${stats(culls)}`);
