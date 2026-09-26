// Shared deterministic primitives. Preserve exact output for versioned world recipes.
export function seedNumber(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
export function randomSource(seed) {
  let state = seedNumber(seed);
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ (n >>> 15), n | 1); n ^= n + Math.imul(n ^ (n >>> 7), n | 61); return ((n ^ (n >>> 14)) >>> 0) / 4294967296; };
}
export function hashNoise(x, y, seed) {
  let n = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export function noise(x, y, seed, scale) {
  const a = Math.floor(x / scale), b = Math.floor(y / scale);
  const fx = x / scale - a, fy = y / scale - b;
  const tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
  const top = hashNoise(a, b, seed) * (1 - tx) + hashNoise(a + 1, b, seed) * tx;
  const bottom = hashNoise(a, b + 1, seed) * (1 - tx) + hashNoise(a + 1, b + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}
