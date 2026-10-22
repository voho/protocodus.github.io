/* Hedgerow — the mission: objectives in order, checkpoints, pickups,
   control hints, the charge on the flak gun, the score. */

import * as THREE from 'three';
import { instantiate } from './assets.js';
import { wrapAngle } from './util.js';
import { FIRE_FOG } from './lights.js';

export function createMission(G, L, built) {
  const M = {
    index: 0, done: false, checkpoint: 0, inventory: null,
    pickups: [], hintsShown: new Set(), flakDestroyed: false, charge: null,
  };
  const objectives = L.objectives;

  // pickups
  for (const p of L.pickups) {
    const name = p.type === 'medkit' ? 'medkit' : p.type === 'grenades' ? 'crate' : 'ammo_box';
    const m = G.models.get(name);
    const o = m ? instantiate(m, G.matlib) : new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: '#6b5a3a' }));
    const y = G.world.groundAt(p.x, p.z, 1e4, 0.5);
    o.position.set(p.x, y, p.z);
    o.rotation.y = (p.x * 13.1 + p.z) % 6.28;
    if (p.type === 'grenades') o.scale.setScalar(0.55);
    G.scene.add(o);
    M.pickups.push({ ...p, y, object: o, taken: false });
  }

  function current() { return objectives[M.index]; }

  function setObjective(i, announce = true) {
    M.index = i;
    const o = current();
    if (!o) return;
    G.hud.objective(o.text, announce);
    if (announce) G.audio.ui('objective');
  }

  function advance() {
    const o = current();
    G.stats.objectives++;
    if (M.index + 1 >= objectives.length) {
      M.done = true;
      G.events.emit('missionComplete');
      return;
    }
    setObjective(M.index + 1);
    G.hud.notice('Objective complete', current().text, 3.5);
  }

  function markerFor(o) {
    if (!o) return null;
    if (o.marker) return o.marker;
    if (o.x !== undefined) return [o.x, o.z];
    return null;
  }

  function reachCheckpoint(i) {
    if (i <= M.checkpoint) return;
    M.checkpoint = i;
    M.inventory = G.player.inventory();
    M.objectiveAt = M.index;
    G.hud.notice('Checkpoint', '', 2);
    G.audio.ui('checkpoint');
  }

  /* the charge on the flak gun */
  function placeCharge() {
    const flak = built.placed.get('flak');
    if (!flak) return;
    const a = flak.model.anchors.charge;
    let x = flak.x, y = flak.y + 1, z = flak.z;
    if (a) {
      const c = Math.cos(flak.yaw), s = Math.sin(flak.yaw);
      x = flak.x + a[0] * c + a[2] * s; y = flak.y + a[1]; z = flak.z - a[0] * s + a[2] * c;
    }
    M.charge = G.explosives.placeCharge(new THREE.Vector3(x, y, z), 6, () => {
      M.flakDestroyed = true;
      // the gun is wrecked: tip it, char it, set it burning
      if (flak.object) {
        flak.object.rotation.z = 0.35;
        flak.object.rotation.x = -0.15;
        flak.object.position.y -= 0.3;
        flak.object.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          o.material.color.multiplyScalar(0.22);
          o.material.roughness = 1;
        });
      }
      G.effects.addFire(flak.x, flak.y + 0.6, flak.z, 0.9);
      G.lights.addStatic({ x: flak.x, y: flak.y + 1.5, z: flak.z, color: '#ff8a3a', intensity: 18, range: 16, flicker: 0.45, fog: FIRE_FOG });
      G.effects.explosion(flak.x, flak.y + 1, flak.z, 1.4);
      if (current() && current().id === 'flak') advance();
    });
    G.hud.notice('Charge set', 'Six seconds — get clear!', 2.5);
    G.audio.ui('beep');
  }

  M.update = (dt, input) => {
    const p = G.player;
    if (!p.alive || M.done) return;
    const px = p.pos.x, pz = p.pos.z;

    // checkpoints
    L.checkpoints.forEach((c, i) => {
      if (i > M.checkpoint && c.r && Math.hypot(px - c.x, pz - c.z) < c.r) reachCheckpoint(i);
    });

    // hints
    L.hints.forEach((h, i) => {
      if (!M.hintsShown.has(i) && Math.hypot(px - h.x, pz - h.z) < h.r) {
        M.hintsShown.add(i);
        G.hud.notice(h.text, h.sub || '', 4.5);
      }
    });

    // pickups
    for (const k of M.pickups) {
      if (k.taken) continue;
      const d = Math.hypot(px - k.x, pz - k.z);
      if (d > 1.4) continue;
      let ok = false;
      if (k.type === 'medkit' && p.health < 100) { p.heal(60); ok = true; G.hud.notice('Field dressing', '+60 health', 1.5); }
      if (k.type === 'ammo') { ok = p.addAmmo(0.5); if (ok) G.hud.notice('Ammunition', '', 1.2); }
      if (k.type === 'grenades') { ok = p.addGrenades(2); if (ok) G.hud.notice('Grenades', '+2', 1.2); }
      if (ok) { k.taken = true; G.scene.remove(k.object); G.audio.ui('pickup'); }
    }

    // objective
    const o = current();
    let prompt = null;
    if (o) {
      if (o.kind === 'reach' && Math.hypot(px - o.x, pz - o.z) < o.r) advance();
      else if (o.kind === 'cross' && pz > o.z) advance();
      else if (o.kind === 'destroy' && !M.charge) {
        const d = Math.hypot(px - o.x, pz - o.z);
        if (d < 3.2) {
          prompt = 'Press <b>E</b> to set a demolition charge';
          if (input.pressed('KeyE')) placeCharge();
        }
      }
    }
    G.hud.prompt(prompt);

    // marker
    const m = markerFor(current());
    if (m) {
      const ang = wrapAngle(Math.atan2(m[0] - px, m[1] - pz) - G.rig.yaw);
      G.hud.objectiveMarker(ang, Math.hypot(m[0] - px, m[1] - pz));
    } else G.hud.objectiveMarker(null, 0);
  };

  M.start = () => {
    setObjective(0, false);
    M.checkpoint = 0;
    M.inventory = null;
    M.objectiveAt = 0;
  };

  M.restoreCheckpoint = () => {
    const c = L.checkpoints[M.checkpoint];
    // objectives completed after the checkpoint are kept (the ground taken stays taken)
    return { spawn: c.spawn, inventory: M.inventory };
  };

  // dead drop ammo sometimes
  G.events.on('enemyKilled', (e) => {
    if (Math.random() < 0.45) {
      const m = G.models.get('ammo_box');
      if (!m) return;
      const o = instantiate(m, G.matlib);
      const x = e.pos.x + 0.6, z = e.pos.z + 0.3;
      const y = G.world.groundAt(x, z, e.pos.y + 0.5, 0.6);
      o.position.set(x, y, z);
      G.scene.add(o);
      M.pickups.push({ type: Math.random() < 0.2 ? 'grenades' : 'ammo', x, z, y, object: o, taken: false });
    }
  });

  return M;
}
