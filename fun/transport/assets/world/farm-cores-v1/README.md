# Farm building cores

Ten generated compact 2×2 building cores serve large 7×7 farm plots: grain farm, dairy farm, vegetable farm, orchard, and livestock farm, each in Taiga and Desert. Barns, packing sheds, milk/grain storage, glasshouses, and loading aprons retain normal vehicle scale. Surrounding crops, tracks, paddocks, and perimeter fences belong to the world terrain renderer and are absent from these sprites.

Each `prompt.json` records the built-in image generator and style reference. `source-generated.png` is untouched generator output. `source-isolated.json` records complete silhouette extraction coordinates; `source-isolated.png` only centers original RGBA crops into isolated 640px cells. The shared `tools/build-world-atlases.py` pipeline produces five independent shipping densities, using 256px masters with a maximum 232px silhouette and groundline 244. The atlas has three columns and two rows; the last cell is empty.

`drawRasterFarmCore` uses a 64px default source size, with the caller adding the usual 8px sprite headroom. `drawNativeFarmCore` draws a 32px conceptual core for callers to scale by two. The renderer places these cores at the farm's upper corner, two tiles wide, rather than enlarging a compact 3×3 farm sprite to fill the whole field plot. Existing industry atlases remain available for compact saved farms.

`tests/farm-core-art-browser-check.mjs` checks all ten cores at six zoom/display densities, late recovery from missing images, distinct native drawings, true alpha gutters, and legacy full-farm artwork availability.
