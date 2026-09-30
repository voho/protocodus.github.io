import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonPresentation } from '../weather-effects.js';
import { weatherAt } from '../environment.js';

test('the seasonal light follows the climate it tints: chill at the coldest, gold while cooling, green while warming', () => {
  const game = { biome: 'taiga', seed: 1847, width: 64, height: 64, tiles: [] }, cold = day => weatherAt(game, 1, 1, day).cold;
  // Decades in, where the climate's 360-day year has long since drifted from the calendar.
  for (const start of [0, 360 * 40]) {
    let coldest = start, chilliest = start;
    for (let day = start; day < start + 360; day++) {
      if (cold(day) > cold(coldest)) coldest = day;
      if (seasonPresentation(game, day).winter > seasonPresentation(game, chilliest).winter) chilliest = day;
      const { spring, autumn } = seasonPresentation(game, day), trend = cold(day + 1) - cold(day - 1);
      if (autumn > .1) assert.ok(trend > 0, `day ${day}: a golden light only while the climate cools`);
      if (spring > .1) assert.ok(trend < 0, `day ${day}: a fresh green only while it warms`);
    }
    assert.ok(Math.abs(chilliest - coldest) <= 1, `the chill peaks on the coldest day (${chilliest} vs ${coldest})`);
  }
});
