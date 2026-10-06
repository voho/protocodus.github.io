# Residential artwork

Nine residential kinds have three architectural designs, two physically drawn orientations and three climates: **162 transparent house-and-garden sprites**. The active masters were regenerated through the built-in imagegen tool on 2026-10-06 to share a human scale and retain clearer silhouettes at Region and Town zoom.

[The shared sprite art direction](../../sprite-art-direction.js) applies to houses, civic buildings and industry. A tile represents 16m; personnel doors target 2.1m, storeys 3m and low fences 1.2m. A 256px cell targets a 22.4px door on a one-tile parcel and an 11.2px door on a two-tile parcel. The renderer enlarges the latter parcel by two, so doors and storeys remain the same world size. Prestige homes gain larger gardens and modest wings, rather than enlarged doors, windows or fence posts.

Roofs and facades use broad painted colour planes. Planting uses restrained clusters and open yard space. Individual brick seams, roof-tile grids, woodgrain scratches and dense flower speckle are reduced because they obscure architecture at smaller zooms. Low fences, an open gate and an entry path remain on every plot. Exposed lawn, snow and soil reveal the actual world terrain through the cached garden-plane cutout in house-ground.js; architecture, paths, fences and planted silhouettes retain their artwork. Raised gardens replay the same world grass surface on their levelled foundation.

The camera is orthographic 2:1 dimetric, with upright walls, ground edges at ±26.565° and northwest light. Orientation 0 faces its door, gate and path toward the lower-left street axis; orientation 1 is physically rotated through 90° and faces the lower-right axis. The saved variant keeps these choices stable: orientation is variant modulo 2, and design is floor(variant / 6) modulo 3.

Design 0 retains plaster cottages, timber cabins, brick homes, traditional family homes and classical prestige homes. Design 1 adds weathered timber and rough stone cottages, new family homes, solar timber homes and modern flat-roof and living-roof villas. Design 2 adds prefabs, granite and half-timber cottages, modern brick homes, solar bungalows and charcoal timber/glass and clay-plaster villas. All three climates retain these identities and physical dimensions.

## Active files

Each climate has its primary design and orientation at the climate directory root. Additional designs use design-1/ and design-2/; second orientations use rotation-1/ below the corresponding design.

- source-readable-scale-2026-10-06.png: accepted unmodified imagegen source with genuine alpha.
- sources/house-kind.png: nine registered 256 × 256 masters.
- house-atlas.png: the 3 × 3 master atlas, 768 × 768 pixels.
- house-atlas-{16,32,64,128}.png: independently filtered LOD atlases.
- atlas.json: source hashes, component bounds, shared source scale, registration padding, offsets, orientation and generation date.
- readable-scale-generation-2026-10-06.json: shared prompts, accepted sources and correction provenance for all eighteen sheets.

Cell order is affordable 1–3, family 1–3, then prestige 1–3. IDs are house-cheap-1 through house-cheap-3, house-normal-1 through house-normal-3, and house-expensive-1 through house-expensive-3.

The 2026-10-05 scale/garden, rotation and variety generation JSON files and older source files are historical provenance. Their tier-based 208/224/240px bounding-box fitting instructions and decorative-detail prompts do not describe the current pipeline. windows.json also documents the previous primary masters.

## Generation and packing

Create or edit every sheet using buildingGenerationPrompt() or tools/generate-building-prompt.mjs, preserving the shared style and each slot's physical dimensions. Never enlarge human features to fill larger plots. Preserve complete parcels and generous transparent gutters.

The house atlas builder requires Pillow, NumPy and SciPy. It registers alpha silhouettes with **one declared scale for the entire source sheet**. Only translation varies per plot; no sprite is fitted independently to its bounding box. Every source pixel with alpha above 8 is assigned exactly once before resampling. If complete fence tips touch through a narrow alpha bridge, registration partitions at the least occupied source gutter, preserving the original pixels. Broad overlapping plots require regeneration.

The common garden groundline is 240px. Source-grid padding is explicit in atlas.json and applied uniformly to all nine cells. Nine sheets use 1.1; the nine gutter-corrected sources use 1.15 to protect the complete source silhouette. Do not use the historical per-tier normalization mode for these calibrated masters.

Every LOD is filtered separately from its master using premultiplied-alpha Lanczos, without sharpening. This avoids neighbouring-cell bleed, coloured transparent halos and amplified small-detail noise. Example rebuild for the primary taiga source:

```sh
python3 fun/transport/tools/build-house-atlases.py \
  --atlas fun/transport/assets/houses/taiga/source-readable-scale-2026-10-06.png \
  --generated-atlas --preserve-grid-scale --source-grid-padding 1.1 \
  --biome taiga --output-dir /tmp/transport-house-rebuild \
  --qa-dir /tmp/transport-house-review
python3 fun/transport/tools/build-house-atlases.py --self-test
```

The raster loader chooses the matching climate/design/orientation at the required display density. Missing or delayed sheets use healthy same-climate artwork while preserving the saved variant; arrival invalidates prepared sprite caches without changing the company or camera.

The raster-house browser check covers identities, orientations, designs, transparency, zoom/DPR rendering, delayed loading and fallback. The house-ground browser check verifies architecture preservation, terrain pixels through gardens, slope surfaces and warm-cache stability. The shared sprite-scale gallery compares actual world-size buildings with door rulers, buses and trucks at all three zooms.
