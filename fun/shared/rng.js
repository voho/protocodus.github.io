/* Seeded randomness for the puzzles. A puzzle is its seed: the same seed
   on the same difficulty rebuilds the same board, so a link with the seed
   in it opens the same puzzle for everyone. */

/* FNV-1a, so a short readable seed becomes a well-mixed 32-bit state. */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let state = (typeof seed === 'number' ? seed : hashSeed(String(seed))) >>> 0;
  // mulberry32
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    shuffle(list) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    },
  };
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i: seeds get read aloud

/* Six characters: short enough to share, wide enough never to repeat. */
export function randomSeed() {
  let seed = '';
  for (let i = 0; i < 6; i++) seed += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return seed;
}
