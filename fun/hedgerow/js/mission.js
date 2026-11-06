/* Hedgerow — the mission: ordered phases, checkpoints, pickups,
   control hints, the charges on the guns, the score.

   Objective kinds: 'reach' (within r of x, z), 'cross' (north of z),
   'destroy' (a charge on the placed prop `target`), 'clear' (every enemy of
   the `groups` dead), 'interact' (hold F beside equipment for `time` seconds),
   'hold' (stay within r of x, z for `time` seconds while
   the `counter` groups come for him). Contiguous objectives sharing an
   `orderGroup` form one phase and may be completed in any order. */

import * as THREE from 'three';
import { instantiate } from './assets.js';
import { wrapAngle } from './util.js';
import { FIRE_FOG } from './lights.js';

export function createMission(G, L, built) {
  const M = {
    index: 0, done: false, checkpoint: 0, inventory: null,
    pickups: [], hintsShown: new Set(), flakDestroyed: false, charge: null, wrecked: new Set(), held: 0, sentAt: -99,
    completed: new Set(), interaction: null, interactionHealth: null, interactionBlocked: false,
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
  // Interactions use simulation time, so menus freeze the work rather than
  // finishing it in the background. A released key, lost range or death
  // cancels unfinished work; a completed action remains completed on retry.
  function cancelInteraction() { M.interaction = null; }
  function resetInteraction(health = G.player.health) { cancelInteraction(); M.interactionHealth = health; M.interactionBlocked = false; }
  function anchorPoint(prop, anchor, height = 0) {
    const scale = prop.scale || 1, c = Math.cos(prop.yaw || 0), s = Math.sin(prop.yaw || 0);
    return {
      x: prop.x + (anchor[0] * c + anchor[2] * s) * scale,
      y: prop.y + (anchor[1] + height) * scale,
      z: prop.z + (-anchor[0] * s + anchor[2] * c) * scale,
    };
  }
  function interactionSite(o) {
    const prop = o.target ? built.placed.get(o.target) : null;
    if (o.target && !prop) return null;
    const anchor = o.anchor && prop?.model.anchors[o.anchor];
    const at = anchor ? anchorPoint(prop, anchor) : null;
    const x = at?.x ?? o.x ?? prop?.x, z = at?.z ?? o.z ?? prop?.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x, z, y: prop?.y ?? G.player.pos.y ?? 0 };
  }
  function interactionAim(o, site) {
    const prop = o.target ? built.placed.get(o.target) : null;
    if (!prop) return { x: site.x, y: site.y + 1, z: site.z };
    const anchors = prop.model.anchors;
    if (o.anchor && anchors[o.anchor]) return anchorPoint(prop, anchors[o.anchor], o.anchorHeight || 0);
    if (anchors.interact) return anchorPoint(prop, anchors.interact, o.anchorHeight || 0);
    // A radio's operator anchor is a foot position outside its solid table;
    // looking to hand height there avoids treating the equipment itself as
    // an occluding wall while still rejecting a real wall between the two.
    if (anchors.operator) return anchorPoint(prop, anchors.operator, o.anchorHeight ?? 1.2);
    return { x: site.x, y: site.y + 1, z: site.z };
  }
  G.events.on('playerDied', () => { resetInteraction(null); G.hud.prompt(null); });

  function active() {
    const first = current();
    if (!first) return [];
    if (!first.orderGroup) return [first];
    const out = [];
    for (let i = M.index; i < objectives.length && objectives[i].orderGroup === first.orderGroup; i++) {
      if (!M.completed.has(objectives[i].id)) out.push(objectives[i]);
    }
    return out;
  }

  // A flanking approach should not send the soldier past an intact gun to
  // reach the gun at the opposite end of the battery. Both the interaction
  // and compass resolve against the same nearest unfinished target.
  function selected() {
    const list = active();
    if (list.length < 2) return list[0];
    const p = G.player.pos;
    return list.reduce((best, o) => Math.hypot(o.x - p.x, o.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? o : best);
  }

  function objectiveText(o) {
    if (!o?.orderGroup || !o.groupText) return o?.text || '';
    const phase = objectives.filter((item) => item.orderGroup === o.orderGroup);
    const done = phase.filter((item) => M.completed.has(item.id)).length;
    return `${o.groupText} — ${done}/${phase.length} destroyed`;
  }

  M.isComplete = (id) => M.completed.has(id);
  M.isActive = (id) => active().some((o) => o.id === id);

  function setObjective(i, announce = true) {
    M.index = i;
    const o = current();
    if (!o) return;
    M.held = 0; M.sentAt = -99; M.charge = null; M.warned = false; resetInteraction();
    G.hud.objective(objectiveText(o), announce);
    if (announce) G.audio.ui('objective');
  }

  const living = (groups) => (G.enemies || []).filter((e) => !e.dead && groups.includes(e.group));

  function advance(o = current()) {
    if (!o || M.completed.has(o.id)) return;
    cancelInteraction();
    M.completed.add(o.id);
    G.stats.objectives++;
    let next = M.index;
    while (next < objectives.length && M.completed.has(objectives[next].id)) next++;
    if (next >= objectives.length) {
      M.index = objectives.length;
      M.done = true;
      G.events.emit('missionComplete');
      return;
    }
    const samePhase = !!o.orderGroup && objectives[next].orderGroup === o.orderGroup;
    setObjective(next, !samePhase);
    G.hud.notice(samePhase ? 'Gun destroyed' : 'Objective complete', samePhase ? objectiveText(current()) : o.text, 3.5);
  }

  function markerFor(o) {
    if (!o) return null;
    if (o.marker) return o.marker;
    if (o.kind === 'clear') {
      // the nearest of them still standing
      let best = null, bd = Infinity;
      for (const e of living(o.groups)) { const d = Math.hypot(e.pos.x - G.player.pos.x, e.pos.z - G.player.pos.z); if (d < bd) { bd = d; best = [e.pos.x, e.pos.z]; } }
      return best;
    }
    if (o.kind === 'interact') {
      const site = interactionSite(o);
      return site ? [site.x, site.z] : null;
    }
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

  /* a charge on the objective's gun (`target`: the id it was placed with) */
  function placeCharge(o) {
    const id = o.target;
    const flak = built.placed.get(id);
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
      M.wrecked.add(id);
      M.charge = null;
      advance(o);
    });
    G.hud.notice('Charge set', 'Six seconds — get clear!', 2.5);
    G.audio.ui('beep');
  }

  M.update = (dt, input) => {
    const p = G.player;
    if (!p.alive || M.done) { resetInteraction(null); return; }
    const px = p.pos.x, pz = p.pos.z;
    // Detect the hit before pickups heal: a dressing in this same frame
    // must not conceal damage that interrupted work on the equipment.
    const interactionHurt = M.interactionHealth !== null && p.health < M.interactionHealth;

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
    const o = selected();
    let prompt = null;
    if (o) {
      if (o.kind === 'reach' && Math.hypot(px - o.x, pz - o.z) < o.r) advance();
      else if (o.kind === 'cross' && pz > o.z) advance();
      else if (o.kind === 'destroy' && !M.charge) {
        const d = Math.hypot(px - o.x, pz - o.z);
        if (d < 3.2) {
          prompt = 'Press <b>F</b> to set a demolition charge';
          if (input.pressed('KeyF')) placeCharge(o);
        }
      } else if (o.kind === 'interact') {
        const site = interactionSite(o);
        const inside = site && Math.hypot(px - site.x, pz - site.z) < (o.r ?? 2.2)
          && Math.abs((p.pos.y ?? site.y) - site.y) < 2.2;
        const aim = inside ? interactionAim(o, site) : null;
        const eye = G.camera?.position || { x: px, y: (p.pos.y ?? site?.y ?? 0) + 1.5, z: pz };
        const visible = inside && (!G.world?.clear || G.world.clear(eye.x, eye.y, eye.z, aim.x, aim.y, aim.z));
        const held = !!input.held?.('KeyF');
        M.interactionHealth = p.health;
        if (interactionHurt && held) M.interactionBlocked = true;
        if (!held) M.interactionBlocked = false;
        if (!inside) cancelInteraction();
        else if (!visible) { cancelInteraction(); prompt = 'Move into view of the equipment'; }
        else if (M.interactionBlocked) { cancelInteraction(); prompt = 'Interrupted — release <b>F</b> to try again'; }
        else if (!held) {
          cancelInteraction();
          prompt = `Hold <b>F</b> to ${o.prompt || o.action || 'operate the equipment'}`;
        } else {
          // time is the local schema; duration also accepts existing missions
          // from the upstream equipment-objective implementation.
          const duration = Math.max(0.1, o.time ?? o.duration ?? 1.5);
          if (M.interaction?.id !== o.id) M.interaction = { id: o.id, elapsed: 0, duration, progress: 0 };
          const work = M.interaction;
          work.elapsed = Math.min(duration, work.elapsed + Math.max(0, Number.isFinite(dt) ? dt : 0));
          work.progress = work.elapsed / duration;
          prompt = `Hold <b>F</b> · ${o.progressText || 'Operating equipment'} — ${Math.floor(work.progress * 100)}%`;
          if (work.elapsed >= duration) {
            advance(o);
            prompt = null;
            G.events.emit('missionAction', { action: o.action || o.id, target: o.target || null, objective: o.id, ...site });
          }
        }
      } else if (o.kind === 'clear') {
        const left = living(o.groups).length;
        if (!left) advance();
        else G.hud.objective(`${o.text} (${left} left)`, false);
      } else if (o.kind === 'hold') {
        const inside = Math.hypot(px - o.x, pz - o.z) < o.r;
        if (inside) M.held += dt;
        // the counter-attack: sent at him when it starts, and again every twenty seconds to where he is
        if (G.time - M.sentAt > 20 && (M.held > 0 || inside)) {
          M.sentAt = G.time;
          for (const g of o.counter || []) G.enemyCtl?.send(g, px, pz);
          if (!M.warned) { M.warned = true; G.hud.notice('Counter-attack!', o.warning || 'Hold the position', 3.5); }
        }
        const left = Math.max(0, Math.ceil(o.time - M.held));
        G.hud.objective(inside ? `${o.text} — ${left} s` : `${o.text} — get back to the position`, false);
        if (M.held >= o.time) advance();
      }
    }
    G.hud.prompt(prompt);

    // marker
    const m = markerFor(selected());
    if (m) {
      const ang = wrapAngle(Math.atan2(m[0] - px, m[1] - pz) - G.rig.yaw);
      G.hud.objectiveMarker(ang, Math.hypot(m[0] - px, m[1] - pz));
    } else G.hud.objectiveMarker(null, 0);
  };

  M.start = () => {
    M.completed.clear();
    M.done = false;
    setObjective(0, false);
    M.checkpoint = 0;
    M.inventory = null;
    M.objectiveAt = 0;
  };

  M.restoreCheckpoint = () => {
    const c = L.checkpoints[M.checkpoint];
    // main.js cancels live explosives on a retry. Release the matching
    // interaction lock too, otherwise dying during a fuse prevents the
    // soldier ever placing another demolition charge.
    M.charge = null;
    resetInteraction(null);
    G.hud.prompt(null);
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
