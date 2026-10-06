# Town parks and retail varieties

Generated with the built-in image generation tool on 5 October 2026. Six complete transparent runtime sheets contain 48 new climate-specific cutouts: three parks, three malls, and two additional physical exteriors for each of the five existing shop identities, in temperate taiga, snowy tundra and dry desert finishes. The fifteen existing shop cutouts remain design 0; there are now 45 shop exteriors across the three climates.

Parks contain distinct paths, benches, planting, fences, play structures or fountains. Their open landscaping has transparent gaps that reveal the world terrain. The malls are a low neighbourhood shopping court, a classic brick shopping arcade and a contemporary timber/glass centre with skylights, planted roof sections, solar panels and a loading dock. The shops add traditional timber/stone/brick and contemporary exteriors.

All art follows the game's fixed orthographic 2:1 dimetric camera with upright walls, detailed miniature materials and northwest lighting. Each source preserves a broad transparent gutter around the complete object. Ground contact surfaces use restrained stone or gravel with planted edges. Source artwork is retained together with exact generation, gutter-repair and climate-edit prompts in [generation.json](generation.json), original initial layouts under `generation/`, and source hashes in [packing.json](packing.json).

`civic-retail` row-major order: village green, formal garden, woodland park / neighbourhood shopping centre, shopping arcade, modern mall / traditional grocery, bakery, butcher. `shop-alternates` order: traditional hardware, florist, modern grocery / modern bakery, butcher, hardware / eco florist, empty, empty.

Rebuild all 16, 32, 64, 128 and 256px isolated cell densities with:

```sh
python3 fun/transport/assets/world/town-variety-v1/rebuild.py
```

The civic/retail sheets first use the existing disconnected-alpha registration tool to preserve every meaningful source pixel while moving each complete cutout into a padded cell. The shared atlas builder preserves alpha, downsamples with premultiplied colours and sharpens only opaque interiors. It normalizes each complete cutout to a maximum 232px extent and groundline 244 inside its 256px master. No script paints or recolours generated art.

`raster-buildings.js` registers all six new buildings and the shop design atlases. Shop seeds repeat every 15 states: identity uses the existing five-way selection, while `buildingArtworkDesign` selects `floor(normalizedVariant / 5)`. Sprite cache identities include the selected design; map sprites and inspector portraits retain that same choice. A late or unavailable alternate falls back first to the established artwork in the same climate and refreshes when generated art arrives.

`tests/town-variety-art-browser-check.mjs` verifies all five densities, isolated transparent cells, the six building identities, the fifteen distinct shop identity/design combinations, authored cache reuse, UI portrait parity, native fallback and late-art recovery.
