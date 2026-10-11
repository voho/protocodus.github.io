# Alpen imported model sources

## nature/ — Quaternius low-poly set (*.gltf)

Quaternius low-poly nature set (winter variants) — CC0 / public domain,
by Quaternius (https://quaternius.com), downloaded 2026-08-07 from the
MIT-licensed mirror https://github.com/flo-bit/tiny-planets
(`public/lowpoly_nature/`). glTF 2.0 with embedded buffers, exported by
FBX2glTF. No longer drawn: the needled species use the photo-textured
card conifers below, and the bare species use card larches off a twig
atlas `js/spruce.js#createTwigAtlas` draws on a canvas at boot. The
loader path (`js/importedModels.js#upgrade`) is kept, though nothing calls
it now.

## nature/alpine-boulders.glb, alpine-crags.glb — the rocks (built in Blender)

Not downloaded: `tools/blender/rocks.py` builds both, from the repository
root (about eight minutes on the CPU, most of it the bake; no GPU needed):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/rocks.py -- --out fun/alpen/assets/models/nature

(`--preview DIR` renders each rock on the snow; `--only boulders|crags`
builds one file; `--atlas 1024 --samples 8` is a quick draft.) They replace
the Poly Haven photoscans that stood here (rock_07, rock_09, rock_face_01,
mountainside, boulder_01 and the rock_moss_set_02 granites), one of which
was a half-shell and two of which were open faces drawn double-sided.

Each rock is a signed distance field in the game's space, written the way
the stone was made (`tools/blender/fieldkit.py` holds the method): a body
cut by its joint planes, its edges rounded by as much weathering as its
rock allows, chipped where its edges stick out, bent a few centimetres over
a metre. Granite is a jointed block with its corners weathered back and one
or two young, crisp-edged faces (one has a frost crack); slate is a book of
plates on edge, every face across the cleavage a staircase of plates; the
"iron" boulder is a schist slab split along its foliation. The crags are the
same rocks at the scale of a cliff — an envelope under a broken skyline,
divided into blocks by bedding and two sets of cross-joints, each block set
back and turned by its own amount, which leaves the ledges the snow holds and
the clefts between them; a face of bedded gneiss, a jointed buttress, a
granite tor. The field is meshed with surface nets on a narrow band (1.4 cm
for a boulder, 6 cm for a crag), pulled onto the true surface, kept as the
full-detail surface for the bake, and copied through Blender's voxel remesh
and quadric decimation into the closed, low surface the game draws.

The texture is baked in Cycles (CPU) from the full-detail surface onto the
low one, as an emission pass carrying the albedo with the occlusion
multiplied in, the way a photoscan's diffuse carries its own: granite's grain
over the structure of `textures/rock/rock-granite.jpg`, slate and schist from
`rock-slate.jpg` and `rock-granite.jpg` projected along their own cleavage,
the faces' weathering, iron staining, the black drip lines down steep faces,
pale crustose lichen mosaics, black crusts and map lichen (Rhizocarpon) on
the faces that see the sky — none on a fresh scar or on the foot the snow
lies against — and the soil at the foot. One 2048² WebP atlas per file, the
buried foot (and a crag's back) given a fraction of the texels.

| file | nodes (pool order) | tris | in game as |
|---|---|---|---|
| `alpine-boulders.glb` | `boulder_slate`, `boulder_iron`, `boulder_granite_a`, `_b`, `_c` | 2450 each | verge hazard boulders and erratics (`rockPools`) |
| `alpine-crags.glb` | `crag_face`, `crag_buttress`, `crag_block` | 4880–4900 each | flank crags (`cragPools`), looking down +z |

Every node stands on y = 0, centred, with no transform, and is built to the
height over half-width its pool's collider assumes — `SCAN_ASPECT` [0.90,
0.45, 0.70, 1.34, 1.20] and `CRAG_ASPECT` [1.44, 2.06, 1.10] in `props.js`;
each node's extras carry its `rock`, `aspect` and `sink` (the crags also
`faces: "+z"`). Each file is fed to its pools by
`js/importedModels.js#upgradeTexturedSet`, which normalises every node to
its grown stand-in's height and swaps it into the live pool;
`props.js#photoMat` adds the up-facing snow dusting.

## nature/alpine-deadwood.glb — stump, logs and branches (built in Blender)

Written by `tools/blender/deadwood.py` (the same kit, a couple of minutes):

    blender --background --factory-startup \
        --python fun/alpen/tools/blender/deadwood.py -- --out fun/alpen/assets/models/nature

It replaces the Poly Haven tree_stump_01, dead_tree_trunk, dead_tree_trunk_02
and dry_branches_medium_01 scans. A Norway spruce's forest floor in winter:

- `stump` — a sawn stump: the cut stepped at the faller's notch with the torn
  hinge standing between the two levels, the face greyed and checked
  radially, bark plates loose and gone in places, six buttress roots diving
  under the snow (about twice as wide as it is tall; the game fits it to 0.4 m
  and puts it in the last shrub slot). About 1750 tris.
- `log_fallen` — a snapped spruce top, 3.03 m along x: bark in plates, gone
  in strips along the grain, whorls of branch stubs, its top torn into a
  tongue and splinters, its butt an old ragged break. About 2430 tris.
- `log_windthrow` — an old windthrow, 4.05 m: the root flare with its torn
  root stubs, one limb standing, most of its bark gone to silver-grey wood
  checked along the grain, a long snap at the top. About 2420 tris.
- `branch_a`, `branch_b`, `branch_c` — crooked spruce branches with their
  twigs snapped short and forking, lying along z, 0.8–1.3 m, swept tubes
  with their own UVs. 380–720 tris.

Logs and stump are distance fields like the rocks (bark plates, checks,
splintered and sawn ends, stubs and roots welded on); their baked texture
maps `textures/tree/tree-bark.jpg` round the trunk (its seam blended on the
underside), grains the bare wood with `textures/huts/alpine-wood-planks.jpg`
laid along the trunk (its plank gaps read as checks), and adds end-grain
rings, rot, the grey leafy lichen of dead spruce, wolf lichen and moss. One
2048² WebP atlas. The trunks lie along +x at the sizes in `props.js`'s
`DEADWOOD` table (its capsule follows that axis) and keep their own metres;
the logs are solid and low enough to jump (a capsule of three circles), the
branches have no collision and no shadow. One `upgradeTexturedSet` call
feeds all six pools, each wearing its own snow amount over the one texture.

## Sapling impostor atlas

`assets/textures/tree/sapling-impostors.webp` (1024 × 2048, RGBA) is a
render of the Poly Haven **fir_sapling** and **pine_sapling_small** models
(CC0, three saplings each). Their needles are real geometry, at 125–157k
triangles per sapling, so they cannot be simplified to a game budget
without losing the needles. Instead, each sapling was drawn in a headless
three.js page from three bearings 60° apart. Each view is an orthographic
camera looking along the normal of a vertical card through the trunk,
with image-right along the card, at 768 px wide.

The bake shader outputs albedo times:

- a crown-occlusion term (0.42–1.0, from how deep a needle sits inside
  its height band's 92nd-percentile envelope, times 0.72–1.0 towards the
  foot);
- a hemisphere term (0.8 + 0.2·nᵧ).

Needle colour is desaturated 18% and cooled by (0.74, 0.84, 0.82). A snow
load goes on up-facing, exposed needles in two scales of hashed clumps.

The views are downsampled with premultiplied box filtering to 310 texels
per metre and colour-dilated into the transparent gutter, then packed one
sapling per row with 8 px padding. The atlas is WebP at quality 82 with
lossless alpha. The UV rectangles and each sapling's frame (half-width
`R` and height `H`, in metres) are the `SAPLINGS` table in `js/props.js`.
In game, each view is a 3 × 3 card at the bearing it was drawn from:
24 triangles per young tree.

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
