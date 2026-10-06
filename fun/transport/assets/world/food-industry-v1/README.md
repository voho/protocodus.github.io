# Farming and food industry artwork

Seven industry identities have Taiga and Desert artwork: dairy farm, vegetable farm, orchard, livestock farm, dairy processing plant, fruit and vegetable cannery, and meat packing plant. Their current version 3 sheets depict full **5×5 compounds** at the shared architectural scale. Active farm plots occupy 5×5 tiles, with a separate 2×2 building core from `farm-cores-v1`; crops, paddocks, tracks and perimeter fences are rendered as terrain. Food processors use these full five-tile compound sprites.

The scale and style come from [`sprite-art-direction.js`](../../../sprite-art-direction.js). Every generation or edit uses its `buildingGenerationPrompt()` instructions: one tile is 16 metres, ordinary personnel doors are 2.1 metres high, storeys are 3 metres, and loading bays are 4.2 metres. Larger sites gain more halls and bays at this same human scale. Broad roofs, wall masses and major equipment remain recognizable at Region zoom; tiny brick courses, roof tiles, window grids and decorative speckle are omitted.

Each climate directory keeps `generation-job.json`, the exact `generation-prompt.json`, `source-scale-v3.png`, `source-scale-v3-registered.json`, and `provenance-scale-v3.json`. The original generated RGBA is registered into one uniform square grid by `tools/register-industry-atlas.py`. All siblings share the same source scale and a clear filtering gutter; complete objects retain their camera geometry. Buildings are never independently enlarged to fit their bounding boxes.

The shared `tools/build-world-atlases.py` packer uses `--aligned --preserve-grid-scale --no-sharpen --max-cell 256`. Premultiplied-alpha filtering produces 16, 32, 64, 128 and 256 px cells without sharpening tiny mip features. The atlas has three columns and three rows, with cells 8 and 9 transparent. Sources and prompt records are provenance, loaded only when explicitly opened.

To rebuild a recorded climate sheet, run from `fun/transport`:

```sh
python3 tools/register-industry-atlas.py assets/world/food-industry-v1/taiga/source-scale-v3.png assets/world/food-industry-v1/taiga/generation-job.json assets/world/food-industry-v1/taiga/source-scale-v3-registered.png
python3 tools/build-world-atlases.py --atlas assets/world/food-industry-v1/taiga/source-scale-v3-registered.png --columns 3 --rows 3 --ids industry:dairy-farm:taiga,industry:vegetable-farm:taiga,industry:orchard:taiga,industry:livestock-farm:taiga,industry:dairy-plant:taiga,industry:cannery:taiga,industry:meat-packer:taiga,-,- --output-dir assets/world/food-industry-v1/taiga --aligned --preserve-grid-scale --no-sharpen --max-cell 256
```

For a new generator job, use `node tools/generate-building-prompt.mjs generation-job.json /tmp/industry-prompt.json` and pass the resulting canonical prompt to the built-in image generator. Keep the generated source and any exact corrective edit instructions. Use the corresponding biome and IDs when rebuilding Desert.

`raster-industries.js` registers both climates and supplies generated art only for five-tile world compounds. Its default 160 px conceptual size becomes a 240 px upright sprite at Town zoom; smaller UI thumbnails retain the same artwork identity. Compact historic one-, two- and three-tile sites use the metre-calibrated recovery drawings in `processing-sprites.js`, keeping their personnel doors at the common scale. Startup loads only small densities for the active climate; sharper levels load on demand and invalidate native sprite caches when they arrive.

Verification: `tests/food-industry-art-browser-check.mjs` checks generated pixels at all three zoom levels and both display densities, native recovery and distinct silhouettes, transparent gutters and empty cells, then renders five-tile food chains beside roads and trucks. `tests/farm-core-art-browser-check.mjs` covers the separate two-tile farm buildings. The sprite-scale browser gallery also reviews compact historic recovery drawings and their uncut silhouettes.

Historical records remain for comparison: `prompt.json`, `packing-prompt.json`, `source-generated.png`, `source-packed.png`, `source-isolated.png` and `source-isolated.json` describe the earlier compact 3×3 artwork and independent 640 px silhouette registration. They are not the current source or packing instructions. Earlier 7×7 farm plots belong to published recipe 9; current new plots are 5×5, while saved geography remains compatible.
