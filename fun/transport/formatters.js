// Cached Intl formatters for text rewritten on every HUD tick or frame: HUD
// figures, route cards and town labels. Each prints exactly what the toLocale*
// call it replaces printed, without building a new formatter per call.
const NUMBER = new Intl.NumberFormat('en-US');
const TENTHS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const DAY = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_LIMIT = 256;

export const integerText = value => NUMBER.format(Math.floor(Number(value) || 0));
export const tenthsText = value => TENTHS.format(value);
export const compactText = value => COMPACT.format(value);

// Game day 0 is 1 January 1950 (UTC). A day outside Date's range reads
// 'Invalid Date', as toLocaleDateString did, instead of throwing.
const dateText = (format, day) => { const time = Date.UTC(1950, 0, 1 + Math.floor(day)); return Number.isFinite(time) ? format.format(time) : 'Invalid Date'; };
// Route cards repeat a few accounting start days on every tick.
const days = new Map();
export const dayText = day => { const key = Math.floor(day); let text = days.get(key); if (text === undefined) { if (days.size >= DAY_LIMIT) days.clear(); days.set(key, text = dateText(DAY, key)); } return text; };
export const monthText = day => dateText(MONTH, day);
export const longDayText = day => dateText(LONG_DAY, day);

// A town label keeps its text until its whole-number population changes.
const populations = new WeakMap();
export const populationText = city => { const count = Math.floor(Number(city.population) || 0); let label = populations.get(city); if (label?.count !== count) populations.set(city, label = { count, text: NUMBER.format(count) }); return label.text; };
