/* Authored Prague street ground. A gentle real-world street grade, crowned
   setts, shallow kerbs and worn courtyards; no countryside noise/craters. */
import { smoothstep, fbm2 } from '../util.js';

export const PRAGUE_STREET = Object.freeze({ halfRoad: 8.8, halfPavement: 14, kerb: 0.14, grade: 0.019 });
export const PRAGUE_COURTYARDS = Object.freeze([
  { x0: -59, x1: -25, z0: 8, z1: 114 },
  { x0: 25, x1: 45, z0: 23, z1: 58 },
]);
export const streetDatum = (_x, z) => 0.8 + (z + 58) * PRAGUE_STREET.grade;

export function pragueHeight(x, z) {
  const absX = Math.abs(x), road = smoothstep(9.0, 8.2, absX);
  const pavement = smoothstep(8.8, 9.25, absX) * smoothstep(14.5, 13.8, absX);
  // Only a few centimetres of camber, so tram rails contact the setts.
  return streetDatum(x, z) + road * Math.max(0, 1 - (x / 9) ** 2) * 0.055 + pavement * PRAGUE_STREET.kerb
    + fbm2(x / 16 + 8.1, z / 20 - 2, 2) * 0.018;
}

export function pragueSplat(x, z) {
  const insideCourt = PRAGUE_COURTYARDS.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  const wear = insideCourt ? smoothstep(0.0, 0.62, fbm2(x / 4 + 3, z / 5, 2)) * 0.16 : 0.025;
  // Courtyards show old setts under dirt rather than green pasture.
  return [wear, 0.001, 0, 1 - wear];
}
