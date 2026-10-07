// Display preferences stay in this browser, independently of saved terrain.
// Corner slopes rise in both axes: the step must be below 16px, half the
// ground half-width, to keep every canonical triangle unfolded and pickable.
export const TERRAIN_HEIGHT_KEY = 'transport-terrain-height-v2';
const LEGACY_HEIGHT_KEY = 'transport-terrain-height-v1';
export const TERRAIN_HEIGHT_VIEWS = Object.freeze([
  Object.freeze({ value: 0, label: 'Flat' }),
  Object.freeze({ value: 6, label: 'Gentle' }),
  Object.freeze({ value: 12, label: 'Normal' }),
  Object.freeze({ value: 14, label: 'Steep' }),
]);
export function normalizeTerrainHeight(value) {
  const step = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return TERRAIN_HEIGHT_VIEWS.some(view => view.value === step) ? step : 12;
}
export function loadTerrainHeight() {
  try {
    const saved = localStorage.getItem(TERRAIN_HEIGHT_KEY);
    if (saved !== null) return normalizeTerrainHeight(saved);
    // Preserve the chosen named view, including Gentle and Flat. Changing the
    // projection does not touch a company's source heights or save format.
    const legacy = localStorage.getItem(LEGACY_HEIGHT_KEY), choices = { '0': 0, '12': 6, '24': 12, '28': 14 };
    const migrated = Object.hasOwn(choices, legacy) ? choices[legacy] : undefined;
    if (migrated !== undefined) { saveTerrainHeight(migrated); return migrated; }
    return 12;
  }
  catch { return 12; }
}
export function saveTerrainHeight(value) {
  try { localStorage.setItem(TERRAIN_HEIGHT_KEY, String(normalizeTerrainHeight(value))); return true; }
  catch { return false; }
}
