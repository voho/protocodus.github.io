import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPoint } from '../isometric.js';
import { BUILDING_MATERIAL_PALETTE, BUILDING_PALETTES, BUILDING_REGISTRATION, SPRITE_SCALE, buildingGenerationPrompt, buildingGroundEnvelope, featureMasterPixels, featureWorldPixels, projectBuildingMasterPoint } from '../sprite-art-direction.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);

test('master registration reproduces the runtime ground projection and physical height', () => {
  for (const footprint of [1, 2, 3, 5]) for (const cell of [128, 256, 512]) {
    const [cx, cy] = projectBuildingMasterPoint(0, 0, 0, footprint, cell);
    near(cx, BUILDING_REGISTRATION.groundCenterMaster[0] * cell / 256);
    near(cy, BUILDING_REGISTRATION.groundCenterMaster[1] * cell / 256);
    const masterToWorld = SPRITE_SCALE.billboardPixelsPerTile * footprint / cell;
    for (const [east, north, height] of [[3, -2, 6], [-8, 8, 0], [0, 0, 2.1]]) {
      const [x, y] = projectBuildingMasterPoint(east, north, height, footprint, cell);
      const ground = projectPoint(featureWorldPixels(east), featureWorldPixels(north));
      near((x - cx) * masterToWorld, ground.x);
      near((y - cy) * masterToWorld, ground.y - featureWorldPixels(height));
    }
  }
});

test('architectural envelopes share exact grid edges and transparent cell margins', () => {
  for (const footprint of [1, 2, 3, 5]) {
    const vertices = buildingGroundEnvelope(footprint);
    const [back, right, front, left] = vertices;
    near(right[0] - left[0], 213 + 1 / 3);
    near(front[1] - back[1], 106 + 2 / 3);
    for (let i = 0; i < vertices.length; i++) {
      const [x, y] = vertices[i], [nx, ny] = vertices[(i + 1) % vertices.length];
      near(Math.abs((ny - y) / (nx - x)), BUILDING_REGISTRATION.groundEdgeSlope);
      assert.ok(x > 8 && x < 248 && y > 8 && y < 248, 'complete inset ground retains filtering gutters');
    }
  }
});

test('the frame fits almost the whole parcel while preserving world scale and filtering gutters', () => {
  assert.equal(SPRITE_SCALE.billboardPixelsPerTile, 72);
  assert.equal(BUILDING_REGISTRATION.architecturalEnvelopeMetresPerTile, 15);
  const half = SPRITE_SCALE.tileMetres / 2;
  const [left] = projectBuildingMasterPoint(-half, half);
  const [right] = projectBuildingMasterPoint(half, -half);
  near((right - left) * SPRITE_SCALE.billboardPixelsPerTile / SPRITE_SCALE.masterCellPixels, 64);
  assert.ok(left > 8 && right < 248, 'full grid parcel fits with room for filtering');
  const [back, east, front, west] = buildingGroundEnvelope();
  const coveredWidth = (east[0] - west[0]) * SPRITE_SCALE.billboardPixelsPerTile / SPRITE_SCALE.masterCellPixels;
  near(coveredWidth, 60);
  near((front[1] - back[1]) * SPRITE_SCALE.billboardPixelsPerTile / SPRITE_SCALE.masterCellPixels, 30);
  assert.ok(coveredWidth / 64 > .9, 'architecture uses more than 90% of both plot axes');
  for (const footprint of [1, 2, 3, 5]) near(featureMasterPixels(SPRITE_SCALE.doorHeightMetres, footprint) * SPRITE_SCALE.billboardPixelsPerTile * footprint / SPRITE_SCALE.masterCellPixels, 4.2);
});

test('climates retain shared semantic architecture materials and restrained plant/ground swatches', () => {
  for (const palette of Object.values(BUILDING_PALETTES)) {
    assert.ok(Object.isFrozen(palette));
    for (const [material, color] of Object.entries(BUILDING_MATERIAL_PALETTE)) assert.equal(palette[material], color);
    assert.ok(Object.values(palette).every(color => /^#[0-9a-f]{6}$/.test(color)));
  }
  assert.equal(new Set(Object.values(BUILDING_PALETTES).map(palette => palette.ground)).size, 3);
});

test('generation jobs carry explicit geometry, material swatches and parcel-specific human scale', () => {
  for (const biome of Object.keys(BUILDING_PALETTES)) {
    const prompt = buildingGenerationPrompt({ biome, columns: 3, rows: 1, entries: [{ id: 'cottage', footprint: 1 }, { id: 'hall', footprint: 2 }, { id: 'factory', footprint: 5 }] });
    assert.match(prompt, /No in-plot yaw/);
    assert.match(prompt, /parcel centre is \(128\.0,192\.0\)/);
    assert.match(prompt, /Register the actual ground centre, never the silhouette bottom/);
    assert.match(prompt, /15m envelope per 16m tile/);
    assert.match(prompt, /Genuine RGBA transparency is the ground key for EVERY family/);
    assert.match(prompt, /Leave ALL bare grass, snow, sand and generic earth transparent/);
    assert.match(prompt, /Preserve isolated plants, contact shadows, paths, paving, courts, pools, crop beds and mineral heaps/);
    assert.match(prompt, /Never enlarge doors, windows, people, garden fences or benches/);
    for (const [material, color] of Object.entries(BUILDING_PALETTES[biome])) assert.ok(prompt.includes(`${material} ${color}`));
    for (const footprint of [1, 2, 5]) assert.ok(prompt.includes(`personnel door height is ${featureMasterPixels(SPRITE_SCALE.doorHeightMetres, footprint).toFixed(1)}px`));
  }
});

test('registration rejects invalid coordinates and parcel dimensions', () => {
  for (const args of [[NaN, 0], [0, Infinity], [0, 0, 0, 0], [0, 0, 0, 1.5], [0, 0, 0, 1, 0]]) assert.throws(() => projectBuildingMasterPoint(...args));
});
