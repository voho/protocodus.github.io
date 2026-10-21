/* Hedgerow — meadow grass: tufts of blades by the tens of thousands, on the GPU.

   One instanced draw of grass tufts round the camera, one per cell of a
   grid of world cells (snapped, so a tuft keeps its place as the patch
   follows the camera); each tuft is five thin blades fanning out of one
   root. Everything about a tuft and its blades — where in the cell, how
   tall, which way each faces and leans, its shade, now and then a dead
   straw-coloured stalk — comes from a hash of its cell; the ground under
   it (height, and how grassy it is) from a map made once from the terrain:
   the grass weight of the splat (a little in the forest), none on roads and
   mud, on steep banks, at the water or inside anything solid (houses, walls,
   sandbags). The wind leans every blade and sends gusts across the field in
   waves; the player parts the grass round his legs. Far tufts thin out (the
   ones left grow fuller, no blade thinner than about a pixel) and the patch
   fades away at its edge, where the scattered tufts and the ground's own
   texture take over. */

import * as THREE from 'three';

const SEGS = 3, TUFT = 5;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* the ground map: R = height, G = how grassy (0..1), at the terrain's grid.
   The splat weights come from the terrain mesh, which has them at its
   vertices (every grid point in its fine chunks, every second one
   elsewhere); the points between are filled from their neighbours. Slope
   and water are judged at every point, from the heights. */
function groundMap(terrain, world, waterLevel) {
  const { H, nx, nz, minX, minZ, res } = terrain.grid;
  const dens = new Float32Array(nx * nz).fill(NaN);
  for (const chunk of terrain.group.children) {
    const g = chunk.geometry;
    const pos = g.attributes.position, spl = g.attributes.splat;
    if (!pos || !spl) continue;
    for (let v = 0; v < pos.count; v++) {
      const i = Math.round((pos.getX(v) - minX) / res), j = Math.round((pos.getZ(v) - minZ) / res);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const k = j * nx + i;
      if (Math.abs(pos.getY(v) - H[k]) > 0.01) continue;          // a skirt
      // grass, a little in the forest, none on the road
      dens[k] = (smoothstep(0.35, 0.8, spl.getY(v)) + spl.getZ(v) * 0.12) * (1 - Math.min(1, spl.getW(v) * 2));
    }
  }
  // between the coarse chunks' vertices: the average of the known neighbours (the
  // straight ones; the diagonal ones where both coordinates fall between)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!Number.isNaN(dens[k])) continue;
    let sum = 0, cnt = 0;
    for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const v = dens[b * nx + a];
      if (!Number.isNaN(v)) { sum += v; cnt++; }
    }
    if (!cnt) for (const [di, dj] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const v = dens[b * nx + a];
      if (!Number.isNaN(v)) { sum += v; cnt++; }
    }
    dens[k] = cnt ? sum / cnt : 0;
  }
  // none on steep banks, none at the water
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (dens[k] <= 0) continue;
    const hx = H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)];
    const hz = H[Math.min(nz - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i];
    const slope = 1 - (2 * res) / Math.hypot(hx, 2 * res, hz);
    dens[k] *= (1 - smoothstep(0.25, 0.5, slope)) * smoothstep(0.1, 0.45, H[k] - waterLevel);
  }
  // nothing grows inside what is solid; a thin thing (a post, a plank, a
  // sandbag wall) clears at least the map's nearest points to it
  const reach = res * 0.72;
  for (const c of world.colliders) {
    if (c.type !== 'box' && c.type !== 'cyl') continue;
    if (!(c.flags & 1) || c.surface === 'foliage') continue;
    const ex = c.type === 'box' ? Math.max(c.hx + 0.1, reach) : 0, ez = c.type === 'box' ? Math.max(c.hz + 0.1, reach) : 0;
    const er = c.type === 'cyl' ? Math.max(c.r + 0.1, reach) : 0;
    const i0 = Math.max(0, Math.floor((c.minX - reach - minX) / res)), i1 = Math.min(nx - 1, Math.ceil((c.maxX + reach - minX) / res));
    const j0 = Math.max(0, Math.floor((c.minZ - reach - minZ) / res)), j1 = Math.min(nz - 1, Math.ceil((c.maxZ + reach - minZ) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      const x = minX + i * res, z = minZ + j * res;
      if (c.top - H[k] < 0.03 || c.bottom - H[k] > 1.0) continue;   // buried, or high above (a bridge deck)
      const rx = x - c.x, rz = z - c.z;
      const inside = c.type === 'box'
        ? Math.abs(rx * c.c - rz * c.s) <= ex && Math.abs(rx * c.s + rz * c.c) <= ez
        : rx * rx + rz * rz <= er * er;
      if (inside) dens[k] = 0;
    }
  }
  const data = new Uint16Array(nx * nz * 2);
  for (let k = 0; k < nx * nz; k++) {
    data[k * 2] = THREE.DataUtils.toHalfFloat(H[k]);
    data[k * 2 + 1] = THREE.DataUtils.toHalfFloat(dens[k]);
  }
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, min: new THREE.Vector2(minX, minZ), size: new THREE.Vector2((nx - 1) * res, (nz - 1) * res) };
}

export function createGrass({ terrain, world, level, shared, n = 192, max = 192, spacing = 0.22 }) {
  // a tuft: TUFT blades, each a strip from the root (y = 0) to the point
  // (y = 1); x is the side, z which blade of the tuft
  const pos = [], idx = [];
  for (let b = 0; b < TUFT; b++) {
    const o = b * (SEGS * 2 + 1);
    for (let i = 0; i < SEGS; i++) pos.push(-1, i / SEGS, b, 1, i / SEGS, b);
    pos.push(0, 1, b);
    for (let i = 0; i < SEGS - 1; i++) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    idx.push(o + (SEGS - 1) * 2, o + (SEGS - 1) * 2 + 1, o + SEGS * 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // three draws no more instances than its instanced attributes hold: a dummy one, sized for the most
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(max * max), 1));
  geo.instanceCount = n * n;

  const map = groundMap(terrain, world, level.water?.level ?? -1e4);
  // the ground under the grass reads the same map (terrain.js)
  if (shared.grassMap) {
    shared.grassMap.value = map.tex;
    shared.grassMin.value.copy(map.min);
    shared.grassSize.value.copy(map.size);
    shared.grassR.value = n > 0 ? n * spacing * 0.5 : 0;
  }
  const uniforms = {
    tGround: { value: map.tex }, uMapMin: { value: map.min }, uMapSize: { value: map.size },
    uOrigin: { value: new THREE.Vector2() }, uN: { value: n }, uSpacing: { value: spacing },
    uRadius: { value: n * spacing * 0.5 }, uPlayer: { value: new THREE.Vector3(0, -1e4, 0) },
    uPixel: { value: 0.0015 },
    uWind: { value: new THREE.Vector2(1.4, 0.6).normalize() }, uTime: shared.time, uWet: shared.wet,
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  mat.name = 'grass';
  mat.customProgramCacheKey = () => 'hedgerow-grass';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGround;
        uniform vec2 uMapMin, uMapSize, uOrigin, uWind;
        uniform float uN, uSpacing, uRadius, uTime, uPixel;
        uniform vec3 uPlayer;
        varying float vT;
        varying vec3 vShade;
        vec3 bladePos;
        vec4 hash4(vec2 c) {
          uvec4 v = uvec4(uvec2(ivec2(floor(c)) + 65536), 7u, 13u);
          v = v * 1664525u + 1013904223u;
          v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
          v ^= v >> 16u;
          v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
          return vec4(v) * (1.0 / 4294967295.0);
        }`)
      .replace('#include <beginnormal_vertex>', `
        // this tuft's cell and everything the hash of it says
        float id = float(gl_InstanceID);
        vec2 cell = uOrigin + vec2(mod(id, uN), floor(id / uN));
        vec4 h = hash4(cell);
        vec2 root = (cell + 0.5 + (h.xy - 0.5) * 1.4) * uSpacing;
        vec4 gd = texture2D(tGround, (root - uMapMin) / uMapSize);
        float dist = length(root - cameraPosition.xz);
        // far tufts thin out (the rest grow fuller), the patch fades at its edge
        float keep = mix(1.0, 0.35, smoothstep(6.0, uRadius, dist));
        float here = step(h.z, gd.y * keep);
        float tuftH = mix(0.3, 0.78, h.w * sqrt(h.w)) * (0.55 + 0.45 * gd.y) * here * (1.0 - smoothstep(uRadius * 0.6, uRadius * 0.95, dist));
        // further out a tuft is fewer, wider blades (the rest are under a pixel anyway)
        float blades = floor(mix(${TUFT}.5, 2.5, smoothstep(5.0, uRadius * 0.75, dist)));
        tuftH *= step(position.z, blades - 0.5);
        // this blade of the tuft: where it comes up, how tall, which way it faces
        vec4 b = hash4(cell + vec2(7919.0 * (position.z + 1.0), 104729.0));
        float ang = b.x * 6.2831853;
        vec2 off = vec2(cos(ang), sin(ang)) * (0.02 + 0.1 * sqrt(b.y));
        vec2 xz = root + off;
        float hgt = tuftH * mix(0.55, 1.0, b.z);
        float t = position.y;
        float yaw = b.w * 6.2831853;
        vec2 dir = vec2(cos(yaw), sin(yaw)), perp = vec2(-dir.y, dir.x);
        float w = mix(0.0035, 0.007, b.y) * (1.0 - t * 0.8) * inversesqrt(keep) * sqrt(${TUFT}.0 / blades);
        w = max(w, dist * uPixel * 0.5 * (1.0 - t * 0.8));
        // out of the tuft, the wind (gusts rolling across the field), a flutter
        float gust = 0.5 + 0.5 * sin(dot(root, uWind) * 0.3 - uTime * 1.7 + sin(dot(root, vec2(-uWind.y, uWind.x)) * 0.11) * 2.0);
        vec2 lean = normalize(off) * (0.25 + 0.45 * b.z) + uWind * (0.15 + 0.55 * gust * gust)
          + perp * sin(uTime * (2.0 + h.w) + b.x * 6.28) * 0.1;
        // parted round the player's legs
        vec2 away = xz - uPlayer.xz;
        float pd = length(away);
        lean += away / max(pd, 0.01) * (1.0 - smoothstep(0.15, 0.8, pd)) * step(abs(uPlayer.y - gd.x), 1.5) * 1.6;
        // bent along an arc (the lean sets how far over the tip is), keeping its length
        float lm = length(lean);
        vec2 ld = lean / max(lm, 1e-4);
        float th = min(lm * 0.85, 1.35);
        float arc = th * t;
        float bx = th > 1e-3 ? (1.0 - cos(arc)) / th : 0.0;
        float by = th > 1e-3 ? sin(arc) / th : t;
        bladePos = vec3(xz.x, gd.x, xz.y);
        bladePos.xz += perp * position.x * w + ld * bx * hgt;
        bladePos.y += by * hgt;
        // across the blade, rounded towards the sky (lit like the sward, not like planks)
        vec3 objectNormal = normalize(vec3(dir.x, 0.0, dir.y) * 0.3 + vec3(perp.x, 0.0, perp.y) * position.x * 0.25 + vec3(0.0, 1.0, 0.0));
        vT = t;
        vShade = vec3(h.w, b.z, step(0.9, b.y));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = bladePos;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWet;
        varying float vT;
        varying vec3 vShade;`)
      .replace('#include <color_fragment>', `
        // dark green at the root (the sward shades it) to lighter, yellower tips; now and then a dead stalk
        vec3 g0 = mix(vec3(0.03, 0.05, 0.014), vec3(0.05, 0.07, 0.02), vShade.x);
        vec3 g1 = mix(vec3(0.09, 0.13, 0.035), vec3(0.15, 0.16, 0.06), vShade.y);
        vec3 col = mix(g0, g1, smoothstep(0.05, 1.0, vT));
        col = mix(col, vec3(0.2, 0.16, 0.08) * (0.6 + 0.4 * vT), vShade.z);
        diffuseColor.rgb = col * mix(0.45, 1.0, smoothstep(0.0, 0.4, vT)) * mix(1.0, 0.85, uWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.42, uWet);`)
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'grass';
  mesh.visible = n > 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return {
    mesh,
    /* follow the camera (a pixel's size at a metre for a viewport `height` high); part the grass round the player */
    update(camera, player, height = 768) {
      const o = uniforms.uOrigin.value;
      o.set(Math.floor(camera.position.x / spacing) - n / 2, Math.floor(camera.position.z / spacing) - n / 2);
      uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height;
      if (player) uniforms.uPlayer.value.copy(player);
    },
    setCount(m) {
      n = Math.min(m, max);
      geo.instanceCount = n * n;
      uniforms.uN.value = n;
      uniforms.uRadius.value = n * spacing * 0.5;
      if (shared.grassR) shared.grassR.value = n > 0 ? uniforms.uRadius.value : 0;
      mesh.visible = n > 0;
    },
    uniforms,
  };
}
