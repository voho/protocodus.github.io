import { CARGO, TRANSIT_CLASSES, TRANSIT_PAY_FLOOR, VEHICLE_SPEEDS } from './data.js';
import { fareFor, transitPay, scheduledDays, payTiles, travelTiles, recentTransitDays } from './model.js';
import { availableVehicleLevel } from './economy-pricing.js';
import { routeCargoList } from './route-planner.js';
import { cargoIcon } from './cargo-icons.js';
import { money, count, tiles, listJoin, capital, cargoName, escapeHTML as escape } from './copy.js';
import { LINE_COLORS } from './design-tokens.js';
import { icon } from './ui-icons.js';

// Cargo payment rates (Guide, Resources): what 10 of each cargo earn over 20 tiles after N days on the way,
// plus the trip facts route cards and the route form show. DOM appears only inside bindPaymentRates.
export const PAYMENT_UNITS = 10, PAYMENT_TILES = 20, PAYMENT_DAYS = 120;
export const CLASS_ORDER = ['express', 'perishable', 'standard', 'bulk'];
// Line colours (DESIGN.md 4.3) Marigold, Iris, Crimson and Cobalt: all pairs ΔE ≥ 16.9 under colour-vision deficiency and 23.1
// in full colour (dataviz validate_palette on #F7F6EF). The light two, for the time-sensitive classes with few cargo, wear the
// line language's ink edge for contrast; the many standard and bulk cargo take the deep two.
export const CLASS_LINE = { express: LINE_COLORS[1], perishable: LINE_COLORS[7], standard: LINE_COLORS[2], bulk: LINE_COLORS[0] };
const M = { left: 44, right: 12, top: 10, bottom: 24 };
const MODE_WORDS = { road: 'by road', rail: 'by rail', water: 'by ship', air: 'by air' };
export const shortMoney = n => money(n, { compact: true });
const percent = n => `${Math.round(n * 100)}%`;
const light = cls => CLASS_LINE[cls].on !== '#FFFFFF';
export const classRule = c => `Full pay for ${c.fullDays} days, then ${+(c.dailyLoss * 100).toFixed(2)}% less each day`;

/** Pay is flat, then falls in a straight line, then rests at the floor, so these knots draw each line exactly. */
export function paymentRateSeries(game) {
  return routeCargoList(game).map(cargo => {
    const cls = CARGO[cargo].transit, c = TRANSIT_CLASSES[cls], floorDay = c.fullDays + (1 - TRANSIT_PAY_FLOOR) / c.dailyLoss;
    const fare = day => fareFor(game, cargo, PAYMENT_TILES + 1, PAYMENT_UNITS, game.day, day);
    const knots = [0, c.fullDays, Math.min(PAYMENT_DAYS, floorDay), PAYMENT_DAYS].filter((d, i, a) => a.indexOf(d) === i);
    return { cargo, cls, full: fare(0), fare, knots };
  });
}
function yScale(series) {
  const top = Math.max(...series.map(s => s.full)), step = [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1e6].find(s => top / s <= 4) || Math.ceil(top / 4);
  return { step, max: Math.ceil(top / step) * step };
}
const lineHTML = (cls, d) => `${light(cls) ? `<path class="payment-edge" d="${d}"/>` : ''}<path stroke="${CLASS_LINE[cls].fill}" d="${d}"/>`;
function svgHTML(series, width) {
  const height = Math.round(Math.max(180, Math.min(240, width * .42))), { step, max } = yScale(series);
  const px = d => M.left + d / PAYMENT_DAYS * (width - M.left - M.right), py = v => M.top + (1 - v / max) * (height - M.top - M.bottom);
  const grid = Array.from({ length: max / step + 1 }, (_, i) => i * step).map(v => `<line x1="${M.left}" x2="${width - M.right}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/><text x="${M.left - 6}" y="${(py(v) + 4).toFixed(1)}" text-anchor="end">${shortMoney(v)}</text>`).join('');
  const ticks = (width >= 420 ? [0, 30, 60, 90, 120] : [0, 60, 120]).map(d => `<text x="${px(d).toFixed(1)}" y="${height - 6}" text-anchor="${d === PAYMENT_DAYS ? 'end' : d ? 'middle' : 'start'}">${d}${d === PAYMENT_DAYS ? ' days' : ''}</text>`).join('');
  const lines = series.map(s => `<g data-payment-line="${s.cargo}">${lineHTML(s.cls, `M${s.knots.map(d => `${px(d).toFixed(1)} ${py(s.fare(d)).toFixed(1)}`).join('L')}`)}</g>`).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="What ${PAYMENT_UNITS} of each cargo earn over ${PAYMENT_TILES} tiles, by days on the way. Use the arrow keys to read values."><g class="payment-grid">${grid}${ticks}</g><g class="payment-lines">${lines}</g><line class="payment-cursor" x1="0" x2="0" y1="${M.top}" y2="${height - M.bottom}" visibility="hidden"/><circle class="payment-dot" r="4" cx="0" cy="0" visibility="hidden"/></svg>`;
}

export function paymentRatesHTML(game) {
  const series = paymentRateSeries(game), level = availableVehicleLevel(game);
  const trips = Object.keys(VEHICLE_SPEEDS).map((mode, i) => `${Math.round(scheduledDays(mode, PAYMENT_TILES, level))}${i ? '' : ' days'} ${MODE_WORDS[mode] || `by ${mode}`}`);
  const groups = CLASS_ORDER.map(cls => {
    const c = TRANSIT_CLASSES[cls], members = series.filter(s => s.cls === cls);
    if (!members.length) return '';
    return `<div class="payment-group"><svg class="payment-swatch" viewBox="0 0 20 8" aria-hidden="true">${lineHTML(cls, 'M3 4H17')}</svg><div class="payment-group-text"><strong>${escape(c.name)}</strong><span>${classRule(c)}</span></div><span class="payment-cargo">${members.map(s => `<button type="button" data-payment-cargo="${s.cargo}" title="${escape(CARGO[s.cargo].name)}">${cargoIcon(s.cargo, { decorative: true })}<span class="sr-only">${escape(CARGO[s.cargo].name)}</span></button>`).join('')}</span></div>`;
  }).join('');
  const days = [10, 30, 60, 90];
  const table = `<details class="payment-table"><summary>Show as table${icon('chevronDown', { size: 16 })}</summary><table><thead><tr><th scope="col">Cargo</th>${days.map(d => `<th scope="col">${d} days</th>`).join('')}</tr></thead><tbody>${series.map(s => `<tr><th scope="row">${escape(CARGO[s.cargo].name)}</th>${days.map(d => `<td data-num>${shortMoney(s.fare(d))}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  return `<section class="payment-rates" aria-labelledby="payment-rates-title"><h3 id="payment-rates-title">Cargo payment rates</h3><p class="panel-description">What ${PAYMENT_UNITS} of each cargo earn over ${PAYMENT_TILES} tiles at today’s prices, by days on the way. Longer trips pay more; slow ones keep less, never under half.</p><div class="payment-plot">${svgHTML(series, 560)}<div class="payment-tip" hidden></div></div><p class="payment-note">This year a ${PAYMENT_TILES}-tile trip takes about ${listJoin(trips)}.</p><div class="payment-legend">${groups}</div>${table}</section>`;
}

/** Crosshair on hover, click and arrow keys: the line nearest the pointer, its value and its share of the full fare. */
export function bindPaymentRates(root, game) {
  const plot = root.querySelector('.payment-plot'); if (!plot) return { dispose() {} };
  const tip = plot.querySelector('.payment-tip'), series = paymentRateSeries(game), { max } = yScale(series), controller = new AbortController(), { signal } = controller;
  let day = 30, index = -1, width = 560, observer = null;
  const svg = () => plot.querySelector('svg'), height = () => +svg().getAttribute('height');
  const px = d => M.left + d / PAYMENT_DAYS * (width - M.left - M.right), py = v => M.top + (1 - v / max) * (height() - M.top - M.bottom);
  function show() {
    const s = series[index]; if (!s) return;
    const chart = svg(), x = px(day), value = s.fare(day), y = py(value), cursor = chart.querySelector('.payment-cursor'), dot = chart.querySelector('.payment-dot');
    cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('visibility', 'visible');
    Object.entries({ cx: x, cy: y, fill: CLASS_LINE[s.cls].fill, visibility: 'visible' }).forEach(([key, v]) => dot.setAttribute(key, v));
    chart.querySelectorAll('[data-payment-line]').forEach(line => line.classList.toggle('muted', line.dataset.paymentLine !== s.cargo));
    tip.hidden = false; tip.textContent = `${CARGO[s.cargo].name} after ${count(day, 'day')}: ${shortMoney(value)}, ${percent(value / s.full)} of full pay`;
    const tipWidth = tip.offsetWidth, left = x + 12 + tipWidth <= width ? x + 12 : Math.max(0, x - 12 - tipWidth);
    tip.style.left = `${Math.round(left)}px`; tip.style.top = `${Math.round(Math.max(0, y - tip.offsetHeight - 8))}px`;
  }
  function hide() {
    const chart = svg(); tip.hidden = true;
    chart.querySelector('.payment-cursor').setAttribute('visibility', 'hidden'); chart.querySelector('.payment-dot').setAttribute('visibility', 'hidden');
    chart.querySelectorAll('.muted').forEach(line => line.classList.remove('muted'));
  }
  function point(event) {
    const rect = svg().getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    day = Math.max(0, Math.min(PAYMENT_DAYS, Math.round((x - M.left) / (width - M.left - M.right) * PAYMENT_DAYS)));
    let best = Infinity; series.forEach((s, i) => { const d = Math.abs(py(s.fare(day)) - y); if (d < best) { best = d; index = i; } });
    show();
  }
  function bindSvg() {
    const chart = svg();
    chart.addEventListener('pointermove', point, { signal }); chart.addEventListener('pointerdown', point, { signal });
    chart.addEventListener('pointerleave', hide, { signal }); chart.addEventListener('blur', hide, { signal });
    chart.addEventListener('keydown', event => {
      const move = { ArrowRight: [5, 0], ArrowLeft: [-5, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]; if (!move) return;
      event.preventDefault(); if (index < 0) index = 0;
      day = Math.max(0, Math.min(PAYMENT_DAYS, day + move[0])); index = (index + move[1] + series.length) % series.length; show();
    }, { signal });
  }
  // Redraw at the plot's width, so axis text keeps its size when the panel resizes.
  function draw() {
    const next = Math.max(200, Math.floor(plot.clientWidth || 560)); if (next === width) return;
    const shown = !tip.hidden; width = next; svg().outerHTML = svgHTML(series, width); bindSvg(); if (shown) show();
  }
  bindSvg(); draw();
  if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(draw); observer.observe(plot); }
  root.querySelectorAll('[data-payment-cargo]').forEach(button => {
    const enter = () => { index = series.findIndex(s => s.cargo === button.dataset.paymentCargo); show(); };
    button.addEventListener('pointerenter', enter, { signal }); button.addEventListener('focus', enter, { signal });
    button.addEventListener('pointerleave', hide, { signal }); button.addEventListener('blur', hide, { signal });
  });
  return { dispose() { controller.abort(); observer?.disconnect(); } };
}

/** Length, days on the way and pay for one unit on a route: recent deliveries when there are any, else the timetable. */
export function routeTrip(game, route, level = 0) {
  const travel = travelTiles(route.mode, route.path), measured = recentTransitDays(game, route.id);
  return tripFacts(game, route.cargo, payTiles(route.path), travel, measured ?? scheduledDays(route.mode, travel, level), measured !== null);
}
/** The same for a planned route and a new vehicle of `level`; `wait` adds days spent loading. */
export function planTrip(game, mode, cargo, path, level, wait = 0) {
  const travel = travelTiles(mode, path);
  return tripFacts(game, cargo, payTiles(path), travel, scheduledDays(mode, travel, level) + wait, false);
}
function tripFacts(game, cargo, paid, travel, days, measured) {
  const d = Math.round(days), share = transitPay(cargo, d);
  return { tiles: paid, travel, capped: paid < Math.round(travel) && travel === Math.round(travel), days: d, measured, share, perUnit: fareFor(game, cargo, paid + 1, 1, game.day, d) };
}
const length = t => t.capped ? `${tiles(t.travel)}, paid as ${t.tiles}` : tiles(t.tiles);
/** The route card row: length and days on the way, then what one unit earns. */
export function tripText(t) { return [`${length(t)}, ${t.measured ? '' : 'about '}${count(t.days, 'day')}`, `${money(t.perUnit)} each${t.share < 1 ? `, ${percent(t.share)} of full pay` : ''}`]; }
/** The route form's line under the forecast. */
export function planText(t) { return `${length(t)}, about ${count(t.days, 'day')} on the way, about ${money(t.perUnit)} each${t.share < 1 ? `, ${percent(t.share)} of full pay` : ''}`; }
export function tripTitle(t, cargo) {
  const when = t.measured ? `Recent deliveries took ${count(t.days, 'day')}` : `A trip takes about ${count(t.days, 'day')}`;
  const pays = cargo === 'passengers' ? `Each passenger pays ${money(t.perUnit)}` : `${capital(cargoName(cargo))} pays ${money(t.perUnit)} each`;
  return `${when} over ${tiles(t.capped ? t.travel : t.tiles)}. ${pays} at today’s prices${t.share < 1 ? `, ${percent(t.share)} of the full fare: faster or newer vehicles keep more.` : ', the full fare.'}${t.capped ? ` Fares count ${t.tiles} of its ${tiles(t.travel)}, twice the grid distance between its stops.` : ''} The Guide’s Resources tab charts the payment rates.`;
}
/** The forecast's other-mode hint gains this clause when that mode would keep 10 points more of the fare. */
export function keepText(otherShare, share) { return otherShare - share >= .1 - 1e-9 ? ` and keep ${percent(otherShare)} of the fare` : ''; }
