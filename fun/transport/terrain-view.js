// Display preferences stay in this browser, independently of saved terrain.
// A projected height step must remain below the 32 px ground half-width:
// steeper faces would fold over and stop having an unambiguous pick target.
export const TERRAIN_HEIGHT_KEY = 'transport-terrain-height-v1';
export const TERRAIN_HEIGHT_VIEWS = Object.freeze([
  Object.freeze({ value: 0, label: 'Flat' }),
  Object.freeze({ value: 12, label: 'Gentle' }),
  Object.freeze({ value: 24, label: 'Normal' }),
  Object.freeze({ value: 28, label: 'Steep' }),
]);
export function normalizeTerrainHeight(value) {
  const step = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return TERRAIN_HEIGHT_VIEWS.some(view => view.value === step) ? step : 24;
}
export function loadTerrainHeight() {
  try { return normalizeTerrainHeight(localStorage.getItem(TERRAIN_HEIGHT_KEY)); }
  catch { return 24; }
}
export function saveTerrainHeight(value) {
  try { localStorage.setItem(TERRAIN_HEIGHT_KEY, String(normalizeTerrainHeight(value))); return true; }
  catch { return false; }
}
