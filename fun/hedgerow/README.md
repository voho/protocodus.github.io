# Hedgerow

A first-person Second World War shooter for the browser — realistic-looking,
arcade to play. You are one soldier pushing through hand-built missions; this
proof of concept has the first one:

**Mission 1 — Saint-Clair, at dusk.** Normandy, July 1944, evening, rain.
Up a sunken lane between hedgerows, through the checkpoint into the village,
up the main street to the church square (sniper in the tower), over the
river (bridge under a machine gun, a ford downstream, a fallen tree
upstream), through the forest's foxholes and trench line, past a concrete
bunker, to the flak gun in the clearing — blow it up — and on to the rally
point.

Every defended point has more than one way past it: the orchard or the ditch
round the checkpoint, the back gardens or the ruined house along the street,
three river crossings, the ends of the trench, the flanks of the bunker.

The look is built for realism at dusk in the rain: every model carries baked
PBR textures (stone courses and mortar, peeling paint, rusted and chipped
steel, hessian, wool, bark and moss, with occlusion, grime and rain streaks
baked in), foliage is alpha cards rendered from modelled leaves, meadows
and verges are tens of thousands of single blades of grass that bend in
the wind and part round your legs, stones lie in the mud of the lanes and
yards and twigs on the forest floor, the trunks show their bark close up
(furrowed oak and pine, smooth beech, moss low on the weather side), and the
renderer adds wet ground — dark, glossy cobbles with water in the joints
(and, near the eye, real depth: the stones stand proud of their joints, the
mud keeps its ruts, the march of the view ray through the height maps),
puddles with soaked margins in the hollows that mirror the lit windows, the
lamps and the glow of the sky, broken by rain rings, river banks soaked
above the waterline, a forest floor of last year's leaves with moss in the
damp, leaves and litter in the gutters, brick bits round the shelled houses,
stones and fallen branches along the lane and the forest track — rain lit by lamps and
fires, halos in the wet air, low mist, bullet holes and scorch marks, distant
artillery flashes and burning farms beyond the hedges, and every half minute
or so an illumination flare going up over the front and sinking under its
parachute, lighting the cloud, glittering on the wet cobbles and laying long
shadows of houses, walls, soldiers and trees (dappled under the crowns) that
swing as it drifts, its light hanging in the rain in shafts between the roofs.
Lightning does the same for its fraction of a second: a cold, blinding light
from the bolt, low over the horizon, that throws every house's shadow across
the street.
Lamps and fires cast
soft shadows and their light hangs in the rain between you and them, corners
and the ground under things darken, and the frame is finished like film —
contrast, sharpening, grain in the shadows — going soft behind whatever you
aim at.

## Controls

| | |
|---|---|
| Mouse | look and aim |
| W A S D | move |
| Shift | sprint |
| C / Ctrl | crouch (toggle) |
| Space | vault low cover / jump |
| Left / right button | fire / aim down the sights |
| R | reload |
| 1 / 2 / wheel | M1 Garand / Thompson |
| G | grenade (hold to cook) |
| E | use (set the charge) |
| Esc | pause |

Health comes back when you stay out of fire. Dying returns you to the last
checkpoint; the enemies you killed stay dead.

The Germans are not statues. Patrols walk their beats and stop to look
round. A shot or a grenade heard from a distance sends one or two of a
group to look while the rest get into cover facing the sound. Break contact
and they split up: some search where you were last seen and look round the
corners nearby, and if you were on the move some run ahead along your way,
crouch behind cover and wait for you to walk into their sights. Afterwards
they go back to their posts, warier for a while. When one of them kills you
the camera turns to him and follows him — usually as he walks over to make
sure.

Reloading is a real motion: the empty Thompson magazine drops to the ground
and a fresh one comes up in the left hand; the Garand's empty clip flies out
with its ping on the last shot. R reloads, an empty trigger reloads, and the
gun reloads by itself after the last round. The enemy reloads too — five
rounds for a Kar98k, 32 for an MP 40, a 75-round belt for the MG 42 — and
ducks while he does. The dead fall as ragdolls, pushed by the shot or thrown
by the blast that killed them, and drop their rifles.

## How it is built

* `js/` — three.js r185 (the site's vendored copy), plain ES modules, no build.
  * `main.js` boot, menus, frame loop with dynamic resolution (holds ~60 fps
    by scaling the render down to 60 % on slow GPUs and dense screens, and
    back up when there is headroom) · `levelBuild.js` level data → world ·
    `levels/saint-clair.js` the mission (ground, props, enemies, objectives)
  * `terrain.js` heightfield + splat material · `world.js` colliders, rays,
    walking · `vegetation.js` instanced trees and ground cover in up to
    three tiers: full model, a thinned `_mid` beyond ~22 m when the nature
    set has one, the `_lod` impostor beyond the quality's near range
  * `player.js` (first person: your own animated body, the head folded
    away, the rifle shouldered; aiming turns the body and bends the spine
    until the sights lie along the view; the arms carry the rifle canted low
    at a sprint, up and aside at a wall, down out of sight while changing
    weapons), `reload.js` (the reload's clip and magazine; in first person on
    the shouldered rifle, tilted into view, the fresh one seating in the
    picture), `camera.js` (at the eyes, down the
    sights when aiming; the over-the-shoulder rig for the death camera),
    `character.js` (rig, split upper/lower body animation, the upper body
    steadied on the gait in first person, the outfit's low-detail `_lod`
    mesh beyond 30 m), `ragdoll.js` (Verlet bodies driving the bones), `combat.js`
    (hit volumes, grenades, charges, dropped magazines and rifles), `ai.js`
    (perception, cover, MG nests, sniper, reloads; patrols; sounds looked
    into; a lost player searched for where he was seen and ambushed along
    his way; the killer checks the body; soldiers out of view are not drawn
    and are posed five times a second), `nav.js` (the 2 m walk grid and A*
    paths round houses, walls and the river), `mission.js`
  * `distance.js` the countryside beyond the level: a terrain ring of fields
    and woods to ~1 km with thousands of far-LOD trees, copses on the far
    hills, rings of layered treeline cards on the horizon (150–350 m, facing
    the level, open towards the far buildings) and the next village
  * `groundmap.js` what grows and lies where, made at load from the
    terrain mesh's own splat: grass, stones and fallen wood (none on roads,
    steep banks, at the water or inside anything solid), and the ground's
    height as the mesh draws it · `grass.js` the meadow grass on the GPU:
    one instanced draw of tufts of blades round the camera (high ~21 m,
    medium ~14 m, none on low), each placed, sized and leaned by a hash of
    its world cell; tufts out of view collapse before the expensive part;
    the ground under it turns to dark, dry sward · `clutter.js` the same
    for stones (grit to fist-sized, a third sunk) and twigs within ~9 m,
    lying along the slope (high and medium)
  * `materials.js` palette-keyed wet materials (and close-up bark on the
    baked trunks: the bark detail projected in the tree's own space from
    two sides, per species) · `sky.js`, `weather.js`
    (rain, splashes, lightning), `lights.js` (pooled point lights),
    `flares.js` (illumination flares: a far light for the haze and the
    smoke, a directional light along it for the ground, its 80 m shadow
    map drawn every other frame only while one burns, the tree crowns'
    leaf cards cut out by their alpha; the shaders it needs are warmed at
    the start of the mission; when none burns, a lightning stroke drives the
    same light from the bolt's direction),
    `effects.js` (particles: smoke and dust lit by the nearest lamps,
    fires and flashes, soft where they meet the scene; blasts throw up a
    column of earth and roll dust along the ground), `flames.js` (the
    fires as flame: three billboards per near fire, each a turbulent body
    of flame worked out in its shader, licking up in tongues, coloured by
    its heat from deep red to a yellow-white core), `atmosphere.js`
    (halos, mist, decals),
    `audio.js` (procedural, nothing downloaded; foley: steps by what is
    underfoot — hobnails on stone, sucking mud, swishing grass, crackling
    leaves, hollow planks, splashing water — the kit when running and
    landing, reloads in their parts, empty cases ringing on stone, bodies
    and rifles falling, ricochets, rain ticking on the helmet)
  * the effects chain (`renderer.setEffects`, in order): the particles of
    `effects.js` drawn into the scene's buffer with its depth · `ssao.js` ambient
    occlusion at half resolution · `ssr.js` reflections in the wet ground,
    the puddles and the river, at half resolution (a ray marched through the
    depth from each pixel the scene pass marked as mirror-like in its alpha,
    `mirrorAlpha`) · `shafts.js` while a flare burns, the lit length of
    each view ray's first 45 m in its shadow map (beams between the roofs,
    through the crowns), at half resolution · `volumetric.js` lays the
    occlusion, the reflections and the shafts on and adds the light
    scattered in the rain by up to eight lamps, fires and
    flashes (the closed-form airlight integral, cut by the depth) · `taa.js`
    temporal anti-aliasing (the projection jittered by a sub-pixel Halton
    step each frame, each frame blended into the history reprojected by
    the depth and held to its neighbourhood; the rifle in your hands is not
    reprojected) · the late particles of `effects.js` and the rain, drawn
    after it so they stay crisp · `distort.js` heat haze shimmering in a
    column over each of the four nearest fires and a blast's shockwave
    ring racing out for half a second, each found along the view ray
    against the depth (walls in front are not bent, nor is the rifle) ·
    `dof.js`
    focus on what is under the crosshair while aiming · `bloom.js` ·
    `post.js` the grade (sharpening, contrast, colour, vignette, grain, the
    hurt state); the high and medium qualities run all of it, low only the
    grade
* `assets/models/*.glb` — built by the Blender scripts in `tools/blender/`;
  see `assets/models/MODELS.md` (pipeline, sizes, build commands),
  `tools/blender/notes/` (every node) and `docs/models-brief*.md`:

      /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
          --python fun/hedgerow/tools/blender/build_<set>.py
      python3 -I fun/hedgerow/tools/fix_card_alpha.py fun/hedgerow/assets/models/{village,military,nature}.glb

  for `village`, `military`, `nature` and `soldier` (soldier + weapons).
  Shared: `kit.py` (modelling helpers, palette, export), `bake.py` (the PBR
  bake), `surfaces.py` (procedural surfaces).
* `assets/textures/*.webp` — tileable detail textures from
  `python3 fun/hedgerow/tools/textures.py`.
* `tests/world-check.mjs` — collision world unit checks;
  `tests/character-check.mjs` — the aim pitch stays put under held poses
  (three's mixer skips unchanged bones), reload clip timing and the hand prop,
  per-soldier face blends (each enemy mixes the rig's `face_broad`,
  `face_gaunt` and `face_older` shape keys);
  `tests/ragdoll-check.mjs` — a shot soldier falls, is pushed by the shot,
  keeps his limbs' length and comes to rest;
  `tests/route-check.mjs` — rebuilds the level's collision world from the
  real GLB colliders and walks every route (main road, both flanks of the
  checkpoint, the gardens, all three river crossings, both trench ends, both
  bunker flanks), with negative controls, and checks every wall lamp and
  ivy patch has a wall behind it;
  `tests/distance-check.mjs` — the horizon treelines face the level, sit
  in the ground and leave the far village in sight;
  `tests/lod-check.mjs` — soldiers switch to low detail at a distance
  (with a gap so they don't flicker), trees sort into full, mid and far;
  `tests/ai-check.mjs` — on the real level: every patrol route walkable, a
  patrol walks it, a distant shot is looked into, lost contact means a
  search and an ambush (hidden, facing his way, springing from cover), the
  killer walks to the body, the death camera follows him;
  `tests/clutter-check.mjs` — the ground clutter's pieces exist, lie beside
  things rather than inside them, out of the river and the middle of the
  street;
  `tests/fp-check.mjs` — first person on the real rig and rifles: walking,
  sprinting and crouching move the rifle in view no more than standing
  still does (the gait's bob and twist steadied out of the upper body),
  aiming puts the front sight in the middle of the view, the fresh clip or
  magazine seats in the picture, the rifle is carried in the picture at a
  sprint and out of it while changing weapons:

      node fun/hedgerow/tests/world-check.mjs
      node fun/hedgerow/tests/route-check.mjs
      node fun/hedgerow/tests/character-check.mjs
      node fun/hedgerow/tests/ragdoll-check.mjs
      node fun/hedgerow/tests/distance-check.mjs
      node fun/hedgerow/tests/lod-check.mjs
      node fun/hedgerow/tests/ai-check.mjs
      node fun/hedgerow/tests/fp-check.mjs
      node fun/hedgerow/tests/clutter-check.mjs

URL switches for testing: `?debug` (frame stats), `?god`, `?fly` (free
camera; WASD, Q/E, Shift), `?at=x,z` (start elsewhere), `?go` (straight to
the briefing), `?test=<glb>` (drop a model in front of the free camera).

Type: everything is set on the typewriter — Courier Prime (OFL) for the
interface and Special Elite (Apache 2.0) for the wordmark and headings,
self-hosted in `assets/fonts/` with their licences.

Design notes: `docs/2026-10-19-hedgerow-design.md`.
