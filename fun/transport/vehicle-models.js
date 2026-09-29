// DOM-free catalogue of fictional vehicle models. Every series has families
// that debut in a given January; each later January adds one mark. A vehicle's
// level is the year of its purchase or last upgrade minus 1950, so its model
// year and age need no saved field. Names and ages are presentation only:
// nothing here changes costs, speed, capacity or reliability.
const series = (mode, passengers, noun, plural, families) => Object.freeze({ mode, passengers, noun, plural,
  families: Object.freeze(families.map(([year, name]) => Object.freeze({ year, level: year - 1950, name }))) });
export const VEHICLE_SERIES = Object.freeze({
  bus: series('road', true, 'bus', 'buses', [[1950, 'Hollin'], [1961, 'Pendle'], [1973, 'Carrick'], [1984, 'Aldous'], [1996, 'Quenby'], [2008, 'Wrenna'], [2021, 'Tessaly'], [2035, 'Aurel']]),
  truck: series('road', false, 'truck', 'trucks', [[1950, 'Garrow'], [1958, 'Dunmore'], [1969, 'Kellet'], [1981, 'Tamber'], [1993, 'Oxley'], [2005, 'Brackett'], [2018, 'Stannard'], [2032, 'Corran']]),
  'passenger-train': series('rail', true, 'train', 'trains', [[1950, 'Lorne'], [1964, 'Solway'], [1977, 'Ellery'], [1990, 'Arden'], [2003, 'Halden'], [2017, 'Ormond'], [2031, 'Kestrin'], [2046, 'Elyra']]),
  'freight-train': series('rail', false, 'train', 'trains', [[1950, 'Rowdon'], [1962, 'Holloway'], [1975, 'Tarrant'], [1988, 'Morven'], [2001, 'Keld'], [2014, 'Ironwood'], [2028, 'Tavish'], [2043, 'Harrow']]),
  ferry: series('water', true, 'ferry', 'ferries', [[1950, 'Linnet'], [1966, 'Plover'], [1982, 'Skerry'], [1998, 'Selkie'], [2014, 'Petrel'], [2030, 'Halyard'], [2046, 'Moorhen']]),
  freighter: series('water', false, 'ship', 'ships', [[1950, 'Hawser'], [1960, 'Kedge'], [1976, 'Merrow'], [1992, 'Longshore'], [2008, 'Tolland'], [2024, 'Fathom'], [2040, 'Ardent']]),
});
const ART = { bus: 'bus', truck: 'truck', 'passenger-train': 'train', 'freight-train': 'train', ferry: 'ship', freighter: 'ship' };
const cleanLevel = level => Number.isInteger(level) && level > 0 ? level : 0;
const factor = n => { const tenths = Math.round(n * 10) / 10; return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1); };
const and = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export function vehicleSeriesKey(mode, cargo) {
  const passengers = cargo === 'passengers';
  return mode === 'rail' ? (passengers ? 'passenger-train' : 'freight-train') : mode === 'water' ? (passengers ? 'ferry' : 'freighter') : (passengers ? 'bus' : 'truck');
}
/** {series, name:'Hollin Mk 3', family, mark, year, level, debut, noun, plural}; the last family keeps counting marks. Mail rides in the freight body. */
export function vehicleModel(mode, cargo, level = 0) {
  const key = vehicleSeriesKey(mode, cargo), s = VEHICLE_SERIES[key], l = cleanLevel(level);
  let family = s.families[0];
  for (const f of s.families) { if (f.level > l) break; family = f; }
  const mark = l - family.level + 1, tanker = mode === 'water' && (cargo === 'oil' || cargo === 'fuel'), mail = cargo === 'mail' ? 'mail ' : '';
  return { series: key, name: `${family.name} Mk ${mark}`, family: family.name, mark, year: 1950 + l, level: l, debut: mark === 1 && l > 0, noun: tanker ? 'tanker' : mail + s.noun, plural: tanker ? 'tankers' : mail + s.plural };
}
/** Whole calendar years since the model year (1950 + level). */
export function vehicleAge(year, level) { return Math.max(0, year - 1950 - cleanLevel(level)); }
export function ageText(age) { return age <= 0 ? 'new this year' : age === 1 ? '1 year old' : `${age} years old`; }
/** Card text for a route's vehicle levels: one model, a mark range in one family, or the newest and older. Work is per distinct level. */
export function fleetModelText(mode, cargo, levels) {
  if (!levels?.length) return { text: '', title: '' };
  const counts = new Map(); let low = Infinity, high = -Infinity;
  for (const level of levels) { const l = cleanLevel(level); if (l < low) low = l; if (l > high) high = l; counts.set(l, (counts.get(l) || 0) + 1); }
  const newest = vehicleModel(mode, cargo, high), oldest = vehicleModel(mode, cargo, low);
  const text = low === high ? newest.name : oldest.family === newest.family ? `${newest.family} Mk ${oldest.mark}–${newest.mark}` : `${newest.name} and older`;
  if (levels.length === 1) return { text, title: `${newest.name}, ${newest.year} model` };
  const byName = new Map();
  for (const l of [...counts.keys()].sort((a, b) => a - b)) { const name = vehicleModel(mode, cargo, l).name; byName.set(name, (byName.get(name) || 0) + counts.get(l)); }
  return { text, title: and([...byName].map(([name, n]) => `${n} ${name}`)) };
}
/** The model a January notice names: the player's most-used series, preferring one whose new family debuts this year. */
export function newYearModel(routes, vehicles, level) {
  const routeById = new Map(), counts = new Map(), cargoOf = new Map();
  for (const route of routes) routeById.set(route.id, route);
  for (const vehicle of vehicles) {
    const route = routeById.get(vehicle.routeId); if (!route) continue;
    const key = vehicleSeriesKey(route.mode, route.cargo); counts.set(key, (counts.get(key) || 0) + 1); if (!cargoOf.has(key)) cargoOf.set(key, route.cargo);
  }
  const keys = Object.keys(VEHICLE_SERIES), debuts = key => VEHICLE_SERIES[key].families.some(family => family.level === level);
  const most = list => list.reduce((best, key) => best === null || counts.get(key) > counts.get(best) ? key : best, null);
  const used = keys.filter(key => counts.has(key));
  const key = most(used.filter(debuts)) ?? most(used) ?? keys.find(debuts) ?? 'bus', s = VEHICLE_SERIES[key];
  return vehicleModel(s.mode, cargoOf.get(key) ?? (s.passengers ? 'passengers' : 'freight'), level);
}
/** The January headline when the named model begins a new family (ttd-headlines' kind 'models'), or null. */
export function modelHeadline(model) {
  if (!model?.debut) return null;
  return { key: `models:${model.year}`, kind: 'models', art: ART[model.series], title: `New ${model.family} ${model.plural} arrive for ${model.year}`,
    detail: `The ${model.name} ${model.noun} carries ${factor(1 + model.level / 5)} times the load of a 1950 ${model.noun} and runs ${factor(1 + model.level / 10)}× as fast.` };
}
