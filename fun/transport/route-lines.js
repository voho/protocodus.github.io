// Route identity (DESIGN.md 4.3 and 8): the number, line colour and default name of each route. DOM-free, so the
// simulation, the renderer and the interface read one answer. Always read a route's colour through lineFor(route).
import { LINE_COLORS } from './design-tokens.js';
import { INDUSTRIES } from './data.js';
import { nearbyCities, nearbyIndustries } from './simulation-spatial.js';
import { industryDistance } from './industry-sites.js';
import { workshopInputs, workshopOutputs } from './town-market.js';
import { stationDistance, stationReach, stationServes } from './station-sites.js';

// index is the DESIGN.md number, 1–9 as in --line-N; light fills take ink numerals and an ink casing on the map.
const LINES = LINE_COLORS.map((line, i) => Object.freeze({ index: i + 1, name: line.name, fill: line.fill, on: line.on, light: line.on !== '#FFFFFF' }));
// Saves keep their stored hex: the old palette's six colours map to their successors, any other hex to the nearest fill.
const LEGACY = { '#69c6bc': 'Cobalt', '#efc16f': 'Marigold', '#e5966d': 'Crimson', '#88aee4': 'Cornflower', '#b3cf83': 'Plum', '#d893b1': 'Heather' };
const lines = new Map(), rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function lineColor(hex) {
  const key = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '';
  let line = lines.get(key);
  if (!line) {
    const [r, g, b] = key ? rgb(key) : [0, 0, 0], gap = fill => { const [fr, fg, fb] = rgb(fill); return (fr - r) ** 2 + (fg - g) ** 2 + (fb - b) ** 2; };
    line = !key ? LINES[0] : LINES.find(entry => entry.fill.toLowerCase() === key) || LINES.find(entry => entry.name === LEGACY[key]) || LINES.reduce((best, entry) => gap(entry.fill) < gap(best.fill) ? entry : best);
    lines.set(key, line);
  }
  return line;
}
export const lineFor = route => lineColor(route?.color);

// A new line avoids every colour worn by a route at its stops and takes, of the rest, the one fewest routes wear, lowest
// first; with all nine at its stops, the one least worn there. Retiring a route recolours nothing.
export function nextLineColor(game, stopIds = []) {
  const stops = new Set(stopIds), here = LINES.map(() => 0), worn = LINES.map(() => 0);
  for (const route of game.routes || []) { const i = lineFor(route).index - 1; worn[i]++; if (route.stops?.some(id => stops.has(id))) here[i]++; }
  const least = (list, count) => list.reduce((best, line) => count[line.index - 1] < count[best.index - 1] ? line : best), free = LINES.filter((line, i) => !here[i]);
  return free.length ? least(free, worn) : least(LINES, here);
}

// route.number is a stable identity from 1 to 9999: the lowest free number, never reused while its route runs.
export const validRouteNumber = n => Number.isInteger(n) && n >= 1 && n <= 9999;
export function nextRouteNumber(game) {
  const used = new Set();for (const route of game.routes || []) if (validRouteNumber(route.number)) used.add(route.number);
  let n = 1;while (used.has(n)) n++;
  return n <= 9999 ? n : undefined;
}
// Numbers routes whose number is missing, invalid or taken by an older route, oldest first: by the counter in the id,
// then by list order. A valid number is never changed, so a legacy save numbers the same way every time.
export function ensureRouteNumbers(game) {
  const made = route => { const match = /(\d+)$/.exec(route.id); return match ? +match[1] : Infinity; };
  const order = (game.routes || []).map((route, i) => [made(route), i, route]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(entry => entry[2]);
  const used = new Set(), missing = [];
  for (const route of order) if (validRouteNumber(route.number) && !used.has(route.number)) used.add(route.number); else missing.push(route);
  let n = 0;
  for (const route of missing) { do n++; while (used.has(n)); if (n > 9999) delete route.number; else route.number = n; }
  return missing.length;
}
export const routeLabel = route => validRouteNumber(route?.number) ? `Route ${route.number}` : 'Route';

// Default names say what a route does. Freight runs '<supplier> to <buyer>', each end named after the site its stop
// serves for the cargo, else its town's workshops when they make or take it, else the stop's town, else the stop; passengers
// and mail join two towns with an en dash, and mail says so at the end.
// A name another route already has gets ' 2', ' 3' and so on; `except` (a route or its id) never counts, so a route
// renamed along its stops does not collide with itself. Names in a save are never rewritten.
const REACH = 5, NAME_LENGTH = 36, TOWN_TO_TOWN = new Set(['passengers', 'mail']);
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// An airport names the towns within its wider reach, measured from its nearest tile.
const townsNear = (game, stop) => nearbyCities(game, stop.x, stop.y, stationReach(stop) + (stop.mode === 'air' ? 5 : 0)).filter(town => stationServes(stop, town));
const siteName = site => site.name || INDUSTRIES[site.kind]?.name || '';
const fit = (text, length) => text.length > length ? text.slice(0, length - 1).trimEnd() + '…' : text;
function townPair(game, from, to) {
  let best = null, walk = Infinity;
  for (const a of townsNear(game, from)) for (const b of townsNear(game, to)) if (a.id !== b.id && stationDistance(from, a) + stationDistance(to, b) < walk) { best = [a, b]; walk = stationDistance(from, a) + stationDistance(to, b); }
  return best;
}
export function defaultRouteName(game, stations, cargo, except = null) {
  const [from, to] = stations || [];
  if (!from || !to) return '';
  const place = stop => townsNear(game, stop).reduce((best, town) => !best || stationDistance(stop, town) < stationDistance(stop, best) ? town : best, null)?.name || stop.name;
  const site = (stop, role, other) => nearbyIndustries(game, stop.x, stop.y, REACH + 2).find(site => site !== other && INDUSTRIES[site.kind]?.[role][cargo] && industryDistance(site, stop) <= REACH);
  let base;
  if (TOWN_TO_TOWN.has(cargo)) { const pair = townPair(game, from, to); base = pair ? `${pair[0].name} – ${pair[1].name}` : `${place(from)} – ${place(to)}`; }
  else {
    const supplier = site(from, 'outputs'), buyer = site(to, 'inputs', supplier), ends = townsNear(game, to);
    const workshops = (stop, fits) => townsNear(game, stop).filter(fits).reduce((best, town) => !best || apart(town, stop) < apart(best, stop) ? town : best, null);
    const maker = !supplier && workshops(from, town => !ends.includes(town) && workshopOutputs(game, town).includes(cargo)), user = !buyer && workshops(to, town => workshopInputs(game, town).includes(cargo));
    base = `${supplier ? siteName(supplier) : maker ? `${maker.name} workshops` : place(from)} to ${buyer ? siteName(buyer) : user ? `${user.name} workshops` : place(to)}`;
  }
  const skip = typeof except === 'string' ? except : except?.id, taken = new Set();
  for (const route of game.routes || []) if (route.id !== skip) taken.add(route.name);
  const kind = cargo === 'mail' ? ' mail' : '';
  for (let n = 1; ; n++) { const count = n > 1 ? ` ${n}` : '', name = fit(base, NAME_LENGTH - kind.length - count.length) + kind + count; if (!taken.has(name)) return name; }
}
