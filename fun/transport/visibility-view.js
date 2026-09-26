import { LAYER_GROUPS } from './visibility.js';

const GROUPS = LAYER_GROUPS.map(group => ({ label: group.label, items: group.items.map(({ key, label }) => [key, label]) }));
const ART = {
  trees: '<path d="m9 3-4 6h2l-4 6h4v6h4v-6h4l-4-6h2Z"/><path d="m17 6 4 8h-3v6"/>',
  buildings: '<path d="m2 10 7-6 7 6M4 9v12h10V9M8 21v-6h3v6M16 4h5v17h-5M17 8h1m-1 4h1m-1 4h1"/>',
  zones: '<path d="M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z" stroke-dasharray="2 2"/>',
  roads: '<path d="M7 2 4 22M17 2l3 20M12 3v3m0 4v4m0 4v3"/>',
  rails: '<path d="M8 2 5 22M16 2l3 20M6 5h12M6 10h12M5 15h14M4 20h16"/>',
  stations: '<path d="M5 21V3h15v10H5M2 21h7M10 7h6m-6 3h4"/>',
  routes: '<circle cx="5" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="M8 5h8a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h8" stroke-dasharray="2 2"/>',
  names: '<path d="M4 5h16v14H4ZM8 9h8m-8 4h5M7 19l-3 3v-3"/>',
  industryIcons: '<path d="M3 21V9l6 3V7l6 4V5h4l2 16ZM7 16v2m5-2v2m5-2v2M16 2h2"/>',
  vehicles: '<rect x="3" y="4" width="18" height="14" rx="3"/><path d="M3 11h18M8 4v7m8-7v7M6 18v3m12-3v3M7 15h1m8 0h1"/>',
  vehicleLoads: '<path d="m3 7 9-4 9 4v11l-9 4-9-4ZM3 7l9 4 9-4M12 11v11M8 5l9 4v5"/>',
  lighting: '<path d="M20 15.2A8.8 8.8 0 0 1 8.8 4a9 9 0 1 0 11.2 11.2Z"/><path d="M17 3v4m-2-2h4"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ART[key]}</svg>`;

/** Lightweight map controls; visibility belongs to the app, not the current save. */
export function mountVisibility(panel, button, { getLayers, onChange, onPreset }) {
  const events = new AbortController(), signal = events.signal;
  let disposed = false;
  if (!panel.id) panel.id = 'layers-panel';
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Map layers'); panel.hidden = true;
  button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', 'false');
  panel.innerHTML = `<div class="layers-heading"><h2>Map layers</h2><button type="button" class="layers-close" data-layers-close aria-label="Close map layers">${icon('close')}</button></div><div class="layers-scroll">${GROUPS.map(group => `<fieldset class="layer-group"><legend>${group.label}</legend>${group.items.map(([key, label]) => `<label class="layer-row"><span class="layer-symbol">${icon(key)}</span><span class="layer-name">${label}</span><input type="checkbox" role="switch" data-layer="${key}" aria-label="${label}"></label>`).join('')}</fieldset>`).join('')}</div><div class="layers-presets" role="group" aria-label="Layer presets"><button type="button" data-layer-preset="all">Show all</button><button type="button" data-layer-preset="terrain">Terrain only</button></div>`;

  function refresh() {
    if (disposed) return;
    const layers = getLayers();
    panel.querySelectorAll('[data-layer]').forEach(input => {
      input.checked = Boolean(layers[input.dataset.layer]);
      input.setAttribute('aria-checked', String(input.checked));
    });
    const values = GROUPS.flatMap(group => group.items.map(([key]) => Boolean(layers[key])));
    panel.querySelector('[data-layer-preset="all"]').setAttribute('aria-pressed', String(values.every(Boolean)));
    panel.querySelector('[data-layer-preset="terrain"]').setAttribute('aria-pressed', String(values.every(value => !value)));
  }
  function close(restoreFocus = false) {
    if (disposed) return;
    panel.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  function toggle() {
    if (disposed) return;
    if (!panel.hidden) { close(); return; }
    refresh(); panel.hidden = false; button.setAttribute('aria-expanded', 'true');
    panel.querySelector('[data-layer]')?.focus({ preventScroll: true });
  }
  function dispose() {
    close(); disposed = true; events.abort();
  }

  button.addEventListener('click', toggle, { signal });
  button.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'l' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); toggle(); }
  }, { signal });
  panel.querySelector('[data-layers-close]').addEventListener('click', () => close(true), { signal });
  panel.querySelectorAll('[data-layer]').forEach(input => input.addEventListener('change', () => {
    onChange(input.dataset.layer, input.checked); refresh();
  }, { signal }));
  panel.querySelectorAll('[data-layer-preset]').forEach(preset => preset.addEventListener('click', () => {
    onPreset(preset.dataset.layerPreset); refresh();
  }, { signal }));
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close();
  }, { capture: true, signal });
  document.addEventListener('keydown', event => {
    if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  }, { capture: true, signal });
  // Native switch keyboard actions must not trigger map panning or shortcuts.
  panel.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'l' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); close(true); }
    event.stopPropagation();
  }, { signal });
  panel.addEventListener('keyup', event => event.stopPropagation(), { signal });
  refresh();
  return { refresh, close, toggle, dispose };
}
