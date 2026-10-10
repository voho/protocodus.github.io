/* Meteora — the world: every simulated thing, stepped in a fixed order.

   One step is 1/120 s and always runs the same sequence: the player's ship
   and guns, the enemy pilots and their guns, the attitude thrusters the
   renderer will puff, bolts and missiles, the drifting rock fragments,
   collisions, shields, deaths, and the next wave. Nothing in here knows a
   frame exists. `advance` feeds real time in and runs at most eight steps
   per frame; a tab that slept for a minute comes back where it left off
   rather than fast-forwarding the fight through a minute of rocks.

   The renderer learns what happened from `events` (shots, hits, breaks,
   kills, waves), drained once per frame, and interpolates between each
   ship's previous and current step from `prevPos` / `prevQ`. */

import { CANNON, COMBAT, ENEMY, ENEMY_CANNON, FIELD, MAX_STEPS, MISSILE, PLAYER, STEP } from './config.js';
import { ANCHORS } from './anchors.js';
import { createField } from './field.js';
import { NEUTRAL_CONTROLS, aimCommands, createShip, forward, selectRcsPorts, stepShip } from './flight.js';
import {
  createGun, createLock, createWeapons, fireBolt, launchMissile, stepWeapons, triggerGun, updateLock,
} from './weapons.js';
import { createBrain, thinkEnemy } from './ai.js';
import {
  applyDamage, loadBest, resolveShipRock, resolveShipShip, saveBest, scoreKill, scoreRock,
  spawnPoints, stepShield, waveSize,
} from './combat.js';
import { makeRng } from './rng.js';
import { dot, len, normalize, qLookRotation, qRotate, sub } from './vec.js';

const LAUNCHER = [0, -1.4, -1.5];

function makeEntity(world, kind, stats, team, pos, q) {
  const ship = createShip(stats, { pos, q });
  ship.prevPos = [...ship.pos];
  ship.prevQ = [...ship.q];
  return {
    id: world.nextId++, team, kind, stats, ship, radius: stats.radius,
    shield: stats.shield, hull: stats.hull, maxShield: stats.shield, maxHull: stats.hull,
    sinceHit: 99, alive: true, reported: false, rcsFired: [],
    gun: createGun(team === 0 ? CANNON : ENEMY_CANNON),
    missiles: team === 0 ? MISSILE.capacity : 0, missileTimer: 0,
    brain: team === 1 ? createBrain(world.rng.int(1, 2 ** 31 - 1)) : null,
  };
}

export function createWorld({ seed = 1234, storage = null, fieldCfg = FIELD } = {}) {
  const world = {
    seed, storage, field: createField(seed, fieldCfg), events: [],
    time: 0, accumulator: 0, weapons: null, rng: null, player: null, enemies: [],
    score: 0, wave: 0, waveTimer: 0, kills: 0, best: loadBest(storage), state: 'attract',
    lock: null, target: null, nextId: 1, leaving: false,
  };
  resetWorld(world);
  return world;
}

export function resetWorld(world) {
  world.field.reset();
  world.weapons = createWeapons();
  world.enemies = [];
  world.events.length = 0;
  world.rng = makeRng(world.seed);
  world.nextId = 1;
  world.player = makeEntity(world, 'fighter', PLAYER, 0, world.field.cfg.spawn, [0, 0, 0, 1]);
  world.score = 0; world.wave = 0; world.waveTimer = 0; world.kills = 0;
  world.time = 0; world.accumulator = 0;
  world.lock = createLock(); world.target = null;
  world.state = 'attract'; world.leaving = false;
}

export function startRun(world) {
  world.state = 'flying';
  world.waveTimer = 0;
}

export function drainEvents(world) { return world.events.splice(0); }

// Live enemies ordered by how far they sit from the crosshair.
function byCrosshair(world) {
  const p = world.player.ship, fwd = forward([0, 0, 0], p);
  const angle = e => {
    const d = normalize([0, 0, 0], sub([0, 0, 0], e.ship.pos, p.pos));
    return Math.acos(Math.max(-1, Math.min(1, dot(d, fwd))));
  };
  return world.enemies.filter(e => e.alive).sort((a, b) => angle(a) - angle(b));
}

function cycleTarget(world) {
  const alive = byCrosshair(world);
  if (!alive.length) { world.target = null; return; }
  world.target = alive[(alive.indexOf(world.target) + 1) % alive.length];
}

function spawnWave(world) {
  const p = world.player;
  world.wave++;
  world.enemies = world.enemies.filter(e => e.alive);
  const points = spawnPoints(world.rng, p.ship.pos, forward([0, 0, 0], p.ship), waveSize(world.wave));
  for (const pos of points) {
    const q = qLookRotation([0, 0, 0, 1], normalize([0, 0, 0], sub([0, 0, 0], p.ship.pos, pos)), [0, 1, 0]);
    const e = makeEntity(world, 'interceptor', ENEMY, 1, pos, q);
    e.ship.throttle = 0.8;
    world.enemies.push(e);
  }
  world.events.push({ type: 'wave', n: world.wave, count: points.length });
}

export function stepWorld(world, input, dt) {
  const ev = world.events, field = world.field, p = world.player;
  world.time += dt;
  const entities = [p, ...world.enemies];
  for (const e of entities) {
    const s = e.ship;
    s.prevPos[0] = s.pos[0]; s.prevPos[1] = s.pos[1]; s.prevPos[2] = s.pos[2];
    s.prevQ[0] = s.q[0]; s.prevQ[1] = s.q[1]; s.prevQ[2] = s.q[2]; s.prevQ[3] = s.q[3];
  }

  // The player.
  if (p.alive) {
    const flying = world.state === 'flying';
    // Mouse flight: an aim point replaces the stick's pitch and yaw.
    let controls = flying ? input : NEUTRAL_CONTROLS;
    if (flying && input.aimPoint) {
      const steer = aimCommands(p.ship, sub([0, 0, 0], input.aimPoint, p.ship.pos));
      controls = { ...input, pitch: steer.pitch, yaw: steer.yaw };
    }
    stepShip(p.ship, controls, dt);
    if (flying) {
      if (input.cycleTarget) cycleTarget(world);
      if (world.target && !world.target.alive) world.target = byCrosshair(world)[0] ?? null;
      updateLock(world.lock, p.ship, world.target, dt);
      if (triggerGun(p.gun, !!input.fire, dt)) {
        const muzzle = ANCHORS.fighter.muzzles[p.gun.muzzle];
        // Both guns converge on the aim point (within their gimbal).
        let aim = null;
        if (input.aimPoint) {
          const from = qRotate([0, 0, 0], p.ship.q, muzzle.pos);
          for (let k = 0; k < 3; k++) from[k] += p.ship.pos[k];
          aim = sub(from, input.aimPoint, from);
        }
        const bolt = fireBolt(world.weapons, p, muzzle.pos, CANNON, aim);
        ev.push({ type: 'fire', team: 0, shipId: p.id, muzzle: p.gun.muzzle, pos: [...bolt.pos], vel: [...bolt.vel] });
      }
      if (input.missile && p.missiles > 0) {
        p.missiles--;
        const m = launchMissile(world.weapons, p, LAUNCHER, world.lock.locked ? world.lock.targetId : null);
        ev.push({ type: 'missileLaunch', team: 0, id: m.id, pos: [...m.pos], locked: m.targetId != null });
      }
      if (p.missiles < MISSILE.capacity) {
        p.missileTimer += dt;
        if (p.missileTimer >= MISSILE.rearm) { p.missiles++; p.missileTimer = 0; }
      }
    }
  }

  // The enemies.
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const missileInbound = world.weapons.missiles.some(m => m.targetId === e.id);
    const threat = { locked: world.lock.locked && world.lock.targetId === e.id, missileInbound };
    const c = thinkEnemy(e.brain, e, { field, player: p, threat, wasHit: e.sinceHit < 0.1 }, dt);
    stepShip(e.ship, c, dt);
    const shooting = c.fire && p.alive && world.state === 'flying';
    if (triggerGun(e.gun, shooting, dt)) {
      const muzzle = ANCHORS.interceptor.muzzles[e.gun.muzzle];
      const bolt = fireBolt(world.weapons, e, muzzle.pos, ENEMY_CANNON);
      ev.push({ type: 'fire', team: 1, shipId: e.id, muzzle: e.gun.muzzle, pos: [...bolt.pos], vel: [...bolt.vel] });
    }
  }

  for (const e of entities) {
    e.rcsFired = e.alive ? selectRcsPorts(ANCHORS[e.kind].rcs, e.ship.accelLocal, e.ship.alphaLocal, e.stats) : [];
  }

  const before = ev.length;
  stepWeapons(world.weapons, {
    field, entities, events: ev,
    damage: (target, amount, point, dir) => applyDamage(target, amount, ev, point, dir),
  }, dt);
  for (let i = before; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === 'rockBreak' && e.team === 0 && !e.crumble) world.score += scoreRock(e.rockType);
  }
  field.step(dt, ev);

  for (const e of entities) if (e.alive) resolveShipRock(e, field, ev);
  for (let i = 0; i < entities.length; i++) {
    if (!entities[i].alive) continue;
    for (let j = i + 1; j < entities.length; j++) {
      if (entities[j].alive) resolveShipShip(entities[i], entities[j], ev);
    }
  }
  for (const e of entities) stepShield(e, dt);

  for (const e of entities) {
    if (e.alive || e.reported) continue;
    e.reported = true;
    ev.push({ type: 'shipKilled', id: e.id, team: e.team, kind: e.kind, pos: [...e.ship.pos], vel: [...e.ship.vel] });
    if (e.team === 1) {
      world.kills++;
      if (world.state === 'flying') world.score += scoreKill(world.wave);
      // A kill moves the target on to whoever is nearest the crosshair.
      if (world.target === e) world.target = byCrosshair(world)[0] ?? null;
    } else {
      world.state = 'dead';
      saveBest(world.storage, world.score);
      world.best = Math.max(world.best, world.score);
    }
  }

  if (world.state === 'flying') {
    if (world.enemies.some(e => e.alive)) world.waveTimer = COMBAT.wave.delay;
    else {
      world.waveTimer -= dt;
      if (world.waveTimer <= 0) { spawnWave(world); world.waveTimer = COMBAT.wave.delay; }
    }
  }

  const half = field.cfg.half, pos = p.ship.pos;
  const outside = Math.hypot(
    Math.max(0, Math.abs(pos[0]) - half[0]), Math.max(0, Math.abs(pos[1]) - half[1]), Math.max(0, Math.abs(pos[2]) - half[2]));
  world.leaving = outside > COMBAT.leaving;
}

/* Feed real time in; run at most MAX_STEPS fixed steps and drop the rest.
   One-shot inputs (a key press, a click) belong to the first step only. */
export function advance(world, input, frameDt) {
  world.accumulator += frameDt;
  let steps = 0;
  let current = input;
  while (world.accumulator >= STEP && steps < MAX_STEPS) {
    stepWorld(world, current, STEP);
    world.accumulator -= STEP;
    steps++;
    if (steps === 1) current = { ...input, toggleFA: false, missile: false, cycleTarget: false };
  }
  if (world.accumulator >= STEP) world.accumulator = world.accumulator % STEP;
  return steps;
}

export { len };
