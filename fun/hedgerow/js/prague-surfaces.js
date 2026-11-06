/* Small original procedural surfaces for Prague's city architecture.
   Painted limestone has a mineral grain, rather than rubble-stone joints;
   the pavement uses restrained black/white quarried mosaic diamonds. */
import * as THREE from 'three';
const cache = new Map();
const hash = (x, y, seed = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + seed * 71.3) * 43758.5453; return v - Math.floor(v); };
function texture(pixels, n) {
  const t = new THREE.DataTexture(pixels, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}
function rgba(data, i, color) { data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255; }
export function pragueTrimMaterial() {
  if (cache.has('trim')) return cache.get('trim');
  const n = 256, pixels = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const grain = (hash(x, y, 4) - 0.5) * 7 + (hash(x >> 4, y >> 4, 2) - 0.5) * 3;
    rgba(pixels, (y * n + x) * 4, [192 + grain, 184 + grain, 167 + grain]);
  }
  const map = texture(pixels, n); map.colorSpace = THREE.SRGBColorSpace; map.repeat.set(0.5, 0.5);
  const m = new THREE.MeshStandardMaterial({ name: 'stone_prague_painted_trim', map, roughness: 0.88, bumpMap: map, bumpScale: 0.006 });
  cache.set('trim', m); return m;
}
export function pragueMosaicMaterial() {
  if (cache.has('mosaic')) return cache.get('mosaic');
  const n = 512, pixels = new Uint8Array(n * n * 4), bump = new Uint8Array(n * n * 4), stonePixels = 16;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const tx = Math.floor(x / stonePixels), ty = Math.floor(y / stonePixels);
    const fx = x % stonePixels, fy = y % stonePixels;
    const dx = Math.abs((tx % 16) - 7.5), dy = Math.abs((ty % 16) - 7.5), diamond = dx + dy;
    const dark = diamond > 6.5 && diamond < 9.5;
    const grout = fx === 0 || fy === 0;
    const grain = (hash(tx, ty, 10) - 0.5) * 18 + (hash(x, y, 6) - 0.5) * 6;
    const c = grout ? [97, 94, 86] : dark ? [85 + grain, 84 + grain, 78 + grain] : [164 + grain, 160 + grain, 147 + grain];
    const i = (y * n + x) * 4; rgba(pixels, i, c);
    const h = grout ? 78 : 181 + (hash(tx, ty, 12) - 0.5) * 24;
    rgba(bump, i, [h, h, h]);
  }
  const map = texture(pixels, n); map.colorSpace = THREE.SRGBColorSpace;
  const height = texture(bump, n);
  // Builder UVs are in metres: one texture tile represents 1.6 metres.
  map.repeat.set(1 / 1.6, 1 / 1.6); height.repeat.copy(map.repeat);
  const m = new THREE.MeshStandardMaterial({ name: 'stone_prague_mosaic', map, bumpMap: height, bumpScale: 0.008, roughness: 0.9 });
  cache.set('mosaic', m); return m;
}
