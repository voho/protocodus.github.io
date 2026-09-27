# Residential artwork

Nine house designs were generated with the built-in `image_gen` tool, then normalized into transparent **256 × 256 pixel masters**. Taiga, tundra and desert each have a complete set of nine. The tundra and desert sets are climate edits of the aligned taiga atlas, keeping the architecture recognizable between environments.

The active artwork uses a fixed **2:1 dimetric camera**, with two visible facades, upright walls and ground edges at ±26.565°. The built-in imagegen regenerated the architecture before deriving matching snowy tundra and dry desert finishes. [Isometric architecture prompts](../world/isometric-architecture-prompts.json) contain the complete current prompts and source paths. The earlier front-facing instructions remain in [prompts.json](prompts.json) and [biome-prompts.json](biome-prompts.json). Each environment's `atlas.json` records source hashes, crop bounds and normalization transforms.

The three affordable houses and the garden bungalow now have small fenced gardens, with varied gates, paths, flowerbeds, vegetable beds or dry-climate planting. [Garden prompts](garden-prompts.json) record the built-in imagegen edits. Only those four identities were replaced in each climate; the other five source masters and their atlas cells remain exactly unchanged.

## Files and ordering

Each of `taiga/`, `tundra/` and `desert/` contains:

- `sources/<house-kind>.png`: nine transparent 256 × 256 masters.
- `house-atlas.png`: the masters in a 3 × 3 grid, 768 × 768 pixels.
- `house-atlas-{16,32,64,128}.png`: prefiltered sprite atlases for the three zoom levels and standard/Retina displays.
- `atlas.json`: cell order and provenance.
- `source-isometric.png`: the unmodified generated image, including its original alpha.
- `source-isometric-packed.png` and `.json`: losslessly registered cells and their source positions.
- `source-gardens.png`, `source-gardens-packed.png` and `.json`: generated garden edits and their lossless registration.
- `garden-packing.json`: selected replacements, hashes of retained masters and unchanged-cell counts for every density.

[windows.json](windows.json) records small measured glazing rectangles on the final masters, used by night lighting. Matching climate positions follow the recorded source registration and normalization.

| Row | Left | Center | Right |
| --- | --- | --- | --- |
| Affordable | Plaster cottage | Timber cabin | Brick terrace |
| Family | Gabled house | Brick villa | Garden bungalow |
| Prestige | Country manor | Grand townhouse | Courtyard villa |

The IDs are `house-cheap-1` through `house-cheap-3`, then `house-normal-1` through `house-normal-3`, then `house-expensive-1` through `house-expensive-3`.

## Downscaling and integration

`tools/build-house-atlases.py` uses Pillow to crop invisible matte noise, align foundations and create each sprite size independently using premultiplied-alpha Lanczos filtering. Mild sharpening is restricted to opaque interiors. Cells are filtered separately to avoid neighboring sprites bleeding into one another.

`tools/prepare-building-atlas.py` registers the disconnected original alpha silhouettes when generated objects extend across nominal cell boundaries. It copies original RGBA pixels into padding without resampling or repainting, and verifies that every pixel with alpha above 8 is preserved exactly once. Rebuild a current climate with:

```sh
python3 fun/transport/tools/prepare-building-atlas.py \
  fun/transport/assets/houses/taiga/source-isometric.png \
  fun/transport/assets/houses/taiga/source-isometric-packed.png
python3 fun/transport/tools/build-house-atlases.py \
  --atlas fun/transport/assets/houses/taiga/source-isometric-packed.png \
  --normalize-atlas --biome taiga --qa-dir /tmp/transport-house-review
```

Garden edits are installed selectively. Normalize the generated sheet into a **staging directory**, then replace only `house-cheap-1`, `house-cheap-2`, `house-cheap-3` and `house-normal-3` in the active atlas. Never install all nine generated garden cells, because image edits can subtly alter the other five houses. After a complete isometric rebuild, apply this garden step again for each climate:

```sh
python3 fun/transport/tools/prepare-building-atlas.py \
  fun/transport/assets/houses/taiga/source-gardens.png \
  fun/transport/assets/houses/taiga/source-gardens-packed.png
python3 fun/transport/tools/build-house-atlases.py \
  --atlas fun/transport/assets/houses/taiga/source-gardens-packed.png \
  --normalize-atlas --biome taiga --output-dir /tmp/transport-garden-rebuild
python3 fun/transport/tools/replace-house-atlas-cells.py \
  --base fun/transport/assets/houses/taiga \
  --replacement /tmp/transport-garden-rebuild/taiga \
  --ids house-cheap-1,house-cheap-2,house-cheap-3,house-normal-3
```

The replacement step copies the four selected normalized masters and metadata, and replaces only their cells at 256, 128, 64, 32 and 16 pixels. It verifies that unselected source files and atlas pixels remain unchanged. Window anchors for all twelve garden variants were measured again on their final 256px masters.

Run the pipeline's self-check from the repository root:

```sh
python3 fun/transport/tools/build-house-atlases.py --self-test
```

To derive atlases from a revised transparent 3 × 3 master, use a separate output directory for review:

```sh
python3 fun/transport/tools/build-house-atlases.py \
  --atlas fun/transport/assets/houses/taiga/house-atlas.png \
  --biome taiga --output-dir /tmp/transport-house-rebuild \
  --qa-dir /tmp/transport-house-review
```

The game loads only the 12 small atlases, approximately 1 MB compressed in total. `raster-houses.js` selects the closest available sprite density and owns the measured window positions used by `lighting.js`. Each density becomes usable independently. Missing densities use another loaded resolution; a missing climate can use the same house from another available climate, with procedural drawing only when no image is usable. Successfully loaded artwork refreshes sprite and terrain caches without changing the company or camera.

`tests/raster-houses-browser-check.mjs` checks all 162 combinations of house, environment, zoom and display density, source transparency, cache limits, delayed loading and fallbacks. Existing saved towns receive the new artwork on reload.
