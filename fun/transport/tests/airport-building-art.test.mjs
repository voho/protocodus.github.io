import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRPORT_BUILDING_ART, AIRPORT_BUILDING_SLOTS,
  airportBuildingProjectedCentre, drawAirportBuilding,
} from '../airport-building-art.js';
import { LAYOUT, localToProjected } from '../airport-art.js';
import { preloadWorldArt } from '../atlas-runtime.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('authored airport anchors stay aligned with the native component geometry in both orientations', () => {
  const nativeCentres = {
    tower: LAYOUT.tower,
    terminal: { u: (LAYOUT.terminal.u0 + LAYOUT.terminal.u1) / 2, v: (LAYOUT.terminal.v0 + LAYOUT.terminal.v1) / 2 },
    hangar: { u: (LAYOUT.hangar.u0 + LAYOUT.hangar.u1) / 2, v: (LAYOUT.hangar.v0 + LAYOUT.hangar.v1) / 2 },
    depot: LAYOUT.depot,
  };
  for (const { kind, axis } of AIRPORT_BUILDING_SLOTS) {
    const p = nativeCentres[kind], expected = localToProjected(axis, p.u, p.v);
    const actual = airportBuildingProjectedCentre(kind, axis);
    close(actual.x, expected.x);
    close(actual.y, expected.y);
  }
  assert.equal(airportBuildingProjectedCentre('unknown'), null);
});

test('missing generated artwork leaves each native airport component available as a fallback', () => {
  const unusedContext = new Proxy({}, { get() { throw new Error('Missing art must not touch the canvas'); } });
  for (const { kind, axis } of AIRPORT_BUILDING_SLOTS) assert.equal(drawAirportBuilding(unusedContext, kind, { axis }), false);
  assert.equal(drawAirportBuilding(unusedContext, 'unknown'), false);
});

test('airport slots draw at one common physical scale and register ground rather than silhouette bounds', async () => {
  const priorImage = globalThis.Image;
  globalThis.Image = class {
    set src(url) {
      this.url = url;
      const cell = Number(url.match(/-(\d+)\.png$/)?.[1]);
      this.naturalWidth = AIRPORT_BUILDING_ART.columns * cell;
      this.naturalHeight = AIRPORT_BUILDING_ART.rows * cell;
      queueMicrotask(() => this.onload());
    }
    decode() { return Promise.resolve(); }
  };
  try {
    assert.equal(await preloadWorldArt({ cells: [512], waitMs: 1000 }), true);
    const calls = [], c = { save() {}, restore() {}, drawImage(...args) { calls.push(args); } };
    for (const [index, { kind, axis }] of AIRPORT_BUILDING_SLOTS.entries()) {
      assert.equal(drawAirportBuilding(c, kind, { axis, pixelScale: 5 }), true);
      const [image, sx, sy, sw, sh, dx, dy, dw, dh] = calls[index];
      assert.match(image.url, /airport-buildings-v2\/airport-buildings-512\.png$/);
      assert.deepEqual([sx, sy, sw, sh], [index % 4 * 512, Math.floor(index / 4) * 512, 512, 512]);
      assert.deepEqual([dw, dh], [96, 96]);
      const centre = airportBuildingProjectedCentre(kind, axis);
      close(dx + 48, centre.x);
      close(dy + 76, centre.y);
    }
  } finally {
    if (priorImage === undefined) delete globalThis.Image;
    else globalThis.Image = priorImage;
  }
});

test('runtime envelopes retain measured painted source and low-density filter gutters', async () => {
  const { readFile } = await import('node:fs/promises');
  const { PART_BOXES } = await import('../airport-art.js');
  const metadata=JSON.parse(await readFile(new URL('../assets/world/airport-buildings-v2/atlas.json',import.meta.url),'utf8'));
  assert.ok(metadata.sourcePixelsPerWorldPixel > 0);
  close(metadata.sourcePixelsPerWorldPixel, metadata.sourceCalibration.fittedSourcePixelsPerWorldPixel);
  assert.equal(metadata.processing.perEntryScale, false);
  for(const entry of metadata.entries){
    const b=PART_BOXES[entry.axis][entry.kind], [left,top,right,bottom]=entry.airportAnchorAlphaBoundsWorld;
    assert.ok(b.left<=left-4 && b.top<=top-4 && b.left+b.width>=right+4 && b.top+b.height>=bottom+4,entry.id+' complete painted envelope');
    assert.equal(entry.clippedMeaningfulSourcePixels,0);
    assert.ok(entry.minimum512FilteringGutterPixels>=2);
  }
});
