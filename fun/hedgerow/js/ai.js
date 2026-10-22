/* Hedgerow — enemy soldiers.

   Each German soldier has a post (standing guard, patrolling, manning a
   machine gun or watching from the church tower) and a leash around it.

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
   their gun within its arc and hose the last known position; the sniper
   aims slowly, and the glint of his scope gives him away.

   Enemy fire is resolved as a roll against the player's exposure (head /
   chest visible), distance, stance and movement; misses still land
   around the player, crack past and kick up dirt. */

import * as THREE from 'three';
import { ENEMY, ENEMY_WEAPONS, GRENADE, GAIT } from './config.js';
import { clamp, damp, dampAngle, rng, wrapAngle, lerp } from './util.js';
import { createCharacter, mergedSoldier, randomFace } from './character.js';
import { startReload as reloadSequence } from './reload.js';
import { MOVE, SHOT, SIGHT } from './world.js';
import { createNav } from './nav.js';

const R = rng(1944);
const FACES = rng(1907);      // faces on their own stream, so they do not shift the AI's dice
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

const BASE_ACC = { rifle: 0.5, smg: 0.3, mg: 0.2, sniper: 0.85, officer: 0.4 };
const WEAPON_OF = { rifle: 'kar98k', smg: 'mp40', mg: 'mg42', sniper: 'sniper', officer: 'mp40' };

/* ---------- cover points from the world's low obstacles ---------- */

export function buildCoverPoints(world, terrain) {
  const points = [];
  for (const col of world.colliders) {
    if (!(col.flags & MOVE) || !(col.flags & SHOT)) continue;
    if (col.type !== 'box') continue;
    const ground = terrain.height(col.x, col.z);
    const top = col.top - ground;
    const low = top > 0.55 && top < 1.45;
    const tall = top >= 1.45;
    if (!low && !tall) continue;
    if (col.hx * col.hz > 300) continue;           // whole houses: corners only
    const off = 0.6;
    const sides = [
      [1, 0, col.hx, col.hz], [-1, 0, col.hx, col.hz], [0, 1, col.hz, col.hx], [0, -1, col.hz, col.hx],
    ];
    for (const [sx, sz, half, along] of sides) {
      const n = tall ? 1 : Math.max(1, Math.floor((along * 2) / 1.4));
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
  return points;
}

export function createEnemies(G, defs) {
  const enemies = [];
  const cover = G.cover;
  const nav = G.nav || (G.nav = createNav(G.world, G.level?.playBounds || G.world.bounds));
  // what each group last saw of the player: where, which way he was going, when
  const intel = new Map();
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

  // sniper glint
  const glintTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,240,200,0.8)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(0, 31, 64, 2); g.fillRect(31, 0, 2, 64);
    return new THREE.CanvasTexture(c);
  })();

  for (const d of defs) enemies.push(spawn(d));

  function spawn(d) {
    const type = d.type || 'rifle';
    const wid = d.weapon || WEAPON_OF[type];
    const wdef = ENEMY_WEAPONS[wid];
    const e = {
      def: d, type, group: d.group || 'none', wdef,
      pos: new THREE.Vector3(), yaw: 0, home: { x: d.at[0], z: d.at[1], yaw: (d.yaw || 0) * Math.PI / 180 },
      health: ENEMY.health * (d.tough || 1), dead: false, char: null,
      state: 'idle', awareness: 0, lastSeen: -99, lastKnown: null, sees: false, exposure: 0,
      cover: null, stance: d.stance || 'stand', target: null, moveSpeed: 0, vel: new THREE.Vector3(),
      fireTimer: 0, burstLeft: 0, aimTimer: 0, reaction: 0, suppressed: 0,
      phase: 'hide', phaseTimer: 0, grenades: type === 'rifle' ? 1 : type === 'smg' ? 1 : 0, grenadeCheck: 2 + R() * 3,
      perceiveTimer: R() * 0.15, searchTimer: 0, stuck: 0, lastPos: new THREE.Vector3(), alertAt: -1,
      patrol: d.patrol || null, patrolIdx: 0, patrolWait: 0,
      leash: d.hold ? 0 : d.leash ?? (type === 'mg' || type === 'sniper' ? 0 : 18),
      mg: null, glint: null, active: false, firstShot: true, shotsAtTarget: 0,
      mag: wdef.mag || 30, reloadT: 0, reloadTotal: 1, reloadStage: 0,
      path: null, pathIdx: 0, pathFails: 0, srch: null, amb: null, alertCover: false,
      patience: 10, waryUntil: -1, scanPhase: R() * 6,
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
      }
    }
    if (type === 'sniper') {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: '#ffe6b0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.scale.set(0.9, 0.9, 1);
      s.visible = false;
      G.scene.add(s);
      e.glint = s;
      e.stance = 'stand';
    }
    e.damage = (amount, from, part, byPlayer) => damage(e, amount, from, part, byPlayer);
    e.suppress = (t, from) => suppress(e, t, from);
    if (e.patrol) e.state = 'patrol';
    return e;
  }

  /* ---------- reactions ---------- */

  function alertGroup(e) {
    for (const o of enemies) {
      if (o === e || o.dead || o.group !== e.group || o.state === 'combat') continue;
      if (o.alertAt < 0) o.alertAt = G.time + 0.35 + R() * 1.1;
      if (!o.lastKnown) o.lastKnown = e.lastKnown ? { ...e.lastKnown } : { x: G.player.pos.x, z: G.player.pos.z };
    }
  }

  function enterCombat(e) {
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
    alertGroup(e);
  }

  function damage(e, amount, from, part, byPlayer) {
    if (e.dead) return false;
    e.health -= amount;
    if (byPlayer) { e.lastKnown = { x: G.player.pos.x, z: G.player.pos.z }; e.lastSeen = G.time; }
    if (e.health <= 0) {
      die(e, from, part);
      return true;
    }
    e.char.oneShot('hit', 1.2);
    e.suppressed = Math.max(e.suppressed, 0.8);
    enterCombat(e);
    return false;
  }

  function die(e, from, part) {
    e.dead = true;
    e.state = 'dead';
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
    e.char.die(kind, { world: G.world, velocity: e.vel.clone(), impulses });
    G.audio.bodyFall(e.pos.x, e.pos.y, e.pos.z, G.world.surfaceUnder(e.pos.x, e.pos.y, e.pos.z), 0.4 + R() * 0.3);
    if (G.debris && e.char.weapon && e.char.ragdoll) {
      G.debris.drop(e.char.weapon, new THREE.Vector3((R() - 0.5) * 1.5, 1.2, (R() - 0.5) * 1.5), { spin: 5, radius: 0.08, life: 240 });
    }
    if (e.glint) e.glint.visible = false;
    G.stats.kills++;
    if (part === 'head') G.stats.headshots++;
    G.events.emit('enemyKilled', e);
    alertGroup(e);
  }

  function suppress(e, t, from) {
    if (e.dead) return;
    e.suppressed = Math.max(e.suppressed, t);
    if (e.state !== 'combat') {
      e.awareness = Math.max(e.awareness, 0.75);
      if (from) e.lastKnown = { x: from.x, z: from.z };
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
      if (e.state === 'combat') { if (!e.sees) e.lastKnown = { x, z }; continue; }
      if (e.state === 'ambush') continue;            // stays put, listening
      if (d < radius * 0.3) { e.lastKnown = { x, z }; enterCombat(e); continue; }
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
          e.alertCover = e.type !== 'mg' && e.type !== 'sniper';
          e.path = null;
        }
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

  const canLeave = (e) => e.leash > 0 && !e.def.hold && e.type !== 'mg' && e.type !== 'sniper';

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
    const head = tmp2.set(p.pos.x, p.pos.y + (p.crouch ? 1.15 : 1.65), p.pos.z);
    const chest = tmp3.set(p.pos.x, p.pos.y + (p.crouch ? 0.8 : 1.2), p.pos.z);
    const dx = chest.x - eye.x, dz = chest.z - eye.z;
    const dist = Math.hypot(dx, dz);
    const combat = e.state === 'combat';
    // looking for him (searching, waiting in ambush, still wary): eyes open wider
    const ready = e.state === 'search' || e.state === 'ambush' || e.state === 'alert' || G.time < e.waryUntil;
    let range = (e.type === 'sniper' ? 150 : e.type === 'mg' ? 95 : ENEMY.viewRange) * p.visible * (combat ? 1.7 : ready ? 1.25 : 1);
    if (G.lightning > 0.4) range *= 1.4;
    if (dist > range) return;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - e.yaw));
    const fov = combat ? Math.PI : e.state === 'ambush' ? ENEMY.viewFov * 1.5 : ready ? ENEMY.viewFov * 1.4 : ENEMY.viewFov;
    if (ang > fov) return;
    const seeHead = G.world.clear(eye.x, eye.y, eye.z, head.x, head.y, head.z, SIGHT);
    const seeChest = G.world.clear(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z, SIGHT);
    if (!seeHead && !seeChest) return;
    e.sees = true;
    e.exposure = seeChest ? 1 : 0.45;
    e.lastKnown = { x: p.pos.x, z: p.pos.z };
    e.lastSeen = G.time;
    intel.set(e.group, { x: p.pos.x, z: p.pos.z, vx: p.vel ? p.vel.x : 0, vz: p.vel ? p.vel.z : 0, t: G.time });
    if (!combat) {
      // waiting for him in ambush: he walked into the sights
      if (e.state === 'ambush') { enterCombat(e); return; }
      const near = 1 - dist / range;
      e.awareness += dt * ENEMY.awareRate * G.diff.aware * (0.35 + 2.2 * near * near) * (seeChest ? 1 : 0.6) * (ready ? 2.5 : 1);
      if (e.awareness >= 1) enterCombat(e);
      else if (e.awareness > 0.35 && e.state !== 'search') e.state = 'alert';
    }
  }

  /* ---------- movement ---------- */

  function moveTowards(e, tx, tz, speed, dt) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) { e.vel.set(0, 0, 0); return true; }
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
    e.pos.x = tmp.x; e.pos.z = tmp.z;
    e.pos.y = G.world.groundAt(e.pos.x, e.pos.z, e.pos.y, 0.5);
    return d < 0.5;
  }

  function face(e, x, z, rate, dt) {
    const want = Math.atan2(x - e.pos.x, z - e.pos.z);
    e.yaw = dampAngle(e.yaw, want, rate, dt);
    return Math.abs(wrapAngle(want - e.yaw));
  }

  /* Find a cover point near the post that hides a crouching man from the
     player's last known position but lets him fire standing. */
  function findCover(e) {
    const lk = e.lastKnown || { x: G.player.pos.x, z: G.player.pos.z };
    const py = G.player.pos.y + 1.2;
    // near the post, or near where he is now when the fight found him elsewhere
    const atPost = e.leash > 0 && Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z) < e.leash + 6;
    const centre = atPost ? e.home : e.pos;
    const cand = coverNear(centre.x, centre.z, Math.max(8, (e.leash || 10) + 4));
    let best = null, bestScore = -Infinity;
    let tests = 0;
    cand.sort((a, b) => ((a.x - e.pos.x) ** 2 + (a.z - e.pos.z) ** 2) - ((b.x - e.pos.x) ** 2 + (b.z - e.pos.z) ** 2));
    for (const c of cand) {
      if (c.taken && c.taken !== e) continue;
      if (tests > 14) break;
      const toP = Math.hypot(lk.x - c.x, lk.z - c.z);
      if (toP < 6) continue;
      // the obstacle must be between the point and the player
      const facing = ((lk.x - c.x) * -c.nx + (lk.z - c.z) * -c.nz) / toP;
      if (facing < 0.35) continue;
      tests++;
      const hidden = !G.world.clear(c.x, c.y + 0.95, c.z, lk.x, py, lk.z, SHOT);
      if (!hidden) continue;
      const peek = c.low ? G.world.clear(c.x, c.y + 1.55, c.z, lk.x, py + 0.3, lk.z, SIGHT) : true;
      const dMe = Math.hypot(c.x - e.pos.x, c.z - e.pos.z);
      const pref = e.type === 'smg' ? 16 : 28;
      const score = (peek ? 6 : 0) - dMe * 0.45 - Math.abs(toP - pref) * 0.15 + facing * 2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
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
    e.reloadT = e.reloadTotal = w.reload || 3;
    e.reloadStage = 0;
    e.burstLeft = 0;
    if (e.type !== 'mg') {
      const clip = e.type === 'smg' && e.char.hasClip('reload_smg') ? 'reload_smg' : 'reload';
      e.char.oneShot(clip, (e.char.clipLength(clip) || 1.6) / e.reloadTotal);
      e.reloadRun = reloadSequence(G, e.char, w, clip);
    }
    G.audio.reload?.(e.type === 'smg' ? 'thompson' : 'garand', e.pos);
  }

  /* the hands during an enemy reload (the shared sequencer in reload.js) */
  function reloadSteps(e, dt) {
    e.reloadT -= dt;
    e.reloadRun?.update(1 - Math.max(0, e.reloadT) / e.reloadTotal);
    if (e.reloadT <= 0) { e.reloadT = 0; e.mag = e.wdef.mag || 30; e.reloadRun?.end(); e.reloadRun = null; }
  }

  function shoot(e) {
    const p = G.player;
    const w = e.wdef;
    if (e.reloadT > 0) return;
    if (--e.mag <= 0) startReload(e);
    const muzzle = muzzleOf(e, new THREE.Vector3());
    const target = new THREE.Vector3(p.pos.x, p.pos.y + (p.crouch ? 0.85 : 1.25), p.pos.z);
    let hit = false;
    if (e.sees && p.alive) {
      const d = muzzle.distanceTo(target);
      const fall = clamp(1 - (d - 6) / (w.range * 1.1), 0.12, 1);
      let pHit = BASE_ACC[e.type] * fall * e.exposure * G.diff.accuracy;
      if (p.crouch) pHit *= 0.7;
      if (p.movingSpeed > 3) pHit *= 0.7;
      if (p.vault) pHit *= 0.5;
      if (e.suppressed > 0) pHit *= 0.35;
      if (e.firstShot) pHit *= 0.45;
      pHit *= Math.min(1.25, 0.85 + e.shotsAtTarget * 0.05);
      hit = R() < pHit;
    }
    e.firstShot = false;
    e.shotsAtTarget++;
    // visuals and sound
    const dir = new THREE.Vector3();
    let end;
    if (hit) {
      end = target;
    } else {
      // a miss lands around the player (or around where he was)
      const base = e.sees ? target : new THREE.Vector3(e.lastKnown?.x ?? p.pos.x, p.pos.y + 1, e.lastKnown?.z ?? p.pos.z);
      end = base.clone().add(new THREE.Vector3((R() - 0.5) * 3.2, (R() - 0.6) * 1.8, (R() - 0.5) * 3.2));
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
        if (miss < 4) G.audio.whizz(closest.x, closest.y, closest.z, 1 - miss / 4);
        if (miss < 1.5) G.rig.addShake(0.08);
      }
    }
  }

  function tryGrenade(e) {
    const p = G.player;
    if (!e.lastKnown || e.grenades <= 0) return false;
    const d = Math.hypot(e.lastKnown.x - e.pos.x, e.lastKnown.z - e.pos.z);
    if (d < 8 || d > 26) return false;
    if (G.time - e.lastSeen < 3.5 || G.time - e.lastSeen > 25) return false;
    if (G.explosives.list.some(g => g.kind === 'enemy')) return false;
    if (R() > 0.45) return false;
    e.grenades--;
    e.char.oneShot('throw', 1.1);
    const tx = e.lastKnown.x + (R() - 0.5) * 3, tz = e.lastKnown.z + (R() - 0.5) * 3;
    setTimeout(() => {
      if (e.dead) return;
      const start = e.char.boneWorld('hand_r', new THREE.Vector3());
      // ballistic launch at ~40°
      const dx = tx - start.x, dz = tz - start.z;
      const horiz = Math.hypot(dx, dz);
      const ty = G.world.groundAt(tx, tz, 1e4, 0.5);
      const ang = 0.7;
      const dy = ty - start.y;
      const v2 = (9.8 * horiz * horiz) / (2 * Math.cos(ang) ** 2 * (horiz * Math.tan(ang) - dy));
      const v = Math.sqrt(Math.max(4, Math.min(400, v2)));
      const vel = new THREE.Vector3((dx / horiz) * v * Math.cos(ang), v * Math.sin(ang), (dz / horiz) * v * Math.cos(ang));
      G.explosives.throwGrenade('enemy', start, vel, 0.4 + R() * 0.6, e);
    }, 420);
    return true;
  }

  /* ---------- per type behaviour ---------- */

  function updateCombatRifle(e, dt) {
    const p = G.player;
    const lk = e.lastKnown || { x: p.pos.x, z: p.pos.z };
    e.phaseTimer -= dt;
    e.suppressed = Math.max(0, e.suppressed - dt);
    e.grenadeCheck -= dt;

    // dug in (trench, foxhole): no running about, just duck and pop up
    if (e.def.hold && (e.phase === 'move' || e.phase === 'open')) { e.phase = 'hide'; e.phaseTimer = 0.3 + R() * 0.9; }

    // choose / refresh cover
    if (e.phase === 'move') {
      if (!e.cover || e.phaseTimer < -6) {
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
            e.cover.taken = null; e.cover = null; e.phase = 'open'; e.phaseTimer = 2;
          } else { e.phase = 'hide'; e.phaseTimer = 0.8 + R() * 1.2; }
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
      e.vel.set(0, 0, 0);
      if (e.grenadeCheck <= 0) { e.grenadeCheck = 3 + R() * 2; if (tryGrenade(e)) { e.phaseTimer = 1.6; return; } }
      if (e.phaseTimer <= 0 && e.suppressed <= 0) {
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
      if (e.phase === 'open') {
        // drift around a little in the open
        if (!e.target || e.phaseTimer < 0) {
          e.target = { x: e.pos.x + (R() - 0.5) * 4, z: e.pos.z + (R() - 0.5) * 4 };
          const near = e.leash > 0 && Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z) < e.leash + 6;
          const h = near ? e.home : e.pos;
          if (Math.hypot(e.target.x - h.x, e.target.z - h.z) > Math.max(4, e.leash)) e.target = { x: h.x, z: h.z };
          e.phaseTimer = 2.5 + R() * 2;
          if (R() < 0.4) { e.phase = 'move'; e.cover = null; return; }
        }
        if (e.sees) e.vel.set(0, 0, 0);
        else moveTowards(e, e.target.x, e.target.z, ENEMY.walk, dt);
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
            shoot(e);
            e.burstLeft--;
            e.fireTimer = e.burstLeft > 0 ? e.wdef.interval : (e.type === 'smg' ? 0.6 + R() * 0.8 : e.wdef.interval * (0.8 + R() * 0.6));
          }
        }
      } else {
        e.aimTimer = e.reaction * 0.6;
      }
      if (e.phase === 'peek' && e.phaseTimer <= 0) {
        e.phase = 'hide';
        e.phaseTimer = 1.0 + R() * 1.6 + e.suppressed;
      }
      // lost him: some go and look, some wait for him where he was heading
      if (canLeave(e)) {
        const gi = intel.get(e.group);
        const ago = G.time - Math.max(e.lastSeen, gi ? gi.t : -99);
        if (ago > e.patience) lostContact(e, gi);
      }
    }
  }

  function updateMG(e, dt) {
    const p = G.player;
    e.suppressed = Math.max(0, e.suppressed - dt);
    const lk = e.lastKnown || { x: p.pos.x, z: p.pos.z };
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
        shoot(e);
        e.burstLeft--;
        e.fireTimer = e.burstLeft > 0 ? e.wdef.interval : 0.9 + R() * 1.1;
      }
    } else e.aimTimer = Math.max(e.aimTimer, 0.4);
  }

  function updateSniper(e, dt) {
    const p = G.player;
    const lk = e.lastKnown || { x: p.pos.x, z: p.pos.z };
    face(e, lk.x, lk.z, 3, dt);
    e.stance = e.suppressed > 0 ? 'crouch' : 'stand';
    e.suppressed = Math.max(0, e.suppressed - dt);
    e.fireTimer -= dt;
    const glint = e.glint;
    if (e.sees && e.suppressed <= 0) {
      e.aimTimer += dt;
      if (glint) {
        glint.visible = true;
        e.char.headWorld(glint.position);
        glint.position.y += 0.02;
        const k = Math.min(1, e.aimTimer / 1.8);
        glint.material.opacity = 0.35 + 0.65 * k * (0.75 + 0.25 * Math.sin(G.time * 18));
        glint.scale.setScalar(0.6 + k * 0.8);
      }
      if (e.aimTimer > 2.1 && e.fireTimer <= 0 && e.reloadT <= 0) {
        shoot(e);
        e.fireTimer = e.wdef.interval;
        e.aimTimer = 0.6;
      }
    } else {
      e.aimTimer = Math.max(0, e.aimTimer - dt * 2);
      if (glint) glint.visible = e.aimTimer > 0.2;
    }
  }

  /* ---------- walking somewhere ---------- */

  /* Along a path on the walk grid to (tx, tz), looking where he goes or at
     `lookAt`. True on arrival — or when the way is blocked for good. */
  function goTo(e, tx, tz, speed, dt, { lookAt = null, faceRate = 6 } = {}) {
    if (!e.path || e.pathGoalX !== tx || e.pathGoalZ !== tz) {
      e.path = nav.findPath(e.pos.x, e.pos.z, tx, tz) || [{ x: tx, z: tz }];
      e.pathIdx = 0; e.pathGoalX = tx; e.pathGoalZ = tz; e.stuck = 0;
    }
    const wp = e.path[Math.min(e.pathIdx, e.path.length - 1)];
    if (!wp) return true;
    const last = e.pathIdx >= e.path.length - 1;
    const there = moveTowards(e, wp.x, wp.z, speed, dt);
    const d = Math.hypot(wp.x - e.pos.x, wp.z - e.pos.z);
    if (lookAt) face(e, lookAt.x, lookAt.z, faceRate, dt); else if (d > 0.3) face(e, wp.x, wp.z, faceRate, dt);
    if (!last && d < 1.1) e.pathIdx++;
    // not getting anywhere: a fresh path, and after a few tries give up on it
    if (e.pos.distanceToSquared(e.lastPos) < (speed * dt * 0.15) ** 2) e.stuck += dt; else e.stuck = Math.max(0, e.stuck - dt * 0.5);
    if (e.stuck > 1.5) {
      e.stuck = 0; e.path = null;
      if (++e.pathFails > 2) { e.pathFails = 0; return true; }
    }
    return last && (there || d < 0.6);
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
    if (e.type !== 'mg' && e.type !== 'sniper' && Math.hypot(e.home.x - e.pos.x, e.home.z - e.pos.z) > 0.6) {
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
        const speed = s.reason === 'search' && d > 18 ? ENEMY.run * 0.8 : ENEMY.walk * 1.1;
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
      if (++tests > 20) break;
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
    if (Math.hypot(at.x - e.pos.x, at.z - e.pos.z) > 0.15) moveTowards(e, at.x, at.z, ENEMY.walk, dt);
    else e.vel.set(0, 0, 0);
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
    const lk = gi ? { x: gi.x, z: gi.z } : e.lastKnown;
    if (!lk) return;
    let searching = 0, waiting = 0;
    for (const o of enemies) {
      if (o === e || o.dead || o.group !== e.group) continue;
      if (o.state === 'search') searching++;
      else if (o.state === 'ambush') waiting++;
    }
    const pred = predictPath(gi);
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
    const firing = e.state === 'combat' && (e.phase === 'peek' || e.phase === 'open' || e.type === 'mg' || e.type === 'sniper') && speed < 3;
    // looking for him, waiting for him, or wary after a scare: rifle up
    const ready = (e.state === 'search' && e.srch?.reason !== 'body') || e.state === 'ambush' || e.state === 'alert' ||
      (G.time < e.waryUntil && e.state !== 'idle');
    let upper = firing || (ready && speed < 3) ? (crouch ? 'crouch_aim' : 'aim') : move;
    if (e.type === 'mg') upper = crouch ? 'crouch_idle' : 'crouch_aim';
    if (e.type === 'mg' && !crouch) move = 'crouch_idle';
    ch.animate(move, upper, gait);
    if (firing && e.lastKnown) {
      const p = G.player;
      const dy = (p.pos.y + 1.2) - (e.pos.y + 1.4);
      const dh = Math.hypot(e.lastKnown.x - e.pos.x, e.lastKnown.z - e.pos.z);
      ch.aimPitch = clamp(Math.atan2(dy, dh), -0.8, 0.8);
    } else ch.aimPitch = 0;
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
      e.active = dPl < 170;
      if (!e.active) { e.char.shadow.visible = false; continue; }
      e.lastPos.copy(e.pos);
      if (e.reloadT > 0) reloadSteps(e, dt);
      e.perceiveTimer -= dt;
      if (e.perceiveTimer <= 0) {
        const step = 0.12;
        perceive(e, step - e.perceiveTimer);
        e.perceiveTimer = step;
      }
      if (e.state === 'combat') {
        if (e.type === 'mg') updateMG(e, dt);
        else if (e.type === 'sniper') updateSniper(e, dt);
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
      } else if (e.state === 'combat' && e.sees && dPl < 60 && (e.type === 'sniper' || e.type === 'mg')) {
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
      e.awareness = 0; e.lastKnown = null; e.lastSeen = -99; e.alertAt = -1;
      if (e.cover) { e.cover.taken = null; e.cover = null; }
      e.phase = 'hide'; e.suppressed = 0; e.vel.set(0, 0, 0); e.health = ENEMY.health * (e.def.tough || 1);
      e.mag = e.wdef.mag || 30; e.reloadT = 0; e.reloadRun?.end(); e.reloadRun = null; e.char.holdLeft(null);
      e.srch = null; e.amb = null; e.path = null; e.alertCover = false; e.waryUntil = -1; e.patrolIdx = 0; e.patrolWait = 0;
      if (e.glint) e.glint.visible = false;
      if (e.mg) e.mg.mesh.rotation.y = e.mg.baseYaw;
    }
    intel.clear();
  }

  return { list: enemies, update, resetLiving, alive: () => enemies.filter(e => !e.dead), nav, intel };
}
