/* Hedgerow — meadow grass: single blades by the tens of thousands, on the GPU.

   One instanced draw of blades round the camera, one per cell of a grid of
   world cells (snapped, so a blade keeps its place as the patch follows the
   camera). Everything about a blade — where in its cell, how tall, which
   way it faces and leans, its shade — comes from a hash of its cell; the
   ground under it (height, and how grassy it is) from a map made once from
   the terrain: the grass weight of the splat (a little in the forest), none
   on roads and mud, on steep banks, at the water or inside anything solid
   (houses, walls, sandbags). The wind leans every blade and sends gusts
   across the field in waves; the player parts the grass round his legs.
   Far blades thin out (the ones left grow wider) and the patch fades away
   at its edge, where the scattered tufts and the ground's own texture take
   over. */

import * as THREE from 'three';

const SEGS = 4;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* the ground map: R = height, G = how grassy (0..1), at the terrain's grid */
function groundMap(terrain, world, level, waterLevel) {
  const { H, nx, nz, minX, minZ, res } = terrain.grid;
  const dens = new Float32Array(nx * nz);
  const nrm = [0, 1, 0];
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * res;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * res, h = H[j * nx + i];
      terrain.normal(x, z, nrm);
      const slope = 1 - nrm[1];
      const w = level.splat(x, z, h, slope);
      let d = smoothstep(0.35, 0.8, w[1]) + w[2] * 0.12;
      d *= (1 - smoothstep(0.25, 0.5, slope)) * (1 - Math.min(1, w[3] * 2)) * smoothstep(0.1, 0.45, h - waterLevel);
      dens[j * nx + i] = d;
    }
  }
  // nothing grows inside what is solid
  for (const c of world.colliders) {
    if (c.type !== 'box' && c.type !== 'cyl') continue;
    if (!(c.flags & 1) || c.surface === 'foliage') continue;
    const i0 = Math.max(0, Math.floor((c.minX - minX) / res)), i1 = Math.min(nx - 1, Math.ceil((c.maxX - minX) / res));
    const j0 = Math.max(0, Math.floor((c.minZ - minZ) / res)), j1 = Math.min(nz - 1, Math.ceil((c.maxZ - minZ) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      const x = minX + i * res, z = minZ + j * res;
      if (c.top - H[k] < 0.3) continue;
      const rx = x - c.x, rz = z - c.z;
      const inside = c.type === 'box'
        ? Math.abs(rx * c.c - rz * c.s) <= c.hx + 0.1 && Math.abs(rx * c.s + rz * c.c) <= c.hz + 0.1
        : rx * rx + rz * rz <= (c.r + 0.1) ** 2;
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
  return { tex, min: new THREE.Vector2(minX, minZ), size: new THREE.Vector2((nx - 1) * res, (nz - 1) * res), texel: new THREE.Vector2(1 / nx, 1 / nz) };
}

export function createGrass({ terrain, world, level, shared, n = 256, spacing = 0.16 }) {
  // one blade: a strip from the root (y = 0) to the point (y = 1), x the side
  const pos = [], idx = [];
  for (let i = 0; i < SEGS; i++) pos.push(-1, i / SEGS, 0, 1, i / SEGS, 0);
  pos.push(0, 1, 0);
  for (let i = 0; i < SEGS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  idx.push((SEGS - 1) * 2, (SEGS - 1) * 2 + 1, SEGS * 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // three draws as many instances as its instanced attributes allow: one dummy
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(n * n), 1));
  geo.instanceCount = n * n;

  const map = groundMap(terrain, world, level, level.water?.level ?? -1e4);
  const uniforms = {
    tGround: { value: map.tex }, uMapMin: { value: map.min }, uMapSize: { value: map.size },
    uOrigin: { value: new THREE.Vector2() }, uN: { value: n }, uSpacing: { value: spacing },
    uRadius: { value: n * spacing * 0.5 }, uPlayer: { value: new THREE.Vector3(0, -1e4, 0) },
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
        uniform float uN, uSpacing, uRadius, uTime;
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
        // this blade's cell and everything the hash of it says
        float id = float(gl_InstanceID);
        vec2 cell = uOrigin + vec2(mod(id, uN), floor(id / uN));
        vec4 h = hash4(cell), h2 = hash4(cell + vec2(311.0, 173.0));
        vec2 xz = (cell + 0.5 + (h.xy - 0.5) * 1.5) * uSpacing;
        vec4 gd = texture2D(tGround, (xz - uMapMin) / uMapSize);
        float dist = length(xz - cameraPosition.xz);
        // far ones thin out (and the rest grow wider), the patch fades at its edge
        float keep = mix(1.0, 0.4, smoothstep(5.0, uRadius, dist));
        float here = step(h.z, gd.y * keep);
        float hgt = mix(0.22, 0.62, h2.x * h2.x) * (0.55 + 0.45 * gd.y) * here * (1.0 - smoothstep(uRadius * 0.65, uRadius * 0.97, dist));
        float t = position.y;
        float yaw = h2.y * 6.2831853;
        vec2 dir = vec2(cos(yaw), sin(yaw)), perp = vec2(-dir.y, dir.x);
        float w = mix(0.011, 0.024, h2.z) * (1.0 - t * 0.85) / sqrt(keep);
        // its own lean, the wind (gusts rolling across the field), a flutter
        float gust = 0.5 + 0.5 * sin(dot(xz, uWind) * 0.3 - uTime * 1.7 + sin(dot(xz, vec2(-uWind.y, uWind.x)) * 0.11) * 2.0);
        vec2 lean = dir * (0.12 + 0.3 * h.w) + uWind * (0.18 + 0.6 * gust * gust)
          + perp * sin(uTime * (2.0 + h2.w) + h.x * 6.28) * 0.12;
        // parted round the player's legs
        vec2 away = xz - uPlayer.xz;
        float pd = length(away);
        lean += away / max(pd, 0.01) * (1.0 - smoothstep(0.15, 0.8, pd)) * step(abs(uPlayer.y - gd.x), 1.5) * 1.6;
        float bend = t * t;
        bladePos = vec3(xz.x, gd.x, xz.y);
        bladePos.xz += perp * position.x * w + lean * bend * hgt * 0.75;
        bladePos.y += t * hgt * (1.0 - 0.3 * bend * min(1.0, dot(lean, lean)));
        // across the blade, rounded towards the sky (lit like a tuft, not a plank)
        vec3 objectNormal = normalize(vec3(dir.x, 0.0, dir.y) * 0.45 + vec3(perp.x, 0.0, perp.y) * position.x * 0.35 + vec3(0.0, 1.0, 0.0));
        vT = t;
        vShade = vec3(h.w, h2.w, gd.y);
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
        // dark green to straw at the tips, darker at the roots (the thatch shades them)
        vec3 g0 = mix(vec3(0.022, 0.04, 0.012), vec3(0.05, 0.065, 0.02), vShade.x);
        vec3 g1 = mix(vec3(0.06, 0.08, 0.025), vec3(0.13, 0.12, 0.05), vShade.y * vShade.y);
        diffuseColor.rgb = mix(g0, g1, smoothstep(0.1, 1.0, vT)) * mix(0.35, 1.0, smoothstep(0.0, 0.5, vT));
        diffuseColor.rgb *= mix(1.0, 0.75, uWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.42, uWet);`)
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'grass';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return {
    mesh,
    /* follow the camera; part the grass round the player */
    update(camera, player) {
      const o = uniforms.uOrigin.value;
      o.set(Math.floor(camera.position.x / spacing) - n / 2, Math.floor(camera.position.z / spacing) - n / 2);
      if (player) uniforms.uPlayer.value.copy(player);
    },
    setCount(m) {
      n = m;
      geo.instanceCount = m * m;
      uniforms.uN.value = m;
      uniforms.uRadius.value = m * spacing * 0.5;
      mesh.visible = m > 0;
    },
    uniforms,
  };
}
