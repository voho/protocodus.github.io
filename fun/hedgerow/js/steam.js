/* Hedgerow — steam off a hot barrel in the rain.

   Every shot heats the barrel of the gun in your hands; the rain that lands
   on it boils off, so after a burst thin steam curls up off its front half,
   more the longer you fired, thinning as it cools (the heat halves in about
   five seconds), carried off on the wind. The wisps are the effects' smoke
   (effects.js steam()), lit by the lamps and fires near like the rest. The
   gun is followed through the rig's own muzzle and weapon (its model's z
   is the barrel), nothing else of it. */

import * as THREE from 'three';

export function createSteam(G, rain) {
  let heat = 0, acc = 0;
  const m = new THREE.Vector3(), dir = new THREE.Vector3();
  // the player's shots (the only ones that make this noise)
  G.events.on('noise', (e) => { if (e.kind === 'shot') heat = Math.min(1.6, heat + 0.12); });

  function update(dt) {
    heat *= Math.exp(-dt / 7);
    const ch = G.player?.char, gun = ch?.weapon;
    if (heat < 0.04 || !gun || !ch.muzzleWorld || rain.value < 0.1) { acc = 0; return; }
    acc += dt * 24 * heat * rain.value;
    if (acc < 1) return;
    ch.muzzleWorld(m);
    gun.getWorldDirection(dir);
    const k = Math.min(1, heat);
    while (acc >= 1) {
      acc -= 1;
      // somewhere along the front forty centimetres of the barrel, just over it
      const t = 0.03 + Math.random() * 0.4;
      G.effects.steam(m.x - dir.x * t, m.y - dir.y * t + 0.015, m.z - dir.z * t, k);
    }
  }

  function clear() { heat = 0; acc = 0; }

  return { update, clear };
}
