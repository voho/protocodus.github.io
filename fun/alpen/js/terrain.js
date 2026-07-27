/* The mountain.

   There is no terrain data. `heightAt` is a pure function of a coordinate —
   a constant grade, four octaves of value noise, and a pair of walls that
   curve up outside a corridor whose centre line wanders — and everything
   else in the game reads the hill through it: the rider stands on it, ramps
   are built on top of it, trees are planted on it, and the mesh below is
   only ever a picture of it.

   The wander is the difference between a run and a chute. Two long sines
   move the piste about seven metres sideways for every hundred it descends,
   which is slight enough that the rider is never fighting it and strong
   enough that the mountain always looks like it is going somewhere. Props
   are placed against the same centre line, so the forest bends with the
   route rather than ignoring it.

   The mesh is a single graded grid, re-anchored to the rider in whole cells
   and refilled from `heightAt`. Snapping to whole cells is what keeps the
   facets welded to the ground instead of crawling across it; grading the
   cells is what lets four thousand vertices cover three quarters of a
   kilometre. */

import { snoise2, noise2 } from './noise.js';
import { TERRAIN } from './config.js';

const { grade, wander, corridorHalf, bankWidth, bankHeight,
  ridges, rolls, moguls, chatter } = TERRAIN;

/* Where the middle of the piste is, at a given point down the mountain. */
export function pisteCenter(z) {
  let x = 0;
  for (let i = 0; i < wander.length; i++) x += Math.sin(z * wander[i].freq) * wander[i].amp;
  return x;
}

/* Height of the bare hill at a point. Forward is -Z, so z falls as the run
   goes on and so does the ground under it. */
export function heightAt(x, z) {
  let h = z * grade;
  h += snoise2(x * ridges.freq, z * ridges.freq, ridges.seed) * ridges.amp;
  h += snoise2(x * rolls.freq, z * rolls.freq, rolls.seed) * rolls.amp;
  h += snoise2(x * moguls.freq, z * moguls.freq, moguls.seed) * moguls.amp;
  h += snoise2(x * chatter.freq, z * chatter.freq, chatter.seed) * chatter.amp;

  // Outside the corridor the ground rises into a ridge and falls away on
  // the far side. Quadratic near the piste, peaking exactly at bankWidth,
  // and back to the bare hill well before the mesh runs out.
  const over = Math.abs(x - pisteCenter(z)) - corridorHalf;
  if (over > 0) {
    const w2 = (over * over) / (bankWidth * bankWidth);
    h += bankHeight * w2 * Math.exp(1 - w2);
  }
  return h;
}

/* Surface normal by central difference. `fn` is passed in so the rider can
   ask about the hill *plus* whatever kickers are sitting on it, while the
   mesh asks about the bare hill. */
const EPS = 0.35;

export function normalFrom(fn, x, z, out) {
  const dx = (fn(x + EPS, z) - fn(x - EPS, z)) / (2 * EPS);
  const dz = (fn(x, z + EPS) - fn(x, z - EPS)) / (2 * EPS);
  return out.set(-dx, 1, -dz).normalize();
}

/* ==========================================================================
   The grid
   ========================================================================== */

const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/* Offsets that start at `step` and grow by `growth` each one, until they
   have covered `reach`. Returns the list of positions, not the steps. */
function graded(step, growth, reach) {
  const out = [0];
  let d = 0;
  let s = step;
  while (d < reach) {
    d += s;
    s *= growth;
    out.push(d);
  }
  return out;
}

export function createTerrain(THREE) {
  const { spacing, back, ahead, aheadGrowth, side, sideGrowth } = TERRAIN;

  // Columns: mirrored about the rider. Rows: a few uniform cells behind,
  // then the graded fan out in front.
  const half = graded(spacing, sideGrowth, side);
  const xs = [];
  for (let i = half.length - 1; i >= 1; i--) xs.push(-half[i]);
  for (let i = 0; i < half.length; i++) xs.push(half[i]);

  const zs = [];
  for (let d = back; d > 0; d -= spacing) zs.push(d);
  const fwd = graded(spacing, aheadGrowth, ahead);
  for (let i = 0; i < fwd.length; i++) zs.push(-fwd[i]);

  const vertsX = xs.length;
  const vertsZ = zs.length;
  const cols = vertsX - 1;
  const rows = vertsZ - 1;
  const count = vertsX * vertsZ;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const heights = new Float64Array(count);
  const indices = new (count > 65535 ? Uint32Array : Uint16Array)(rows * cols * 6);

  // The topology never changes, only the heights the vertices sit at
  let t = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Columns run left to right and rows run from behind the rider to in
      // front of them, so this is the winding that faces up
      const a = r * vertsX + c;
      indices[t++] = a; indices[t++] = a + 1; indices[t++] = a + vertsX;
      indices[t++] = a + 1; indices[t++] = a + vertsX + 1; indices[t++] = a + vertsX;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), ahead);

  /* Surface detail, in the fragment shader rather than in the mesh.

     A snowfield at two-metre cells is geometrically smooth and visually
     blank, and a blank ground is the one thing that will not sell speed: the
     eye reads velocity from texture passing underneath, and there was none.
     It cannot come from the grid — corduroy is a metre and a half apart and
     the vertices are two, so anything fine enough to work aliases before it
     is drawn.

     So it is painted per pixel, from world coordinates, which means it is
     welded to the ground and rushes at the rider at exactly the speed the
     rider is doing. Three layers: the groomer's ribs running across the fall
     line, broad wind packing along it, and a hash of grain to break up the
     flats. All three fade out by ninety metres, well before their period
     falls under a pixel and starts to crawl. */
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying float vDist;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDist = -mvPosition.z;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying float vDist;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float detail = 1.0 - smoothstep(45.0, 125.0, vDist);
        if (detail > 0.002) {
          float rib = sin(vWorld.z * 4.1);
          float pack = sin(vWorld.x * 0.55 + vWorld.z * 0.07);
          float grain = fract(sin(dot(floor(vWorld.xz * 2.3), vec2(12.9898, 78.233))) * 43758.545);
          float d = rib * 0.105 + pack * 0.035 + (grain - 0.5) * 0.07;
          diffuseColor.rgb *= 1.0 + d * detail;
        }`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  // Snow is two colours and a rock, mixed per vertex. Lighting is the
  // material's job; these carry material variation only — wind-packed
  // patches, the shade that collects in a hollow, and the stone that shows
  // through wherever the hill gets too steep to hold snow.
  // Snow is very nearly white and the shade in it is very nearly white too;
  // the difference between them is small on purpose, because the lighting
  // has to be what shapes the hill. Push these apart and the terrain starts
  // looking painted rather than lit.
  const snowLit = new THREE.Color('#fbfdff');
  const snowDim = new THREE.Color('#c2d3ea');
  const rock = new THREE.Color('#5a6170');
  const rockLit = new THREE.Color('#8b93a3');
  const cur = new THREE.Color();
  const stone = new THREE.Color();

  let anchorX = NaN;
  let anchorZ = NaN;

  function fill(ax, az, ay) {
    // Pass one: heights. One `heightAt` per vertex and no more — the colour
    // pass needs slopes, and taking them from neighbours already sampled is
    // five times cheaper than asking the hill again.
    let i = 0;
    for (let r = 0; r < vertsZ; r++) {
      const wz = az + zs[r];
      for (let c = 0; c < vertsX; c++) heights[i++] = heightAt(ax + xs[c], wz);
    }

    // Pass two: positions and colours
    i = 0;
    let p = 0;
    for (let r = 0; r < vertsZ; r++) {
      const lz = zs[r];
      const wz = az + lz;
      const centre = pisteCenter(wz);
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(vertsZ - 1, r + 1);
      const dz2 = zs[rNext] - zs[rPrev] || 1;

      for (let c = 0; c < vertsX; c++, i++, p += 3) {
        const lx = xs[c];
        const wx = ax + lx;
        const h = heights[i];

        positions[p] = lx;
        positions[p + 1] = h - ay;
        positions[p + 2] = lz;

        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(vertsX - 1, c + 1);
        const dx2 = xs[cNext] - xs[cPrev] || 1;
        const dx = (heights[r * vertsX + cNext] - heights[r * vertsX + cPrev]) / dx2;
        const dz = (heights[rNext * vertsX + c] - heights[rPrev * vertsX + c]) / dz2;
        // Steepness measured against the grade, not against flat: the whole
        // hill is tilted, and a piste is not a cliff just for being a piste
        const steep = Math.hypot(dx, dz + grade);

        cur.copy(snowLit);
        // Hollows hold shade. The mogul octave already knows where they are.
        const hollow = smoothstep(0.5, -0.2, snoise2(wx * moguls.freq, wz * moguls.freq, moguls.seed));
        cur.lerp(snowDim, hollow * 0.5);
        // Wind-packed patches, big and faint
        cur.lerp(snowDim, noise2(wx * 0.02, wz * 0.02, 7) * 0.2);

        if (Math.abs(wx - centre) < corridorHalf + 3) {
          // Corduroy: the groomer's lines, and the only fine detail the eye
          // can use to read speed across an otherwise featureless white field
          cur.lerp(snowDim, (Math.sin(wx * 1.9) * 0.5 + 0.5) * 0.1);
          // and the piste is groomed, so it is brighter than what flanks it
          cur.lerp(snowLit, 0.25);
        }

        const bare = smoothstep(0.5, 1.0, steep);
        if (bare > 0) {
          // Rock catches the sun along its ridges and holds none of it in
          // the clefts, which is most of what makes a cliff read as rock
          stone.copy(rock).lerp(rockLit, noise2(wx * 0.4, wz * 0.4, 11));
          cur.lerp(stone, bare);
        }

        colors[p] = cur.r;
        colors[p + 1] = cur.g;
        colors[p + 2] = cur.b;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  /* Re-anchor if the rider has crossed into a new cell. The mesh is placed
     at the anchor and its vertices stored relative to it, which keeps every
     coordinate the GPU sees inside a kilometre however far down the mountain
     the run has gone. */
  function update(x, z) {
    const ax = Math.round(x / spacing) * spacing;
    const az = Math.round(z / spacing) * spacing;
    if (ax === anchorX && az === anchorZ) return;
    anchorX = ax;
    anchorZ = az;
    const ay = heightAt(ax, az);
    mesh.position.set(ax, ay, az);
    fill(ax, az, ay);
  }

  return { mesh, update, vertexCount: count };
}
