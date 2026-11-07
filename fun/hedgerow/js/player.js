/* Hedgerow — the player soldier.

   First person: the soldier faces where the camera looks and carries his
   rifle shouldered (lowered at a sprint, while changing weapons, or when a
   wall is closer than its muzzle); the camera rides at his eyes, his head
   folded away, so his arms, rifle, chest and legs are his own animated body.
   Aiming puts the eye behind the rear sight; his body turns and his spine
   bends a little more or less until the sights lie along the view, so the
   sight picture is true and recoil lifts the rifle off it before it
   settles back. (CAMERA.firstPerson off: the old over-the-shoulder view, the
   soldier turning with the camera more lazily when idle.)

   Walking, sprinting, crouching, wading, vaulting low cover and jumping
   share one capsule against the world. Two weapons (Garand, Thompson),
   grenades that can be cooked, health that comes back when out of fire. A
   blast close by leaves him dazed for a few seconds (daze.js): slower on
   his feet and slower to turn, the view swimming.

   Down the sights the aim is never quite still: it wanders in a slow loop
   with his breath and pulse, more on the move, winded or dazed, less
   crouched. Shift while aiming holds the breath and the sights settle for
   up to four seconds; held longer, he lets it out hard and the sights
   shake until he has his breath back. Q and E lean him out to the left or
   right round cover (his whole body rolls over his feet, so his eyes and
   the rifle go out together, as far as the wall beside him lets them). */

import * as THREE from 'three';
import { PLAYER, WEAPONS, GRENADE, GAIT, CAMERA } from './config.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from './util.js';
import { createCharacter } from './character.js';
import { rayEnemies } from './combat.js';
import { instantiate } from './assets.js';
import { startReload as reloadSequence, startFirstPersonReload } from './reload.js';
import { SHOT, MOVE } from './world.js';
import { createViewMotion } from './viewmotion.js';
import { createDaze } from './daze.js';
import { missionLoadout, loadoutInventory } from './loadout.js';
import { attachResistanceIdentity } from './resistance-kit.js';
import { BOLT_CYCLE_DURATION } from './kar98k-action.js';
import { KAR98K_ACTION_TIMING } from './weapon-action-timing.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), dir = new THREE.Vector3();

/* First person, the arms' poses about the chest (character.js liftArms; radians): the rifle canted
   low at a sprint; down and aside at a wall, a low ready that draws the muzzle back out of the
   picture (swung up, the right hand on the grip came to the eye and filled the view); down out of
   sight while changing weapons. None brings an arm within a hand's breadth of the eye (fp-check). */
/* Holding the breath down the sights (seconds), the sway it steadies (radians), the lean. */
export const BREATH = { hold: 4, winded: 2.5, refill: 0.8 };
const SWAY = 0.0032;
const LEAN = 0.2;          // the body's roll fully out: the eyes some 0.33 m to the side

export const ARMS = {
  sprint: { pitch: -0.15, yaw: -0.1, roll: -0.45 },
  wall: { pitch: -0.5, yaw: 0.55, roll: -0.3 },
  away: { pitch: -0.8, yaw: 0, roll: 0 },
};

// Check a new candidate once at Space input.
// Each midpoint body conservatively encloses the standing body throughout
// the small arc segment; retain the player's existing step/support policy.
function vaultArcIsClear(world, from, to, arc) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const bound = distance + Math.abs(to.y - from.y) + Math.PI * arc;
  const segments = Math.max(4, Math.ceil(bound / .05));
  if (!Number.isFinite(segments) || segments > 192) return false;
  const bulge = arc * Math.PI * Math.PI / (8 * segments * segments);
  const q = { x: from.x, z: from.z };
  let ax = from.x, ay = from.y, az = from.z;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments, bx = from.x + (to.x - from.x) * t,
      bz = from.z + (to.z - from.z) * t,
      by = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * arc;
    const x = (ax + bx) * .5, z = (az + bz) * .5;
    q.x = x; q.z = z;
    const blocked = world.pushOut(q, PLAYER.radius + Math.hypot(bx - ax, bz - az) * .5,
      Math.min(ay, by), PLAYER.height + Math.abs(by - ay) + bulge, PLAYER.step);
    if (blocked || Math.hypot(q.x - x, q.z - z) > 1e-6) return false;
    ax = bx; ay = by; az = bz;
  }
  return true;
}

export function createPlayer(G) {
  const loadout = missionLoadout(G.level);
  const P = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, alive: true, health: PLAYER.health,
    crouch: false, crouchT: 0, sprint: false, grounded: true,
    hurtTimer: 99, regenHold: 0,
    weapon: loadout[0], loadout, ammo: {}, grenades: GRENADE.carry,
    cooldown: 0, reloading: 0, switching: 0, spread: 0, boltAge: -1,
    cooking: -1, throwing: 0,
    vault: null, wading: 0,
    stepAcc: 0, steps: 0, firedAt: -10, lastHurtDir: 0,
    char: null, movingSpeed: 0, visible: 1, noise: 0,
    stats: null,
    yawFix: 0, pitchFix: 0, blocked: false, arms: { pitch: 0, yaw: 0, roll: 0 },
    daze: 0, dazeT: 99,
    lean: 0, leanX: 0, leanZ: 0,            // -1..1 (to his left), and how far the head is out in x, z
    breath: BREATH.hold, winded: 0, holding: false,
    suppression: 0, suppressedAt: -99, beat: 0,   // pinned down by fire close past him (0..1)
  };
  const FP = !!CAMERA.firstPerson;
  // the eyes from the head bone: up and forward of it, in metres; and, not
  // aiming, the eye a little up, left and back of the stock (the rifle low
  // and right in the picture, the crosshair clear)
  const EYE_UP = 0.09, EYE_FORWARD = 0.08;
  const HIP_UP = 0.035, HIP_LEFT = 0.055, HIP_BACK = 0.03;
  const eyeOff = new THREE.Vector3(0, PLAYER.eye, 0);
  // the rifle's lag behind quick turns, its kick, the dip of a landing (viewmotion.js)
  const motion = createViewMotion();
  let vm = { yaw: 0, pitch: 0, drop: 0 };
  // stunned by a blast close by, wearing off (daze.js)
  const dazed = createDaze();
  // The hand releases 300 ms into the throw clip. This belongs to the
  // simulation clock so pause, death and checkpoint retries can stop it.
  let grenadeRelease = null;
  // Empty-magazine reloads run on the same clock as movement and weapon
  // actions. A browser timer could otherwise start one while paused, or
  // after a checkpoint has restored a different weapon.
  let autoReload = null;
  let emptyTriggerLatched = false;
  let boltCasePending = false;
  const boltCasePoint = new THREE.Vector3(), boltForward = new THREE.Vector3();

  // Test a requested stand against the real standing body before changing
  // posture. The scratch position absorbs corrections; player feet stay put.
  function canStand() {
    tmp.set(P.pos.x, 0, P.pos.z);
    return !G.world.pushOut(tmp, PLAYER.radius, P.pos.y, PLAYER.height, PLAYER.step);
  }

  const charOpts = () => ({ outfit: G.level?.playerOutfit === 'axis' ? 'axis' : 'allied', weaponModel: G.models.get(WEAPONS[P.weapon].model), grenadeModel: G.models.get(G.level?.playerGrenade || 'grenade_us'), scene: G.scene, weaponActions: FP });
  let identityKit = null;
  P.char = createCharacter(G.soldier, G.matlib, charOpts());
  identityKit = attachResistanceIdentity(P.char, G.matlib, G.level?.playerIdentity);
  G.scene.add(P.char.root);
  P.releaseGraphicsResources = () => identityKit?.releaseGraphicsResources();

  P.reset = (spawn, keepInventory = null) => {
    grenadeRelease = null;
    autoReload = null;
    emptyTriggerLatched = false;
    cancelBolt();
    P.char.cancelGrenade?.();
    G.audio.cancelActions?.();
    P.pos.set(spawn[0], 0, spawn[1]);
    P.pos.y = G.world.groundAt(P.pos.x, P.pos.z, 1e4, 0.5);
    P.vel.set(0, 0, 0);
    P.stepAcc = 0;
    P.yaw = spawn[2] || 0;
    G.rig.yaw = P.yaw; G.rig.pitch = -0.08;
    P.alive = true; P.health = PLAYER.health; P.killer = null;
    G.rig.resetDeathCam?.();
    P.crouch = false; P.crouchT = 0;
    P.cooldown = 0; P.reloading = 0; P.switching = 0; P.cooking = -1; P.throwing = 0; P.vault = null;
    P.reloadRun?.end?.();
    P.reloadRun = null;
    P.char.holdLeft?.(null);
    Object.assign(P, loadoutInventory(loadout, keepInventory));
    if (P.char.dead) {
      identityKit?.dispose();
      P.char.dispose();
      P.char = createCharacter(G.soldier, G.matlib, charOpts());
      identityKit = attachResistanceIdentity(P.char, G.matlib, G.level?.playerIdentity);
      G.scene.add(P.char.root);
    } else {
      P.char.setWeapon(G.models.get(WEAPONS[P.weapon].model));
    }
    P.char.root.position.copy(P.pos);
    P.char.root.rotation.y = P.yaw;
    P.char.hideHead(FP);
    P.char.steady = FP;
    P.lean = 0; P.leanX = P.leanZ = 0; G.rig.lean = 0; P.char.root.rotation.z = 0;
    P.breath = BREATH.hold; P.winded = 0; P.holding = false;
    P.suppression = 0; P.suppressedAt = -99; P.beat = 0;
    G.rig.swayYaw = G.rig.swayPitch = 0;
    P.yawFix = 0; P.pitchFix = 0; P.blocked = false; P.arms = { pitch: 0, yaw: 0, roll: 0 }; P.pendingWeapon = null;
    motion.reset(); vm = { yaw: 0, pitch: 0, drop: 0 };
    dazed.reset(); P.daze = 0; P.dazeT = 99;
    eyeOff.set(0, PLAYER.eye, 0);
    G.hud.health(P.health / PLAYER.health);
    G.hud.weapon(weaponDef().name, P.ammo[P.weapon], P.grenades);
  };

  P.inventory = () => ({ ammo: JSON.parse(JSON.stringify(P.ammo)), grenades: P.grenades, weapon: P.weapon });

  /* `by`: the enemy who fired or threw (for the camera that turns to him) */
  P.damage = (amount, from, kind = 'bullet', by = null) => {
    if (!P.alive || G.godMode) return;
    P.health -= amount;
    P.hurtTimer = 0;
    G.stats.damageTaken += amount;
    G.audio.ui('hurt');
    P.suppress(kind === 'bullet' ? 0.8 : 1.5);
    G.rig.addShake(kind === 'bullet' ? 0.25 : 0.6);
    if (from) {
      const ang = Math.atan2(from.x - P.pos.x, from.z - P.pos.z);
      G.hud.damageFrom(wrapAngle(ang - G.rig.yaw));
      if (FP) G.rig.flinch(wrapAngle(ang - G.rig.yaw), kind === 'bullet' ? 1 : 2);
    }
    if (P.health <= 0) {
      P.health = 0;
      P.alive = false;
      grenadeRelease = null; P.cooking = -1; P.throwing = 0;
      autoReload = null;
      cancelBolt();
      P.reloadRun?.end(); P.reloadRun = null; P.reloading = 0;
      P.killer = by;
      P.diedAt = G.time;
      const back = from ? Math.cos(Math.atan2(from.x - P.pos.x, from.z - P.pos.z) - P.yaw) < 0 : false;
      const impulses = [];
      if (from) {
        const dir = new THREE.Vector3(P.pos.x - from.x, 0, P.pos.z - from.z).normalize();
        const k = kind === 'bullet' ? 3.0 : 7;
        impulses.push({ part: kind === 'bullet' ? 'body' : 'all', vel: dir.multiplyScalar(k).add(new THREE.Vector3(0, kind === 'bullet' ? 0.4 : 3.5, 0)) });
      }
      P.lean = 0; P.leanX = P.leanZ = 0; G.rig.lean = 0; G.rig.swayYaw = G.rig.swayPitch = 0;
      P.char.root.rotation.z = 0;
      P.suppression = 0;
      if (!FP) P.char.hideHead(false);      // first person: the eyes go down with him; the head shows once the camera has left it
      P.headBack = !FP;
      const fallenChar = P.char;
      P.char.die(back ? 'death_back' : 'death_fwd', { world: G.world, velocity: P.vel.clone(), impulses,
        onImpact: ({ x, y, z, surface, speed }) => {
          if (!P.alive && P.char === fallenChar) G.audio.bodyImpact(x, y, z, surface, speed, true);
        },
      });
      if (!P.char.ragdoll) G.audio.bodyFall(P.pos.x, P.pos.y, P.pos.z, G.world.surfaceUnder(P.pos.x, P.pos.y, P.pos.z), 0.45, true);
      if (G.debris && P.char.weapon && P.char.ragdoll) G.debris.drop(P.char.weapon, new THREE.Vector3(0, 1, 0), { spin: 4, radius: 0.08 });
      G.events.emit('playerDied');
    }
    G.hud.health(P.health / PLAYER.health);
  };

  /* A round cracking past or striking close by (ai.js): `amount` 0..1, how close. A burst
     builds it up; it ebbs a second and a half after the last. */
  P.suppress = (amount) => {
    if (!P.alive) return;
    P.suppression = Math.min(1, P.suppression + amount * 0.3);
    P.suppressedAt = G.time;
  };

  /* a blast close by (combat.js): 0..1, how hard it hit him */
  P.concuss = (amount) => { if (P.alive) dazed.hit(amount); };

  P.heal = (amount) => {
    P.health = Math.min(PLAYER.health, P.health + amount);
    G.hud.health(P.health / PLAYER.health);
  };

  function weaponDef() { return WEAPONS[P.weapon]; }
  function cancelBolt() {
    P.boltAge = -1; boltCasePending = false;
    P.char.boltAge = -1; P.char.boltReload = false;
    P.char.cancelWeaponAction?.();
  }

  function switchTo(id) {
    if (id === P.weapon || P.switching > 0 || P.cooking >= 0 || P.throwing > 0 || !loadout.includes(id)) return;
    autoReload = null;
    cancelBolt();
    P.reloadRun?.end();
    P.reloadRun = null;
    P.weapon = id;
    emptyTriggerLatched = false;
    P.reloading = 0;
    // first person: the gun in his hands goes down out of sight, is changed there, the new one comes up
    if (FP) { P.switching = 0.5; P.pendingWeapon = id; }
    else { P.switching = 0.45; P.char.setWeapon(G.models.get(WEAPONS[id].model)); }
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
    if (P.reloading > 0 || a.mag >= w.mag || a.reserve <= 0 || P.switching > 0 || P.cooking >= 0 || P.throwing > 0) return false;
    autoReload = null;
    P.boltAge = -1;
    P.reloading = P.reloadTotal = w.reload;
    P.reloadRun?.end();
    if (FP) P.reloadRun = startFirstPersonReload(G, P.char, w);
    else {
      const clip = w.kind === 'smg' && P.char.hasClip('reload_smg') ? 'reload_smg' : 'reload';
      P.char.oneShot(clip, (P.char.clipLength(clip) || 1.6) / w.reload);
      P.reloadRun = reloadSequence(G, P.char, w, clip);
    }
    G.audio.reload(P.weapon);
    return true;
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
      if (!emptyTriggerLatched) G.audio.dryFire();
      emptyTriggerLatched = true;
      P.cooldown = 0.25;
      if (a.reserve > 0) startReload();
      return;
    }
    emptyTriggerLatched = false;
    a.mag--;
    P.cooldown = w.interval;
    P.firedAt = G.time;
    G.stats.shots++;
    // spread: hip/aim, movement, bloom
    const moving = Math.min(1, P.movingSpeed / 3);
    let spread = lerp(w.spreadHip, w.spreadAim, G.rig.aimT) + w.spreadMove * moving * (P.crouch ? 0.5 : 1) + P.spread;
    spread *= 1 + 0.6 * P.suppression;      // shooting back while pinned down: hurried
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
    const camHit = traceShot(cam, dir, w);
    // from the muzzle to what the crosshair found
    const muzzle = P.char.muzzleWorld(new THREE.Vector3());
    const target = camHit ? camHit.point : tmp.copy(cam).addScaledVector(dir, w.range);
    const md = new THREE.Vector3().subVectors(target, muzzle);
    const mlen = md.length();
    md.divideScalar(mlen || 1);
    let finalHit = camHit;
    // (what stands between the muzzle and the first thing the round went through or hit)
    const first = camHit?.through[0];
    const clearTo = first ? Math.hypot(first.x - muzzle.x, first.y - muzzle.y, first.z - muzzle.z) : mlen;
    const block = G.world.raycast(muzzle.x, muzzle.y, muzzle.z, md.x, md.y, md.z, Math.max(0, clearTo - 0.3), SHOT);
    if (block && mlen > 0.5) {
      finalHit = { point: new THREE.Vector3(block.x, block.y, block.z), world: block, through: [], keep: 1, dist: block.t };
    }
    // effects
    G.effects.muzzle(muzzle.x, muzzle.y, muzzle.z, md.x, md.y, md.z, w.kind === 'rifle' ? 1.2 : 0.9);
    if (w.action === 'bolt') {
      // A manually worked rifle retains its case until the bolt is drawn
      // back. A full reload can take over before the shot cycle begins.
      P.boltAge = 0; boltCasePending = true;
    } else {
      G.effects.shell(muzzle.x - md.x * 0.5, muzzle.y, muzzle.z - md.z * 0.5, -md.z, md.x);
    }
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
    if (FP) motion.kick((w.kick ?? 0.04) * (P.crouch ? 0.8 : 1) * lerp(1, 0.75, G.rig.aimT));
    G.events.emit('noise', { x: P.pos.x, z: P.pos.z, radius: 75, kind: 'shot' });

    if (finalHit) {
      const p = finalHit.point;
      // through planks or canvas: splinters where it went in and where it came out
      for (const h of finalHit.through) {
        G.effects.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.surface, dir.x, dir.y, dir.z);
        G.decals?.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.surface);
        G.audio.impact(h.x, h.y, h.z, h.surface);
        G.effects.impact(h.ox, h.oy, h.oz, dir.x, dir.y, dir.z, h.surface, dir.x, dir.y, dir.z);
      }
      if (finalHit.enemy) {
        const e = finalHit.enemy;
        const mul = finalHit.part === 'head' ? w.headMul : finalHit.part === 'legs' ? w.limbMul : 1;
        // the round slowing over the distance, and what it went through first
        const [near, far, least] = w.falloff || [Infinity, Infinity, 1];
        const fall = lerp(1, least, clamp((finalHit.dist - near) / (far - near), 0, 1));
        const killed = e.damage(w.damage * mul * fall * finalHit.keep, P.pos, finalHit.part, true);
        G.effects.blood(p.x, p.y, p.z, dir.x, dir.y, dir.z);
        G.audio.impact(p.x, p.y, p.z, 'flesh');
        G.stats.hits++;
        if (finalHit.part === 'head') G.stats.headHits++;
        G.hud.hitmark(killed);
        G.audio.ui(killed ? 'kill' : 'hit');
      } else if (finalHit.world) {
        const h = finalHit.world;
        if (!G.pragueGlass?.impact(h, finalHit === camHit ? dir : md)) {
          G.effects.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.surface || 'stone', dir.x, dir.y, dir.z);
          G.decals?.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.surface || 'stone');
          G.audio.impact(h.x, h.y, h.z, h.surface);
        }
        // near misses keep enemies' heads down
        for (const e of G.enemies) {
          if (!e.dead && Math.hypot(e.pos.x - h.x, e.pos.y + 1 - h.y, e.pos.z - h.z) < 2.2) e.suppress(1.2, P.pos);
        }
      }
    }
    G.hud.weapon(w.name, a, P.grenades);
    if (a.mag === 0 && a.reserve > 0) autoReload = { weapon: P.weapon, ammo: a, delay: 0.25 };
  }

  function ejectBoltCase() {
    boltCasePending = false;
    const gun = P.char.weapon;
    if (gun) {
      gun.localToWorld(boltCasePoint.set(-.02, .055, -.03));
      boltForward.set(0, 0, 1).transformDirection(gun.matrixWorld);
    } else {
      boltCasePoint.copy(P.pos).y += 1.35;
      boltForward.set(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    }
    G.effects.shell(boltCasePoint.x, boltCasePoint.y, boltCasePoint.z, -boltForward.z, boltForward.x);
  }

  /* The round from the eye along `d`: the first man or thing it hits, after going through at most
     one thin board, crate side or canvas (`through`: where it went in, and out at ox, oy, oz), with
     `keep` of its damage left and `dist` metres travelled. */
  const PIERCED = new Set(['wood', 'canvas', 'fabric', 'planks']);
  function traceShot(o, d, w) {
    const from = new THREE.Vector3().copy(o), through = [];
    let keep = 1, gone = 0;
    for (;;) {
      const range = w.range - gone;
      const wh = G.world.raycast(from.x, from.y, from.z, d.x, d.y, d.z, range, SHOT);
      const eh = rayEnemies(G.enemies, from, d, wh ? wh.t : range);
      if (eh) return { point: from.clone().addScaledVector(d, eh.t), enemy: eh.enemy, part: eh.part, through, keep, dist: gone + eh.t };
      if (wh && !through.length && PIERCED.has(wh.surface) && typeof wh.collider === 'object' && w.pierce) {
        const depth = G.world.depthThrough(wh.collider, wh.x, wh.y, wh.z, d.x, d.y, d.z);
        if (depth <= w.pierce) {
          from.set(wh.x, wh.y, wh.z).addScaledVector(d, depth + 0.02);
          through.push({ ...wh, ox: from.x, oy: from.y, oz: from.z });
          gone += wh.t + depth + 0.02;
          keep *= w.pierceKeep;
          continue;
        }
      }
      if (wh) return { point: new THREE.Vector3(wh.x, wh.y, wh.z), world: wh, through, keep, dist: gone + wh.t };
      // through the board and on into the distance
      return through.length ? { point: from.clone().addScaledVector(d, range), through, keep, dist: w.range } : null;
    }
  }

  function throwGrenade(dt) {
    const cooked = P.cooking >= 0 ? G.time - P.cooking : 0;
    P.cooking = -1;
    P.grenades--;
    P.throwing = 0.9;
    P.char.oneShot('throw', 1.2, dt);
    G.hud.weapon(weaponDef().name, P.ammo[P.weapon], P.grenades);
    grenadeRelease = { delay: 0.3, cooked };
  }

  function releaseGrenade() {
    const pending = grenadeRelease;
    grenadeRelease = null;            // one release, even if a long frame crosses the beat
    G.rig.forward(dir);
    const hand = new THREE.Vector3();
    if (!P.char.heldGrenadeWorld?.(hand)) P.char.boneWorld('hand_r', hand);
    const start = hand.lengthSq() > 0 ? hand : P.pos.clone().setY(P.pos.y + 1.6);
    // Keep the small projectile on this side of a nearby solid even when
    // the authored throwing arm reaches across its face.
    const eye = G.camera.position, offset = new THREE.Vector3().subVectors(start, eye), distance = offset.length();
    if (distance > 1e-6) {
      offset.divideScalar(distance);
      const obstruction = G.world.raycast(eye.x, eye.y, eye.z, offset.x, offset.y, offset.z, distance + .06, MOVE, { noWater: true });
      if (obstruction && obstruction.t < distance + .06) start.copy(eye).addScaledVector(offset, Math.max(0, obstruction.t - .06));
    }
    // aim a little above the crosshair so the arc lands near it
    const v = new THREE.Vector3(dir.x, dir.y + 0.28, dir.z).normalize().multiplyScalar(GRENADE.throwSpeed);
    v.add(new THREE.Vector3(P.vel.x, 0, P.vel.z).multiplyScalar(0.5));
    const flight = G.explosives.throwGrenade('player', start, v, pending.cooked + 0.3);
    if (flight?.mesh) P.char.heldGrenadeRotation?.(flight.mesh.quaternion);
    P.char.releaseHeldGrenade?.();
    G.stats.grenades++;
  }

  /* ---------- first person ---------- */

  const eyeW = new THREE.Vector3(), rearW = new THREE.Vector3(), frontW = new THREE.Vector3();
  const sightW = new THREE.Vector3(), sDir = new THREE.Vector3(), vDir = new THREE.Vector3();

  /* The camera at his eyes (and down his sights when aiming), after his body
     has been posed for the frame. */
  function firstPersonView(dt, w, aiming, hSpeed, strafe) {
    const ch = P.char;
    // the eyes: above and in front of the head bone; the offset from the feet is
    // smoothed, so his steps bob the view without the jitter of the clips
    ch.headWorld(eyeW);
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    eyeW.x += sy * (EYE_FORWARD - HIP_BACK) + cy * HIP_LEFT;
    eyeW.z += cy * (EYE_FORWARD - HIP_BACK) - sy * HIP_LEFT;
    eyeW.y += EYE_UP + HIP_UP;
    eyeW.sub(P.pos);
    const k = 1 - Math.exp(-22 * dt);
    eyeOff.lerp(eyeW, k);
    eyeW.copy(P.pos).add(eyeOff);
    eyeW.y += vm.drop;
    // the rifle's sight line, and the eye's place behind it
    let sight = null;
    const wpn = ch.weapon;
    if (wpn && w.sight && (ch.upper === 'aim' || ch.upper === 'crouch_aim') && Math.abs(P.arms.pitch) + Math.abs(P.arms.yaw) + Math.abs(P.arms.roll) < 0.05) {
      wpn.localToWorld(rearW.fromArray(w.sight.rear));
      wpn.localToWorld(frontW.fromArray(w.sight.front));
      sDir.subVectors(frontW, rearW).normalize();
      sight = sightW.copy(rearW).addScaledVector(sDir, -w.sight.relief);
      // turn the body and bend the spine until the sights lie along the view
      G.rig.forward(vDir);
      // (the sway and the kick are passing: what they move is not to be corrected)
      const eYaw = wrapAngle(Math.atan2(vDir.x, vDir.z) - Math.atan2(sDir.x, sDir.z)) + vm.yaw;
      const ePitch = Math.asin(clamp(vDir.y, -1, 1)) - Math.asin(clamp(sDir.y, -1, 1)) + vm.pitch;
      const g = 1 - Math.exp(-14 * dt);
      P.yawFix = clamp(P.yawFix + eYaw * g, -0.6, 0.6);
      P.pitchFix = clamp(P.pitchFix + ePitch * g, -0.6, 0.6);
    }
    // a wall nearer than the muzzle: the rifle comes down (next frame's pose)
    G.rig.forward(vDir);
    P.blocked = !!G.world.raycast(eyeW.x, eyeW.y, eyeW.z, vDir.x, vDir.y, vDir.z, w.reach || 0.8, SHOT, { noWater: true });
    G.rig.updateFirstPerson(dt, eyeW, P.blocked ? null : sight, aiming, { moveSpeed: hSpeed, strafe, sprint: P.sprint, steps: P.steps + P.stepAcc });
  }

  /* The breath held or not, the sights' sway, the lean (first person). */
  function steady(dt, input, aiming, hSpeed) {
    // the breath: Shift down the sights holds it, until it runs out
    const wantHold = aiming && G.rig.aimT > 0.5 && input.held('Shift') && P.winded <= 0;
    if (wantHold && !P.holding && P.breath > 0.5) { P.holding = true; G.audio.gear('inhale'); }
    else if (P.holding && !wantHold) { P.holding = false; G.audio.gear('exhale'); }
    if (P.holding) {
      P.breath -= dt;
      if (P.breath <= 0) { P.breath = 0; P.holding = false; P.winded = BREATH.winded; G.audio.gear('gasp'); }
    } else {
      P.winded = Math.max(0, P.winded - dt);
      P.breath = Math.min(BREATH.hold, P.breath + BREATH.refill * dt);
    }
    // the sway: a slow figure of eight, a quicker tremor over it, down the sights only
    const t = G.time;
    const amp = SWAY * G.rig.aimT
      * (P.crouch ? 0.6 : 1) * (1 + Math.min(1, hSpeed / 2.5) * 1.5) * (1 + 3 * P.daze)
      * (P.holding ? 0.12 : P.winded > 0 ? 1 + 1.6 * P.winded / BREATH.winded : 1)
      * (1 + 2.5 * P.suppression);
    const k = 1 - Math.exp(-6 * dt);       // eased, so holding the breath settles rather than snaps
    G.rig.swayYaw += (amp * (Math.sin(t * 0.9) + 0.35 * Math.sin(t * 2.7 + 1.3)) - G.rig.swayYaw) * k;
    G.rig.swayPitch += (amp * (0.55 * Math.sin(t * 1.8 + 0.4) + 0.3 * Math.sin(t * 3.4)) - G.rig.swayPitch) * k;

    // the lean: Q out to the left, E to the right, not at a sprint or in the air; only as far
    // as the wall on that side lets the head go
    let want = (input.held('KeyQ') ? 1 : 0) - (input.held('KeyE') ? 1 : 0);
    if (P.sprint || P.vault || !P.grounded) want = 0;
    if (want) {
      const lx = Math.cos(G.rig.yaw) * want, lz = -Math.sin(G.rig.yaw) * want;
      const eyeY = P.pos.y + lerp(PLAYER.eye, PLAYER.crouchEye, P.crouchT);
      const reach = 0.33 + 0.2;
      const hit = G.world.raycast(P.pos.x, eyeY, P.pos.z, lx, 0, lz, reach, SHOT, { noWater: true });
      if (hit) want *= clamp((hit.t - 0.2) / 0.33, 0, 1);
    }
    if (Math.abs(want) > 0.5 && Math.abs(P.lean) < 0.2 && Math.sign(want) !== Math.sign(P.leanSaid || 0)) G.audio.gear('lean');
    P.leanSaid = Math.abs(want) > 0.5 ? Math.sign(want) : 0;
    P.lean = damp(P.lean, want, 9, dt);
    G.rig.lean = P.lean * LEAN;
    // where the head is, for the enemy's eyes (the roll swings it out about the feet)
    const out = Math.sin(P.lean * LEAN) * lerp(PLAYER.eye, PLAYER.crouchEye, P.crouchT);
    P.leanX = Math.cos(G.rig.yaw) * out; P.leanZ = -Math.sin(G.rig.yaw) * out;
  }

  /* ---------- per frame ---------- */

  const killerHead = new THREE.Vector3();
  const deathEye = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };

  P.update = (dt, input, settings) => {
    const ch = P.char;
    // a blast's daze wearing off (on through the death camera: the ears still ring)
    P.daze = dazed.update(dt);
    P.dazeT = dazed.t;
    G.rig.daze = P.alive ? P.daze : 0;
    if (!P.alive) {
      grenadeRelease = null;
      ch.root.position.copy(P.pos);
      ch.update(dt, G.world.groundAt(P.pos.x, P.pos.z, P.pos.y + 0.5));
      // the camera turns to the man who did it and follows him (first person: after
      // going down with the body for a moment)
      const k = P.killer && !P.killer.dead ? P.killer.char.headWorld(killerHead) : null;
      let eye = null;
      if (FP && ch.bones?.head) {
        eye = deathEye;
        ch.bones.head.getWorldPosition(eye.pos);
        ch.bones.head.getWorldQuaternion(eye.quat);
      }
      G.rig.deathCam(dt, P.pos, k, eye);
      if (!P.headBack && k && G.rig.deathTime() > 1.1) { ch.hideHead(false); P.headBack = true; }
      return;
    }
    // Tick an existing wind-up before processing a new G release below;
    // a throw started this frame gets its full 300 ms animation lead-in.
    const reloadingAtStart = P.reloading > 0;
    if (grenadeRelease) grenadeRelease.delay -= dt;
    if (P.boltAge >= 0) P.boltAge = Math.min(BOLT_CYCLE_DURATION, P.boltAge + dt);
    if (autoReload) {
      autoReload.delay -= dt;
      if (autoReload.delay <= 1e-9) {
        const queued = autoReload;
        if (queued.weapon !== P.weapon || P.ammo[P.weapon] !== queued.ammo || queued.ammo.mag !== 0 || queued.ammo.reserve <= 0) autoReload = null;
        else startReload(); // a grenade action can defer, rather than lose, the request
      }
    }
    const [mx, my] = input.consumeMouse();
    G.rig.look(mx, my, settings.sensitivity * (1 - 0.25 * P.daze), settings.invertY);

    // weapon selection
    if (input.pressed('Digit1')) switchTo(loadout[0]);
    if (input.pressed('Digit2') && loadout[1]) switchTo(loadout[1]);
    const wheel = input.consumeWheel();
    if (wheel && loadout.length > 1) switchTo(loadout[(loadout.indexOf(P.weapon) + 1) % loadout.length]);
    const w = weaponDef();
    if (!FP && input.pressed('KeyQ')) G.rig.shoulder *= -1;
    if ((input.pressed('KeyC') || input.pressed('Control')) && (!P.crouch || canStand())) {
      P.crouch = !P.crouch; G.audio.gear(P.crouch ? 'crouch' : 'stand');
    }
    if (input.pressed('KeyR')) startReload();

    // movement intent in camera space
    let fx = 0, fz = 0;
    if (input.held('KeyW')) fz += 1;
    if (input.held('KeyS')) fz -= 1;
    if (input.held('KeyA')) fx += 1;
    if (input.held('KeyD')) fx -= 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const aiming = input.mouseR && P.reloading <= 0 && P.cooking < 0 && P.throwing <= 0 && P.switching <= 0 && P.boltAge < 0;
    if (aiming && !P.wasAiming) G.audio.gear('aim');
    P.wasAiming = aiming;
    P.sprint = input.held('Shift') && fz > 0.3 && !aiming && P.reloading <= 0 && P.cooking < 0;
    if (P.sprint && P.crouch) {
      if (canStand()) P.crouch = false;
      else P.sprint = false;
    }

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
    speed *= 1 - 0.4 * P.daze;            // dazed, he stumbles along

    // Footfalls follow resolved ordinary movement, not velocity into a wall.
    let stepDistance = 0;

    // vault / jump
    // A new vault takes over this update before ordinary movement can
    // move the body away from the saved start of its arc.
    if (!P.vault && input.pressed('Space') && P.grounded) {
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
          if (!blocked && !G.world.tooDeep(lx, lz, PLAYER.maxWade, gy)) {
            const candidate = { x: lx, y: gy, z: lz };
            const arc = Math.max(0.25, ob.top - Math.max(P.pos.y, gy) + 0.35);
            if (vaultArcIsClear(G.world, P.pos, candidate, arc)) { landed = candidate; break; }
          }
        }
        if (landed) {
          P.vault = { from: P.pos.clone(), to: new THREE.Vector3(landed.x, landed.y, landed.z), t: 0, dur: 0.55, arc: Math.max(0.25, ob.top - Math.max(P.pos.y, landed.y) + 0.35), dirX: fdx, dirZ: fdz };
          P.crouch = false;
          G.audio.gear('jump');
        }
      } else if (!ob || ob.top - P.pos.y <= PLAYER.step) {
        P.vel.y = PLAYER.jump;
        P.grounded = false;
        G.audio.gear('jump');
      }
    }
    if (P.vault) {
      const v = P.vault;
      v.t += dt / v.dur;
      const t = Math.min(1, v.t);
      P.pos.x = lerp(v.from.x, v.to.x, t);
      P.pos.z = lerp(v.from.z, v.to.z, t);
      P.pos.y = lerp(v.from.y, v.to.y, t) + Math.sin(t * Math.PI) * v.arc;
      if (t >= 1) { P.vault = null; P.vel.set(v.dirX * 2, 0, v.dirZ * 2); }
    } else {

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
      const rise = P.vel.y * dt;
      const nextY = rise > 0 ? G.world.limitUpwardMove(P.pos.x, P.pos.z, tmp.x, tmp.z,
        PLAYER.radius, P.pos.y, h, rise) : P.pos.y + rise;
      if (nextY < P.pos.y + rise) P.vel.y = 0;
      // Collision correction cannot add more stride than this frame intended.
      stepDistance = Math.min(Math.hypot(tmp.x - P.pos.x, tmp.z - P.pos.z),
        Math.hypot(P.vel.x, P.vel.z) * Math.max(0, dt));
      P.pos.x = tmp.x; P.pos.z = tmp.z;
      P.pos.y = nextY;
      const g2 = G.world.groundAt(P.pos.x, P.pos.z, Math.max(P.pos.y, ground), PLAYER.step);
      if (P.pos.y <= g2) {
        if (FP && !P.grounded && P.vel.y < -3) motion.land(-P.vel.y);
        if (!P.grounded && P.vel.y < -6) G.audio.gear('land', G.world.surfaceUnder(P.pos.x, g2, P.pos.z));
        P.pos.y = g2; P.vel.y = 0; P.grounded = true;
      } else if (P.pos.y - g2 < 0.3 && P.vel.y <= 0 && P.grounded) {
        P.pos.y = g2; P.vel.y = 0;      // stick to slopes and steps going down
      } else P.grounded = false;
    }

    // facing
    const hSpeed = Math.hypot(P.vel.x, P.vel.z);
    P.movingSpeed = hSpeed;
    const firingRecently = G.time - P.firedAt < 1.2;
    if (FP) P.yaw = cy + P.yawFix;
    else if (aiming || firingRecently || hSpeed > 0.4 || P.cooking >= 0) P.yaw = dampAngle(P.yaw, cy, aiming ? 30 : 12, dt);
    else if (Math.abs(wrapAngle(cy - P.yaw)) > 1.2) P.yaw = dampAngle(P.yaw, cy, 4, dt);

    // pinned down: it ebbs once the fire stops; his heart pounding while it is high
    if (G.time - P.suppressedAt > 1.5) P.suppression = Math.max(0, P.suppression - 0.45 * dt);
    P.beat -= dt;
    if (P.suppression > 0.35 && P.beat <= 0) { G.audio.gear('heart', null, P.suppression); P.beat = 60 / (85 + 75 * P.suppression); }
    if (FP) steady(dt, input, aiming, hSpeed);

    // timers
    P.cooldown -= dt;
    P.switching -= dt;
    if (P.pendingWeapon && P.switching <= 0.25) { P.char.setWeapon(G.models.get(WEAPONS[P.pendingWeapon].model)); P.pendingWeapon = null; }
    P.throwing -= dt;
    P.spread = Math.max(0, P.spread - w.bloomDecay * P.spread * dt);
    if (P.reloading > 0) {
      if (reloadingAtStart) P.reloading -= dt;
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
    const pulled = input.fired();
    const trigger = w.auto ? (input.mouseL || pulled) : pulled;
    if (!trigger || pulled) emptyTriggerLatched = false;
    if (trigger && canFire) {
      if (P.sprint) P.sprint = false;
      fire(aiming);
    }

    // grenades: hold G to cook, release to throw
    if (input.pressed('KeyG') && P.grenades > 0 && P.cooking < 0 && P.throwing <= 0 && P.reloading <= 0 && P.switching <= 0) {
      if (P.boltAge >= 0) { cancelBolt(); G.audio.cancelActions?.(); }
      P.cooking = G.time;
      G.audio.pin(G.level?.playerGrenade || 'grenade_us');
    }
    if (P.cooking >= 0) {
      if (G.time - P.cooking > GRENADE.fuse - 0.2) throwGrenade(dt);          // held too long: it goes anyway
      else if (!input.held('KeyG')) throwGrenade(dt);
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
    if (FP) {
      // the rifle stays shouldered; the arms carry it canted low at a sprint, down and
      // aside at a wall, down out of sight while changing weapons, and tilt it into
      // view to reload (the throw is the clip's own)
      upper = P.crouch ? 'crouch_aim' : 'aim';
      const t = P.reloading > 0 && P.reloadRun?.pose ? P.reloadRun.pose(1 - P.reloading / P.reloadTotal)
        : P.switching > 0.25 ? ARMS.away
        : P.blocked ? ARMS.wall
        : P.boltAge >= 0 ? { pitch: -.08, yaw: .07, roll: .10 }
        : P.sprint ? ARMS.sprint
        : null;
      for (const k of ['pitch', 'yaw', 'roll']) P.arms[k] = damp(P.arms[k], t ? t[k] : 0, 10, dt);
      vm = motion.update(dt, G.rig.yaw, G.rig.pitch, G.rig.aimT);
      ch.armsPitch = P.arms.pitch + vm.pitch; ch.armsYaw = P.arms.yaw + vm.yaw; ch.armsRoll = P.arms.roll;
    } else if (aiming || firingRecently) upper = P.crouch ? 'crouch_aim' : 'aim';
    else if (P.crouch) upper = hSpeed > 0.3 ? 'crouch_walk' : 'crouch_idle';
    else upper = move;
    ch.setGrenadeHold?.(P.cooking >= 0);
    ch.animate(move, upper, gait);
    if (FP) ch.aimPitch = clamp(G.rig.pitch + P.pitchFix, -0.9, 0.9);
    else ch.aimPitch = (aiming || firingRecently) ? clamp(G.rig.pitch, -0.9, 0.9) : clamp(G.rig.pitch * 0.4, -0.4, 0.4);

    ch.root.position.copy(P.pos);
    if (P.wading > 0.2) ch.root.position.y -= 0.0;
    ch.root.rotation.y = P.yaw;
    // leaning out: the body rolls over his feet about its own forward axis (rotation order XYZ:
    // the roll is in the body's frame, before its yaw); negative z is to his left
    ch.root.rotation.z = -P.lean * LEAN;
    const boltReload = w.action === 'bolt' && P.reloading > 0;
    ch.boltReload = boltReload;
    ch.boltAge = boltReload ? P.reloadTotal - P.reloading : P.boltAge;
    ch.update(dt, G.world.groundAt(P.pos.x, P.pos.z, P.pos.y + 0.2));
    if (boltCasePending && w.action === 'bolt' && ch.boltAge >= (boltReload ? KAR98K_ACTION_TIMING.reload.eject : KAR98K_ACTION_TIMING.shot.eject)) ejectBoltCase();
    if (P.boltAge >= BOLT_CYCLE_DURATION) P.boltAge = -1;
    // footsteps
    if (P.grounded && hSpeed > 0.5 && stepDistance > 0 && !P.vault) {
      P.stepAcc += stepDistance / (P.sprint ? 1.6 : 1.2);
      if (P.stepAcc > 1) {
        P.stepAcc = 0;
        P.steps++;
        const surf = P.wading > 0.05 ? 'water' : G.world.surfaceUnder(P.pos.x, P.pos.y, P.pos.z);
        G.audio.footstep(P.pos.x, P.pos.y, P.pos.z, surf, P.crouch ? 0.5 : P.sprint ? 1.2 : 0.8, true, { run: P.sprint, wet: G.shared.wet.value });
        if (surf === 'water') G.effects.splash(P.pos.x, G.world.water.level, P.pos.z, 0.5);
        if (P.sprint) G.events.emit('noise', { x: P.pos.x, y: P.pos.y + .05, z: P.pos.z, radius: 12, kind: 'step' });
      }
    }

    // how easy we are to see: crouching, darkness, movement, firing
    P.visible = (P.crouch ? 0.55 : 1) * (hSpeed > 3 ? 1.15 : 1) * (firingRecently ? 1.6 : 1);

    if (FP) firstPersonView(dt, w, aiming, hSpeed, local.s * hSpeed);
    else G.rig.update(dt, P.pos, lerp(PLAYER.eye, PLAYER.crouchEye, P.crouchT), aiming, hSpeed);
    if (FP) ch.poseHeldGrenade?.(G.camera, dt, G.world);
    // Release from the final visible hand pose, once, at the existing
    // simulation beat. The held copy disappears when the projectile exists.
    if (grenadeRelease && grenadeRelease.delay <= 1e-9) releaseGrenade();
    G.hud.crosshair(lerp(w.spreadHip, w.spreadAim, G.rig.aimT) + P.spread + w.spreadMove * Math.min(1, hSpeed / 3), G.rig.aimT, G.camera.fov, FP);
    G.hud.stance(P.crouch ? 'Crouched' : P.sprint ? 'Sprinting' : P.wading > 0.3 ? 'Wading' : 'Standing');
  };

  P.addAmmo = (fraction = 0.5) => {
    let got = false;
    for (const k of loadout) {
      const w = WEAPONS[k];
      const a = P.ammo[k];
      const max = Math.floor(w.reserve * 1.5);
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
