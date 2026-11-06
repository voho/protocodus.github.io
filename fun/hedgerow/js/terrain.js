/* Hedgerow — terrain.

   The level describes its ground analytically (height(x, z) and
   splat(x, z, h, slope) -> [mud, grass, forest, cobble]); this module
   samples it once into a 0.5 m master grid, answers height / normal / ray
   queries from that grid, and builds chunked meshes (1 m, or 0.5 m where
   the level asks for detail, e.g. trenches) with skirts to hide the seams
   between resolutions; past LOD_FAR from the eye a chunk is drawn at half
   its resolution (updateLod), where its 1 m facets are under a pixel or two
   and the vertex work for them was the terrain's biggest cost in the long
   views up the street and the meadows. The material blends four ground textures by the
   splat weights and their heights, puts rock on steep slopes and standing
   water with rain rings in the hollows of the mud. */

import * as THREE from 'three';
import { RUTS_GLSL } from './ruts.js';
import { dimFillSpecular, addFireBounce } from './fill.js';
import { addCanopy } from './canopy.js';
import { clamp } from './util.js';
import { breathe } from './pace.js';

const RES = 0.5;
const CHUNK = 32;
const LOD_FAR = 140;      // metres from the eye to a chunk's nearest edge where it is drawn coarse

// a row of the heightfield, a chunk of the mesh at a time, the browser getting its turns between (pace.js)
export async function createTerrain(def, textures, shared) {
  const { minX, maxX, minZ, maxZ } = def.bounds;
  const nx = Math.round((maxX - minX) / RES) + 1;
  const nz = Math.round((maxZ - minZ) / RES) + 1;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * RES;
    for (let i = 0; i < nx; i++) H[j * nx + i] = def.height(minX + i * RES, z);
    await breathe();
  }

  function height(x, z) {
    const fx = clamp((x - minX) / RES, 0, nx - 1.001);
    const fz = clamp((z - minZ) / RES, 0, nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i], d = H[(j + 1) * nx + i + 1];
    // match the mesh triangulation (diagonal from (i,j+1) to (i+1,j))
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  function normal(x, z, out = [0, 1, 0]) {
    const e = RES;
    const hx = height(x + e, z) - height(x - e, z);
    const hz = height(x, z + e) - height(x, z - e);
    const L = Math.hypot(hx, 2 * e, hz);
    out[0] = -hx / L; out[1] = (2 * e) / L; out[2] = -hz / L;
    return out;
  }

  const splatCache = new Map();
  function surfaceAt(x, z) {
    const w = def.splat(x, z, height(x, z), 0);
    let best = 0;
    for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
    return ['mud', 'grass', 'forest', 'cobble'][best];
  }

  /* March a ray over the heightfield; returns t or Infinity. */
  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let t = 0;
    let prevT = 0, prevD = oy - height(ox, oz);
    if (prevD < 0) return 0;
    const step = 0.6;
    while (t < maxT) {
      t = Math.min(t + step, maxT);
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const d = y - height(x, z);
      if (d < 0) {
        // bisect
        let a = prevT, b = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) * 0.5;
          const dm = (oy + dy * m) - height(ox + dx * m, oz + dz * m);
          if (dm < 0) b = m; else a = m;
        }
        return b;
      }
      prevT = t; prevD = d;
      if (t >= maxT) break;
    }
    return Infinity;
  }

  /* ---------- meshes ---------- */

  const material = createTerrainMaterial(textures, shared);
  const group = new THREE.Group();
  group.name = 'terrain';
  const fine = def.fine || [];
  const isFine = (x0, z0, x1, z1) => fine.some(([a, b, c, d]) => x1 > a && x0 < c && z1 > b && z0 < d);

  for (let cz = minZ; cz < maxZ - 1e-6; cz += CHUNK) {
    for (let cx = minX; cx < maxX - 1e-6; cx += CHUNK) {
      const x1 = Math.min(cx + CHUNK, maxX), z1 = Math.min(cz + CHUNK, maxZ);
      const step = isFine(cx, cz, x1, z1) ? 1 : 2;   // in master cells
      group.add(buildChunk(cx, cz, x1, z1, step));
      await breathe();
    }
  }

  /* A chunk's mesh at its own resolution, with the half resolution kept beside it for the
     distance (when the chunk's cells divide evenly into it; a narrow chunk at the edge may not). */
  function buildChunk(x0, z0, x1, z1, step) {
    const i0 = Math.round((x0 - minX) / RES), j0 = Math.round((z0 - minZ) / RES);
    const i1 = Math.round((x1 - minX) / RES), j1 = Math.round((z1 - minZ) / RES);
    const fineGeo = chunkGeometry(i0, j0, i1, j1, step);
    const coarse = (i1 - i0) % (2 * step) === 0 && (j1 - j0) % (2 * step) === 0 ? chunkGeometry(i0, j0, i1, j1, 2 * step) : null;
    const mesh = new THREE.Mesh(fineGeo, material);
    mesh.name = 'terrain_chunk';
    mesh.matrixAutoUpdate = false;
    mesh.userData = { fine: fineGeo, coarse, box: [x0, z0, x1, z1] };
    return mesh;
  }

  function chunkGeometry(i0, j0, i1, j1, step) {
    const cols = Math.floor((i1 - i0) / step) + 1, rows = Math.floor((j1 - j0) / step) + 1;
    const vcount = cols * rows + 2 * (cols + rows);
    const pos = new Float32Array(vcount * 3);
    const nrm = new Float32Array(vcount * 3);
    const spl = new Float32Array(vcount * 4);
    const idx = [];
    const n = [0, 0, 0];
    let v = 0;
    const put = (i, j, drop) => {
      const x = minX + i * RES, z = minZ + j * RES;
      const h = H[j * nx + i];
      pos[v * 3] = x; pos[v * 3 + 1] = h - drop; pos[v * 3 + 2] = z;
      normal(x, z, n);
      nrm[v * 3] = n[0]; nrm[v * 3 + 1] = n[1]; nrm[v * 3 + 2] = n[2];
      const w = def.splat(x, z, h, 1 - n[1]);
      spl[v * 4] = w[0]; spl[v * 4 + 1] = w[1]; spl[v * 4 + 2] = w[2]; spl[v * 4 + 3] = w[3];
      return v++;
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) put(i0 + c * step, j0 + r * step, 0);
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    // skirts
    const edge = (list) => {
      const base = v;
      for (const [c, r] of list) put(i0 + c * step, j0 + r * step, 1.5);
      for (let k = 0; k < list.length - 1; k++) {
        const ta = list[k][1] * cols + list[k][0], tb = list[k + 1][1] * cols + list[k + 1][0];
        const ba = base + k, bb = base + k + 1;
        idx.push(ta, ba, tb, tb, ba, bb, ta, tb, ba, tb, bb, ba);
      }
    };
    edge(Array.from({ length: cols }, (_, c) => [c, 0]));
    edge(Array.from({ length: cols }, (_, c) => [c, rows - 1]));
    edge(Array.from({ length: rows }, (_, r) => [0, r]));
    edge(Array.from({ length: rows }, (_, r) => [cols - 1, r]));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, v * 3), 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(spl.subarray(0, v * 4), 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  /* Each chunk fine or coarse by how far its nearest edge is from the eye (a few metres'
     hysteresis, so one on the line does not flip back and forth). */
  function updateLod(eye) {
    for (const m of group.children) {
      const { fine, coarse, box } = m.userData;
      if (!coarse) continue;
      const dx = Math.max(box[0] - eye.x, 0, eye.x - box[2]), dz = Math.max(box[1] - eye.z, 0, eye.z - box[3]);
      const d = Math.hypot(dx, dz), far = m.geometry === coarse;
      if (!far && d > LOD_FAR + 8) m.geometry = coarse;
      else if (far && d < LOD_FAR - 8) m.geometry = fine;
    }
  }

  return { height, normal, raycast, surfaceAt, updateLod, group, material, grid: { H, nx, nz, minX, minZ, res: RES } };
}

/* ---------- material ---------- */

/* how much the shading normal's spread within a pixel widens the highlights (specular AA) */
export const SPEC_AA = { value: 1 };

export function createTerrainMaterial(textures, shared) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.name = 'terrain';
  mat.envMapIntensity = 0.9;
  mat.customProgramCacheKey = () => 'hedgerow-terrain-arrays-landscape-v1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tGround: { value: textures.groundAlbedo }, tGroundN: { value: textures.groundNormal },
      tLandscape: { value: textures.landscape },
      tRock: { value: textures.rock },
      uRockColor: { value: new THREE.Color('#5f5c55') },
      uWet: shared.wet, uTime: shared.time, uRain: shared.rain,
      uWaterLevel: shared.waterLevel || { value: -1e4 },
      uRelief: shared.relief || { value: 1 },
      uSpecAA: SPEC_AA,
      // the meadow grass (grass.js): its density map, and the radius it grows in round the camera
      tSward: shared.grassMap || { value: null }, uSwardMin: shared.grassMin || { value: new THREE.Vector2() },
      uSwardSize: shared.grassSize || { value: new THREE.Vector2(1, 1) }, uSwardR: shared.grassR || { value: 0 },
      // the lanes' wheel ruts (ruts.js)
      tRut: shared.rutMap || { value: null }, uRutMin: shared.rutMin || { value: new THREE.Vector2() },
      uRutSize: shared.rutSize || { value: new THREE.Vector2(1, 1) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNormal;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vSplat = splat;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2DArray tGround, tGroundN;
        uniform sampler2D tLandscape, tRock;
        uniform vec3 uRockColor;
        uniform float uWet, uTime, uRain, uWaterLevel, uSwardR, uRelief, uSpecAA;
        uniform sampler2D tSward;
        uniform vec2 uSwardMin, uSwardSize;
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        vec3 tNormal; vec3 tRockNormal; float tRockWeight;
        float tRough; float tPuddle; float tRim; float tShore; float tSwardK;
        vec2 pxz; float cavity;
        ${GLSL_HELPERS}
        ${RUTS_GLSL}
        // the depth (m) of the ground's relief below the mesh at xz: the
        // visible layer's height map (blended as the shading blends them)
        // scaled by how deep that ground is; layers that are not there are not read
        float reliefDepth(vec2 xz, vec4 w, vec2 gx, vec2 gy, vec4 sc) {
          vec2 uv = xz / 4.0;
          vec4 h = vec4(1.0);
          if (w.x > 0.002) h.x = textureGrad(tGround, vec3(uv, 0.0), gx, gy).a;
          if (w.y > 0.002) h.y = textureGrad(tGround, vec3(uv * 0.93 + 0.37, 1.0), gx * 0.93, gy * 0.93).a;
          if (w.z > 0.002) h.z = textureGrad(tGround, vec3(uv * 0.87 + 0.61, 2.0), gx * 0.87, gy * 0.87).a;
          if (w.w > 0.002) h.w = textureGrad(tGround, vec3(uv * 1.6, 3.0), gx * 1.6, gy * 1.6).a;
          vec4 hw = w + h * 0.55 * step(0.002, w);
          float ma = max(max(hw.x, hw.y), max(hw.z, hw.w)) - 0.18;
          vec4 b = max(hw - ma, 0.0) * step(0.002, w);
          b /= max(dot(b, vec4(1.0)), 1e-4);
          // and the wheel ruts cut into the mud of the lanes (~7 cm)
          return dot(b, (1.0 - h) * sc) + rutsAt(xz, b.x).x * sc.x * 1.2;
        }`)
      .replace('#include <map_fragment>', `
        // relief near the eye (parallax occlusion): the view ray marched down
        // through the height maps — the joints between the cobbles, the ruts
        // and hollows of the mud, the leaf litter — and the ground read where
        // it lands. Standing water caps it: puddles stay flat, stones break through.
        pxz = vWPos.xz;
        cavity = 0.0;
        {
          vec3 V = normalize(cameraPosition - vWPos);
          vec3 N = normalize(vWNormal);
          float vn = dot(V, N);
          float fade = (1.0 - smoothstep(9.0, 16.0, length(cameraPosition - vWPos))) * (1.0 - smoothstep(0.3, 0.45, 1.0 - N.y));
          vec4 wr = max(vSplat, 0.0);
          vec2 g0 = vWPos.xz / 4.0;
          vec2 gx = dFdx(g0), gy = dFdy(g0);
          // where water stands, and how high (the same noise the shading uses below)
          float gatherR = texture2D(tLandscape, vWPos.xz / 31.0).r;
          float levelR = smoothstep(0.45, 0.75, gatherR) * 1.2;
          // how deep each ground is (m): mud ruts, grass, leaf litter, the cobbles' joints
          vec4 sc = vec4(0.06, 0.012, 0.025, 0.035) * fade * uRelief;
          float maxD = max(max(sc.x * step(0.002, wr.x), sc.y * step(0.002, wr.y)), max(sc.z * step(0.002, wr.z), sc.w * step(0.002, wr.w)));
          // on a rutted lane the ground goes deeper
          float lane = rutLane(vWPos.xz) * step(0.002, wr.x);
          maxD = max(maxD, sc.x * 2.2 * lane);
          if (maxD > 0.002 && vn > 0.05) {
            // per metre of depth the ray moves this far across the ground (held in at grazing angles)
            vec2 dir = -V.xz / max(vn, 0.12);
            float reach = length(dir) * maxD;
            if (reach > 0.3) dir *= 0.3 / reach;
            // the water's surface caps the march
            float drainR = 1.0 - smoothstep(0.005, 0.06, 1.0 - N.y);
            float holdR = (wr.x + wr.w + wr.z * 0.35) / max(dot(wr, vec4(1.0)), 1e-4) * uWet * drainR;
            float waterD = holdR > 0.3 && levelR > 0.0 ? (1.0 - min(levelR, 1.0)) * dot(wr, sc) / max(dot(wr, vec4(1.0)), 1e-4) : 1e3;
            // the water standing in a rut, a little below the lane
            if (lane > 0.0 && uWet * drainR > 0.3 && rutsAt(vWPos.xz, 1.0).y > 0.02) waterD = min(waterD, sc.x * 0.55);
            const int STEPS = 12;
            float layer = maxD / float(STEPS);
            float d = 0.0, srf = min(reliefDepth(pxz, wr, gx, gy, sc), waterD);
            float pd = 0.0, ps = srf;
            for (int i = 0; i < STEPS; i++) {
              if (d >= srf) break;
              pd = d; ps = srf;
              d += layer;
              srf = min(reliefDepth(vWPos.xz + dir * d, wr, gx, gy, sc), waterD);
            }
            // where between the last two steps the ray met the ground
            float a = clamp((ps - pd) / max((ps - pd) - (srf - d), 1e-5), 0.0, 1.0);
            float dh = d > 0.0 ? mix(pd, d, a) : 0.0;
            pxz = vWPos.xz + dir * dh;
            cavity = dh / maxD;
          }
        }
        vec2 uvw = pxz / 4.0;
        vec4 cM = texture(tGround, vec3(uvw, 0.0));
        vec4 cG = texture(tGround, vec3(uvw * 0.93 + 0.37, 1.0));
        vec4 cF = texture(tGround, vec3(uvw * 0.87 + 0.61, 2.0));
        vec4 cC = texture(tGround, vec3(uvw * 1.6, 3.0));
        vec4 hts = vec4(cM.a, cG.a, cF.a, cC.a);
        vec4 w = max(vSplat, 0.0);
        vec4 hw = w + hts * 0.55 * step(0.002, w);
        float ma = max(max(hw.x, hw.y), max(hw.z, hw.w)) - 0.18;
        vec4 b = max(hw - ma, 0.0) * step(0.002, w);
        b /= max(dot(b, vec4(1.0)), 1e-4);
        vec3 alb = cM.rgb * b.x + cG.rgb * b.y + cF.rgb * b.z + cC.rgb * b.w;
        vec4 nM = texture(tGroundN, vec3(uvw, 0.0)), nG = texture(tGroundN, vec3(uvw * 0.93 + 0.37, 1.0));
        vec4 nF = texture(tGroundN, vec3(uvw * 0.87 + 0.61, 2.0)), nC = texture(tGroundN, vec3(uvw * 1.6, 3.0));
        vec4 nb = nM * b.x + nG * b.y + nF * b.z + nC * b.w;
        tNormal = nb.xyz * 2.0 - 1.0;
        tRough = nb.w;
        // Broad, irregular growth/soil patches break the repeating tile's
        // colour as well as its brightness. The land stays its own material:
        // dry sward tends towards straw, damp hollows towards deeper green;
        // stony cobbles keep their neutral colour and ordered courses.
        float macro = texture2D(tLandscape, pxz / 57.0).g;
        alb *= 0.78 + 0.44 * macro;
        vec3 growthTint = mix(vec3(1.10, 0.99, 0.75), vec3(0.85, 1.03, 0.88), smoothstep(0.30, 0.68, macro));
        alb *= mix(vec3(1.0), growthTint, b.y * 0.65);
        tRough = clamp(tRough + (macro - 0.5) * 0.12 * (b.x + b.y), 0.35, 1.0);
        // the forest floor: moss spreading in the damp, drifts of last year's leaves
        float drift = texture2D(tLandscape, pxz / 23.0).b;
        alb = mix(alb, alb * vec3(0.62, 0.95, 0.42) + vec3(0.004, 0.012, 0.002), b.z * smoothstep(0.56, 0.72, drift) * 0.7);
        alb = mix(alb, alb * vec3(1.25, 1.0, 0.72), b.z * smoothstep(0.42, 0.3, drift) * 0.6);
        // Rock on steep banks is projected from three axes. A top-down UV
        // alone stretched its grain into vertical streaks down trench walls.
        vec3 groundNormal = normalize(vWNormal);
        float slope = 1.0 - groundNormal.y;
        float rockW = smoothstep(0.42, 0.62, slope + (hts.x - 0.5) * 0.15);
        tRockNormal = groundNormal; tRockWeight = rockW;
        vec3 rockDx = dFdx(vWPos) / 3.0, rockDy = dFdy(vWPos) / 3.0;
        if (rockW > 0.001) {
          vec3 tri = pow(abs(groundNormal), vec3(4.0));
          tri /= max(dot(tri, vec3(1.0)), 1e-4);
          vec3 rockUV = vec3(pxz.x, vWPos.y, pxz.y) / 3.0;
          vec4 rx = textureGrad(tRock, rockUV.zy, rockDx.zy, rockDy.zy);
          vec4 ry = textureGrad(tRock, rockUV.xz, rockDx.xz, rockDy.xz);
          vec4 rz = textureGrad(tRock, rockUV.xy, rockDx.xy, rockDy.xy);
          float relief = dot(vec3(rx.a, ry.a, rz.a), tri);
          alb = mix(alb, uRockColor * (0.55 + 0.9 * relief), rockW);
          vec2 nx = rx.xy * 2.0 - 1.0, ny = ry.xy * 2.0 - 1.0, nz = rz.xy * 2.0 - 1.0;
          vec3 bump = vec3(0.0, nx.y, nx.x) * tri.x + vec3(ny.x, 0.0, ny.y) * tri.y + vec3(nz.x, nz.y, 0.0) * tri.z;
          bump -= groundNormal * dot(bump, groundNormal);
          tRockNormal = normalize(groundNormal + bump * 0.7);
        }
        tRough = mix(tRough, 0.85, rockW);
        // standing water: a slow noise says where it gathers, and there it
        // fills the ground up to a level — the joints between the cobbles and
        // the hollows of the mud first, then (deeper) over the stones too; the
        // road's joints hold a little everywhere. Not on grass or rock.
        // Rain drains off a slope. Keep its wet sheen, but only let water
        // stand on nearly level ground; hillside puddles must not tilt.
        float drainage = 1.0 - smoothstep(0.005, 0.06, slope);
        float hold = (b.x + b.w + b.z * 0.35) * (1.0 - rockW) * drainage;
        float gather = texture2D(tLandscape, vWPos.xz / 31.0).r;
        float level = smoothstep(0.45, 0.75, gather) * 1.2;
        float depthW = level - dot(b, hts);
        tPuddle = smoothstep(-0.02, 0.06, depthW);
        tPuddle = max(tPuddle, b.w * 0.55 * smoothstep(0.32, 0.12, hts.w));
        tPuddle *= hold * uWet;
        // the soaked margin round standing water
        tRim = smoothstep(-0.16, -0.02, depthW) * hold * uWet * (1.0 - tPuddle);
        // the river bank: soaked to a hand above the water
        tShore = 1.0 - smoothstep(0.0, 0.4, vWPos.y - uWaterLevel);
        // under the meadow grass the ground is the shaded sward: dark, rough, no standing water
        tSwardK = 0.0;
        if (uSwardR > 0.0) {
          tSwardK = texture2D(tSward, (vWPos.xz - uSwardMin) / uSwardSize).x
            * (1.0 - smoothstep(uSwardR * 0.6, uSwardR * 0.95, length(vWPos.xz - cameraPosition.xz)));
          tPuddle *= 1.0 - tSwardK;
          tRim *= 1.0 - tSwardK;
        }
        // the wheel ruts of the lanes: dark wet mud, water standing in them in stretches, a
        // grassy crown between them
        vec3 ruts = rutsAt(pxz, b.x * (1.0 - rockW));
        tPuddle = max(tPuddle, ruts.y * uWet * drainage);
        alb = mix(alb, cG.rgb * vec3(0.75, 0.8, 0.65), ruts.z * 0.5);
        alb *= 1.0 - 0.3 * ruts.x;
        // darken wet ground (the road's stones most: they soak, and shine);
        // under water the ground shows through a little darker
        alb *= mix(1.0, 0.62 - 0.12 * b.w, uWet * (1.0 - rockW * 0.3));
        alb = mix(alb, alb * vec3(0.78, 0.78, 0.82), tPuddle);
        alb *= 1.0 - 0.2 * tRim - 0.35 * tShore - 0.45 * tSwardK;
        // the bottom of the relief (the cobbles' joints, the ruts) gets less light
        alb *= 1.0 - 0.25 * cavity * (1.0 - tPuddle);
        diffuseColor.rgb *= alb;
      `)
      .replace('#include <roughnessmap_fragment>', `
        // wet ground shines; a field of wet grass much less (its blades break the sheen up)
        float roughnessFactor = mix(tRough, tRough * (0.62 - 0.2 * b.w) + 0.04, uWet * (1.0 - 0.65 * b.y));
        roughnessFactor = mix(roughnessFactor, 0.2, tRim * 0.6);
        roughnessFactor = mix(roughnessFactor, 0.12, tShore * 0.8);
        roughnessFactor = mix(roughnessFactor, 0.07, tPuddle);
        roughnessFactor = mix(roughnessFactor, 0.85, tSwardK);
      `)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 nts = tNormal;
          nts.xy *= (1.0 - tPuddle) * (1.0 - 0.5 * tShore);
          // rain rings in puddles
          if (tPuddle > 0.01) nts.xy += rainRipples(pxz * 1.7, uTime, rippleFade(length(vViewPosition))) * uRain * tPuddle * 0.9;
          mat3 tbn = cotangentFrame(normal, -vViewPosition, vWPos.xz);
          normal = normalize(tbn * normalize(nts));
          normal = normalize(mix(normal, normalize(mat3(viewMatrix) * tRockNormal), tRockWeight));
        }
        // specular anti-aliasing: where the shading normal turns within a pixel (the cobbles' relief
        // some way off), a sharp highlight would flicker from pixel to pixel and frame to frame;
        // widen the lobe by that spread instead (on GGX's alpha squared), so it reads as a sheen
        {
          vec3 ndx = dFdx(normal), ndy = dFdy(normal);
          float spread = 0.25 * (dot(ndx, ndx) + dot(ndy, ndy));
          float a = roughnessFactor * roughnessFactor;
          roughnessFactor = sqrt(sqrt(a * a + min(2.0 * spread * uSpecAA, 0.18)));
        }
      `)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        #ifdef OPAQUE
          gl_FragColor.a = mirrorAlpha(roughnessFactor, uWet);
        #endif`);
    addFireBounce(shader, 'vWPos', 'normalize(vWNormal)');
    // the trees' shade from a flare beyond its shadow map (canopy.js)
    addCanopy(shader, 'vWPos');
    dimFillSpecular(shader);
  };
  return mat;
}

/* Shared GLSL: a cotangent frame from screen derivatives, procedural rain
   ripples (rings expanding from random points in a cell grid), and the
   alpha an opaque wet surface writes for the reflections pass (ssr.js):
   0.25 for no reflection down to 0 for a mirror, from its wet roughness.
   Everything else writes 1, and transparent things drawn over (rain, mist,
   decals) only raise it, so a value under 0.25 means "reflect here". */
export const GLSL_HELPERS = /* glsl */ `
  float mirrorAlpha(float rough, float wet) {
    return 0.25 * (1.0 - wet * clamp((0.5 - rough) / 0.43, 0.0, 1.0));
  }
  mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
    vec3 dp1 = dFdx(p), dp2 = dFdy(p);
    vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
    return mat3(T * invmax, B * invmax, N);
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // the rings raindrops make on standing water: two layers of cells a quarter of a metre across (at
  // the callers' scales, 1.5 to 1.9 a metre), a drop landing in each at a place and time of its own and
  // its ring spreading some 0.3 m/s as it dies away; the slope, as a direction and strength. Each ring
  // is a few centimetres wide: beyond some 15 m smaller than a pixel, where it would only glitter, so
  // fade (from 1 near to 0 far) thins them out, and at 0 the work is skipped
  vec2 rainRipples(vec2 p, float t, float fade) {
    vec2 acc = vec2(0.0);
    if (fade < 0.01) return acc;
    p *= 2.4;
    for (int k = 0; k < 2; k++) {
      vec2 q = p + float(k) * vec2(0.37, 0.71);
      vec2 cell = floor(q);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float h = hash12(c + float(k) * 13.1);
        vec2 centre = c + vec2(hash12(c + 3.7), hash12(c + 9.1));
        float phase = fract(t * 1.3 + h);
        vec2 d = q - centre;
        float r = length(d);
        float ring = r - phase * 0.9;
        float wave = sin(ring * 40.0) * exp(-ring * ring * 160.0) * (1.0 - phase) * (1.0 - phase);
        acc += d / max(r, 1e-3) * wave;
      }
    }
    return acc * 0.5 * fade;
  }
  // how much of the rain's rings to draw at a view distance
  float rippleFade(float dist) { return 1.0 - smoothstep(8.0, 16.0, dist); }
`;
