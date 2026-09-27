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
