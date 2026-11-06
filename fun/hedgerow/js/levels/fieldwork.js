/* Cultivated Normandy ground: shallow parallel ridges, worn turning strips,
   and grass left along field boundaries. The 1.6 m ridge spacing survives
   the terrain's half-metre master grid; nothing is deep enough to trap a
   soldier. Sampling uses no random state, so render, collision and nav agree. */
import { smoothstep } from '../util.js';

export function fieldwork(definitions) {
  const fields = definitions.map((f) => ({ ...f, c: Math.cos((f.yaw || 0) * Math.PI / 180), s: Math.sin((f.yaw || 0) * Math.PI / 180) }));
  function sample(x, z, channel) {
    let result = 0;
    for (const f of fields) {
      const dx = x - f.x, dz = z - f.z;
      const u = dx * f.c - dz * f.s, v = dx * f.s + dz * f.c;
      const edge = Math.min(f.width / 2 - Math.abs(u), f.length / 2 - Math.abs(v));
      if (edge <= 0) continue;
      const keep = smoothstep(0, 2.2, edge);
      const rows = smoothstep(2.4, 5.2, f.length / 2 - Math.abs(v));
      // Slightly wavering animal-drawn furrows rather than perfect machinery.
      const ridge = Math.cos((u + Math.sin(v * 0.19) * 0.09) * Math.PI * 2 / (f.spacing || 1.6));
      if (channel === 'height') result += keep * rows * ridge * (f.relief || 0.065);
      else if (channel === 'mud') result += keep * ((f.soil || 1.6) + (1 - rows) * 0.8 + (1 - ridge) * rows * 0.45);
      else result = Math.max(result, keep);
    }
    return result;
  }
  return {
    height: (x, z) => sample(x, z, 'height'),
    mud: (x, z) => sample(x, z, 'mud'),
    mask: (x, z) => sample(x, z, 'mask'),
    // Tell the terrain mesher to retain the half-metre samples here. Its
    // ordinary one-metre mesh would undersample the cultivated ridges.
    fine: fields.map((f) => {
      const hx = Math.abs(f.c) * f.width / 2 + Math.abs(f.s) * f.length / 2;
      const hz = Math.abs(f.s) * f.width / 2 + Math.abs(f.c) * f.length / 2;
      return [f.x - hx, f.z - hz, f.x + hx, f.z + hz];
    }),
    definitions,
  };
}
