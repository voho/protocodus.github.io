import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTerrainMesh, paintTerrainTile, facetLight, terrainVertexLight } from '../terrain-mesh.js';
import { projectTerrainPoint, tileSurface } from '../terrain-geometry.js';

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
  assert.ok(facetLight(bright) > 1.09, 'lit slopes remain legible at the compact normal relief');
  assert.ok(facetLight(dark) < .85, 'opposing slopes get a clear but bounded shade');
  const awayFromScreenLeft = [[0, 0, 3], [1, 0, 3], [1, 1, 4]].map(args => projectTerrainPoint(...args));
  assert.ok(facetLight(bright) > facetLight(awayFromScreenLeft), 'the light comes from screen upper left, matching sprite shadows');
  assert.equal(facetLight(bright), facetLight([...bright].reverse()), 'winding does not reverse the light');
  assert.equal(facetLight(dark), facetLight(dark.map(p => ({ ...p, u: p.u + 400, v: p.v + 200, height: p.height + 2 }))), 'chunk location and absolute height do not change a face normal');
});

const landscape = height => ({ width: 16, height: 16, revision: 1, tiles: Array.from({ length: 256 }, (_, i) => ({ terrain: 'grass', elevation: height(i % 16, Math.floor(i / 16)) / 7 })) });

test('smooth vertex light preserves full illumination on broad ramps and flat authored colors', () => {
  const rising = landscape(x => Math.max(0, Math.min(7, x - 3)));
  const falling = landscape(x => Math.max(0, Math.min(7, 12 - x)));
  const flat = landscape(() => 3), before = JSON.stringify(rising);
  for (const game of [rising, falling]) {
    assert.equal(terrainVertexLight(game, 7, 8), facetLight(tileSurface(game, 7, 8).triangles[0]));
    assert.equal(terrainVertexLight(game, 7, 8, 0), 1, 'the flat relief view does not add slope lighting');
  }
  assert.ok(terrainVertexLight(rising, 7, 8) > 1.09);
  assert.ok(terrainVertexLight(falling, 7, 8) < .85);
  for (const x of [0, 1, 8, 15, 16]) for (const y of [0, 1, 8, 15, 16]) assert.equal(terrainVertexLight(flat, x, y), 1);
  assert.equal(JSON.stringify(rising), before, 'sampling illumination never changes the saved height field');
});

test('a plateau joins a ramp through a shared intermediate normal', () => {
  const game = landscape(x => Math.max(3, Math.min(7, x - 2)));
  const flat = terrainVertexLight(game, 4, 8), shoulder = terrainVertexLight(game, 5, 8), slope = terrainVertexLight(game, 6, 8);
  assert.equal(flat, 1);
  assert.ok(shoulder > flat && shoulder < slope, 'the slope boundary has an intermediate light instead of a triangle-sized jump');
});

test('shore vertices keep water untinted while dry slopes retain directional light', () => {
  const game = landscape(() => 3);
  for (let y = 0; y < game.height; y++) for (let x = 0; x < 8; x++) game.tiles[y * game.width + x] = { terrain: 'water', elevation: 0 };
  for (let y = 1; y < game.height; y++) for (let x = 1; x <= 8; x++) assert.equal(terrainVertexLight(game, x, y), 1);
  assert.ok(terrainVertexLight(game, 9, 8) > 1, 'land rises out of the authored water plane');
});
