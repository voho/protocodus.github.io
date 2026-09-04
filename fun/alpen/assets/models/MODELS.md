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
