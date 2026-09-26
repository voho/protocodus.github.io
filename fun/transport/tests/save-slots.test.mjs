import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, saveGame, loadGame, SAVE_KEY, tick, validateGame } from '../model.js';
import { listSaveSlots, writeSaveSlot, readSaveSlot, renameSaveSlot, deleteSaveSlot, SAVE_SLOT_PREFIX } from '../save-slots.js';

function storageFixture(quota = Infinity) {
  const values = new Map();
  return {
    values, quota, denyWrites: false, denyReads: new Set(),
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { if (this.denyReads.has(key)) throw new Error('Read disabled'); return values.get(key) ?? null; },
    setItem(key, value) {
      value = String(value);
      const size = [...values].reduce((sum, [k, v]) => sum + (k === key ? 0 : k.length + v.length), 0) + key.length + value.length;
      if (this.denyWrites || size * 2 > this.quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem(key) { if (this.denyWrites) throw new Error('Writes disabled'); values.delete(key); },
  };
}

async function withStorage(run, local = storageFixture()) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  try { await run(local); } finally { if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete globalThis.localStorage; }
}

function content(game) {
  const copy = structuredClone(game);
  delete copy.maintenanceRevision;
  for (const route of copy.routes) delete route.pathRevision;
  return copy;
}

test('two huge worlds and autosave fit a conservative 5 MiB quota and round-trip independently', () => withStorage(async local => {
  const forest = createGame({ biome: 'taiga', seed: 1847, size: 'huge' });
  const desert = createGame({ biome: 'desert', seed: 82461, size: 'huge' });
  tick(forest, 2.375); tick(desert, 3.25);
  assert.equal(saveGame(forest).ok, true);
  const autosave = local.getItem(SAVE_KEY);
  const first = await writeSaveSlot(forest, { name: '  Long haul  ' });
  const second = await writeSaveSlot(desert, { name: 'Long haul' });
  assert.equal(first.ok, true, first.message); assert.equal(second.ok, true, second.message);
  assert.notEqual(first.id, second.id, 'duplicate display names have independent crypto IDs');
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  for (const [result, original] of [[first, forest], [second, desert]]) {
    const raw = local.getItem(SAVE_SLOT_PREFIX + result.id), envelope = JSON.parse(raw);
    assert.equal(envelope.encoding, 'gzip-base64');
    assert.equal(envelope.codec, 'tile-binary-v1');
    assert.ok(raw.length < 700_000, 'compressed huge slot keeps space for a second world and autosave');
    const loaded = await readSaveSlot(result.id);
    assert.equal(loaded.ok, true, loaded.message);
    assert.deepEqual(content(loaded.game), content(original));
    tick(loaded.game, .625); tick(original, .625);
    assert.deepEqual(content(loaded.game), content(original), 'restored worlds continue exactly');
  }
  const listing = listSaveSlots();
  assert.equal(listing.ok, true); assert.equal(listing.slots.length, 3);
  assert.equal(listing.slots[0].id, 'autosave'); assert.equal(listing.slots[0].readonly, true);
  assert.equal(listing.slots.filter(slot => slot.name === 'Long haul').length, 2);
  assert.ok(listing.slots.every(slot => slot.status === 'ready'));
  assert.equal(local.getItem(SAVE_KEY), autosave, 'manual operations leave the original autosave byte-for-byte intact');
}, storageFixture(5 * 1024 * 1024)));

test('overwriting and renaming update metadata without touching another slot or autosave', () => withStorage(async local => {
  const a = createGame({ size: 'regional', biome: 'taiga', seed: 91 });
  const b = createGame({ size: 'regional', biome: 'tundra', seed: 92 });
  saveGame(a);
  const first = await writeSaveSlot(a, { name: 'North' }), second = await writeSaveSlot(b, { name: 'Ice' });
  const autosave = local.getItem(SAVE_KEY), other = local.getItem(SAVE_SLOT_PREFIX + second.id);
  tick(b, 12.5);
  const overwrite = await writeSaveSlot(b, { id: first.id, name: 'New frontier' });
  assert.equal(overwrite.ok, true); assert.equal(overwrite.id, first.id);
  const slot = listSaveSlots().slots.find(slot => slot.id === first.id);
  assert.equal(slot.name, 'New frontier'); assert.equal(slot.biome, 'tundra');
  assert.equal(slot.day, b.day); assert.equal(slot.money, b.money); assert.equal(slot.routes, b.routes.length);
  assert.deepEqual(content((await readSaveSlot(first.id)).game), content(b));
  const before = JSON.parse(local.getItem(SAVE_SLOT_PREFIX + first.id));
  assert.equal(renameSaveSlot(first.id, '  Winter line  ').ok, true);
  const after = JSON.parse(local.getItem(SAVE_SLOT_PREFIX + first.id));
  assert.equal(after.name, 'Winter line'); assert.equal(after.payload, before.payload); assert.equal(after.savedAt, before.savedAt);
  assert.equal(local.getItem(SAVE_SLOT_PREFIX + second.id), other); assert.equal(local.getItem(SAVE_KEY), autosave);
  local.setItem('another-app-setting', 'keep');
  assert.equal(deleteSaveSlot(first.id).ok, true);
  assert.equal(local.getItem(SAVE_SLOT_PREFIX + first.id), null);
  assert.equal(local.getItem('another-app-setting'), 'keep'); assert.equal(local.getItem(SAVE_SLOT_PREFIX + second.id), other);
  assert.equal(deleteSaveSlot('autosave').ok, false); assert.equal(renameSaveSlot('autosave', 'Other').ok, false);
  assert.equal((await writeSaveSlot(a, { id: 'autosave', name: 'Other' })).ok, false);
  assert.equal(local.getItem(SAVE_KEY), autosave);
}));

test('quota failures preserve the previous slot atomically and do not create phantom entries', () => withStorage(async local => {
  const game = createGame({ size: 'regional', seed: 903 });
  const saved = await writeSaveSlot(game, { name: 'Safe checkpoint' });
  saveGame(game);
  const before = new Map(local.values);
  local.denyWrites = true;
  assert.equal((await writeSaveSlot(game, { id: saved.id, name: 'Failed overwrite' })).ok, false);
  assert.equal((await writeSaveSlot(game, { name: 'Failed new slot' })).ok, false);
  assert.equal(renameSaveSlot(saved.id, 'Failed rename').ok, false);
  assert.equal(deleteSaveSlot(saved.id).ok, false);
  assert.deepEqual(local.values, before);
  assert.equal((await readSaveSlot(saved.id)).ok, true);
  assert.equal(listSaveSlots().slots.length, 2);
}));

test('invalid names, absent overwrite targets and invalid games never change storage', () => withStorage(async local => {
  const game = createGame({ size: 'regional', seed: 72 });
  const saved = await writeSaveSlot(game, { name: 'Existing' });
  const before = new Map(local.values);
  for (const name of ['', '  ', 'x'.repeat(41), null, 42]) {
    assert.equal((await writeSaveSlot(game, { name })).ok, false);
    assert.equal(renameSaveSlot(saved.id, name).ok, false);
  }
  assert.equal((await writeSaveSlot(game, { id: 'missing', name: 'Ghost' })).ok, false);
  game.money = NaN;
  assert.equal((await writeSaveSlot(game, { id: saved.id, name: 'Invalid world' })).ok, false);
  assert.deepEqual(local.values, before);
}));

test('corrupt and inaccessible slots remain listed without deleting or replacing their bytes', () => withStorage(async local => {
  const game = createGame({ size: 'regional', seed: 418 });
  const saved = await writeSaveSlot(game, { name: 'Original' });
  const original = JSON.parse(local.getItem(SAVE_SLOT_PREFIX + saved.id));
  local.setItem(SAVE_SLOT_PREFIX + 'bad-json', '{broken');
  local.setItem(SAVE_SLOT_PREFIX + 'future', JSON.stringify({ ...original, id: 'future', format: 'future-save' }));
  local.setItem(SAVE_SLOT_PREFIX + 'damaged', JSON.stringify({ ...original, id: 'damaged', payload: original.payload.slice(0, -8) + 'AAAAAAAA' }));
  const before = new Map(local.values);
  const listed = listSaveSlots();
  assert.equal(listed.ok, true);
  for (const id of ['bad-json', 'future', 'damaged']) {
    assert.equal(listed.slots.find(slot => slot.id === id).status, 'corrupt');
    assert.equal((await readSaveSlot(id)).ok, false);
    assert.equal(renameSaveSlot(id, 'Attempt').ok, false);
  }
  assert.deepEqual(local.values, before, 'even failed reads and renames leave corrupted bytes untouched');
  local.denyReads.add(SAVE_SLOT_PREFIX + saved.id);
  const partial = listSaveSlots();
  assert.equal(partial.ok, false); assert.equal(partial.slots.find(slot => slot.id === saved.id).status, 'unavailable');
  assert.equal((await readSaveSlot(saved.id)).ok, false);
  local.denyReads.clear();
  assert.equal(deleteSaveSlot('bad-json').ok, true, 'the user can explicitly remove a damaged entry');
  assert.equal((await readSaveSlot(saved.id)).ok, true);
}));

test('legacy autosaves migrate through the same loader and stay read-only in the slot catalog', () => withStorage(async local => {
  const legacy = createGame({ size: 'regional', seed: 225 });
  tick(legacy, 25.375);
  delete legacy.networkRevision;
  for (const industry of legacy.industries) { delete industry.lastProductionDay; delete industry.nextProductionDay; delete industry.nextReviewDay; }
  for (const vehicle of legacy.vehicles) { delete vehicle.dwellRemaining; delete vehicle.tripSerial; }
  for (const city of legacy.cities) delete city.lastServiceDay;
  const raw = JSON.stringify(legacy); local.setItem(SAVE_KEY, raw);
  const listed = listSaveSlots().slots[0];
  assert.equal(listed.id, 'autosave'); assert.equal(listed.savedAt, null); assert.equal(listed.readonly, true); assert.equal(listed.status, 'ready');
  const restored = await readSaveSlot('autosave');
  assert.equal(restored.ok, true); assert.equal(validateGame(restored.game), true);
  assert.deepEqual(content(restored.game), content(loadGame()));
  assert.ok(restored.game.industries.every(industry => Number.isInteger(industry.nextProductionDay)));
  assert.ok(restored.game.vehicles.every(vehicle => vehicle.dwellRemaining === 0 && vehicle.tripSerial === 0));
  assert.equal(local.getItem(SAVE_KEY), raw, 'loading alone does not replace the autosave');
}));

test('async compression snapshots game data and metadata before the simulation can advance', () => withStorage(async local => {
  const game = createGame({ size: 'regional', seed: 391 });
  const snapshot = content(game), pending = writeSaveSlot(game, { name: 'Before growth' });
  tick(game, 8.5);
  const saved = await pending, loaded = await readSaveSlot(saved.id);
  assert.equal(saved.ok, true); assert.equal(loaded.ok, true);
  assert.deepEqual(content(loaded.game), snapshot);
  const envelope = JSON.parse(local.getItem(SAVE_SLOT_PREFIX + saved.id));
  assert.equal(envelope.day, snapshot.day); assert.equal(envelope.money, snapshot.money);
}));

test('readable JSON fallback works without compression and compressed slots report missing support', () => withStorage(async local => {
  const game = createGame({ size: 'regional', seed: 12 });
  const compressed = await writeSaveSlot(game, { name: 'Compressed' });
  const compression = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream');
  const decompression = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  Object.defineProperty(globalThis, 'CompressionStream', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: undefined });
  try {
    const fallback = await writeSaveSlot(game, { name: 'Readable fallback' });
    assert.equal(fallback.ok, true);
    const envelope = JSON.parse(local.getItem(SAVE_SLOT_PREFIX + fallback.id));
    assert.equal(envelope.encoding, 'json'); assert.equal(JSON.parse(envelope.payload).format, 'transport-compact-v1');
    assert.deepEqual(content((await readSaveSlot(fallback.id)).game), content(game));
    assert.equal(listSaveSlots().slots.find(slot => slot.id === compressed.id).status, 'unavailable');
    assert.match((await readSaveSlot(compressed.id)).message, /gzip support/);
  } finally {
    Object.defineProperty(globalThis, 'CompressionStream', compression);
    Object.defineProperty(globalThis, 'DecompressionStream', decompression);
  }
}));
