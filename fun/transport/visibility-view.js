import { LAYER_GROUPS } from './visibility.js';
import { icon } from './ui-icons.js';

const GROUPS = LAYER_GROUPS.map(group => ({ label: group.label, items: group.items.map(({ key, label }) => [key, label]) }));
const GLYPH = { trees: 'tree', buildings: 'house', zones: 'zones', roads: 'road', rails: 'rail', stations: 'stop', routes: 'routes', names: 'label', industryIcons: 'industry', vehicles: 'truck', vehicleLoads: 'stock', deliveries: 'coin', lighting: 'moon', weather: 'rain', grid: 'grid', goal: 'flag' };
// A short key for map marks whose look carries meaning.
const NOTES = { industryIcons: ['Ring: served by a route', 'Bar: stored output', 'Amber: missing inputs'] };

/** Lightweight map controls; visibility belongs to the app, not the current save. */
export function mountVisibility(panel, button, { getLayers, onChange, onPreset }) {
  const events = new AbortController(), signal = events.signal;
  let disposed = false;
  if (!panel.id) panel.id = 'layers-panel';
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Map layers'); panel.hidden = true;
  button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', 'false');
  panel.innerHTML = `<div class="layers-heading"><h2>Map layers</h2><button type="button" class="layers-close" data-layers-close aria-label="Close map layers">${icon('close')}</button></div><div class="layers-scroll">${GROUPS.map(group => `<fieldset class="layer-group"><legend>${group.label}</legend>${group.items.map(([key, label]) => `<label class="layer-row"><span class="layer-symbol">${icon(GLYPH[key])}</span><span class="layer-name">${label}${NOTES[key] ? `<small class="layer-note" id="layer-note-${key}">${NOTES[key].map(part => `<span>${part}</span>`).join(' ')}</small>` : ''}</span><input type="checkbox" role="switch" data-layer="${key}" aria-label="${label}"${NOTES[key] ? ` aria-describedby="layer-note-${key}"` : ''}></label>`).join('')}</fieldset>`).join('')}</div><div class="layers-presets" role="group" aria-label="Layer presets"><button type="button" data-layer-preset="all">Show all</button><button type="button" data-layer-preset="terrain">Terrain only</button></div>`;

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
