/* Hedgerow — what the hands do during a reload.

   First person (startFirstPersonReload): the rig's reload clips work at the
   waist, below the eyes, so the player's own reload is shown on the
   shouldered rifle instead — it dips, turns and cants into view (`pose`),
   the Garand's fresh clip comes down from above into the receiver, the
   Thompson's empty magazine drops away and a full one slides up into the
   well; the bolt jolts where the sounds (audio.js) put it.

   The rig carries the frames of its reload clips' events (soldier.glb, node
   `rig`, extras `reload_events`): when the clip in the left hand appears and
   is seated, when an SMG's magazine is grabbed, drops and is replaced. This
   runs those events as a reload advances, for the player and the enemy:
   the seated magazine of the gun is hidden while a copy rides in the left
   hand, falls to the ground as a dropped object, and a fresh one comes up
   and is seated; the Garand's clip comes from the belt into the receiver.
   Fallback fractions are used for a rig without the events. */

import * as THREE from 'three';
import { instantiate } from './assets.js';

const FRAMES = { reload: 60, reload_smg: 66 };
const DEFAULT = {
  reload: { clip_in_hand: 21, clip_seated: 36, oprod_slap: 47 },
  reload_smg: { mag_grab: 8, mag_out: 17, mag_drop: 21, new_mag_in_hand: 31, mag_seated: 45, bolt_back: 57 },
};

let events = null;
/* Event fractions per clip, from the rig's extras when present. */
export function reloadEvents(soldierGltf) {
  if (events) return events;
  let src = DEFAULT;
  soldierGltf?.scene?.traverse((o) => {
    const ex = o.userData?.reload_events;
    if (ex) { try { src = typeof ex === 'string' ? JSON.parse(ex) : ex; } catch { /* keep the defaults */ } }
  });
  events = {};
  for (const [clip, ev] of Object.entries(src)) {
    const total = FRAMES[clip] || Math.max(...Object.values(ev)) + 10;
    events[clip] = Object.entries(ev).map(([name, f]) => ({ name, t: f / total })).sort((a, b) => a.t - b.t);
  }
  return events;
}

/* One reload in progress. `w`: weapon definition with `prop` (the magazine
   or clip model name), `drops` (the empty one falls), `seated` (the name of
   the gun's seated-magazine node), `kind`. */
export function startReload(G, char, w, clip) {
  const list = reloadEvents(G.soldier)[clip] || reloadEvents(G.soldier).reload;
  let next = 0, inHand = null;
  const seated = w.seated && char.weapon ? char.weapon.getObjectByName(w.seated) : null;

  const prop = () => {
    const m = w.prop && G.models.get(w.prop);
    if (m) return instantiate(m, G.matlib);
    const [x, y, z] = w.propSize || [0.04, 0.2, 0.07];
    return new THREE.Mesh(new THREE.BoxGeometry(x, y, z), G.matlib.get('gun_metal'));
  };
  const at = () => char.boneWorld('hand_l', new THREE.Vector3());

  function fire(name) {
    switch (name) {
      case 'clip_in_hand':
      case 'new_mag_in_hand':
        inHand = prop();
        char.holdLeft(inHand);
        break;
      case 'mag_grab':
        // the seated magazine is now in the hand
        if (seated) seated.visible = false;
        inHand = prop();
        char.holdLeft(inHand);
        break;
      case 'mag_drop':
        if (inHand && w.drops && G.debris) {
          const mag = inHand;
          char.releaseLeft();                 // the hand lets go; the magazine keeps its place
          G.debris.drop(mag, new THREE.Vector3(0, -0.6, 0), { spin: 6, radius: 0.04, life: 120 });
        } else char.holdLeft(null);
        inHand = null;
        break;
      case 'clip_seated':
      case 'mag_seated':
        char.holdLeft(null);
        inHand = null;
        if (seated) seated.visible = true;
        break;
      case 'oprod_slap':
      case 'bolt_back':
        G.audio.ui?.('hit');
        break;
    }
  }

  return {
    /* advance to fraction t (0..1) of the reload */
    update(t) {
      while (next < list.length && t >= list[next].t) fire(list[next++].name);
    },
    /* finished or interrupted: put everything back */
    end() {
      char.holdLeft(null);
      if (seated) seated.visible = true;
      next = list.length;
    },
  };
}

/* First person: one reload on the shouldered rifle. `pose(t)` is how far the
   arms swing the rifle at fraction t ({pitch, yaw, roll}, character.js
   armsPitch/armsYaw/armsRoll); `update(t)` moves the clip or magazine. */
/* How the arms tip the gun to reload it in first person (about the chest: character.js liftArms):
   the Thompson raised to the middle of the view and turned a little, so its fresh magazine seats in
   the picture; the Garand turned and canted, its clip going in at the top. Neither brings a hand or
   a forearm within a hand's breadth of the eye (raised further, the Thompson's right forearm came
   to 4 cm and filled the view; fp-check holds every arms pose to that). */
export const RELOAD_TILT = { smg: { pitch: 0.2, yaw: 0.12, roll: 0.05 }, rifle: { pitch: -0.12, yaw: 0.12, roll: 0.15 } };

export function startFirstPersonReload(G, char, w) {
  const gun = char.weapon;
  const smg = w.kind === 'smg';
  const tilt = smg ? RELOAD_TILT.smg : RELOAD_TILT.rifle;
  const ease = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  const jolt = (at, t) => Math.exp(-(((t - at) / 0.025) ** 2));
  const seated = w.seated && gun ? gun.getObjectByName(w.seated) : null;
  const make = () => {
    const m = w.prop && G.models.get(w.prop);
    if (m) return instantiate(m, G.matlib);
    const [x, y, z] = w.propSize || [0.04, 0.2, 0.07];
    return new THREE.Mesh(new THREE.BoxGeometry(x, y, z), G.matlib.get('gun_metal'));
  };
  // the fresh clip or magazine rides on the rifle from where the hand brings it to where it seats
  const anchors = G.models.get(w.model)?.anchors || {};
  const seat = new THREE.Vector3(), from = new THREE.Vector3(), rot = new THREE.Quaternion();
  if (smg && w.seatedAt) {
    seat.fromArray(w.seatedAt.p); rot.fromArray(w.seatedAt.q);
    from.copy(seat).add(new THREE.Vector3(0, -0.17, -0.02));
  } else {
    seat.fromArray(anchors.clip || [0, 0.074, 0.114]);
    from.copy(seat).add(new THREE.Vector3(0, 0.16, 0.02));
  }
  const [inAt, seatAt] = smg ? [0.24, 0.37] : [0.24, 0.36];
  let fresh = null, dropped = false, done = false;

  return {
    pose(t) {
      const k = ease(0, 0.15, t) * (1 - ease(0.86, 1, t));
      const kick = smg ? jolt(0.64, t) * 0.06 : jolt(0.08, t) * -0.05 + jolt(0.84, t) * 0.06;
      return { pitch: tilt.pitch * k + kick, yaw: tilt.yaw * k, roll: tilt.roll * k };
    },
    update(t) {
      if (!gun || done) return;
      // the empty magazine out and down
      if (smg && !dropped && t >= 0.12) {
        dropped = true;
        if (seated) {
          seated.visible = false;
          if (w.drops && G.debris) {
            const empty = make();
            empty.position.copy(seat); empty.quaternion.copy(rot);
            gun.add(empty);
            gun.updateMatrixWorld(true);
            G.debris.drop(empty, new THREE.Vector3(0, -0.8, 0), { spin: 5, radius: 0.04, life: 120 });
          }
        }
      }
      // the fresh one comes in and seats
      if (t >= inAt && t < seatAt) {
        if (!fresh) { fresh = make(); fresh.quaternion.copy(rot); gun.add(fresh); }
        fresh.position.lerpVectors(from, seat, ease(inAt, seatAt, t));
      } else if (t >= seatAt && fresh) {
        fresh.parent?.remove(fresh);
        fresh = null;
        if (seated) seated.visible = true;
      }
    },
    end() {
      done = true;
      fresh?.parent?.remove(fresh);
      fresh = null;
      if (seated) seated.visible = true;
    },
  };
}
