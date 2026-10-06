# Desert cacti

Nine actual imagegen plant cutouts, generated on 2026-10-06 using the shared game camera, physical scale and painted style. The current desert house atlas was a style reference only. No old nature artwork was used as a reference.

`prompt.txt` contains the exact request produced by `cactusGenerationPrompt()` in `tree-art-catalog.js`. `generation.json` records the source, reference and prompt hashes, botanical descriptions, measured crown-to-root heights and physical registration factors. `source-generated-2026-10-06.png` is the unchanged imagegen output.

The first image has all nine identities and clean transparent roots, but its layout does not preserve equal-cell physical height. `register-source.py` therefore isolates the complete plants and uniformly resamples each whole cutout to its declared metre height at **32 master pixels per metre**. This is metre calibration, never fitting each plant to a maximum cell box. Proportions, plant anatomy, roots and the tiny contact shadow are retained; shorter plants remain smaller. All roots register at 95.5% of the 256px cell height. No plants, ground, spines, ribs or flowers are drawn by preparation scripts.

| Slot | Plant | Height |
| --- | --- | --- |
| 1 | Saguaro | 4.00 m |
| 2 | Organ pipe | 3.33 m |
| 3 | Cardon | 4.67 m |
| 4 | Senita | 2.67 m |
| 5 | Candelabra | 3.33 m |
| 6 | Tree cholla | 2.00 m |
| 7 | Golden barrel | 1.00 m |
| 8 | Fishhook barrel | 1.33 m |
| 9 | Hedgehog | 0.67 m |

To reproduce, run `python fun/transport/assets/world/nature-ground-desert/cacti/register-source.py` from the repository root, then run the exact `buildCommand` in `generation.json`. The shared atlas packer uses `--aligned --preserve-grid-scale --max-cell 256 --no-sharpen`. Each plant retains the same complete native envelope at every density; premultiplied-alpha filtering keeps the small versions quiet.

QA checked all 45 sprite/mip cells at 16, 32, 64, 128 and 256 pixels, distinct master cutouts, root alignment, transparent master boundaries, nonempty smaller mips and exact independent-cell resampling. `qa.json` records the measurements. At 16px, a root anchored at 95.5% contributes to the final pixel row; this is expected sampling of the complete transparent master, with no cross-cell contamination or source clipping.

Projection-unit correction: these forest/ground sprites render at 1:1 world pixels, while building billboards use a 1.5× enlargement. Current target and measured metre values are therefore the historical values divided by 1.5, and current master pixels per metre are multiplied by 1.5. Exact historical imagegen requests remain unchanged in the provenance files. All source/master/LOD artwork, uniform pixel resampling factors, root positions and shadow proportions are unchanged. `generation.json.projectionCorrection` records the conversion explicitly.
