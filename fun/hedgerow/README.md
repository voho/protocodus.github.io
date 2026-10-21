# Hedgerow

A third-person Second World War shooter for the browser — realistic-looking,
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
baked in), foliage is alpha cards rendered from modelled leaves, and the
renderer adds wet reflective ground with puddle ripples, rain lit by lamps and
fires, halos in the wet air, low mist, bullet holes and scorch marks, distant
artillery flashes and burning farms beyond the hedges.

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
| Q | switch shoulder |
| Esc | pause |

Health comes back when you stay out of fire. Dying returns you to the last
checkpoint; the enemies you killed stay dead.

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
  * `player.js`, `camera.js`, `character.js` (rig, split upper/lower body
    animation, the outfit's low-detail `_lod` mesh beyond 30 m), `ragdoll.js` (Verlet bodies driving the bones), `combat.js`
    (hit volumes, grenades, charges, dropped magazines and rifles), `ai.js`
    (perception, cover, MG nests, sniper, reloads; soldiers out of view
    are not drawn and are posed five times a second), `mission.js`
  * `distance.js` the countryside beyond the level: a terrain ring of fields
    and woods to ~1 km with thousands of far-LOD trees, copses on the far
    hills, rings of layered treeline cards on the horizon (150–350 m, facing
    the level, open towards the far buildings) and the next village
  * `materials.js` palette-keyed wet materials · `sky.js`, `weather.js`
    (rain, splashes, lightning), `lights.js` (pooled point lights),
    `effects.js` (particles), `atmosphere.js` (halos, mist, decals),
    `post.js` + `bloom.js`, `audio.js` (procedural)
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
  (with a gap so they don't flicker), trees sort into full, mid and far:

      node fun/hedgerow/tests/world-check.mjs
      node fun/hedgerow/tests/route-check.mjs
      node fun/hedgerow/tests/character-check.mjs
      node fun/hedgerow/tests/ragdoll-check.mjs
      node fun/hedgerow/tests/distance-check.mjs
      node fun/hedgerow/tests/lod-check.mjs

URL switches for testing: `?debug` (frame stats), `?god`, `?fly` (free
camera; WASD, Q/E, Shift), `?at=x,z` (start elsewhere), `?go` (straight to
the briefing), `?test=<glb>` (drop a model in front of the free camera).

Type: everything is set on the typewriter — Courier Prime (OFL) for the
interface and Special Elite (Apache 2.0) for the wordmark and headings,
self-hosted in `assets/fonts/` with their licences.

Design notes: `docs/2026-10-19-hedgerow-design.md`.
