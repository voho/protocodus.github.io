/* Meteora — dust in the light.

   A pilot reads speed from what streams past. Space has no air, but it has
   grit, and two layers of it hang around the camera: motes fixed in space,
   each wrapping to the far side of its layer's box as the camera leaves it
   behind, so the near ones flash by, the far ones drift slowly, and the
   stars beyond stay where they are. Each mote is drawn as a streak along
   the ship's course, longer the faster it flies, and only a faint speck at
   rest. How much dust there is, and its tint, belong to the mission's
   surroundings (`setLook`): thick in the Deep, thin in open space. */

const LAYERS = [
  { count: 300, box: 240, size: 0.045, bright: 0.45, streak: 0.04 },  // near grit
  { count: 240, box: 1500, size: 0.32, bright: 0.32, streak: 0.022 }, // far dust
];

export function createDust(glow, seed = 9) {
  const layers = LAYERS.map((L, li) => {
    const pos = new Float32Array(L.count * 3);
    let s = (seed * 7919 + li * 104729) % 2147483647 || 1;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < pos.length; i++) pos[i] = rand() * L.box;
    return { ...L, pos };
  });
  let amount = 1, tint = [0.75, 0.82, 1];
  const wrap = (v, box) => ((v % box) + box * 1.5) % box - box / 2;

  return {
    /* amount: 0 (none) … 1.5 (thick); tint: linear rgb. */
    setLook({ amount: a = 1, tint: t = [0.75, 0.82, 1] } = {}) { amount = a; tint = t; },
    add(camera, vel) {
      if (amount <= 0) return;
      const speed = Math.hypot(vel[0], vel[1], vel[2]);
      const dx = speed > 0.5 ? vel[0] / speed : 0, dy = speed > 0.5 ? vel[1] / speed : 0, dz = speed > 0.5 ? vel[2] / speed : 1;
      const { x: cx, y: cy, z: cz } = camera.position;
      // Seen at a crawl they are specks; at speed, streaks.
      const lively = 0.35 + 0.65 * Math.min(1, speed / 160);
      for (const L of layers) {
        const half = L.box / 2, n = Math.min(L.count, Math.round(L.count * amount));
        const length = Math.min(L.box * 0.08, speed * L.streak);
        for (let i = 0; i < n; i++) {
          const x = wrap(L.pos[3 * i] - cx, L.box), y = wrap(L.pos[3 * i + 1] - cy, L.box), z = wrap(L.pos[3 * i + 2] - cz, L.box);
          const d = Math.hypot(x, y, z);
          // Not right by the lens (a mote a few metres off would streak
          // across half the screen), and fading out toward the box's edge
          // so that the wrap is never seen.
          const k = Math.min(1, Math.max(0, (d - 8) / 14)) * Math.max(0, 1 - d / (half * 0.95));
          if (k <= 0.01) continue;
          glow.add(cx + x, cy + y, cz + z, L.size, tint[0], tint[1], tint[2], L.bright * k * lively, dx, dy, dz, length);
        }
      }
    },
  };
}
