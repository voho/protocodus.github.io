import { smoothstep, lerp } from '../util.js';
import { profileSide } from './landform-banks.js';

// The bridge mouth and outer reed banks retain their authored profile.
// Stone quays between them retain a nearly vertical face rather than an
// exposed earth ramp projecting through the visible masonry.
export function canalBankCut(h, x, z, centre = 120) {
  const d = Math.abs(z - centre); if (d >= 13) return h;
  const quay = smoothstep(5.5, 6, Math.abs(x)) * smoothstep(55, 49, Math.abs(x));
  const original = smoothstep(12.6, 11.2, d), retained = smoothstep(12.9, 12.6, d);
  return lerp(h, -2.6, lerp(original, retained, quay));
}

export function causewayShoulders(line) {
  const length = line.reduce((n, p, i) => n + (i ? Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0);
  function profile(x, z, closest, bridge) {
    const side = profileSide(line, closest, x, z);
    const s = closest.t * length, nature = (1 - bridge) * smoothstep(97, 83, z);
    const outer = side > 0 ? 4.8 + 0.55 * Math.sin(s / 27 + 0.4) : 5.7 + 0.55 * Math.sin(s / 33 + 1.7);
    const shoulder = outer, drain = shoulder + 0.85 + 0.18 * Math.sin(s / 23 + side);
    const width = side > 0 ? 1.15 : 1.45, depth = 0.25 + 0.07 * Math.sin(s / 31 + side * 0.8);
    const rawWet = Math.exp(-(((closest.d - drain) / width) ** 2)) * smoothstep(3.2, 4, closest.d) * smoothstep(9, 8, closest.d);
    return { shoulder, depth, nature, rawWet, wet: rawWet * nature };
  }
  return {
    reach: 9,
    profile,
    cut(h, floor, x, z, closest, bridge) {
      const p = profile(x, z, closest, bridge);
      const oldDitch = 0.5 * smoothstep(3.6, 4.8, closest.d) * smoothstep(7, 5.4, closest.d) * (1 - bridge);
      const original = lerp(h - oldDitch, floor, smoothstep(4.2, 3, closest.d));
      const organic = lerp(h, floor, smoothstep(p.shoulder, 3, closest.d)) - p.depth * p.rawWet;
      return lerp(original, organic, p.nature);
    },
  };
}
