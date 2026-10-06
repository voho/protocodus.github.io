import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWaterMotion, drawPreparedWaterMotion } from '../water-art.js';
import { shorelineContours } from '../shoreline.js';

const bounds = { x0: 0, y0: 0, x1: 32, y1: 24 };
function fixture(seed = 1847) {
  const game = { width: 32, height: 24, seed, tiles: Array.from({ length: 768 }, (_, id) => { const x = id % 32, y = Math.floor(id / 32); return { terrain: y >= 6 && (x < 12 || x > 14 || y > 12) ? 'water' : 'grass', detail: x >= 19 && x <= 21 ? 'river' : '', road: y === 15, rail: x === 26 }; }) };
  const tile = (x, y) => x < 0 || y < 0 || x >= 32 || y >= 24 ? null : game.tiles[y * 32 + x];
  return { game, tile, contours: shorelineContours(game, bounds) };
}
function context() {
  const stack = [], strokes = [], clips = [];
  return { strokes, clips, globalAlpha: 1, path: [],
    save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x, y]); }, lineTo(x, y) { this.path.push([x, y]); }, rect(...args) { this.path.push(args); },
    quadraticCurveTo(x, y, ex, ey) { this.path.push([x, y], [ex, ey]); },
    clip(...args) { clips.push(args); },
    stroke() { strokes.push({ points: structuredClone(this.path), color: this.strokeStyle, width: this.lineWidth, opacity: this.globalAlpha }); },
  };
}
function prepare(f, profile = 'town', b = bounds, options) {
  const previous = globalThis.Path2D;
  globalThis.Path2D = class { cells = []; rect(...args) { this.cells.push(args); } };
  try { return prepareWaterMotion(b, f.contours, f.tile, f.game.seed, profile, { shore: 'the exact static water clip' }, options); }
  finally { if (previous === undefined) delete globalThis.Path2D; else globalThis.Path2D = previous; }
}
const shape = motion => ({ bounds: motion.bounds, waves: motion.waves, shores: motion.shores, cells: motion.tilePath.cells, profile: motion.profile });

test('water preparation is seed-stable, bounded to its chunk and excludes engineered crossing cells', () => {
  for (const profile of ['region', 'town', 'detail']) {
    const f = fixture(), immutable = JSON.stringify(f.game), first = prepare(f, profile), repeated = prepare(f, profile), other = prepare(fixture(1947), profile);
    assert.deepEqual(shape(repeated), shape(first)); assert.notDeepEqual(shape(other), shape(first));
    assert.ok(first.waves.length > 15 && first.shores.length > 10);
    for (const wave of first.waves) { const t = f.tile(wave.x, wave.y); assert.equal(t.terrain, 'water'); assert.equal(t.road, false); assert.equal(t.rail, false); }
    for (const [x, y, width, height] of first.tilePath.cells) { const tx = Math.floor((x + width / 2) / 32), ty = Math.floor((y + height / 2) / 32), t = f.tile(tx, ty); assert.equal(t.terrain, 'water'); assert.equal(t.road, false); assert.equal(t.rail, false); assert.ok(x >= tx * 32 && y >= ty * 32 && x + width <= (tx + 1) * 32 && y + height <= (ty + 1) * 32); }
    const localBounds = { x0: 16, y0: 8, x1: 24, y1: 16 }, local = prepare(f, profile, localBounds);
    assert.deepEqual(local.waves, first.waves.filter(w => w.x >= 16 && w.x < 24 && w.y >= 8 && w.y < 16), 'camera and chunk order never reseed an overlapping wave group');
    const globalEdges = new Map(first.shores.map(e => [JSON.stringify(e.p), e]));
    for (const e of local.shores) assert.deepEqual(e, globalEdges.get(JSON.stringify(e.p)), 'a real bank segment keeps its phase across neighboring caches');
    assert.equal(JSON.stringify(f.game), immutable);
  }
});

test('bank antialiasing guards cover one physical pixel without cutting water joins or cached chunk seams', () => {
  const f = fixture(), available = (x, y) => { const t = f.tile(x, y); return Boolean(t?.terrain === 'water' && !t.road && !t.rail); };
  for (const pixelScale of [.5, 1, 2, 4]) {
    const guard = 1 / pixelScale, first = prepare(f, 'town', bounds, { pixelScale });
    for (const cell of first.tilePath.cells) {
      const [px, py, width, height] = cell, x = Math.floor((px + width / 2) / 32), y = Math.floor((py + height / 2) / 32);
      const left = available(x - 1, y) ? 0 : guard, right = available(x + 1, y) ? 0 : guard, top = available(x, y - 1) ? 0 : guard, bottom = available(x, y + 1) ? 0 : guard;
      assert.deepEqual(cell, [x * 32 + left, y * 32 + top, 32 - left - right, 32 - top - bottom], 'only an exposed bank or engineered crossing receives the physical-pixel guard');
    }
    const localBounds = { x0: 16, y0: 8, x1: 24, y1: 16 }, local = prepare(f, 'town', localBounds, { pixelScale });
    assert.deepEqual(local.tilePath.cells, first.tilePath.cells.filter(([px, py, width, height]) => { const x = (px + width / 2) / 32, y = (py + height / 2) / 32; return x >= 16 && x < 24 && y >= 8 && y < 16; }), 'chunk ownership never creates an artificial gap between water cells');
  }
});

test('prepared motion uses simulation time, freezes under reduced motion and performs no per-frame tile reads', () => {
  for (const profile of ['region', 'town', 'detail']) for (const biome of ['taiga', 'tundra', 'desert']) {
    const f = fixture(); let reads = 0; const tile = f.tile; f.tile = (...args) => { reads++; return tile(...args); };
    const motion = prepare(f, profile), readCount = reads, immutable = JSON.stringify(shape(motion)), draw = (day, options) => { const c = context(), result = drawPreparedWaterMotion(c, motion, day, biome, options); return { c, result }; };
    const first = draw(2.25), paused = draw(2.25), later = draw(3.25), still = draw(0), reducedFirst = draw(2.25, { reducedMotion: true }), reducedLater = draw(77.75, { reducedMotion: true });
    assert.deepEqual(paused.c.strokes, first.c.strokes); assert.notDeepEqual(later.c.strokes, first.c.strokes);
    assert.deepEqual(reducedFirst.c.strokes, still.c.strokes); assert.deepEqual(reducedLater.c.strokes, still.c.strokes);
    assert.equal(reads, readCount, 'neighborhood classification is cached instead of repeating for every rendered frame');
    assert.equal(JSON.stringify(shape(motion)), immutable, 'drawing cannot change cached geometry');
    assert.deepEqual(first.c.clips, [[], [motion.waterPath, 'evenodd'], [motion.tilePath]], 'animated ink respects chunk, real shore and native water-face intersections');
    assert.equal(first.result.waves, motion.waves.length); assert.equal(first.result.shores, motion.shores.length);
    assert.ok(first.c.strokes.every(s => s.points.flat().every(Number.isFinite) && s.width > 0 && s.opacity >= 0 && s.opacity * parseInt(s.color.slice(-2), 16) / 255 <= .48), 'effective ink opacity stays restrained');
  }
});

test('open seas never receive a cached-chunk shoreline and sparse motion stays inside native tile envelopes', () => {
  const f = fixture(); f.tile = () => ({ terrain: 'water' });
  for (const profile of ['region', 'town', 'detail']) {
    const motion = prepare(f, profile); assert.equal(motion.shores.length, 0);
    assert.ok(motion.waves.length > 0 && motion.waves.length < 180);
    for (const wave of motion.waves) {
      const local = { ...motion, waves: [wave], shores: [] };
      for (const day of [0, 1, 12.5, 25, 50, 1e6]) {
        const c = context(); drawPreparedWaterMotion(c, local, day, 'taiga');
        for (const stroke of c.strokes) for (const [x, y] of stroke.points) assert.ok(x >= wave.x * 32 + 3 && x <= (wave.x + 1) * 32 - 3 && y >= wave.y * 32 + 3 && y <= (wave.y + 1) * 32 - 3, 'small ripple displacement cannot reach a tile edge');
      }
    }
  }
});
