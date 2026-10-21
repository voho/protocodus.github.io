/* Hedgerow — the player soldier.

   Strafe-style third-person control: the soldier faces where the camera
   looks while moving or aiming, and turns with it more lazily when idle.
   Walking, sprinting, crouching, wading, vaulting low cover and jumping
   share one capsule against the world. Two weapons (Garand, Thompson),
   grenades that can be cooked, health that comes back when out of fire. */

import * as THREE from 'three';
import { PLAYER, WEAPONS, GRENADE, GAIT } from './config.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from './util.js';
import { createCharacter } from './character.js';
import { rayEnemies } from './combat.js';
import { instantiate } from './assets.js';
import { startReload as reloadSequence } from './reload.js';
import { SHOT, MOVE } from './world.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), dir = new THREE.Vector3();

export function createPlayer(G) {
  const P = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, alive: true, health: PLAYER.health,
    crouch: false, crouchT: 0, sprint: false, grounded: true,
    hurtTimer: 99, regenHold: 0,
    weapon: 'garand', ammo: {}, grenades: GRENADE.carry,
    cooldown: 0, reloading: 0, switching: 0, spread: 0,
    cooking: -1, throwing: 0,
    vault: null, wading: 0,
    stepAcc: 0, firedAt: -10, lastHurtDir: 0,
    char: null, movingSpeed: 0, visible: 1, noise: 0,
    stats: null,
  };

  const charOpts = () => ({ outfit: 'allied', weaponModel: G.models.get(WEAPONS[P.weapon || 'garand'].model), grenadeModel: G.models.get('grenade_us'), scene: G.scene });
  P.char = createCharacter(G.soldier, G.matlib, charOpts());
  G.scene.add(P.char.root);

  P.reset = (spawn, keepInventory = null) => {
    P.pos.set(spawn[0], 0, spawn[1]);
    P.pos.y = G.world.groundAt(P.pos.x, P.pos.z, 1e4, 0.5);
    P.vel.set(0, 0, 0);
    P.yaw = spawn[2] || 0;
    G.rig.yaw = P.yaw; G.rig.pitch = -0.08;
    P.alive = true; P.health = PLAYER.health; P.killer = null;
    G.rig.resetDeathCam?.();
    P.crouch = false; P.crouchT = 0;
    P.cooldown = 0; P.reloading = 0; P.switching = 0; P.cooking = -1; P.throwing = 0; P.vault = null;
    P.reloadRun?.end?.();
    P.reloadRun = null;
    P.char.holdLeft?.(null);
    if (keepInventory) {
      P.ammo = JSON.parse(JSON.stringify(keepInventory.ammo));
      P.grenades = keepInventory.grenades;
      P.weapon = keepInventory.weapon;
    } else {
      P.ammo = {};
      for (const [k, w] of Object.entries(WEAPONS)) P.ammo[k] = { mag: w.mag, reserve: w.reserve };
      P.grenades = GRENADE.carry;
      P.weapon = 'garand';
    }
    if (P.char.dead) {
      P.char.dispose();
      P.char = createCharacter(G.soldier, G.matlib, charOpts());
      G.scene.add(P.char.root);
    } else {
      P.char.setWeapon(G.models.get(WEAPONS[P.weapon].model));
    }
    P.char.root.position.copy(P.pos);
    P.char.root.rotation.y = P.yaw;
    G.hud.health(P.health / PLAYER.health);
  };

  P.inventory = () => ({ ammo: JSON.parse(JSON.stringify(P.ammo)), grenades: P.grenades, weapon: P.weapon });

  /* `by`: the enemy who fired or threw (for the camera that turns to him) */
  P.damage = (amount, from, kind = 'bullet', by = null) => {
    if (!P.alive || G.godMode) return;
    P.health -= amount;
    P.hurtTimer = 0;
    G.stats.damageTaken += amount;
    G.audio.ui('hurt');
    G.rig.addShake(kind === 'bullet' ? 0.25 : 0.6);
    if (from) {
      const ang = Math.atan2(from.x - P.pos.x, from.z - P.pos.z);
      G.hud.damageFrom(wrapAngle(ang - G.rig.yaw));
    }
    if (P.health <= 0) {
      P.health = 0;
      P.alive = false;
      P.killer = by;
      P.diedAt = G.time;
      const back = from ? Math.cos(Math.atan2(from.x - P.pos.x, from.z - P.pos.z) - P.yaw) < 0 : false;
      const impulses = [];
      if (from) {
        const dir = new THREE.Vector3(P.pos.x - from.x, 0, P.pos.z - from.z).normalize();
        const k = kind === 'bullet' ? 3.0 : 7;
        impulses.push({ part: kind === 'bullet' ? 'body' : 'all', vel: dir.multiplyScalar(k).add(new THREE.Vector3(0, kind === 'bullet' ? 0.4 : 3.5, 0)) });
      }
      P.char.die(back ? 'death_back' : 'death_fwd', { world: G.world, velocity: P.vel.clone(), impulses });
      if (G.debris && P.char.weapon && P.char.ragdoll) G.debris.drop(P.char.weapon, new THREE.Vector3(0, 1, 0), { spin: 4, radius: 0.08 });
      G.events.emit('playerDied');
    }
    G.hud.health(P.health / PLAYER.health);
  };

  P.heal = (amount) => {
    P.health = Math.min(PLAYER.health, P.health + amount);
    G.hud.health(P.health / PLAYER.health);
  };

  function weaponDef() { return WEAPONS[P.weapon]; }

  function switchTo(id) {
    if (id === P.weapon || P.switching > 0 || !WEAPONS[id]) return;
    P.reloadRun?.end();
    P.reloadRun = null;
    P.weapon = id;
    P.reloading = 0;
    P.switching = 0.45;
    P.char.setWeapon(G.models.get(WEAPONS[id].model));
    G.audio.switchWeapon();
    G.hud.weapon(WEAPONS[id].name, P.ammo[id], P.grenades);
  }

  /* A magazine or clip object for the hands or the ground (the model when
     weapons.glb has it, otherwise a small dark block of the right size). */
  function magObject(w) {
    const m = w.prop && G.models.get(w.prop);
    if (m) return instantiate(m, G.matlib);
    const [x, y, z] = w.propSize || [0.04, 0.2, 0.07];
    return new THREE.Mesh(new THREE.BoxGeometry(x, y, z), G.matlib.get('gun_metal'));
  }

  function startReload() {
    const w = weaponDef(), a = P.ammo[P.weapon];
    if (P.reloading > 0 || a.mag >= w.mag || a.reserve <= 0 || P.switching > 0) return;
    P.reloading = P.reloadTotal = w.reload;
    const clip = w.kind === 'smg' && P.char.hasClip('reload_smg') ? 'reload_smg' : 'reload';
    P.char.oneShot(clip, (P.char.clipLength(clip) || 1.6) / w.reload);
    P.reloadRun?.end();
    P.reloadRun = reloadSequence(G, P.char, w, clip);
    G.audio.reload(P.weapon);
  }

  function finishReload() {
    const w = weaponDef(), a = P.ammo[P.weapon];
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take; a.reserve -= take;
    G.hud.weapon(w.name, a, P.grenades);
  }

  function fire(aiming) {
    const w = weaponDef(), a = P.ammo[P.weapon];
    if (a.mag <= 0) {
      G.audio.dryFire();
      P.cooldown = 0.25;
      if (a.reserve > 0) startReload();
      return;
    }
    a.mag--;
    P.cooldown = w.interval;
    P.firedAt = G.time;
    G.stats.shots++;
    // spread: hip/aim, movement, bloom
    const moving = Math.min(1, P.movingSpeed / 3);
    let spread = lerp(w.spreadHip, w.spreadAim, G.rig.aimT) + w.spreadMove * moving * (P.crouch ? 0.5 : 1) + P.spread;
    if (P.crouch) spread *= 0.75;
    P.spread = Math.min(P.spread + w.bloom, 0.12);
    G.rig.forward(dir);
    // random cone
    const r = Math.sqrt(Math.random()) * spread, th = Math.random() * Math.PI * 2;
    const up = Math.abs(dir.y) < 0.95 ? tmp.set(0, 1, 0) : tmp.set(1, 0, 0);
    const rx = tmp2.crossVectors(dir, up).normalize();
    const ry = new THREE.Vector3().crossVectors(rx, dir).normalize();
    dir.addScaledVector(rx, Math.cos(th) * r).addScaledVector(ry, Math.sin(th) * r).normalize();

    const cam = G.camera.position;
    const camHit = traceShot(cam, dir, w.range);
    // from the muzzle to what the crosshair found
    const muzzle = P.char.muzzleWorld(new THREE.Vector3());
    const target = camHit ? camHit.point : tmp.copy(cam).addScaledVector(dir, w.range);
    const md = new THREE.Vector3().subVectors(target, muzzle);
    const mlen = md.length();
    md.divideScalar(mlen || 1);
    let finalHit = camHit;
    const block = G.world.raycast(muzzle.x, muzzle.y, muzzle.z, md.x, md.y, md.z, Math.max(0, mlen - 0.3), SHOT);
    if (block && mlen > 0.5) {
      finalHit = { point: new THREE.Vector3(block.x, block.y, block.z), world: block };
    }
    // effects
    G.effects.muzzle(muzzle.x, muzzle.y, muzzle.z, md.x, md.y, md.z, w.kind === 'rifle' ? 1.2 : 0.9);
    G.effects.shell(muzzle.x - md.x * 0.5, muzzle.y, muzzle.z - md.z * 0.5, -md.z, md.x);
    G.lights.flash(muzzle.x + md.x * 0.3, muzzle.y, muzzle.z + md.z * 0.3, '#ffb36b', 60, 9, 0.06);
    G.audio.gunshot(w.sound, muzzle.x, muzzle.y, muzzle.z, { player: true });
    if (P.weapon === 'garand' && a.mag === 0) {
      // the empty en-bloc flies out with its ping
      G.audio.garandPing();
      const wpn = P.char.weapon;
      const at = new THREE.Vector3();
      if (wpn) wpn.localToWorld(at.set(0, 0.06, 0.05)); else at.copy(muzzle);
      const side = new THREE.Vector3(-Math.cos(P.yaw), 0, Math.sin(P.yaw));
      G.debris.spawn(magObject(w), at, new THREE.Vector3(side.x * 1.2, 3.2, side.z * 1.2), { spin: 18, radius: 0.03 });
    }
    if (w.tracer) G.effects.tracer(muzzle.x, muzzle.y, muzzle.z, md.x, md.y, md.z, mlen);
    G.rig.kick(w.recoil * (P.crouch ? 0.7 : 1) * lerp(1, 0.7, G.rig.aimT), (Math.random() - 0.5) * 2 * w.recoilYaw);
    G.events.emit('noise', { x: P.pos.x, z: P.pos.z, radius: 75, kind: 'shot' });

    if (finalHit) {
      const p = finalHit.point;
      if (finalHit.enemy) {
        const e = finalHit.enemy;
        const mul = finalHit.part === 'head' ? w.headMul : finalHit.part === 'legs' ? w.limbMul : 1;
        const killed = e.damage(w.damage * mul, P.pos, finalHit.part, true);
        G.effects.blood(p.x, p.y, p.z, dir.x, dir.y, dir.z);
        G.audio.impact(p.x, p.y, p.z, 'flesh');
        G.stats.hits++;
        if (finalHit.part === 'head') G.stats.headHits++;
        G.hud.hitmark(killed);
        G.audio.ui(killed ? 'kill' : 'hit');
      } else if (finalHit.world) {
        const h = finalHit.world;
        G.effects.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.surface || 'stone', dir.x, dir.y, dir.z);
        G.decals?.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.surface || 'stone');
        G.audio.impact(h.x, h.y, h.z, h.surface);
        // near misses keep enemies' heads down
        for (const e of G.enemies) {
          if (!e.dead && Math.hypot(e.pos.x - h.x, e.pos.y + 1 - h.y, e.pos.z - h.z) < 2.2) e.suppress(1.2, P.pos);
        }
      }
    }
    G.hud.weapon(w.name, a, P.grenades);
    if (a.mag === 0 && a.reserve > 0) setTimeout(() => { if (P.alive && P.ammo[P.weapon] === a && a.mag === 0) startReload(); }, 250);
  }

  function traceShot(o, d, range) {
    const wh = G.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range, SHOT);
    const eh = rayEnemies(G.enemies, o, d, wh ? wh.t : range);
    if (eh) return { point: new THREE.Vector3(o.x + d.x * eh.t, o.y + d.y * eh.t, o.z + d.z * eh.t), enemy: eh.enemy, part: eh.part };
    if (wh) return { point: new THREE.Vector3(wh.x, wh.y, wh.z), world: wh };
    return null;
  }

  function throwGrenade() {
    const cooked = P.cooking >= 0 ? G.time - P.cooking : 0;
    P.cooking = -1;
    P.grenades--;
    P.throwing = 0.9;
    P.char.oneShot('throw', 1.2);
    G.hud.weapon(weaponDef().name, P.ammo[P.weapon], P.grenades);
    setTimeout(() => {
      if (!P.alive) return;
      G.rig.forward(dir);
      const hand = P.char.boneWorld('hand_r', new THREE.Vector3());
      const start = hand.lengthSq() > 0 ? hand : P.pos.clone().setY(P.pos.y + 1.6);
      // aim a little above the crosshair so the arc lands near it
      const v = new THREE.Vector3(dir.x, dir.y + 0.28, dir.z).normalize().multiplyScalar(GRENADE.throwSpeed);
      v.add(new THREE.Vector3(P.vel.x, 0, P.vel.z).multiplyScalar(0.5));
      G.explosives.throwGrenade('player', start, v, cooked + 0.3);
      G.stats.grenades++;
    }, 300);
  }

  /* ---------- per frame ---------- */

  const killerHead = new THREE.Vector3();

  P.update = (dt, input, settings) => {
    const ch = P.char;
    if (!P.alive) {
      ch.root.position.copy(P.pos);
      ch.update(dt, G.world.groundAt(P.pos.x, P.pos.z, P.pos.y + 0.5));
      // the camera turns to the man who did it and follows him
      const k = P.killer && !P.killer.dead ? P.killer.char.headWorld(killerHead) : null;
      G.rig.deathCam(dt, P.pos, k);
      return;
    }
    const w = weaponDef();
    const [mx, my] = input.consumeMouse();
    G.rig.look(mx, my, settings.sensitivity, settings.invertY);

    // weapon selection
    if (input.pressed('Digit1')) switchTo('garand');
    if (input.pressed('Digit2')) switchTo('thompson');
    const wheel = input.consumeWheel();
    if (wheel) switchTo(P.weapon === 'garand' ? 'thompson' : 'garand');
    if (input.pressed('KeyQ')) G.rig.shoulder *= -1;
    if (input.pressed('KeyC') || input.pressed('Control')) P.crouch = !P.crouch;
    if (input.pressed('KeyR')) startReload();

    // movement intent in camera space
    let fx = 0, fz = 0;
    if (input.held('KeyW')) fz += 1;
    if (input.held('KeyS')) fz -= 1;
    if (input.held('KeyA')) fx += 1;
    if (input.held('KeyD')) fx -= 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const aiming = input.mouseR && P.reloading <= 0 && P.throwing <= 0;
    P.sprint = input.held('Shift') && fz > 0.3 && !aiming && P.reloading <= 0 && P.cooking < 0;
    if (P.sprint && P.crouch) P.crouch = false;

    const cy = G.rig.yaw;
    const sinY = Math.sin(cy), cosY = Math.cos(cy);
    // world direction: forward (sin, cos), left (cos, -sin)
    const wx = fz * sinY + fx * cosY;
    const wz = fz * cosY - fx * sinY;

    const ground = G.world.groundAt(P.pos.x, P.pos.z, P.pos.y, PLAYER.step);
    const depth = G.world.waterDepth(P.pos.x, P.pos.z, ground);
    P.wading = depth;
    let speed = P.crouch ? PLAYER.crouchWalk : P.sprint ? PLAYER.run : aiming ? PLAYER.aimWalk : PLAYER.walk;
    if (depth > 0.45) speed *= PLAYER.wade;
    if (P.reloading > 0 && !P.crouch) speed = Math.min(speed, PLAYER.walk * 0.8);

    // vault / jump
    if (P.vault) {
      const v = P.vault;
      v.t += dt / v.dur;
      const t = Math.min(1, v.t);
      P.pos.x = lerp(v.from.x, v.to.x, t);
      P.pos.z = lerp(v.from.z, v.to.z, t);
      P.pos.y = lerp(v.from.y, v.to.y, t) + Math.sin(t * Math.PI) * v.arc;
      if (t >= 1) { P.vault = null; P.vel.set(v.dirX * 2, 0, v.dirZ * 2); }
    } else {
      if (input.pressed('Space') && P.grounded) {
        const fdx = len > 0 ? wx : Math.sin(P.yaw), fdz = len > 0 ? wz : Math.cos(P.yaw);
        const ob = G.world.obstacleAhead(P.pos.x, P.pos.z, fdx, fdz, P.pos.y, 0.7);
        if (ob && ob.top - P.pos.y <= PLAYER.vault && ob.top - P.pos.y > PLAYER.step - 0.05) {
          // find the landing beyond the obstacle
          let landed = null;
          for (let d = 1.0; d <= 2.6; d += 0.3) {
            const lx = P.pos.x + fdx * d, lz = P.pos.z + fdz * d;
            const gy = G.world.groundAt(lx, lz, ob.top + 0.05, 0.1, 0.3);
            tmp.set(lx, gy, lz);
            const blocked = G.world.pushOut(tmp, PLAYER.radius, gy, PLAYER.height, PLAYER.step);
            if (!blocked && !G.world.tooDeep(lx, lz, PLAYER.maxWade, gy)) { landed = { x: lx, y: gy, z: lz }; break; }
          }
          if (landed) {
            P.vault = { from: P.pos.clone(), to: new THREE.Vector3(landed.x, landed.y, landed.z), t: 0, dur: 0.55, arc: Math.max(0.25, ob.top - Math.max(P.pos.y, landed.y) + 0.35), dirX: fdx, dirZ: fdz };
            P.crouch = false;
          }
        } else if (!ob || ob.top - P.pos.y <= PLAYER.step) {
          P.vel.y = PLAYER.jump;
          P.grounded = false;
        }
      }

      // horizontal velocity
      const accel = P.grounded ? PLAYER.accel : PLAYER.airAccel;
      P.vel.x = damp(P.vel.x, wx * speed, accel / 3, dt);
      P.vel.z = damp(P.vel.z, wz * speed, accel / 3, dt);
      P.vel.y -= PLAYER.gravity * dt;

      const nx = P.pos.x + P.vel.x * dt, nz = P.pos.z + P.vel.z * dt;
      tmp.set(nx, 0, nz);
      const h = P.crouch ? PLAYER.crouchHeight : PLAYER.height;
      G.world.pushOut(tmp, PLAYER.radius, P.pos.y, h, PLAYER.step);
      // deep water is a wall
      if (G.world.tooDeep(tmp.x, tmp.z, PLAYER.maxWade, P.pos.y)) {
        if (!G.world.tooDeep(tmp.x, P.pos.z, PLAYER.maxWade, P.pos.y)) tmp.z = P.pos.z;
        else if (!G.world.tooDeep(P.pos.x, tmp.z, PLAYER.maxWade, P.pos.y)) tmp.x = P.pos.x;
        else { tmp.x = P.pos.x; tmp.z = P.pos.z; }
      }
      // level bounds
      const B = G.level.playBounds;
      if (B) { tmp.x = clamp(tmp.x, B.minX, B.maxX); tmp.z = clamp(tmp.z, B.minZ, B.maxZ); }
      P.pos.x = tmp.x; P.pos.z = tmp.z;
      P.pos.y += P.vel.y * dt;
      const g2 = G.world.groundAt(P.pos.x, P.pos.z, Math.max(P.pos.y, ground), PLAYER.step);
      if (P.pos.y <= g2) {
        if (!P.grounded && P.vel.y < -6) G.audio.footstep(P.pos.x, P.pos.y, P.pos.z, G.terrain.surfaceAt(P.pos.x, P.pos.z), 1.3, true);
        P.pos.y = g2; P.vel.y = 0; P.grounded = true;
      } else if (P.pos.y - g2 < 0.3 && P.vel.y <= 0 && P.grounded) {
        P.pos.y = g2; P.vel.y = 0;      // stick to slopes and steps going down
      } else P.grounded = false;
    }

    // facing
    const hSpeed = Math.hypot(P.vel.x, P.vel.z);
    P.movingSpeed = hSpeed;
    const firingRecently = G.time - P.firedAt < 1.2;
    if (aiming || firingRecently || hSpeed > 0.4 || P.cooking >= 0) P.yaw = dampAngle(P.yaw, cy, aiming ? 30 : 12, dt);
    else if (Math.abs(wrapAngle(cy - P.yaw)) > 1.2) P.yaw = dampAngle(P.yaw, cy, 4, dt);

    // timers
    P.cooldown -= dt;
    P.switching -= dt;
    P.throwing -= dt;
    P.spread = Math.max(0, P.spread - w.bloomDecay * P.spread * dt);
    if (P.reloading > 0) {
      P.reloading -= dt;
      P.reloadRun?.update(1 - Math.max(0, P.reloading) / P.reloadTotal);
      if (P.reloading <= 0) { P.reloadRun?.end(); P.reloadRun = null; finishReload(); }
    }
    {
      const a = P.ammo[P.weapon];
      G.hud.reload(P.reloading > 0 ? 1 - P.reloading / P.reloadTotal : null,
        P.reloading <= 0 && a.reserve > 0 && a.mag <= Math.ceil(w.mag * 0.25));
    }

    // fire
    const canFire = P.cooldown <= 0 && P.reloading <= 0 && P.switching <= 0 && P.throwing <= 0 && !P.vault && P.cooking < 0;
    const trigger = w.auto ? input.mouseL : input.fired();
    if (trigger && canFire) {
      if (P.sprint) P.sprint = false;
      fire(aiming);
    }

    // grenades: hold G to cook, release to throw
    if (input.pressed('KeyG') && P.grenades > 0 && P.cooking < 0 && P.throwing <= 0 && P.reloading <= 0) {
      P.cooking = G.time;
      G.audio.pin();
    }
    if (P.cooking >= 0) {
      if (G.time - P.cooking > GRENADE.fuse - 0.2) throwGrenade();          // held too long: it goes anyway
      else if (!input.held('KeyG')) throwGrenade();
    }

    // health regeneration
    P.hurtTimer += dt;
    if (P.hurtTimer > 4.5 && P.health < PLAYER.health) P.heal(22 * dt);

    // stance blend, animation
    P.crouchT = damp(P.crouchT, P.crouch ? 1 : 0, 10, dt);
    const local = { f: 0, s: 0 };
    if (hSpeed > 0.2) {
      const mv = Math.atan2(P.vel.x, P.vel.z) - P.yaw;
      local.f = Math.cos(mv); local.s = Math.sin(mv);
    }
    let move;
    if (P.vault) move = 'run';
    else if (P.crouch) move = hSpeed > 0.3 ? 'crouch_walk' : 'crouch_idle';
    else if (hSpeed < 0.3) move = 'idle';
    else if (P.sprint || hSpeed > 4.2) move = 'run';
    else if (local.f > 0.5) move = 'walk';
    else if (local.f < -0.5) move = 'walk_back';
    else move = local.s > 0 ? 'strafe_l' : 'strafe_r';
    const gait = GAIT[move] ? clamp(hSpeed / GAIT[move], 0.6, 2.6) : 1;
    let upper;
    if (aiming || firingRecently) upper = P.crouch ? 'crouch_aim' : 'aim';
    else if (P.crouch) upper = hSpeed > 0.3 ? 'crouch_walk' : 'crouch_idle';
    else upper = move;
    ch.animate(move, upper, gait);
    ch.aimPitch = (aiming || firingRecently) ? clamp(G.rig.pitch, -0.9, 0.9) : clamp(G.rig.pitch * 0.4, -0.4, 0.4);

    ch.root.position.copy(P.pos);
    if (P.wading > 0.2) ch.root.position.y -= 0.0;
    ch.root.rotation.y = P.yaw;
    ch.update(dt, G.world.groundAt(P.pos.x, P.pos.z, P.pos.y + 0.2));

    // footsteps
    if (P.grounded && hSpeed > 0.5 && !P.vault) {
      P.stepAcc += dt * hSpeed / (P.sprint ? 1.6 : 1.2);
      if (P.stepAcc > 1) {
        P.stepAcc = 0;
        const surf = P.wading > 0.05 ? 'water' : G.terrain.surfaceAt(P.pos.x, P.pos.z);
        G.audio.footstep(P.pos.x, P.pos.y, P.pos.z, surf, P.crouch ? 0.5 : P.sprint ? 1.2 : 0.8, true);
        if (surf === 'water') G.effects.splash(P.pos.x, G.world.water.level, P.pos.z, 0.5);
        if (P.sprint) G.events.emit('noise', { x: P.pos.x, z: P.pos.z, radius: 12, kind: 'step' });
      }
    }

    // how easy we are to see: crouching, darkness, movement, firing
    P.visible = (P.crouch ? 0.55 : 1) * (hSpeed > 3 ? 1.15 : 1) * (firingRecently ? 1.6 : 1);

    const eye = lerp(PLAYER.eye, PLAYER.crouchEye, P.crouchT);
    G.rig.update(dt, P.pos, eye, aiming, hSpeed);
    G.hud.crosshair(lerp(w.spreadHip, w.spreadAim, G.rig.aimT) + P.spread + w.spreadMove * Math.min(1, hSpeed / 3), G.rig.aimT, G.camera.fov);
    G.hud.stance(P.crouch ? 'Crouched' : P.sprint ? 'Sprinting' : P.wading > 0.3 ? 'Wading' : 'Standing');
  };

  P.addAmmo = (fraction = 0.5) => {
    let got = false;
    for (const [k, w] of Object.entries(WEAPONS)) {
      const a = P.ammo[k];
      const max = w.reserve * 1.5;
      if (a.reserve < max) { a.reserve = Math.min(max, a.reserve + Math.ceil(w.reserve * fraction)); got = true; }
    }
    G.hud.weapon(weaponDef().name, P.ammo[P.weapon], P.grenades);
    return got;
  };
  P.addGrenades = (n) => {
    if (P.grenades >= GRENADE.max) return false;
    P.grenades = Math.min(GRENADE.max, P.grenades + n);
    G.hud.weapon(weaponDef().name, P.ammo[P.weapon], P.grenades);
    return true;
  };

  return P;
}
