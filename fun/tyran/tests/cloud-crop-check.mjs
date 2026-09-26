import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Test the actual private helpers without requiring a browser or changing the
// renderer's public API. This file stays portable beside ../worlds.js.
const source = await readFile(new URL('../worlds.js', import.meta.url), 'utf8');
const start = source.indexOf('function cloudBounds(');
const end = source.indexOf('function circle(', start);
assert(start >= 0 && end > start, 'cloud crop helpers must exist');
const helpers = source.slice(start, end);
const { cloudBounds, cloudPixelBounds, drawCloudImage } = await import(
  'data:text/javascript;base64,' + Buffer.from(helpers + '\nexport { cloudBounds, cloudPixelBounds, drawCloudImage };').toString('base64')
);

const width = 480, height = 320, rgba = new Uint8Array(width * height * 4);
// Overlapping soft puffs plus alpha=1 outliers exercise the whole nonzero
// footprint. No threshold may discard a faint cloud edge.
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  let alpha = 0;
  for (const [cx, cy, rx, ry] of [[175, 170, 75, 66], [263, 143, 93, 111], [327, 184, 58, 62]]) {
    const distance = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (distance < 1) alpha = Math.max(alpha, Math.max(1, Math.round((1 - distance) * 180)));
  }
  rgba[(y * width + x) * 4 + 3] = alpha;
}
rgba[(19 * width + 89) * 4 + 3] = 1;
rgba[(297 * width + 389) * 4 + 3] = 1;
const bounds = cloudPixelBounds(rgba, width, height);
assert.deepEqual(bounds, { x: 87, y: 17, width: 305, height: 283 });
let nonzero = 0;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3]) {
  nonzero++;
  assert(x >= bounds.x + 2 && x < bounds.x + bounds.width - 2);
  assert(y >= bounds.y + 2 && y < bounds.y + bounds.height - 2);
}

function sampledAlpha(x, y) {
  x -= .5; y -= .5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  let alpha = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const xx = Math.max(0, Math.min(width - 1, ix + i)), yy = Math.max(0, Math.min(height - 1, iy + j));
    alpha += rgba[(yy * width + xx) * 4 + 3] * (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
  }
  return alpha;
}
let seed = 99, clipped = 0;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
for (let i = 0; i < 20000; i++) {
  const x = random() * width, y = random() * height;
  if (x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) {
    assert.equal(sampledAlpha(x, y), 0, 'removed pixels must remain transparent under bilinear filtering');
    clipped++;
  }
}

const image = { width, height, _tyranAlphaBounds: bounds };
for (const [x, y, w, h] of [[0, 0, 960, 640], [-600, -300, 1700, 1139], [3.27, 7.64, 120.3, 70.9], [3200, 1600, 14, 9]]) {
  let args;
  drawCloudImage({ prewarm() {}, drawImage(...values) { args = values; } }, image, x, y, w, h);
  assert.equal(args[0], image);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = args;
  assert.deepEqual([sx, sy, sw, sh], [bounds.x, bounds.y, bounds.width, bounds.height]);
  for (const [u, v] of [[0, 0], [.17, .43], [.5, .5], [1, 1]]) {
    assert(Math.abs(dx + u * dw - (x + (sx + u * sw) * w / width)) < 1e-10);
    assert(Math.abs(dy + v * dh - (y + (sy + v * sh) * h / height)) < 1e-10);
  }
}
let nativeArgs;
drawCloudImage({ drawImage(...args) { nativeArgs = args; } }, image, 3, 4, 5, 6);
assert.deepEqual(nativeArgs, [image, 3, 4, 5, 6], 'native Canvas draw must remain unchanged');
let fallbackArgs;
const uncropped = { width: 20, height: 20 };
drawCloudImage({ prewarm() {}, drawImage(...args) { fallbackArgs = args; } }, uncropped, 1, 2, 3, 4);
assert.deepEqual(fallbackArgs, [uncropped, 1, 2, 3, 4]);
assert.equal(cloudPixelBounds(new Uint8Array(12 * 8 * 4), 12, 8), null);
for (const [x, y, expected] of [[0, 0, { x: 0, y: 0, width: 3, height: 3 }], [11, 7, { x: 9, y: 5, width: 3, height: 3 }]]) {
  const pixels = new Uint8Array(12 * 8 * 4); pixels[(y * 12 + x) * 4 + 3] = 1;
  assert.deepEqual(cloudPixelBounds(pixels, 12, 8), expected);
}
const shadow = cloudBounds(bounds.x * .5, bounds.y * .5, (bounds.x + bounds.width) * .5, (bounds.y + bounds.height) * .5, 240, 160);
assert(shadow.x <= bounds.x * .5 - 2 && shadow.y <= bounds.y * .5 - 2);
assert(shadow.x + shadow.width >= (bounds.x + bounds.width) * .5 + 2);
assert(shadow.y + shadow.height >= (bounds.y + bounds.height) * .5 + 2);
console.log(JSON.stringify({ pass: true, nonzero, clippedZeroAlphaSamples: clipped, bounds, shadow }, null, 2));
