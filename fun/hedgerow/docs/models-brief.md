# Hedgerow — models brief

All models are built by deterministic Python scripts run in headless Blender
5.3 and exported as GLB. Read `tools/blender/kit.py` first: it holds the
helpers and the palette, and its docstring is the contract.

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python fun/hedgerow/tools/blender/build_<set>.py

(run from the repository root of the worktree; scripts locate files relative
to themselves through `kit.ROOT`).

## Look

"Realistic-looking but arcade": a 1944 Normandy village and forest at dusk
in the rain, seen from a third-person camera 2–4 m behind the player.
Real-world scale and proportions, believable construction (stone courses,
window frames and sills, shutters, door frames, ridge tiles, chimneys,
gutters, planks, posts, rivets, straps). Silhouettes matter more than
surface detail because the scene is dark, foggy and wet: chamfer/bevel
edges that catch light, break perfectly straight lines a little (`jitter`,
slight sag on roofs, irregular stone), avoid default-cube looks. Muted,
weathered palette. No text that needs a font. Not cartoonish, not gory.

The game shades every material itself (tiling detail textures, rain
wetness, reflections), keyed by material name. So: **use only palette keys
as material names** (`kit.material(key)`), give every surface a sensible
key, and do not bake images or add textures.

## Conventions (every model)

* Blender space, Z up, metres. The model's **front faces -Y** (front door,
  firing slit, a soldier's face, a gun's muzzle) — that is three.js +Z.
* One exported **mesh object per model** (join parts; several materials per
  object are fine), at the world origin, its **base at z = 0** and centred
  on the footprint (`kit.finalize` does this) unless the model section
  says otherwise. Object name = the node name listed below, exactly.
* UVs box-projected in metres (`kit.uv_box`, done by `finalize`); bark and
  round things may use `kit.uv_cylinder`.
* Vertex colour attribute `Color` on every mesh (`kit.grime` via
  `finalize`, or `kit.flat_color`). Grime darkens towards the base — keep
  strength ~0.3–0.45 for buildings, lower for small props, 0 for weapons.
* **Colliders** (`kit.set_colliders`) — a list of `kit.collider_box`
  (oriented box, yaw only) and `kit.collider_cyl` (vertical cylinder),
  authored in Blender space, the helpers convert to glTF space. They are
  the physics of the game: walls block the player and bullets; a box whose
  top is ≤ 0.45 m above the feet is stepped onto; tops up to 1.3 m can be
  vaulted. Keep them simple and close to the visible geometry (a house =
  a few boxes, a tree = one trunk cylinder). Optional `kind`:
  `'wire'` (blocks movement, not bullets or sight), `'soft'` (blocks
  sight, not movement — bushes).
* **Anchors** (`kit.set_anchors`) — named points (optionally with a yaw)
  the game uses: muzzles, light positions, gunner positions, etc.
* Triangle budgets below are upper bounds; a model that reads well with
  fewer is better.
* Deterministic: fixed seeds, no time.

## Deliverables per set

1. `tools/blender/build_<set>.py` — builds and exports the whole set; accepts
   node names after `--` to build only those (still writes the whole GLB
   if it is cheap, your call).
2. `assets/models/<set>.glb`.
3. Previews: `tools/blender/previews/<set>/<node>.png` (512², `kit.preview`)
   and look at them — iterate until each model reads well. Previews are
   for review only.
4. `tools/blender/notes/<set>.md` — one table: node, size (x × y × z m),
   tris, materials, colliders, anchors; plus anything the game must know.
5. Do **not** edit `kit.py` (others use it concurrently); put extra helpers
   in your own module `tools/blender/<set>_parts.py`. Report kit bugs.
6. Do not commit; do not touch files outside your set.

## Level context

The level is ~140 m wide and ~560 m long (south → north): a sunken lane
between hedgerows, a village of ~14 houses along a main street and a square
with a church, a river (12 m wide, banks ~2.5 m high) with a stone bridge,
a ford and a fallen-tree crossing, then a hilly pine and oak forest with a
trench line, a concrete bunker and a clearing with a flak gun.

---

## Set `village` → `assets/models/village.glb`

| node | what | approx. size (x × y × z) | tris ≤ |
|---|---|---|---|
| `house_a` | two-storey Norman stone farmhouse, tile gable roof (ridge along X), chimney, front door, 6–8 windows with sills and shutters, dressed stone quoins | 9 × 6.5 × 10 | 4000 |
| `house_b` | narrow two-storey town house, plaster with stone quoins, slate roof with a dormer, shop front on the ground floor (big window, awning frame) | 6 × 9 × 10 | 4000 |
| `house_c` | wide two-storey house, dirty plaster, brick window surrounds, tile roof, two doors, a lean-to at one side | 11 × 7 × 9.5 | 4500 |
| `house_d` | one-storey stone cottage, steep roof (thatch or tile), small windows | 7 × 5.5 × 6.5 | 2500 |
| `barn` | stone lower walls with plank upper walls, big open doorway at the front (enterable: colliders only on the walls), hay inside | 12 × 8 × 8 | 4000 |
| `ruin` | shelled two-storey house: walls broken to different heights, no roof, a few charred beams, floor rubble; open front doorway and a breach in the back wall so the player can walk through; rubble piles as low steppable colliders | 9 × 7 × 7 | 5000 |
| `church` | village church: nave with slate roof and buttresses, arched windows, a square bell tower at the front (-Y) ~22 m tall with an **open belfry** (arched openings on all four sides, a floor at z ≈ 14 m, a sniper stands there), spire or pyramidal roof | 11 × 24 × 24 | 8000 |
| `shed` | small plank shed, lean-to roof | 3 × 2.5 × 2.6 | 800 |
| `wall_low` | dry stone garden wall, 4 m long (along X), 1.0 m high, 0.5 m thick, uneven top (vaultable) | 4 × 0.5 × 1.0 | 400 |
| `wall_high` | stone wall 4 m long, 2.3 m high with coping (blocks) | 4 × 0.6 × 2.3 | 400 |
| `wall_broken` | low wall with a collapsed middle (gap ~1.4 m) | 4 × 0.5 × 1.0 | 500 |
| `fence` | weathered wooden post-and-rail fence, 3 m long | 3 × 0.15 × 1.1 | 300 |
| `gate` | wooden farm gate on two stone posts, open-able look (closed) 3 m | 3 × 0.4 × 1.4 | 500 |
| `fountain` | square fountain: round stone basin ~3.4 m diameter, central pillar with a spout | 3.4 × 3.4 × 2.4 | 1500 |
| `bridge_stone` | stone arch bridge, deck runs along **Y**, 22 m long, 5 m wide, parapets 0.9 m; **origin = centre of the deck at the deck surface (deck top at z = 0)**; the arch spans 13 m and goes down to the riverbed at z ≈ −3.2, abutments into the banks; colliders: deck (top at 0), parapets, piers | 5 × 22 × (−3.5 … 0.9) | 4000 |
| `lamp_post` | cast-iron street lamp with a lantern head, 3.4 m; anchor `light` at the lantern centre; the lantern glass uses `window_lit` | 0.5 × 0.8 × 3.4 | 600 |
| `pole` | wooden telegraph pole with crossarm and insulators, 7 m | 1.4 × 0.3 × 7 | 300 |
| `signpost` | wooden village signpost with two arrow boards | 1.2 × 0.2 × 2.4 | 300 |
| `cross` | stone wayside calvary cross on a stepped plinth | 1.5 × 1.5 × 3.5 | 600 |
| `cart` | two-wheeled wooden farm cart, shafts down | 2 × 3.8 × 1.4 | 1200 |
| `haystack` | rounded haystack | 3 × 3 × 3 | 600 |

Houses: closed (doors shut, windows are dark `glass` panes set back in the
wall), except that **2–3 window panes per house use `window_lit`** (warm
light inside). Colliders: the house footprint as one or a few boxes up to
the eaves; the roof does not need a collider. Anchors for houses: `door`
(outside the front door, on the ground), and for lit windows `lamp_N`
(points ~1 m inside the lit windows, the game may put a light there).
Church anchors: `sniper` (belfry floor, centre, facing -Y), `door`.

## Set `military` → `assets/models/military.glb`

| node | what | approx. size | tris ≤ |
|---|---|---|---|
| `sandbags` | straight sandbag wall, 3 m along X, 1.05 m high, ~0.7 m deep, individual lumpy bags in staggered courses | 3 × 0.7 × 1.05 | 1500 |
| `sandbags_low` | same, 0.55 m high (crouch cover) | 3 × 0.7 × 0.55 | 900 |
| `sandbags_curve` | quarter ring of sandbags, outer radius 2.4 m, 1.05 m high | 2.4 × 2.4 × 1.05 | 1600 |
| `mg_nest` | circular sandbag MG emplacement, inner radius ~1.7 m, 1.1 m high, opening at the back (+Y), a firing notch at the front; anchors `gun` (where the MG42 bipod sits on the bags, facing -Y) and `gunner` (where the gunner stands, behind the gun) | 4.6 × 4.6 × 1.1 | 3000 |
| `bunker` | concrete pillbox, ~7 × 6 m, 2.7 m high, walls ~0.9 m thick, a horizontal firing slit in the front (-Y) at 1.2–1.6 m, earth mounded against the sides and on the roof (`dirt` / `grass`), a rear entrance (doorway ~1.1 m wide) leading into a hollow interior ~4.5 × 3.5 m; colliders: the walls (so the interior is walkable), anchors `gunner` (inside behind the slit), `slit` (centre of the slit opening, outside face), `door` | 7 × 6 × 2.9 | 3000 |
| `trench_wall` | trench revetment: 4 m of horizontal planks held by posts, 1.7 m high, to line a trench side (the planks face -Y) | 4 × 0.25 × 1.7 | 600 |
| `duckboard` | trench floor duckboard, 3 m | 0.8 × 3 × 0.12 | 300 |
| `barbed_wire` | barbed wire coils on wooden X-frames, 4 m along X, 1.1 m high; collider kind `'wire'` | 4 × 1 × 1.1 | 2000 |
| `hedgehog` | Czech hedgehog of three steel angle beams | 1.8 × 1.8 × 1.4 | 400 |
| `barrier` | road checkpoint: two posts and a red/white striped boom across 5 m (`paint_red`/`paint_white`), boom down | 5.6 × 0.4 × 1.2 | 500 |
| `sentry_box` | wooden sentry box with chevron stripes | 1.2 × 1.2 × 2.4 | 500 |
| `crate` | wooden ammo crate with rope handles | 1.0 × 0.55 × 0.45 | 200 |
| `crate_large` | big supply crate | 1.4 × 1.2 × 1.0 | 200 |
| `barrel` | steel fuel drum | 0.6 × 0.6 × 0.88 | 300 |
| `jerrycan` | jerrycan | 0.35 × 0.17 × 0.47 | 300 |
| `ammo_box` | small metal ammo can with handle (pickup) | 0.3 × 0.15 × 0.2 | 150 |
| `medkit` | first aid kit: canvas pouch/box with a white field and red cross (`paint_white`, `paint_red`) (pickup) | 0.35 × 0.12 × 0.25 | 200 |
| `tent` | German field tent / small command tent, canvas over poles, open front | 4 × 3.5 × 2.4 | 1200 |
| `radio_table` | trestle table with a field radio set, a handset and a whip antenna | 1.6 × 0.8 × 2.6 | 800 |
| `flak38` | 20 mm Flak 38 anti-aircraft gun on its cruciform base, gun shield, long barrel pointing up ~25° towards -Y, seats; `metal_gray`; anchor `charge` (where the player places a charge, ~1 m beside the breech), `muzzle` | 2.2 × 4 × 1.8 | 3000 |
| `truck` | Opel-Blitz-like 3-ton truck: cab, bonnet, wheels with tyres, mudguards, cargo bed with canvas tilt; front -Y | 2.3 × 6.0 × 2.9 | 4000 |
| `truck_burnt` | the same truck burnt out: `burnt`/`rust`, no tilt (bare hoops), flat tyres gone to rims, windscreen gone; anchor `fire` (centre of the cab where the game puts flames) | 2.3 × 6.0 × 2.6 | 4000 |
| `jeep_wreck` | wrecked Willys jeep, nose down in a ditch look (tilted), `metal_olive`, a white star is not needed | 1.6 × 3.4 × 1.6 | 2500 |
| `watchtower` | wooden watchtower, platform at 4.5 m with a rail and a small roof, a ladder at the back; anchor `lookout` on the platform; collider the legs + the platform (top at 4.5) | 3 × 3 × 7 | 1500 |
| `charge` | demolition charge (TNT block bundle with a fuse/detonator) | 0.3 × 0.15 × 0.2 | 200 |

## Set `nature` → `assets/models/nature.glb`

Each tree has a full node and a `_lod` node (same silhouette, far cheaper).
Foliage is **solid geometry** (no alpha cards): layered drooping needle
"skirts" with ragged edges for conifers, clumpy irregular leaf masses for
broadleaves, so silhouettes read in fog. Trunks with root flare.

| node | what | size | tris ≤ |
|---|---|---|---|
| `pine_a`, `pine_b`, `pine_c` | spruce/pine, 14–20 m, branches start at 3–6 m (player sees under), bark `bark_pine`, foliage `needles` | r 3–4.5 × 14–20 | 1500 (lod 250) |
| `oak_a`, `oak_b` | broad oak / beech, 10–14 m, broad crown, trunk forks | r 4–6 × 10–14 | 2200 (lod 350) |
| `tree_dead` | dead bare tree with broken branches, `deadwood` | 9 m | 900 |
| `bush_a`, `bush_b` | shrubs 1–2 m, `leaves` (+ a few twigs); collider kind `'soft'` | | 500 |
| `hedge` | hedgerow segment for the bocage lane: 4 m long along X, 2.8 m tall, 1.6 m thick, dense leaf masses over a woody base, tileable end to end (ends irregular but overlapping) | 4 × 1.6 × 2.8 | 1500 |
| `hedge_low` | hedge 1.2 m tall | 4 × 1.2 × 1.2 | 900 |
| `boulder_a`, `boulder_b`, `boulder_c` | granite boulders 1.2, 2 and 3.2 m, weathered, partly sunk (base slightly below 0), `rock` with `moss` on top faces | | 800 |
| `outcrop` | rock outcrop for hillsides, 7 × 4 × 3.5 m, layered, `rock_dark` | | 1500 |
| `rocks_small` | cluster of 5–7 small stones | 1.5 × 1.5 × 0.4 | 300 |
| `log` | fallen log 5 m, 0.5 m diameter, broken ends | | 400 |
| `log_bridge` | big fallen tree to cross the river: 17 m trunk, 0.9 m diameter, lying along **Y**, root plate at +Y end, broken branch stubs; the top is walkable: colliders as a chain of boxes along the trunk with tops at the trunk top | 3 × 17 × 2.5 | 1800 |
| `stump` | tree stump with roots | 0.9 × 0.9 × 0.6 | 300 |
| `grass_tuft` | clump of 8–14 grass blades 0.4–0.6 m (instanced in thousands), `grass` | | 60 |
| `fern` | fern, 0.8 m, `leaves` | | 120 |
| `reeds` | reed clump for river banks, 1.4 m, `reed` | | 120 |

## Set `soldier` → `assets/models/soldier.glb` and `assets/models/weapons.glb`

### soldier.glb

One armature object `rig` with **exactly these bones** (deform bones,
names are the contract):

`root` (at the ground between the feet; whole-body offsets),
`hips`, `spine`, `chest`, `neck`, `head`,
`clavicle_l`, `upperarm_l`, `forearm_l`, `hand_l`,
`clavicle_r`, `upperarm_r`, `forearm_r`, `hand_r`,
`thigh_l`, `shin_l`, `foot_l`, `thigh_r`, `shin_r`, `foot_r`.

(`_l` is the character's left = Blender +X when the character faces -Y.)

Two skinned meshes parented to `rig`, same armature, same proportions:

* `allied` — US infantryman 1944: M1 helmet (round, with chin strap),
  M41 field jacket, wool trousers, canvas leggings over brown boots,
  cartridge belt with pouches, canteen, entrenching tool, small pack;
  colours `cloth_od`, `cloth_od_dark`, `cloth_khaki`, `webbing`,
  `helmet_od`, `leather`, `skin`.
* `axis` — German Heer rifleman 1944: Stahlhelm (the flared coal-scuttle
  silhouette is essential), M40 field-grey tunic with four pockets,
  trousers bloused into tall black jackboots, black belt with Y-straps,
  ammo pouches at the front, bread bag, fluted gas-mask canister on the
  back; `cloth_feldgrau`, `cloth_feldgrau_dark`, `leather_black`,
  `helmet_gray`, `canvas`, `skin`.

1.78 m tall, facing -Y, feet on z = 0, ≤ 6000 tris each. Head with a face
(brow, nose, ears, jaw — believable at 3 m, no need for eyes modelling).
Smooth skin weights near joints, ≤ 4 influences per vertex, normalised.

An empty **`socket_weapon`** parented to bone `hand_r`: a weapon object
placed as its child with an identity transform must sit in the hand, with
the weapon's grip in the palm and its barrel pointing along the forearm
line the way a rifle is held. Verify by rendering the poses with the
`m1_garand` attached.

**Actions** (30 fps; names are the contract; loops must loop seamlessly
— last frame equals the first). Every clip keys all bones. "Rifle" poses
hold a two-handed rifle: right hand at the grip, left hand under the
handguard.

| action | frames | what |
|---|---|---|
| `idle` | 60, loop | standing, rifle at low ready, breathing |
| `walk` | 32, loop | walking forward, rifle low ready |
| `walk_back` | 32, loop | walking backwards |
| `strafe_l`, `strafe_r` | 28, loop | side-stepping left / right, facing forward |
| `run` | 20, loop | running forward, rifle at port arms across the chest |
| `crouch_idle` | 60, loop | crouched (head at ~1.15 m), rifle ready |
| `crouch_walk` | 36, loop | crouched walk forward |
| `aim` | 30, loop | standing, rifle shouldered, sighting **straight ahead (-Y), level**: muzzle at ~1.45 m; minimal sway |
| `crouch_aim` | 30, loop | the same crouched (muzzle ~1.0 m) |
| `reload` | 48 | upper body: rifle down, hand to belt, back (legs neutral) |
| `throw` | 30 | upper body grenade throw (right arm overhand, rifle in left hand) |
| `hit` | 12 | short flinch |
| `death_fwd` | 40 | shot from the front: falls backwards, ends lying on the back |
| `death_back` | 40 | shot from behind: falls forwards, ends face down |
| `death_crumple` | 36 | knees buckle, slumps to the side |

The game plays the legs (`root`, `hips`, `thigh_*`, `shin_*`, `foot_*`)
from a locomotion clip and the upper body (`spine` … `hand_*`) from an
overlay clip (idle/aim/reload/throw), and adds its own aim pitch on
`spine`/`chest`. So the upper body of locomotion clips must also hold the
rifle sensibly, and `aim`'s spine should be roughly upright.

Previews: the two outfits in rest/idle, and `aim`, `run` (mid stride),
`crouch_aim`, `throw` (release), `death_fwd` (last frame) with the rifle on
the socket, from a 3/4 back view at shoulder height (the game's view) and
from the front.

### weapons.glb

Each weapon is one object, **origin at the firing hand's grip**, barrel
along **-Y**, top +Z. Anchors `muzzle` (end of the barrel) and `offhand`
(where the left hand holds it). `gun_wood`, `gun_metal`,
`gun_metal_worn`, `leather` (sling).

| node | what | tris ≤ |
|---|---|---|
| `m1_garand` | M1 Garand rifle, 1.1 m | 1500 |
| `thompson` | M1A1 Thompson SMG with stick magazine | 1500 |
| `kar98k` | Karabiner 98k rifle | 1500 |
| `mp40` | MP 40 SMG, stock folded out | 1500 |
| `mg42` | MG 42 on its bipod, origin at the bipod feet centre (it sits on sandbags), barrel along -Y | 2000 |
| `grenade_us` | Mk 2 "pineapple" grenade, origin at its centre | 200 |
| `grenade_de` | Stielhandgranate 24 (stick grenade), origin at its centre of mass | 150 |
