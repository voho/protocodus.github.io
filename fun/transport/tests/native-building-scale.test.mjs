import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../buildings.js';
import { drawTownBuilding, NATIVE_TOWN_BUILDING_KINDS } from '../building-sprites.js';
import { drawTownFeature, TOWN_FEATURE_KINDS } from '../town-feature-sprites.js';
import { SPRITE_SCALE, featureWorldPixels, BUILDING_PALETTES, projectBuildingMasterPoint } from '../sprite-art-direction.js';

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

// Sloping frontage edges change the bounding box; the upright sides retain
// the physical opening height independently of the two ground axes.
const height = shape => Math.abs(shape.points[1][1] - shape.points[2][1]);
const uprightQuad = shape => shape.points.length === 4 && Math.abs(shape.points[1][0] - shape.points[2][0]) < 1e-9 && Math.abs(shape.points[0][0] - shape.points[3][0]) < 1e-9;
const expectedDoor = featureWorldPixels(SPRITE_SCALE.doorHeightMetres);
const shade = (color, factor) => `rgb(${[1, 3, 5].map(i => Math.round(parseInt(color.slice(i, i + 2), 16) * factor)).join(',')})`;

test('native personnel entrances use one physical height and width across homes, shops and civic parcels', () => {
  const p = BUILDING_PALETTES.taiga, ordinary = shade(p.timber, .72);
  const entries = [
    ['house-cheap-1', ordinary, 1], ['house-cheap-2', ordinary, 1], ['house-cheap-3', ordinary, 1],
    ['house-normal-1', ordinary, 1], ['house-normal-2', ordinary, 1], ['house-normal-3', ordinary, 1],
    ['house-expensive-1', ordinary, 2], ['house-expensive-2', ordinary, 2], ['house-expensive-3', ordinary, 1],
    ['school', ordinary, 2], ['police-station', ordinary, 1], ['pub', ordinary, 1],
    ['shop-grocery', ordinary, 1], ['shop-bakery', ordinary, 1], ['shop-butcher', ordinary, 1],
    ['shop-hardware', ordinary, 1], ['shop-florist', ordinary, 1], ['service-post-office', ordinary, 1],
    ['service-bank', ordinary, 1], ['service-barber', ordinary, 1], ['service-garage', ordinary, 1],
    ['hospital', p.glass, 2], ['church', ordinary, 2], ['service-hotel', ordinary, 2],
    ['mall-neighborhood', ordinary, 1], ['mall-shopping', ordinary, 1], ['mall-modern', ordinary, 1],
  ];
  for (const detail of ['region', 'town', 'detail']) for (const variant of [0, 5, 10]) for (const [kind, color, leaves] of entries) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(c, kind, 'taiga', detail, variant);
    // The hospital's glass shares its material with window panes and parked cars.
    const doors = c.fills.filter(shape => uprightQuad(shape) && shape.color === color && (color !== p.glass || Math.abs(height(shape) - expectedDoor) < 1e-9));
    assert.ok(doors.length, `${kind}/${variant} has a personnel entrance`);
    for (const door of doors) {
      assert.ok(Math.abs(height(door) - expectedDoor) < 1e-9, `${kind}/${detail}/${variant} entrance is ${SPRITE_SCALE.doorHeightMetres}m high`);
      const dx = Math.abs(door.points[1][0] - door.points[0][0]), dy = Math.abs(door.points[1][1] - door.points[0][1]);
      assert.ok(Math.abs(dx - featureWorldPixels(SPRITE_SCALE.doorWidthMetres) * leaves) < 1e-9, `${kind} entrance retains its physical width`);
      assert.ok(Math.abs(dy / dx - .5) < 1e-9, `${kind} entrance follows a ground axis`);
    }
  }
});

test('native town-feature entrances stay at human scale on one- and two-tile parcels', () => {
  for (const [kind, color] of [
    ['shop-cafe', shade(BUILDING_PALETTES.taiga.timber, .72)], ['shop-pharmacy', shade(BUILDING_PALETTES.taiga.timber, .72)], ['shop-bookshop', shade(BUILDING_PALETTES.taiga.timber, .72)],
    ['town-hall', shade(BUILDING_PALETTES.taiga.timber, .72)], ['sports-hall', BUILDING_PALETTES.taiga.glass],
  ]) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    assert.equal(drawTownFeature(c, kind, 'taiga'), true);
    const doors = c.fills.filter(shape => shape.color === color && shape.points.length === 4 && Math.abs(height(shape) - expectedDoor) < 1e-9);
    assert.equal(doors.length, 1, `${kind} has a ${SPRITE_SCALE.doorHeightMetres}m entrance`);
    assert.equal(c.saved.length, 0, 'drawing restores its caller context');
  }
});

test('native vehicle bays preserve their larger physical opening without enlarging personnel entrances', () => {
  for (const [kind, count] of [['fire-station', 2], ['service-garage', 1]]) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(c, kind, 'taiga');
    const bays = c.fills.filter(shape => uprightQuad(shape) && shape.color === BUILDING_PALETTES.taiga.ink && height(shape) > featureWorldPixels(SPRITE_SCALE.windowHeightMetres) + 1e-9);
    assert.equal(bays.length, count);
    for (const bay of bays) assert.ok(Math.abs(height(bay) - featureWorldPixels(SPRITE_SCALE.loadingBayHeightMetres)) < 1e-9);
  }
});

test('native fallback floor tones and windows keep the same dimensions across parcel sizes', () => {
  for (const kind of ['house-normal-2', 'house-expensive-2', 'hospital', 'service-hotel', 'mall-shopping']) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(c, kind, 'taiga', 'detail');
    const storeys = c.fills.filter(shape => uprightQuad(shape) && shape.color === '#53635a0c');
    assert.ok(storeys.length, `${kind} exposes complete storeys`);
    for (const storey of storeys) assert.ok(Math.abs(height(storey) - featureWorldPixels(SPRITE_SCALE.storeyHeightMetres)) < 1e-9);
    const windows = c.fills.filter(shape => uprightQuad(shape) && shape.color === BUILDING_PALETTES.taiga.ink);
    assert.ok(windows.length, `${kind} has windows`);
    for (const window of windows) {
      assert.ok(Math.abs(height(window) - featureWorldPixels(SPRITE_SCALE.windowHeightMetres)) < 1e-9);
      assert.ok(Math.abs(Math.abs(window.points[1][0] - window.points[0][0]) - featureWorldPixels(SPRITE_SCALE.windowHeightMetres)) < 1e-9, `${kind} window width retains the shared physical scale`);
    }
    const small = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(small, kind, 'taiga', 'region');
    assert.equal(small.fills.filter(shape => shape.color === '#53635a0c').length, 0, 'Region art omits floor tone overlays');
  }
});

test('every legacy fallback has registered 2:1 ground planes and isolated complete artwork', () => {
  assert.equal(NATIVE_TOWN_BUILDING_KINDS.length, 32, 'all original houses, shops, services, civic buildings, parks and malls retain fallbacks');
  const signatures = new Set();
  for (const biome of ['taiga', 'tundra', 'desert']) for (const kind of NATIVE_TOWN_BUILDING_KINDS) for (const variant of [0, 5, 10]) {
    const size = BUILDINGS[kind].footprint, c = new DrawingContext(size), matrix = [...c.matrix];
    assert.equal(drawTownBuilding(c, kind, biome, 'detail', variant), true);
    assert.ok(c.fills.length > 0, `${kind} retains a silhouette`);
    const ground = c.fills[0];
    assert.equal(ground.rect, undefined, 'ground is a projected plane');
    const corners = [[-.95,-.95],[.95,-.95],[.95,.95],[-.95,.95]];
    for (let i = 0; i < corners.length; i++) {
      const [u,v] = corners[i], expected = projectBuildingMasterPoint(u * 5 * size, v * 5 * size, 0, size, 32).map(value => value * 1.5 * size);
      assert.ok(ground.points[i].every((value, axis) => Math.abs(value - expected[axis]) < 1e-9), `${kind}/${biome} shares the canonical registered ground`);
      const a = ground.points[i], b = ground.points[(i+1)%4];
      assert.ok(Math.abs(Math.abs((b[1]-a[1])/(b[0]-a[0]))-.5) < 1e-9, `${kind} garden/yard stays on a 2:1 ground axis`);
    }
    assert.ok(c.fills.every(shape => shape.points.flat().every(Number.isFinite)), `${kind}/${biome} has finite artwork coordinates`);
    assert.ok(c.fills.every(shape => shape.points.every(([x,y]) => x >= 0 && x <= 48 * size && y >= -12 && y <= 48 * size)), `${kind}/${biome} stays within the real fallback sprite canvas`);
    assert.deepEqual(c.matrix, matrix, 'drawing preserves its caller transform');
    assert.equal(c.saved.length, 0);
    const repeated = new DrawingContext(size);
    drawTownBuilding(repeated, kind, biome, 'detail', variant);
    assert.deepEqual(repeated.fills, c.fills, `${kind} is deterministic`);
    const small = new DrawingContext(size);
    drawTownBuilding(small, kind, biome, 'region', variant);
    assert.ok(small.fills.length > 3, `${kind} retains broad identifying masses at Region zoom`);
    if(biome === 'taiga' && variant === 0)signatures.add(JSON.stringify(small.fills.map(shape => shape.points)));
  }
  assert.equal(signatures.size, NATIVE_TOWN_BUILDING_KINDS.length, 'every fallback retains distinct architecture or landscaping');
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

test('native homes reveal terrain ground while preserving every architectural and garden object', () => {
  for(const kind of NATIVE_TOWN_BUILDING_KINDS.filter(kind => kind.startsWith('house-')))for(const biome of ['taiga','tundra','desert']) {
    const source = new DrawingContext(BUILDINGS[kind].footprint), terrain = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(source,kind,biome,'town',0);
    drawTownBuilding(terrain,kind,biome,'town',0,{gardenGround:'terrain'});
    assert.equal(source.fills[0].color,BUILDING_PALETTES[biome].ground,'default gallery art retains its painted garden');
    assert.deepEqual(terrain.fills,source.fills.slice(1),`${kind}/${biome} only removes the lawn plane, preserving paths, fences, plants and architecture`);
  }
});
