// Airport components share one physical density and retain their individual
// ground anchors while the airport painter sorts them among aircraft and trees.
// Keep this module independent of airport-art.js: that painter imports us.
import { registerAtlas, drawAtlas } from './atlas-runtime.js';

export const AIRPORT_BUILDING_ART = Object.freeze({
  id: 'airport-buildings-v2',
  path: './assets/world/airport-buildings-v2/airport-buildings',
  columns: 4,
  rows: 2,
  referenceCellPixels: 384,
  referencePixelsPerWorldPixel: 4,
  worldFramePixels: 96,
  groundCenterWorld: Object.freeze([48, 76]),
  groundCenterSource: Object.freeze([192, 304]),
  maxCell: 512,
  levels: Object.freeze([16, 32, 64, 128, 256, 512]),
});

// These are airport-local coordinates, not atlas coordinates. The centres
// match the native upright parts; no silhouette-dependent fitting is applied.
export const AIRPORT_BUILDING_CENTRES = Object.freeze({
  tower: Object.freeze({ u: .3, v: .46 }),
  terminal: Object.freeze({ u: 1.09, v: .46 }),
  hangar: Object.freeze({ u: 4.74, v: .43 }),
  depot: Object.freeze({ u: 5.5, v: .42 }),
});

export const AIRPORT_BUILDING_KINDS = Object.freeze(Object.keys(AIRPORT_BUILDING_CENTRES));
export const AIRPORT_BUILDING_SLOTS = Object.freeze(['x', 'y'].flatMap(axis =>
  AIRPORT_BUILDING_KINDS.map(kind => Object.freeze({
    id: `airport-building:${kind}:axis-${axis}`, kind, axis,
  }))));

registerAtlas({
  id: AIRPORT_BUILDING_ART.id,
  path: AIRPORT_BUILDING_ART.path,
  columns: AIRPORT_BUILDING_ART.columns,
  rows: AIRPORT_BUILDING_ART.rows,
  entries: AIRPORT_BUILDING_SLOTS.map(slot => slot.id),
  maxCell: AIRPORT_BUILDING_ART.maxCell,
});

export function airportBuildingProjectedCentre(kind, axis = 'x') {
  const centre = AIRPORT_BUILDING_CENTRES[kind];
  if (!centre) return null;
  const [x, y] = axis === 'y' ? [centre.v, centre.u] : [centre.u, centre.v];
  return { x: (x - y) * 32, y: (x + y) * 16 };
}

// The caller already translates to the airport anchor. Returning false allows
// the native component painter to cover missing or not-yet-loaded artwork.
export function drawAirportBuilding(c, kind, { axis = 'x', pixelScale = 1 } = {}) {
  const centre = airportBuildingProjectedCentre(kind, axis);
  if (!centre) return false;
  const orientation = axis === 'y' ? 'y' : 'x';
  const [anchorX, anchorY] = AIRPORT_BUILDING_ART.groundCenterWorld;
  return drawAtlas(c, `airport-building:${kind}:axis-${orientation}`,
    centre.x - anchorX, centre.y - anchorY,
    AIRPORT_BUILDING_ART.worldFramePixels, AIRPORT_BUILDING_ART.worldFramePixels,
    { pixelScale });
}
