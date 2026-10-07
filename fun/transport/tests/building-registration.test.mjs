// Registration QA uses recorded source landmarks and the actual packing
// transforms. It cannot replace visual review of the painted landmarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BUILDINGS } from '../buildings.js';
import { HOUSE_KINDS } from '../raster-houses.js';
import { RASTER_BUILDING_FAMILIES } from '../raster-buildings.js';
import { FARM_CORE_KINDS } from '../raster-industries.js';
import { projectPoint } from '../isometric.js';
import { SPRITE_SCALE } from '../sprite-art-direction.js';

const directory = new URL('../', import.meta.url), sourceHashes = new Map();
const json = async path => JSON.parse(await readFile(new URL(path, directory), 'utf8'));
const near = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} versus ${expected} (±${tolerance})`);
};
const pointNear = (actual, expected, tolerance, label) => {
  assert.ok(Array.isArray(actual) && actual.length === 2, `${label}: requires a measured point`);
  actual.forEach((value, axis) => near(value, expected[axis], tolerance, `${label}/${axis}`));
};
const slope = ([a, b]) => (b[1] - a[1]) / (b[0] - a[0]);
const meanPoint = points => points[0].map((_, axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
const masterMetres = (height, footprint) => height * SPRITE_SCALE.billboardPixelsPerTile * footprint / (256 * SPRITE_SCALE.worldPixelsPerMetre);
// The visually accepted house paintings retain measured camera variation up
// to .16 from the ideal .5 slope, including measured drift in a few final
// lawn-only edits. Stable Town/core keep their .11 limit;
// native geometry remains exactly 2:1.
const houseGroundSlopeTolerance = .16;

function camera(lines, recorded, label, tolerance = .11) {
  assert.ok(lines.length >= 2, `${label}: two independently measured ground axes are required`);
  const values = lines.map(slope);
  assert.ok(values.some(value => value > 0) && values.some(value => value < 0), `${label}: both visible grid axes must be observed`);
  values.forEach((value, index) => {
    near(Math.abs(value), .5, tolerance, `${label}: painted ground edge ${index}`);
    if (recorded) near(recorded[index], value, .002, `${label}: recorded slope ${index} matches its source endpoints`);
  });
}

function gutter(bounds, label) {
  assert.ok(Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite), `${label}: actual normalized alpha bounds are recorded`);
  const [left, top, right, bottom] = bounds;
  assert.ok(left >= 8 && top >= 8 && right <= 248 && bottom <= 248 && right > left && bottom > top, `${label}: complete meaningful artwork retains eight-pixel filtering gutters (${bounds})`);
}

const resizedScales = (bounds, scale, divisor = 1) => [0, 1].map(axis => Math.round((bounds[axis + 2] - bounds[axis]) * scale) / (bounds[axis + 2] - bounds[axis]) / divisor);
// PIL resampling maps pixel centres, including the half-pixel origin offset.
// Rectangular crop dimensions are independently rounded to integral pixels.
const resizedPoint = (point, bounds, scale, translation, divisor = 1) => point.map((value, axis) => ((value - bounds[axis] + .5) * resizedScales(bounds, scale)[axis] - .5 + translation[axis]) / divisor);

function measuredDoor(sourceHeight, masterHeight, scale, footprint, measurement, label, renderedVerticalScale = scale) {
  assert.ok(measurement && sourceHeight > 0, `${label}: observable doors require source measurements`);
  near(masterHeight, sourceHeight * scale, .001, `${label}: recorded doorway height uses the shared nominal artwork scale`);
  const endpoints = measurement.edgeEndpointsSource || measurement.verticalEndpointsSource || (measurement.headSource && [measurement.headSource, measurement.sillSource]);
  if (endpoints?.length && endpoints.every(point => point.length === 3)) {
    // Raster column records are [x, firstOccupiedY, lastOccupiedY]. The
    // measured median counts both occupied endpoint pixels; it is distinct
    // from a geometric distance between two independently marked points.
    const bounds = measurement.boundsSource;
    assert.ok(bounds?.length === 4, `${label}: raster opening columns retain their source search region`);
    assert.equal(new Set(endpoints.map(point => point[0])).size, endpoints.length, `${label}: opening median samples distinct source columns`);
    const columns = endpoints.map(([x, top, bottom]) => {
      assert.ok([x, top, bottom].every(Number.isFinite) && bottom >= top, `${label}: source opening columns retain actual ordered endpoints`);
      assert.ok(x >= bounds[0] && x < bounds[2] && top >= bounds[1] && bottom < bounds[3], `${label}: measured opening endpoints lie within their actual source region`);
      return bottom - top + 1;
    }).sort((a, b) => a - b);
    const middle = Math.floor(columns.length / 2), median = columns.length % 2 ? columns[middle] : (columns[middle - 1] + columns[middle]) / 2;
    near(median, sourceHeight, .01, `${label}: pixel-inclusive opening median is supported by its measured vertical columns`);
  } else if (endpoints) {
    assert.ok(endpoints.length === 2 && endpoints.every(point => point.length === 2), `${label}: geometric door datums require a top and bottom point`);
    near(endpoints[0][0], endpoints[1][0], .01, `${label}: door datum is vertical rather than a slanted facade edge`);
    near(Math.abs(endpoints[1][1] - endpoints[0][1]), sourceHeight, .01, `${label}: door height is supported by source endpoints`);
  } else {
    const bounds = measurement.boundsSource;
    assert.ok(bounds?.length === 4 && bounds[2] > bounds[0] && bounds[3] > bounds[1], `${label}: visible-opening median has a bounded source search region`);
    assert.ok(sourceHeight <= bounds[3] - bounds[1], `${label}: observed opening fits its measured source region`);
  }
  const metres = masterMetres(sourceHeight * renderedVerticalScale, footprint), description = `${measurement.kind || measurement.method || ''} ${measurement.notes || ''}`;
  if (/\binferred\b|\bheader\b.*(?:occluded|hidden)/i.test(measurement.kind || measurement.method || '')) {
    const uncertainty = measurement.uncertaintyPixels ?? measurement.landmarkUncertaintySourcePixels;
    assert.ok(uncertainty > 0 && uncertainty <= 3, `${label}: estimated source endpoints retain quantified uncertainty`);
  }
  const frame = measurement.fullFrameHeightSource;
  if (Number.isFinite(frame) && frame > 0) {
    const frameEndpoints = measurement.fullFrameEndpointsSource || (frame === sourceHeight && endpoints?.length === 2 && endpoints.every(point => point.length === 2) && /full.*frame|outer.*frame/i.test(description) ? endpoints : null);
    assert.ok(frameEndpoints?.length === 2 && frameEndpoints.every(point => point.length === 2), `${label}: a full-frame height requires independently recorded head and sill endpoints`);
    near(frameEndpoints[0][0], frameEndpoints[1][0], .01, `${label}: complete frame is measured along a vertical source column`);
    near(Math.abs(frameEndpoints[1][1] - frameEndpoints[0][1]), frame, .01, `${label}: actual full-frame endpoints support its stated height`);
    const frameMetres = masterMetres(frame * renderedVerticalScale, footprint);
    assert.ok(frame >= sourceHeight && frameMetres >= 1.7 && frameMetres <= 2.5, `${label}: observed full personnel frame has a plausible human height (${frameMetres}m)`);
  } else if (measurement.partiallyOccluded === true) {
    assert.ok(/occlud|obscur|hidden|porch|roof|beam/i.test(description), `${label}: an occluded lower bound names the visible obstruction`);
    assert.ok(metres > 0 && metres <= 2.5, `${label}: explicitly occluded opening remains a lower bound, not an invented complete doorway`);
  } else if (metres < 1.7 || metres > 2.5) {
    const uncertainty = measurement.uncertaintyPixels ?? measurement.landmarkUncertaintySourcePixels;
    assert.ok(Number.isFinite(uncertainty) && uncertainty > 0 && uncertainty <= 3, `${label}: an ambiguous opening needs quantified source uncertainty (${metres}m)`);
    const delta = masterMetres(uncertainty * renderedVerticalScale, footprint);
    assert.ok(metres + delta >= 1.7 && metres + delta <= 2.5 && metres - delta <= 2.5, `${label}: quantified frame uncertainty remains bounded by human scale (${metres}±${delta}m)`);
  }
}

async function retainedSource(folder, filename, expectedHash) {
  const path = `${folder}/${filename}`;
  assert.ok(typeof filename === 'string' && /\.png$/.test(filename), `${folder}: retained source filename is recorded`);
  if (!sourceHashes.has(path)) sourceHashes.set(path, readFile(new URL(path, directory)).then(bytes => createHash('sha256').update(bytes).digest('hex')));
  assert.equal(await sourceHashes.get(path), expectedHash, `${path}: metadata identifies the actual retained source pixels`);
}

function uniformTiers(cells, label) {
  const scales = new Map();
  for (const cell of cells) {
    assert.ok(Number.isFinite(cell.uniformScale) && cell.uniformScale > 0, `${label}/${cell.id}: positive measured source-to-master scale`);
    if (scales.has(cell.footprint)) near(cell.uniformScale, scales.get(cell.footprint), 1e-9, `${label}: a footprint tier is not fitted independently per silhouette`);
    else scales.set(cell.footprint, cell.uniformScale);
  }
}

for (const biome of ['taiga', 'tundra', 'desert']) for (const design of [0, 1, 2]) for (const rotation of [0, 1]) {
  test(`house registration ${biome} design${design} rotation${rotation}`, async () => {
    const folder = `assets/houses/${biome}/${design ? `design-${design}/` : ''}${rotation ? 'rotation-1/' : ''}`.replace(/\/$/, '');
    const meta = await json(`${folder}/atlas.json`), calibration = meta.physicalCalibration;
    assert.deepEqual(meta.order, HOUSE_KINDS);
    assert.deepEqual(meta.houses.map(row => row.id), HOUSE_KINDS);
    assert.deepEqual(calibration?.cells.map(row => row.id), HOUSE_KINDS, `${folder}: every current house has measured registration`);
    assert.equal(new Set(meta.order).size, 9);
    assert.equal(meta.design, design); assert.equal(meta.rotation, rotation); assert.equal(meta.biome, biome);
    assert.equal(meta.columns, 3); assert.equal(meta.rows, 3); assert.equal(meta.masterCellSize, 256);
    pointNear(calibration.groundCenterMaster, [128, 192], 0, folder);
    uniformTiers(calibration.cells, folder);
    for (const footprint of [1, 2]) assert.ok(calibration.cells.some(cell => cell.footprint === footprint && cell.doorHeightSourceMeasured > 0 && cell.sourceDoorMeasurement?.personnelDoorObservable !== false && cell.sourceDoorMeasurement?.partiallyOccluded !== true), `${folder}: each footprint tier retains an independently visible complete doorway for physical calibration`);
    for (let index = 0; index < 9; index++) {
      const cell = calibration.cells[index], house = meta.houses[index], label = `${folder}/${cell.id}`;
      assert.equal(cell.footprint, BUILDINGS[cell.id].footprint);
      const vertices = cell.sourceGroundVertices, sourceCenter = meanPoint([vertices.left, vertices.right]);
      pointNear(cell.sourceGroundCenter, sourceCenter, .02, `${label}: measured opposite garden vertices define the centre`);
      camera([[vertices.left, vertices.front], [vertices.front, vertices.right]], cell.groundEdgeSlopesMeasured, label, houseGroundSlopeTolerance);
      const packed = sourceCenter.map((value, axis) => value * cell.uniformScale + cell.translationMaster[axis]);
      pointNear(packed, [128, 192], .76, `${label}: observed garden centre lands on the world foundation`);
      pointNear(cell.registeredGroundCenter, packed, .02, `${label}: recorded packed centre matches source landmarks`);
      near(house.actualSourceScale, cell.uniformScale, 1e-9, `${label}: runtime master uses the measured scale`);
      const squareSize = house.sourceSquareSize ?? house.originalSize[0];
      assert.deepEqual(house.drawSize, [house.drawSize[0], house.drawSize[0]], `${label}: complete artwork is resampled on a square source canvas`);
      near(house.drawSize[0] / squareSize, cell.uniformScale, 1e-9, `${label}: recorded scale matches the actual integral raster dimensions`);
      pointNear(resizedPoint(sourceCenter, [0, 0, squareSize, squareSize], cell.uniformScale, cell.translationMaster), [128, 192], 1, `${label}: resampled pixel-centre datum retains world registration`);
      pointNear(house.offset, cell.translationMaster, 0, `${label}: physical registration matches the actual master placement`);
      if (cell.sourceDoorMeasurement?.personnelDoorObservable === false) {
        assert.equal(cell.sourceDoorMeasurement.partiallyOccluded, true, `${label}: absent door measurement requires an observed physical obstruction`);
        assert.match(cell.sourceDoorMeasurement.notes, /roof|wing|porch|canopy|obscur|hidden/i, `${label}: completely hidden entrance retains its obstruction note`);
        assert.equal(cell.doorHeightSourceMeasured, null, `${label}: no source height is invented for a hidden entrance`);
        assert.equal(cell.doorHeightMasterMeasured, null, `${label}: no master height is invented for a hidden entrance`);
        assert.equal(house.doorHeightMasterMeasured, null, `${label}: atlas retains the honest absence of a visible doorway`);
      } else {
        near(house.doorHeightMasterMeasured, cell.doorHeightMasterMeasured, .001, `${label}: atlas record retains the measured doorway height`);
        measuredDoor(cell.doorHeightSourceMeasured, cell.doorHeightMasterMeasured, cell.uniformScale, cell.footprint, cell.sourceDoorMeasurement, label);
      }
      gutter(cell.bounds, label);
      await retainedSource(folder, house.source, house.sourceSha256);
    }
  });
}

for (const biome of ['taiga', 'tundra', 'desert']) {
  test(`town feature registration ${biome}`, async () => {
    const folder = `assets/world/buildings-town-features/${biome}`, meta = await json(`${folder}/atlas.json`), calibration = meta.physicalCalibration;
    const packing = await json(`${folder}/packing-2026-10-07.json`), registration = await json(`${folder}/registration-2026-10-07.json`);
    assert.equal(registration.source, packing.source, `${folder}: source landmarks refer to the retained original painted pixels`);
    assert.deepEqual(packing.physicalCalibration, calibration, `${folder}: published atlas keeps the actual measured packing calibration`);
    await retainedSource(folder, packing.source, packing.sourceSha256);
    const kinds = RASTER_BUILDING_FAMILIES['buildings-town-features'], expected = kinds.map(kind => kind ? `civic:${kind}:${biome}` : null);
    assert.deepEqual(meta.order, expected);
    assert.equal(new Set(expected.filter(Boolean)).size, 11);
    assert.equal(meta.columns, 4); assert.equal(meta.rows, 3); assert.equal(meta.masterCell, 256);
    const cells = calibration.cells.filter(cell => cell.id);
    assert.deepEqual(cells.map(cell => cell.id), expected.filter(Boolean));
    pointNear(calibration.groundCenterMaster, [128, 192], 0, folder);
    assert.equal(calibration.cells[11].empty, true);
    uniformTiers(cells, folder);
    for (const cell of cells) {
      const kind = kinds[cell.cell], label = `${folder}/${kind}`, vertices = cell.groundVerticesSource;
      const observed = registration.entries[cell.cell];
      assert.equal(observed.id, kind);
      assert.deepEqual(observed.groundVerticesSource, vertices, `${label}: atlas ground landmarks retain the original source review`);
      assert.deepEqual(observed.sourceDoorMeasurement, cell.sourceDoorMeasurement, `${label}: atlas doorway endpoints retain the original source review`);
      assert.equal(cell.footprint, BUILDINGS[kind].footprint);
      assert.deepEqual(cell.groundVertexMeasured, [false, true, true, true], `${label}: hidden rear corner is identified as inferred`);
      const sourceUncertainty = Number(cell.groundVerticesMethod?.match(/±(\d+(?:\.\d+)?)px/)?.[1]);
      assert.ok(sourceUncertainty > 0 && sourceUncertainty <= 3, `${label}: planar landmarks retain quantified source uncertainty`);
      pointNear(vertices[0], vertices[1].map((value, axis) => value + vertices[3][axis] - vertices[2][axis]), 4 * sourceUncertainty, `${label}: inferred rear corner closes the observed parallelogram within propagated landmark uncertainty`);
      const sourceCenter = meanPoint([vertices[1], vertices[3]]);
      pointNear(cell.groundCenterSource, sourceCenter, .01, `${label}: observed opposite planar vertices define the measured centre`);
      camera([[vertices[1], vertices[2]], [vertices[2], vertices[3]]], [cell.measuredGroundEdgeSlopes[1], cell.measuredGroundEdgeSlopes[2]], label);
      const packed = sourceCenter.map((value, axis) => (value - cell.sourceBounds[axis]) * cell.uniformScale + cell.translationMaster[axis]);
      pointNear(packed, [128, 192], 1, `${label}: measured planar centre lands on the foundation after crop/scale/translation`);
      pointNear(resizedPoint(sourceCenter, cell.sourceBounds, cell.uniformScale, cell.translationMaster), [128, 192], 1, `${label}: actual rounded crop resampling preserves the pixel-centre datum`);
      if (cell.sourceDoorMeasurement) measuredDoor(cell.sourceDoorMeasurement.heightPixels, cell.masterDoorHeightPixels, cell.uniformScale, cell.footprint, cell.sourceDoorMeasurement, label, resizedScales(cell.sourceBounds, cell.uniformScale)[1]);
      else assert.equal(cell.masterDoorHeightPixels, null, `${label}: an unobservable doorway is not assigned an invented height`);
      gutter(cell.normalizedBounds, label);
    }
    const ballpark = cells.find(cell => cell.cell === kinds.indexOf('ballpark')), field = calibration.tiers['3'];
    assert.equal(field.personnelDoorObservable, false);
    const observedWidth = Math.max(...ballpark.groundVerticesSource.map(point => point[0])) - Math.min(...ballpark.groundVerticesSource.map(point => point[0]));
    near(field.groundWidthSourcePixels, observedWidth, .01, `${folder}: ballpark scale is supported by actual field width`);
    near(field.groundWidthMasterPixels, observedWidth * ballpark.uniformScale, .001, `${folder}: field width uses the complete compound scale`);
    near(masterMetres(observedWidth * ballpark.uniformScale, 3) / 2, field.insetGroundSquareMetres, .01, `${folder}: grid-aligned square width represents the measured inset field`);
    assert.ok(field.insetGroundSquareMetres > 16 && field.insetGroundSquareMetres <= 30);
    await retainedSource(folder, meta.source, meta.sourceSha256);
  });
}

for (const biome of ['taiga', 'desert']) {
  test(`farm core registration ${biome}`, async () => {
    const folder = `assets/world/farm-cores-v1/${biome}`, meta = await json(`${folder}/atlas.json`), calibration = meta.physicalCalibration;
    const packing = await json(`${folder}/packing-v4.json`), registration = await json(`${folder}/registration-camera-v4.json`);
    assert.equal(registration.source, packing.source, `${folder}: source landmarks refer to the retained original painted pixels`);
    assert.deepEqual(packing.physicalCalibration, calibration, `${folder}: published atlas keeps the actual measured packing calibration`);
    await retainedSource(folder, packing.source, packing.sourceSha256);
    const expected = FARM_CORE_KINDS.map(kind => `farm-core:${kind}:${biome}`), cells = calibration.cells.filter(cell => cell.id);
    assert.deepEqual(meta.order.filter(Boolean), expected); assert.deepEqual(cells.map(cell => cell.id), expected);
    assert.equal(new Set(expected).size, 5); assert.equal(meta.columns, 3); assert.equal(meta.rows, 2);
    assert.equal(calibration.cells[5].empty, true);
    uniformTiers(cells, folder);
    for (const cell of cells) {
      const label = `${folder}/${cell.id}`;
      assert.equal(cell.footprint, 2);
      const observed = registration.entries[cell.cell];
      assert.equal(observed.id, cell.id);
      assert.equal(cell.groundVertexMeasured[0], true, `${label}: left datum corner is observed`);
      assert.equal(cell.groundVertexMeasured[2], true, `${label}: opposite datum corner is observed`);
      assert.equal(cell.groundVertexMeasured[3], false, `${label}: hidden rear corner remains inferred`);
      assert.deepEqual(observed.groundVertexMeasured, cell.groundVertexMeasured, `${label}: observed/inferred flags retain the original source review`);
      assert.deepEqual(cell.oppositeGroundCornersSource, [cell.groundVerticesSource[0], cell.groundVerticesSource[2]], `${label}: datum uses observed rather than inferred corners`);
      assert.deepEqual(observed.oppositeGroundCornersSource, cell.oppositeGroundCornersSource, `${label}: observed floor corners retain the original source review`);
      assert.deepEqual(observed.cameraLinesSource, cell.cameraLinesSource, `${label}: independent camera measurements retain their original source endpoints`);
      assert.deepEqual(observed.sourceDoorMeasurement, cell.sourceDoorMeasurement, `${label}: personnel doorway retains its original source endpoints`);
      const centre = meanPoint(cell.oppositeGroundCornersSource), projected = projectPoint(...cell.measuredStructureCenterMetres.map(value => value * SPRITE_SCALE.worldPixelsPerMetre));
      const masterToWorld = SPRITE_SCALE.billboardPixelsPerTile * 2 / 256;
      const groundCenter = centre.map((value, axis) => value - (axis ? projected.y : projected.x) / (masterToWorld * cell.uniformScale));
      pointNear(cell.groundCenterSource, groundCenter, .01, `${label}: observed opposite floor corners and physical building position determine the parcel centre`);
      camera(cell.cameraLinesSource, cell.measuredGroundEdgeSlopes, label);
      const packed = groundCenter.map((value, axis) => ((value - cell.sourceBounds[axis] - cell.copyBoundsWithinSourceCell[axis]) * cell.uniformScaleToRegistered512 + cell.translationRegistered512[axis]) / 2);
      pointNear(packed, [128, 192], .51, `${label}: actual source crop and high-density translation register the physical centre`);
      pointNear(cell.groundCenterAfterPackingMaster, packed, .001, `${label}: packed centre record matches source observations`);
      near(cell.uniformScaleToRegistered512 / 2, cell.uniformScale, 1e-9, `${label}: both densities preserve one physical source scale`);
      const localCenter = groundCenter.map((value, axis) => value - cell.sourceBounds[axis]);
      pointNear(resizedPoint(localCenter, cell.copyBoundsWithinSourceCell, cell.uniformScaleToRegistered512, cell.translationRegistered512, 2), [128, 192], .51, `${label}: actual rounded high-density crop preserves the pixel-centre datum`);
      measuredDoor(cell.sourceDoorMeasurement.heightPixels, cell.masterDoorHeightPixels, cell.uniformScale, 2, cell.sourceDoorMeasurement, label, resizedScales(cell.copyBoundsWithinSourceCell, cell.uniformScaleToRegistered512, 2)[1]);
      gutter(cell.normalizedBounds, label);
    }
    await retainedSource(folder, meta.source, meta.sourceSha256);
  });
}
