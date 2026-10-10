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
