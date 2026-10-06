import { ACHIEVEMENT_GROUPS, ACHIEVEMENT_FAMILIES, ACHIEVEMENTS, TIER_NAMES, CARGO_ORDER, CARGO_BIT, cargoMask, cargoCount, achievementProgress, achievementMeasures, earnedCount } from './achievements.js';
import { calendarYear, inflationInfo } from './economy-pricing.js';
import { icon } from './ui-icons.js';
import { cargoIcon } from './cargo-icons.js';
import { money, number, count, dateLong, dateShort, cargoName, capital, escapeHTML as escape } from './copy.js';

// The Achievements dialog as HTML strings (DOM-free): a medal strip, the next record, its measure and the last one
// earned, per family. It only reads: nothing here stamps a record. Tier colours live in dialogs.css and notices.css.
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const compact = n => money(n, { compact: true });
const share = (value, target) => target > 0 ? Math.max(0, Math.min(100, Math.floor(100 * value / target))) : 0;
const HIDDEN = 'Hidden achievement';
// A record met but not yet stamped is earned at its family's next evaluation.
const CLOSES = { day: 'at the end of the day', month: 'when the month closes', year: 'when the year closes' };

/** A tier roundel carrying the achievements glyph; a locked one is a pale tint of its tier. A mark ('?') replaces the glyph. */
export function medalIcon(tier, { locked = false, mark = '', label = '' } = {}) {
  const art = mark ? `<span class="medal-mark" aria-hidden="true">${escape(mark)}</span>` : icon('achievements', { size: 16 });
  const semantics = label ? `role="img" aria-label="${escape(label)}" title="${escape(label)}"` : 'aria-hidden="true"';
  return `<span class="medal medal--${escape(tier)}${locked ? ' is-locked' : ''}" ${semantics}>${art}</span>`;
}
export const tierName = tier => TIER_NAMES[tier] || capital(tier);

// This calendar year so far, in 1950 dollars at this year's index: closed months for the company, live profit for a route.
function thisYear(game, familyId) {
  const year = calendarYear(game) - 1950, index = inflationInfo(game).index;
  if (familyId === 'route-year') { let best = 0; for (const route of game.routes) if ((route.profitThisYear ?? 0) > best) best = route.profitThisYear; return Math.round(best / index); }
  const key = familyId === 'property' ? 'property' : 'operatingProfit';
  let sum = 0; for (const h of game.history) if (Math.floor(h.month / 12) === year) sum += h[key] ?? 0;
  return Math.round(sum / index);
}
// The measure line and bar share of an open family.
function measure(game, family, progress, measures) {
  const { value, target, rung } = progress, of = unit => ({ text: `${number(value)} of ${number(target)} ${unit}`, pct: share(value, target) });
  const state = game.achievements || {}, mask = cargoMask(game.biome), total = cargoCount(mask);
  switch (family.id) {
    case 'delivered': return of('delivered');
    case 'profit-year': case 'route-year': case 'property': {
      const now = thisYear(game, family.id), best = Math.max(value, now);
      return { text: now > value ? `This year so far ${compact(now)} of ${compact(target)}` : `Best year ${compact(value)} of ${compact(target)}`, pct: share(best, target) };
    }
    case 'fleet': return of('vehicles');
    case 'network': case 'structures': case 'longest': return of('tiles');
    case 'served': return of('towns');
    case 'full-capacity': return of('industries');
    case 'every-town': {
      const towns = game.cities.length, served = measures.served.size;
      return towns >= 25 ? { text: `${number(served)} of ${number(towns)} towns`, pct: share(served, towns) } : { text: `Needs a world of 25 towns or more. This one has ${number(towns)}.`, pct: 0 };
    }
    case 'big-towns': {
      if (rung.target > 1) return of('towns');
      const largest = measures.towns.largest;
      return { text: `Largest town ${number(largest)} of ${number(5000)} residents`, pct: share(largest, 5000) };
    }
    case 'founded': return game.cities.some(city => city.founded === true) ? { text: `Largest founded town ${number(value)} of ${number(target)} residents`, pct: share(value, target) } : { text: 'No founded towns yet', pct: 0 };
    case 'every-cargo': case 'whole-economy': {
      const bits = (family.id === 'every-cargo' ? state.cargo : state.yearCargo) & mask, have = cargoCount(bits);
      const missing = family.id === 'every-cargo' ? CARGO_ORDER.filter(key => mask & CARGO_BIT[key] && !(bits & CARGO_BIT[key])) : [];
      return { text: `${family.id === 'whole-economy' ? 'This year ' : ''}${number(have)} of ${number(total)} cargo types`, pct: share(have, total), missing };
    }
    case 'years': {
      const year = calendarYear(game), goal = 1950 + target;
      return { text: `${count(goal - year, 'year')} to ${goal}`, pct: share(year - 1950, target) };
    }
    default: return null;
  }
}
function row(game, family, measures) {
  const unlocked = game.achievements?.unlocked || {}, earned = family.rungs.filter(r => owns(unlocked, r.id)), attrs = `class="achievement-row" data-family="${family.id}"`;
  if (family.hidden && !earned.length) return `<li ${attrs} data-state="hidden"><span class="achievement-medals">${medalIcon('hidden', { locked: true, mark: '?', label: HIDDEN })}</span><div class="achievement-text"><strong>${HIDDEN}</strong><p>Keep playing to discover it.</p></div></li>`;
  const progress = achievementProgress(game, family.id, { measures }), title = progress.rung.title, last = earned.at(-1);
  const medals = family.rungs.map(r => owns(unlocked, r.id) ? medalIcon(r.tier, { label: `${tierName(r.tier)}: ${r.title}, earned ${dateLong(unlocked[r.id])}` }) : medalIcon(r.tier, { locked: true, label: `${tierName(r.tier)}: ${r.title}` })).join('');
  const line = progress.complete ? null : measure(game, family, progress, measures);
  if (line?.pct >= 100) line.text += `, earned ${CLOSES[family.cadence]}`;
  const bar = line ? `<div class="achievement-progress"><span class="achievement-meter" aria-hidden="true"><span style="width:${line.pct}%"></span></span><span class="achievement-value" data-num>${escape(line.text)}</span>${line.missing?.length ? `<span class="achievement-cargo">${line.missing.map(key => `<span class="achievement-cargo-tile" title="${escape(capital(cargoName(key)))}">${cargoIcon(key, { decorative: true })}</span>`).join('')}</span>` : ''}</div>` : '';
  const stamp = last ? `<p class="achievement-earned">${last.title === title ? 'Earned' : `${escape(last.title)}, earned`} ${dateLong(unlocked[last.id])}</p>` : '';
  return `<li ${attrs} data-state="${progress.complete ? 'complete' : 'open'}"><span class="achievement-medals">${medals}</span><div class="achievement-text"><strong>${escape(title)}</strong><p>${escape(family.detail)}</p>${bar}${stamp}</div></li>`;
}

/** The dialog body: the count earned, then one section per group. served and network come from the app (activeCities, networkTotals). */
export function renderAchievements(game, { served = null, network = null } = {}) {
  const measures = achievementMeasures(game, { served, network }), since = game.achievements?.since ?? 0;
  const summary = `<p class="achievements-summary"><span><strong data-num>${earnedCount(game)}</strong> of ${ACHIEVEMENTS.length} earned</span>${since > 0 ? `<span>Records began in ${dateShort(since)}</span>` : ''}</p>`;
  return summary + ACHIEVEMENT_GROUPS.map(group => `<section class="achievement-group" aria-labelledby="achievement-group-${group.id}"><h3 id="achievement-group-${group.id}">${escape(group.name)}</h3><ol class="achievement-list">${ACHIEVEMENT_FAMILIES.filter(f => f.group === group.id).map(f => row(game, f, measures)).join('')}</ol></section>`).join('');
}
