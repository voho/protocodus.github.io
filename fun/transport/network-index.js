// One bit per occupied tile, rather than a JS object/Set entry per road.
// Even a fully connected 2048² world uses only 512 KiB for this shared index.
const caches = new WeakMap();

export function networkIndex(game) {
  const revision = game.networkRevision || 0;
  let index = caches.get(game);
  if (index && index.tiles === game.tiles && index.width === game.width && index.height === game.height && index.revision === revision) return index;
  const bits = new Uint32Array(Math.ceil(game.tiles.length / 32));
  let count = 0;
  for (let id = 0; id < game.tiles.length; id++) {
    const tile = game.tiles[id];
    if (tile.road || tile.rail || tile.bridge || tile.tunnel) { bits[id >>> 5] |= 1 << (id & 31); count++; }
  }
  index = { tiles: game.tiles, width: game.width, height: game.height, revision, count, bytes: bits.byteLength, bits,
    *[Symbol.iterator]() {
      for (let word = 0; word < bits.length; word++) {
        let value = bits[word];
        while (value) {
          const bit = 31 - Math.clz32(value & -value);
          yield word * 32 + bit;
          value = (value & (value - 1)) >>> 0;
        }
      }
    },
  };
  caches.set(game, index);
  return index;
}

// Called after a model-owned mutation, with its previous revision. Unknown
// edits/fixture changes still cause the next reader to rebuild the index.
export function updateNetworkIndex(game, points, previousRevision) {
  const index = caches.get(game);
  if (!index) return;
  if (!points || index.tiles !== game.tiles || index.width !== game.width || index.height !== game.height || index.revision !== previousRevision) {
    caches.delete(game); return;
  }
  for (const { x, y } of points) {
    if (x < 0 || y < 0 || x >= game.width || y >= game.height) continue;
    const id = y * game.width + x, tile = game.tiles[id], word = id >>> 5, mask = 1 << (id & 31);
    const before = Boolean(index.bits[word] & mask), after = Boolean(tile.road || tile.rail || tile.bridge || tile.tunnel);
    if (before === after) continue;
    if (after) { index.bits[word] |= mask; index.count++; }
    else { index.bits[word] &= ~mask; index.count--; }
  }
  index.revision = game.networkRevision || 0;
}

// Which cells each model-owned network edit touched, never saved. Route
// replanning keeps a path only when none of these cells can reach it; a gap,
// overflow, replaced tiles or a revision set elsewhere answers null instead.
const JOURNAL_ENTRIES = 64, JOURNAL_CELLS = 16384, NO_CHANGES = new Int32Array(0), journals = new WeakMap();
let journalEnabled = true;

export function noteNetworkChanges(game, points, previousRevision) {
  let ring = journals.get(game);
  if (!ring || ring.tiles !== game.tiles || ring.width !== game.width) journals.set(game, ring = { tiles: game.tiles, width: game.width, entries: [], size: 0 });
  // Revisions only grow; an edit without points or after a rewind ends the known history.
  if (!points || (ring.entries.length && ring.entries[ring.entries.length - 1].to > previousRevision)) { ring.entries.length = 0; ring.size = 0; if (!points) return; }
  const cells = [];
  for (const p of points) if (p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < game.width && p.y < game.height) cells.push(p.y * game.width + p.x);
  ring.entries.push({ from: previousRevision, to: game.networkRevision || 0, cells: Int32Array.from(cells) }); ring.size += cells.length;
  while (ring.entries.length > JOURNAL_ENTRIES || ring.size > JOURNAL_CELLS) ring.size -= ring.entries.shift().cells.length;
}

// Cells changed in (revision, networkRevision], possibly repeated and read-only,
// or null unless journal entries cover that whole span for these tiles.
export function networkChangesSince(game, revision) {
  const target = game.networkRevision || 0, ring = journals.get(game);
  if (!journalEnabled || !Number.isInteger(revision) || revision > target) return null;
  if (revision === target) return NO_CHANGES;
  if (!ring || ring.tiles !== game.tiles || ring.width !== game.width) return null;
  let first = ring.entries.length, cursor = target, size = 0;
  while (cursor > revision && first > 0) { const entry = ring.entries[first - 1]; if (entry.to !== cursor) return null; cursor = entry.from; size += entry.cells.length; first--; }
  if (cursor !== revision) return null;
  if (first === ring.entries.length - 1) return ring.entries[first].cells;
  const cells = new Int32Array(size);
  for (let i = first, offset = 0; i < ring.entries.length; offset += ring.entries[i++].cells.length) cells.set(ring.entries[i].cells, offset);
  return cells;
}

// Tests compare a company that skips routes with a twin that searches every route.
export function setNetworkJournalEnabled(enabled) { journalEnabled = Boolean(enabled); }
