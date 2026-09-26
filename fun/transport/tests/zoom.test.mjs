import test from 'node:test';
import assert from 'node:assert/strict';
import { ZOOM_LEVELS, ZOOM_VIEWS, nearestZoom, zoomIndex, stepZoom } from '../zoom.js';

test('the three zoom views use matching labels and exact pixel-friendly scales', () => {
  assert.deepEqual(ZOOM_LEVELS, [.5, 1, 2]);
  assert.deepEqual(ZOOM_VIEWS.map(({ zoom, name }) => [zoom, name]), [[.5, 'Region'], [1, 'Town'], [2, 'Detail']]);
  assert.equal(Object.isFrozen(ZOOM_LEVELS), true);
  for (const zoom of ZOOM_LEVELS) assert.equal(nearestZoom(zoom), zoom);
});

test('legacy and invalid zoom values resolve to a usable supported view', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, 0, -1, '2']) {
    assert.equal(nearestZoom(value), 1, `${String(value)} returns to Town`);
  }
  for (const [value, expected] of [[Number.MIN_VALUE, .5], [.65, .5], [.8, 1], [1.3, 1], [1.5, 2], [3.5, 2], [Number.MAX_VALUE, 2]]) {
    assert.equal(nearestZoom(value), expected, `${value} snaps to ${expected}`);
    assert.equal(ZOOM_LEVELS[zoomIndex(value)], expected);
  }
});

test('zoom steps cross a single level and stop at both map-view bounds', () => {
  let zoom = .5;
  const trail = [zoom];
  for (const direction of [10000, 1, 1, -10000, -1, -1, 0]) {
    zoom = stepZoom(zoom, direction);
    trail.push(zoom);
  }
  assert.deepEqual(trail, [.5, 1, 2, 2, 1, .5, .5, .5]);
  assert.equal(stepZoom(.9, 1), 2, 'a legacy starting zoom snaps before stepping');
  assert.equal(stepZoom(NaN, -1), .5, 'an invalid starting zoom recovers through Town');
});
