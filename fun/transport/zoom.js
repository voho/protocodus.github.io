// Power-of-two scales keep the same miniature artwork aligned to whole pixels.
export const ZOOM_LEVELS = Object.freeze([0.5, 1, 2]);
export const ZOOM_VIEWS = Object.freeze([
  { zoom: 0.5, name: 'Region', description: 'Plan the wider network' },
  { zoom: 1, name: 'Town', description: 'Build and connect neighborhoods' },
  { zoom: 2, name: 'Detail', description: 'Inspect buildings and vehicles' },
]);
export function nearestZoom(value = 1) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return ZOOM_LEVELS.reduce((best, zoom) => Math.abs(Math.log2(value / zoom)) < Math.abs(Math.log2(value / best)) ? zoom : best);
}
export function zoomIndex(value) { return ZOOM_LEVELS.indexOf(nearestZoom(value)); }
export function stepZoom(value, direction) { return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIndex(value) + Math.sign(direction)))]; }
