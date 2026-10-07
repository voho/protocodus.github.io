# Residential artwork

Nine residential kinds have three architectural designs, two drawn orientations and three climates: **162 house-and-garden sprites in eighteen sheets**. The active artwork was regenerated with `image_gen` on 2026-10-07 for a shared human scale, simpler silhouettes, alignment with the world grid and transparent gardens.

[The shared sprite art direction](../../sprite-art-direction.js) supplies the canonical camera, scale and material palette used by houses, civic buildings and industry. One tile represents 16m; personnel doors target 2.1m, storeys 3m and low fences 1.2m. In a 256px normalized cell a one-tile parcel targets a 22.4px door; a two-tile parcel targets 11.2px. The renderer enlarges the two-tile parcel by two, preserving human scale. Larger homes gain rooms, wings and gardens rather than enlarged doors or windows.

Roofs, walls and planting use broad painted masses with restrained plaster, brick, stone, timber, slate and terracotta hues. Garden fences, an open gate and a path remain recognizable at Town zoom. Unpaved lawn, snow and soil are authored as transparent space, so the native world terrain shows through. `house-ground.js` recognizes the authored clear ground before its conservative recovery mask; it preserves roofs, fences, paths and individual planted silhouettes. Raised gardens reveal the same world terrain on their levelled foundation.

The requested camera is orthographic 2:1 dimetric with upright walls, ground axes at ±26.565° and northwest daylight. Native terrain uses the exact projection. Measured painted house edges have small variation: most are near absolute slopes .5–.61, with a few up to .66. Registration metadata preserves their observed post-foot axes; it does not claim exact generated geometry or warp the artwork. Orientation 0 faces its entrance toward the lower-left street axis; orientation 1 redraws it along the lower-right axis. It never rotates the plot arbitrarily. Saved variants keep the choice stable: orientation is variant modulo 2, and design is floor(variant / 6) modulo 3.

Design 0 includes plaster and timber cottages, brick homes, traditional family homes and classical prestige homes. Design 1 adds weathered timber and rough stone cottages, solar timber homes and modern flat-roof and living-roof villas. Design 2 adds prefabs, granite and half-timber cottages, modern brick homes, solar bungalows and charcoal timber/glass and clay-plaster villas. The climates retain these architectural identities.

## Active files

Each climate stores design 0/orientation 0 at its root. Additional designs use `design-1/` and `design-2/`; the second orientation uses `rotation-1/` below its design directory.

- `exec-*.png`: exact accepted, unmodified imagegen output, identified by the source SHA in `atlas.json`.
- `sources/house-kind.png`: nine registered 256 × 256 runtime masters.
- `house-atlas.png`: the 768 × 768 master atlas.
- `house-atlas-{16,32,64,128}.png`: independently filtered LOD atlases.
- `atlas.json`: measured ground vertices, source regions, source hashes, uniform scale per footprint tier, translations and actual normalized bounds.
- `grid-calibration-2026-10-07.json`: durable rebuild inputs, with actual source-pixel observations and tier calibration.
- `grid-generation-2026-10-07.json`: the exact canonical generation prompt used for the accepted output.
- `grid-landmark-review-2026-10-07.json`: independent source observations, including visible openings, full frames, genuine obstructions and uncertainty.
- [Generation reference index](grid-references-2026-10-07/index.json): exact edit-parent artwork and production guides, with hashes and reference roles. These are provenance inputs, not runtime sprites.

Cell order is affordable 1–3, family 1–3, then prestige 1–3: `house-cheap-1` through `house-cheap-3`, `house-normal-1` through `house-normal-3`, and `house-expensive-1` through `house-expensive-3`.

Older tracked 2026-10-05/06 sources, `windows.json` and their generation records remain historical provenance. Their alpha-bottom/240px groundline, source padding and silhouette-fit instructions do not describe the active 2026-10-07 registration.

## Generation and packing

Create or edit every sheet through `buildingGenerationPrompt()` or `tools/generate-building-prompt.mjs`. Preserve the shared numeric camera, metre scale, palette, complete parcels and transparent lawn. A lawn-only edit can still change generated geometry; remeasure the final source rather than copying old landmarks.

Use [the measured house packer](../../tools/repack-house-grid.py), which requires Pillow, NumPy and SciPy through the existing atlas builder. It partitions the source at actual empty gutters, retaining every source pixel with alpha above 8 exactly once. Each complete RGBA parcel is resampled uniformly and translated; it is never warped, sharpened, recoloured or independently fitted to its silhouette.

The physical garden centre is **(128,192)** in every master cell. It is measured from opposite grounded fence/post feet, independently of roof height, shadows and alpha bounds. Garden geometry uses the same two world axes. One uniform source-to-master factor applies to the six one-tile houses; another applies to the three two-tile houses. Personnel entrance observations set those factors, with the same gutter constraint applied across each tier. Hidden doors are excluded from calibration. Metadata distinguishes dark inner openings from separately observed full-frame head/sill endpoints, records genuine porch/roof occlusion as a lower bound, and permits an explicitly unobservable entrance instead of measuring a window.

Each master keeps at least eight meaningful transparent edge pixels for filtering. Every LOD is filtered independently from its master using premultiplied-alpha Lanczos, preventing adjacent-cell bleed and coloured transparent halos.

From the repository root, rebuild the primary Taiga sheet with:

```sh
python3 fun/transport/tools/repack-house-grid.py \
  fun/transport/assets/houses/taiga/grid-calibration-2026-10-07.json \
  /tmp/transport-house-rebuild --qa-dir /tmp/transport-house-review
python3 fun/transport/tools/build-house-atlases.py --self-test
node --test fun/transport/tests/building-registration.test.mjs
```

The raster loader selects climate, design, orientation and display density. Delayed sheets use healthy same-climate artwork while preserving saved variants; arrival invalidates prepared sprite caches.

The raster-house browser check covers all identities, designs, orientations, zoom/DPR levels, delayed loading and fallback. The house-ground browser check verifies source alpha, preserved architecture and planting, terrain through connected open garden regions, slope surfaces and warm-cache stability. The shared scale gallery and building-consistency scene compare actual world-size buildings with door rulers, buses and trucks.
