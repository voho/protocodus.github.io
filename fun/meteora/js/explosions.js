/* Meteora — explosions and impacts.

   What a blast is made of, in the order the eye takes it in:

     flash     a white-hot sprite and a borrowed point light that lights the
               rocks and hulls around it; gone in a tenth of a second
     fireball  noise lobes that swell, cool and burn away (fireballs.js)
     ring      the shock front, for warheads and ships
     sparks    molten streaks, flying dead straight — there is no air to
               slow them — and cooling from white to red as they go
     embers    slower scraps that flicker out
     debris    hull shards and rock chips, tumbling (debris.js); hot shards
               trail fire and smoke
     smoke     lit puffs boiling out of the fireball, glowing with it at
               first, then spreading and thinning for seconds (smoke.js)

   Everything inherits the velocity of whatever blew up: an interceptor
   killed at 200 m/s leaves a fireball that carries on at 200 m/s, as its
   pieces would, so a kill on the pass streaks by instead of stopping dead
   in space. Sparks and debris keep the speed they left with; smoke and
   embers settle into the cloud's own frame as it spreads.

   Each recipe is sized by what blew up: a bolt on a rock is a puff of grit
   and a few sparks, a missile a fireball and a ring, an interceptor all of
   it, and the player's own fighter the biggest thing in the game. Close
   blasts also return a `flash` the renderer turns into a brief exposure
   surge, the way an eye or a camera is dazzled. */

import * as THREE from 'three';
import { makeRng } from './rng.js';
import { bigDeathSpan } from './config.js';
import { createFireballs } from './fireballs.js';
import { createDebris } from './debris.js';

const ZERO = [0, 0, 0];
const SPARK_HOT = [1, 0.8, 0.45], SPARK_COOL = [1, 0.28, 0.05];
const EMBER_HOT = [1, 0.52, 0.16], EMBER_COOL = [0.55, 0.06, 0];
const SHIELD_HOT = [0.75, 0.92, 1], SHIELD_COOL = [0.2, 0.45, 1];
const DUST = [0.3, 0.27, 0.24], SOOT = [0.085, 0.08, 0.075];
// Linear albedo of the hull plates each ship breaks into (see the previews
// in tools/blender/previews).
const HARROW_PLATES = [new THREE.Color(0.03, 0.03, 0.034), new THREE.Color(0.05, 0.05, 0.055), new THREE.Color(0.24, 0.012, 0.01)];
const WATCH_PLATES = [new THREE.Color(0.55, 0.55, 0.53), new THREE.Color(0.62, 0.62, 0.6), new THREE.Color(0.03, 0.03, 0.032), new THREE.Color(0.7, 0.2, 0.03)];
const CIVIL_PLATES = [new THREE.Color(0.5, 0.49, 0.46), new THREE.Color(0.32, 0.3, 0.28), new THREE.Color(0.55, 0.22, 0.06), new THREE.Color(0.06, 0.06, 0.06)];
const ROCK_PLATES = [new THREE.Color(0.09, 0.08, 0.07), new THREE.Color(0.14, 0.12, 0.1), new THREE.Color(0.3, 0.02, 0.01)];
const HULLS = {
  interceptor: HARROW_PLATES, mite: HARROW_PLATES, talon: HARROW_PLATES, maul: HARROW_PLATES, sentry: HARROW_PLATES,
  anchor: HARROW_PLATES, warden: HARROW_PLATES, mother: HARROW_PLATES, seed: ROCK_PLATES,
  fighter: WATCH_PLATES, swift: WATCH_PLATES, anvil: WATCH_PLATES, drone: WATCH_PLATES, halberd: WATCH_PLATES,
  shuttle: CIVIL_PLATES, freighter: CIVIL_PLATES, station: CIVIL_PLATES, colony: CIVIL_PLATES, perpetua: CIVIL_PLATES,
};
// Roughly one pixel's angle at 1080p and 70°: sparks are never drawn
// narrower, only dimmer, so a distant one does not shimmer in and out.
const PIXEL = 2 * Math.tan(35 * Math.PI / 180) / 1080 * 1.2;

/* Particles live in typed arrays, one per field, packed: a dead one is
   replaced by the last live one. A full pool overwrites in turn. */
function createPool(capacity, fields) {
  const pool = { n: 0, capacity, cursor: 0, fields };
  for (const f of fields) pool[f] = new Float32Array(capacity);
  return pool;
}
function claim(pool) {
  if (pool.n < pool.capacity) return pool.n++;
  pool.cursor = (pool.cursor + 1) % pool.capacity;
  return pool.cursor;
}
function release(pool, i) {
  const last = --pool.n;
  if (i !== last) for (const f of pool.fields) pool[f][i] = pool[f][last];
}

const GLOW_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'bx', 'by', 'bz', 'age', 'life', 'size', 'grow',
  'r', 'g', 'b', 'r2', 'g2', 'b2', 'power', 'fade', 'drag', 'streak', 'flicker'];
const SMOKE_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'bx', 'by', 'bz', 'age', 'life', 'size', 'grow',
  'r', 'g', 'b', 'alpha', 'drag', 'angle', 'spin', 'cell', 'glow', 'glowLife', 'fadeIn'];

const fract = x => x - Math.floor(x);
const hash = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

export function createExplosions(scene, glow, smoke, chipModel, { reducedMotion = false, seed = 99 } = {}) {
  const rng = makeRng(seed);
  const fireballs = createFireballs(scene);
  const debris = createDebris(scene, chipModel);
  const sparks = createPool(3072, GLOW_FIELDS);
  const puffs = createPool(1536, SMOKE_FIELDS);
  const lobes = [], rings = [], surges = [], timers = [], drawn = [];
  const fartherFirst = (a, b) => b.depth - a.depth;
  const flashScale = reducedMotion ? 0.5 : 1;
  // Two lights, created once and never hidden: changing the number of
  // lights in the scene would recompile every lit material mid-fight.
  const lights = [0, 1].map(() => {
    const light = new THREE.PointLight(0xffc890, 0, 100, 2);
    scene.add(light);
    return { light, pos: [0, 0, 0], vel: [0, 0, 0], age: 0, life: 0, peak: 0, seed: 0 };
  });
  const cam = new THREE.Vector3(), camFwd = new THREE.Vector3(), camPrev = new THREE.Vector3(), camVel = [0, 0, 0];
  let haveCam = false, clock = 0;
  // Each frame's sparks and puffs go to their batches through these (the
  // batches' addFrom), not as a dozen numbers each, which would be boxed.
  const sprite = new Float64Array(12), puffOut = new Float64Array(11);
  const dir = [0, 0, 0];

  /* ---------- emitters ---------- */

  // A random unit vector within `spread` radians of `n` (any direction when
  // `n` is null).
  function cone(o, n, spread) {
    if (!n) return rng.unit(o);
    const cosMax = Math.cos(spread), z = cosMax + (1 - cosMax) * rng.next();
    const r = Math.sqrt(Math.max(0, 1 - z * z)), phi = 2 * Math.PI * rng.next();
    const hx = Math.abs(n[0]) < 0.9 ? 1 : 0, hy = 1 - hx;
    // t1 = normalize(helper × n), t2 = n × t1
    let ax = hy * n[2], ay = -hx * n[2], az = hx * n[1] - hy * n[0];
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    const bx = n[1] * az - n[2] * ay, by = n[2] * ax - n[0] * az, bz = n[0] * ay - n[1] * ax;
    const c = r * Math.cos(phi), s = r * Math.sin(phi);
    o[0] = ax * c + bx * s + n[0] * z; o[1] = ay * c + by * s + n[1] * z; o[2] = az * c + bz * s + n[2] * z;
    return o;
  }

  function spark(x, y, z, base, d, speed, life, size, hot, cool, power, o = {}) {
    const i = claim(sparks), P = sparks;
    P.x[i] = x; P.y[i] = y; P.z[i] = z;
    P.vx[i] = base[0] + d[0] * speed; P.vy[i] = base[1] + d[1] * speed; P.vz[i] = base[2] + d[2] * speed;
    P.bx[i] = base[0]; P.by[i] = base[1]; P.bz[i] = base[2];
    P.age[i] = 0; P.life[i] = life; P.size[i] = size; P.grow[i] = o.grow ?? 1;
    P.r[i] = hot[0]; P.g[i] = hot[1]; P.b[i] = hot[2]; P.r2[i] = cool[0]; P.g2[i] = cool[1]; P.b2[i] = cool[2];
    P.power[i] = power; P.fade[i] = o.fade ?? 1.5; P.drag[i] = o.drag ?? 0;
    P.streak[i] = o.streak ?? 0.028; P.flicker[i] = o.flicker ?? 0;
  }

  function burst(count, pos, base, { normal = null, spread = Math.PI, speed, life, size, hot = SPARK_HOT, cool = SPARK_COOL, power = 6, ...o }) {
    for (let k = 0; k < count; k++) {
      cone(dir, normal, spread);
      spark(pos[0], pos[1], pos[2], base, dir, rng.range(speed[0], speed[1]), rng.range(life[0], life[1]),
        size * rng.range(0.7, 1.3), hot, cool, power * rng.range(0.7, 1.2), o);
    }
  }

  function flash(pos, base, size, color, power, life) {
    spark(pos[0], pos[1], pos[2], base, ZERO, 0, life, size, color, color, power * flashScale, { fade: 2, grow: 1.5, streak: 0 });
  }

  function puff(x, y, z, vx, vy, vz, base, size, grow, life, color, alpha, o = {}) {
    const i = claim(puffs), P = puffs;
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.bx[i] = base[0]; P.by[i] = base[1]; P.bz[i] = base[2];
    P.age[i] = 0; P.life[i] = life; P.size[i] = size; P.grow[i] = grow;
    const shade = rng.range(0.85, 1.15);
    P.r[i] = color[0] * shade; P.g[i] = color[1] * shade; P.b[i] = color[2] * shade; P.alpha[i] = alpha;
    P.drag[i] = o.drag ?? 0.6; P.angle[i] = rng.range(0, Math.PI * 2); P.spin[i] = rng.range(-0.5, 0.5);
    P.cell[i] = rng.int(0, 3); P.glow[i] = o.glow ?? 0; P.glowLife[i] = o.glowLife ?? 0.3; P.fadeIn[i] = o.fadeIn ?? 0.08;
  }

  // A cloud of puffs started inside `spread` metres of `pos`, pushed out.
  function cloud(count, pos, base, { spread, speed, size, grow, life, color, alpha, normal = null, ...o }) {
    for (let k = 0; k < count; k++) {
      cone(dir, normal, normal ? 1.1 : Math.PI);
      const at = rng.range(0, spread), v = rng.range(speed[0], speed[1]);
      puff(pos[0] + dir[0] * at, pos[1] + dir[1] * at, pos[2] + dir[2] * at,
        base[0] + dir[0] * v, base[1] + dir[1] * v, base[2] + dir[2] * v, base,
        size * rng.range(0.7, 1.3), grow, rng.range(life[0], life[1]), color, alpha * rng.range(0.75, 1.1), o);
    }
  }

  function fireball(count, pos, base, { radius, spread, life, delay = [0, 0], heat = 1, gain = 1 }) {
    for (let k = 0; k < count; k++) {
      if (lobes.length >= 64) lobes.shift();
      rng.unit(dir);
      const at = rng.range(0, spread), drift = rng.range(0.5, 2.5) * spread;
      lobes.push({
        x: pos[0] + dir[0] * at, y: pos[1] + dir[1] * at, z: pos[2] + dir[2] * at,
        vx: base[0] + dir[0] * drift, vy: base[1] + dir[1] * drift, vz: base[2] + dir[2] * drift,
        age: 0, delay: rng.range(delay[0], delay[1]), life: rng.range(life[0], life[1]),
        radius: rng.range(radius[0], radius[1]), seed: rng.range(0, 500), heat, gain, t: 0, depth: 0,
      });
    }
  }

  function ring(pos, base, normal, radius, life, color, power, width) {
    if (rings.length >= 24) rings.shift();
    const n = normal ?? rng.unit([0, 0, 0]);
    rings.push({
      x: pos[0], y: pos[1], z: pos[2], vx: base[0], vy: base[1], vz: base[2], nx: n[0], ny: n[1], nz: n[2],
      age: 0, life, radius, width, color, power, seed: rng.range(0, 100),
    });
  }

  function chips(count, pos, base, { normal = null, spread = Math.PI, speed, size, life }) {
    for (let k = 0; k < count; k++) {
      cone(dir, normal, spread);
      const v = rng.range(speed[0], speed[1]);
      debris.chip(pos[0], pos[1], pos[2], base[0] + dir[0] * v, base[1] + dir[1] * v, base[2] + dir[2] * v,
        rng.range(size[0], size[1]), rng.range(life[0], life[1]), rng);
    }
  }

  function shards(count, pos, base, palette, { spread, speed, size, life }) {
    for (let k = 0; k < count; k++) {
      rng.unit(dir);
      const at = rng.range(0, spread), v = rng.range(speed[0], speed[1]);
      const piece = debris.shard(pos[0] + dir[0] * at, pos[1] + dir[1] * at, pos[2] + dir[2] * at,
        base[0] + dir[0] * v, base[1] + dir[1] * v, base[2] + dir[2] * v,
        rng.range(size[0], size[1]), rng.pick(palette), rng.range(0.75, 1), rng.range(life[0], life[1]), rng);
      piece.base[0] = base[0]; piece.base[1] = base[1]; piece.base[2] = base[2];
    }
  }

  function light(pos, base, peak, range, life) {
    // Take a dark light, or else the one with the least left to give.
    let slot = lights[0], best = Infinity;
    for (const l of lights) {
      const left = l.age >= l.life ? 0 : l.peak * (1 - l.age / l.life);
      if (left < best) { best = left; slot = l; }
    }
    if (best > peak) return;
    slot.pos[0] = pos[0]; slot.pos[1] = pos[1]; slot.pos[2] = pos[2];
    slot.vel[0] = base[0]; slot.vel[1] = base[1]; slot.vel[2] = base[2];
    slot.age = 0; slot.life = life; slot.peak = peak; slot.seed = rng.range(0, 100);
    slot.light.distance = range;
  }

  function surge(pos, base, size, strength) {
    if (surges.length >= 8) surges.shift();
    surges.push({ x: pos[0], y: pos[1], z: pos[2], vx: base[0], vy: base[1], vz: base[2], size, strength: strength * flashScale, age: 0 });
  }

  /* ---------- recipes ---------- */

  function impact(kind, pos, normal, base) {
    if (kind === 'rock') {
      flash(pos, base, 1.6, [1, 0.85, 0.62], 7, 0.07);
      burst(9, pos, base, { normal, spread: 1.2, speed: [15, 70], life: [0.2, 0.55], size: 0.12, power: 5 });
      cloud(3, pos, base, { normal, spread: 0.4, speed: [3, 9], size: 0.8, grow: 5, life: [1.6, 2.6], color: DUST, alpha: 0.5, drag: 1.2 });
      chips(rng.int(2, 3), pos, base, { normal, spread: 1, speed: [8, 25], size: [0.08, 0.18], life: [2.5, 4] });
    } else if (kind === 'hull') {
      flash(pos, base, 2.2, [1, 0.72, 0.45], 9, 0.08);
      burst(16, pos, base, { normal, spread: 1.3, speed: [25, 90], life: [0.25, 0.7], size: 0.14, power: 6 });
      spark(pos[0], pos[1], pos[2], base, ZERO, 0, 0.22, 1.2, [1, 0.6, 0.2], [1, 0.25, 0.04], 3, { grow: 1.8, fade: 1.2, streak: 0 });
      cloud(2, pos, base, { normal, spread: 0.3, speed: [2, 6], size: 0.6, grow: 5, life: [1, 1.6], color: SOOT, alpha: 0.45, glow: 1.5, glowLife: 0.15 });
    } else {
      flash(pos, base, 2.6, [0.6, 0.85, 1], 8, 0.1);
      // A shield splashes rather than breaks: sparks skate along it.
      for (let k = 0; k < 12; k++) {
        cone(dir, normal, Math.PI / 2);
        const off = dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2];
        for (let i = 0; i < 3; i++) dir[i] -= normal[i] * (off - 0.35);
        const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        for (let i = 0; i < 3; i++) dir[i] /= l;
        spark(pos[0], pos[1], pos[2], base, dir, rng.range(20, 55), rng.range(0.12, 0.3), 0.11, SHIELD_HOT, SHIELD_COOL, 5, { streak: 0.03 });
      }
      ring(pos, base, normal, 3.2, 0.28, [0.35, 0.7, 1], 3.5, 0.12);
    }
  }

  function rockBreak(pos, base, radius, crumble) {
    const R = radius;
    if (crumble) {
      cloud(4 + Math.round(R), pos, base, { spread: 0.6 * R, speed: [1, 4], size: 0.5 * R, grow: 3, life: [2.5, 4], color: DUST, alpha: 0.35 });
      chips(2, pos, base, { speed: [2, 8], size: [0.1, 0.25], life: [2, 3.5] });
      return;
    }
    flash(pos, base, Math.max(2, 0.9 * R), [1, 0.92, 0.75], 10, 0.08);
    spark(pos[0], pos[1], pos[2], base, ZERO, 0, 0.3, 0.7 * R, [1, 0.45, 0.12], [0.8, 0.12, 0.02], 1.5, { streak: 0, fade: 1.2 });
    fireball(R > 6 ? 2 : 1, pos, base, { radius: [0.45 * R, 0.6 * R], spread: 0.3 * R, life: [0.32, 0.42], heat: 0.75, gain: 0.8 });
    burst(Math.min(90, 18 + Math.round(5 * R)), pos, base, { speed: [20, 110], life: [0.35, 1.1], size: 0.16 });
    burst(Math.min(30, 5 + Math.round(2 * R)), pos, base, {
      speed: [6, 35], life: [1, 2.6], size: 0.3, hot: EMBER_HOT, cool: EMBER_COOL, power: 2.5, drag: 0.6, flicker: 0.6, streak: 0.02, fade: 1,
    });
    cloud(Math.min(28, 7 + Math.round(2 * R)), pos, base, {
      spread: 0.5 * R, speed: [2, 10 + 0.6 * R], size: Math.max(1, 0.45 * R), grow: 3.2, life: [3, 6], color: DUST, alpha: 0.55,
      drag: 0.7, glow: 0.6, glowLife: 0.2,
    });
    chips(Math.min(28, 6 + Math.round(2 * R)), pos, base,
      { speed: [8, 40], size: [Math.max(0.12, 0.06 * R), Math.min(1.6, Math.max(0.2, 0.14 * R))], life: [4, 7] });
    light(pos, base, 2500 * R, 12 * R + 30, 0.45);
    surge(pos, base, R, 0.25);
  }

  function blast(pos, base) {
    flash(pos, base, 7, [1, 0.9, 0.72], 14, 0.09);
    fireball(4, pos, base, { radius: [6, 9], spread: 4, life: [0.65, 0.9], delay: [0, 0.07] });
    ring(pos, base, null, 36, 0.4, [1, 0.72, 0.45], 0.8, 0.035);
    burst(60, pos, base, { speed: [60, 220], life: [0.4, 1.1], size: 0.14, power: 5 });
    burst(18, pos, base, { speed: [15, 60], life: [1.2, 2.8], size: 0.4, hot: EMBER_HOT, cool: EMBER_COOL, power: 3, drag: 0.5, flicker: 0.7, streak: 0.02, fade: 1 });
    cloud(14, pos, base, {
      spread: 4, speed: [5, 16], size: 3, grow: 4, life: [3, 4.5], color: SOOT, alpha: 0.5, drag: 0.6, glow: 0.8, glowLife: 0.3, fadeIn: 0.35,
    });
    light(pos, base, 30000, 160, 0.6);
    surge(pos, base, 10, 0.6);
  }

  function shipDeath(pos, base, kind) {
    const S = { fighter: 1.35, anvil: 1.7, maul: 1.6, talon: 1.3, swift: 1.1, mite: 0.55, drone: 0.5, sentry: 0.9 }[kind] ?? 1;
    flash(pos, base, 10 * S, [1, 0.9, 0.75], 16, 0.11);
    fireball(6, pos, base, { radius: [8 * S, 13 * S], spread: 5 * S, life: [0.95, 1.35], delay: [0, 0.16] });
    // A second blast a beat later: fuel and ammunition going up.
    fireball(2, pos, base, { radius: [5 * S, 7 * S], spread: 6 * S, life: [0.7, 0.9], delay: [0.25, 0.45], heat: 0.85 });
    timers.push({ at: clock + 0.3, fn: () => {
      const p = [pos[0] + base[0] * 0.3, pos[1] + base[1] * 0.3, pos[2] + base[2] * 0.3];
      flash(p, base, 7 * S, [1, 0.85, 0.6], 14, 0.08);
      burst(Math.round(40 * S), p, base, { speed: [40, 160], life: [0.4, 1], size: 0.18 });
    } });
    ring(pos, base, null, 55 * S, 0.55, [1, 0.75, 0.5], 0.8, 0.03);
    burst(Math.round(120 * S), pos, base, { speed: [50, 280], life: [0.5, 1.6], size: 0.15, power: 4.5 });
    burst(Math.round(34 * S), pos, base, {
      speed: [15, 90], life: [1.5, 3.5], size: 0.45, hot: EMBER_HOT, cool: EMBER_COOL, power: 3, drag: 0.35, flicker: 0.7, streak: 0.02, fade: 1,
    });
    shards(Math.round(14 * S), pos, base, HULLS[kind] ?? HULLS.interceptor, { spread: 3 * S, speed: [12, 70], size: [0.8, 2.6], life: [4, 7] });
    cloud(Math.round(24 * S), pos, base, {
      spread: 5 * S, speed: [5, 22], size: 4 * S, grow: 4.5, life: [4, 6.5], color: SOOT, alpha: 0.5, drag: 0.5, glow: 0.8, glowLife: 0.35, fadeIn: 0.5,
    });
    light(pos, base, 60000 * S, 260, 1.1);
    surge(pos, base, 14 * S, 0.9);
  }

  /* A large ship dies over seconds: blasts walk across its hull, then the
     core goes. Everything rides the wreck's own velocity. `points` are
     local offsets (collision spheres) to burst at, already in world
     orientation. */
  function bigDeath(pos, base, radius, kind, points = null) {
    const t0 = clock;
    const S = Math.min(14, Math.max(1.6, radius / 28));
    const n = Math.round(Math.min(16, 3 + radius / 50));
    const span = bigDeathSpan(radius);
    const at = k => (points?.length ? points[(k * 7) % points.length] : rng.unit([0, 0, 0]).map(v => v * radius * rng.range(0.15, 0.75)));
    const where = off => [pos[0] + off[0] + base[0] * (clock - t0), pos[1] + off[1] + base[1] * (clock - t0), pos[2] + off[2] + base[2] * (clock - t0)];
    for (let k = 0; k < n; k++) {
      const off = at(k), when = rng.range(0, span);
      timers.push({ at: clock + when, fn: () => {
        const p = where(off), s = S * rng.range(0.35, 0.6);
        flash(p, base, 8 * s, [1, 0.88, 0.7], 14, 0.12);
        fireball(4, p, base, { radius: [6 * s, 10 * s], spread: 4 * s, life: [0.9, 1.4], delay: [0, 0.1] });
        burst(Math.round(40 + 6 * s), p, base, { speed: [40, 200], life: [0.5, 1.4], size: 0.18 * Math.sqrt(s), power: 5 });
        shards(Math.round(4 + s), p, base, HULLS[kind] ?? CIVIL_PLATES, { spread: 2 * s, speed: [10, 60], size: [1.2 * s, 3 * s], life: [5, 9] });
        cloud(Math.round(6 + s), p, base, { spread: 3 * s, speed: [4, 16], size: 3 * s, grow: 3.5, life: [5, 8], color: SOOT, alpha: 0.5, drag: 0.4, glow: 0.9, glowLife: 0.4, fadeIn: 0.4 });
        light(p, base, 40000 * s, 200 * s, 0.8);
        surge(p, base, 6 * s, 0.5);
      } });
    }
    timers.push({ at: clock + span + 0.4, fn: () => {
      const p = where([0, 0, 0]);
      flash(p, base, radius * 1.2, [1, 0.95, 0.85], 18, 0.25);
      fireball(12, p, base, { radius: [S * 9, S * 15], spread: radius * 0.45, life: [1.6, 2.6], delay: [0, 0.4] });
      ring(p, base, null, radius * 2.6, 1.4, [1, 0.8, 0.55], 1.2, 0.03);
      ring(p, base, null, radius * 1.8, 1.1, [1, 0.6, 0.35], 1, 0.04);
      burst(Math.round(160 + 4 * S), p, base, { speed: [80, 420], life: [0.8, 2.4], size: 0.25 * Math.sqrt(S), power: 5 });
      burst(60, p, base, { speed: [20, 120], life: [2, 5], size: 0.6 * Math.sqrt(S), hot: EMBER_HOT, cool: EMBER_COOL, power: 3, drag: 0.25, flicker: 0.7, streak: 0.02, fade: 1 });
      shards(Math.round(20 + S * 2), p, base, HULLS[kind] ?? CIVIL_PLATES, { spread: radius * 0.4, speed: [20, 110], size: [2 * S, 5 * S], life: [8, 14] });
      cloud(Math.round(30 + S), p, base, { spread: radius * 0.4, speed: [6, 30], size: 6 * S, grow: 4, life: [7, 12], color: SOOT, alpha: 0.55, drag: 0.3, glow: 1, glowLife: 0.6, fadeIn: 0.6 });
      light(p, base, 400000 * S, radius * 6, 2);
      surge(p, base, radius, 1.4);
    } });
  }

  function flak(pos, base) {
    flash(pos, base, 3.5, [1, 0.7, 0.35], 9, 0.07);
    burst(18, pos, base, { speed: [30, 120], life: [0.2, 0.5], size: 0.12, power: 5 });
    cloud(3, pos, base, { spread: 2, speed: [2, 6], size: 2.4, grow: 3, life: [1.6, 2.6], color: SOOT, alpha: 0.55, glow: 1.2, glowLife: 0.12 });
  }

  function pop(pos, base) {
    flash(pos, base, 4, [1, 0.85, 0.6], 11, 0.08);
    burst(26, pos, base, { speed: [30, 150], life: [0.3, 0.8], size: 0.13, power: 5 });
    cloud(4, pos, base, { spread: 1.5, speed: [3, 9], size: 1.6, grow: 4, life: [2, 3], color: SOOT, alpha: 0.5, glow: 1, glowLife: 0.15 });
    light(pos, base, 8000, 60, 0.3);
  }

  function hatch(pos, base, radius) {
    rockBreak(pos, base, radius * 0.5, false);
    burst(50, pos, base, { speed: [30, 140], life: [0.6, 1.4], size: 0.3, hot: [1, 0.25, 0.1], cool: [0.6, 0.02, 0.01], power: 5 });
    flash(pos, base, radius * 1.5, [1, 0.25, 0.12], 10, 0.3);
  }

  function jumpFlash(pos, base, radius, colour = [0.7, 0.85, 1]) {
    flash(pos, base, radius * 1.5, colour, 16, 0.3);
    ring(pos, base, null, radius * 3, 0.9, colour, 1.2, 0.035);
    burst(80, pos, base, { speed: [100, 500], life: [0.3, 0.9], size: 0.25, hot: [0.9, 0.97, 1], cool: [0.3, 0.55, 1], power: 6 });
    light(pos, base, 200000, radius * 8, 0.8);
    surge(pos, base, radius, 1);
  }

  function beamHit(pos, normal, base) {
    flash(pos, base, 5, [1, 0.45, 0.2], 10, 0.05);
    burst(6, pos, base, { normal, spread: 1.2, speed: [30, 120], life: [0.2, 0.6], size: 0.2, power: 6 });
    if (rng.next() < 0.3) cloud(1, pos, base, { normal, spread: 1, speed: [4, 12], size: 2.5, grow: 4, life: [1.5, 3], color: SOOT, alpha: 0.5, glow: 1.4, glowLife: 0.3 });
  }

  // A damaged ship trails smoke and, when it is bad, fire and sparks.
  function smoulder(pos, base, size, fire) {
    puff(pos[0], pos[1], pos[2], base[0] * 0.9 + rng.range(-2, 2), base[1] * 0.9 + rng.range(-2, 2), base[2] * 0.9 + rng.range(-2, 2), base,
      size, 3, rng.range(1.2, 2.4), SOOT, 0.42, { drag: 0.8, glow: fire, glowLife: 0.25 });
    if (fire > 0.5 && rng.next() < 0.35) burst(2, pos, base, { speed: [10, 40], life: [0.2, 0.5], size: 0.1, power: 5 });
  }

  // A hot shard burns as it flies: fire on the shard, and smoke left behind
  // that falls back into the cloud's frame, so it draws a trail. This runs
  // every frame for every hot shard, so its options are reused, not made.
  const trailPuff = { drag: 2, glow: 0, glowLife: 0.2 };
  function trail(piece, dt) {
    const h = piece.heat, p = piece.pos;
    glow.add(p[0], p[1], p[2], 0.5 + 1.3 * h, 1, 0.45 + 0.4 * h, 0.12 + 0.4 * h * h, 3.2 * h * h);
    piece.trail += dt;
    trailPuff.glow = 1.6 * h;
    while (piece.trail >= 0.05) {
      piece.trail -= 0.05;
      puff(p[0], p[1], p[2], piece.vel[0], piece.vel[1], piece.vel[2], piece.base, 0.5, 4, rng.range(0.9, 1.4), SOOT, 0.45 * h, trailPuff);
    }
  }

  /* ---------- per frame ---------- */

  function update(dt, camera) {
    clock += dt;
    camera.getWorldPosition(cam);
    camera.getWorldDirection(camFwd);
    if (haveCam && dt > 0) {
      const vx = (cam.x - camPrev.x) / dt, vy = (cam.y - camPrev.y) / dt, vz = (cam.z - camPrev.z) / dt;
      // Nothing flies at 2 km/s: a jump that fast is a cut (a restart, the
      // launch), not motion.
      if (vx * vx + vy * vy + vz * vz > 4e6) camVel.fill(0);
      else {
        const k = 1 - Math.exp(-dt * 20);
        camVel[0] += (vx - camVel[0]) * k; camVel[1] += (vy - camVel[1]) * k; camVel[2] += (vz - camVel[2]) * k;
      }
    }
    camPrev.copy(cam); haveCam = true;

    for (let k = timers.length - 1; k >= 0; k--) {
      if (clock >= timers[k].at) { const { fn } = timers[k]; timers.splice(k, 1); fn(); }
    }

    fireballs.begin();
    drawn.length = 0;
    for (let k = lobes.length - 1; k >= 0; k--) {
      const l = lobes[k];
      l.age += dt;
      l.x += l.vx * dt; l.y += l.vy * dt; l.z += l.vz * dt;
      const t = (l.age - l.delay) / l.life;
      if (t >= 1) { lobes.splice(k, 1); continue; }
      if (t < 0) continue;
      l.t = t;
      l.depth = (l.x - cam.x) * camFwd.x + (l.y - cam.y) * camFwd.y + (l.z - cam.z) * camFwd.z;
      drawn.push(l);
    }
    drawn.sort(fartherFirst);
    for (const l of drawn) {
      // Swells hard for the first 40 % of its life, then keeps spreading slowly.
      const g = Math.min(1, l.t / 0.4);
      const radius = l.radius * (0.2 + 0.8 * (1 - (1 - g) ** 3) + 0.3 * Math.max(0, l.t - 0.4));
      fireballs.lobe(l.x, l.y, l.z, radius, l.t, l.seed, l.heat, l.gain);
    }
    for (let k = rings.length - 1; k >= 0; k--) {
      const r = rings[k];
      r.age += dt;
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      const t = r.age / r.life;
      if (t >= 1) { rings.splice(k, 1); continue; }
      fireballs.ring(r.x, r.y, r.z, r.nx, r.ny, r.nz, r.radius * (1 - (1 - t) ** 2.5), r.width * (1 + t), t, r.seed,
        r.color[0], r.color[1], r.color[2], r.power);
    }
    fireballs.end();

    debris.update(dt, trail);

    const G = sparks;
    for (let i = G.n - 1; i >= 0; i--) {
      G.age[i] += dt;
      if (G.age[i] >= G.life[i]) { release(G, i); continue; }
      if (G.drag[i] > 0) {
        const k = Math.exp(-G.drag[i] * dt);
        G.vx[i] = G.bx[i] + (G.vx[i] - G.bx[i]) * k;
        G.vy[i] = G.by[i] + (G.vy[i] - G.by[i]) * k;
        G.vz[i] = G.bz[i] + (G.vz[i] - G.bz[i]) * k;
      }
      const x = G.x[i] += G.vx[i] * dt, y = G.y[i] += G.vy[i] * dt, z = G.z[i] += G.vz[i] * dt;
      const t = G.age[i] / G.life[i];
      let power = G.power[i] * (1 - t) ** G.fade[i];
      if (G.flicker[i] > 0) power *= 1 - G.flicker[i] * hash(i + G.life[i] * 97, Math.floor(clock * 24));
      let size = G.size[i] * (1 + (G.grow[i] - 1) * t);
      // Motion blur along the spark's motion as the camera sees it.
      let ax = 0, ay = 0, az = 0, length = 0;
      if (G.streak[i] > 0) {
        const rx = G.vx[i] - camVel[0], ry = G.vy[i] - camVel[1], rz = G.vz[i] - camVel[2];
        // (Square roots, not Math.hypot: twice a spark a frame, its boxed
        // arguments and scratch array were most of a big fight's garbage.)
        const speed = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (speed > 1e-3) { ax = rx / speed; ay = ry / speed; az = rz / speed; length = speed * G.streak[i]; }
      }
      const cx = x - cam.x, cy = y - cam.y, cz = z - cam.z;
      const least = Math.sqrt(cx * cx + cy * cy + cz * cz) * PIXEL;
      if (size < least) { const f = size / least; power *= length > 0 ? f : f * f; size = least; }
      const o = sprite;
      o[0] = x; o[1] = y; o[2] = z; o[3] = size;
      o[4] = G.r[i] + (G.r2[i] - G.r[i]) * t; o[5] = G.g[i] + (G.g2[i] - G.g[i]) * t; o[6] = G.b[i] + (G.b2[i] - G.b[i]) * t;
      o[7] = power; o[8] = ax; o[9] = ay; o[10] = az; o[11] = length;
      glow.addFrom(o);
    }

    const S = puffs;
    for (let i = S.n - 1; i >= 0; i--) {
      const age = S.age[i] += dt;
      if (age >= S.life[i]) { release(S, i); continue; }
      const k = Math.exp(-S.drag[i] * dt);
      S.vx[i] = S.bx[i] + (S.vx[i] - S.bx[i]) * k;
      S.vy[i] = S.by[i] + (S.vy[i] - S.by[i]) * k;
      S.vz[i] = S.bz[i] + (S.vz[i] - S.bz[i]) * k;
      S.x[i] += S.vx[i] * dt; S.y[i] += S.vy[i] * dt; S.z[i] += S.vz[i] * dt;
      S.angle[i] += S.spin[i] * dt;
      const t = age / S.life[i];
      // Spreads fast and then slowly; thins away over the second half.
      const size = S.size[i] * (1 + (S.grow[i] - 1) * (1 - (1 - t) ** 2.2));
      const fadeOut = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
      const alpha = S.alpha[i] * Math.min(1, age / S.fadeIn[i]) * fadeOut * fadeOut;
      const o = puffOut;
      o[0] = S.x[i]; o[1] = S.y[i]; o[2] = S.z[i]; o[3] = size; o[4] = S.r[i]; o[5] = S.g[i]; o[6] = S.b[i];
      o[7] = alpha; o[8] = S.angle[i]; o[9] = S.cell[i]; o[10] = S.glow[i] * Math.exp(-age / S.glowLife[i]);
      smoke.addFrom(o);
    }

    for (const l of lights) {
      if (l.age >= l.life) { l.light.intensity = 0; continue; }
      l.age += dt;
      for (let k = 0; k < 3; k++) l.pos[k] += l.vel[k] * dt;
      const t = Math.min(1, l.age / l.life);
      const envelope = 0.72 * Math.exp(-l.age / 0.09) + 0.28 * (1 - t);
      l.light.intensity = l.peak * envelope * flashScale * (0.8 + 0.4 * hash(l.seed, Math.floor(clock * 30)));
      l.light.color.setRGB(1, 0.78 - 0.3 * t, 0.56 - 0.4 * t);
      l.light.position.set(l.pos[0], l.pos[1], l.pos[2]);
    }

    let dazzle = 0;
    for (let k = surges.length - 1; k >= 0; k--) {
      const s = surges[k];
      s.age += dt;
      if (s.age > 0.6) { surges.splice(k, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const d = Math.max(1, Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z));
      // Only what is in view dazzles.
      const facing = ((s.x - cam.x) * camFwd.x + (s.y - cam.y) * camFwd.y + (s.z - cam.z) * camFwd.z) / d;
      if (facing <= 0) continue;
      dazzle += s.strength * Math.exp(-s.age / 0.12) * Math.min(1, (s.size * 5 / d) ** 2) * facing;
    }
    return { flash: Math.min(1, dazzle) };
  }

  return {
    get counts() { return { sparks: sparks.n, puffs: puffs.n, lobes: lobes.length, rings: rings.length, debris: debris.count }; },
    impact, rockBreak, blast, shipDeath, bigDeath, flak, pop, hatch, jumpFlash, beamHit, smoulder, update,
    // The renderer's side of the simulation's events.
    handle(e, extra = null) {
      switch (e.type) {
        case 'boltHit': impact(e.kind === 'rock' ? 'rock' : e.shielded ? 'shield' : 'hull', e.pos, e.normal, e.vel ?? ZERO); break;
        case 'rockBreak': rockBreak(e.pos, e.vel ?? ZERO, e.radius, !!e.crumble); break;
        case 'missileExplode': case 'missileExpire':
          if (e.torpedo) { blast(e.pos, e.vel ?? ZERO); fireball(4, e.pos, e.vel ?? ZERO, { radius: [12, 18], spread: 10, life: [0.9, 1.3] }); ring(e.pos, e.vel ?? ZERO, null, 90, 0.6, [1, 0.7, 0.45], 0.9, 0.03); }
          else blast(e.pos, e.vel ?? ZERO);
          break;
        case 'missileDestroyed': pop(e.pos, e.vel ?? ZERO); break;
        case 'flak': flak(e.pos, e.vel ?? ZERO); break;
        case 'hatch': hatch(e.pos, ZERO, 20); break;
        case 'impact': rockBreak(e.pos, ZERO, 20, false); blast(e.pos, ZERO); break;
        case 'shipKilled':
          if (e.big) bigDeath(e.pos, e.vel ?? ZERO, e.radius ?? 100, e.kind, extra);
          else shipDeath(e.pos, e.vel ?? ZERO, e.kind);
          break;
      }
    },
    clear() {
      sparks.n = 0; puffs.n = 0;
      lobes.length = 0; rings.length = 0; surges.length = 0; timers.length = 0;
      debris.clear();
      for (const l of lights) { l.age = l.life = 0; l.light.intensity = 0; }
    },
    fireballs, debris, lights: lights.map(l => l.light),
  };
}
