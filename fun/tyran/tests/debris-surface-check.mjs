import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the production scenery painter without browser art dependencies.
// Destroyed sites must reveal their existing terrain in every environment,
// including regenerated strips and old destruction records loaded from saves.
const source = await readFile(new URL('../worlds.js', import.meta.url), 'utf8');
const methodSource = (name, next) => {
  const start = source.indexOf(`  ${name}(`), end = source.indexOf(`  ${next}(`, start);
  assert(start >= 0 && end > start, `${name} method must exist`);
  return source.slice(start, end);
};
const structureStart = source.indexOf('export function structureStage(');
const structureEnd = source.indexOf('\nconst FOLIAGE', structureStart);
const structureStage = new Function(`${source.slice(structureStart, structureEnd).replace('export ', '')};return structureStage;`)();
const painted = [], foundations = [];
const context = {
  setTransform() {}, save() {}, restore() {}, translate() {},
  drawImage(image) { if (image.type) painted.push(image); },
  getContextAttributes() { return { alpha: false }; },
};
const surface = (width, height) => ({ width, height, getContext() { return context; } });
const structures = ['temple','ruin','bunker','station','radar','dome','solar','refinery','building','tower','pylon','fortress','hut','satellite','crawler','hauler'];
const painter = new Function('canvas', 'TILE', 'PAD', 'MARGIN', 'STRUCTURE_SPRITES', 'structureStage', 'ellipse',
  `return ({${methodSource('getSceneryLayer', 'dirtyScenery')}}).getSceneryLayer;`)(surface, 800, 140, 100, structures, structureStage, () => {});
const dead = { id: 'destroyed-facility', type: 'station', variant: 2, row: 0, x: 150, y: 350, size: 20, hp: 0, maxHp: 100 };
const band = [dead,
  { ...dead, id: 'living-facility', x: 350, hp: 100 },
  { ...dead, id: 'lightly-damaged-facility', x: 450, hp: 55 },
  { ...dead, id: 'heavily-damaged-facility', x: 550, hp: 25 },
  { ...dead, id: 'original-ruin', type: 'ruin', x: 650, hp: 100 },
  { ...dead, id: 'natural-asteroid', type: 'asteroid', x: 750, hp: 100 },
  { ...dead, id: 'legacy-destroyed-tree', type: 'tree', x: 850 },
  { ...dead, id: 'empty-unindexed-site', x: 950 },
  { ...dead, id: 'ledger-only-destroyed-site', x: 1050, hp: 100 }];
const world = {
  index: 0, scale: 1, scroll: 0, parallaxX: 0,
  mapWidth: 1200, detailScale: 1, sceneryLayers: [new Map()], sceneryDirty: new Map(),
  destroyed: new Set([dead.id, 'legacy-destroyed-tree', 'ledger-only-destroyed-site']),
  damage: new Map([['lightly-damaged-facility', 55], ['heavily-damaged-facility', 25]]),
  getBand: row => row === 0 ? band : [], getTile: () => ({}), drawGroundDetails() {},
  getSprite: (type, variant, stage) => ({ type, variant, stage }),
  structureEffects: { drawFoundation(_context, prop) { foundations.push(prop.id); } },
};
const savedDestroyed = [...world.destroyed], savedDamage = [...world.damage], savedHp = band.map(prop => prop.hp);
const expectedPaint = [
  { type: 'station', variant: 2, stage: 0 },
  { type: 'station', variant: 2, stage: 1 },
  { type: 'station', variant: 2, stage: 2 },
  { type: 'ruin', variant: 2, stage: 0 },
  { type: 'asteroid', variant: 2, stage: 0 },
];
let checks = 0;
for (let index = 0; index < 10; index++) for (const detailScale of [1, 2]) for (const scroll of [-850.25, 0, 75000]) {
  Object.assign(world, { index, detailScale, scroll, parallaxX: scroll ? -12 : 12 });
  world.sceneryLayers[0].clear(); painted.length = 0; foundations.length = 0;
  const first = painter.call(world, 0, band);
  assert.deepEqual(painted, expectedPaint, 'only intact scenery and live damage stages may paint');
  assert.deepEqual(foundations, band.slice(1, 6).map(prop => prop.id), 'destroyed sites leave no foundation');
  assert.deepEqual([...world.destroyed], savedDestroyed, 'painting preserves the destruction ledger');
  assert.deepEqual([...world.damage], savedDamage, 'painting preserves live structural damage');
  assert.deepEqual(band.map(prop => prop.hp), savedHp, 'painting never revives or damages scenery');
  painted.length = 0;
  assert.equal(painter.call(world, 0, band), first, 'unchanged scenery uses its existing strip');
  assert.equal(painted.length, 0, 'cached strips perform no repeated scenery painting');
  world.sceneryDirty.set(0, { left: 0, right: 1200, top: 0, bottom: 800 });
  painter.call(world, 0, band);
  assert.deepEqual(painted, expectedPaint, 'dirty refreshes leave destroyed sites equally empty');
  checks++;
}

// Legacy/debug requests for a terminal sprite share one transparent pixel and
// cannot build or cache crater art during gameplay.
const getSprite = new Function(`return ({${methodSource('getSprite', 'cacheSprite')}}).getSprite;`)();
const emptySprite = { width: 1, height: 1 };
const spriteWorld = { emptyScenerySprite: emptySprite };
for (const type of structures) for (let variant = 0; variant < 5; variant++) {
  assert.equal(getSprite.call(spriteWorld, type, variant, 3), emptySprite);
  assert.equal(getSprite.call(spriteWorld, type, variant, 4), emptySprite);
}

// Destruction still emits exactly one reward event and records the site, then
// subsequent hits ignore it even though no crater is painted.
const hit = new Function('BUILDINGS', 'STRUCTURE_SPRITES', 'structureStage', 'HIT_CELL', 'clamp',
  `return ({${methodSource('hit', 'spriteVehicle')}}).hit;`)(new Set(structures.filter(type => !['crawler', 'hauler'].includes(type))), structures,
  structureStage, 160, (n, a, b) => Math.max(a, Math.min(b, n)));
const target = { ...dead, id: 'reward-once', x: 50, y: 50, hp: 100, value: 12 };
const hitWorld = {
  scale: 1, parallaxX: 0, scroll: 0,
  hitBuckets: new Map([['0:0', [target]]]), destroyed: new Set(), damage: new Map(), turretActivity: new Map(),
  dirtyScenery(prop) { assert.equal(prop, target); },
  queueWarm() { throw new Error('Destroyed structures must not queue terminal art'); },
};
assert.equal(hit.call(hitWorld, 50, 50, 0, 100).length, 1);
assert.equal(hit.call(hitWorld, 50, 50, 0, 100).length, 0);
assert.equal(target.hp, 0);
assert(hitWorld.destroyed.has(target.id));
assert.equal(hitWorld.damage.size, 0);
console.log(JSON.stringify({ pass: true, sceneryChecks: checks, environments: 10, terminalSpriteAllocations: 0, destructionRewards: 1 }, null, 2));
