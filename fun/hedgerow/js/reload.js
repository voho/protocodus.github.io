/* Hedgerow — what the hands do during a reload.

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
