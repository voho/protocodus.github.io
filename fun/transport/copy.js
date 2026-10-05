import { CARGO, INDUSTRIES } from './data.js';

// The words layer (DESIGN.md 6): figures, units, dates, vehicle and stop words, and the
// message templates (7.6) the model and the interface share. DOM-free, so the model imports it.
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const MINUS = '−', MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VEHICLES = { rail: 'train', water: 'ship', air: 'plane' }, STOPS = { road: 'road stop', rail: 'rail station', water: 'port', air: 'airport' };
const whole = n => Math.round(Number(n) || 0);
/** Text made safe inside HTML elements and quoted attributes. */
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** '$372,875'; compact gives '$18k', '$372.9k' and '$1.2M'. Negatives take a true minus; signed adds '+'. */
export function money(n, { compact = false, signed = false } = {}) {
  const value = whole(n), size = Math.abs(value);
  return `${value < 0 ? MINUS : signed && value > 0 ? '+' : ''}$${compact && size >= 1000 ? COMPACT.format(size).replace('K', 'k') : WHOLE.format(size)}`;
}
export const perMonth = (n, options) => `${money(n, { ...options, signed: true })} a month`;
export const number = n => WHOLE.format(whole(n));
export const count = (n, one, many = one + 's') => `${number(n)} ${whole(n) === 1 ? one : many}`;
export const listJoin = (items, word = 'and') => items.length < 3 ? items.join(` ${word} `) : `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`;
export const tiles = n => count(n, 'tile');
export const capital = text => text ? text[0].toUpperCase() + text.slice(1) : '';
/** 'stone', 'iron ore', 'passengers' ('passenger' for one), 'mail'. */
export const cargoName = (cargo, n) => cargo === 'passengers' && n !== undefined && whole(n) === 1 ? 'passenger' : CARGO[cargo]?.name.toLowerCase() ?? String(cargo ?? '');
export const cargoAmount = (n, cargo) => `${number(n)} ${cargoName(cargo, n)}`;
// Game day 0 is 1 January 1950 (UTC). English month names, so September reads 'Sep' in every locale data set.
const calendar = day => { const date = new Date(Date.UTC(1950, 0, 1 + Math.floor(Number(day) || 0))); return Number.isNaN(date.getTime()) ? null : date; };
export const dateShort = day => { const date = calendar(day); return date ? `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : ''; };
export const dateLong = day => { const date = calendar(day); return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : ''; };
/** A vehicle's model is the year it was first sold: level 0 is the 1950 model. */
export const modelYear = level => 1950 + (Number.isInteger(level) ? level : 0);
/** bus, truck, train, ship or plane; mail runs as a mail truck, train, ship or plane. Plural unless n is 1. */
export function vehicleNoun(mode, cargo, n = 1) {
  const base = VEHICLES[mode] || (cargo === 'passengers' ? 'bus' : 'truck'), noun = cargo === 'mail' ? `mail ${base}` : base;
  return n === 1 ? noun : noun === 'bus' ? 'buses' : noun + 's';
}
export const stopKind = mode => STOPS[mode] || 'stop';

// Templates name things with tokens: {route:id}, {stop:id}, {town:id}, {industry:id}, {vehicle:id},
// {cargo:id}, {money:n} and {date:day}. The interface renders them as references.
export const token = (kind, id) => `{${kind}:${id}}`;
const TOKEN = /\{(route|stop|town|industry|vehicle|cargo|money|date):([^{}]+)\}/g;
/** The plain text of a template. resolveName(kind, id) names entities; unknown ids become empty. */
export const plain = (template, resolveName) => String(template ?? '').replace(TOKEN, (_, kind, id) => kind === 'money' ? money(Number(id)) : kind === 'date' ? dateLong(Number(id)) : resolveName?.(kind, id) ?? (kind === 'cargo' ? cargoName(id) : ''));
const LISTS = { route: 'routes', stop: 'stations', town: 'cities', industry: 'industries' };
/** Names from a live game for plain(): routes, stops, towns, industries, vehicles and cargo. */
export const namesIn = game => (kind, id) => {
  if (kind === 'cargo') return cargoName(id);
  if (kind === 'vehicle') { const vehicle = game?.vehicles?.find(item => item.id === id), route = vehicle && game.routes.find(item => item.id === vehicle.routeId); return route ? capital(vehicleNoun(route.mode, route.cargo)) : undefined; }
  const item = game?.[LISTS[kind]]?.find(entry => String(entry.id) === String(id));
  return item ? item.name || INDUSTRIES[item.kind]?.name : undefined;
};
