# Farm building cores

Ten generated **2×2 building cores** serve current **5×5 farm plots**: grain farm, dairy farm, vegetable farm, orchard and livestock farm, each in Taiga and Desert. Low barns, packing sheds, storage silos, greenhouses and loading aprons retain the same human and vehicle scale as town buildings. Surrounding fields, tracks, paddocks and perimeter fences belong to the terrain renderer and are absent from these core sprites. Published recipe 9 retains its historic 7×7 farm geography and uses these same fixed-size cores.

Version 3 artwork follows [`sprite-art-direction.js`](../../../sprite-art-direction.js) and its `buildingGenerationPrompt()`: one tile is 16 metres, ordinary doors are 2.1 metres high, storeys are 3 metres, and loading bays are 4.2 metres. A core represents a 32 metre square yard, rather than a close-up of its barn. Corrective generation reduced the buildings inside the unchanged yard, leaving quiet hardstanding. Broad roofs and major equipment provide the identity; tiny roof tiles, brick courses, scratches and crate grids are omitted.

Each climate directory retains `generation-job.json`, the exact `generation-prompt.json`, untouched `source-scale-v3.png`, `source-scale-v3-registered.png` and its registration record, and `provenance-scale-v3.json`. The Taiga corrective edit also keeps `source-scale-v3-reference.png`; the Desert edit references the corrected Taiga source while retaining the dimensions. These records identify the actual generator instructions and source hashes.

`tools/register-industry-atlas.py` copies complete original RGBA objects into one uniformly calibrated square grid, preserving camera geometry and transparent gutters. The siblings share one source-cell scale; no building receives an independent bounding-box fit. `tools/build-world-atlases.py` packs with `--aligned --preserve-grid-scale --no-sharpen --max-cell 256`, then creates 16, 32, 64, 128 and 256 px cells using premultiplied-alpha filtering. The atlas has three columns and two rows; the sixth cell is transparent.

To rebuild a recorded climate sheet, run from `fun/transport`:

```sh
python3 tools/register-industry-atlas.py assets/world/farm-cores-v1/taiga/source-scale-v3.png assets/world/farm-cores-v1/taiga/generation-job.json assets/world/farm-cores-v1/taiga/source-scale-v3-registered.png
python3 tools/build-world-atlases.py --atlas assets/world/farm-cores-v1/taiga/source-scale-v3-registered.png --columns 3 --rows 2 --ids farm-core:farm:taiga,farm-core:dairy-farm:taiga,farm-core:vegetable-farm:taiga,farm-core:orchard:taiga,farm-core:livestock-farm:taiga,- --output-dir assets/world/farm-cores-v1/taiga --aligned --preserve-grid-scale --no-sharpen --max-cell 256
```

For a new generator job, use `node tools/generate-building-prompt.mjs generation-job.json /tmp/farm-core-prompt.json` and pass the canonical result to the built-in image generator. Keep exact correction and climate-edit instructions with their references. Use the corresponding biome and IDs for Desert.

`drawRasterFarmCore` uses a 64 px conceptual source size, with eight pixels of sprite headroom; the renderer displays the upright two-tile core at 96 px at Town zoom. `drawNativeFarmCore` draws a 32 px conceptual core for callers to scale by two, using the shared metre dimensions. The renderer anchors it within the farm plot and keeps the surrounding field footprint separate. Compact historic farms use distinct metre-calibrated native full-farm drawings; five-tile generated compounds are not shrunk into smaller world parcels.

`tests/farm-core-art-browser-check.mjs` verifies all ten generated cores at the three zoom levels and both display densities, recovery after missing images, distinct native drawings, transparent gutters, exact generated pixels and rejection of five-tile artwork for compact historic parcels. The sprite-scale gallery checks the cores beside current five-tile industries and town buildings.

Historical `prompt.json`, `source-generated.png`, `source-isolated.png` and `source-isolated.json` retain the earlier art and 640 px registration records. Their earlier independent-fit packing and 7×7-only description are historical; current generation and shipping use the version 3 sources and shared calibration above.
