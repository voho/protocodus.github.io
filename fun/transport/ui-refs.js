// References (DESIGN.md 7): every mention of a route, stop, town, industry, vehicle or cargo is the same button, built only
// here. ref(), refFor() and renderTemplate() return markup and resolveRef() finds what a reference points at, so all of them
// run in Node; installReferences() adds the one delegated set of document listeners that links hover, focus and clicks to
// the map, and linkFromMap() lets map hover light panel rows.
import { CARGO, INDUSTRIES } from './data.js';
import { icon, modeGlyph } from './ui-icons.js';
import { cargoIcon } from './cargo-icons.js';
import { bullet, roundel } from './ui-line.js';
import { capital, cargoName, dateLong, escapeHTML as escape, money, vehicleNoun } from './copy.js';
import { validRouteNumber } from './route-lines.js';
import { industrySize } from './industry-sites.js';
import { stationSpan } from './station-sites.js';

export const REF_KINDS = Object.freeze(['route', 'stop', 'town', 'industry', 'vehicle', 'cargo']);
const LISTS = { route: 'routes', stop: 'stations', town: 'cities', industry: 'industries', vehicle: 'vehicles' };
// What a template says for something that has gone: plain words, never a dead button.
const GONE = { route: 'a retired route', stop: 'a removed stop', town: 'a former town', industry: 'a closed industry', vehicle: 'a sold vehicle' };
const VARIANTS = { prose: 'ref ref--prose', row: 'ref ref--row', compact: 'ref ref--compact', onInk: 'ref ref--prose ref--on-ink' };
const TOKEN = /\{(route|stop|town|industry|vehicle|cargo|money|date):([^{}]+)\}/g, INTENT_MS = 150, SHOW_MS = 4000;
const cargoTile = cargo => `<span class="cargo-tile">${cargoIcon(cargo, { decorative: true })}</span>`;

/** 'town:city-3' or {kind, id} as {kind, id}; null for anything that is not a reference. */
export function parseRef(value) {
  const at = typeof value === 'string' ? value.indexOf(':') : -1, kind = value && typeof value === 'object' ? value.kind : at > 0 ? value.slice(0, at) : '';
  const id = value && typeof value === 'object' ? value.id : at > 0 ? value.slice(at + 1) : '';
  return REF_KINDS.includes(kind) && id != null && id !== '' ? { kind, id: String(id) } : null;
}
export const refKey = value => { const parsed = parseRef(value); return parsed ? `${parsed.kind}:${parsed.id}` : null; };

// A kind's mark (7.1): a route's bullet, a stop's roundel, the town glyph, an industry's output cargo tile, a vehicle's mode glyph, a cargo tile.
const markOf = (kind, id, { route, cargo, mode, size = 16 }) => kind === 'route' ? bullet(route || { mode }, { size, named: true }) : kind === 'stop' ? roundel() : kind === 'town' ? icon('town', { size: 16 })
  : kind === 'industry' ? cargo ? cargoTile(cargo) : icon('industry', { size: 16 }) : kind === 'vehicle' ? icon(modeGlyph(mode || route?.mode, cargo || route?.cargo), { size: 16 }) : cargoTile(id);

/** A reference (7.2): <button class="ref ref--prose" data-ref="industry:industry-12" aria-label="Stone quarry, industry"> with the
 * kind's mark (a route's bullet, a stop's roundel, the town glyph, an industry's output cargo tile, a vehicle's mode glyph, a
 * cargo tile) and the escaped label. variant: 'prose' (inline, underlined), 'row' (a whole list row; `after` holds the rest of
 * the row), 'compact' (the mark alone) or 'onInk'; onInk also turns a compact mark onto ink. A vehicle names its route with a
 * small bullet after the label. Something gone, or no id, is plain text in span.ref--gone. */
export function ref(kind, id, label, { variant = 'prose', route = null, cargo = null, mode = null, onInk = false, gone = false, size = 0, after = '' } = {}) {
  if (gone || id == null || id === '' || !REF_KINDS.includes(kind)) return `<span class="ref--gone">${escape(label)}</span>`;
  const compact = variant === 'compact', mark = markOf(kind, id, { route, cargo, mode, size: size || (variant === 'row' || compact ? 20 : 16) });
  const noun = kind === 'route' && validRouteNumber(route?.number) ? `route ${route.number}` : kind, cls = (VARIANTS[variant] || VARIANTS.prose) + (onInk && variant !== 'onInk' ? ' ref--on-ink' : '');
  const trail = kind === 'vehicle' && route && !compact ? bullet(route, { size: 16, named: true }) : '';
  return `<button type="button" class="${cls}" data-ref="${escape(`${kind}:${id}`)}" aria-label="${escape(`${label}, ${noun}`)}"><span class="ref-mark">${mark}</span>${compact ? '' : `<span class="ref-label">${escape(label)}</span>`}${trail}${after}</button>`;
}

/** 'Truck 2': the vehicle's noun and its place among its route's vehicles. */
export function vehicleLabel(game, vehicle) {
  const route = game?.routes?.find(item => item.id === vehicle?.routeId), fleet = (game?.vehicles || []).filter(item => item.routeId === vehicle?.routeId);
  return `${capital(vehicleNoun(route?.mode, route?.cargo))} ${fleet.indexOf(vehicle) + 1}`;
}

/** What a reference points at: {exists, kind, id, label, entity, frame}. A frame is in tiles, x0..x1 and y0..y1 inclusive, with
 * cx, cy where the view centres when that is not its middle: a route's path (centred on its projected extent, as Show frames
 * it), an industry's footprint, a town's centre ± 4 tiles, a stop's tile or an airport's 6 × 2 site, a vehicle's position (a
 * plane in flight at vehiclePoint(vehicle), the renderer's). Cargo has no frame: it lights the cargo lens instead. */
export function resolveRef(game, value, { vehiclePoint } = {}) {
  const parsed = parseRef(value), none = { exists: false, kind: parsed?.kind ?? null, id: parsed?.id ?? null, label: '', entity: null, frame: null };
  if (!parsed) return none;
  const { kind, id } = parsed;
  if (kind === 'cargo') return Object.hasOwn(CARGO, id) ? { exists: true, kind, id, label: cargoName(id), entity: null, frame: null } : none;
  const entity = game?.[LISTS[kind]]?.find(item => String(item.id) === id);
  if (!entity) return none;
  let label = entity.name, frame = null;
  if (kind === 'route') {
    const points = entity.path?.length ? entity.path : (entity.stops || []).map(stop => game.stations?.find(station => station.id === stop)).filter(Boolean);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); u0 = Math.min(u0, p.x - p.y); u1 = Math.max(u1, p.x - p.y); v0 = Math.min(v0, p.x + p.y); v1 = Math.max(v1, p.x + p.y); }
    const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
    if (points.length) frame = { x0, y0, x1, y1, cx: (u + v) / 2, cy: (v - u) / 2 };
  } else if (kind === 'industry') { const size = industrySize(entity); label ||= INDUSTRIES[entity.kind]?.name || 'Industry'; frame = { x0: entity.x, y0: entity.y, x1: entity.x + size - 1, y1: entity.y + size - 1 }; }
  else if (kind === 'town') frame = { x0: entity.x - 4, y0: entity.y - 4, x1: entity.x + 4, y1: entity.y + 4, cx: entity.x, cy: entity.y };
  else if (kind === 'stop') { const { w, h } = stationSpan(entity); frame = { x0: entity.x, y0: entity.y, x1: entity.x + w - 1, y1: entity.y + h - 1 }; }
  else { const p = vehiclePoint?.(entity) || entity; label = vehicleLabel(game, entity); frame = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
  return { exists: true, kind, id, label: label || '', entity, frame };
}

/** The reference to a live entity by 'kind:id', with its label and mark read from the game, or plain words when it has gone. */
export function refFor(game, value, { variant = 'prose', onInk = false, size = 0, after = '' } = {}) {
  const target = resolveRef(game, value), parsed = parseRef(value), entity = target.entity;
  if (!target.exists) return ref(parsed?.kind, null, parsed?.kind === 'cargo' ? parsed.id : GONE[parsed?.kind] || '', { gone: true });
  const route = target.kind === 'route' ? entity : target.kind === 'vehicle' ? game.routes?.find(item => item.id === entity.routeId) : null;
  const cargo = target.kind === 'industry' ? Object.keys(INDUSTRIES[entity.kind]?.outputs || {})[0] : route?.cargo;
  return ref(target.kind, target.id, target.label, { variant, onInk, route, cargo, mode: target.kind === 'stop' ? entity.mode : route?.mode, size, after });
}

/** The mark of a live entity's reference, for surfaces that show it outside a reference button (the edge pointer); '' if it has gone. */
export function refMark(game, value, { size = 16 } = {}) {
  const target = resolveRef(game, value), entity = target.entity;if (!target.exists) return '';
  const route = target.kind === 'route' ? entity : target.kind === 'vehicle' ? game.routes?.find(item => item.id === entity.routeId) : null;
  return markOf(target.kind, target.id, { route, cargo: target.kind === 'industry' ? Object.keys(INDUSTRIES[entity.kind]?.outputs || {})[0] : route?.cargo, mode: target.kind === 'stop' ? entity.mode : route?.mode, size });
}

/** A message template (7.6) as markup: entity tokens become prose references (on ink for toasts, with onInk), a token whose
 * entity has gone plain words, {money:n} and {date:day} copy.js text, and everything else escaped text. */
export function renderTemplate(template, game, { onInk = false } = {}) {
  const text = String(template ?? '');let out = '', last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, kind, id] = match;
    out += escape(text.slice(last, match.index)) + (kind === 'money' ? escape(money(Number(id))) : kind === 'date' ? escape(dateLong(Number(id))) : refFor(game, `${kind}:${id}`, { variant: onInk ? 'onInk' : 'prose' }));
    last = match.index + whole.length;
  }
  return out + escape(text.slice(last));
}

// .is-linked marks every element that names what the pointer or keyboard is on (hover), or what the map pointer is over (map).
const linked = { hover: null, map: null };
function relink() {
  if (!globalThis.document) return;
  const on = new Set([linked.hover, linked.map].filter(Boolean));
  for (const el of document.querySelectorAll('[data-ref]')) el.classList.toggle('is-linked', on.has(el.dataset.ref));
}
/** Map hover lights the rows and references of the entity under the pointer in open panels; nothing scrolls. null clears it. */
export function linkFromMap(value) { const next = refKey(value); if (next === linked.map) return; linked.map = next; relink(); }

let installed = null;
/** The one delegated set of document listeners (7.3). Pointer hover counts after 150 ms of intent and keyboard focus at once;
 * either sets view.hoverRef, which the map highlights, and links every [data-ref] with the same value. A click or Enter calls
 * onOpen(ref, {source, open: true, hold: 0, keyboard}); data-ref-action="show" asks for {open: false, hold: 4000}; a cargo
 * reference calls onCargo(cargo, {source}) instead. Returns {clear, relink}. */
export function installReferences({ getGame, view, onOpen, onCargo }) {
  if (installed) return installed;
  let pending = 0, leaving = 0;
  const owner = node => node?.closest?.('[data-ref]'), live = el => el && !el.classList.contains('ref--gone') ? el.dataset.ref : null;
  const set = value => { clearTimeout(pending); clearTimeout(leaving); if (view.hoverRef === value) return; view.hoverRef = value; linked.hover = value; relink(); };
  document.addEventListener('pointerover', e => {
    const value = live(owner(e.target));if (!value) return;
    clearTimeout(leaving); clearTimeout(pending);
    if (value !== view.hoverRef) pending = setTimeout(() => set(value), INTENT_MS);
  });
  document.addEventListener('pointerout', e => {
    const from = live(owner(e.target));if (!from || from === live(owner(e.relatedTarget))) return;
    clearTimeout(pending);if (view.hoverRef !== from) return;
    // The edge pointer is a reference to the same target, so the pointer keeps the hover on its way there.
    clearTimeout(leaving); leaving = setTimeout(() => set(null), document.querySelector(`.edge-pointer[data-ref="${CSS.escape(from)}"]`) ? 700 : 60);
  });
  document.addEventListener('focusin', e => { const value = live(owner(e.target)); if (value && e.target.matches(':focus-visible')) set(value); });
  document.addEventListener('focusout', e => { const from = live(owner(e.target)); if (from && from === view.hoverRef && from !== live(owner(e.relatedTarget))) set(null); });
  document.addEventListener('click', e => {
    const el = owner(e.target), value = live(el), parsed = parseRef(value);if (!parsed) return;
    if (parsed.kind === 'cargo') { onCargo?.(parsed.id, { source: el }); return; }
    const show = el.dataset.refAction === 'show';
    if (resolveRef(getGame?.(), value).exists) onOpen?.(value, { source: el, open: !show, hold: show ? SHOW_MS : 0, keyboard: e.detail === 0 });
  });
  // Enter opens a reference that is not a button itself (a row); buttons click on Enter already.
  document.addEventListener('keydown', e => { const el = owner(e.target); if (e.key !== 'Enter' || e.defaultPrevented || el !== e.target || el.matches('button,a,input,select,textarea,summary')) return; e.preventDefault(); el.click(); });
  return installed = { clear: () => set(null), relink };
}
