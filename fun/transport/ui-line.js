// The line language (DESIGN.md 8), the game's one memorable element: the route bullet, the stop roundel, the strip diagram
// and the ladder, as markup strings built with HTML and CSS (refs.css). Colours are the line tokens lineFor picks
// (var(--line-N)), so the map, rows, toasts and forms agree. DOM-free apart from drawOnce, which animates a strip on the page.
import { lineFor, validRouteNumber, routeLabel } from './route-lines.js';
import { isTownTraffic } from './data.js';
import { icon } from './ui-icons.js';
import { cargoIcon } from './cargo-icons.js';
import { cargoAmount, escapeHTML as escape, number, vehicleNoun } from './copy.js';
import { reducedMotion } from './ui-motion.js';

export const STRIP_CAPSULES = 8;
const MODES = new Set(['road', 'rail', 'water', 'air']), CUT = .06;
const modeOf = route => MODES.has(route?.mode) ? route.mode : 'road';
const colours = route => { const n = lineFor(route).index; return `--c:var(--line-${n});--on:var(--line-${n}-on)`; };
const pct = share => +(Math.max(0, Math.min(1, share)) * 100).toFixed(2), rest = share => +(100 - pct(share)).toFixed(2);

/** A route bullet (8.1): route.number in 12/700 on its line colour, a rounded square by road, a circle by rail, a pill by water
 * and a diamond by air; two or more digits stretch it (bullet--wide). size is 20 (rows, inspector) or 16 (prose, toasts).
 * Beside a visible name it is decoration; alone it is named 'Route 2'. */
export function bullet(route, { size = 20, named = false } = {}) {
  const text = validRouteNumber(route?.number) ? String(route.number) : '';
  const cls = ['bullet', `bullet--${modeOf(route)}`, size === 16 && 'bullet--16', text.length > 1 && 'bullet--wide', lineFor(route).light && 'bullet--light'].filter(Boolean).join(' ');
  return `<span class="${cls}" style="${colours(route)}" ${named ? 'aria-hidden="true"' : `role="img" aria-label="${escape(routeLabel(route))}"`}><span class="bullet__n">${text}</span></span>`;
}
/** A stop: a paper disc in an ink ring, or an --edge ring when no route uses it. */
export const roundel = ({ unused = false } = {}) => `<span class="roundel${unused ? ' roundel--unused' : ''}" aria-hidden="true"></span>`;

// Both ends sit at 0 and 100%; a stop between sits at its nearest point along the path.
function stopPlaces(route, stops) {
  const path = route?.path || [], last = stops.length - 1;
  return stops.map((stop, i) => {
    if (Number.isFinite(stop?.at)) return stop.at;
    if (!i || i === last || path.length < 2) return last ? i / last : 0;
    let best = 0, gap = Infinity;
    path.forEach((p, k) => { const d = (p.x - stop.x) ** 2 + (p.y - stop.y) ** 2; if (d < gap) { gap = d; best = k; } });
    return best / (path.length - 1);
  });
}

/** The strip diagram (8.2): a route's state left to right from its first stop to its last. stops are the stations in order
 * (each may give `at`, 0–1); vehicles are placed by progress along the path, eight capsules at most and then '+N', filled when
 * loaded; waiting[i] ({count, cargo} or a count of the route's cargo) sits above stop i; freight shows up to three chevrons
 * (direction 1 from the first stop, −1 back, 0 none); broken (true or the break's share of the line) cuts the line with a
 * dashed error gap and the broken glyph; proposed (8.3) is a dashed ink-2 line between two roundels. label(stop, i) returns
 * the markup under each end, a stop reference on the surfaces; by default the escaped name. */
export function strip({ route = {}, stops = [], vehicles = [], waiting = [], direction, broken = false, proposed = false, label } = {}) {
  const mode = modeOf(route), places = stopPlaces(route, stops), length = Math.max(1, (route.path?.length || 1) - 1), name = label || (stop => escape(stop?.name));
  const cut = proposed || broken === false || broken == null ? null : typeof broken === 'number' ? Math.max(CUT, Math.min(1 - CUT, broken)) : .5;
  const flow = proposed ? 0 : direction ?? (isTownTraffic(route.cargo) ? 0 : 1), parts = [];
  if (cut === null) parts.push('<span class="strip__line" style="left:0%;right:0%"></span>');
  else parts.push(`<span class="strip__line" style="left:0%;right:${rest(cut - CUT)}%"></span><span class="strip__gap" style="left:${pct(cut - CUT)}%;right:${rest(cut + CUT)}%"></span><span class="strip__line" style="left:${pct(cut + CUT)}%;right:0%"></span><span class="strip__cut" style="left:${pct(cut)}%">${icon('broken', { size: 16 })}</span>`);
  if (flow) for (const at of [.25, .5, .75]) if (cut === null || Math.abs(at - cut) > .1) parts.push(`<span class="strip__chevron${flow < 0 ? ' strip__chevron--back' : ''}" style="left:${pct(at)}%"></span>`);
  stops.forEach((stop, i) => parts.push(`<span class="strip__stop" style="left:${pct(places[i])}%">${roundel()}</span>`));
  const said = [stops.map(stop => stop?.name || 'Stop').join(' to ')], shown = proposed ? [] : vehicles.slice(0, STRIP_CAPSULES), loaded = vehicles.filter(v => v?.load > 0).length;
  for (const v of shown) parts.push(`<span class="strip__vehicle${v?.load > 0 ? ' strip__vehicle--loaded' : ''}" style="left:${pct((v?.progress || 0) / length)}%"></span>`);
  if (proposed) said.push('Proposed');
  else if (vehicles.length) said.push(`${number(vehicles.length)} ${vehicleNoun(mode, route.cargo, vehicles.length)}, ${number(loaded)} loaded`);
  stops.forEach((stop, i) => {
    const item = waiting[i], n = item && typeof item === 'object' ? item.count : item, cargo = item?.cargo || route.cargo, end = !i ? ' strip__waiting--start' : i === stops.length - 1 ? ' strip__waiting--end' : '';
    if (!(n > 0)) return;
    parts.push(`<span class="strip__waiting${end}" style="left:${pct(places[i])}%"><span class="cargo-tile">${cargoIcon(cargo, { decorative: true })}</span><span data-num>${number(n)}</span></span>`);
    said.push(`${cargoAmount(n, cargo)} waiting at ${stop?.name || 'a stop'}`);
  });
  if (cut !== null) said.push('The line is cut');
  const more = proposed ? 0 : Math.max(0, vehicles.length - STRIP_CAPSULES), ends = stops.length > 1 ? [stops[0], stops.at(-1)] : stops;
  const cls = ['strip', `strip--${mode}`, proposed && 'strip--proposed', !proposed && lineFor(route).light && 'strip--light'].filter(Boolean).join(' ');
  return `<div class="${cls}"${proposed ? '' : ` style="${colours(route)}"`}><div class="strip__row"><div class="strip__track" role="img" aria-label="${escape(said.join('. ') + '.')}">${parts.join('')}</div>${more ? `<span class="strip__more" data-num>+${number(more)}</span>` : ''}</div><div class="strip__names">${ends.map(stop => `<span class="strip__name">${name(stop, stops.indexOf(stop))}</span>`).join('')}</div></div>`;
}

/** A new route's line draws once from A to B in 400 ms; nothing moves under reduced motion. */
export function drawOnce(stripEl) {
  if (!stripEl?.classList || reducedMotion()) return;
  stripEl.classList.remove('strip--draw'); void stripEl.offsetWidth; stripEl.classList.add('strip--draw');
  setTimeout(() => stripEl.classList.remove('strip--draw'), 450);
}

/** The ladder (8.3), the strip turned vertical for goals and checklists: a done step is an ink roundel with a paper check, the
 * current one (the first not done, unless a step says current) a signal ring and the rest hollow --edge rings. Steps without a
 * part keep the one before (1 at first); the connector is solid within a part and dashed into the next. A step gives its
 * escaped label or its markup (html, for references) and an optional meta, such as the date it was done. */
export function ladder({ steps = [] } = {}) {
  const chosen = steps.findIndex(step => step?.current), current = chosen >= 0 ? chosen : steps.findIndex(step => !step?.done);
  let part = null;
  return `<ol class="ladder">${steps.map((step, i) => {
    const own = step.part ?? part ?? 1, fresh = i > 0 && own !== part, state = step.done ? 'done' : i === current ? 'current' : 'next';part = own;
    return `<li class="ladder__step ladder__step--${state}${fresh ? ' ladder__step--part' : ''}"><span class="ladder__node">${step.done ? icon('check', { size: 16 }) : ''}</span><span class="ladder__label">${step.html ?? escape(step.label)}</span>${step.meta ? `<span class="ladder__meta">${escape(step.meta)}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}
