// One-level tile shapes, in NW / NE / SE / SW corner-bit order. A tile has
// exactly two planar triangles: no sampled centre, quarter-tile fans or
// additional intermediate slopes. All-high corners normalize to flat.
const names = ['flat', 'raised-nw', 'raised-ne', 'ramp-north', 'raised-se', 'ridge-nw-se', 'ramp-east', 'lowered-sw', 'raised-sw', 'ramp-west', 'ridge-ne-sw', 'lowered-se', 'ramp-south', 'lowered-ne', 'lowered-nw'];
const alternate = new Set([1, 4, 10, 11, 14]);
export const TERRAIN_SLOPE_SHAPES = Object.freeze(names.map((name, mask) => Object.freeze({
  name, mask,
  kind: name.split('-')[0],
  // Corner slopes hinge on their two equal-height corners: a level half
  // tile plus one triangular slope. Both saddle orientations use a ridge.
  diagonal: alternate.has(mask) ? 'ne-sw' : 'nw-se',
})));

export function terrainSlopeShape({ nw, ne, se, sw }) {
  const low = Math.min(nw, ne, se, sw);
  if (nw === ne && nw === se && nw === sw) return TERRAIN_SLOPE_SHAPES[0];
  const mask = (nw > low ? 1 : 0) | (ne > low ? 2 : 0) | (se > low ? 4 : 0) | (sw > low ? 8 : 0);
  return TERRAIN_SLOPE_SHAPES[mask];
}

export function slopeHeight(heights, a, b, shape = terrainSlopeShape(heights)) {
  const { nw, ne, se, sw } = heights;
  if (shape.diagonal === 'ne-sw') {
    return a + b <= 1 ? nw + (ne - nw) * a + (sw - nw) * b : se + (sw - se) * (1 - a) + (ne - se) * (1 - b);
  }
  return a >= b ? nw + (ne - nw) * a + (se - ne) * b : nw + (se - sw) * a + (sw - nw) * b;
}
