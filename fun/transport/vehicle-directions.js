import { registerAtlas, drawAtlas } from './atlas-runtime.js';

// Canvas headings: east is zero, clockwise is positive. Frames are individually
// drawn with a fixed camera and light source, never rotated copies of a side view.
export const VEHICLE_HEADINGS = Object.freeze(['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']);
export const VEHICLE_KINDS = Object.freeze(['bus', 'express-bus', 'truck', 'locomotive', 'coach', 'wagon', 'ferry', 'cargo-ship', 'tanker']);
export const VEHICLE_ATLAS_PATHS = Object.freeze(Object.fromEntries(
  VEHICLE_KINDS.map(kind => [kind, `./assets/world/vehicle-${kind}-dimetric-v2/atlas`])
));
const compass = ['NW', 'N', 'NE', 'W', null, 'E', 'SW', 'S', 'SE'];
for (const kind of VEHICLE_KINDS) {
  registerAtlas({ id: `vehicle-${kind}`, path: VEHICLE_ATLAS_PATHS[kind],
    maxCell: 256,
    entries: compass.map(heading => heading && `vehicle:${kind}:${heading}`) });
}
export function vehicleHeadingIndex(angle = 0) {
  return ((Math.round((Number.isFinite(angle) ? angle : 0) / (Math.PI / 4)) % 8) + 8) % 8;
}
export const vehicleHeading = angle => VEHICLE_HEADINGS[vehicleHeadingIndex(angle)];
// Diagonal frames lie on the 2:1 diamond axes. Selection still uses the eight
// compass sectors, while loads and lights follow the authored shallow angle.
const diagonal = Math.atan(.5);
const frameAngles = [0, diagonal, Math.PI / 2, Math.PI - diagonal, Math.PI, Math.PI + diagonal, Math.PI * 1.5, -diagonal];
export const vehicleFrameAngle = angle => frameAngles[vehicleHeadingIndex(angle)];
export function drawDirectionalVehicle(c, kind, angle, size, pixelScale = 1) {
  return drawAtlas(c, `vehicle:${kind}:${vehicleHeading(angle)}`, -size / 2, -size / 2, size, size, { pixelScale });
}
