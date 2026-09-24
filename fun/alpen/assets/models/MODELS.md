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

## Card conifer atlas

The needled tree species are card conifers built at runtime by
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
