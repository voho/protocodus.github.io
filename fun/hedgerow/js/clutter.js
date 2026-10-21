/* Hedgerow — the litter at your feet: stones and twigs, on the GPU.

   Like the grass (grass.js), each kind is one instanced draw over a grid of
   world cells snapped round the camera, everything about a piece — where in
   its cell, how big, which way it lies, its shade — from a hash of its cell,
   and where it lies from the ground map (groundmap.js): stones in the mud of
   the lanes, the yards and the street's muddy edges (a few in the forest),
   twigs on the forest floor; none on the road, under the water, on steep
   banks or inside anything solid. Each piece lies along the slope of the
   ground (from the map's heights), stones sunk to a third of their height,
   twigs resting on the ground. Stones are a low icosphere pushed about by
   noise and flattened, from grit to the odd fist-sized one, wet and glossy;
   twigs a bent six-sided stick. Pieces shrink away towards the edge of the
   patch. */

import * as THREE from 'three';
import { rng } from './util.js';
import { GROUND_GLSL } from './groundmap.js';
import { dimFillSpecular } from './fill.js';

/* a stone: a once-subdivided icosahedron, its points pushed in and out, flattened */
function stoneGeometry(seed = 3) {
  const R = rng(seed);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((v) => { const l = Math.hypot(...v); return v.map((c) => c / l); });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = new Map();
  const midpoint = (a, b) => {
    const key = a < b ? a + ',' + b : b + ',' + a;
    if (mid.has(key)) return mid.get(key);
    const v = verts[a].map((c, i) => c + verts[b][i]);
    const l = Math.hypot(...v);
    verts.push(v.map((c) => c / l));
    mid.set(key, verts.length - 1);
    return verts.length - 1;
  };
  faces = faces.flatMap(([a, b, c]) => { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  // lumpy, and flatter than tall (a stone lies on its broad side)
  verts = verts.map(([x, y, z]) => { const k = 0.78 + R() * 0.38; return [x * k, y * k * 0.62, z * k]; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
  geo.setIndex(faces.flat());
  geo.computeVertexNormals();
  return geo;
}

/* a twig: a six-sided stick along x (-0.5..0.5), radius 1, thinning to the tip,
   with a kink in the middle (the bend attribute: sideways, in lengths, so it scales with the length) */
function twigGeometry() {
  const pos = [], bends = [], idx = [];
  const rings = [[-0.5, 0, 1], [0.05, 0.08, 0.85], [0.5, 0, 0.55]];      // x, bend, radius
  for (const [x, bend, r] of rings) for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    pos.push(x, Math.sin(a) * r, Math.cos(a) * r);
    bends.push(bend);
  }
  for (let ri = 0; ri < rings.length - 1; ri++) for (let k = 0; k < 6; k++) {
    const a = ri * 6 + k, b = ri * 6 + (k + 1) % 6, c = a + 6, d = b + 6;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('bend', new THREE.Float32BufferAttribute(bends, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const KINDS = {
  // channel of the ground map, cell (m), patch radius (m), how many cells hold one at full cover
  stone: { channel: 'y', spacing: 0.3, radius: 9, density: 0.5, seed: 11.0 },
  twig: { channel: 'z', spacing: 0.4, radius: 9, density: 0.75, seed: 37.0 },
};

function createKind(kind, geometry, map, shared) {
  const K = KINDS[kind];
  const n = Math.ceil((K.radius * 2) / K.spacing);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = geometry.index;
  geo.setAttribute('position', geometry.attributes.position);
  geo.setAttribute('normal', geometry.attributes.normal);
  if (geometry.attributes.bend) geo.setAttribute('bend', geometry.attributes.bend);
  // three draws no more instances than its instanced attributes hold: a dummy one
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(n * n), 1));
  geo.instanceCount = n * n;
  const uniforms = {
    ...map.uniforms, tGround: { value: map.tex }, uMapSize: { value: map.size },
    uOrigin: { value: new THREE.Vector2() }, uN: { value: n }, uSpacing: { value: K.spacing },
    uRadius: { value: K.radius }, uDensity: { value: K.density }, uWet: shared.wet,
  };
  const stone = kind === 'stone';
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: stone ? 0.75 : 0.85, metalness: 0 });
  mat.name = 'clutter_' + kind;
  mat.customProgramCacheKey = () => 'hedgerow-clutter-' + kind;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGround;
        uniform vec2 uMapSize, uOrigin;
        ${GROUND_GLSL}
        uniform float uN, uSpacing, uRadius, uDensity;
        ${stone ? '' : 'attribute float bend;'}
        varying vec3 vTint;
        vec3 piecePos;
        vec4 hash4(vec2 c) {
          uvec4 v = uvec4(uvec2(ivec2(floor(c)) + 65536), 7u, 13u);
          v = v * 1664525u + 1013904223u;
          v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
          v ^= v >> 16u;
          v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
          return vec4(v) * (1.0 / 4294967295.0);
        }
        vec4 cover(vec2 xz) { return texture2D(tGround, (xz - uMapMin) / uMapSize); }
        // smooth noise over a coarse grid: where things gather and where they don't
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash4(i).x, hash4(i + vec2(1.0, 0.0)).x, f.x), mix(hash4(i + vec2(0.0, 1.0)).x, hash4(i + vec2(1.0, 1.0)).x, f.x), f.y);
        }`)
      .replace('#include <beginnormal_vertex>', `
        // this piece's cell and everything the hash of it says
        float id = float(gl_InstanceID);
        vec2 cell = uOrigin + vec2(mod(id, uN), floor(id / uN));
        vec4 h = hash4(cell + ${K.seed.toFixed(1)});
        vec4 h2 = hash4(cell + vec2(${K.seed.toFixed(1)}, 991.0));
        vec2 xz = (cell + 0.5 + (h.xy - 0.5) * 0.9) * uSpacing;
        float gy = groundY(xz);
        float dist = length(xz - cameraPosition.xz);
        // some everywhere, more where they gather
        float gathered = 0.35 + 1.3 * smoothstep(0.3, 0.85, vnoise(xz / 1.7 + ${K.seed.toFixed(1)}));
        float here = step(h.z, cover(xz).${K.channel} * uDensity * gathered) * (1.0 - smoothstep(uRadius * 0.7, uRadius, dist));
        // the slope it lies on
        float hx = groundY(xz + vec2(0.4, 0.0)) - groundY(xz - vec2(0.4, 0.0));
        float hz = groundY(xz + vec2(0.0, 0.4)) - groundY(xz - vec2(0.0, 0.4));
        vec3 up = normalize(vec3(-hx, 0.8, -hz));
        float yaw = h.w * 6.2831853;
        // a right-handed frame on the slope (a mirrored one would turn the faces inside out)
        vec3 fw0 = vec3(cos(yaw), 0.0, sin(yaw));
        vec3 rt = normalize(cross(fw0, up));
        vec3 fw = cross(up, rt);
        mat3 basis = mat3(fw, up, rt);
        ${stone ? `
        // from grit to the odd fist-sized stone, each its own proportions, a third sunk
        // (the stone is 1.24 high in its own units: lifted 0.2, a third of it stays below)
        float s = mix(0.016, 0.085, h2.x * h2.x * h2.x) * here;
        vec3 sc = vec3(1.0, mix(0.7, 1.15, h2.y), mix(0.65, 1.0, h2.z)) * s;
        vec3 lp = position * sc;
        lp.y += 0.2 * sc.y;
        vec3 objectNormal = normalize(basis * (normal / max(sc, vec3(1e-5))));
        vTint = vec3(h2.w, h2.y, step(0.82, h2.z));` : `
        // a stick 20-60 cm long, up to a thumb thick, resting on the ground
        float len = mix(0.2, 0.6, h2.x) * here;
        float rad = mix(0.006, 0.015, h2.y * h2.y) * here;
        vec3 sc = vec3(len, rad, rad * 1.5);
        vec3 lp = position * sc;
        lp.z += bend * len * (h2.z > 0.5 ? 1.0 : -1.0);
        lp.y += rad * 0.7;
        vec3 objectNormal = normalize(basis * (normal / max(sc, vec3(1e-5))));
        vTint = vec3(h2.w, h2.z, 0.0);`}
        piecePos = vec3(xz.x, gy, xz.y) + basis * lp;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = piecePos;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWet;
        varying vec3 vTint;`)
      .replace('#include <color_fragment>', stone ? `
        // field stones coated in the mud they lie in: brown-grey, now and then a paler flint; wet: darker
        vec3 col = mix(vec3(0.085, 0.075, 0.062), vec3(0.16, 0.14, 0.115), vTint.x);
        col = mix(col, vec3(0.26, 0.24, 0.21), vTint.z * 0.6);
        diffuseColor.rgb = col * mix(1.0, 0.7, uWet);` : `
        // dead wood: grey-brown bark, a little paler than the litter it lies on, some darker and rotting
        vec3 col = mix(vec3(0.11, 0.085, 0.06), vec3(0.22, 0.18, 0.13), vTint.x);
        diffuseColor.rgb = col * mix(0.7, 1.0, vTint.y) * mix(1.0, 0.8, uWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, ${stone ? '0.38' : '0.72'}, uWet);`);
    dimFillSpecular(shader);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'clutter_' + kind;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    update(camera) {
      uniforms.uOrigin.value.set(Math.floor(camera.position.x / K.spacing) - n / 2, Math.floor(camera.position.z / K.spacing) - n / 2);
    },
  };
}

export function createClutter({ map, shared, on = 1 }) {
  const group = new THREE.Group();
  group.name = 'clutter';
  const kinds = [createKind('stone', stoneGeometry(), map, shared), createKind('twig', twigGeometry(), map, shared)];
  for (const k of kinds) group.add(k.mesh);
  group.visible = !!on;
  return {
    group,
    update(camera) { if (group.visible) for (const k of kinds) k.update(camera); },
    setOn(v) { group.visible = !!v; },
  };
}
