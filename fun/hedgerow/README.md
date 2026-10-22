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
baked in), foliage is alpha cards rendered from modelled leaves (light
shines through them: a crown between you and a flare or a fire glows green
where its leaves are thinnest), meadows
and verges are tens of thousands of single blades of grass that bend in
the wind, part round your legs and flatten outward under a blast's
shockwave, stones lie in the mud of the lanes and
yards and twigs on the forest floor, the trunks show their bark close up
(furrowed oak and pine, smooth beech, moss low on the weather side) and
walls, wrecks and crates the grain of their surface, behind
each lit window there is a room — papered walls, beams overhead, a table
under a lamp, a cupboard, lace across the bottom of some windows — that
shifts with parallax as you walk past, seen up close through rain beaded on
the glass, and its light falls out onto the
street, a cart, a bicycle against the wall, the rifle in your hands, in the
shape of the window with its glazing bars across it, the rain in front of
it glowing with it, and the
renderer adds wet ground — dark, glossy cobbles with water in the joints
(and, near the eye, real depth: the stones stand proud of their joints, the
mud keeps its ruts, the march of the view ray through the height maps),
puddles with soaked margins in the hollows that mirror the lit windows, the
lamps and the glow of the sky, broken by rain rings, river banks soaked
above the waterline with a thin broken line of scum where the water laps
them and the water browner in the shallows of the ford, a forest floor of last year's leaves with moss in the
damp, leaves and litter in the gutters, brick bits round the shelled houses,
stones and fallen branches along the lane and the forest track, whose mud is
cut by two wheel ruts with a grassy crown between them and water standing in
them in stretches, rainwater standing in the shell craters — rain in fine
streaks, falling in sheets far down the street, sweeping across in gusts,
dripping and pouring in broken strings off the eaves, lit by lamps, fires
and flares,
halos in the wet air, low mist, bullet holes that catch the light — stone
chipped pale round a black hole, wood splintered, paint flaked off a dent to
the bare steel — mud kicked up and the scorch of blasts, a low
cloud deck rolling overhead, its bellies lit orange from below over the
burning farms, whose smoke climbs into it in leaning columns, and caught by
the flashes of a distant barrage, searchlights sweeping
the cloud over the front and flak tracer going up into it, and every half minute
or so an illumination flare going up over the front and sinking under its
parachute, lighting the cloud, glittering on the wet cobbles and laying long
shadows of houses, walls, soldiers and trees (dappled under the crowns) that
swing as it drifts, its light hanging in the rain in shafts between the roofs.
Lightning does the same for its fraction of a second: a cold, blinding light
from the bolt — high over a near strike, low over the horizon for a far one,
the bolt itself forking down out of the cloud about half the time — that
throws every house's shadow across the street.
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
    set has one, the `_lod` impostor beyond the quality's near range (those
    distances, and the soldiers' 30 m, as they look through the view: down
    the sights they reach 1.4 times further)
  * `player.js` (first person: your own animated body, the head folded
    away, the rifle shouldered; aiming turns the body and bends the spine
    until the sights lie along the view; the arms carry the rifle canted low
    at a sprint, up and aside at a wall, down out of sight while changing
    weapons), `viewmotion.js` (the springs on top: the rifle lags a quick
    turn, kicks up with each shot and settles, the eye dips on a landing),
    `reload.js` (the reload's clip and magazine; in first person on
    the shouldered rifle, tilted into view, the fresh one seating in the
    picture), `camera.js` (at the eyes, down the
    sights when aiming, flinching from a hit; dying, the eyes go down with
    the body for a moment before the over-the-shoulder death camera turns to
    the killer),
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
  * `ruts.js` the lane's and the forest track's wheel ruts: their centrelines
    (the level's `lines`) drawn at load into a half-float texture of the
    distance across and along them, from which the terrain cuts two ruts a
    cart's track apart, wandering a little, into its near-eye relief, dark
    with wet mud, holding water in stretches, a grassy crown between them
  * `ponds.js` rainwater in the shell craters (the level's `craters`): a
    disc at two fifths of each holding bowl's depth, cut by the bowl's own
    sides, drawn with the river's water held still (shallows and a line of
    scum from its depth in the ground map, rain rings, no white glint of the
    night's fill light); the ground map keeps grass and clutter out of it
  * `groundmap.js` what grows and lies where, made at load from the
    terrain mesh's own splat: grass, stones and fallen wood (none on roads,
    steep banks, at the water or inside anything solid), and the ground's
    height as the mesh draws it · `grass.js` the meadow grass on the GPU:
    one instanced draw of tufts of blades round the camera (high ~21 m,
    medium ~14 m, none on low), each placed, sized and leaned by a hash of
    its world cell; tufts out of view collapse before the expensive part;
    light shines through the blades as through the leaves, most at their tips;
    the ground under it turns to dark, dry sward · `clutter.js` the same
    for stones (grit to fist-sized, a third sunk) and twigs within ~9 m,
    lying along the slope (high and medium)
  * `materials.js` palette-keyed wet materials (and close-up bark on the
    baked trunks: the bark detail projected in the tree's own space from
    two sides, per species; on the other baked solids within ~7 m a
    generated metre of surface grain in world space from three sides,
    mottling everything and roughening what is baked rough, not where water
    stands; rain running down walls within ~24 m in
    rivulets that slide down and catch the light; the soldiers' skin, found
    in their atlas by its colour, scattering light under its surface (the
    light wrapping past the shadow's edge, reddest; the hands on the rifle
    included), and their wool, found by its baked roughness and its colour
    (field grey, olive or khaki below the collar, not leather), darkening in
    the rain but never glossy, with a fabric's sheen at grazing angles;
    within 3 m (your own arms round the rifle, a man at arm's length) the
    weave of that wool and the grain of the skin, laid on in the model's
    own bind-pose space so they move with him;
    round a fire, the charred
    wood of a ruin glowing in the cracks of its char and a burnt-out wreck's
    metal a dull red with the heat) · `rooms.js` the rooms
    behind the lit windows: at load the panes are found in the houses'
    baked glow (lit, flat, upright, at least a hand's breadth) and split off
    with their frame in a vertex attribute; their shader carries the view
    ray on through the glass into a box with a table and a cupboard lit by
    a lamp that throws their shadows (interior mapping), each room drawn
    from its own seed; the curtains drawn back in front glow less ·
    `windowlight.js` that light leaving the window: a frustum per lit pane
    round the light of a lamp behind it, drawn in the late pass, each pixel
    rebuilt from the depth and lit if the line from the lamp to it passes
    through the pane, as by a glowing window (inverse square, both angles;
    the normal rebuilt from the neighbours on the same surface), and the
    same light scattered by the wet air along the view ray's stretch
    through that light, in four jittered steps ·
    `sky.js` (the cloud deck: rolls and billows of noise warped by itself,
    the fires' light on its base falling off with distance; drawn after
    the solid scene, so only the sky that shows is shaded), `drips.js` (the
    water off the eaves: at load the lower edges of the roofs are found in
    the house, church and barn models, a point every quarter metre with
    how far it falls (to the ground or the part of the building below);
    each fall is one thin ribbon whose shader places the falling water on
    it - drops that speed up and stretch, or a string that breaks up as it
    goes - and within 9 m a crown of droplets where each drop lands, the
    rain's own crown shader with the moment worked out from the same
    schedule), `weather.js`
    (rain: near streaks a drop wide but never under a pixel and a half,
    faint out in the dark and glittering by a lamp, a fire, a flare or the
    lightning,
    and beyond them, out to ~60 m, sheets of rain worked out per pixel on
    four cylinders round the eye in one full-screen draw, hidden behind the
    scene by its depth, lit by the lamps near them and by a burning flare;
    rings where drops land (on the river's surface over its bed), and
    within 7 m crowns of droplets flung up and
    out of each, a few thousand a second, drawn after the frame; all of it
    in gusts — bands of heavier, harder-leaning rain some 30 m across blown
    downwind, one noise shared by the shaders and the splashes - and by the
    trees, which lean downwind and shake harder as a gust sweeps through,
    and the meadow grass, which lies over in it; lightning), `lights.js` (pooled point lights; a muzzle's or a blast's flash lights
    the surfaces round it but only a little of the wet air; a fire's light
    sways and leaps with its flames, so the shadows round it dance),
    `fill.js` (the night's fill lights — the low key light from the last of
    the sun, the rim light of the overcast — model shapes but make no
    glints on the world: their direct specular is cut to a tenth on the
    ground, water, walls and leaves, where they made a sun on the puddles
    under a sky with no sun; the soldiers and their weapons keep it),
    `flares.js` (illumination flares: a far light for the haze and the
    smoke, a directional light along it for the ground (as bright as the
    flare is at the player, eased towards a ceiling close under one), its 80 m shadow
    map drawn every other frame only while one burns, the tree crowns'
    leaf cards cut out by their alpha; the shaders it needs are warmed at
    the start of the mission; when none burns, a lightning stroke drives the
    same light from the bolt's direction),
    `effects.js` (particles: smoke and dust lit by the nearest lamps,
    fires and flashes, soft where they meet the scene; the fires' embers
    carried off on the wind for seconds, swirling in its eddies as they
    cool; blasts throw up a
    column of earth and roll dust along the ground; a shot or a step into
    water throws up a spout of spray and spreads a ring flat on it; tracers
    and sparks never
    thinner than a pixel and a half, so fire from a hundred metres off is
    still an unbroken line), `flames.js` (the
    fires as flame: three billboards per near fire, each a turbulent body
    of flame worked out in its shader, licking up in tongues, coloured by
    its heat from deep red to a yellow-white core), `plumes.js` (each
    fire's smoke climbing ~90 m on from its particles: a ribbon turned to
    the camera about an axis that leans downwind as it climbs, billows of
    noise in metres rising through it, lit orange from below by the fire
    and by flares and lightning, fading into the haze; drawn before the
    light in the rain, whose glow hangs in front of it), `fireball.js` (a
    blast's fireball: a billboard whose shader swells a ball of turbulent
    flame in a tenth of a second, yellow at its heart and orange in its
    folds, cooling from the outside in to a dull red glow inside a ball of
    smoke that rolls up and thins into the blast's dust), `atmosphere.js`
    (halos, mist, and decals: four painted variants of each kind with their
    own relief, drawn pulled a few centimetres towards the eye along their
    sight line so a wall's stones do not swallow them), `casings.js` (the
    brass thrown out of the gun — the Garand's long bottlenecked case, the
    Thompson's short one — tumbling past in the muzzle flash, bouncing and
    lying where it falls; the last 64 of each stay), `chunks.js` (what a
    blast throws up: clods of mud and turf, or stones off the cobbles, as
    solid lumps that tumble, knock off walls, bounce and lie where they
    fall),
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
    through the crowns), at half resolution; and for the lamp or fire
    casting shadows near the camera, the share of its glow along each ray
    that is not in shadow (twelve equiangular looks into its cube shadow
    map), so a truck's cab or a wall cuts dark shafts out of its glow · `volumetric.js` lays the
    occlusion, the reflections and the shafts on and adds the light
    scattered in the rain by up to eight lamps, fires and
    flashes (the closed-form airlight integral, cut by the depth) · `taa.js`
    temporal anti-aliasing (the projection jittered by a sub-pixel Halton
    step each frame, each frame blended into the history reprojected by
    the depth and held to its neighbourhood; the rifle in your hands is not
    reprojected) · `motionblur.js` camera motion blur as the view turns
    or moves (each pixel smeared along its own motion since the last frame
    over a 180-degree shutter; the rifle and hands stay sharp; high and
    medium) · the late particles of `effects.js` and the rain, drawn
    after it so they stay crisp · `distort.js` heat haze shimmering in a
    column over each of the four nearest fires and a blast's shockwave
    ring racing out for half a second, each found along the view ray
    against the depth (walls in front are not bent, nor is the rifle) ·
    `dof.js`
    focus on what is under the crosshair while aiming · `bloom.js` ·
    `post.js` the grade (sharpening, contrast, colour, vignette, grain, the
    hurt state, and the mud a blast close by throws over the view: dark wet
    splats along the bottom and flecks round the edges, some dripping,
    gone in a few seconds); the high and medium qualities run all of it, low only the
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
  (with a gap so they don't flicker), trees sort into full, mid and far,
  and down the sights detail reaches as far as the narrower view makes
  things look near;
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
  sprint and out of it while changing weapons, and the sway, kick and
  landing dip stay within a few degrees and centimetres and settle:

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
