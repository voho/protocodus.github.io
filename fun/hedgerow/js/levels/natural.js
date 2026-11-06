/* Smooth authored terrain corridors. Broad curves define the place; small
   variations change shoulders/banks without making noisy walking ground. */
import { polylineDistance, smoothstep } from '../util.js';

export function corridorFrame(line) {
  const length = line.reduce((n, p, i) => n + (i ? Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0);
  const atZ = (z) => {
    let i = 0;
    while (i < line.length - 2 && z > line[i + 1][1]) i++;
    const a = line[i], b = line[i + 1], t = Math.max(0, Math.min(1, (z - a[1]) / (b[1] - a[1] || 1)));
    const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
    return { x: a[0] + dx * t, z: a[1] + dz * t, tx: dx / d, tz: dz / d, yaw: Math.atan2(dx, dz) };
  };
  return {
    line, length, atZ,
    nearest(x, z, out = {}) {
      polylineDistance(line, x, z, out);
      const a = line[out.seg], b = line[out.seg + 1], dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1;
      out.tx = dx / d; out.tz = dz / d; out.signed = (x - out.px) * out.tz - (z - out.pz) * out.tx; out.along = out.t * length;
      return out;
    },
  };
}

// A reversible lateral remap keeps an existing lane-side arrangement
// coherent while replacing its centreline. z is preserved, so gateways to
// the next district remain fixed and the transform cannot fold a field.
export function corridorRemap(source, target, { minZ = -Infinity, maxZ = Infinity } = {}) {
  const old = corridorFrame(source), next = corridorFrame(target);
  const delta = (z) => z < minZ || z >= maxZ ? 0 : next.atZ(z).x - old.atZ(z).x;
  return {
    delta,
    point: (x, z) => [x + delta(z), z],
    inverse: (x, z) => [x - delta(z), z],
    yaw: (degrees, z) => z < minZ || z >= maxZ ? degrees : degrees + (next.atZ(z).yaw - old.atZ(z).yaw) * 180 / Math.PI,
    line(points, step = 2) {
      const out = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
        for (let j = 0; j < n; j++) {
          const t = j / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          // Keep existing route goals outside the migrated district: adding
          // a new intermediate goal on an old garden wall changes how a
          // walking solver rounds its corner even though nothing moved.
          if (j === 0 || (z >= minZ && z < maxZ)) out.push([x + delta(z), z]);
        }
      }
      const p = points.at(-1); if (p) out.push([p[0] + delta(p[1]), p[1]]);
      return out;
    },
  };
}

export function sunkenLane(line) {
  const frame = corridorFrame(line), sample = {};
  const profile = (s, side) => ({
    road: 2.75 + 0.22 * Math.sin(s / 29 + side * 0.7),
    shoulder: side > 0 ? 7.5 + 0.65 * Math.sin(s / 37 + 0.3) : 8.3 + 0.9 * Math.sin(s / 43 + 1.4),
    crest: side > 0 ? 5.9 + 0.65 * Math.sin(s / 31) : 6.6 + 0.6 * Math.sin(s / 41 + 1.8),
    rise: side > 0 ? 0.48 + 0.20 * Math.sin(s / 35 + 0.8) : 0.27 + 0.15 * Math.sin(s / 48 + 2.2),
  });
  return {
    frame, profile,
    cut(h, x, z, datum) {
      frame.nearest(x, z, sample); const d = Math.abs(sample.signed), side = sample.signed >= 0 ? 1 : -1, p = profile(sample.along, side);
      if (d > p.shoulder + 2 || sample.d > p.shoulder + 2) return h;
      const blend = smoothstep(p.shoulder, p.road, d);
      const floor = datum(sample.px, sample.pz) + Math.min(d, p.road) ** 2 * 0.008;
      const bank = p.rise * Math.exp(-(((d - p.crest) / (side > 0 ? 1.55 : 2.2)) ** 2));
      return h + (floor - h) * blend + bank;
    },
  };
}
