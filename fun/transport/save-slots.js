import { BIOMES, SAVE_KEY, restoreGame, validateGame } from './model.js';
import { encodeGame } from './save-codec.js';

export const SAVE_SLOT_PREFIX = 'transport-slot-v1:';
export const SAVE_SLOT_FORMAT = 'transport-slot-v1';
const MAX_SAVE_LENGTH = 12_000_000;
const fail = message => ({ ok: false, message });
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && id !== 'autosave';
const validName = value => typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= 40;
const finite = value => typeof value === 'number' && Number.isFinite(value);
let autosaveCache = { raw: null, slot: null };

function storage() {
  if (typeof localStorage === 'undefined') throw new Error('Storage unavailable');
  return localStorage;
}

function metadata(game, id, name, savedAt) {
  return { id, name, biome: game.biome, day: game.day, money: game.money, savedAt, width: game.width, height: game.height, routes: game.routes.length };
}

// Detect accidental edits or truncated payloads while listing, without expanding maps.
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseEnvelope(raw, id) {
  if (!raw || raw.length > MAX_SAVE_LENGTH) throw new Error('Invalid save size');
  const slot = JSON.parse(raw);
  if (!slot || slot.format !== SAVE_SLOT_FORMAT || slot.id !== id || !validName(slot.name) || !Object.hasOwn(BIOMES, slot.biome) || !finite(slot.day) || slot.day < 0 || !finite(slot.money) || !Number.isInteger(slot.width) || !Number.isInteger(slot.height) || slot.width < 1 || slot.height < 1 || slot.width * slot.height > 512 * 384 || !Number.isInteger(slot.routes) || slot.routes < 0 || typeof slot.savedAt !== 'string' || !Number.isFinite(Date.parse(slot.savedAt)) || !['json', 'gzip-base64'].includes(slot.encoding) || typeof slot.payload !== 'string' || slot.payload.length > MAX_SAVE_LENGTH || slot.checksum !== checksum(slot.payload)) throw new Error('Damaged save');
  if (slot.encoding === 'gzip-base64' && (!/^H4sI[A-Za-z0-9+/]*={0,2}$/.test(slot.payload) || slot.payload.length % 4 !== 0)) throw new Error('Invalid compressed save');
  if (slot.codec !== undefined && (slot.codec !== 'tile-binary-v1' || slot.encoding !== 'gzip-base64')) throw new Error('Unsupported save codec');
  if (slot.encoding === 'json') JSON.parse(slot.payload);
  return slot;
}

function slotSummary(slot) {
  const { payload, checksum: ignored, encoding, codec, format, ...summary } = slot;
  const unavailable = encoding === 'gzip-base64' && typeof DecompressionStream !== 'function';
  return { ...summary, readonly: false, status: unavailable ? 'unavailable' : 'ready', ...(unavailable ? { message: 'This browser cannot open compressed saves. Use a browser with gzip support.' } : {}) };
}

function damagedSummary(id, raw, message = 'This save is damaged or from an unsupported version.') {
  let name = 'Damaged save';
  try { const value = JSON.parse(raw); if (validName(value?.name)) name = value.name.trim(); } catch {}
  return { id, name, readonly: false, status: 'corrupt', message, biome: null, day: null, money: null, savedAt: null, width: null, height: null, routes: null };
}

function autosaveSummary(raw) {
  if (raw === autosaveCache.raw && autosaveCache.slot) return { ...autosaveCache.slot };
  let game = null;
  try { if (raw.length <= MAX_SAVE_LENGTH) game = restoreGame(JSON.parse(raw)); } catch {}
  const slot = game ? { ...metadata(game, 'autosave', 'Autosave', null), readonly: true, status: 'ready' } : { ...damagedSummary('autosave', raw), name: 'Autosave', readonly: true };
  autosaveCache = { raw, slot };
  return { ...slot };
}

/** Synchronous metadata listing. No indexes and no writes, including for damaged entries. */
export function listSaveSlots() {
  const slots = [];
  let unavailable = false;
  try {
    const local = storage();
    try { const raw = local.getItem(SAVE_KEY); if (raw !== null) slots.push(autosaveSummary(raw)); }
    catch { unavailable = true; slots.push({ id: 'autosave', name: 'Autosave', readonly: true, status: 'unavailable', message: 'Browser storage is unavailable.' }); }
    const keys = [];
    for (let i = 0; i < local.length; i++) { const key = local.key(i); if (key?.startsWith(SAVE_SLOT_PREFIX)) keys.push(key); }
    for (const key of keys) {
      const id = key.slice(SAVE_SLOT_PREFIX.length);
      let raw;
      try { raw = local.getItem(key); } catch { unavailable = true; slots.push({ id, name: 'Unavailable save', readonly: false, status: 'unavailable', message: 'Browser storage is unavailable.' }); continue; }
      if (raw === null) continue;
      try { slots.push(slotSummary(parseEnvelope(raw, id))); }
      catch { slots.push(damagedSummary(id, raw)); }
    }
    slots.sort((a, b) => Number(b.readonly) - Number(a.readonly) || (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { ok: !unavailable, slots, ...(unavailable ? { message: 'Some saves could not be accessed.' } : {}) };
  } catch { return { ok: false, slots, message: 'Browser storage is unavailable.' }; }
}

function toBase64(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(parts.join(''));
}

function fromBase64(text) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pack(json, saved) {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return { encoding: 'json', payload: json };
  // Gzip the packed tile bytes directly, avoiding base64 overhead inside gzip.
  const tileBytes = fromBase64(saved.tiles.data), header = { ...saved, tiles: { ...saved.tiles } };
  delete header.tiles.data;
  const headerBytes = new TextEncoder().encode(JSON.stringify(header)), framed = new Uint8Array(9 + headerBytes.length + tileBytes.length);
  framed.set(new TextEncoder().encode('TRSP1'));
  new DataView(framed.buffer).setUint32(5, headerBytes.length);
  framed.set(headerBytes, 9); framed.set(tileBytes, 9 + headerBytes.length);
  const bytes = await new Response(new Blob([framed]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return { encoding: 'gzip-base64', codec: 'tile-binary-v1', payload: toBase64(new Uint8Array(bytes)) };
}

async function unpack(slot) {
  if (slot.encoding === 'json') return slot.payload;
  if (typeof DecompressionStream !== 'function') throw new Error('Compression unsupported');
  const bytes = fromBase64(slot.payload);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder(), pieces = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_SAVE_LENGTH) { await reader.cancel(); throw new Error('Expanded save is too large'); }
      pieces.push(value);
    }
    const expanded = new Uint8Array(length); let offset = 0;
    for (const piece of pieces) { expanded.set(piece, offset); offset += piece.length; }
    if (slot.codec !== 'tile-binary-v1') return decoder.decode(expanded);
    if (length < 9 || decoder.decode(expanded.subarray(0, 5)) !== 'TRSP1') throw new Error('Invalid tile frame');
    const headerLength = new DataView(expanded.buffer).getUint32(5);
    if (headerLength < 2 || headerLength > length - 9) throw new Error('Invalid tile header');
    const saved = JSON.parse(decoder.decode(expanded.subarray(9, 9 + headerLength)));
    if (!saved?.tiles || !saved.state || expanded.length - 9 - headerLength !== saved.state.width * saved.state.height * 4) throw new Error('Invalid tile frame size');
    saved.tiles.data = toBase64(expanded.subarray(9 + headerLength));
    return JSON.stringify(saved);
  } finally { reader.releaseLock(); }
}

/** A single setItem is the commit: failures preserve the complete previous slot. */
export async function writeSaveSlot(game, { id, name } = {}) {
  if (!validName(name)) return fail('Use a name between 1 and 40 characters.');
  if (id !== undefined && !validId(id)) return fail('Choose a named save to overwrite.');
  try {
    if (!validateGame(game)) return fail('The game state could not be validated.');
    const local = storage();
    if (id !== undefined && local.getItem(SAVE_SLOT_PREFIX + id) === null) return fail('That save no longer exists. Create a new save.');
    const saved = encodeGame(game), json = JSON.stringify(saved);
    if (json.length > MAX_SAVE_LENGTH) return fail('This world is too large to save in browser storage.');
    // Snapshot metadata before compression yields, matching the exact serialized world.
    const slotId = id ?? crypto.randomUUID();
    const info = metadata(game, slotId, name.trim(), new Date().toISOString());
    const packed = await pack(json, saved);
    const envelope = { format: SAVE_SLOT_FORMAT, ...info, ...packed, checksum: checksum(packed.payload) };
    const serialized = JSON.stringify(envelope);
    if (serialized.length > MAX_SAVE_LENGTH) return fail('This world is too large to save in browser storage.');
    local.setItem(SAVE_SLOT_PREFIX + slotId, serialized);
    return { ok: true, id: slotId, message: 'Saved on this device.' };
  } catch { return fail('Could not save. Browser storage may be full or unavailable. Existing saves were kept.'); }
}

export async function readSaveSlot(id) {
  if (id !== 'autosave' && !validId(id)) return fail('Choose a save to load.');
  let raw;
  try { raw = storage().getItem(id === 'autosave' ? SAVE_KEY : SAVE_SLOT_PREFIX + id); }
  catch { return fail('Browser storage is unavailable.'); }
  if (raw === null) return fail('That save no longer exists.');
  try {
    let json = raw;
    if (id !== 'autosave') {
      const slot = parseEnvelope(raw, id);
      if (slot.encoding === 'gzip-base64' && typeof DecompressionStream !== 'function') return fail('This browser cannot open compressed saves. Use a browser with gzip support.');
      json = await unpack(slot);
    }
    if (json.length > MAX_SAVE_LENGTH) return fail('This save is too large to load.');
    const game = restoreGame(JSON.parse(json));
    if (!game) return fail('This save is damaged or incompatible. Your current world is unchanged.');
    return { ok: true, id, game, message: 'World loaded.' };
  } catch { return fail('This save is damaged or incompatible. Your current world is unchanged.'); }
}

export function renameSaveSlot(id, name) {
  if (!validId(id)) return fail('Autosave cannot be renamed.');
  if (!validName(name)) return fail('Use a name between 1 and 40 characters.');
  try {
    const local = storage(), raw = local.getItem(SAVE_SLOT_PREFIX + id);
    if (raw === null) return fail('That save no longer exists.');
    const slot = parseEnvelope(raw, id);
    local.setItem(SAVE_SLOT_PREFIX + id, JSON.stringify({ ...slot, name: name.trim() }));
    return { ok: true, id, message: 'Save renamed.' };
  } catch { return fail('Could not rename this save. The original was kept.'); }
}

export function deleteSaveSlot(id) {
  if (!validId(id)) return fail('Autosave cannot be deleted here.');
  try {
    const local = storage();
    if (local.getItem(SAVE_SLOT_PREFIX + id) === null) return fail('That save no longer exists.');
    local.removeItem(SAVE_SLOT_PREFIX + id);
    return { ok: true, id, message: 'Save deleted.' };
  } catch { return fail('Could not delete this save. Browser storage is unavailable.'); }
}
