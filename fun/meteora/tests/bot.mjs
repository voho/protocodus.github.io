/* A fair bot pilot for balance runs: it plays through the same input the
   keyboard and mouse produce (stick, throttle, trigger, secondary, target
   keys, the Tender), no teleporting and no invulnerability. It flies like
   the AI fighters do — the same brain from ai.js steers the dogfight —
   and on top of that it reads the mission: scans what needs scanning,
   flies to nav points, goes for objective targets and their subsystems,
   hunts what threatens the ships it must protect, shoots down torpedoes,
   and calls a Tender when hurt. It is a decent, not a great, pilot: good
   enough that a mission it cannot win is too hard. */

import { NEUTRAL_CONTROLS, aimCommands, forward } from '../js/flight.js';
import { createBrain, steerClear, thinkPilot } from '../js/ai.js';
import { SECONDARIES } from '../js/loadout.js';
import { subsystemWorld } from '../js/compound.js';
import { IDLE } from '../js/world.js';
import { leadPoint } from '../js/weapons.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const SUB_PRIORITY = ['shield', 'emitter', 'reactor', 'bay', 'beam', 'turret', 'engine'];

export function createBot(seed = 7) {
  const brain = createBrain(seed, 'fighter');
  const state = { goal: null, kind: null, think: 0, repairCalled: false, lastTarget: null, missileHold: 0, jitter: [0, 0, 0], jitterT: 0 };
  let rngState = seed * 7919 + 1;
  const rand = () => ((rngState = (rngState * 16807) % 2147483647) / 2147483647);

  function protectedShips(world) {
    return world.entities.filter(e => e.alive && e.team === 0 && e !== world.player && (e.tags.has('objective') || e.tags.has('convoy')));
  }

  function choose(world) {
    const p = world.player;
    const rt = world.mission;
    const active = id => rt?.objectives.some(o => o.id === id && o.state === 'active');
    let stayNear = null;
    // 0. Timed exits outrank everything: the ring, the fold point, a blast.
    if (active('clear')) {
      const boom = world.entities.find(e => e.alive && e.unkillable && e.team === 1 && e.big);
      if (boom) return { kind: 'flee', from: boom };
    }
    if ((active('jump') || active('run')) && world.nav && !world.nav.hidden) return { kind: 'nav', nav: world.nav };
    // The ring is about to open: be near it.
    const spool = rt?.timers?.get('spool');
    const ring = world.navs.find(n => n.id === 'ring' && !n.hidden);
    // Once there, stay close: a pilot fighting four kilometres out misses the window.
    if (spool && ring && spool.left < 25) {
      const d = Math.hypot(ring.pos[0] - p.ship.pos[0], ring.pos[1] - p.ship.pos[1], ring.pos[2] - p.ship.pos[2]);
      if (d > 600 || (d > 300 && spool.left < 12)) return { kind: 'nav', nav: ring };
      stayNear = { pos: ring.pos, r: 900 };
    }
    // A beam charging at us: get out of its line.
    const beam = world.entities.find(e => e.alive && e.beam && e.beam.state === 'charge' && e.beam.targetId === p.id);
    if (beam) return { kind: 'dodge', from: beam };
    // 1. Scans.
    const scan = world.entities.find(e => e.alive && e.scan && !e.scan.done && !e.hidden && e.team !== 1);
    if (scan) return { kind: 'scan', target: scan };
    const objScan = world.entities.find(e => e.alive && e.scan && !e.scan.done && !e.hidden);
    if (objScan) return { kind: 'scan', target: objScan };
    const subScan = world.entities.flatMap(e => (e.alive ? e.subsystems.filter(s => s.scan && !s.scan.done && s.alive).map(s => [e, s]) : []))[0];
    if (subScan) return { kind: 'scan', target: subScan[0], sub: subScan[1] };
    // 2. Torpedoes in flight at something we protect (or at us).
    const torp = world.weapons.missiles.find(m => m.team === 1 && m.hp > 0 && dist(m.pos, p.ship.pos) < 2500);
    if (torp) return { kind: 'torpedo', missile: torp };
    // 3. Hostiles near the ships we protect, bombers first, then near us.
    const guard = protectedShips(world);
    const hostiles = world.entities.filter(e => e.alive && e.team === 1 && !e.folding && !e.hidden && !e.untargetable
      && (!stayNear || dist(e.ship.pos, stayNear.pos) < stayNear.r));
    const threat = (e) => {
      let d = dist(e.ship.pos, p.ship.pos);
      for (const g of guard) d = Math.min(d, dist(e.ship.pos, g.ship.pos) * 0.6);
      if (e.role === 'bomber') d *= 0.4;
      if (e.tags.has('traitor')) d *= 0.2;
      if (e.tags.has('falling')) d *= 0.15;
      if (e.tags.has('tug')) d *= 0.15;
      if (e.tags.has('anchor') && !e.tags.has('dead')) d *= 0.5;
      if (e.big && !e.tags.has('objective') && e.role !== 'hauler') d *= 3;
      // A capital ship whose generators or reactor are the objective.
      if (e.big && e.tags.has('objective') && e.subsystems.some(s => s.alive && (s.kind === 'shield' || s.kind === 'reactor' || s.kind === 'emitter'))) d *= 0.25;
      if (e.role === 'sentry') d *= 4;
      if (e.frozen) d *= 2;
      return d;
    };
    // Like a person, it finishes what it started unless something is much worse.
    const keep = state.goal?.kind === 'attack' && state.goal.target?.alive ? state.goal.target : null;
    const target = hostiles.sort((a, b) => (threat(a) * (a === keep ? 0.45 : 1)) - (threat(b) * (b === keep ? 0.45 : 1)))[0];
    // In the recon mission, stay quiet: go for the scans, not the Eyes.
    if (target && !(rt?.def.id === 'm03' && !world.sentries.some(e => e.alarmed))) {
      let sub = null;
      if (target.big && target.subsystems.length) {
        for (const kind of SUB_PRIORITY) {
          sub = target.subsystems.find(s => s.alive && s.kind === kind && (kind !== 'reactor' || !target.subsystems.some(x => x.kind === 'shield' && x.alive)));
          if (sub) break;
        }
        // Like a careful pilot, silence the guns that cover it first.
        if (sub && sub.kind !== 'turret' && target.team === 1 && target.turrets?.length) {
          const at = subsystemWorld([0, 0, 0], target, sub);
          const guns = target.turrets.filter(t => t.alive && dist(subsystemWorld([0, 0, 0], target, t), at) < 380);
          // One gun at a time: keep at the one already under fire.
          const was = state.goal?.target === target && state.goal.sub?.kind === 'turret' && guns.includes(state.goal.sub) ? state.goal.sub : null;
          if (was) sub = was;
          else if (guns.length) sub = guns.sort((a, b) => dist(subsystemWorld([0, 0, 0], target, a), p.ship.pos) - dist(subsystemWorld([0, 0, 0], target, b), p.ship.pos))[0];
        }
      }
      return { kind: 'attack', target, sub };
    }
    // Neutral objectives in the way (the rockslide).
    const rock = world.entities.find(e => e.alive && e.team === -1 && e.tags.has('objective') && e.rock);
    if (rock) return { kind: 'attack', target: rock, sub: null };
    // 4. A nav point.
    const nav = world.nav && !world.nav.hidden ? world.nav : world.navs.find(n => !n.hidden);
    if (nav) return { kind: 'nav', nav };
    // 5. Stay with whoever we protect.
    if (guard.length) return { kind: 'escort', ship: guard[0] };
    return { kind: 'idle' };
  }

  const control = function control(world, dt) {
    const p = world.player;
    if (!p?.alive || world.state !== 'flying') return IDLE;
    state.think -= dt;
    if (state.think <= 0) { state.think = 0.3; state.goal = choose(world); }
    const g = state.goal ?? { kind: 'idle' };
    const input = { ...IDLE };
    // The Tender, when it is worth it.
    if (p.hull < p.maxHull * 0.4 && world.repair.charges > 0 && !(world.repair.droneId != null && world.byId.get(world.repair.droneId)?.alive)) input.repair = true;
    const docking = world.repair.droneId != null && world.byId.get(world.repair.droneId)?.alive;
    // Creep while the Eyes might see us; once the cover is blown, run.
    const running = world.mission?.objectives.some(o => (o.id === 'run' || o.id === 'jump') && o.state === 'active');
    const sneaking = world.sentries.length > 0 && !running;
    let c = null;
    const fly = (to, speed = null, near = 0) => {
      const v = [to[0] - p.ship.pos[0], to[1] - p.ship.pos[1], to[2] - p.ship.pos[2]];
      const d = Math.hypot(...v);
      const out = { ...NEUTRAL_CONTROLS };
      out.throttleSet = speed ?? (d > 800 ? 1 : Math.max(0.25, d / 800));
      // Fly as the pilots do, clear of rocks and hulls.
      steerClear(p, { field: world.field, larges: world.larges }, d > 1e-6 ? v.map(x => x / d) : forward([0, 0, 0], p.ship), out);
      out.boost = (d > 2500 || (running && d > 1500)) && !sneaking;
      if (d < near) out.throttleSet = 0.1;
      return out;
    };
    if (g.kind === 'scan') {
      const t = g.target;
      world.target = t; world.targetSub = g.sub ?? null;   // the target keys, directly
      const at = g.sub ? subsystemWorld([0, 0, 0], t, g.sub) : t.ship.pos;
      const range = (g.sub ? g.sub.scan : t.scan).range;
      const quiet = sneaking;
      c = fly(at, quiet ? 0.2 : null, Math.max(80, range * 0.5));
    } else if (g.kind === 'nav') {
      let to = g.nav.pos;
      // The drive ring is a hoop: line up on its axis ahead of the bow, then
      // fly through, as a person would, rather than into its side.
      const ark = g.nav.id === 'ring' ? world.entities.find(e => e.alive && e.cls === 'mercy') : null;
      if (ark) {
        const axis = forward([0, 0, 0], ark.ship);
        const rel = [p.ship.pos[0] - to[0], p.ship.pos[1] - to[1], p.ship.pos[2] - to[2]];
        const along = rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2];
        const off = Math.hypot(rel[0] - axis[0] * along, rel[1] - axis[1] * along, rel[2] - axis[2] * along);
        // Lined up (close to the axis, not yet past the hoop): go through.
        // Otherwise come round to a point on the axis ahead of the bow.
        const through = off <= 70 && along > -40;
        const k = through ? -200 : 350;
        to = [to[0] + axis[0] * k, to[1] + axis[1] * k, to[2] + axis[2] * k];
      }
      c = fly(to, sneaking ? 0.25 : null);
    } else if (g.kind === 'flee' || g.kind === 'dodge') {
      const from = g.from.ship.pos;
      let away = [p.ship.pos[0] - from[0], p.ship.pos[1] - from[1], p.ship.pos[2] - from[2]];
      if (g.kind === 'dodge') {
        // Sideways to the beam's line, not along it.
        const up = [0, 1, 0];
        away = [away[1] * up[2] - away[2] * up[1], away[2] * up[0] - away[0] * up[2], away[0] * up[1] - away[1] * up[0]];
      }
      const d = Math.hypot(...away) || 1;
      c = fly([p.ship.pos[0] + away[0] / d * 3000, p.ship.pos[1] + away[1] / d * 3000, p.ship.pos[2] + away[2] / d * 3000], 1);
      c.boost = true;
    } else if (g.kind === 'escort') {
      const s = g.ship;
      const off = [s.ship.pos[0] + 300, s.ship.pos[1] + 150, s.ship.pos[2]];
      c = fly(off, dist(off, p.ship.pos) > 600 ? 1 : 0.4);
    } else if (g.kind === 'torpedo' || g.kind === 'attack') {
      const tgt = g.kind === 'torpedo'
        ? { id: -1, alive: true, big: false, radius: 2, ship: { pos: g.missile.pos, vel: g.missile.vel, q: [0, 0, 0, 1] }, subsystems: [], colliders: null }
        : g.target;
      if (g.kind === 'attack') { world.target = g.target; world.targetSub = g.sub ?? null; }
      brain.target = tgt; brain.targetSub = g.sub ?? null;
      // Turret fire is no reason to break off: jinking does not beat a capital's guns.
      const byGun = world.byId.get(p.lastHitBy)?.big;
      c = thinkPilot(brain, p, { field: world.field, target: tgt, threat: {}, wasHit: p.sinceHit < 0.1 && !byGun, larges: world.larges, aimError: 0.9, thinkScale: 1 }, dt);
      input.fire = c.fire;
      // Burn to close the distance, as a person would.
      const far = dist(tgt.ship.pos, p.ship.pos) - (tgt.big ? tgt.radius : 0);
      if (far > 1200 && !sneaking) c.boost = true;
      // Secondaries: fire on a lock, torpedoes only at large targets.
      const bank = p.banks[p.bank];
      const w = SECONDARIES[bank?.weapon];
      if (g.kind === 'attack') {
        // Torpedoes are for what only torpedoes can crack: an armoured
        // subsystem, or a hull with its shields down. Not for turrets.
        const shielded = (g.target.shield ?? 0) > 0 && !(g.sub && g.sub.exposed);
        const wantTorpedo = g.target.big && !shielded && (!g.sub || g.sub.kind !== 'turret');
        const best = p.banks.findIndex(b => b.count > 0 && (SECONDARIES[b.weapon].torpedo ? wantTorpedo : !wantTorpedo));
        if (best >= 0 && best !== p.bank) input.cycleBank = true;
        if (world.lock.locked && world.lock.valid && bank?.count > 0 && (w.torpedo ? wantTorpedo : true)) {
          state.missileHold -= dt;
          if (state.missileHold <= 0) { input.missile = true; state.missileHold = w.torpedo ? 3 : 1.5; }
        }
      }
    } else c = fly([p.ship.pos[0], p.ship.pos[1], p.ship.pos[2] - 100], 0.3);
    if (docking) { c.throttleSet = 0; c.boost = false; }
    Object.assign(input, { pitch: c.pitch, yaw: c.yaw, roll: c.roll, strafe: c.strafe ?? 0, lift: c.lift ?? 0,
      throttleSet: c.throttleSet ?? null, speedSet: c.speedSet ?? null, boost: !!c.boost, aimPoint: null });
    // The last kilometre: like a person with a mouse, put the cursor on the
    // lead marker (a little shakily) and let the guns' gimbal do the rest.
    if ((g.kind === 'attack' || g.kind === 'torpedo') && !docking && p.gun) {
      const tgt = g.kind === 'torpedo' ? null : g.target;
      const pos = g.kind === 'torpedo' ? g.missile.pos : (g.sub ? subsystemWorld([0, 0, 0], tgt, g.sub) : tgt.ship.pos);
      const vel = g.kind === 'torpedo' ? g.missile.vel : tgt.ship.vel;
      const d = dist(pos, p.ship.pos);
      const fwd = forward([0, 0, 0], p.ship);
      const to = [(pos[0] - p.ship.pos[0]) / d, (pos[1] - p.ship.pos[1]) / d, (pos[2] - p.ship.pos[2]) / d];
      const ahead = fwd[0] * to[0] + fwd[1] * to[1] + fwd[2] * to[2];
      if (d < 1100 && ahead > Math.cos(40 * Math.PI / 180) && !(tgt?.big && !g.sub)) {
        state.jitterT -= dt;
        if (state.jitterT <= 0) {
          state.jitterT = 0.25;
          const r = 3 + d * 0.012;
          state.jitter = [(rand() * 2 - 1) * r, (rand() * 2 - 1) * r, (rand() * 2 - 1) * r];
        }
        const lead = leadPoint([0, 0, 0], p.ship.pos, p.ship.vel, pos, vel, p.gun.params.speed);
        if (lead) {
          input.aimPoint = [lead[0] + state.jitter[0], lead[1] + state.jitter[1], lead[2] + state.jitter[2]];
          const ld = dist(lead, p.ship.pos);
          const lc = ((lead[0] - p.ship.pos[0]) * fwd[0] + (lead[1] - p.ship.pos[1]) * fwd[1] + (lead[2] - p.ship.pos[2]) * fwd[2]) / ld;
          const range = p.gun.params.speed * p.gun.params.life * 0.8;
          input.fire = ld < range && lc > Math.cos((p.gun.params.gimbal ?? 0) + 2 * Math.PI / 180);
        }
      }
    }
    return input;
  };
  control.state = state;
  control.brain = brain;
  return control;
}
