import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAP_TILE_SIZE, hashLevel, tileAt, isDryTerrainTile } from '../tile-map.js';

const worlds = ['jungle', 'snow', 'desert', 'paradise', 'asteroid', 'mars', 'volcanic', 'neon', 'alien', 'void'];
let checked = 0, mixedShorelines = 0, dryLowGround = 0;
for (const [biome, id] of worlds.entries()) {
  const hash = hashLevel(id);
  let dry = 0, wet = 0;
  for (let row = -50; row < 50; row++) for (let col = -4; col < 18; col++) {
    const tile = tileAt(hash, biome, col, row);
    const expected = biome === 4 || biome === 9 ? false : biome === 2 || biome === 5 ? true : tile.cornerMasks[1] === 15;
    assert.equal(isDryTerrainTile(hash, biome, col, row), expected, `${id} ${col},${row} must agree with rendered corner overlays`);
    assert.equal(isDryTerrainTile(hash, biome + 10, col, row), expected, 'endless cycles use the same surface semantics');
    if (expected) dry++; else wet++;
    if (biome !== 2 && biome !== 5 && biome !== 4 && biome !== 9 && tile.cornerMasks[1] > 0 && tile.cornerMasks[1] < 15) {
      mixedShorelines++;
      assert.equal(expected, false, 'curved shoreline cells cannot safely support an entire wreck');
    }
    if ((biome === 2 || biome === 5) && tile.material === 0) {
      dryLowGround++;
      assert.equal(expected, true, 'dry riverbeds/canyons remain valid ground');
    }
    checked++;
  }
  if ([0, 1, 3, 6, 7, 8].includes(biome)) assert(dry > 0 && wet > 0, `${id} retains dry ground and rejects water/lava`);
  if (biome === 4 || biome === 9) assert.equal(dry, 0, 'space platforms and asteroids cannot collect debris');
}
assert(mixedShorelines > 100 && dryLowGround > 100);

// Exercise the production method without instantiating its browser-only art
// dependencies. The injected tile classifier also measures cache misses.
const source = await readFile(new URL('../worlds.js', import.meta.url), 'utf8');
const start = source.indexOf('  canPlaceDebris('), end = source.indexOf('  makeSubstrate(', start);
assert(start >= 0 && end > start, 'debris surface method must exist');
let lookups = 0;
const classifier = (_hash, _biome, col, row) => { lookups++; return !(col === 1 && row === 0); };
const canPlaceDebris = new Function('MAP_TILE_SIZE', 'DEBRIS_SURFACE_CACHE_SIZE', 'isDryTerrainTile',
  `return ({${source.slice(start, end)}}).canPlaceDebris;`)(MAP_TILE_SIZE, 1024, classifier);
const world = {
  index: 0, levelHash: 10, scale: 1, scroll: 0, parallaxX: 0,
  debrisSurfaceCols: new Float64Array(1024),
  debrisSurfaceRows: new Float64Array(1024),
  debrisSurfaceStates: new Uint8Array(1024),
  canPlaceDebris,
  tileAt() { throw new Error('surface checks must not allocate rendered tile metadata'); },
};
assert.equal(world.canPlaceDebris(50, 50), true);
assert.equal(lookups, 1);
for (let i = 0; i < 1000; i++) assert.equal(world.canPlaceDebris(50, 50, 0, 10), true);
assert.equal(lookups, 1, 'repeated fragment checks reuse fixed numeric cache slots');
assert.equal(world.canPlaceDebris(150, 50), false, 'water under the center rejects debris');
assert.equal(world.canPlaceDebris(50, 50, 0, 48), true);
assert.equal(world.canPlaceDebris(50, 50, 0, 49), false, 'footprint edge and filtering guard may not overlap water');
assert.equal(world.canPlaceDebris(250, 50, 0, 52), false, 'wide wrecks cannot overhang a neighboring wet cell');

for (const scale of [.75, 1, 2]) for (const parallaxX of [-12, 0, 12]) for (const scroll of [-800.25, 0, 4611.5]) {
  Object.assign(world, { scale, parallaxX, scroll });
  assert.equal(world.canPlaceDebris((50 + parallaxX) * scale, (50 + scroll) * scale), true, 'inverse transform must preserve dry world position');
  assert.equal(world.canPlaceDebris((150 + parallaxX) * scale, (50 + scroll) * scale), false, 'inverse transform must preserve water position');
  assert.equal(world.canPlaceDebris((50 + parallaxX) * scale, (50 + scroll) * scale, scroll, 49 * scale), false, 'radius scales with the ground plane');
}
Object.assign(world, { scale: 1, parallaxX: 0, scroll: 0 });
for (let col = -3000; col <= 3000; col++) assert.equal(world.canPlaceDebris(col * 100 + 50, 50), col !== 1);
assert.equal(world.debrisSurfaceStates.length, 1024, 'cache stays bounded while the map scrolls indefinitely');
assert.equal(world.canPlaceDebris(150, 50), false, 'hash collisions must compare full tile coordinates');
for (const index of [4, 9]) {
  world.index = index;
  const before = lookups;
  assert.equal(world.canPlaceDebris(50, 50), false);
  assert.equal(world.canPlaceDebris(100000, -200000, 0, 200), false);
  assert.equal(lookups, before, 'space checks need no tile lookup');
}
for (const index of [2, 5]) {
  world.index = index;
  const before = lookups;
  assert.equal(world.canPlaceDebris(150, 50, 0, 200), true);
  assert.equal(lookups, before, 'dry biomes need no tile lookup');
}
world.index = 0;
assert.equal(world.canPlaceDebris(NaN, 50), false);
assert.equal(world.canPlaceDebris(50, Infinity), false);
assert.equal(world.canPlaceDebris(50, 50, Infinity), false);
assert.equal(world.canPlaceDebris(50, 50, 0, NaN), false);

// The scenery painter also owns persistent building craters. Hiding transient
// ship fragments alone must not leave this second source of orbital wreckage.
const painterStart = source.indexOf('  getSceneryLayer('), painterEnd = source.indexOf('  dirtyScenery(', painterStart);
assert(painterStart >= 0 && painterEnd > painterStart);
const painted = [], foundations = [];
const context = { setTransform() {}, save() {}, restore() {}, translate() {}, drawImage(image) { if (image.type) painted.push(image); }, getContextAttributes() { return { alpha: false }; } };
const surface = (width, height) => ({ width, height, getContext() { return context; } });
const structures = ['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite','crawler','hauler'];
const painter = new Function('canvas', 'TILE', 'PAD', 'MARGIN', 'STRUCTURE_SPRITES', 'structureStage', 'ellipse',
  `return ({${source.slice(painterStart, painterEnd)}}).getSceneryLayer;`)(surface, 800, 140, 100, structures,
  prop => prop.hp <= 0 ? 3 : 0, () => {});
const dead = { id: 'destroyed-facility', type: 'station', variant: 2, row: 0, x: 150, y: 50, size: 20, hp: 0, maxHp: 100 };
const band = [dead,
  { ...dead, id: 'living-facility', x: 350, hp: 100 },
  { ...dead, id: 'original-ruin', type: 'ruin', x: 550, hp: 100 },
  { ...dead, id: 'natural-asteroid', type: 'asteroid', x: 750, hp: 100 }];
Object.assign(world, {
  mapWidth: 1200, detailScale: 1, sceneryLayers: [new Map()], sceneryDirty: new Map(),
  destroyed: new Set([dead.id]), damage: new Map(),
  getBand: row => row === 0 ? band : [], getTile: () => ({}), drawGroundDetails() {},
  getSprite: (type, variant, stage) => ({ type, variant, stage }),
  structureEffects: { drawFoundation(_context, prop) { foundations.push(prop.id); } },
  drawScorch() { throw new Error('No legacy scorch expected for these intact natural props'); },
});
const persistentChecks = [];
for (const index of [0, 3, 4, 6, 9, 2, 5]) for (const x of [150, 450]) {
  world.index = index; dead.x = x; world.sceneryLayers[0].clear();
  world.debrisSurfaceStates.fill(0); painted.length = 0; foundations.length = 0;
  painter.call(world, 0, band);
  const dry = index !== 4 && index !== 9 && (index === 2 || index === 5 || x === 450);
  assert.equal(painted.some(sprite => sprite.type === 'station' && sprite.stage === 3), dry, 'destroyed site crater follows dry surface policy');
  assert.equal(foundations.includes(dead.id), dry, 'destroyed site foundation follows the same policy');
  assert(painted.some(sprite => sprite.type === 'station' && sprite.stage === 0), 'intact facilities remain visible in space');
  assert(painted.some(sprite => sprite.type === 'ruin' && sprite.stage === 0), 'original scenery ruins remain visible');
  assert(painted.some(sprite => sprite.type === 'asteroid'), 'natural rocks remain visible');
  assert(world.destroyed.has(dead.id) && dead.hp === 0 && world.damage.size === 0, 'hiding wreckage never revives a destroyed building or changes its damage ledger');
  persistentChecks.push({ index, x, craterVisible: dry });
}
console.log(JSON.stringify({ pass: true, checked, mixedShorelines, dryLowGround, cacheSlots: 1024, persistentChecks }, null, 2));
