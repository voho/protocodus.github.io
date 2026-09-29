import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_SERIES, vehicleSeriesKey, vehicleModel, vehicleAge, ageText, fleetModelText, newYearModel, modelHeadline } from '../vehicle-models.js';
import { newYearNotice } from '../ui-notices.js';
import { AIR_DEBUT_YEAR } from '../economy-pricing.js';

test('seven fictional series, 54 invented names, every series from 1950, the airliner from AIR_DEBUT_YEAR', () => {
  assert.deepEqual(Object.keys(VEHICLE_SERIES), ['bus', 'truck', 'passenger-train', 'freight-train', 'ferry', 'freighter', 'airliner']);
  const names = Object.values(VEHICLE_SERIES).flatMap(s => s.families.map(f => f.name));
  assert.equal(names.length, 54); assert.equal(new Set(names).size, 54);
  assert.equal(VEHICLE_SERIES.airliner.families[0].year, AIR_DEBUT_YEAR); assert.equal(VEHICLE_SERIES.airliner.families.length, 8);
  for (const n of names) { assert.match(n, /^[A-Z][a-z]{3,8}$/); assert.doesNotMatch(n.toLowerCase(), /(ford|haven|field|mere|ridge|bridge|brook|vale)$/); }
  for (const s of Object.values(VEHICLE_SERIES)) { assert.equal(s.families[0].year, s.mode === 'air' ? AIR_DEBUT_YEAR : 1950); s.families.forEach((f, i) => { assert.equal(f.level, f.year - 1950); if (i) assert.ok(f.year > s.families[i - 1].year); }); }
  assert.ok(Object.isFrozen(VEHICLE_SERIES) && Object.isFrozen(VEHICLE_SERIES.bus.families[0]));
});

test('a level names its model: family, mark, model year and noun', () => {
  assert.deepEqual(vehicleModel('road', 'passengers', 0), { series: 'bus', name: 'Hollin Mk 1', family: 'Hollin', mark: 1, year: 1950, level: 0, debut: false, noun: 'bus', plural: 'buses' });
  assert.equal(vehicleModel('road', 'passengers', 10).name, 'Hollin Mk 11');
  assert.equal(vehicleModel('road', 'passengers', 11).name, 'Pendle Mk 1'); assert.equal(vehicleModel('road', 'passengers', 11).debut, true);
  assert.equal(vehicleModel('road', 'passengers', 150).name, 'Aurel Mk 66', 'the last family keeps counting');
  for (const bad of [-1, 1.5, undefined, NaN, '3']) assert.equal(vehicleModel('rail', 'coal', bad).name, 'Rowdon Mk 1');
  assert.deepEqual([['road', 'coal'], ['rail', 'passengers'], ['rail', 'coal'], ['water', 'passengers'], ['water', 'fish'], ['air', 'passengers'], ['air', 'mail']].map(([mode, cargo]) => vehicleSeriesKey(mode, cargo)), ['truck', 'passenger-train', 'freight-train', 'ferry', 'freighter', 'airliner', 'airliner']);
  assert.equal(vehicleModel('water', 'oil', 3).noun, 'tanker'); assert.equal(vehicleModel('water', 'fuel', 3).plural, 'tankers'); assert.equal(vehicleModel('water', 'fish', 3).noun, 'ship');
  // Mail rides in the mode's freight body.
  assert.deepEqual(['road', 'rail', 'water'].map(mode => [vehicleSeriesKey(mode, 'mail'), vehicleModel(mode, 'mail', 2).noun, vehicleModel(mode, 'mail', 2).plural]), [['truck', 'mail truck', 'mail trucks'], ['freight-train', 'mail train', 'mail trains'], ['freighter', 'mail ship', 'mail ships']]);
  for (const s of Object.values(VEHICLE_SERIES)) if (s.mode !== 'air') for (let l = 0; l < s.families[1].level; l++) assert.equal(vehicleModel(s.mode, s.passengers ? 'passengers' : 'coal', l).mark, l + 1);
  // The airliner begins in 1952: its first mark is level 2, and earlier levels clamp to Mk 1.
  assert.deepEqual([0, 1, 2, 3, 12, 13].map(l => vehicleModel('air', 'passengers', l).name), ['Aldwyn Mk 1', 'Aldwyn Mk 1', 'Aldwyn Mk 1', 'Aldwyn Mk 2', 'Aldwyn Mk 11', 'Corvane Mk 1']);
  assert.deepEqual([vehicleModel('air', 'mail', 2).noun, vehicleModel('air', 'mail', 2).plural, vehicleModel('air', 'passengers', 2).debut, vehicleModel('air', 'passengers', 1).debut], ['mail plane', 'mail planes', true, false]);
  assert.equal(vehicleAge(1970, 3), 17); assert.equal(vehicleAge(1950, 0), 0); assert.equal(vehicleAge(1951, undefined), 1); assert.equal(vehicleAge(1960, 12), 0);
  assert.deepEqual([0, 1, 17].map(ageText), ['new this year', '1 year old', '17 years old']);
});

test('a fleet reads as one model, a mark range or its newest model and older', () => {
  assert.deepEqual(fleetModelText('road', 'passengers', [3]), { text: 'Hollin Mk 4', title: 'Hollin Mk 4, 1953 model' });
  assert.deepEqual(fleetModelText('road', 'passengers', [3, 5, 5]), { text: 'Hollin Mk 4–6', title: '1 Hollin Mk 4 and 2 Hollin Mk 6' });
  assert.deepEqual(fleetModelText('road', 'passengers', [12, 9, 12]), { text: 'Pendle Mk 2 and older', title: '1 Hollin Mk 10 and 2 Pendle Mk 2' });
  assert.equal(fleetModelText('road', 'passengers', [2, 0, 1, 0]).title, '2 Hollin Mk 1, 1 Hollin Mk 2 and 1 Hollin Mk 3');
  assert.deepEqual(fleetModelText('road', 'passengers', [4, 4]), { text: 'Hollin Mk 5', title: '2 Hollin Mk 5' });
  assert.deepEqual(fleetModelText('road', 'passengers', []), { text: '', title: '' });
  assert.deepEqual(fleetModelText('road', 'passengers'), { text: '', title: '' });
  const big = Array.from({ length: 10000 }, (_, i) => i % 40), t0 = performance.now(); fleetModelText('road', 'coal', big); assert.ok(performance.now() - t0 < 20);
});

test('January names the most-used series, or a used series that begins this year', () => {
  const r = (id, mode, cargo) => ({ id, mode, cargo }), v = routeId => ({ routeId });
  assert.equal(newYearModel([r('a', 'road', 'coal'), r('b', 'road', 'passengers')], [v('a'), v('a'), v('b')], 1).name, 'Garrow Mk 2');
  assert.equal(newYearModel([r('a', 'road', 'passengers'), r('b', 'rail', 'coal')], [v('a'), v('a'), v('b')], 12).name, 'Holloway Mk 1');
  assert.equal(newYearModel([r('a', 'road', 'passengers'), r('b', 'road', 'coal')], [v('a'), v('b')], 1).name, 'Hollin Mk 2', 'ties go to catalogue order');
  assert.equal(newYearModel([], [], 10).name, 'Kedge Mk 1', 'no vehicles: the first series that begins');
  assert.equal(newYearModel([], [], 1).name, 'Hollin Mk 2');
  assert.equal(newYearModel([r('a', 'water', 'oil')], [v('a'), v('gone')], 10).noun, 'tanker', 'the first cargo seen names the body');
  assert.equal(newYearModel([r('a', 'road', 'mail'), r('b', 'road', 'food')], [v('a'), v('b')], 1).noun, 'truck', 'a mail truck names the body only when the series carries nothing else');
  assert.equal(newYearModel([r('a', 'road', 'mail')], [v('a')], 1).noun, 'mail truck');
});

test('the January notice names a model without middle dots; a headline year keeps only the prices', () => {
  assert.equal(newYearNotice(1951, .023), 'New for 1951: vehicles carry 20% more and run 10% faster. Prices rise 2.3% this year.');
  assert.equal(newYearNotice(1951, .023, { model: vehicleModel('road', 'passengers', 1) }), 'New for 1951: vehicles such as the Hollin Mk 2 bus carry 20% more and run 10% faster. Prices rise 2.3% this year.');
  assert.equal(newYearNotice(1961, .02, { model: vehicleModel('road', 'passengers', 11) }), 'New for 1961: vehicles such as the Pendle Mk 1, a new bus series, carry 20% more and run 10% faster. Prices rise 2.0% this year.');
  assert.equal(newYearNotice(1961, .02, { generation: false, model: vehicleModel('road', 'passengers', 11) }), 'Prices rise 2.0% in 1961.');
  for (let level = 1; level <= 100; level++) assert.doesNotMatch(newYearNotice(1950 + level, .03, { model: vehicleModel('water', 'oil', level) }), / · |Generation/);
});

test('a new series makes the one January headline, with its own copy', () => {
  assert.deepEqual(modelHeadline(vehicleModel('road', 'passengers', 11)), { key: 'models:1961', kind: 'models', art: 'bus', title: 'New Pendle buses arrive for 1961', detail: 'The Pendle Mk 1 bus carries 3.2 times the load of a 1950 bus and runs 2.1× as fast.' });
  assert.deepEqual(modelHeadline(vehicleModel('water', 'oil', 10)), { key: 'models:1960', kind: 'models', art: 'ship', title: 'New Kedge tankers arrive for 1960', detail: 'The Kedge Mk 1 tanker carries 3 times the load of a 1950 tanker and runs 2× as fast.' });
  assert.equal(modelHeadline(vehicleModel('rail', 'coal', 12)).art, 'train');
  assert.deepEqual(modelHeadline(vehicleModel('air', 'passengers', 13)), { key: 'models:1963', kind: 'models', art: 'plane', title: 'New Corvane planes arrive for 1963', detail: 'The Corvane Mk 1 plane carries 2.6 times the load of a 1952 plane and runs 1.9× as fast.' });
  for (const level of [0, 1, 5, 10, 12]) assert.equal(modelHeadline(vehicleModel('road', 'passengers', level)), null, level);
  for (const [key, s] of Object.entries(VEHICLE_SERIES)) for (const family of s.families.slice(1)) {
    const entry = modelHeadline(vehicleModel(s.mode, s.passengers ? 'passengers' : 'coal', family.level));
    assert.equal(entry.key, `models:${family.year}`, key); assert.ok(entry.title.length <= 140 && entry.detail.length <= 240); assert.doesNotMatch(entry.title + entry.detail, / · |Prices|Generation/);
  }
});
