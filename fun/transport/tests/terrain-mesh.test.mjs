import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTerrainMesh, paintTerrainTile, facetLight } from '../terrain-mesh.js';
import { projectTerrainPoint } from '../terrain-geometry.js';

function context() {
  return {
    draws: [], transforms: [], depth: 0,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1 }),
    save() { this.depth++; }, restore() { this.depth--; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
    transform(...values) { this.transforms.push(values); },
    drawImage(...values) { this.draws.push(values); },
  };
}
const world = () => ({ width: 4, height: 4, revision: 1, tiles: Array.from({ length: 16 }, () => ({ terrain: 'grass', elevation: 3 / 7 })) });

test('mesh paints exactly two faces per visible tile and leaves game and context unchanged', () => {
  const game = world(), before = JSON.stringify(game), c = context(), image = { width: 144, height: 144 };
  assert.deepEqual(drawTerrainMesh(c, { game, canvas: image, sourceX: -8, sourceY: -8, bounds: { x0: -2, y0: -2, x1: 6, y1: 6 } }), { tiles: 16, triangles: 32 });
  assert.equal(c.draws.length, 32); assert.equal(c.depth, 0);
  assert.equal(JSON.stringify(game), before);
  assert.ok(c.transforms.every(matrix => matrix.every(Number.isFinite)));
});

test('a custom bank without a triangle list uses the same NW-SE split, ignoring an obsolete center', () => {
  const c = context(), image = { width: 128, height: 128 }, surface = {
    nw: projectTerrainPoint(1, 1, 3), ne: projectTerrainPoint(2, 1, 3.25),
    se: projectTerrainPoint(2, 2, 3.25), sw: projectTerrainPoint(1, 2, 3),
    center: projectTerrainPoint(1.5, 1.5, 100),
  }, before = JSON.stringify(surface);
  assert.equal(paintTerrainTile(c, image, { game: world(), x: 1, y: 1, sourceScale: 1, shade: false, surface }), 2);
  assert.equal(c.draws.length, 2); assert.equal(c.depth, 0);
  assert.equal(JSON.stringify(surface), before);
});

test('normal lighting distinguishes the two slopes while preserving flat authored colors', () => {
  const flat = [[0, 0, 3], [1, 0, 3], [1, 1, 3]].map(args => projectTerrainPoint(...args));
  const bright = [[0, 0, 3], [1, 0, 4], [1, 1, 4]].map(args => projectTerrainPoint(...args));
  const dark = [[0, 0, 4], [1, 0, 3], [1, 1, 3]].map(args => projectTerrainPoint(...args));
  assert.equal(facetLight(flat), 1);
  assert.ok(facetLight(bright) > 1);
  assert.ok(facetLight(dark) < 1);
  assert.equal(facetLight(bright), facetLight([...bright].reverse()), 'winding does not reverse the light');
  assert.equal(facetLight(dark), facetLight(dark.map(p => ({ ...p, u: p.u + 400, v: p.v + 200, height: p.height + 2 }))), 'chunk location and absolute height do not change a face normal');
});
