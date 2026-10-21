/* Hedgerow — meadow grass: tufts of blades by the tens of thousands, on the GPU.

   One instanced draw of grass tufts round the camera, one per cell of a
   grid of world cells (snapped, so a tuft keeps its place as the patch
   follows the camera); each tuft is five thin blades fanning out of one
   root. Everything about a tuft and its blades — where in the cell, how
   tall, which way each faces and leans, its shade, now and then a dead
   straw-coloured stalk — comes from a hash of its cell; the ground under
   it (height, and how grassy it is) from the ground map (groundmap.js):
   the grass weight of the splat (a little in the forest), none on roads and
   mud, on steep banks, at the water or inside anything solid (houses, walls,
   sandbags). The wind leans every blade and sends gusts across the field in
   waves; light shines through the blades (a meadow between you and a flare
   or a fire glows at its tips); the player parts the grass round his legs,
   and a blast's shockwave
   (effects.js `shocks`) flattens it outward as it races through, the grass
   still bowed behind it for a moment. Far tufts thin out (the
   ones left grow fuller, no blade thinner than about a pixel) and the patch
   fades away at its edge, where the scattered tufts and the ground's own
   texture take over. */

import * as THREE from 'three';
import { FOLIAGE_UNIFORMS } from './materials.js';
import { dimFillSpecular } from './fill.js';

const SEGS = 3, TUFT = 5;
export function createGrass({ map, shared, n = 192, max = 192, spacing = 0.22, shocks = null }) {
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
    // the last blasts' shockwaves: x, z, how far the front has gone, its strength (0: none)
    uShock: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  mat.name = 'grass';
  mat.customProgramCacheKey = () => 'hedgerow-grass';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, FOLIAGE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGround;
        uniform vec2 uMapMin, uMapSize, uOrigin, uWind;
        uniform float uN, uSpacing, uRadius, uTime, uPixel;
        uniform vec3 uPlayer;
        uniform vec4 uShock[3];
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
        // how grassy, and the ground's height (the mesh's, to a centimetre), in one fetch
        vec4 gd = texture2D(tGround, (root - uMapMin) / uMapSize);
        float grassy = gd.x, gy = gd.w;
        float dist = length(root - cameraPosition.xz);
        // far tufts thin out (the rest grow fuller), the patch fades at its edge
        float keep = mix(1.0, 0.35, smoothstep(6.0, uRadius, dist));
        float here = step(h.z, grassy * keep);
        // a tuft with no grass, or out of view (behind the camera, off to a side, above
        // or below the frame, with a margin for its lean), is a point: none of the rest is worked out
        vec3 rv = (viewMatrix * vec4(root.x, gy + 0.4, root.y, 1.0)).xyz;
        float front = max(-rv.z, 0.0);
        bool seen = here > 0.5 && -rv.z > -1.2
          && abs(projectionMatrix[0][0] * rv.x) - projectionMatrix[0][0] * 1.2 <= front
          && abs(projectionMatrix[1][1] * rv.y) - projectionMatrix[1][1] * 1.2 <= front;
        vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        bladePos = vec3(root.x, gy - 1.0, root.y);
        vT = 0.0;
        vShade = vec3(0.0);
        if (seen) {
          float tuftH = mix(0.3, 0.78, h.w * sqrt(h.w)) * (0.55 + 0.45 * grassy) * here * (1.0 - smoothstep(uRadius * 0.6, uRadius * 0.95, dist));
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
          lean += away / max(pd, 0.01) * (1.0 - smoothstep(0.15, 0.8, pd)) * step(abs(uPlayer.y - gy), 1.5) * 1.6;
          // flattened outward by a blast's shockwave as its front races through, still bowed behind it
          for (int i = 0; i < 3; i++) {
            vec4 sk = uShock[i];
            if (sk.w <= 0.0) continue;
            vec2 sd = xz - sk.xy;
            float sl = length(sd);
            float push = (1.0 - smoothstep(0.0, 2.2, abs(sl - sk.z))) * 3.2 + (1.0 - smoothstep(0.0, sk.z + 0.01, sl)) * 0.9;
            lean += sd / max(sl, 0.05) * push * sk.w * (1.0 - smoothstep(6.0, 15.0, sl));
          }
          // bent along an arc (the lean sets how far over the tip is), keeping its length
          float lm = length(lean);
          vec2 ld = lean / max(lm, 1e-4);
          float th = min(lm * 0.85, 1.35);
          float arc = th * t;
          float bx = th > 1e-3 ? (1.0 - cos(arc)) / th : 0.0;
          float by = th > 1e-3 ? sin(arc) / th : t;
          bladePos = vec3(xz.x, gy, xz.y);
          bladePos.xz += perp * position.x * w + ld * bx * hgt;
          bladePos.y += by * hgt;
          // across the blade, rounded towards the sky (lit like the sward, not like planks)
          objectNormal = normalize(vec3(dir.x, 0.0, dir.y) * 0.3 + vec3(perp.x, 0.0, perp.y) * position.x * 0.25 + vec3(0.0, 1.0, 0.0));
          vT = t;
          vShade = vec3(h.w, b.z, step(0.9, b.y));
        }
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
        roughnessFactor = mix(roughnessFactor, 0.55, uWet);`)
      // every light also shines through the blades, as through the leaves (materials.js): most where
      // the eye looks towards it through the grass, more at the thin tips than at the shaded roots
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        uniform float uLeafTrans;
        float bladeThin = 1.0;
        void RE_Direct_Blade(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
            const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          float through = pow(saturate(dot(-geometryViewDir, directLight.direction)), 6.0) * 1.6;
          reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseColor) * through * bladeThin * uLeafTrans;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Blade`)
      .replace('#include <lights_fragment_begin>', `
        bladeThin = smoothstep(0.15, 0.9, vT) * (1.0 - vShade.z * 0.6);
        #include <lights_fragment_begin>`)
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    dimFillSpecular(shader);
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
      const sv = uniforms.uShock.value;
      for (let i = 0; i < 3; i++) {
        const s = shocks?.[i];
        if (s) sv[i].set(s.x, s.z, s.radius, s.strength); else sv[i].set(0, 0, 0, 0);
      }
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
