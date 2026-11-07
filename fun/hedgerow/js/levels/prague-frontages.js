/* Authored building ages/heights along the fictional Prague street.
   Address keys avoid periodic colour/height stripes and preserve every
   named arcade and the two damaged shopfronts. Data only: no Three import. */
export const PRAGUE_FRONTAGE_VARIATION = Object.freeze([
  [-19, -46, 'prague_classical_sage'], [-19, -32, 'prague_old_classical_attic'],
  [-19, -18, 'prague_interwar'], [-19, 10, 'prague_classical_sage'],
  [-19, 38, 'prague_old_classical_attic'], [-19, 52, 'prague_interwar'],
  [-19, 80, 'prague_classical_sage'], [-19, 122, 'prague_interwar'], [-19, 136, 'prague_old_classical_attic'],
  [19, -46, 'prague_interwar'], [19, -32, 'prague_classical_sage'],
  [19, -18, 'prague_old_classical'], [19, 10, 'prague_interwar'], [19, 24, 'prague_old_classical'],
  [19, 52, 'prague_classical_sage'], [19, 80, 'prague_interwar'], [19, 94, 'prague_old_classical'],
  [19, 122, 'prague_classical_sage'], [19, 136, 'prague_interwar'],
  [-64, 14, 'prague_old_classical'], [-64, 28, 'prague_classical_sage'],
  [-64, 56, 'prague_old_classical'], [-64, 70, 'prague_interwar'],
  [-64, 84, 'prague_classical_sage'], [-64, 112, 'prague_old_classical'],
  [-57, 2, 'prague_old_classical'], [-43, 2, 'prague_classical_sage'], [-29, 2, 'prague_interwar'],
  [-57, 122, 'prague_classical_sage'], [-29, 122, 'prague_old_classical'],
  [50, 31, 'prague_old_classical'], [50, 45, 'prague_classical_sage'],
  [36, 14, 'prague_old_classical'], [36, 66, 'prague_interwar'],
].map(Object.freeze));

export function varyPragueFrontages(props) {
  const addresses = new Map(PRAGUE_FRONTAGE_VARIATION.map(([x, z, m]) => [`${x}:${z}`, m]));
  const ordinary = new Set(['prague_ochre', 'prague_gray', 'prague_rose']);
  for (const p of props) {
    const variant = addresses.get(`${p.x}:${p.z}`);
    if (variant && ordinary.has(p.m)) p.m = variant;
  }
  return props;
}
