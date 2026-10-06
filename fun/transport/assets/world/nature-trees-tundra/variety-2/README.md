# Tundra tree variety 2

Nine new isolated trees generated with `image_gen.imagegen` on 2026-10-06. `generation.json` records the exact canonical `treeGenerationPrompt('tundra', 2)`, transparent-background parameter, approved tundra-house style reference, source hashes, raw output path, measured trunk roots and whole-tree calibration. Original nine shipped trees are untouched.

The first generation copied old grass/stone mounds and was rejected. Its complete source and exact call remain in `source-rejected-mounds-2026-10-06.png` and `generation-rejected-mounds.json`. The accepted repair uses only house artwork as a style reference and contains bare roots with tiny contact shadows. Directional ground shadows are drawn separately by the game.

`source-generation-2026-10-06.png` is the unmodified accepted imagegen output. Its unequal source gutters are separated by disconnected alpha components, retaining all original meaningful RGBA pixels. `source-registered-2026-10-06.png` uses uniform scaling of each complete tree to the shared 19.72265 master pixels per metre. The visible trunk foot is centred at 95.5% of the 256px cell. This is physical crown-to-root calibration, never independent max-bounding-box enlargement.

| Species | Nominal metres | Calibrated metres |
| --- | ---: | ---: |
| arctic-birch | 4.67 | 4.67 |
| mountain-birch | 6.67 | 6.67 |
| silver-birch | 9.33 | 9.33 |
| grey-alder | 7.33 | 7.33 |
| green-alder | 5.33 | 5.33 |
| balsam-poplar | 9.33 | 9.33 |
| quaking-aspen | 8.67 | 8.67 |
| feltleaf-willow | 5.33 | 5.33 |
| goat-willow | 6.67 | 6.67 |

Rebuild all isolated masters and five unsharpened premultiplied LODs from the registered source:

```sh
python3 fun/transport/tools/build-world-atlases.py \
  --atlas fun/transport/assets/world/nature-trees-tundra/variety-2/source-registered-2026-10-06.png \
  --columns 3 --rows 3 --ids 'nature-trees-tundra:arctic-birch,nature-trees-tundra:mountain-birch,nature-trees-tundra:silver-birch,nature-trees-tundra:grey-alder,nature-trees-tundra:green-alder,nature-trees-tundra:balsam-poplar,nature-trees-tundra:quaking-aspen,nature-trees-tundra:feltleaf-willow,nature-trees-tundra:goat-willow' \
  --output-dir fun/transport/assets/world/nature-trees-tundra/variety-2 \
  --aligned --preserve-grid-scale --max-cell 256 --no-sharpen
```

After rebuilding, retain the linked `physicalCalibration` metadata from this `atlas.json`. Each proportional transform is recorded with its exact source bounds, source root, scale and target anchor in `generation.json` so the registered sheet can be reproduced with `build-house-atlases.py`'s premultiplied `resize_alpha()` helper.

QA: nine unique source cutouts; all 45 cell/LOD profiles nonempty. Master side gutters remain 34px or wider and 128/256px edge alpha is 0. At 32/64px only≤14 edge filtering fringe remains. At 16px the 95.5% root anchor lies in the last pixel row, so the bottom retains alpha 73–115 root/contact-shadow coverage from complete masters; other edges remain clear. Visual 128/64/32/16px review passed: no clipped crown, missing trunk, duplicate tree, painted ground disc or long baked shadow.

Projection-unit correction: these forest/ground sprites render at 1:1 world pixels, while building billboards use a 1.5× enlargement. Current target and measured metre values are therefore the historical values divided by 1.5, and current master pixels per metre are multiplied by 1.5. Exact historical imagegen requests remain unchanged in the provenance files. All source/master/LOD artwork, uniform pixel resampling factors, root positions and shadow proportions are unchanged. `generation.json.projectionCorrection` records the conversion explicitly.
