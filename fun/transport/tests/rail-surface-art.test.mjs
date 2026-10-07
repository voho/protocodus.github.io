import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawRailSurface, RAIL_PALETTE } from '../rail-surface-art.js';
import { drawRasterNetwork, drawRasterInfrastructure, hasRasterNetwork } from '../raster-transport.js';
import { preloadWorldArt } from '../atlas-runtime.js';

function context() {
  return {
    strokes: [], images: [], path: [], save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, clip() {},
    beginPath() { this.path = []; }, rect() {},
    moveTo(x,y) { this.path.push([x,y]); }, lineTo(x,y) { this.path.push([x,y]); },
    stroke() { this.strokes.push({ color: this.strokeStyle, width: this.lineWidth, points: this.path }); },
    drawImage(...args) { this.images.push(args); },
  };
}
const railEnds = c => c.strokes.filter(s => s.color === RAIL_PALETTE.steel).flatMap(s => [s.points[0],s.points.at(-1)]);
const sortedPoints = points => points.map(p => p.map(n => Math.round(n*1e6)/1e6)).sort((a,b) => a[0]-b[0] || a[1]-b[1]);

test('paired steel meets neighboring tiles on both axes without a turn or junction seam', () => {
  for (const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]) {
    const opposite = [-dx,-dy], perpendicular = [-dy,dx];
    for (const arms of [[opposite,[dx,dy]],[[dx,dy],perpendicular],[opposite,[dx,dy],perpendicular],[[0,-1],[1,0],[0,1],[-1,0]]]) {
      const a = context(), b = context();
      drawRailSurface(a,16,16,arms);
      drawRailSurface(b,16+dx*32,16+dy*32,[opposite,[dx,dy]]);
      const onBoundary = ([x,y]) => Math.abs((dx ? x : y)-(dx ? 16+dx*16 : 16+dy*16)) < 1e-8;
      const aEnds = railEnds(a).filter(onBoundary), bEnds = railEnds(b).filter(onBoundary);
      assert.equal(aEnds.length,2); assert.equal(bEnds.length,2);
      assert.deepEqual(sortedPoints(aEnds),sortedPoints(bEnds),`connected rails meet for ${JSON.stringify(arms)}`);
      assert.ok(Math.abs(Math.hypot(aEnds[0][0]-aEnds[1][0],aEnds[0][1]-aEnds[1][1])-2.87) < 1e-8,'steel centers retain the shared metre scale');
      assert.ok(a.strokes.flatMap(s => s.points).flat().every(Number.isFinite));
    }
  }
});

test('tunnel approaches stop at the mouth; isolated short tracks keep full gauge', () => {
  const portal = context();
  drawRailSurface(portal,16,16,[[1,0]],{inner:6});
  assert.ok(portal.strokes.flatMap(s => s.points).every(([x]) => x >= 22 && x <= 32),'no ballast or steel is painted beneath the tunnel');
  for (const arms of [[[0,-.48],[0,.48]],[[-.48,0],[.48,0]]]) {
    const c = context(); drawRailSurface(c,16,16,arms);
    const ends = railEnds(c), first = ends.filter(p => arms[0][0] ? p[0] < 16 : p[1] < 16);
    assert.equal(first.length,2);
    assert.ok(Math.abs(Math.hypot(first[0][0]-first[1][0],first[0][1]-first[1][1])-2.87) < 1e-8,'short stubs do not shrink the gauge');
  }
});

test('loaded brown atlases cannot replace the gray rail geometry or Gallery portraits', async () => {
  const kinds = ['rail','rail-bridge'], arms = [[0,-1],[1,0],[0,1]], before = new Map();
  for (const kind of kinds) {
    assert.equal(hasRasterNetwork(kind),true);
    const c = context(); assert.equal(drawRasterNetwork(c,kind,16,16,arms,1),true);
    assert.equal(c.images.length,0); before.set(kind,c.strokes);
    const portrait = context(); assert.equal(drawRasterInfrastructure(portrait,kind,0,0,64,64,1),true);
    assert.ok(portrait.strokes.some(s => s.color === RAIL_PALETTE.steel)); assert.equal(portrait.images.length,0);
  }
  const previous = globalThis.Image;
  try {
    globalThis.Image = class {
      set src(url) {
        const png = readFileSync(new URL(url));
        this.naturalWidth = png.readUInt32BE(16); this.naturalHeight = png.readUInt32BE(20);
        queueMicrotask(() => this.onload());
      }
      decode() { return Promise.resolve(); }
    };
    assert.equal(await preloadWorldArt({cells:[16],waitMs:1000}),true);
    const road = context(); assert.equal(drawRasterNetwork(road,'road',16,16,[[0,-1],[0,1]]),true);
    assert.ok(road.images.length > 0,'the fixture really loaded the legacy atlas');
    for (const kind of kinds) for (const density of [1,2,4]) {
      const c = context(); assert.equal(drawRasterNetwork(c,kind,16,16,arms,density),true);
      assert.deepEqual(c.strokes,before.get(kind),'density and late assets retain railway materials and physical dimensions');
      assert.equal(c.images.length,0,'a brown rail strip never covers the gray surface');
    }
  } finally {
    if (previous === undefined) delete globalThis.Image; else globalThis.Image = previous;
  }
});
