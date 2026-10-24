/* Meteora — one draw call for everything that floats and blocks light.

   The glow batch is light added to the frame; this is matter in front of
   it: explosion smoke, rock dust, the trails burning debris leaves behind.
   Each puff is a camera-facing quad cut from a small atlas of noise puffs
   generated at load, and it is lit, because a cloud in sunlight is bright
   on one side and dark on the other, and that is most of what makes it read
   as a volume rather than a sticker. The atlas stores each puff's surface
   normal (a lumpy ball) beside its density; the shader turns the normal
   with the puff's rotation and lights it with the sun, wrapped, since smoke
   scatters light round its edges. An emissive term lets fresh smoke glow
   with the fire still inside it.

   Puffs are drawn back to front, re-sorted every frame — a few hundred at
   most — and the batch as a whole before the fireballs and the glow (main.js
   sets the order), so fire shows through smoke. As with the glow, a puff
   that would swallow the camera fades and is dropped. */

import * as THREE from 'three';
import { makeRng } from './rng.js';

const CELL = 128, CELLS = 2;   // a 2 × 2 atlas of 128² puffs

const VERTEX = /* glsl */`
attribute vec4 iCenter;   // world xyz, half-width (m)
attribute vec4 iColor;    // linear albedo rgb, opacity
attribute vec4 iMisc;     // rotation (rad), atlas cell, fire glow, unused
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec2 vRot;
varying vec4 vColor;
varying float vGlow;
varying vec3 vSun;
void main() {
  float c = cos(iMisc.x), s = sin(iMisc.x);
  vec2 corner = position.xy;
  vec4 mv = viewMatrix * vec4(iCenter.xyz, 1.0);
  mv.xy += vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * iCenter.w;
  vec2 cell = vec2(mod(iMisc.y, 2.0), floor(iMisc.y / 2.0));
  vUv = (cell + corner * 0.5 + 0.5) * 0.5;
  vRot = vec2(c, s);
  vColor = iColor;
  vGlow = iMisc.z;
  vSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */`
uniform sampler2D uAtlas;
uniform float uSun;
uniform float uAmbient;
varying vec2 vUv;
varying vec2 vRot;
varying vec4 vColor;
varying float vGlow;
varying vec3 vSun;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  vec2 n2 = t.rg * 2.0 - 1.0;
  n2 = vec2(n2.x * vRot.x - n2.y * vRot.y, n2.x * vRot.y + n2.y * vRot.x);
  vec3 n = vec3(n2, sqrt(max(0.0, 1.0 - dot(n2, n2))));
  float wrap = clamp(dot(n, vSun) * 0.6 + 0.4, 0.0, 1.0);
  // Thin edges seen against the sun light up: smoke scatters forward.
  float forward = pow(max(0.0, -vSun.z), 6.0) * (1.0 - t.a) * 0.9;
  vec3 lit = vColor.rgb * (uAmbient + uSun * (wrap + forward));
  // Fire inside fresh smoke: hottest where the puff is thickest.
  vec3 fire = mix(vec3(1.0, 0.24, 0.04), vec3(1.0, 0.62, 0.28), clamp(vGlow * t.a * 0.5, 0.0, 1.0)) * vGlow * t.a;
  gl_FragColor = vec4(lit + fire, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Smooth 2D value noise on a seeded 256² lattice: the atlas needs a few
// hundred thousand samples at load, and this is several times cheaper than
// the 3D noise the belt uses.
function lattice(seed) {
  const rng = makeRng(seed), table = new Float32Array(256 * 256);
  for (let i = 0; i < table.length; i++) table[i] = rng.next() * 2 - 1;
  const noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x0 = ix & 255, y0 = (iy & 255) << 8, x1 = (ix + 1) & 255, y1 = ((iy + 1) & 255) << 8;
    const a = table[y0 + x0], b = table[y0 + x1], c = table[y1 + x0], d = table[y1 + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => {
    let sum = 0, amp = 0.5;
    for (let o = 0; o < 4; o++, amp *= 0.5) sum += amp * noise(x * (1 << o) + o * 37.1, y * (1 << o) - o * 19.7);
    return sum;
  };
}

/* Four puffs, each a lumpy ball: noise piled onto a soft dome, cut off
   below a threshold so the edge is ragged. The normal comes from that
   uncut height — the dome's curve plus the noise's slope — so lumps catch
   the light across the whole puff, not just at its rim. Density fades to
   nothing inside each cell's border, so mipmaps never bleed one puff into
   the next. */
export function puffAtlas(size = CELL) {
  const w = size * CELLS, data = new Uint8Array(w * w * 4);
  const height = new Float32Array(size * size);
  for (let cell = 0; cell < CELLS * CELLS; cell++) {
    const ox = (cell % CELLS) * size, oy = Math.floor(cell / CELLS) * size;
    const fbm = lattice(17 + cell * 31);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
        const dome = Math.max(0, 1 - Math.hypot(u, v) / 0.96);
        height[y * size + x] = dome * dome * (3 - 2 * dome) * 1.4 + fbm(u * 2.2, v * 2.2) * 0.95;
      }
    }
    const at = (xx, yy) => height[Math.min(size - 1, Math.max(0, yy)) * size + Math.min(size - 1, Math.max(0, xx))];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
        const rim = Math.min(1, Math.max(0, (1 - Math.hypot(u, v)) / 0.15));
        const d = Math.max(0, Math.min(1, (at(x, y) - 0.32) * 1.3)) * rim;
        const gx = (at(x + 1, y) - at(x - 1, y)) * size * 0.12, gy = (at(x, y + 1) - at(x, y - 1)) * size * 0.12;
        let nx = -gx, ny = -gy, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        // Row 0 is the bottom of the texture (no flip), which is where the
        // shader puts the quad's lower edge, so +y here is up on screen.
        const i = ((oy + y) * w + ox + x) * 4;
        data[i] = Math.round((nx * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[i + 2] = 255;
        data[i + 3] = Math.round(d * (2 - d) * 255);
      }
    }
  }
  return { data, size: w };
}

export function createSmokeBatch(scene, sunDir, capacity = 1536) {
  const atlas = puffAtlas();
  const texture = new THREE.DataTexture(atlas.data, atlas.size, atlas.size, THREE.RGBAFormat);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const center = new Float32Array(capacity * 4), color = new Float32Array(capacity * 4), misc = new Float32Array(capacity * 4);
  const attrs = [['iCenter', center], ['iColor', color], ['iMisc', misc]].map(([name, array]) => {
    const a = new THREE.InstancedBufferAttribute(array, 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  });
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    uniforms: {
      uAtlas: { value: texture }, uSunDir: { value: sunDir.clone() },
      uSun: { value: 1.7 }, uAmbient: { value: 0.12 },
    },
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Puffs are staged here as they are added and written to the GPU arrays
  // in depth order at `end`.
  const stage = new Float32Array(capacity * 12), depth = new Float32Array(capacity), order = new Uint16Array(capacity);
  let n = 0, camX = 0, camY = 0, camZ = 0, fwdX = 0, fwdY = 0, fwdZ = -1;
  // Farthest first, ties in the order they came: each puff's key is its
  // depth's bits, turned so they sort as the depth does, above its index.
  // The keys sort natively; a comparator would be called, and its answer
  // boxed, some fifteen thousand times a frame in a big fight.
  const depthBits = new Uint32Array(depth.buffer), keys = new Float64Array(capacity);

  /* A puff handed over as its eleven numbers in one array `p`, in add's
     order — for the explosions' thousands a frame, which would each have
     every number boxed on the way into add. */
  const one = new Float64Array(11);
  const addFrom = p => {
    const x = p[0], y = p[1], z = p[2], size = p[3];
    let alpha = p[7];
    if (n >= capacity || alpha <= 0.002) return;
    const px = x - camX, py = y - camY, pz = z - camZ;
    const ahead = px * fwdX + py * fwdY + pz * fwdZ;
    const clearance = Math.sqrt(px * px + py * py + pz * pz) - size;
    if (clearance <= 0.5 || ahead - size <= 0.5) return;
    alpha *= Math.min(1, clearance / (size * 2), (ahead - size) / (size * 2));
    const s = n * 12;
    stage[s] = x; stage[s + 1] = y; stage[s + 2] = z; stage[s + 3] = size;
    stage[s + 4] = p[4]; stage[s + 5] = p[5]; stage[s + 6] = p[6]; stage[s + 7] = alpha;
    stage[s + 8] = p[8]; stage[s + 9] = p[9]; stage[s + 10] = p[10]; stage[s + 11] = 0;
    depth[n] = ahead;
    n++;
  };

  return {
    mesh,
    get count() { return n; },
    // Each place has its own sun: where it is, how strong, how much light
    // the sky itself gives.
    setSun(dir, sun = 1.7, ambient = 0.12) {
      material.uniforms.uSunDir.value.copy(dir);
      material.uniforms.uSun.value = sun;
      material.uniforms.uAmbient.value = ambient;
    },
    setCamera(x, y, z, fx, fy, fz) { camX = x; camY = y; camZ = z; fwdX = fx; fwdY = fy; fwdZ = fz; },
    begin() { n = 0; },
    // Position, half-width, albedo and opacity, rotation, atlas cell (0–3)
    // and fire glow.
    add(x, y, z, size, r, g, b, alpha, angle = 0, cell = 0, glow = 0) {
      const p = one;
      p[0] = x; p[1] = y; p[2] = z; p[3] = size; p[4] = r; p[5] = g; p[6] = b; p[7] = alpha;
      p[8] = angle; p[9] = cell; p[10] = glow;
      addFrom(p);
    },
    addFrom,
    end() {
      for (let k = 0; k < n; k++) {
        const bits = depthBits[k];
        // Float bits sort as the number does once negatives are flipped
        // whole and positives get the sign bit; then larger means nearer.
        const key = bits & 0x80000000 ? ~bits >>> 0 : (bits | 0x80000000) >>> 0;
        keys[k] = (0xffffffff - key) * 65536 + k;
      }
      keys.subarray(0, n).sort();
      // (Exact, and quicker than %, which is a call for doubles.)
      for (let k = 0; k < n; k++) { const key = keys[k]; order[k] = key - Math.floor(key / 65536) * 65536; }
      for (let k = 0; k < n; k++) {
        const s = order[k] * 12, i = k * 4;
        center[i] = stage[s]; center[i + 1] = stage[s + 1]; center[i + 2] = stage[s + 2]; center[i + 3] = stage[s + 3];
        color[i] = stage[s + 4]; color[i + 1] = stage[s + 5]; color[i + 2] = stage[s + 6]; color[i + 3] = stage[s + 7];
        misc[i] = stage[s + 8]; misc[i + 1] = stage[s + 9]; misc[i + 2] = stage[s + 10]; misc[i + 3] = stage[s + 11];
      }
      geometry.instanceCount = n;
      for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    },
  };
}
