/* Meteora — drawing everything that flies.

   One view per entity: a clone of its model (models.js), placed between
   the simulation's last two steps, and the handles of whatever on it
   moves. Every frame each view is placed and its parts animated:

     turrets       swing toward what the simulation is aiming at, at a
                   turret's pace, barrels raised and lowered
     ring          the Perpetua's habitat ring turns about her spine
     drive         the Long Mercy's fold ring brightens as it charges
     reactor       the Mother's heart throbs
     eye           Eyes and Mothers turn their eye on the player (as far
                   as the socket lets them)
     emitter       a fold anchor's crown turns and pulses
     shield_N      a Mother's shield generators hum, and die dark
     arm_L, arm_R  a Tender lowers its gripper and welder onto the hull
     lights        beacon lights blink

   Damage shows: a burning subsystem keeps burning, a hurt hull smokes and,
   when it is bad, trails fire and sparks; destroyed turrets go dark and
   droop. A ship arriving through a fold slides out of it stretched; one
   leaving stretches into it. */

import * as THREE from 'three';
import { hardpoints } from './hardpoints.js';
import { tint } from './models.js';
import { foldGeometry } from './fold-fx.js';

const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0), zAxis = new THREE.Vector3(0, 0, 1);
const rotQ = new THREE.Quaternion(), aimV = new THREE.Vector3(), worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
const TURRET_SLEW = 1.6;   // rad/s
const EYE_LIMIT = 60 * Math.PI / 180;
const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export function place(object, ship, alpha) {
  object.position.set(
    ship.prevPos[0] + (ship.pos[0] - ship.prevPos[0]) * alpha,
    ship.prevPos[1] + (ship.pos[1] - ship.prevPos[1]) * alpha,
    ship.prevPos[2] + (ship.pos[2] - ship.prevPos[2]) * alpha);
  tmpQ.set(ship.prevQ[0], ship.prevQ[1], ship.prevQ[2], ship.prevQ[3]);
  tmpQ2.set(ship.q[0], ship.q[1], ship.q[2], ship.q[3]);
  object.quaternion.slerpQuaternions(tmpQ, tmpQ2, alpha);
}

export function createEntityRender(scene, library, glow, fx) {
  const views = new Map();
  let time = 0;

  function create(e) {
    const inst = library.instantiate(e.model);
    if (!inst && e.model) return null;
    const root = new THREE.Group();
    if (inst) {
      inst.root.scale.setScalar(e.scale ?? 1);
      root.add(inst.root);
      if (e.tint) tint(inst.root, e.tint);
    }
    scene.add(root);
    const hp = hardpoints(e.model);
    const view = {
      id: e.id, root, model: e.model, nodes: inst?.nodes ?? {}, turrets: inst?.turrets ?? [], hp,
      placeholder: inst?.placeholder, lightsPhase: Math.random() * 10, smoke: 0, burning: [],
      // Fire points for a hurt hull: a few of its collision spheres, or its centre.
      firePoints: (e.colliders?.length ? e.colliders.filter((_, i) => i % Math.max(1, Math.floor(e.colliders.length / 6)) === 0).slice(0, 6) : [{ pos: [0, 0, 0], r: e.radius * 0.4 }]),
      emissive: [],
    };
    // Parts whose glow the game drives get their own material copies.
    for (const key of ['drive', 'reactor', 'emitter', 'eye', 'shield_0', 'shield_1']) {
      const node = view.nodes[key];
      if (!node) continue;
      node.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        view.emissive.push({ key, material: o.material, base: o.material.emissiveIntensity ?? 1 });
      });
    }
    // Rest poses of the parts that turn, so turning composes with them.
    view.rest = {};
    for (const key of ['ring', 'emitter', 'arm_L', 'arm_R']) if (view.nodes[key]) view.rest[key] = view.nodes[key].quaternion.clone();
    for (const t of view.turrets) t.sub = e.turrets?.find(s => s.name === t.name) ?? null;
    views.set(e.id, view);
    return view;
  }

  function remove(id) {
    const v = views.get(id);
    if (!v) return;
    scene.remove(v.root);
    views.delete(id);
  }

  /* Turn a turret toward the direction its subsystem aims (ship-local). */
  function aimTurret(view, tr, entity, dt) {
    const s = tr.sub;
    if (!s) return;
    if (!s.alive) {
      // Dead turrets droop and go dark.
      if (!tr.dead) { tr.dead = true; tr.node.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color?.multiplyScalar(0.25); o.material.emissiveIntensity = 0; } }); }
      tr.pitch += (-0.5 - tr.pitch) * Math.min(1, dt);
    } else {
      // Aim in the turret's own (rest) frame.
      tr.node.parent.getWorldQuaternion(parentQ);
      view.root.getWorldQuaternion(worldQ);
      aimV.set(s.turret.aim[0], s.turret.aim[1], s.turret.aim[2]).applyQuaternion(worldQ);   // world
      aimV.applyQuaternion(parentQ.invert()).applyQuaternion(tmpQ.copy(tr.q0).invert());    // turret rest frame
      const yaw = Math.atan2(-aimV.x, -aimV.z);
      const pitch = Math.atan2(aimV.y, Math.hypot(aimV.x, aimV.z));
      const step = TURRET_SLEW * dt;
      let dy = yaw - tr.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      tr.yaw += Math.max(-step, Math.min(step, dy));
      tr.pitch += Math.max(-step, Math.min(step, Math.max(-0.2, pitch) - tr.pitch));
    }
    tr.node.quaternion.copy(tr.q0).multiply(rotQ.setFromAxisAngle(yAxis, tr.yaw));
    if (tr.gun) tr.gun.quaternion.copy(tr.gq0).multiply(rotQ.setFromAxisAngle(xAxis, tr.pitch));
  }

  function animate(view, e, world, dt, camera) {
    const N = view.nodes;
    if (N.ring && view.rest.ring) N.ring.quaternion.copy(view.rest.ring).multiply(rotQ.setFromAxisAngle(zAxis, time * 0.035));
    for (const em of view.emissive) {
      const m = em.material;
      if (em.key === 'reactor') {
        const sub = e.subsystems.find(s => s.kind === 'reactor');
        const alive = sub?.alive !== false;
        m.emissiveIntensity = alive ? em.base * (0.8 + 0.5 * Math.sin(time * 3.1) ** 2) * (e.frozen && world.missionDef?.id === 'm03' && !e.wokeUp ? 0.25 : 1) : 0.05;
      } else if (em.key === 'drive') {
        const t = world.mission?.timers?.get('spool');
        const charge = e.ringOpen ? 1 : t ? 1 - t.left / t.total : 0.15;
        m.emissiveIntensity = em.base * (0.3 + 2.4 * charge) * (0.9 + 0.1 * Math.sin(time * (4 + 10 * charge)));
      } else if (em.key === 'emitter') {
        const alive = e.subsystems.every(s => s.alive);
        m.emissiveIntensity = alive ? em.base * (0.7 + 0.6 * Math.abs(Math.sin(time * 2.4))) : 0.03;
      } else if (em.key === 'eye') {
        const lit = !e.frozen || e.wokeUp || e.role === 'sentry';
        m.emissiveIntensity = lit ? em.base * (e.alarmed ? 1.6 + 0.6 * Math.sin(time * 14) : 1) : 0.08;
      } else if (em.key === 'shield_0' || em.key === 'shield_1') {
        const gen = e.subsystems.find(s => s.name === `sub_${em.key}`);
        m.emissiveIntensity = gen?.alive === false ? 0.03 : em.base * (0.75 + 0.35 * Math.sin(time * 5.3 + (em.key === 'shield_1' ? 1.7 : 0)) ** 2);
      }
    }
    // Eyes look at the player, up to 60° off the socket's axis.
    if (N.eye && world.player?.alive && (e.role === 'sentry' || !e.frozen)) {
      const p = world.player.ship.pos;
      tmpV.set(p[0], p[1], p[2]);
      N.eye.parent.worldToLocal(tmpV);
      tmpV.sub(N.eye.position).normalize();
      tmpQ.setFromUnitVectors(tmpV2.set(0, 0, -1), tmpV);
      const off = 2 * Math.acos(Math.min(1, Math.abs(tmpQ.w)));
      if (off > EYE_LIMIT) tmpQ.slerpQuaternions(tmpQ2.identity(), tmpQ, EYE_LIMIT / off);
      N.eye.quaternion.slerp(tmpQ, Math.min(1, dt * 3));
    }
    // A fold anchor's crown turns while it stands.
    if (N.emitter && view.rest.emitter) {
      if (e.subsystems.every(s => s.alive)) view.spin = (view.spin ?? 0) + dt * 0.9;
      N.emitter.quaternion.copy(view.rest.emitter).multiply(rotQ.setFromAxisAngle(yAxis, view.spin ?? 0));
    }
    // A Tender at work lowers its tools; the welder shakes as it works.
    if (N.arm_L || N.arm_R) {
      const working = e.tender?.state === 'docked';
      view.arm = (view.arm ?? 0) + ((working ? -0.65 : 0) - (view.arm ?? 0)) * Math.min(1, dt * 3);
      if (N.arm_L) N.arm_L.quaternion.copy(view.rest.arm_L).multiply(rotQ.setFromAxisAngle(xAxis, view.arm));
      if (N.arm_R) N.arm_R.quaternion.copy(view.rest.arm_R).multiply(rotQ.setFromAxisAngle(xAxis, view.arm + (working ? 0.12 * Math.sin(time * 11) : 0)));
    }
    for (const tr of view.turrets) aimTurret(view, tr, e, dt);
  }

  /* Beacon lights, damage fire and smoke. */
  function effects(view, e, dt, base) {
    const hp = view.hp, r = view.root;
    // A derelict shows no lights.
    for (const L of e.def.derelict ? [] : hp.lights) {
      const on = !L.blink || ((time + view.lightsPhase) % L.blink) < L.blink * 0.18;
      if (!on) continue;
      tmpV.set(L.pos[0], L.pos[1], L.pos[2]).multiplyScalar(e.scale ?? 1).applyQuaternion(r.quaternion).add(r.position);
      const c = L.color ?? [1, 1, 1];
      glow.add(tmpV.x, tmpV.y, tmpV.z, e.big ? 1.1 + e.radius * 0.0025 : 0.3, c[0], c[1], c[2], L.blink ? 3.2 : 1.4);
    }
    // The flight recorder and anything else without a model: a beacon.
    if (!e.model) glow.add(r.position.x, r.position.y, r.position.z, 1.2, ...(e.def.glow ?? [1, 0.8, 0.4]), 2.5 + 2 * Math.abs(Math.sin(time * 4)));
    // Burning subsystems.
    for (const s of e.subsystems) {
      if (s.alive || s.kind === 'turret') continue;
      tmpV.set(s.pos[0], s.pos[1], s.pos[2]).applyQuaternion(r.quaternion).add(r.position);
      const flick = 0.7 + 0.6 * Math.random();
      glow.add(tmpV.x, tmpV.y, tmpV.z, s.r * 0.6, 1, 0.45, 0.12, 1.4 * flick);
      if (Math.random() < dt * 10) fx.smoulder([tmpV.x, tmpV.y, tmpV.z], base, Math.max(3, s.r * 0.5), 1);
    }
    // A hurt hull smokes; a badly hurt one burns.
    const health = e.maxHull > 0 ? e.hull / e.maxHull : 1;
    if (health < 0.5 && e.alive) {
      const rate = (e.big ? 6 : 14) * (1 - health);
      view.smoke += dt * rate;
      while (view.smoke >= 1) {
        view.smoke -= 1;
        const fp = view.firePoints[Math.floor(Math.random() * view.firePoints.length)];
        tmpV.set(fp.pos[0], fp.pos[1], fp.pos[2]).applyQuaternion(r.quaternion).add(r.position);
        if (e.big) tmpV.addScaledVector(tmpV2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), fp.r * 0.8);
        fx.smoulder([tmpV.x, tmpV.y, tmpV.z], base, e.big ? Math.max(4, e.radius * 0.03) : 0.9, health < 0.3 ? 1.5 : 0.2);
      }
    }
    // Seeds falling on Varlaam burn their rockets.
    if (e.burning && hp.nozzles.length) {
      for (const n of hp.nozzles) {
        tmpV.set(n.pos[0], n.pos[1], n.pos[2]).applyQuaternion(r.quaternion).add(r.position);
        tmpV2.set(n.dir[0], n.dir[1], n.dir[2]).applyQuaternion(r.quaternion);
        const s = n.size ?? 1.5;
        glow.add(tmpV.x, tmpV.y, tmpV.z, s * 1.6, 1, 0.55, 0.2, 3);
        glow.add(tmpV.x + tmpV2.x * s * 4, tmpV.y + tmpV2.y * s * 4, tmpV.z + tmpV2.z * s * 4, s, 1, 0.4, 0.1, 2, tmpV2.x, tmpV2.y, tmpV2.z, s * 8);
      }
    }
  }

  return {
    get count() { return views.size; },
    view: id => views.get(id) ?? null,
    poseOf: id => { const v = views.get(id); return v ? v.root : null; },
    /* Place and animate every view; create views for new entities as their
       models arrive, drop those whose entities have gone. */
    sync(world, alpha, dt, camera, { hidePlayer = false } = {}) {
      time += dt;
      const seen = new Set();
      for (const e of world.entities) {
        // A capital ship burns in view until its last blast takes it.
        if (!e.alive && !e.folding && !(e.big && !e.departed)) continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) v = create(e);
        if (!v) continue;
        place(v.root, e.ship, alpha);
        let visible = !(hidePlayer && e === world.player) && !e.hidden;
        // Through the fold: slide out of it (or into it), stretched.
        const f = e.folding;
        if (f) {
          const u = f.t / f.dur;
          const L = Math.max(4, view_length(v, e));
          if (f.dir === 'in') {
            const k = ease((u - 0.3) / 0.7);
            visible &&= u > 0.3;
            tmpV.set(0, 0, 1).applyQuaternion(v.root.quaternion).multiplyScalar(foldGeometry(e, L) * (1 - k));
            v.root.position.add(tmpV);
            v.root.scale.set(1, 1, 1 + 3 * (1 - k) * (1 - k));
          } else {
            const k = ease(u);
            v.root.scale.set(1 - 0.5 * k, 1 - 0.5 * k, 1 + 4 * k * k);
            visible &&= u < 0.98;
          }
        } else if (v.root.scale.z !== 1) v.root.scale.set(1, 1, 1);
        v.root.visible = visible;
        if (!visible) continue;
        animate(v, e, world, dt, camera);
      }
      for (const id of [...views.keys()]) if (!seen.has(id)) remove(id);
    },
    /* Lights, fires and smoke: after the camera has moved and the glow
       batch has been opened for the frame. */
    effects(world, dt) {
      for (const e of world.entities) {
        if (!e.alive) continue;
        const v = views.get(e.id);
        if (v && v.root.visible) effects(v, e, dt, e.ship.vel);
      }
    },
    remove,
    clear() { for (const id of [...views.keys()]) remove(id); time = 0; },
  };
}

function view_length(view, e) { return view.hp.length || e.radius * 2; }
