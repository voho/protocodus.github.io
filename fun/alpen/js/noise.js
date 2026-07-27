/* Seeded deterministic noise and deterministic randomness.

   Both matter for the same reason: the mountain is generated on demand and
   thrown away behind the rider, so anything the world says about a patch of
   hill has to be a pure function of where that patch is. Nothing is stored,
   and looking at the same coordinate twice always answers the same. A run
   seed is mixed into every hash, so the mountain changes between runs while
   a shared seed recreates the same terrain, props, weather and skyline. That
   is what lets props be forgotten and re-spawned without the hill appearing
   to shuffle itself. */

let worldSeed = 0;

/* Accept the short base-36 codes used in the URL, arbitrary text for hand-
   named mountains, or a raw integer from crypto. */
function seedValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const text = String(value ?? '').trim();
  if (/^[0-9a-z]{1,7}$/i.test(text)) return parseInt(text, 36) >>> 0;

  // FNV-1a: small, stable, and sufficient for turning a label into a key.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function setWorldSeed(value) {
  worldSeed = seedValue(value);
  return worldSeed;
}

export function getWorldSeed() {
  return worldSeed >>> 0;
}

export function worldSeedCode(value = worldSeed) {
  return seedValue(value).toString(36).toUpperCase().padStart(7, '0');
}

export function randomWorldSeed() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0] >>> 0;
  }
  return (Date.now() ^ Math.floor((globalThis.performance?.now?.() || 0) * 1000)) >>> 0;
}

/* One round of xxhash-shaped mixing over two integers. Returns [0, 1). */
export function hash2(x, y, seed = 0) {
  const runSeed = (seed | 0) ^ (worldSeed | 0);
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
    ^ Math.imul(runSeed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Value noise: smoothstep between four hashed lattice corners. Cheaper than
   gradient noise and, at these amplitudes, indistinguishable — the hill is
   read at 240 pixels tall through fog. Returns [0, 1). */
export function noise2(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);

  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

/* The same, centred: [-1, 1). */
export function snoise2(x, y, seed = 0) {
  return noise2(x, y, seed) * 2 - 1;
}

/* A tiny stream of numbers from one integer key — for a band of hill that
   wants a dozen decisions made about it and nothing kept. mulberry32. */
export function stream(key) {
  let a = ((key | 0) ^ (worldSeed | 0)) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
