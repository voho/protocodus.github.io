import { CARGO, INDUSTRIES } from './data.js';
import { priceFor, inflationInfo, calendarYear } from './economy-pricing.js';
import { activeCities } from './settlements.js';

// Achievements are long-horizon records in bronze, silver, gold and platinum. They are recognition only: they pay
// nothing, unlock nothing and no simulation or UI module other than this one, achievements-view.js and app.js's
// dialog, notices and company count reads game.achievements. tick() evaluates them at day boundaries only, with
// no notify(), randomAt or ids; a stamp, once made, is never taken back. DOM-free, and never imports model.js.
export const ACHIEVEMENT_TIERS = Object.freeze(['bronze', 'silver', 'gold', 'platinum']);
export const TIER_NAMES = Object.freeze({ bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' });
// Bit order is saved: append only.
export const CARGO_ORDER = Object.freeze(['passengers', 'timber', 'lumber', 'coal', 'iron', 'steel', 'grain', 'food', 'furniture', 'machinery', 'fish', 'oil', 'fuel', 'stone', 'sand', 'glass', 'copper', 'wire', 'cement', 'goods', 'mail', 'milk', 'produce', 'livestock']);
export const CARGO_BIT = Object.freeze(Object.fromEntries(CARGO_ORDER.map((key, i) => [key, 1 << i])));
export const CARGO_MASK = 2 ** CARGO_ORDER.length - 1;
// Ships reach a load of 1,000 with the 1981 models, trains with the 2001 models. A vehicle is first 50 years past its model year in 2000.
const HEAVY_YEAR = 1981, MUSEUM_YEAR = 2000, BIG_TOWN = 5000, FULL_CAPACITY = 3 - 1e-9;
const NONE = Object.freeze([]);
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const dayOfJan1 = year => Math.round((Date.UTC(year, 0, 1) - Date.UTC(1950, 0, 1)) / 864e5);
const flag = met => met ? 1 : 0;

const masks = new Map();
/** Every cargo the landscape's industries make, and mail; passengers are left out. */
export function cargoMask(biome) {
  let mask = masks.get(biome);
  if (mask === undefined) {
    mask = CARGO_BIT.mail;
    // Optional player-built chains do not add compulsory cargo to a landscape
    // achievement that an existing company may already be working toward.
    for (const definition of Object.values(INDUSTRIES)) if(!definition.buildOnly&&definition.biomes.includes(biome)) for(const key of Object.keys(definition.outputs)) mask |= CARGO_BIT[key] || 0;
    masks.set(biome, mask);
  }
  return mask;
}
export const cargoCount = bits => { let n = 0; for (let b = bits >>> 0; b; b &= b - 1) n++; return n; };

const group = (id, name) => Object.freeze({ id, name });
export const ACHIEVEMENT_GROUPS = Object.freeze([group('trade', 'Deliveries and earnings'), group('network', 'Fleet and network'), group('towns', 'Towns'), group('industry', 'Industry and cargo'), group('company', 'Company'), group('hidden', 'Hidden')]);
const rung = (id, tier, target, title) => Object.freeze({ id, tier, target, title });
const family = (id, groupId, name, detail, cadence, unit, measure, rungs, hidden = false) => Object.freeze({ id, group: groupId, name, detail, cadence, unit, measure, rungs: Object.freeze(rungs), ...hidden ? { hidden: true } : {} });
const secret = (id, tier, cadence, title, detail, measure) => family(id, 'hidden', title, detail, cadence, 'flag', measure, [rung(id, tier, 1, title)], true);

export const ACHIEVEMENT_FAMILIES = Object.freeze([
  family('delivered', 'trade', 'Deliveries', 'Passengers, mail and cargo delivered over your company’s lifetime.', 'day', 'delivered', game => game.totalDelivered,
    [rung('delivered-100k', 'bronze', 1e5, '100,000 delivered'), rung('delivered-1m', 'silver', 1e6, 'A million delivered'), rung('delivered-10m', 'gold', 1e7, 'Ten million delivered'), rung('delivered-100m', 'platinum', 1e8, 'A hundred million delivered')]),
  family('profit-year', 'trade', 'Best year', 'Operating profit in one calendar year, in 1950 dollars.', 'year', 'money', (game, state) => state.bestYear,
    [rung('profit-year-10m', 'silver', 1e7, 'A $10 million year'), rung('profit-year-100m', 'platinum', 1e8, 'A $100 million year')]),
  family('route-year', 'trade', 'Star route', 'Profit one route earns in a calendar year, in 1950 dollars.', 'year', 'money', (game, state) => state.bestRouteYear,
    [rung('route-year-1m', 'silver', 1e6, 'Million-dollar route'), rung('route-year-10m', 'platinum', 1e7, 'Ten-million-dollar route')]),
  family('property', 'trade', 'Rent', 'Rent your property earns in one calendar year, in 1950 dollars.', 'year', 'money', (game, state) => state.bestRent ?? 0,
    [rung('property-10k', 'bronze', 1e4, 'Landlord'), rung('property-100k', 'silver', 1e5, 'Estate'), rung('property-1m', 'gold', 1e6, 'Property empire')]),
  family('fleet', 'network', 'Fleet', 'Vehicles you own at the same time.', 'day', 'vehicles', game => game.vehicles.length,
    [rung('fleet-10', 'bronze', 10, 'Ten vehicles'), rung('fleet-100', 'silver', 100, 'A hundred vehicles'), rung('fleet-1000', 'gold', 1000, 'A thousand vehicles')]),
  family('network', 'network', 'Network', 'Road and railway tiles you have built. Town streets don’t count.', 'month', 'tiles', (game, state, ctx) => ctx.network.owned,
    [rung('network-1k', 'bronze', 1000, '1,000 tiles of road and rail'), rung('network-10k', 'silver', 1e4, '10,000 tiles of road and rail'), rung('network-100k', 'platinum', 1e5, '100,000 tiles of road and rail')]),
  family('structures', 'network', 'Bridges and tunnels', 'Bridge and tunnel tiles in your network.', 'month', 'tiles', (game, state, ctx) => ctx.network.structures,
    [rung('structures-100', 'bronze', 100, '100 bridge and tunnel tiles'), rung('structures-1k', 'silver', 1000, '1,000 bridge and tunnel tiles'), rung('structures-10k', 'platinum', 1e4, '10,000 bridge and tunnel tiles')]),
  family('longest', 'network', 'Long lines', 'Your longest running route by road, rail or water, in tiles.', 'month', 'tiles', (game, state, ctx) => ctx.longest,
    [rung('longest-250', 'bronze', 250, 'A 250-tile line'), rung('longest-1000', 'gold', 1000, 'A 1,000-tile line')]),
  family('served', 'towns', 'Towns served', 'Towns within 5 tiles of a stop on a running route, or 7 of an airport.', 'month', 'towns', (game, state, ctx) => ctx.served.size,
    [rung('served-50', 'gold', 50, 'Fifty towns served'), rung('served-100', 'platinum', 100, 'A hundred towns served')]),
  family('every-town', 'towns', 'Every town', 'Serve every town on the map at once, in a world of 25 towns or more.', 'month', 'flag', (game, state, ctx) => flag(game.cities.length >= 25 && ctx.served.size === game.cities.length),
    [rung('every-town', 'gold', 1, 'Every town')]),
  family('big-towns', 'towns', 'Big towns', 'Towns with 5,000 residents or more.', 'month', 'towns', (game, state, ctx) => ctx.towns.big,
    [rung('town-5000', 'silver', 1, 'A town of 5,000'), rung('towns-5000-10', 'gold', 10, 'Ten towns of 5,000')]),
  family('founded', 'towns', 'Founder’s town', 'A town you founded grows to 2,500 residents.', 'month', 'residents', (game, state, ctx) => ctx.towns.founded,
    [rung('founded-2500', 'silver', 2500, 'Founder’s town')]),
  family('every-cargo', 'industry', 'Every cargo', 'Deliver mail and each cargo your landscape produces at least once.', 'month', 'cargo', (game, state) => flag((state.cargo & cargoMask(game.biome)) === cargoMask(game.biome)),
    [rung('every-cargo', 'silver', 1, 'Every cargo')]),
  family('whole-economy', 'industry', 'Whole economy', 'Deliver mail and every cargo of your landscape within one calendar year.', 'year', 'cargo', (game, state) => flag((state.yearCargo & cargoMask(game.biome)) === cargoMask(game.biome)),
    [rung('whole-economy', 'gold', 1, 'Whole economy')]),
  family('full-capacity', 'industry', 'Full capacity', 'Industries working at their full 300% capacity at the same time.', 'month', 'industries', (game, state, ctx) => ctx.fullIndustries,
    [rung('full-capacity-10', 'silver', 10, 'Ten industries at 300%'), rung('full-capacity-50', 'gold', 50, 'Fifty industries at 300%')]),
  family('years', 'company', 'Years in business', 'Your company opened on 1 January 1950.', 'month', 'years', game => calendarYear(game) - 1950,
    [rung('years-10', 'bronze', 10, 'Ten years'), rung('years-25', 'silver', 25, 'Silver jubilee'), rung('years-50', 'gold', 50, 'Golden jubilee'), rung('years-100', 'platinum', 100, 'A century')]),
  // Never missable: any model still running 50 years after its model year counts, so an upgrade never closes the door.
  secret('museum-piece', 'silver', 'month', 'Museum piece', 'A vehicle still runs 50 years after its model year.', (game, state, ctx) => flag(calendarYear(game) >= MUSEUM_YEAR && calendarYear(game) - ctx.vehicles.model >= MUSEUM_YEAR - 1950)),
  secret('grand-central', 'silver', 'month', 'Grand central', 'Ten different destinations from one stop.', (game, state, ctx) => flag(ctx.partners >= 10)),
  secret('back-from-red', 'silver', 'day', 'Back from the red', 'After a month closed in the red, hold $1 million in 1950 dollars.', (game, state) => flag(state.red === true && game.money >= 1e6 && game.money >= priceFor(game, 1e6))),
  secret('heavy-haul', 'gold', 'month', 'Heavy haul', 'One vehicle carries a load of 1,000 at once.', (game, state, ctx) => flag(calendarYear(game) >= HEAVY_YEAR && ctx.vehicles.load >= 1000)),
  secret('billion-nominal', 'gold', 'day', 'A billion, nominally', 'Hold $1,000,000,000 in today’s dollars. Inflation helped.', game => flag(game.money >= 1e9)),
]);
export const ACHIEVEMENTS = Object.freeze(ACHIEVEMENT_FAMILIES.flatMap(f => f.rungs.map(r => Object.freeze({ ...r, family: f.id, group: f.group, detail: f.detail, hidden: Boolean(f.hidden) }))));
export const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map(a => a.id));
export const achievementById = id => BY_ID.get(id) || null;
const BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a])), ORDER = new Map(ACHIEVEMENTS.map((a, i) => [a.id, i]));
const FAMILIES = new Map(ACHIEVEMENT_FAMILIES.map(f => [f.id, f]));
const DAY = ACHIEVEMENT_FAMILIES.filter(f => f.cadence === 'day'), MONTH = ACHIEVEMENT_FAMILIES.filter(f => f.cadence === 'month'), YEAR = ACHIEVEMENT_FAMILIES.filter(f => f.cadence === 'year');

export const createAchievementState = day => ({ unlocked: {}, since: day, cargo: 0, yearCargo: 0, bestYear: 0, bestRouteYear: 0, bestRent: 0, red: false });
/** Earned catalog entries; unknown saved ids are ignored. */
export function earnedCount(game) { const unlocked = game.achievements?.unlocked; if (!unlocked) return 0; let n = 0; for (const a of ACHIEVEMENTS) if (owns(unlocked, a.id)) n++; return n; }

/** Called by unloadVehicle for every paid delivery. */
export function noteDelivery(state, cargo) { const b = CARGO_BIT[cargo]; if (b) { state.cargo |= b; state.yearCargo |= b; } }

// The month's measures, each built on first use in one pass: only families still open ask for them.
function monthContext(game, { served = null, network = null, networkTotals = null } = {}) {
  let longest = -1, partners = -1, towns = null, full = -1, vehicles = null;
  return {
    get served() { return served ??= activeCities(game); },
    get network() { return network ??= networkTotals?.(game) ?? { owned: 0, structures: 0 }; },
    get longest() { if (longest < 0) { longest = 0; for (const route of game.routes) if (route.active && route.mode !== 'air' && route.path?.length - 1 > longest) longest = route.path.length - 1; } return longest; },
    get partners() { return partners < 0 ? partners = busiestStop(game.routes) : partners; },
    get towns() {
      if (!towns) { towns = { big: 0, founded: 0, largest: 0 }; for (const city of game.cities) { const n = city.population; if (n >= BIG_TOWN) towns.big++; if (n > towns.largest) towns.largest = n; if (city.founded === true && n > towns.founded) towns.founded = n; } }
      return towns;
    },
    get fullIndustries() { if (full < 0) { full = 0; for (const industry of game.industries) if (industry.capacity >= FULL_CAPACITY) full++; } return full; },
    get vehicles() { if (!vehicles) { vehicles = { load: 0, model: Infinity }; for (const v of game.vehicles) { if (v.load > vehicles.load) vehicles.load = v.load; if (1950 + (v.level || 0) < vehicles.model) vehicles.model = 1950 + (v.level || 0); } } return vehicles; },
  };
}
// The most distinct stops one stop reaches directly over running routes; two routes on one pair count once.
function busiestStop(routes) {
  const partners = new Map(); let best = 0;
  const add = (a, b) => { let set = partners.get(a); if (!set) partners.set(a, set = new Set()); set.add(b); if (set.size > best) best = set.size; };
  for (const route of routes) if (route.active) { const a = route.stops[0], b = route.stops[1]; add(a, b); add(b, a); }
  return best;
}
// A family is skipped once every rung is stamped; each newly met rung is stamped today.
// Catalog ids are never Object.prototype keys, so a plain lookup tells a stamp apart from none.
function check(game, state, family, ctx, day, fresh) {
  const unlocked = state.unlocked, rungs = family.rungs; let open = false;
  for (let i = 0; i < rungs.length; i++) if (unlocked[rungs[i].id] === undefined) { open = true; break; }
  if (!open) return fresh;
  const value = family.measure(game, state, ctx);
  for (let i = 0; i < rungs.length; i++) { const r = rungs[i]; if (value >= r.target && unlocked[r.id] === undefined) { unlocked[r.id] = day; (fresh ||= []).push(r.id); } }
  return fresh;
}
// A closed calendar year's total: its company-report entry, else the sum of its months in history.
function yearTotal(game, yearIndex, key) {
  const entry = game.annual?.at(-1);
  if (entry?.year === 1950 + yearIndex) return entry[key] ?? 0;
  let sum = 0; for (const h of game.history) if (Math.floor(h.month / 12) === yearIndex) sum += h[key] ?? 0;
  return sum;
}
const deflate = (value, index) => Math.max(0, Math.round(value / index));
const bestRouteProfit = game => { let best = 0; for (const route of game.routes) if ((route.profitLastYear ?? 0) > best) best = route.profitLastYear; return best; };

const log = new WeakMap();
/** Runs once per simulated day from tick(), after the month closes; returns the ids stamped today, in catalog order. */
export function stepAchievements(game, { closedMonth = null, served = null, networkTotals = null } = {}) {
  const state = game.achievements; if (!state) return NONE;
  const day = Math.floor(game.day); let fresh = null;
  if (closedMonth !== null) {
    if (game.money < 0) state.red = true;
    if (closedMonth % 12 === 11) {
      // December: the year in 1950 dollars, at the index of the year just closed. Routes rolled profitLastYear already.
      const year = Math.floor(closedMonth / 12), index = inflationInfo(game, game.day - 1).index;
      state.bestYear = Math.max(state.bestYear, deflate(yearTotal(game, year, 'operatingProfit'), index));
      state.bestRouteYear = Math.max(state.bestRouteYear, deflate(bestRouteProfit(game), index));
      state.bestRent = Math.max(state.bestRent ?? 0, deflate(yearTotal(game, year, 'property'), index));
      for (const f of YEAR) fresh = check(game, state, f, null, day, fresh);
      state.yearCargo = 0;
    }
    const ctx = monthContext(game, { served, networkTotals });
    for (const f of MONTH) fresh = check(game, state, f, ctx, day, fresh);
  }
  for (let i = 0; i < DAY.length; i++) fresh = check(game, state, DAY[i], null, day, fresh);
  if (!fresh) return NONE;
  fresh.sort((a, b) => ORDER.get(a) - ORDER.get(b));
  let list = log.get(game); if (!list) log.set(game, list = []);
  list.push(...fresh);
  return fresh;
}
/** Ids stamped since the last drain, oldest first; the interface celebrates them. Never saved. */
export function drainAchievementUnlocks(game) { const list = log.get(game) || NONE; log.delete(game); return list; }

// Every closed calendar year on record, in 1950 dollars: the company report's entries and whole years of history.
function bestClosedYear(game, key) {
  let best = 0;
  for (const entry of game.annual || []) best = Math.max(best, deflate(entry[key] ?? 0, inflationInfo(game, dayOfJan1(entry.year)).index));
  const years = new Map();
  for (const h of game.history) { const year = Math.floor(h.month / 12), total = years.get(year) || { months: 0, sum: 0 }; total.months++; total.sum += h[key] ?? 0; years.set(year, total); }
  for (const [year, { months, sum }] of years) if (months === 12) best = Math.max(best, deflate(sum, inflationInfo(game, dayOfJan1(1950 + year)).index));
  return best;
}
/** An older save is credited quietly on load: records begin today, and whatever it already meets is stamped today, uncelebrated. */
export function backfillAchievements(game, { networkTotals = null } = {}) {
  const day = Math.floor(game.day), state = game.achievements = createAchievementState(day);
  for (const route of game.routes) if (route.delivered > 0) state.cargo |= CARGO_BIT[route.cargo] || 0;
  state.red = game.money < 0 || game.history.some(h => h.money < 0);
  state.bestYear = bestClosedYear(game, 'operatingProfit');
  state.bestRent = bestClosedYear(game, 'property');
  state.bestRouteYear = deflate(bestRouteProfit(game), inflationInfo(game, dayOfJan1(calendarYear(game) - 1)).index);
  const ctx = monthContext(game, { networkTotals });
  for (const f of ACHIEVEMENT_FAMILIES) if (f.id !== 'whole-economy') check(game, state, f, ctx, day, null);
  return state;
}

export function validAchievements(game) {
  const a = game.achievements;
  if (a === undefined) return true;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  const u = a.unlocked, day = Math.floor(game.day);
  if (!u || typeof u !== 'object' || Array.isArray(u) || ![Object.prototype, null].includes(Object.getPrototypeOf(u))) return false;
  const entries = Object.entries(u);
  if (entries.length > 64 || !entries.every(([id, stamp]) => id.length <= 40 && int(stamp, 0, day))) return false;
  return int(a.since, 0, day) && int(a.cargo, 0, CARGO_MASK) && int(a.yearCargo, 0, CARGO_MASK) && int(a.bestYear, 0, 1e15) && int(a.bestRouteYear, 0, 1e15) && (a.bestRent === undefined || int(a.bestRent, 0, 1e15)) && (a.red === undefined || typeof a.red === 'boolean');
}

/** A family's standing for the dialog: the live measure (a best record for yearly families), the next rung and its share. Never stamps. */
export function achievementProgress(game, familyId, context = {}) {
  const f = FAMILIES.get(familyId), state = game.achievements || createAchievementState(Math.floor(game.day)), unlocked = state.unlocked;
  const next = f.rungs.find(r => !owns(unlocked, r.id)), r = next || f.rungs.at(-1), value = f.measure(game, state, context.measures || monthContext(game, context));
  return { value, target: r.target, pct: Math.max(0, Math.min(100, Math.floor(100 * value / r.target))), rung: r, complete: !next };
}
/** The dialog's month measures, built once for all families. */
export const achievementMeasures = (game, context = {}) => monthContext(game, context);
