/* Hedgerow — bullets and grenades.

   Player bullets are hitscan along the crosshair ray, checked against the
   enemies' hit volumes (head sphere, torso and leg capsules from their
   bones) and the world, then re-traced from the muzzle so cover in front of
   the gun still stops them. Enemy fire is resolved by the AI as a roll
   against the player's exposure; this module draws and sounds the shot.
   Grenades and charges are small rigid bodies that bounce off the world
   and explode with a radius check that respects cover. */

import * as THREE from 'three';
import { GRENADE } from './config.js';
import { SHOT, MOVE } from './world.js';
import { clamp } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/* Ray vs sphere / capsule (segment a-b, radius r). Returns t or Infinity. */
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

function rayCapsule(o, d, a, b, r) {
  // closest approach between the ray and the segment, then a sphere test there
  const ab = _c.subVectors(b, a);
  const abLen = ab.length();
  if (abLen < 1e-5) return raySphere(o.x, o.y, o.z, d.x, d.y, d.z, a.x, a.y, a.z, r);
  ab.divideScalar(abLen);
  const w0x = o.x - a.x, w0y = o.y - a.y, w0z = o.z - a.z;
  const bdot = d.x * ab.x + d.y * ab.y + d.z * ab.z;
  const dd = d.x * w0x + d.y * w0y + d.z * w0z;
  const ee = ab.x * w0x + ab.y * w0y + ab.z * w0z;
  const den = 1 - bdot * bdot;
  let s = den > 1e-6 ? (bdot * dd - ee) / -den : 0;
  // parameter along the segment
  let u = den > 1e-6 ? (ee - bdot * dd) / den : ee;
  u = clamp(u, 0, abLen);
  const px = a.x + ab.x * u, py = a.y + ab.y * u, pz = a.z + ab.z * u;
  return raySphere(o.x, o.y, o.z, d.x, d.y, d.z, px, py, pz, r);
}

/* Nearest enemy hit along a ray: {t, enemy, part}. */
export function rayEnemies(enemies, o, d, maxT) {
  let best = maxT, hit = null, part = null;
  for (const e of enemies) {
    if (e.dead || !e.char) continue;
    const ex = e.pos.x, ez = e.pos.z;
    // broad phase: vertical cylinder
    const px = o.x - ex, pz = o.z - ez;
    const a = d.x * d.x + d.z * d.z;
    const b = px * d.x + pz * d.z;
    const c = px * px + pz * pz - 0.7 * 0.7;
    if (a > 1e-9) {
      const disc = b * b - a * c;
      if (disc < 0) continue;
      const t0 = (-b - Math.sqrt(disc)) / a;
      if (t0 > best) continue;
    }
    const ch = e.char;
    const head = ch.boneWorld('head', _a);
    const th = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, head.x, head.y + 0.07, head.z, 0.15);
    if (th < best) { best = th; hit = e; part = 'head'; }
    const hips = ch.boneWorld('hips', new THREE.Vector3());
    const neck = ch.boneWorld('neck', new THREE.Vector3());
    const tt = rayCapsule(o, d, hips, neck, 0.22);
    if (tt < best) { best = tt; hit = e; part = 'body'; }
    const sl = ch.boneWorld('shin_l', new THREE.Vector3());
    const sr = ch.boneWorld('shin_r', new THREE.Vector3());
    const feet = sl.add(sr).multiplyScalar(0.5);
    const tl = rayCapsule(o, d, hips, feet, 0.19);
    if (tl < best) { best = tl; hit = e; part = 'legs'; }
  }
  return hit ? { t: best, enemy: hit, part } : null;
}

/* Grenades and charges. */
export function createExplosives(G) {
  const list = [];
  const geoUS = new THREE.SphereGeometry(0.045, 8, 6);
  const geoDE = new THREE.CylinderGeometry(0.03, 0.03, 0.36, 6).rotateX(Math.PI / 2);
  const matDark = new THREE.MeshStandardMaterial({ color: '#2f3326', roughness: 0.6, metalness: 0.3 });

  function meshFor(kind) {
    const name = kind === 'enemy' ? 'grenade_de' : kind === 'charge' ? 'charge' : 'grenade_us';
    const model = G.models.get(name);
    if (model) {
      const g = new THREE.Group();
      for (const p of model.prims) g.add(new THREE.Mesh(p.geometry, G.matlib.resolve(p.material)));
      return g;
    }
    return new THREE.Mesh(kind === 'enemy' ? geoDE : geoUS, matDark);
  }

  function spawn(kind, pos, vel, fuse) {
    const mesh = meshFor(kind);
    mesh.position.copy(pos);
    G.scene.add(mesh);
    const e = { kind, pos: pos.clone(), vel: vel.clone(), fuse, mesh, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0), rest: false, warned: false };
    list.push(e);
    return e;
  }

  /* `by`: the soldier who threw it (an enemy), for the record of who killed whom */
  function throwGrenade(owner, pos, vel, cooked = 0, by = null) {
    const g = spawn(owner === 'player' ? 'player' : 'enemy', pos, vel, Math.max(0.6, GRENADE.fuse - cooked));
    g.by = by;
    return g;
  }

  function placeCharge(pos, fuse, onBoom) {
    const e = spawn('charge', pos, new THREE.Vector3(), fuse);
    e.rest = true;
    e.onBoom = onBoom;
    return e;
  }

  function explode(e) {
    const { x, y, z } = e.pos;
    const inWater = G.world.water && G.world.water.contains(x, z) && G.terrain.height(x, z) < G.world.water.level && y < G.world.water.level + 0.3;
    const scale = e.kind === 'charge' ? 1.8 : 1;
    G.effects.explosion(x, y, z, scale, inWater);
    if (!inWater) {
      const gy = G.terrain.height(x, z);
      if (y - gy < 1.2) {
        G.decals?.add('scorch', x, gy, z, 0, 1, 0, 3.2 * scale);
        // the ground it lay on, thrown up in clods (or stones on the cobbles)
        G.chunks?.burst(x, gy, z, scale, G.terrain.surfaceAt(x, z));
      }
    }
    G.audio.explosion(x, y, z, scale);
    // it lights the street; the wet air round it glows, but is not turned white
    G.lights.flash(x, y + 1, z, '#ffb070', 220 * scale, 30, 0.4, 0.12);
    G.events.emit('noise', { x, z, radius: 90, kind: 'explosion' });
    const radius = GRENADE.radius * (e.kind === 'charge' ? 1.6 : 1);
    // camera shake by distance
    const cam = G.camera.position;
    const dc = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
    G.rig.addShake(clamp(1.4 - dc / 30, 0, 1.2));
    // close by, it throws mud over the view (not out of the water)
    if (!inWater) G.spatter?.(clamp(1.25 - dc / 8, 0, 1) * (e.kind === 'charge' ? 1.2 : 1));
    // and leaves him dazed (player.js, daze.js): all of it within 3 m of a grenade, none past
    // 11 m (a charge, nearly twice as far); a wall between takes some of it
    let daze = clamp((11 * scale - dc) / (8 * scale), 0, 1);
    if (daze > 0 && !G.world.clear(x, y + 0.4, z, cam.x, cam.y, cam.z, SHOT)) daze *= 0.6;
    if (daze > 0.05) G.player?.concuss?.(daze);
    // damage
    const hurt = (tx, ty, tz) => {
      const d = Math.hypot(tx - x, ty - y, tz - z);
      if (d > radius) return 0;
      if (!G.world.clear(x, y + 0.4, z, tx, ty, tz, SHOT)) return d < 1.6 ? 0.35 : 0;
      return 1 - (d / radius) ** 1.4;
    };
    const p = G.player;
    if (p.alive) {
      const k = hurt(p.pos.x, p.pos.y + 0.9, p.pos.z);
      if (k > 0) p.damage(GRENADE.damage * k * (e.kind === 'player' || e.kind === 'charge' ? 0.8 : G.diff.damage), e.pos, 'explosion', e.by || null);
    }
    let kills = 0;
    for (const en of G.enemies) {
      if (en.dead) continue;
      const k = hurt(en.pos.x, en.pos.y + 0.9, en.pos.z);
      if (k > 0) {
        // damage returns true only when this hit killed a living enemy. Keep
        // this local to the blast, independent of the mission's kill total.
        if (en.damage(GRENADE.damage * k * 1.4, e.pos, 'explosion', e.kind === 'player' || e.kind === 'charge')) kills++;
      } else if (Math.hypot(en.pos.x - x, en.pos.z - z) < radius * 2) en.suppress(2);
    }
    if (e.kind === 'player' && kills > 0) {
      G.hud.notice('Grenade', `${kills} ${kills === 1 ? 'enemy' : 'enemies'} killed`, 3);
    }
    e.onBoom?.(e);
  }

  function update(dt) {
    const p = G.player;
    let warn = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.fuse -= dt;
      if (e.fuse <= 0) {
        explode(e);
        G.scene.remove(e.mesh);
        list.splice(i, 1);
        continue;
      }
      if (e.kind === 'enemy' && p.alive && e.pos.distanceTo(p.pos) < GRENADE.radius + 2) warn = true;
      if (e.rest) continue;
      // integrate with a few sub-steps, bouncing off the world
      const steps = 3;
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        e.vel.y -= 9.8 * h;
        const sp = e.vel.length();
        if (sp < 1e-4) continue;
        const dist = sp * h;
        const dx = e.vel.x / sp, dy = e.vel.y / sp, dz = e.vel.z / sp;
        const hit = G.world.raycast(e.pos.x, e.pos.y, e.pos.z, dx, dy, dz, dist + 0.05, MOVE | SHOT);
        if (hit && hit.surface !== 'water') {
          e.pos.set(hit.x - dx * 0.05 + hit.nx * 0.04, hit.y - dy * 0.05 + hit.ny * 0.04, hit.z - dz * 0.05 + hit.nz * 0.04);
          const vn = e.vel.x * hit.nx + e.vel.y * hit.ny + e.vel.z * hit.nz;
          e.vel.x -= 1.6 * vn * hit.nx; e.vel.y -= 1.6 * vn * hit.ny; e.vel.z -= 1.6 * vn * hit.nz;
          e.vel.multiplyScalar(0.45);
          if (Math.abs(vn) > 1.5) G.audio.grenadeBounce(e.pos.x, e.pos.y, e.pos.z);
          if (e.vel.length() < 0.6 && hit.ny > 0.6) { e.rest = true; e.vel.set(0, 0, 0); }
        } else {
          e.pos.addScaledVector(e.vel, h);
          if (hit && hit.surface === 'water' && !e.splashed) { e.splashed = true; G.effects.splash(hit.x, hit.y, hit.z, 0.7); e.vel.multiplyScalar(0.3); }
        }
      }
      e.mesh.position.copy(e.pos);
      e.mesh.rotation.x += e.spin.x * dt;
      e.mesh.rotation.y += e.spin.y * dt;
    }
    G.hud.grenadeWarning(warn);
  }

  function clear() {
    for (const e of list) G.scene.remove(e.mesh);
    list.length = 0;
  }

  return { throwGrenade, placeCharge, update, clear, list };
}

/* Dropped things: empty magazines and clips, the rifles of the fallen. Each
   is a small rigid body that tumbles, bounces off the ground and settles. */
export function createDebris(G, { max = 48 } = {}) {
  const list = [];
  const tmp = new THREE.Vector3();

  function spawn(object, pos, vel, { spin = 8, life = 90, radius = 0.05 } = {}) {
    if (list.length >= max) { const old = list.shift(); old.object.parent?.remove(old.object); }
    object.position.copy(pos);
    G.scene.add(object);
    const d = {
      object, vel: vel.clone(), life, radius, rest: false,
      ang: new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin),
    };
    list.push(d);
    return d;
  }

  /* Take an object out of its parent (keeping where it is in the world) and drop it. */
  function drop(object, vel, opts) {
    object.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    object.matrixWorld.decompose(p, q, s);
    object.parent?.remove(object);
    object.position.copy(p);
    object.quaternion.copy(q);
    object.scale.copy(s);
    return spawn(object, p, vel, opts);
  }

  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.life -= dt;
      if (d.life <= 0) { d.object.parent?.remove(d.object); list.splice(i, 1); continue; }
      if (d.rest) continue;
      d.vel.y -= 9.8 * dt;
      const o = d.object;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.ang.x * dt; o.rotation.y += d.ang.y * dt; o.rotation.z += d.ang.z * dt;
      tmp.copy(o.position);
      if (G.world.pushOut(tmp, d.radius, o.position.y - d.radius, d.radius * 2, 0.02)) {
        d.vel.x = (tmp.x - o.position.x) / Math.max(dt, 1e-3) * 0.3; d.vel.z = (tmp.z - o.position.z) / Math.max(dt, 1e-3) * 0.3;
        o.position.x = tmp.x; o.position.z = tmp.z;
      }
      const g = G.world.groundAt(o.position.x, o.position.z, o.position.y + 0.2, 0.25, d.radius) + d.radius * 0.5;
      if (o.position.y < g) {
        o.position.y = g;
        if (Math.abs(d.vel.y) > 1.2) {
          d.vel.y = -d.vel.y * 0.3; d.vel.x *= 0.55; d.vel.z *= 0.55; d.ang.multiplyScalar(0.5);
          G.audio.grenadeBounce?.(o.position.x, o.position.y, o.position.z);
        } else {
          // settle: lie flat-ish
          d.vel.set(0, 0, 0); d.rest = true;
          o.rotation.x = Math.round(o.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
          o.rotation.z = Math.round(o.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
        }
      }
    }
  }

  function clear() { for (const d of list) d.object.parent?.remove(d.object); list.length = 0; }

  return { spawn, drop, update, clear, list };
}
