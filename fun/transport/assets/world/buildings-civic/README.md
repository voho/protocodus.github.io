# Civic buildings

All active school, hospital, police station, fire station, stadium, church, pub, grocer and bakery sprites were regenerated with `image_gen` on 6 October 2026. Broad campuses and normal-sized storeys now share the same quiet architectural style as houses and industry.

Human-sized features use [sprite-art-direction.js](../../../sprite-art-direction.js): ordinary doors are 2.1m high, storeys 3m, windows 1.2m and loading bays 4.2m. Bigger parcels gain repeated bays, wings and floors at this same scale. Broad roof/wall colour masses replace tiny tiles, bricks, flower dots and ornamental texture; premultiplied-alpha mipmaps omit sharpening.

`scale-2026-10-06.json` records manually measured source personnel doors (approximately ±2px precision), expected final heights and one uniform source-pixel calibration per footprint tier. Original disconnected RGBA cutouts are registered without resampling to preserve complete shadows and edges. Alpha bounds locate ground contact only and never choose scale; every cutout in a tier uses the same pixel scale and fixed `(128,244)` contact anchor. The resulting full 256px parcel grid is packed with `--aligned --preserve-grid-scale --no-sharpen`. There is no runtime per-kind multiplier.

The generated input in each climate is `source-style-2026-10-06.png`; `source-registered-2026-10-06.png` retains original RGBA pixels in safe cells and `source-calibrated-2026-10-06.png` is the physical-scale master. Exact jobs and shared prompts are retained in `generation-2026-10-06.json`. Climate edits preserve the temperate source geometry and pixel proportions.

Rebuild the current three climates and five densities with:

```sh
python3 fun/transport/tools/calibrate-city-atlases.py fun/transport/assets/world/buildings-civic
```

Earlier `source-isometric*`, `generated/`, `windows.json`, prompt files and 2026-10-05 generation records are historical archives, not active art or rebuild inputs.
