// Display preferences belong to this browser, independently of saved companies.
export const VISIBILITY_KEY = 'transport-visibility-v1';
export const LAYER_GROUPS = [
  { label: 'Scenery', items: [
    { key: 'trees', label: 'Trees & plants' },
    { key: 'buildings', label: 'Buildings' },
    { key: 'zones', label: 'Zones' },
  ] },
  { label: 'Networks', items: [
    { key: 'roads', label: 'Roads' },
    { key: 'rails', label: 'Railways' },
    { key: 'stations', label: 'Stops' },
    { key: 'routes', label: 'Route lines' },
  ] },
  { label: 'Details', items: [
    { key: 'names', label: 'Names' },
    { key: 'industryIcons', label: 'Industry icons' },
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'vehicleLoads', label: 'Cargo loads' },
    { key: 'lighting', label: 'Day / night' },
    { key: 'grid', label: 'Grid' },
  ] },
];
export const DEFAULT_LAYERS = Object.freeze(Object.fromEntries(
  LAYER_GROUPS.flatMap(group => group.items.map(({ key }) => [key, key !== 'grid'])),
));

export function normalizeLayers(value) {
  const layers = { ...DEFAULT_LAYERS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return layers;
  for (const key of Object.keys(layers)) if (typeof value[key] === 'boolean') layers[key] = value[key];
  return layers;
}

export function layerPreset(name) {
  if (name !== 'all' && name !== 'terrain') return { ...DEFAULT_LAYERS };
  return Object.fromEntries(Object.keys(DEFAULT_LAYERS).map(key => [key, name === 'all']));
}

export function loadVisibility() {
  try { return normalizeLayers(JSON.parse(localStorage.getItem(VISIBILITY_KEY))); }
  catch { return { ...DEFAULT_LAYERS }; }
}

export function saveVisibility(layers) {
  try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(normalizeLayers(layers))); return true; }
  catch { return false; }
}
