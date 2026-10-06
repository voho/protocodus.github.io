# Residential artwork

The nine residential kinds each have **three architectural designs**, with **two physically drawn orientations in three climates**, for **162 transparent house-and-garden sprites**. Each is normalized into a 256 × 256 pixel master and independently downscaled for all game zooms and display densities.

Every house now sits inside a generous fenced garden, with an open gate, an entry path and substantial open foreground yard. The house structure is much smaller relative to the full plot: architecture and roofs occupy roughly 40–50% of plot width instead of filling most of it. Cottages read at a believable scale beside buses and trucks; the full garden and occupied tile footprint remain the same size. Taiga has varied lawns, flowers and vegetable beds, tundra has patchy snow and hardy dormant planting, and desert has sandy xeriscape yards, dry grasses and succulents.

The fixed **2:1 dimetric camera** has upright walls and ground edges at ±26.565°. Orientation 0 faces its entrance and garden gate toward the lower-left projected street axis; orientation 1 turns the architecture physically through 90° and faces the lower-right axis. Both are separately painted through the built-in imagegen tool, with correct facades, gardens and lighting. The existing saved tile variant selects orientation with `variant % 2` and architectural design with `floor(variant / 6) % 3`. Choices repeat every eighteen variants, keeping architecture independent of the procedural residential kind and stable when rendering, changing zoom or reloading a company.

Design 0 retains the original gardened houses. Design 1 adds weathered timber and stone cottages, workers' brick homes, new family houses, classic brick townhouses, solar timber homes, a compact stone villa, a modern flat-roof glass villa and an ecological green-roof villa. Design 2 adds contemporary timber prefabs, granite and half-timber cottages, modern brick family homes, renovated traditional houses, solar bungalows, restored stone villas, charcoal timber/glass villas and clay-plaster green-roof homes. All retain the same small house scale and generous plots.

[Primary scale and garden prompts](scale-garden-prompts-2026-10-05.json) and [second-orientation prompts](rotation-1-generation-2026-10-05.json) record the complete current generations, references, corrections and accepted sources. Each climate/orientation's `atlas.json` records source hashes, crop bounds and normalization transforms. [The initial 2026-10-05 regeneration](regeneration-prompts-2026-10-05.json), [earlier isometric prompts](../world/isometric-architecture-prompts.json), [original prompts](prompts.json), [biome prompts](biome-prompts.json) and [garden prompts](garden-prompts.json) remain as historical provenance.

[Architectural variety generation](variety-generation-2026-10-05.json) records the eighteen added designs, complete prompts, climate edits, physical rotations, layout corrections and accepted sources. Each accepted generation contains eighteen plots in a three-row, six-column sheet: design 1 occupies the left three columns and design 2 the right three. Disconnected original RGBA silhouettes were losslessly registered into separate 3 × 3 masters before the ordinary normalization pipeline. Every meaningful source pixel was retained exactly once.

## Files and ordering

Each of `taiga/`, `tundra/` and `desert/` contains the primary orientation below. Its `rotation-1/` subdirectory contains the same atlas, source and packing files for the second orientation:

The additional designs use `design-1/` and `design-2/` inside each climate directory, with their second orientation in `design-1/rotation-1/` and `design-2/rotation-1/`. Every design/orientation uses the same atlas filenames, cell order, master groundline of 240 pixels and tier plot widths of 208/224/240 pixels. Each added design retains `source-variety-2026-10-05-packed.png` and its registration JSON; each climate retains the original paired `source-design-variety[-rotation-1]-2026-10-05.png` generations.

- `sources/<house-kind>.png`: nine transparent 256 × 256 masters.
- `house-atlas.png`: the masters in a 3 × 3 grid, 768 × 768 pixels.
- `house-atlas-{16,32,64,128}.png`: prefiltered sprite atlases for the three zoom levels and standard/Retina displays.
- `atlas.json`: cell order and provenance.
- `source-scale-gardens-2026-10-05.png`: the unmodified accepted generated image, including its original alpha.
- `source-scale-gardens-2026-10-05-packed.png` and `.json`: losslessly registered cells, source positions and meaningful pixel coverage.
- Earlier `source-isometric*`, `source-gardens*`, `source-regenerated*` and `garden-packing.json` files: historical generation and selective garden-edit provenance.

[windows.json](windows.json) records small glazing rectangles inspected on the final primary orientation masters, registered independently to dark glass in each climate.

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
  fun/transport/assets/houses/taiga/source-scale-gardens-2026-10-05.png \
  fun/transport/assets/houses/taiga/source-scale-gardens-2026-10-05-packed.png
python3 fun/transport/tools/build-house-atlases.py \
  --atlas fun/transport/assets/houses/taiga/source-scale-gardens-2026-10-05-packed.png \
  --normalize-atlas --biome taiga --qa-dir /tmp/transport-house-review
```

The complete regeneration includes fenced gardens for all nine identities in both orientations, so the previous selective garden replacement step is unnecessary. The older garden sources and selected-cell metadata are retained only for provenance.

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

The game has **72 small atlases** across its eighteen climate/design/orientation sets; the eighteen 256px-cell masters remain available for source review and explicit loading. `raster-houses.js` selects the closest available sprite density and draws the matching climate/design/orientation cell. Designs and rotations share the same fenced-plot envelope and each keeps its own cache entry. Each density becomes usable independently. Missing artwork temporarily uses an available house sheet; arrival refreshes the cached draw while retaining the saved variant. Successfully loaded artwork refreshes sprite and terrain caches without changing the company or camera.

`tests/raster-houses-browser-check.mjs` checks house kinds, climates, designs, orientations, zooms and display densities, source transparency, cache limits, delayed loading and fallbacks. Existing saved towns receive the new artwork on reload.
