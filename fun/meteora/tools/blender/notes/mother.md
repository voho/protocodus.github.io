## The Mother (`build_mother.py`)

Built by `tools/blender/build_mother.py` (parts and paint in
`tools/blender/mother_parts.py`, which builds on the helpers in
`build_ships.py`):

```
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python fun/meteora/tools/blender/build_mother.py [-- mother]
```

The full build takes about 2 minutes on an Apple-silicon Mac (up to 6
when the machine is busy with other builds); `METEORA_FAST=1` gives a
geometry pass in under a minute (most of it the collider fit). It writes
`mother.glb` and `js/anchors/mother.js`; the preview comes from
`METEORA_PREVIEW_ENGINE=CYCLES … render_previews.py -- mother`. Two runs
give byte-identical geometry, textures and anchors (Blender 5.3's
`bmesh.ops.create_uvsphere` orders its faces differently in every
process, so the script builds its own spheres).

`METEORA_CHECK=1` also casts 4,000 rays at the finished ship (a back face
hit would mean an inverted normal or a hole; the build logs none) and
tests every loose part for contact (none floats).
`tests/models-mother-check.mjs` checks the size and triangle budgets, the
WebP textures (at most two 2048² sets), the length, every anchor in the
module against the GLB node at the same position, the colliders (count,
scales, the subsystems inside them, and the whole plating, sampled every
1.5 m, inside them), the nozzles, subsystems, turrets, bays, lights and
animated nodes.

| file | nodes (triangles) | textures | size |
|---|---|---|---|
| `mother.glb` | `hull` 18,412 + `greebles` 9,966 + `reactor` 896 + `eye` 840 + `shield_0`, `shield_1` 252 each + 8 × (`turret_NN` 92 + `turret_NN_gun` 142) = **32,490** | `mother_hull`: base, normal and emissive 2048², MR 512²; `mother_detail`: base and emissive 2048², normal 1024², MR 512² | 3,716 KB |

809 m from the mandible tips to the nozzle exits (glTF z −414 … +395),
263 m across the engine blades (the hull itself is 164 m wide), 188 m
from the ventral blade to the tips of the crown tines (deck to keel
96 m), radius 419 m. The Harrow foundry ship in the Thorn's colours:
gunmetal `#4a4f55` and oxblood `#5e1a1d` plating, hazard `#d9a21b`
bands, red `#ff2a1a` light.

- **Spine**: a long faceted hull (deck ridge, sloped decks, an oxblood
  shoulder stripe like the Thorn's cheeks, a flat keel), painted with two
  scales of irregular plating (34 × 14 m plates split at random,
  14 × 6 m panels, some proud, some sunk, a few with inset hatches),
  mottling, baked AO grime, aft streaks and chipped edges, a few plate
  seams lit red, and rows of red running lights along the flanks.
- **Reactor chamber** amidships: the hull pinches to a 116 × 64 m waist
  that opens into a cage of two oxblood ribs, two end frames and six
  longerons with machine clamps. The reactor (node `reactor`, a 23 m
  red-orange sphere in three containment hoops) hangs on eight glowing
  conduits from heavy socket rings on the bulkheads, visible from the
  sides, top and belly; the bars glow faintly on their inner faces.
- **Harrow tines**: thirteen transverse frames along the back, each with
  a tall raked tine in the middle and two splayed ones; four crown tines
  (up to 80 m) on the cage; armour wedges between the frames; forge pits
  with glowing floors and grilles cut into the deck.
- **Flanks**: a folded fabrication arm in each trench, fore and aft on
  both sides (upper arm aft, forearm folded under it, three hooked
  fingers and a cutting torch, hydraulic rams, glowing joint rings,
  hazard bands), red light strips along the trench walls, layered armour
  wedges along the shoulders and lower flanks, conduits along the chines.
- **Belly**: two launch bays under the forward hull (40 × 112 m, hazard
  frames, launch rails, lit walls, outer doors hanging open), two ore maws
  ringed with downward-hooked tines and glowing hotter inside, a ventral
  blade under the aft hull, keel bars, two belly turrets.
- **Prow**: a faceted V-brow with a bladed crest over the great red eye
  (node `eye`, r 18 m, in a glowing socket between armoured cheek
  shields), two toothed pincer mandibles that bow out and hook in, swept
  canard blades, and the beam emitter between the mandibles (a banded
  barrel with coils, collars and a red tip).
- **Aft**: two octagonal engine housings, banded and collared, each with
  three blades (dorsal, outboard, ventral) and three big bells with soot
  inside, a glowing orange throat and a hot core; antenna masts on the
  aft deck and the housings.
- **Shield generators**: two glowing domes (nodes `shield_0`, `shield_1`,
  r 22 m) with a cracked-glass red pattern, armour ribs and a spike, on
  octagonal pedestals on the aft shoulders.
- **Greebles**: about 830 kitbashed pieces at three scales (boxes,
  chamfered blocks, stacks, wedges, vents, fin banks, small domes)
  raycast onto the plating, mirrored rows of identical modules, and the
  29 beacon pods, all in one `greebles` node with plain factor materials
  (dark metal, gunmetal, oxblood, dim vent glow, red lights).
- **Story detail**: one faded off-white plate with a teal band (the
  *Perpetua* programme's colours, scorched and sooty) on the port aft
  shoulder below the port shield dome, glTF about (−69, 18, 152).

### Anchors (`js/anchors/mother.js`)

| node | meaning |
|---|---|
| `nozzle_0` … `nozzle_5` | engine exits, size 25 (exit radius), exhaust +Z; 0–2 the port cluster (top, inboard, outboard), 3–5 starboard |
| `muzzle_beam` | the beam emitter's tip, (0, −24, −389.5) |
| `sub_reactor` | the reactor, r 65 (it reaches the colliders over the cage, so hits there count with the game's 6 m margin) |
| `sub_shield_0`, `sub_shield_1` | the domes, port and starboard (r 30 / 32.5) |
| `sub_bay_0`, `sub_bay_1` | the bays, port and starboard (r 38) |
| `sub_engine_0`, `sub_engine_1` | the engine clusters, port and starboard (r 62) |
| `sub_beam` | the emitter head, (0, −24, −374), r 26 |
| `turret_00` … `turret_07` | yaw pivots on barbettes: 00/01 forward shoulders, 02/03 forward upper flanks, 04/05 aft shoulders, 06/07 belly; `up` (the node's local +Y in glTF) is tilted with the plating, about 37° outboard on the shoulders; barrels at rest point forward; size 15 |
| `turret_NN_gun` | the gun, child of its base, origin at the trunnion 9 m (0.6 × size) above the pivot; its barrels end 12.6 m along its local −Z (glTF) |
| `bay_0`, `bay_1` | launch points in the bay mouths, dir (0, −0.8, −0.6): down and forward |
| `light_00` … `light_28` | 29 red beacons: tine tips (steady), crown tines (2.4 s), dome spikes (steady), masts (1.2 s), mandible tips (1.6 s), engine housings (steady), tail (1 s), brow tip (steady) |
| `col_00` … `col_70` | 71 collision spheres (r 11 – 67 m), sorted from the bow aft |

The colliders are fitted by the build: spheres centred inside the hull
(stand-ins close the reactor cage and wrap the domes, bells and emitter),
each allowed to stand at most τ metres outside the plating (measured on a
4 m voxel field of the distance outside the hull, so spheres may fill the
trenches and bay mouths but not bulge into open space), chosen greedily
until every plating sample and vertex lies 1.5 m inside one, with τ the
smallest level that needs no more than 78 spheres (22 m here). Each
sphere then shrinks to what it alone covers, and a last pass samples the
plating every 1.2 m and grows the nearest sphere (by at most 2.5 m) over
any sliver left between the samples: of 1.6 million points sampled a
metre apart on the plating, none lies outside the set. No gap leads into
the hull; in places (between the tine rows, over the domes) the set
stands up to 24 m proud of the plating, which the tines and greebles
partly fill.

### For the game

- **Hierarchy**: `hull` is the only root (identity transform); every
  other node is its child, so node positions are model-space.
- **Animated nodes**: `reactor` (origin at the core's centre; red-orange
  emissive core in a dark frame; pulse it, and darken or hide it when
  `sub_reactor` dies); `eye` (origin at the eye's centre; lens, iris and
  pupil face the node's local −Z in glTF, the ship's nose, so turning the
  node aims it); `shield_0`, `shield_1` (origin at the dome's base; each
  has its own copy of the `mother_detail` material, so one dome can go
  dark when its generator dies).
- **Materials**: `mother_hull` and `mother_detail` are the two baked sets
  (both on the `hull` node), which `prepareShip` gives the ×3 emissive.
  Everything else uses glTF factors only; the factor materials whose
  emission exceeds 1 (`mother_light`, `mother_vent`, `mother_turret_eye`,
  `mother_eye_iris`, `mother_eye_pupil`, `mother_reactor_core`) carry
  `KHR_materials_emissive_strength`, which three's `GLTFLoader` reads.
- **Turrets** share one base mesh and one gun mesh; `turret_06`/`07` hang
  under the belly (up ≈ −Y).
- **Beam**: `sub_beam` is where the beam starts (turrets.js fires from
  the subsystem's position); `muzzle_beam` marks the emitter's tip 15 m
  further forward if the beam's visual should start there.
- **Size**: 3,716 KB of the 4 MB budget (textures 1.8 MB).

Known weaknesses: the baked plating is about 0.44 m per texel on the hull
set and 0.7 m on the detail set, so up close it relies on the runtime
tri-planar detail layer; the greebles are untextured (flat factors over
the hull's baked shadow); the collider set is lumpy over the tine rows
and domes (a bolt between two crown tines can still hit a sphere there);
one tangent value in about 96,000 can differ in the fourth decimal
between two builds (Blender's tangent calculation landing on the
exporter's rounding boundary), harmless but it means the GLB is not
always bit-identical.
