/* Hedgerow — enemy soldiers.

   Each German soldier has a post (standing guard, patrolling, manning a
   machine gun) and a leash around it.

   Perception: a sight cone shortened by the player's crouch, the dark and
   distance, lengthened when the player fires; line of sight through the
   world; hearing for shots and explosions. Awareness fills while the
   player is visible; full awareness means combat, which spreads to the
   rest of the group. A group shares what it saw: where the player was,
   which way he was going, and when.

   Patrols walk their routes and stop to look round. A shot or a blast
   heard from a distance sends the nearest one or two of a group to look
   (they stop and listen, walk over with their rifles up, look round the
   corners nearby, then go back); the rest take cover facing the sound.
   When the player breaks contact, one or two search the last place he was
   seen, sweeping towards where he was heading, and if he was on the move
   others run ahead along his way, crouch behind cover that hides them
   from it and wait for him to walk into their sights. Longer moves follow
   paths on the walk grid (nav.js), round houses, walls and the river.

   Combat for riflemen and SMG gunners is a cover cycle: pick a low-cover
   spot near the post that hides a crouched man from the player but lets
   a standing one see him, run there, then alternate hiding and popping up
   to fire. Suppression (bullets landing close) keeps them down. If the
   player stays out of sight close by, they may throw a stick grenade; if
   the player disappears for long, they go and look. Machine gunners swing
   their gun within its arc and hose the last known position.

   A squad can send one man to lateral cover while another watches. High
   cover needs an actual step round a corner, then back into shelter.
   Soldiers hold fire through comrades, reload in cover during a lull,
   and react to visible live grenades after a human delay. Contact reports
   are local; an unseen player's current position is never a fallback.

   Enemy fire is resolved as a roll against the player's exposure (head /
   chest visible), distance, stance and movement; misses still land
   around the player, crack past and kick up dirt. */

import * as THREE from 'three';
import { ENEMY, ENEMY_WEAPONS, GRENADE, GAIT } from './config.js';
import { clamp, damp, dampAngle, rng, wrapAngle, lerp } from './util.js';
import { createCharacter, mergedSoldier, randomFace } from './character.js';
import { startReload as reloadSequence, reloadEvents } from './reload.js';
import { MOVE, SHOT, SIGHT } from './world.js';
import { createNav } from './nav.js';
import { breathe } from './pace.js';
import { friendlyInFireLane, flankAngle } from './ai-tactics.js';

const R = rng(1944);
const FACES = rng(1907);      // faces on their own stream, so they do not shift the AI's dice
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

const BASE_ACC = { rifle: 0.5, smg: 0.3, mg: 0.2, officer: 0.4 };
const WEAPON_OF = { rifle: 'kar98k', smg: 'mp40', mg: 'mg42', officer: 'mp40' };

/* ---------- cover points from the world's low obstacles ---------- */

export function buildCoverPoints(world, terrain) {
  const points = [];
  for (const col of world.colliders) coverBy(col, world, terrain, points);
  return points;
}

/* the same, a collider at a time, the browser getting its turns between (loading, pace.js) */
export async function buildCoverPointsPaced(world, terrain) {
  const points = [];
  for (const col of world.colliders) { coverBy(col, world, terrain, points); await breathe(); }
  return points;
}

/* the cover points along one obstacle */
function coverBy(col, world, terrain, points) {
  if (!(col.flags & MOVE) || !(col.flags & SHOT)) return;
  if (col.type !== 'box') return;
  const ground = terrain.height(col.x, col.z);
  const top = col.top - ground;
  const low = top > 0.55 && top < 1.45;
  const tall = top >= 1.45;
  if (!low && !tall) return;
  if (col.hx * col.hz > 300) return;             // whole houses: corners only
  const off = 0.6;
  const sides = [
    [1, 0, col.hx, col.hz], [-1, 0, col.hx, col.hz], [0, 1, col.hz, col.hx], [0, -1, col.hz, col.hx],
  ];
  for (const [sx, sz, half, along] of sides) {
    // Each end of a tall face is a distinct usable corner. Sampling only
    // its negative end made otherwise mirrored encounters behave very
    // differently: the man at the other end abandoned shelter he had.
    const n = tall ? (along > .3 ? 2 : 1) : Math.max(1, Math.floor((along * 2) / 1.4));
    for (let k = 0; k < n; k++) {
      const u = tall ? (k % 2 ? 1 : -1) * Math.max(0, along - 0.3) : (n === 1 ? 0 : -along + 0.5 + (k * (along * 2 - 1)) / Math.max(1, n - 1));
      // local point
      const lx = sx !== 0 ? sx * (half + off) : u;
      const lz = sz !== 0 ? sz * (half + off) : u;
      const wx = col.x + lx * col.c + lz * col.s;
      const wz = col.z - lx * col.s + lz * col.c;
      const nx = sx * col.c + sz * col.s, nz = -sx * col.s + sz * col.c;   // outward normal
      const gy = world.groundAt(wx, wz, ground + 1, 0.5);
      if (Math.abs(gy - ground) > 0.8) continue;
      tmp.set(wx, gy, wz);
      if (world.pushOut(tmp, 0.3, gy, 1.7, 0.45)) continue;
      points.push({ x: wx, y: gy, z: wz, nx, nz, low, taken: null });
    }
  }
}

export function createEnemies(G, defs) {
  const enemies = [];
  const cover = G.cover;
  const nav = G.nav || (G.nav = createNav(G.world, G.level?.playBounds || G.world.bounds));
  // what each group last saw of the player: where, which way he was going, when
  const intel = new Map();
  const manoeuvres = new Map();              // one bounding move per squad at a time
  const coverGrid = new Map();
  for (const c of cover) {
    const k = Math.floor(c.x / 10) + ',' + Math.floor(c.z / 10);
    if (!coverGrid.has(k)) coverGrid.set(k, []);
    coverGrid.get(k).push(c);
  }
  const coverNear = (x, z, r) => {
    const out = [];
    const x0 = Math.floor((x - r) / 10), x1 = Math.floor((x + r) / 10), z0 = Math.floor((z - r) / 10), z1 = Math.floor((z + r) / 10);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const l = coverGrid.get(i + ',' + j);
      if (l) for (const c of l) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) out.push(c);
    }
    return out;
  };

  for (const d of defs) enemies.push(spawn(d));

  function spawn(d) {
    const type = d.type || 'rifle';
    const wid = d.weapon || WEAPON_OF[type];
    const wdef = ENEMY_WEAPONS[wid];
    const e = {
      def: d, id: enemies.length, type, group: d.group || 'none', wdef,
      pos: new THREE.Vector3(), yaw: 0, home: { x: d.at[0], z: d.at[1], yaw: (d.yaw || 0) * Math.PI / 180 },
      health: ENEMY.health * (d.tough || 1), dead: false, char: null,
      state: 'idle', awareness: 0, lastSeen: -99, lastContact: -99, lastKnown: null, contact: null, pendingContact: null, reportTimer: 0, sees: false, exposure: 0,
      cover: null, coverDeadline: 0, peekSpot: null, stance: d.stance || 'stand', target: null, moveSpeed: 0, vel: new THREE.Vector3(),
      fireTimer: 0, burstLeft: 0, aimTimer: 0, reaction: 0, suppressed: 0, shotRecoil: 0,
      phase: 'hide', phaseTimer: 0, grenades: type === 'rifle' ? 1 : type === 'smg' ? 1 : 0, grenadeCheck: 2 + R() * 3,
      perceiveTimer: R() * 0.15, searchTimer: 0, stuck: 0, lastPos: new THREE.Vector3(), alertAt: -1,
      patrol: d.patrol || null, patrolIdx: 0, patrolWait: 0,
      leash: d.hold ? 0 : d.leash ?? (type === 'mg' ? 0 : 18),
      mg: null, active: false, firstShot: true, shotsAtTarget: 0,
      mag: wdef.mag || 30, reloadT: 0, reloadTotal: 1, reloadStage: 0, reloadAudio: null,
      path: null, pathIdx: 0, pathFails: 0, rejectedCover: new Map(), srch: null, amb: null, alertCover: false,
      patience: 10, waryUntil: -1, scanPhase: R() * 6,
      tacticTimer: 7 + R() * 4, tacticalRole: null, covering: null, coverUntil: -1, fireLaneBlocked: false,
      laneBlockedFor: 0, laneStep: null,
      order: null,
      dangerTimer: R() * 0.18, danger: null, heardGrenade: null, pendingThrow: null,
    };
    // where it stands
    let x = d.at[0], z = d.at[1], y = null, yaw = e.home.yaw;
    if (d.anchor) { [x, y, z, yaw] = d.anchor; e.home.x = x; e.home.z = z; e.home.yaw = yaw; }
    e.pos.set(x, y ?? G.world.groundAt(x, z, 1e4, 0.5), z);
    if (y != null) e.fixedY = y;
    e.yaw = yaw;
    e.char = createCharacter(G.soldier ? mergedSoldier(G.soldier, G.matlib) : null, G.matlib, { outfit: 'axis', weaponModel: type === 'mg' ? null : G.models.get(wdef.model), grenadeModel: G.models.get('grenade_de'), scene: G.scene, face: randomFace(FACES) });
    e.char.root.position.copy(e.pos);
    e.char.root.rotation.y = e.yaw;
    G.scene.add(e.char.root);
    if (type === 'mg' && d.gun) {
      // the machine gun on the nest, turned by the gunner
      const model = G.models.get('mg42');
      if (model) {
        const g = new THREE.Group();
        for (const p of model.prims) g.add(new THREE.Mesh(p.geometry, G.matlib.resolve(p.material)));
        g.position.set(d.gun[0], d.gun[1], d.gun[2]);
        g.rotation.y = d.gun[3];
        G.scene.add(g);
        e.mg = { mesh: g, x: d.gun[0], y: d.gun[1], z: d.gun[2], baseYaw: d.gun[3], arc: d.arc ?? 1.0, muzzle: model.anchors.muzzle || [0, 0.25, 0.9] };
        g.updateMatrixWorld(true);
        e.mg.gunner = g.worldToLocal(e.pos.clone());
        // The model anchor centres the body; seat the butt against the
        // right shoulder, just in front of it, instead of through the neck.
        e.mg.gunner.x += 0.14;
        e.mg.gunner.z -= 0.08;
        e.char.holdMountedWeapon(g, model.anchors);
      }
    }
    e.damage = (amount, from, part, byPlayer) => damage(e, amount, from, part, byPlayer);
    e.suppress = (t, from) => suppress(e, t, from);
    if (e.patrol) e.state = 'patrol';
    return e;
  }

  /* ---------- reactions ---------- */

  function alertGroup(e) {
    if (!e.lastKnown || e.lastKnown.uncertain || e.group === 'none') return;
    const known = e.contact && e.contact.t >= Math.max(e.lastSeen, e.lastContact) ? e.contact : {
      ...e.lastKnown, vx: 0, vz: 0, t: G.time,
    };
    const report = { ...known, reporter: e.id };
    for (const o of enemies) {
      if (o === e || o.dead || o.group !== e.group) continue;
      // A shouted contact is local. A remote sentry, or every unassigned
      // soldier on the map, cannot know what happened at this post.
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > 60) continue;
      // Preserve an in-flight call's delivery time. Replacing it every
      // perception tick would keep postponing the report indefinitely.
      if (!o.pendingContact) o.pendingContact = { report, at: G.time + 0.35 + R() * 1.1 };
    }
    e.reportTimer = G.time + 1.25;
  }

  function receiveContact(e) {
    const pending = e.pendingContact;
    if (!pending || G.time < pending.at) return;
    e.pendingContact = null;
    const report = pending.report;
    if (report.t <= Math.max(e.lastSeen, e.lastContact, e.contact?.t ?? -99)) return;
    e.contact = report;
    if (!e.sees) e.lastKnown = { x: report.x, y: report.y, z: report.z };
    // A call interrupts a patrol or search, but cannot propagate itself
    // along a chain of sentries across the entire map.
    if (e.state !== 'combat') enterCombat(e, false);
  }

  function localIntel(e) {
    // The public map is useful for diagnostics and authored test reports;
    // runtime visual reports carry a reporter and only arrive via the
    // delayed, local channel above.
    const injected = intel.get(e.group);
    return injected && injected.reporter == null ? injected : e.contact;
  }

  function enterCombat(e, report = true) {
    if (e.state === 'combat' || e.dead) return;
    // sprung from an ambush: already in cover with the rifle on the spot
    const sprung = e.state === 'ambush' && e.cover && e.amb && e.amb.phase === 'wait';
    e.state = 'combat';
    e.awareness = 1;
    e.phase = sprung ? 'peek' : 'move';
    e.phaseTimer = sprung ? 2.5 + R() * 1.5 : 0;
    e.reaction = sprung ? 0.2 + R() * 0.15 : lerp(ENEMY.reaction[0], ENEMY.reaction[1], R());
    e.aimTimer = e.reaction;
    e.patience = 7 + R() * 6;
    e.srch = null; e.amb = null; e.path = null;
    e.firstShot = true;
    G.events.emit('enemyAlert', e);
    if (report) alertGroup(e);
  }

  function incomingBearing(e, from) {
    // Preserve a fresh sensed position; a hit alone supplies a bearing,
    // not the unseen shooter's distance or elevation. Freeze its original
    // timestamp so repeated hits cannot keep old visual intel fresh.
    const known = e.lastKnown;
    const at = known?.t ?? Math.max(e.lastSeen, e.lastContact, e.contact?.t ?? -99);
    if (known && !known.uncertain && G.time - at <= 1.5) {
      e.lastKnown = { ...known, t: at };
      return;
    }
    const dx = from.x - e.pos.x, dz = from.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > .01) e.lastKnown = { x: e.pos.x + dx / d * 20, y: e.pos.y, z: e.pos.z + dz / d * 20, uncertain: true };
  }

  function damage(e, amount, from, part, byPlayer) {
    if (e.dead) return false;
    e.health -= amount;
    if (e.health <= 0) {
      die(e, from, part);
      return true;
    }
    if (byPlayer && from) incomingBearing(e, from);
    e.char.oneShot('hit', 1.2);
    e.lastContact = G.time;
    e.suppressed = Math.max(e.suppressed, 0.8);
    enterCombat(e);
    return false;
  }

  function die(e, from, part) {
    e.dead = true;
    e.state = 'dead';
    e.reloadAudio?.cancel(); e.reloadAudio = null;
    e.pendingThrow = null; e.danger = null; e.heardGrenade = null; e.laneStep = null; e.order = null; e.tacticalRole = null; e.covering = null;
    if (e.cover) { e.cover.taken = null; e.cover = null; }
    let kind = 'death_fwd';
    if (from) {
      const ang = Math.atan2(from.x - e.pos.x, from.z - e.pos.z);
      const rel = Math.cos(wrapAngle(ang - e.yaw));
      kind = rel > 0.2 ? 'death_fwd' : rel < -0.2 ? 'death_back' : 'death_crumple';
    }
    if (part === 'head' && R() < 0.5) kind = 'death_crumple';
    // the blow that killed him: a bullet pushes the part it hit, a blast throws him
    const impulses = [];
    if (from) {
      const dir = new THREE.Vector3(e.pos.x - from.x, 0, e.pos.z - from.z);
      const d = dir.length() || 1;
      dir.divideScalar(d);
      if (part === 'explosion') {
        const k = Math.max(2, 9 - d);
        impulses.push({ part: 'all', vel: dir.multiplyScalar(k).add(new THREE.Vector3(0, k * 0.55, 0)) });
      } else {
        impulses.push({ part: part || 'body', vel: dir.multiplyScalar(part === 'head' ? 2.6 : 3.4).add(new THREE.Vector3(0, 0.4, 0)) });
      }
    }
    // Keep this draw on the AI stream even when real contact replaces the
    // fallback, so a body-sound change cannot alter squad decisions.
    const fallbackDelay = 0.4 + R() * 0.3;
    e.char.die(kind, {
      world: G.world, velocity: e.vel.clone(), impulses,
      onImpact: ({ x, y, z, surface, speed }) => G.audio.bodyImpact(x, y, z, surface, speed),
    });
    if (!e.char.ragdoll) G.audio.bodyFall(e.pos.x, e.pos.y, e.pos.z, G.world.surfaceUnder(e.pos.x, e.pos.y, e.pos.z), fallbackDelay);
    if (G.debris && e.char.weapon && e.char.ragdoll) {
      G.debris.drop(e.char.weapon, new THREE.Vector3((R() - 0.5) * 1.5, 1.2, (R() - 0.5) * 1.5), { spin: 5, radius: 0.08, life: 240 });
    }
    G.stats.kills++;
    if (part === 'head') G.stats.headshots++;
    // A dead man cannot begin a new contact call. A call already heard
    // remains valid; cancel only this reporter's unfinished human delay.
    for (const other of enemies) {
      if (other.pendingContact?.report.reporter === e.id && other.pendingContact.at > G.time) other.pendingContact = null;
    }
    G.events.emit('enemyKilled', e);
  }

  function suppress(e, t, from) {
    if (e.dead) return;
    e.suppressed = Math.max(e.suppressed, t);
    if (from && e.state !== 'combat') incomingBearing(e, from);
    e.lastContact = G.time;
    if (e.state !== 'combat') {
      e.awareness = Math.max(e.awareness, 0.75);
      enterCombat(e);
    }
  }

  /* Shots and blasts. Close by: into cover, ready. Further off: the
     nearest one or two of each group go and look, the rest take cover
     facing the sound. Running feet only turn heads. */
  G.events.on('noise', ({ x, z, radius, kind }) => {
    const heard = [];
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d > radius) continue;
      if (kind === 'step') {
        if (e.state === 'combat' || e.state === 'ambush') continue;
        e.awareness = Math.max(e.awareness, 0.45);
        e.lastKnown = { x, z };
        if (e.state === 'idle' || e.state === 'patrol') e.state = 'alert';
        continue;
      }
      if (e.state === 'combat') { if (!e.sees) { e.lastKnown = { x, z }; e.lastContact = G.time; } continue; }
      e.lastKnown = { x, z }; e.lastContact = G.time;
      if (e.state === 'ambush') continue;            // stays put, listening
      if (d < radius * 0.3) { e.lastKnown = { x, z }; e.lastContact = G.time; enterCombat(e); continue; }
      heard.push({ e, d });
    }
    const groups = new Map();
    for (const h of heard) { if (!groups.has(h.e.group)) groups.set(h.e.group, []); groups.get(h.e.group).push(h); }
    for (const list of groups.values()) {
      list.sort((a, b) => a.d - b.d);
      const want = kind === 'explosion' ? 2 : list.length > 3 ? 2 : 1;
      let going = list.filter(({ e }) => e.state === 'search').length;
      for (const { e } of list) {
        if (e.state === 'search' && e.srch) {
          // already looking: the new sound is the place to go
          Object.assign(e.srch, { x, z, phase: 'approach', timer: 45, points: null, idx: 0 });
          e.path = null;
          continue;
        }
        if (canLeave(e) && going < want) {
          startSearch(e, x, z, { reason: 'investigate', sweeps: kind === 'explosion' ? 2 : 1, listen: 0.6 + R() * 1.2 });
          going++;
        } else {
          e.lastKnown = { x, z };
          e.awareness = Math.max(e.awareness, 0.85);
          e.state = 'alert';
          e.alertCover = e.type !== 'mg';
          e.path = null;
        }
      }
    }
  });

  // A visible grenade is not the only warning: an actual nearby impact
  // can be heard behind him. Solid cover muffles that short sound. This
  // cue is about the grenade, never a confirmed sighting of its thrower.
  G.events.on('grenadeBounce', ({ grenade }) => {
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - grenade.pos.x, e.pos.y + .8 - grenade.pos.y, e.pos.z - grenade.pos.z);
      if (d > 7) continue;
      const clear = G.world.clear(e.pos.x, e.pos.y + 1.1, e.pos.z, grenade.pos.x, grenade.pos.y + .15, grenade.pos.z, SIGHT);
      if (!clear && d > 2.5) continue;
      e.heardGrenade = { grenade, until: G.time + 1.2 };
      if (e.state === 'idle' || e.state === 'patrol' || e.state === 'alert') {
        e.lastKnown = { x: grenade.pos.x, y: grenade.pos.y, z: grenade.pos.z };
        e.awareness = Math.max(e.awareness, .45);
        e.state = 'alert';
      }
    }
  });

  /* The player is down: whoever killed him walks over to make sure. */
  G.events.on('playerDied', () => {
    const k = G.player.killer;
    if (k && !k.dead && canLeave(k)) {
      const p = G.player.pos;
      startSearch(k, p.x, p.z, { reason: 'body', sweeps: 0, listen: 1.5 + R() });
    }
  });

  const canLeave = (e) => e.leash > 0 && !e.def.hold && e.type !== 'mg';
  const assaultOrder = (e) => e.order && G.time < e.order.until ? e.order : null;

  /* ---------- perception ---------- */

  function eyePos(e, out) {
    const h = e.stance === 'crouch' ? 1.05 : 1.6;
    return out.set(e.pos.x, e.pos.y + h, e.pos.z);
  }

  function perceive(e, dt) {
    const p = G.player;
    e.sees = false;
    e.exposure = 0;
    if (!p.alive) return;
    const eye = eyePos(e, tmp);
    const head = tmp2.set(p.pos.x + (p.leanX || 0), p.pos.y + (p.crouch ? 1.15 : 1.65), p.pos.z + (p.leanZ || 0));
    const chest = tmp3.set(p.pos.x, p.pos.y + (p.crouch ? 0.8 : 1.2), p.pos.z);
    const dx = chest.x - eye.x, dz = chest.z - eye.z;
    const dist = Math.hypot(dx, dz);
    const combat = e.state === 'combat';
    // looking for him (searching, waiting in ambush, still wary): eyes open wider
    const ready = e.state === 'search' || e.state === 'ambush' || e.state === 'alert' || G.time < e.waryUntil;
    let range = (e.type === 'mg' ? 95 : ENEMY.viewRange) * p.visible * (combat ? 1.7 : ready ? 1.25 : 1);
    if (G.lightning > 0.4) range *= 1.4;
    if (dist > range) return;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - e.yaw));
    // Alertness widens peripheral vision; it does not put eyes in the
    // back of his head. Sounds and local contact calls turn him instead.
    const fov = combat ? Math.PI * 0.55 : e.state === 'ambush' ? ENEMY.viewFov * 1.5 : ready ? ENEMY.viewFov * 1.4 : ENEMY.viewFov;
    if (ang > fov) return;
    const seeChest = G.world.clear(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z, SIGHT);
    // A clear chest already gives full exposure; only check above cover
    // when the chest is hidden.
    const seeHead = !seeChest && G.world.clear(eye.x, eye.y, eye.z, head.x, head.y, head.z, SIGHT);
    if (!seeHead && !seeChest) return;
    e.sees = true;
    e.exposure = seeChest ? 1 : 0.45;
    e.lastKnown = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    e.lastSeen = G.time;
    e.contact = { x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel ? p.vel.x : 0, vz: p.vel ? p.vel.z : 0, t: G.time, reporter: e.id };
    intel.set(e.group, e.contact);
    if (!combat) {
      // waiting for him in ambush: he walked into the sights
      if (e.state === 'ambush') { enterCombat(e); return; }
      const near = 1 - dist / range;
      e.awareness += dt * ENEMY.awareRate * G.diff.aware * (0.35 + 2.2 * near * near) * (seeChest ? 1 : 0.6) * (ready ? 2.5 : 1);
      if (e.awareness >= 1) enterCombat(e);
      else if (e.awareness > 0.35 && e.state !== 'search') e.state = 'alert';
    }
    if (e.state === 'combat' && G.time >= e.reportTimer) alertGroup(e);
  }

  /* ---------- movement ---------- */

  function threatOf(e) {
    return e.lastKnown || { x: e.pos.x + Math.sin(e.yaw) * 20, y: e.pos.y, z: e.pos.z + Math.cos(e.yaw) * 20 };
  }

  function threatHeight(lk) {
    return lk.y ?? nav.height(lk.x, lk.z) ?? G.world.groundAt(lk.x, lk.z, 1e4, 0.5);
  }

  function moveTowards(e, tx, tz, speed, dt, stop = 0.25) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stop) { e.vel.set(0, 0, 0); return true; }
    const vx = (dx / d) * speed, vz = (dz / d) * speed;
    e.vel.x = damp(e.vel.x, vx, 8, dt);
    e.vel.z = damp(e.vel.z, vz, 8, dt);
    tmp.set(e.pos.x + e.vel.x * dt, 0, e.pos.z + e.vel.z * dt);
    G.world.pushOut(tmp, ENEMY.radius, e.pos.y, 1.7, 0.45);
    // keep apart from other soldiers and the player
    for (const o of enemies) {
      if (o === e || o.dead) continue;
      const ox = tmp.x - o.pos.x, oz = tmp.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 0.7 && od > 1e-4) { tmp.x += (ox / od) * (0.7 - od) * 0.5; tmp.z += (oz / od) * (0.7 - od) * 0.5; }
    }
    if (G.world.tooDeep(tmp.x, tmp.z, 1.0, e.pos.y)) { e.vel.set(0, 0, 0); return true; }
    // Separation or a drop beside a raised obstacle can change the body
    // span after the first collision solve. Resolve at his new footing,
    // too, so he cannot settle half inside a trench wall or crate.
    let ground = G.world.groundAt(tmp.x, tmp.z, e.pos.y, 0.5);
    G.world.pushOut(tmp, ENEMY.radius, ground, 1.7, 0.45);
    ground = G.world.groundAt(tmp.x, tmp.z, ground, 0.5);
    // his velocity is what he actually made good: pressed against a wall he stops there instead of
    // walking on the spot into it (the gait follows e.vel)
    if (dt > 0) { e.vel.x = (tmp.x - e.pos.x) / dt; e.vel.z = (tmp.z - e.pos.z) / dt; }
    e.pos.x = tmp.x; e.pos.z = tmp.z;
    e.pos.y = ground;
    return Math.hypot(tx - e.pos.x, tz - e.pos.z) < stop;
  }

  function face(e, x, z, rate, dt) {
    const want = Math.atan2(x - e.pos.x, z - e.pos.z);
    e.yaw = dampAngle(e.yaw, want, rate, dt);
    return Math.abs(wrapAngle(want - e.yaw));
  }

  /* Find a cover point near the post that hides a crouching man from the
     player's last known position but lets him fire standing. */
  function cornerPeek(c, lk, py) {
    for (const side of [1, -1]) {
      const x = c.x - c.nz * 1.05 * side, z = c.z + c.nx * 1.05 * side;
      const y = G.world.groundAt(x, z, c.y, 0.45);
      if (Math.abs(y - c.y) > 0.45 || G.world.tooDeep(x, z, 0.9, y)) continue;
      const point = { x, y, z };
      G.world.pushOut(point, ENEMY.radius, y, 1.7, 0.45);
      if (Math.hypot(point.x - x, point.z - z) > 0.03) continue;
      if (!G.world.clear(c.x, c.y + 0.6, c.z, x, y + 0.6, z, MOVE)) continue;
      if (G.world.clear(x, y + 1.55, z, lk.x, py, lk.z, SIGHT)) return { x, z };
    }
    return null;
  }

  function findCover(e) {
    const lk = threatOf(e);
    const py = threatHeight(lk) + 1.2;
    // near the post, or near where he is now when the fight found him elsewhere
    const atPost = e.leash > 0 && Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z) < e.leash + 6;
    const order = assaultOrder(e);
    const centre = order ? e.pos : atPost ? e.home : e.pos;
    const cand = coverNear(centre.x, centre.z, order ? 24 : Math.max(8, (e.leash || 10) + 4));
    const scored = [];
    let tests = 0;
    cand.sort((a, b) => ((a.x - e.pos.x) ** 2 + (a.z - e.pos.z) ** 2) - ((b.x - e.pos.x) ** 2 + (b.z - e.pos.z) ** 2));
    for (const c of cand) {
      if (c.taken && c.taken !== e) continue;
      if ((e.rejectedCover.get(c) || 0) > G.time) continue;
      if (tests > 14) break;
      const toP = Math.hypot(lk.x - c.x, lk.z - c.z);
      if (toP < 6) continue;
      const progress = order ? Math.hypot(e.pos.x - order.x, e.pos.z - order.z) - Math.hypot(c.x - order.x, c.z - order.z) : 0;
      if (order && e.reloadT <= 0 && e.suppressed < .3 && Math.hypot(e.pos.x - order.x, e.pos.z - order.z) > 26 && progress < 2) continue;
      // the obstacle must be between the point and the player
      const facing = ((lk.x - c.x) * -c.nx + (lk.z - c.z) * -c.nz) / toP;
      if (facing < 0.35) continue;
      tests++;
      const hidden = !G.world.clear(c.x, c.y + 0.95, c.z, lk.x, py, lk.z, SHOT);
      if (!hidden) continue;
      const peek = c.low ? G.world.clear(c.x, c.y + 1.55, c.z, lk.x, py + 0.3, lk.z, SIGHT) : !!cornerPeek(c, lk, py);
      if (!peek && e.reloadT <= 0 && e.suppressed < 0.6) continue;
      const dMe = Math.hypot(c.x - e.pos.x, c.z - e.pos.z);
      const pref = e.type === 'smg' ? 16 : 28;
      const score = (peek ? 6 : 0) - dMe * 0.45 - Math.abs(toP - pref) * 0.15 + facing * 2 + progress * 0.65;
      scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { c } of scored.slice(0, 6)) {
      const route = walkingPath(e, c.x, c.z);
      if (route) { e.coverDeadline = G.time + Math.max(6, routeLength(e.pos, route) / ENEMY.run * 1.5 + 2); return c; }
      e.rejectedCover.set(c, G.time + 20);
    }
    return null;
  }

  /* ---------- shooting ---------- */

  function muzzleOf(e, out) {
    if (e.mg) {
      const m = e.mg;
      const yaw = m.mesh.rotation.y;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return out.set(m.x + m.muzzle[0] * c + m.muzzle[2] * s, m.y + m.muzzle[1], m.z - m.muzzle[0] * s + m.muzzle[2] * c);
    }
    return e.char.muzzleWorld(out);
  }

  function startReload(e) {
    const w = e.wdef;
    e.reloadAudio?.cancel(); e.reloadAudio = null;
    e.reloadT = e.reloadTotal = w.reload || 3;
    e.reloadStage = 0;
    e.burstLeft = 0;
    let clip = null;
    if (e.type !== 'mg') {
      clip = e.type === 'smg' && e.char.hasClip('reload_smg') ? 'reload_smg' : 'reload';
      e.char.oneShot(clip, (e.char.clipLength(clip) || 1.6) / e.reloadTotal);
      e.reloadRun = reloadSequence(G, e.char, w, clip);
    }
    e.reloadAudio = G.audio.reloadActor?.(w.sound, () => e.dead ? null : e.pos, {
      duration: e.reloadTotal,
      events: clip ? reloadEvents(G.soldier)[clip] || reloadEvents(G.soldier).reload : undefined,
    }) || null;
    if (!e.reloadAudio) G.audio.reload?.(w.sound, e.pos);
    // Caught empty in the open: run to a real cover position rather than
    // stand facing the player through the entire magazine change.
    if (canLeave(e) && !e.cover && e.state === 'combat') {
      const c = findCover(e);
      if (c) { e.cover = c; c.taken = e; e.phase = 'move'; e.phaseTimer = 0; e.path = null; }
    }
  }

  /* the hands during an enemy reload (the shared sequencer in reload.js) */
  function reloadSteps(e, dt) {
    e.reloadT -= dt;
    e.reloadAudio?.advance(dt);
    e.reloadRun?.update(1 - Math.max(0, e.reloadT) / e.reloadTotal);
    if (e.reloadT <= 0) {
      e.reloadT = 0; e.mag = e.wdef.mag || 30; e.reloadRun?.end(); e.reloadRun = null;
      e.reloadAudio?.finish(); e.reloadAudio = null;
    }
  }

  function shoot(e) {
    const p = G.player;
    const w = e.wdef;
    if (e.reloadT > 0 || e.pendingThrow) return false;
    const muzzle = muzzleOf(e, new THREE.Vector3());
    const lk = threatOf(e), headOnly = e.exposure < 0.75;
    const target = e.sees
      ? (headOnly
        ? new THREE.Vector3(p.pos.x + (p.leanX || 0), p.pos.y + (p.crouch ? 1.15 : 1.65), p.pos.z + (p.leanZ || 0))
        : new THREE.Vector3(p.pos.x, p.pos.y + (p.crouch ? 0.85 : 1.25), p.pos.z))
      : new THREE.Vector3(lk.x, threatHeight(lk) + 1.2, lk.z);
    let shotExposure = e.exposure;
    let clearShot = e.sees && G.world.clear(muzzle.x, muzzle.y, muzzle.z, target.x, target.y, target.z, SHOT);
    // A cached full-body sighting can become head-only as the target
    // moves behind low cover. Check the real exposed head from the muzzle.
    if (e.sees && !clearShot && !headOnly) {
      target.set(p.pos.x + (p.leanX || 0), p.pos.y + (p.crouch ? 1.15 : 1.65), p.pos.z + (p.leanZ || 0));
      clearShot = G.world.clear(muzzle.x, muzzle.y, muzzle.z, target.x, target.y, target.z, SHOT);
      shotExposure = Math.min(shotExposure, 0.45);
    }
    // The body and rifle must finish turning before a new contact can
    // be engaged. A probabilistic hit must still correspond to the
    // direction the soldier is visibly aiming.
    if (Math.abs(wrapAngle(Math.atan2(target.x - e.pos.x, target.z - e.pos.z) - e.yaw)) > 0.16) return false;
    e.fireLaneBlocked = !!friendlyInFireLane(e, muzzle, target, enemies);
    if (e.fireLaneBlocked) return false;
    if (--e.mag <= 0) startReload(e);
    let hit = false;
    if (e.sees && p.alive) {
      const d = muzzle.distanceTo(target);
      const fall = clamp(1 - (d - 6) / (w.range * 1.1), 0.12, 1);
      let pHit = BASE_ACC[e.type] * fall * shotExposure * G.diff.accuracy;
      if (p.crouch) pHit *= 0.7;
      if (p.movingSpeed > 3) pHit *= 0.7;
      if (p.vault) pHit *= 0.5;
      if (e.suppressed > 0) pHit *= 0.35;
      if (e.firstShot) pHit *= 0.45;
      pHit *= Math.min(1.25, 0.85 + e.shotsAtTarget * 0.05);
      // Perception is deliberately staggered. Cover may have changed in
      // the 120 ms since the last sight check; the muzzle still needs a
      // clear shot now, including when only the player's head is visible.
      hit = R() < pHit && clearShot;
    }
    e.firstShot = false;
    e.shotsAtTarget++;
    // A small shoulder response follows a fired round; mounted guns retain their bipod pose.
    if (!e.mg) e.shotRecoil = Math.min(.065, e.shotRecoil + (e.type === 'rifle' ? .045 : .018));
    // visuals and sound
    const dir = new THREE.Vector3();
    let end;
    if (hit) {
      end = target;
    } else {
      // a miss lands around the player (or around where he was)
      end = target.clone().add(new THREE.Vector3((R() - 0.5) * 3.2, (R() - 0.6) * 1.8, (R() - 0.5) * 3.2));
    }
    dir.subVectors(end, muzzle);
    const len = dir.length();
    dir.divideScalar(len || 1);
    G.effects.muzzle(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, e.type === 'mg' ? 1.1 : 0.9);
    G.lights.flash(muzzle.x + dir.x * 0.3, muzzle.y, muzzle.z + dir.z * 0.3, '#ffb36b', e.type === 'mg' ? 50 : 40, 8, 0.05);
    G.audio.gunshot(w.sound, muzzle.x, muzzle.y, muzzle.z);
    const wh = hit ? null : G.world.raycast(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, 200, SHOT);
    const tracer = R() < w.tracer;
    // a tracer ends where its round does
    if (tracer) G.effects.tracer(muzzle.x + dir.x * 0.6, muzzle.y + dir.y * 0.6, muzzle.z + dir.z * 0.6, dir.x, dir.y, dir.z, hit ? len : wh ? wh.t : 150, 260, '#ffc070');
    if (hit) {
      const dmg = lerp(w.damage[0], w.damage[1], R()) * G.diff.damage;
      p.damage(dmg, e.pos, 'bullet', e);
      G.effects.blood(target.x, target.y, target.z, dir.x, dir.y, dir.z);
    } else {
      if (wh) {
        G.effects.impact(wh.x, wh.y, wh.z, wh.nx, wh.ny, wh.nz, wh.surface || 'stone', dir.x, dir.y, dir.z);
        G.decals?.impact(wh.x, wh.y, wh.z, wh.nx, wh.ny, wh.nz, wh.surface || 'stone');
        G.audio.impact(wh.x, wh.y, wh.z, wh.surface);
        // a glancing tracer skips off stone, metal or a hard road, now and then off the mud: it
        // goes on, slower, off the way it bounced, often up into the sky
        const into = -(dir.x * wh.nx + dir.y * wh.ny + dir.z * wh.nz);
        const soft = /^(mud|grass|forest|dirt|foliage|sandbag|water|flesh)$/.test(wh.surface || 'stone');
        if (tracer && into > 0 && R() < (soft ? 0.25 : 0.7) * (1 - into)) {
          const rd = tmp.set(dir.x + 2 * into * wh.nx + (R() - 0.5) * 0.5, dir.y + 2 * into * wh.ny + R() * 0.35, dir.z + 2 * into * wh.nz + (R() - 0.5) * 0.5).normalize();
          G.effects.tracer(wh.x + rd.x * 0.05, wh.y + rd.y * 0.05, wh.z + rd.z * 0.05, rd.x, rd.y, rd.z, 25 + R() * 50, 140 + R() * 80, '#ffc070');
        }
      }
      // crack past the listener if close to the line
      const cam = G.camera.position;
      const toCam = tmp.subVectors(cam, muzzle);
      const along = toCam.dot(dir);
      if (along > 0 && (!wh || along < wh.t + 2)) {
        const closest = tmp2.copy(muzzle).addScaledVector(dir, along);
        const miss = closest.distanceTo(cam);
        if (miss < 4) { G.audio.whizz(closest.x, closest.y, closest.z, 1 - miss / 4); p.suppress?.(1 - miss / 4); }
        if (miss < 1.5) G.rig.addShake(0.08);
      } else if (wh && Math.hypot(wh.x - cam.x, wh.y - cam.y, wh.z - cam.z) < 2.5) {
        // or it struck the wall or the ground beside him
        p.suppress?.(0.5);
      }
    }
    return true;
  }

  function tryGrenade(e) {
    if (!e.lastKnown || e.lastKnown.uncertain || e.grenades <= 0 || e.pendingThrow || e.reloadT > 0 || e.suppressed > 0.2) return false;
    const d = Math.hypot(e.lastKnown.x - e.pos.x, e.lastKnown.z - e.pos.z);
    if (d < 8 || d > 26) return false;
    if (G.time - e.lastSeen < 3.5 || G.time - e.lastSeen > 25) return false;
    if (G.explosives.list.some(g => g.kind === 'enemy') || enemies.some(o => o.pendingThrow)) return false;
    if (R() > 0.45) return false;
    const tx = e.lastKnown.x + (R() - 0.5) * 3, tz = e.lastKnown.z + (R() - 0.5) * 3;
    if (!grenadeSafe(e, tx, tz) || !grenadeArc(new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z), tx, tz)) return false;
    e.char.oneShot('throw', 1.1);
    // Simulation time: pausing or retrying a checkpoint cannot release a
    // delayed grenade into a frozen or newly reset battlefield.
    e.pendingThrow = { x: tx, z: tz, delay: 0.42 };
    return true;
  }

  function grenadeSafe(e, x, z) {
    return enemies.every(o => o.dead || o === e || Math.hypot(o.pos.x - x, o.pos.z - z) > GRENADE.radius + 1.5);
  }

  function grenadeArc(start, tx, tz) {
    const dx = tx - start.x, dz = tz - start.z, horiz = Math.hypot(dx, dz);
    if (horiz < 0.5) return null;
    const ty = G.world.groundAt(tx, tz, 1e4, 0.5), ang = 0.7;
    const denominator = 2 * Math.cos(ang) ** 2 * (horiz * Math.tan(ang) - (ty - start.y));
    if (denominator <= 0) return null;
    const v2 = 9.8 * horiz * horiz / denominator;
    if (!Number.isFinite(v2) || v2 <= 0 || v2 > 400) return null;
    const v = Math.sqrt(v2);
    const vel = new THREE.Vector3((dx / horiz) * v * Math.cos(ang), v * Math.sin(ang), (dz / horiz) * v * Math.cos(ang));
    const flight = horiz / (v * Math.cos(ang));
    let prev = start;
    for (let i = 1; i <= 10; i++) {
      const t = flight * i / 10;
      const next = new THREE.Vector3(start.x + vel.x * t, start.y + vel.y * t - 4.9 * t * t, start.z + vel.z * t);
      // The intended ground impact is allowed; a wall or low roof is not.
      if (!G.world.clear(prev.x, prev.y + 0.12, prev.z, next.x, next.y + 0.12, next.z, SHOT)) return null;
      prev = next;
    }
    return vel;
  }

  function updateThrow(e, dt) {
    const queued = e.pendingThrow;
    if (!queued || (queued.delay -= dt) > 0) return;
    e.pendingThrow = null;
    const tx = queued.x, tz = queued.z;
    if (e.dead || e.suppressed > 0.5 || e.danger || !grenadeSafe(e, tx, tz)) return;
    const start = e.char.boneWorld('hand_r', new THREE.Vector3());
    const vel = grenadeArc(start, tx, tz);
    if (!vel) return;
    // Spend the grenade only when it actually leaves his hand.
    e.grenades--;
    G.explosives.throwGrenade('enemy', start, vel, 0.4 + R() * 0.6, e);
  }

  /* ---------- survival and squad movement ---------- */

  function escapePoint(e, grenade) {
    const away = Math.atan2(e.pos.x - grenade.pos.x, e.pos.z - grenade.pos.z);
    const reach = clamp(ENEMY.run * Math.max(0.7, grenade.fuse - 0.3), 3, 9);
    const candidates = [];
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2.1, -2.1, Math.PI]) {
      const x = e.pos.x + Math.sin(away + turn) * reach, z = e.pos.z + Math.cos(away + turn) * reach;
      if (!nav.walkable(x, z)) continue;
      const y = nav.height(x, z) ?? e.pos.y;
      const distance = Math.hypot(x - grenade.pos.x, z - grenade.pos.z);
      const shielded = !G.world.clear(grenade.pos.x, grenade.pos.y + 0.4, grenade.pos.z, x, y + 0.9, z, SHOT);
      const crowd = enemies.filter(o => o !== e && !o.dead && Math.hypot(x - o.pos.x, z - o.pos.z) < 1.5).length;
      candidates.push({ x, z, score: distance + (shielded ? 8 : 0) - crowd * 3 });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates.slice(0, 4)) {
      const path = walkingPath(e, c.x, c.z);
      const end = path?.[path.length - 1];
      if (!end || Math.hypot(end.x - c.x, end.z - c.z) > 1.2) continue;
      return c;
    }
    return null;
  }

  function updateDanger(e, dt) {
    if (e.heardGrenade && G.time > e.heardGrenade.until) e.heardGrenade = null;
    e.dangerTimer -= dt;
    if (e.dangerTimer <= 0) {
      e.dangerTimer = 0.18;
      let nearest = null, nd = 9.5;
      for (const g of G.explosives.list) {
        if (g.fuse <= 0 || g.kind === 'charge' && g.fuse > 3.4) continue;
        const distance = Math.hypot(g.pos.x - e.pos.x, g.pos.y - (e.pos.y + 0.8), g.pos.z - e.pos.z);
        const known = e.danger?.grenade === g || e.heardGrenade?.grenade === g;
        if (!known && Math.abs(wrapAngle(Math.atan2(g.pos.x - e.pos.x, g.pos.z - e.pos.z) - e.yaw)) > Math.PI * .55) continue;
        if (distance >= nd || !G.world.clear(e.pos.x, e.pos.y + 1.1, e.pos.z, g.pos.x, g.pos.y + 0.15, g.pos.z, SIGHT)) continue;
        nearest = g; nd = distance;
      }
      if (nearest) {
        if (e.danger?.grenade !== nearest) e.danger = { grenade: nearest, reactAt: G.time + 0.3 + R() * 0.25, until: G.time + nearest.fuse + 0.5, target: null };
        else e.danger.until = G.time + nearest.fuse + 0.5;
      } else if (e.danger) {
        e.danger.until = Math.min(e.danger.until, G.time + 0.5);
      }
    }
    const danger = e.danger;
    if (!danger || G.time < danger.reactAt) return false;
    if (G.time > danger.until) {
      e.danger = null; e.tacticalRole = null; e.path = null;
      if (e.state === 'combat') { e.phase = 'move'; e.phaseTimer = 0; }
      return false;
    }
    e.pendingThrow = null;
    if (!canLeave(e)) {
      // A mounted gunner or a man fixed in a dugout stays in his firing
      // position, but gets his head down until the danger has passed.
      e.stance = 'crouch'; e.vel.set(0, 0, 0);
      e.suppressed = Math.max(e.suppressed, 0.8);
      e.phase = 'hide'; e.phaseTimer = 0.8;
      return true;
    }
    if (danger.plannedAt == null || G.time - danger.plannedAt > 0.8 && Math.hypot(danger.grenade.pos.x - danger.plannedX, danger.grenade.pos.z - danger.plannedZ) > 3) {
      if (e.state === 'ambush') endAmbush(e);
      else if (e.cover) { e.cover.taken = null; e.cover = null; }
      e.path = null;
      e.laneStep = null;
      danger.target = escapePoint(e, danger.grenade);
      danger.plannedAt = G.time; danger.plannedX = danger.grenade.pos.x; danger.plannedZ = danger.grenade.pos.z;
      e.tacticalRole = 'evade';
    }
    e.stance = danger.target ? 'stand' : 'crouch';
    if (danger.target) goTo(e, danger.target.x, danger.target.z, ENEMY.run, dt, { faceRate: 9 });
    else e.vel.set(0, 0, 0);
    return true;
  }

  /* One man changes the angle while another watches the threat. The
     bounding move is available only with recent contact, ammunition,
     morale and a reachable cover position; it is never a blind rush at
     the player's current coordinates. */
  function tryFlank(e) {
    if (!canLeave(e) || e.group === 'none' || e.reloadT > 0 || e.suppressed > 0.2 || e.pendingThrow || e.health < ENEMY.health * 0.35 || !e.lastKnown) return false;
    if (e.covering && e.covering.tacticalRole === 'flank' && G.time < e.coverUntil) return false;
    if (G.time - e.lastSeen > 2 || Math.hypot(e.lastKnown.x - e.pos.x, e.lastKnown.z - e.pos.z) < 11) return false;
    if ((manoeuvres.get(e.group) || 0) > G.time) return false;
    const support = enemies.find(o => o !== e && !o.dead && o.group === e.group && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 45 && o.state === 'combat' && o.sees && o.reloadT <= 0 && o.suppressed < 0.3 && Math.hypot(o.vel.x, o.vel.z) < 0.4 && (o.type === 'mg' || o.phase === 'peek' || o.phase === 'open'));
    if (!support) return false;
    const lk = e.lastKnown, py = threatHeight(lk) + 1.3;
    const candidates = coverNear(e.pos.x, e.pos.z, 20)
      .filter(c => (!c.taken || c.taken === e) && c !== e.cover)
      .map(c => ({ c, distance: Math.hypot(c.x - e.pos.x, c.z - e.pos.z), angle: flankAngle(e.pos, c, lk), range: Math.hypot(c.x - lk.x, c.z - lk.z) }))
      .filter(c => c.distance > 4 && c.angle > 0.24 && c.range > 10 && c.range < 45 && Math.hypot(c.c.x - e.home.x, c.c.z - e.home.z) < e.leash + 12)
      .sort((a, b) => (b.angle * 8 - b.distance * 0.35) - (a.angle * 8 - a.distance * 0.35));
    for (const { c } of candidates.slice(0, 8)) {
      if (G.world.clear(c.x, c.y + 0.95, c.z, lk.x, py, lk.z, SHOT)) continue;
      // Low cover must permit a shot on arrival; a wall corner must at
      // least face the threat, as in the ordinary cover selection.
      const facing = ((lk.x - c.x) * -c.nx + (lk.z - c.z) * -c.nz) / Math.hypot(lk.x - c.x, lk.z - c.z);
      if (facing < 0.35 || (c.low ? !G.world.clear(c.x, c.y + 1.55, c.z, lk.x, py, lk.z, SIGHT) : !cornerPeek(c, lk, py))) continue;
      const path = walkingPath(e, c.x, c.z);
      const end = path?.[path.length - 1];
      if (!end || Math.hypot(end.x - c.x, end.z - c.z) > 1.2) continue;
      if (e.cover) e.cover.taken = null;
      e.cover = c; c.taken = e;
      e.coverDeadline = G.time + Math.max(6, routeLength(e.pos, path) / ENEMY.run * 1.5 + 2);
      e.phase = 'move'; e.phaseTimer = 0; e.tacticalRole = 'flank';
      e.path = path; e.pathIdx = 0; e.pathGoalX = c.x; e.pathGoalZ = c.z; e.stuck = 0;
      manoeuvres.set(e.group, G.time + 10);
      support.covering = e; support.coverUntil = G.time + 6;
      return true;
    }
    return false;
  }

  /* Hold fire first; if a comrade stays in front, take a short, checked
     lateral step. This is only for a man already exposed in the open,
     never an instruction to leave shelter or abandon covering fire. */
  function clearFiringLane(e) {
    const lk = threatOf(e), range = Math.hypot(lk.x - e.pos.x, lk.z - e.pos.z);
    if (range < 3) return false;
    const dx = (lk.z - e.pos.z) / range, dz = -(lk.x - e.pos.x) / range;
    const muzzle = muzzleOf(e, new THREE.Vector3());
    const target = { x: lk.x, y: threatHeight(lk) + 1.2, z: lk.z };
    for (const side of e.id % 2 ? [-1, 1] : [1, -1]) {
      const x = e.pos.x + dx * side * 1.6, z = e.pos.z + dz * side * 1.6;
      if (Math.hypot(x - e.home.x, z - e.home.z) > e.leash + 4 || !finalStepsClear(e, x, z)) continue;
      const y = G.world.groundAt(x, z, e.pos.y, .45);
      const from = { x: muzzle.x + x - e.pos.x, y: muzzle.y + y - e.pos.y, z: muzzle.z + z - e.pos.z };
      if (friendlyInFireLane(e, from, target, enemies) || !G.world.clear(from.x, from.y, from.z, target.x, target.y, target.z, SHOT)) continue;
      e.laneStep = { x, z, until: G.time + 2.2 };
      e.aimTimer = Math.max(e.aimTimer, .2);
      e.burstLeft = 0;
      return true;
    }
    return false;
  }

  /* ---------- per type behaviour ---------- */

  function updateCombatRifle(e, dt) {
    const lk = threatOf(e);
    e.phaseTimer -= dt;
    e.suppressed = Math.max(0, e.suppressed - dt);
    e.grenadeCheck -= dt;
    if (e.laneStep) {
      const step = e.laneStep;
      if (G.time > step.until || e.suppressed > .5 || moveTowards(e, step.x, step.z, ENEMY.walk, dt, .12)) {
        e.laneStep = null; e.vel.set(0, 0, 0);
      }
      face(e, lk.x, lk.z, 7, dt);
      return;
    }
    if (e.phase === 'open' && !e.cover && e.fireLaneBlocked && e.sees && canLeave(e) && !e.covering && e.reloadT <= 0 && e.suppressed < .3) {
      e.laneBlockedFor += dt;
      if (e.laneBlockedFor > 1.2) { e.laneBlockedFor = 0; if (clearFiringLane(e)) return; }
    } else e.laneBlockedFor = 0;
    if (e.covering && (e.covering.dead || e.covering.tacticalRole !== 'flank' || G.time >= e.coverUntil)) e.covering = null;
    // The other half of the bound keeps watching until the mover is in
    // place. Suppression and reloading still take priority over this order.
    if (e.covering && e.phase === 'peek' && e.reloadT <= 0 && e.suppressed < 0.3) e.phaseTimer = Math.max(e.phaseTimer, 0.35);
    e.tacticTimer -= dt;
    if (e.tacticTimer <= 0 && e.phase !== 'move') {
      e.tacticTimer = 5 + R() * 3;
      tryFlank(e);
    }

    // dug in (trench, foxhole): no running about, just duck and pop up
    if (e.def.hold && (e.phase === 'move' || e.phase === 'open')) { e.phase = 'hide'; e.phaseTimer = 0.3 + R() * 0.9; }

    // choose / refresh cover
    if (e.phase === 'move') {
      if (!e.cover || G.time > e.coverDeadline) {
        if (e.cover && G.time > e.coverDeadline) e.rejectedCover.set(e.cover, G.time + 20);
        const c = findCover(e);
        if (e.cover) e.cover.taken = null;
        e.cover = c;
        if (c) c.taken = e;
        e.phaseTimer = 0;
        if (!c) { e.phase = 'open'; e.phaseTimer = 2 + R() * 2; }
      }
      if (e.cover) {
        e.stance = 'stand';
        const before = e.pathFails;
        if (goTo(e, e.cover.x, e.cover.z, ENEMY.run, dt, { faceRate: 8 })) {
          if (e.pathFails > before || Math.hypot(e.cover.x - e.pos.x, e.cover.z - e.pos.z) > 1.2) {
            // could not get there
            e.rejectedCover.set(e.cover, G.time + 20);
            e.cover.taken = null; e.cover = null; e.phase = 'open'; e.phaseTimer = 2;
          } else { e.phase = 'hide'; e.phaseTimer = 0.8 + R() * 1.2; }
          e.tacticalRole = null;
          e.path = null;
        }
      }
      return;
    }

    // cover compromised: the player can see us crouched
    if (e.cover && e.phase === 'hide' && e.sees && e.exposure >= 1 && e.stance === 'crouch' && R() < dt * 1.5) {
      e.phase = 'move';
      e.cover.taken = null; e.cover = null;
      return;
    }

    face(e, lk.x, lk.z, 7, dt);
    if (e.phase === 'hide') {
      e.stance = e.def.hold || (e.cover && e.cover.low) ? 'crouch' : 'stand';
      // High cover needs a real step around its corner. Returning to
      // shelter is a movement too, not just a pose change in the open.
      if (e.cover && !e.cover.low && Math.hypot(e.pos.x - e.cover.x, e.pos.z - e.cover.z) > 0.05) {
        moveTowards(e, e.cover.x, e.cover.z, ENEMY.walk * 1.3, dt, 0.03);
        return;
      }
      e.vel.set(0, 0, 0);
      // Top off a nearly spent magazine during a lull, already protected.
      if ((e.cover || e.def.hold) && !e.sees && G.time - e.lastSeen > 1.5 && e.reloadT <= 0 && e.mag > 0 && e.mag <= Math.floor(e.wdef.mag * 0.3)) {
        startReload(e); e.phaseTimer = Math.max(e.phaseTimer, e.reloadT + 0.3);
      }
      if (e.grenadeCheck <= 0) { e.grenadeCheck = 3 + R() * 2; if (tryGrenade(e)) { e.phaseTimer = 1.6; return; } }
      if (e.phaseTimer <= 0 && e.suppressed <= 0 && e.reloadT <= 0) {
        e.peekSpot = e.cover && !e.cover.low ? cornerPeek(e.cover, lk, threatHeight(lk) + 1.3) : null;
        if (e.cover && !e.cover.low && !e.peekSpot) {
          e.cover.taken = null; e.cover = null; e.phase = 'move'; e.path = null;
          return;
        }
        e.phase = 'peek';
        e.phaseTimer = 1.8 + R() * 2.2;
        e.aimTimer = e.reaction;
        e.burstLeft = 0;
      }
      return;
    }
    // peek / open: up and firing
    if (e.phase === 'peek' || e.phase === 'open') {
      e.stance = e.phase === 'open' && e.def.stance === 'crouch' ? 'crouch' : 'stand';
      if (e.phase === 'peek' && e.peekSpot && Math.hypot(e.pos.x - e.peekSpot.x, e.pos.z - e.peekSpot.z) > 0.15) {
        if (e.suppressed > 0.5 || e.reloadT > 0 || e.phaseTimer <= 0) { e.phase = 'hide'; e.phaseTimer = 1 + e.suppressed; return; }
        moveTowards(e, e.peekSpot.x, e.peekSpot.z, ENEMY.walk, dt, 0.1);
        return;
      }
      if (e.phase === 'open') {
        const order = assaultOrder(e);
        if (order && Math.hypot(e.pos.x - order.x, e.pos.z - order.z) > 24) {
          if (e.suppressed > .3) { order.boundUntil = 0; order.advanceAt = G.time + 1.5; }
          else if (e.reloadT <= 0 && G.time >= order.advanceAt) {
            if (!order.boundUntil) {
              // Move from shelter to shelter when it is available. A
              // reserve in a bare field still makes short bounds with
              // pauses to watch and fire, rather than staying home just
              // because it can see a distant target.
              const c = findCover(e);
              if (c && Math.hypot(c.x - order.x, c.z - order.z) < Math.hypot(e.pos.x - order.x, e.pos.z - order.z) - 2) {
                e.cover = c; c.taken = e; e.phase = 'move'; e.phaseTimer = 0; e.path = null;
                return;
              }
              order.boundUntil = G.time + 2.2;
            }
            if (G.time < order.boundUntil) {
              e.stance = 'stand';
              const arrived = goTo(e, order.x, order.z, ENEMY.run * .85, dt, { lookAt: lk, faceRate: 4 });
              if (!arrived) return;
            }
            order.boundUntil = 0; order.advanceAt = G.time + 1.8;
            e.path = null; e.vel.set(0, 0, 0); e.aimTimer = Math.max(e.aimTimer, .25);
          }
        }
        // drift around a little in the open
        if (!e.target || e.phaseTimer < 0) {
          e.target = { x: e.pos.x + (R() - 0.5) * 4, z: e.pos.z + (R() - 0.5) * 4 };
          const near = e.leash > 0 && Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z) < e.leash + 6;
          const h = near ? e.home : e.pos;
          if (Math.hypot(e.target.x - h.x, e.target.z - h.z) > Math.max(4, e.leash)) e.target = { x: h.x, z: h.z };
          // a step aside he can take: not into a wall, a hedge or a trench side
          if (!reachable(e, e.target.x, e.target.z)) e.target = { x: e.pos.x, z: e.pos.z };
          e.phaseTimer = 2.5 + R() * 2;
          if (R() < 0.4) { e.phase = 'move'; e.cover = null; return; }
        }
        if (e.sees) e.vel.set(0, 0, 0);
        else {
          moveTowards(e, e.target.x, e.target.z, ENEMY.walk, dt);
          // blocked after all: stand and fire from here rather than lean on it
          if (Math.hypot(e.vel.x, e.vel.z) < ENEMY.walk * 0.2) { e.target = { x: e.pos.x, z: e.pos.z }; e.vel.set(0, 0, 0); }
        }
      } else e.vel.set(0, 0, 0);
      if (e.suppressed > 0.5 && e.cover) { e.phase = 'hide'; e.phaseTimer = e.suppressed + 0.5; return; }
      if (e.reloadT > 0) {
        // out of ammunition: down behind cover while reloading
        if (e.cover || e.def.hold) { e.phase = 'hide'; e.phaseTimer = e.reloadT + 0.3; }
      } else if (e.sees || G.time - e.lastSeen < 1.5) {
        e.aimTimer -= dt;
        if (e.aimTimer <= 0) {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            if (e.burstLeft <= 0) {
              const b = e.wdef.burst;
              e.burstLeft = Array.isArray(b) ? Math.round(lerp(b[0], b[1], R())) : b;
            }
            if (shoot(e)) {
              e.burstLeft--;
              e.fireTimer = e.burstLeft > 0 ? e.wdef.interval : (e.type === 'smg' ? 0.6 + R() * 0.8 : e.wdef.interval * (0.8 + R() * 0.6));
            } else e.fireTimer = 0.18;
          }
        }
      } else {
        e.aimTimer = e.reaction * 0.6;
      }
      if (e.phase === 'peek' && e.phaseTimer <= 0) {
        const order = assaultOrder(e);
        if (order && Math.hypot(e.pos.x - order.x, e.pos.z - order.z) > 26 && e.reloadT <= 0 && e.suppressed < .3 && !e.covering) {
          // Firing from the first wall is a pause in an assault, not its
          // destination. Resume towards the order after this fire cycle.
          if (e.cover) e.cover.taken = null;
          e.cover = null; e.peekSpot = null; e.path = null;
          e.phase = 'move'; e.phaseTimer = 0;
        } else {
          e.phase = 'hide';
          e.phaseTimer = 1.0 + R() * 1.6 + e.suppressed;
        }
      }
      // lost him: some go and look, some wait for him where he was heading
      if (canLeave(e)) {
        const gi = localIntel(e);
        const ago = G.time - Math.max(e.lastSeen, e.lastContact, gi ? gi.t : -99);
        if (ago > e.patience) lostContact(e, gi);
      }
    }
  }

  function updateMG(e, dt) {
    e.suppressed = Math.max(0, e.suppressed - dt);
    const lk = threatOf(e);
    const want = Math.atan2(lk.x - e.pos.x, lk.z - e.pos.z);
    const base = e.mg ? e.mg.baseYaw : e.home.yaw;
    const arc = e.mg ? e.mg.arc : 1;
    const rel = clamp(wrapAngle(want - base), -arc, arc);
    e.yaw = dampAngle(e.yaw, base + rel, 2.2, dt);
    if (e.mg) e.mg.mesh.rotation.y = e.yaw;
    e.stance = e.suppressed > 0.6 ? 'crouch' : 'stand';
    const inArc = Math.abs(wrapAngle(want - base)) <= arc + 0.1;
    const recent = G.time - e.lastSeen < 2.5;
    if (e.reloadT > 0) { e.stance = 'crouch'; return; }
    if ((e.sees || recent) && inArc && e.suppressed < 0.6 && Math.abs(wrapAngle(want - e.yaw)) < 0.25) {
      e.aimTimer -= dt;
      if (e.aimTimer > 0) return;
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        if (e.burstLeft <= 0) e.burstLeft = Math.round(lerp(e.wdef.burst[0], e.wdef.burst[1], R()));
        if (shoot(e)) {
          e.burstLeft--;
          e.fireTimer = e.burstLeft > 0 ? e.wdef.interval : 0.9 + R() * 1.1;
        } else e.fireTimer = 0.18;
      }
    } else e.aimTimer = Math.max(e.aimTimer, 0.4);
  }

  /* ---------- walking somewhere ---------- */

  /* Along a path on the walk grid to (tx, tz), looking where he goes or at
     `lookAt`. True on arrival — or when the way is blocked for good. */
  function goTo(e, tx, tz, speed, dt, { lookAt = null, faceRate = 6 } = {}) {
    if (!e.path || e.pathGoalX !== tx || e.pathGoalZ !== tz) {
      const path = walkingPath(e, tx, tz, true);
      // no way round on the walk grid: straight there only if nothing stands in the way, else
      // give up on it now (walking at a wall until the stuck timer notices looked broken)
      if (!path && !reachable(e, tx, tz)) {
        e.path = null; e.pathFails++; e.vel.set(0, 0, 0);
        return true;
      }
      e.path = path || [{ x: tx, z: tz }];
      e.pathIdx = 0; e.pathGoalX = tx; e.pathGoalZ = tz; e.stuck = 0;
    }
    const wp = e.path[Math.min(e.pathIdx, e.path.length - 1)];
    if (!wp) return true;
    const last = e.pathIdx >= e.path.length - 1;
    const exactGoal = Math.hypot(wp.x - tx, wp.z - tz) < 0.05;
    const there = moveTowards(e, wp.x, wp.z, speed, dt, last && exactGoal ? 0.12 : 0.25);
    const d = Math.hypot(wp.x - e.pos.x, wp.z - e.pos.z);
    if (lookAt) face(e, lookAt.x, lookAt.z, faceRate, dt); else if (d > 0.3) face(e, wp.x, wp.z, faceRate, dt);
    // Cutting a corner a metre before the waypoint can put the next leg
    // straight through a wall. Advance early only with a clear next leg.
    const next = e.path[e.pathIdx + 1];
    if (!last && (d < 0.4 || d < 1.1 && nav.lineClear(e.pos.x, e.pos.z, next.x, next.z))) e.pathIdx++;
    // not getting anywhere: a fresh path, and after a few tries give up on it
    if (e.pos.distanceToSquared(e.lastPos) < (speed * dt * 0.15) ** 2) e.stuck += dt; else e.stuck = Math.max(0, e.stuck - dt * 0.5);
    if (e.stuck > 1.5) {
      e.stuck = 0; e.path = null;
      if (++e.pathFails > 2) { e.pathFails = 0; return true; }
    }
    // The 2 m nav grid may end at the nearest cell beside a wall even
    // though the authored cover spot is on clear footing just beyond
    // that cell. Walk the last couple of steps using the collision world
    // instead of declaring arrival short and abandoning good cover.
    if (last && (there || d < 0.6)) {
      const left = Math.hypot(tx - e.pos.x, tz - e.pos.z);
      if (left > 0.6 && left < 2.5 && finalStepsClear(e, tx, tz)) {
        e.path = [{ x: tx, z: tz }]; e.pathIdx = 0;
        return false;
      }
    }
    return last && (exactGoal ? there || d < 0.18 : there || d < 0.6);
  }

  function finalStepsClear(e, x, z) {
    return stepsClear(e.pos, x, z);
  }

  function stepsClear(from, x, z) {
    const distance = Math.hypot(x - from.x, z - from.z);
    const steps = Math.max(1, Math.ceil(distance / 0.35));
    let y = from.y;
    for (let i = 1; i <= steps; i++) {
      const px = from.x + (x - from.x) * i / steps, pz = from.z + (z - from.z) * i / steps;
      const ground = G.world.groundAt(px, pz, y, 0.45);
      if (Math.abs(ground - y) > 0.45 || G.world.tooDeep(px, pz, 0.9, ground)) return false;
      const point = { x: px, y: ground, z: pz };
      G.world.pushOut(point, ENEMY.radius, ground, 1.7, 0.45);
      if (Math.hypot(point.x - px, point.z - pz) > 0.03) return false;
      y = ground;
    }
    return true;
  }

  /* Cover often sits between the 2 m walk-grid centres. Connect it from
     a nearby clear cell with actual body-sized steps; never accept a
     snapped endpoint on the wrong side of the obstacle being used. */
  function walkingPath(e, x, z, partial = false, repairStart = true) {
    // A nearby clear point does not need a trip out to a coarse grid
    // centre and back. In particular, already standing in corner shelter
    // must not send him a metre into the open before declaring arrival.
    if (Math.hypot(x - e.pos.x, z - e.pos.z) < 4 && finalStepsClear(e, x, z)) return [{ x, z }];
    const path = nav.findPath(e.pos.x, e.pos.z, x, z);
    // A post can stand on clear ground inside an otherwise blocked grid
    // cell. Its snapped start may be across a sandbag bank. Check the
    // first leg as a body, then join from this side of the obstacle.
    const first = path?.[0];
    if (first && !stepsClear(e.pos, first.x, first.z)) {
      if (!repairStart) return null;
      const starts = walkJoins(e.pos.x, e.pos.z).filter(q => stepsClear(e.pos, q.x, q.z));
      starts.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      for (const q of starts.slice(0, 4)) {
        const route = walkingPath({ pos: { ...q, y: nav.height(q.x, q.z) ?? e.pos.y } }, x, z, partial, false);
        if (route) return [q, ...route];
      }
      return null;
    }
    const end = path?.[path.length - 1];
    if (end) {
      const left = Math.hypot(end.x - x, end.z - z);
      if (left < 0.05) return path;
      if (left < 3 && stepsClear({ x: end.x, y: nav.height(end.x, end.z) ?? e.pos.y, z: end.z }, x, z)) return [...path, { x, z }];
    }
    // A narrow point may be nearest to the cell in front of its wall.
    // Try the surrounding centres on the correct side, in distance order.
    const joins = walkJoins(x, z).filter(q => stepsClear({ ...q, y: nav.height(q.x, q.z) ?? e.pos.y }, x, z));
    joins.sort((a, b) => Math.hypot(a.x - e.pos.x, a.z - e.pos.z) - Math.hypot(b.x - e.pos.x, b.z - e.pos.z));
    for (const q of joins) {
      const route = nav.findPath(e.pos.x, e.pos.z, q.x, q.z, 4000);
      const last = route?.[route.length - 1];
      if (last && Math.hypot(last.x - q.x, last.z - q.z) < 0.1 && stepsClear(e.pos, route[0].x, route[0].z)) return [...route, { x, z }];
    }
    // Search orders may end at the nearest reachable point rather than
    // walk into a house or into deep water. Cover selection checks that
    // this partial route actually reaches the requested shelter.
    return partial ? path : null;
  }

  function walkJoins(x, z) {
    const joins = [], seen = new Set();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const q = nav.nearest(x + Math.sin(a) * 2.1, z + Math.cos(a) * 2.1, 1);
      if (!q || seen.has(q.x + ',' + q.z) || Math.hypot(q.x - x, q.z - z) > 3.4) continue;
      seen.add(q.x + ',' + q.z);
      joins.push(q);
    }
    return joins;
  }

  function routeLength(from, route) {
    let length = 0, previous = from;
    for (const point of route) { length += Math.hypot(point.x - previous.x, point.z - previous.z); previous = point; }
    return length;
  }

  /* Can he walk straight from where he stands to (x, z)? Nothing solid across the line at his
     knees or his chest, and footing at the far end. */
  function reachable(e, x, z) {
    if (!nav.walkable(x, z)) return false;
    const y = e.pos.y;
    return G.world.clear(e.pos.x, y + 0.5, e.pos.z, x, y + 0.5, z, MOVE) && G.world.clear(e.pos.x, y + 1.3, e.pos.z, x, y + 1.3, z, MOVE);
  }

  /* Looking round from where he stands: sweeping either side of `base`. */
  function scanAround(e, base, dt, width = 1.0) {
    e.scanPhase += dt;
    e.yaw = dampAngle(e.yaw, base + Math.sin(e.scanPhase * 1.1) * width, 2.5, dt);
  }

  /* ---------- posts and patrols ---------- */

  function nearestPatrolIdx(e) {
    let best = 0, bd = Infinity;
    e.patrol.forEach(([x, z], i) => { const d = (x - e.pos.x) ** 2 + (z - e.pos.z) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  function updateIdle(e, dt) {
    if (e.alertAt > 0 && G.time >= e.alertAt) { e.alertAt = -1; enterCombat(e); return; }
    const wary = G.time < e.waryUntil;
    if (e.state === 'alert') {
      e.awareness = Math.max(0, e.awareness - dt * 0.04);
      const lk = e.lastKnown;
      // heard something: into cover facing it, rifle up
      if (e.alertCover && lk && canLeave(e)) {
        if (!e.cover) { const c = findCover(e); e.cover = c; if (c) c.taken = e; else e.alertCover = false; e.path = null; }
        if (e.cover && Math.hypot(e.cover.x - e.pos.x, e.cover.z - e.pos.z) > 0.6) {
          e.stance = 'stand';
          if (goTo(e, e.cover.x, e.cover.z, ENEMY.run * 0.8, dt)) e.path = null;
          return;
        }
        e.stance = e.cover && e.cover.low ? 'crouch' : 'stand';
      }
      e.vel.set(0, 0, 0);
      if (lk) scanAround(e, Math.atan2(lk.x - e.pos.x, lk.z - e.pos.z), dt, 0.35);
      if (e.awareness < 0.2) {
        if (e.cover) { e.cover.taken = null; e.cover = null; }
        e.alertCover = false;
        e.waryUntil = G.time + 45;
        e.state = 'return';
      }
      return;
    }
    e.awareness = Math.max(0, e.awareness - dt * 0.08);
    e.stance = 'stand';
    if (e.state === 'patrol' && e.patrol) {
      if (e.patrolWait > 0) {
        // a pause at the end of each leg: a look round
        e.patrolWait -= dt;
        e.vel.set(0, 0, 0);
        scanAround(e, e.patrolLook ?? e.yaw, dt, 0.9);
        return;
      }
      const [tx, tz] = e.patrol[e.patrolIdx];
      if (goTo(e, tx, tz, ENEMY.walk * (wary ? 0.95 : 0.8), dt, { faceRate: 4 })) {
        e.patrolLook = e.yaw;
        e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
        e.patrolWait = 2.5 + R() * 3;
        e.path = null;
      }
      return;
    }
    // standing guard: back at the post, looking round a little
    e.vel.set(0, 0, 0);
    if (e.type !== 'mg' && Math.hypot(e.home.x - e.pos.x, e.home.z - e.pos.z) > 0.6) {
      if (goTo(e, e.home.x, e.home.z, ENEMY.walk, dt)) e.path = null;
      return;
    }
    const look = e.home.yaw + Math.sin(G.time * 0.21 + e.home.x) * (wary ? 0.9 : 0.5);
    e.yaw = dampAngle(e.yaw, look, 0.8, dt);
    if (e.mg) e.mg.mesh.rotation.y = e.yaw;
  }

  /* Back to the post or onto the patrol route after a search. */
  function updateReturn(e, dt) {
    e.stance = 'stand';
    e.awareness = Math.max(0, e.awareness - dt * 0.05);
    const to = e.patrol ? (() => { const [x, z] = e.patrol[nearestPatrolIdx(e)]; return { x, z }; })() : e.home;
    if (goTo(e, to.x, to.z, ENEMY.walk, dt)) {
      e.path = null;
      if (e.patrol) { e.state = 'patrol'; e.patrolIdx = nearestPatrolIdx(e); e.patrolWait = 1.5; }
      else e.state = 'idle';
    }
  }

  /* ---------- looking for him ---------- */

  /* `reason`: 'investigate' (a sound), 'search' (where he was last seen),
     'body' (the man who shot him, making sure). */
  function startSearch(e, x, z, { reason = 'search', sweeps = 3, heading = null, listen = 0 } = {}) {
    if (e.cover) { e.cover.taken = null; e.cover = null; }
    e.state = 'search';
    e.srch = { x, z, reason, sweeps, heading, phase: listen > 0 ? 'listen' : 'approach', timer: listen > 0 ? listen : 45, points: null, idx: 0, scanBase: e.yaw };
    e.path = null; e.stuck = 0; e.pathFails = 0;
    e.alertCover = false;
    e.awareness = Math.max(e.awareness, 0.55);
  }

  function endSearch(e) {
    e.srch = null; e.path = null;
    e.waryUntil = G.time + 60;
    e.awareness = 0.3;
    e.state = 'return';
  }

  /* A few spots round the place to look behind: walkable, within reach of
     the post, towards where he was heading when there is a heading, and
     preferably out of sight from the place itself (round a corner). */
  function sweepPoints(e, s) {
    if (s.sweeps <= 0) return [];
    const cands = [];
    const base = s.heading ? Math.atan2(s.heading.x, s.heading.z) : R() * Math.PI * 2;
    const spread = s.heading ? 1.3 : Math.PI;
    const y0 = (nav.height(s.x, s.z) ?? e.pos.y) + 1.5;
    for (let i = 0; i < 14; i++) {
      const a = base + (R() * 2 - 1) * spread, r = 6 + R() * 9;
      const x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r;
      if (!nav.walkable(x, z) || Math.hypot(x - e.home.x, z - e.home.z) > e.leash + 45) continue;
      const y = (nav.height(x, z) ?? y0) + 1.5;
      const hidden = !G.world.clear(s.x, y0, s.z, x, y, z, SIGHT);
      cands.push({ x, z, score: (hidden ? 3 : 0) - Math.abs(a - base) * 0.5 + R() });
    }
    cands.sort((a, b) => b.score - a.score);
    const out = [];
    for (const c of cands) {
      if (out.length >= s.sweeps) break;
      if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 5)) out.push(c);
    }
    return out;
  }

  function updateSearch(e, dt) {
    const s = e.srch;
    if (!s) { endSearch(e); return; }
    s.timer -= dt;
    e.stance = 'stand';
    switch (s.phase) {
      case 'listen':
        // stop, listen, turn to the sound
        e.vel.set(0, 0, 0);
        face(e, s.x, s.z, 4, dt);
        if (s.timer <= 0) { s.phase = 'approach'; s.timer = 45; }
        break;
      case 'approach': {
        const d = Math.hypot(s.x - e.pos.x, s.z - e.pos.z);
        const stop = s.reason === 'investigate' ? 4.5 : s.reason === 'body' ? 2.2 : 1.5;
        // hurry while far from where he was seen, then slow down, rifle up
        const speed = (s.reason === 'search' || s.reason === 'assault') && d > 18 ? ENEMY.run * 0.8 : ENEMY.walk * 1.1;
        if (d < stop || goTo(e, s.x, s.z, speed, dt) || s.timer <= 0) {
          s.phase = 'look'; s.timer = 2 + R() * 2;
          s.scanBase = d > 0.5 ? Math.atan2(s.x - e.pos.x, s.z - e.pos.z) : e.yaw;
          e.vel.set(0, 0, 0); e.path = null;
        }
        break;
      }
      case 'look':
        e.vel.set(0, 0, 0);
        scanAround(e, s.scanBase, dt);
        if (s.timer <= 0) {
          if (!s.points) s.points = sweepPoints(e, s);
          if (s.idx < s.points.length) { s.phase = 'sweep'; s.timer = 25; }
          else endSearch(e);
        }
        break;
      case 'sweep': {
        const q = s.points[s.idx];
        if (goTo(e, q.x, q.z, ENEMY.walk * 1.1, dt) || s.timer <= 0) {
          s.idx++;
          s.phase = 'look'; s.timer = 1.5 + R() * 1.5; s.scanBase = e.yaw;
          e.vel.set(0, 0, 0); e.path = null;
        }
        break;
      }
    }
  }

  /* Where he is likely heading: the way he was last seen moving, followed
     on the walk grid round whatever is in the way (as he would walk it),
     some 10-24 m on (null when he stood still). */
  function predictPath(gi) {
    if (!gi) return null;
    const sp = Math.hypot(gi.vx, gi.vz);
    if (sp < 1.2) return null;
    const dx = gi.vx / sp, dz = gi.vz / sp;
    const ahead = clamp(sp * 5, 10, 24);
    const path = nav.findPath(gi.x, gi.z, gi.x + dx * ahead * 1.3, gi.z + dz * ahead * 1.3, 4000);
    if (!path) return null;
    let px = gi.x, pz = gi.z, left = ahead;
    for (const q of path) {
      const seg = Math.hypot(q.x - px, q.z - pz);
      if (seg >= left) { px += ((q.x - px) / seg) * left; pz += ((q.z - pz) / seg) * left; break; }
      left -= seg; px = q.x; pz = q.z;
    }
    if (Math.hypot(px - gi.x, pz - gi.z) < 6) return null;
    return { x: px, z: pz, dx, dz, from: { x: gi.x, z: gi.z } };
  }

  /* Cover from which to watch where he is heading: ahead of him and off his
     line, hiding a crouching man from that point. From low cover he rises
     to look over it; from a wall corner he steps out past the corner (the
     `peek` spot) — either way he must then see the spot. */
  function findAmbush(e, pred) {
    const py = (nav.height(pred.x, pred.z) ?? G.world.groundAt(pred.x, pred.z, 1e4, 0.5)) + 1.2;
    let best = null, bestScore = -Infinity, tests = 0;
    for (const c of coverNear(pred.x, pred.z, 26)) {
      if (c.taken && c.taken !== e) continue;
      const toP = Math.hypot(pred.x - c.x, pred.z - c.z);
      if (toP < 8 || toP > 26) continue;
      if (Math.hypot(c.x - e.home.x, c.z - e.home.z) > e.leash + 40) continue;
      const facing = ((pred.x - c.x) * -c.nx + (pred.z - c.z) * -c.nz) / toP;
      if (facing < 0.3) continue;
      const along = (c.x - pred.from.x) * pred.dx + (c.z - pred.from.z) * pred.dz;
      if (along < 2) continue;                                    // not behind him
      if (++tests > 36) break;
      if (G.world.clear(c.x, c.y + 0.95, c.z, pred.x, py, pred.z, SHOT)) continue;
      let peek = null;
      if (c.low) {
        if (!G.world.clear(c.x, c.y + 1.55, c.z, pred.x, py + 0.3, pred.z, SIGHT)) continue;
      } else {
        for (const sgn of [1, -1]) {
          const x = c.x - c.nz * 0.9 * sgn, z = c.z + c.nx * 0.9 * sgn;
          if (!nav.walkable(x, z) || !G.world.clear(c.x, c.y + 1.2, c.z, x, c.y + 1.2, z, MOVE)) continue;
          if (G.world.clear(x, c.y + 1.55, z, pred.x, py + 0.3, pred.z, SIGHT)) { peek = { x, z }; break; }
        }
        if (!peek) continue;
      }
      const side = Math.abs((c.x - pred.from.x) * pred.dz - (c.z - pred.from.z) * pred.dx);
      const dMe = Math.hypot(c.x - e.pos.x, c.z - e.pos.z);
      const score = -dMe * 0.25 + Math.min(side, 12) * 0.3 + facing * 2 - Math.abs(toP - 16) * 0.12 + Math.min(along, 12) * 0.15;
      if (score > bestScore) { bestScore = score; best = { c, peek }; }
    }
    return best;
  }

  function startAmbush(e, pred, spot) {
    const c = spot.c;
    if (e.cover && e.cover !== c) e.cover.taken = null;
    e.cover = c; c.taken = e;
    e.state = 'ambush';
    e.amb = { x: pred.x, z: pred.z, phase: 'move', timer: 30 + R() * 20, peekSpot: spot.peek };
    e.path = null; e.stuck = 0; e.pathFails = 0;
  }

  function updateAmbush(e, dt) {
    const a = e.amb;
    a.timer -= dt;
    if (a.phase === 'move') {
      e.stance = 'stand';
      const before = e.pathFails;
      if (goTo(e, e.cover.x, e.cover.z, ENEMY.run, dt)) {
        e.path = null;
        if (e.pathFails > before) { endAmbush(e); return; }
        a.phase = 'wait';
      }
      return;
    }
    // crouched behind the cover, rifle on the place he will come through,
    // every few seconds rising over it (or stepping out past the corner)
    // to look
    a.peek = (a.peek ?? 1.5 + R() * 2) - dt;
    if (a.peek < -1.4) a.peek = 2.5 + R() * 2.5;
    const looking = a.peek <= 0;
    const at = looking && a.peekSpot ? a.peekSpot : e.cover;
    if (Math.hypot(at.x - e.pos.x, at.z - e.pos.z) > 0.15) {
      moveTowards(e, at.x, at.z, ENEMY.walk, dt);
      if (Math.hypot(e.vel.x, e.vel.z) < ENEMY.walk * 0.2) e.vel.set(0, 0, 0);
    } else e.vel.set(0, 0, 0);
    e.stance = looking || !e.cover.low ? (a.peekSpot && !looking ? 'crouch' : 'stand') : 'crouch';
    face(e, a.x, a.z, 4, dt);
    if (a.timer <= 0) endAmbush(e);
  }

  function endAmbush(e) {
    const a = e.amb;
    if (e.cover) { e.cover.taken = null; e.cover = null; }
    e.amb = null;
    startSearch(e, a.x, a.z, { reason: 'search', sweeps: 2 });
  }

  /* Contact lost for longer than his patience. The group splits the work:
     up to two search where he was last seen, up to two wait in ambush
     along his way (when he was moving), the rest hold their cover. */
  function lostContact(e, gi) {
    const order = assaultOrder(e);
    if (order && Math.hypot(e.pos.x - order.x, e.pos.z - order.z) > 12) {
      startSearch(e, order.x, order.z, { reason: 'assault', sweeps: 1 });
      return;
    }
    const useReport = gi && gi.t >= e.lastContact;
    const lk = useReport ? { x: gi.x, y: gi.y, z: gi.z } : e.lastKnown;
    if (!lk) return;
    let searching = 0, waiting = 0;
    for (const o of enemies) {
      if (o === e || o.dead || o.group !== e.group || e.group === 'none' || Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > 60) continue;
      if (o.state === 'search') searching++;
      else if (o.state === 'ambush') waiting++;
    }
    const pred = predictPath(useReport ? gi : null);
    if (pred && waiting < 2 && (searching >= 1 || R() < 0.4)) {
      const c = findAmbush(e, pred);
      if (c) { startAmbush(e, pred, c); return; }
    }
    if (searching < 2) {
      startSearch(e, lk.x, lk.z, { reason: 'search', sweeps: 3, heading: pred ? { x: pred.dx, z: pred.dz } : null });
      return;
    }
    e.patience += 8 + R() * 6;          // enough of us out there: keep watching from here
  }

  /* ---------- animation ---------- */

  function animate(e, dt) {
    const ch = e.char;
    e.shotRecoil = damp(e.shotRecoil, 0, 18, dt);
    const speed = Math.hypot(e.vel.x, e.vel.z);
    let move;
    const crouch = e.stance === 'crouch';
    if (crouch) move = speed > 0.3 ? 'crouch_walk' : 'crouch_idle';
    else if (speed < 0.3) move = 'idle';
    else if (speed > 3) move = 'run';
    else {
      const mv = Math.atan2(e.vel.x, e.vel.z) - e.yaw;
      const f = Math.cos(mv), s = Math.sin(mv);
      if (f > 0.5) move = 'walk'; else if (f < -0.5) move = 'walk_back'; else move = s > 0 ? 'strafe_l' : 'strafe_r';
    }
    const gait = GAIT[move] ? clamp(speed / GAIT[move], 0.6, 2.6) : 1;
    // his steps: on the cobbles a patrol carries
    if (speed > 0.5) {
      e.stepAcc = (e.stepAcc || 0) + dt * speed / (speed > 3 ? 1.6 : 1.2);
      if (e.stepAcc > 1) {
        e.stepAcc = 0;
        G.audio.footstep(e.pos.x, e.pos.y, e.pos.z, G.world.surfaceUnder(e.pos.x, e.pos.y, e.pos.z), crouch ? 0.5 : speed > 3 ? 1.1 : 0.8, false, { run: speed > 3, wet: G.shared.wet.value });
      }
    }
    const firing = e.state === 'combat' && (e.phase === 'peek' || e.phase === 'open' || e.type === 'mg') && speed < 3;
    // looking for him, waiting for him, or wary after a scare: rifle up
    const ready = (e.state === 'search' && e.srch?.reason !== 'body') || e.state === 'ambush' || e.state === 'alert' ||
      (G.time < e.waryUntil && e.state !== 'idle');
    let upper = firing || (ready && speed < 3) ? (crouch ? 'crouch_aim' : 'aim') : move;
    if (e.type === 'mg') {
      // Lean square over the mounted gun; its grip anchors pose both arms.
      // The full crouch puts the shoulders below this chest-high mount,
      // while a rifle's bladed aiming pose twists them away from the stock.
      ch.mountedGrip = !crouch;
      move = crouch ? 'crouch_idle' : e.mg && e.mg.y - e.pos.y < 1 ? 'mg_ready' : 'idle';
      upper = 'crouch_idle';
      if (e.mg) {
        e.mg.mesh.updateMatrixWorld(true);
        // Traverse about the bipod together, keeping the gunner behind the
        // stock instead of leaving him planted as the gun swings away.
        e.pos.copy(e.mg.gunner).applyMatrix4(e.mg.mesh.matrixWorld);
      }
    }
    ch.animate(move, upper, gait);
    if (firing && e.lastKnown && !e.mg) {
      const dy = (threatHeight(e.lastKnown) + 1.2) - (e.pos.y + 1.4);
      const dh = Math.hypot(e.lastKnown.x - e.pos.x, e.lastKnown.z - e.pos.z);
      ch.aimPitch = clamp(Math.atan2(dy, dh), -0.8, 0.8);
    } else ch.aimPitch = 0;
    if (!e.mg) ch.aimPitch += e.shotRecoil;
    ch.root.position.copy(e.pos);
    ch.root.rotation.y = e.yaw;
    // out of view and not close: the skeleton is posed five times a second
    // (the body still moves every frame, so muzzle flashes and tracers start
    // where he stands)
    e.animAcc = (e.animAcc || 0) + dt;
    if (!e.inView && e.dCam > 30 && e.animAcc < 0.2) return;
    ch.update(e.animAcc, e.fixedY != null ? e.fixedY : G.world.groundAt(e.pos.x, e.pos.z, e.pos.y + 0.2));
    e.animAcc = 0;
  }

  /* Is the soldier in the camera's view? A sphere round the body (wider for
     the dead, whose ragdoll can lie a couple of metres from where he fell). */
  const frustum = new THREE.Frustum(), projView = new THREE.Matrix4(), sphere = new THREE.Sphere();
  function inView(e) {
    const p = e.char.ragdoll ? e.char.ragdoll.pelvis : e.pos;
    sphere.center.set(p.x, (e.char.ragdoll ? p.y : e.pos.y + 1.0), p.z);
    sphere.radius = e.dead ? 2.4 : 1.6;
    return frustum.intersectsSphere(sphere);
  }

  /* ---------- frame ---------- */

  function update(dt) {
    const p = G.player;
    const cam = G.camera.position;
    const aware = [];
    G.camera.updateMatrixWorld();
    projView.multiplyMatrices(G.camera.projectionMatrix, G.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    for (const e of enemies) {
      const dCam = Math.hypot(e.pos.x - cam.x, e.pos.z - cam.z);
      const dPl = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      e.dCam = dCam;
      // drawn only when in view and inside the fog; the low-detail mesh from LOD_FAR
      e.inView = dCam < 220 && inView(e);
      e.char.root.visible = e.inView;
      e.char.setDistance(Math.hypot(e.pos.x - cam.x, e.pos.y - cam.y, e.pos.z - cam.z) * (G.lodScale ?? 1));
      if (e.dead) {
        // a falling body keeps falling out of view; it comes to rest in seconds
        if (dCam < 220 && (e.inView || (e.char.ragdoll && !e.char.ragdoll.asleep))) e.char.update(dt, e.fixedY ?? G.world.groundAt(e.pos.x, e.pos.z, e.pos.y + 0.2));
        e.char.shadow.visible = e.inView;
        continue;
      }
      // A reload already in progress must complete even when the player
      // leaves this encounter; otherwise its actor-owned sound stays queued.
      if (e.reloadT > 0) reloadSteps(e, dt);
      e.active = dPl < 170;
      if (!e.active) { e.char.shadow.visible = false; continue; }
      e.lastPos.copy(e.pos);
      receiveContact(e);
      e.perceiveTimer -= dt;
      if (e.perceiveTimer <= 0) {
        const step = 0.12;
        perceive(e, step - e.perceiveTimer);
        e.perceiveTimer = step;
      }
      const avoiding = updateDanger(e, dt);
      updateThrow(e, dt);
      if (avoiding) { /* survival overrides a firing or patrol order */ }
      else if (e.state === 'combat') {
        if (e.type === 'mg') updateMG(e, dt);
        else updateCombatRifle(e, dt);
      } else if (e.state === 'search') updateSearch(e, dt);
      else if (e.state === 'ambush') updateAmbush(e, dt);
      else if (e.state === 'return') updateReturn(e, dt);
      else updateIdle(e, dt);
      if (e.fixedY != null) e.pos.y = e.fixedY;
      if (dCam < 220) animate(e, dt);
      if (!e.inView) e.char.shadow.visible = false;
      // awareness hint for the HUD
      if ((e.state === 'alert' || (e.state !== 'combat' && e.state !== 'ambush' && e.awareness > 0.15)) && dPl < 70) {
        const ang = wrapAngle(Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - G.rig.yaw);
        aware.push({ angle: ang, level: clamp(e.awareness, 0, 1), alert: false, d: dPl });
      } else if (e.state === 'combat' && e.sees && dPl < 60 && e.type === 'mg') {
        const ang = wrapAngle(Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - G.rig.yaw);
        aware.push({ angle: ang, level: 1, alert: true, d: dPl });
      }
    }
    aware.sort((a, b) => a.d - b.d);
    G.hud.awareness(aware);
  }

  /* Back to their posts after the player respawns (the dead stay dead). */
  function resetLiving() {
    for (const e of enemies) {
      if (e.dead) continue;
      e.pos.set(e.home.x, e.fixedY ?? G.world.groundAt(e.home.x, e.home.z, 1e4, 0.5), e.home.z);
      e.yaw = e.home.yaw;
      e.state = e.patrol ? 'patrol' : 'idle';
      e.awareness = 0; e.lastKnown = null; e.contact = null; e.pendingContact = null; e.reportTimer = 0; e.lastSeen = -99; e.lastContact = -99; e.alertAt = -1;
      if (e.cover) { e.cover.taken = null; e.cover = null; }
      e.phase = 'hide'; e.suppressed = 0; e.shotRecoil = 0; e.vel.set(0, 0, 0); e.health = ENEMY.health * (e.def.tough || 1);
      e.mag = e.wdef.mag || 30; e.reloadT = 0; e.reloadRun?.end(); e.reloadRun = null; e.char.holdLeft(null);
      e.reloadAudio?.cancel(); e.reloadAudio = null;
      e.srch = null; e.amb = null; e.path = null; e.alertCover = false; e.waryUntil = -1; e.patrolIdx = 0; e.patrolWait = 0;
      e.rejectedCover.clear();
      e.danger = null; e.heardGrenade = null; e.pendingThrow = null; e.peekSpot = null; e.tacticalRole = null; e.covering = null; e.coverUntil = -1; e.fireLaneBlocked = false; e.tacticTimer = 7 + R() * 4;
      e.laneStep = null; e.laneBlockedFor = 0;
      e.order = null; e.leash = e.def.hold ? 0 : e.def.leash ?? (e.type === 'mg' ? 0 : 18);
      if (e.mg) e.mg.mesh.rotation.y = e.mg.baseYaw;
    }
    intel.clear();
    manoeuvres.clear();
  }

  /* A group sent to (x, z) (a counter-attack, mission.js): each living man goes to look there,
     into combat as soon as he sees the player. */
  function send(group, x, z) {
    for (const e of enemies) {
      if (e.dead || e.group !== group || !canLeave(e)) continue;
      e.leash = Math.max(e.leash, 60);
      e.order = { x: x + (R() - 0.5) * 8, z: z + (R() - 0.5) * 8, until: G.time + 120, advanceAt: G.time + 1 + R() * 1.4, boundUntil: 0 };
      // A reserve that fought earlier still has to move when ordered.
      // Preserve a live engagement and reload, but let its next cover
      // decision advance towards the ordered position.
      if (e.state === 'combat' && e.sees) { e.phaseTimer = Math.min(e.phaseTimer, 1.5); continue; }
      e.laneStep = null;
      startSearch(e, e.order.x, e.order.z, { reason: 'assault', sweeps: 2 });
    }
  }

  return { list: enemies, update, resetLiving, send, alive: () => enemies.filter(e => !e.dead), nav, intel };
}
