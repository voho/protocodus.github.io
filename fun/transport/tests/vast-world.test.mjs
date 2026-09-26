import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, INDUSTRIES, saveGame, loadGame, tick, SAVE_KEY, validateGame } from '../model.js';
import { WORLD_SIZES, DEFAULT_WORLD_SIZE, MAX_WORLD_TILES } from '../world.js';
import { encodeGame, decodeGame, encodeBytes, decodeBytes } from '../save-codec.js';
import { stepEcology } from '../environment.js';
import { writeSaveSlot, readSaveSlot, listSaveSlots, SAVE_SLOT_PREFIX } from '../save-slots.js';

function content(game) {
  const copy = structuredClone(game);
  delete copy.maintenanceRevision;
  for (const route of copy.routes) delete route.pathRevision;
  return copy;
}

test('the default continent adds 2.25 times the area while keeping every existing size unchanged', () => {
  assert.equal(DEFAULT_WORLD_SIZE, 'vast');
  assert.equal(MAX_WORLD_TILES, 768 * 576);
  for (const [size, dimensions] of [['regional', [128, 96]], ['large', [256, 192]], ['huge', [512, 384]]]) {
    assert.deepEqual([WORLD_SIZES[size].width, WORLD_SIZES[size].height], dimensions);
  }
  const game = createGame();
  assert.equal(game.size, 'vast');
  assert.equal(game.tiles.length / (512 * 384), 2.25);
  assert.equal(game.routes[0].path.length, 25, 'the opening trip stays short on a larger continent');
  assert.equal(validateGame(game), true);
});

for (const biome of ['taiga', 'tundra', 'desert']) test(`${biome}: vast worlds spread towns and complete production districts across the map`, () => {
  const game = createGame({ biome, size: 'vast', seed: 19281 });
  assert.equal(game.cities.length, 64);
  for (const [kind, definition] of Object.entries(INDUSTRIES)) {
    if (definition.biomes.includes(biome)) assert.equal(game.industries.filter(site => site.kind === kind).length, 12, `each district supplies ${kind}`);
  }
  const quadrants = [0, 0, 0, 0];
  for (const city of game.cities) quadrants[Number(city.x > game.width / 2) + 2 * Number(city.y > game.height / 2)]++;
  assert.ok(quadrants.every(count => count >= 8), `towns occupy all four regions: ${quadrants}`);
  const at = (x, y) => game.tiles[y * game.width + x];
  for (const industry of game.industries) {
    assert.notEqual(at(industry.x, industry.y).terrain, 'water', 'factories have buildable land');
    if (INDUSTRIES[industry.kind].coastal) assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(industry.x + dx, industry.y + dy).terrain === 'water'), 'fisheries have water access');
  }
  for (const city of game.cities.slice(0, 2)) {
    assert.equal(at(city.x, city.y + 5).terrain, 'water');
    assert.equal(at(city.x, city.y + 5).road, false, 'the opening port berth remains empty');
  }
});

test('dense browser strings preserve all byte values, reject malformed padding, and keep base64 compatibility', () => {
  for (let length = 0; length < 300; length++) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 157 + length) % 256);
    const encoded = encodeBytes(bytes, 'utf16-15');
    assert.deepEqual(decodeBytes(JSON.parse(JSON.stringify(encoded)), 'utf16-15', length), bytes);
    assert.deepEqual(decodeBytes(encodeBytes(bytes), 'base64', length), bytes);
  }
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index), encoded = encodeBytes(bytes, 'utf16-15');
  assert.ok(encoded.length < encodeBytes(bytes).length / 2, 'dense strings consume less than half the base64 code units');
  assert.throws(() => decodeBytes(encoded.slice(1), 'utf16-15', bytes.length));
  assert.throws(() => decodeBytes(encoded.slice(0, -1) + '\ud800', 'utf16-15', bytes.length));
  assert.throws(() => decodeBytes(encoded, 'future-encoding', bytes.length));
  assert.throws(() => decodeBytes(String.fromCharCode(270, 511), 'utf16-15'), 'nonzero padding cannot fabricate an extra byte');
});

test('a developed vast autosave and two distinct vast slots fit 5 MiB and resume losslessly', async () => {
  const values = new Map(), old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const bytesUsed = () => [...values].reduce((sum, [key, value]) => sum + (key.length + value.length) * 2, 0);
  const local = {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      const prior = values.get(key), nextBytes = bytesUsed() - (prior === undefined ? 0 : (key.length + prior.length) * 2) + (key.length + value.length) * 2;
      if (nextBytes > 5 * 1024 * 1024) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  try {
    const forest = createGame({ biome: 'taiga', seed: 1847 }), desert = createGame({ biome: 'desert', seed: 82461 });
    tick(forest, 360); tick(desert, 90);
    Object.assign(forest.tiles[0], { elevation: Math.PI, variant: 42, detail: 'custom-saved-riverbank' });
    assert.equal(saveGame(forest).ok, true);
    const raw = local.getItem(SAVE_KEY);
    assert.equal(JSON.parse(raw).tiles.encoding, 'utf16-15');
    const first = await writeSaveSlot(forest, { name: 'Forest continent' });
    const second = await writeSaveSlot(desert, { name: 'Desert continent' });
    assert.equal(first.ok, true, first.message); assert.equal(second.ok, true, second.message);
    assert.equal(JSON.parse(local.getItem(SAVE_SLOT_PREFIX + first.id)).encoding, 'gzip-utf16');
    assert.ok(bytesUsed() < 5 * 1024 * 1024);
    assert.deepEqual(content(loadGame()), content(forest));
    const resumed = await readSaveSlot(first.id);
    assert.equal(resumed.ok, true, resumed.message);
    assert.deepEqual(content(resumed.game), content(forest));
    tick(resumed.game, 2.375); tick(forest, 2.375);
    assert.deepEqual(content(resumed.game), content(forest), 'restored growth, production, and deliveries continue identically');
    assert.equal(saveGame(forest).ok, true, 'autosave continues while both named worlds occupy storage');
    assert.equal(listSaveSlots().slots.length, 3);
    const beforeFailure = new Map(values), third = await writeSaveSlot(desert, { name: 'Exceeds quota' });
    assert.equal(third.ok, false); assert.deepEqual(values, beforeFailure, 'quota failure leaves every existing company intact');
    const damaged = JSON.parse(local.getItem(SAVE_SLOT_PREFIX + second.id));
    damaged.payload = damaged.payload.slice(0, -2);
    values.set(SAVE_SLOT_PREFIX + second.id, JSON.stringify(damaged));
    assert.equal((await readSaveSlot(second.id)).ok, false);
    assert.equal(listSaveSlots().slots.find(slot => slot.id === second.id).status, 'corrupt');
    assert.equal((await readSaveSlot(first.id)).ok, true, 'one damaged slot does not poison another');
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete globalThis.localStorage;
  }
});

test('vast ecology visits a bounded sparse sample and preserves infrastructure', () => {
  const game = createGame({ biome: 'taiga', seed: 1234 }), tiles = game.tiles;
  const protectedTiles = new Map();
  for (let i = 0; i < tiles.length; i++) if (tiles[i].road || tiles[i].rail || tiles[i].building || tiles[i].terrain === 'water') protectedTiles.set(i, { ...tiles[i] });
  let reads = 0;
  game.tiles = new Proxy(tiles, { get(target, key, receiver) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, receiver); } });
  game.day = 42;
  const networkRevision = game.networkRevision, changes = stepEcology(game);
  assert.ok(changes > 0 && changes <= Math.ceil(tiles.length / 128));
  assert.ok(reads < tiles.length / 8, `one day samples neighborhoods instead of scanning ${tiles.length} tiles (${reads} reads)`);
  assert.equal(game.networkRevision, networkRevision, 'nature cannot trigger transport path rebuilding');
  for (const [index, tile] of protectedTiles) assert.deepEqual(tiles[index], tile);
  game.tiles = tiles;
  const saved = encodeGame(game);
  assert.deepEqual(decodeGame(saved).tiles, tiles, 'new terrain succession is saved without adding a migration');
});
