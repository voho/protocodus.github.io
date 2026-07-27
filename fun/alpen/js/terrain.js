/* The mountain.

   There is no terrain data. `heightAt` is a pure function of a coordinate and
   everything else in the game reads the hill through it: the rider stands on
   it, ramps are built on top of it, trees are planted on it, and the mesh
   below is only ever a picture of it.

   Four things have changed about what that function says, and they are the
   whole of the mountain's character.

   The pitch is no longer constant. It is two long sines over a base, and the
   height is their analytic integral — which matters more than it sounds,
   because the alternative is marching down the hill from the summit every
   time anything asks how high the ground is, five times per physics step. So
   the run has chapters: pitches that stand up and ask for a real carve, and
   runouts that hand the speed back slowly.

   The route forks. Every few hundred metres the single centre line has a
   chance of splitting in two, drifting apart around an island and closing
   again below. The corridor is measured to whichever branch is nearer, so
   the geometry does the rest by itself: the piste widens, an island of hill
   rises out of the middle of it, two lines run either side, and they rejoin.

   The corridor is roughly three times wider than it was, and it breathes —
   gullies where it draws in, bowls where it opens out.

   And you cannot leave it. Outside the groomed part the ground rises into a
   quarterpipe with a real lip you can launch off, and past that into a wall
   that climbs towards a hundred and thirty metres and then keeps creeping up
   forever. Crossing it would take 75 m/s of kinetic energy and the game
   tops out at 50. There is no barrier and no invisible wall — the ground
   outside the run is simply, monotonically, uphill everywhere, so gravity is
   always pointing home. That is the whole containment mechanism.

   The mesh is a single graded grid, re-anchored to the rider in whole cells
   and refilled from `heightAt`. Snapping to whole cells is what keeps the
   facets welded to the ground instead of crawling across it; grading the
   cells is what lets six thousand vertices cover most of a kilometre. */

import { snoise2, noise2, hash2 } from './noise.js';
import { TERRAIN } from './config.js';

const { wander, route, corridor, wall, cliffs, knolls,
  ridges, rolls, moguls, chatter, warp, bulgeVary } = TERRAIN;
const GRADE = TERRAIN.grade;

const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const smooth01 = (u) => u * u * (3 - 2 * u);

const CLIFF_SPAN = cliffs.fall + cliffs.runout;

/* ==========================================================================
   The route
   ========================================================================== */

/* The mid-line: where the run would be if it never split. */
function wanderAt(z) {
  let x = 0;
  for (let i = 0; i < wander.length; i++) x += Math.sin(z * wander[i].freq) * wander[i].amp;
  return x;
}

/* Half the separation between the two branches, and zero wherever the run is
   whole. A fork gets one window per `period` metres of hill, takes it about
   two thirds of the time, and opens and closes over the first and last third
   of the window it occupies — so from inside, a fork is a piste that widens,
   grows an island, and closes again. */
function forkSplit(z) {
  const b = Math.floor(-z / route.period);
  if (b < 0) return 0;
  if (hash2(b, 7717, 41) > route.chance) return 0;
  const top = -(b * route.period) - (route.period - route.span) * hash2(b, 991, 42);
  const t = (top - z) / route.span;
  if (t <= 0 || t >= 1) return 0;
  const edge = 0.32;
  const k = t < edge ? t / edge : t > 1 - edge ? (1 - t) / edge : 1;
  return route.split * smooth01(k);
}

/* The groomed half-width, which breathes on a long sine. */
export function corridorHalfAt(z) {
  return corridor.half + corridor.vary * Math.sin(z * corridor.freq);
}

/* Where the middle of the piste is. When the run has forked there are two of
   them, and this is the line between — which is the island, not the piste.
   Anything placing itself on rideable ground wants `nearestCenter`. */
export function pisteCenter(z) {
  return wanderAt(z);
}

export function centersAt(z, out = []) {
  const mid = wanderAt(z);
  const s = forkSplit(z);
  out[0] = mid - s;
  out[1] = mid + s;
  return out;
}

export function nearestCenter(x, z) {
  const mid = wanderAt(z);
  const s = forkSplit(z);
  if (s <= 0) return mid;
  return Math.abs(x - (mid - s)) < Math.abs(x - (mid + s)) ? mid - s : mid + s;
}

/* ==========================================================================
   The height, as a row and a point on it

   Almost everything the hill knows depends only on z: the grade's integral,
   the route, the corridor's width, the shape of the wall, how lumpy this
   stretch is, and which drops reach it. The mesh fills a row at a time, so
   all of that is computed once per row and only the genuinely x-dependent
   part — six noise lookups and some arithmetic — runs per vertex. It is
   about four times cheaper than asking `heightAt` for every one, and because
   `heightAt` is itself written in terms of these two functions there is
   exactly one definition of the mountain and no chance of the mesh and the
   physics disagreeing about where the ground is.
   ========================================================================== */

function makeContext() {
  return {
    z: NaN,
    base: 0,
    mid: 0,
    split: 0,
    half: 0,
    lump: 1,
    lipW: 1,
    lipH: 0,
    nCliffs: 0,
    cliffX: [0, 0],
    cliffA: [0, 0],
    nKnolls: 0,
    kx: [0, 0, 0, 0],
    krx: [0, 0, 0, 0],
    kdz: [0, 0, 0, 0],   // the along-axis distance, already leaned and scaled
    kh: [0, 0, 0, 0],
  };
}

function rowContext(z, ctx) {
  if (ctx.z === z) return ctx;
  ctx.z = z;

  // The grade, integrated. d/dz of this is base + Σ amp·sin(freq·z + phase),
  // which is the pitch the rider actually feels underneath them.
  let base = GRADE.base * z;
  for (let i = 0; i < GRADE.waves.length; i++) {
    const w = GRADE.waves[i];
    base -= (w.amp / w.freq) * (Math.cos(w.freq * z + w.phase) - Math.cos(w.phase));
  }
  ctx.base = base;

  ctx.mid = wanderAt(z);
  ctx.split = forkSplit(z);
  ctx.half = corridorHalfAt(z);
  /* Which of the two branches is the high one, and by how much. Hashed off
     the fork's own block so a given crossroads always leans the same way,
     and faded in with the split so the offset arrives as the branches part
     and is gone again by the time they rejoin — otherwise the run would step
     vertically at the moment the fork opened. */
  ctx.tilt = 0;
  if (ctx.split > 0) {
    const b = Math.floor(-z / route.period);
    const side = hash2(b, 2287, 43) < 0.5 ? -1 : 1;
    ctx.tilt = side * route.drop * (ctx.split / route.split);
  }
  ctx.lump = bulgeVary.floor
    + (1 - bulgeVary.floor) * noise2(z * bulgeVary.freq, 0.5, bulgeVary.seed);

  // Some stretches get a wall worth aiming at and some get a mellow bank
  const v = 1 + wall.lipVary * snoise2(z * wall.lipFreq, 0, 23);
  ctx.lipW = wall.lipWidth * v;
  ctx.lipH = wall.lipHeight * v;

  /* Any drop whose face or runout reaches this far down the hill. A drop
     spans about seventy metres against a period of two hundred and sixty, so
     only this block and the one above it can ever be in range. */
  ctx.nCliffs = 0;
  const b0 = Math.floor(-z / cliffs.period);
  for (let k = 0; k <= 1; k++) {
    const b = b0 - k;
    if (b < 1) continue;   // the first stretch of the run is left alone
    if (hash2(b, 5501, 61) > cliffs.chance) continue;
    // Placed anywhere in its block that leaves room for the whole feature —
    // the face and its runout — to finish before the next block starts
    const lip = -(b * cliffs.period) - (cliffs.period - CLIFF_SPAN) * hash2(b, 173, 62);
    const t = lip - z;
    if (t <= 0 || t >= CLIFF_SPAN) continue;

    const drop = cliffs.drop[0] + (cliffs.drop[1] - cliffs.drop[0]) * hash2(b, 907, 63);
    const amount = drop
      * smoothstep(0, cliffs.fall, t)
      * (1 - smoothstep(cliffs.fall, CLIFF_SPAN, t));
    if (amount < 0.01) continue;

    // Placed against a branch of the route at the lip, never against x = 0 —
    // the route wanders thirty metres and a drop pinned to the world would
    // spend most of its life in the trees
    const lipMid = wanderAt(lip);
    const lipSplit = forkSplit(lip);
    const side = hash2(b, 311, 64) < 0.5 ? -1 : 1;
    const branch = lipSplit > 0 ? lipMid + side * lipSplit : lipMid;
    const spread = (hash2(b, 613, 65) * 2 - 1) * corridorHalfAt(lip) * 0.55;

    ctx.cliffX[ctx.nCliffs] = branch + spread;
    ctx.cliffA[ctx.nCliffs] = amount;
    ctx.nCliffs += 1;
  }

  /* Knolls in range. Their blocks are short and their radii can be three
     times the block length, so several overlap at any point — which is the
     intention: two knolls that run into each other make a shape neither of
     them had on its own, and the hill stops looking like it was stamped. */
  ctx.nKnolls = 0;
  const k0 = Math.floor(-z / knolls.period);
  for (let k = -3; k <= 3 && ctx.nKnolls < 4; k++) {
    const b = k0 + k;
    if (b < 2) continue;
    if (hash2(b, 4021, 81) > knolls.chance) continue;

    const cz = -(b * knolls.period) - knolls.period * hash2(b, 77, 82);
    const rz = knolls.radius[0] + (knolls.radius[1] - knolls.radius[0]) * hash2(b, 149, 83);
    const lee = knolls.lee[0] + (knolls.lee[1] - knolls.lee[0]) * hash2(b, 233, 84);

    // Downhill of the crest is z < cz, and that half is squashed so it falls
    // away far faster than it rose — which is what turns a bump into a lip
    let dz = (z - cz) / rz;
    if (dz < 0) dz /= lee;
    if (dz <= -1 || dz >= 1) continue;

    // Height comes out of the radius, never on its own — see the note on
    // `rise` in the config. A knoll's job is curvature, not altitude.
    const rise = knolls.rise[0] + (knolls.rise[1] - knolls.rise[0]) * hash2(b, 331, 85);
    const height = rise * rz;
    const rx = rz * (1 + (hash2(b, 419, 86) * 2 - 1) * knolls.eccentric);
    const half = corridorHalfAt(cz);
    const mid = wanderAt(cz);
    const sp = forkSplit(cz);
    const branch = sp > 0 ? mid + (hash2(b, 503, 87) < 0.5 ? -sp : sp) : mid;

    ctx.kx[ctx.nKnolls] = branch + (hash2(b, 601, 88) * 2 - 1) * half * knolls.spread;
    ctx.krx[ctx.nKnolls] = rx;
    ctx.kdz[ctx.nKnolls] = dz;
    ctx.kh[ctx.nKnolls] = height;
    ctx.nKnolls += 1;
  }
  return ctx;
}

function heightIn(ctx, x) {
  const z = ctx.z;
  let h = ctx.base;

  /* Two of the four octaves are sampled at coordinates that a long slow
     noise has pushed around. That warp is the whole difference between a
     mogul field and a grid of identical pimples: a bulge is stretched here
     and pinched there, and no two stretches of hill have the same lumps. */
  const wx = x + snoise2(x * warp.freq, z * warp.freq, warp.seed) * warp.amp;
  const wz = z + snoise2(x * warp.freq, z * warp.freq, warp.seed + 1) * warp.amp;

  h += snoise2(x * ridges.freq, z * ridges.freq, ridges.seed) * ridges.amp;
  h += snoise2(wx * rolls.freq, wz * rolls.freq, rolls.seed) * rolls.amp * ctx.lump;
  h += snoise2(wx * moguls.freq, wz * moguls.freq, moguls.seed) * moguls.amp * ctx.lump;
  h += snoise2(x * chatter.freq, z * chatter.freq, chatter.seed) * chatter.amp;

  /* Outside the corridor: the quarterpipe, then the wall.

     The lip is a smoothstep, so it leaves the piste concave — a transition
     you can ride up — and arrives at the top with zero gradient, which is a
     genuine convex rollover and the reason a rider who commits speed to it
     gets thrown rather than handed their speed back. Past it the wall takes
     over from zero gradient too, so the two meet without a crease. */
  let d;
  if (ctx.split > 0) {
    const d0 = Math.abs(x - (ctx.mid - ctx.split));
    const d1 = Math.abs(x - (ctx.mid + ctx.split));
    d = Math.min(d0, d1);
    /* The two ways sit at different heights, blended by inverse-square
       proximity rather than switched at the midpoint. Switching would put a
       vertical step down the middle of the island; weighting means each
       branch reaches its own elevation, the island between settles at the
       mean, and the surface is smooth everywhere — which it has to be,
       because the rider's normals are central differences of this and a step
       would fling them sideways for a frame. */
    if (ctx.tilt !== 0) {
      const w0 = 1 / (d0 * d0 + 25);
      const w1 = 1 / (d1 * d1 + 25);
      h += ctx.tilt * (w1 - w0) / (w0 + w1);
    }
  } else {
    d = Math.abs(x - ctx.mid);
  }
  const over = d - ctx.half;
  // Inside the groomed part, a shallow dish that gathers a drifting rider
  // back towards the fall line. It never pushes — at the corridor's edge it
  // is a slope of about a fifteenth — and being entirely lateral it costs
  // nothing against the budget the octaves are fighting over.
  if (over <= 0) {
    const u = d / Math.max(1, ctx.half);
    h += corridor.bowl * u * u;
  }
  if (over > 0) {
    h += corridor.bowl;
    h += ctx.lipH * smooth01(Math.min(1, over / ctx.lipW));
    const w = over - ctx.lipW;
    if (w > 0) {
      const u = w / wall.scale;
      h += wall.height * (1 - Math.exp(-u * u)) + wall.creep * w;
    }
  }

  /* The knolls. A squared dome — (1 − r²)² — which is one at the crest,
     zero at the rim, and flat at both, so a knoll joins the hill without a
     crease and has no edge anywhere on it. Overlapping ones simply add. */
  for (let i = 0; i < ctx.nKnolls; i++) {
    const dx = (x - ctx.kx[i]) / ctx.krx[i];
    if (dx <= -1 || dx >= 1) continue;
    const dz = ctx.kdz[i];
    const r2 = dx * dx + dz * dz;
    if (r2 >= 1) continue;
    const f = 1 - r2;
    h += ctx.kh[i] * f * f;
  }

  for (let i = 0; i < ctx.nCliffs; i++) {
    const ax = Math.abs(x - ctx.cliffX[i]);
    if (ax >= cliffs.halfWidth + cliffs.shoulder) continue;
    h -= ctx.cliffA[i]
      * (1 - smoothstep(cliffs.halfWidth, cliffs.halfWidth + cliffs.shoulder, ax));
  }

  return h;
}

/* The pure form, for everyone who is asking about one point rather than a
   row of them. It is the row path with a row of one. */
const scratch = makeContext();

export function heightAt(x, z) {
  return heightIn(rowContext(z, scratch), x);
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

/* The pitch of the bare hill down the fall line, which is what the rider's
   climb scrub and the attract-mode steering both want to know. */
export function gradeAt(z) {
  let g = GRADE.base;
  for (let i = 0; i < GRADE.waves.length; i++) {
    const w = GRADE.waves[i];
    g += w.amp * Math.sin(w.freq * z + w.phase);
  }
  return g;
}

/* ==========================================================================
   The grid
   ========================================================================== */

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

export function createTerrain(THREE, shading) {
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

     A snowfield at these cell sizes is geometrically smooth and visually
     blank, and a blank ground is the one thing that will not sell speed: the
     eye reads velocity from texture passing underneath, and there was none.
     It cannot come from the grid — corduroy is a metre and a half apart and
     so are the vertices, so anything fine enough to work aliases before it
     is drawn.

     So it is painted per pixel, from world coordinates, which means it is
     welded to the ground and rushes at the rider at exactly the speed the
     rider is doing. Three layers: the groomer's ribs running across the fall
     line, broad wind packing along it, and a hash of grain to break up the
     flats.

     Each layer is faded out by how much ground a pixel is covering rather
     than by distance alone, and that is not a refinement — it is the whole
     reason the ground is legible. A rib every metre and a half seen down a
     slope at a grazing angle is compressed into almost nothing in screen
     space long before it is far away, and sampling it once per pixel with
     no mip chain beats against the pixel grid and throws broad moiré bands
     right across the hill. At 288 lines this was invisible because
     everything was; at native resolution it was the first thing you saw.
     `fwidth` says exactly how many metres a pixel spans here, so each layer
     can be taken out the moment its period approaches that. */
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
        float detail = 1.0 - smoothstep(140.0, 320.0, vDist);
        if (detail > 0.002) {
          // Metres of ground this pixel covers, which on a slope seen at a
          // grazing angle is far larger than the distance alone implies
          float px = max(fwidth(vWorld.x), fwidth(vWorld.z));
          float ribFade = 1.0 - smoothstep(0.26, 0.72, px);      // period 1.53 m
          float grainFade = 1.0 - smoothstep(0.10, 0.26, px);    // cells of 0.43 m
          float rib = sin(vWorld.z * 4.1) * ribFade;
          float pack = sin(vWorld.x * 0.55 + vWorld.z * 0.07);   // metres wide, never aliases
          float grain = fract(sin(dot(floor(vWorld.xz * 2.3), vec2(12.9898, 78.233))) * 43758.545);
          float d = rib * 0.105 + pack * 0.035 + (grain - 0.5) * 0.07 * grainFade;
          diffuseColor.rgb *= 1.0 + d * detail;
        }`)
      /* Glitter.

         Snow is made of flat crystals lying at every angle, and a tiny
         fraction of them are, from where you happen to be standing, aimed
         exactly right — so a snowfield in sun is not white, it is white with
         a scatter of points brighter than anything else outdoors, and they
         come and go as you move because it is a different fraction of
         crystals every step. It is the single most recognisable thing about
         real snow and the thing every white-render-with-a-blue-tint misses.

         One in seventy lattice cells is allowed to hold one, and whether it
         is lit depends on the view direction, so they twinkle as the run
         goes past rather than sitting there like dirt. It is added after the
         lighting and before the fog, and scaled by how bright the pixel
         already was — snow in shadow has nothing to catch — so a glint is
         something the sun is doing rather than something the ground is. */
      .replace('#include <fog_fragment>', `
        {
          float sparkPx = max(fwidth(vWorld.x), fwidth(vWorld.z));
          float sparkFade = (1.0 - smoothstep(0.02, 0.11, sparkPx))
            * (1.0 - smoothstep(30.0, 95.0, vDist));
          if (sparkFade > 0.004) {
            vec3 vd = normalize(cameraPosition - vWorld);
            vec2 cell = floor(vWorld.xz * 26.0);
            float pick = fract(sin(dot(cell, vec2(45.233, 91.777))) * 31871.37);
            float phase = fract(pick * 71.3 + dot(vd.xz, vec2(2.7, 3.1)) * 0.5);
            float twinkle = pow(abs(sin(phase * 6.28318)), 22.0);
            float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            gl_FragColor.rgb += smoothstep(0.986, 1.0, pick) * twinkle
              * sparkFade * smoothstep(0.45, 0.95, lum) * vec3(0.9, 0.95, 1.0);
          }
        }
        #include <fog_fragment>`);
  };
  /* And then the console, on top of all that: the vertex snap, the five
     bands of diffuse, and the fog that resolves towards the sky rather than
     towards one colour. It goes on last on purpose — `shading.apply` keeps
     whatever the material was already doing to itself and runs it first, and
     the glitter above is written to leave the fog include standing behind it
     precisely so that this can take it. */
  shading.apply(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  /* Snow is two colours and a rock, mixed per vertex. Lighting is the
     material's job; these carry material variation only — wind-packed
     patches, the shade that collects in a hollow, and the stone that shows
     through wherever the hill gets too steep to hold snow.

     SNOW IS NEVER WHITE. These used to be #fbfdff and #c2d3ea — a bright
     snow that was white with a rounding error in it, and a shade that was
     white with a hint. They are albedos, not appearances, and an albedo of
     one is a lie about a material that reflects eighty per cent of the light
     it gets: it left nothing for the key to do, so a lit slope arrived at the
     top of the scale before the sun had said anything about it and the
     highlight shoulder downstream had nothing left to roll off.

     What is here instead is glacier. The bright stop is a pale blue-white
     with the blue still legible in it, the dim stop is properly glacial, and
     the warmth in the picture arrives from somewhere it can actually come
     from — the key light, which at golden hour is #ffcb8a and at dusk is
     #ff9a6a. Snow is warm only where a low sun is landing on it, which is
     precisely the rule, and it is a rule about light and not about paint.

     The rock has come down and gone blue with them. A neutral grey stone
     against a blue-biased snow reads as warm, which is the last thing a cliff
     on this mountain should read as. */
  const snowLit = new THREE.Color('#dae7f6');
  const snowDim = new THREE.Color('#a3bcdd');
  const rock = new THREE.Color('#414a5c');
  const rockLit = new THREE.Color('#6f7c93');
  const cur = new THREE.Color();
  const stone = new THREE.Color();

  const ctx = makeContext();

  let anchorX = NaN;
  let anchorZ = NaN;

  function fill(ax, az, ay) {
    // Pass one: heights, a row at a time so everything that depends only on
    // z is computed once for the whole row rather than once per vertex
    let i = 0;
    for (let r = 0; r < vertsZ; r++) {
      rowContext(az + zs[r], ctx);
      for (let c = 0; c < vertsX; c++) heights[i++] = heightIn(ctx, ax + xs[c]);
    }

    // Pass two: positions and colours
    i = 0;
    let p = 0;
    for (let r = 0; r < vertsZ; r++) {
      const lz = zs[r];
      const wz = az + lz;
      rowContext(wz, ctx);
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(vertsZ - 1, r + 1);
      const dz2 = zs[rNext] - zs[rPrev] || 1;
      const grade = gradeAt(wz);

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

        // Groomed, and measured to whichever branch of the run is nearer —
        // which is what puts corduroy down both sides of an island
        const toCentre = ctx.split > 0
          ? Math.min(Math.abs(wx - (ctx.mid - ctx.split)), Math.abs(wx - (ctx.mid + ctx.split)))
          : Math.abs(wx - ctx.mid);
        if (toCentre < ctx.half + 3) {
          /* Groomed, so it is brighter than what flanks it.

             There used to be a second set of corduroy lines here, written
             into the vertex colours at a period of 3.3 metres — which is
             barely two samples per cycle on a 1.5-metre grid, under Nyquist,
             and so it did not draw corduroy at all. It drew the beat between
             its own period and the grid's, which crawled across the hill as
             the mesh re-anchored. The ribs the fragment shader paints are
             the same idea done where there are enough samples to do it. */
          cur.lerp(snowLit, 0.25);
        }

        const bare = smoothstep(0.5, 1.0, steep);
        if (bare > 0) {
          // Rock catches the sun along its ridges and holds none of it in
          // the clefts, which is most of what makes a cliff read as rock.
          // It is also the sign on the containment wall: everything too
          // steep to hold snow is somewhere you are not going to get to.
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

  /* Re-anchor if the rider has crossed into a new anchor cell. The mesh is
     placed at the anchor and its vertices stored relative to it, which keeps
     every coordinate the GPU sees inside a kilometre however far down the
     mountain the run has gone.

     The anchor moves in strides of four cells rather than one. Refilling six
     thousand vertices is a few milliseconds and at 145 km/h a one-cell
     anchor asked for it twenty-seven times a second, which is a whole frame's
     budget spent four times over on a hill that had moved a metre and a half.
     Four cells is still a whole number of the finest spacing, so the near
     vertices land on the same lattice every time and the facets stay welded
     exactly as they did; it is only the far, graded cells that shift further
     per step, and they are in fog. `back` has to stay comfortably larger than
     the stride or the ground behind the rider pops. */
  /* Two cells, not four.

     Every re-anchor shifts the far, graded cells by the whole stride, and out
     where a cell is forty metres wide that shift is a visible crawl along the
     skyline — the second half of the flickering horizon, the first being the
     vertex snap. Four cells was chosen to keep the refill cost down and it
     tripled the crawl to do it. Two is the compromise: the near cells still
     land on the same lattice every time so the facets stay welded to the hill,
     the refill happens twice as often as it needs to and is still only a few
     milliseconds, and the far field moves little enough that the haze can
     cover it — which is what the haze is for. */
  const stride = spacing * 2;

  function update(x, z) {
    const ax = Math.round(x / stride) * stride;
    const az = Math.round(z / stride) * stride;
    if (ax === anchorX && az === anchorZ) return;
    anchorX = ax;
    anchorZ = az;
    const ay = heightAt(ax, az);
    mesh.position.set(ax, ay, az);
    fill(ax, az, ay);
  }

  return { mesh, update, vertexCount: count };
}
