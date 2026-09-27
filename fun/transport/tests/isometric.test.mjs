import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPoint, unprojectPoint, projectAngle, projectedDepth, projectedGroundBasis } from '../isometric.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('square tile corners form a 2:1 isometric diamond', () => {
  assert.deepEqual([[0, 0], [32, 0], [32, 32], [0, 32]].map(([x, y]) => projectPoint(x, y)), [
    { x: 0, y: 0 }, { x: 32, y: 16 }, { x: 0, y: 32 }, { x: -32, y: 16 },
  ]);
  assert.deepEqual(projectPoint(16, 16), { x: 0, y: 16 });
});

test('projection and picking round trip negative, fractional and largest-map coordinates', () => {
  const values = [-65536, -32.9, -.5, 0, .125, 16, 31.999, 8192, 65536];
  for (const x of values) for (const y of values) {
    const point = projectPoint(x, y), picked = unprojectPoint(point.x, point.y);
    near(picked.x, x); near(picked.y, y);
    const restored = projectPoint(...Object.values(unprojectPoint(x, y)));
    near(restored.x, x); near(restored.y, y);
  }
});

test('each of the eight vehicle headings follows the projected travel segment', () => {
  const origin = projectPoint(240.5, -78.25);
  for (let direction = 0; direction < 8; direction++) {
    const angle = direction * Math.PI / 4;
    const next = projectPoint(240.5 + Math.cos(angle) * 32, -78.25 + Math.sin(angle) * 32);
    const actual = projectAngle(angle), expected = Math.atan2(next.y - origin.y, next.x - origin.x);
    near(Math.cos(actual), Math.cos(expected)); near(Math.sin(actual), Math.sin(expected));
    near(Math.cos(projectAngle(angle + Math.PI)), -Math.cos(actual));
    near(Math.sin(projectAngle(angle + Math.PI)), -Math.sin(actual));
  }
  near(projectAngle(0), Math.atan(.5));
  near(projectAngle(Math.PI / 4), Math.PI / 2);
  near(projectAngle(-Math.PI / 4), 0);
});

test('screen dragging and pointer zoom preserve the projected world anchor', () => {
  const center = { x: 1034.5, y: 890.25 }, cursor = { x: 157, y: -84 };
  for (const zoom of [.5, 1, 2]) {
    const offset = unprojectPoint(cursor.x / zoom, cursor.y / zoom);
    const anchor = { x: center.x + offset.x, y: center.y + offset.y };
    for (const nextZoom of [.5, 1, 2]) {
      const nextOffset = unprojectPoint(cursor.x / nextZoom, cursor.y / nextZoom);
      const nextCenter = { x: anchor.x - nextOffset.x, y: anchor.y - nextOffset.y };
      const nextScreen = projectPoint(anchor.x - nextCenter.x, anchor.y - nextCenter.y);
      near(nextScreen.x * nextZoom, cursor.x); near(nextScreen.y * nextZoom, cursor.y);
    }
  }
});

test('depth orders foreground anchors after background anchors', () => {
  assert.equal(projectedDepth(8, 4), projectedDepth(4, 8));
  assert.ok(projectedDepth(8, 5) > projectedDepth(8, 4));
  assert.ok(projectedDepth(9, 4) > projectedDepth(8, 4));
});

test('cargo bed axes share the terrain projection and preserve depth foreshortening',()=>{
  for(let n=0;n<8;n++){
    const worldAngle=n*Math.PI/4,screenAngle=projectAngle(worldAngle),basis=projectedGroundBasis(screenAngle);
    const along=projectPoint(Math.cos(worldAngle),Math.sin(worldAngle)),across=projectPoint(-Math.sin(worldAngle),Math.cos(worldAngle));
    near(basis.a,along.x*Math.SQRT1_2);near(basis.b,along.y*Math.SQRT1_2);
    near(basis.c,across.x*Math.SQRT1_2);near(basis.d,across.y*Math.SQRT1_2);
    near(basis.a*basis.d-basis.b*basis.c,.5);
  }
  const horizontal=projectedGroundBasis(0),vertical=projectedGroundBasis(Math.PI/2);
  near(Math.hypot(horizontal.a,horizontal.b),1);near(Math.hypot(vertical.a,vertical.b),.5);
});
