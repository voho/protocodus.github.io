import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { integerText, tenthsText, compactText, dayText, monthText, longDayText, populationText } from '../formatters.js';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const inflation = Array.from({ length: 60 }, (_, year) => 400000 * 1.037 ** year);
const numbers = [0, -0, 1, -1, 0.04, 0.05, 0.95, 9.95, 12.345, 999, 999.4, 999.95, -999.5, 1000, 1049, 1050, 1234.5678, 99949, 99950, 999999, 1e6, 1.25e6, -2.5e7, 987654321, 1e9, 1e12, 1e15, 2 ** 53, NaN, Infinity, -Infinity,
  ...Array.from({ length: 13 }, (_, n) => 10 ** n), ...Array.from({ length: 13 }, (_, n) => -(10 ** n) * 1.2345), ...inflation, ...inflation.map(value => -value / 7), ...Array.from({ length: 400 }, (_, n) => ((n * 7919) % 104729) * 13.37 - 250000)];

test('cached number formatters print exactly what toLocaleString printed', () => {
  for (const value of numbers) {
    assert.equal(integerText(value), Math.floor(Number(value) || 0).toLocaleString('en-US'), `integer ${value}`);
    assert.equal(tenthsText(value), value.toLocaleString('en-US', { maximumFractionDigits: 1 }), `tenths ${value}`);
    assert.equal(tenthsText(value / 1000), (value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }), `thousands ${value}`);
    assert.equal(compactText(Math.abs(value)), Math.abs(value).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }), `compact ${value}`);
  }
  for (const value of ['1234', '', null, undefined, '12.9', 'x']) assert.equal(integerText(value), Math.floor(Number(value) || 0).toLocaleString('en-US'), `integer ${value}`);
});

test('cached date formatters print exactly what toLocaleDateString printed', () => {
  const date = (day, options) => new Date(Date.UTC(1950, 0, 1 + Math.floor(day))).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
  const days = [0, 0.4, 0.99, 1, 30.44, 58, 59, 365.25, -1, -400.5, 1e5, 1e5 + 0.7, NaN, 1e12];
  for (let day = 0; day <= 1e5; day += 97) days.push(day, day + 0.5);
  for (let pass = 0; pass < 2; pass++) for (const day of days) {
    assert.equal(dayText(day), date(day, { day: 'numeric', month: 'short', year: 'numeric' }), `day ${day}`);
    assert.equal(monthText(day), date(day, { month: 'short', year: 'numeric' }), `month ${day}`);
    assert.equal(longDayText(day), date(day, { day: 'numeric', month: 'long', year: 'numeric' }), `long day ${day}`);
  }
  assert.equal(dayText(0), 'Jan 1, 1950');assert.equal(monthText(59), 'Mar 1950');assert.equal(longDayText(365), 'January 1, 1951');
});

test('a town label keeps its population text until the whole number changes', () => {
  const town = { population: 1234 }, first = populationText(town);
  assert.equal(first, '1,234');assert.equal(populationText(town), first);
  town.population = 1234.8;assert.equal(populationText(town), '1,234', 'a fraction of a resident is not shown');
  town.population = 98765;assert.equal(populationText(town), '98,765');
  assert.equal(populationText({ population: 0 }), '0');assert.equal(populationText({}), '0');assert.equal(populationText({ population: NaN }), '0');
  assert.equal(populationText({ population: 2500000 }), '2,500,000');
});

test('the HUD, route cards and town labels no longer build a formatter per call', () => {
  const app = read('app.js'), renderer = read('renderer.js'), body = name => app.slice(app.indexOf(`function ${name}(`), app.indexOf('\n}\n', app.indexOf(`function ${name}(`)));
  for (const name of ['integer', 'money', 'compactMoney']) assert.doesNotMatch(app.match(new RegExp(`^const ${name} = .*$`, 'm'))[0], /toLocale/, name);
  for (const name of ['updateHud', 'routeRate']) assert.doesNotMatch(body(name), /toLocale(Date)?String/, name);
  assert.doesNotMatch(renderer, /toLocaleString/, 'town labels reuse their population text');
});
