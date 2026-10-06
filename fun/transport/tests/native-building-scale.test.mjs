import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../buildings.js';
import { drawTownBuilding } from '../building-sprites.js';
import { drawTownFeature, TOWN_FEATURE_KINDS } from '../town-feature-sprites.js';
import { SPRITE_SCALE, featureWorldPixels } from '../sprite-art-direction.js';

// Record final world coordinates, including the parcel transform applied by sprites.js.
class DrawingContext {
  constructor(footprint) {
    this.matrix = [1.5 * footprint, 1.5 * footprint, 0, 0];
    this.saved = [];
    this.fills = [];
    this.path = [];
  }
  point(x, y) { const [sx, sy, tx, ty] = this.matrix; return [x * sx + tx, y * sy + ty]; }
  save() { this.saved.push({ matrix: [...this.matrix], fillStyle: this.fillStyle }); }
  restore() { const state = this.saved.pop(); this.matrix = state.matrix; this.fillStyle = state.fillStyle; }
  translate(x, y) { this.matrix[2] += x * this.matrix[0]; this.matrix[3] += y * this.matrix[1]; }
  scale(x, y) { this.matrix[0] *= x; this.matrix[1] *= y; }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push(this.point(x, y)); }
  lineTo(x, y) { this.path.push(this.point(x, y)); }
  closePath() {}
  stroke() {}
  ellipse(x, y, rx, ry) { this.path.push(this.point(x - rx, y - ry), this.point(x + rx, y + ry)); }
  arc(x, y, r) { this.ellipse(x, y, r, r); }
  fill() { this.fills.push({ color: this.fillStyle, points: this.path }); }
  fillRect(x, y, w, h) {
    this.fills.push({ color: this.fillStyle, rect: true, points: [this.point(x, y), this.point(x + w, y), this.point(x + w, y + h), this.point(x, y + h)] });
  }
}

const height = shape => Math.abs(shape.points[1][1] - shape.points[2][1]);
const expectedDoor = featureWorldPixels(SPRITE_SCALE.doorHeightMetres);

test('native personnel entrances use one physical height across homes, shops and civic parcels', () => {
  const entries = [
    ['house-cheap-1', '#776c55'], ['house-normal-2', '#776c55'],
    ['house-expensive-1', '#776c55'], ['house-expensive-2', '#776c55'],
    ['house-expensive-3', '#776c55'], ['school', '#776c55'],
    ['police-station', '#776c55'], ['pub', '#776c55'],
    ['shop-grocery', '#776c55'], ['shop-bakery', '#776c55'],
    ['shop-butcher', '#776c55'], ['shop-hardware', '#776c55'],
    ['shop-florist', '#776c55'], ['service-post-office', '#776c55'],
    ['service-bank', '#617e74'], ['service-barber', '#776c55'],
    ['hospital', '#729292'], ['church', '#697263'], ['service-hotel', '#5e7972'],
    ['mall-neighborhood', '#776c55'], ['mall-shopping', '#776c55'], ['mall-modern', '#776c55'],
  ];
  for (const detail of ['region', 'town', 'detail']) for (const [kind, color] of entries) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(c, kind, 'taiga', detail);
    const doors = c.fills.filter(shape => shape.rect && shape.color === color);
    assert.ok(doors.length, `${kind} has a personnel entrance`);
    for (const door of doors) assert.ok(Math.abs(height(door) - expectedDoor) < 1e-9, `${kind}/${detail} personnel entrance is ${SPRITE_SCALE.doorHeightMetres}m high`);
  }
});

test('native town-feature entrances stay at human scale on one- and two-tile parcels', () => {
  for (const [kind, color] of [
    ['shop-cafe', '#6d5a44'], ['shop-pharmacy', '#6d5a44'], ['shop-bookshop', '#6d5a44'],
    ['town-hall', '#6b5a44'], ['sports-hall', '#7fa9b5'],
  ]) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    assert.equal(drawTownFeature(c, kind, 'taiga'), true);
    const doors = c.fills.filter(shape => shape.color === color && shape.points.length === 4 && Math.abs(height(shape) - expectedDoor) < 1e-9);
    assert.equal(doors.length, 1, `${kind} has a ${SPRITE_SCALE.doorHeightMetres}m entrance`);
    assert.equal(c.saved.length, 0, 'drawing restores its caller context');
  }
});

test('native vehicle bays preserve their larger physical opening without enlarging personnel entrances', () => {
  for (const [kind, color, count] of [['fire-station', '#565e52', 2], ['service-garage', '#4c655c', 1]]) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(c, kind, 'taiga');
    const bays = c.fills.filter(shape => shape.rect && shape.color === color);
    assert.equal(bays.length, count);
    for (const bay of bays) assert.ok(Math.abs(height(bay) - featureWorldPixels(SPRITE_SCALE.loadingBayHeightMetres)) < 1e-9);
  }
});

test('native fallback floor tones and windows keep the same dimensions across parcel sizes', () => {
  for (const kind of ['house-normal-2', 'house-expensive-2', 'hospital', 'service-hotel', 'mall-shopping']) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(c, kind, 'taiga', 'detail');
    const storeys = c.fills.filter(shape => shape.rect && shape.color === '#53635a0c');
    assert.ok(storeys.length, `${kind} exposes complete storeys`);
    for (const storey of storeys) assert.ok(Math.abs(height(storey) - featureWorldPixels(SPRITE_SCALE.storeyHeightMetres)) < 1e-9);
    const windows = c.fills.filter(shape => shape.rect && shape.color === '#4b5954');
    assert.ok(windows.length, `${kind} has windows`);
    for (const window of windows) assert.ok(Math.abs(height(window) - featureWorldPixels(SPRITE_SCALE.windowHeightMetres)) < 1e-9);
    const small = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(small, kind, 'taiga', 'region');
    assert.equal(small.fills.filter(shape => shape.color === '#53635a0c').length, 0, 'Region art omits floor tone overlays');
  }
});

test('all native town features draw finite, isolated profiles, with less small detail at Region zoom', () => {
  for (const biome of ['taiga', 'tundra', 'desert']) for (const kind of TOWN_FEATURE_KINDS) {
    const c = new DrawingContext(BUILDINGS[kind].footprint), matrix = [...c.matrix];
    assert.equal(drawTownFeature(c, kind, biome, 'detail'), true);
    assert.ok(c.fills.length > 0);
    assert.ok(c.fills.every(shape => shape.points.flat().every(Number.isFinite)), `${kind}/${biome} has finite artwork coordinates`);
    assert.deepEqual(c.matrix, matrix);
    assert.equal(c.saved.length, 0);
  }
  for (const kind of ['park', 'shop-bookshop', 'swimming-pool']) {
    const full = new DrawingContext(BUILDINGS[kind].footprint), small = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownFeature(full, kind, 'taiga', 'detail');
    drawTownFeature(small, kind, 'taiga', 'region');
    assert.ok(small.fills.length < full.fills.length, `${kind} drops small overlays at Region zoom`);
  }
});
