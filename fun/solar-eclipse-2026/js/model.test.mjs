import assert from 'node:assert/strict';
import {
  LOCATIONS,
  chapterAt,
  circleOverlapFraction,
  eclipseStateAt,
  formatClock,
  phaseAt,
  separationForCoverage,
} from './model.mjs';

assert.equal(circleOverlapFraction(2, 1, 1), 0);
assert.equal(circleOverlapFraction(0, 1, 1), 1);

const requestedCoverage = 0.863;
const separation = separationForCoverage(requestedCoverage, 1, LOCATIONS.prague.moonRadius);
assert.ok(Math.abs(circleOverlapFraction(separation, 1, LOCATIONS.prague.moonRadius)
  - requestedCoverage) < 1e-9);

const pragueMaximumProgress = (LOCATIONS.prague.maximum - LOCATIONS.prague.start)
  / (LOCATIONS.prague.end - LOCATIONS.prague.start);
const pragueMaximum = eclipseStateAt(LOCATIONS.prague, pragueMaximumProgress);
assert.ok(Math.abs(pragueMaximum.coverage - 0.863) < 1e-6);
assert.equal(formatClock(pragueMaximum.minutes), '20:12');
assert.equal(chapterAt(LOCATIONS.prague, pragueMaximumProgress), 3);

const pragueSunset = eclipseStateAt(LOCATIONS.prague, 1);
assert.ok(pragueSunset.coverage > 0, 'Sunset happens before the Moon leaves the Sun in Prague');
assert.equal(formatClock(LOCATIONS.prague.end), '20:26');

for (const location of Object.values(LOCATIONS)) {
  const maximumProgress = (location.maximum - location.start) / (location.end - location.start);
  const start = eclipseStateAt(location, 0);
  const maximum = eclipseStateAt(location, maximumProgress);
  const end = eclipseStateAt(location, 1);
  assert.ok(start.coverage < 1e-9, `${location.name}: first contact starts at zero coverage`);
  assert.ok(Math.abs(maximum.coverage - location.maxCoverage) < 1e-6,
    `${location.name}: maximum coverage matches its data`);
  if (location.endKind === 'contact') {
    assert.ok(end.coverage < 1e-9, `${location.name}: last contact ends at zero coverage`);
  }
  if (location.kind === 'total') {
    const atMinute = (minute) => eclipseStateAt(location,
      (minute - location.start) / (location.end - location.start));
    const totalityStart = atMinute(location.totalityStart);
    const totalityEnd = atMinute(location.totalityEnd);
    assert.ok(totalityStart.coverage > 1 - 1e-9,
      `${location.name}: full coverage starts at second contact`);
    assert.ok(atMinute(location.totalityStart - 1 / 60).coverage < 1,
      `${location.name}: coverage is partial one second before totality`);
    assert.equal(phaseAt(location, totalityStart), 'Úplné zatmění');
    assert.ok(totalityEnd.coverage > 1 - 1e-9,
      `${location.name}: full coverage ends at third contact`);
    assert.ok(atMinute(location.totalityEnd + 1 / 60).coverage < 1,
      `${location.name}: coverage is partial one second after totality`);
  }
}

console.log('Solar eclipse model checks passed.');
