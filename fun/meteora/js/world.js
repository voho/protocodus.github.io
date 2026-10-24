/* Meteora — the world: every simulated thing, stepped in a fixed order.

   One step is 1/120 s and always runs the same sequence: arrivals and
   departures through fold space; the player's ship, guns, ordnance and
   orders; the pilots, the helms of the large ships and the Tenders; turrets
   and beams; bolts, flak, missiles and torpedoes; the drifting rock
   fragments; collisions; shields; the Harrow's Eyes; scans; deaths and the
   score; seeds hatching and bays launching; and the mission's script.
   Nothing in here knows a frame exists. `advance` feeds real time in and
   runs at most eight steps per frame; a tab that slept for a minute comes
   back where it left off rather than fast-forwarding the fight.

   Everything that flies is an entity built from a class (catalog.js): the
   player, wingmen, the Harrow, freighters, stations, capital ships, Eyes,
   seeds, drones. A mission (mission.js) places them and decides when the
   fight is won; Survival (missions/survival.js) is a mission too.

   The renderer learns what happened from `events` (shots, hits, breaks,
   kills, folds, scans), drained once per frame, and interpolates between
   each ship's previous and current step from `prevPos` / `prevQ`. */

import { COMBAT, FIELD, MAX_STEPS, STEP, bigDeathSpan } from './config.js';
import { CLASSES, subsystemName } from './catalog.js';
import { GUNS, SECONDARIES, buildStats, defaultLoadout } from './loadout.js';
import { difficulty } from './difficulty.js';
import { hardpoints } from './hardpoints.js';
import { createField } from './field.js';
import { NEUTRAL_CONTROLS, aimCommands, createShip, forward, selectRcsPorts, stepShip } from './flight.js';
import {
  createGun, createLock, createWeapons, fireBolt, launchMissile, leadPoint, stepWeapons, triggerGun, updateLock,
} from './weapons.js';
import { createBrain, pickTarget, thinkPilot } from './ai.js';
import {
  applyDamage, equalizeShields, initShields, loadBest, resolveRockLarge, resolveShipLarge, resolveShipRock,
  resolveShipShip, saveBest, scoreRock, stepShield,
} from './combat.js';
import { createBeam, createTurret, stepBeam, stepTurrets } from './turrets.js';
import { createHelm, stepHelm } from './helm.js';
import { stepTender } from './drone.js';
import { stepSentries } from './detection.js';
import { subsystemWorld, toWorld } from './compound.js';
import { makeRng } from './rng.js';
import { createWell } from './well.js';
import { clamp, dot, len, normalize, qLookRotation, qRotate, sub } from './vec.js';

export const IDLE = Object.freeze({ ...NEUTRAL_CONTROLS, fire: false, missile: false, cycleTarget: false });
const FOLD_SMALL = 1.1, FOLD_LARGE = 2.6;
const STREAK_WINDOW = 4;
const SCAN_CONE = 30 * Math.PI / 180;

/* ---------- entities ---------- */

let survivalDef = null;
export function setDefaultMission(def) { survivalDef = def; }

/* Build an entity of class `cls`. Options: team, pos, q (or forward), vel,
   name, role, tags, orders, primary, missiles, torpedoes, helm ({ path,
   speed, then }), fold (arrive through fold space), hull / shield scale,
   invulnerable, unkillable, hidden, untargetable, disabled, scan ({ time,
   range, label }), leader, slot, protect, prefer, playerBias, home,
   launcher ({ cls, interval, max }), hatch ({ in, cls, count }), beamAuto. */
export function spawn(world, cls, o = {}) {
  const def = CLASSES[cls];
  if (!def) throw new Error(`unknown class ${cls}`);
  const team = o.team ?? (def.faction === 'harrow' ? 1 : def.faction === 'neutral' ? -1 : 0);
  const isPlayer = o.role === 'player';
  const stats = o.flight ?? def.flight;
  let q = o.q ? [...o.q] : [0, 0, 0, 1];
  if (!o.q && o.forward) qLookRotation(q, o.forward, o.up ?? [0, 1, 0]);
  const ship = createShip(stats, { pos: o.pos ?? [0, 0, 0], vel: o.vel ?? [0, 0, 0], q });
  ship.prevPos = [...ship.pos];
  ship.prevQ = [...ship.q];
  if (o.throttle != null) ship.throttle = o.throttle;
  const hp = hardpoints(def.model);
  const scale = def.modelScale ?? 1;
  const big = def.size === 'large';
  const friendly = team === 0 && !isPlayer;
  const hullMul = (o.hullScale ?? 1) * (friendly ? world.diff.friendlyHull : 1);
  const e = {
    id: world.nextId++, cls, def, model: def.model, name: o.name ?? def.name, team, role: o.role ?? def.role,
    big, fixed: !!(def.fixed || o.fixed), scale, ship, tint: o.tint ?? def.tint ?? null,
    radius: big ? hp.radius * scale : stats.radius,
    colliders: big ? (hp.colliders.length ? hp.colliders : [{ pos: [0, 0, 0], r: hp.radius * 0.8 }]).map(c => ({ pos: c.pos.map(v => v * scale), r: c.r * scale })) : null,
    subsystems: [], turrets: [], generators: 0, beam: null,
    quad: null, shield: 0, maxShield: 0, shieldRegen: def.shieldRegen ?? 0, shieldDelay: def.shieldDelay ?? 3,
    hull: def.hull * hullMul, maxHull: def.hull * hullMul, armor: def.armor ?? 0, rock: !!def.rock,
    signature: def.signature ?? 1, silent: 1,
    tags: new Set(o.tags ?? []), orders: o.orders ?? null,
    alive: true, reported: false, departed: false, folding: null, removeAt: Infinity,
    sinceHit: 99, lastHitBy: null, lastHitTeam: null, lastFired: -99, lastBoost: -99,
    invulnerable: !!o.invulnerable, unkillable: !!o.unkillable, hidden: !!o.hidden, untargetable: !!o.untargetable,
    disabled: !!o.disabled, frozen: false, rcsFired: [],
    gun: null, banks: null, bank: 0, missiles: o.missiles ?? def.missiles?.count ?? 0,
    missileWeapon: o.missileWeapon ?? def.missiles?.weapon ?? 'hornet',
    torpedoes: o.torpedoes ?? def.ordnance?.count ?? 0, torpedoWeapon: o.torpedoWeapon ?? def.ordnance?.weapon ?? 'lance',
    brain: null, leaderId: o.leader?.id ?? o.leaderId ?? null, slot: o.slot ?? null,
    protectId: o.protect?.id ?? null, prefer: o.prefer ?? null, playerBias: o.playerBias ?? (team === 1 ? world.diff.playerBias ?? 180 : 0),
    home: o.home ?? null, helm: null, tender: null, scan: null, launcher: null, hatch: null,
    detectRange: def.detectRange ?? null, attention: 0, alarmed: false,
    kills: 0,
  };
  if (def.shield > 0) initShields(e, def.shield * (o.shieldScale ?? 1) * (friendly ? world.diff.friendlyHull : 1));
  // Subsystems, turrets and beams from the model's anchors.
  for (const s of hp.subsystems) {
    const spec = def.subsystems?.[s.kind];
    if (!spec) continue;
    const sub2 = {
      name: s.name, kind: s.kind, pos: s.pos.map(v => v * scale), r: s.r * scale,
      hull: spec.hull * hullMul, maxHull: spec.hull * hullMul, armor: spec.armor ?? e.armor, exposed: !!spec.exposed, alive: true,
    };
    e.subsystems.push(sub2);
    if (s.kind === 'shield') e.generators++;
    if (s.kind === 'beam' && spec.weapon) { e.beam = createBeam(sub2); e.beam.auto = !!o.beamAuto; }
  }
  const tspec = def.subsystems?.turret;
  if (tspec) {
    hp.turrets.forEach((t, i) => {
      const weapon = def.turretWeapons ? def.turretWeapons[i % def.turretWeapons.length] : tspec.weapon;
      const sub2 = createTurret({
        name: t.name, kind: 'turret', pos: t.pos.map(v => v * scale), r: Math.max(4, (t.size ?? 3) * 1.6) * scale,
        hull: tspec.hull * hullMul, maxHull: tspec.hull * hullMul, armor: tspec.armor, exposed: true, alive: true,
      }, t, weapon, world.rng);
      e.subsystems.push(sub2);
      e.turrets.push(sub2);
    });
  }
  // Guns and pilots for anything that dogfights.
  if (!big && (def.role === 'fighter' || def.role === 'bomber' || o.primary)) {
    const key = o.primary ?? def.primary ?? (team === 0 ? 'wingPulse' : 'harrow');
    e.gun = createGun(GUNS[key]);
  }
  if (!isPlayer && (e.role === 'fighter' || e.role === 'bomber')) e.brain = createBrain(world.rng.int(1, 2 ** 31 - 1), e.role);
  if (o.helm) e.helm = createHelm(o.helm);
  if (o.scan) e.scan = { time: 3, range: 500, progress: 0, done: false, label: e.name, ...o.scan };
  if (o.launcher) e.launcher = { interval: 30, max: 6, timer: o.launcher.first ?? 8, spawned: [], ...o.launcher };
  if (o.hatch) e.hatch = { at: world.time + o.hatch.in, cls: o.hatch.cls ?? 'mite', count: o.hatch.count ?? 5, done: false };
  if (o.fold) {
    e.folding = { dir: 'in', t: 0, dur: big ? FOLD_LARGE + Math.min(2, e.radius / 500) : FOLD_SMALL };
    world.events.push({ type: 'foldIn', id: e.id, pos: [...ship.pos], q: [...ship.q], radius: e.radius, big, team, dur: e.folding.dur });
  }
  world.entities.push(e);
  world.byId.set(e.id, e);
  if (e.role === 'sentry') world.sentries.push(e);
  return e;
}

/* The player's ship, from a loadout. */
export function spawnPlayer(world, loadout, pos = [0, 0, 0], q = [0, 0, 0, 1], o = {}) {
  const s = buildStats(loadout, world.diff);
  const e = spawn(world, s.loadout.hull, { ...o, team: 0, role: 'player', name: o.name ?? 'Lantern One', pos, q, flight: s.flight, primary: s.loadout.primary });
  e.maxShield = 0;
  initShields(e, s.shield);
  e.hull = e.maxHull = s.hull;
  e.armor = s.armor;
  e.shieldRegen = s.shieldRegen;
  e.shieldDelay = s.shieldDelay;
  e.signature = s.signature;
  e.silent = s.silent;
  e.gun = createGun(s.gun);
  e.banks = s.banks.map(b => ({ ...b }));
  e.loadout = s.loadout;
  e.tailgun = s.rearTurret ? { w: GUNS[s.rearTurret], cool: 0, target: null, think: 0 } : null;
  e.missiles = 0; e.torpedoes = 0;
  world.player = e;
  return e;
}

/* Fold out: a short burn into a fold that closes behind the ship. It is
   gone, not dead — missions count it as escaped. */
export function foldOut(world, e) {
  if (!e.alive || e.folding) return;
  e.folding = { dir: 'out', t: 0, dur: e.big ? FOLD_LARGE : FOLD_SMALL };
  world.events.push({ type: 'foldOut', id: e.id, pos: [...e.ship.pos], q: [...e.ship.q], radius: e.radius, big: e.big, team: e.team, dur: e.folding.dur, vel: [...e.ship.vel] });
}

/* ---------- the world ---------- */

export function createWorld({ seed = 1234, storage = null, fieldCfg = FIELD, mission = null, loadout = null, difficulty: diffKey = 'veteran' } = {}) {
  const world = {
    seed, storage, fieldCfg, field: null, events: [],
    time: 0, accumulator: 0, timeScale: 1,
    weapons: null, rng: null,
    entities: [], byId: new Map(), active: [], smalls: [], larges: [], sentries: [],
    player: null, target: null, targetSub: null, nav: null, navs: [],
    score: 0, wave: 0, kills: 0, best: 0, state: 'attract',
    lock: null, nextId: 1, leaving: false, speedLock: false,
    diffKey, diff: difficulty(diffKey),
    missionDef: mission ?? survivalDef, loadout: loadout ?? defaultLoadout('kestrel'), mission: null,
    stats: null, streak: null, repair: null, shieldCooldown: 0, playerSignature: 1,
  };
  world.foldOut = e => foldOut(world, e);
  world.damage = (target, amount, point, dir, o = {}) => damageEntity(world, target, amount, point, dir, o);
  world.damageRock = (ref, amount, point) => {
    const out = [];
    world.field.damageRock(ref, amount, point, [0, 0, 0], out);
    for (const e of out) world.events.push(e);
  };
  const threat = { locked: false, missileInbound: false };
  world.scratch = {
    controls: {}, aim: [0, 0, 0], from: [0, 0, 0], threat,
    aiCtx: { field: null, target: null, threat, wasHit: false, larges: world.larges, smalls: world.smalls, leader: null, home: null, aimError: 1, thinkScale: 1, frozen: false },
    weaponsCtx: {
      field: null, entities: world.active, smalls: world.smalls, larges: world.larges, events: world.events,
      damage: (target, amount, point, dir, o) => damageEntity(world, target, amount, point, dir, o),
    },
  };
  resetWorld(world);
  return world;
}

/* Load (or reload) the world's mission from scratch. */
export function resetWorld(world, { mission = world.missionDef, loadout = world.loadout, difficulty: diffKey = world.diffKey } = {}) {
  world.missionDef = mission; world.loadout = loadout; world.diffKey = diffKey; world.diff = difficulty(diffKey);
  const def = mission;
  const fieldCfg = def?.field ?? world.fieldCfg;
  const fieldSeed = def?.fieldSeed ?? world.seed;
  if (!world.field || world.field.cfg !== fieldCfg || world.field.seed !== fieldSeed) world.field = createField(fieldSeed, fieldCfg);
  else world.field.reset();
  world.scratch.aiCtx.field = world.field;
  world.scratch.weaponsCtx.field = world.field;
  // A black hole, for the mission that has one (well.js).
  world.well = def?.well ? createWell(def.well) : null;
  world.scratch.aiCtx.well = world.well;
  world.weapons = createWeapons();
  world.entities.length = 0; world.byId.clear(); world.active.length = 0; world.smalls.length = 0; world.larges.length = 0;
  world.sentries.length = 0;
  world.events.length = 0;
  world.rng = makeRng(def?.seed ?? world.seed);
  world.nextId = 1;
  world.score = 0; world.wave = 0; world.kills = 0;
  world.time = 0; world.accumulator = 0; world.timeScale = 1;
  world.lock = createLock(); world.target = null; world.targetSub = null; world.nav = null; world.navs = [];
  world.speedLock = false; world.leaving = false;
  world.stats = {
    shots: 0, hits: 0, kills: {}, killCount: 0, damageTaken: 0, hullTaken: 0, torpedoesDowned: 0, subsystems: 0,
    rocks: 0, missilesFired: 0, saves: 0, bestStreak: 0, repairs: 0, detected: 0, commandKills: 0,
  };
  world.streak = { count: 0, last: -99, mult: 1 };
  world.repair = { charges: world.diff.repairDrones, droneId: null };
  world.shieldCooldown = 0;
  world.best = loadBest(world.storage, def?.bestKey);
  world.state = 'attract';
  world.mission = null;
  if (def) world.mission = def.create(world);
  else spawnPlayer(world, world.loadout, world.field.cfg.spawn);
  refreshLists(world);
}

export function startRun(world) {
  world.state = 'flying';
  world.mission?.start?.();
}

export function drainEvents(world) {
  // The mission sees every event before the frame takes them away.
  if (world.mission) { world.mission.flush?.(); world.mission.cursor = 0; }
  return world.events.splice(0);
}

function refreshLists(world) {
  const { active, smalls, larges } = world;
  active.length = 0; smalls.length = 0; larges.length = 0;
  for (const e of world.entities) {
    if (!e.alive || e.folding) continue;
    active.push(e);
    (e.big ? larges : smalls).push(e);
  }
}

/* ---------- damage, credit and score ---------- */

function damageEntity(world, target, amount, point, dir, o = {}) {
  let scale = 1;
  // The Harrow's damage to anything on our side follows the difficulty.
  if (o.sourceTeam === 1 && target.team === 0) scale = world.diff.enemyDamage;
  const r = applyDamage(target, amount, world.events, point, dir, { ...o, scale: (o.scale ?? 1) * scale });
  const p = world.player;
  if (target === p) { world.stats.damageTaken += r.shield + r.hull; world.stats.hullTaken += r.hull; }
  if (o.sourceId === p?.id && target.team !== 0) {
    if (r.shield + r.hull + (r.sub ?? 0) > 0 && !target.rock) world.events.push({ type: 'hitMarker', shield: r.shield > 0 && !r.hull, kill: r.killed, big: !!target.big });
  }
  return r;
}

function award(world, points, pos, label, { streak = false } = {}) {
  let mult = 1;
  if (streak) {
    const s = world.streak;
    s.count = world.time - s.last <= STREAK_WINDOW ? s.count + 1 : 1;
    s.last = world.time;
    s.mult = mult = Math.min(5, s.count);
    world.stats.bestStreak = Math.max(world.stats.bestStreak, s.count);
  }
  const total = Math.round(points * mult * world.diff.score);
  world.score += total;
  world.events.push({ type: 'score', points: total, mult, label, pos: pos ? [...pos] : null, streak: streak ? world.streak.count : 0 });
  return total;
}

/* ---------- targeting ---------- */

const angleFromNose = (world, pos) => {
  const p = world.player.ship, fwd = forward([0, 0, 0], p);
  const d = normalize([0, 0, 0], sub([0, 0, 0], pos, p.pos));
  return Math.acos(clamp(dot(d, fwd), -1, 1));
};
const targetable = e => e.alive && !e.folding && !e.hidden && !e.untargetable;

export function hostiles(world) { return world.active.filter(e => e.team === 1 && targetable(e)); }

function cycle(world, list) {
  if (!list.length) { world.target = null; world.targetSub = null; return; }
  const next = list[(list.indexOf(world.target) + 1) % list.length];
  if (next !== world.target) world.targetSub = null;
  world.target = next;
  world.events.push({ type: 'targetChange', id: next.id });
}

export function cycleTarget(world) {
  const list = hostiles(world).sort((a, b) => angleFromNose(world, a.ship.pos) - angleFromNose(world, b.ship.pos));
  cycle(world, list);
}

/* With nothing targeted — at the start of a fight, or when the target is
   destroyed or gone — the nearest hostile is taken, so there is always
   something on the scope. A capital ship counts from halfway out to its
   skin, as the HUD's range does. */
export function autoTarget(world) {
  const p = world.player.ship.pos;
  let best = null, bestD = Infinity;
  for (const e of hostiles(world)) {
    const d = Math.hypot(e.ship.pos[0] - p[0], e.ship.pos[1] - p[1], e.ship.pos[2] - p[2]) - (e.big ? e.radius * 0.5 : 0);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best) return null;
  world.target = best; world.targetSub = null;
  world.events.push({ type: 'targetChange', id: best.id, auto: true });
  return best;
}

/* Objectives first (scan targets, protected ships), then everyone friendly. */
export function cycleFriendly(world) {
  const p = world.player;
  const list = world.active.filter(e => e !== p && targetable(e) && (e.team === 0 || e.scan || e.tags.has('objective')) && e.team !== 1)
    .sort((a, b) => {
      const oa = a.scan && !a.scan.done || a.tags.has('objective') ? 0 : 1, ob = b.scan && !b.scan.done || b.tags.has('objective') ? 0 : 1;
      return oa - ob || angleFromNose(world, a.ship.pos) - angleFromNose(world, b.ship.pos);
    });
  cycle(world, list);
}

/* Incoming torpedoes are targeted through a light stand-in with the shape
   the HUD and the guns read: an id, a ship-like position and velocity, hp. */
function torpedoProxy(world, m) {
  return {
    id: `m${m.id}`, missile: m, name: m.p.name ?? 'Torpedo', team: m.team, big: false, radius: m.radius * 3,
    ship: { pos: m.pos, vel: m.vel, q: [0, 0, 0, 1] }, get hull() { return m.hp; }, maxHull: m.p.hp || 1,
    get alive() { return m.hp > 0 && world.weapons.missiles.includes(m); }, subsystems: [], tags: new Set(), proxy: true,
  };
}
export function targetTorpedo(world) {
  const p = world.player.ship;
  let best = null, bestD = Infinity;
  for (const m of world.weapons.missiles) {
    if (m.team === 0 || m.hp <= 0) continue;
    const d = Math.hypot(m.pos[0] - p.pos[0], m.pos[1] - p.pos[1], m.pos[2] - p.pos[2]);
    if (d < bestD) { bestD = d; best = m; }
  }
  if (!best) return false;
  world.target = torpedoProxy(world, best); world.targetSub = null;
  world.events.push({ type: 'targetChange', id: world.target.id });
  return true;
}

export function cycleNav(world) {
  if (!world.navs.length) { world.nav = null; return; }
  const live = world.navs.filter(n => !n.hidden);
  if (!live.length) { world.nav = null; return; }
  world.nav = live[(live.indexOf(world.nav) + 1) % live.length];
  world.events.push({ type: 'navChange', id: world.nav.id });
}

const SUB_ORDER = ['reactor', 'shield', 'emitter', 'drive', 'beam', 'bay', 'engine', 'bridge', 'hangar', 'dock', 'comms', 'turret'];
export function cycleSubsystem(world) {
  const t = world.target;
  if (!t || !t.subsystems?.length) { world.targetSub = null; return; }
  const list = t.subsystems.filter(s => s.alive).sort((a, b) => SUB_ORDER.indexOf(a.kind) - SUB_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  if (!list.length) { world.targetSub = null; return; }
  const i = list.indexOf(world.targetSub);
  world.targetSub = i + 1 < list.length ? list[i + 1] : (i === -1 ? list[0] : null);
  world.events.push({ type: 'targetChange', id: t.id, sub: world.targetSub?.name ?? null });
}

/* ---------- the player's actions ---------- */

export function callRepair(world) {
  const p = world.player, R = world.repair;
  if (!p?.alive) return false;
  const deny = reason => { world.events.push({ type: 'repairDenied', reason }); return false; };
  if (R.droneId != null && world.byId.get(R.droneId)?.alive) return deny('enroute');
  if (R.charges <= 0) return deny('none');
  if (p.hull >= p.maxHull * 0.5) return deny('healthy');
  R.charges--;
  world.stats.repairs++;
  // From the nearest friendly carrier or station within 6 km, else a fold nearby.
  let from = null, bestD = 6000;
  for (const e of world.active) {
    if (e.team !== 0 || !e.big || (e.role !== 'capital' && e.role !== 'station')) continue;
    const d = Math.hypot(e.ship.pos[0] - p.ship.pos[0], e.ship.pos[1] - p.ship.pos[1], e.ship.pos[2] - p.ship.pos[2]);
    if (d < bestD) { bestD = d; from = e; }
  }
  let pos, fold = false, fwd;
  if (from) {
    const bay = hardpoints(from.model).bays[0];
    pos = bay ? toWorld([0, 0, 0], from, bay.pos.map(v => v * from.scale)) : [...from.ship.pos];
    fwd = normalize([0, 0, 0], sub([0, 0, 0], p.ship.pos, pos));
    if (!bay) for (let k = 0; k < 3; k++) pos[k] += fwd[k] * (from.radius + 30);
  } else {
    const back = qRotate([0, 0, 0], p.ship.q, [0.3, 0.4, 1]);
    normalize(back, back);
    pos = p.ship.pos.map((c, k) => c + back[k] * 400 + p.ship.vel[k] * 1.5);
    fwd = normalize([0, 0, 0], sub([0, 0, 0], p.ship.pos, pos));
    fold = true;
  }
  const drone = spawn(world, 'tender', { team: 0, pos, forward: fwd, vel: [...(from ? from.ship.vel : p.ship.vel)], fold, name: 'Tender' });
  drone.tender = { patientId: p.id, state: 'approach', t: 0, restock: 0, goal: null };
  drone.ignoreId = p.id;
  R.droneId = drone.id;
  world.events.push({ type: 'repairCalled', id: drone.id, from: from?.name ?? null, fold, eta: Math.round(Math.hypot(...sub([0, 0, 0], p.ship.pos, pos)) / 220) });
  return true;
}

export function wingOrder(world, order) {
  const p = world.player;
  const wing = world.active.filter(e => e.leaderId === p.id && e.brain);
  if (!wing.length) return false;
  for (const e of wing) {
    if (order === 'attack') {
      if (world.target?.alive && !world.target.proxy && (world.target.team === 1 || (world.target.team < 0 && world.target.rock))) e.orders = { type: 'attack', target: world.target };
      else e.orders = { type: 'cover' };
    } else e.orders = { type: order };
    e.brain.retarget = 0;
  }
  if (order === 'attack' && wing.some(e => e.orders?.type === 'attack')) world.target.commandedBy = p.id;
  world.events.push({ type: 'wingOrder', order, names: wing.map(e => e.name), target: order === 'attack' ? world.target?.name ?? null : null });
  return true;
}

/* ---------- the step ---------- */

const ZERO = [0, 0, 0];

function stepFolds(world, dt) {
  for (const e of world.entities) {
    const f = e.folding;
    if (!f || !e.alive) continue;
    f.t += dt;
    if (f.dir === 'out') {
      // Into the fold: a hard burn along the nose.
      const fwd = forward([0, 0, 0], e.ship);
      const accel = e.big ? 40 : 300;
      for (let k = 0; k < 3; k++) { e.ship.vel[k] += fwd[k] * accel * dt; e.ship.pos[k] += e.ship.vel[k] * dt; }
    }
    if (f.t >= f.dur) {
      if (f.dir === 'in') {
        e.folding = null;
        world.events.push({ type: 'arrive', id: e.id, team: e.team, name: e.name, big: e.big });
      } else {
        e.folding = null; e.alive = false; e.departed = true; e.removeAt = world.time;
        world.events.push({ type: 'departed', id: e.id, team: e.team, name: e.name, tags: [...e.tags] });
        if (world.target === e) { world.target = null; world.targetSub = null; }
      }
    }
  }
}

function playerStep(world, input, dt) {
  const p = world.player, ev = world.events, scratch = world.scratch;
  if (!p?.alive || p.folding) return;
  const flying = world.state === 'flying';
  let controls = flying ? input : NEUTRAL_CONTROLS;
  if (flying) {
    if (input.cycleTarget) cycleTarget(world);
    if (input.cycleFriendly) cycleFriendly(world);
    if (input.targetTorpedo) targetTorpedo(world);
    if (input.cycleNav) cycleNav(world);
    if (input.cycleSub) cycleSubsystem(world);
    if (world.target && !world.target.alive) { world.target = null; world.targetSub = null; }
    if (!world.target) autoTarget(world);
    if (world.targetSub && !world.targetSub.alive) world.targetSub = null;
    if (input.toggleSpeedLock) world.speedLock = !world.speedLock && !!world.target;
    if (input.throttleDelta || input.throttleZero || !world.target) world.speedLock = false;
    controls = Object.assign(scratch.controls, input);
    controls.speedSet = world.speedLock ? len(world.target.ship.vel) : (input.speedSet ?? null);
    if (input.aimPoint) aimCommands(p.ship, sub(scratch.aim, input.aimPoint, p.ship.pos), controls);
    if (input.cycleBank && p.banks.length > 1) {
      p.bank = (p.bank + 1) % p.banks.length;
      ev.push({ type: 'bankChange', bank: p.bank, weapon: p.banks[p.bank].weapon });
    }
    if (input.equalize) {
      if (world.shieldCooldown <= 0) { equalizeShields(p); world.shieldCooldown = 5; ev.push({ type: 'shieldsLevelled' }); }
    }
    if (input.repair) callRepair(world);
    if (input.wingAttack) wingOrder(world, 'attack');
    if (input.wingCover) wingOrder(world, 'cover');
    if (input.wingForm) wingOrder(world, 'form');
  }
  world.shieldCooldown = Math.max(0, world.shieldCooldown - dt);
  stepShip(p.ship, controls, dt);
  if (p.ship.afterburner) p.lastBoost = world.time;
  if (!flying) return;

  // Missile lock follows the active bank's weapon.
  const bank = p.banks[p.bank];
  const sw = SECONDARIES[bank?.weapon] ?? SECONDARIES.hornet;
  const lockable = world.target && !world.target.proxy ? world.target : null;
  updateLock(world.lock, p.ship, lockable, dt, sw, lockable ? world.targetSub : null);

  if (triggerGun(p.gun, !!input.fire, dt)) {
    const muzzles = hardpoints(p.model).muzzles;
    const muzzle = muzzles[p.gun.muzzle % muzzles.length];
    let aim = null;
    if (input.aimPoint) {
      const from = qRotate(scratch.from, p.ship.q, muzzle.pos);
      for (let k = 0; k < 3; k++) from[k] += p.ship.pos[k];
      aim = sub(from, input.aimPoint, from);
    }
    const bolt = fireBolt(world.weapons, p, muzzle.pos, p.gun.params, aim);
    p.lastFired = world.time;
    world.stats.shots++;
    ev.push({ type: 'fire', team: 0, shipId: p.id, muzzle: p.gun.muzzle, pos: [...bolt.pos], vel: [...bolt.vel], weapon: p.loadout.primary, player: true });
  }
  if (input.missile && bank) {
    if (bank.count > 0) {
      bank.count--;
      const locked = world.lock.locked && world.lock.valid && world.lock.targetId === lockable?.id;
      const launchers = hardpoints(p.model).launchers;
      const salvo = sw.salvo ?? 1;
      for (let k = 0; k < salvo; k++) {
        const launcher = launchers[(world.stats.missilesFired + k) % Math.max(1, launchers.length)]?.pos ?? [0, -1.4, -1.5];
        let dir = null;
        if (salvo > 1) {
          const fwd = forward([0, 0, 0], p.ship), right = qRotate([0, 0, 0], p.ship.q, [1, 0, 0]), up = qRotate([0, 0, 0], p.ship.q, [0, 1, 0]);
          const a = (k / salvo) * Math.PI * 2;
          dir = fwd.map((f, i) => f + (right[i] * Math.cos(a) + up[i] * Math.sin(a)) * Math.tan(sw.spread));
        }
        launchMissile(world.weapons, p, launcher, locked ? world.lock.targetId : null, sw, { subName: locked ? world.lock.subName : null, dir });
      }
      world.stats.missilesFired += salvo;
      p.lastFired = world.time;
      ev.push({ type: 'missileLaunch', team: 0, pos: [...p.ship.pos], locked, weapon: bank.weapon, torpedo: !!sw.torpedo, player: true });
    } else {
      ev.push({ type: 'dryFire', weapon: bank.weapon });
    }
  }
  // Survival keeps the old slow rearm; the campaign rearms only from a Tender.
  if (world.mission?.rearm) {
    p.missileTimer = (p.missileTimer ?? 0) + dt;
    if (p.missileTimer >= world.mission.rearm) {
      p.missileTimer = 0;
      const b = p.banks.find(x => x.count < x.max);
      if (b) b.count++;
    }
  }
  if (p.tailgun) tailgun(world, p, dt);
}

/* The Anvil's tail gun: anything hostile and small behind the bomber. */
function tailgun(world, p, dt) {
  const T = p.tailgun, w = T.w;
  T.cool -= dt; T.think -= dt;
  const hp = hardpoints(p.model).turrets[0];
  const at = toWorld([0, 0, 0], p, hp?.pos ?? [0, 1.5, 6]);
  if (T.think <= 0) {
    T.think = 0.3;
    T.target = null;
    let bestD = 900;
    const fwd = forward([0, 0, 0], p.ship);
    for (const e of world.smalls) {
      if (e.team !== 1 || !targetable(e)) continue;
      const to = sub([0, 0, 0], e.ship.pos, at);
      const d = len(to);
      if (d < bestD && dot(to, fwd) < 0.25 * d) { bestD = d; T.target = e; }
    }
  }
  const e = T.target;
  if (!e || !e.alive || T.cool > 0) return;
  const lead = leadPoint([0, 0, 0], at, p.ship.vel, e.ship.pos, e.ship.vel, w.speed);
  if (!lead) return;
  T.cool = 1 / w.rate;
  fireBolt(world.weapons, p, null, w, null, { from: at, dir: sub([0, 0, 0], lead, at), spread: 0.02, rng: world.rng });
  world.events.push({ type: 'fire', team: 0, shipId: p.id, pos: at, vel: [...p.ship.vel], turret: true, weapon: 'tailgun' });
}

/* Who a pilot fights, re-decided twice a second. */
function aiTarget(world, e) {
  const o = e.orders ?? {};
  const leader = e.leaderId != null ? world.byId.get(e.leaderId) : null;
  const choose = (list, options = {}) => pickTarget(e, list, { allies: world.smalls.filter(x => x.team === e.team), ...options });
  const near = (pos, r) => world.active.filter(x => x.team !== e.team && (x.team >= 0 || (e.prefer && x.tags.has(e.prefer))) && targetable(x)
    && Math.hypot(x.ship.pos[0] - pos[0], x.ship.pos[1] - pos[1], x.ship.pos[2] - pos[2]) < r);
  // Ordered somewhere (the jump, a hold point): fly there, fight nothing.
  if (o.type === 'jump' || o.type === 'hold') return null;
  if (o.type === 'attack') {
    if (o.target?.alive && !o.target.folding) return o.target;
    e.orders = leader ? { type: 'cover' } : null;
  }
  if (o.type === 'strike' && o.target?.alive) return o.target;
  if (o.type === 'form' && leader?.alive) return e.sinceHit < 2 ? choose(near(e.ship.pos, 800)) : null;
  if (leader?.alive && (o.type === 'cover' || !o.type)) {
    if (Math.hypot(...e.ship.pos.map((v, k) => v - leader.ship.pos[k])) > 3200) return null;
    const list = near(leader.ship.pos, 2600);
    return list.length ? choose(list, { protect: leader, player: world.player, prefer: e.prefer }) : null;
  }
  const protect = e.protectId != null ? world.byId.get(e.protectId) : null;
  if (protect?.alive) {
    const list = near(protect.ship.pos, 3500);
    if (list.length) return choose(list, { protect, player: world.player, prefer: e.prefer });
  }
  return choose(world.active, { player: world.player, prefer: e.prefer, playerBias: e.playerBias });
}

/* The subsystem a bomber was sent at; once that is gone, another live one
   of the same kind (a strike on an engine goes on to the next engine). */
function strikeSub(target, name) {
  const named = target.subsystems.find(s => s.name === name);
  if (named?.alive) return named;
  return target.subsystems.find(s => s.alive && s.kind === named?.kind) ?? null;
}

function aiStep(world, e, dt) {
  const scratch = world.scratch, ctx = scratch.aiCtx, threat = scratch.threat;
  const brain = e.brain;
  brain.retarget -= dt;
  if (brain.retarget <= 0 || (brain.target && (!brain.target.alive || brain.target.folding))) {
    brain.retarget = 0.5;
    const t = aiTarget(world, e);
    if (t !== brain.target) {
      brain.target = t; brain.targetSub = null; brain.strafePoint = null;
      brain.lockTimer = 0; brain.sightTimer = 0;
      if (brain.state !== 'evade' && brain.state !== 'recover') { brain.state = 'approach'; brain.timer = 0; }
      if (t && e.role === 'bomber' && t.big && e.orders?.sub) brain.targetSub = strikeSub(t, e.orders.sub);
    }
  }
  if (brain.targetSub && !brain.targetSub.alive) brain.targetSub = brain.target?.alive && e.orders?.sub ? strikeSub(brain.target, e.orders.sub) : null;
  let missileInbound = false;
  for (const m of world.weapons.missiles) if (m.targetId === e.id) { missileInbound = true; break; }
  threat.locked = world.lock.locked && world.lock.targetId === e.id;
  threat.missileInbound = missileInbound;
  ctx.target = brain.target;
  ctx.wasHit = e.sinceHit < 0.1;
  ctx.leader = e.leaderId != null && (e.orders?.type === 'form' || e.orders?.type === 'cover' || !e.orders) ? world.byId.get(e.leaderId) ?? null : null;
  if (ctx.leader && !ctx.leader.alive) ctx.leader = null;
  ctx.home = e.home;
  ctx.aimError = e.team === 1 ? world.diff.enemyAim * (e.def.ace ? 0.5 : 1) : 0.8;
  ctx.thinkScale = e.team === 1 ? world.diff.aiThink : 1;
  ctx.tactics = e.team === 1 ? ({ recruit: 0, pilot: 0.35, veteran: 0.7, ace: 1 }[world.diffKey] ?? 0.7) : 0.5;
  ctx.frozen = e.frozen;
  const c = e.disabled ? NEUTRAL_CONTROLS : thinkPilot(brain, e, ctx, dt);
  stepShip(e.ship, c, dt);
  if (e.disabled || e.frozen) return;
  const rateScale = e.team === 1 ? world.diff.enemyFireRate : 1;
  if (e.gun && triggerGun(e.gun, c.fire && world.state !== 'attract', dt, rateScale)) {
    const muzzles = hardpoints(e.model).muzzles;
    const muzzle = muzzles.length ? muzzles[e.gun.muzzle % muzzles.length].pos : [0, 0, -e.radius];
    const bolt = fireBolt(world.weapons, e, muzzle, e.gun.params);
    e.lastFired = world.time;
    world.events.push({ type: 'fire', team: e.team, shipId: e.id, muzzle: e.gun.muzzle, pos: [...bolt.pos], vel: [...bolt.vel] });
  }
  const target = brain.target;
  if (c.missile && e.missiles > 0 && target) {
    e.missiles--;
    const launchers = hardpoints(e.model).launchers;
    launchMissile(world.weapons, e, launchers[e.missiles % Math.max(1, launchers.length)]?.pos ?? [0, -1, -1], target.id, SECONDARIES[e.missileWeapon]);
    world.events.push({ type: 'missileLaunch', team: e.team, pos: [...e.ship.pos], locked: true, weapon: e.missileWeapon, targetId: target.id });
  }
  if (c.torpedo && e.torpedoes > 0 && target?.big) {
    e.torpedoes--;
    const launchers = hardpoints(e.model).launchers;
    const w = SECONDARIES[e.torpedoWeapon];
    launchMissile(world.weapons, e, launchers[0]?.pos ?? [0, -1.3, -3], target.id, w, { subName: brain.targetSub?.name ?? null });
    world.events.push({ type: 'missileLaunch', team: e.team, pos: [...e.ship.pos], locked: true, weapon: e.torpedoWeapon, torpedo: true, targetId: target.id });
  }
}

function hatchSeeds(world) {
  for (const e of world.active) {
    const h = e.hatch;
    if (!h || h.done || world.time < h.at) continue;
    h.done = true;
    e.hatched = true;
    world.events.push({ type: 'hatch', id: e.id, pos: [...e.ship.pos], count: h.count, name: e.name });
    for (let k = 0; k < h.count; k++) {
      const dir = world.rng.unit([0, 0, 0]);
      const pos = e.ship.pos.map((c, i) => c + dir[i] * (e.radius + 8));
      const m = spawn(world, h.cls, { team: 1, pos, forward: dir, vel: dir.map(v => v * 60), throttle: 1, tags: ['hatchling', ...(h.tags ?? [])], prefer: h.prefer ?? null });
      m.brain.retarget = 0;
    }
  }
}

function launchFromBays(world, e, dt) {
  const L = e.launcher;
  if (!L || e.frozen || L.paused) return;
  L.spawned = L.spawned.filter(x => x.alive);
  let bays = hardpoints(e.model).bays.filter(b => {
    const sub2 = e.subsystems.find(s => s.kind === 'bay' && s.name.endsWith(b.name.slice(-1)));
    return !sub2 || sub2.alive;
  });
  // A hull with no bays (a boarded shuttle) disgorges them from its back.
  if (!bays.length && e.launchFromHull) bays = [{ name: 'hull', pos: [0, e.radius / e.scale * 0.6, 0], dir: [0, 1, 0] }];
  if (!bays.length) return;
  L.timer -= dt;
  if (L.timer > 0 || L.spawned.length >= L.max) return;
  L.timer = L.interval;
  const n = Math.min(L.wave ?? 2, L.max - L.spawned.length);
  for (let k = 0; k < n; k++) {
    const bay = bays[k % bays.length];
    const pos = toWorld([0, 0, 0], e, bay.pos.map(v => v * e.scale));
    const dir = qRotate([0, 0, 0], e.ship.q, bay.dir);
    for (let i = 0; i < 3; i++) pos[i] += dir[i] * 20 * (k + 1);
    const cls = Array.isArray(L.cls) ? L.cls[(L.count = (L.count ?? 0) + 1) % L.cls.length] : L.cls;
    const s = spawn(world, cls, { team: e.team, pos, forward: dir, vel: e.ship.vel.map((v, i) => v + dir[i] * 80), throttle: 1, tags: ['launched', ...(L.tags ?? [])], prefer: L.prefer ?? null });
    L.spawned.push(s);
  }
  world.events.push({ type: 'launch', id: e.id, count: n });
}

/* ---------- the Well ---------- */

const pullScratch = [0, 0, 0];
function pull(world, dt) {
  const well = world.well, a = pullScratch;
  for (const e of world.entities) {
    if (!e.alive || e.fixed || e.folding || (e.tender && e.tender.state === 'docked')) continue;
    well.accel(e.ship.pos, a);
    for (let k = 0; k < 3; k++) e.ship.vel[k] += a[k] * dt;
  }
  for (const rock of world.field.dynamic) {
    well.accel(rock.pos, a);
    for (let k = 0; k < 3; k++) rock.vel[k] += a[k] * dt;
  }
}

/* Whatever reaches the horizon is gone: not destroyed, not seen to cross —
   simply lost, with no wreck and no fire. */
function swallow(world) {
  const well = world.well;
  for (const e of world.entities) {
    if (!e.alive || e.fixed || well.distance(e.ship.pos) > well.rs * 1.1) continue;
    e.alive = false; e.lost = true; e.reported = true; e.removeAt = world.time + 0.05;
    if (world.target === e) { world.target = null; world.targetSub = null; }
    world.events.push({ type: 'lost', id: e.id, team: e.team, cls: e.cls, name: e.name, pos: [...e.ship.pos] });
    if (e === world.player) {
      world.state = 'dead';
      if (world.mission) world.mission.flags.deathReason ??= 'Lantern One fell into the Well.';
    }
  }
  const field = world.field;
  for (let i = field.dynamic.length - 1; i >= 0; i--) {
    if (well.distance(field.dynamic[i].pos) < well.rs * 1.1) field.dynamic.splice(i, 1);
  }
}

function stepScan(world, dt) {
  const p = world.player, t = world.targetSub?.scan ? world.targetSub : world.target;
  if (!p?.alive || !t || !t.scan || t.scan.done || world.state !== 'flying') { world.scanning = null; return; }
  const owner = world.target;
  const at = world.targetSub?.scan ? subsystemWorld([0, 0, 0], owner, world.targetSub) : owner.ship.pos;
  const d = Math.hypot(at[0] - p.ship.pos[0], at[1] - p.ship.pos[1], at[2] - p.ship.pos[2]) - (owner.big && !world.targetSub ? owner.radius * 0.5 : 0);
  const inRange = d <= t.scan.range, inCone = angleFromNose(world, at) <= SCAN_CONE;
  world.scanning = { target: t, inRange, inCone, distance: d };
  if (!inRange || !inCone) return;
  t.scan.progress = Math.min(1, t.scan.progress + dt / t.scan.time);
  if (t.scan.progress >= 1) {
    t.scan.done = true;
    world.events.push({ type: 'scanned', id: owner.id, sub: world.targetSub?.scan ? world.targetSub.name : null, label: t.scan.label });
  }
}

function report(world) {
  const p = world.player;
  for (const e of world.entities) {
    if (e.alive || e.reported || e.departed) continue;
    e.reported = true;
    e.removeAt = world.time + (e.big ? bigDeathSpan(e.radius) + 0.4 : 3);
    world.events.push({ type: 'shipKilled', id: e.id, team: e.team, kind: e.model, cls: e.cls, name: e.name, big: e.big, radius: e.radius, pos: [...e.ship.pos], vel: [...e.ship.vel], by: e.lastHitBy });
    if (e === p) {
      world.state = 'dead';
      saveBest(world.storage, world.score, world.missionDef?.bestKey);
      world.best = Math.max(world.best, world.score);
      continue;
    }
    // The next step takes the nearest hostile in its place.
    if (world.target === e) { world.target = null; world.targetSub = null; }
    if (e.team === 1) {
      world.kills++;
      const byPlayer = e.lastHitBy === p?.id;
      if (byPlayer && world.state === 'flying') {
        world.stats.kills[e.cls] = (world.stats.kills[e.cls] ?? 0) + 1;
        world.stats.killCount++;
        const points = world.mission?.scoreKill ? world.mission.scoreKill(e) : (e.def.score ?? 100);
        award(world, points, e.ship.pos, e.name, { streak: true });
        if (e.big) world.events.push({ type: 'bigKill', id: e.id, pos: [...e.ship.pos], radius: e.radius });
      } else if (e.lastHitBy != null) {
        const killer = world.byId.get(e.lastHitBy);
        if (killer) killer.kills++;
        if (killer?.wingmate && e.commandedBy === p?.id && world.state === 'flying') {
          const points = world.mission?.scoreKill ? world.mission.scoreKill(e) : (e.def.score ?? 100);
          world.stats.commandKills++;
          award(world, points * 0.4, e.ship.pos, `${killer.name} · command assist`);
        }
      }
    }
  }
}

function credits(world, events, from) {
  const p = world.player;
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'rockBreak' && ev.team === 0 && !ev.crumble) { world.score += scoreRock(ev.rockType); world.stats.rocks++; }
    if (ev.type === 'boltHit' && ev.ownerId === p?.id && ev.kind === 'ship') world.stats.hits++;
    if (ev.type === 'subsystemDestroyed' && ev.byId === p?.id && ev.team === 1) {
      world.stats.subsystems++;
      award(world, 300, ev.pos, `${subsystemName(ev.kind)} destroyed`);
    }
    if (ev.type === 'missileDestroyed' && ev.team === 1) {
      world.stats.torpedoesDowned++;
      award(world, 75, ev.pos, 'Torpedo down');
    }
  }
}

export function stepWorld(world, input, dt) {
  const ev = world.events, field = world.field;
  world.time += dt;
  stepFolds(world, dt);
  refreshLists(world);
  for (const e of world.entities) {
    const s = e.ship;
    s.prevPos[0] = s.pos[0]; s.prevPos[1] = s.pos[1]; s.prevPos[2] = s.pos[2];
    s.prevQ[0] = s.q[0]; s.prevQ[1] = s.q[1]; s.prevQ[2] = s.q[2]; s.prevQ[3] = s.q[3];
  }

  // The Well pulls everything that moves, before the pilots and their
  // flight computers answer it.
  if (world.well) pull(world, dt);

  playerStep(world, input, dt);

  for (const e of world.active) {
    if (e === world.player) continue;
    if (e.brain) aiStep(world, e, dt);
    else if (e.tender) {
      const c = stepTender(world, e, dt);
      if (!c.docked) stepShip(e.ship, c, dt);
    } else if (e.helm && !e.fixed) stepShip(e.ship, e.frozen ? { ...NEUTRAL_CONTROLS, speedSet: 0 } : stepHelm(world, e, dt), dt);
    else if (!e.fixed) stepShip(e.ship, e.disabled ? NEUTRAL_CONTROLS : { ...NEUTRAL_CONTROLS, speedSet: e.drift ?? 0 }, dt);
    if (e.big) {
      stepTurrets(world, e, dt);
      stepBeam(world, e, dt);
      launchFromBays(world, e, dt);
    }
  }

  for (const e of world.smalls) {
    const rcs = hardpoints(e.model).rcs;
    if (rcs.length) selectRcsPorts(rcs, e.ship.accelLocal, e.ship.alphaLocal, e.ship.stats, e.rcsFired);
  }

  const before = ev.length;
  stepWeapons(world.weapons, world.scratch.weaponsCtx, dt);
  field.step(dt, ev);
  for (const rock of field.dynamic) for (const L of world.larges) resolveRockLarge(rock, L);

  const S = world.smalls, L = world.larges;
  // Collisions hurt through applyDamage directly; count what they cost the
  // player with everything else, for the debrief and the commendations.
  const pl = world.player, plHull = pl?.hull ?? 0, plShield = pl?.shield ?? 0;
  for (const e of S) {
    if (!e.alive) continue;
    if (!(e.tender && e.tender.state === 'docked')) resolveShipRock(e, field, ev);
    for (const big of L) if (big.alive && big !== e) resolveShipLarge(e, big, ev);
  }
  for (let i = 0; i < S.length; i++) {
    const a = S[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < S.length; j++) {
      const b = S[j];
      if (!b.alive || a.ignoreId === b.id || b.ignoreId === a.id) continue;
      resolveShipShip(a, b, ev);
    }
  }
  if (pl) {
    const hullLost = Math.max(0, plHull - pl.hull), shieldLost = Math.max(0, plShield - pl.shield);
    world.stats.hullTaken += hullLost;
    world.stats.damageTaken += hullLost + shieldLost;
  }
  for (const e of world.active) stepShield(e, dt);
  if (world.sentries.length) stepSentries(world, dt);
  stepScan(world, dt);
  if (world.well) swallow(world);
  report(world);
  credits(world, ev, before);
  hatchSeeds(world);

  // Bring out the dead after the renderer has had time to see them go.
  if (world.entities.some(e => e.removeAt <= world.time)) {
    for (let i = world.entities.length - 1; i >= 0; i--) {
      const e = world.entities[i];
      if (e.removeAt > world.time || e === world.player) continue;
      world.entities.splice(i, 1);
      world.byId.delete(e.id);
      const si = world.sentries.indexOf(e);
      if (si >= 0) world.sentries.splice(si, 1);
    }
  }

  world.mission?.step(dt);

  const p = world.player;
  if (p) {
    const area = world.missionDef?.area;
    if (area) {
      world.leaving = Math.hypot(p.ship.pos[0] - area.centre[0], p.ship.pos[1] - area.centre[1], p.ship.pos[2] - area.centre[2]) > area.radius;
    } else {
      const half = field.cfg.half, pos = p.ship.pos;
      const outside = Math.hypot(
        Math.max(0, Math.abs(pos[0]) - half[0]), Math.max(0, Math.abs(pos[1]) - half[1]), Math.max(0, Math.abs(pos[2]) - half[2]));
      world.leaving = outside > COMBAT.leaving;
    }
  }
}

/* Feed real time in; run at most MAX_STEPS fixed steps and drop the rest.
   One-shot inputs (a key press, a click) belong to the first step only. */
const ONE_SHOTS = ['toggleFA', 'missile', 'cycleTarget', 'cycleFriendly', 'targetTorpedo', 'cycleNav', 'cycleSub',
  'toggleSpeedLock', 'cycleBank', 'equalize', 'repair', 'wingAttack', 'wingCover', 'wingForm', 'toggleCamera'];
export function advance(world, input, frameDt) {
  world.accumulator += frameDt * world.timeScale;
  let steps = 0;
  let current = input;
  while (world.accumulator >= STEP && steps < MAX_STEPS) {
    stepWorld(world, current, STEP);
    world.accumulator -= STEP;
    steps++;
    if (steps === 1) {
      current = { ...input };
      for (const k of ONE_SHOTS) current[k] = false;
    }
  }
  if (world.accumulator >= STEP) world.accumulator = world.accumulator % STEP;
  return steps;
}

export { len, ZERO };
