# Alpen imported model sources

## nature/ — Quaternius low-poly set (*.gltf)

Quaternius low-poly nature set (winter variants) — CC0 / public domain,
by Quaternius (https://quaternius.com), downloaded 2026-08-07 from the
MIT-licensed mirror https://github.com/flo-bit/tiny-planets
(`public/lowpoly_nature/`). glTF 2.0 with embedded buffers, exported by
FBX2glTF. No longer drawn: the needled species use the photo-textured
card conifers below, and the bare species use card larches off a twig
atlas `js/spruce.js#createTwigAtlas` draws on a canvas at boot. The
loader path (`js/importedModels.js#upgrade`) is kept for the rocks.

## nature/ — Poly Haven photoscans (*.glb)

CC0 photogrammetry from https://polyhaven.com, downloaded 2026-08-19 at
1k texture resolution and processed offline for the instanced prop
pipeline (glTF-Transform + meshoptimizer: welded, simplified to a game
budget, quantized; ambient occlusion baked into the diffuse; textures
re-encoded as WebP; single-file .glb):

| file | source asset | in game as | tris |
|---|---|---|---|
| `rock_07.glb` | rock_07 | slate boulders | 2.6k |
| `rock_09.glb` | rock_09 | iron boulders | 2.6k |
| `rock_face_01.glb` | rock_face_01 | flank crag | 4.2k |
| `mountainside.glb` | mountainside | flank crag | 5.2k |
| `boulder_01.glb` | boulder_01 | flank crag | 3.6k |
| `tree_stump_01.glb` | tree_stump_01 | forest-floor stumps | 1.8k |

At runtime `js/importedModels.js#upgradeTextured` world-bakes each scan
into one buffer, keeps its UVs and baseColor map, normalises it to the
grown variant's height and swaps it into the live pool; `props.js`'s
`photoMat` adds the up-facing snow dusting and the shared scene shading.

### Forest floor and stones (added 2026-09-24)

Also CC0 from Poly Haven, downloaded 2026-09-24 as the 1k glTF packages.
Processed the same way with glTF-Transform 4 + meshoptimizer: the wanted
nodes isolated, welded, and simplified per node with
`simplifyPrimitive`. Ambient occlusion (the ARM map's red channel) is
multiplied into the diffuse in linear light at 0.7–0.8 strength and the
colour is desaturated by 8–10%. The result is written as WebP inside the
GLB, and the normal and ARM maps are dropped. A "set" file keeps several
objects as named nodes sharing one texture. `upgradeTexturedSet` feeds
one pool per node from it, so the texture loads once.

| file | source asset | nodes | in game as | tris |
|---|---|---|---|---|
| `fallen_log_01.glb` | dead_tree_trunk | `fallen_log_01` | fallen log, natural scale | 1.6k |
| `fallen_trunk_02.glb` | dead_tree_trunk_02 | `fallen_trunk_02` | fallen broken trunk | 2.6k |
| `deadfall_branches.glb` | dry_branches_medium_01 | `branch_a`, `branch_b`, `branch_c` | deadfall scatter | 1.2k / 0.7k / 0.7k |
| `stone_granite_set.glb` | rock_moss_set_02 | `stone_10`, `stone_11`, `stone_13` (rocks 10, 11, 13) | granite stones | 1.3k each |

The logs are solid and low enough to jump (a capsule of three circles
along the trunk). The branches have no collision and no shadow. The
granite stones join the scenic stone families.

## Sapling impostor atlas (built in Blender)

`assets/textures/tree/sapling-impostors.webp` (1024 × 2048, RGBA) is
rendered by `tools/blender/saplings.py` from young trees modelled with the
forest's own kit (`trees.py`'s `Tree`, its sprig cards cut from
`alpine-sprigs.webp`, its occlusion bake and impostor material), from the
repository root:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/saplings.py -- --out fun/alpen/assets

It renders with Cycles on the CPU, so it builds without a GPU, and prints
the `SAPLINGS` table for `js/props.js` (each sapling's frame `R`, `H` and
its three UV rectangles), which has to be pasted over the old one after a
rebuild. It replaced a render of Poly Haven's fir and pine sapling scans.

Six young trees of the forest's four species, grown as young trees rather
than small old ones — crowns to the ground with the lowest branches lying
on the snow, broad for their height, sprigs drawn at about life size — each
with a young tree's history (`Youth`: its light side, uneven years, the
odd broken branch, a stem swept at the foot by snow creep): a Norway spruce
(2.4 m), a silver fir in the stand's shade (1.8 m, level two-ranked
plates), a spruce the deer have browsed into a bushy three-leader (1.3 m) —
the three the placement puts in shelter — and a Swiss stone pine (2.1 m), a
three-stemmed treeline stone pine (1.3 m) and a bare European larch
(2.7 m) for the exposed ground.

Each is photographed from three bearings 60° apart, orthographic across
the card `saplingCardGeometry` stands there, framed from the snow line to
its top and to its crown's widest reach, as albedo — the sprig atlas's
colour times the baked crown occlusion — keyed like the forest's cards,
packed one sapling per 341 px row and colour-dilated into the gutter;
WebP at quality 90 with alpha. Frost twins of the sprigs give the snow
load. In game each view is a 3 × 3 card at the bearing it was drawn from:
24 triangles per young tree, each kind with its own sway height.

## nature/alpine-trees.glb — the Alpine forest (built in Blender)

Not downloaded: `tools/blender/trees.py` builds it, together with the
atlas its cards point into (`textures/tree/alpine-sprigs.webp`), from the
repository root:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/trees.py -- --out fun/alpen/assets

(The sprigs are rendered with EEVEE, so this needs a GPU — it will not run
inside a sandbox that hides Metal.)

Four species, as they grow above 1500 m: **Norway spruce** (*Picea abies*,
the narrow subalpine spire with hanging curtains of shoots), **silver fir**
(*Abies alba*, level tiers of flat sprays; an old one flattens into a
stork's nest), **Swiss stone pine** (*Pinus cembra*, a dense rounded column
of upturned five-needle brushes, often with two or three leaders, one
wind-flagged), and **European larch** (*Larix decidua*, bare in winter).
One tree per slot of `props.js`'s `SPECIES` table (node `tree_<name>`,
with `extras.height` and `extras.species`); the 24 pools scale them to
their grown heights.

`tools/blender/sprigs.py` models each species' foliage needle by needle —
spiralled spruce shoots, two-ranked fir sprays, pine fascicles of five,
larch twigs with their spur stubs and cones — adds a snow mantle (flattened
metaballs) for the evergreens and hoar frost for the larch, and photographs
them straight down onto black: two sprigs per species in the top half of
the atlas, their snow twins half an atlas below, and three bark strips
(spruce/fir from the old bough atlas, stone pine and larch from the two bark
photographs) left of u = 0.116, where `spruceMat` starts keying black.

Each tree is a trunk with buttress roots running on under the snow line,
the lowest branch stubs, and 300–550 cards: boughs drawn as skirts sloping
down off the trunk (split in two on long boughs so the sprig is never
stretched to a frond), curtains facing out of the crown, brush rosettes on
the pines. Occlusion is baked in Blender by casting rays through the
finished tree and exported as the custom attribute `_AO`; `_OWN` is the
`surfaceOwn` contract (needles 1, snow 0, bark 0.35); normals are canopy
normals. `props.js#alpineTreeGeometry` turns a node into pool geometry.
744–1156 triangles a tree. If either file fails to load, the card conifers
below take over.

The same script then photographs every finished tree from three bearings
(0°, 60°, 120°) with an orthographic camera into
`textures/tree/alpine-impostors.webp` (2048 × 1024, one 170 px column per
tree, one row per bearing), and writes the frame each was drawn in to its
node as `extras.impostor` = [column, half-width, bottom, top].
`props.js#treeImpostorGeometry` stands those three photographs as crossed
cards — six triangles — and the far forest draws every tree that way,
sharing the pool's own instance buffers. The whole tree is drawn only for
the nearest six rings of bands; between 170 m and 220 m the two dissolve
into each other on a per-pixel hash. Without the impostor atlas every tree
is drawn whole.

## nature/alpine-flora.glb — trackside flora and ground cover (built in Blender)

Written by `tools/blender/flora.py` (no rendering, so it builds anywhere):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/flora.py -- --out fun/alpen/assets/models/nature

The small things that still show above the snow beside an Alpine piste in
winter, one node each (`flora_<name>`): seed grass gone to straw, the dried
rosette of a silver thistle (*Carlina acaulis*), dead umbellifer stalks
holding caps of snow, alpenrose (*Rhododendron ferrugineum*), bilberry's
green winter twigs, a low juniper mat, a cluster of moraine stones, and two
lighter cuts — a grass tuft and a bilberry sprig — for the ground cover.
84–480 triangles each. Materials are roles; `props.js#floraGeometry` paints
them for the shared flora material, which adds the procedural snow and bark
grain each role asks for.

`props.js` places them in two layers, neither of which is a solid: the
trackside flora off the groomed piste — out across the verge and the
terrain beyond, thickest near the edge, one in ten surviving in the
piste's last two metres — in clumps, by ecology; and the ground cover —
the grass tuft and bilberry sprig in their thousands — in meadow patches
over the ground either side, each its own size, turn and lean. Both are
placed in every streamed band but drawn only for the nearest four rings
(at least 160 m ahead), dissolving out between 115 m and 150 m.

## piste/piste-furniture.glb — gate panel, piste marker, snow bridge (built in Blender)

Written by `tools/blender/piste.py` (no rendering needed; `--preview <dir>`
renders a Cycles contact sheet):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/piste.py -- --out fun/alpen/assets/models/piste

Three nodes, each at its own origin in the frame its procedural stand-in in
`props.js` uses:

- `gate_panel` (368 triangles) — a giant-slalom panel: two 32 mm flex poles
  screwed into black spring hinges on their drilled bases, caps, a snow
  collar at each foot, and the panel slid over both poles by its sleeves,
  with stitched hems and a printed sponsor field. Inner pole on the origin,
  outer at `GATE_PANEL.width`, fabric facing ±Z; `props.js#gatePanelGeometry`
  derives the flutter weight from the fabric roles.
- `waymark` (216 triangles) — a Swiss piste marker: a run-red fibreglass
  pole with reflective white bands and the run sign on top, a square
  aluminium plate in the run's red with a white border and the run number,
  clamped to the pole and facing +Z (up the hill); snow along the sign's top
  edge and drifted round the foot. 3.05 m tall.
- `snow_bridge` (1140 triangles) — one six-metre section of a steel snow
  bridge: two H-section girders carrying eight I-section grate beams on
  their uphill (+Z) face, leaning 8° downhill of the slope's normal; tubular
  struts behind to steel footings, tension anchors into the slope; the
  snowpack held against the lower beams and new snow on the upper ones.
  Built to the stand-in's footprint, whose box the collision is still cut
  from.

Materials are roles; `GATE_LOOKS`, `WAYMARK_LOOKS` and `FENCE_LOOKS` in
`props.js` give each its colour and how much race tint (`surfaceOwn`, on
the gate) or plank grain (`aGrain`, on `alpineMat`) it takes. Until the
file loads, and if it fails, the procedural stand-ins draw.

## nature/alpine-shrubs.glb — scrub, dwarf pine and plant patches (built in Blender)

Written by `tools/blender/shrubs.py` (no rendering needed):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/shrubs.py -- --out fun/alpen/assets/models/nature

The shrub and plant pools' models, one node each, sized like the grown
stand-ins whose bounding spheres the game still collides with:

- `shrub_alderScrub` (1367 triangles) — leafless green alder (*Alnus
  viridis*) and willow: grey-brown stems pressed down at the foot by the
  snow and rising in arcs, forked into redder twigs, the alder's winter
  catkins in threes and old cones, a few straight red willow wands, a drift
  at the foot and snow lodged in low forks.
- `shrub_mountainPine` (1334 triangles) — dwarf mountain pine (*Pinus
  mugo*): a dome of upturned, star-sectioned needle brushes over a dark
  core, prostrate stems running out at the rim, snow pillows on top.
- `plant_heath` (476 triangles) — a wind-scoured heath patch: clusters of
  little heather, crowberry and trailing-azalea bushes, a dead grass tuft
  with its seed head, snow banked in the lee.
- `plant_tussock` (482 triangles) — a tussock in winter straw: a crown of
  thatch, a fountain of arching blades, two standing culms, snow in its
  middle.

Materials are roles; `SHRUB_LOOKS` in `props.js` gives each its colour and
its `surfaceOwn` for the shared flora material (bark grain and procedural
snow). The grown stand-ins draw until the file loads, and if it fails.

## backdrop/alps.glb — the mountains round the run (built in Blender)

Written by `tools/blender/backdrop.py`, with its two maps
(`textures/backdrop/alps-shape.webp`, `alps-cover.webp`); nothing is
rendered, so it builds anywhere:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/backdrop.py -- --out fun/alpen/assets

It replaced the photographed sky panoramas. A real-sized Alpine landscape,
modelled in numpy — a ridged-multifractal range with glacial valleys cut
into it, the shoulder the run is on falling into the main valley eight
kilometres ahead, and four landmarks no noise draws: a leaning horn
(4350 m, 15 km, 17° left of the fall line), a row of granite needles, a
glaciated dome (4470 m, 23 km) and a north face off to the right. It is
sampled on a log-polar grid round the eye (3072 bearings × 480 distances,
2.4–48 km), every point slid along its line of sight from the eye to a drawn
radius between 1650 and 2800 m (which the eye cannot see), and decimated by
Blender's quadric collapse in that drawn space, where a metre of error is
about a pixel, to about 90 000 vertices — more down the run than behind it.
The ring is cut into 24 sectors of 15° (nodes `range_00`…`range_23`, with
`extras.bearing`, and the frame in `distance`, `radius`, `horizons`,
`horizonMax`), so the frustum keeps about a third of it and no sector spans
the sky probe's join.

Per vertex there is only the position and `_HORIZON_A`/`_HORIZON_B`: eight
normalised bytes, the elevation of the land round the vertex on eight
bearings (down the run, then every 45° towards +x), 0–50°. The game shades
the range with them (the sun is behind the land when it is under the horizon
on its bearing) and takes its sky occlusion from them. Everything else is
in the maps, on the same frame (u the bearing, v the log of the distance):
the normal's x and z and the cavity (4096 × 1024), and the snow, forest and
ice cover (2048 × 512). `js/backdrop.js` reads all three and draws the range
— into the frame and into the sky probe the fog reads; if any of them fails
to load the procedural ranges in `sky.js` stand instead.

## Card conifer atlas (fallback)

The needled tree species were card conifers built at runtime by
`js/spruce.js` from `assets/textures/tree/spruce-card-atlas.webp`. The
atlas is composed offline from the Poly Haven **fir_tree_01** asset
(CC0): its `twig_diff/_ao/_alpha` maps supply two needle sprigs (stored
as luminance values so the per-instance cast supplies the colour, plus
frost variants derived from the alpha's top edges) and its
`bark_diff/_ao` maps supply the trunk strip. Layout is documented at the
head of `js/spruce.js`. The same builder grows the bare larches from a
second atlas drawn at boot (`createTwigAtlas`): two fractal twig sprigs
as luminance values, with their snow drawn a shade bluer than grey so the
card material can turn it back into the prop snow colour per texel.

## Vendored loaders

`assets/vendor/GLTFLoader.js`, `assets/utils/BufferGeometryUtils.js` and
`assets/utils/SkeletonUtils.js` are from three.js r185
(https://github.com/mrdoob/three.js, MIT), matching the vendored three
build at the repository root.

## riders/ — the player and the other people (built in Blender)

`rider.glb` and `npcs.glb` are not downloaded assets: they are written by
`tools/blender/riders.py`, which builds every surface from tables (lofted
rings, swept profiles, one level of Catmull-Clark) and exports them. The
script is the source; rebuild after changing it, from the repository root:

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/riders.py -- --out fun/alpen/assets/models/riders

(Blender 4.2 or later; built with 5.3.) The tables are written in the
game's own three.js coordinates and the skeleton constants are copied from
`js/riderModel.js`, so the two must move together.

- `rider.glb` holds one node per rigid segment of the rig — pelvis, torso
  (jacket, hood, pack), head (gaiter, goggles, helmet, headlamp), upper arm,
  forearm and thigh as lead/rear mirror pairs, shin, boot and binding —
  each at the origin of its segment's frame. The board's deck stays
  procedural (its flex shader and top-sheet mapping are built on it); the
  bindings and boots are bolted onto it at load.
- `npcs.glb` holds each figure's two halves for a skier and a boarder (the
  `deck` that stays on the snow and the `body` hinged at the hip, whose
  height is the node's `extras.hip`), plus helmet, beanie and pack nodes the
  game mixes per figure.

Materials carry only a role name (`shell`, `trim`, `npcJacket`…); colour,
the cloth masks and the per-figure dress are assigned in `riderModel.js`
and `mountainLife.js`. `js/riderAssets.js` reads the files without the glTF
loader (positions, normals and indices only). If they fail to load, the
procedural riders stay.

| file | nodes | triangles |
|---|---|---|
| `rider.glb` | 11 segments | ~13.8k as drawn (arms, legs, boots, bindings twice), plus the deck |
| `npcs.glb` | 2 × (deck, body, helmet, beanie, pack) | ≤ ~4k per dressed figure |
