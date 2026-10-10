# Meteora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Meteora, a realistic three.js space shooter with Blender-made
models, Newtonian flight, a massive asteroid belt, combat waves and a full
HDR effects pipeline, and list it on the Protocodus games pages.

**Architecture:** A pure, deterministic simulation (`flight`, `field`,
`weapons`, `ai`, `combat`, `world`, `shake`, `controls`) that never imports
three.js and is covered by Node checks. Rendering modules consume the
world state and its event queue. Models are produced by committed Blender
`bpy` scripts that also emit `js/anchors.js`, so the simulation knows the
muzzle and thruster positions without loading a GLB.

**Tech Stack:** three.js r185 (vendored, import map), WebGL2, GLSL, Web
Audio, Blender 5.3 headless (`bpy`, Cycles bake, glTF exporter), Node 26
(`node:assert/strict`) for the checks.

**Spec:** `fun/meteora/docs/2026-10-10-meteora-design.md`. Read it with this
plan; section numbers below (§) refer to it.

## Global Constraints

- No build step and no npm dependencies. ES modules only. three is loaded
  as `"three": "/assets/vendor/three/three.module.min.js"` through an
  import map.
- Simulation modules (`vec`, `rng`, `config`, `anchors`, `flight`,
  `field`, `weapons`, `ai`, `combat`, `world`, `shake`, `controls`) must
  not import `three` or touch the DOM.
- Checks run from `fun/meteora` as `node tests/<name>.mjs`, using only
  `node:assert/strict` and `node:fs`. Each check exits non-zero on failure.
- Units are metres, seconds and radians. Ship nose −Z, top +Y. In Blender,
  the nose is +Y and the top +Z.
- Physics runs at a fixed `STEP = 1/120` s, with at most 8 steps per
  rendered frame; the backlog beyond that is dropped.
- Blender binary: `/Applications/Blender.app/Contents/MacOS/Blender`, always
  run with `--background --factory-startup`.
- All seven GLBs together ≤ 10 MB. Per-model triangle budgets as in §4.
- Per frame: ≤ 400 draw calls and ≤ 2.5M triangles; 60 fps target with
  dynamic resolution down to 0.6.
- Storage keys: `meteora.best` and `meteora.settings`. Every storage access
  is wrapped in try/catch.
- Pointer-lock loss pauses the game. The game never runs with a free
  cursor.
- Commit messages are prefixed `meteora:` and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code style follows the repo: prose block comments that explain why,
  2-space indent, single quotes, semicolons.

## Review Focus

1. **A long-hidden tab or a debugger pause produces a huge frame time.**
   The world must run at most 8 steps and drop the rest, never spiral or
   teleport ships through rocks. Pinned in Task 8, test "a 60 s frame runs
   at most 8 steps".
2. **Keys held while the window loses focus or pointer lock is lost** (for
   example alt-tab while holding W and Shift). Keyup never arrives, so
   inputs stick. Blur and lock loss must drop every held input. Pinned in
   Task 9, test "blur drops every held input".
3. **A missile whose target dies or despawns mid-flight** must fly on
   ballistically with its motor, never produce NaN, and expire normally.
   Pinned in Task 6, test "a missile whose target dies flies on".
4. **Pressing "Launch again" after a fight** must restore every destroyed
   rock and clear bolts, missiles, enemies, dynamic rocks and events. A
   second run must start exactly like the first. Pinned in Task 5 (field
   reset) and Task 8 (world reset).
5. **Degenerate geometry**: zero-length vectors (a ship at rest, an enemy
   exactly on the player, a missile launched with zero relative velocity,
   coordinates 1 000 km out) must yield finite controls and empty queries,
   never NaN. Pinned in Task 1 (`normalize` of zero), Task 5 (far query) and
   Task 7 (coincident enemy).

---

## File map

```
fun/meteora/
  index.html, meteora.css, README.md
  docs/2026-10-10-meteora-design.md, docs/2026-10-10-meteora-plan.md
  assets/models/{fighter,interceptor,asteroid_1..5}.glb, MODELS.md
  assets/vendor/GLTFLoader.js, assets/utils/{BufferGeometryUtils,SkeletonUtils}.js
  tools/blender/{common,build_asteroids,build_ships,render_previews,build_all}.py
  tools/blender/previews/*.png
  js/  vec rng config anchors(generated) flight field weapons ai combat world
       shake controls | input models field-render sky post particles plumes
       projectiles explosions fx dust camera hud audio screens main
  tests/ harness vec flight field weapons ai combat controls shake models (-check.mjs)
```

---

### Task 1: Scaffold, vector math, RNG and config

**Files:**
- Create: `fun/meteora/js/vec.js`, `fun/meteora/js/rng.js`, `fun/meteora/js/config.js`
- Create: `fun/meteora/tests/harness.mjs`, `fun/meteora/tests/vec-check.mjs`

**Interfaces:**
- Produces from `vec.js`, all on plain arrays. `o` is the out-param, which is
  returned; inputs may alias `o`.
  - Vectors: `v3(x=0,y=0,z=0)`, `set(o,x,y,z)`, `copy(o,a)`,
    `add(o,a,b)`, `sub(o,a,b)`, `scale(o,a,s)`, `addScaled(o,a,b,s)`
    (o = a + b·s), `dot(a,b)`, `cross(o,a,b)`, `len(a)`, `lenSq(a)`,
    `dist(a,b)`, `distSq(a,b)`, `normalize(o,a)` (zero → `[0,0,0]`),
    `lerp(o,a,b,t)`, `clamp(x,lo,hi)`.
  - Quaternions, `[x,y,z,w]`: `qIdentity()`, `qMul(o,a,b)`,
    `qRotate(o,q,v)`, `qRotateInv(o,q,v)`, `qNormalize(q)`,
    `qFromAxisAngle(o,axis,angle)`, `qIntegrate(q,wLocal,dt)` (mutates q,
    body-frame angular velocity, renormalises), `qSlerp(o,a,b,t)`,
    `qLookRotation(o,forward,up)` (the result maps local −Z to `forward`).
- Produces from `rng.js`:
  - `makeRng(seed)` → `{ next(), range(a,b), int(a,b) /*inclusive*/,
    pick(arr), unit(o) /*uniform on sphere*/, gauss() }`;
  - `hash3(ix,iy,iz,seed)` → uint32;
  - `noise3(x,y,z,seed)` → value noise in [−1,1] with smooth
    interpolation;
  - `fbm3(x,y,z,seed,octaves=4)` → roughly [−1,1].
- Produces from `config.js`: `STEP`, `MAX_STEPS`, `PLAYER`, `ENEMY`,
  `CANNON`, `ENEMY_CANNON`, `MISSILE`, `FIELD`, `COMBAT`, `SHAKE`,
  `RENDER`, with the exact values given in the step below.

- [ ] **Step 1: Write `tests/harness.mjs`**

```js
import assert from 'node:assert/strict';

const cases = [];
export function test(name, fn) { cases.push([name, fn]); }
export function near(actual, expected, eps, label = '') {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label} expected ${expected} ± ${eps}, got ${actual}`);
}
export function finite(values, label = '') {
  for (const v of values) assert.ok(Number.isFinite(v), `${label} not finite: ${values}`);
}
export async function run() {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (error) { failed++; console.log(`FAIL ${name}\n     ${error.message}`); }
  }
  console.log(failed ? `${failed} of ${cases.length} failed` : `${cases.length} passed`);
  if (failed) process.exit(1);
}
export { assert };
```

- [ ] **Step 2: Write the failing `tests/vec-check.mjs`**

```js
import { test, run, assert, near, finite } from './harness.mjs';
import * as V from '../js/vec.js';
import { makeRng, fbm3, noise3 } from '../js/rng.js';

test('normalize of a zero vector is zero, not NaN', () => {
  assert.deepEqual(V.normalize([0, 0, 0], [0, 0, 0]), [0, 0, 0]);
});
test('qRotate and qRotateInv are inverses', () => {
  const q = V.qFromAxisAngle([0, 0, 0, 1], V.normalize([0, 0, 0], [1, 2, 3]), 1.1);
  const v = V.qRotateInv([0, 0, 0], q, V.qRotate([0, 0, 0], q, [4, -5, 6]));
  near(v[0], 4, 1e-9); near(v[1], -5, 1e-9); near(v[2], 6, 1e-9);
});
test('qIntegrate with a body pitch rate raises the nose', () => {
  const q = V.qIdentity();
  for (let i = 0; i < 120; i++) V.qIntegrate(q, [Math.PI / 2, 0, 0], 1 / 120);
  const nose = V.qRotate([0, 0, 0], q, [0, 0, -1]);
  near(nose[1], 1, 1e-3, 'nose up after 90°');
  near(Math.hypot(...q), 1, 1e-12);
});
test('qLookRotation points local -Z at the forward vector', () => {
  const q = V.qLookRotation([0, 0, 0, 1], V.normalize([0, 0, 0], [1, 0, -1]), [0, 1, 0]);
  const nose = V.qRotate([0, 0, 0], q, [0, 0, -1]);
  near(nose[0], Math.SQRT1_2, 1e-9); near(nose[2], -Math.SQRT1_2, 1e-9);
});
test('the rng is deterministic per seed', () => {
  const a = makeRng(7), b = makeRng(7), c = makeRng(8);
  const sa = [a.next(), a.next(), a.next()];
  assert.deepEqual(sa, [b.next(), b.next(), b.next()]);
  assert.notDeepEqual(sa, [c.next(), c.next(), c.next()]);
});
test('rng.unit is on the unit sphere and noise stays in range', () => {
  const r = makeRng(3);
  for (let i = 0; i < 1000; i++) near(V.len(r.unit([0, 0, 0])), 1, 1e-9);
  for (let i = 0; i < 1000; i++) {
    const x = r.range(-500, 500), y = r.range(-500, 500), z = r.range(-500, 500);
    const n = noise3(x, y, z, 1), f = fbm3(x, y, z, 1);
    finite([n, f]);
    assert.ok(n >= -1 && n <= 1 && f >= -1.01 && f <= 1.01);
  }
});
await run();
```

- [ ] **Step 3: Run it; expect failure**
  Run: `cd fun/meteora && node tests/vec-check.mjs`. Expected: `ERR_MODULE_NOT_FOUND` for `vec.js`.

- [ ] **Step 4: Implement `vec.js` and `rng.js`**
  - `qIntegrate`: `dq = 0.5 · q ⊗ (wx,wy,wz,0)`, `q += dq·dt`, then
    normalise (Euler is enough at 120 Hz; the test pins the drift).
  - `makeRng`: mulberry32.
  - `hash3`: `Math.imul` mixing of the three ints and the seed (xxhash-style
    avalanche).
  - `noise3`: trilinear value noise on `hash3` lattice values mapped to
    [−1,1], with quintic fade.
  - `fbm3`: octaves with lacunarity 2 and gain 0.5, normalised by the
    amplitude sum.
  - `qLookRotation`: build an orthonormal basis `z = −forward`,
    `x = normalize(up × z)`, `y = z × x`, then convert the matrix to a
    quaternion. If `up` is parallel to forward, fall back to `up = [1,0,0]`.

- [ ] **Step 5: Write `config.js` with the spec values**

```js
/* Meteora — every number the game leans on. Metres, seconds, radians. */
export const STEP = 1 / 120;
export const MAX_STEPS = 8;

export const PLAYER = {
  radius: 6,
  accel: { forward: 45, reverse: 25, lateral: 22, boost: 120 },
  fa: { forwardSpeed: 180, boostSpeed: 320, strafeSpeed: 60, tau: 0.25, tauAngular: 0.12 },
  rate: [1.6, 1.1, 2.6],          // pitch, yaw, roll max rad/s
  angAccel: [6, 4, 9],            // rad/s²
  spinCap: 3,                     // FA-off safety cap, × rate
  throttle: { min: -0.35, rampPerSecond: 0.6 },
  boost: { capacity: 100, drain: 25, regen: 12, regenDelay: 1.5, relock: 20 },
  shield: 100, hull: 100, shieldRegen: 15, shieldDelay: 3,
};
export const ENEMY = {
  ...PLAYER,
  radius: 5,
  accel: { forward: 40, reverse: 25, lateral: 26, boost: 110 },
  fa: { forwardSpeed: 200, boostSpeed: 300, strafeSpeed: 70, tau: 0.25, tauAngular: 0.1 },
  rate: [1.9, 1.5, 3.0],
  angAccel: [7, 5, 10],
  shield: 30, hull: 60, shieldRegen: 6, shieldDelay: 4,
};
export const CANNON = { rate: 12, speed: 1000, life: 2.2, damage: 8, heat: 4.5, cool: 30, lockAt: 100, releaseAt: 40, radius: 0.3 };
export const ENEMY_CANNON = { rate: 6, speed: 850, life: 2.2, damage: 5, heat: 0, cool: 0, lockAt: Infinity, releaseAt: 0, radius: 0.3,
  burst: [0.8, 1.4], pause: [0.6, 1.2] };
export const MISSILE = { capacity: 6, rearm: 8, lockCone: 15 * Math.PI / 180, lockRange: 3000, lockTime: 0.8,
  launchKick: 30, ignition: 0.25, accel: 220, maxSpeed: 650, navGain: 4, maxLateral: 350,
  life: 8, fuse: 12, damage: 80, blast: 30, radius: 0.6 };
export const FIELD = {
  half: [4000, 1000, 4000],
  spawn: [0, 0, 0], spawnClear: 200,
  cell: 1000, hashCell: 100, bigRadius: 300, maxDynamic: 64,
  types: [  // nominal bounding radius, count, draw distance (m)
    { radius: 1.5, count: 12000, draw: 1500 },
    { radius: 4, count: 6000, draw: 3000 },
    { radius: 12, count: 2500, draw: 6000 },
    { radius: 40, count: 600, draw: Infinity },
    { radius: 125, count: 150, draw: Infinity },
  ],
  landmarks: { count: 6, scale: [6, 10] },
  scale: [0.7, 1.4], collide: 0.85, gap: 0.95,
  destructible: 3, hpPerRadius: 5,   // hp = 5 · r^1.5 for types 0–2
};
export const COMBAT = {
  wave: { base: 2, cap: 10, near: 2500, far: 3500, viewCone: 60 * Math.PI / 180, delay: 6 },
  score: { kill: 100, rock: [10, 25, 50] },
  collision: { safe: 8, perMs: 1.2, restitution: 0.35, friction: 0.85 },
  leaving: 3000,
};
export const SHAKE = {
  idle: 0.02, engine: 0.12, rumble: 0.35, rcsKick: 0.08,
  buffet: 0.0025, buffetGrain: 0.9,  // buffet amplitude per (m/s × density)
  shipShare: 0.35, maxImpact: 1.6,
};
export const RENDER = {
  far: 60000, near: 0.5, fov: 70, dprCap: 2,
  scaleMin: 0.6, scaleMax: 1, targetMs: 16.7,
  shadowBox: 600, shadowSize: 2048, lights: 8,
  skyFace: 2048, brightStars: 2500,
};
```

- [ ] **Step 6: Run the check; expect a pass**
  Run: `node tests/vec-check.mjs`. Expected: `6 passed`.

- [ ] **Step 7: Commit**

```bash
git add fun/meteora/js/vec.js fun/meteora/js/rng.js fun/meteora/js/config.js fun/meteora/tests
git commit -m "meteora: vector math, seeded noise and the tunables"
```

---

### Task 2: Blender pipeline and the five asteroids

**Files:**
- Create: `fun/meteora/tools/blender/common.py`, `build_asteroids.py`, `render_previews.py`, `build_all.py`
- Create (generated): `fun/meteora/assets/models/asteroid_1.glb` … `asteroid_5.glb`, `tools/blender/previews/asteroid_*.png`
- Create: `fun/meteora/tests/models-check.mjs` (asteroid part)

**Interfaces:**
- Produces GLBs, each with exactly two mesh nodes, `lod0` and `lod1`,
  centred on the origin. The bounding radius of `lod0` is within ±10 % of
  the nominal radius (1.5, 4, 12, 40, 125). The material uses embedded WebP
  `baseColorTexture`, `normalTexture` and `metallicRoughnessTexture`.
- Produces `tests/models-check.mjs` with a reusable `readGlb(path)` →
  `{ json, bytes }` and `trianglesOf(json, meshIndex)`.

- [ ] **Step 1: Write the failing asteroid part of `models-check.mjs`**

```js
import { test, run, assert } from './harness.mjs';
import { readFileSync, statSync, existsSync } from 'node:fs';

const MODELS = new URL('../assets/models/', import.meta.url);
export function readGlb(name) {
  const buf = readFileSync(new URL(name, MODELS));
  assert.equal(buf.readUInt32LE(0), 0x46546c67, `${name}: glTF magic`);
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${name}: JSON chunk`);
  return { json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')), size: buf.length };
}
export function trianglesOf(json, meshIndex) {
  let tris = 0;
  for (const p of json.meshes[meshIndex].primitives) {
    const acc = json.accessors[p.indices ?? p.attributes.POSITION];
    tris += acc.count / 3;
  }
  return tris;
}
function nodeByName(json, name) { return json.nodes.find(n => n.name === name); }
function radiusOf(json, meshIndex) {
  const acc = json.accessors[json.meshes[meshIndex].primitives[0].attributes.POSITION];
  return Math.max(...acc.max.map(Math.abs), ...acc.min.map(Math.abs));
}

const ROCKS = [
  { file: 'asteroid_1.glb', radius: 1.5, lod0: 300, lod1: 80, kb: 700 },
  { file: 'asteroid_2.glb', radius: 4, lod0: 600, lod1: 160, kb: 900 },
  { file: 'asteroid_3.glb', radius: 12, lod0: 1200, lod1: 300, kb: 1500 },
  { file: 'asteroid_4.glb', radius: 40, lod0: 2500, lod1: 600, kb: 1600 },
  { file: 'asteroid_5.glb', radius: 125, lod0: 4000, lod1: 1000, kb: 1800 },
];
for (const rock of ROCKS) {
  test(`${rock.file}: lods, budgets, textures, size`, () => {
    assert.ok(existsSync(new URL(rock.file, MODELS)), 'exists');
    const { json, size } = readGlb(rock.file);
    assert.ok(size <= rock.kb * 1024, `size ${size}`);
    for (const [lod, budget] of [['lod0', rock.lod0], ['lod1', rock.lod1]]) {
      const node = nodeByName(json, lod);
      assert.ok(node && node.mesh !== undefined, `${lod} node`);
      const tris = trianglesOf(json, node.mesh);
      assert.ok(tris > budget * 0.3 && tris <= budget, `${lod} tris ${tris}`);
    }
    const r = radiusOf(json, nodeByName(json, 'lod0').mesh);
    assert.ok(Math.abs(r - rock.radius) <= rock.radius * 0.1, `radius ${r}`);
    const mat = json.materials[0].pbrMetallicRoughness;
    assert.ok(mat.baseColorTexture && json.materials[0].normalTexture && mat.metallicRoughnessTexture, 'textures');
    assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'webp');
  });
}
if (process.argv[1].endsWith('models-check.mjs')) await run();
```

- [ ] **Step 2: Run it; expect failure** (`exists` assertion fails).

- [ ] **Step 3: Write `common.py`**. The helpers, with key code:

```python
import bpy, bmesh, math, random, os
from mathutils import Vector, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'assets', 'models')

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    return scene

def new_image(name, size, non_color=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if non_color: img.colorspace_settings.name = 'Non-Color'
    return img

def bake(obj, image, kind, source=None, extrusion=0.0):
    """Bake `kind` ('NORMAL'|'DIFFUSE'|'ROUGHNESS'|'EMIT'|'AO') of obj (or from
    `source` high-poly, selected-to-active) into image via an active image node."""
    mat = obj.active_material
    nodes = mat.node_tree.nodes
    tex = nodes.new('ShaderNodeTexImage'); tex.image = image
    nodes.active = tex
    bpy.ops.object.select_all(action='DESELECT')
    if source: source.select_set(True)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    kw = dict(type=kind, margin=8, use_selected_to_active=bool(source), cage_extrusion=extrusion)
    if kind == 'DIFFUSE': kw['pass_filter'] = {'COLOR'}
    bpy.ops.object.bake(**kw)
    nodes.remove(tex)

def smart_uv(obj, margin=0.02):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')

def baked_material(name, base, normal, mr, emissive=None):
    """Principled material wired to the baked images (what the glTF exporter reads)."""
    ...  # TexImage → Base Color; TexImage → Normal Map → Normal;
         # TexImage → Separate Color (G → Roughness, B → Metallic); optional emissive.

def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_image_format='WEBP',
        export_image_quality=82, export_extras=False, export_cameras=False, export_lights=False)
```

- [ ] **Step 4: Write `build_asteroids.py`.** For each of the five rocks:
  1. Build the high-poly sculpt:
     - an ico sphere with 6 subdivisions;
     - a per-rock shape stretch: shard `(1.0, 0.55, 0.7)` with a planar
       cut, pile `(1, 0.9, 0.85)`, potato `(1.6, 0.8, 0.75)`, blocky
       `(1.2, 1, 0.8)` with layered terracing via `round(n·k)/k`,
       battered `(1, 0.95, 0.9)`;
     - vertex displacement `r·(1 + 0.22·fbm + 0.08·voronoi F1 facets)`
       using `mathutils.noise` with a fixed seed;
     - 6–30 craters, each a smooth bowl with a raised rim at
       `random.Random(seed)` sample points.
  2. Make the game mesh: duplicate the sculpt, apply a Decimate (collapse)
     modifier to the LOD0 budget, then decimate again for LOD1.
  3. Rescale so the LOD0 bounding radius equals the nominal radius.
  4. Material on the high mesh:
     - base colour from a carbonaceous grey-brown ramp driven by noise,
       plus pointiness / AO for lighter regolith in cavities;
     - roughness 0.85–0.95 with sparse 0.4 flecks;
     - metallic 0.
  5. Bake onto the LOD0 (smart UV) with selected-to-active:
     - NORMAL (cage extrusion 3 % of radius);
     - DIFFUSE colour;
     - ROUGHNESS, packed into the G channel of the MR image (B = 0) in
       numpy.
  6. LOD1 reuses the LOD0 material. It gets its own UVs via data transfer
     from LOD0, or a re-bake from the same source; reuse the same images.
  7. Name the nodes `lod0` and `lod1`. Delete the sculpt. Export with
     `export_glb`.
  8. Texture sizes: 512 for rocks 1–2 and 1024 for rocks 3–5.

- [ ] **Step 5: Write `render_previews.py`.** For every GLB in `assets/models`:
  - import into an empty scene with a sun (strength 4) and a dark world;
  - add a camera framing the bounding sphere at a 3/4 view;
  - render 512² Eevee to `tools/blender/previews/<name>.png`.

  `build_all.py` runs `build_asteroids`, then `build_ships` (once it
  exists), then `render_previews`.

- [ ] **Step 6: Run the build**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python fun/meteora/tools/blender/build_all.py
```

  Expected: 5 GLBs and 5 PNGs. Open every preview PNG with the Read tool
  and judge it: each rock must look like a rock (not a lumpy ball), with
  visible craters and baked detail, and the five must be distinct.
  Iterate on the shape parameters until they do.

- [ ] **Step 7: Run `node tests/models-check.mjs`.** Expected: `5 passed`.

- [ ] **Step 8: Commit** the scripts, GLBs and previews:
  `meteora: Blender pipeline and five baked asteroids`.

---

### Task 3: Blender ships and the generated anchors module

**Files:**
- Create: `fun/meteora/tools/blender/build_ships.py`
- Create (generated): `assets/models/fighter.glb`, `assets/models/interceptor.glb`, `js/anchors.js`, previews
- Modify: `fun/meteora/tests/models-check.mjs` (ship part)

**Interfaces:**
- Produces `js/anchors.js` (generated; do not hand-edit), in glTF/three
  space, metres:

```js
export const ANCHORS = {
  fighter: {
    radius: 7.1,
    nozzles: [{ name: 'nozzle_L', pos: [x, y, z], dir: [0, 0, 1] }, ...],
    muzzles: [{ name: 'muzzle_L', pos: [...] }, ...],
    rcs: [{ name: 'rcs_01', pos: [...], dir: [...] }, ...],   // dir = puff direction (unit)
    cockpit: [x, y, z],
  },
  interceptor: { radius, nozzles, muzzles, rcs, cockpit },
};
```

- [ ] **Step 1: Extend `models-check.mjs` with failing ship tests**

```js
import { ANCHORS } from '../js/anchors.js';
import { cross, dot, normalize, scale } from '../js/vec.js';

const SHIPS = [
  { file: 'fighter.glb', key: 'fighter', tris: 12000, kb: 3500, length: [12.5, 15.5], nozzles: 2, muzzles: 2, rcs: 12 },
  { file: 'interceptor.glb', key: 'interceptor', tris: 8000, kb: 2200, length: [9.5, 12.5], nozzles: 1, muzzles: 2, rcs: 8 },
];
for (const ship of SHIPS) {
  test(`${ship.file}: budget, size, length, anchors match the GLB`, () => {
    const { json, size } = readGlb(ship.file);
    assert.ok(size <= ship.kb * 1024, `size ${size}`);
    const tris = json.meshes.reduce((t, _, i) => t + trianglesOf(json, i), 0);
    assert.ok(tris <= ship.tris && tris > ship.tris * 0.3, `tris ${tris}`);
    let minZ = Infinity, maxZ = -Infinity;
    for (const m of json.meshes) for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION]; minZ = Math.min(minZ, a.min[2]); maxZ = Math.max(maxZ, a.max[2]);
    }
    assert.ok(maxZ - minZ >= ship.length[0] && maxZ - minZ <= ship.length[1], `length ${maxZ - minZ}`);
    const a = ANCHORS[ship.key];
    assert.equal(a.nozzles.length, ship.nozzles); assert.equal(a.muzzles.length, ship.muzzles);
    assert.ok(a.rcs.length >= ship.rcs, 'rcs ports');
    for (const anchor of [...a.nozzles, ...a.muzzles, ...a.rcs]) {
      const node = json.nodes.find(n => n.name === anchor.name);
      assert.ok(node, `node ${anchor.name}`);
    }
    for (const n of a.nozzles) assert.ok(n.dir[2] > 0.95, 'nozzles exhaust to +Z');
    for (const m of a.muzzles) assert.ok(m.pos[2] < 0, 'muzzles ahead of centre');
  });
  test(`${ship.key}: RCS can push every axis and turn every way`, () => {
    const ports = ANCHORS[ship.key].rcs;
    const axes = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const axis of axes) {
      const linear = ports.filter(p => dot(scale([0,0,0], p.dir, -1), axis) > 0.5).length;
      const turning = ports.filter(p => {
        const t = normalize([0,0,0], cross([0,0,0], p.pos, scale([0,0,0], p.dir, -1)));
        return dot(t, axis) > 0.3;
      }).length;
      assert.ok(linear >= 2, `linear ${axis}: ${linear}`);
      assert.ok(turning >= 2, `turning ${axis}: ${turning}`);
    }
  });
}
```

- [ ] **Step 2: Run it; expect failure.**

- [ ] **Step 3: Write `build_ships.py`.** Model in Blender space (nose +Y, top +Z).

  **Fighter, about 14 m long:**
  - Fuselage: a bmesh loft through 9 cross-sections (rounded-rectangle
    profiles generated parametrically: width, height and corner radius per
    station along Y from −7 to +7). Add Bevel (0.04, 2 segments) and
    Weighted Normal modifiers.
  - Canopy: a UV sphere scaled `(0.9, 2.2, 0.7)`, intersected above the
    fuselage line (boolean), with a separate glass material.
  - Wings: an extruded tapered plate (root chord 5, tip chord 1.6,
    span 5.5 per side), swept 28° with 4° dihedral, mirrored. Gun pods
    are cylinders at the tips; barrels end at `muzzle_L` / `muzzle_R`.
  - Engines: two nacelle cylinders at the rear, with nozzle bells made by
    lathing a profile (screw modifier, then applied) and an emissive inner
    disc. Empties `nozzle_L` / `nozzle_R` sit at the exit, local −Y
    pointing back.
  - Greebles: 20–40 small boxes, vents and an antenna, placed from a
    seeded list on the hull surface (raycast onto the fuselage).
  - RCS: 12 empties named `rcs_01` to `rcs_12`, each with local +Z out of
    the hull: nose up, down, left and right; tail up, down, left and right;
    wingtip up and down left and right. Two forward-facing ports at the nose
    serve reverse thrust.
  - Paint, as a procedural node material:
    - off-white `#d9d6cf` panels and graphite `#2b2d31`, split by a
      position mask;
    - an orange stripe `#c8642a`;
    - panel lines from a Brick texture on UVs, scaled down, used as both
      a colour darkening and a bump;
    - edge wear from Pointiness (Cycles) as lighter metal;
    - grime from AO;
    - roughness 0.35–0.6 and metallic 0.2–0.6.
  - Bake on a Smart-UV joined mesh: base 2048, normal 2048, MR 1024,
    emissive 1024. Use selected-to-active from a bevel-subdivided high copy
    for normals; for the rest, a self-bake.

  **Interceptor, about 11 m:**
  - An angular wedge fuselage (bmesh, faceted, no subdivision) and a
    forward-swept split wing.
  - One large engine (`nozzle_C`) and two small side boosters (detail
    only, no anchor).
  - A red emissive sensor eye.
  - Gunmetal `#4a4f55`, oxblood `#5e1a1d` and hazard stripes.
  - Muzzles under the wing roots. At least 8 RCS ports.
  - Textures at 1024.

  **Export:**
  - Join each ship's meshes into one mesh object `hull`, plus a separate
    `glass` mesh if needed. Parent the empties to the `hull` origin.
  - Export with `export_glb`.
  - Then write `js/anchors.js`. For each empty, convert its world matrix
    from Blender to glTF space with `(x, y, z) → (x, z, −y)`:
    - position from the matrix translation;
    - `dir` from the empty's local +Z axis (for RCS) or local −Y (for
      nozzles), transformed by the same rule and normalised.
  - Write `radius` as the bounding radius of the hull.

- [ ] **Step 4: Build** (`build_all.py`) and open both ship previews. They must read as
  a sleek human fighter and a hostile, angular interceptor. Check that the
  panel lines and wear are visible and that nothing is inside-out (correct
  normals). Iterate on the shapes until both previews look good.

- [ ] **Step 5: `node tests/models-check.mjs`** → all pass (asteroids + ships).

- [ ] **Step 6: Write `assets/models/MODELS.md`.** Cover the generator command,
  the per-file triangle counts and sizes, the anchor naming and directions,
  and the Blender-to-glTF axis rule.

- [ ] **Step 7: Commit:** `meteora: Blender fighter and interceptor with exported anchors`.

---

### Task 4: Flight model

**Files:** Create `fun/meteora/js/flight.js` and `fun/meteora/tests/flight-check.mjs`.

**Interfaces:**
- Consumes `vec.js` and `config.js` (`PLAYER`, `STEP`).
- Produces:
  - `NEUTRAL_CONTROLS = { pitch:0, yaw:0, roll:0, strafe:0, lift:0,
    throttleDelta:0, throttleSet:null, throttleZero:false, boost:false,
    toggleFA:false }`. Signs: `pitch +1` = nose up; `yaw +1` = nose right;
    `roll +1` = roll right (right wing down); `strafe +1` = right;
    `lift +1` = up.
  - `createShip(stats, { pos, vel, q } = {})` → `{ stats, pos, vel, q,
    w /*local rad/s [pitch,yaw,roll] about +X,+Y,+Z*/, throttle:0,
    boost:capacity, boostIdle:0, boostLocked:false, fa:true,
    accelLocal:[0,0,0], alphaLocal:[0,0,0], afterburner:false,
    thrust:0 /*0..1 main engine*/ }`.
  - `stepShip(ship, controls, dt)`: mutates the ship and fills
    `accelLocal`, `alphaLocal`, `afterburner` and `thrust`.
  - `forward(o, ship)`, `up(o, ship)`, `right(o, ship)`: world axes.
  - `selectRcsPorts(ports, accelLocal, alphaLocal, stats)` →
    `[{ index, intensity /*0..1*/ }]`.

- [ ] **Step 1: Write the failing check**

```js
import { test, run, assert, near } from './harness.mjs';
import { createShip, stepShip, NEUTRAL_CONTROLS, selectRcsPorts, forward } from '../js/flight.js';
import { PLAYER, STEP as DT } from '../js/config.js';
import { qRotateInv, qRotate, qFromAxisAngle, len } from '../js/vec.js';

const ctl = (o = {}) => ({ ...NEUTRAL_CONTROLS, ...o });
const local = s => qRotateInv([0, 0, 0], s.q, s.vel);
function fly(s, c, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { stepShip(s, c, DT); each?.(s, i); }
}

test('FA on: full throttle converges on the forward target within main thrust', () => {
  const s = createShip(PLAYER); s.throttle = 1;
  let prev = local(s)[2];
  fly(s, ctl(), 10, s => { const z = local(s)[2]; assert.ok(prev - z <= PLAYER.accel.forward * DT + 1e-9); prev = z; });
  near(local(s)[2], -PLAYER.fa.forwardSpeed, 0.5);
});
test('throttle zero brakes to rest no faster than reverse thrust', () => {
  const s = createShip(PLAYER, { vel: [0, 0, -180] }); s.throttle = 1;
  let prev = 180;
  fly(s, ctl({ throttleZero: true }), 9.5, s => { const v = len(s.vel); assert.ok(prev - v <= PLAYER.accel.reverse * DT + 1e-9); prev = v; });
  assert.equal(s.throttle, 0);
  assert.ok(len(s.vel) < 0.5, `still ${len(s.vel)}`);
});
test('a 90° turn at speed leaves a slide that decays at the lateral limit', () => {
  const s = createShip(PLAYER, { vel: [0, 0, -150] }); s.throttle = 150 / 180;
  qFromAxisAngle(s.q, [0, 1, 0], -Math.PI / 2);   // nose now points +X; velocity is sideways
  let prev = Math.abs(local(s)[0]);
  fly(s, ctl(), 9, s => { const x = Math.abs(local(s)[0]); assert.ok(prev - x <= PLAYER.accel.lateral * DT + 1e-9); prev = x; });
  assert.ok(Math.abs(local(s)[0]) < 0.5);
  near(local(s)[2], -150, 0.5);
});
test('FA off with no input conserves velocity and spin', () => {
  const s = createShip(PLAYER, { vel: [3, -2, -50] }); s.fa = false; s.w = [0.2, 0, 0.5];
  const p0 = [...s.pos];
  fly(s, ctl(), 5);
  assert.deepEqual(s.vel.map(v => +v.toFixed(9)), [3, -2, -50]);
  assert.deepEqual(s.w.map(v => +v.toFixed(9)), [0.2, 0, 0.5]);
  near(s.pos[0] - p0[0], 15, 1e-6); near(s.pos[2] - p0[2], -250, 1e-6);
});
test('FA off: thrust keeps accelerating past the FA speed', () => {
  const s = createShip(PLAYER); s.fa = false; s.throttle = 1;
  fly(s, ctl(), 10);
  near(-local(s)[2], PLAYER.accel.forward * 10, 1);
});
test('afterburner: accel, drain, dry-out, regen delay and relock', () => {
  const s = createShip(PLAYER); s.throttle = 1;
  fly(s, ctl({ boost: true }), 1);
  near(len(s.vel), PLAYER.accel.boost, 1.5); near(s.boost, 75, 0.5); assert.equal(s.afterburner, true);
  fly(s, ctl({ boost: true }), 3.2);
  assert.equal(s.afterburner, false); near(s.boost, 0, 0.01);
  fly(s, ctl(), 1.2); near(s.boost, 0, 0.01);
  fly(s, ctl(), 1.0); near(s.boost, PLAYER.boost.regen * 0.9, 0.3);
  fly(s, ctl({ boost: true }), 0.1); assert.equal(s.afterburner, false, 'locked until 20');
});
test('afterburner raises the FA target to boost speed', () => {
  const s = createShip(PLAYER); s.throttle = 1;
  fly(s, ctl({ boost: true }), 3.9);
  assert.ok(-local(s)[2] > PLAYER.fa.forwardSpeed + 100);
});
test('FA on rotation: rate reached at angular accel, release stops it', () => {
  const s = createShip(PLAYER);
  let prev = 0;
  fly(s, ctl({ pitch: 1 }), 1, s => { assert.ok(s.w[0] - prev <= PLAYER.angAccel[0] * DT + 1e-9); prev = s.w[0]; });
  near(s.w[0], PLAYER.rate[0], 0.01);
  fly(s, ctl(), 0.6);
  near(s.w[0], 0, 0.01);
});
test('control signs: pitch up, yaw right, roll right', () => {
  const nose = s => forward([0, 0, 0], s);
  let s = createShip(PLAYER); fly(s, ctl({ pitch: 1 }), 0.4); assert.ok(nose(s)[1] > 0.1);
  s = createShip(PLAYER); fly(s, ctl({ yaw: 1 }), 0.4); assert.ok(nose(s)[0] > 0.1);
  s = createShip(PLAYER); fly(s, ctl({ roll: 1 }), 0.4);
  assert.ok(qRotate([0, 0, 0], s.q, [1, 0, 0])[1] < -0.1);
});
test('FA off: spin persists after the stick is released', () => {
  const s = createShip(PLAYER); s.fa = false;
  fly(s, ctl({ roll: 1 }), 0.5);
  const spin = s.w[2];
  near(spin, -PLAYER.angAccel[2] * 0.5, 0.05);
  fly(s, ctl(), 2);
  near(s.w[2], spin, 1e-9);
});
test('the quaternion stays normalised through a minute of tumbling', () => {
  const s = createShip(PLAYER); s.fa = false; s.w = [1.3, -0.7, 2.1];
  fly(s, ctl(), 60);
  near(Math.hypot(...s.q), 1, 1e-9);
});
test('throttle ramps at its rate and clamps; toggleFA flips once', () => {
  const s = createShip(PLAYER);
  fly(s, ctl({ throttleDelta: 1 }), 1); near(s.throttle, 0.6, 0.01);
  fly(s, ctl({ throttleDelta: 1 }), 3); near(s.throttle, 1, 1e-9);
  fly(s, ctl({ throttleDelta: -1 }), 5); near(s.throttle, PLAYER.throttle.min, 1e-9);
  stepShip(s, ctl({ toggleFA: true }), DT); assert.equal(s.fa, false);
  stepShip(s, ctl({ throttleSet: 0.5 }), DT); near(s.throttle, 0.5, 1e-9);
});
test('selectRcsPorts fires the ports that push the commanded way', () => {
  const ports = [
    { pos: [0, 0, -5], dir: [0, 1, 0] }, { pos: [0, 0, -5], dir: [0, -1, 0] },
    { pos: [3, 0, 0], dir: [1, 0, 0] }, { pos: [-3, 0, 0], dir: [-1, 0, 0] },
  ];
  assert.deepEqual(selectRcsPorts(ports, [0, 0, 0], [-3, 0, 0], PLAYER).map(f => f.index), [0]);
  assert.deepEqual(selectRcsPorts(ports, [10, 0, 0], [0, 0, 0], PLAYER).map(f => f.index), [3]);
  assert.equal(selectRcsPorts(ports, [0, 0, -45], [0, 0, 0], PLAYER).length, 0, 'main engine needs no RCS');
  for (const f of selectRcsPorts(ports, [22, 0, 0], [0, 0, 0], PLAYER)) assert.ok(f.intensity > 0 && f.intensity <= 1);
});
await run();
```

- [ ] **Step 2: Run it; expect failure.**

- [ ] **Step 3: Implement `flight.js`** as specified in §6. The core of the step:

```js
export function stepShip(ship, c, dt) {
  const S = ship.stats;
  if (c.toggleFA) ship.fa = !ship.fa;
  if (c.throttleSet != null) ship.throttle = c.throttleSet;
  else if (c.throttleZero) ship.throttle = 0;
  else ship.throttle += c.throttleDelta * S.throttle.rampPerSecond * dt;
  ship.throttle = clamp(ship.throttle, S.throttle.min, 1);

  // Afterburner energy: drain while burning, regen after a quiet delay, relock at empty.
  const burning = c.boost && !ship.boostLocked && ship.boost > 0;
  if (burning) {
    ship.boost = Math.max(0, ship.boost - S.boost.drain * dt); ship.boostIdle = 0;
    if (ship.boost === 0) ship.boostLocked = true;
  } else {
    ship.boostIdle += dt;
    if (ship.boostIdle >= S.boost.regenDelay) ship.boost = Math.min(S.boost.capacity, ship.boost + S.boost.regen * dt);
    if (ship.boostLocked && ship.boost >= S.boost.relock) ship.boostLocked = false;
  }
  ship.afterburner = burning;

  const vL = qRotateInv(tmpA, ship.q, ship.vel);
  const a = ship.accelLocal, A = S.accel;
  const fwdMax = burning ? A.boost : A.forward;
  if (ship.fa) {
    const target = burning ? S.fa.boostSpeed : ship.throttle * S.fa.forwardSpeed;
    a[0] = clamp((c.strafe * S.fa.strafeSpeed - vL[0]) / S.fa.tau, -A.lateral, A.lateral);
    a[1] = clamp((c.lift * S.fa.strafeSpeed - vL[1]) / S.fa.tau, -A.lateral, A.lateral);
    a[2] = clamp((-target - vL[2]) / S.fa.tau, -fwdMax, A.reverse);
  } else {
    a[0] = c.strafe * A.lateral; a[1] = c.lift * A.lateral;
    a[2] = burning ? -A.boost
      : ship.throttle >= 0 ? -ship.throttle * A.forward : (ship.throttle / S.throttle.min) * A.reverse;
  }
  // `cmd` is the commanded body rate [pitch, yaw, roll] from the sign rules.
  const cmd = [c.pitch * S.rate[0], -c.yaw * S.rate[1], -c.roll * S.rate[2]];
  for (let i = 0; i < 3; i++) {
    const alpha = ship.fa
      ? clamp((cmd[i] - ship.w[i]) / S.fa.tauAngular, -S.angAccel[i], S.angAccel[i])
      : (i === 0 ? c.pitch : i === 1 ? -c.yaw : -c.roll) * S.angAccel[i];
    ship.alphaLocal[i] = alpha;
    ship.w[i] = clamp(ship.w[i] + alpha * dt, -S.rate[i] * S.spinCap, S.rate[i] * S.spinCap);
  }
  ship.thrust = Math.max(0, -a[2]) / A.forward;
  addScaled(ship.vel, ship.vel, qRotate(tmpB, ship.q, a), dt);   // semi-implicit Euler
  addScaled(ship.pos, ship.pos, ship.vel, dt);
  qIntegrate(ship.q, ship.w, dt);
}
```

  Two details the tests pin:
  - The convergence exactly hits its target, because the clamp never
    overshoots: with τ = 0.25 s and dt = 1/120, `a·dt = (target−v)/30`
    approaches asymptotically. Use `tau = max(S.fa.tau, dt)`.
  - The deceleration bound in the "throttle zero" test holds per axis.

  `selectRcsPorts`:

```js
// The main engine owns forward thrust (−Z); RCS covers lateral, vertical, reverse and torque.
export function selectRcsPorts(ports, accel, alpha, S) {
  const lin = [accel[0], accel[1], Math.max(0, accel[2])];
  const linMag = len(lin), angMag = len(alpha), out = [];
  if (linMag < 1e-6 && angMag < 1e-6) return out;
  normalize(lin, lin); const ang = normalize([0, 0, 0], alpha);
  ports.forEach((p, index) => {
    const push = scale(t1, p.dir, -1);
    const torque = normalize(t2, cross(t2, p.pos, push));
    const l = linMag > 1e-6 ? dot(push, lin) * Math.min(1, linMag / S.accel.lateral) : 0;
    const r = angMag > 1e-6 ? dot(torque, ang) * Math.min(1, angMag / Math.max(...S.angAccel)) : 0;
    const intensity = Math.min(1, Math.max(l, r));
    if (intensity > 0.15 && (l > 0.5 * Math.min(1, linMag / S.accel.lateral) || r > 0.3 * Math.min(1, angMag / Math.max(...S.angAccel))))
      out.push({ index, intensity });
  });
  return out;
}
```

- [ ] **Step 4: Run `node tests/flight-check.mjs`** → `13 passed`. If a numeric bound fails, fix the model, not the bound.

- [ ] **Step 5: Commit:** `meteora: Newtonian flight with flight assist and RCS port selection`.

---

### Task 5: The asteroid belt (generation, hash, collision, destruction)

**Files:** Create `fun/meteora/js/field.js` and `fun/meteora/tests/field-check.mjs`.

**Interfaces:**
- Consumes `vec`, `rng` and `config` (`FIELD`).
- Produces:
  - `densityAt(x,y,z,seed)` → [0,1], the same field the shake uses.
  - `generateBelt(seed, cfg=FIELD)` → `{ count, type:Uint8Array,
    landmark:Uint8Array, pos:Float32Array(3n), scale:Float32Array,
    radius:Float32Array /*bounding*/, collide:Float32Array /*0.85·radius*/,
    axis:Float32Array(3n), spin:Float32Array, phase:Float32Array }`.
  - `createField(seed, cfg=FIELD)` → field, with:
    - `belt`, `alive:Uint8Array`, `hp:Float32Array`, `dynamic:[]`;
    - `queryRadius(p, r, out=[])` → refs `{ kind:'static'|'dynamic',
      index, pos, radius }`, alive only;
    - `sweepSphere(p0, p1, r)` → `{ t, ref, point, normal }` or null (the
      first hit along the segment);
    - `damageRock(ref, amount, point, impulse, events)` → `'destroyed'`,
      `'damaged'` or `'immune'`;
    - `addDynamicRock(type, pos, vel)` → dynamic rock;
    - `step(dt, events)`;
    - `reset()`.
  - A dynamic rock is `{ id, type, pos, vel, q, w, radius, collide, hp,
    born }`.
  - Events emitted:
    - `{ type:'rockBreak', rockType, pos, radius, vel }`;
    - `{ type:'staticRockRemoved', index }`;
    - `{ type:'dynamicRockRemoved', id }`;
    - `{ type:'rockImpact', pos, normal }`, for immune rocks.

- [ ] **Step 1: Write the failing check**

```js
import { test, run, assert, near } from './harness.mjs';
import { generateBelt, createField, densityAt } from '../js/field.js';
import { FIELD } from '../js/config.js';
import { makeRng } from '../js/rng.js';
import { dist, len } from '../js/vec.js';

const SEED = 1234;
const field = createField(SEED);
const b = field.belt;
const P = i => [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]];
const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };

test('the same seed gives the identical belt, another seed does not', () => {
  const again = generateBelt(SEED);
  assert.deepEqual(again.pos, b.pos); assert.deepEqual(again.type, b.type); assert.deepEqual(again.scale, b.scale);
  assert.notDeepEqual(generateBelt(SEED + 1).pos.slice(0, 30), b.pos.slice(0, 30));
});
test('counts per type match the config', () => {
  const counts = [0, 0, 0, 0, 0]; let landmarks = 0;
  for (let i = 0; i < b.count; i++) { counts[b.type[i]]++; landmarks += b.landmark[i]; }
  FIELD.types.forEach((t, k) => assert.equal(counts[k], t.count + (k === 4 ? FIELD.landmarks.count : 0), `type ${k}`));
  assert.equal(landmarks, FIELD.landmarks.count);
});
test('no two rocks overlap (central 1.5 km cube brute force, plus all big rocks)', () => {
  const ids = [];
  for (let i = 0; i < b.count; i++) { const p = P(i); if (Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) < 750 || b.radius[i] > 30) ids.push(i); }
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
    const i = ids[x], j = ids[y];
    assert.ok(dist(P(i), P(j)) >= (b.radius[i] + b.radius[j]) * FIELD.gap - 1e-3, `rocks ${i} and ${j} overlap`);
  }
});
test('the spawn sphere is clear', () => {
  for (let i = 0; i < b.count; i++) assert.ok(dist(P(i), FIELD.spawn) - b.radius[i] >= FIELD.spawnClear);
});
test('radius queries agree with brute force', () => {
  const r = makeRng(9);
  for (let q = 0; q < 200; q++) {
    const p = [r.range(-4000, 4000), r.range(-1000, 1000), r.range(-4000, 4000)], rad = r.range(20, 400);
    const got = field.queryRadius(p, rad).filter(h => h.kind === 'static').map(h => h.index).sort((a, c) => a - c);
    const want = [];
    for (let i = 0; i < b.count; i++) if (dist(P(i), p) < rad + b.collide[i]) want.push(i);
    assert.deepEqual(got, want);
  }
});
test('sweepSphere returns the first rock along a segment', () => {
  const r = makeRng(11);
  for (let k = 0; k < 50; k++) {
    const p0 = [r.range(-3000, 3000), r.range(-800, 800), r.range(-3000, 3000)];
    const p1 = [p0[0] + r.range(-800, 800), p0[1] + r.range(-200, 200), p0[2] + r.range(-800, 800)];
    const hit = field.sweepSphere(p0, p1, 0.3);
    let best = Infinity, bestI = -1;
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    for (let i = 0; i < b.count; i++) {   // brute-force segment–sphere
      const c = P(i), R = b.collide[i] + 0.3;
      const m = [p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]];
      const A = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, B = 2 * (m[0] * d[0] + m[1] * d[1] + m[2] * d[2]), C = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 - R * R;
      const disc = B * B - 4 * A * C; if (disc < 0) continue;
      const t = C <= 0 ? 0 : (-B - Math.sqrt(disc)) / (2 * A);
      if (t >= 0 && t <= 1 && t < best) { best = t; bestI = i; }
    }
    if (bestI < 0) assert.equal(hit, null);
    else { assert.equal(hit.ref.index, bestI); near(hit.t, best, 1e-6); }
  }
});
test('density is in [0,1] and vanishes outside the slab', () => {
  for (let i = 0; i < 500; i++) { const d = densityAt(i * 13 - 3000, (i % 7) * 100, i * 7 - 2000, SEED); assert.ok(d >= 0 && d <= 1); }
  assert.equal(densityAt(0, 3000, 0, SEED), 0);
  assert.equal(densityAt(9000, 0, 0, SEED), 0);
});
test('a type-3 rock splits into 2–3 type-2 rocks whose centre of mass carries the impulse', () => {
  const f = createField(SEED);
  const i = [...f.belt.type].findIndex(t => t === 2);
  const ref = { kind: 'static', index: i, pos: P(i) };
  const events = [];
  const M = f.belt.radius[i] ** 3, impulse = [0, 0, -5 * M];
  let result;
  while ((result = f.damageRock(ref, 50, P(i), impulse, events)) === 'damaged');
  assert.equal(result, 'destroyed');
  assert.ok(f.dynamic.length >= 2 && f.dynamic.length <= 3);
  assert.ok(f.dynamic.every(r => r.type === 1));
  let m = 0; const mv = [0, 0, 0];
  for (const r of f.dynamic) { const w = r.radius ** 3; m += w; for (let k = 0; k < 3; k++) mv[k] += w * r.vel[k]; }
  near(mv[2] / m, -5, 1e-6); near(mv[0] / m, 0, 1e-6); near(mv[1] / m, 0, 1e-6);
  assert.ok(!f.queryRadius(P(i), 0.1).some(h => h.kind === 'static' && h.index === i), 'parent gone');
  assert.ok(events.some(e => e.type === 'rockBreak') && events.some(e => e.type === 'staticRockRemoved' && e.index === i));
});
test('type-1 rocks crumble without children; types 4–5 are immune', () => {
  const f = createField(SEED); const events = [];
  const small = [...f.belt.type].findIndex(t => t === 0);
  while (f.damageRock({ kind: 'static', index: small }, 100, P(small), [0, 0, 0], events) === 'damaged');
  assert.equal(f.dynamic.length, 0);
  const big = [...f.belt.type].findIndex(t => t === 4);
  assert.equal(f.damageRock({ kind: 'static', index: big }, 1e9, P(big), [0, 0, 0], events), 'immune');
  assert.ok(events.some(e => e.type === 'rockImpact'));
});
test('dynamic rocks are capped and the oldest crumble first', () => {
  const f = createField(SEED, EMPTY); const events = [];
  for (let k = 0; k < 80; k++) f.addDynamicRock(0, [k * 10, 0, 0], [0, 0, 0]);
  assert.equal(f.dynamic.length, FIELD.maxDynamic);
  assert.equal(Math.min(...f.dynamic.map(r => r.id)), 80 - FIELD.maxDynamic);
});
test('reset restores destroyed rocks and clears dynamic ones', () => {
  const f = createField(SEED); const events = [];
  const ids = [...f.belt.type].map((t, i) => [t, i]).filter(([t]) => t === 1).slice(0, 20).map(([, i]) => i);
  for (const i of ids) while (f.damageRock({ kind: 'static', index: i }, 100, P(i), [0, 0, 0], events) === 'damaged');
  assert.ok(f.dynamic.length > 0);
  f.reset();
  assert.equal(f.dynamic.length, 0);
  for (const i of ids) assert.ok(f.queryRadius(P(i), 0.1).some(h => h.kind === 'static' && h.index === i));
  assert.ok(f.alive.every(a => a === 1));
});
test('queries 1 000 km out return nothing, fast', () => {
  const t0 = performance.now();
  assert.deepEqual(field.queryRadius([1e6, 0, -1e6], 500), []);
  assert.equal(field.sweepSphere([1e6, 0, 0], [1e6 + 1000, 0, 0], 1), null);
  assert.ok(performance.now() - t0 < 50);
});
test('dynamic rocks drift and bounce off static rocks', () => {
  const f = createField(SEED); const events = [];
  const big = [...f.belt.type].findIndex(t => t === 3);
  const c = P(big), R = f.belt.collide[big];
  const r = f.addDynamicRock(0, [c[0] + R + 20, c[1], c[2]], [-20, 0, 0]);
  for (let k = 0; k < 240; k++) f.step(1 / 120, events);
  assert.ok(r.vel[0] > 0, 'bounced away');
  assert.ok(dist(r.pos, c) >= R + r.collide - 1e-6);
});
await run();
```

- [ ] **Step 2: Run it; expect failure.**

- [ ] **Step 3: Implement `field.js`.**
  - **Density:** `d = smoothstep(0.05, 0.55, 0.5 + 0.5·fbm3(x/1800, y/900, z/1800, seed))`
    multiplied by the slab falloff. The falloff is
    `1 − smoothstep(0.65, 1, |y| / (half[1] · (0.8 + 0.2·noise)))`, and the
    same with smoothstep(0.8, 1, …) on x and z. Return 0 outside the box.
  - **Generation:**
    - Place types 5, then 4, then the landmarks (at fixed seeded points
      2–3.5 km out, never within 900 m of the spawn), then 3, 2 and 1.
    - Each candidate is uniform in the slab and accepted with probability
      `density^1.5`, and only if it fits: no overlap at `gap` against the
      hash and the big list, and it clears the spawn sphere.
    - Retry until the count is met; throw after 400 × count attempts.
  - **Hash:**
    - Cell 100 m. Key `((ix+32768)·65536 + (iy+32768))·65536 + (iz+32768)`.
    - Rocks with radius > 300 m go in a separate `big` list, checked by
      brute force.
    - Each rock is inserted into every cell its collide-sphere overlaps.
    - Queries dedupe with a stamp array.
  - **`sweepSphere`:** walk the cells the segment's AABB (inflated by r)
    covers. If the segment is longer than 2 km, sample along it in 100 m
    hops instead. Check the big list and the dynamic rocks too.
  - **HP:** `5·r^1.5` for types 0–2 and `Infinity` otherwise.
  - **Splitting:**
    - Children are 2–3 type-1 rocks (from type 2) or 2–4 type-0 rocks
      (from type 1), placed inside the parent's radius at random offsets.
    - Their velocities are `parentVel + impulse/M_parent + u_i`, with
      `u_i` outward at 2–8 m/s, then corrected so that `Σ m_i u_i = 0`.
      Masses ∝ r³.
    - Over the cap, remove the oldest with a `rockBreak` event (a crumble,
      no children).
  - **`step`:** integrate dynamic rocks. Against static rocks, push them
    out and reflect the normal velocity with restitution 0.5.
  - **`reset`:** set `alive` to 1 and `hp` to full, re-insert the removed
    statics, and clear `dynamic`.

- [ ] **Step 4: Run `node tests/field-check.mjs`** → `13 passed`. Generation must take < 1.5 s in Node; print the time.

- [ ] **Step 5: Commit:** `meteora: seeded asteroid belt with spatial hash and destruction`.

---

### Task 6: Weapons

**Files:** Create `fun/meteora/js/weapons.js` and `fun/meteora/tests/weapons-check.mjs`.

**Interfaces:**
- Consumes `vec`, `config` (`CANNON`, `ENEMY_CANNON`, `MISSILE`), the `field` API and the flight `forward()`.
- Produces:
  - `createWeapons()` → `{ bolts:[], missiles:[], nextId:1 }`.
  - `createGun(params)` → `{ params, heat:0, overheated:false, cooldown:0, muzzle:0 }`.
  - `triggerGun(gun, firing, dt)` → number of shots this step (0 or 1).
  - `fireBolt(weapons, shooter, muzzleLocal, params)`. `shooter` is an
    entity `{ id, team, ship }`. Pushes and returns `{ id, team, ownerId,
    pos, vel, life, damage, radius }`.
  - `createLock()` → `{ targetId:null, progress:0, locked:false }`.
  - `updateLock(lock, shooterShip, target /*entity|null*/, dt)`.
  - `launchMissile(weapons, shooter, launcherLocal, targetId|null)`.
  - `stepWeapons(weapons, ctx, dt)`, where `ctx = { field, entities,
    events, damage(entity, amount, point, dir) }` and `entities` are
    `{ id, team, ship, radius, alive }`. It emits:
    - `boltHit { pos, normal, kind:'rock'|'ship', team, targetId? }`;
    - `missileExplode { pos, targetId? }`;
    - `missileExpire { pos }`.
  - `leadPoint(o, shooterPos, shooterVel, targetPos, targetVel, speed)` → `o` or null.
  - `blastDamage(d)` → `80·(1 − d/30)`, clamped at 0.
  - `guidanceAccel(o, mPos, mVel, tPos, tVel, N, maxA)` (ZEM form).

- [ ] **Step 1: Write the failing check**

```js
import { test, run, assert, near, finite } from './harness.mjs';
import { createWeapons, createGun, triggerGun, fireBolt, createLock, updateLock, launchMissile,
  stepWeapons, leadPoint, blastDamage } from '../js/weapons.js';
import { createShip } from '../js/flight.js';
import { createField } from '../js/field.js';
import { CANNON, MISSILE, PLAYER, ENEMY, FIELD, STEP as DT } from '../js/config.js';
import { qLookRotation, dist, len, sub, normalize } from '../js/vec.js';

const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };
function ctxWith(entities = []) {
  const events = [], damage = [];
  return { field: createField(1, EMPTY), entities, events, damageLog: damage,
    damage(entity, amount, point, dir) { damage.push({ id: entity.id, amount }); } };
}
const player = (o = {}) => ({ id: 1, team: 0, alive: true, radius: PLAYER.radius, ship: createShip(PLAYER, o) });
const target = (pos, vel = [0, 0, 0]) => ({ id: 2, team: 1, alive: true, radius: ENEMY.radius, ship: createShip(ENEMY, { pos, vel }) });

test('bolts inherit the shooter velocity', () => {
  const w = createWeapons(); const p = player({ vel: [30, 0, -100] });
  const bolt = fireBolt(w, p, [0, 0, -7], CANNON);
  near(bolt.vel[0], 30, 1e-9); near(bolt.vel[2], -1100, 1e-9);
});
test('a 1000 m/s bolt does not tunnel through a 1.5 m rock', () => {
  const w = createWeapons(); const ctx = ctxWith([]);
  const rock = ctx.field.addDynamicRock(0, [0, 0, -500], [0, 0, 0]);
  const hp0 = rock.hp;
  fireBolt(w, player(), [0, 0, 0], CANNON);
  for (let i = 0; i < 120; i++) stepWeapons(w, ctx, DT);
  assert.ok(ctx.events.some(e => e.type === 'boltHit' && e.kind === 'rock'));
  assert.equal(w.bolts.length, 0);
  assert.ok(rock.hp < hp0 || !ctx.field.dynamic.includes(rock));
});
test('gun heat locks at 100 and releases at 40', () => {
  const g = createGun(CANNON); let t = 0, shots = 0, sawLock = false, firedWhileLocked = false;
  while (t < 8) { const n = triggerGun(g, true, DT); if (g.overheated) { sawLock = true; if (n) firedWhileLocked = true; } shots += n; t += DT; }
  assert.ok(sawLock && !firedWhileLocked);
  for (let i = 0; i < 120 * 3 && g.overheated; i++) triggerGun(g, false, DT);
  assert.equal(g.overheated, false); assert.ok(g.heat <= CANNON.releaseAt + 1e-9);
  near(shots / 8, CANNON.rate * 0.5, CANNON.rate * 0.45, 'fires a lot but not while locked');
});
test('guns alternate muzzles at the configured rate', () => {
  const g = createGun(CANNON); let shots = 0; const muzzles = [];
  for (let i = 0; i < 120; i++) if (triggerGun(g, true, DT)) { shots++; muzzles.push(g.muzzle); }
  near(shots, CANNON.rate, 1);
  assert.notEqual(muzzles[0], muzzles[1]);
});
test('lock needs 0.8 s inside 15° and 3 km, and resets when lost', () => {
  const p = player(); const lock = createLock();
  const ahead = target([0, 0, -1000]);
  for (let i = 0; i < Math.round(0.7 / DT); i++) updateLock(lock, p.ship, ahead, DT);
  assert.equal(lock.locked, false);
  for (let i = 0; i < Math.round(0.15 / DT); i++) updateLock(lock, p.ship, ahead, DT);
  assert.equal(lock.locked, true);
  const off = target([Math.tan(20 * Math.PI / 180) * 1000, 0, -1000]);
  updateLock(lock, p.ship, off, DT); assert.equal(lock.locked, false); assert.equal(lock.progress, 0);
  const far = target([0, 0, -3500]); const l2 = createLock();
  for (let i = 0; i < 240; i++) updateLock(l2, p.ship, far, DT);
  assert.equal(l2.locked, false);
});
for (const [name, start, vel] of [
  ['head-on 2 km', [0, 0, -2000], [0, 0, 150]],
  ['crossing 1.5 km', [-600, 0, -1500], [200, 0, 0]],
  ['tail chase 1.2 km', [0, 0, -1200], [0, 0, -200]],
]) {
  test(`PN missile hits a 3 g turning target: ${name}`, () => {
    const p = player(); const t = target(start, vel); const ctx = ctxWith([p, t]); const w = createWeapons();
    launchMissile(w, p, [0, -1, -3], t.id);
    const g = 3 * 9.81, speed = len(vel); let hit = false;
    for (let i = 0; i < Math.round(MISSILE.life / DT) && !hit; i++) {
      // Turn the target: centripetal accel g, perpendicular to its velocity in the XY-plane-ish.
      const v = t.ship.vel, perp = normalize([0, 0, 0], [-v[2], 0.3 * speed, v[0]]);
      for (let k = 0; k < 3; k++) { v[k] += perp[k] * g * DT; }
      const s = speed / len(v); for (let k = 0; k < 3; k++) { v[k] *= s; t.ship.pos[k] += v[k] * DT; }
      stepWeapons(w, ctx, DT);
      hit = ctx.events.some(e => e.type === 'missileExplode' && e.targetId === t.id);
    }
    assert.ok(hit, 'missile hit');
    assert.ok(ctx.damageLog.some(d => d.id === t.id && d.amount >= MISSILE.damage * (1 - MISSILE.fuse / MISSILE.blast) - 1e-9));
  });
}
test('blast damage falls off linearly to zero at 30 m', () => {
  near(blastDamage(0), 80, 1e-9); near(blastDamage(15), 40, 1e-9); assert.equal(blastDamage(30), 0); assert.equal(blastDamage(45), 0);
});
test('a missile whose target dies flies on, finite, and expires', () => {
  const p = player(); const t = target([0, 0, -2500]); const ctx = ctxWith([p, t]); const w = createWeapons();
  launchMissile(w, p, [0, 0, -3], t.id);
  for (let i = 0; i < 120; i++) stepWeapons(w, ctx, DT);
  t.alive = false;
  const m = w.missiles[0]; const before = [...m.pos];
  for (let i = 0; i < 240; i++) stepWeapons(w, ctx, DT);
  finite([...m.pos, ...m.vel]);
  assert.ok(dist(m.pos, before) > 100);
  for (let i = 0; i < Math.round(MISSILE.life / DT); i++) stepWeapons(w, ctx, DT);
  assert.equal(w.missiles.length, 0);
  assert.ok(ctx.events.some(e => e.type === 'missileExpire'));
});
test('leadPoint solves the intercept and refuses the impossible', () => {
  const lead = leadPoint([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, -1000], [100, 0, 0], 1000);
  const t = len(lead) / 1000;
  near(dist(lead, [100 * t, 0, -1000]), 0, 0.01);
  assert.equal(leadPoint([0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, -1000], [0, 0, -2000], 1000), null);
});
await run();
```

- [ ] **Step 2: Run it; expect failure.**

- [ ] **Step 3: Implement `weapons.js`.**
  - **Gun:** each step `heat = max(0, heat − cool·dt)`.
    - If overheated and `heat ≤ releaseAt`, clear the overheat.
    - `cooldown −= dt`. If firing, not overheated and `cooldown ≤ 0`:
      `cooldown += 1/rate` (when idle, `cooldown = max(cooldown, 0)`),
      `heat += heatPerShot`, `muzzle ^= 1`, and return 1.
    - If `heat ≥ lockAt`, set the overheat.
  - **Bolt step:** `prev = pos`, `pos += vel·dt`.
    - Hit test: `field.sweepSphere(prev, pos, r)` and segment–sphere tests
      against entities of the other team. The nearest t wins.
    - On a rock: `field.damageRock(ref, damage, point, vel·0.05·mass-ish
      impulse = normalize(vel)·damage·2, events)`.
    - On a ship: `ctx.damage(entity, damage, point, dir)`.
    - Then emit `boltHit` and remove the bolt.
  - **Missile:**
    - Starts at `{ pos, vel: ship.vel + fwd·launchKick, frameVel:
      ship.vel copy, age:0, targetId, heading: fwd }`.
    - Each step: `age += dt`. Look up the target by id among the alive
      entities; if it is missing, set `targetId = null` (ballistic).
    - When `age > ignition` and `|vel − frameVel| < maxSpeed`, add
      `heading·accel`.
    - With a target: `a_g = guidanceAccel(…, navGain, maxLateral)`,
      removing the component along the heading. `vel += a_g·dt`. Then
      `heading = normalize(vel − frameVel)`, or keep the previous heading
      when that is ~0.
    - Fuse: within `fuse` of any enemy-team entity, or a sweep hit on a
      rock or ship. Explode: apply `blastDamage(d)` to every entity within
      `blast`, and to rocks via `queryRadius`.
    - At `age ≥ life`: explode with the same blast and emit
      `missileExpire`.
  - **ZEM guidance:** `r = tPos − mPos`, `vr = tVel − mVel`,
    `Vc = −dot(r, vr)/|r|`.
    - If `Vc ≤ 1`, use pure pursuit: `a = maxA ·` the perpendicular part
      of the line of sight relative to the heading.
    - Otherwise `tgo = |r|/Vc`, `ZEM = r + vr·tgo`,
      `a = N·(ZEM − (ZEM·r̂)r̂)/tgo²`.
    - Clamp `|a|` to `maxA`. Every normalise is zero-safe.
  - **Lead:** solve `|r + vr t| = s t`, where `vr = tVel − shooterVel`, for
    the smallest positive t (a quadratic). Return
    `targetPos + (tVel − shooterVel)·t + shooterPos·0`, a relative frame,
    so add the shooter position. Return null when there is no positive
    root.

- [ ] **Step 4: Run `node tests/weapons-check.mjs`** → `11 passed`.

- [ ] **Step 5: Commit:** `meteora: plasma cannons, missile lock and ZEM guidance`.

---

### Task 7: Enemy AI

**Files:** Create `fun/meteora/js/ai.js` and `fun/meteora/tests/ai-check.mjs`.

**Interfaces:**
- Consumes `flight` (`NEUTRAL_CONTROLS`, `forward`), `weapons` (`leadPoint`), `field` (`sweepSphere`) and `rng`.
- Produces:
  - `createBrain(seed)` → `{ state:'approach', timer:0, rng, burst:0,
    pause:0, jink:[0,0,0], think:0, breakDir:null, lastControls }`.
  - `thinkEnemy(brain, me /*entity*/, ctx, dt)` → controls: a
    `NEUTRAL_CONTROLS` shape plus `fire:boolean`.
  - `ctx = { field, player /*entity*/, threat:{ locked:boolean,
    missileInbound:boolean }, wasHit:boolean }`.
  - Decisions are made at 20 Hz (`think` accumulator), and the last
    controls are held in between.
  - States: `'approach'|'attack'|'breakoff'|'evade'`.

- [ ] **Step 1: Write the failing check**

```js
import { test, run, assert, finite } from './harness.mjs';
import { createBrain, thinkEnemy } from '../js/ai.js';
import { createShip, stepShip, forward } from '../js/flight.js';
import { createField, densityAt } from '../js/field.js';
import { leadPoint } from '../js/weapons.js';
import { ENEMY, PLAYER, ENEMY_CANNON, FIELD, STEP as DT } from '../js/config.js';
import { dist, dot, normalize, sub, qLookRotation } from '../js/vec.js';

const EMPTY = { ...FIELD, types: FIELD.types.map(t => ({ ...t, count: 0 })), landmarks: { ...FIELD.landmarks, count: 0 } };
const ent = (id, team, stats, o) => ({ id, team, stats, radius: stats.radius, alive: true, ship: createShip(stats, o) });
function sim(enemy, ctx, seconds, each) {
  const brain = enemy.brain ?? (enemy.brain = createBrain(5));
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const c = thinkEnemy(brain, enemy, ctx, DT);
    stepShip(enemy.ship, c, DT); each?.(c, brain, i);
  }
}
const calm = { locked: false, missileInbound: false };

test('an enemy closes from 3 km into an attack run', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY, { pos: [0, 0, -3000] });
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  let attacked = false, closest = Infinity;
  sim(e, ctx, 30, (c, b) => { attacked ||= b.state === 'attack'; closest = Math.min(closest, dist(e.ship.pos, p.ship.pos)); });
  assert.ok(attacked); assert.ok(closest < 1200);
});
test('it fires only inside the angle and range gates', () => {
  const p = ent(1, 0, PLAYER, { vel: [40, 0, 0] }), e = ent(2, 1, ENEMY, { pos: [300, 200, -2500] });
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  let shots = 0;
  sim(e, ctx, 60, c => {
    for (let k = 0; k < 3; k++) p.ship.pos[k] += p.ship.vel[k] * DT;
    if (!c.fire) return;
    shots++;
    const lead = leadPoint([0, 0, 0], e.ship.pos, e.ship.vel, p.ship.pos, p.ship.vel, ENEMY_CANNON.speed);
    assert.ok(lead, 'lead exists');
    const to = normalize([0, 0, 0], sub([0, 0, 0], lead, e.ship.pos));
    assert.ok(Math.acos(Math.min(1, dot(to, forward([0, 0, 0], e.ship)))) <= 4 * Math.PI / 180 + 1e-6, 'angle gate');
    assert.ok(dist(e.ship.pos, p.ship.pos) <= 1200, 'range gate');
  });
  assert.ok(shots > 0, 'it did shoot');
});
test('it breaks off inside 150 m', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY, { pos: [0, 0, -140], vel: [0, 0, 150] });
  qLookRotation(e.ship.q, [0, 0, 1], [0, 1, 0]);
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  e.brain = createBrain(5); e.brain.state = 'attack';
  let broke = false; sim(e, ctx, 0.2, (c, b) => { broke ||= b.state === 'breakoff'; });
  assert.ok(broke);
});
test('it evades and burns when a missile is inbound', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY, { pos: [0, 0, -800] });
  const ctx = { field: createField(1, EMPTY), player: p, threat: { locked: true, missileInbound: true }, wasHit: false };
  let evaded = false, burned = false; sim(e, ctx, 0.5, (c, b) => { evaded ||= b.state === 'evade'; burned ||= c.boost; });
  assert.ok(evaded && burned);
});
test('a minute in the densest cell without touching a rock', () => {
  const field = createField(1234);
  let best = -1, at = null;
  for (let x = -3500; x <= 3500; x += 500) for (let z = -3500; z <= 3500; z += 500) {
    const d = densityAt(x, 0, z, 1234); if (d > best && Math.hypot(x, z) > 600) { best = d; at = [x, 0, z]; }
  }
  const clear = p => field.queryRadius(p, ENEMY.radius + 30).length === 0;
  let start = null;
  for (let k = 0; k < 400 && !start; k++) { const p = [at[0] + (k % 20) * 40 - 400, 0, at[2] + Math.floor(k / 20) * 40 - 400]; if (clear(p)) start = p; }
  const p = ent(1, 0, PLAYER, { pos: [at[0] + 1500, 0, at[2]] }), e = ent(2, 1, ENEMY, { pos: start });
  const ctx = { field, player: p, threat: calm, wasHit: false };
  sim(e, ctx, 60, () => {
    assert.equal(field.queryRadius(e.ship.pos, e.radius).length, 0, `hit a rock at ${e.ship.pos.map(Math.round)}`);
  });
});
test('an enemy exactly on the player, both at rest, yields finite controls', () => {
  const p = ent(1, 0, PLAYER), e = ent(2, 1, ENEMY);
  const ctx = { field: createField(1, EMPTY), player: p, threat: calm, wasHit: false };
  const c = thinkEnemy(createBrain(1), e, ctx, DT);
  finite([c.pitch, c.yaw, c.roll, c.strafe, c.lift, c.throttleSet ?? 0]);
});
await run();
```

- [ ] **Step 2: Run it; expect failure.**

- [ ] **Step 3: Implement `ai.js`** (§7.3).
  - **Steering:** `steerTo(me, dirWorld)` → pitch, yaw and roll. Take
    `d = qRotateInv(q, dir)` and the off-angle `θ = acos(−d.z)`. Then:
    - `pitch = clamp(atan2(d.y, −d.z)·2.5, −1, 1)`;
    - `yaw = clamp(atan2(d.x, −d.z)·2.5, −1, 1)`;
    - when θ > 20°, add bank-to-turn: `roll = clamp(atan2(d.x, d.y)·1.5, −1, 1)`.
    - Zero-length `dir` gives zero commands.
  - **Avoidance** runs before every steering decision:
    - Probe `field.sweepSphere(pos, pos + vel·2 + fwd·40, radius + 25)`.
    - On a hit, get the escape direction `away` from the hit point's
      offset from the rock centre, projected perpendicular to the velocity
      (fallback: ship up).
    - Blend `dir = normalize(dir·(1−u) + away·u·2)` with
      `u = 1 − hit.t`. Set `strafe` and `lift` from `away` in the local
      frame, scaled by u.
    - Cut the throttle to 0.4 when `u > 0.6`.
    - Also check the current overlap neighbourhood with `queryRadius(pos,
      radius + 60)`; push away from the nearest centre (strafe and lift)
      when inside it.
  - **Fire gate:** angle to the true lead ≤ 4°, range ≤ 1 200 m, state
    `attack`, and inside a burst window. Bursts last `ENEMY_CANNON.burst`
    and pauses last `.pause`, both rng-sampled.
  - **Aim error:** steer to the lead point plus a jitter vector of
    magnitude `range·0.004·rng.gauss()`, resampled at 2 Hz. The gate
    still tests the true lead.
  - **Transitions:**
    - approach → attack when range < 1 200;
    - attack → breakoff when range < 150 or 6 s have passed;
    - breakoff → approach after extending 600–900 m;
    - any → evade when `wasHit` or `threat.missileInbound`. Evade lasts
      1.5–3 s with random jinks; boost is on when a missile is inbound.
  - **Throttle:** `throttleSet` 1 in approach (boost when range > 2 km),
    `clamp(range/900, 0.35, 0.9)` in attack, and 1 in breakoff.

- [ ] **Step 4: Run `node tests/ai-check.mjs`** → `6 passed`. If the dense-cell test fails, improve avoidance (probe length, speed cut); never loosen the test.

- [ ] **Step 5: Commit:** `meteora: enemy pilots with attack runs, evasion and rock avoidance`.

---

### Task 8: Combat rules and the world loop

**Files:** Create `fun/meteora/js/combat.js`, `fun/meteora/js/world.js` and `fun/meteora/tests/combat-check.mjs`.

**Interfaces:**
- Consumes all the simulation modules and `ANCHORS`.
- Produces from `combat.js`:
  - `applyDamage(entity, amount, events, point, dir)` → `{ shield,
    hull, killed }`, and resets `entity.sinceHit`;
  - `stepShield(entity, dt)`;
  - `waveSize(k)`;
  - `spawnPoints(rng, playerPos, playerFwd, n)`;
  - `loadBest(storage)` and `saveBest(storage, score)`;
  - `scoreKill(wave)` and `scoreRock(type)`;
  - `resolveShipRock(entity, field, events)` and `resolveShipShip(a, b, events)`.
- Produces from `world.js`:
  - `createWorld({ seed, storage, fieldCfg })` → `world = { seed, time,
    accumulator, field, weapons, rng, player, enemies:[], events:[],
    score, wave, waveTimer, best, state:'attract'|'flying'|'dead',
    lock, target }`;
  - `startRun(world)` and `resetWorld(world)`;
  - `stepWorld(world, input, dt)`, where `input` is the controls plus
    `{ fire, missile, cycleTarget }`;
  - `advance(world, input, frameDt)` → steps taken (≤ `MAX_STEPS`); the
    remaining backlog is dropped;
  - `drainEvents(world)` → array.
- The entity shape (player and enemies):
  `{ id, team, kind:'fighter'|'interceptor', ship, radius, shield, hull,
  maxShield, maxHull, sinceHit, gun, missiles, missileTimer, alive, brain?,
  rcsFired:[] }`.

- [ ] **Step 1: Write the failing check**

```js
import { test, run, assert, near } from './harness.mjs';
import { applyDamage, stepShield, waveSize, spawnPoints, loadBest, saveBest, scoreKill, scoreRock } from '../js/combat.js';
import { createWorld, startRun, resetWorld, stepWorld, advance, drainEvents } from '../js/world.js';
import { NEUTRAL_CONTROLS } from '../js/flight.js';
import { PLAYER, COMBAT, FIELD, MAX_STEPS, STEP as DT } from '../js/config.js';
import { makeRng } from '../js/rng.js';
import { dist, dot, normalize, sub } from '../js/vec.js';

const idle = { ...NEUTRAL_CONTROLS, fire: false, missile: false, cycleTarget: false };
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('damage drains the shield before the hull', () => {
  const e = { shield: 100, hull: 100, maxShield: 100, maxHull: 100, sinceHit: 9, alive: true };
  applyDamage(e, 70, []); assert.equal(e.shield, 30); assert.equal(e.hull, 100); assert.equal(e.sinceHit, 0);
  const r = applyDamage(e, 50, []); assert.equal(e.shield, 0); assert.equal(e.hull, 80); assert.ok(r.hull > 0);
  assert.ok(applyDamage(e, 500, []).killed); assert.equal(e.alive, false);
});
test('the shield regenerates only after 3 s without damage', () => {
  const e = { shield: 0, hull: 100, maxShield: 100, maxHull: 100, sinceHit: 0, alive: true, stats: PLAYER };
  for (let i = 0; i < Math.round(2.9 / DT); i++) stepShield(e, DT);
  assert.equal(e.shield, 0);
  for (let i = 0; i < Math.round(1.1 / DT); i++) stepShield(e, DT);
  near(e.shield, PLAYER.shieldRegen * 1.0, 0.5);
});
test('wave sizes grow and cap at 10', () => {
  assert.deepEqual([1, 2, 3, 8, 20].map(waveSize), [3, 4, 5, 10, 10]);
});
test('spawn points are 2.5–3.5 km out and outside the view cone', () => {
  const pts = spawnPoints(makeRng(3), [100, 0, 0], [0, 0, -1], 10);
  for (const p of pts) {
    const d = dist(p, [100, 0, 0]); assert.ok(d >= 2500 && d <= 3500);
    const dir = normalize([0, 0, 0], sub([0, 0, 0], p, [100, 0, 0]));
    assert.ok(Math.acos(dot(dir, [0, 0, -1])) > COMBAT.wave.viewCone);
  }
});
test('score: kills scale with the wave, rocks by type', () => {
  assert.equal(scoreKill(3), 300); assert.deepEqual([0, 1, 2].map(scoreRock), [10, 25, 50]);
});
test('best score survives a throwing localStorage', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(loadBest(broken), 0); assert.doesNotThrow(() => saveBest(broken, 500));
  assert.equal(loadBest(null), 0);
  const ok = memory(); saveBest(ok, 1200); assert.equal(loadBest(ok), 1200); saveBest(ok, 300); assert.equal(loadBest(ok), 1200);
});
test('a 60 s frame runs at most 8 steps and drops the backlog', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  const t0 = w.time;
  assert.equal(advance(w, idle, 60), MAX_STEPS);
  near(w.time - t0, MAX_STEPS * DT, 1e-9);
  assert.ok(w.accumulator < DT);
});
test('wave 1 arrives at start, wave 2 follows 6 s after the last kill', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  stepWorld(w, idle, DT);
  assert.equal(w.wave, 1); assert.equal(w.enemies.filter(e => e.alive).length, 3);
  for (const e of w.enemies) applyDamage(e, 1e6, w.events);
  for (let i = 0; i < Math.round(5.9 / DT); i++) stepWorld(w, idle, DT);
  assert.equal(w.wave, 1);
  for (let i = 0; i < Math.round(0.2 / DT); i++) stepWorld(w, idle, DT);
  assert.equal(w.wave, 2); assert.equal(w.enemies.filter(e => e.alive).length, 4);
  assert.ok(drainEvents(w).some(e => e.type === 'wave' && e.n === 2));
});
test('ramming a rock bounces and costs (v_n − 8) × 1.2', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  w.enemies.length = 0; w.waveTimer = 1e9;
  const b = w.field.belt; const i = [...b.type].findIndex(t => t === 3);
  const c = [b.pos[3 * i], b.pos[3 * i + 1], b.pos[3 * i + 2]], R = b.collide[i];
  const p = w.player; p.ship.pos = [c[0], c[1], c[2] + R + PLAYER.radius + 0.1]; p.ship.vel = [0, 0, -30]; p.ship.fa = false; p.ship.throttle = 0;
  for (let k = 0; k < 4; k++) stepWorld(w, idle, DT);
  near(PLAYER.shield - p.shield, (30 - COMBAT.collision.safe) * COMBAT.collision.perMs, 1.5);
  assert.ok(p.ship.vel[2] > 0); near(p.ship.vel[2], 30 * COMBAT.collision.restitution, 1.5);
});
test('reset after a fight restores the belt and clears everything', () => {
  const w = createWorld({ seed: 1234, storage: memory() }); startRun(w);
  const fire = { ...idle, fire: true, throttleSet: 1 };
  for (let i = 0; i < 120 * 20; i++) stepWorld(w, fire, DT);
  const fresh = createWorld({ seed: 1234, storage: memory() }); startRun(fresh);
  resetWorld(w); startRun(w);
  assert.equal(w.weapons.bolts.length, 0); assert.equal(w.weapons.missiles.length, 0);
  assert.equal(w.field.dynamic.length, 0); assert.ok(w.field.alive.every(a => a === 1));
  assert.equal(w.score, 0); assert.equal(w.player.hull, PLAYER.hull); assert.equal(w.player.shield, PLAYER.shield);
  stepWorld(w, idle, DT); stepWorld(fresh, idle, DT);
  assert.deepEqual(w.enemies.map(e => e.ship.pos.map(v => +v.toFixed(6))), fresh.enemies.map(e => e.ship.pos.map(v => +v.toFixed(6))));
});
test('player death ends the run and stores the best score', () => {
  const store = memory(); const w = createWorld({ seed: 1234, storage: store }); startRun(w);
  w.score = 777; applyDamage(w.player, 1e6, w.events); stepWorld(w, idle, DT);
  assert.equal(w.state, 'dead'); assert.equal(loadBest(store), 777);
  assert.ok(drainEvents(w).some(e => e.type === 'shipKilled' && e.team === 0));
});
await run();
```

- [ ] **Step 2: Run it; expect failure.**

- [ ] **Step 3: Implement `combat.js` and `world.js`.** The order inside `stepWorld`:
  1. `time += dt`.
  2. The player:
     - when `state==='flying'`, run `stepShip` with the input, then the
       gun trigger, `fireBolt` per shot from `ANCHORS.fighter.muzzles[gun.muzzle].pos`
       (emit `fire`), the lock on `world.target`, and a missile launch if
       requested and ammo > 0 (emit `missileLaunch`);
     - otherwise the ship coasts.
  3. Enemies: `thinkEnemy` then `stepShip`, and fire from their muzzles.
     The threat comes from the player's lock and inbound missiles;
     `wasHit` comes from `sinceHit < 0.1`.
  4. RCS: for each ship, `rcsFired = selectRcsPorts(...)` (read by fx).
  5. `stepWeapons(weapons, ctx, dt)`, with `ctx.damage` → `applyDamage`
     and score/kill bookkeeping (`shipKilled { id, team, pos, vel, kind }`,
     score += `scoreKill(wave)`).
  6. `field.step(dt, events)`. `rockBreak` events from player bolts or
     missiles add `scoreRock(type)`: the weapon tags `events` with
     `team`, and only team 0 scores.
  7. Collisions: each ship against rocks (`resolveShipRock`) and against
     ships (`resolveShipShip`), emitting `collision { id, speed, pos }`.
  8. Shields regenerate. Missile rearm timer.
  9. Waves:
     - when no enemy is alive and the state is `flying`, run `waveTimer`
       down from `COMBAT.wave.delay`;
     - at 0, spawn `waveSize(++wave)` enemies at `spawnPoints`, facing the
       player, and emit `wave`.
     - The first wave spawns on the first step after `startRun`.
  10. Death: when the player is not alive, set `state='dead'`, call
      `saveBest`, and emit `shipKilled` (team 0) once.
  11. Leaving the field: set `world.leaving` when the player is more
      than 3 km outside the slab.

  `advance`:
  `accumulator += frameDt; n = 0; while (accumulator >= STEP && n < MAX_STEPS) { stepWorld; accumulator −= STEP; n++ }; if (n === MAX_STEPS) accumulator = Math.min(accumulator, STEP·0.999)`.

  `resetWorld`: `field.reset()`, new weapons, clear the enemies and
  events, recreate the player at spawn facing −Z, `score = 0`, `wave = 0`,
  re-seed the world rng from `seed`, and `state = 'attract'`.

  `resolveShipRock`: query `field.queryRadius(pos, radius)`. For each
  overlap:
  - normal `n = normalize(pos − c)`;
  - push out to `c + n·(R + r)`;
  - `v_n = −dot(vel_rel, n)`; if `v_n > 0`, reflect
    `vel_rel_n = n·v_n·restitution` and scale the tangential part by
    `friction`;
  - for a dynamic rock, `vel_rel` is relative to its velocity;
  - damage `max(0, v_n − safe)·perMs` through `applyDamage`.

- [ ] **Step 4: Run all checks so far** (`for f in tests/*-check.mjs; do node $f || break; done`). Everything should pass.

- [ ] **Step 5: Commit:** `meteora: combat rules, enemy waves and the fixed-step world`.

---

### Task 9: Controls mapping and the vibration model

**Files:** Create `fun/meteora/js/controls.js`, `fun/meteora/js/shake.js`, `fun/meteora/tests/controls-check.mjs` and `fun/meteora/tests/shake-check.mjs`.

**Interfaces:**
- `controls.js`:
  - `createControlState(settings)` → `{ held:Set, mouse:{left,right},
    cursor:[0,0], pressed:Set /*edge-triggered this frame*/, settings }`;
  - `keyDown(state, code, repeat)` and `keyUp(state, code)`;
  - `mouseDown(state, button)` and `mouseUp(state, button)`;
  - `mouseMove(state, dx, dy)`;
  - `dropAll(state)` (blur and lock loss: clears held, mouse and
    pressed, and recentres the cursor);
  - `readInput(state)` → the controls (§6.5 mapping) plus `{ fire,
    missile, cycleTarget, toggleCamera, mute, pause }`. It consumes the
    `pressed` set.
  - Settings: `{ sensitivity: 1, invertPitch: false, vibration: true }`.
    The cursor ring radius is 1 (normalised), the deadzone 0.06, and
    mouse dx is scaled by `sensitivity·0.0025`.
- `shake.js`:
  - `vibration({ thrust, afterburner, speed, density, rcs }, enabled)` →
    `{ fine, rumble, buffet }` amplitudes (0 when disabled);
  - `createShake(seed)` → `{ impact:0, t:0, rng }`;
  - `kick(shake, amount)`;
  - `stepShake(shake, amps, dt)` → `{ pos:[x,y,z], rot:[pitch,yaw,roll] }`
    offsets.
  - Impact shake decays with a half-life of 0.18 s and is never gated by
    `enabled`.

- [ ] **Step 1: Write both failing checks**

```js
// tests/controls-check.mjs
import { test, run, assert, near } from './harness.mjs';
import { createControlState, keyDown, keyUp, mouseDown, mouseMove, dropAll, readInput } from '../js/controls.js';

const S = () => createControlState({ sensitivity: 1, invertPitch: false, vibration: true });
test('W/S ramp the throttle, X zeroes it, Shift boosts', () => {
  const s = S(); keyDown(s, 'KeyW'); keyDown(s, 'ShiftLeft');
  let c = readInput(s); assert.equal(c.throttleDelta, 1); assert.equal(c.boost, true);
  keyUp(s, 'KeyW'); keyDown(s, 'KeyS'); assert.equal(readInput(s).throttleDelta, -1);
  keyDown(s, 'KeyX'); assert.equal(readInput(s).throttleZero, true);
});
test('blur drops every held input', () => {
  const s = S(); keyDown(s, 'KeyW'); keyDown(s, 'ShiftLeft'); keyDown(s, 'KeyQ'); mouseDown(s, 0); mouseMove(s, 300, -200);
  dropAll(s);
  const c = readInput(s);
  assert.equal(c.throttleDelta, 0); assert.equal(c.boost, false); assert.equal(c.roll, 0); assert.equal(c.fire, false);
  assert.equal(c.pitch, 0); assert.equal(c.yaw, 0);
});
test('the virtual stick clamps to the ring and has a deadzone', () => {
  const s = S(); mouseMove(s, 10, 0);
  assert.equal(readInput(s).yaw, 0, 'inside the deadzone');
  mouseMove(s, 100000, 0); const c = readInput(s);
  near(c.yaw, 1, 1e-9); assert.ok(Math.hypot(...s.cursor) <= 1 + 1e-9);
});
test('mouse up is nose down unless pitch is inverted', () => {
  const s = S(); mouseMove(s, 0, -300); assert.ok(readInput(s).pitch > 0, 'mouse up (dy<0) pitches the nose up');
  const inv = createControlState({ sensitivity: 1, invertPitch: true, vibration: true });
  mouseMove(inv, 0, -300); assert.ok(readInput(inv).pitch < 0);
});
test('Z toggles flight assist once per press, ignoring key repeat', () => {
  const s = S(); keyDown(s, 'KeyZ', false);
  assert.equal(readInput(s).toggleFA, true); assert.equal(readInput(s).toggleFA, false);
  keyDown(s, 'KeyZ', true); assert.equal(readInput(s).toggleFA, false);
});
test('strafe, lift and roll map to the documented keys', () => {
  const s = S(); keyDown(s, 'KeyD'); keyDown(s, 'KeyR'); keyDown(s, 'KeyE');
  const c = readInput(s); assert.equal(c.strafe, 1); assert.equal(c.lift, 1); assert.equal(c.roll, 1);
  keyDown(s, 'KeyA'); assert.equal(readInput(s).strafe, 0, 'both cancel');
  keyUp(s, 'KeyR'); keyDown(s, 'KeyC'); assert.equal(readInput(s).lift, -1);
});
await run();
```

```js
// tests/shake-check.mjs
import { test, run, assert } from './harness.mjs';
import { vibration, createShake, kick, stepShake } from '../js/shake.js';
import { SHAKE } from '../js/config.js';

const total = a => a.fine + a.rumble + a.buffet;
test('a ship at rest with no thrust only hums', () => {
  const a = vibration({ thrust: 0, afterburner: false, speed: 0, density: 0.8, rcs: 0 }, true);
  assert.equal(a.rumble, 0); assert.equal(a.buffet, 0); assert.ok(a.fine > 0 && a.fine <= SHAKE.idle + 1e-9);
});
test('amplitude rises with thrust and with speed × density', () => {
  let prev = -1;
  for (const thrust of [0, 0.25, 0.5, 1]) { const t = total(vibration({ thrust, afterburner: false, speed: 0, density: 0, rcs: 0 }, true)); assert.ok(t > prev); prev = t; }
  prev = -1;
  for (const [speed, density] of [[0, 1], [50, 0.2], [100, 0.5], [300, 1]]) { const b = vibration({ thrust: 0, afterburner: false, speed, density, rcs: 0 }, true).buffet; assert.ok(b > prev || (speed === 0 && b === 0)); prev = b; }
});
test('the afterburner adds rumble', () => {
  const off = vibration({ thrust: 1, afterburner: false, speed: 100, density: 0.3, rcs: 0 }, true);
  const on = vibration({ thrust: 1, afterburner: true, speed: 100, density: 0.3, rcs: 0 }, true);
  assert.equal(off.rumble, 0); assert.ok(on.rumble > 0);
});
test('vibration off zeroes everything but impact shake', () => {
  const a = vibration({ thrust: 1, afterburner: true, speed: 300, density: 1, rcs: 1 }, false);
  assert.equal(total(a), 0);
  const s = createShake(1); kick(s, 1);
  const o = stepShake(s, a, 1 / 60);
  assert.ok(Math.hypot(...o.rot) > 0, 'impact shake still shows');
  for (let i = 0; i < 120; i++) stepShake(s, a, 1 / 60);
  assert.ok(Math.hypot(...stepShake(s, a, 1 / 60).rot) < 1e-3, 'and decays');
});
await run();
```

- [ ] **Step 2: Run both; expect failure.**

- [ ] **Step 3: Implement.**
  - **`controls.js` key map:** W/S throttle; X zero; A/D strafe;
    R/Space up and F/C down; Q/E roll; Shift boost; Z FA; T target;
    V camera; M mute; Escape pause.
    - Mouse button 0 fires the cannons; button 2 fires a missile
      (edge-triggered).
    - `pitch = −cursor[1]` (with deadzone rescale) and
      `yaw = cursor[0]`; invert flips the pitch.
  - **`shake.js`:**
    - `fine = SHAKE.idle + SHAKE.engine·thrust`;
    - `rumble = afterburner ? SHAKE.rumble : 0`;
    - `buffet = SHAKE.buffet·speed·density`;
    - RCS adds `SHAKE.rcsKick·rcs` to `fine`.
    - `stepShake` sums:
      - two sine-noise bands (fine at about 38 Hz and rumble at about
        9 Hz, phase-jittered by the rng);
      - buffet as low-passed white noise plus sparse ticks (probability
        `0.6·dt` per frame, scaled by `buffetGrain`);
      - `impact·(noise)`, decayed.
    - Rotation offsets in radians use `amp·0.004`; position offsets in
      metres use `amp·0.05`.

- [ ] **Step 4: Run both** → `6 passed` and `4 passed`.

- [ ] **Step 5: Commit:** `meteora: input mapping and physically sourced ship vibration`.

---

### Task 10: Page shell, loading, renderer, ships and belt on screen

**Files:**
- Create: `fun/meteora/index.html`, `fun/meteora/meteora.css`, `js/main.js`, `js/input.js`, `js/models.js`, `js/field-render.js`, `js/camera.js` and `js/screens.js`
- Copy: `fun/alpen/assets/vendor/GLTFLoader.js` → `fun/meteora/assets/vendor/GLTFLoader.js`, and `fun/alpen/assets/utils/{BufferGeometryUtils,SkeletonUtils}.js` → `fun/meteora/assets/utils/`
- Create (local only, not committed): `.claude/launch.json`, entry `meteora`: `python3 -m http.server 8765` from the repo root

**Interfaces:**
- `models.js`: `loadModels(onProgress)` → `Promise<{ fighter:{ scene },
  interceptor:{ scene }, rocks:[{ lod0:BufferGeometry, lod1, material }] }>`.
  It rejects with `{ file }` on failure. `instantiateShip(template)`
  returns `Object3D` clones that share geometry and materials.
- `field-render.js`: `createFieldRender(scene, field, rocks)` →
  `{ update(camera, time), removeStatic(index), syncDynamic(dynamic), stats }`.
- `camera.js`:
  - `createChaseCamera(camera)` → `{ mode:'chase'|'nose', update(entity,
    alpha, dt, offsets), toggle() }`.
  - Chase: offset `(0, 4.2, 19)` in ship space. The offset is critically
    damped with a stiffness of 18. The camera lags the acceleration: the
    offset adds `−accelLocal·0.012`, so it pulls back under thrust.
  - FOV 70 → 78 under the afterburner, eased.
  - Nose: at `ANCHORS.fighter.cockpit`.
- `input.js`: `createInput(canvas, controlState, { onPause, onLockChange })`.
  It wires the DOM events to `controls.js` and handles pointer lock. It
  calls `dropAll` on `blur`, on `visibilitychange` (hidden) and on pointer
  lock loss, which also calls `onPause`.
- `screens.js`: the start, pause and destroyed overlays (DOM), the
  loading bar, settings bound to `meteora.settings`, and the no-WebGL2
  and load-error states.

- [ ] **Step 1: Write `index.html`.** It contains:
  - the import map for `three`;
  - the stage `<canvas id="stage">`;
  - the HUD `<canvas class="hud">`;
  - three overlays with `data-screen="start|pause|dead"`:
    - start: METEORA wordmark, tagline, loading bar, Launch button, and
      the controls table from §6.5;
    - pause: Resume and Restart buttons, plus settings for sensitivity
      (slider), invert pitch, ship vibration, and volume;
    - dead: score, wave, best, and "Launch again".
  - meta and OG tags like Alpen's, and the favicon link.

  Write `meteora.css`:
  - a dark space-console look with Space Grotesk from `/assets/fonts`;
  - full-viewport canvases;
  - overlays as centred glass panels;
  - `@media (prefers-reduced-motion)` disables CSS transitions.

- [ ] **Step 2: Write `models.js`, `field-render.js`, `camera.js`, `input.js`, `screens.js` and a minimal `main.js`.**
  - `main.js`:
    - creates the `WebGLRenderer` (antialias off; the post pass handles
      MSAA later), the scene, camera, sun `DirectionalLight` and a
      temporary background colour;
    - loads the models and creates the world;
    - sets up the attract-mode orbit camera;
    - on Launch: request pointer lock, call `startRun`, and run the loop
      with `advance` and render interpolation (lerp the positions and
      slerp the orientations between the previous and current step
      snapshots).
  - `field-render.js`: the cell InstancedMeshes per §5.2, and the tumble
    in `onBeforeCompile`. Each instance carries `aSpin` (vec4: axis xyz,
    rate) and `aPhase` (float). The vertex chunk replaces
    `#include <begin_vertex>` with a Rodrigues rotation of `position` and
    `objectNormal` by angle `aSpin.w·uTime + aPhase`.
  - Destroyed statics are scaled to zero via `setMatrixAt` plus
    `needsUpdate`.
  - Dynamic rocks use one InstancedMesh per type, capacity 64.

- [ ] **Step 3: Serve and verify in the browser pane.**
  - Run `preview_start` with name `meteora`, then navigate to
    `http://localhost:8765/fun/meteora/`. Screenshot:
    - the start screen;
    - after Launch, flying forward with W, the belt visible around you;
    - a turn with the mouse.
  - `read_console_messages` must show no errors (including no favicon
    404).
  - Pointer lock may be refused under automation. In that case `?debug`
    enables a debug-only `?autopilot` that feeds scripted inputs, so the
    loop can be screenshotted without lock. The query flag is ignored
    without `?debug`.

- [ ] **Step 4: Commit:** `meteora: page shell, model loading and the belt in flight`.

---

### Task 11: The sky — stars, Milky Way, nebulae, galaxies, sun, gas giant

**Files:** Create `fun/meteora/js/sky.js`; modify `js/main.js` to use it.

**Interfaces:**
- `createSky(renderer, scene, seed)` → `{ envMap /*PMREM texture*/, sunDir:[x,y,z] /*unit, world*/, update(camera, dt, occluded:boolean), flare:{ visible, screenPos, strength } }`.

- [ ] **Step 1: Generate the cubemap.**
  - `WebGLCubeRenderTarget(RENDER.skyFace, HalfFloatType)`. Render a
    fullscreen-cube `ShaderMaterial` (BackSide) with a `CubeCamera` once
    at boot.
  - The fragment shader takes the view direction `d` and sums:
    1. **Stars:**
       - Hash the direction on a cube-sphere grid at 3 densities.
       - Magnitude from `−2.5·log10(u)`-shaped sampling, so faint stars
         dominate.
       - Colour from a blackbody approximation for
         T = 3000 + 9000·u², with a gaussian PSF of 0.6 texels.
       - Density is multiplied by `1 + 3·band(d)` toward the Milky Way.
    2. **Milky Way:** `band = exp(−(dot(d, galNormal)/0.18)²)`.
       - Brightness is `band · fbm(d·4)`, with a core bulge near the
         galactic centre direction.
       - Dust lanes: `1 − smoothstep(.., domainWarpedFbm(d·9))` along the
         midplane.
       - Warm white-beige colour, toward amber at the bulge.
    3. **Nebulae** (§8.3). Each is
       `{ dir, radius, palette, seed, kind }`; they are evaluated in a
       local tangent frame around `dir` with
       `t = angle(d, dir)/radius`:
       - **emission:** a domain-warped fbm cloud. Colour mixes Hα
         `(1.0, 0.18, 0.32)` and OIII `(0.15, 0.85, 0.8)` by a second
         noise. Dark pillars are `pow(fbm, 3)` absorbers. A few embedded
         blue stars.
       - **reflection:** soft blue `(0.35, 0.55, 1.0)` glow around a
         cluster of 6 bright stars.
       - **planetary:** a ring
         `exp(−((t−0.6)/0.12)²)·(1+0.3·noise)`, teal inside and red at
         the rim, with a bipolar lobe term.
       - **supernova remnant:** a filament shell
         `exp(−((t−0.85)/0.04)²)` modulated by ridged noise, red and
         green-teal.
       - **dark:** multiply star and background light by
         `1 − 0.85·cloud`.
    4. **Galaxies** (§8.3), each `{ dir, size, incl, pa, kind, seed }`:
       - **spiral:** project `d` into the galaxy's tilted disc plane.
         Log-spiral arm density is
         `cos(2·(θ − ln(r)/tan(pitch)))` to a power, with an exponential
         disc falloff, a yellow-white bulge
         `exp(−(r/0.12)²)`, blue knots from thresholded noise along the
         arms, pink HII dots, and near-side dust lanes darkening by
         inclination.
       - **edge-on:** the same disc at an inclination near 88°, with a
         dark midplane line.
       - **elliptical:** a Sérsic-like `exp(−7.67·(r^(1/4) − 1))`,
         elliptical, warm.
       - **interacting pair:** two small spirals plus a curved tidal-tail
         noise arc.
       - **150 tiny ones:** a hashed loop over a cell grid in direction
         space; each cell holds 0–1 small galaxy (an elongated gaussian
         with a faint bulge), only away from the band.
    5. Keep the base exposure dark. The bright cores are HDR 2–6×, so they
       bloom softly in Task 12.
  - Then `scene.background = cube.texture`, and
    `PMREMGenerator.fromCubemap` (intensity 0.25) as the environment.

- [ ] **Step 2: Add bright stars, sun, flare and gas giant.**
  - **Bright stars:** `Points` with `RENDER.brightStars` points at radius
    `0.9·far`, following the camera. Size comes from magnitude and colour
    from temperature, through a small additive gaussian sprite shader.
  - **Sun:** a camera-following billboard at the `sunDir` with an HDR
    disc, corona and streaks.
  - **Flare:** 6 ghost discs and a horizontal streak along the
    sun-to-screen-centre axis, drawn in the post pass. `strength` eases
    toward 0 or 1 over 0.15 s based on `occluded`.
  - **Gas giant:** a sphere of radius 9 000 m at 42 km, in a direction
    about 70° from the sun.
    - Banded clouds: latitude fbm bands with turbulence.
    - The terminator uses `dot(n, sunDir)`, with a Rayleigh rim of
      `pow(1 − dot(n, v), 3)` on the lit limb.
    - Rings are a flat annulus mesh (1.4–2.3 R) with a radial
      band-density texture computed in the shader. The ring shadow on the
      planet and the planet shadow on the ring are analytic ray–plane and
      ray–sphere tests against `sunDir`.
    - Both meshes are rendered with `depthWrite` and fog off, and
      `renderOrder` set so they draw behind the belt.

- [ ] **Step 3: Verify in the browser.**
  - Use the debug key `F9` (dev-only, behind `?debug`): it cycles the
    camera through 6 sky views: emission nebula, Andromeda-like spiral,
    planetary, Milky Way band, gas giant, and sun. Screenshot each.
  - Each must look astronomical and detailed, not like flat blobs.
    Iterate the shader until it does.
  - Check generation time on the `?debug` overlay; target < 400 ms.

- [ ] **Step 4: Commit:** `meteora: generated sky with nebulae, galaxies, sun and a ringed gas giant`.

---

### Task 12: HDR post pipeline, shadows, ship materials

**Files:** Create `fun/meteora/js/post.js`; modify `js/main.js`, `js/models.js` and `js/field-render.js`.

**Interfaces:**
- `createPost(renderer, { reducedMotion })` → `{ render(scene, camera, flare), resize(w, h, dpr), scale, setBloomSurge(x), stats:{ ms, scale } }`.

- [ ] **Step 1: Implement `post.js`.**
  - HDR `WebGLRenderTarget` with `HalfFloatType`, `samples: 4`, and a
    depth buffer.
  - Bloom: a prefilter with a soft knee (threshold 1.0, knee 0.5), 6
    levels of 13-tap downsample, then tent upsample with additive
    accumulation and per-level weights `[1, 0.9, 0.75, 0.6, 0.45, 0.3]`.
  - Composite shader: `exposure`; AgX (the three.js
    `AgXToneMapping` chunk logic inlined); edge chromatic aberration
    (0.0015 at the corners); vignette 0.25; grain 0.02 (animated hash);
    the flare overlay.
  - Dynamic resolution: an EMA of frame time. When it is over
    `targetMs·1.08`, `scale −= 0.05`; when under `·0.85` for 1 s,
    `scale += 0.05`. Clamp to `[scaleMin, scaleMax]` and resize the
    targets.
  - Set `renderer.toneMapping = NoToneMapping` (the composite owns tone
    mapping) and `outputColorSpace = SRGBColorSpace`.

- [ ] **Step 2: Lighting.**
  - The sun `DirectionalLight` at intensity 6, with `castShadow`. The
    shadow camera is an orthographic 600 m box following the camera
    position snapped to texels, with map size 2048, bias −0.0004 and
    normalBias 0.6.
  - Ships and dynamic rocks cast and receive shadows. Static cell meshes
    receive; casting is limited to cells within 400 m (toggled per frame).
  - Ship materials: keep the GLB PBR and set `envMapIntensity` 0.6.
    Emissive maps get intensity 3 (engine interiors and the canopy glow).
  - Hemisphere ambient at intensity 0.02 only.

- [ ] **Step 3: Verify in the browser.**
  - Screenshots in flight: rocks with a sharp terminator, ship reflections
    of the sky, and the sun blooming.
  - The `?debug` overlay shows draw calls ≤ 400 and the triangle count;
    record both in the commit message.

- [ ] **Step 4: Commit:** `meteora: HDR bloom and AgX pipeline, sun shadows and dynamic resolution`.

---

### Task 13: Particles, engine plumes, RCS puffs and space dust

**Files:** Create `js/particles.js`, `js/plumes.js` and `js/dust.js`; modify `js/main.js`.

**Interfaces:**
- `particles.js`: `createParticles(scene, { sunDir })` → `{ emit(kind,
  p), update(dt, camera), counts }`.
  - `kind` is one of `'spark'|'fire'|'flash'|'glow'|'ember'` (additive
    pool) or `'smoke'|'dust'|'gas'` (alpha pool).
  - `p = { pos, vel, life, size:[start,end], color:[r,g,b] |
    ramp:'fire'|'smoke'|'dust', drag, stretch, rot, spin, alpha }`.
- `plumes.js`: `createPlumes(object3D, anchors, palette)` →
  `{ update(entity, dt, time, emitParticles) }`. The palette is
  `{ core, sheath }` (player blue-violet, enemy orange-red).
- `dust.js`: `createDust(scene)` → `{ update(camera, velocity, dt, density) }`.

- [ ] **Step 1: `particles.js`.**
  - Two `InstancedBufferGeometry` quads with per-instance attributes:
    `iPos` vec3, `iVel` vec3 (used for stretch), `iSize`, `iColor` vec4,
    `iRot`.
  - Simulation in typed arrays. When full, the ring-buffer replaces the
    oldest particle.
  - The vertex shader does camera-facing billboards. When
    `stretch > 0`, it aligns the quad along the screen-projected velocity,
    with length = `size + |v|·stretch`.
  - Additive fragment: a soft gaussian core with a hot centre.
  - Smoke fragment:
    - samples a 4×4 noise-sprite atlas generated at boot on a canvas
      (fbm discs);
    - derives a pseudo-normal from the sprite's gradient;
    - lighting is `0.35 + 0.65·max(0, dot(n, sunDirView))`, tinted by
      the colour ramp.
  - Fire ramp (blackbody): white → yellow → orange → dull red → smoke grey.

- [ ] **Step 2: `plumes.js`.**
  - Per nozzle anchor: a `ConeGeometry` (open-ended, 24 radial × 16
    height), additive, with depthWrite off.
  - Uniforms: `uPower` (= `entity.ship.thrust`, eased over 0.08 s),
    `uBoost` (0..1, eased), `uTime` and the palette.
  - The fragment shader:

```glsl
// x along the plume 0 (nozzle) → 1 (tip), r radial 0..1 at that slice
float core = exp(-pow(r / mix(0.25, 0.4, uBoost), 2.0)) * (1.0 - x);
float diamonds = 0.5 + 0.5 * cos(x * (18.0 + 10.0 * uBoost) - uTime * 2.0);
diamonds = mix(1.0, diamonds, (1.0 - x) * 0.6);
float flicker = 0.85 + 0.15 * noise(vec3(x * 6.0 - uTime * 30.0, r * 3.0, uTime * 5.0));
float edge = pow(clamp(dot(normalize(vNormalV), normalize(-vPosV)), 0.0, 1.0), 1.5);
vec3 col = mix(uSheath, uCore, core) * (core * 6.0 + 1.2) * diamonds * flicker * edge;
gl_FragColor = vec4(col * uPower * (1.0 + 1.6 * uBoost), 1.0);
```

  - Scale the plume length: `0.6 + 5·power`, ×2.2 with boost.
  - A nozzle glow sprite (via `emit('glow')` each frame, or a fixed
    sprite).
  - Under the afterburner, emit 30 per second `spark` and `fire`
    particles at the nozzle, with ship velocity plus 120 m/s backwards.
  - RCS: for each `entity.rcsFired` port, emit 2–4 `gas` particles at the
    port's world position with velocity
    `ship.vel + dir·(25 + 30·intensity)`, life 0.25–0.4 s, size 0.4 → 2.2,
    white-grey, alpha 0.5·intensity.

- [ ] **Step 3: `dust.js`.**
  - 5 000 `Points` in a 300 m box around the camera, wrapped toroidally
    with a `mod` in the vertex shader on `(pos − cameraPos)`.
  - Velocity streaks: a second `LineSegments` buffer of the same points
    stretched along `−velocity·0.03 s`, scaled by `min(1, |v|/300)`, with
    alpha ∝ density.
  - 400 instanced pebbles (`asteroid_1` lod1 at scale 0.05–0.25), wrapped
    the same way.

- [ ] **Step 4: Verify in the browser.**
  - Screenshots: cruising (plumes and dust streaks); under the
    afterburner (long white-hot plume and sparks); a strafe (RCS puffs
    visible at the correct ports); a hard turn.
  - Check the particle counts on the `?debug` overlay stay under the caps.

- [ ] **Step 5: Commit:** `meteora: particles, shock-diamond engine plumes, RCS puffs and space dust`.

---

### Task 14: Projectiles, explosions, effects mapping, lights, shields and shake

**Files:** Create `js/projectiles.js`, `js/explosions.js` and `js/fx.js`; modify `js/main.js` and `js/camera.js`.

**Interfaces:**
- `projectiles.js`: `createProjectiles(scene)` → `{ sync(weapons, alpha) }`.
  Bolts are one instanced draw of stretched capsules; missiles are small
  body meshes plus motor glow and smoke (via particles).
- `explosions.js`: `createExplosions(scene, particles, lights)` →
  `{ spawn(pos, vel, sizeClass /*'chip'|'missile'|'enemy'|'player'|'rock'*/), update(dt) }`.
- `fx.js`: `createFx({ scene, particles, explosions, lights, shake,
  camera, audio, fieldRender })` → `{ handle(event), update(world, dt) }`.
  It maps every sim event (§ Task 8) to visuals, audio and shake.
- The light pool lives in `fx.js`: `borrow(pos, color, intensity, range,
  life, priority)` over `RENDER.lights` pre-created `PointLight`s.

- [ ] **Step 1: Projectiles.**
  - Bolt capsule: the vertex shader stretches along the screen-projected
    velocity to a 9 m length (player) or 7 m (enemy). The fragment is a
    core of white × 8 plus a halo (player cyan-violet `(0.5, 0.6, 1.0)`,
    enemy red-orange `(1.0, 0.35, 0.12)`) × 3.
  - Muzzle flash on `fire`: a `flash` particle (life 0.05 s, size 3) and
    a borrowed light (intensity 40, range 30, 0.06 s).

- [ ] **Step 2: Explosions** (§8.7, all layers):
  - **Fireball:** an icosahedron (detail 4). The vertex shader displaces
    by 3D noise × 0.35·radius. The fragment uses the temperature
    `T(t) = 1 − age/life`, the blackbody ramp, and erosion
    `discard if noise > T·1.2`. It is additive while hot and switches to
    alpha smoke colour as it cools. Pooled at 12.
  - **Shockwave:** a ring mesh in a random plane, expanding to 6·radius
    over 0.5 s, additive, fading.
  - **Debris:**
    - 16 procedurally generated convex shards (random hulls from 8
      points; `ConvexGeometry` is not vendored, so build tetrahedral fans
      from sorted points);
    - instanced at 64 capacity, with ember emissive
      `exp(−age/1.2)` and tumbling;
    - each leaves a short smoke trail.
  - **Size classes** (`radius`, `sparks`, `debris`, `smokePuffs`,
    `shake`, `light`):
    - chip: 2, 20, 0, 3;
    - rock: 6, 40, 0, 10 (dust-coloured smoke);
    - missile: 10, 80, 0, 14;
    - enemy: 16, 160, 14, 24;
    - player: 22, 200, 20, 30.

- [ ] **Step 3: `fx.js` event mapping.**
  - `boltHit`:
    - rock: sparks plus a dust puff and a small flash;
    - ship hull: sparks plus fire plus a light;
    - shield: shield ripple, cyan sparks.
  - `rockBreak`: a rock explosion, `fieldRender.removeStatic` when it
    carries an index, and `syncDynamic`.
  - `rockImpact`: sparks and dust.
  - `missileLaunch`: a smoke puff and the motor plume.
  - `missileExplode` / `missileExpire`: a missile explosion.
  - `shipKilled`: an enemy or player explosion, and that entity's mesh
    hidden.
  - `collision`: `shake.kick(min(maxImpact, speed/30))`, sparks and dust.
  - `wave`: a HUD callout plus audio.
  - Per frame, `update(world)`:
    - damaged-ship smoke: hull < 40 % emits a smoke trail plus occasional
      sparks;
    - missile smoke trails: every 0.02 s per missile, a `smoke` particle
      with life 3–5 s, size 1 → 7, drag 0.6, plus a motor `glow`;
    - vibration amplitudes come from the player ship
      (`vibration({ thrust, afterburner, speed, density: densityAt(pos),
      rcs: Σ intensities })`), sent to `stepShake`, then the offsets are
      applied to the camera, and `SHAKE.shipShare` of them to the player
      mesh (chase view only).
- **Shields:** a sphere mesh per ship (radius 1.15 × ship radius), with
  a fresnel shader and an impact ripple (uniforms `uHitPoint`, `uHitAge`).
  It shows for 0.4 s after a shield hit.
- **Reduced motion:** with `prefers-reduced-motion`, multiply flash
  intensities by 0.5 and impact shake by 0.5. Vibration defaults to off.

- [ ] **Step 4: Verify in the browser.**
  - Use the `?debug` key `F8` to spawn an enemy 300 m ahead.
  - Screenshots of:
    - cannon fire at a rock until it breaks (children drift);
    - a missile lock and launch with its smoke trail;
    - an enemy explosion mid-sequence (fireball, sparks, debris, smoke,
      shockwave);
    - a shield ripple;
    - a damaged enemy smoking.
  - The console stays clean, and the frame time on the `?debug` overlay
    stays under 16.7 ms during a 10-enemy wave (use `F7`, debug only, to
    jump to wave 8).

- [ ] **Step 5: Commit:** `meteora: plasma bolts, layered explosions, shields and impact effects`.

---

### Task 15: HUD and audio

**Files:** Create `js/hud.js` and `js/audio.js`; modify `js/main.js`.

**Interfaces:**
- `hud.js`: `createHud(canvas)` → `{ draw(world, camera, view), callout(text), resize() }`.
- `audio.js`: `createAudio()` → `{ start() /*on Launch gesture*/, resume(), setVolume(v), mute(toggle), handle(event, listenerPos), update(world, dt) }`.

- [ ] **Step 1: `hud.js`.** Canvas 2D at CSS pixel resolution × DPR, in
  Space Grotesk with tabular numbers.
  - **Centre:** crosshair; the virtual-stick cursor and its ring; the
    prograde marker (the velocity direction projected; a retrograde
    marker when moving backwards).
  - **Left:** speed (m/s), the throttle bar with the FA setpoint tick, FA
    ON/OFF, and the afterburner energy bar.
  - **Right:** shield and hull bars, the gun heat bar (red when locked),
    and missile pips with the rearm progress.
  - **Top:** score, wave, and the "Leaving the field" warning.
  - **Targets:**
    - brackets around enemies on screen, with distance; the selected one
      highlighted;
    - a lead pip (from `leadPoint` with `CANNON.speed`);
    - a lock bracket that closes as `lock.progress` rises and turns
      solid red when locked;
    - off-screen arrows at the screen edge.
  - **Radar:** an ellipse at the bottom centre, 3 km range. Each contact is
    plotted on the disc (local x and z), with a vertical stalk for its
    local y, red for enemies and grey for big rocks within 600 m.
  - **Callouts:** wave incoming, target destroyed, and missile lock
    warnings, fading.

- [ ] **Step 2: `audio.js`** (procedural, master compressor → destination):
  - **Engine:** brown noise through a lowpass (200 + 900·thrust Hz) plus
    a detuned saw pair at 38 + 30·thrust Hz. Gain is 0.15 + 0.35·thrust,
    and the afterburner adds a band-passed roar.
  - **Cannon:** a 70 ms square chirp 1 400 → 300 Hz plus noise tick,
    panned by the muzzle.
  - **Missile launch:** a 1.2 s noise whoosh with the highpass sweeping
    down. **Lock tone:** an 880 Hz beep at 3 → 12 Hz as progress rises,
    steady when locked.
  - **Explosion:** a noise burst with a lowpass from 3 kHz to 120 Hz over
    0.8–2 s by size, plus a sine sub thump at 55 Hz, with distance
    attenuation `1/(1 + d/400)`.
  - **Shield hit:** a metallic ping (two inharmonic sines). **Hull hit:**
    a crunch (bandpassed noise). **Collision:** a thud plus scrape.
  - **Alarm:** a two-tone at hull < 30 %, every 1.2 s.
  - Mute and volume persist in `meteora.settings`.

- [ ] **Step 3: Verify.** Screenshot the HUD in combat: the brackets,
  lead pip, lock, radar and every bar must be legible. Audio cannot be
  heard by the agent. Instead, check that `audio.context.state === 'running'`
  after Launch via `javascript_tool`, and that the console shows no Web
  Audio errors.

- [ ] **Step 4: Commit:** `meteora: flight HUD with radar and lead pip, procedural cockpit audio`.

---

### Task 16: Site integration, docs, performance pass and final verification

**Files:**
- Modify: `fun/index.html`, `index.html` (the `#fun` grid), the root `README.md`
- Create: `fun/meteora/README.md`, `fun/meteora/tests/README.md`

- [ ] **Step 1: Add the cards.**
  - `fun/index.html`: after Alpen, add:

```html
<a class="game" href="/fun/meteora/">
  <h2>Meteora</h2>
  <p>Fly a heavy fighter through a vast asteroid belt with real momentum, break rocks apart and outfight waves of interceptors.</p>
  <div class="game-foot">
    <span class="game-tech">Space combat · 3D</span>
    <span class="game-go">Play game <span aria-hidden="true">→</span></span>
  </div>
</a>
```

  - In both pages' meta and OG descriptions, change "Play Transport,
    Tyran, Ashline and Alpen" to "Play Transport, Tyran, Ashline, Alpen
    and Meteora" and add "space combat" to the genre list.
  - `index.html`: the same card using `<h3>` and `class="game reveal"`,
    with the text "Thread a massive asteroid belt with real momentum and
    fight waves of interceptors."
  - The root `README.md`: a `## Meteora` section in the style of the
    others (a play link, one paragraph, 4 bullets).
- [ ] **Step 2: `fun/meteora/README.md`.** Cover:
  - controls (the §6.5 table);
  - the flight model explained for players (FA on/off and the prograde
    marker);
  - weapons, waves and scoring;
  - settings, and the `?debug` keys (F7, F8, F9 and the overlay);
  - how to regenerate the models (the Blender command) and how to run the
    checks;
  - the performance notes measured in Step 3.
- [ ] **Step 3: Performance pass in the browser.** With `?debug`, at the
  browser pane's size and at 1440p, during wave 8, record:
  - fps, draw calls, triangles, particle counts and the dynamic-resolution
    scale.
  - Any value over budget is fixed before moving on (cell sizes, draw
    distances or particle caps).
- [ ] **Step 4: Full verification.**
  - Run every check: `cd fun/meteora && for f in tests/*-check.mjs; do node "$f" || exit 1; done`.
  - Run the site checks: `node tests/navigation-check.mjs` and `node tests/background-check.mjs`
    from the repo root.
  - Browser: load `/fun/` and `/` and check the Meteora card is present
    and links correctly. Play from Launch to death once, then press Launch
    again and confirm the belt is restored (Review Focus 4).
  - Alt-tab while holding W: on return, the game is paused and nothing is
    stuck (Review Focus 2).
- [ ] **Step 5: Commit:** `meteora: listed on the games pages, with player guide and measured performance`.

---

## Self-review notes

- **Spec coverage:**
  - §4 → Tasks 2 and 3; §5 → Tasks 5 and 10; §6 → Tasks 4 and 9;
    §7 → Tasks 6, 7 and 8;
  - §8.1 → Task 12; §8.2 → Tasks 12 and 14; §8.3 → Task 11;
    §8.4 and §8.5 → Task 13; §8.6 to §8.9 → Task 14;
  - §9 → the file map; §10 → the checks in Tasks 1–9; §11 → Tasks 12
    and 16; §12 → Tasks 10, 12 and 15; HUD and audio → Task 15;
    site integration → Task 16.
- **Review Focus** items 1–5 are each pinned by a named test in Tasks 1,
  5, 6, 7, 8 and 9.
- **Names used across tasks** were checked against the producing task:
  - `stepShip`, `selectRcsPorts`, `NEUTRAL_CONTROLS` and `forward`;
  - `createField`, `densityAt`, `queryRadius`, `sweepSphere`,
    `damageRock`, `addDynamicRock` and `reset`;
  - `fireBolt`, `triggerGun`, `updateLock`, `launchMissile`,
    `stepWeapons` and `leadPoint`;
  - `thinkEnemy` and `createBrain`;
  - `applyDamage`, `advance`, `stepWorld`, `resetWorld`, `startRun` and
    `drainEvents`;
  - `vibration` and `stepShake`.
