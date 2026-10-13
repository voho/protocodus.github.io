/* A cheating pilot for headless mission runs. It cannot die, it flies
   (teleports) to whatever the mission is asking for, scans what needs
   scanning, and kills what is in its way with the player's credit — the
   point is to prove each mission's script can be finished (and failed),
   not to fly well. `solve(world)` is called a few times a second. */

import { STEP as DT } from '../js/config.js';
import { createWorld, startRun, stepWorld, drainEvents, IDLE } from '../js/world.js';
import { applyDamage } from '../js/combat.js';
import { qLookRotation } from '../js/vec.js';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function placeNear(world, pos, range) {
  const p = world.player.ship;
  const away = [p.pos[0] - pos[0], p.pos[1] - pos[1], p.pos[2] - pos[2]];
  const d = Math.hypot(...away) || 1;
  const at = pos.map((c, i) => c + away[i] / d * range);
  p.pos = at; p.prevPos = [...at]; p.vel = [0, 0, 0];
  qLookRotation(p.q, [pos[0] - at[0], pos[1] - at[1], pos[2] - at[2]], [0, 1, 0]);
}

export function solve(world, { kill = true, killRange = 4000 } = {}) {
  const p = world.player;
  if (!p?.alive) return;
  p.invulnerable = true;
  p.hull = Math.max(p.hull, p.maxHull * 0.9);
  // Scan whatever is scannable and not done.
  const scan = world.entities.find(e => e.alive && e.scan && !e.scan.done && !e.hidden);
  const subScan = world.entities.flatMap(e => e.alive ? e.subsystems.filter(s => s.scan && !s.scan.done && s.alive).map(s => [e, s]) : [])[0];
  if (scan) {
    world.target = scan; world.targetSub = null;
    placeNear(world, scan.ship.pos, Math.min(scan.scan.range * 0.5, scan.big ? scan.radius * 0.5 + 150 : 120));
    return;
  }
  if (subScan) {
    const [e, s] = subScan;
    world.target = e; world.targetSub = s;
    const at = e.ship.pos.map((c, i) => c + s.pos[i]);
    placeNear(world, at, 250);
    return;
  }
  // Kill hostiles: small craft, then anything large and hostile the mission marks.
  if (kill) {
    for (const e of world.entities) {
      if (!e.alive || e.folding || e.team !== 1 || e.frozen) continue;
      if (distance(e.ship.pos, p.ship.pos) > killRange && !e.tags.has('objective')) continue;
      if (e.big) {
        // Generators first (as a pilot would), then the rest, each just hard enough.
        const order = ['shield', 'emitter', 'bay', 'reactor'];
        for (const kind of order) for (const s of e.subsystems) {
          if (!s.alive || s.kind !== kind || !e.alive) continue;
          if (kind === 'reactor' && e.subsystems.some(x => x.kind === 'shield' && x.alive)) continue;
          if (!s.exposed && e.quad) e.quad.fill(0);
          s.hull = 0.5;
          applyDamage(e, 2, world.events, null, null, { sub: s, sourceId: p.id, sourceTeam: 0, weapon: { pierce: 1, shieldMul: 1, hullMul: 1 } });
        }
        if (e.role !== 'capital' || e.tags.has('kill')) applyDamage(e, 1e6, world.events, null, null, { sourceId: p.id, sourceTeam: 0, weapon: { pierce: 1, hullMul: 1, rockMul: 1 } });
      } else applyDamage(e, 1e6, world.events, null, null, { sourceId: p.id, sourceTeam: 0 });
    }
    for (const m of world.weapons.missiles) if (m.team === 1 && m.hp > 0) m.hp = 0;
    for (const e of world.entities) if (e.alive && e.team === -1 && e.tags.has('objective') && e.rock) applyDamage(e, 1e6, world.events, null, null, { sourceId: p.id, sourceTeam: 0, weapon: { pierce: 1, rockMul: 1 } });
  }
  // Go where the mission points.
  const nav = world.nav && !world.nav.hidden ? world.nav : world.navs.find(n => !n.hidden);
  if (nav) placeNear(world, nav.pos, Math.max(10, nav.r * 0.3));
}

/* Play a mission to its end. Returns { outcome, time, world, events }. */
export function play(mission, { loadout, difficulty = 'pilot', seconds = 1200, cheat = true, input = IDLE, every = 0.25, onStep = null } = {}) {
  const world = createWorld({ seed: 1, mission, loadout, difficulty });
  startRun(world);
  const log = [];
  let t = 0, next = 0;
  while (t < seconds && !world.mission.outcome) {
    stepWorld(world, input, DT);
    t += DT;
    if (cheat && t >= next) { solve(world, cheat === true ? {} : cheat); next = t + every; }
    onStep?.(world, t);
    for (const e of drainEvents(world)) if (e.type === 'objective' || e.type === 'missionWon' || e.type === 'missionLost' || e.type === 'radio') log.push([+t.toFixed(1), e.type, e.text ?? e.reason ?? e.id, e.state ?? '']);
  }
  // Let the last lines play.
  for (let k = 0; k < 120 * 2; k++) stepWorld(world, input, DT);
  return { outcome: world.mission.outcome, reason: world.mission.reason, time: world.mission.time, world, log };
}
