# Farming and food industry artwork

Seven compact 3×3 sites have separate northern and desert artwork: dairy farm, vegetable farm, orchard, livestock farm, dairy processing plant, fruit and vegetable cannery, and meat packing plant. These full-property drawings preserve compact saved farms; new 7×7 farm plots use the separate 2×2 building artwork in `farm-cores-v1` and terrain-rendered fields. Food processing plants continue to use these 3×3 sites.

`prompt.json` and `packing-prompt.json` record the built-in image generator's two authored passes. Both generated source sheets are retained. `source-isolated.json` records the original pixel bounds used to center each complete transparent silhouette in an isolated 640px cell. This extraction changes no artwork, colors, or alpha.

The shared `tools/build-world-atlases.py` pipeline normalizes each site into a 256px cell, with a maximum 232px silhouette, groundline at 244, and premultiplied-alpha density filtering. Shipping atlases contain 16, 32, 64, 128, and 256px cells in the runtime industry order; cells 8 and 9 are empty. Sources and metadata are build provenance, loaded only when explicitly opened.

`raster-industries.js` registers these two biome atlases. Ordinary startup loads only the active climate's small densities; sharper levels load on demand. Existing atlas revision handling replaces cached native drawings when artwork arrives. Every site also has its own native recovery drawing in `processing-sprites.js` if authored art cannot load.

Verification: `tests/food-industry-art-browser-check.mjs` decodes both climates, checks genuine alpha and empty gutters, compares generated pixels through the runtime sprite cache at six zoom/display densities, tests replacement of failed native artwork, and renders all seven compact 3×3 sites beside roads and trucks.
