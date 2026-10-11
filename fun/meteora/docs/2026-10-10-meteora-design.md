# Meteora — design

Status: approved in conversation 2026-10-10, written up for review.

## 1. Intent

A realistic 3D space shooter for the Protocodus games page. The player flies a
fighter through a massive asteroid belt and fights waves of enemy
interceptors. The flight has real momentum, and the effects carry the sense
of being there: engine plumes, attitude-thruster puffs, plasma bolts,
missiles with smoke trails, layered explosions and a deep starfield.

What the user asked for, verbatim in substance:

- realistic 3D space shooter, added to Protocodus games under the name Meteora;
- ship and rock models made in Blender: 1 player ship, 1 enemy ship,
  5 asteroids of different sizes;
- a massive asteroid field to fly through, and weapons to fire;
- momentum flight with acceleration and deceleration;
- fire, explosions, booster burner, weapon projectiles, shaders, smoke,
  and a realistic, immersive starfield.

Decisions taken with the user:

| question | answer |
|---|---|
| gameplay loop | combat sandbox: endless enemy waves, destructible small asteroids, score, shield and hull |
| flight model | Newtonian 6-DOF with flight assist (on by default, toggleable) |
| controls | mouse and keyboard only (no touch, no gamepad) |
| renderer | three.js r185 (already vendored) on WebGL2 with a hand-written HDR pipeline |

Assumptions (not explicitly requested, accepted with the design): procedural
Web Audio sound, a distant ringed gas giant and a sun with lens flare, and a
3D radar.

Success looks like this: a player opens `/fun/meteora/`, clicks Launch, and
within seconds is flying through a dense belt at 60 fps on a recent laptop.
They feel the ship's mass when they turn, shoot down interceptors and break
up rocks, and are destroyed eventually with a score worth beating.

## 2. Where it lives

Like every other game in the repo, Meteora is a self-contained folder with
no build step:

```
fun/meteora/
  index.html            page shell, import map, screens
  meteora.css
  README.md             player guide + technical notes
  docs/                 this spec and the implementation plan
  assets/
    models/             *.glb exported by the Blender scripts + MODELS.md
    vendor/             GLTFLoader.js (+ utils), copied from fun/alpen
  tools/blender/        bpy scripts that build and export every model
  js/                   ES modules (see section 9)
  tests/                dependency-free Node checks (`node tests/x.mjs`)
```

three.js comes from the shared `/assets/vendor/three/three.module.min.js`
through an import map, exactly as Alpen loads it. The loader is a copy, not
a cross-game import, so neither game can break the other.

Site integration: a card on `fun/index.html` and in the home page's `#fun`
games grid, Meteora named in both pages' meta descriptions, and a section in
the root `README.md`.

## 3. Units and conventions

- Metres, seconds, radians. World is right-handed, three.js default: +Y up.
- Ship local frame: nose along −Z, top along +Y, right along +X.
- Blender modelling frame: nose along +Y, top along +Z. With the glTF
  exporter's +Y-up conversion, Blender +Y becomes glTF −Z, so ships arrive
  facing three.js forward with no runtime correction.
- Physics runs at a fixed 120 Hz step, and rendering interpolates (the Alpen
  pattern). Everything stochastic in the simulation takes a seeded RNG, so
  tests are deterministic.

## 4. Blender assets

### 4.1 Pipeline

Scripts in `fun/meteora/tools/blender/` run headless:

```
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fun/meteora/tools/blender/build_all.py
```

- `common.py` handles scene reset, material helpers, UV unwrap, Cycles bake
  helpers and GLB export.
- `build_ships.py` builds the player fighter and the enemy interceptor.
- `build_asteroids.py` builds the five rocks.
- `render_previews.py` renders a turntable still of each model to
  `tools/blender/previews/*.png` (committed so a reviewer can see the models
  without Blender).
- `build_all.py` runs the three in order.

Every script is deterministic, with a fixed random seed per model. Re-running
it reproduces the files.

Textures are baked in Cycles (CPU, low samples) from procedural node
materials into image textures, because glTF cannot carry procedural nodes.
Each model ships base colour, normal, metallic-roughness and, where it
glows, emissive maps. Images are exported as WebP inside the GLB
(`EXT_texture_webp`, which three's GLTFLoader reads natively). No Draco and
no meshopt, so no decoder is needed.

### 4.2 Player fighter — `fighter.glb`

- About 14 m long and 11 m across the wings. A heavy fighter: a lifting-body
  fuselage lofted from cross-sections, a raised canopy (dark tinted glass,
  slight emissive instrument glow), swept wings with gun pods at the tips,
  two main engines with bell nozzles, and small greebles (vents, panels, an
  antenna).
- Paint: off-white and graphite panels with a muted orange accent stripe,
  baked panel lines, edge wear and grime. The engine nozzle interior is
  emissive.
- Budget: ≤ 12k triangles; textures 2048² base colour and normal, 1024²
  metallic-roughness and emissive.
- Anchors (empties exported as glTF nodes):
  - `nozzle_L`, `nozzle_R`: centre of each nozzle exit, local −Y pointing
    out the back (Blender) → plume direction +Z in game.
  - `muzzle_L`, `muzzle_R`: gun barrel tips.
  - `rcs_*`: 12 attitude-thruster ports. Each empty's local +Z in Blender
    (+Y in glTF) points out of the hull and is the puff direction. The ports
    are placed so every linear axis and every rotation axis has at least two
    ports that can push it.
  - `cam_cockpit`: the eye point for the nose camera.

### 4.3 Enemy interceptor — `interceptor.glb`

- About 11 m long. Aggressive and angular: a forward-swept split wing, one
  large engine with two small side boosters, a sensor eye in place of a
  canopy (emissive red).
- Paint: gunmetal and oxblood with hazard markings, baked panel lines and
  wear.
- Budget: ≤ 8k triangles; textures 1024².
- Anchors: `nozzle_C`, `muzzle_L`, `muzzle_R`, `rcs_*` (8 or more).

### 4.4 Asteroids — `asteroid_1.glb` … `asteroid_5.glb`

Each starts as a high-poly sculpt: a subdivided icosphere deformed by layered
noise (Voronoi for facets, musgrave-style fBm for lumps), stamped with
craters of several scales, and with an overall shape chosen per rock. A
game-budget mesh is decimated from it. Normals and colour are baked from the
sculpt onto the low mesh, and a second, lower-detail LOD is exported as
another node in the same file.

| file | nominal radius | character | LOD0 / LOD1 tris | texture |
|---|---|---|---|---|
| `asteroid_1.glb` | 1.5 m | angular shard, fresh fracture faces | ≤ 300 / ≤ 80 | 512² |
| `asteroid_2.glb` | 4 m | rounded pebble-pile, lumpy | ≤ 600 / ≤ 160 | 512² |
| `asteroid_3.glb` | 12 m | elongated potato, one deep crater | ≤ 1.2k / ≤ 300 | 1024² |
| `asteroid_4.glb` | 40 m | blocky, layered with ridges | ≤ 2.5k / ≤ 600 | 1024² |
| `asteroid_5.glb` | 125 m | battered, heavily cratered | ≤ 4k / ≤ 1k | 1024² |

Rock colour comes from a carbonaceous grey-brown base, lighter regolith in
crater floors and on exposures (baked from cavity/AO), and sparse
metallic-glint flecks expressed through roughness. Node names are
`lod0` and `lod1`.

### 4.5 Asset budget

All seven GLBs together: ≤ 10 MB. `assets/models/MODELS.md` records the
generating script, the triangle counts and the anchors. A `models-check`
test enforces the budgets and anchors (section 10).

## 5. World

### 5.1 The belt

- A seeded slab of about 8 km × 2 km × 8 km (X × Y × Z), centred on the
  origin. Its density comes from a 3D noise field, so the belt has dense
  clumps, lanes and voids rather than an even sprinkle. Density thins
  smoothly at the slab edges.
- Population, before LOD and culling (random scale 0.7–1.4 × nominal,
  random orientation and tumble rate):

  | type | count | drawn up to |
  |---|---|---|
  | 1 (1.5 m) | 12 000 | 1.5 km |
  | 2 (4 m) | 6 000 | 3 km |
  | 3 (12 m) | 2 500 | 6 km |
  | 4 (40 m) | 600 | far plane |
  | 5 (125 m) | 150 | far plane |
  | landmarks (type 5 × 6–10) | 6 | far plane |

- Rocks never overlap each other. A clear sphere 400 m across is reserved at
  the player spawn point.
- Asteroids do not translate. They tumble in place, with rotation computed in
  the vertex shader from a per-instance axis, rate and phase, so tumble costs
  no CPU. Collision uses a sphere per rock at 0.85 × its scaled bounding
  radius (it is independent of rotation).

### 5.2 Rendering the belt

- The belt is divided into 1 km cells. Each cell holds one `InstancedMesh`
  per asteroid type that has instances in it, built once at load. three.js
  frustum-culls each cell mesh by its bounding sphere. Cells farther than a
  type's draw distance are hidden. Cells beyond 2 km switch to the `lod1`
  geometry.
- The material is `MeshStandardMaterial` extended through `onBeforeCompile`
  with: the per-instance tumble; a triplanar detail-noise normal and albedo
  perturbation that fades in at close range (so a landmark-scale rock does
  not show stretched texels); and an exposure-correct fill term from the
  environment.
- Draw-call budget: ≤ 400 per frame including everything else.

### 5.3 Near-field dust

A box of about 300 m around the camera holds about 5 000 dust points and
about 400 tiny instanced pebbles. They wrap toroidally as the camera moves,
so the box never runs out. The points stretch into short streaks along the
camera-relative velocity, which shows speed and drift direction even in
empty space.

### 5.4 Destruction

- Types 1–3 have hit points proportional to volume. When destroyed:
  - type 3 splits into 2–3 type-2 rocks plus chips;
  - type 2 splits into 2–4 type-1 rocks plus chips;
  - type 1 crumbles into chips and dust.

  Children inherit a share of the impact momentum and drift away. Any
  destroyed static rock leaves the static instance buffers (its instance is
  scaled to zero, and it leaves the hash). Its children become dynamic
  rocks.
- Up to 64 dynamic rocks exist at once, drawn as separate instanced meshes
  and moving with linear and angular velocity. When the cap is reached, the
  oldest are crumbled.
- Types 4–5 and landmarks are indestructible terrain. Hits on them make
  sparks and dust puffs.

### 5.5 Spatial hash

A uniform 100 m grid hash holds static rocks (inserted once), dynamic rocks,
ships and missiles (rebuilt each step). It serves projectile sweeps, ship
collisions, AI obstacle probes and the sun-flare occlusion ray.

## 6. Flight model

### 6.1 State and stats

State per ship: `position`, `velocity` (world), `orientation` (quaternion),
`angularVelocity` (ship-local), `throttle` (−0.35 … 1), `boostEnergy`
(0 … 100) and `flightAssist` (bool).

Player stats (enemy stats in the AI section):

| stat | value |
|---|---|
| main thrust accel | 45 m/s² |
| reverse thrust accel | 25 m/s² |
| lateral / vertical accel | 22 m/s² |
| afterburner accel (forward) | 120 m/s² |
| FA forward speed at throttle 1 | 180 m/s |
| FA forward speed with afterburner | 320 m/s |
| FA strafe speed limit | 60 m/s |
| max rate pitch / yaw / roll | 1.6 / 1.1 / 2.6 rad/s |
| angular accel pitch / yaw / roll | 6 / 4 / 9 rad/s² |
| afterburner drain / regen / regen delay | 25/s / 12/s / 1.5 s |

### 6.2 Flight assist on (default)

- The commanded local velocity is `(strafe·60, lift·60, −throttle·180)`; with
  the afterburner held, the forward target is −320. The controller computes
  `a = (v_cmd − v_local) / τ` with τ = 0.25 s, then clamps it per axis to
  that axis's thruster limit (forward and reverse separately). So when you
  turn, the old velocity bleeds off only as fast as the thrusters allow.
  That is the realistic slide.
- Rotation: the stick commands an angular rate. The controller drives
  `angularVelocity` toward it, clamped by angular accel. When the stick is
  released, the rotation stops at the same limited rate.

### 6.3 Flight assist off

- Thrust inputs apply their axis acceleration directly. The afterburner adds
  forward acceleration. Nothing damps velocity.
- The stick commands angular acceleration. Nothing damps rotation; spin
  persists until countered.
- The throttle still means "forward thrust fraction" (0 … 1, and negative
  for reverse).

### 6.4 Integration and collisions

- Semi-implicit Euler at 120 Hz. The quaternion is integrated from angular
  velocity and renormalised every step.
- Ship versus rock: the ship is a sphere of radius 6 m (player) or 5 m
  (enemy) against rock spheres. On contact the ship is pushed out along the
  normal. Its velocity is reflected with restitution 0.35 on the normal
  component and tangential friction 0.85. Damage is
  `max(0, v_n − 8) × 1.2` points. Camera shake scales with v_n.
- Ship versus ship: sphere-sphere collision with the same response;
  ramming damages both ships.

### 6.5 Controls (mouse and keyboard)

| input | action |
|---|---|
| mouse | virtual joystick: the cursor offset from screen centre (clamped to a ring, with a deadzone) commands pitch and yaw |
| W / S | throttle up / down (ramps while held, 0.6 of the full range per second) |
| X | throttle to zero (with FA on: brake to a full stop) |
| A / D | strafe left / right |
| R or Space / F or C | thrust up / down |
| Q / E | roll left / right |
| Shift | afterburner (hold) |
| Z | toggle flight assist |
| left mouse | plasma cannons |
| right mouse | fire missile |
| T | target the enemy nearest the crosshair; press again to cycle |
| V | toggle chase / nose camera |
| M | mute |
| Esc | pause (also triggered when pointer lock is lost) |

Pointer lock is requested on Launch and on clicking the canvas. Pause
settings: mouse sensitivity, invert pitch, and volume.

## 7. Combat

### 7.1 Plasma cannons (player)

- Two muzzles fire alternately at 12 shots/s overall.
- A bolt leaves at the muzzle velocity, 1 000 m/s along the nose, plus the
  ship's own velocity.
- Range: 2.2 s of life (about 2.2 km). Damage: 8.
- Heat: +4.5 per shot, cooling at 30/s. At 100 the guns lock until the heat
  drops to 40.
- Hits are tested by sweeping the bolt's segment for the step against the
  spatial hash (no tunnelling at 1 000+ m/s).
- On hit: sparks, a flash and a small light pulse. Rocks also get a dust
  puff. Shields also get a shield-shell ripple.

### 7.2 Missiles

- Capacity 6; rearms 1 every 8 s.
- Lock: the targeted enemy must stay within a 15° cone and 3 km for 0.8 s,
  with a growing tone and a closing HUD bracket. An unlocked missile flies
  straight (dumbfire).
- Flight: launched with the ship's velocity plus 30 m/s. The motor ignites
  after 0.25 s and accelerates at 220 m/s² up to 650 m/s relative to its
  launch frame.
- Guidance: proportional navigation, N = 4, lateral acceleration capped at
  350 m/s².
- Life 8 s. Proximity fuse at 12 m. Damage 80 at the centre, falling off
  linearly to 0 at 30 m (the blast also hurts rocks and the player).
- A missile leaves a dense smoke trail (section 8.5) and has a bright motor
  plume.
- Missiles collide with rocks.

### 7.3 Enemies

- Same flight model and FA-on controller, with their own stats: main
  accel 40, lateral 26, max rates 1.9 / 1.5 / 3.0 rad/s, forward cap 200 m/s,
  afterburner cap 300 m/s.
- Shield 30, hull 60.
- Cannon: 6 shots/s in bursts of 0.8–1.4 s. Bolt speed 850 m/s, damage 5,
  red-orange colour.
- The AI is a state machine run at 20 Hz with a per-enemy seeded RNG:
  - **Approach**: close to about 1.2 km, using the afterburner when far.
  - **Attack run**: fly to the lead point of the player. Fire when the
    lead-point angle is under 4° and the range is under 1.2 km. The aim
    error grows with range and with the player's lateral acceleration.
  - **Break off**: when the range is under 150 m or a run has lasted 6 s,
    pull to a random perpendicular direction and extend 600–900 m.
  - **Evade**: when hit or missile-locked, jink with random lateral thrust
    and rolls for 1.5–3 s; uses the afterburner against missiles.
  - **Avoidance** (always on): probe a sphere ahead along the velocity for
    2 s of travel. If it hits a rock, blend a steering correction away from
    the rock's centre.
- Damaged enemies (hull < 40 %) trail smoke and sparks.

### 7.4 Player survivability, waves and score

- Shield 100, regenerating at 15/s after 3 s without damage. Hull 100, no
  regeneration. Damage drains the shield first.
- At zero hull: death explosion, the camera drifts on, then the Destroyed
  screen.
- Wave k spawns `min(2 + k, 10)` enemies 2.5–3.5 km away, outside the
  player's view cone, in a loose formation. The next wave starts 6 s after
  the last kill, with an incoming-wave callout.
- Score: enemy kill 100 × wave; rock break 10 / 25 / 50 for types 1 / 2 / 3.
  The best score is kept in `localStorage` (`meteora.best`), with reads and
  writes wrapped in try/catch.
- Leaving the belt: more than 3 km outside the slab shows a "Leaving the
  field" warning. Nothing stops the player; there is simply nothing out
  there.

## 8. Rendering and effects

### 8.1 Frame pipeline

1. Scene into an HDR target: `HalfFloatType`, MSAA 4 samples where
   supported. Opaque objects first, then additive and alpha effects.
2. Bloom: a soft-knee threshold, 6-level dual-filter downsample and upsample
   chain, combined with per-level weights.
3. Composite to screen: exposure, AgX tone mapping, a slight
   chromatic-aberration fringe at the edges, vignette, and very light film
   grain. Then the lens flare overlay.
4. Dynamic resolution: the frame-time average adjusts the HDR target's
   scale between 0.6 and 1.0 of the canvas (canvas DPR capped at 2), so a
   heavy firefight degrades sharpness, not frame rate.

### 8.2 Lighting

- One sun (directional, warm white, high intensity). Ambient is
  near-absent; space is dark on the night side. That stark contrast is part
  of the realism.
- An environment map from the generated sky, through PMREM at low
  intensity, gives the metal ships reflections of the nebula and the planet.
- One 2048² shadow map follows the camera, covering a 600 m box: ships and
  near rocks cast onto ships and near rocks. It is updated every frame.
- A pool of 8 point lights is lent to muzzle flashes, explosions and
  missile motors by priority (nearest and brightest). Lights are never
  created at runtime, so shaders never recompile mid-fight.

### 8.3 Sky

Generated once at boot by rendering a fragment shader into a cubemap
(2048² per face on desktop):

- Milky Way: a band along a tilted great circle built from fBm, with dark
  dust lanes (domain-warped noise) and a brighter core bulge.
- Nebulae (added at the user's request: "nice nebulae", a showpiece rather
  than a faint wash). The sky has several distinct nebulae at seeded
  directions, each built from domain-warped fBm in 3D and lit with
  physically motivated colours:
  - **one large emission nebula** (about 35° across) near the Milky Way
    band: Hα crimson and magenta with OIII teal cores. Dark Bok-globule
    pillars and lanes cut into it. A few embedded hot blue-white stars
    light it from inside.
  - **one reflection nebula**: soft blue scattered light around a bright
    star cluster.
  - **one planetary nebula** (about 2°): a ring or bipolar shell, teal
    inside and red at the rim.
  - **one supernova remnant**: filamentary shell, red and green-teal
    filaments, faint.
  - **dark nebulae**: absorbing clouds that hide the stars behind them,
    in front of the band and the big emission nebula.

  Brightness is HDR-scaled so the cores bloom gently while the outskirts
  stay subtle. They are vivid but still astronomical: no flat
  cartoon saturation.
- Galaxies (added at the user's request). They are rendered into the
  cubemap at seeded directions away from the Milky Way band, where real
  extragalactic sky would show them:
  - **one large nearby spiral** (about 6° across, Andromeda-like): an
    inclined disc with a yellow-white bulge, logarithmic spiral arms with
    blue star-forming knots and pink HII regions, dust lanes on the near
    side, and a faint halo.
  - **one face-on grand-design spiral** (about 2°) and **one edge-on disc**
    with a dark dust line (about 1.5°).
  - **one elliptical** (smooth, warm, about 1°) and **one interacting pair**
    with a tidal tail (about 1.5°).
  - **about 150 tiny background galaxies**: sub-degree smudges in mixed
    shapes and orientations, findable by a player who looks closely.
- Background stars: hashed per direction cell. The magnitude distribution
  follows the real one (far more faint stars than bright ones), and colours
  are sampled from blackbody temperatures (3 000–12 000 K). Stars cluster
  toward the Milky Way band and thin away from it. Stars do not twinkle.

The cubemap is 2048² per face, so the 2° objects get about 45 px of
detail. Generation takes one render pass per face at boot; the target is
under 400 ms, measured on the dev overlay.

Also:

- Bright stars: about 2 500 `Points` at infinity, sized by magnitude, with a
  small diffraction glow. They stay pin-sharp at any resolution.
- Sun: an HDR disc with corona, bright enough to bloom. The lens flare
  (ghosts and a streak along the sun–centre axis) is occluded when a ray from
  the camera to the sun hits a rock or ship sphere, fading over 0.15 s.
- Gas giant: a large sphere far outside the belt, with banded procedural
  clouds, a Rayleigh-style rim glow on the lit limb, a dark night side, and
  rings that cast a shadow on the planet and are shadowed by it
  (analytic, in the shader).

### 8.4 Engine plume and attitude thrusters

- The main plume is a cone mesh per nozzle anchor with an additive shader:
  - axial falloff and a hot white core with a coloured sheath
    (blue-violet for the player, orange-red for enemies);
  - shock diamonds from a sine along the axis that fades with distance;
  - scrolling noise flicker, and view-angle edge softening.

  Length and brightness follow the forward thrust actually applied, not the
  throttle setting. The afterburner lengthens the plume ×2.2, shifts it
  white-hot and adds a short flame-noise layer. Idle shows only a dim
  nozzle glow.
- A nozzle glow sprite plus a borrowed point light while thrusting.
- RCS puffs: each step, the commanded linear and angular accelerations pick
  the ports whose push (`−d`, and torque `r × −d`) aligns with the command.
  Each picked port emits a brief puff (2–4 alpha particles, white-grey,
  fast-fading). Strafing, braking and turning all visibly fire thrusters.

### 8.5 Particles

- One particle system with two pools, each a single instanced draw:
  - **additive**: fire, sparks, flashes, plasma glow, embers;
  - **alpha**: smoke, dust, RCS gas.
- Simulation runs on the CPU into typed arrays, uploaded once per frame.
- Per particle: position, velocity, age, life, size curve, colour curve id,
  rotation, drag, and the stretch flag (sparks render as velocity-aligned
  streaks).
- Caps: 6 000 additive, 4 000 alpha. When a pool is full, a new particle
  replaces the oldest.
- The smoke shader uses a procedural noise sprite atlas generated at boot.
  Lighting is the sun direction against a pseudo-normal from the sprite's
  gradient, so smoke is lit on one side and dark on the other. Smoke
  expands, slows by drag and fades over 2–6 s.

### 8.6 Projectiles

Bolts are drawn as one instanced draw: camera-facing capsules stretched along
the velocity, with an HDR core (white) and a coloured halo. They bloom
strongly and read clearly at any range. The muzzle flash is a short-lived
star sprite at the muzzle plus a point-light flash.

### 8.7 Explosions

Layers on a shared clock, scaled by the explosion's size class (rock chip,
missile, enemy, player):

1. **Flash**: one frame or two of a big white-yellow sprite and a strong
   point light.
2. **Fireball**: a noise-displaced sphere shader. Temperature falls over
   0.6–1.4 s through a blackbody ramp (white → yellow → orange → dull red).
   The sphere expands fast, then slows, and erodes by noise threshold.
3. **Sparks**: 60–200 streaking additive particles with drag.
4. **Debris**: 8–20 procedurally generated hull shards (small irregular
   convex shapes) with ember emissive glow that cools, tumbling outward.
   They have no collision.
5. **Smoke**: soft lit puffs that billow up from the fireball's volume and
   linger for 4–6 s.
6. **Shockwave**: a thin additive ring expanding in a random plane, for
   ship and missile explosions only.
7. **Camera**: shake by distance, and a brief bloom surge.

### 8.8 Ship vibration (camera feel)

Added at the user's request: "a little shaking when the ship is moving, to
make it feel more realistic". In vacuum a ship coasting at constant velocity
feels nothing, so the shake comes from physical sources, all of which are
present whenever you are actually flying the ship through the belt:

- **Engine vibration**: a continuous high-frequency, low-amplitude tremor
  proportional to the forward thrust actually applied this step. It is
  strongest on the afterburner, which also adds a low-frequency rumble. At
  idle there is a barely perceptible hum.
- **Thruster knocks**: each RCS firing adds a tiny directional kick,
  opposite to the puff, so strafing and hard turns are felt as well as
  seen.
- **Dust buffeting**: micro-impacts from the belt's dust and grit. The
  amplitude scales with `speed × local belt density` (the same density
  field that places the rocks), so it is a faint shiver in open space and
  a rough ride at 300 m/s through a dense clump. It is irregular: filtered
  noise plus sparse random ticks, with the occasional bigger grain.

The shake is applied as a small rotation plus translation offset on the
camera, and in the chase view also as a fraction of that amplitude on the
ship model, so the ship visibly trembles in front of the camera. It never
touches the simulation: aim and physics are unaffected. Each source has an
amplitude in `config.js`. The pause settings have a "Ship vibration"
toggle; it defaults to on, or off under `prefers-reduced-motion`
(section 12). The amplitude model is a pure function in `shake.js`. Hits, collisions and
explosions keep their own, stronger, decaying shake (section 8.7).

### 8.9 Shields

A hit on shields shows a short-lived fresnel shell around the ship, rippling
from the impact point (an impact point uniform with an expanding ring in the
shader).

## 9. Code modules (`fun/meteora/js/`)

Simulation modules import nothing from three.js (math is done on plain
arrays or a tiny local vector helper), so Node tests can run them without a
DOM or GPU.

| module | role | pure sim? |
|---|---|---|
| `config.js` | every tunable number from this spec | yes |
| `rng.js` | seeded PRNG, hashing, noise | yes |
| `vec.js` | small vec3/quaternion helpers on plain arrays | yes |
| `flight.js` | `stepShip(ship, controls, stats, dt)`: FA controller, integration, RCS port selection | yes |
| `field.js` | belt generation from the seed, cells, spatial hash, collision queries, destruction and splitting | yes |
| `weapons.js` | bolts, missiles, lock, PN guidance, hit sweeps | yes |
| `ai.js` | enemy state machine and avoidance | yes |
| `combat.js` | damage, shields, waves, score, the event stream (events like `hit`, `kill`, `explode` that renderers subscribe to) | yes |
| `world.js` | owns the simulation: steps ship, AI, weapons, field and combat in order at 120 Hz | yes |
| `input.js` | keyboard, pointer lock, virtual-joystick cursor | no |
| `models.js` | GLB loading, anchor extraction, materials setup | no |
| `field-render.js` | cell instanced meshes, tumble shader, dynamic rocks | no |
| `sky.js` | cubemap generation, bright stars, sun, planet, flare | no |
| `post.js` | HDR target, bloom, composite, dynamic resolution | no |
| `plumes.js` | engine plume meshes and shader | no |
| `particles.js` | the two pools and their shaders | no |
| `fx.js` | maps sim events to particles, lights, explosions, shakes | no |
| `explosions.js` | fireball, shockwave, debris layers | no |
| `dust.js` | near-field dust and pebbles | no |
| `shake.js` | ship-vibration amplitude model: engine, RCS kicks, dust buffeting (section 8.8) | yes |
| `camera.js` | chase spring camera with acceleration lag and afterburner FOV; nose camera; shake | no |
| `hud.js` | canvas-2D HUD | no |
| `audio.js` | procedural Web Audio | no |
| `screens.js` | start, pause and destroyed overlays; settings | no |
| `main.js` | boot, loading progress, loop, render interpolation | no |

The loop is the Alpen one: accumulate real time, step the world in fixed
1/120 s steps (capped at 8 steps per frame), interpolate positions and
orientations for rendering, and drain the event queue into `fx`, `audio`
and `hud`.

Attract mode: before Launch, the player ship idles in the belt and the
camera slowly orbits it behind the start screen.

## 10. Testing

Node checks in `fun/meteora/tests/`, runnable with `node tests/<name>.mjs`
and no dependencies:

- **flight-check**:
  - FA on reaches the throttle target velocity and never exceeds an axis's
    thruster limit in any step;
  - a 90° turn at speed produces a slide that decays at the lateral accel
    limit;
  - FA off conserves linear and angular momentum with no input;
  - the afterburner raises accel and target speed and drains and regains
    energy at the stated rates;
  - the step is stable at 120 Hz;
  - RCS port selection picks ports that oppose the command.
- **field-check**:
  - the same seed gives an identical belt;
  - counts match the config;
  - no rock overlaps another;
  - the spawn sphere is clear;
  - hash queries agree with brute force;
  - splitting conserves momentum and respects the dynamic-rock cap.
- **weapons-check**:
  - bolts inherit ship velocity;
  - the swept hit test catches a 1 000 m/s bolt passing a 1.5 m rock;
  - heat lockout and recovery;
  - lock timing and the cone;
  - PN missiles hit a target that turns at 3 g, from several geometries;
  - the proximity fuse fires and damage falls off with distance.
- **ai-check**:
  - an enemy reaches attack range;
  - it fires only within the angle and range gates;
  - it breaks off when close;
  - over a 60 s run in a dense cell it does not fly into a rock;
  - it evades when locked.
- **shake-check**:
  - a stationary ship with zero thrust gives only the idle hum;
  - the amplitude rises monotonically with applied thrust and with
    `speed × density`;
  - the afterburner adds the low-frequency rumble;
  - turning the vibration setting off zeroes everything but impact shake.
- **combat-check**: shield before hull, regen delay, wave sizes, score,
  best-score storage that survives a throwing `localStorage`.
- **models-check**: parses each GLB's JSON chunk and checks:
  - the file exists and fits its size budget;
  - triangle counts per node are within budget;
  - every required anchor exists, with RCS coverage of all six linear and
    three angular directions;
  - asteroids have `lod0` and `lod1`;
  - textures are present.

Browser verification during implementation: serve the repo root locally
and drive the built-in browser pane. Screenshot the start screen, flight,
combat and explosions, and the sky. Check the console is clean on boot
(including no favicon 404), and read the frame-time log in the dev overlay
(`?debug` shows fps, draw calls, triangles, particle counts and the
dynamic-resolution scale).

## 11. Performance targets

- 60 fps at 1440p on an Apple M1-class integrated GPU during a 10-enemy
  fight, with dynamic resolution allowed to drop to 0.75.
- Per frame: ≤ 400 draw calls, ≤ 2.5M triangles drawn, ≤ 6 ms of JS
  (simulation plus render prep).
- Boot to playable: ≤ 4 s on a warm cache, with sky generation included.
  Loading progress is shown.

## 12. Failure handling

- No WebGL2: the start screen says so plainly and hides Launch.
- A model fails to load: the loading bar stops with a message naming the
  file and a Retry button. The game never starts with missing models.
- Pointer lock refused or lost: pause, and show "Click to fly". The game
  never runs with a free cursor.
- WebGL context lost: pause, and show a message with a Reload button. GPU
  resources are not rebuilt in place (an in-place rebuild is a non-goal);
  the best score is already saved.
- Audio starts only on the Launch gesture. A suspended `AudioContext` is
  resumed on the next input.
- `prefers-reduced-motion`: the ship-vibration setting defaults to off
  (the player can turn it on), impact shake is halved, flash intensities and
  the bloom surge are halved, and the dust streak length is reduced.

## 13. Non-goals (this version)

Touch and gamepad controls, multiplayer, missions or a campaign, ship
upgrades, mid-run saves, soft (depth-faded) particles, a cockpit interior
model, screen-space reflections, and mobile GPU budgets.
