import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../buildings.js';
import { drawTownBuilding, NATIVE_TOWN_BUILDING_KINDS } from '../building-sprites.js';
import { drawNativeFarmCore, drawProcessingPlant } from '../processing-sprites.js';
import { INDUSTRIES } from '../data.js';
import { drawTownFeature, TOWN_FEATURE_KINDS } from '../town-feature-sprites.js';
import { SPRITE_SCALE, featureWorldPixels, BUILDING_PALETTES, BUILDING_REGISTRATION, projectBuildingMasterPoint } from '../sprite-art-direction.js';

// Record final world coordinates, including the parcel transform applied by sprites.js.
class DrawingContext {
  constructor(footprint) {
    this.matrix = [(SPRITE_SCALE.billboardPixelsPerTile / 32) * footprint, (SPRITE_SCALE.billboardPixelsPerTile / 32) * footprint, 0, 0];
    this.saved = [];
    this.fills = [];
    this.strokes = [];
    this.path = [];
  }
  point(x, y) { const [sx, sy, tx, ty] = this.matrix; return [x * sx + tx, y * sy + ty]; }
  save() { this.saved.push({ matrix: [...this.matrix], fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineJoin: this.lineJoin }); }
  restore() { Object.assign(this,this.saved.pop()); }
  translate(x, y) { this.matrix[2] += x * this.matrix[0]; this.matrix[3] += y * this.matrix[1]; }
  scale(x, y) { this.matrix[0] *= x; this.matrix[1] *= y; }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push(this.point(x, y)); }
  lineTo(x, y) { this.path.push(this.point(x, y)); }
  closePath() {}
  stroke() {
    const radius = (this.lineWidth || 1) / 2;
    const rx = Math.abs(this.matrix[0]) * radius, ry = Math.abs(this.matrix[1]) * radius;
    this.strokes.push({color:this.strokeStyle,points:this.path.flatMap(([x,y]) => [[x-rx,y-ry],[x+rx,y+ry]])});
  }
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
const groundPoint = (footprint, u, v) => {
  const half = BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile * footprint / 2;
  return projectBuildingMasterPoint(u * half, v * half, 0, footprint, 32).map(value => value * SPRITE_SCALE.billboardPixelsPerTile / 32 * footprint);
};
const pointsNear = (actual, expected) => actual.every((point, index) => point.every((value, axis) => Math.abs(value - expected[index][axis]) < 1e-9));

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

test('compact saved building parcels retain physical entrances after their catalog footprint grows', () => {
  const p = BUILDING_PALETTES.taiga, ordinary = shade(p.timber,.72);
  const entries = [
    ['school',drawTownBuilding,ordinary,2],
    ['church',drawTownBuilding,ordinary,2],
    ['house-expensive-1',drawTownBuilding,ordinary,2],
    ['house-expensive-2',drawTownBuilding,ordinary,2],
    ['house-expensive-3',drawTownBuilding,ordinary,1],
    ['town-hall',drawTownFeature,ordinary,1],
    ['sports-hall',drawTownFeature,p.glass,2],
  ];
  for(const [kind,draw,color,leaves] of entries)for(const span of [1,2]) {
    const c = new DrawingContext(span), matrix = [...c.matrix];
    const options = {gardenGround:'terrain',footprint:span};
    const drawn = draw === drawTownBuilding ? draw(c,kind,'taiga','town',0,options) : draw(c,kind,'taiga','town',options);
    assert.equal(drawn,true);
    const doors = c.fills.filter(shape => uprightQuad(shape) && shape.color === color && (color !== p.glass || Math.abs(height(shape)-expectedDoor)<1e-9));
    assert.ok(doors.length,`${kind} has an entrance on its retained ${span} tile parcel`);
    for(const door of doors) {
      assert.ok(Math.abs(height(door)-expectedDoor)<1e-9,`${kind}/${span} entrance stays ${SPRITE_SCALE.doorHeightMetres}m high`);
      assert.ok(Math.abs(Math.abs(door.points[1][0]-door.points[0][0])-featureWorldPixels(SPRITE_SCALE.doorWidthMetres)*leaves)<1e-9,`${kind}/${span} entrance retains physical width`);
    }
    assert.deepEqual(c.matrix,matrix);
    assert.equal(c.saved.length,0);
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
      const [u,v] = corners[i], expected = groundPoint(size,u,v);
      assert.ok(ground.points[i].every((value, axis) => Math.abs(value - expected[axis]) < 1e-9), `${kind}/${biome} shares the canonical registered ground`);
      const a = ground.points[i], b = ground.points[(i+1)%4];
      assert.ok(Math.abs(Math.abs((b[1]-a[1])/(b[0]-a[0]))-.5) < 1e-9, `${kind} garden/yard stays on a 2:1 ground axis`);
    }
    assert.ok(c.fills.every(shape => shape.points.flat().every(Number.isFinite)), `${kind}/${biome} has finite artwork coordinates`);
    assert.ok(c.fills.every(shape => shape.points.every(([x,y]) => x >= 0 && x <= SPRITE_SCALE.billboardPixelsPerTile * size && y >= -12 && y <= SPRITE_SCALE.billboardPixelsPerTile * size)), `${kind}/${biome} stays within the real fallback sprite canvas`);
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
    const ground = c.fills[0], expected = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v]) => groundPoint(BUILDINGS[kind].footprint,u,v));
    assert.ok(pointsNear(ground.points,expected), `${kind} starts on the registered ground without a raised sprite plinth`);
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

test('native non-house plots leave bare climate terrain open while keeping structures', () => {
  for (const biome of ['taiga', 'tundra', 'desert']) for (const kind of ['church', 'park-village', 'park-formal', 'park-woodland']) {
    const source = new DrawingContext(BUILDINGS[kind].footprint), terrain = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownBuilding(source, kind, biome);
    drawTownBuilding(terrain, kind, biome, 'town', 0, {gardenGround: 'terrain'});
    assert.equal(source.fills[0].color, BUILDING_PALETTES[biome].ground);
    assert.deepEqual(terrain.fills, source.fills.slice(1));
  }
  for (const biome of ['taiga', 'tundra', 'desert']) {
    const c = new DrawingContext(1);
    drawTownFeature(c, 'park', biome, 'detail', {gardenGround: 'terrain'});
    assert.ok(c.fills.length > 10);
    assert.equal(c.fills.some(shape => shape.color === BUILDING_PALETTES[biome].ground), false);
  }
  for (const biome of ['taiga', 'tundra', 'desert']) for (const kind of ['town-hall','shop-cafe','shop-pharmacy','shop-bookshop','sports-hall','playground']) {
    const c = new DrawingContext(BUILDINGS[kind].footprint);
    drawTownFeature(c,kind,biome,'detail',{gardenGround:'terrain'});
    assert.ok(c.fills.length > 5);
    assert.equal(c.fills.some(shape => shape.color === BUILDING_PALETTES[biome].ground),false,`${kind} keeps generic lawn transparent`);
  }
});

test('native industry and farm cores retain physical doors with transparent generic yards', () => {
  const ground = {taiga:'#91a77a', tundra:'#cbd4c5', desert:'#c4b28a'};
  for (const footprint of [1,2,3,5]) for (const biome of Object.keys(ground)) for (const kind of Object.keys(INDUSTRIES)) {
    const source = new DrawingContext(footprint), terrain = new DrawingContext(footprint), matrix = [...terrain.matrix];
    assert.equal(drawProcessingPlant(source, kind, () => .5, biome, 'town', footprint), true);
    assert.equal(drawProcessingPlant(terrain, kind, () => .5, biome, 'town', footprint, {gardenGround:'terrain'}), true);
    assert.deepEqual(terrain.matrix, matrix);
    assert.equal(terrain.saved.length, 0);
    assert.ok(terrain.fills.length > 0);
    assert.equal(terrain.fills.some(shape => shape.color === ground[biome]), false, `${kind}/${biome} keeps generic yard transparent`);
    assert.ok(terrain.fills.every(shape => shape.points.flat().every(Number.isFinite)));
    assert.equal(source.fills[0].color,ground[biome]);
    const expectedGround = [[-1,1],[-1,-1],[1,-1],[1,1]].map(([u,v]) => groundPoint(footprint,u,v));
    assert.ok(pointsNear(source.fills[0].points,expectedGround),`${kind}/${footprint} shares the registered industry plot`);
    const removedColors = new Set([ground[biome],...(kind==='livestock-farm'?['#91a172']:kind==='fishery'?['#779ca0']:[])]);
    assert.deepEqual(terrain.fills,source.fills.filter(shape => !removedColors.has(shape.color)),`${kind}/${biome} preserves buildings, crops, equipment and mineral heaps`);
    const doors = terrain.fills.filter(shape => shape.rect && shape.color === '#4f635b');
    assert.ok(doors.length > 0, `${kind} has personnel access`);
    for (const door of doors) assert.ok(Math.abs(height(door) - expectedDoor) < 1e-9, `${kind} door retains physical height`);
  }
  for (const biome of Object.keys(ground)) for (const kind of ['farm','dairy-farm','vegetable-farm','orchard','livestock-farm']) {
    const c = new DrawingContext(2), source = new DrawingContext(2), matrix = [...c.matrix];
    assert.equal(drawNativeFarmCore(c,kind,()=>.5,biome,'town',2,{gardenGround:'terrain'}),true);
    assert.equal(drawNativeFarmCore(source,kind,()=>.5,biome,'town',2),true);
    assert.equal(c.fills.some(shape => shape.color === ground[biome]),false);
    assert.deepEqual(c.matrix,matrix);
    assert.deepEqual(c.fills,source.fills.slice(1),`${kind}/${biome} only removes generic core terrain`);
  }
});

test('native industry bodies and stroke widths fit the actual sprite frame on compact saved plots', () => {
  const gutter = SPRITE_SCALE.billboardPixelsPerTile / 4;
  // At the smallest Region0.5/DPR1 view this leaves at least three quarters
  // of a display pixel, preventing an opaque body from reaching its boundary.
  const minimumWorldMargin = 1.5;
  const entries = Object.keys(INDUSTRIES).flatMap(kind => [1,2,3,5].map(span => ({kind,span,draw:drawProcessingPlant})));
  entries.push(...['farm','dairy-farm','vegetable-farm','orchard','livestock-farm'].map(kind => ({kind,span:2,draw:drawNativeFarmCore})));
  for(const {kind,span,draw} of entries)for(const biome of ['taiga','tundra','desert'])for(const gardenGround of ['art','terrain']) {
    const c = new DrawingContext(span);c.lineJoin='miter';
    assert.equal(draw(c,kind,()=>.5,biome,'town',span,{gardenGround}),true);
    const frameWidth = SPRITE_SCALE.billboardPixelsPerTile * span, frameHeight = frameWidth + gutter;
    for(const shape of [...c.fills,...c.strokes])for(const [x,y] of shape.points) {
      assert.ok(x>=minimumWorldMargin && x<=frameWidth-minimumWorldMargin,`${kind}/${span}/${gardenGround} has horizontal filtering room, including strokes`);
      assert.ok(y+gutter>=minimumWorldMargin && y+gutter<=frameHeight-minimumWorldMargin,`${kind}/${span}/${gardenGround} fits the real frame height, including strokes`);
    }
    assert.equal(c.lineJoin,'miter','native round joins restore the caller state');
  }
});
