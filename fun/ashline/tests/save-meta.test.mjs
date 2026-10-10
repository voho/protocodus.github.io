import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, updateGame} from '../sim.js';
import {SAVE_KEY, SAVE_META_KEY, saveGame, loadGame, getSaveInfo} from '../save.js';

const storage = () => {
  const memory = new Map(), reads = [];
  return {memory, reads, getItem: key => { reads.push(key); return memory.get(key) ?? null; }, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key)};
};

test('the menu reads saved-operation details from a small metadata entry written after the save', () => {
  const s = createGame('save-meta', 'hard', {width: 72, height: 56});
  for (let i = 0; i < 40; i++) updateGame(s, .05);
  const store = storage(), saved = saveGame(s, {}, store);
  assert(saved.ok, saved.reason);
  const meta = JSON.parse(store.memory.get(SAVE_META_KEY));
  assert.deepEqual(meta, {seed: s.seed, difficulty: s.difficulty, time: s.time, savedAt: saved.savedAt, length: store.memory.get(SAVE_KEY).length});
  const info = getSaveInfo(store);
  assert.deepEqual(info, {ok: true, reason: '', seed: s.seed, difficulty: 'hard', time: s.time, savedAt: saved.savedAt}, 'The shape matches a full decode');
  const loaded = loadGame(store); assert(loaded.ok);
  assert.deepEqual(info, {ok: true, reason: '', seed: loaded.game.seed, difficulty: loaded.game.difficulty, time: loaded.game.time, savedAt: loaded.savedAt});
});

test('a missing, stale or damaged metadata entry falls back to the full save and repairs itself', () => {
  const s = createGame('save-meta-stale', 'normal', {width: 72, height: 56}), store = storage();
  assert(saveGame(s, {}, store).ok);
  const text = store.memory.get(SAVE_KEY), expected = getSaveInfo(store);
  // Saves written before the metadata entry existed.
  store.memory.delete(SAVE_META_KEY);
  assert.deepEqual(getSaveInfo(store), expected);
  assert(store.memory.has(SAVE_META_KEY), 'Reading an older save writes its metadata for next time');
  // Metadata from another save (the main entry changed after it) is never trusted.
  store.memory.set(SAVE_META_KEY, JSON.stringify({...JSON.parse(store.memory.get(SAVE_META_KEY)), seed: 'IMPOSTOR', length: text.length + 1}));
  assert.equal(getSaveInfo(store).seed, s.seed);
  store.memory.set(SAVE_META_KEY, JSON.stringify({...JSON.parse(store.memory.get(SAVE_META_KEY)), savedAt: '2000-01-01T00:00:00.000Z', seed: 'IMPOSTOR'}));
  assert.equal(getSaveInfo(store).seed, s.seed, 'A metadata timestamp that differs from the save header is ignored');
  for (const damaged of ['{broken', 'null', '[]', JSON.stringify({seed: 7, difficulty: 'normal', time: 1, savedAt: 'x', length: text.length})]) {
    store.memory.set(SAVE_META_KEY, damaged);
    assert.deepEqual(getSaveInfo(store), expected, `Damaged metadata ${damaged.slice(0, 12)} is ignored`);
  }
  // A damaged main save with metadata of the wrong length reports the decode failure.
  store.memory.set(SAVE_KEY, '{invalid save');
  assert.equal(getSaveInfo(store).ok, false);
  store.memory.delete(SAVE_KEY);
  assert.equal(getSaveInfo(store).ok, false);
});

test('storage that refuses the metadata entry still saves the operation', () => {
  const s = createGame('save-meta-quota', 'normal', {width: 72, height: 56}), store = storage();
  const setItem = store.setItem;
  store.setItem = (key, value) => { if (key === SAVE_META_KEY) throw new DOMException('full', 'QuotaExceededError'); setItem(key, value); };
  const saved = saveGame(s, {}, store);
  assert(saved.ok, 'The operation itself is saved');
  assert(!store.memory.has(SAVE_META_KEY));
  assert.equal(getSaveInfo(store).seed, s.seed);
});
