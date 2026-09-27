import test from 'node:test';
import assert from 'node:assert/strict';
import { paintWaterRelief } from '../water-art.js';

function draw({ treeIsVisible, building = false, trees = true } = {}) {
  const strokes = [], queried = [], c = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
  };
  const tile = (x, y) => x < 0 || x >= 16 || y < 0 || y > 3 ? null : y === 0
    ? { terrain: 'forest', building: building ? { kind: 'cottage' } : null }
    : { terrain: 'water' };
  const options = treeIsVisible === undefined ? undefined : { treeIsVisible(x, y) { queried.push({ x, y }); return treeIsVisible(x, y); } };
  paintWaterRelief(c, { x0: 0, y0: 1, x1: 16, y1: 2 }, tile, 'tundra', 1847, 'town', { trees, buildings: true }, options);
  return { strokes, queried };
}
const reflectedTree = stroke => stroke.color === '#3c60631c';

test('hidden hillside forests cast no water reflection while visible flat-bank trees retain theirs', () => {
  const visible = draw({ treeIsVisible: () => true }), hidden = draw({ treeIsVisible: () => false });
  assert.ok(visible.strokes.filter(reflectedTree).length > 0);
  assert.equal(hidden.strokes.filter(reflectedTree).length, 0);
  assert.deepEqual(hidden.strokes, visible.strokes.filter(stroke => !reflectedTree(stroke)), 'removing tree reflections preserves the water surface and bank shading');
  assert.ok(hidden.queried.length > 0 && hidden.queried.every(({ y }) => y === 0), 'the predicate receives the land bank coordinates');
  assert.deepEqual(draw().strokes, visible.strokes, 'callers without a visibility predicate retain existing behavior');
});

test('building reflections remain visible when the bank tree is hidden or its layer is disabled', () => {
  for (const trees of [true, false]) {
    const result = draw({ treeIsVisible: () => false, building: true, trees });
    assert.equal(result.strokes.filter(reflectedTree).length, 0);
    assert.ok(result.strokes.some(stroke => stroke.color === '#d3cab124' && stroke.width === 4));
  }
});

function recordingContext() {
  const stack = [], strokes = [], clips = [];
  return {
    strokes, clips, globalAlpha: 1, path: [],
    save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x, y]); }, lineTo(x, y) { this.path.push([x, y]); },
    quadraticCurveTo(x, y, ex, ey) { this.path.push([x, y], [ex, ey]); },
    clip(...args) { clips.push(args); },
    stroke() { strokes.push({ points: this.path.slice(), color: this.strokeStyle, width: this.lineWidth, opacity: this.globalAlpha }); },
  };
}

const { paintCoast, drawWaterMotion } = await import('../water-art.js');

test('coast treatments follow real banks, skip artificial chunk edges and leave broken low-contrast foam', () => {
  const contours = [[...Array.from({ length: 17 }, (_, i) => [i * 32, 32]), [512, 96], [0, 96]]];
  const waterPath = { id: 'same shoreline path used by the renderer' };
  for (const [biome, foam] of [['taiga', '#dce8ce'], ['tundra', '#dbe7df'], ['desert', '#e9e1c5']]) {
    const c = recordingContext(), tile = (x, y) => ({ terrain: y < 1 ? biome === 'desert' ? 'sand' : 'grass' : 'water' });
    const edges = paintCoast(c, contours, tile, biome, 1847, 'town', waterPath);
    assert.ok(edges > 10 && edges < 18, 'only the actual northern shore is painted');
    assert.deepEqual(c.clips, [[waterPath, 'evenodd']]);
    const foamStrokes = c.strokes.filter(stroke => stroke.color.startsWith(foam));
    assert.ok(foamStrokes.length > 0 && foamStrokes.length < edges / 2, 'foam has generous breaks instead of a white perimeter');
    assert.ok(foamStrokes.every(stroke => parseInt(stroke.color.slice(-2), 16) <= 46));
    const empty = recordingContext();
    assert.equal(paintCoast(empty, contours, () => ({ terrain: 'water' }), biome, 1847, 'town', waterPath), 0);
    assert.equal(empty.strokes.length, 0, 'a chunk boundary in open sea creates no coast');
  }
});

function motion(profile, day, seed = 1847) {
  const c = recordingContext(); let selected = 0, reads = 0;
  const tile = () => { reads++; return { terrain: 'water' }; };
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (drawWaterMotion(c, x, y, false, false, day, 'tundra', { profile, seed, tile })) selected++;
  return { strokes: c.strokes, selected, reads };
}

test('all zoom profiles animate sparse deterministic wave groups and freeze with simulation time', () => {
  for (const profile of ['region', 'town', 'detail']) {
    const first = motion(profile, 2.25), paused = motion(profile, 2.25), advanced = motion(profile, 3.25), otherSeed = motion(profile, 2.25, 7193);
    assert.ok(first.selected > 15 && first.selected < 150, `${profile} has visible but sparse motion`);
    assert.equal(first.reads, first.selected * 5, 'only selected groups read their own tile and four neighbors');
    assert.deepEqual(paused, first, 'paused frames do not drift or flicker');
    assert.notDeepEqual(advanced.strokes, first.strokes, 'advancing simulation time moves the water');
    assert.notDeepEqual(otherSeed.strokes, first.strokes, 'maps do not repeat the same wave pattern');
    assert.ok(first.strokes.every(stroke => stroke.points.every(point => point.every(Number.isFinite))));
    assert.ok(first.strokes.every(stroke => stroke.width * (profile === 'region' ? .5 : profile === 'detail' ? 2 : 1) >= .4), 'at least a fractional screen pixel remains visible at each zoom');
  }
});

test('river motion follows its channel and shore-safe wave groups stay inside water', () => {
  for (const vertical of [false, true]) {
    let seen = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const c = recordingContext(), tile = (u, v) => ({ terrain: u === x && v === y ? 'water' : 'grass' });
      if (!drawWaterMotion(c, x, y, true, vertical, 4, 'taiga', { profile: 'region', seed: 1847, tile })) continue;
      seen++;
      for (const stroke of c.strokes) for (const [px, py] of stroke.points) {
        assert.ok(px >= x * 32 + 8 && px <= x * 32 + 24 && py >= y * 32 + 8 && py <= y * 32 + 24, 'shore motion stays in the safe central water area');
      }
      const points = c.strokes[0].points, first = points[0], last = points.at(-1), dx = Math.abs(last[0] - first[0]), dy = Math.abs(last[1] - first[1]);
      assert.ok(vertical ? dy > dx * 10 : dx > dy * 10);
      const blocked = recordingContext();
      assert.equal(drawWaterMotion(blocked, x, y, true, vertical, 4, 'taiga', { profile: 'region', seed: 1847, tile: () => ({ terrain: 'water', road: true }) }), 0);
      assert.equal(blocked.strokes.length, 0);
    }
    assert.ok(seen > 10);
  }
});
