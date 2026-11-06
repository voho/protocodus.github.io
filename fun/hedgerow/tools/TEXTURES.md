# Hedgerow texture pipeline

The ground maps combine deterministic periodic geometry/noise for mud and
cobble with retained ImageGen diffuse sources for sward and decayed leaf litter.
No external photographs, texture packs or paid providers are used. Prompts,
source hashes and derivation limits are recorded in `texture-sources/`. The
existing GLTF atlases and twelve
palette-tinted model-detail maps are independent and remain unchanged in this
pass. These are original project assets under the project's existing terms;
this document does not grant a new third-party license.

Run from the repository root with Python 3, NumPy and Pillow:

```sh
python3 fun/hedgerow/tools/textures.py mud grass forest cobble
python3 fun/hedgerow/tools/check_textures.py --json work/texture-validation.json
```

The original procedural sward and litter are available for explicit comparison:
`python3 fun/hedgerow/tools/textures.py --procedural grass forest`.

Individual output files are replaced atomically. Keep scratch alternatives and
before/after captures in `work/`, outside the shipped assets directory.

## Runtime contract

| File | RGB | Alpha | Transfer function | Repeat in world |
| --- | --- | --- | --- | --- |
| `mud.webp` | Clay/gravel albedo | Relief height | RGB sRGB; alpha linear | 4 m |
| `grass.webp` | Basal meadow sward albedo | Relief height | RGB sRGB; alpha linear | 4 / 0.93 ≈ 4.30 m |
| `forest.webp` | Decaying litter/humus albedo | Relief height | RGB sRGB; alpha linear | 4 / 0.87 ≈ 4.60 m |
| `cobble.webp` | Worn granite setts albedo | Relief height | RGB sRGB; alpha linear | 4 / 1.6 = 2.5 m |
| `<ground>_n.webp` | OpenGL tangent normal | Dry-surface roughness | All channels linear | Same as paired ground |
| Model detail maps | Tangent normal | Palette albedo multiplier detail | All channels linear | Defined by `materials.js` |
| `landscape.webp` | R moisture, G growth, B organic drift | Independent secondary field | All channels linear | Per-channel periods below |

Ground albedos use the exact sRGB transfer function, not a gamma-2.2
approximation. The normal vectors are derived from the **quantized shipped
height** using periodic central differences. Green points up the image
(opposite increasing image rows); do not flip it to DirectX convention.

The ground normal/roughness maps use lossless WebP. Before lossless encoding,
X/Y have seven effective bits and roughness six effective bits; blue is derived
from the quantized X/Y slopes to preserve the unit hemisphere. This bounds the
additional angular error while avoiding lossy WebP's YUV chroma filtering,
which can rotate narrow blade/rib normals by many degrees. The ground albedos
use WebP quality 80 with lossless alpha. Palette detail maps retain their
existing encoding and appearance.

## Material structure and scale

- Mud has connected compacted clay aggregates, buried irregular mineral
  grains and sparse short straw. World-space wheel ruts and rain puddles are
  handled by the terrain shader, so they are not repeated in each texture tile.
- Grass has irregular overlapping narrow blades, clover and sparse old straw
  in a compressed basal mat under the standing grass geometry. It does not
  attempt to draw tall grass in albedo.
- Forest floor contains torn, decayed brown deciduous leaves, fine organic
  fragments, twigs, humus and small moss patches. Brown last-year litter fits
  the Normandy summer setting. Its dense detail avoids smooth blank soil
  between isolated painted leaf shapes.
- Cobble contains roughly 12 × 16 cm granite setts with worn crowns, small
  chips, mineral grains and packed gritty joints. Stone and joint color,
  relief and roughness share masks.

The generated sources are diffuse-only images. Their restrained relief and
roughness are estimates, not measured scans or recovered true displacement.
Color and relief share the source structure, with no deliberately baked
directional sun or shadow.
Rain darkening, standing water, broad landscape tint and near-eye parallax
remain runtime effects.

## Landscape fields

Material relief must not decide where rain gathers or vegetation changes.
`landscape.webp` is a separate 256² lossless RGBA field, with periodic spectra
and independent seeds. Its marginal distributions are calibrated to the old
authored broad fields; the retained calibration quantiles and reference asset
hashes make rebuilding independent of the current ground images.

| Channel | Meaning | Mean / standard deviation | Suggested full repeat |
| --- | --- | --- | --- |
| R | Complete moisture/gather field | 0.40592 / 0.07203 | 31 m |
| G | Complete growth/color macro field | 0.45772 / 0.08503 | 57 m |
| B | Complete organic drift field | 0.42311 / 0.05792 | 23 m |
| A | Independent secondary field | 0.44245 / 0.13358 | 9 m |

R, G and B already match the complete old weighted mixtures, so they should not
be mixed again with the old weights unless a distribution change is intended.
The suggested repeats are full image periods, not the size of each patch.
Each channel contains several scales of smooth structure within its repeat.
Six effective bits per scalar, stored losslessly, avoid cross-channel color
compression. Linear filtering keeps transitions soft. The decoded channels'
largest absolute pairwise correlation is below 0.08.

## Budget and validation

The fixed budget is twenty-one RGBA maps: twelve 512² model detail maps, eight
1024² ground maps and one 256² landscape field. This is **59.00 MiB** for
uncompressed RGBA8 with a full mip
chain (drivers can choose a different internal representation). The download
budget is **8 MiB**. Ground resolution and draw calls do not increase. The
dedicated landscape field adds one 256² terrain sampler and 0.33 MiB of full
mips.

The runtime packs the eight ground images into two four-layer
`DataArrayTexture` objects with `createTerrainTextureArrays` in
`js/terrain-textures.js`. Layers are mud 0, grass 1, forest 2, cobble 3.
The albedo array keeps sRGB RGB/linear height alpha; the normal array is
entirely linear. The helper copies uploaded texels through Three r185's GPU
`copyTextureToTexture` API, never through a canvas, and generates a full mip
chain for every layer. Temporary source GPU allocations are disposed; decoded
source images remain available for diagnostics and context recovery.

This saves six terrain sampler units. With two point shadows, one directional
shadow, environment lighting and r185's DFG lookup, the integrated material
uses **11 fragment + 1 vertex = 12 combined** samplers. Before packing, adding
the landscape map would require 17 fragment samplers and exceed WebGL2's
guaranteed fragment minimum of 16. The canopy map is vertex-only.

On context loss, the helper releases the old generation's array allocations
and disposal listeners. After Three rebuilds its GL caches, it repopulates
the same array objects from retained source images. Final disposal removes
both lifecycle listeners and is idempotent.

`check_textures.py` inspects decoded WebP bytes rather than trusting generator
settings. It checks map names, dimensions, channel mode, normal hemisphere and
length, normal/height angular agreement, dry roughness bounds, terrain height
bias and both periodic boundaries. Opposite edge pixels are adjacent samples,
not identical samples; a valid periodic derivative is comparable to derivatives
inside the tile. The report includes file hashes, boundary step ratios, angular
error and both download and mip budgets.

Additional runtime checks:

```sh
node fun/hedgerow/tests/terrain-textures-check.mjs
node fun/hedgerow/tests/terrain-textures-browser.mjs
```

The optional browser gate uses Playwright and accepts `CHROMIUM_PATH`. Run it
serially with full-world captures. It compares all RGBA bytes in every layer
and every mip of the actual eight ground images, verifies temporary GPU
cleanup, forces context loss/recovery when the extension is available, and
checks final disposal for stale-context GL errors. Its JSON output defaults
to `work/qa/terrain-textures-browser.json`; `HEDGEROW_TEXTURE_REPORT` overrides
that destination.

A passing byte-level check does not establish art quality. Review tiled maps at
close range and in the real terrain shader, in dry daylight and wet low light.
For before/after scene captures, keep the camera/world unchanged, swap texture
images in place, and allow several real renders for temporal effects to settle.
Do not infer frame rate from CPU command-dispatch time on a software renderer.
