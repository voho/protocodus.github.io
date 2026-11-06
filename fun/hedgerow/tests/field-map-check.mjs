// A field sketch must preserve the actual mission geometry and orientation.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { MISSIONS } = await import('../js/missions.js');
const { buildFieldMapData, fieldPoint } = await import('../js/field-map.js');
for (const entry of MISSIONS) {
  const { default: level } = await entry.load();
  const data = await buildFieldMapData(level, { yieldTask: () => Promise.resolve() });
  assert.ok(data.width > 0 && data.height > 0);
  assert.equal(data.markers.length, level.objectives.length, 'one entry per order, no live unit icons');
  assert.deepEqual(data.markers.map(m => m.id), level.objectives.map(o => o.id));
  const centre = fieldPoint(data, 0, 0), west = fieldPoint(data, 10, 0), north = fieldPoint(data, 0, 10);
  assert.ok(west[0] < centre[0], '+X west is left on the map');
  assert.ok(north[1] < centre[1], '+Z north is up on the map');
  for (const marker of data.markers) {
    assert.ok(marker.label && marker.at, `${entry.id}/${marker.id}: order location can be found`);
    assert.ok(marker.at.every(Number.isFinite));
    assert.ok(marker.at[0] >= 0 && marker.at[0] <= data.width && marker.at[1] >= 0 && marker.at[1] <= data.height);
  }
  for (const key of ['water', 'woods']) assert.ok(!/NaN|Infinity|undefined/.test(data[key]));
  assert.ok(data.contours.length <= 14 && data.contours.every(path => !/NaN|Infinity/.test(path)));
  assert.equal(data.routes.length, Object.values(level.lines).filter(line => Array.isArray(line) && line.length > 1).length);
  assert.ok(data.routes.every(route => route.path.startsWith('M') && !/NaN|Infinity/.test(route.path)));
  if (level.water) assert.ok(data.water.length > 0, 'the actual river/canal is mapped');
  if (entry.id === 'prague') assert.equal(data.woods.length, 0, 'Prague does not inherit woodland on its sketch');
  console.log(`ok    ${entry.id}: ${data.markers.length} orders, ${data.routes.length} routes, ${data.contours.length} contour levels`);
}
console.log('field-map-check: four real layouts, north/west orientation, order locations and finite bounded geometry pass');
