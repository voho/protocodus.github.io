# Residential artwork

Nine house designs were generated with the built-in `image_gen` tool, then normalized into transparent **256 × 256 pixel masters**. Taiga, tundra and desert each have a complete set of nine. The tundra and desert sets are climate edits of the aligned taiga atlas, keeping the architecture recognizable between environments.

The full generation instructions are in [prompts.json](prompts.json) and [biome-prompts.json](biome-prompts.json). Each environment's `atlas.json` records source hashes, crop bounds and normalization transforms.

## Files and ordering

Each of `taiga/`, `tundra/` and `desert/` contains:

- `sources/<house-kind>.png`: nine transparent 256 × 256 masters.
- `house-atlas.png`: the masters in a 3 × 3 grid, 768 × 768 pixels.
- `house-atlas-{16,32,64,128}.png`: prefiltered sprite atlases for the three zoom levels and standard/Retina displays.
- `atlas.json`: cell order and provenance.

| Row | Left | Center | Right |
| --- | --- | --- | --- |
| Affordable | Plaster cottage | Timber cabin | Brick terrace |
| Family | Gabled house | Brick villa | Garden bungalow |
| Prestige | Country manor | Grand townhouse | Courtyard villa |

The IDs are `house-cheap-1` through `house-cheap-3`, then `house-normal-1` through `house-normal-3`, then `house-expensive-1` through `house-expensive-3`.

## Downscaling and integration

`tools/build-house-atlases.py` uses Pillow to crop invisible matte noise, align foundations and create each sprite size independently using premultiplied-alpha Lanczos filtering. Mild sharpening is restricted to opaque interiors. Cells are filtered separately to avoid neighboring sprites bleeding into one another.

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

The game loads only the 12 small atlases, approximately 1 MB compressed in total. `raster-houses.js` selects the matching sprite density and owns the measured window positions used by `lighting.js`. Slow or unavailable images retain the original procedural fallback; successfully loaded artwork refreshes sprite and terrain caches without changing the company or camera.

`tests/raster-houses-browser-check.mjs` checks all 162 combinations of house, environment, zoom and display density, source transparency, cache limits, delayed loading and fallbacks. Existing saved towns receive the new artwork on reload.
